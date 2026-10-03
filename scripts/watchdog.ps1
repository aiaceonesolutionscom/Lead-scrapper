<#
  LeadCRM Watchdog — keeps the backend + Cloudflare Quick Tunnel alive.

  What it does, repeatedly (every 30s):
    1. Backend not healthy on 127.0.0.1:5000? Start it hidden.
    2. cloudflared quick tunnel not running? Start it hidden and wait for URL.
    3. Public path (Vercel edge -> Quick Tunnel -> backend) not answering?
       - If the tunnel's URL changed since last known, update Vercel's
         API_PROXY_TARGET env var and redeploy so live keeps working.
       - Otherwise it is just a transient tunnel blip -> retry next loop.

  Free path: no account, no domain. The trycloudflare URL changes on every
  cloudflared restart, so a reboot while this watchdog is not running means
  live stays up (tunnel keeps its connection) but a cloudflared restart
  without the watchdog will need a manual Vercel env update + redeploy.

  Register with Task Scheduler at login:
    schtasks /Create /SC ONLOGON /TN "LeadCRM Watchdog" /TR "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"<repo>\scripts\watchdog.ps1\"" /RL LIMITED /F
#>

$ErrorActionPreference = 'SilentlyContinue'

$Root       = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)   # <- repo root
$Scripts    = Join-Path $Root 'scripts'
$Runtime    = Join-Path $Root '.runtime'
$CfDir      = Join-Path $Runtime 'cloudflared'
$Cloudflared = Join-Path $Root 'tools\cloudflared.exe'
$Health     = 'http://127.0.0.1:5000/health'
$PublicProbe = 'https://leadlabz.vercel.app/api/auth/login'
$LogFile    = Join-Path $Runtime 'watchdog.log'
$UrlState   = Join-Path $CfDir 'current-url.txt'
$CfOutLog   = Join-Path $CfDir 'tunnel.out.log'
$CfErrLog   = Join-Path $CfDir 'tunnel.err.log'
$IntervalSeconds = 30
$ConsecPublicFailures = 0
$FailThreshold = 3   # ~90s of continuous public-path failure before acting

if (-not (Test-Path $Runtime)) { New-Item -ItemType Directory -Path $Runtime | Out-Null }
if (-not (Test-Path $CfDir))    { New-Item -ItemType Directory -Path $CfDir | Out-Null }

function Write-Log([string]$msg) {
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -LiteralPath $LogFile -Value "$ts  $msg"
}

