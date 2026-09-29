namespace MedicalQcWebDemo;

public sealed record LiveExcerptRequest(string CaseId, string TargetLanguage);
public sealed record LiveAvailability(bool Available, string Reason);
public sealed record LiveExcerptResult(string Status, string Message, string? Translation = null,
    string? Model = null, int? PromptTokens = null, int? CompletionTokens = null,
    string? QcSummary = null);
public sealed record LiveOptions(bool Enabled, string? ApiKey, int PerClientLimit = 3,
    int GlobalHourlyLimit = 20, int MaxTrackedClients = 4096,
    int? LifetimeAttemptLimit = null, string? LifetimeLedgerPath = null)
{
    public static int ParsePerClientLimit(string? raw) =>
        int.TryParse(raw, out var value) && value is >= 1 and <= 20 ? value : 3;
}

public sealed class LiveExcerptService
{
    private readonly DemoCaseCatalog catalog;
    private readonly NebiusClient provider;
    private readonly LiveOptions options;
    private readonly LiveBudget budget;
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly Dictionary<string, (DateTimeOffset Expires, LiveExcerptResult Result)> cache = new(StringComparer.Ordinal);

    public LiveExcerptService(DemoCaseCatalog catalog, NebiusClient provider, LiveOptions options, LiveBudget? budget = null)
    {
        this.catalog = catalog;
        this.provider = provider;
        this.options = options;
        this.budget = budget ?? new LiveBudget(options);
    }

    public LiveAvailability Availability => !options.Enabled
        ? new(false, "Live excerpt is disabled on this server. Recorded cases remain available without a model call.")
        : string.IsNullOrWhiteSpace(options.ApiKey)
            ? new(false, "Live excerpt is unavailable on this server.")
            : new(true, "Configured; provider credit and model entitlement are not verified by this status check.");

    public async Task<LiveExcerptResult> ExecuteAsync(LiveExcerptRequest request, string clientId, CancellationToken cancellationToken)
    {
        if (!Availability.Available) return new("unavailable", Availability.Reason);
        if (string.IsNullOrWhiteSpace(request.CaseId) || string.IsNullOrWhiteSpace(request.TargetLanguage))
            return new("invalid", "This case or language is not in the tested live subset.");
        var item = catalog.Get(request.CaseId);
        if (request.CaseId != "mueller-figure1" || item is null ||
            request.TargetLanguage is not ("ko" or "es" or "ar") ||
            item.Translations.All(x => x.Language != request.TargetLanguage))
            return new("invalid", "This case or language is not in the tested live subset.");
        var caption = item.Source.Sections.FirstOrDefault(x => x.Id == "caption")?.Text;
        if (caption is null || caption.Length > 640)
            return new("invalid", "The fixed excerpt is unavailable or too long.");

        await gate.WaitAsync(cancellationToken);
        try
        {
            var now = DateTimeOffset.UtcNow;
            var key = $"{request.CaseId}:{request.TargetLanguage}";
            if (cache.TryGetValue(key, out var cached) && cached.Expires > now) return cached.Result;
            using var lease = await budget.TryAcquireAsync(clientId, cancellationToken);
            if (lease is null)
                return new("rate-limited", "Live demo request limit reached. The recorded case remains available.");

            try
            {
                var output = await provider.TranslateAsync(caption, request.TargetLanguage, cancellationToken);
                var qc = output.Text.Contains("2,185", StringComparison.Ordinal) || output.Text.Contains("2.185", StringComparison.Ordinal)
                    ? "Number 2,185 appears in output; independent medical and linguistic review is still required."
                    : "Number 2,185 was not found exactly; review numeric fidelity and all medical terms before use.";
                if (request.TargetLanguage == "ko" && caption.Contains("proximal", StringComparison.OrdinalIgnoreCase) &&
                    output.Text.Contains("원위", StringComparison.Ordinal) && !output.Text.Contains("근위", StringComparison.Ordinal))
                    qc += " High-risk directional mismatch: the source says proximal, but the Korean draft appears to say distal; human review required.";
                if (request.TargetLanguage == "ar" &&
                    (output.Text.Contains("proximal", StringComparison.OrdinalIgnoreCase) ||
                     output.Text.Contains("distal", StringComparison.OrdinalIgnoreCase)))
                    qc += " Untranslated English directional term remains in the Arabic draft; human review required.";
                var result = new LiveExcerptResult("ok", "Live model excerpt only—not a full-document or clinically validated translation.",
                    output.Text, output.Model, output.PromptTokens, output.CompletionTokens, qc);
                cache[key] = (now + TimeSpan.FromMinutes(15), result);
                return result;
            }
            catch (Exception error) when (error is HttpRequestException or TaskCanceledException or InvalidDataException or System.Text.Json.JsonException)
            {
                return new("provider-error", "The provider could not complete this excerpt. Check model access or credit; the recorded case remains available.");
            }
        }
        finally
        {
            gate.Release();
        }
    }
}
