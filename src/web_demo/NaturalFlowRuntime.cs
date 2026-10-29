using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MedicalQcWebDemo;

// A separately admitted runtime for natural-flow review; never substitutes for the strict gate manifest.
internal sealed record NaturalFlowRuntime(string Host, string Entry, string Python, string InspectorSha256,
    Dictionary<string, string> Pins, string EvidenceRoot, string Contract)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal string ManifestSha { get; private set; } = "";
    internal static NaturalFlowRuntime Load()
    {
        var bytes = ReadManifest("MTQC_WORD_FLOW_MANIFEST", "MTQC_WORD_FLOW_MANIFEST_SHA256");
        var value = JsonSerializer.Deserialize<NaturalFlowRuntime>(bytes, Json) ?? throw new InvalidDataException("Natural-flow runtime missing.");
        if (value.Contract != "mtqc-local-natural-flow-runtime-v1" ||
            new[] { value.Host, value.Entry, value.Python, value.EvidenceRoot }.Any(p => !Path.IsPathFullyQualified(p)) || value.Pins is null)
            throw new InvalidDataException("Natural-flow runtime contract or paths are invalid.");
        var inspector = Path.Combine(Path.GetDirectoryName(value.Entry)!, "tools", "review_natural_flow.py");
        foreach (var path in new[] { value.Host, value.Entry, value.Python, inspector })
            if (!value.Pins.ContainsKey(path)) throw new InvalidDataException("Natural-flow executable or inspector is not pinned.");
        if (!Digest(value.InspectorSha256, value.Pins[inspector])) throw new InvalidDataException("Natural-flow inspector identity disagrees.");
        foreach (var pin in value.Pins)
            if (!Path.IsPathFullyQualified(pin.Key) || !Digest(pin.Value, Hash(File.ReadAllBytes(pin.Key))))
                throw new InvalidDataException("Natural-flow runtime dependency changed.");
        EnsureSharedRoot(value.EvidenceRoot, true);
        value.ManifestSha = Hash(bytes); return value;
    }
    internal static void EnsureSharedRoot(string root, bool natural)
    {
        var prefix = natural ? "MTQC_WORD_LAYOUT_MANIFEST" : "MTQC_WORD_FLOW_MANIFEST";
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(prefix))) return;
        using var other = JsonDocument.Parse(ReadManifest(prefix, prefix + "_SHA256"));
        if (!SamePath(other.RootElement.GetProperty("evidenceRoot").GetString(), root))
            throw new InvalidDataException("Both Word modes must share the same evidence root and lease.");
    }
    private static byte[] ReadManifest(string variable, string shaVariable)
    {
        var path = Environment.GetEnvironmentVariable(variable) ?? "";
        if (!Path.IsPathFullyQualified(path)) throw new InvalidDataException("An absolute pinned natural-flow manifest is required.");
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length is <= 0 or > 1024 * 1024) throw new InvalidDataException("Runtime manifest size is invalid.");
        var bytes = new byte[(int)stream.Length]; stream.ReadExactly(bytes);
        if (stream.ReadByte() != -1 || !Digest(Environment.GetEnvironmentVariable(shaVariable), Hash(bytes)))
            throw new InvalidDataException("Runtime manifest changed.");
        return bytes;
    }
    internal (string Status, string[] Findings) Admit(JsonElement root, int exit, string draft, string pdf, string evidence)
    {
        if (root.GetProperty("contract").GetString() != "natural-flow-rectangle-review-v1" ||
            root.GetProperty("policy").GetString() != "preserve-source-inline-flow" ||
            !root.GetProperty("publication_blocked").GetBoolean() || root.GetProperty("full_rendered_layout_verified").GetBoolean() ||
            !root.GetProperty("input_hashes_rechecked_before_commit").GetBoolean() ||
            !Digest(root.GetProperty("inspector_file_sha256").GetString(), InspectorSha256))
            throw new InvalidDataException("Natural-flow report contract is not bound.");
        var paths = new[] { draft, pdf, evidence }; var inputs = root.GetProperty("inputs").EnumerateArray().ToArray();
        if (inputs.Length != 3) throw new InvalidDataException("Natural-flow input denominator changed.");
        for (var i = 0; i < paths.Length; i++)
            if (!SamePath(inputs[i].GetProperty("path").GetString(), paths[i]) ||
                inputs[i].GetProperty("bytes").GetInt64() != new FileInfo(paths[i]).Length ||
                !Digest(inputs[i].GetProperty("sha256").GetString(), Hash(File.ReadAllBytes(paths[i]))))
                throw new InvalidDataException("Natural-flow report is not bound to this staged draft/render.");
        var pages = root.GetProperty("pages"); var findings = root.GetProperty("findings");
        if (pages.GetArrayLength() is <= 0 or > 2000 || findings.GetArrayLength() > 12000)
            throw new InvalidDataException("Natural-flow report denominator is outside bounds.");
        var status = root.GetProperty("status").GetString(); var expected = findings.GetArrayLength() == 0 ? "NO_RECTANGLE_FINDINGS" : "REVIEW_REQUIRED";
        if (status != expected || exit != (findings.GetArrayLength() == 0 ? 0 : 2))
            throw new InvalidDataException("Natural-flow status and process exit disagree.");
        return (status, findings.EnumerateArray().Select(f =>
            $"Page {f.GetProperty("page").GetInt32()}: {f.GetProperty("type").GetString()}").ToArray());
    }
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static bool Digest(string? value, string expected) => value is not null && Regex.IsMatch(value, "\\A[0-9a-fA-F]{64}\\z") && string.Equals(value, expected, StringComparison.OrdinalIgnoreCase);
    private static bool SamePath(string? value, string expected) => value is not null && Path.IsPathFullyQualified(value) && string.Equals(Path.GetFullPath(value), Path.GetFullPath(expected), StringComparison.OrdinalIgnoreCase);
}
