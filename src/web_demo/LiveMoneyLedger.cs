using System.Text.Json;

namespace MedicalQcWebDemo;

// Only a local operator can supply this receipt; there is no HTTP reconciliation route.
public sealed record LiveBillingReceipt(string CallId, string Bucket, string Model,
    decimal BilledCostUsd, string Evidence, DateTimeOffset ConfirmedAtUtc);

// An operator's explicit budget loss acceptance is NOT a provider billing receipt.
public sealed record LiveReservationLossAcceptance(string CallId, decimal ReservedUsd,
    string Evidence, DateTimeOffset AcceptedAtUtc);

internal sealed class LiveMoneyLedger(LiveMoneyOptions options, TimeProvider clock)
{
    private sealed record CostState(int Version, decimal PriorCashHoldUsd, List<CostEntry> Calls);
    private sealed record CostEntry(string CallId, string RunId, string Day, string Bucket,
        string BillingEvidence, decimal TaxMultiplier, decimal ReservedUsd, string State,
        string? Model = null, int? PromptTokens = null, int? CompletionTokens = null,
        decimal? EstimatedCostUsd = null, decimal? BilledCostUsd = null,
        decimal InputUsdPerMillion = LiveMoneyOptions.InputUsdPerMillion,
        decimal OutputUsdPerMillion = LiveMoneyOptions.OutputUsdPerMillion,
        string PriceVersion = LiveMoneyOptions.PriceVersion,
        DateTimeOffset ReservedAtUtc = default, DateTimeOffset? StartedAtUtc = null,
        DateTimeOffset? ObservedAtUtc = null, DateTimeOffset? FinishedAtUtc = null,
        string? Outcome = null, string? BillingReceipt = null, DateTimeOffset? BillingConfirmedAtUtc = null,
        string AdmissionPolicy = "settled", LiveReservationLossAcceptance? LossAcceptance = null);

    private string Day => clock.GetUtcNow().ToOffset(TimeSpan.FromHours(9)).ToString("yyyy-MM-dd");
    private static decimal Committed(CostEntry entry) => entry.State == "cancelled" ? 0m :
        entry.State == "reconciled" ? entry.BilledCostUsd!.Value : entry.ReservedUsd;
    private static bool Unresolved(CostEntry entry) => entry.State is "reserved" or "started" or "pending-billing" or "unknown-cost" or "failed-cost-held";
    private bool BlocksAdmission(CostEntry entry) => Unresolved(entry) &&
        !(options.UsesReservationBudget && entry.AdmissionPolicy == LiveMoneyOptions.ReservationPolicy &&
          entry.Bucket == "operator-budget" && (entry.State == "pending-billing" || entry.LossAcceptance is not null));

    private bool WithinLimits(CostState state, decimal extra, string day)
    {
        if (state.Calls.Where(c => c.Day == day).Sum(Committed) + extra > options.DailyLimitUsd) return false;
        if (options.UsesReservationBudget)
            return state.PriorCashHoldUsd + state.Calls.Sum(Committed) + extra <= options.AuthorizedBudgetUsd;
        if (options.BillingBucket == "promo")
            return state.Calls.Where(c => c.Bucket == "promo").Sum(Committed) + extra <=
                Math.Min(LiveMoneyOptions.PromoExposureLimitUsd,
                    options.PromoRemainingUsd.GetValueOrDefault() - LiveMoneyOptions.PromoProtectedUsd);
        return state.Calls.Where(c => c.Bucket == "trial").Sum(Committed) + (options.BillingBucket == "trial" ? extra : 0m)
                <= Math.Min(1m, options.TrialRemainingUsd.GetValueOrDefault()) &&
            state.PriorCashHoldUsd + state.Calls.Where(c => c.Bucket == "cash").Sum(Committed) +
                (options.BillingBucket == "cash" ? extra : 0m) <= Math.Min(5m, options.CashRemainingUsd.GetValueOrDefault() - 20m);
    }

