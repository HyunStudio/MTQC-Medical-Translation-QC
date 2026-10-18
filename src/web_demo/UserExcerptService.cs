using System.Diagnostics;

namespace MedicalQcWebDemo;

public sealed record UserExcerptRequest(string SourceText, string TargetLanguage, bool IncludeExperimentalCritique = false);

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
            request.SourceText.Any(ch => char.IsControl(ch) && ch is not ('\t' or '\n' or '\r')) ||
            !TargetLanguages.Contains(request.TargetLanguage, StringComparer.Ordinal))
            return new("invalid", "Provide a reviewed English excerpt of 1–3,000 readable characters and a supported target language. Correct any unreadable PDF glyphs against the original.");
        if (provider.RequestedModel != LiveMoneyOptions.Model)
            return new("rate-limited", "Live model cost is not approved. Recorded examples remain available.");
        using var lease = await budget.TryAcquireAsync(clientId, request.IncludeExperimentalCritique ? 2 : 1, cancellationToken);
        if (lease is null) return new("rate-limited", "Live budget or request limit reached, or cost accounting is not ready. Recorded examples remain available without a paid call.");
        var timer = Stopwatch.StartNew();
        var runId = Guid.NewGuid().ToString("N");
        var translationStage = new ReviewStage("pending");
        var critiqueStage = new ReviewStage(request.IncludeExperimentalCritique ? "pending" : "skipped");
        var rulesStage = new ReviewStage("pending");
        var modelFindings = (IReadOnlyList<CritiqueFinding>)Array.Empty<CritiqueFinding>();
        var ruleFindings = (IReadOnlyList<RuleFinding>)Array.Empty<RuleFinding>();
        var coverage = (IReadOnlyList<RuleCoverage>)Array.Empty<RuleCoverage>();
        ReviewIdentity? identity = null;
        ReviewRun Review() => new(runId, translationStage, critiqueStage, rulesStage,
            modelFindings, ruleFindings, coverage, timer.ElapsedMilliseconds,
            EstimatedCostUsd: budget.EstimatedCostUsd(lease), Identity: identity);
        var source = request.SourceText.Trim();
        NebiusOutput output;
        try
        {
            var started = timer.ElapsedMilliseconds;
            using var cost = budget.TryStartCall(lease, 0);
            if (cost is null) return new("rate-limited", "Cost reservation is unavailable. Recorded examples remain available.");
            output = await provider.TranslateAsync(source, request.TargetLanguage, cancellationToken, cost);
            cost.Complete();
            identity = ReviewIdentity.Create(source, output.Text, request.TargetLanguage);
            translationStage = new("completed", output.Model, output.PromptTokens,
                output.CompletionTokens, timer.ElapsedMilliseconds - started);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or InvalidDataException or System.Text.Json.JsonException)
        {
            translationStage = new("failed", ElapsedMs: timer.ElapsedMilliseconds);
            return new("provider-error", "Translation did not complete. Check model access or credit; no draft was accepted.", Review: Review());
        }
        if (request.IncludeExperimentalCritique) try
        {
            var started = timer.ElapsedMilliseconds;
            using var cost = budget.TryStartCall(lease, 1);
            if (cost is null)
                critiqueStage = new("held", ElapsedMs: timer.ElapsedMilliseconds - started);
            else
            {
                var critique = await provider.CritiqueAsync(source, request.TargetLanguage, output.Text, cancellationToken, cost);
                cost.Complete();
                modelFindings = critique.Findings;
                critiqueStage = new("completed", critique.Model, critique.PromptTokens,
                    critique.CompletionTokens, timer.ElapsedMilliseconds - started);
            }
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
        var complete = rulesStage.State == "completed" &&
            (!request.IncludeExperimentalCritique || critiqueStage.State == "completed");
        return new(complete ? "ok" : "partial",
            complete ? "AI draft and scoped rule checks completed; experimental AI critique may be skipped. Human medical and linguistic review is still required."
                : critiqueStage.State == "held"
                    ? "AI draft — experimental critique is on hold until billing is confirmed. Scoped rule checks are available; human review remains required. Recorded examples remain available."
                    : "AI draft — review incomplete. Human review is required; do not treat this as an approved translation.",
            output.Text, output.Model, output.PromptTokens, output.CompletionTokens,
            ExcerptQc.Summarize(source, output.Text, request.TargetLanguage), Review());
    }
}
