@echo off
rem ============================================================
rem  Run the CRM backend.
rem  All temp/cache data lives in <repo>\.runtime so the project
rem  can live on any drive (a machine-specific absolute path
rem  broke the app on every other PC).
rem  Console output is teed into logs\backend-console.log so it
rem  can be watched live, like logs\extraction.log.
rem  chcp 65001 keeps non-Latin business names (Urdu/Chinese)
rem  readable instead of "U+6D4"-style mojibake.
rem ============================================================
chcp 65001 >nul
set "ROOT=%~dp0.."
set "RT=%ROOT%\.runtime"
set "NODEHOME=%RT%\node"
rem Prefer the Node that 1-INSTALL.BAT placed in .runtime\node so the app does
rem not depend on a machine-wide Node install.
if exist "%NODEHOME%\node.exe" set "PATH=%NODEHOME%;%PATH%"
set "TMP=%RT%\tmp"
set "TEMP=%RT%\tmp"
set "NPM_CONFIG_CACHE=%RT%\npm-cache"
set "LOGDIR=%ROOT%\logs"
if not exist "%TMP%" mkdir "%TMP%"
if not exist "%NPM_CONFIG_CACHE%" mkdir "%NPM_CONFIG_CACHE%"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
rem Keep the Playwright browsers where 1-INSTALL.BAT put them, even if the
rem caller inherited a different value.
if not defined PLAYWRIGHT_BROWSERS_PATH set "PLAYWRIGHT_BROWSERS_PATH=%ROOT%\playwright-browsers"
pushd "%ROOT%\server"
call npm run start 2>&1 | powershell -NoProfile -Command "$input | ForEach-Object { $t=(Get-Date).ToString('yyyy-MM-dd HH:mm:ss'); Add-Content -LiteralPath '%LOGDIR%\backend-console.log' -Encoding UTF8 -Value ('[' + $t + '] ' + $_) }"
