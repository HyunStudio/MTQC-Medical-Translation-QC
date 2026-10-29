using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using System.Runtime.CompilerServices;
[assembly: InternalsVisibleTo("MedicalTranslationQC")]
[assembly: InternalsVisibleTo("MedicalQcWebDemo")]
namespace QCStatusBoard;

internal sealed record TranslationUnit(
    string Id,
    string Text,
    string Context,
    string LayoutRole = "flow",
    double BudgetMultiplier = 1.0,
    double BudgetReserve = 4.0,
    string InlineContract = "");
internal abstract class TranslatableDocument
{
    protected TranslatableDocument(string inputPath, string outputPath) { InputPath = inputPath; OutputPath = outputPath; }
    public string InputPath { get; }
    public string OutputPath { get; }
    public abstract IReadOnlyList<TranslationUnit> Units { get; }
    public abstract Task SaveAsync(IReadOnlyDictionary<string, string> translations, CancellationToken ct);
}

internal sealed class PlainTextDocument : TranslatableDocument
{
    private readonly string[] _lines;
    private readonly List<TranslationUnit> _units;
    private PlainTextDocument(string input, string output, string[] lines) : base(input, output)
    {
        _lines = lines; _units = lines.Select((line, i) => new TranslationUnit($"line_{i:D8}", line, $"line {i+1}" )).Where(x => ShouldTranslate(x.Text)).ToList();
    }
    public override IReadOnlyList<TranslationUnit> Units => _units;
    public static async Task<TranslatableDocument> LoadAsync(string input, string output, CancellationToken ct) => new PlainTextDocument(input, output, await File.ReadAllLinesAsync(input, ct));
    public override Task SaveAsync(IReadOnlyDictionary<string, string> translations, CancellationToken ct)
    {
        var result = _lines.ToArray(); foreach (var unit in _units) if (translations.TryGetValue(unit.Id, out var text)) result[int.Parse(unit.Id[5..])] = text;
        return File.WriteAllLinesAsync(OutputPath, result, new UTF8Encoding(false), ct);
    }
    internal static bool ShouldTranslate(string text) => !string.IsNullOrWhiteSpace(text) && text.Any(char.IsLetter);
}

internal sealed class NodeGroup
{
    public required TranslationUnit Unit { get; init; }
    public List<XText> Nodes { get; init; } = [];
    public Action<string>? CustomApply { get; init; }
    private List<XText>? _originalActiveNodes;
    public void Apply(IReadOnlyDictionary<string,string> translations)
    {
        if(!translations.TryGetValue(Unit.Id,out var translated)) return;
        if(CustomApply is not null){CustomApply(translated);return;}
        _originalActiveNodes??=Nodes.Where(n=>!string.IsNullOrEmpty(n.Value)).ToList();
        var active=_originalActiveNodes;
        if(active.Count==0)return;
        if(!string.IsNullOrEmpty(Unit.InlineContract)
            &&InlineRunContract.Markers(translated).Count!=0)
        {
            var spans=InlineRunContract.Parse(translated);
            if(spans.Count!=active.Count
                ||!spans.Select(span=>span.Marker).SequenceEqual(
                    InlineRunContract.Markers(Unit.InlineContract),
                    StringComparer.Ordinal))
                throw new InvalidDataException(
                    $"DOCX inline run contract is invalid: {Unit.Id}");
            for(var index=0;index<active.Count;index++)
                active[index].Value=spans[index].Text;
            return;
        }
        var weights=active.Select(n=>Math.Max(1,n.Value.Length)).ToArray(); var total=weights.Sum(); var cursor=0;
        for(var i=0;i<active.Count;i++)
        {
            var requested=i==active.Count-1?translated.Length:Math.Clamp(cursor+(int)Math.Round(translated.Length*(double)weights[i]/total),cursor,translated.Length);
            var end=i==active.Count-1?translated.Length:NearestBoundary(translated,requested,cursor);
            active[i].Value=translated[cursor..end]; cursor=end;
        }
    }

    private static int NearestBoundary(string text,int requested,int minimum)
    {
        if(requested<=minimum||requested>=text.Length)return requested;
        static bool Boundary(char ch)=>char.IsWhiteSpace(ch)||char.IsPunctuation(ch)||char.IsSymbol(ch);
        for(var distance=0;distance<=12;distance++)
        {
            var right=requested+distance;if(right<text.Length&&Boundary(text[right]))return right+1;
            var left=requested-distance;if(left>minimum&&Boundary(text[left-1]))return left;
        }
        return requested;
    }
}

