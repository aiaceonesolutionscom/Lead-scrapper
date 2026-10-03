@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title CRM Lead Extractor - Stop
set "ROOT=%~dp0"

rem Stop by port rather than by process name, so it works from any project
rem folder and also catches the node processes behind the "CRM ..." windows.
echo Stopping frontend on port 3000 ...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  echo   killing PID %%p
  taskkill /F /PID %%p >nul 2>&1
)

echo Stopping backend on port 5000 ...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5000" ^| findstr "LISTENING"') do (
  echo   killing PID %%p
  taskkill /F /PID %%p >nul 2>&1
)

rem A browser left behind by an interrupted extraction would keep the profile
rem locked and make the next run fail to start.
echo Stopping any leftover extraction browser ...
taskkill /F /IM chrome.exe >nul 2>&1
taskkill /F /IM msedge.exe >nul 2>&1

echo.
echo Any remaining "CRM Backend" / "CRM Frontend" windows can be closed.
echo.
pause
