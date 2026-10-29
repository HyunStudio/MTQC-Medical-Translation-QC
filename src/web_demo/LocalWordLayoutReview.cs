using System.IO.Compression;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;

namespace MedicalQcWebDemo;

internal static class LocalWordLayoutReview
{
    private sealed record Request(string SourceBase64, string TargetBase64, string SourceSha256, string TargetSha256);
    private static bool Admitted(HttpContext context, bool natural = false) => LocalDocxDocuments.Admitted(context) &&
        Environment.GetEnvironmentVariable(natural ? "MTQC_LOCAL_WORD_FLOW" : "MTQC_LOCAL_WORD_LAYOUT") == "true";
    private static bool ReadAdmitted(HttpContext context) => Admitted(context) || Admitted(context, true);

    internal static void Map(WebApplication app)
    {
        var jobs = app.Services.GetRequiredService<LocalWordLayoutJobs>();
        app.MapGet("/api/local/docx/layout/status", (HttpContext context) =>
            Admitted(context) ? Results.Ok(jobs.Availability()) : Results.StatusCode(403));
        app.MapPost("/api/local/docx/layout/jobs", (Delegate)((HttpContext context) => Submit(context, jobs)));
        app.MapGet("/api/local/docx/layout/flow/status", (HttpContext context) =>
            Admitted(context, true) ? Results.Ok(jobs.Availability(true)) : Results.StatusCode(403));
        app.MapPost("/api/local/docx/layout/flow/jobs", (Delegate)((HttpContext context) => Submit(context, jobs, true)));
        app.MapGet("/api/local/docx/layout/jobs/{id}", (HttpContext context, string id) =>
            !ReadAdmitted(context) ? Results.StatusCode(403) : jobs.Get(id) is { } view ? Results.Ok(view) : Results.NotFound());
        app.MapGet("/api/local/docx/layout/jobs/{id}/report", (HttpContext context, string id) =>
            !ReadAdmitted(context) ? Results.StatusCode(403) : jobs.Report(id) is { } bytes
                ? Results.File(bytes, "application/json", "mtqc-word-layout-report.json") : Results.NotFound());
        app.MapGet("/api/local/docx/layout/jobs/{id}/pdf", (HttpContext context, string id) =>
            !ReadAdmitted(context) ? Results.StatusCode(403) : jobs.RenderedPdf(id) is { } bytes
                ? Results.File(bytes, "application/pdf", "mtqc-natural-layout.pdf") : Results.NotFound());
    }

    private static async Task<IResult> Submit(HttpContext context, LocalWordLayoutJobs jobs, bool natural = false)
    {
        if (!Admitted(context, natural)) return Results.StatusCode(403);
        if (context.Request.ContentType?.Split(';')[0].Trim() != "application/json") return Results.StatusCode(415);
        const int bound = 32 * 1024 * 1024;
        if (context.Request.ContentLength > bound) return Results.StatusCode(413);
        try
        {
            using var memory = new MemoryStream(); var buffer = new byte[65536];
            int read;
            while ((read = await context.Request.Body.ReadAsync(buffer, context.RequestAborted)) != 0)
            {
                if (memory.Length + read > bound) return Results.StatusCode(413);
                memory.Write(buffer, 0, read);
            }
            var request = JsonSerializer.Deserialize<Request>(memory.ToArray(), new JsonSerializerOptions(JsonSerializerDefaults.Web))
                ?? throw new InvalidDataException("Missing document pair.");
            var source = Decode(request.SourceBase64); var target = Decode(request.TargetBase64);
            NativeInput(source); NativeInput(target);
            // No RequestAborted token crosses this boundary. The hosted owner drains admitted work.
            var view = jobs.Submit(source, target, request.SourceSha256, request.TargetSha256, natural);
            return Results.Json(view, statusCode: 202);
        }
        catch (LayoutAdmissionException error) { return Results.Json(new { error = error.Message }, statusCode: error.StatusCode); }
        catch (Exception error) when (error is InvalidDataException or JsonException or FormatException or XmlException or ArgumentException)
        { return Results.BadRequest(new { error = "Document comparison held: " + error.Message }); }
    }
    private static byte[] Decode(string? encoded)
    {
        if (encoded is null || encoded.Length > ((10 * 1024 * 1024 + 2) / 3) * 4)
            throw new InvalidDataException("Each document must fit the local 10 MiB limit.");
        return Convert.FromBase64String(encoded);
    }
    private static void NativeInput(byte[] bytes)
    {
        LocalDocxDocuments.ValidatePackage(bytes);
        using var memory = new MemoryStream(bytes, false); using var zip = new ZipArchive(memory, ZipArchiveMode.Read);
        var wordNamespaces = new[] { "http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main" };
        foreach (var entry in zip.Entries.Where(e => e.FullName.EndsWith(".xml", StringComparison.OrdinalIgnoreCase)))
        {
            using var stream = entry.Open(); using var reader = XmlReader.Create(stream, new XmlReaderSettings
            { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 2 * 1024 * 1024 });
            var xml = XDocument.Load(reader);
            if (xml.Descendants().Any(e => e.Name.LocalName == "OLEObject" ||
                wordNamespaces.Contains(e.Name.NamespaceName, StringComparer.Ordinal) &&
                e.Name.LocalName is "fldChar" or "fldSimple" or "instrText" or "altChunk"))
                throw new InvalidDataException("Fields, inserted content and OLE require separate native-execution review.");
        }
    }
}
