namespace MedicalQcWebDemo;

public sealed record CritiqueFinding(string Category, string Severity, string? SourceSpan,
    string? DraftSpan, string Rationale);

public sealed record NebiusCritique(IReadOnlyList<CritiqueFinding> Findings, string Model,
    int? PromptTokens, int? CompletionTokens);
