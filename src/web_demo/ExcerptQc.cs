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

    public static RuleEvaluation Evaluate(string source, string translated, string language)
    {
        var findings = new List<RuleFinding>();
        var coverage = new List<RuleCoverage>();
        void Add(string category, bool assessed, string? warning, string? sourceSpan = null, string? draftSpan = null)
        {
            var state = !assessed ? "not assessed" : warning is null ? "checked" : "warning";
            coverage.Add(new(category, state));
            if (warning is not null) findings.Add(new(category, "review", warning, sourceSpan, draftSpan));
        }

        var sourceNumbers = Numbers(source);
        var draftNumbers = Numbers(translated);
        var numericMismatch = sourceNumbers.Keys.Union(draftNumbers.Keys)
            .Any(value => sourceNumbers.GetValueOrDefault(value) != draftNumbers.GetValueOrDefault(value));
        var changedDraftNumber = NumberPattern.Matches(translated).Select(match => match.Value)
            .FirstOrDefault(value => draftNumbers.GetValueOrDefault(NormalizeNumber(value)) >
                sourceNumbers.GetValueOrDefault(NormalizeNumber(value)));
        Add("number", sourceNumbers.Count > 0 || draftNumbers.Count > 0,
            numericMismatch ? "Numeric value or count differs from the source; review each value and sign." : null,
            draftSpan: numericMismatch ? changedDraftNumber : null);

        var sourceUnits = Regex.Matches(source, @"(?<!\p{L})(?:mg|mm|cm|mL|%)(?!\p{L})", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
            .Select(match => match.Value).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var unitSupported = language is "ko" or "es" && sourceUnits.Length > 0;
        Add("unit", unitSupported,
            unitSupported && sourceUnits.Any(unit => !Regex.IsMatch(translated, $@"(?<!\p{{L}}){Regex.Escape(unit)}(?!\p{{L}})", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
                ? "A source unit symbol is not identifiable in the draft; review units manually." : null);

        var proximal = Regex.IsMatch(source, @"\bproximal\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        var distal = Regex.IsMatch(source, @"\bdistal\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        var directionSupported = (language is "ko" or "ar") && (proximal || distal);
        var directionMismatch = directionSupported && (language == "ko"
            ? proximal && !translated.Contains("근위", StringComparison.Ordinal) || distal && !translated.Contains("원위", StringComparison.Ordinal)
            : proximal && !translated.Contains("قريب", StringComparison.Ordinal) || distal && !translated.Contains("بعيد", StringComparison.Ordinal));
        Add("direction", directionSupported,
            directionMismatch ? "Source anatomical direction is not identifiable in the draft; review proximal/distal fidelity." : null,
            draftSpan: directionMismatch && language == "ko" && proximal && translated.Contains("원위", StringComparison.Ordinal)
                ? "원위" : directionMismatch && language == "ko" && distal && translated.Contains("근위", StringComparison.Ordinal)
                    ? "근위" : null);

        var sourceNegated = Regex.IsMatch(source, @"\b(?:not|no)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        var negationSupported = language is "ko" or "es" or "ar" && sourceNegated;
        var arabicWithoutMarks = Regex.Replace(translated, @"[\u064B-\u065F]", "");
        var negationVisible = language switch
        {
            "ko" => Regex.IsMatch(translated, "않|없|아니", RegexOptions.CultureInvariant),
            "es" => Regex.IsMatch(translated, @"\b(?:no|nunca|sin)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant),
            "ar" => Regex.IsMatch(arabicWithoutMarks, @"(?<!\p{L})(?:لا|ليس|لم|لن)(?!\p{L})", RegexOptions.CultureInvariant),
            _ => false
        };
        Add("negation", negationSupported,
            negationSupported && !negationVisible
                ? "Source negation marker is not identifiable in this draft; review meaning and scope manually." : null);

        var femoralVein = language == "ko" &&
            Regex.IsMatch(source, @"\bfemoral\s+vein\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        Add("terminology", femoralVein,
            femoralVein && !Regex.IsMatch(translated, @"(?:대퇴|넙다리)\s*정맥", RegexOptions.CultureInvariant)
                ? "Femoral vein is not identifiable in the Korean draft; review terminology." : null);
        Add("omission", false, null);
        Add("other", false, null);
        return new(findings, coverage);
    }

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