internal static class InlineRunContract
{
    // Existing desktop translation instruction, reused by the web document consumer.
    internal const string TranslationInstruction = " When MTQC inline markers are present, preserve every marker exactly once and in order, but read the marker-stripped text as one continuous source string. You may redistribute the translation across marker spans or leave a span empty; never leak a source-language fragment merely because a marker splits a word.";
    internal const string CritiqueInstruction = " MTQC inline markers identify document text runs. They are structural metadata, not medical numbers or source claims; compare the text between markers as a continuous passage. Native content between runs remains outside this text-only critique.";

    private static readonly System.Text.RegularExpressions.Regex MarkerRegex=
        new(@"⟦MTQC_\d{4}⟧",System.Text.RegularExpressions.RegexOptions.Compiled);

    public static string Build(IReadOnlyList<XText> nodes)
    {
        var active=nodes.Where(node=>!string.IsNullOrEmpty(node.Value)).ToArray();
        if(active.Length<=1)return "";
        return string.Concat(active.Select((node,index)=>
            $"⟦MTQC_{index:D4}⟧{node.Value}"));
    }

    public static IReadOnlyList<string> Markers(string value)
        =>MarkerRegex.Matches(value).Select(match=>match.Value).ToArray();

    public static IReadOnlyList<(string Marker,string Text)> Parse(string value)
    {
        var matches=MarkerRegex.Matches(value);
        var result=new List<(string Marker,string Text)>();
        for(var index=0;index<matches.Count;index++)
        {
            var start=matches[index].Index+matches[index].Length;
            var end=index+1<matches.Count?matches[index+1].Index:value.Length;
            result.Add((matches[index].Value,value[start..end]));
        }
        return result;
    }

    public static bool IsValid(string contract,string translated)
        =>Markers(contract).SequenceEqual(
            Markers(translated),StringComparer.Ordinal);

    public static string Strip(string value)
        =>MarkerRegex.Replace(value,"");

    internal static bool HasContract(string value)
        =>value.Contains("⟦MTQC",StringComparison.Ordinal);

    internal static bool InvalidRequest(string value)
    {
        if(!HasContract(value))return false;
        var markers=Markers(value);
        return markers.Count is <1 or >48
            ||string.IsNullOrWhiteSpace(Strip(value))
            ||!value.StartsWith(markers[0],StringComparison.Ordinal)
            ||!markers.SequenceEqual(Enumerable.Range(0,markers.Count).Select(index=>
                "⟦MTQC_"+index.ToString("D4",System.Globalization.CultureInfo.InvariantCulture)+"⟧"),StringComparer.Ordinal)
            ||HasContract(Strip(value));
    }

    internal static bool ValidResponse(string source,string target)
        =>!HasContract(source)?!HasContract(target):
            !InvalidRequest(source)&&!InvalidRequest(target)&&IsValid(source,target);
}

internal sealed class PackageDocument : TranslatableDocument
{
    private sealed record EntryData(
        string Name,
        byte[]? XmlBytes,
        long Length,
        string Sha256,
        DateTimeOffset Time);
    private readonly List<EntryData> _entries; private readonly Dictionary<string,XDocument> _xml; private readonly List<NodeGroup> _groups; private readonly string _extension; private readonly Dictionary<string,string> _structureSignatures;
    private PackageDocument(string input,string output,List<EntryData> entries,Dictionary<string,XDocument> xml,List<NodeGroup> groups,string extension,Dictionary<string,string> structureSignatures):base(input,output){_entries=entries;_xml=xml;_groups=groups;_extension=extension;_structureSignatures=structureSignatures;}
    public override IReadOnlyList<TranslationUnit> Units => _groups.Select(g=>g.Unit).ToArray();

