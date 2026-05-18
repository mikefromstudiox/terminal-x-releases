; build/installer.nsh — Terminal X NSIS install customizations
;
; v2.17.8 (2026-05-18) — one-time clean-install of local SQLCipher DB.
;
; Wipes %APPDATA%\TerminalX on install so the app boots fresh and runs
; the current provisioning flow (license validation → business binding
; via cloud → fresh local DB encrypted to the correct business_id).
;
; Why this exists right now: Ranoza is the first paying desktop client,
; and an earlier install path (pre-v2.17.8) bound her local DB to a
; ghost business created from a typo-email signup. Auto-update via
; electron-updater does NOT trigger NSIS scripts — only running this
; Setup.exe directly does — so this is safe for users on auto-update.
;
; Cloud (Supabase) state is untouched. All inventory, services, NCF
; sequences, staff, etc. resync down on next login. Worst-case loss
; is offline-queued tickets that haven't synced — accepted because
; we have zero non-Ranoza desktop installs today.
;
; Remove this macro (or gate it behind a CLI flag) once we ship the
; in-app "Reset Local DB" Settings button in a future release.

!macro customInit
  DetailPrint "Resetting Terminal X local data..."
  RMDir /r "$APPDATA\TerminalX"
!macroend
