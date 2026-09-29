param(
    [decimal]$MaxEstimatedUsd = 0.05
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$key = [Environment]::GetEnvironmentVariable('NEBIUS_API_KEY', 'User')
if ([string]::IsNullOrWhiteSpace($key)) { throw 'User-scope NEBIUS_API_KEY is not configured; no provider calls made.' }
if ($MaxEstimatedUsd -le 0 -or $MaxEstimatedUsd -gt 0.95) { throw 'MaxEstimatedUsd must be within (0, 0.95].' }
$languages = @('ko','es','ar','zh-CN','zh-TW','ja','fr','de','it','pt','ru','hi','id','nl','pl','th','tr','vi')
$sourceText = 'The proximal artery measures 2.5 mm. The distal vein measures 1.8 mm.'
$webProject = Join-Path $projectRoot 'src/web_demo/MedicalQcWebDemo.csproj'
$runRoot = Join-Path $projectRoot ('output/smoke-18-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null

& dotnet build $webProject -c Release --nologo
if ($LASTEXITCODE -ne 0) { throw 'Release build failed; no provider calls made.' }
$dll = Join-Path $projectRoot 'src/web_demo/bin/Release/net10.0/MedicalQcWebDemo.dll'
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$baseUrl = "http://127.0.0.1:$port"
$priorKey = $env:NEBIUS_API_KEY
$priorEnabled = $env:DEMO_LIVE_ENABLED
$priorLimit = $env:DEMO_LIVE_PER_CLIENT_LIMIT
$env:NEBIUS_API_KEY = $key
$env:DEMO_LIVE_ENABLED = 'true'
$env:DEMO_LIVE_PER_CLIENT_LIMIT = '18'
$server = $null
$results = @()
$estimatedUsd = [decimal]0
try {
    $server = Start-Process -FilePath 'dotnet.exe' -ArgumentList @("`"$dll`"", '--urls', $baseUrl) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runRoot 'server-stdout.log') -RedirectStandardError (Join-Path $runRoot 'server-stderr.log')
    $ready = $false
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        try {
            $status = Invoke-RestMethod -Uri "$baseUrl/api/live/status" -TimeoutSec 2
            if ($status.available) { $ready = $true; break }
        }
        catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $ready) { throw 'Local live server was not ready; no provider calls made.' }
    foreach ($language in $languages) {
        if ($estimatedUsd -ge $MaxEstimatedUsd) { Write-Warning "Estimated spend reached the script limit before $language."; break }
        $body = @{ sourceText = $sourceText; targetLanguage = $language } | ConvertTo-Json -Compress
        try {
            $response = Invoke-RestMethod -Uri "$baseUrl/api/live/document-excerpt" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30
            $inputTokens = [int]$response.promptTokens
            $outputTokens = [int]$response.completionTokens
            # Nemotron-3.5-Lightning public rates checked on 2026-09-29: $0.06/M input and $0.24/M output.
            $estimatedUsd += ([decimal]$inputTokens * [decimal]0.06 + [decimal]$outputTokens * [decimal]0.24) / [decimal]1000000
            $results += [pscustomobject]@{
                language = $language
                status = $response.status
                model = $response.model
                promptTokens = $inputTokens
                completionTokens = $outputTokens
                qcSummary = $response.qcSummary
                translation = $response.translation
            }
            Write-Output ('{0}: {1}, {2}/{3} tokens, estimated cumulative USD {4:N6}' -f $language,$response.status,$inputTokens,$outputTokens,$estimatedUsd)
        }
        catch {
            $results += [pscustomobject]@{ language = $language; status = 'request-error'; errorType = $_.Exception.GetType().Name }
            Write-Warning "$language request failed; no automatic retry."
        }
    }
}
finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
    $env:NEBIUS_API_KEY = $priorKey
    $env:DEMO_LIVE_ENABLED = $priorEnabled
    $env:DEMO_LIVE_PER_CLIENT_LIMIT = $priorLimit
    $key = $null
}
$report = [pscustomobject]@{
    utc = [DateTimeOffset]::UtcNow.ToString('o')
    source = $sourceText
    languagesAttempted = $results.Count
    estimatedUsd = $estimatedUsd
    pricingBasis = 'Listed $0.06/M input and $0.24/M output, not provider billing ledger'
    results = $results
}
$reportPath = Join-Path $runRoot 'report.json'
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Output "Smoke report: $reportPath"
Write-Output ('Estimated new-call token cost: USD {0:N6}' -f $estimatedUsd)
