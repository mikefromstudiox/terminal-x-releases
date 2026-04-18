@echo off
REM Step 3 — Decode the captured .SPL files and print the winning pulse.
REM Uses the default capture folder at %TEMP%\kicktest\spool-capture.

cd /d "%~dp0"

set NODE_PATH=C:\Users\post1\AppData\Local\Temp\sqlitetmp\node_modules
node "%~dp0decode-spl.js" "%TEMP%\kicktest\spool-capture"
echo.
pause