    public bool HasCapacity(int count) => Transaction(state =>
        !state.Calls.Any(BlocksAdmission) && count * options.MaximumCallUsd <= options.PerRunLimitUsd &&
        WithinLimits(state, count * options.MaximumCallUsd, Day), write: false, admission: true);

    public LiveRunOwnership? Reserve(string runId, int count)
    {
        LiveRunOwnership? ownership = null;
        var reserved = Transaction(state =>
        {
            var maximum = count * options.MaximumCallUsd;
            if (state.Calls.Any(BlocksAdmission) || state.Calls.Count + count > 1000 ||
                maximum > options.PerRunLimitUsd || !WithinLimits(state, maximum, Day)) return false;
            // Create ownership only for an admitted run, while the ledger is locked.
            ownership = TryOwnRun(runId);
            if (ownership is null) return false;
            for (var index = 0; index < count; index++)
                state.Calls.Add(new($"{runId}-{index}", runId, Day, options.BillingBucket,
                    options.BillingEvidence, options.TaxMultiplier, options.MaximumCallUsd, "reserved",
                    ReservedAtUtc: clock.GetUtcNow(), AdmissionPolicy: options.AdmissionPolicy));
            return true;
        }, admission: true);
        if (reserved) return ownership;
        ownership?.Dispose();
        return null;
    }

    // OS ownership ends on process loss, but its absence never releases a charge.
    // Keep sidecars in place: unlinking a locked file can split ownership on Unix.
    internal LiveRunOwnership? TryOwnRun(string runId)
    {
        if (!options.IsStructurallyValid()) return null;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(options.LedgerPath)!);
            return new(new FileStream(options.LedgerPath + ".run-" + runId + ".lock",
                FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            return null;
        }
    }

    public LiveCostCall? Start(string runId, int index, LiveRunOwnership ownership)
    {
        var callOwnership = ownership.Retain();
        if (callOwnership is null) return null;
        var id = $"{runId}-{index}";
        var started = Transaction(state =>
        {
            var position = state.Calls.FindIndex(c => c.CallId == id);
            if (position < 0 || state.Calls[position].State != "reserved" ||
                state.Calls.Any(c => BlocksAdmission(c) && (c.RunId != runId || c.State != "reserved"))) return false;
            var entry = state.Calls[position];
            if (entry.Day != Day)
            {
                // A reserved request crossing KST midnight must fit the new day's ceiling too.
                var otherToday = state.Calls.Where(c => c.Day == Day && c.CallId != id).Sum(Committed);
                if (otherToday + entry.ReservedUsd > options.DailyLimitUsd) return false;
            }
            state.Calls[position] = entry with { Day = Day, State = "started", StartedAtUtc = clock.GetUtcNow() };
            return true;
        }, admission: true);
        if (started) return new LiveCostCall(this, id, callOwnership);
        callOwnership.Dispose();
        return null;
    }

    public bool Observe(string id, string? model, int? prompt, int? completion) => Transaction(state =>
    {
        var position = state.Calls.FindIndex(c => c.CallId == id);
        if (position < 0 || state.Calls[position].State != "started") return false;
        var entry = state.Calls[position];
        var valid = model == LiveMoneyOptions.Model && prompt is >= 0 and <= LiveMoneyOptions.InputTokenBound &&
            completion is >= 0 and <= LiveMoneyOptions.OutputTokenBound;
        decimal? estimate = valid ? (prompt!.Value * entry.InputUsdPerMillion + completion!.Value * entry.OutputUsdPerMillion) / 1_000_000m * entry.TaxMultiplier : null;
        state.Calls[position] = entry with
        {
            Model = model == LiveMoneyOptions.Model ? model : null,
            PromptTokens = prompt is >= 0 and <= LiveMoneyOptions.InputTokenBound ? prompt : null,
            CompletionTokens = completion is >= 0 and <= LiveMoneyOptions.OutputTokenBound ? completion : null,
            EstimatedCostUsd = estimate, ObservedAtUtc = clock.GetUtcNow()
        };
        return true;
    });

