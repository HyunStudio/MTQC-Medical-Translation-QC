using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MedicalQcWebDemo;

if (args.Length is not (5 or 6) || args[0] != "--live" ||
    args[1] is not ("capture-drafts" or "capture-reviews"))
{
    Console.Error.WriteLine("Usage: --live capture-drafts cases.json output.json ledger.txt | --live capture-reviews cases.json variants.json output.json ledger.txt");
    return 2;
}
var key = Environment.GetEnvironmentVariable("NEBIUS_API_KEY");
if (string.IsNullOrWhiteSpace(key))
{
    Console.Error.WriteLine("NEBIUS_API_KEY is unavailable; no provider call was made.");
    return 2;
}
var draftsMode = args[1] == "capture-drafts";
if ((draftsMode && args.Length != 5) || (!draftsMode && args.Length != 6)) return 2;
var casesPath = Path.GetFullPath(args[2]);
var variantsPath = draftsMode ? null : Path.GetFullPath(args[3]);
var outputPath = Path.GetFullPath(args[draftsMode ? 3 : 4]);
var ledgerPath = Path.GetFullPath(args[draftsMode ? 4 : 5]);
if (File.Exists(outputPath))
{
    Console.Error.WriteLine("Output already exists; refusing to overwrite evaluation evidence.");
    return 2;
}
if (outputPath == ledgerPath) return 2;
var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true };
var manifest = JsonSerializer.Deserialize<CaseManifest>(await File.ReadAllTextAsync(casesPath), jsonOptions)
    ?? throw new InvalidDataException("Case manifest missing");
if (manifest.Cases.Length is < 1 or > 3) throw new InvalidDataException("Only 1–3 controlled cases are allowed per capture");
foreach (var specimen in manifest.Cases)
{
    if (string.IsNullOrWhiteSpace(specimen.Id) || string.IsNullOrWhiteSpace(specimen.Source) ||
        !UserExcerptService.TargetLanguages.Contains(specimen.TargetLanguage, StringComparer.Ordinal) ||
        specimen.Source.EnumerateRunes().Count() > 3000 || Sha(specimen.Source) != specimen.SourceSha256)
        throw new InvalidDataException("Case manifest invalid or hash changed");
}
var cases = manifest.Cases.ToDictionary(item => item.Id, StringComparer.Ordinal);
VariantManifest? variantManifest = null;
if (!draftsMode)
{
    variantManifest = JsonSerializer.Deserialize<VariantManifest>(await File.ReadAllTextAsync(variantsPath!), jsonOptions)
        ?? throw new InvalidDataException("Variant manifest missing");
    if (variantManifest.Variants.Length is < 1 or > 6) throw new InvalidDataException("Only 1–6 review variants are allowed per capture");
    if (variantManifest.Variants.Select(item => item.RunId).Distinct(StringComparer.Ordinal).Count() != variantManifest.Variants.Length)
        throw new InvalidDataException("Duplicate run ID");
    foreach (var variant in variantManifest.Variants)
        if (!System.Text.RegularExpressions.Regex.IsMatch(variant.RunId, "^[a-z0-9-]{1,80}$") ||
            !cases.ContainsKey(variant.CaseId) || string.IsNullOrWhiteSpace(variant.Draft) ||
            variant.Draft.Length > 10000 || Sha(variant.Draft) != variant.DraftSha256)
            throw new InvalidDataException("Variant invalid or hash changed");
}

// The ledger is shared across both commands. Twenty is a hard upper bound, not a
// target: the planned nine captures and diagnosed failures remain on the ledger.
var options = new LiveOptions(true, key, PerClientLimit: 20, GlobalHourlyLimit: 20,
    LifetimeAttemptLimit: 20, LifetimeLedgerPath: ledgerPath);
var budget = new LiveBudget(options);
using var http = new HttpClient();
var model = Environment.GetEnvironmentVariable("DEMO_NEBIUS_MODEL") ?? "nvidia/Nemotron-3_5-Lightning";
var provider = new NebiusClient(http, key, model,
    new Uri("https://api.tokenfactory.nebius.com/v1/chat/completions"), TimeSpan.FromSeconds(25));
