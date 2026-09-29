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
        using var lease = await budget.TryAcquireAsync(clientId, cancellationToken);
        if (lease is null) return new("rate-limited", "Live demo request limit reached. Try a recorded case or return later.");
        try
        {
            var source = request.SourceText.Trim();
            var output = await provider.TranslateAsync(source, request.TargetLanguage, cancellationToken);
            return new("ok", "AI draft excerpt only—not a full-document or clinically validated translation.",
                output.Text, output.Model, output.PromptTokens, output.CompletionTokens,
                ExcerptQc.Summarize(source, output.Text, request.TargetLanguage));
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or InvalidDataException or System.Text.Json.JsonException)
        {
            return new("provider-error", "The provider could not complete this excerpt. Try a recorded case or check model access and credit.");
        }
    }
}
