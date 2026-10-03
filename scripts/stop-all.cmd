@echo off
rem ============================================================
rem  Stop the backend (port 5000) and frontend (port 3000),
rem  plus any browser left over from an extraction run.
rem  Matching on the port means this works no matter where the
rem  project lives and regardless of the node process tree.
rem ============================================================
echo Stopping frontend (port 3000)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%p >nul 2>&1
)

echo Stopping backend (port 5000)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5000" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%p >nul 2>&1
)

echo Stopping any leftover extraction browser...
taskkill /F /IM chrome.exe >nul 2>&1

echo Done. Any leftover "CRM Backend" / "CRM Frontend" windows can be closed manually.
