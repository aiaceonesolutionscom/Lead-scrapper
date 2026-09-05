@echo off
rem ============================================================
rem  Run the frontend (Next.js dev) with ZERO load on C:
rem ============================================================
set "RT=D:\Office work\yawar leads\lead-extractor-crm\.runtime"
set "TMP=%RT%\tmp"
set "TEMP=%RT%\tmp"
set "NPM_CONFIG_CACHE=%RT%\npm-cache"
if not exist "%TMP%" mkdir "%TMP%"
if not exist "%NPM_CONFIG_CACHE%" mkdir "%NPM_CONFIG_CACHE%"
pushd "%~dp0.."
call npm run dev