param(
    [switch]$SelfCheck
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$required = @(
    'src/web_demo/wwwroot/vendor/pdfjs/pdf.mjs',
    'src/web_demo/wwwroot/vendor/pdfjs/pdf.worker.mjs',
    'src/web_demo/wwwroot/vendor/tesseract/tesseract.esm.min.js',
    'src/web_demo/wwwroot/vendor/tesseract/worker.min.js',
    'src/web_demo/wwwroot/vendor/tesseract/lang/eng.traineddata.gz',
    'src/web_demo/LICENSE',
    'docs/web-demo/public-source.gitignore',
    'docs/web-demo/public-source.gitattributes',
    'docs/web-demo/THIRD_PARTY_NOTICES.md',
    'docs/web-demo/RIGHTS.md',
    'docs/web-demo/public-source-workflows/mtqc.yml',
    'docs/web-demo/evaluation/cases-v1.json',
    'src/web_demo_evaluation/evaluator.mjs',
    'src/web_demo/fixtures/assets.sha256'
)
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $projectRoot $_) -PathType Leaf) })
if ($missing.Count -gt 0) {
    throw "Release self-check: missing required files: $($missing -join ', ')"
}

$assetRoot = Join-Path $projectRoot 'src/web_demo/fixtures/assets'
$manifest = Join-Path $projectRoot 'src/web_demo/fixtures/assets.sha256'
$expected = @{}
foreach ($line in Get-Content -LiteralPath $manifest) {
    if ($line -notmatch '^([0-9a-f]{64})  ([^\\/]+)$') { throw "Malformed asset manifest line: $line" }
    $expected[$Matches[2]] = $Matches[1]
}
$actual = @(Get-ChildItem -LiteralPath $assetRoot -File | ForEach-Object Name)
if ($actual.Count -ne $expected.Count) { throw 'Asset manifest file count differs from the release assets.' }
foreach ($name in $actual) {
    if (-not $expected.ContainsKey($name)) { throw "Unmanifested release asset: $name" }
    $hash = (Get-FileHash -LiteralPath (Join-Path $assetRoot $name) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $expected[$name]) { throw "Release asset hash mismatch: $name" }
}
Write-Output "Release self-check: required files and $($actual.Count) asset hashes verified."
if ($SelfCheck) { exit 0 }

$stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$releaseRoot = Join-Path $projectRoot "output/web-demo-release-$stamp"
$publish = Join-Path $releaseRoot 'publish'
$source = Join-Path $releaseRoot 'public-source'
New-Item -ItemType Directory -Path $publish,$source -Force | Out-Null

$clientRoot = Join-Path $projectRoot 'src/web_demo_client'
$npmCommand = if ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows) { 'npm.cmd' } else { 'npm' }
Push-Location $clientRoot
try {
    & $npmCommand ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    & $npmCommand run build
    if ($LASTEXITCODE -ne 0) { throw 'Local PDF/OCR worker build failed.' }
}
finally { Pop-Location }

$webProject = Join-Path $projectRoot 'src/web_demo/MedicalQcWebDemo.csproj'
& dotnet publish $webProject -c Release -o $publish --nologo
if ($LASTEXITCODE -ne 0) { throw 'Release publish failed.' }
& dotnet (Join-Path $publish 'MedicalQcWebDemo.dll') --validate-fixtures
if ($LASTEXITCODE -ne 0) { throw 'Published fixture validation failed.' }

foreach ($file in @('README.md','RIGHTS.md','THIRD_PARTY_NOTICES.md')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "docs/web-demo/$file") -Destination (Join-Path $publish $file)
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'src/web_demo/LICENSE') -Destination (Join-Path $publish 'LICENSE')

$httpPortListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$httpPortListener.Start()
$port = ([System.Net.IPEndPoint]$httpPortListener.LocalEndpoint).Port
$httpPortListener.Stop()
$baseUrl = "http://127.0.0.1:$port"
$priorLive = $env:DEMO_LIVE_ENABLED
$env:DEMO_LIVE_ENABLED = 'false'
$serverProcess = $null
try {
    $serverArgs = @{ FilePath = 'dotnet'; ArgumentList = @("`"$(Join-Path $publish 'MedicalQcWebDemo.dll')`"", '--urls', $baseUrl); PassThru = $true; RedirectStandardOutput = (Join-Path $releaseRoot 'server-stdout.log'); RedirectStandardError = (Join-Path $releaseRoot 'server-stderr.log') }
    if ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows) { $serverArgs.WindowStyle = 'Hidden' }
    $serverProcess = Start-Process @serverArgs
    $ready = $false
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri "$baseUrl/api/cases" -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        }
        catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $ready) { throw 'Published server did not answer /api/cases.' }
    foreach ($path in @('/vendor/pdfjs/pdf.mjs','/vendor/pdfjs/pdf.worker.mjs','/vendor/tesseract/worker.min.js','/vendor/tesseract/lang/eng.traineddata.gz')) {
        $response = Invoke-WebRequest -Uri "$baseUrl$path" -UseBasicParsing -TimeoutSec 10
        if ($response.StatusCode -ne 200 -or $response.RawContentLength -le 0) { throw "Published worker asset unavailable: $path" }
    }
}
finally {
    if ($serverProcess -and -not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force }
    $env:DEMO_LIVE_ENABLED = $priorLive
}

$allowedTrees = @('src/web_demo','src/web_demo_client','src/web_demo_tests','src/web_demo_browser_tests','src/web_demo_evaluation','docs/web-demo')
foreach ($tree in $allowedTrees) {
    $folder = Join-Path $projectRoot $tree
    foreach ($file in Get-ChildItem -LiteralPath $folder -File -Recurse) {
        if ($file.FullName -match '[\\/](bin|obj|node_modules|vendor|__pycache__|\.pytest_cache|\.mypy_cache)[\\/]' -or
            $file.Extension -in @('.pyc','.pyo')) { continue }
        $relative = $file.FullName.Substring($projectRoot.Length + 1)
        $destination = Join-Path $source $relative
        New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $destination
    }
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/web-demo/README.md') -Destination (Join-Path $source 'README.md')
$exportReadme = Join-Path $source 'README.md'
$readmeText = Get-Content -LiteralPath $exportReadme -Raw -Encoding utf8
foreach ($docName in @('RIGHTS.md','THIRD_PARTY_NOTICES.md','CORPUS_EVALUATION_20260930.md','CORPUS_SOURCES.md','COMPLEX_MEDICAL_IMAGE_PILOT_20260930.md','REVIEW_EVALUATION_20261001.md')) {
    $readmeText = $readmeText.Replace("]($docName)", "](docs/web-demo/$docName)")
    if (-not (Test-Path -LiteralPath (Join-Path $source "docs/web-demo/$docName"))) { throw "Missing linked source document: $docName" }
}
Set-Content -LiteralPath $exportReadme -Value $readmeText -Encoding utf8 -NoNewline
if ([System.IO.File]::ReadAllText($exportReadme, [System.Text.Encoding]::UTF8) -cne $readmeText) {
    throw 'Exported README failed its UTF-8 round-trip check.'
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'src/web_demo/LICENSE') -Destination (Join-Path $source 'LICENSE')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/web-demo/public-source.gitignore') -Destination (Join-Path $source '.gitignore')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/web-demo/public-source.gitattributes') -Destination (Join-Path $source '.gitattributes')
$workflowFolder = Join-Path $source '.github/workflows'
New-Item -ItemType Directory -Path $workflowFolder -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/web-demo/public-source-workflows/mtqc.yml') -Destination (Join-Path $workflowFolder 'mtqc.yml')
if (-not (Test-Path -LiteralPath (Join-Path $workflowFolder 'mtqc.yml') -PathType Leaf)) { throw 'Public CI workflow missing from source export.' }
$sourceScripts = Join-Path $source 'scripts'
New-Item -ItemType Directory -Path $sourceScripts -Force | Out-Null
foreach ($name in @('web_demo_release.ps1','smoke_18_languages.ps1','build_judge_brief.py','build_video_narration.ps1','compose_professional_video.py')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "scripts/$name") -Destination (Join-Path $sourceScripts $name)
}

$secretPattern = '(?i)\bsk-[a-z0-9_-]{20,}\b|Bearer\s+[a-z0-9_-]{20,}|(?:api[_-]?key|secret)\s*[:=]\s*["''][^"'']{20,}["'']'
foreach ($file in Get-ChildItem -LiteralPath $source -File -Recurse) {
    if ($file.Extension -notin @('.cs','.js','.mjs','.json','.md','.ps1','.py','.html','.css','.svg','.xml','.txt','.yml','.yaml')) { continue }
    $contents = Get-Content -LiteralPath $file.FullName -Raw
    if ($contents -match $secretPattern) { throw "Possible secret in public source: $($file.FullName)" }
    if ($contents -match '(?i)C:\\Users\\hyung|H:\\Dev\\Hyun') { throw "Private machine path in public source: $($file.FullName)" }
}

$publishZip = Join-Path $releaseRoot 'medical-qc-judge-build.zip'
$sourceZip = Join-Path $releaseRoot 'medical-qc-public-source.zip'
Compress-Archive -Path (Join-Path $publish '*') -DestinationPath $publishZip
[System.IO.Compression.ZipFile]::CreateFromDirectory($source, $sourceZip)
Write-Output "Judge build: $publishZip"
Write-Output "Public source export: $sourceZip"
Write-Output "Build SHA256: $((Get-FileHash -LiteralPath $publishZip -Algorithm SHA256).Hash)"
Write-Output "Source SHA256: $((Get-FileHash -LiteralPath $sourceZip -Algorithm SHA256).Hash)"
