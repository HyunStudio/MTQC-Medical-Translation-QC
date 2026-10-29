namespace QCStatusBoard;

internal static class SiblingTempPath
{
    private const int MaxAttempts = 32;

    public static string Create(string target, string extension = ".tmp")
    {
        var fullTarget = Path.GetFullPath(target);
        var directory = Path.GetDirectoryName(fullTarget)
            ?? throw new InvalidOperationException(
                "Temporary output directory is missing.");
        if (string.IsNullOrWhiteSpace(extension)
            || Path.GetFileName(extension) != extension
            || extension.IndexOfAny(
                [Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar]) >= 0)
            throw new ArgumentException(
                "Temporary extension must be a non-empty leaf suffix.",
                nameof(extension));
        if (!extension.StartsWith(".", StringComparison.Ordinal))
            extension = "." + extension;

        for (var attempt = 0; attempt < MaxAttempts; attempt++)
        {
            var candidate = Path.Combine(
                directory, $".mtqc-{Guid.NewGuid():N}{extension}");
            if (!File.Exists(candidate) && !Directory.Exists(candidate))
                return candidate;
        }
        throw new IOException(
            $"Could not allocate a unique sibling temporary path for: {fullTarget}");
    }

    internal static bool LongTargetSelfTest()
    {
        var root = Path.Combine(
            Path.GetTempPath(), "mtqc_sibling_temp_" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(root);
            var target = Path.Combine(
                root, new string('x', 180) + ".render.json");
            var first = Create(target, ".media.tmp");
            var second = Create(target, ".media.tmp");
            var expectedParent = Path.GetFullPath(root);
            var firstLeaf = Path.GetFileName(first);
            return Path.GetDirectoryName(first) == expectedParent
                && Path.GetDirectoryName(second) == expectedParent
                && !first.Equals(second, StringComparison.OrdinalIgnoreCase)
                && firstLeaf.StartsWith(".mtqc-", StringComparison.Ordinal)
                && firstLeaf.EndsWith(".media.tmp", StringComparison.Ordinal)
                && firstLeaf.Length == ".mtqc-".Length + 32 + ".media.tmp".Length
                && first.Length < target.Length
                && !File.Exists(first)
                && !Directory.Exists(first);
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }
}
