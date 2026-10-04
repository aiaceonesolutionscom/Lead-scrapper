# Final step of 1-INSTALL.BAT. Does the three things that need real string
# handling (which is painful and error-prone inside a .bat file):
#   1. write .env.local from .env.example, filling in the generated admin
#      credentials and the machine-specific Playwright browsers path
#   2. put the seed database in server\data (only if there is no database yet,
#      so re-running the installer never destroys live data). The committed
#      seed is encrypted (seed\crm.db.enc) because it holds real leads and real
#      password hashes, so it is decrypted here with a passphrase you supply
#   3. create-or-update the admin account so the printed credentials always
#      work -- the seeded database already contains users, which would make the
#      server's bootstrap-admin step a no-op and leave the user locked out
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-config.ps1
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot '.env.local'
$example = Join-Path $repoRoot '.env.example'
$dbDir = Join-Path $repoRoot 'server\data'
$dbPath = Join-Path $dbDir 'crm.db'
$seedEncPath = Join-Path $repoRoot 'seed\crm.db.enc'
$browsersPath = Join-Path $repoRoot 'playwright-browsers'

if (-not (Test-Path -LiteralPath $example)) { throw "Missing .env.example at $example" }

$adminUser = if ($env:ADMIN_USERNAME) { $env:ADMIN_USERNAME } else { 'admin' }
$adminPass = $env:ADMIN_PASSWORD
if (-not $adminPass) {
  $adminPass = (& (Join-Path $PSScriptRoot 'gen-password.ps1')).Trim()
}
if ($adminPass.Length -lt 10) { throw 'Generated password is too short.' }

# --- 1. .env.local ----------------------------------------------------------
if (Test-Path -LiteralPath $envFile) {
  Write-Host '  .env.local already exists - left untouched.'
} else {
  $content = (Get-Content -LiteralPath $example -Raw).
    Replace('PLAYWRIGHT_BROWSERS_PATH=', "PLAYWRIGHT_BROWSERS_PATH=$browsersPath").
    Replace('ADMIN_USERNAME=', "ADMIN_USERNAME=$adminUser").
    Replace('ADMIN_PASSWORD=', "ADMIN_PASSWORD=$adminPass")
  [System.IO.File]::WriteAllText($envFile, $content, (New-Object System.Text.UTF8Encoding $false))
  Write-Host '  Wrote .env.local'
}

# --- 2. seed database -------------------------------------------------------
New-Item -ItemType Directory -Path $dbDir -Force | Out-Null
$seeded = $false
if (Test-Path -LiteralPath $dbPath) {
  Write-Host '  server\data\crm.db already exists - existing data kept.'
} elseif (Test-Path -LiteralPath $seedEncPath) {
  # The committed seed is encrypted. Ask for the passphrase here rather than
  # baking one into the repository, so anyone who finds the public repo still
  # cannot read the leads or the password hashes inside it.
  Write-Host ''
  Write-Host '  An encrypted seed database was found: seed\crm.db.enc'
  Write-Host '  It holds your leads and user accounts, so it needs your password.'
  Write-Host '  Press Enter to skip it and start with an empty database instead.'
  Write-Host ''
  # Read-Host -AsSecureString masks what you type, which is what we want when a
  # person double-clicks 1-INSTALL.BAT. It cannot read redirected stdin though,
  # so fall back to a plain line read when the input is a pipe. That keeps the
  # step scriptable for automated installs and tests.
  $plain = $null
  if ([Console]::IsInputRedirected) {
    $line = [Console]::In.ReadLine()
    if ($line) { $plain = $line }
  } else {
    $seedPass = Read-Host '  Seed database password' -AsSecureString
    if ($seedPass -and $seedPass.Length -gt 0) {
      $plain = [System.Net.NetworkCredential]::new('', $seedPass).Password
    }
  }

  if ($plain) {
    # Prefer the Node that install-node.ps1 placed in .runtime\node, the same
    # way the launcher scripts do.
    $nodeExe = Join-Path $repoRoot '.runtime\node\node.exe'
    if (-not (Test-Path -LiteralPath $nodeExe)) {
      $nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
    }
    if (-not $nodeExe) { throw 'node.exe not found. Run 1-INSTALL.bat again.' }

    Push-Location $repoRoot
    try {
      $env:SEED_DB_PASSWORD = $plain
      & $nodeExe (Join-Path $PSScriptRoot 'decrypt-seed.mjs') --dest $dbPath
      if ($LASTEXITCODE -ne 0) { throw 'The seed database could not be decrypted.' }
      $seeded = $true
    } finally {
      # Do not leave the passphrase lying around in the environment of a
      # process that may keep running.
      Remove-Item Env:\SEED_DB_PASSWORD -ErrorAction SilentlyContinue
      $plain = $null
      Pop-Location
    }
  } else {
    Write-Host '  No password entered - starting with an empty database.'
  }
} else {
  Write-Host '  No seed database found - the app will start with an empty one.'
}

# --- 3. admin account -------------------------------------------------------
Push-Location $repoRoot
try {
  $env:ADMIN_USERNAME = $adminUser
  $env:ADMIN_PASSWORD = $adminPass
  & (Join-Path $repoRoot 'node_modules\.bin\tsx.cmd') (Join-Path $PSScriptRoot 'create-admin.ts')
  if ($LASTEXITCODE -ne 0) { throw "create-admin.ts failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host '  ------------------------------------------------------------'
Write-Host '   Admin username : ' $adminUser
Write-Host '   Admin password : ' $adminPass
Write-Host '  ------------------------------------------------------------'
if ($seeded) {
  Write-Host '  The database already contained accounts, so the accounts from the'
  Write-Host '  original PC still work too.'
}
Write-Host '  Save the password now - it is also stored in .env.local.'
Write-Host ''
exit 0
