using System.Security.Cryptography;
using System.Text.Json;
using System.Xml;

namespace MedicalQcWebDemo;

internal static class LocalVisualAuditReview
{
    private static bool Enabled => Environment.GetEnvironmentVariable("MTQC_LOCAL_VISUAL_AUDIT") == "true";
    internal static void Map(WebApplication app)
    {
        var jobs = app.Services.GetRequiredService<LocalVisualAuditJobs>();
        app.MapGet("/api/local/docx/visual/status", (HttpContext context) =>
            !LocalDocxDocuments.Admitted(context) ? Results.StatusCode(403) : Results.Ok(Enabled ? jobs.Availability() :
                new { available = false, busy = false, message = "The dedicated local visual audit is disabled.",
                    fullOcrVerified = false, mathSemanticsVerified = false, fullRenderedLayoutVerified = false, mediaCoordinatesOnly = true }));
        app.MapPost("/api/local/docx/visual/jobs", (Delegate)((HttpContext context) => Submit(context, jobs)));
        app.MapGet("/api/local/docx/visual/jobs/{id}", (HttpContext context, string id) =>
            !Enabled ? Results.NotFound() : !LocalDocxDocuments.Admitted(context) ? Results.StatusCode(403) :
            jobs.Get(id) is { } view ? Results.Ok(view) : Results.NotFound());
        app.MapGet("/api/local/docx/visual/jobs/{id}/report", (HttpContext context, string id) =>
        {
            if (!Enabled) return (IResult)Results.NotFound();
            if (!LocalDocxDocuments.Admitted(context)) return Results.StatusCode(403);
            if (jobs.Get(id) is null) return Results.NotFound();
            return jobs.Report(id) is { } bytes
                ? Results.File(bytes, "application/json", "mtqc-visual-audit-report.json")
                : Results.Conflict(new { error = "This job has no immutable admitted report." });
        });
    }

    private static async Task<IResult> Submit(HttpContext context, LocalVisualAuditJobs jobs)
    {
        if (!Enabled) return Results.NotFound();
        if (!LocalDocxDocuments.Admitted(context)) return Results.StatusCode(403);
        if (!string.Equals(context.Request.ContentType?.Split(';')[0].Trim(), "application/json", StringComparison.OrdinalIgnoreCase))
            return Results.StatusCode(415);
        const int bound = 16 * 1024 * 1024;
        if (context.Request.ContentLength > bound) return Results.StatusCode(413);
        try
        {
            using var memory = new MemoryStream(); var buffer = new byte[65536]; int read;
            while ((read = await context.Request.Body.ReadAsync(buffer, context.RequestAborted)) != 0)
            {
                if (memory.Length + read > bound) return Results.StatusCode(413);
                memory.Write(buffer, 0, read);
            }
            using var document = JsonDocument.Parse(memory.ToArray());
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Missing saved-draft request.");
            var keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in root.EnumerateObject())
                if (!keys.Add(property.Name) || property.Name is not ("savedDraftBase64" or "draftSha256" or "targetLanguage") ||
                    property.Value.ValueKind != JsonValueKind.String)
                    throw new InvalidDataException("Unknown, duplicate or invalid request field.");
            if (keys.Count != 3) throw new InvalidDataException("All saved-draft fields are required.");
            var encoded = root.GetProperty("savedDraftBase64").GetString()!;
            var sha = root.GetProperty("draftSha256").GetString()!;
            var target = root.GetProperty("targetLanguage").GetString()!;
            if (encoded.Length > ((10 * 1024 * 1024 + 2) / 3) * 4 || !LocalVisualAuditJobs.ValidLanguage(target))
                throw new InvalidDataException("Saved draft or target language exceeds the local contract.");
            var bytes = Convert.FromBase64String(encoded);
            if (bytes.Length is <= 0 or > 10 * 1024 * 1024 || sha.Length != 64 || !sha.All(Uri.IsHexDigit) ||
                !string.Equals(sha, Convert.ToHexString(SHA256.HashData(bytes)), StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Saved draft SHA-256 binding differs.");
            // Existing safe package guard is reused; fields are read-only here, never executed by Word.
            LocalDocxDocuments.ValidatePackage(bytes);
            // Admitted ownership never receives RequestAborted.
            return Results.Json(jobs.Submit(bytes, sha, target), statusCode: 202);
        }
        catch (VisualAuditAdmissionException error) { return Results.Json(new { error = error.Message }, statusCode: error.StatusCode); }
        catch (Exception error) when (error is InvalidDataException or JsonException or FormatException or XmlException or ArgumentException or InvalidOperationException)
        { return Results.BadRequest(new { error = "Saved-DOCX audit held: " + error.Message }); }
    }
}
