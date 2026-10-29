using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace QCStatusBoard;

// Restores the selected source's package structure; it does not infer a page layout.
public static class DocxSourceRestoration
{
    private static readonly XNamespace W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private static readonly XNamespace M = "http://schemas.openxmlformats.org/officeDocument/2006/math";
    private static readonly XNamespace W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
    private static readonly XNamespace Wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
    private static readonly XNamespace A = "http://schemas.openxmlformats.org/drawingml/2006/main";
    private const int MaxBytes = 10 * 1024 * 1024;
    private sealed record Part(string Name, byte[] Bytes, DateTimeOffset Time);
    public sealed record PartReport(string Part, string Correspondence, int Paragraphs, int TextNodes, int NativeEquations, int RestoredParagraphs);
    public sealed record RestoredSourceParagraph(string Part, string ParagraphId, string SourceTextPreview);
    public sealed record RestorationReport(string SourceSha256, string DraftSha256, string OutputSha256,
        IReadOnlyList<PartReport> Parts, int NativeEquations, int PreservedMedia,
        bool SourceStructureRestored, bool RenderedLayoutVerified, bool ScannedEquationOcr,
        bool PublicationBlocked, IReadOnlyList<string> Warnings, int RestoredParagraphs,
        IReadOnlyList<RestoredSourceParagraph> RestoredSourceParagraphs);
    public sealed record Result(byte[] Document, RestorationReport Report);