function Get-Health([int]$timeoutMs = 5000) {
  try {
    $r = Invoke-WebRequest -Uri $Health -UseBasicParsing -TimeoutSec 5
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function Get-CloudflaredProcs {
  Get-Process -Name 'cloudflared' -ErrorAction SilentlyContinue |
    Where-Object { $_.StartTime -lt (Get-Date).AddMinutes(1) }
}

function Get-QuickTunnelUrl {
  # 1) Parse the cloudflared logs (URL is printed in a banner to stderr/stdout).
  try {
    foreach ($log in @($CfOutLog, $CfErrLog)) {
      if (-not (Test-Path -LiteralPath $log)) { continue }
      $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction Stop |
           Select-Object -First 1
      if ($m -and $m.Matches[0].Value -notmatch '^https://api\.') { return $m.Matches[0].Value }
    }
  } catch {}

  # 2) Scrape the local metrics endpoint (fallback): find the listener port
  #    owned by any running cloudflared and ask /quicktunnel.
  foreach ($p in Get-Process -Name 'cloudflared' -ErrorAction SilentlyContinue) {
    $port = Get-NetTCPConnection -OwningProcess $p.Id -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1 -ExpandProperty LocalPort
    if (-not $port) { continue }
    try {
      $hostname = (Invoke-WebRequest -Uri "http://127.0.0.1:$port/quicktunnel" -UseBasicParsing -TimeoutSec 5).Content |
                  ConvertFrom-Json | Select-Object -ExpandProperty hostname
      if ($hostname -match 'trycloudflare') { return "https://$hostname" }
    } catch {}
  }
  return $null
}

function Ensure-Tunnel {
  # Only start one; adopt any cloudflared that changed port < 1 min ago.
  $running = Get-Process -Name 'cloudflared' -ErrorAction SilentlyContinue
  if ($running) {
    $url = Get-QuickTunnelUrl
    if ($url) { return $url }
    # process up but no URL yet -> give it a moment
    Start-Sleep -Seconds 12
    return Get-QuickTunnelUrl
  }

  # Rotate stale logs so the URL parse stays clean.
  Remove-Item -LiteralPath $CfOutLog -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $CfErrLog -ErrorAction SilentlyContinue

  $proc = Start-Process -FilePath $Cloudflared `
    -ArgumentList 'tunnel','--protocol','http2','--url','http://127.0.0.1:5000','--no-autoupdate' `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $CfOutLog `
    -RedirectStandardError  $CfErrLog `
    -WindowStyle Hidden -PassThru

  for ($i = 0; $i -lt 6; $i++) {
    Start-Sleep -Seconds 5
    if ($proc.HasExited) { break }
    $url = Get-QuickTunnelUrl
    if ($url) { return $url }
  }
  return $null
}

function Test-PublicPath([int]$timeoutSec = 20) {
  # Real user path: Vercel edge -> Cloudflare quick tunnel -> backend.
  # Use POST: Vercel edge caches GET responses, so a GET probe can return 200
  # even when the tunnel is dead. POST /api/auth/login with a dummy body always
  # reaches the backend, which replies 400 "Security check failed" (no valid
  # captcha token) — proving the tunnel hop works. Any HTTP answer below 500
  # means the backend was reached; Vercel's own 502 "upstream unreachable" and
  # network failures (timeout/TLS reset) mean the tunnel is down.
  #
  # Body is validated too: on a flaky CGNAT link cloudflared can sever the
  # connection MID-body. That surfaces as a 200/400 whose body does not parse
  # as JSON (browser reports "Failed to fetch" / ERR_CONTENT_DECODING_FAILED).
  # Treat a non-JSON body like a failure so the watchdog still reacts.
  try {
    $body = "{`"username`":`"probe`",`"password`":`"probe`"}"
    $r = Invoke-WebRequest -Uri $PublicProbe -Method POST -Body $body `
         -ContentType 'application/json' -UseBasicParsing -TimeoutSec $timeoutSec
    if ($r.StatusCode -ge 500) { return $false }
    try { $null = ($r.Content | ConvertFrom-Json); return $true } catch { return $false }
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      if ($resp.StatusCode.value__ -ge 500) { return $false }
      return $true
    }
    return $false
  }
}

function Update-VercelTarget([string]$url) {
  # Runs inside the repo so `npx vercel` resolves from node_modules and uses
  # the user's existing Vercel login (~/.vercel/auth.json).
  Write-Log "Vercel target changed -> $url ; updating env + redeploying..."
  Push-Location $Root
  try {
    & (Join-Path $Root 'node_modules\.bin\vercel.cmd') env rm API_PROXY_TARGET production --yes 2>$null | Out-Null
    $url | & (Join-Path $Root 'node_modules\.bin\vercel.cmd') env add API_PROXY_TARGET production 2>$null | Out-Null
    & (Join-Path $Root 'node_modules\.bin\vercel.cmd') --prod --yes 2>$null | Out-Null
    Write-Log 'Vercel env + deploy done.'
  } finally {
    Pop-Location
  }
}

function Ensure-Backend {
  # Backend already healthy? Nothing to do.
  if (Get-Health) { return }

  # Start hidden so the user never sees console windows on login.
  $scriptUrl = Join-Path $Scripts 'run-backend.cmd'
  $proc = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', "call `"$scriptUrl`"" `
    -WorkingDirectory $Scripts `
    -WindowStyle Hidden

  # Wait up to 40s for it to become healthy.
  for ($i = 0; $i -lt 8; $i++) {
    Start-Sleep -Seconds 5
    if (Get-Health) { return }
  }
  Write-Log 'Backend did not become healthy yet; will retry next loop.'
}

Write-Log 'Watchdog started.'

# After (re)pointing Vercel at a new tunnel URL the redeploy takes ~30-60s;
# during that window the public path legitimately fails. Remember when we last
# repointed so we never cycle cloudflared mid-deploy (which would produce yet
# another URL and keep Vercel permanently stale).
$lastRepointAt = [DateTime]::MinValue
$RepointGraceSec = 120

while ($true) {
  Ensure-Backend
  $tunnelUrl = Ensure-Tunnel
  if (-not $tunnelUrl) {
    Write-Log 'Quick Tunnel not up yet -- will retry.'
    Start-Sleep -Seconds $IntervalSeconds
    continue
  }

  $known = (Get-Content -LiteralPath $UrlState -ErrorAction SilentlyContinue | Select-Object -First 1)

  # Tunnel URL changed since last known -> repoint Vercel FIRST, then record it.
  if ($known -ne $tunnelUrl) {
    Write-Log "Tunnel URL: $tunnelUrl (was $known)"
    Update-VercelTarget $tunnelUrl
    Set-Content -LiteralPath $UrlState -Value $tunnelUrl -NoNewline
    $known = $tunnelUrl
    $lastRepointAt = Get-Date
    $ConsecPublicFailures = 0
  }

  # Public-path health. Only act AFTER the repoint grace period has elapsed, so
  # a normal Vercel redeploy is never mistaken for a dead tunnel.
  if ((Get-Date) -lt $lastRepointAt.AddSeconds($RepointGraceSec)) {
    Write-Log 'Skipping public-path check during Vercel redeploy grace...'
  } elseif (Get-Health) {
    if (Test-PublicPath) {
      $ConsecPublicFailures = 0
    } else {
      $ConsecPublicFailures++
      Write-Log "Public path probe failed ($ConsecPublicFailures/$FailThreshold)"
      if ($ConsecPublicFailures -ge $FailThreshold) {
        $freshUrl = Get-QuickTunnelUrl
        $knownState = (Get-Content -LiteralPath $UrlState -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($freshUrl -and $freshUrl -ne $knownState) {
          # cloudflared re-registered a new hostname while path was down ->
          # Vercel still points at the old one -> repoint + redeploy.
          Update-VercelTarget $freshUrl
          Set-Content -LiteralPath $UrlState -Value $freshUrl -NoNewline
          $lastRepointAt = Get-Date
          $ConsecPublicFailures = 0
        } else {
          # Same URL but public path stuck. Check the tunnel DIRECTLY before
          # burning it: if the tunnel itself answers /health, the flake is on
          # the Vercel edge (e.g. mid-redeploy) — keep the same URL and let it
          # recover instead of churning a new hostname (which forces a redeploy
          # and a new URL each cycle = the old death loop).
          $directOk = $false
          try {
            $r = Invoke-WebRequest -Uri "$freshUrl/health" -UseBasicParsing -TimeoutSec 15
            $directOk = ($r.StatusCode -eq 200)
          } catch {}
          if ($directOk) {
            Write-Log 'Tunnel direct-OK but Vercel public path down; staying on same URL (likely redeploy).'
            $ConsecPublicFailures = 0
          } else {
            Write-Log 'Tunnel direct check failing too; cycling cloudflared...'
            Get-Process -Name 'cloudflared' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 3
            $ConsecPublicFailures = 0
          }
        }
      }
    }
  } else {
    $ConsecPublicFailures = 0
  }

  Start-Sleep -Seconds $IntervalSeconds
}