var startedUtc = DateTimeOffset.UtcNow;
Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
if (draftsMode)
{
    var rows = new List<object>();
    foreach (var specimen in manifest.Cases)
    {
        using var lease = await budget.TryAcquireAsync("evaluation-local", 1, CancellationToken.None)
            ?? throw new InvalidOperationException("Evaluation attempt ledger exhausted; no further call made");
        var timer = Stopwatch.StartNew();
        var output = await provider.TranslateAsync(specimen.Source, specimen.TargetLanguage, CancellationToken.None);
        rows.Add(new { caseId = specimen.Id, specimen.TargetLanguage, draft = output.Text,
            draftSha256 = Sha(output.Text), model = output.Model, output.PromptTokens,
            output.CompletionTokens, latencyMs = timer.ElapsedMilliseconds });
        Console.WriteLine($"Captured direct draft for {specimen.Id} ({timer.ElapsedMilliseconds} ms)");
    }
    await File.WriteAllTextAsync(outputPath, JsonSerializer.Serialize(new {
        captureKind = "genuine direct Nemotron drafts", startedUtc, manifest.Version,
        promptVersion = "mtqc-translation-prompt-2026-10-01", drafts = rows
    }, jsonOptions));
}
else
{
    var rows = new List<JsonElement>();
    foreach (var variant in variantManifest!.Variants)
    {
        var checkpointPath = outputPath + "." + variant.RunId + ".json";
        if (File.Exists(checkpointPath))
        {
            var saved = JsonSerializer.Deserialize<JsonElement>(await File.ReadAllTextAsync(checkpointPath));
            if (saved.GetProperty("runId").GetString() != variant.RunId ||
                saved.GetProperty("draftSha256").GetString() != variant.DraftSha256)
                throw new InvalidDataException("Review checkpoint mismatch");
            rows.Add(saved);
            Console.WriteLine($"Reused review checkpoint for {variant.RunId}");
            continue;
        }
        var specimen = cases[variant.CaseId];
        using var lease = await budget.TryAcquireAsync("evaluation-local", 1, CancellationToken.None)
            ?? throw new InvalidOperationException("Evaluation attempt ledger exhausted; no further call made");
        var timer = Stopwatch.StartNew();
        var critique = await provider.CritiqueAsync(specimen.Source, specimen.TargetLanguage, variant.Draft, CancellationToken.None);
        var rules = ExcerptQc.Evaluate(specimen.Source, variant.Draft, specimen.TargetLanguage);
        var ruleFindings = rules.Findings.Select(item => new {
            category = item.Category, draftSpan = item.DraftSpan, provenance = "rule"
        }).ToArray();
        var modelFindings = critique.Findings.Select(item => new {
            category = item.Category, draftSpan = item.DraftSpan, provenance = "model"
        }).ToArray();
        var row = new { variant.RunId, variant.CaseId, specimen.TargetLanguage, variant.Draft,
            variant.DraftSha256,
            baseline = new { variant.DraftSha256, findings = ruleFindings },
            enhanced = new { variant.DraftSha256, findings = ruleFindings.Cast<object>().Concat(modelFindings).ToArray() },
            latencyMs = timer.ElapsedMilliseconds, promptTokens = critique.PromptTokens,
            completionTokens = critique.CompletionTokens, estimatedCostUsd = (decimal?)null,
            critiqueModel = critique.Model, ruleCoverage = rules.Coverage };
        var rowJson = JsonSerializer.Serialize(row, jsonOptions);
        await using (var checkpoint = new FileStream(checkpointPath, FileMode.CreateNew, FileAccess.Write))
        await using (var writer = new StreamWriter(checkpoint))
            await writer.WriteAsync(rowJson);
        rows.Add(JsonSerializer.Deserialize<JsonElement>(rowJson));
        Console.WriteLine($"Captured critique for {variant.RunId} ({timer.ElapsedMilliseconds} ms)");
    }
    await File.WriteAllTextAsync(outputPath, JsonSerializer.Serialize(new {
        captureKind = "genuine Nemotron critique on frozen direct drafts and controlled variants",
        startedUtc, runSet = variantManifest.RunSet,
        promptVersion = variantManifest.PromptVersion ?? "mtqc-critique-prompt-2026-10-01-v1", comparison = "same draft and same deterministic gate in both arms; enhanced adds separate critique",
        runs = rows
    }, jsonOptions));
}
Console.WriteLine($"Wrote generated evidence: {outputPath}");
return 0;

static string Sha(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();

sealed record CaseManifest(string Version, CaseSpec[] Cases);
sealed record CaseSpec(string Id, string Author, string License, string TargetLanguage, string Source, string SourceSha256);
sealed record VariantManifest(string RunSet, Variant[] Variants, string? PromptVersion = null);
sealed record Variant(string RunId, string CaseId, string Draft, string DraftSha256);
