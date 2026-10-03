@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title CRM Lead Extractor - Start
set "ROOT=%~dp0"
set "NODEHOME=%ROOT%.runtime\node"
set "PATH=%NODEHOME%;%PATH%"
set "PLAYWRIGHT_BROWSERS_PATH=%ROOT%playwright-browsers"

if not exist "%ROOT%.env.local" (
  echo No .env.local found. Run 1-INSTALL.bat first.
  pause
  exit /b 1
)
if not exist "%NODEHOME%\node.exe" (
  echo Node.js is missing from .runtime\node. Run 1-INSTALL.bat first.
  pause
  exit /b 1
)

rem Only one instance may own the database at a time.
curl -s -o nul http://127.0.0.1:5000/health
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5000" ^| findstr "LISTENING"') do (
  echo The backend is already running. Use 3-STOP.bat first.
  pause
  exit /b 1
)

echo Starting backend and frontend in separate windows ...
start "CRM Backend" cmd /k call "%ROOT%scripts\run-backend.cmd"

echo Waiting for the backend on http://127.0.0.1:5000/health ...
set "READY="
for /l %%i in (1,1,60) do (
  if not defined READY (
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5000" ^| findstr "LISTENING"') do set "READY=1"
    if not defined READY timeout /t 1 >nul
  )
)
if not defined READY (
  echo The backend did not come up. Check the "CRM Backend" window and logs\backend-console.log.
  pause
  exit /b 1
)
echo Backend is up.

echo Starting the frontend ...
start "CRM Frontend" cmd /k call "%ROOT%scripts\run-frontend.cmd"

echo Waiting for the frontend on http://localhost:3000 ...
set "WEBREADY="
for /l %%i in (1,1,90) do (
  if not defined WEBREADY (
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do set "WEBREADY=1"
    if not defined WEBREADY timeout /t 1 >nul
  )
)
if defined WEBREADY (
  echo Frontend is up.
  start "" "http://localhost:3000"
) else (
  echo The frontend did not come up in time. Check the "CRM Frontend" window.
)

echo.
echo ============================================================
echo   Frontend : http://localhost:3000
echo   Backend  : http://127.0.0.1:5000
echo   Logs     : logs\backend-console.log
echo               logs\frontend-console.log
echo               logs\extraction.log
echo.
for /f "tokens=1,* delims==" %%a in ('findstr /b "ADMIN_USERNAME=" "%ROOT%.env.local"') do set "ADMIN_USER=%%b"
for /f "tokens=1,* delims==" %%a in ('findstr /b "ADMIN_PASSWORD=" "%ROOT%.env.local"') do set "ADMIN_PASS=%%b"
echo   Login    : !ADMIN_USER!  /  !ADMIN_PASS!
echo   Stop with 3-STOP.bat
echo ============================================================
echo.
pause
