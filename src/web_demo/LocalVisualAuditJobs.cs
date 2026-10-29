using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Hosting;

namespace MedicalQcWebDemo;

internal sealed class VisualAuditAdmissionException(int statusCode, string message) : Exception(message)
{
    internal int StatusCode { get; } = statusCode;
}

internal sealed record VisualAuditFinding(string Kind, string Part, string Locator, string Text, string Reason,
    double? X = null, double? Y = null, double? Width = null, double? Height = null);
internal sealed record VisualAuditView(string Id, string State, string DraftSha256, string TargetLanguage,
    string? EngineStatus, int? ExitCode, string? ReportSha256, VisualAuditFinding[] Findings,
    int EmbeddedMediaCount, int ReviewItemCount, int OcrEvidenceCount, int NoTextDetectedCount,
    int UnsupportedMediaCount, string? Capability, string[] Warnings,
    bool FullOcrVerified = false, bool MathSemanticsVerified = false,
    bool FullRenderedLayoutVerified = false, bool MediaCoordinatesOnly = true);

// Independent owner of the fixed, read-only audit CLI. It never owns Word or a provider.
internal sealed class LocalVisualAuditJobs : IHostedService
{
    private const int CaptureLimit = 16 * 1024 * 1024;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { PropertyNameCaseInsensitive = false };
    private static readonly HashSet<string> Languages = new(StringComparer.Ordinal)
        { "ko", "es", "ar", "zh-CN", "zh-TW", "ja", "fr", "de", "it", "pt", "ru", "hi", "id", "nl", "pl", "th", "tr", "vi" };
    private static readonly HashSet<string> OcrExtensions = new(StringComparer.OrdinalIgnoreCase)
        { ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff" };
    private static readonly HashSet<string> OtherExtensions = new(StringComparer.OrdinalIgnoreCase)
        { ".emf", ".wmf", ".svg", ".webp" };
    private static readonly HashSet<string> Unavailable = new(StringComparer.Ordinal)
        { "OCR_API_UNAVAILABLE", "OCR_LANGUAGE_UNAVAILABLE", "OCR_ENGINE_CREATION_FAILED", "OCR_LANGUAGE_MISMATCH", "OCR_CAPABILITY_PROBE_FAILED" };
    private readonly object sync = new();
    private readonly Dictionary<string, Job> jobs = new(StringComparer.Ordinal);
    private readonly TimeSpan observationLimit;
    private Task? active;
    private bool stopping;

    public LocalVisualAuditJobs() : this(TimeSpan.FromSeconds(120)) { }
    internal LocalVisualAuditJobs(TimeSpan observationLimit)
    {
        if (observationLimit <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(observationLimit));
        this.observationLimit = observationLimit;
    }
    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    public async Task StopAsync(CancellationToken cancellationToken)
    {
        Task? owned;
        lock (sync) { stopping = true; owned = active; }
        // Even an already-cancelled host token cannot abandon an admitted monitor.
        if (owned is not null) await owned.ConfigureAwait(false);
    }
    internal static bool ValidLanguage(string? language) => language is not null && Languages.Contains(language);

    internal object Availability()
    {
        try
        {
            var config = Configuration.Load();
            lock (sync)
            {
                var busy = stopping || active is { IsCompleted: false } || File.Exists(config.Lease);
                return new { available = !busy, busy, fullOcrVerified = false, mathSemanticsVerified = false,
                    fullRenderedLayoutVerified = false, mediaCoordinatesOnly = true,
                    message = busy ? "An active or unaudited job holds this runtime." : "Ready for an explicit saved-DOCX audit." };
            }
        }
        catch (Exception error)
        {
            return new { available = false, busy = false, fullOcrVerified = false, mathSemanticsVerified = false,
                fullRenderedLayoutVerified = false, mediaCoordinatesOnly = true, message = "Audit runtime held: " + error.Message };
        }
    }

    internal VisualAuditView Submit(byte[] draft, string sha, string target)
    {
        // Snapshot all caller-owned data before any background work or launch.
        draft = draft.ToArray();
        var digest = Hash(draft);
        if (draft.Length is <= 0 or > 10 * 1024 * 1024 || !DigestEquals(sha, digest) || !ValidLanguage(target))
            throw new VisualAuditAdmissionException(400, "Invalid saved draft binding or target language.");
        Inventory inventory;
        try { inventory = Inventory.Read(draft); }
        catch (Exception error) when (error is InvalidDataException or IOException or ArgumentException or OverflowException)
        { throw new VisualAuditAdmissionException(400, "Saved draft inventory held: " + error.Message); }
        if (inventory.Media.Values.Any(m => !m.Ocr && !OtherExtensions.Contains(m.Extension)))
            throw new VisualAuditAdmissionException(503, "Unknown embedded-media extension; audit held before launch.");
        lock (sync)
        {
            if (stopping || active is { IsCompleted: false }) throw new VisualAuditAdmissionException(409, "An audit is active or stopping.");
            Configuration config;
            try { config = Configuration.Load(); }
            catch (Exception error) { throw new VisualAuditAdmissionException(503, "Runtime held: " + error.Message); }
            if (File.Exists(config.Lease)) throw new VisualAuditAdmissionException(409, "Unknown or active lease; manual audit required.");
            var id = Guid.NewGuid().ToString("N");
            var job = new Job(id, config, digest, target, inventory);
            var leaseOwned = false;
            try
            {
                Directory.CreateDirectory(config.EvidenceRoot);
                Durable(config.Lease, JsonSerializer.SerializeToUtf8Bytes(new { token = id, directory = job.Directory, startedUtc = DateTime.UtcNow }, Json));
                leaseOwned = true;
                Directory.CreateDirectory(job.Directory);
                Durable(job.Draft, draft);
                Durable(Path.Combine(job.Directory, "job.json"), JsonSerializer.SerializeToUtf8Bytes(new
                {
                    id, draftSha256 = digest, targetLanguage = target, sourceLanguage = "en", config.ManifestSha,
                    observationSeconds = observationLimit.TotalSeconds, draftPath = job.Draft, reportPath = job.ReportPath,
                    media = inventory.Media.Values, embeddedObjectCount = inventory.Objects.Count,
                    fullOcrVerified = false, mathSemanticsVerified = false, fullRenderedLayoutVerified = false, mediaCoordinatesOnly = true
                }, Json));
                var start = new ProcessStartInfo(config.Host)
                {
                    UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
                    RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = job.Directory
                };
                foreach (var argument in new[] { config.Entry, "--audit-embedded-visual-text", job.Draft,
                    "--source", "en", "--target", target, "--visual-text-report", job.ReportPath }) start.ArgumentList.Add(argument);
                var process = Process.Start(start) ?? throw new IOException("Owned audit CLI did not start.");
                jobs.Add(id, job);
                // Stop cannot intervene between the direct launch and tracked observer assignment.
                active = Task.Run(() => Observe(job, process));
                return Snapshot(job.View);
            }
            catch (Exception error)
            {
                // Never overwrite/delete an unknown lease, or retry an uncertain launch.
                if (!leaseOwned && error is IOException && File.Exists(config.Lease))
                    throw new VisualAuditAdmissionException(409, "Another owner or an unknown lease holds this runtime.");
                throw new VisualAuditAdmissionException(503, "Launch held; retain evidence and lease for manual audit. " + error.Message);
            }
        }
    }
    internal VisualAuditView? Get(string id)
    { lock (sync) return jobs.TryGetValue(id, out var job) ? Snapshot(job.View) : null; }
    internal byte[]? Report(string id)
    { lock (sync) return jobs.TryGetValue(id, out var job) ? job.ReportBytes?.ToArray() : null; }
    private static VisualAuditView Snapshot(VisualAuditView view) => view with
        { Findings = view.Findings.ToArray(), Warnings = view.Warnings.ToArray() };

    private async Task Observe(Job job, Process process)
    {
        var custody = new Custody();
        var stdout = Capture(process.StandardOutput.BaseStream, Path.Combine(job.Directory, "stdout.raw"));
        var stderr = Capture(process.StandardError.BaseStream, Path.Combine(job.Directory, "stderr.raw"));
        var exited = ObserveExit(process, custody);
        var all = Task.WhenAll(exited, stdout, stderr);
        var timeout = await Task.WhenAny(all, Task.Delay(observationLimit)).ConfigureAwait(false) != all;
        if (timeout)
        {
            // The registered audit branch has no inner process or Word cleanup. Kill only this Process.
            try { if (!process.HasExited) process.Kill(); } catch { /* Exit/EOF observation decides custody below. */ }
            await Task.WhenAny(all, Task.Delay(TimeSpan.FromSeconds(5))).ConfigureAwait(false);
        }
        string? observationFailure = null;
        if (all.IsCompleted)
        {
            try { await all.ConfigureAwait(false); }
            catch (Exception error) { observationFailure = error.Message; }
        }
        var output = stdout.IsCompletedSuccessfully ? stdout.Result : null;
        var errorOutput = stderr.IsCompletedSuccessfully ? stderr.Result : null;
        var sourceUnchanged = SourceUnchanged(job);
        var safe = custody.ExitObserved && output is not null && errorOutput is not null && sourceUnchanged;
        var view = job.View with { State = "held", ExitCode = custody.ExitCode };
        byte[]? report = null;
        if (!safe || timeout || output?.Truncated == true || errorOutput?.Truncated == true)
        {
            view = view with { Warnings = [timeout ? "Owned audit deadline exceeded; no report admitted."
                : output?.Truncated == true || errorOutput?.Truncated == true ? "Raw capture exceeded its bound; no report admitted."
                : "Exit, raw EOF or source custody is uncertain. " + observationFailure] };
        }
        else
        {
            try { (view, report) = AdmitReport(job, custody.ExitCode!.Value); }
            catch (Exception failure)
            {
                view = view with { EngineStatus = job.ObservedEngineStatus, Warnings = ["Report held: " + failure.Message] };
            }
        }
        try
        {
            // Durable custody precedes lease release and public terminal state.
            Durable(Path.Combine(job.Directory, "terminal.json"), Receipt(job, view, custody, output, errorOutput, sourceUnchanged, !safe));
            if (safe) ReleaseOwnLease(job);
            lock (sync) { job.View = view; job.ReportBytes = report; }
        }
        catch (Exception failure)
        {
            view = view with { State = "held", ReportSha256 = null, Warnings = ["Evidence or lease release held: " + failure.Message] };
            // Append, never overwrite an earlier immutable terminal receipt.
            try
            {
                Durable(Path.Combine(job.Directory, "held.json"), Receipt(job, view, custody, output, errorOutput, sourceUnchanged, true));
                lock (sync) { job.View = view; job.ReportBytes = null; }
            }
            catch { /* No terminal publication without durable custody. The lease remains fail closed. */ }
        }
        if (!safe || !all.IsCompleted) _ = LateExit(job, process, custody, all, stdout, stderr);
        else process.Dispose();
    }

    private static async Task ObserveExit(Process process, Custody custody)
    {
        await process.WaitForExitAsync(CancellationToken.None).ConfigureAwait(false);
        custody.ExitCode = process.ExitCode; custody.ExitObserved = true;
    }
    private static async Task LateExit(Job job, Process process, Custody custody, Task all,
        Task<RawCapture> stdout, Task<RawCapture> stderr)
    {
        string? failure = null;
        try { await all.ConfigureAwait(false); } catch (Exception error) { failure = error.Message; }
        if (!custody.ExitObserved)
        {
            try { await ObserveExit(process, custody).ConfigureAwait(false); }
            catch (Exception error) { failure = (failure ?? "") + " Late exit observation: " + error.Message; }
        }
        try
        {
            Durable(Path.Combine(job.Directory, "late-exit.json"), JsonSerializer.SerializeToUtf8Bytes(new
            {
                state = "held", leaseRetained = true, custody.ExitCode, custody.ExitObserved,
                stdoutCompleted = stdout.IsCompletedSuccessfully, stderrCompleted = stderr.IsCompletedSuccessfully,
                stdout = stdout.IsCompletedSuccessfully ? stdout.Result : null,
                stderr = stderr.IsCompletedSuccessfully ? stderr.Result : null,
                sourceHashUnchanged = SourceUnchanged(job), failure, observedUtc = DateTime.UtcNow
            }, Json));
        }
        catch { /* Preserve the original held receipt and lease on late storage failure. */ }
        finally { process.Dispose(); }
    }
    private static byte[] Receipt(Job job, VisualAuditView view, Custody custody, RawCapture? stdout,
        RawCapture? stderr, bool sourceUnchanged, bool leaseRetained) => JsonSerializer.SerializeToUtf8Bytes(new
        {
            job.Id, custody.ExitCode, custody.ExitObserved, stdoutCompleted = stdout is not null,
            stderrCompleted = stderr is not null, sourceHashUnchanged = sourceUnchanged,
            leaseRetained, view, stdout, stderr, draftPath = job.Draft, reportPath = job.ReportPath,
            reportSha256 = view.ReportSha256, observedUtc = DateTime.UtcNow
        }, Json);
    private static async Task<RawCapture> Capture(Stream input, string path)
    {
        using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read, 65536, FileOptions.Asynchronous);
        var buffer = new byte[65536]; long total = 0; int read;
        while ((read = await input.ReadAsync(buffer, CancellationToken.None).ConfigureAwait(false)) != 0)
        {
            var keep = (int)Math.Min(read, Math.Max(0L, CaptureLimit - total));
            if (keep > 0) await output.WriteAsync(buffer.AsMemory(0, keep), CancellationToken.None).ConfigureAwait(false);
            total = checked(total + read); // Continue draining beyond the independent on-disk cap.
        }
        output.Flush(true);
        output.Dispose(); // Close the writer before reopening bytes for the immutable capture digest.
        return new RawCapture(total, Math.Min(total, CaptureLimit), total > CaptureLimit, Hash(File.ReadAllBytes(path)));
    }
    private static bool SourceUnchanged(Job job)
    { try { return DigestEquals(job.View.DraftSha256, Hash(File.ReadAllBytes(job.Draft))); } catch { return false; } }

