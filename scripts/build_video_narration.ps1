$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$outputRoot = Join-Path $projectRoot 'output/video/professional-v3'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$story = Get-Content (Join-Path $projectRoot 'docs/web-demo/video-storyboard.json') -Raw | ConvertFrom-Json
$voice = New-Object -ComObject SAPI.SpVoice
$english = @($voice.GetVoices() | Where-Object { $_.GetDescription() -match 'Zira.*English' })[0]
if (-not $english) { throw 'English Zira voice unavailable' }
$voice.Voice = $english
$voice.Rate = 0
foreach ($scene in $story) {
    for ($i = 0; $i -lt $scene.sentences.Count; $i++) {
        $stream = New-Object -ComObject SAPI.SpFileStream
        $stream.Open((Join-Path $outputRoot ("{0}-{1}.wav" -f $scene.id, $i)), 3, $false)
        $voice.AudioOutputStream = $stream
        [void]$voice.Speak($scene.sentences[$i])
        $stream.Close()
    }
}
Write-Output "Narration generated: $outputRoot"