    public static async Task<TranslatableDocument> LoadAsync(string input,string output,string ext,CancellationToken ct)
    {
        var entries=new List<EntryData>(); var xml=new Dictionary<string,XDocument>(StringComparer.Ordinal); var groups=new List<NodeGroup>(); var signatures=new Dictionary<string,string>(StringComparer.Ordinal);
        using var fs=File.Open(input,FileMode.Open,FileAccess.Read,FileShare.Read); using var zip=new ZipArchive(fs,ZipArchiveMode.Read);
        foreach(var entry in zip.Entries)
        {
            await using var es=entry.Open();
            if(IsTarget(entry.FullName,ext))
            {
                using var ms=new MemoryStream();
                await es.CopyToAsync(ms,ct);
                var bytes=ms.ToArray();
                entries.Add(new(
                    entry.FullName,bytes,bytes.LongLength,
                    Convert.ToHexString(SHA256.HashData(bytes)),entry.LastWriteTime));
            }
            else
            {
                var hash=Convert.ToHexString(await SHA256.HashDataAsync(es,ct));
                entries.Add(new(entry.FullName,null,entry.Length,hash,entry.LastWriteTime));
            }
        }
        if(ext==".docx"&&entries.Any(e=>e.Name.StartsWith("_xmlsignatures/",StringComparison.OrdinalIgnoreCase)))throw new InvalidDataException("Digitally signed DOCX files require signature removal or re-signing before translation.");
        foreach(var entry in entries.Where(e=>IsTarget(e.Name,ext)))
        {
            try{using var ms=new MemoryStream(entry.XmlBytes!); var doc=await XDocument.LoadAsync(ms,LoadOptions.PreserveWhitespace,ct); xml[entry.Name]=doc; if(ext==".docx")signatures[entry.Name]=DocxStructureSignature(doc); groups.AddRange(BuildGroups(doc,ext,entry.Name,groups.Count));}
            catch(Exception ex){throw new InvalidDataException($"Translatable package XML could not be parsed: {entry.Name}",ex);}
        }
        return new PackageDocument(input,output,entries,xml,groups,ext,signatures);
    }

    public override Task SaveAsync(IReadOnlyDictionary<string,string> translations,CancellationToken ct)
        => SaveCoreAsync(translations,ct,requireCoverage:true);

    // Partial review must leave unselected XText nodes untouched, including whitespace.
    internal Task SaveSelectedAsync(IReadOnlyDictionary<string,string> translations,CancellationToken ct)
        => SaveCoreAsync(translations,ct,requireCoverage:false);

    private async Task SaveCoreAsync(IReadOnlyDictionary<string,string> translations,CancellationToken ct,bool requireCoverage)
    {
        var missing=_groups.Where(g=>!translations.TryGetValue(g.Unit.Id,out var value)||string.IsNullOrWhiteSpace(value)).Select(g=>g.Unit.Id).ToArray();
        if(requireCoverage&&missing.Length>0)throw new InvalidDataException($"Translation coverage is incomplete: {missing.Length} unit(s).");
        foreach(var g in _groups)g.Apply(translations);
        if(_extension==".docx")foreach(var part in _structureSignatures)if(!_xml.TryGetValue(part.Key,out var doc)||DocxStructureSignature(doc)!=part.Value)throw new InvalidDataException($"DOCX structure lock failed: {part.Key}");
        var temp=SiblingTempPath.Create(OutputPath); if(File.Exists(temp))File.Delete(temp);
        using var sourceStream=File.Open(
            InputPath,FileMode.Open,FileAccess.Read,FileShare.Read);
        using var sourceZip=new ZipArchive(sourceStream,ZipArchiveMode.Read);
        await using(var fs=File.Create(temp)) using(var zip=new ZipArchive(fs,ZipArchiveMode.Create))
        {
            foreach(var item in _entries.OrderByDescending(x=>x.Name.Equals("mimetype",StringComparison.Ordinal)))
            {
                var entry=zip.CreateEntry(
                    item.Name,
                    item.Name.Equals("mimetype",StringComparison.Ordinal)
                        ?CompressionLevel.NoCompression
                        :CompressionLevel.Optimal);
                entry.LastWriteTime=item.Time;
                await using var output=entry.Open();
                if(_xml.TryGetValue(item.Name,out var doc))
                    await doc.SaveAsync(output,SaveOptions.DisableFormatting,ct);
                else
                {
                    var sourceEntry=sourceZip.GetEntry(item.Name)
                        ??throw new InvalidDataException(
                            $"Source package entry disappeared: {item.Name}");
                    await using var input=sourceEntry.Open();
                    await input.CopyToAsync(output,ct);
                }
            }
        }
        VerifySavedPackage(temp);
        File.Move(temp,OutputPath,true);
    }

