namespace MedicalQcWebDemo;

// Ephemeral result identity, never a clinical certification or a durable text log.
// AppVersion is a release label, not an assertion about a Git commit or clean tree.
public sealed record ReviewIdentity(string TargetLanguage, string SourceSha256, string DraftSha256,
    string TextNormalization, string RuleVersion, string AppVersion)
{
    public static ReviewIdentity Create(string source, string draft, string language)
    {
        static string Hash(string text) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(text.Trim()))).ToLowerInvariant();
        return new(language, Hash(source), Hash(draft), "trim-utf8", ExcerptQc.RuleVersion, "mtqc-web-review-20261018");
    }
}

public sealed record ReviewStage(string State, string? Model = null, int? PromptTokens = null,
    int? CompletionTokens = null, long? ElapsedMs = null);

public sealed record RuleFinding(string Category, string Severity, string Message,
    string? SourceSpan = null, string? DraftSpan = null);
public sealed record RuleCoverage(string Category, string State);

public sealed record RuleEvaluation(IReadOnlyList<RuleFinding> Findings,
    IReadOnlyList<RuleCoverage> Coverage);

public sealed record ReviewRun(string RunId, ReviewStage TranslationStage, ReviewStage CritiqueStage,
    ReviewStage RulesStage, IReadOnlyList<CritiqueFinding> ModelFindings,
    IReadOnlyList<RuleFinding> RuleFindings, IReadOnlyList<RuleCoverage> Coverage,
    long ElapsedMs, bool RequiresHumanReview = true, decimal? EstimatedCostUsd = null,
    ReviewIdentity? Identity = null);
