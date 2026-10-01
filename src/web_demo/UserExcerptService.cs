using System.Diagnostics;

namespace MedicalQcWebDemo;

public sealed record UserExcerptRequest(string SourceText, string TargetLanguage);

public sealed class UserExcerptService
{
    public static readonly string[] TargetLanguages =
    ["ko", "es", "ar", "zh-CN", "zh-TW", "ja", "fr", "de", "it", "pt", "ru", "hi", "id", "nl", "pl", "th", "tr", "vi"];

    private readonly NebiusClient provider;
    private readonly LiveOptions options;
    private readonly LiveBudget budget;

    public UserExcerptService(NebiusClient provider, LiveOptions options, LiveBudget budget)
    {
        this.provider = provider;
        this.options = options;
        this.budget = budget;
    }

    public async Task<LiveExcerptResult> ExecuteAsync(UserExcerptRequest request, string clientId, CancellationToken cancellationToken)
    {
        if (!options.Enabled || string.IsNullOrWhiteSpace(options.ApiKey))
            return new("unavailable", "Live translation is disabled on this server. Recorded cases remain available.");
        if (request is null || string.IsNullOrWhiteSpace(request.SourceText) ||
            request.SourceText.EnumerateRunes().Count() > 3000 ||
            !TargetLanguages.Contains(request.TargetLanguage, StringComparer.Ordinal))
            return new("invalid", "Provide a reviewed English excerpt of 1–3,000 characters and a supported target language.");
        using var lease = await budget.TryAcquireAsync(clientId, 2, cancellationToken);
        if (lease is null) return new("rate-limited", "Live demo request limit reached. Try a recorded case or return later.");
        var timer = Stopwatch.StartNew();
        var runId = Guid.NewGuid().ToString("N");
        var translationStage = new ReviewStage("pending");
        var critiqueStage = new ReviewStage("pending");
        var rulesStage = new ReviewStage("pending");
        var modelFindings = (IReadOnlyList<CritiqueFinding>)Array.Empty<CritiqueFinding>();
        var ruleFindings = (IReadOnlyList<RuleFinding>)Array.Empty<RuleFinding>();
        var coverage = (IReadOnlyList<RuleCoverage>)Array.Empty<RuleCoverage>();
        ReviewRun Review() => new(runId, translationStage, critiqueStage, rulesStage,
            modelFindings, ruleFindings, coverage, timer.ElapsedMilliseconds);
        var source = request.SourceText.Trim();
        NebiusOutput output;
        try
        {
            var started = timer.ElapsedMilliseconds;
            output = await provider.TranslateAsync(source, request.TargetLanguage, cancellationToken);
            translationStage = new("completed", output.Model, output.PromptTokens,
                output.CompletionTokens, timer.ElapsedMilliseconds - started);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or InvalidDataException or System.Text.Json.JsonException)
        {
            translationStage = new("failed", ElapsedMs: timer.ElapsedMilliseconds);
            return new("provider-error", "Translation did not complete. Check model access or credit; no draft was accepted.", Review: Review());
        }
        try
        {
            var started = timer.ElapsedMilliseconds;
            var critique = await provider.CritiqueAsync(source, request.TargetLanguage, output.Text, cancellationToken);
            modelFindings = critique.Findings;
            critiqueStage = new("completed", critique.Model, critique.PromptTokens,
                critique.CompletionTokens, timer.ElapsedMilliseconds - started);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or InvalidDataException or System.Text.Json.JsonException)
        {
            critiqueStage = new("failed", ElapsedMs: timer.ElapsedMilliseconds - translationStage.ElapsedMs.GetValueOrDefault());
        }
        try
        {
            var started = timer.ElapsedMilliseconds;
            var rules = ExcerptQc.Evaluate(source, output.Text, request.TargetLanguage);
            ruleFindings = rules.Findings;
            coverage = rules.Coverage;
            rulesStage = new("completed", ElapsedMs: timer.ElapsedMilliseconds - started);
        }
        catch (Exception)
        {
            rulesStage = new("failed");
        }
        var complete = critiqueStage.State == "completed" && rulesStage.State == "completed";
        return new(complete ? "ok" : "partial",
            complete ? "AI draft and automated review completed; human medical and linguistic review is still required."
                : "AI draft — review incomplete. Human review is required; do not treat this as an approved translation.",
            output.Text, output.Model, output.PromptTokens, output.CompletionTokens,
            ExcerptQc.Summarize(source, output.Text, request.TargetLanguage), Review());
    }
}
