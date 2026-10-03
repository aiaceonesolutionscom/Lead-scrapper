# Print a random strong password on stdout and nothing else.
# Character set is deliberately limited to symbols that are safe in a .env
# file, in batch, and in a URL: no # (dotenv comment), no % or ^ (batch
# metacharacters), no quotes, backslash or space.
# Usage: for /f "delims=" %%p in ('powershell -NoProfile -File scripts\gen-password.ps1') do set "PW=%%p"

$lower = 'abcdefghijkmnopqrstuvwxyz'
$upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
$digits = '23456789'
$symbols = '!@$*+?_-'

function Get-Pick($set) { $set[(Get-Random -Maximum $set.Length)] }

# 4 of each class = 20 chars, then shuffle so the class order is not guessable.
$chars = @()
1..4 | ForEach-Object { $chars += Get-Pick $lower }
1..4 | ForEach-Object { $chars += Get-Pick $upper }
1..4 | ForEach-Object { $chars += Get-Pick $digits }
1..4 | ForEach-Object { $chars += Get-Pick $symbols }

for ($i = $chars.Count - 1; $i -gt 0; $i--) {
  $j = Get-Random -Maximum ($i + 1)
  $tmp = $chars[$i]; $chars[$i] = $chars[$j]; $chars[$j] = $tmp
}

Write-Output (-join $chars)
