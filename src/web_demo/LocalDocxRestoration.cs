using System.Security.Cryptography;
using System.Text.Json;
using System.Xml;
using QCStatusBoard;

namespace MedicalQcWebDemo;

internal static class LocalDocxRestoration
{
    private sealed record Request(string SourceBase64, string DraftBase64, string SourceSha256, string DraftSha256);
    internal static void Map(WebApplication app)
    {
        app.MapGet("/api/local/docx/restoration/status", (HttpContext context) => LocalDocxDocuments.Admitted(context)
            ? Results.Ok(new { available = true, sourceStructureRestoration = true, omittedParagraphRestoration = true, renderedLayoutVerified = false, scannedEquationOcr = false }) : Results.StatusCode(403));
        app.MapPost("/api/local/docx/restoration/restore", (Delegate)Execute);
    }
    private static async Task<IResult> Execute(HttpContext context)
    {
        if (!LocalDocxDocuments.Admitted(context)) return Results.StatusCode(403);
        if (context.Request.ContentType?.Split(';')[0].Trim() != "application/json") return Results.StatusCode(415);
        const int limit = 29 * 1024 * 1024;
        if (context.Request.ContentLength > limit) return Results.StatusCode(413);
        try
        {
            using var body = new MemoryStream(); var buffer = new byte[65536]; int read;
            while ((read = await context.Request.Body.ReadAsync(buffer, context.RequestAborted)) > 0)
            { if (body.Length + read > limit) return Results.StatusCode(413); body.Write(buffer, 0, read); }
            var request = JsonSerializer.Deserialize<Request>(body.ToArray(), new JsonSerializerOptions(JsonSerializerDefaults.Web))
                ?? throw new InvalidDataException("Missing document pair.");
            byte[] Decode(string encoded, string sha)
            {
                if (encoded is null || encoded.Length > 13981016) throw new InvalidDataException("Document exceeds 10 MiB.");
                var bytes = Convert.FromBase64String(encoded); LocalDocxDocuments.ValidatePackage(bytes);
                if (!string.Equals(Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), sha, StringComparison.Ordinal))
                    throw new InvalidDataException("Document pair binding changed.");
                return bytes;
            }
            var source = Decode(request.SourceBase64, request.SourceSha256); var draft = Decode(request.DraftBase64, request.DraftSha256);
            var result = DocxSourceRestoration.Restore(source, draft);
            return Results.Ok(new { documentBase64 = Convert.ToBase64String(result.Document), report = result.Report });
        }
        catch (Exception error) when (error is InvalidDataException or FormatException or JsonException or XmlException or ArgumentException)
        { return Results.BadRequest(new { error = "Restoration held: " + error.Message }); }
    }
}
