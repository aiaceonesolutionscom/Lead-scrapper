@echo off
rem ============================================================
rem  Run the frontend (Next.js dev server) with all temp/cache
rem  data inside <repo>\.runtime, so the project can live on any
rem  drive. Console output is teed into logs\frontend-console.log.
rem ============================================================
chcp 65001 >nul
set "ROOT=%~dp0.."
set "RT=%ROOT%\.runtime"
set "NODEHOME=%RT%\node"
if exist "%NODEHOME%\node.exe" set "PATH=%NODEHOME%;%PATH%"
set "TMP=%RT%\tmp"
set "TEMP=%RT%\tmp"
set "NPM_CONFIG_CACHE=%RT%\npm-cache"
set "LOGDIR=%ROOT%\logs"
if not exist "%TMP%" mkdir "%TMP%"
if not exist "%NPM_CONFIG_CACHE%" mkdir "%NPM_CONFIG_CACHE%"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
pushd "%ROOT%"
call npm run dev 2>&1 | powershell -NoProfile -Command "$input | ForEach-Object { $t=(Get-Date).ToString('yyyy-MM-dd HH:mm:ss'); Add-Content -LiteralPath '%LOGDIR%\frontend-console.log' -Encoding UTF8 -Value ('[' + $t + '] ' + $_) }"