    public bool Finish(string id, bool success) => Transaction(state =>
    {
        var position = state.Calls.FindIndex(c => c.CallId == id);
        if (position < 0 || state.Calls[position].State != "started") return false;
        var entry = state.Calls[position];
        // Usage pricing is an estimate; retain the full reservation. The default
        // policy blocks the next dispatch. Only explicitly authorized reservation
        // entries can continue within their cumulative envelope, never as settled charges.
        state.Calls[position] = entry with { State = success && entry.EstimatedCostUsd is not null ? "pending-billing" :
            entry.EstimatedCostUsd is not null ? "failed-cost-held" : "unknown-cost",
            Outcome = success ? "accepted" : "failed", FinishedAtUtc = clock.GetUtcNow() };
        return true;
    });

    public bool AcceptReservationLoss(LiveReservationLossAcceptance acceptance) => Transaction(state =>
    {
        if (!options.UsesReservationBudget || acceptance is null) return false;
        var position = state.Calls.FindIndex(c => c.CallId == acceptance.CallId);
        if (position < 0) return false;
        var entry = state.Calls[position];
        if (!ValidLossAcceptance(entry, acceptance) ||
            entry.LossAcceptance is not null && entry.LossAcceptance != acceptance) return false;
        // A finished call can still have an enclosing live lease. Never bypass it.
        using var ownership = TryOwnRun(entry.RunId);
        if (ownership is null) return false;
        state.Calls[position] = entry with { LossAcceptance = acceptance };
        return true;
    });

    public bool Reconcile(LiveBillingReceipt receipt) => Transaction(state =>
    {
        if (receipt is null || !EvidenceId(receipt.Evidence) || receipt.Model != LiveMoneyOptions.Model ||
            receipt.ConfirmedAtUtc > clock.GetUtcNow()) return false;
        var position = state.Calls.FindIndex(c => c.CallId == receipt.CallId);
        if (position < 0) return false;
        var entry = state.Calls[position];
        // Full loss acceptance is permanent budget consumption, not settlement.
        // Keep any later actual provider receipt separately; do not reclaim this reserve.
        if (entry.LossAcceptance is not null) return false;
        if (receipt.Bucket != entry.Bucket || receipt.BilledCostUsd < 0m || receipt.BilledCostUsd > entry.ReservedUsd ||
            receipt.ConfirmedAtUtc < (entry.FinishedAtUtc ?? entry.StartedAtUtc ?? entry.ReservedAtUtc)) return false;
        if (entry.State == "reconciled") return entry.BilledCostUsd == receipt.BilledCostUsd &&
            entry.BillingReceipt == receipt.Evidence && entry.BillingConfirmedAtUtc == receipt.ConfirmedAtUtc;
        if (entry.State is "reserved" or "started")
        {
            // Explicit local receipt only, and only after every lease/call owner is gone.
            // Older binaries predate these locks; stop them before orphan recovery.
            using var orphanOwnership = TryOwnRun(entry.RunId);
            if (orphanOwnership is null) return false;
        }
        else if (entry.State is not ("pending-billing" or "failed-cost-held" or "unknown-cost")) return false;
        state.Calls[position] = entry with { State = "reconciled", BilledCostUsd = receipt.BilledCostUsd,
            BillingReceipt = receipt.Evidence, BillingConfirmedAtUtc = receipt.ConfirmedAtUtc };
        return true;
    });

    public void CancelUnstarted(string runId) => Transaction(state =>
    {
        for (var index = 0; index < state.Calls.Count; index++)
            if (state.Calls[index].RunId == runId && state.Calls[index].State == "reserved")
                state.Calls[index] = state.Calls[index] with { State = "cancelled" };
        return true;
    });

