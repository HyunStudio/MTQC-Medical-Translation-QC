using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MedicalQcWebDemo;

internal sealed class LayoutAdmissionException(int statusCode, string message) : Exception(message)
{
    internal int StatusCode { get; } = statusCode;
}

internal sealed record LayoutJobView(string Id, string State, string SourceSha256, string TargetSha256,
    string? EngineStatus, int? ExitCode, string[] Issues, string[] Warnings, string? ReportSha256,
    string? WordVersion, bool LimitedComparison = true, bool FullRenderedLayoutVerified = false,
    string ReviewMode = "strict", string? PdfSha256 = null);

// Owns the outer CLI, never Word COM. A disconnected HTTP request cannot cancel its observation or captures.
internal sealed class LocalWordLayoutJobs : IHostedService
{
    private const string GateSource = "1c6f92fcaf347a4d539a71c91e6781bd03743945cc37176d8f57ddcd106225ea";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly object sync = new();
    private readonly Func<bool> wordPresent;
    private readonly TimeSpan observationLimit;
    private readonly Dictionary<string, Job> jobs = new(StringComparer.Ordinal);
    private Task? active;
    private bool stopping;

    public LocalWordLayoutJobs() : this(AnyWord, TimeSpan.FromSeconds(720)) { }
    internal LocalWordLayoutJobs(Func<bool> wordPresent, TimeSpan observationLimit)
    {
        if (observationLimit <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(observationLimit));
        this.wordPresent = wordPresent;
        this.observationLimit = observationLimit;
    }

    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    public async Task StopAsync(CancellationToken cancellationToken)
    {
        Task? current;
        lock (sync) { stopping = true; current = active; }
        // The host's token can expire before the CLI finishes its inner ownership cleanup.
        if (current is not null) await current.ConfigureAwait(false);
    }

    internal object Availability(bool natural = false)
    {
        try
        {
            var config = Configuration.Load(natural);
            lock (sync)
            {
                var busy = stopping || active is { IsCompleted: false } || File.Exists(config.Lease);
                return new { available = !busy, busy, limitedComparison = true,
                    fullRenderedLayoutVerified = false, reviewMode = natural ? "natural" : "strict",
                    message = busy ? "An active or unaudited job holds this runtime." : natural ? "Ready for explicit natural-flow review. Findings remain review-required." : "Ready for an explicit comparison." };
            }
        }
        catch (Exception error)
        {
            return new { available = false, busy = false, limitedComparison = true,
                fullRenderedLayoutVerified = false, message = "Word comparison held: " + error.Message };
        }
    }