    public static Result Restore(byte[] source, byte[] draft)
    {
        var original = Read(source); var translated = Read(draft);
        if (!original.Keys.ToHashSet(StringComparer.Ordinal).SetEquals(translated.Keys))
            throw new InvalidDataException("Source and draft package entries do not correspond.");
        var outputs = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        var reports = new List<PartReport>(); var media = 0;
        var restored = new List<RestoredSourceParagraph>(); var retainedCorrespondences = 0;
        foreach (var part in original.Values)
        {
            var target = translated[part.Name];
            if (part.Name.EndsWith(".rels", StringComparison.OrdinalIgnoreCase) || part.Name == "[Content_Types].xml")
            {
                if (!XNode.DeepEquals(AuthorityMap(part.Bytes, part.Name), AuthorityMap(target.Bytes, part.Name)))
                    throw new InvalidDataException("Package relationship or content-type authority changed: " + part.Name);
                outputs.Add(part.Name, part.Bytes); continue;
            }
            if (part.Name.StartsWith("word/media/", StringComparison.Ordinal))
            { outputs.Add(part.Name, target.Bytes); media++; continue; }
            if (!part.Name.StartsWith("word/", StringComparison.Ordinal) || !part.Name.EndsWith(".xml", StringComparison.Ordinal))
            {
                if (!part.Bytes.SequenceEqual(target.Bytes))
                    throw new InvalidDataException("Unmapped package content changed: " + part.Name);
                outputs.Add(part.Name, part.Bytes); continue;
            }
            var xml = Parse(part.Bytes); var draftXml = Parse(target.Bytes);
            var sourceText = VisibleText(xml).ToArray(); var draftText = VisibleText(draftXml).ToArray();
            var paragraphs = xml.Descendants(W + "p").ToArray();
            var draftParagraphs = draftXml.Descendants(W + "p").ToArray();
            CheckDuplicateIds(paragraphs); CheckDuplicateIds(draftParagraphs);
            var identified = paragraphs.Length > 0 && paragraphs.All(p => Id(p).Length > 0)
                && draftParagraphs.All(p => Id(p).Length > 0);
            var mode = "unchanged-nontext-part";
            var restoredBefore = restored.Count;
            if (sourceText.Length > 0 || draftText.Length > 0 || paragraphs.Length > 0)
            {
                if (identified)
                {
                    var draftMap = draftParagraphs.ToDictionary(Id, StringComparer.Ordinal);
                    var sourceIds = paragraphs.Select(Id).ToHashSet(StringComparer.Ordinal);
                    if (!draftMap.Keys.All(sourceIds.Contains))
                        throw new InvalidDataException("Paragraph identifiers do not correspond: " + part.Name);
                    if (sourceText.Any(t => !t.Ancestors(W + "p").Any()) || draftText.Any(t => !t.Ancestors(W + "p").Any()))
                        throw new InvalidDataException("Unmapped text outside paragraph: " + part.Name);
                    foreach (var paragraph in paragraphs)
                    {
                        if (!draftMap.TryGetValue(Id(paragraph), out var other))
                        {
                            var preview = string.Concat(OwnText(paragraph).Select(t => t.Value));
                            preview = string.Concat(preview.EnumerateRunes().Take(160).Select(r => r.ToString()));
                            restored.Add(new(part.Name, Id(paragraph), preview));
                            continue; // The original template already holds this paragraph in its original position.
                        }
                        // Structural changes beyond source math/formatting cannot silently discard draft content.
                        if (!XNode.DeepEquals(Skeleton(paragraph, stripParagraphIds: true), Skeleton(other, stripParagraphIds: true)))
                            throw new InvalidDataException("Paragraph content topology changed: " + Id(paragraph));
                        CopyText(OwnText(paragraph).ToArray(), OwnText(other).ToArray());
                        retainedCorrespondences++;
                    }
                    mode = restored.Count > restoredBefore ? "retained-identifiers-with-source-omissions-restored" : "retained-paragraph-identifiers";
                }
                else
                {
                    if (!XNode.DeepEquals(Skeleton(xml.Root!), Skeleton(draftXml.Root!)))
                        throw new InvalidDataException("Content topology changed without complete paragraph identifiers: " + part.Name);
                    CopyText(sourceText, draftText); mode = "identical-content-topology";
                }
            }
            else if (!XNode.DeepEquals(xml, draftXml) && part.Name is not ("word/styles.xml" or "word/settings.xml" or "word/fontTable.xml" or "word/numbering.xml")
                && !part.Name.StartsWith("word/theme/", StringComparison.Ordinal))
                throw new InvalidDataException("Unmapped non-text XML changed: " + part.Name);
            using var memory = new MemoryStream();
            xml.Save(memory, SaveOptions.DisableFormatting); outputs.Add(part.Name, memory.ToArray());
            if (paragraphs.Length > 0 || xml.Descendants(M + "oMath").Any())
                reports.Add(new(part.Name, mode, paragraphs.Length, sourceText.Length, xml.Descendants(M + "oMath").Count(), restored.Count - restoredBefore));
        }
        if (restored.Count > 0 && retainedCorrespondences == 0)
            throw new InvalidDataException("No retained paragraph identity establishes source/draft correspondence.");
        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
            foreach (var part in original.Values)
            {
                var entry = zip.CreateEntry(part.Name, CompressionLevel.Optimal); entry.LastWriteTime = part.Time;
                using var stream = entry.Open(); stream.Write(outputs[part.Name]);
            }
        var bytes = output.ToArray();
        if (bytes.Length > MaxBytes) throw new InvalidDataException("Restored DOCX exceeds the local limit.");
        var warnings = new List<string>
        {
            "Source OOXML structure, formatting and geometry restored; Word rendering, overflow and font fidelity require review.",
            "Draft media bytes retained; embedded-image OCR and mathematical correctness are not accepted by this operation."
        };
        if (restored.Count > 0) warnings.Add($"{restored.Count} missing source paragraph(s) restored with original source text, not translated. Translation review is required.");
        return new(bytes, new(Hash(source), Hash(draft), Hash(bytes), reports, reports.Sum(p => p.NativeEquations), media,
            true, false, false, true, warnings, restored.Count, restored));
    }

    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static bool XmlWhitespace(string value) => value.All(c => c is ' ' or '\t' or '\r' or '\n');
    // Compare the OPC authority values, not one XML writer's serialization.
    // Output still uses the original bytes. No URI/path/identifier remapping occurs.
    private static XElement AuthorityMap(byte[] bytes, string part)
    {
        var relationships = part.EndsWith(".rels", StringComparison.OrdinalIgnoreCase);
        XNamespace ns = relationships ? "http://schemas.openxmlformats.org/package/2006/relationships"
            : "http://schemas.openxmlformats.org/package/2006/content-types";
        InvalidDataException Invalid() => new("Unsupported or ambiguous package authority: " + part);
        var root = Parse(bytes).Root;
        if (root is null || root.Name != ns + (relationships ? "Relationships" : "Types")
            || root.Attributes().Any(a => !a.IsNamespaceDeclaration)
            || root.Nodes().OfType<XText>().Any(t => !XmlWhitespace(t.Value))) throw Invalid();
        var keys = new HashSet<string>(relationships ? StringComparer.Ordinal : StringComparer.OrdinalIgnoreCase);
        var extensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var entries = new List<XElement>();
        foreach (var entry in root.Elements())
        {
            var name = entry.Name.LocalName;
            if (entry.Name.Namespace != ns || (relationships ? name != "Relationship" : name is not ("Default" or "Override"))
                || entry.Elements().Any() || entry.Nodes().OfType<XText>().Any(t => !XmlWhitespace(t.Value))) throw Invalid();
            string[] required = relationships ? ["Id", "Type", "Target"]
                : name == "Default" ? ["Extension", "ContentType"] : ["PartName", "ContentType"];
            if (required.Any(a => string.IsNullOrWhiteSpace((string?)entry.Attribute(a)))
                || entry.Attributes().Where(a => !a.IsNamespaceDeclaration).Any(a => a.Name.Namespace != XNamespace.None
                    || !required.Contains(a.Name.LocalName) && !(relationships && a.Name.LocalName == "TargetMode"))) throw Invalid();
            var key = (string)entry.Attribute(required[0])!;
            if (name == "Default" ? !extensions.Add(key) : !keys.Add(key)) throw Invalid();
            var normalized = new XElement(entry.Name, entry.Attributes().Where(a => !a.IsNamespaceDeclaration)
                .Select(a => new XAttribute(a.Name, a.Value)));
            if (relationships)
            {
                try { XmlConvert.VerifyNCName(key); } catch (XmlException) { throw Invalid(); }
                var mode = (string?)entry.Attribute("TargetMode") ?? "Internal";
                if (mode is not ("Internal" or "External")) throw Invalid();
                normalized.SetAttributeValue("TargetMode", mode);
            }
            entries.Add(new XElement(normalized.Name, normalized.Attributes().OrderBy(a => a.Name.LocalName, StringComparer.Ordinal)));
        }
        return new XElement(root.Name, entries.OrderBy(e => e.Name.LocalName, StringComparer.Ordinal)
            .ThenBy(e => (string?)e.Attribute(relationships ? "Id" : e.Name.LocalName == "Default" ? "Extension" : "PartName"), StringComparer.Ordinal));
    }
    private static string Id(XElement p) => (string?)p.Attribute(W14 + "paraId") ?? "";
    private static IEnumerable<XElement> VisibleText(XContainer root) => root.Descendants(W + "t").Where(t => !t.Ancestors().Any(p => p.Name.Namespace == M));
    private static IEnumerable<XElement> OwnText(XElement paragraph) => VisibleText(paragraph).Where(t => t.Ancestors(W + "p").FirstOrDefault() == paragraph);
    private static void CheckDuplicateIds(XElement[] paragraphs)
    {
        var ids = paragraphs.Select(Id).Where(id => id.Length > 0).ToArray();
        if (ids.Distinct(StringComparer.Ordinal).Count() != ids.Length) throw new InvalidDataException("Duplicate paragraph identifier.");
    }
    private static void CopyText(XElement[] source, XElement[] draft)
    {
        if (source.Length != draft.Length) throw new InvalidDataException("Translated text segmentation changed.");
        for (var i = 0; i < source.Length; i++)
        {
            source[i].Value = draft[i].Value;
            source[i].SetAttributeValue(XNamespace.Xml + "space", (string?)draft[i].Attribute(XNamespace.Xml + "space"));
        }
    }
    private static XElement Skeleton(XElement element, bool stripParagraphIds = false)
    {
        var copy = new XElement(element);
        foreach (var node in copy.Descendants().Where(e => e.Name.Namespace == M
            || e.Name.Namespace == W && new[] { "pPr", "rPr", "tblPr", "trPr", "tcPr", "tblGrid", "sectPr" }.Contains(e.Name.LocalName)
            || e.Name.Namespace == Wp && new[] { "positionH", "positionV", "extent", "effectExtent", "simplePos" }.Contains(e.Name.LocalName)
            || e.Name == A + "xfrm").ToArray()) node.Remove();
        foreach (var text in copy.DescendantsAndSelf(W + "t")) { text.Value = ""; text.Attribute(XNamespace.Xml + "space")?.Remove(); }
        foreach (var blank in copy.DescendantNodes().OfType<XText>().Where(t => string.IsNullOrWhiteSpace(t.Value)).ToArray()) blank.Remove();
        foreach (var node in copy.DescendantsAndSelf())
        {
            if (stripParagraphIds) node.Attribute(W14 + "paraId")?.Remove();
            if (node.Name == Wp + "anchor") foreach (var attr in node.Attributes().Where(a => !a.IsNamespaceDeclaration && a.Name.Namespace == XNamespace.None).ToArray()) attr.Remove();
        }
        return copy;
    }
    private static XDocument Parse(byte[] bytes)
    {
        using var stream = new MemoryStream(bytes);
        using var reader = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 2 * 1024 * 1024 });
        return XDocument.Load(reader, LoadOptions.PreserveWhitespace);
    }
    private static Dictionary<string, Part> Read(byte[] bytes)
    {
        if (bytes.Length == 0 || bytes.Length > MaxBytes) throw new InvalidDataException("Invalid DOCX size.");
        using var memory = new MemoryStream(bytes); using var zip = new ZipArchive(memory, ZipArchiveMode.Read);
        if (zip.Entries.Count > 512) throw new InvalidDataException("Too many DOCX entries.");
        var result = new Dictionary<string, Part>(StringComparer.Ordinal); var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase); long expanded = 0;
        foreach (var entry in zip.Entries)
        {
            var name = entry.FullName;
            if (!names.Add(name) || name.StartsWith('/') || name.Contains('\\') || name.Split('/').Any(p => p is "." or "..")
                || name.StartsWith("_xmlsignatures/", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Ambiguous or signed package.");
            using var input = entry.Open(); using var content = new MemoryStream(); var buffer = new byte[65536]; int read;
            while ((read = input.Read(buffer)) > 0) { expanded += read; if (expanded > 48 * 1024 * 1024) throw new InvalidDataException("Expanded DOCX exceeds limit."); content.Write(buffer, 0, read); }
            result.Add(name, new(name, content.ToArray(), entry.LastWriteTime));
        }
        if (!result.ContainsKey("word/document.xml") || !result.ContainsKey("[Content_Types].xml")) throw new InvalidDataException("DOCX document part missing.");
        return result;
    }
}
