# Install the latest Node.js 24 LTS into <repo>\.runtime\node -- no admin rights,
# no registry changes, no MSI. Everything the app needs (node, npm, npx) ships
# inside the official win-x64 zip, so the app can live on any drive.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-node.ps1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeHome = Join-Path $repoRoot '.runtime\node'
$exe = Join-Path $nodeHome 'node.exe'

function Get-LocalNodeVersion {
  if (-not (Test-Path -LiteralPath $exe)) { return $null }
  try { return (& $exe -v) } catch { return $null }
}

$current = Get-LocalNodeVersion
if ($current -and [int](($current -replace '^v(\d+)\..*$', '$1')) -ge 24) {
  Write-Host "  Node $current already present in .runtime\node - skipping download."
  exit 0
}

Write-Host '  Looking up the latest Node.js 24 release...'
$releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
$target = $releases | Where-Object { $_.version -like 'v24.*' } | Select-Object -First 1
if (-not $target) { throw 'No Node.js 24 release found on nodejs.org.' }
Write-Host "  Latest 24.x: $($target.version) (LTS: $($target.lts))"

$url = "https://nodejs.org/dist/$($target.version)/node-$($target.version)-win-x64.zip"
$zip = Join-Path $env:TEMP "node-$($target.version)-win-x64.zip"
Write-Host "  Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

Write-Host '  Extracting...'
$stage = Join-Path $env:TEMP "node-stage-$($target.version)"
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
$extracted = Get-ChildItem -LiteralPath $stage -Directory | Select-Object -First 1
if (-not $extracted) { throw 'The downloaded archive did not contain a Node folder.' }
# .runtime may not exist yet on a clean clone, and Move-Item fails with a
# confusing "Could not find a part of the path" if its parent is missing.
New-Item -ItemType Directory -Path (Split-Path -Parent $nodeHome) -Force | Out-Null
if (Test-Path -LiteralPath $nodeHome) { Remove-Item -LiteralPath $nodeHome -Recurse -Force }
Move-Item -LiteralPath $extracted.FullName -Destination $nodeHome
Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue

$installed = Get-LocalNodeVersion
if (-not $installed) { throw 'node.exe is still missing after extraction.' }
Write-Host "  Installed Node $installed -> .runtime\node"
exit 0