    internal LayoutJobView Submit(byte[] source, byte[] target, string sourceSha, string targetSha, bool natural = false)
    {
        // Copy before background work; callers cannot replace an admitted pair while the CLI is running.
        source = source.ToArray(); target = target.ToArray();
        if (!DigestEquals(sourceSha, Hash(source)) || !DigestEquals(targetSha, Hash(target)))
            throw new LayoutAdmissionException(400, "Document pair binding changed.");
        lock (sync)
        {
            if (stopping || active is { IsCompleted: false }) throw new LayoutAdmissionException(409, "A comparison is already active or stopping.");
            Configuration config;
            try { config = Configuration.Load(natural); }
            catch (Exception error) { throw new LayoutAdmissionException(503, "Runtime held: " + error.Message); }
            if (File.Exists(config.Lease)) throw new LayoutAdmissionException(409, "An active or unaudited job holds this runtime. Manual audit is required.");
            try
            {
                if (wordPresent()) throw new LayoutAdmissionException(409, "Save and close existing Word sessions before starting this comparison.");
            }
            catch (LayoutAdmissionException) { throw; }
            catch (Exception error) { throw new LayoutAdmissionException(503, "Word inventory is unknown: " + error.Message); }

            var id = Guid.NewGuid().ToString("N");
            var directory = Path.Combine(config.EvidenceRoot, id);
            var job = new Job(id, directory, config, Hash(source), Hash(target));
            try
            {
                Directory.CreateDirectory(config.EvidenceRoot);
                Durable(config.Lease, JsonSerializer.SerializeToUtf8Bytes(new { token = id, startedUtc = DateTime.UtcNow }), createNew: true);
                Directory.CreateDirectory(directory);
                Durable(job.Source, source, createNew: true); Durable(job.Target, target, createNew: true);
                Durable(Path.Combine(directory, "job.json"), JsonSerializer.SerializeToUtf8Bytes(new
                {
                    id, sourceSha256 = job.View.SourceSha256, targetSha256 = job.View.TargetSha256,
                    manifestSha256 = config.ManifestSha, gateSourceSha256 = natural ? null : GateSource,
                    reviewMode = natural ? "natural" : "strict", inspectorSha256 = config.Flow?.InspectorSha256,
                    hardSeconds = 600, stallSeconds = 120, observationSeconds = observationLimit.TotalSeconds,
                    limitedComparison = true, fullRenderedLayoutVerified = false
                }, Json), createNew: true);
                var start = new ProcessStartInfo(config.Host)
                {
                    UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
                    RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = directory
                };
                var arguments = config.Flow is { } flow
                    ? new[] { config.Entry, "--render-review-natural-flow-docx", job.Target,
                        "--natural-flow-pdf", job.Pdf, "--natural-flow-report", job.ReportPath,
                        "--natural-flow-python", flow.Python }
                    : new[] { config.Entry, "--verify-word-layout-isolated", job.Source,
                    "--layout-target", job.Target, "--layout-gate-report", job.ReportPath,
                    "--word-layout-timeout-seconds", "600", "--word-layout-stall-seconds", "120" };
                if (natural)
                    foreach (var key in start.Environment.Keys.Where(k => new[] { "MTQC_", "DEMO_", "NEBIUS_", "OPENAI_", "AZURE_", "ANTHROPIC_" }
                        .Any(prefix => k.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))).ToArray()) start.Environment.Remove(key);
                foreach (var argument in arguments)
                    start.ArgumentList.Add(argument);
                var process = Process.Start(start) ?? throw new IOException("CLI did not start.");
                job.Pid = process.Id; job.LaunchObservedUtc = DateTime.UtcNow;
                jobs.Add(id, job);
                // Launch and tracked-task assignment share the StopAsync lock.
                active = Task.Run(() => Observe(job, process));
                return job.View;
            }
            catch (Exception error)
            {
                // A failure after taking the lease is uncertain; never automatically clear it or retry.
                throw new LayoutAdmissionException(503, "Comparison launch held; retained evidence requires manual audit. " + error.Message);
            }
        }
    }

    internal LayoutJobView? Get(string id) { lock (sync) return jobs.TryGetValue(id, out var job) ? job.View : null; }
    internal byte[]? Report(string id) { lock (sync) return jobs.TryGetValue(id, out var job) ? job.ReportBytes?.ToArray() : null; }
    internal byte[]? RenderedPdf(string id)
    {
        lock (sync)
        {
            if (!jobs.TryGetValue(id, out var job) || job.Config.Flow is null || job.ReportBytes is null || job.View.PdfSha256 is null) return null;
            using var stream = new FileStream(job.Pdf, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (stream.Length is <= 0 or > 100 * 1024 * 1024) return null;
            var bytes = new byte[(int)stream.Length]; stream.ReadExactly(bytes);
            return stream.ReadByte() == -1 && DigestEquals(job.View.PdfSha256, Hash(bytes)) ? bytes : null;
        }
    }

    private async Task Observe(Job job, Process process)
    {
        var output = Capture(process.StandardOutput.BaseStream, Path.Combine(job.Directory, "stdout.raw"));
        var error = Capture(process.StandardError.BaseStream, Path.Combine(job.Directory, "stderr.raw"));
        var completed = Finish(job, process, output, error);
        if (await Task.WhenAny(completed, Task.Delay(observationLimit)).ConfigureAwait(false) == completed)
        {
            try
            {
                var result = await completed.ConfigureAwait(false);
                Durable(Path.Combine(job.Directory, "terminal.json"), JsonSerializer.SerializeToUtf8Bytes(result.View, Json), true);
                ReleaseOwnLease(job);
                lock (sync) { job.View = result.View; job.ReportBytes = result.Report; }
            }
            catch (Exception failure) { Hold(job, "Observation or evidence custody is uncertain: " + failure.Message); }
            finally { process.Dispose(); }
            return;
        }
        Hold(job, "Observation deadline exceeded. No process was killed. The lease requires manual audit.");
        // Preserve eventual exit/captures without upgrading HELD or clearing its lease.
        // Keep the retained CLI/captures in the hosted owner's active task. Shutdown
        // drains their eventual exit without upgrading HELD or releasing its lease.
        await LateExit(job, process, completed).ConfigureAwait(false);
    }

    private async Task LateExit(Job job, Process process, Task<Result> completed)
    {
        try
        {
            var result = await completed.ConfigureAwait(false);
            Durable(Path.Combine(job.Directory, "late-exit.json"), JsonSerializer.SerializeToUtf8Bytes(new
            { result.View.ExitCode, observedUtc = DateTime.UtcNow, state = "held", leaseRetained = true }, Json), true);
        }
        catch (Exception failure)
        {
            try { Durable(Path.Combine(job.Directory, "late-exit.json"), JsonSerializer.SerializeToUtf8Bytes(new
                { exitCode = (int?)null, state = "held", error = failure.Message, leaseRetained = true }, Json), true); } catch { }
        }
        finally { process.Dispose(); }
    }

    private async Task<Result> Finish(Job job, Process process, Task output, Task error)
    {
        await process.WaitForExitAsync(CancellationToken.None).ConfigureAwait(false);
        var exit = process.ExitCode;
        await Task.WhenAll(output, error).ConfigureAwait(false);
        Durable(Path.Combine(job.Directory, "exit.json"), JsonSerializer.SerializeToUtf8Bytes(new
        { exitCode = exit, pid = job.Pid, launchObservedUtc = job.LaunchObservedUtc, observedUtc = DateTime.UtcNow, stdoutSha256 = Hash(File.ReadAllBytes(Path.Combine(job.Directory, "stdout.raw"))),
            stderrSha256 = Hash(File.ReadAllBytes(Path.Combine(job.Directory, "stderr.raw"))) }, Json), true);
        if (!DigestEquals(job.View.SourceSha256, Hash(File.ReadAllBytes(job.Source))) ||
            !DigestEquals(job.View.TargetSha256, Hash(File.ReadAllBytes(job.Target)))) throw new IOException("Staged inputs changed.");
        for (var attempt = 0; ; attempt++)
        {
            if (!wordPresent()) break;
            if (attempt == 50) throw new IOException("Word remains present after CLI exit; ownership is unknown.");
            await Task.Delay(100).ConfigureAwait(false);
        }
        try { return AdmitReport(job, exit); }
        catch (Exception failure)
        {
            if (job.Config.Flow is not null) throw new InvalidDataException("Natural-flow report custody is uncertain; lease retained.", failure);
            return new Result(job.View with { State = "held", ExitCode = exit,
                Warnings = ["Report held: " + failure.Message] }, null);
        }
    }

    private static Result AdmitReport(Job job, int exit)
    {
        using var stream = new FileStream(job.ReportPath, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length is <= 0 or > 16 * 1024 * 1024) throw new InvalidDataException("Report size is outside the local bound.");
        var bytes = new byte[(int)stream.Length]; stream.ReadExactly(bytes);
        if (stream.ReadByte() != -1) throw new InvalidDataException("Report changed during read.");
        using var document = JsonDocument.Parse(bytes);
        var root = document.RootElement;
        if (job.Config.Flow is { } flow)
        {
            var admitted = flow.Admit(root, exit, job.Target, job.Pdf, Path.ChangeExtension(job.Pdf, ".render.json"));
            return new Result(job.View with { State = "completed", EngineStatus = admitted.Status, ExitCode = exit,
                Issues = admitted.Findings, Warnings = ["Rectangle intersections require review; they do not prove visible occlusion. No findings is not acceptance. Glyph ink, vector art, clipping, transparency, order, fonts, OCR and math/clinical correctness remain unverified."],
                ReportSha256 = Hash(bytes), PdfSha256 = root.GetProperty("inputs")[1].GetProperty("sha256").GetString() }, bytes);
        }
        if (root.GetProperty("schema_version").GetInt32() != 1 ||
            !SamePath(root.GetProperty("source_docx").GetString(), job.Source) ||
            !SamePath(root.GetProperty("translated_docx").GetString(), job.Target) ||
            !DigestEquals(root.GetProperty("source_docx_sha256").GetString(), job.View.SourceSha256) ||
            !DigestEquals(root.GetProperty("translated_docx_sha256").GetString(), job.View.TargetSha256))
            throw new InvalidDataException("Report is not bound to this exact document pair.");
        var policy = root.GetProperty("timeout_policy");
        if (policy.GetProperty("contract").GetString() != "word-layout-timeout-policy-v2" ||
            policy.GetProperty("hard_timeout_seconds").GetInt32() != 600 || policy.GetProperty("stall_timeout_seconds").GetInt32() != 120 ||
            !root.GetProperty("timeout_telemetry").GetProperty("input_hashes_unchanged").GetBoolean())
            throw new InvalidDataException("Report policy or input telemetry is not bound.");
        var status = root.GetProperty("status").GetString();
        var blocked = root.GetProperty("publication_blocked").GetBoolean();
        var issues = Strings(root.GetProperty("issues")); var warnings = Strings(root.GetProperty("warnings"));
        var version = root.GetProperty("word_version").GetString();
        if (status == "TIMEOUT" && blocked && exit != 0)
            return new Result(job.View with { State = "held", EngineStatus = status, ExitCode = exit, Issues = issues,
                Warnings = warnings, WordVersion = version, ReportSha256 = Hash(bytes) }, bytes);
        if (string.IsNullOrWhiteSpace(version) || !Snapshot(root.GetProperty("source")) || !Snapshot(root.GetProperty("translated")) ||
            !(status == "PASS" && exit == 0 && !blocked && issues.Length == 0 || status == "BLOCKED" && exit != 0 && blocked && issues.Length > 0))
            throw new InvalidDataException("Status, process exit and snapshot evidence do not agree.");
        return new Result(job.View with { State = "completed", EngineStatus = status, ExitCode = exit, Issues = issues,
            Warnings = warnings, WordVersion = version, ReportSha256 = Hash(bytes) }, bytes);
    }

    private void Hold(Job job, string reason)
    {
        var view = job.View with { State = "held", Warnings = [reason] };
        try
        {
            var terminal = Path.Combine(job.Directory, "terminal.json");
            // Preserve a prior observed result if lease release failed, and append the authoritative hold.
            Durable(File.Exists(terminal) ? Path.Combine(job.Directory, "held.json") : terminal,
                JsonSerializer.SerializeToUtf8Bytes(view, Json), true);
        }
        catch { /* Published HELD and the retained lease still prevent automatic reuse if storage failed. */ }
        lock (sync) job.View = view;
    }
    private static async Task Capture(Stream input, string path)
    {
        using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read, 65536, FileOptions.Asynchronous);
        await input.CopyToAsync(output, CancellationToken.None).ConfigureAwait(false); output.Flush(true);
    }
    private static bool AnyWord()
    {
        var processes = Process.GetProcessesByName("WINWORD");
        try { return processes.Length != 0; } finally { foreach (var process in processes) process.Dispose(); }
    }
    private static void ReleaseOwnLease(Job job)
    {
        using var lease = JsonDocument.Parse(File.ReadAllBytes(job.Config.Lease));
        if (lease.RootElement.GetProperty("token").GetString() != job.Id) throw new IOException("Lease owner changed.");
        File.Delete(job.Config.Lease);
    }
    private static bool Snapshot(JsonElement value) => value.ValueKind == JsonValueKind.Object &&
        new[] { "pages", "sections", "paragraphs" }.All(p => value.GetProperty(p).GetInt32() > 0) &&
        new[] { "tables", "inline_shapes", "shapes" }.All(p => value.GetProperty(p).GetInt32() >= 0);
    private static string[] Strings(JsonElement value) => value.EnumerateArray().Select(v => v.GetString() ?? throw new InvalidDataException("Invalid report text.")).ToArray();
    private static bool SamePath(string? a, string b) => a is not null && Path.IsPathFullyQualified(a) && string.Equals(Path.GetFullPath(a), Path.GetFullPath(b), StringComparison.OrdinalIgnoreCase);
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static bool DigestEquals(string? a, string b) => a is not null && Regex.IsMatch(a, "\\A[0-9a-fA-F]{64}\\z") && string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    private static void Durable(string path, byte[] bytes, bool createNew)
    {
        using var file = new FileStream(path, createNew ? FileMode.CreateNew : FileMode.Create, FileAccess.Write, FileShare.Read);
        file.Write(bytes); file.Flush(true);
    }

    private sealed record Result(LayoutJobView View, byte[]? Report);
    private sealed class Job(string id, string directory, Configuration config, string sourceSha, string targetSha)
    {
        internal string Id { get; } = id;
        internal string Directory { get; } = directory;
        internal Configuration Config { get; } = config;
        internal string Source => Path.Combine(Directory, "source.docx");
        internal string Target => Path.Combine(Directory, "draft.docx");
        internal string ReportPath => Path.Combine(Directory, "report.json");
        internal string Pdf => Path.Combine(Directory, "draft.pdf");
        internal int Pid;
        internal DateTime LaunchObservedUtc;
        internal LayoutJobView View = new(id, "running", sourceSha, targetSha, null, null, [], [], null, null,
            ReviewMode: config.Flow is null ? "strict" : "natural");
        internal byte[]? ReportBytes;
    }
    private sealed record Configuration(string Host, string Entry, Dictionary<string, string> Pins, string EvidenceRoot,
        string Contract, string GateSourceSha256)
    {
        internal string ManifestSha { get; private set; } = "";
        internal NaturalFlowRuntime? Flow { get; private set; }
        internal string Lease => Path.Combine(EvidenceRoot, "active.json");
        internal static Configuration Load(bool natural = false)
        {
            if (natural)
            {
                var flow = NaturalFlowRuntime.Load();
                return new Configuration(flow.Host, flow.Entry, flow.Pins, flow.EvidenceRoot, flow.Contract, "")
                { Flow = flow, ManifestSha = flow.ManifestSha };
            }
            var path = Environment.GetEnvironmentVariable("MTQC_WORD_LAYOUT_MANIFEST") ?? "";
            var expected = Environment.GetEnvironmentVariable("MTQC_WORD_LAYOUT_MANIFEST_SHA256") ?? "";
            if (!Path.IsPathFullyQualified(path)) throw new InvalidDataException("An absolute pinned runtime manifest is required.");
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (stream.Length is <= 0 or > 1024 * 1024) throw new InvalidDataException("Runtime manifest size is invalid.");
            var bytes = new byte[(int)stream.Length]; stream.ReadExactly(bytes);
            if (stream.ReadByte() != -1 || !DigestEquals(expected, Hash(bytes))) throw new InvalidDataException("Runtime manifest hash changed.");
            var config = JsonSerializer.Deserialize<Configuration>(bytes, Json) ?? throw new InvalidDataException("Runtime manifest is missing.");
            if (config.Contract != "mtqc-local-word-layout-runtime-v1" || !DigestEquals(config.GateSourceSha256, GateSource) ||
                !Path.IsPathFullyQualified(config.Host) || !Path.IsPathFullyQualified(config.Entry) || !Path.IsPathFullyQualified(config.EvidenceRoot) ||
                config.Pins is null || !config.Pins.ContainsKey(config.Host) || !config.Pins.ContainsKey(config.Entry))
                throw new InvalidDataException("Runtime contract, executable pins or private evidence root is invalid.");
            foreach (var pin in config.Pins)
                if (!Path.IsPathFullyQualified(pin.Key) || !DigestEquals(pin.Value, Hash(File.ReadAllBytes(pin.Key))))
                    throw new InvalidDataException("A registered runtime dependency changed.");
            NaturalFlowRuntime.EnsureSharedRoot(config.EvidenceRoot, false);
            config.ManifestSha = Hash(bytes); return config;
        }
    }
}