    private static (VisualAuditView, byte[]) AdmitReport(Job job, int exit)
    {
        var bytes = ReadBounded(job.ReportPath, CaptureLimit);
        using var doc = StrictJson(bytes);
        var root = doc.RootElement;
        // Retain observed engine status even when later binding checks reject the report.
        job.ObservedEngineStatus = Text(root, "status");
        if (Count(root, "schema_version") != 2 || Text(root, "ocr_engine") != "Windows.Media.Ocr" ||
            Text(root, "ocr_contract") != "windows-media-ocr-v1" || Text(root, "source_language") != "en" ||
            Text(root, "target_language") != job.View.TargetLanguage)
            throw new InvalidDataException("Engine schema or captured language binding differs.");
        var document = root.GetProperty("document");
        if (!SamePath(Text(document, "path"), job.Draft) || !DigestEquals(Text(document, "sha256"), job.View.DraftSha256) || !SourceUnchanged(job))
            throw new InvalidDataException("Report document is not the immutable saved draft.");
        var mediaCount = Count(root, "embedded_media_count");
        var objects = Count(root, "embedded_object_count");
        var reviewCount = Count(root, "review_item_count");
        var reviews = root.GetProperty("review_items"); var evidence = root.GetProperty("ocr_evidence");
        if (reviews.ValueKind != JsonValueKind.Array || evidence.ValueKind != JsonValueKind.Array ||
            reviewCount != reviews.GetArrayLength() || mediaCount != job.Inventory.Media.Count || objects != job.Inventory.Objects.Count)
            throw new InvalidDataException("Report counts do not cover the exact package inventory.");
        var status = job.ObservedEngineStatus;
        var blocked = root.GetProperty("publication_blocked").GetBoolean();
        if (!(status == "PASS" && exit == 0 && !blocked && reviewCount == 0 ||
            status == "VISUAL_TEXT_REVIEW_REQUIRED" && exit == 2 && blocked && reviewCount > 0))
            throw new InvalidDataException("Status, exit code and review count conflict.");
        var capability = root.GetProperty("ocr_capability");
        var capStatus = Text(capability, "status"); var available = capability.GetProperty("available").GetBoolean();
        var requested = Text(capability, "requested_language"); var resolved = Text(capability, "resolved_language");
        _ = Text(capability, "message");
        if (requested != "en-US" || (available ? capStatus != "AVAILABLE" || resolved != "en-US" : !Unavailable.Contains(capStatus)))
            throw new InvalidDataException("OCR capability language/status is inconsistent.");
        var seenEvidence = new Dictionary<string, Evidence>(StringComparer.Ordinal);
        var noText = 0;
        foreach (var entry in evidence.EnumerateArray())
        {
            var part = Text(entry, "part");
            if (!available || !job.Inventory.Media.TryGetValue(part, out var medium) || !medium.Ocr || seenEvidence.ContainsKey(part) ||
                !DigestEquals(Text(entry, "media_sha256"), medium.Sha256) || Count64(entry, "encoded_bytes") != medium.EncodedBytes ||
                Text(entry, "requested_language") != "en-US" || Text(entry, "resolved_language") != "en-US")
                throw new InvalidDataException("OCR evidence is duplicate, unrecognized or not media-bound.");
            var width = Count(entry, "pixel_width"); var height = Count(entry, "pixel_height"); var lines = Count(entry, "line_count");
            var evStatus = Text(entry, "status");
            if (width <= 0 || height <= 0 || !(lines == 0 && evStatus == "NO_TEXT_DETECTED" || lines > 0 && evStatus == "TEXT_DETECTED"))
                throw new InvalidDataException("OCR pixel size, line count or evidence status is invalid.");
            if (lines == 0) noText++;
            seenEvidence.Add(part, new Evidence(width, height, lines));
        }
        var coverage = new HashSet<string>(StringComparer.Ordinal);
        var lineFindings = new Dictionary<string, int>(StringComparer.Ordinal);
        var findings = new List<VisualAuditFinding>(); var unsupported = 0;
        foreach (var item in reviews.EnumerateArray())
        {
            var kind = Text(item, "kind"); var part = Text(item, "part"); var locator = Text(item, "locator");
            var text = Text(item, "text"); var reason = Text(item, "reason");
            if (locator.Length == 0 || kind == "document_changed") throw new InvalidDataException("Changed document or missing finding locator.");
            double? x = null, y = null, width = null, height = null;
            if (kind == "embedded_media_ocr")
            {
                if (reason != "OCR_TRANSLATION_AND_OVERLAY_REQUIRED" || !seenEvidence.TryGetValue(part, out var ev))
                    throw new InvalidDataException("OCR finding has no matching evidence.");
                x = Coordinate(item, "x", false); y = Coordinate(item, "y", false);
                width = Coordinate(item, "width", true); height = Coordinate(item, "height", true);
                if (x.Value + width.Value > ev.Width || y.Value + height.Value > ev.Height || text.Length == 0)
                    throw new InvalidDataException("OCR finding falls outside the image.");
                lineFindings.TryGetValue(part, out var count); lineFindings[part] = count + 1;
                if (count + 1 > ev.Lines) throw new InvalidDataException("More OCR findings than evidence lines.");
            }
            else if (kind == "embedded_media")
            {
                if (!job.Inventory.Media.TryGetValue(part, out var medium) || locator != part || text != "" ||
                    seenEvidence.ContainsKey(part) || !coverage.Add(part))
                    throw new InvalidDataException("Media coverage is duplicate, conflicting or unbound.");
                if (!medium.Ocr)
                {
                    if (reason != "UNSUPPORTED_MEDIA_OCR_REVIEW_REQUIRED") throw new InvalidDataException("Unsupported medium lacks exact finding.");
                    unsupported++;
                }
                else if (!(available && Regex.IsMatch(reason, "\\AWINDOWS_OCR_FAILED:[A-Za-z_][A-Za-z0-9_]*\\z") ||
                    !available && reason == capStatus)) throw new InvalidDataException("Unrecognized per-media OCR failure.");
                NoCoordinates(item);
            }
            else if (kind == "embedded_object")
            {
                if (!job.Inventory.Objects.Contains(part) || locator != part || reason != "EMBEDDED_OBJECT_TEXT_REVIEW_REQUIRED")
                    throw new InvalidDataException("Object finding is unbound.");
                NoCoordinates(item);
            }
            else
            {
                if (!job.Inventory.WordXml.Contains(part) || !XmlReason(kind, reason, part))
                    throw new InvalidDataException("Unknown or unbound XML finding.");
                NoCoordinates(item);
            }
            findings.Add(new VisualAuditFinding(kind, part, locator, text, reason, x, y, width, height));
        }
        if (job.Inventory.Media.Keys.Any(part => !seenEvidence.ContainsKey(part) && !coverage.Contains(part)))
            throw new InvalidDataException("At least one embedded medium has no evidence or exact failure finding.");
        var warnings = new List<string>
        {
            "Finite source-language visual-text audit only; source policy is asymmetric and absence of findings is not translation completion.",
            "Coordinates are embedded-image pixels. OCR does not verify math semantics or full rendered Word layout."
        };
        if (noText > 0) warnings.Add("NO_TEXT_DETECTED is an OCR limitation; it does not verify that the image contains no text.");
        if (mediaCount == 0) warnings.Add("No embedded media: PASS describes this report only, not whole-document restoration.");
        if (!available) warnings.Add("OCR capability unavailable: immutable diagnostic report only; review remains held.");
        return (job.View with
        {
            State = available ? "completed" : "held", EngineStatus = status, ExitCode = exit, ReportSha256 = Hash(bytes),
            Findings = findings.ToArray(), EmbeddedMediaCount = mediaCount, ReviewItemCount = reviewCount,
            OcrEvidenceCount = seenEvidence.Count, NoTextDetectedCount = noText, UnsupportedMediaCount = unsupported,
            Capability = capStatus, Warnings = warnings.ToArray()
        }, bytes);
    }

