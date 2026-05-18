; build/installer.nsh — Terminal X NSIS install customizations
;
; v2.17.9 (2026-05-18) — empty.
;
; v2.17.8 shipped with a customInit that wiped %APPDATA%\TerminalX on
; install for Ranoza's first-client onboarding. Two issues:
;   1. The Electron userData folder is %APPDATA%\Terminal X (with a
;      space), not %APPDATA%\TerminalX — the wipe targeted a folder
;      that didn't exist and was a no-op.
;   2. Even if it worked, it would wipe local data for ANY user who
;      downloads Setup.exe directly (vs auto-updating via electron-
;      updater which doesn't re-run NSIS scripts). That's a foot-gun.
;
; For future "stuck client" recovery: use the in-app Reset Local DB
; flow (queued for a later release) or manual %APPDATA%\Terminal X
; folder delete via AnyDesk/support session.

; No customInit — let NSIS run its default install flow.
