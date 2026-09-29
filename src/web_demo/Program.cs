using MedicalQcWebDemo;

var fixtureRoot = Environment.GetEnvironmentVariable("DEMO_FIXTURE_ROOT")
    ?? Path.Combine(AppContext.BaseDirectory, "fixtures");
DemoCaseCatalog catalog;
try
{
    catalog = new DemoCaseCatalog(fixtureRoot);
}
catch (Exception error) when (error is InvalidDataException or IOException or System.Text.Json.JsonException)
{
    Console.Error.WriteLine($"Demo fixtures unavailable: {error.Message}");
    return 1;
}

if (args.Contains("--validate-fixtures", StringComparer.Ordinal))
{
    Console.WriteLine("Demo fixtures valid");
    return 0;
}

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = AppContext.BaseDirectory
});
var app = builder.Build();
var liveKey = Environment.GetEnvironmentVariable("NEBIUS_API_KEY");
var ledgerPath = Environment.GetEnvironmentVariable("DEMO_LIVE_LEDGER_PATH");
var rawLifetimeLimit = Environment.GetEnvironmentVariable("DEMO_LIVE_TOTAL_ATTEMPTS");
var ledgerRequested = ledgerPath is not null || rawLifetimeLimit is not null;
var ledgerValid = int.TryParse(rawLifetimeLimit, out var lifetimeLimit) && lifetimeLimit is >= 1 and <= 1000 &&
    !string.IsNullOrWhiteSpace(ledgerPath) && Path.IsPathFullyQualified(ledgerPath);
var liveOptions = new LiveOptions(
    string.Equals(Environment.GetEnvironmentVariable("DEMO_LIVE_ENABLED"), "true", StringComparison.OrdinalIgnoreCase) &&
        (!ledgerRequested || ledgerValid),
    liveKey,
    PerClientLimit: LiveOptions.ParsePerClientLimit(Environment.GetEnvironmentVariable("DEMO_LIVE_PER_CLIENT_LIMIT")),
    LifetimeAttemptLimit: ledgerValid ? lifetimeLimit : null,
    LifetimeLedgerPath: ledgerValid ? ledgerPath : null);
var liveModel = Environment.GetEnvironmentVariable("DEMO_NEBIUS_MODEL") ?? "nvidia/Nemotron-3_5-Lightning";
var provider = new NebiusClient(new HttpClient(), liveKey ?? "", liveModel,
    new Uri("https://api.tokenfactory.nebius.com/v1/chat/completions"), TimeSpan.FromSeconds(20));
var budget = new LiveBudget(liveOptions);
var live = new LiveExcerptService(catalog, provider, liveOptions, budget);
var userExcerpt = new UserExcerptService(provider, liveOptions, budget);
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapGet("/api/cases", () => Results.Ok(catalog.All.Select(item => new
{
    item.Id,
    item.Title,
    item.Mode,
    Languages = item.Translations.Select(translation => translation.Language)
})));
app.MapGet("/api/cases/{id}", (string id) => catalog.Get(id) is { } item
    ? Results.Ok(item)
    : Results.NotFound());
app.MapGet("/api/live/status", () => Results.Ok(live.Availability));
app.MapPost("/api/live/excerpt", async (LiveExcerptRequest request, HttpContext context) =>
{
    var result = await live.ExecuteAsync(request, context.Connection.RemoteIpAddress?.ToString() ?? "unknown", context.RequestAborted);
    var code = result.Status switch
    {
        "unavailable" => 503,
        "invalid" => 400,
        "rate-limited" => 429,
        "provider-error" => 502,
        _ => 200
    };
    return Results.Json(result, statusCode: code);
});
app.MapPost("/api/live/document-excerpt", async (HttpContext context) =>
{
    const int maxBodyBytes = 64 * 1024;
    if (context.Request.ContentLength > maxBodyBytes) return Results.StatusCode(413);
    if (context.Request.ContentType?.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) != true)
        return Results.StatusCode(415);
    var buffer = new byte[maxBodyBytes + 1];
    var total = 0;
    while (total < buffer.Length)
    {
        var read = await context.Request.Body.ReadAsync(buffer.AsMemory(total), context.RequestAborted);
        if (read == 0) break;
        total += read;
    }
    if (total > maxBodyBytes) return Results.StatusCode(413);
    UserExcerptRequest? request;
    try
    {
        request = System.Text.Json.JsonSerializer.Deserialize<UserExcerptRequest>(buffer.AsSpan(0, total),
            new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
    }
    catch (System.Text.Json.JsonException)
    {
        return Results.BadRequest();
    }
    if (request is null) return Results.BadRequest();
    var result = await userExcerpt.ExecuteAsync(request, context.Connection.RemoteIpAddress?.ToString() ?? "unknown", context.RequestAborted);
    var code = result.Status switch
    {
        "unavailable" => 503,
        "invalid" => 400,
        "rate-limited" => 429,
        "provider-error" => 502,
        _ => 200
    };
    return Results.Json(result, statusCode: code);
});
app.MapGet("/assets/{name}", (string name) =>
{
    var path = catalog.ResolvePublishedAsset("/assets/" + name);
    return path is null ? Results.NotFound() : Results.File(path, contentType: ContentType(path));
});
await app.RunAsync();
return 0;

static string ContentType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
{
    ".png" => "image/png",
    ".pdf" => "application/pdf",
    ".pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    _ => "application/octet-stream"
};
