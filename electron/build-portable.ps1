param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'dist\AuroraGame-win32-x64')
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'This portable build script requires Windows.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$electronDist = Join-Path $PSScriptRoot 'node_modules\electron\dist'
$packagePath = Join-Path $PSScriptRoot 'package.json'
$sourceRoot = Join-Path $PSScriptRoot 'src'
$livekitSource = Join-Path $projectRoot 'win\livekit'
$testingGuide = Join-Path $projectRoot 'TESTING.md'
$voiceGuide = Join-Path $projectRoot 'VOICE_SERVER.md'
$portableVerifier = Join-Path $projectRoot 'tools\verify_portable.py'
$targetRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$targetApp = Join-Path $targetRoot 'resources\app'

foreach ($required in @(
  (Join-Path $electronDist 'electron.exe'),
  (Join-Path $sourceRoot 'main\main.js'),
  (Join-Path $sourceRoot 'preload\preload.js'),
  (Join-Path $sourceRoot 'renderer\index.html'),
  (Join-Path $livekitSource 'livekit-server.exe'),
  (Join-Path $livekitSource 'config.yaml')
)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Required file is missing: $required"
  }
}

if (Test-Path -LiteralPath $targetRoot) {
  throw "Output directory already exists; refusing to overwrite it: $targetRoot"
}

$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$electronPackage = Get-Content -LiteralPath (Join-Path $electronDist '..\package.json') -Raw | ConvertFrom-Json
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

New-Item -ItemType Directory -Path $targetRoot | Out-Null
try {
  Copy-Item -Path (Join-Path $electronDist '*') -Destination $targetRoot -Recurse

  $runtimeExe = Join-Path $targetRoot 'electron.exe'
  $appExe = Join-Path $targetRoot 'AuroraGame.exe'
  Move-Item -LiteralPath $runtimeExe -Destination $appExe

  New-Item -ItemType Directory -Path $targetApp -Force | Out-Null
  Copy-Item -LiteralPath $sourceRoot -Destination $targetApp -Recurse
  $targetLiveKit = Join-Path $targetApp 'win\livekit'
  New-Item -ItemType Directory -Path $targetLiveKit -Force | Out-Null
  Copy-Item -Path (Join-Path $livekitSource '*') -Destination $targetLiveKit -Recurse
  foreach ($guide in @($testingGuide, $voiceGuide, $portableVerifier)) {
    if (Test-Path -LiteralPath $guide -PathType Leaf) {
      Copy-Item -LiteralPath $guide -Destination $targetRoot
    }
  }

  $appPackage = [ordered]@{
    name = 'aurora-game'
    productName = 'Aurora Game'
    version = [string]$package.version
    main = 'src/main/main.js'
  }
  $appPackageJson = $appPackage | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText((Join-Path $targetApp 'package.json'), $appPackageJson, $utf8NoBom)

  $buildInfo = [ordered]@{
    name = 'Aurora Game'
    version = [string]$package.version
    electron = [string]$electronPackage.version
    architecture = 'x64'
    packagedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  }
  $buildInfoJson = $buildInfo | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText((Join-Path $targetRoot 'build-info.json'), $buildInfoJson, $utf8NoBom)

  Write-Output "Portable build created: $targetRoot"
  Write-Output "Client version: $($package.version)"
  Write-Output "Electron version: $($electronPackage.version)"
  Write-Output 'Launch: AuroraGame.exe'
} catch {
  Remove-Item -LiteralPath $targetRoot -Recurse -Force -ErrorAction SilentlyContinue
  throw
}
