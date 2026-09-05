@echo off
rem ============================================================
rem  Stop backend (5000), frontend (3000) and cloudflared.
rem ============================================================
echo Stopping frontend (port 3000)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%p >nul 2>&1
)

echo Stopping backend (port 5000)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5000" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%p >nul 2>&1
)

echo Stopping Cloudflare Tunnel...
taskkill /F /IM cloudflared.exe >nul 2>&1

echo Done. (Any leftover "CRM Backend" / "CRM Frontend" / "CRM Tunnel" windows can be closed manually.)
