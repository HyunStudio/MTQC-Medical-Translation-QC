using System.Text.RegularExpressions;
using System.Globalization;

namespace MedicalQcWebDemo;

public static class ExcerptQc
{
    private static readonly Regex NumberPattern = new(@"(?:(?<![\p{L}\p{N}.,])[+\-\u2212\u00B1])?\d+(?:[.,\u066B\u066C]\d+)*", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static string NormalizeNumber(string token)
    {
        var digits = string.Concat(token.Select(character => char.IsDigit(character)
            ? ((int)char.GetNumericValue(character)).ToString(CultureInfo.InvariantCulture)
            : character == '\u2212' ? "-" : character.ToString()));
        // A single decimal separator with 1-2 digits is unambiguous here. Three
        // trailing digits or mixed separators remain exact-format review cases.
        return Regex.IsMatch(digits, @"^[+\-\u00B1]?\d+[,\u066B]\d{1,2}$")
            ? digits.Replace(',', '.').Replace('\u066B', '.') : digits;
    }

    private static Dictionary<string, int> Numbers(string text) => NumberPattern.Matches(text)
        .Select(match => NormalizeNumber(match.Value)).GroupBy(value => value)
        .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);

    public static string Summarize(string source, string translated, string language)
    {
        var targetTokens = NumberPattern.Matches(translated).Select(match => match.Value).ToHashSet(StringComparer.Ordinal);
        var missing = NumberPattern.Matches(source).Select(match => match.Value)
            .Where(value => !targetTokens.Contains(value)).Distinct(StringComparer.Ordinal).ToArray();
        var warnings = new List<string>();
        if (missing.Length > 0) warnings.Add($"Source number format not found exactly in draft: {string.Join(", ", missing)}. Review numeric fidelity.");
        var sourceNumbers = Numbers(source);
        var targetNumbers = Numbers(translated);
        var changed = sourceNumbers.Keys.Union(targetNumbers.Keys).Where(value =>
            sourceNumbers.GetValueOrDefault(value) != targetNumbers.GetValueOrDefault(value)).ToArray();
        if (changed.Length > 0)
            warnings.Add($"Numeric value/count mismatch: {string.Join("; ", changed.Select(value => $"{value} (source {sourceNumbers.GetValueOrDefault(value)}, draft {targetNumbers.GetValueOrDefault(value)})"))}. Check omissions, additions and substitutions.");
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
