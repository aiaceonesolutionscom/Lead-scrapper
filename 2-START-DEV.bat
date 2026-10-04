@echo off
rem ============================================================
rem  Same as 2-START.bat, but the frontend runs in DEV mode.
rem
rem  Use this while you are editing code: changes appear instantly.
rem  It is slow because Next.js recompiles every route on visit.
rem  For normal daily use, close this and run 2-START.bat instead
rem  (production build, no compiling).
rem
rem  This file only sets APP_MODE and hands over to 2-START.bat so
rem  there is a single copy of the start-up logic.
rem ============================================================
setlocal
set "APP_MODE=dev"
call "%~dp02-START.bat"