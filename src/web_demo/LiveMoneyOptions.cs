namespace MedicalQcWebDemo;

// Account evidence is operator configuration, never a claim inferred from an API key.
public sealed record LiveMoneyOptions(string LedgerPath, string BillingBucket,
    string BillingEvidence, DateTimeOffset VerifiedAtUtc, decimal? TrialRemainingUsd,
    decimal? CashRemainingUsd, decimal TaxMultiplier,
    decimal DailyLimitUsd = 0.50m, decimal PerRunLimitUsd = 0.15m,
    decimal? PromoRemainingUsd = null, DateTimeOffset? PromoExpiresAtUtc = null)
{
    public const string Model = "nvidia/Nemotron-3_5-Lightning";
    // Deliberately over-reserve input: even a complete 1M-token context is covered.
    // This is a cost bound, not a claim about the provider's supported context length.
    public const int InputTokenBound = 1_048_576;
    public const int OutputTokenBound = 1800;
    public const decimal InputUsdPerMillion = 0.06m;
    public const decimal OutputUsdPerMillion = 0.24m;
    public const string PriceVersion = "nebius-standard-2026-08-01";
    public const decimal PromoProtectedUsd = 20m;
    public const decimal PromoExposureLimitUsd = 5m;
    public decimal MaximumCallUsd => decimal.Ceiling(
        (InputTokenBound * InputUsdPerMillion + OutputTokenBound * OutputUsdPerMillion) / 1_000_000m * TaxMultiplier * 100_000_000m) / 100_000_000m;

    public bool IsValid(DateTimeOffset now) => IsStructurallyValid() &&
        VerifiedAtUtc <= now && now - VerifiedAtUtc <= TimeSpan.FromHours(24) &&
        (BillingBucket != "promo" || PromoExpiresAtUtc > now);

    internal bool IsStructurallyValid() => !string.IsNullOrWhiteSpace(LedgerPath) && Path.IsPathFullyQualified(LedgerPath) &&
        BillingBucket is "trial" or "cash" or "promo" &&
        !string.IsNullOrWhiteSpace(BillingEvidence) && BillingEvidence.Length <= 160 &&
        BillingEvidence.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' or ':') &&
        (BillingBucket == "promo"
            ? TrialRemainingUsd is null && CashRemainingUsd is null &&
              PromoRemainingUsd is >= 0m and <= 25m && PromoExpiresAtUtc > VerifiedAtUtc
            : TrialRemainingUsd is >= 0m and <= 1m && CashRemainingUsd is >= 20m and <= 25m &&
              PromoRemainingUsd is null && PromoExpiresAtUtc is null) &&
        TaxMultiplier is >= 1m and <= 2m && DailyLimitUsd is > 0m and <= 0.50m &&
        PerRunLimitUsd is > 0m and <= 0.15m;

    public static LiveMoneyOptions? FromEnvironment(string model, bool requireFresh = true)
    {
        string? Env(string name) => Environment.GetEnvironmentVariable("DEMO_LIVE_" + name);
        bool Amount(string name, out decimal value) => decimal.TryParse(Env(name),
            System.Globalization.NumberStyles.AllowDecimalPoint, System.Globalization.CultureInfo.InvariantCulture, out value);
        if (model != Model || Env("COST_LEDGER_PATH") is not string path ||
            Env("BILLING_BUCKET") is not string bucket || Env("BILLING_EVIDENCE") is not string evidence ||
            !DateTimeOffset.TryParse(Env("BILLING_VERIFIED_UTC"), System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeUniversal, out var verified) ||
            !Amount("TAX_MULTIPLIER", out var tax)) return null;
        LiveMoneyOptions options;
        if (bucket == "promo")
        {
            // Unknown legacy balances stay unknown; never relabel a Builder grant as cash.
            if (Env("TRIAL_REMAINING_USD") is not null || Env("CASH_REMAINING_USD") is not null ||
                !Amount("PROMO_REMAINING_USD", out var promo) ||
                !DateTimeOffset.TryParse(Env("PROMO_EXPIRES_UTC"), System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.AssumeUniversal, out var expires)) return null;
            options = new(path, bucket, evidence, verified, null, null, tax,
                PromoRemainingUsd: promo, PromoExpiresAtUtc: expires);
        }
        else
        {
            if (Env("PROMO_REMAINING_USD") is not null || Env("PROMO_EXPIRES_UTC") is not null ||
                !Amount("TRIAL_REMAINING_USD", out var trial) || !Amount("CASH_REMAINING_USD", out var cash)) return null;
            options = new(path, bucket, evidence, verified, trial, cash, tax);
        }
        return (requireFresh ? options.IsValid(DateTimeOffset.UtcNow) : options.IsStructurallyValid()) ? options : null;
    }
}
