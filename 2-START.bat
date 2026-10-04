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
rem PATH already has .runtime\node first, so `where node` finds the copy the
rem installer placed OR a Node that was already installed machine-wide.
where node >nul 2>nul
if errorlevel 1 (
  echo No Node.js found, neither in .runtime\node nor on this machine.
  echo Run 1-INSTALL.bat once to set everything up.
  pause
  exit /b 1
)

set "BACKEND_UP="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5000" ^| findstr "LISTENING"') do set "BACKEND_UP=1"
set "FRONTEND_UP="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do set "FRONTEND_UP=1"

rem ---------------------------------------------------------------- backend
if defined BACKEND_UP (
  echo Backend is already running on port 5000 - leaving it untouched.
) else (
  echo Starting the backend ...
  start "CRM Backend" cmd /k call "%ROOT%scripts\run-backend.cmd"
  echo Waiting for the backend on http://127.0.0.1:5000/health ...
  for /l %%i in (1,1,60) do (
    if not defined BACKEND_UP (
      for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5000" ^| findstr "LISTENING"') do set "BACKEND_UP=1"
      if not defined BACKEND_UP ping -n 2 127.0.0.1 >nul
    )
  )
  if not defined BACKEND_UP (
    echo The backend did not come up. Check the "CRM Backend" window and logs\backend-console.log.
    pause
    exit /b 1
  )
  echo Backend is up.
)

rem --------------------------------------------------------------- frontend
if defined FRONTEND_UP (
  echo Frontend is already running on port 3000 - leaving it untouched.
) else (
  echo Starting the frontend ...
  start "CRM Frontend" cmd /k call "%ROOT%scripts\run-frontend.cmd"
  echo Waiting for the frontend on http://localhost:3000 ...
  for /l %%i in (1,1,90) do (
    if not defined FRONTEND_UP (
      for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do set "FRONTEND_UP=1"
      if not defined FRONTEND_UP ping -n 2 127.0.0.1 >nul
    )
  )
  if not defined FRONTEND_UP (
    echo The frontend did not come up in time. Check the "CRM Frontend" window.
    pause
    exit /b 1
  )
  echo Frontend is up.
)

start "" "http://localhost:3000"

if not defined APP_MODE set "APP_MODE=prod"

echo.
echo ============================================================
echo   Frontend : http://localhost:3000
echo   Backend  : http://127.0.0.1:5000
echo   Frontend mode: !APP_MODE!
if /i not "!APP_MODE!"=="dev" (
  echo   A production build is used, so pages load fast with no compiling.
  echo   Rebuilding automatically if the source changed.
) else (
  echo   Dev mode compiles every route on visit, so it is slow. Use 2-START.bat
  echo   for normal, fast use.
)
echo   Logs     : logs\backend-console.log
echo               logs\frontend-console.log
echo               logs\extraction.log
echo               logs\build.log
echo.
for /f "tokens=1,* delims==" %%a in ('findstr /b "ADMIN_USERNAME=" "%ROOT%.env.local"') do set "ADMIN_USER=%%b"
for /f "tokens=1,* delims==" %%a in ('findstr /b "ADMIN_PASSWORD=" "%ROOT%.env.local"') do set "ADMIN_PASS=%%b"
echo   Login    : !ADMIN_USER!  /  !ADMIN_PASS!
echo   Stop with 3-STOP.bat
echo ============================================================
echo.
pause