    public decimal? Estimate(string runId)
    {
        decimal? estimate = null;
        Transaction(state =>
        {
            var calls = state.Calls.Where(c => c.RunId == runId && c.State != "cancelled").ToArray();
            if (calls.Length > 0 && calls.All(c => c.EstimatedCostUsd is not null))
                estimate = calls.Sum(c => c.EstimatedCostUsd!.Value);
            return true;
        }, write: false);
        return estimate;
    }

    private bool Transaction(Func<CostState, bool> action, bool write = true, bool admission = false)
    {
        if (!options.IsStructurallyValid() || admission && !options.IsValid(clock.GetUtcNow())) return false;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(options.LedgerPath)!);
            if (!File.Exists(options.LedgerPath))
            {
                try
                {
                    using var created = new FileStream(options.LedgerPath, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                    JsonSerializer.Serialize(created, new CostState(2, 0.015m, []));
                    created.Flush(true);
                }
                catch (IOException) when (File.Exists(options.LedgerPath)) { }
            }
            using var file = new FileStream(options.LedgerPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
            if (file.Length is < 1 or > 4_000_000) return false;
            var state = JsonSerializer.Deserialize<CostState>(file);
            if (state is null || state.Version is not (2 or 3) || state.PriorCashHoldUsd != 0.015m || state.Calls is null ||
                state.Calls.Count > 1000 || state.Calls.Any(c => !ValidEntry(c)) ||
                (state.Version == 3) != state.Calls.Any(c => c.LossAcceptance is not null) ||
                state.Calls.Select(c => c.CallId).Distinct(StringComparer.Ordinal).Count() != state.Calls.Count) return false;
            if (!action(state)) return false;
            if (write)
            {
                // Historical v2 tools must reject, rather than erase, explicit loss metadata.
                if (state.Calls.Any(c => c.LossAcceptance is not null)) state = state with { Version = 3 };
                var bytes = JsonSerializer.SerializeToUtf8Bytes(state);
                file.Position = 0;
                file.SetLength(0);
                file.Write(bytes);
                file.Flush(true);
            }
            return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or
            NotSupportedException or JsonException or InvalidOperationException or OverflowException)
        {
            // Never replace damaged accounting state or release an uncertain charge automatically.
            return false;
        }
    }

    private bool ValidLossAcceptance(CostEntry entry, LiveReservationLossAcceptance acceptance) =>
        entry.AdmissionPolicy == LiveMoneyOptions.ReservationPolicy && entry.Bucket == "operator-budget" &&
        entry.State is "unknown-cost" or "failed-cost-held" && entry.Outcome == "failed" &&
        entry.StartedAtUtc is not null && entry.FinishedAtUtc >= entry.StartedAtUtc &&
        acceptance.CallId == entry.CallId && acceptance.ReservedUsd == entry.ReservedUsd &&
        EvidenceId(acceptance.Evidence) && acceptance.AcceptedAtUtc >= entry.FinishedAtUtc &&
        acceptance.AcceptedAtUtc <= clock.GetUtcNow();

