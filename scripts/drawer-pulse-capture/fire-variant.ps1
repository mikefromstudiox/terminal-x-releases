# fire-variant.ps1 — direct-fires an ESC/POS drawer pulse via WritePrinter RAW,
# bypassing Terminal X entirely. Useful to confirm a captured pulse opens the
# drawer before committing it to Terminal X's settings.
#
# Usage:
#   powershell -File fire-variant.ps1 -PrinterName "80mm Series Printer" -HexBytes "1B 70 00 0F 3F 0D 0A"
#
# Accepts hex with spaces, dashes, or no separator.

param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$HexBytes
)

$ErrorActionPreference = 'Stop'

# Parse hex string into byte array
$clean = $HexBytes -replace '[^0-9A-Fa-f]', ''
if ($clean.Length -eq 0 -or $clean.Length % 2 -ne 0) {
  Write-Host "Invalid hex string. Give pairs of hex digits, e.g. '1B 70 00 0F 3F 0D 0A'" -ForegroundColor Red
  exit 2
}
$bytes = New-Object byte[] ($clean.Length / 2)
for ($i = 0; $i -lt $bytes.Length; $i++) {
  $bytes[$i] = [Convert]::ToByte($clean.Substring($i * 2, 2), 16)
}

$src = @"
using System;
using System.Runtime.InteropServices;
public class RP {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DI { public string pDocName; public string pOutputFile; public string pDatatype; }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool StartDocPrinter(IntPtr h, int L, [In] ref DI di);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr h, IntPtr p, int c, out int w);
  public static string Fire(string name, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(name, out h, IntPtr.Zero)) return "OpenPrinter FAILED err=" + Marshal.GetLastWin32Error();
    try {
      DI di = new DI { pDocName = "DrawerKick", pDatatype = "RAW" };
      if (!StartDocPrinter(h, 1, ref di)) return "StartDoc FAILED err=" + Marshal.GetLastWin32Error();
      if (!StartPagePrinter(h)) return "StartPage FAILED err=" + Marshal.GetLastWin32Error();
      IntPtr p = Marshal.AllocHGlobal(bytes.Length);
      try {
        Marshal.Copy(bytes, 0, p, bytes.Length);
        int w;
        if (!WritePrinter(h, p, bytes.Length, out w)) return "WritePrinter FAILED err=" + Marshal.GetLastWin32Error();
        return "OK wrote=" + w;
      } finally { Marshal.FreeHGlobal(p); }
    } finally { EndPagePrinter(h); EndDocPrinter(h); ClosePrinter(h); }
  }
}
"@
Add-Type -TypeDefinition $src -Language CSharp

$hexDisplay = ($bytes | ForEach-Object { $_.ToString('X2') }) -join ' '
Write-Host ("→ Printer: {0}" -f $PrinterName)
Write-Host ("→ Bytes  : {0} ({1} byte{2})" -f $hexDisplay, $bytes.Length, $(if ($bytes.Length -eq 1) {''} else {'s'}))
$result = [RP]::Fire($PrinterName, $bytes)
Write-Host ("Result   : {0}" -f $result)
