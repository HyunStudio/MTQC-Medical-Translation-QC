namespace MedicalQcWebDemo;

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
    long ElapsedMs, bool RequiresHumanReview = true, decimal? EstimatedCostUsd = null);
