# printer-diag.ps1 — enumerate printer + driver + port + event log + USB devices.
# Run BEFORE trying to capture or fire pulses — rules out driver / cable issues first.
#
# Usage:
#   powershell -File printer-diag.ps1

$ErrorActionPreference = 'Continue'

Write-Host "=== Installed printers ===" -ForegroundColor Cyan
Get-Printer | Select-Object Name, DriverName, PortName, PrintProcessor, RenderingMode, PrinterStatus | Format-List

Write-Host "=== Ports ===" -ForegroundColor Cyan
Get-PrinterPort | Format-Table Name, Description, PortMonitor -AutoSize

Write-Host "=== USB devices matching print/pos/thermal ===" -ForegroundColor Cyan
Get-PnpDevice -Class USB -ErrorAction SilentlyContinue |
  Where-Object { $_.FriendlyName -match 'print|pos|thermal|epson|xprinter|rongta|star|POS-80' } |
  Select-Object FriendlyName, InstanceId, Status | Format-List

Write-Host "=== PrintService operational log (last 10) ===" -ForegroundColor Cyan
try {
  Get-WinEvent -LogName 'Microsoft-Windows-PrintService/Operational' -MaxEvents 10 -ErrorAction Stop |
    Select-Object TimeCreated, LevelDisplayName, Id, Message | Format-List
} catch {
  Write-Host ("  (no events or log disabled: {0})" -f $_.Exception.Message) -ForegroundColor DarkGray
}

Write-Host "=== Terminal X saved printer config ===" -ForegroundColor Cyan
$db = Join-Path $env:APPDATA 'terminal-x\terminal-x.db'
if (-not (Test-Path $db)) {
  Write-Host "  Terminal X DB not found at $db" -ForegroundColor DarkGray
} else {
  # Use a portable better-sqlite3 via node if installed under sqlitetmp
  $nodeMods = 'C:\Users\post1\AppData\Local\Temp\sqlitetmp\node_modules'
  if (Test-Path (Join-Path $nodeMods 'better-sqlite3')) {
    $env:NODE_PATH = $nodeMods
    node -e "const D=require('better-sqlite3'); const db=new D(process.argv[1],{readonly:true}); const rows=db.prepare(\"SELECT key,value FROM app_settings WHERE key LIKE '%printer%' OR key LIKE '%drawer%' OR key LIKE '%pulse%'\").all(); console.log(JSON.stringify(rows,null,2));" $db
  } else {
    Write-Host "  (better-sqlite3 not found; manual check needed)" -ForegroundColor DarkGray
  }
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  - If printer shows Status=Normal and is on a USB port, proceed to capture-spool.ps1"
Write-Host "  - If RenderingMode is blank, the spooler may filter raw bytes — set to BranchOfficeDirect"
Write-Host "    via: Set-Printer -Name '<name>' -RenderingMode BranchOfficeDirect"
