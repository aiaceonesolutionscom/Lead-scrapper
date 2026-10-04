@echo off
rem ============================================================
rem  Run the frontend.
rem
rem  APP_MODE=prod (default) -> "next start", which serves a real
rem    production build: no per-visit compiling, so pages load as
rem    fast as a deployed build. ensure-build.ps1 rebuilds first
rem    if the source changed since the last build.
rem  APP_MODE=dev -> "next dev": instant edits while coding, but
rem    every route recompiles on visit (slow).
rem
rem  2-START.bat uses prod, 2-START-DEV.bat uses dev.
rem
rem  All temp/cache data lives in <repo>\.runtime so the project can
rem  live on any drive. chcp 65001 keeps non-Latin business names
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

if not defined APP_MODE set "APP_MODE=prod"

if /i "%APP_MODE%"=="dev" goto dev_mode

rem ------------------------------------------------------------ prod (fast)
echo [frontend] Fast mode: using the production build.
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\ensure-build.ps1"
if errorlevel 1 (
  echo.
  echo [frontend] Could not prepare the production build. Falling back to dev mode
  echo           so the app still starts. Use 2-START-DEV.bat to skip this step.
  echo.
  goto dev_mode
)
pushd "%ROOT%"
call npm run start 2>&1 | powershell -NoProfile -Command "$input | ForEach-Object { $t=(Get-Date).ToString('yyyy-MM-dd HH:mm:ss'); Add-Content -LiteralPath '%LOGDIR%\frontend-console.log' -Encoding UTF8 -Value ('[' + $t + '] ' + $_) }"
goto done

rem ------------------------------------------------------------- dev (slow)
:dev_mode
echo [frontend] Dev mode: changes appear instantly, but each page recompiles.
pushd "%ROOT%"
call npm run dev 2>&1 | powershell -NoProfile -Command "$input | ForEach-Object { $t=(Get-Date).ToString('yyyy-MM-dd HH:mm:ss'); Add-Content -LiteralPath '%LOGDIR%\frontend-console.log' -Encoding UTF8 -Value ('[' + $t + '] ' + $_) }"

:done