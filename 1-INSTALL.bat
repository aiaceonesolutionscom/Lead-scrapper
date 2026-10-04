@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title CRM Lead Extractor - Install
set "ROOT=%~dp0"
set "NODEHOME=%ROOT%.runtime\node"
set "PATH=%NODEHOME%;%PATH%"
set "PLAYWRIGHT_BROWSERS_PATH=%ROOT%playwright-browsers"

echo ============================================================
echo   CRM Lead Extractor - first-time install
echo   Project folder: %ROOT%
echo ============================================================
echo.
echo Internet access is required for this step.
echo.

echo [1/6] Node.js 24 ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\install-node.ps1"
if errorlevel 1 goto failed

echo.
echo [2/6] Google Chrome ...
powershell -NoProfile -Command "if ((Test-Path 'C:\Program Files\Google\Chrome\Application\chrome.exe') -or (Test-Path 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe')) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  where winget >nul 2>nul
  if errorlevel 1 (
    echo   winget not available. Install Chrome manually from https://www.google.com/chrome
  ) else (
    echo   Installing Chrome with winget. This may take a few minutes.
    winget install --id Google.Chrome --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
  )
) else (
  echo   Chrome already installed.
)
echo   Note: if Chrome stays missing, extraction falls back to the bundled
echo   Chromium browser and Google may occasionally block a run.

echo.
echo [3/6] npm packages ...
pushd "%ROOT%"
if exist "%ROOT%package-lock.json" (
  echo   npm ci in root ...
  call npm ci --no-audit --fund=false
) else (
  echo   npm install in root ...
  call npm install --no-audit --fund=false
)
if errorlevel 1 goto failed
popd

pushd "%ROOT%server"
if exist "%ROOT%server\package-lock.json" (
  echo   npm ci in server ...
  call npm ci --no-audit --fund=false
) else (
  echo   npm install in server ...
  call npm install --no-audit --fund=false
)
if errorlevel 1 goto failed
popd

echo.
echo [4/6] Playwright fallback browser ...
pushd "%ROOT%"
call npx playwright install chromium
if errorlevel 1 goto failed
popd

echo.
echo [5/6] Configuration, database and admin account ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\install-config.ps1"
if errorlevel 1 goto failed

rem This must come AFTER install-config.ps1: NEXT_PUBLIC_* values are inlined
rem into the bundle at build time, so .env.local has to exist first or the API
rem URL gets baked in as empty.
echo.
echo [6/6] Building the production frontend (once) ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\ensure-build.ps1"
if errorlevel 1 (
  echo.
  echo   The production build failed, but the install itself is complete.
  echo   You can still use 2-START-DEV.bat while you fix it. See logs\build.log.
  goto failed
)

echo.
echo ============================================================
echo   Install finished. Build the app with 2-START.bat.
echo   Run 2-START.bat to launch the app.
echo ============================================================
echo.
pause
exit /b 0

:failed
echo.
echo ============================================================
echo   Install failed. Fix the problem above and run this file again.
echo ============================================================
echo.
pause
exit /b 1
