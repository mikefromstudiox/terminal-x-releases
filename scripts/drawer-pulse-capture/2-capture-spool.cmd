@echo off
REM Step 2 — Capture the winning pulse from a competing POS app.
REM Self-elevates to admin (UAC prompt) — the spool folder is ACL'd.
REM While the script runs, open the working POS and click its drawer-open button.

cd /d "%~dp0"

REM Check if already elevated; if not, relaunch with RunAs
net session >nul 2>&1
if %errorLevel% NEQ 0 (
  echo Requesting admin elevation for spool folder access...
  powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/c','\"%~f0\"' -Verb RunAs"
  exit /b
)

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0capture-spool.ps1"
echo.
pause
