using System.Text.RegularExpressions;
using System.Globalization;

namespace MedicalQcWebDemo;

public static class ExcerptQc
{
    public const string RuleVersion = "excerpt-qc-20261018d";
    // Bounded literal inventory only: uppercase ASCII codes containing digits,
    // not a medical dictionary or a semantic terminology/omission assessment.
    // Permit Korean particles and Arabic conjunctions around intact Latin codes.
    // Long/underscored/camel-case shapes must not be partially matched.
    private static readonly Regex IdentifierPattern = new(
        @"(?<![A-Za-z0-9_\-‐‑])[A-Z]{2,8}(?:[\-‐‑][A-Z]{1,4})?[\-‐‑]?[0-9]{1,4}[A-Z]{0,3}(?![A-Za-z0-9_\-‐‑])",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);
    // Reject unsupported joined/Unicode continuations rather than checking a
    // shorter prefix. Sentence punctuation remains valid (BRCA1. / BRCA1: ...).
    private static bool CompleteIdentifier(string text, Match match)
    {
        static bool Continuation(char value) => value is '_' or '*' || char.IsSymbol(value) || char.IsNumber(value) || char.IsSurrogate(value) ||
            char.GetUnicodeCategory(value) is UnicodeCategory.DashPunctuation or UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark or UnicodeCategory.EnclosingMark ||
            (char.IsLetter(value) && !(value is >= '\uAC00' and <= '\uD7A3' or >= '\u0600' and <= '\u06FF'));
        var start = match.Index;
        var end = start + match.Length;
        if (start > 0 && (Continuation(text[start - 1]) || text[start - 1] is '.' or '/' or ':')) return false;
        if (end == text.Length) return true;
        if (Continuation(text[end]) || text[end] == '/') return false;
        return !(text[end] is '.' or ':' && end + 1 < text.Length &&
            (char.IsLetterOrDigit(text[end + 1]) || char.IsNumber(text[end + 1])));
    }
    private static Match[] IdentifierMatches(string text) => IdentifierPattern.Matches(text)
        .Where(match => CompleteIdentifier(text, match)).ToArray();
    private static string IdentifierKey(Match match) => match.Value.Replace('‐', '-').Replace('‑', '-');
    private static (bool Assessed, bool Mismatch, string? SourceSpan, string? DraftSpan) IdentifierInventory(string source, string draft)
    {
        var sourceMatches = IdentifierMatches(source);
        var draftMatches = IdentifierMatches(draft);
        var sourceCounts = Counts(sourceMatches.Select(IdentifierKey));
        var draftCounts = Counts(draftMatches.Select(IdentifierKey));
        var mismatch = CountsDiffer(sourceCounts, draftCounts);
        return (sourceMatches.Length + draftMatches.Length > 0, mismatch,
            mismatch ? ExcessSpan(sourceMatches, IdentifierKey, sourceCounts, draftCounts) : null,
            mismatch ? ExcessSpan(draftMatches, IdentifierKey, draftCounts, sourceCounts) : null);
    }
    private const string IdentifierWarning = "Literal identifier spelling or occurrence count differs from the source; compare the complete code manually. Localized aliases and clinical meaning are not assessed.";
    // Keep a leading decimal separator inside the numeric token, so .5 cannot
    // be compared as 5 and an adjacent sign is not silently dropped.
    private const string DecimalNumber = @"(?:(?<![\p{L}\p{N}.,])[+\-\u2212\u00B1])?(?:(?<![\p{L}\p{N}.,\u066B\u066C])[.\u066B]\d+|\d+(?:[.,\u066B\u066C]\d+)*)";
    private const string ScientificStart = @"(?<![\p{L}\p{N}_.,\u066B\u066C])[+\-\u2212\u00B1]?";
    private const string ScientificEnd = @"(?![.,\u066B\u066C]\d)(?:(?![\p{L}\p{N}_])|(?=" + UnitSymbols + @"(?![A-Za-z])))";
    private const string ScientificBody = @"(?:\d+(?:[.\u066B]\d+)?|[.\u066B]\d+)[eE][+\-\u2212]?\d+";
    private const string ScientificNumber = ScientificStart + ScientificBody + ScientificEnd;
    private static readonly Regex ScientificPattern = new(ScientificNumber, RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex ScopeScientificPattern = new(ScientificStart + ScientificBody +
        @"(?![.,\u066B\u066C]\d)(?:(?![\p{L}\p{N}_])|(?=" + ScopeUnitSymbols + @"(?![A-Za-z])))",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);
    // Retain invalid decimal exponent tails and numeric-start suffixes rather
    // than letting their digit fragments fall back to a checked comparison.
    private static readonly Regex ScientificCandidate = new(ScientificStart + @"(?:\d+(?:[.,\u066B\u066C]\d+)*|[.,\u066B\u066C]\d+)[eE][+\-\u2212]?\d*(?:[.,\u066B\u066C]\d+)*(?!\d)", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex ScientificValue = new(@"^(?<sign>[+\-\u00B1]?)(?<mantissa>\d+(?:\.\d+)?|\.\d+)[eE](?<exponent>[+\-]?\d+)$", RegexOptions.CultureInvariant);
    private static readonly Regex NumberPattern = new($@"(?:{ScientificNumber}|{DecimalNumber})", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    // Literal symbols only; allow Korean grammatical suffixes but not ASCII
    // word continuations. Only literal micro signs and L/l volume aliases are
    // normalized; Latin u, arbitrary casing and unit conversions are excluded.
    private const string UnitSymbols = @"(?:[μµ]g|[μµ][Ll]|mg|mm|cm|m[Ll]|%)";
    private static readonly Regex UnitPattern = new($@"(?<!\p{{L}}){UnitSymbols}(?![A-Za-z])", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    // Do not rescan each suffix of a long numeric run when no unit follows.
    // English adjectival 150-mg and literal 150 mg carry the same local pair.
    // Only a directly attached ASCII hyphen before a letter unit is an alias;
    // spaced dashes, Unicode dashes, percent suffixes and conversions are not.
    // ScopeUnitPairPattern below deliberately keeps its original anchor surface.
    private static readonly Regex UnitPairPattern = new($@"(?<![\p{{N}}.,\u066B\u066C])(?<number>{NumberPattern})(?:\s*|-(?=[A-Za-zμµ]))(?<unit>{UnitSymbols})(?![A-Za-z])", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    // Broader unit inventory must not expand the separately gated Korean
    // negation-scope/modifier region. Keep its original anchor surface pinned.
    private const string ScopeUnitSymbols = @"(?:mg|mm|cm|m[Ll]|%)";
    private static readonly Regex ScopeUnitPairPattern = new($@"(?<![\p{{N}}.,\u066B\u066C])(?<number>{NumberPattern})\s*(?<unit>{ScopeUnitSymbols})(?![A-Za-z])", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static string UnitKey(string symbol) => symbol.Replace('µ', 'μ') switch
    {
        "ml" => "mL", "μl" => "μL", var literal => literal
    };
    private static string PairKey(Match match) => NormalizeNumber(match.Groups["number"].Value) + " " + UnitKey(match.Groups["unit"].Value);
    private static Dictionary<string, int> Counts(IEnumerable<string> values) => values.GroupBy(value => value)
        .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);
    private static bool CountsDiffer(Dictionary<string, int> source, Dictionary<string, int> draft) =>
        source.Keys.Union(draft.Keys).Any(value => source.GetValueOrDefault(value) != draft.GetValueOrDefault(value));
    private static string? ExcessSpan(IEnumerable<Match> matches, Func<Match, string> key,
        Dictionary<string, int> own, Dictionary<string, int> other) => matches
        .FirstOrDefault(match => own.GetValueOrDefault(key(match)) > other.GetValueOrDefault(key(match)) && match.Length <= 160)?.Value;

    private static string NormalizeDigits(string token) => string.Concat(token.Select(character => char.IsDigit(character)
        ? ((int)char.GetNumericValue(character)).ToString(CultureInfo.InvariantCulture)
        : character == '\u2212' ? "-" : character.ToString()));

    // Compare compact scientific forms without floating-point rounding or
    // allocating expanded powers of ten. Excessive/malformed exponents and
    // cross-notation conversion stay unassessed, including dependent anchors.
    private static bool TryScientificKey(string token, out string key)
    {
        key = "";
        var match = ScientificValue.Match(NormalizeDigits(token).Replace('\u066B', '.'));
        if (!match.Success || !int.TryParse(match.Groups["exponent"].Value, NumberStyles.AllowLeadingSign,
            CultureInfo.InvariantCulture, out var exponent) || exponent is < -100 or > 100) return false;
        var mantissa = match.Groups["mantissa"].Value;
        var dot = mantissa.IndexOf('.');
        var coefficient = mantissa.Replace(".", "").TrimStart('0');
        long power = exponent - (dot < 0 ? 0L : mantissa.Length - dot - 1L);
        if (coefficient.Length == 0) { coefficient = "0"; power = 0; }
        else
        {
            var trimmed = coefficient.TrimEnd('0');
            power += coefficient.Length - trimmed.Length;
            coefficient = trimmed;
        }
        key = match.Groups["sign"].Value + coefficient + "e" + power.ToString(CultureInfo.InvariantCulture);
        return true;
    }

    private static bool ScientificComparisonSupported(string source, string draft, bool preserveScope = false)
    {
        var sourceCandidates = ScientificCandidate.Matches(source);
        var draftCandidates = ScientificCandidate.Matches(draft);
        var scientific = preserveScope ? ScopeScientificPattern : ScientificPattern;
        var sourceScientific = scientific.Matches(source);
        var draftScientific = scientific.Matches(draft);
        if (sourceCandidates.Count != sourceScientific.Count || draftCandidates.Count != draftScientific.Count ||
            sourceCandidates.Any(match => !TryScientificKey(match.Value, out _)) ||
            draftCandidates.Any(match => !TryScientificKey(match.Value, out _)) ||
            sourceScientific.Count != draftScientific.Count) return false;
        if (sourceScientific.Count == 0) return true;
        // Equal scientific counts can hide mixed scientific/plain conversions.
        // Require the ordinary-number multiset to stay stable; this also leaves
        // ordinary changes alongside scientific tokens unassessed, deliberately.
        Dictionary<string, int> Ordinary(string text) => Counts(NumberPattern.Matches(text)
            .Where(match => !TryScientificKey(match.Value, out _)).Select(match => NormalizeNumber(match.Value)));
        return !CountsDiffer(Ordinary(source), Ordinary(draft));
    }

    private static string NormalizeNumber(string token)
    {
        if (TryScientificKey(token, out var scientific)) return scientific;
        var digits = NormalizeDigits(token);
        digits = Regex.Replace(digits, @"^([+\-\u00B1]?)[.\u066B](?=\d)", "${1}0.", RegexOptions.CultureInvariant);
        // A single decimal separator with 1-2 digits is unambiguous here. Three
        // trailing digits or mixed separators remain exact-format review cases.
        return Regex.IsMatch(digits, @"^[+\-\u00B1]?\d+[,\u066B]\d{1,2}$")
            ? digits.Replace(',', '.').Replace('\u066B', '.') : digits;
    }

    private static Dictionary<string, int> Numbers(string text) => NumberPattern.Matches(text)
        .Select(match => NormalizeNumber(match.Value)).GroupBy(value => value)
        .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);

    // Exact frequency spelling alias, only for the numeric inventory. Require
    // equal nonzero occurrence counts and a whitespace/start left boundary;
    // never erase unit pairs, clinical context, prefixed signs/punctuation,
    // unmatched repetitions, ordinal forms, or other frequency expressions.
    private static readonly Regex OnceDaily = new(@"\bonce\s+daily\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex KoreanOnceDaily = new(@"(?<!\S)1\s*일\s*1\s*회(?![\p{L}\p{N}_]|[.,\u066B\u066C]\d)", RegexOptions.CultureInvariant);
    private static string ComparableNumberDraft(string source, string draft, string language)
    {
        if (language != "ko") return draft;
        var count = OnceDaily.Matches(source).Count;
        return count > 0 && count == KoreanOnceDaily.Matches(draft).Count
            ? KoreanOnceDaily.Replace(draft, match => new string(' ', match.Length)) : draft;
    }

    // Adversative discourse phrases do not negate a predicate. Exclude only
    // these complete literal phrases; genuine no/nunca/sin elsewhere survives.
    private static readonly Regex SpanishNegation = new(@"\b(?:no\b(?!\s+obstante\b)|nunca\b|sin\b(?!\s+embargo\b))",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    // Arabic waw may be attached directly to these already supported markers.
    // Keep complete word boundaries so ولما / unrelated prefixed words do not
    // count as لم / لا. This remains presence-only, not tense/scope analysis.
    private static readonly Regex ArabicNegation = new(@"(?<!\p{L})(?:و)?(?:لا|ليس|لم|لن)(?!\p{L})", RegexOptions.CultureInvariant);

    // These literal comparison/additive phrases do not establish a negative
    // predicate. Exclude only their marker, keeping genuine no/not elsewhere.
    // Their quantitative meaning is still outside this lexical check.
    private static readonly Regex SourceNegation = new(@"\b(?:not\b(?!\s+only\b)|no\b(?!\s+(?:more|less)\s+than\b))", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex KoreanNegation = new(@"않|없|아니|아닙|아님|아닌|아닐|(?<!\p{L})(?:안|못)(?=\s)", RegexOptions.CultureInvariant);
    // These recognized uncertainty/quantifier forms cannot establish simple
    // predicate polarity. Withholding is a coverage limit, not a translation
    // judgment; unrelated affirmative sentences do not trigger this guard.
    private static readonly Regex SourceNegationUncertainty = new(@"\b(?:may|might|could|possibly|possible|definite|suspected|uncertain)\b|\bnot\s+(?:all|every|(?:be\s+)?excluded|(?:be\s+)?ruled\s+out)\b|\bno\s+evidence\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex KoreanScopeUncertainty = new(@"가능|추정|의심|불확실|수(?:도)?\s*있|지도\s*모(?:르|릅)", RegexOptions.CultureInvariant);
    // Quote boundaries and these reporting forms do not establish direct
    // predicate polarity. An apostrophe inside letters (patient's) is allowed.
    // This is a conservative lexical guard, not quotation/attribution parsing.
    private static readonly Regex QuotationBoundary = new(@"[""“”‘]|(?<!\p{L})['’]|['’](?!\p{L})", RegexOptions.CultureInvariant);
    private static readonly Regex SourceAttribution = new(@"\b(?:said|says|reported|reports|stated|states|denied|denies|claimed|claims)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex KoreanAttribution = new(@"(?:다고|다는|라고|라는)(?=$|[\s\p{P}])|(?:말|진술)(?:했|하|합)|기재", RegexOptions.CultureInvariant);
    // This literal pair is a coverage constraint for the frozen clot cases,
    // not an entity dictionary or semantic attachment certification. Vessel
    // context and missing/repeated/compound target terms stay unassessed.
    private static readonly Regex SourceClotTerm = new(@"\bclots?\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex SourceVesselTerm = new(@"\b(?:veins?|artery|arteries)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex KoreanClotStem = new(@"혈전", RegexOptions.CultureInvariant);
    private static readonly Regex KoreanClotTerm = new(@"(?<!\p{L})혈전(?:들)?(?=$|[\s\p{P}]|(?:은|는|이|가|과|의|도|만|을|에)(?=$|[\s\p{P}]))", RegexOptions.CultureInvariant);
    private static readonly Regex KoreanVesselTerm = new(@"정맥|동맥", RegexOptions.CultureInvariant);
    // These are smaller lexical coverage regions, not predicate translation
    // or entity matching. Preserve omission warnings when no negative survives.
    private static readonly Regex SourceRecorded = new(@"\brecorded\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex KoreanRecordStem = new(@"기록", RegexOptions.CultureInvariant);
    // Only this literal recorded-dose region is constrained. Unit anchors do
    // not establish noun identity; alternate nouns may also be held. One term
    // still does not certify semantic attachment or translation correctness.
    private static readonly Regex SourceDoseTerm = new(@"\bdoses?\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex KoreanDoseStem = new(@"용량", RegexOptions.CultureInvariant);
    private static readonly Regex KoreanDoseTerm = new(@"(?<!\p{L})용량(?:들)?(?=$|[\s\p{P}]|(?:은|는|이|가|의|을|에|도|만)(?=$|[\s\p{P}]))", RegexOptions.CultureInvariant);
    // A smaller supported surface interval, not a general noun-relation parser.
    // Extra words, punctuation or record-before-dose order are outside coverage.
    private static readonly Regex KoreanDoseRecordInterval = new(@"\A\s*(?:은|는|이|가|의|을|에|도|만)?\s*\z", RegexOptions.CultureInvariant);
    // The matched unit pair must lead directly to the dose noun. Words or
    // punctuation here remain outside this small surface region; nouns before
    // the unit pair still do not establish semantic correspondence.
    private static readonly Regex KoreanUnitDoseInterval = new(@"\A\s+\z", RegexOptions.CultureInvariant);
    // Only these terminal negative surfaces are covered after recorded-dose.
    // Extra nouns and alternate phrasing stay unassessed; this is not grammar
    // parsing or semantic identity evidence. Negative-free warnings stay separate.
    private static readonly Regex KoreanDoseRecordTail = new(@"\A\s*(?:(?:되|하)지\s*않(?:았)?(?:습니다|음|았다)|(?:은|는|이|가|도|만)?\s*(?:전혀\s+)?없(?:습니다|음|다))\s*[.!?。！？]?\s*\z", RegexOptions.CultureInvariant);
    // A small source surface region, not an English subject parser. Unknown
    // descriptors, extra nouns and other tenses/endings are outside coverage.
    private static readonly Regex SourceDosePrefix = new(@"\A\s*(?:(?:a|an|the)\s+|(?<no>no)\s+)(?:(?:patient['’]s|intravenous|prescribed|initial)\s+)*\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex SourceUnitDoseInterval = new(@"\A\s+\z", RegexOptions.CultureInvariant);
    private static readonly Regex SourceDoseNotRecordedTail = new(@"\A\s+(?:was|were)\s+not\s+recorded\s*[.!?。！？]?\s*\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex SourceDoseNoRecordedTail = new(@"\A\s+(?:was|were)\s+recorded\s*[.!?。！？]?\s*\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex KoreanRecordTerm = new(@"(?<!\p{L})기록(?=$|[\s\p{P}]|(?:은|는|이|가|의|을|에|도|만)(?=$|[\s\p{P}])|(?:되|하)지\s*않(?:았)?(?:습니다|음|았다)(?=$|[\s\p{P}]))", RegexOptions.CultureInvariant);
    private static readonly Regex KoreanStatementBoundary = new(@"[;；]|(?:보입니다|보인다|보임|기록되었습니다|기록됐습니다|투여되었습니다|투여됐습니다|있습니다|있다|있음)\s*[,，:：(（]", RegexOptions.CultureInvariant);
    private static bool UnsupportedSourceNegation(string text) => Regex.Split(text, @"(?<=[.!?。！？])\s+")
        .Any(sentence => SourceNegation.IsMatch(sentence) &&
            (SourceNegationUncertainty.IsMatch(sentence) || QuotationBoundary.IsMatch(sentence) || SourceAttribution.IsMatch(sentence)));

    private static bool SourceRecordedDoseSurfaceSupported(string sentence)
    {
        var pairs = ScopeUnitPairPattern.Matches(sentence);
        var doses = SourceDoseTerm.Matches(sentence);
        if (pairs.Count != 1 || doses.Count != 1) return false;
        var pair = pairs[0];
        var dose = doses[0];
        var pairEnd = pair.Index + pair.Length;
        if (dose.Index < pairEnd || !SourceUnitDoseInterval.IsMatch(sentence[pairEnd..dose.Index])) return false;
        var prefix = SourceDosePrefix.Match(sentence[..pair.Index]);
        if (!prefix.Success) return false;
        var tail = sentence[(dose.Index + dose.Length)..];
        return (prefix.Groups["no"].Success ? SourceDoseNoRecordedTail : SourceDoseNotRecordedTail).IsMatch(tail);
    }

    // A separate, bounded lexical check: unique anchors locate sentences, never
    // sentence ordinal positions or global negative-marker counts. Shared
    // negative predicates in merged sentences are allowed. Ambiguous mappings
    // and unanchored negative continuations are left unassessed.
    private static (bool Assessed, string? SourceSpan, string? DraftSpan) KoreanNegationScope(string source, string draft)
    {
        if (!ScientificComparisonSupported(source, draft, preserveScope: true) || UnsupportedSourceNegation(source)) return (false, null, null);
        string[] Sentences(string text) => Regex.Split(text, @"(?<=[.!?。！？])\s+")
            .Select(sentence => sentence.Trim()).Where(sentence => sentence.Length > 0).ToArray();
        // Preserve one complete ASCII wrapper used to format provider drafts.
        // Never erase inline or unmatched quote boundaries per sentence.
        var draftText = draft.Trim();
        if (draftText.Length >= 2 && draftText[0] == '"' && draftText[^1] == '"') draftText = draftText[1..^1];
        IEnumerable<string> Anchors(string sentence, bool english)
        {
            foreach (Match match in ScopeUnitPairPattern.Matches(sentence)) yield return "unit:" + PairKey(match);
            foreach (var (key, pattern) in new[] { ("proximal", english ? @"\bproximal\b" : "근위"), ("distal", english ? @"\bdistal\b" : "원위") })
                foreach (Match match in Regex.Matches(sentence, pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
                    yield return "direction:" + key;
        }
        var sourceSentences = Sentences(source);
        var draftSentences = Sentences(draftText);
        var sourceAnchors = sourceSentences.SelectMany(sentence => Anchors(sentence, true).Select(key => (Key: key, Sentence: sentence)))
            .GroupBy(item => item.Key).ToDictionary(group => group.Key, group => group.ToArray());
        var draftAnchors = draftSentences.SelectMany(sentence => Anchors(sentence, false).Select(key => (Key: key, Sentence: sentence)))
            .GroupBy(item => item.Key).ToDictionary(group => group.Key, group => group.ToArray());
        var negativeSources = sourceSentences.Where(sentence => SourceNegation.IsMatch(sentence)).ToArray();
        if (negativeSources.Length == 0 || draftSentences.Any(sentence => KoreanNegation.IsMatch(sentence) && !Anchors(sentence, false).Any()))
            return (false, null, null);
        var mapped = new List<(string Source, string Draft)>();
        var negativeKeys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var sentence in negativeSources)
        {
            var keys = Anchors(sentence, true).ToArray();
            // Mixed predicates/idioms and incidental surviving anchors cannot
            // establish clause scope. Require exactly one anchor occurrence,
            // unique in both excerpts, instead of discarding ambiguous ones.
            if (keys.Length != 1 || Regex.IsMatch(sentence, @"\b(?:and|but|or|not\s+only|no\s+(?:more|less)\s+than)\b|;", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant) ||
                sourceAnchors[keys[0]].Length != 1 || !draftAnchors.TryGetValue(keys[0], out var matches) || matches.Length != 1)
                return (false, null, null);
            var targets = new[] { matches[0].Sentence };
            // Exact bounded sentence evidence is required. Missing/repeated
            // anchors and long sentences cannot certify a correspondence.
            if (targets.Length == 0 || sentence.Length > 160 || targets.Any(target => target.Length > 160))
                return (false, null, null);
            if (SourceClotTerm.IsMatch(sentence) &&
                (SourceClotTerm.Matches(sentence).Count != 1 || SourceVesselTerm.IsMatch(sentence) ||
                 targets.Any(target => KoreanClotTerm.Matches(target).Count != 1 || KoreanClotStem.Matches(target).Count != 1 || KoreanVesselTerm.IsMatch(target))))
                return (false, null, null);
            if (SourceRecorded.IsMatch(sentence) && targets.Any(target => KoreanNegation.IsMatch(target) &&
                (KoreanRecordTerm.Matches(target).Count != 1 || KoreanRecordStem.Matches(target).Count != 1)))
                return (false, null, null);
            if (SourceRecorded.IsMatch(sentence) && SourceDoseTerm.IsMatch(sentence) &&
                targets.Any(target => KoreanNegation.IsMatch(target) &&
                    (SourceDoseTerm.Matches(sentence).Count != 1 || KoreanDoseTerm.Matches(target).Count != 1 || KoreanDoseStem.Matches(target).Count != 1)))
                return (false, null, null);
            if (SourceRecorded.IsMatch(sentence) && SourceDoseTerm.IsMatch(sentence))
                foreach (var target in targets.Where(target => KoreanNegation.IsMatch(target)))
                {
                    if (!SourceRecordedDoseSurfaceSupported(sentence)) return (false, null, null);
                    var dose = KoreanDoseTerm.Match(target);
                    var unitPairs = ScopeUnitPairPattern.Matches(target);
                    if (unitPairs.Count != 1) return (false, null, null);
                    var unitEnd = unitPairs[0].Index + unitPairs[0].Length;
                    if (dose.Index < unitEnd || !KoreanUnitDoseInterval.IsMatch(target[unitEnd..dose.Index]))
                        return (false, null, null);
                    var record = KoreanRecordTerm.Match(target);
                    var intervalStart = dose.Index + dose.Length;
                    if (record.Index < intervalStart || !KoreanDoseRecordInterval.IsMatch(target[intervalStart..record.Index]) ||
                        !KoreanDoseRecordTail.IsMatch(target[(record.Index + record.Length)..]))
                        return (false, null, null);
                }
            negativeKeys.Add(keys[0]);
            mapped.AddRange(targets.Select(target => (sentence, target)));
        }
        foreach (var target in mapped.Select(pair => pair.Draft).Distinct())
        {
            // A marker on another entity, multiple negative forms (including
            // double negatives), or a recognized compound predicate cannot
            // establish this sentence's polarity. Keep shared noun predicates
            // only when every target anchor comes from a negative source.
            // Remaining inline/unmatched quote and reporting cues cannot
            // establish direct polarity even when a negative marker survives.
            if (KoreanScopeUncertainty.IsMatch(target) || QuotationBoundary.IsMatch(target) || KoreanAttribution.IsMatch(target) || KoreanStatementBoundary.IsMatch(target) ||
                Anchors(target, false).Any(key => !negativeKeys.Contains(key)) ||
                KoreanNegation.Matches(target).Count > 1 ||
                Regex.IsMatch(target, @"\p{L}(?:고|며|지만|거나|으나)(?=$|[\s\p{P}])", RegexOptions.CultureInvariant))
                return (false, null, null);
        }
        var mismatch = mapped.FirstOrDefault(pair => !KoreanNegation.IsMatch(pair.Draft));
        return (true, mismatch.Source, mismatch.Draft);
    }

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
        var numericDraft = ComparableNumberDraft(source, translated, language);
        var draftNumbers = Numbers(numericDraft);
        var numericSupported = ScientificComparisonSupported(source, translated);
        var numericMismatch = numericSupported && sourceNumbers.Keys.Union(draftNumbers.Keys)
            .Any(value => sourceNumbers.GetValueOrDefault(value) != draftNumbers.GetValueOrDefault(value));
        var changedDraftNumber = NumberPattern.Matches(numericDraft).Select(match => match.Value)
            .FirstOrDefault(value => draftNumbers.GetValueOrDefault(NormalizeNumber(value)) >
                sourceNumbers.GetValueOrDefault(NormalizeNumber(value)));
        Add("number", numericSupported && (NumberPattern.IsMatch(source) || NumberPattern.IsMatch(translated)),
            numericMismatch ? "Numeric value or count differs from the source; review each value and sign." : null,
            draftSpan: numericMismatch ? changedDraftNumber : null);

        var sourceUnitMatches = UnitPattern.Matches(source).ToArray();
        var draftUnitMatches = UnitPattern.Matches(translated).ToArray();
        var sourceUnits = Counts(sourceUnitMatches.Select(match => UnitKey(match.Value)));
        var draftUnits = Counts(draftUnitMatches.Select(match => UnitKey(match.Value)));
        var sourcePairMatches = UnitPairPattern.Matches(source).ToArray();
        var draftPairMatches = UnitPairPattern.Matches(translated).ToArray();
        var sourcePairs = Counts(sourcePairMatches.Select(PairKey));
        var draftPairs = Counts(draftPairMatches.Select(PairKey));
        var unitSupported = language is "ko" or "es" && numericSupported && (sourceUnits.Count > 0 || draftUnits.Count > 0);
        var unitMismatch = unitSupported && (CountsDiffer(sourceUnits, draftUnits) || CountsDiffer(sourcePairs, draftPairs));
        Add("unit", unitSupported,
            unitMismatch ? "Literal unit symbol count or adjacent number-unit pair differs from the source; review units and their values manually. Unit conversions and meaning are not verified." : null,
            sourceSpan: unitMismatch ? ExcessSpan(sourcePairMatches, PairKey, sourcePairs, draftPairs)
                ?? ExcessSpan(sourceUnitMatches, match => UnitKey(match.Value), sourceUnits, draftUnits) : null,
            draftSpan: unitMismatch ? ExcessSpan(draftPairMatches, PairKey, draftPairs, sourcePairs)
                ?? ExcessSpan(draftUnitMatches, match => UnitKey(match.Value), draftUnits, sourceUnits) : null);

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

        var sourceNegated = SourceNegation.IsMatch(source);
        var negationSupported = language is "ko" or "es" or "ar" && sourceNegated && !UnsupportedSourceNegation(source);
        var arabicWithoutMarks = Regex.Replace(translated, @"[\u064B-\u065F]", "");
        var negationVisible = language switch
        {
            "ko" => KoreanNegation.IsMatch(translated),
            "es" => SpanishNegation.IsMatch(translated),
            "ar" => ArabicNegation.IsMatch(arabicWithoutMarks),
            _ => false
        };
        Add("negation", negationSupported,
            negationSupported && !negationVisible
                ? "Source negation marker is not identifiable in this draft; review meaning and scope manually." : null);

        var scope = language == "ko" ? KoreanNegationScope(source, translated) : (Assessed: false, SourceSpan: (string?)null, DraftSpan: (string?)null);
        Add("negation-scope", scope.Assessed,
            scope.SourceSpan is not null
                ? "A uniquely anchored source sentence contains no/not, but its draft sentence has no recognized Korean negative marker. Review meaning and scope manually; this lexical check does not verify semantic equivalence." : null,
            scope.SourceSpan, scope.DraftSpan);

        var femoralVein = language == "ko" &&
            Regex.IsMatch(source, @"\bfemoral\s+vein\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        Add("terminology", femoralVein,
            femoralVein && !Regex.IsMatch(translated, @"(?:대퇴|넙다리)\s*정맥", RegexOptions.CultureInvariant)
                ? "Femoral vein is not identifiable in the Korean draft; review terminology." : null);
        var identifiers = IdentifierInventory(source, translated);
        Add("identifier", identifiers.Assessed, identifiers.Mismatch ? IdentifierWarning : null,
            identifiers.SourceSpan, identifiers.DraftSpan);
        Add("omission", false, null);
        Add("other", false, null);
        return new(findings, coverage);
    }

    public static string Summarize(string source, string translated, string language)
    {
        var numericDraft = ComparableNumberDraft(source, translated, language);
        var targetTokens = NumberPattern.Matches(numericDraft).Select(match => match.Value).ToHashSet(StringComparer.Ordinal);
        var missing = NumberPattern.Matches(source).Select(match => match.Value)
            .Where(value => !targetTokens.Contains(value)).Distinct(StringComparer.Ordinal).ToArray();
        var warnings = new List<string>();
        if (missing.Length > 0) warnings.Add($"Source number format not found exactly in draft: {string.Join(", ", missing)}. Review numeric fidelity.");
        var sourceNumbers = Numbers(source);
        var targetNumbers = Numbers(numericDraft);
        var numericSupported = ScientificComparisonSupported(source, translated);
        var changed = sourceNumbers.Keys.Union(targetNumbers.Keys).Where(value => numericSupported &&
            sourceNumbers.GetValueOrDefault(value) != targetNumbers.GetValueOrDefault(value)).ToArray();
        if (changed.Length > 0)
            warnings.Add($"Numeric value/count mismatch: {string.Join("; ", changed.Select(value => $"{value} (source {sourceNumbers.GetValueOrDefault(value)}, draft {targetNumbers.GetValueOrDefault(value)})"))}. Check omissions, additions and substitutions.");
        if (!numericSupported) warnings.Add("Scientific numeric comparison is not assessed; review exponent notation and values manually.");
        if (language == "ko" && source.Contains("proximal", StringComparison.OrdinalIgnoreCase) &&
            translated.Contains("원위", StringComparison.Ordinal) && !translated.Contains("근위", StringComparison.Ordinal))
            warnings.Add("Possible proximal-to-distal directional mismatch; human review required.");
        if (language == "ko" &&
            Regex.IsMatch(source, @"\bfemoral\s+vein\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant) &&
            !Regex.IsMatch(translated, @"(?:대퇴|넙다리)\s*정맥", RegexOptions.CultureInvariant))
            warnings.Add("Source femoral vein is not identifiable in the Korean draft; review anatomical terminology.");
        // Only previously scoped Korean/Arabic residual-English checks. Latin
        // anatomical cognates in other languages are not evidence of mistranslation.
        if (language is "ko" or "ar" &&
            Regex.IsMatch(translated, @"\b(?:proximal|distal)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
            warnings.Add("Untranslated English directional term remains; human review required.");
        if (IdentifierInventory(source, translated).Mismatch) warnings.Add(IdentifierWarning);
        warnings.Add("Automated checks are limited; independent medical and linguistic review is still required.");
        return string.Join(" ", warnings);
    }
}
