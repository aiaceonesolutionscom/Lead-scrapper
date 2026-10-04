@echo off
setlocal enabledelayedexpansion
rem ============================================================
rem  Start backend + frontend, in order, each in its own window.
rem  Reuses the run-*.cmd scripts so the D:-only env setup
rem  (TEMP/NPM_CONFIG_CACHE/etc.) stays in exactly one place per
rem  service.
rem
rem  Local install only — there is no tunnel step. To expose the app
rem  beyond this PC, put a reverse proxy in front of port 3000/5000.
rem ============================================================
set "ROOT=%~dp0.."

echo [1/2] Starting backend...
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
  if !TRIES! LSS 60 (
    ping -n 2 127.0.0.1 >nul
    goto wait_loop
  )
)

if not defined READY (
  echo Backend did not become healthy within 60s -- check the "CRM Backend" window for errors.
) else (
  echo Backend is up.
)

echo [2/2] Starting frontend...
start "CRM Frontend" cmd /k call "%ROOT%\scripts\run-frontend.cmd"

echo.
echo Backend:  http://127.0.0.1:5000
echo Frontend: http://localhost:3000
echo Logs:     logs\backend-console.log, logs\frontend-console.log, logs\extraction.log
echo Use scripts\stop-all.cmd to stop them.
endlocal
