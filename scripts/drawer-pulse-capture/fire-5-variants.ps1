# fire-5-variants.ps1 — fires 5 common ESC/POS drawer variants in sequence,
# 500ms apart. Drawer opens on the first match.
#
# Limitation: if several work, only the first gets credit — use fire-variant.ps1
# one at a time if you need to identify the winner precisely.
#
# Usage:
#   powershell -File fire-5-variants.ps1 -PrinterName "80mm Series Printer"

param([Parameter(Mandatory=$true)][string]$PrinterName)

$ErrorActionPreference = 'Stop'

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
    if (!OpenPrinter(name, out h, IntPtr.Zero)) return "FAILED";
    try {
      DI di = new DI { pDocName = "DrawerKick", pDatatype = "RAW" };
      if (!StartDocPrinter(h, 1, ref di)) return "FAILED";
      if (!StartPagePrinter(h)) return "FAILED";
      IntPtr p = Marshal.AllocHGlobal(bytes.Length);
      try {
        Marshal.Copy(bytes, 0, p, bytes.Length);
        int w;
        if (!WritePrinter(h, p, bytes.Length, out w)) return "FAILED";
        return "OK wrote=" + w;
      } finally { Marshal.FreeHGlobal(p); }
    } finally { EndPagePrinter(h); EndDocPrinter(h); ClosePrinter(h); }
  }
}
"@
Add-Type -TypeDefinition $src -Language CSharp

$variants = @(
  @{ name = 'starsisa-dr    (1B 70 00 0F 3F 0D 0A)'; bytes = [byte[]](0x1B,0x70,0x00,0x0F,0x3F,0x0D,0x0A) }
  @{ name = 'std-25-250     (1B 70 00 19 FA)';       bytes = [byte[]](0x1B,0x70,0x00,0x19,0xFA) }
  @{ name = 'pin2-50-250    (1B 70 00 32 FA)';       bytes = [byte[]](0x1B,0x70,0x00,0x32,0xFA) }
  @{ name = 'pin5-25-250    (1B 70 01 19 FA)';       bytes = [byte[]](0x1B,0x70,0x01,0x19,0xFA) }
  @{ name = 'bel            (07)';                    bytes = [byte[]](0x07) }
)

foreach ($v in $variants) {
  $hex = ($v.bytes | ForEach-Object { $_.ToString('X2') }) -join ' '
  Write-Host ("→ {0} : {1}" -f $v.name.PadRight(40), $hex) -NoNewline
  $r = [RP]::Fire($PrinterName, $v.bytes)
  Write-Host (" ... {0}" -f $r)
  Start-Sleep -Milliseconds 500
}
