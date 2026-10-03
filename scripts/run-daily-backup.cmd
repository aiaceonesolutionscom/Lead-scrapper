@echo off
rem ============================================================
rem  Daily database backup. Paths are derived from this script's
rem  own location so the repo can live on any drive/machine.
rem  Schedule with: schtasks /create /sc daily /tn "CRM DB Backup"
rem                 /tr "\"%~f0\"" /st 02:00
rem ============================================================
setlocal
set "ROOT=%~dp0.."
if not defined BACKUP_ROOT set "BACKUP_ROOT=%ROOT%\backups"
set "BACKUP_KEEP=14"
if not exist "%ROOT%\.runtime" mkdir "%ROOT%\.runtime"
pushd "%ROOT%"
call npx tsx "%ROOT%\scripts\backup-db.ts" >> "%ROOT%\.runtime\backup-daily.log" 2>&1
endlocal
