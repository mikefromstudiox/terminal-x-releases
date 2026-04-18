@echo off
REM Step 1 — Enumerate printer + driver + port. Run this FIRST.
REM Double-clickable; no admin elevation needed.

cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0printer-diag.ps1"
echo.
pause
