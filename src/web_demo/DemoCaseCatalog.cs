using System.Text.Json;
using System.Text.RegularExpressions;

namespace MedicalQcWebDemo;

public sealed class DemoCaseCatalog
{
    private static readonly HashSet<string> SupportedLanguages =
    ["ko", "es", "ar", "zh-CN", "zh-TW", "ja", "fr", "de", "it", "pt", "ru", "hi", "id", "nl", "pl", "th", "tr", "vi"];
    private static readonly Regex AssetName = new("^/assets/[A-Za-z0-9_-]+[.][A-Za-z0-9]+$", RegexOptions.Compiled);
    private readonly Dictionary<string, DemoCase> cases;
    private readonly HashSet<string> publishedAssets = new(StringComparer.Ordinal);
    private readonly string fixtureRoot;

    public DemoCaseCatalog(string fixtureRoot)
    {
        this.fixtureRoot = Path.GetFullPath(fixtureRoot);
        cases = new Dictionary<string, DemoCase>(StringComparer.Ordinal);
        foreach (var name in new[] { "case.json", "servier-visual.json" })
        {
            var path = Path.Combine(this.fixtureRoot, name);
            if (name != "case.json" && !File.Exists(path)) continue;
            var item = JsonSerializer.Deserialize<DemoCase>(File.ReadAllText(path), new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            }) ?? throw new InvalidDataException("Demo case is empty");
            Validate(item);
            if (!cases.TryAdd(item.Id, item)) throw new InvalidDataException("Duplicate demo case ID");
        }
        foreach (var item in cases.Values)
        {
            publishedAssets.Add(item.Source.Preview);
            foreach (var translation in item.Translations)
            {
                publishedAssets.Add(translation.Preview);
                publishedAssets.Add(translation.Download);
            }
        }
    }

    public IReadOnlyCollection<DemoCase> All => cases.Values;
    public DemoCase? Get(string id) => cases.GetValueOrDefault(id);
    public string? ResolvePublishedAsset(string url) => publishedAssets.Contains(url) ? ResolveAsset(url) : null;

    public string? ResolveAsset(string url)
    {
        if (!AssetName.IsMatch(url) || url.Contains("..", StringComparison.Ordinal)) return null;
        var name = url["/assets/".Length..];
        var path = Path.GetFullPath(Path.Combine(fixtureRoot, "assets", name));
        var allowedRoot = Path.GetFullPath(Path.Combine(fixtureRoot, "assets")) + Path.DirectorySeparatorChar;
        return path.StartsWith(allowedRoot, StringComparison.OrdinalIgnoreCase) && File.Exists(path) ? path : null;
    }

    private void Validate(DemoCase item)
    {
        Require(item.Id is "mueller-figure1" or "servier-visual", "Unknown demo case ID");
        Require(!string.IsNullOrWhiteSpace(item.Title) && item.Mode == "recorded", "Case title or mode invalid");
        Require(DateTimeOffset.TryParse(item.GeneratedUtc, out _), "Generation date missing");
        Require(!string.IsNullOrWhiteSpace(item.Generator) && !string.IsNullOrWhiteSpace(item.Scope), "Provenance missing");
        Require(!string.IsNullOrWhiteSpace(item.Source.Citation), "Source citation missing");
        Require(Uri.TryCreate(item.Source.Url, UriKind.Absolute, out var sourceUrl) && sourceUrl.Scheme == Uri.UriSchemeHttps, "Source URL missing");
        Require(item.Source.License == "CC BY 4.0", "Source license missing or unsupported");
        Require(!string.IsNullOrWhiteSpace(item.Source.Modifications), "Modification note missing");
        Require(ResolveAsset(item.Source.Preview) is not null, "Source preview missing or unsafe");
        Require(item.Source.Sections.Count > 0 && item.Translations.Count > 0, "Case content missing");
        var sourceIds = CheckSections(item.Source.Sections);
        var languages = new HashSet<string>(StringComparer.Ordinal);
        foreach (var translation in item.Translations)
        {
            Require(SupportedLanguages.Contains(translation.Language) && languages.Add(translation.Language), "Unsupported or duplicate language");
            Require(translation.Status == "AI_DRAFT_UNREVIEWED", "Translation status not authentic");
            Require(ResolveAsset(translation.Preview) is not null, "Target preview missing or unsafe");
            Require(ResolveAsset(translation.Download) is not null, "Target artifact missing or unsafe");
            var targetIds = CheckSections(translation.Sections);
            Require(translation.Findings.Count > 0, "QC evidence missing");
            foreach (var finding in translation.Findings)
            {
                Require(!string.IsNullOrWhiteSpace(finding.Id) && !string.IsNullOrWhiteSpace(finding.Title) && !string.IsNullOrWhiteSpace(finding.Basis), "QC finding incomplete");
                Require(finding.Status is "passed" or "needs-review" or "blocked", "QC status invalid");
                Require(sourceIds.Contains(finding.SourceSection) && targetIds.Contains(finding.TargetSection), "QC finding points to missing section");
            }
        }
    }

    private static HashSet<string> CheckSections(List<DemoSection> sections)
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var section in sections)
            Require(!string.IsNullOrWhiteSpace(section.Id) && ids.Add(section.Id) && !string.IsNullOrWhiteSpace(section.Text), "Section missing or duplicated");
        return ids;
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidDataException(message);
    }
}
