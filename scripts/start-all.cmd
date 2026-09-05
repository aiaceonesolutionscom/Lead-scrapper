@echo off
setlocal enabledelayedexpansion
rem ============================================================
rem  Start backend + frontend + tunnel, in order, each in its
rem  own window. Reuses the existing run-*.cmd scripts so the
rem  D:-only env setup (TEMP/NPM_CONFIG_CACHE/etc.) stays in
rem  exactly one place per service.
rem ============================================================
set "ROOT=%~dp0.."

echo [1/3] Starting backend...
start "CRM Backend" cmd /k call "%ROOT%\scripts\run-backend.cmd"

echo Waiting for backend to become healthy on http://127.0.0.1:5000/health ...
set "READY="
set "TRIES=0"

:wait_loop
set /a TRIES+=1
curl -s -o nul -w "%%{http_code}" http://127.0.0.1:5000/health > "%TEMP%\_health_code.txt" 2>nul
set /p HEALTH_CODE=<"%TEMP%\_health_code.txt"
if "!HEALTH_CODE!"=="200" (
  set "READY=1"
) else (
  if !TRIES! LSS 30 (
    timeout /t 1 >nul
    goto wait_loop
  )
)

if not defined READY (
  echo Backend did not become healthy within 30s -- check the "CRM Backend" window for errors.
) else (
  echo Backend is up.
)

echo [2/3] Starting frontend...
start "CRM Frontend" cmd /k call "%ROOT%\scripts\run-frontend.cmd"

echo [3/3] Starting Cloudflare Tunnel...
start "CRM Tunnel" cmd /k call "%ROOT%\scripts\run-tunnel.cmd"

echo.
echo All three started in separate windows: CRM Backend, CRM Frontend, CRM Tunnel.
echo Use scripts\stop-all.cmd to stop them.
endlocal
