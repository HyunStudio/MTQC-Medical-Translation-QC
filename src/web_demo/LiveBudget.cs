using System.Globalization;
using System.Text;

namespace MedicalQcWebDemo;

public sealed class LiveBudget
{
    private readonly LiveOptions options;
    private readonly SemaphoreSlim upstream = new(1, 1);
    private readonly object sync = new();
    private readonly Dictionary<string, (DateTimeOffset Started, int Count)> clients = new(StringComparer.Ordinal);
    private DateTimeOffset globalStarted = DateTimeOffset.MinValue;
    private int globalCount;

    public LiveBudget(LiveOptions options) => this.options = options;

    public bool HasLifetimeCapacity(int attemptCount)
    {
        if (attemptCount is < 1 or > 2) return false;
        if (options.LifetimeAttemptLimit is null && options.LifetimeLedgerPath is null) return true;
        if (options.LifetimeAttemptLimit is not int limit || limit is < 1 or > 1000 ||
            string.IsNullOrWhiteSpace(options.LifetimeLedgerPath) ||
            !Path.IsPathFullyQualified(options.LifetimeLedgerPath)) return false;
        try
        {
            if (Directory.Exists(options.LifetimeLedgerPath)) return false;
            if (!File.Exists(options.LifetimeLedgerPath)) return true;
            using var file = new FileStream(options.LifetimeLedgerPath, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (file.Length is < 1 or > 20) return false;
            var bytes = new byte[(int)file.Length];
            file.ReadExactly(bytes);
            return int.TryParse(Encoding.ASCII.GetString(bytes), NumberStyles.None,
                CultureInfo.InvariantCulture, out var count) && count >= 0 && count <= limit - attemptCount;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            return false;
        }
    }

    public Task<IDisposable?> TryAcquireAsync(string clientId, CancellationToken cancellationToken) =>
        TryAcquireAsync(clientId, 1, cancellationToken);

    public async Task<IDisposable?> TryAcquireAsync(string clientId, int attemptCount, CancellationToken cancellationToken)
    {
        if (attemptCount is < 1 or > 2) return null;
        if (!await upstream.WaitAsync(0, cancellationToken)) return null;
        var allowed = false;
        try
        {
            lock (sync)
            {
                var now = DateTimeOffset.UtcNow;
                if (globalStarted == DateTimeOffset.MinValue || now - globalStarted >= TimeSpan.FromHours(1))
                {
                    globalStarted = now;
                    globalCount = 0;
                }
                if (globalCount >= options.GlobalHourlyLimit) return null;
                if (!clients.ContainsKey(clientId) && clients.Count >= options.MaxTrackedClients)
                {
                    foreach (var expired in clients.Where(x => now - x.Value.Started >= TimeSpan.FromHours(1)).Select(x => x.Key).ToArray())
                        clients.Remove(expired);
                    if (clients.Count >= options.MaxTrackedClients) return null;
                }
                if (!clients.TryGetValue(clientId, out var entry) || now - entry.Started >= TimeSpan.FromHours(1))
                    entry = (now, 0);
                if (entry.Count >= options.PerClientLimit) return null;
                if (!ReserveLifetimeAttempts(attemptCount)) return null;
                clients[clientId] = (entry.Started, entry.Count + 1);
                globalCount++;
                allowed = true;
                return new Lease(upstream);
            }
        }
        finally
        {
            if (!allowed) upstream.Release();
        }
    }

    private bool ReserveLifetimeAttempts(int attemptCount)
    {
        if (options.LifetimeAttemptLimit is null && options.LifetimeLedgerPath is null) return true;
        if (options.LifetimeAttemptLimit is not int limit || limit is < 1 or > 1000 ||
            string.IsNullOrWhiteSpace(options.LifetimeLedgerPath) ||
            !Path.IsPathFullyQualified(options.LifetimeLedgerPath)) return false;
        try
        {
            var filePath = options.LifetimeLedgerPath;
            Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
            if (!File.Exists(filePath))
            {
                try
                {
                    using var created = new FileStream(filePath, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                    created.Write(Encoding.ASCII.GetBytes("0"));
                    created.Flush(true);
                }
                catch (IOException) when (File.Exists(filePath)) { /* Another process created the ledger. */ }
            }
            using var file = new FileStream(filePath, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
            if (file.Length is < 1 or > 20) return false;
            var bytes = new byte[(int)file.Length];
            file.ReadExactly(bytes);
            if (!int.TryParse(Encoding.ASCII.GetString(bytes), NumberStyles.None, CultureInfo.InvariantCulture, out var count) ||
                count < 0 || count > limit - attemptCount) return false;
            var next = Encoding.ASCII.GetBytes((count + attemptCount).ToString(CultureInfo.InvariantCulture));
            file.Position = 0;
            file.SetLength(0);
            file.Write(next);
            file.Flush(true);
            return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            // If durable state cannot be read or written, deny the call rather than spending untracked credit.
            return false;
        }
    }

    private sealed class Lease(SemaphoreSlim gate) : IDisposable
    {
        private int released;
        public void Dispose()
        {
            if (Interlocked.Exchange(ref released, 1) == 0) gate.Release();
        }
    }
}
