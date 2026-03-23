# Terminal X — POS System (Claude Project Context)

## Who I Am
- Owner of Studio X Tech — building and reselling Terminal X to car washes and businesses in the Dominican Republic
- Non-developer — I give direction, Claude writes the code
- Keep responses short and direct. Don't explain what you just did unless I ask
- Never summarize changes at the end of a response — I can read the diff
- Never add emojis unless I ask

## What This App Is
Terminal X is a full-featured desktop POS system built for the Dominican Republic market.
It is being resold to multiple clients. The #1 sell point is 100% working e-CF (electronic fiscal receipts) with QR codes per Ley 32-23.

## Tech Stack
- **Electron 41** — desktop shell, IPC bridge (main ↔ renderer)
- **React 18 + Vite 5** — UI (JSX, no TypeScript)
- **Tailwind CSS 3** — all styling
- **better-sqlite3** — local SQLite database (synchronous, main process only)
- **electron-updater** — auto-update via GitHub releases
- **adm-zip** — DGII RNC ZIP extraction
- Language: CommonJS (`require`) in electron/, ES modules (`import`) in src/

## Project Structure
```
electron/
  main.js        — IPC handlers, app lifecycle, DGII sync, printing
  preload.js     — contextBridge (exposes window.electronAPI + window.printerAPI)
  database.js    — all SQLite functions (synchronous better-sqlite3)
  updater.js     — electron-updater logic

src/
  screens/       — POS, Queue, Clients, Credits, Settings, DGII, Reports, etc.
  components/    — CobrarModal, Sidebar, Layout, etc.
  hooks/         — useDB.js (all DB hooks), useRNC.js (RNC lookup + DGII sync)
  services/      — printer.js (ESC/POS), ecf.js (e-CF / ef2.do), license.js
  context/       — AuthContext, LicenseContext, LayoutContext, BackupContext
  i18n/          — es.js, en.js (bilingual ES/EN via useLang() hook)
```

## IPC Pattern
All DB/system calls go through Electron IPC:
- Renderer calls `window.electronAPI.someModule.method()`
- `preload.js` bridges via `contextBridge.exposeInMainWorld('electronAPI', {...})`
- `main.js` handles with `ipcMain.handle('channel', handler)`
- Printer API is separate: `window.printerAPI.print(buffer)`, `window.printerAPI.openDrawer()`

## Database (SQLite — better-sqlite3)
All functions in `electron/database.js` are synchronous.
Key tables: businesses, users, services, tickets, clients, credit_payments,
            washers, sellers, ncf_sequences, cuadre, caja_chica,
            notas, rnc_contribuyentes (DGII RNC directory)

## Fiscal / e-CF (Dominican Republic)
- **Legacy mode**: B01 (tax credit) / B02 (consumer) — paper NCF sequences
- **e-CF mode**: E31/E32/E33/E34... — electronic, mandatory after May 15 2026 (Ley 32-23)
- e-CF submission goes through **ef2.do API** via IPC (bypasses CORS)
- Service: `src/services/ecf.js` — `signAndSubmitECF()`, `ECF_TYPES`, `BUSINESS_TYPES`
- QR code prints on receipt when `ncf.startsWith('E')` (e-CF only)
- EF2 credentials: `VITE_EF2_USERNAME` + `VITE_EF2_TOKEN` in `.env`

## RNC Lookup
- Hook: `useRNC()` from `src/hooks/useRNC.js`
- Lookup order: local SQLite (`rnc_contribuyentes`) → megaplus.com.do API fallback
- Full DGII sync (900K records) available in Settings → e-CF → Sincronizar ahora
- IPC: `electronAPI.rnc.lookup(rnc)`, `electronAPI.rnc.sync()`, `electronAPI.rnc.status()`

## Printing (ESC/POS)
- Service: `src/services/printer.js`
- 80mm thermal paper = **42 chars per line** (COL_WIDTH = 42)
- Code Page 858 charset (`ESC \x74 \x10`) — covers Spanish chars (ñ, á, é, etc.)
- ASCII-only separators: `'-'.repeat(42)` — no unicode
- TOTAL lines use `LARGE_ON = ESC + '!' + '\x38'` (bold + double height + double width)
- Cash drawer: `DRAWER_KICK` prepended to print buffer OR `window.printerAPI.openDrawer()`
- Receipts: `buildClientReceipt()`, `buildWasherConduce()`, `buildCreditPaymentReceipt()`

## Roles & Permissions
- owner, manager, cfo, accountant, cashier
- Role-gated screens checked via `useAuth()` + permissions map in Settings.jsx

## License System
- Key format: `TXL-XXXX-XXXX-XXXX`
- HWID: SHA256 of MAC + hostname — stored in userData/hwid.json
- Offline grace: 72h cached validation
- License server: Express.js in `server/` — deployable to Railway/Render
- WhatsApp support number: `+18098282971` (Studio X Tech)

## Build Commands
```bash
npm run dev          # dev mode (Vite + Electron)
npm run dist:win     # production Windows installer → dist/Terminal X-Setup-x.x.x.exe
npm run dist:mac     # macOS DMG
```

## Key Rules
1. Always read a file before editing it
2. Use `require()` in electron/ files, `import` in src/ files
3. Never add fake/demo/placeholder data — all screens must use real DB
4. Never add artificial delays (setTimeout for fake loading)
5. No debug console.log statements in production code
6. Keep ESC/POS buffer in binary — never mix unicode characters
7. Print fires BEFORE closing the cobrar modal so cashier sees change due
8. Cash drawer opens only for cash payments (not card/transfer/credit)
9. License banners stay — do not remove until final release is confirmed
10. RemoteDashboard uses real Supabase queries via `fetchDashboardData()` — shows config prompt if credentials are missing

## Current Status (as of March 2026)
- App is production-ready and being tested for first client deployment
- All major screens connected to real SQLite DB
- e-CF stub mode works; real ef2.do integration ready when credentials are provided
- RNC lookup wired: local DGII DB (post-sync) + megaplus.com.do fallback
- ESC/POS receipt formatting complete (42-char, CP858, drawer kick)
- Build target: Windows x64 NSIS installer