    private void VerifySavedPackage(string path)
    {
        using var zip=ZipFile.OpenRead(path);
        var expected=_entries.OrderByDescending(x=>x.Name.Equals("mimetype",StringComparison.Ordinal)).ToArray();
        if(!zip.Entries.Select(e=>e.FullName).SequenceEqual(expected.Select(e=>e.Name),StringComparer.Ordinal))throw new InvalidDataException("Package entry order or set changed.");
        for(var i=0;i<expected.Length;i++)
        {
            using var stream=zip.Entries[i].Open();
            if(!_xml.ContainsKey(expected[i].Name))
            {
                var hash=Convert.ToHexString(SHA256.HashData(stream));
                if(zip.Entries[i].Length!=expected[i].Length
                    ||!hash.Equals(expected[i].Sha256,StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException(
                        $"Non-text package part changed: {expected[i].Name}");
                continue;
            }
            using var memory=new MemoryStream();
            stream.CopyTo(memory);
            var bytes=memory.ToArray();
            if(_extension==".docx")
            {
                using var xmlStream=new MemoryStream(bytes);var document=XDocument.Load(xmlStream,LoadOptions.PreserveWhitespace);
                if(!_structureSignatures.TryGetValue(expected[i].Name,out var signature)||DocxStructureSignature(document)!=signature)throw new InvalidDataException($"Saved DOCX structure lock failed: {expected[i].Name}");
            }
        }
    }

    private static bool IsTarget(string name,string ext)=>ext switch
    {
        ".docx"=>name.StartsWith("word/",StringComparison.OrdinalIgnoreCase)
            &&name.EndsWith(".xml",StringComparison.OrdinalIgnoreCase)
            &&(name.Contains("document")
                ||name.Contains("header")
                ||name.Contains("footer")
                ||name.Contains("footnote")
                ||name.Contains("endnote")
                ||name.StartsWith("word/charts/",StringComparison.OrdinalIgnoreCase)
                ||name.StartsWith("word/diagrams/",StringComparison.OrdinalIgnoreCase)
                ||name.StartsWith("word/drawings/",StringComparison.OrdinalIgnoreCase)),
        ".pptx"=>name.StartsWith("ppt/",StringComparison.OrdinalIgnoreCase)&&name.EndsWith(".xml",StringComparison.OrdinalIgnoreCase)&&(name.Contains("slide")||name.Contains("notes")),
        ".xlsx"=>name.Equals("xl/sharedStrings.xml",StringComparison.OrdinalIgnoreCase)||(name.StartsWith("xl/worksheets/",StringComparison.OrdinalIgnoreCase)&&name.EndsWith(".xml",StringComparison.OrdinalIgnoreCase)),
        ".epub"=>name.EndsWith(".xhtml",StringComparison.OrdinalIgnoreCase)||name.EndsWith(".html",StringComparison.OrdinalIgnoreCase)||name.EndsWith(".htm",StringComparison.OrdinalIgnoreCase)||name.EndsWith(".ncx",StringComparison.OrdinalIgnoreCase),
        ".odt" or ".ods" or ".odp"=>name.Equals("content.xml",StringComparison.OrdinalIgnoreCase)||name.Equals("styles.xml",StringComparison.OrdinalIgnoreCase),
        _=>false
    };

    private static IEnumerable<NodeGroup> BuildGroups(XDocument doc,string ext,string part,int offset)
    {
        IEnumerable<XElement> containers=ext switch
        {
            ".docx"=>doc.Descendants().Where(x=>x.Name.LocalName=="p"&&x.Name.NamespaceName.Contains("wordprocessingml")),
            ".pptx"=>doc.Descendants().Where(x=>x.Name.LocalName=="p"&&x.Name.NamespaceName.Contains("drawingml")),
            ".xlsx"=>doc.Descendants().Where(x=>x.Name.LocalName is "si" or "is"),
            ".epub"=>doc.Descendants().Where(x=>new[]{"p","h1","h2","h3","h4","h5","h6","li","td","th","figcaption","title","text"}.Contains(x.Name.LocalName,StringComparer.OrdinalIgnoreCase)),
            _=>doc.Descendants().Where(x=>x.Name.LocalName is "p" or "h")
        };
        var index=offset;
        foreach(var container in containers)
        {
            var nodes=ext==".docx"
                ? DocxVisibleTextNodes(container)
                : container.DescendantNodes().OfType<XText>().Where(n=>!n.Ancestors().Any(a=>a.Name.LocalName is "script" or "style")).ToList();
            var text=string.Concat(nodes.Select(n=>n.Value)).Trim(); if(!PlainTextDocument.ShouldTranslate(text))continue;
            var role=ext==".docx"?DocxLayoutRole(container,part):"flow";
            var (multiplier,reserve)=role switch
            {
                "table_cell"=>(0.94,3.0),
                "text_box"=>(0.92,3.0),
                "header_footer"=>(0.92,2.0),
                "column_break"=>(0.94,2.0),
                _=>(1.0,4.0)
            };
            var paraId=container.Attributes().FirstOrDefault(a=>a.Name.LocalName=="paraId")?.Value??index.ToString("D8");
            var path=StableElementPath(container);var context=$"{part}:p:{paraId}:{role}:{path}";
            var id=ext==".docx"?"docx_"+Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{context}|{text}")))[..20].ToLowerInvariant():$"pkg_{index:D8}";
            var inlineContract=ext==".docx"?InlineRunContract.Build(nodes):"";
            index++;
            yield return new NodeGroup{Unit=new TranslationUnit(
                id,text,context,role,multiplier,reserve,inlineContract),Nodes=nodes};
        }
        if(ext!=".docx")yield break;
        foreach(var group in BuildDocxDrawingGroups(doc,part,index))
        {
            index++;
            yield return group;
        }
    }

    private static IEnumerable<NodeGroup> BuildDocxDrawingGroups(
        XDocument doc,
        string part,
        int offset)
    {
        var claimed=new HashSet<XElement>();
        var index=offset;
        var drawingParagraphs=doc.Descendants()
            .Where(element=>element.Name.LocalName=="p"
                &&element.Name.NamespaceName.Contains("drawingml"))
            .ToArray();
        foreach(var paragraph in drawingParagraphs)
        {
            var elements=paragraph.Descendants()
                .Where(element=>element.Name.LocalName=="t"
                    &&element.Name.NamespaceName.Contains("drawingml"))
                .ToArray();
            var nodes=elements.SelectMany(element=>element.Nodes().OfType<XText>()).ToList();
            var text=string.Concat(nodes.Select(node=>node.Value)).Trim();
            foreach(var element in elements)claimed.Add(element);
            if(!PlainTextDocument.ShouldTranslate(text))continue;
            yield return CreateDocxAuxiliaryGroup(
                part,paragraph,text,"drawing_text",nodes,index++);
        }
        foreach(var element in doc.Descendants().Where(element=>
                     element.Name.LocalName=="t"
                     &&element.Name.NamespaceName.Contains("drawingml")
                     &&!claimed.Contains(element)))
        {
            var nodes=element.Nodes().OfType<XText>().ToList();
            var text=string.Concat(nodes.Select(node=>node.Value)).Trim();
            if(!PlainTextDocument.ShouldTranslate(text))continue;
            yield return CreateDocxAuxiliaryGroup(
                part,element,text,"drawing_text",nodes,index++);
        }
        foreach(var element in doc.Descendants().Where(element=>
                     element.Name.LocalName=="textpath"))
        {
            var attribute=element.Attributes()
                .FirstOrDefault(item=>item.Name.LocalName=="string");
            var text=attribute?.Value?.Trim()??"";
            if(attribute is null||!PlainTextDocument.ShouldTranslate(text))continue;
            var context=$"{part}:wordart:{StableElementPath(element)}";
            var id="docx_"+Convert.ToHexString(SHA256.HashData(
                Encoding.UTF8.GetBytes($"{context}|{text}")))[..20].ToLowerInvariant();
            yield return new NodeGroup
            {
                Unit=new TranslationUnit(id,text,context,"wordart_text",0.9,2.0),
                CustomApply=value=>attribute.Value=value
            };
            index++;
        }
        foreach(var element in doc.Descendants().Where(element=>
                     element.Name.LocalName=="v"
                     &&element.Name.NamespaceName.Contains("drawingml/chart",StringComparison.OrdinalIgnoreCase)))
        {
            var nodes=element.Nodes().OfType<XText>().ToList();
            var text=string.Concat(nodes.Select(node=>node.Value)).Trim();
            if(!PlainTextDocument.ShouldTranslate(text))continue;
            yield return CreateDocxAuxiliaryGroup(
                part,element,text,"chart_text",nodes,index++);
        }
    }

    private static NodeGroup CreateDocxAuxiliaryGroup(
        string part,
        XElement element,
        string text,
        string role,
        List<XText> nodes,
        int index)
    {
        var context=$"{part}:{role}:{StableElementPath(element)}";
        var id="docx_"+Convert.ToHexString(SHA256.HashData(
            Encoding.UTF8.GetBytes($"{context}|{text}")))[..20].ToLowerInvariant();
        var multiplier=role=="chart_text"?0.9:0.92;
        return new NodeGroup
        {
            Unit=new TranslationUnit(
                id,text,context,role,multiplier,2.0,
                InlineRunContract.Build(nodes)),
            Nodes=nodes
        };
    }

    private static string StableElementPath(XElement element)=>string.Join("/",element.AncestorsAndSelf().Reverse().Select(e=>$"{e.Name.LocalName}[{e.ElementsBeforeSelf(e.Name).Count()+1}]"));

    private static List<XText> DocxVisibleTextNodes(XElement paragraph)
    {
        var result=new List<XText>();var fieldDepth=0;
        foreach(var element in paragraph.Descendants())
        {
            var nearestParagraph=element.Ancestors().FirstOrDefault(a=>a.Name.LocalName=="p"&&a.Name.NamespaceName.Contains("wordprocessingml"));
            if(nearestParagraph!=paragraph)continue;
            if(element.Name.LocalName=="fldChar")
            {
                var type=element.Attributes().FirstOrDefault(a=>a.Name.LocalName=="fldCharType")?.Value;
                if(type=="begin")fieldDepth++;
                else if(type=="end"&&fieldDepth>0)fieldDepth--;
                continue;
            }
            if(element.Name.LocalName=="t"&&element.Name.NamespaceName.Contains("wordprocessingml")&&fieldDepth==0
                && !element.Ancestors().Any(a=>a.Name.LocalName=="fldSimple"))
                result.AddRange(element.Nodes().OfType<XText>());
        }
        return result;
    }

    private static string DocxLayoutRole(XElement paragraph,string part)
    {
        if(part.Contains("header",StringComparison.OrdinalIgnoreCase)||part.Contains("footer",StringComparison.OrdinalIgnoreCase))return "header_footer";
        if(paragraph.Ancestors().Any(a=>a.Name.LocalName=="tc"))return "table_cell";
        if(paragraph.Ancestors().Any(a=>a.Name.LocalName=="txbxContent"))return "text_box";
        if(paragraph.Descendants().Any(e=>e.Name.LocalName=="br"&&e.Attributes().Any(a=>a.Name.LocalName=="type"&&a.Value=="column")))return "column_break";
        return "body";
    }

    private static string DocxStructureSignature(XDocument source)
    {
        var clone=new XDocument(source);
        foreach(var text in clone.Descendants().Where(e=>
                    (e.Name.LocalName=="t"
                        &&(e.Name.NamespaceName.Contains("wordprocessingml")
                            ||e.Name.NamespaceName.Contains("drawingml")))
                    ||(e.Name.LocalName=="v"
                        &&e.Name.NamespaceName.Contains("drawingml/chart",StringComparison.OrdinalIgnoreCase))))
            text.Value="";
        foreach(var attribute in clone.Descendants()
                     .Where(e=>e.Name.LocalName=="textpath")
                     .SelectMany(e=>e.Attributes())
                     .Where(a=>a.Name.LocalName=="string"))
            attribute.Value="";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(clone.ToString(SaveOptions.DisableFormatting))));
    }
    internal static List<NodeGroup> BuildGenericGroups(XDocument doc,string context)
    {
        var result=new List<NodeGroup>(); var i=0;
        foreach(var e in doc.Descendants().Where(e=>!e.HasElements&&!e.Ancestors().Any(a=>a.Name.LocalName is "script" or "style"))){var nodes=e.Nodes().OfType<XText>().ToList();var text=string.Concat(nodes.Select(n=>n.Value)).Trim();if(PlainTextDocument.ShouldTranslate(text))result.Add(new NodeGroup{Unit=new TranslationUnit($"xml_{i++:D8}",text,context),Nodes=nodes});}return result;
    }
}