    private bool ValidEntry(CostEntry c) => c is not null &&
        c.RunId is { Length: 32 } && c.RunId.All(char.IsAsciiHexDigit) &&
        (c.CallId == c.RunId + "-0" || c.CallId == c.RunId + "-1") &&
        DateOnly.TryParseExact(c.Day, "yyyy-MM-dd", out _) &&
        (c.AdmissionPolicy == "settled" ? c.Bucket is "trial" or "cash" or "promo" :
            c.AdmissionPolicy == LiveMoneyOptions.ReservationPolicy && c.Bucket == "operator-budget") &&
        EvidenceId(c.BillingEvidence) && c.ReservedAtUtc != default &&
        c.InputUsdPerMillion == LiveMoneyOptions.InputUsdPerMillion && c.OutputUsdPerMillion == LiveMoneyOptions.OutputUsdPerMillion &&
        c.PriceVersion == LiveMoneyOptions.PriceVersion &&
        c.TaxMultiplier is >= 1m and <= 2m && c.ReservedUsd is > 0m and <= 0.15m &&
        (c.AdmissionPolicy != LiveMoneyOptions.ReservationPolicy ||
            c.ReservedUsd == LiveMoneyOptions.MaximumCallForTax(c.TaxMultiplier)) &&
        c.State is "reserved" or "started" or "pending-billing" or "unknown-cost" or "failed-cost-held" or "cancelled" or "reconciled" &&
        (c.State == "reconciled" ? c.BilledCostUsd is >= 0m && c.BilledCostUsd <= c.ReservedUsd &&
            EvidenceId(c.BillingReceipt) && c.BillingConfirmedAtUtc >= (c.FinishedAtUtc ?? c.StartedAtUtc ?? c.ReservedAtUtc) :
            c.BilledCostUsd is null && c.BillingReceipt is null && c.BillingConfirmedAtUtc is null) &&
        (c.State != "pending-billing" || c.EstimatedCostUsd is not null) &&
        (c.LossAcceptance is null || ValidLossAcceptance(c, c.LossAcceptance)) &&
        (c.AdmissionPolicy != LiveMoneyOptions.ReservationPolicy || c.State != "pending-billing" ||
            c.Outcome == "accepted" && c.StartedAtUtc is not null && c.ObservedAtUtc is not null && c.FinishedAtUtc is not null) &&
        (c.EstimatedCostUsd is null || c.Model == LiveMoneyOptions.Model && c.PromptTokens is >= 0 and <= LiveMoneyOptions.InputTokenBound &&
            c.CompletionTokens is >= 0 and <= LiveMoneyOptions.OutputTokenBound &&
            c.EstimatedCostUsd == (c.PromptTokens.Value * c.InputUsdPerMillion + c.CompletionTokens.Value * c.OutputUsdPerMillion) / 1_000_000m * c.TaxMultiplier &&
            c.EstimatedCostUsd <= c.ReservedUsd);

    private static bool EvidenceId(string? evidence) => !string.IsNullOrWhiteSpace(evidence) && evidence.Length <= 160 &&
        evidence.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' or ':');
}

// A cost call retains the OS lock even if its enclosing lease is disposed early.
internal sealed class LiveRunOwnership : IDisposable
{
    private sealed class Shared(FileStream stream)
    {
        public FileStream? Stream = stream;
        public int Count = 1;
    }
    private Shared? shared;
    internal LiveRunOwnership(FileStream stream) => shared = new(stream);
    private LiveRunOwnership(Shared shared) => this.shared = shared;
    internal LiveRunOwnership? Retain()
    {
        var current = shared;
        if (current is null) return null;
        lock (current)
        {
            if (current.Stream is null) return null;
            current.Count++;
            return new(current);
        }
    }
    public void Dispose()
    {
        var current = Interlocked.Exchange(ref shared, null);
        if (current is null) return;
        lock (current)
        {
            if (--current.Count != 0) return;
            current.Stream?.Dispose();
            current.Stream = null;
        }
    }
}

public sealed class LiveCostCall : IDisposable
{
    private readonly LiveMoneyLedger ledger;
    private readonly string id;
    private LiveRunOwnership? ownership;
    private bool finished;
    internal LiveCostCall(LiveMoneyLedger ledger, string id, LiveRunOwnership ownership) =>
        (this.ledger, this.id, this.ownership) = (ledger, id, ownership);
    internal void Observe(string? model, int? prompt, int? completion)
    {
        if (!ledger.Observe(id, model, prompt, completion)) throw new InvalidDataException("Cost usage could not be recorded");
    }
    internal void Complete()
    {
        if (!ledger.Finish(id, true)) throw new InvalidDataException("Cost accounting could not be completed");
        finished = true;
    }
    public void Dispose()
    {
        try
        {
            if (!finished) ledger.Finish(id, false);
            finished = true;
        }
        finally { Interlocked.Exchange(ref ownership, null)?.Dispose(); }
    }
}
