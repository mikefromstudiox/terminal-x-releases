# capture-spool.ps1 — requires admin PowerShell
# Watches the Windows print spool folder and copies any .SPL/.SHD file before
# the spooler deletes it. Run this, then open the working POS app and click
# its drawer-open button. The drawer physically opens AND we keep the bytes.
#
# Output dir: $env:TEMP\kicktest\spool-capture\

$ErrorActionPreference = 'Continue'

# Must be elevated — spool folder is ACL'd to SYSTEM + Administrators
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Must run as Administrator. Win+X → Terminal (Admin) → retry." -ForegroundColor Red
  exit 1
}

$dst = Join-Path $env:TEMP 'kicktest\spool-capture'
New-Item -ItemType Directory -Force -Path $dst | Out-Null
$src = Join-Path $env:SystemRoot 'System32\spool\PRINTERS'
$totalSec = 180
$end = (Get-Date).AddSeconds($totalSec)

Write-Host ("Watching {0} for {1}s." -f $src, $totalSec) -ForegroundColor Yellow
Write-Host "Now: open the working POS app → login → click Abrir Caja." -ForegroundColor Yellow
Write-Host ("Output folder: {0}" -f $dst) -ForegroundColor DarkGray
Write-Host ""

$seen = @{}
$lastTick = 0
while ((Get-Date) -lt $end) {
  Get-ChildItem -Path $src -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -match '\.(SPL|SHD|tmp)$' -or $_.Name -match 'FP\d' } |
    ForEach-Object {
      if (-not $seen[$_.Name]) {
        try {
          Copy-Item -Path $_.FullName -Destination (Join-Path $dst $_.Name) -Force -ErrorAction Stop
          Write-Host ("  CAPTURED {0}  ({1} bytes)" -f $_.Name, $_.Length) -ForegroundColor Green
          $seen[$_.Name] = $true
        } catch {
          # File may have been deleted between enumeration and copy — normal race
        }
      }
    }
  $remain = [int]($end - (Get-Date)).TotalSeconds
  if ($remain -ne $lastTick -and $remain % 15 -eq 0) {
    Write-Host ("  ...{0}s left" -f $remain) -ForegroundColor DarkGray
    $lastTick = $remain
  }
  Start-Sleep -Milliseconds 50
}

Write-Host ""
Write-Host ("Done. Files in {0}:" -f $dst) -ForegroundColor Cyan
Get-ChildItem $dst | Format-Table Name, Length, LastWriteTime -AutoSize

Write-Host ""
Write-Host "Next: decode with" -ForegroundColor Yellow
Write-Host ("  node `"C:\TerminalX-Share\drawer-diagnostics\decode-spl.js`" `"{0}`"" -f $dst) -ForegroundColor White