    private static bool XmlReason(string kind, string reason, string part) => kind switch
    {
        "drawing_text" => reason == "UNTRANSLATED_DRAWINGML_TEXT",
        "wordart_text" => reason == "UNTRANSLATED_WORDART_TEXT",
        "visual_metadata" => reason == "UNTRANSLATED_ALT_OR_TITLE_TEXT",
        "chart_or_smartart" => reason == "CHART_OR_SMARTART_SEMANTIC_REVIEW_REQUIRED" &&
            (part.StartsWith("word/charts/", StringComparison.OrdinalIgnoreCase) || part.StartsWith("word/diagrams/", StringComparison.OrdinalIgnoreCase)),
        "xml_parse" => Regex.IsMatch(reason, "\\AVISUAL_TEXT_XML_PARSE_FAILED:[A-Za-z_][A-Za-z0-9_]*\\z"),
        _ => false
    };
    private static void NoCoordinates(JsonElement item)
    {
        foreach (var name in new[] { "x", "y", "width", "height" })
            if (item.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null)
                throw new InvalidDataException("Non-OCR finding has image coordinates.");
    }
    private static double Coordinate(JsonElement element, string key, bool positive)
    {
        var value = element.GetProperty(key).GetDouble();
        if (!double.IsFinite(value) || (positive ? value <= 0 : value < 0)) throw new InvalidDataException("Invalid finite image coordinate.");
        return value;
    }
    private static int Count(JsonElement element, string key)
    { var value = element.GetProperty(key).GetInt32(); if (value < 0) throw new InvalidDataException("Negative report count."); return value; }
    private static long Count64(JsonElement element, string key)
    { var value = element.GetProperty(key).GetInt64(); if (value < 0) throw new InvalidDataException("Negative report count."); return value; }
    private static string Text(JsonElement element, string key) => element.GetProperty(key).GetString() ?? throw new InvalidDataException("Missing report text.");
    private static JsonDocument StrictJson(byte[] bytes)
    {
        var doc = JsonDocument.Parse(bytes);
        try { UniqueKeys(doc.RootElement); return doc; } catch { doc.Dispose(); throw; }
    }
    private static void UniqueKeys(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in value.EnumerateObject())
            { if (!keys.Add(property.Name)) throw new InvalidDataException("Duplicate JSON key."); UniqueKeys(property.Value); }
        }
        else if (value.ValueKind == JsonValueKind.Array) foreach (var item in value.EnumerateArray()) UniqueKeys(item);
    }
    private static byte[] ReadBounded(string path, int bound)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length <= 0 || stream.Length > bound) throw new InvalidDataException("File exceeds its custody bound.");
        var bytes = new byte[(int)stream.Length]; stream.ReadExactly(bytes);
        if (stream.ReadByte() != -1) throw new InvalidDataException("File changed during read.");
        return bytes;
    }
    private static void ReleaseOwnLease(Job job)
    {
        using var lease = StrictJson(ReadBounded(job.Config.Lease, 1024 * 1024));
        if (Text(lease.RootElement, "token") != job.Id) throw new IOException("Lease owner changed.");
        File.Delete(job.Config.Lease);
    }
    private static bool SamePath(string? a, string b) => a is not null && Path.IsPathFullyQualified(a) &&
        string.Equals(Path.GetFullPath(a), Path.GetFullPath(b), StringComparison.OrdinalIgnoreCase);
    private static bool DigestEquals(string? a, string b) => a is not null && Regex.IsMatch(a, "\\A[0-9a-fA-F]{64}\\z") &&
        string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static void Durable(string path, byte[] bytes)
    {
        using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
        file.Write(bytes); file.Flush(true);
    }
    private sealed record RawCapture(long TotalBytes, long RetainedBytes, bool Truncated, string Sha256);
    private sealed class Custody { internal volatile bool ExitObserved; internal int? ExitCode; }
    private sealed record Evidence(int Width, int Height, int Lines);
    private sealed record Medium(string Part, string Sha256, long EncodedBytes, string Extension, bool Ocr);
    private sealed class Inventory
    {
        internal Dictionary<string, Medium> Media { get; } = new(StringComparer.Ordinal);
        internal HashSet<string> WordXml { get; } = new(StringComparer.Ordinal);
        internal HashSet<string> Objects { get; } = new(StringComparer.Ordinal);
        internal static Inventory Read(byte[] bytes)
        {
            var result = new Inventory();
            using var zip = new ZipArchive(new MemoryStream(bytes, false), ZipArchiveMode.Read);
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            const long packageLimit = 48 * 1024 * 1024;
            long total = 0, actualTotal = 0;
            var buffer = new byte[65536];
            if (zip.Entries.Count > 512) throw new InvalidDataException("Too many package entries.");
            foreach (var entry in zip.Entries)
            {
                if (!names.Add(entry.FullName) || entry.FullName.StartsWith('/') || entry.FullName.Contains('\\') ||
                    entry.FullName.Split('/').Any(p => p is "." or "..")) throw new InvalidDataException("Ambiguous package part.");
                total = checked(total + entry.Length);
                if (total > packageLimit) throw new InvalidDataException("Expanded package too large.");
                var part = entry.FullName;
                var isMedia = entry.Name.Length != 0 && part.StartsWith("word/media/", StringComparison.OrdinalIgnoreCase);
                using var retained = isMedia ? new MemoryStream() : null;
                using (var input = entry.Open())
                {
                    long actualEntry = 0; int read;
                    while ((read = input.Read(buffer, 0, buffer.Length)) != 0)
                    {
                        // Stored streams can exceed header Length. Check actual bytes before retention.
                        if (read > entry.Length - actualEntry || read > packageLimit - actualTotal)
                            throw new InvalidDataException("Actual package bytes exceed their declared or aggregate bound.");
                        actualEntry += read; actualTotal += read;
                        retained?.Write(buffer, 0, read);
                    }
                    if (actualEntry != entry.Length) throw new InvalidDataException("Package entry length differs from actual streamed bytes.");
                }
                if (entry.Name.Length == 0) continue;
                if (isMedia)
                {
                    var encoded = retained!.ToArray(); var extension = Path.GetExtension(part);
                    result.Media.Add(part, new Medium(part, Hash(encoded), encoded.LongLength, extension, OcrExtensions.Contains(extension)));
                }
                if (part.StartsWith("word/embeddings/", StringComparison.OrdinalIgnoreCase)) result.Objects.Add(part);
                if (part.StartsWith("word/", StringComparison.OrdinalIgnoreCase) && part.EndsWith(".xml", StringComparison.OrdinalIgnoreCase)) result.WordXml.Add(part);
            }
            return result;
        }
    }
    private sealed class Job(string id, Configuration config, string sha, string target, Inventory inventory)
    {
        internal string Id { get; } = id;
        internal Configuration Config { get; } = config;
        internal string Directory => Path.Combine(Config.EvidenceRoot, Id);
        internal string Draft => Path.Combine(Directory, "draft.docx");
        internal string ReportPath => Path.Combine(Directory, "report.json");
        internal Inventory Inventory { get; } = inventory;
        internal VisualAuditView View = new(id, "running", sha, target, null, null, null, [], inventory.Media.Count, 0, 0, 0, 0, null, []);
        internal byte[]? ReportBytes;
        internal string? ObservedEngineStatus;
    }
    private sealed record Configuration(string Contract, string Host, string Entry, Dictionary<string, string> Pins,
        string EvidenceRoot, Dictionary<string, string> SourcePins)
    {
        internal string ManifestSha { get; private set; } = "";
        internal string Lease => Path.Combine(EvidenceRoot, "active.json");
        private static readonly Dictionary<string, string> RequiredSources = new(StringComparer.Ordinal)
        {
            ["Program.cs"] = "07f9ae063e826c5432629004cfd72fa4f96e5d7e16113f3d41168b1821becc33",
            ["EmbeddedVisualTextAudit.cs"] = "301f6bad35f4ba89475714d66efc03af45fc69318359f6793903b6ed00db450d",
            ["WindowsOcrCore.cs"] = "52f0c889b8df16e5772dd7049cbba8afb4872e1094a7fa2e2711f7c49e542129"
        };
        internal static Configuration Load()
        {
            var path = Environment.GetEnvironmentVariable("MTQC_VISUAL_AUDIT_MANIFEST") ?? "";
            var expected = Environment.GetEnvironmentVariable("MTQC_VISUAL_AUDIT_MANIFEST_SHA256") ?? "";
            if (!Path.IsPathFullyQualified(path)) throw new InvalidDataException("An absolute registered runtime manifest is required.");
            var bytes = ReadBounded(path, 1024 * 1024);
            if (!DigestEquals(expected, Hash(bytes))) throw new InvalidDataException("Runtime manifest hash differs.");
            using var document = StrictJson(bytes);
            var config = JsonSerializer.Deserialize<Configuration>(bytes, Json) ?? throw new InvalidDataException("Runtime manifest missing.");
            if (config.Contract != "mtqc-local-visual-audit-runtime-v1" || !Path.IsPathFullyQualified(config.Host) ||
                !Path.IsPathFullyQualified(config.Entry) || !Path.IsPathFullyQualified(config.EvidenceRoot) ||
                config.Pins is null || !config.Pins.ContainsKey(config.Host) || !config.Pins.ContainsKey(config.Entry) || config.SourcePins is null)
                throw new InvalidDataException("Runtime contract, host, entry or evidence root invalid.");
            foreach (var pin in config.Pins.Concat(config.SourcePins))
                if (!Path.IsPathFullyQualified(pin.Key) || !DigestEquals(pin.Value, Hash(File.ReadAllBytes(pin.Key))))
                    throw new InvalidDataException("Registered dependency or engine source changed.");
            foreach (var source in RequiredSources)
            {
                var matches = config.SourcePins.Where(p => Path.GetFileName(p.Key) == source.Key).ToArray();
                if (matches.Length != 1 || !DigestEquals(matches[0].Value, source.Value))
                    throw new InvalidDataException("Required unchanged engine source pin missing or different.");
            }
            config.ManifestSha = Hash(bytes);
            return config;
        }
    }
}
