param(
  [Parameter(Mandatory = $true)][string]$Archive,
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$UserDataDirectory,
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion
)

$ErrorActionPreference = 'Stop'
$logPath = Join-Path $UserDataDirectory 'update.log'
$tempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('AuroraGame-update-' + [guid]::NewGuid().ToString('N'))

function Write-UpdateLog([string]$Message) {
  try { Add-Content -LiteralPath $logPath -Value ((Get-Date -Format 's') + ' ' + $Message) -Encoding UTF8 } catch { }
}

try {
  while (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) { throw 'Архив обновления не найден' }
  New-Item -ItemType Directory -Path $tempDirectory | Out-Null
  Expand-Archive -LiteralPath $Archive -DestinationPath $tempDirectory -Force
  $newExecutable = Join-Path $tempDirectory 'AuroraGame.exe'
  $buildInfoPath = Join-Path $tempDirectory 'build-info.json'
  $newResources = Join-Path $tempDirectory 'resources'
  if (-not (Test-Path -LiteralPath $newExecutable -PathType Leaf) -or
      -not (Test-Path -LiteralPath $buildInfoPath -PathType Leaf) -or
      -not (Test-Path -LiteralPath $newResources -PathType Container)) {
    throw 'Архив не содержит полного portable-клиента'
  }
  $buildInfo = Get-Content -LiteralPath $buildInfoPath -Raw | ConvertFrom-Json
  if ([string]$buildInfo.version -ne $ExpectedVersion) { throw 'Версия в архиве не совпадает с выпуском GitHub' }
  Get-ChildItem -LiteralPath $tempDirectory -Force | ForEach-Object {
    $destination = Join-Path $InstallDirectory $_.Name
    if ($_.Name -eq 'resources' -and (Test-Path -LiteralPath $destination)) {
      Remove-Item -LiteralPath $destination -Recurse -Force
    }
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
  }
  Write-UpdateLog ('Обновление до ' + $ExpectedVersion + ' применено')
  Start-Process -FilePath $Executable -ArgumentList '--start-in-tray' -WorkingDirectory $InstallDirectory
} catch {
  Write-UpdateLog ('Обновление не применено: ' + $_.Exception.Message)
  try {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('Не удалось установить обновление Aurora Game. Старую версию оставил на месте.' + [Environment]::NewLine + $_.Exception.Message,
      'Aurora Game', 'OK', 'Warning') | Out-Null
  } catch { }
  if (Test-Path -LiteralPath $Executable -PathType Leaf) {
    Start-Process -FilePath $Executable -WorkingDirectory $InstallDirectory
  }
} finally {
  Remove-Item -LiteralPath $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue
}
