using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using System.Text.RegularExpressions;
using QCStatusBoard;

namespace MedicalQcWebDemo;

// Local desktop adapter. The public demo never admits document uploads here.
internal static class LocalDocxDocuments
{
    private const int MaxSourceBytes = 10 * 1024 * 1024;
    private const int MaxJsonBytes = 16 * 1024 * 1024;
    internal sealed record Request(string SourceBase64, string? SourceSha256,
        Dictionary<string, string>? Targets);

    internal static void Map(WebApplication app)
    {
        app.MapGet("/api/local/docx/status", (HttpContext context) =>
            Admitted(context) ? Results.Ok(new { available = true, localOnly = true }) : Results.NotFound());
        app.MapPost("/api/local/docx/inspect", (Delegate)((HttpContext context) => Execute(context, false)));
        app.MapPost("/api/local/docx/apply", (Delegate)((HttpContext context) => Execute(context, true)));
    }

    internal static bool Admitted(HttpContext context)
    {
        if (Environment.GetEnvironmentVariable("MTQC_LOCAL_DOCUMENTS") != "true"
            || context.Connection.RemoteIpAddress is not { } remote || !IPAddress.IsLoopback(remote)) return false;
        var host = context.Request.Host.Host;
        if (host != "localhost" && (!IPAddress.TryParse(host, out var address) || !IPAddress.IsLoopback(address))) return false;
        var origin = context.Request.Headers.Origin.ToString();
        return origin.Length == 0 || origin == $"{context.Request.Scheme}://{context.Request.Host}";
    }

