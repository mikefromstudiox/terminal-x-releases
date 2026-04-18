# Cash drawer pulse capture — client onboarding workflow

Every Dominican-market POS-80 clone ships with subtly different firmware. Instead of guessing the right ESC/POS pulse for a new client, capture the exact byte sequence from an app that already opens their drawer (StarSISA, legacy .NET POS, whatever). Ship that verbatim.

**First-use discovery (Studio X Auto Detailing, 2026-04-18):** pulse `1B 70 00 0F 3F 0D 0A` — StarSISA terminates its drawer kick with `CR LF`, which forces generic POS-80 firmware to flush the command. Without the CR LF, queued commands never execute. Built-in Terminal X variants at that point shipped without the terminator.

## When to run this

Client says "cash drawer doesn't open from Terminal X." Before guessing variants:

1. Does another POS app on that PC open the drawer? (Ask the client.)
2. If yes → capture its pulse (Step A below) — deterministic, ~3 minutes.
3. If no → hardware / cable / driver diagnostics (not in this playbook).

## Step A — Capture the pulse (requires admin PowerShell)

Run `capture-spool.ps1` from an elevated PowerShell. It watches `C:\Windows\System32\spool\PRINTERS\` for 3 minutes and copies any `.SPL` file to `C:\Users\<user>\AppData\Local\Temp\kicktest\spool-capture\` before the spooler deletes it. While the script runs, open the working POS app and click its "Abrir Caja" button. The drawer will open AND the `.SPL` will be captured in the same action.

```powershell
# Elevated PowerShell:
powershell -ExecutionPolicy Bypass -File "C:\TerminalX-Share\drawer-diagnostics\capture-spool.ps1"
```

## Step B — Decode the captured bytes

```bash
node "C:\TerminalX-Share\drawer-diagnostics\decode-spl.js" "C:\Users\<user>\AppData\Local\Temp\kicktest\spool-capture\"
```

Drops ESC/POS interpretation for every non-empty `.SPL`. The one with 5-8 bytes starting `1B 70` is the drawer kick. Note any trailing CR LF / form-feed / reset bytes — those are the firmware-specific terminators you need to ship.

## Step C — Ship the bytes

1. Paste the hex into `app_settings.drawer_pulse_hex` for that client's business_id.
2. Update Terminal X's "Probar Variantes" default list to include the new variant so future clients see it in the picker.

## Other tools in this folder

- `fire-variant.ps1 -Variant <hex>` — direct-fires a pulse via `WritePrinter` RAW. Use to test a captured pulse before committing to it. Drawer opens if pulse is correct.
- `fire-5-variants.ps1` — fires Terminal X's current 5 built-in variants one after another with 500ms gaps. Quick sanity check before capturing.
- `scan-pos-binary.js <exe-or-dll-path>` — scans a competing POS's binary for ESC/POS byte sequences. Useful if you don't want to touch the spool folder and are willing to guess from static strings. Warning: static scan hits are often data-table entries, not runtime pulses — Step A capture is always more reliable.
- `printer-diag.ps1` — enumerates printer / port / driver / saved config / USB devices / print event log. Run this first to confirm printer name and rule out driver/cable issues.

## Reference: variants seen so far

| Client | Pulse (hex) | Notes |
|---|---|---|
| Studio X Auto Detailing | `1B 70 00 0F 3F 0D 0A` | POS-80 clone, pin-2, 30ms/126ms, **CR LF terminator required** |

(Append new clients as we capture them.)

## Key lesson

Static byte scans of POS binaries ≠ runtime output. Starsisa.exe had `1B 70 01 00 00 00` and `1B 70 00 26 1E` as data-table entries, but the bytes it actually sent to the printer were `1B 70 00 0F 3F 0D 0A`. Always prefer the spool capture over binary spelunking.
