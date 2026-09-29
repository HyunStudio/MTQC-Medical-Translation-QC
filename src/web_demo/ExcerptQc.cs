using System.Text.RegularExpressions;

namespace MedicalQcWebDemo;

public static class ExcerptQc
{
    private static readonly Regex NumberPattern = new(@"\d+(?:[.,]\d+)*", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static string Summarize(string source, string translated, string language)
    {
        var missing = NumberPattern.Matches(source).Select(match => match.Value)
            .Where(value => !translated.Contains(value, StringComparison.Ordinal)).Distinct(StringComparer.Ordinal).ToArray();
        var warnings = new List<string>();
        if (missing.Length > 0) warnings.Add($"Source number format not found exactly in draft: {string.Join(", ", missing)}. Review numeric fidelity.");
        if (language == "ko" && source.Contains("proximal", StringComparison.OrdinalIgnoreCase) &&
            translated.Contains("원위", StringComparison.Ordinal) && !translated.Contains("근위", StringComparison.Ordinal))
            warnings.Add("Possible proximal-to-distal directional mismatch; human review required.");
        if (language == "ko" &&
            Regex.IsMatch(source, @"\bfemoral\s+vein\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant) &&
            !Regex.IsMatch(translated, @"(?:대퇴|넙다리)\s*정맥", RegexOptions.CultureInvariant))
            warnings.Add("Source femoral vein is not identifiable in the Korean draft; review anatomical terminology.");
        // These exact spellings are standard anatomical terms in Spanish/Portuguese,
        // and can be legitimate French masculine forms; do not call them untranslated English.
        if (language is not ("es" or "pt" or "fr") &&
            Regex.IsMatch(translated, @"\b(?:proximal|distal)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
            warnings.Add("Untranslated English directional term remains; human review required.");
        warnings.Add("Automated checks are limited; independent medical and linguistic review is still required.");
        return string.Join(" ", warnings);
    }
}
