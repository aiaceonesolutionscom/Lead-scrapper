# Make sure a production Next.js build exists and matches the current source,
# then report whether anything had to be done.
#
# `next dev` recompiles a route every time you visit it (3-11s each), which is
# what makes local use feel slow. `next build` compiles everything up front, so
# `next start` afterwards serves pages with no compile step at all -- the same
# speed you get from a deployed build.
#
# A rebuild is forced when .next\BUILD_ID is missing, when -Force is passed, or
# when anything under src\ (plus the config/lockfile/.env.local) is newer than
# that build. .env.local counts because NEXT_PUBLIC_* values are inlined into
# the bundle at build time: editing the API URL without rebuilding would leave
# the old URL baked in.
#
# Usage:
#   powershell -File scripts\ensure-build.ps1
#   powershell -File scripts\ensure-build.ps1 -Force
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$nextDir = Join-Path $repoRoot '.next'
$buildId = Join-Path $nextDir 'BUILD_ID'
$logDir = Join-Path $repoRoot 'logs'
$logFile = Join-Path $logDir 'build.log'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-Status([string]$Message) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Write-Host $line
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
}

# Anything here changing means the bundle must be rebuilt.
$watchPaths = @('src', 'next.config.ts', 'postcss.config.mjs', 'package.json', 'package-lock.json', '.env.local')
$newestSource = $null
$newestName = ''
foreach ($rel in $watchPaths) {
  $path = Join-Path $repoRoot $rel
  if (-not (Test-Path -LiteralPath $path)) { continue }
  $entry = Get-Item -LiteralPath $path
  $items = if ($entry.PSIsContainer) { @(Get-ChildItem -LiteralPath $path -Recurse -File) } else { @($entry) }
  foreach ($item in $items) {
    if ($null -eq $newestSource -or $item.LastWriteTime -gt $newestSource) {
      $newestSource = $item.LastWriteTime
      $newestName = $rel
    }
  }
}

if (-not $Force -and (Test-Path -LiteralPath $buildId)) {
  $buildTime = (Get-Item -LiteralPath $buildId).LastWriteTime
  # 2s tolerance: BUILD_ID is written while the build is still finishing.
  if ($null -ne $newestSource -and $newestSource -le $buildTime.AddSeconds(2)) {
    Write-Status ('Build is up to date (built {0}). Skipping rebuild.' -f $buildTime)
    exit 0
  }
  Write-Status ('Source changed since the last build (newest: {0} at {1}).' -f $newestName, $newestSource)
} else {
  if ($Force) { Write-Status 'Rebuild forced with -Force.' }
  else { Write-Status 'No existing build found (.next\BUILD_ID missing).' }
}

# Prefer the Node that 1-INSTALL.BAT placed in .runtime\node so the build does
# not depend on a machine-wide Node install.
$npm = 'npm.cmd'
$localNpm = Join-Path $repoRoot '.runtime\node\npm.cmd'
if (Test-Path -LiteralPath $localNpm) { $npm = $localNpm }

Write-Status 'Building the production frontend (npm run build). This takes 1-2 minutes...'
Write-Status ("Build output is also appended to {0}" -f $logFile)

$sw = [Diagnostics.Stopwatch]::StartNew()
Push-Location $repoRoot
try {
  & $npm run build 2>&1 | Tee-Object -FilePath $logFile -Append | Out-Host
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}
$sw.Stop()

if ($code -ne 0 -or -not (Test-Path -LiteralPath $buildId)) {
  Write-Status ("BUILD FAILED (exit {0}) after {1:N0}s." -f $code, $sw.Elapsed.TotalSeconds)
  Write-Status 'A production build is required for the fast mode. Check logs\build.log for the error, then try again.'
  Write-Status 'To keep working in the meantime, use 2-START-DEV.bat (slower, but it needs no build).'
  exit 1
}

Write-Status ('Build finished in {0:N0}s. The app will now start in fast mode.' -f $sw.Elapsed.TotalSeconds)
exit 0