    private static async Task<IResult> Execute(HttpContext context, bool apply)
    {
        if (!Admitted(context)) return Results.StatusCode(403);
        if (context.Request.ContentType?.Split(';')[0].Trim() != "application/json") return Results.StatusCode(415);
        if (context.Request.ContentLength > MaxJsonBytes) return Results.StatusCode(413);
        string? directory = null;
        try
        {
            using var body = new MemoryStream();
            var buffer = new byte[65536];
            int count;
            while ((count = await context.Request.Body.ReadAsync(buffer, context.RequestAborted)) > 0)
            {
                if (body.Length + count > MaxJsonBytes) return Results.StatusCode(413);
                body.Write(buffer, 0, count);
            }
            var request = JsonSerializer.Deserialize<Request>(body.ToArray(), new JsonSerializerOptions(JsonSerializerDefaults.Web))
                ?? throw new InvalidDataException("Missing document request.");
            if (request.SourceBase64 is null || request.SourceBase64.Length > ((MaxSourceBytes + 2) / 3) * 4)
                throw new InvalidDataException("Document exceeds the local limit.");
            var bytes = Convert.FromBase64String(request.SourceBase64);
            var nativeEquations = ValidatePackage(bytes);
            var digest = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            if (apply && !string.Equals(request.SourceSha256, digest, StringComparison.Ordinal))
                throw new InvalidDataException("Document source binding changed.");
            directory = Path.Combine(Path.GetTempPath(), "mtqc-local-docx-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            var input = Path.Combine(directory, "source.docx");
            var output = Path.Combine(directory, "draft.docx");
            await File.WriteAllBytesAsync(input, bytes, context.RequestAborted);
            var document = await PackageDocument.LoadAsync(input, output, ".docx", context.RequestAborted);
            if (document.Units.Count > 4096) throw new InvalidDataException("Too many document text units.");
            if (!apply) return Results.Ok(new
            {
                sourceSha256 = digest,
                units = document.Units.Select(u => new { u.Id, u.Text, u.Context, u.LayoutRole, u.InlineContract }),
                nativeEquationCount = nativeEquations,
                scannedEquationOcr = false,
                renderedLayoutVerified = false
            });
            if (request.Targets is null || request.Targets.Count == 0)
                throw new InvalidDataException("No reviewed text targets supplied.");
            var units = document.Units.ToDictionary(u => u.Id, StringComparer.Ordinal);
            foreach (var target in request.Targets)
            {
                if (!units.TryGetValue(target.Key, out var unit)) throw new InvalidDataException("Unknown document text unit.");
                ValidateTarget(unit, target.Value);
            }
            // Apply only explicitly selected targets. Never reconstruct untouched runs from trimmed display text.
            await ((PackageDocument)document).SaveSelectedAsync(request.Targets, context.RequestAborted);
            var result = await File.ReadAllBytesAsync(output, context.RequestAborted);
            if (!SHA256.HashData(await File.ReadAllBytesAsync(input, context.RequestAborted)).SequenceEqual(SHA256.HashData(bytes)))
                throw new InvalidDataException("Document source changed during export.");
            return Results.File(result, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "mtqc-text-draft.docx");
        }
        catch (Exception error) when (error is InvalidDataException or FormatException or JsonException or XmlException or ArgumentException)
        {
            return Results.BadRequest(new { error = "Document held: " + error.Message });
        }
        finally
        {
            if (directory is not null) Directory.Delete(directory, true);
        }
    }

    private static void ValidateTarget(TranslationUnit unit, string? target)
    {
        if (string.IsNullOrWhiteSpace(target) || target.Length > 50000
            || string.IsNullOrWhiteSpace(InlineRunContract.Strip(target))
            || target.Any(c => char.IsControl(c) && c is not '\r' and not '\n' and not '\t'))
            throw new InvalidDataException("Invalid reviewed text target.");
        var markers = InlineRunContract.Markers(unit.InlineContract);
        if (!InlineRunContract.IsValid(unit.InlineContract, target)
            || (markers.Count > 0 && !target.StartsWith(markers[0], StringComparison.Ordinal))
            || InlineRunContract.Strip(target).Contains("⟦MTQC_", StringComparison.Ordinal))
            throw new InvalidDataException("Keep every inline marker in its original order; native equations stay between the same runs.");
        XmlConvert.VerifyXmlChars(target);
    }

    internal static int ValidatePackage(byte[] bytes)
    {
        if (bytes.Length == 0 || bytes.Length > MaxSourceBytes) throw new InvalidDataException("Invalid document size.");
        using var memory = new MemoryStream(bytes, false);
        using var zip = new ZipArchive(memory, ZipArchiveMode.Read);
        if (zip.Entries.Count > 512) throw new InvalidDataException("Too many package entries.");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        long expanded = 0;
        int equations = 0;
        foreach (var entry in zip.Entries)
        {
            var name = entry.FullName;
            var lower = name.ToLowerInvariant();
            if (!names.Add(name) || name.StartsWith('/') || name.Contains('\\')
                || name.Split('/').Any(part => part is "." or "..")
                || lower.StartsWith("_xmlsignatures/") || lower.Contains("vbaproject")
                || lower.StartsWith("word/activex/") || lower.StartsWith("word/embeddings/") || lower.StartsWith("customui/"))
                throw new InvalidDataException("Unsupported active, signed or ambiguous package.");
            expanded += entry.Length;
            if (expanded > 48 * 1024 * 1024) throw new InvalidDataException("Expanded document exceeds the local limit.");
            if (!lower.EndsWith(".xml") && !lower.EndsWith(".rels")) continue;
            if (entry.Length > 2 * 1024 * 1024) throw new InvalidDataException("Document XML exceeds the local limit.");
            using var stream = entry.Open();
            using var reader = XmlReader.Create(stream, new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 2 * 1024 * 1024
            });
            var xml = XDocument.Load(reader);
            if (name == "[Content_Types].xml" && xml.Descendants().Attributes("ContentType").Any(a =>
                Regex.IsMatch(a.Value, "macroEnabled|vbaProject|vbaData|oleObject|activeX|digital-signature|webextension", RegexOptions.IgnoreCase)))
                throw new InvalidDataException("Declared active or signed content requires separate review.");
            if (lower.EndsWith(".rels") && xml.Descendants().Attributes("Type").Any(a =>
                Regex.IsMatch(a.Value, @"/(?:oleObject|package|control|activeXControlBinary|vbaProject|vbaData|aFChunk|attachedTemplate|webextension|webextensiontaskpanes|ui/extensibility|digital-signature/[^/]+)$", RegexOptions.IgnoreCase)))
                throw new InvalidDataException("Declared active or signed relationship requires separate review.");
            if (lower.EndsWith(".rels") && xml.Descendants().Any(e => e.Attributes().Any(a => a.Name.LocalName == "TargetMode" && a.Value == "External")))
                throw new InvalidDataException("External package relationships require separate review.");
            if (name.StartsWith("word/", StringComparison.Ordinal))
                equations += xml.Descendants(XName.Get("oMath", "http://schemas.openxmlformats.org/officeDocument/2006/math")).Count();
        }
        if (!names.Contains("[Content_Types].xml") || !names.Contains("word/document.xml"))
            throw new InvalidDataException("A genuine Word document is required.");
        return equations;
    }
}
