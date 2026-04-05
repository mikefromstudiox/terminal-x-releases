# Terminal X — POS System (Claude Project Context)

## Who I Am
- Michael Mejia, owner of Studio X Group — a group of interconnected businesses in the Dominican Republic
- Non-developer — I give direction, Claude writes the code
- Keep responses short and direct. Don't explain what you just did unless I ask
- Never summarize changes at the end of a response — I can read the diff
- Never add emojis unless I ask

## Studio X Group (Parent)
Terminal X is one product under the Studio X Group umbrella:
- **Studio X Detailing SRL** — car wash, detailing, tints, ceramic (studioxdetailing.com)
- **Studio X Tech SRL** — computer store, camera installs, IT services (studioxrdtech.com)
- **Studio X Media SRL** — social media, content production, software dev (studioxmedia.io)
- **Terminal X SRL** — this POS system (terminalxpos.com)
- **Group hub site** — studioxrd.com (separate project at `A:\Studio X HUB`)

## What This App Is
Terminal X is a full-featured desktop POS system built for the Dominican Republic market.
It is being resold to multiple clients. The #1 sell point is 100% working e-CF (electronic fiscal receipts) with QR codes per Ley 32-23.

## Tech Stack
- **Electron 41** — desktop shell, IPC bridge (main ↔ renderer)
- **React 19 + Vite 5** — UI (JSX, no TypeScript)
- **Tailwind CSS 4** — styling via `@tailwindcss/vite` plugin (no PostCSS pipeline)
- **react-router-dom 7** — routing
- **lucide-react 1.7** — icons
- **better-sqlite3** — local SQLite database (synchronous, main process only)
- **electron-updater** — auto-update via GitHub releases
- Language: CommonJS (`require`) in electron/, ES modules (`import`) in packages/

## Project Structure
```
packages/
  ui/              — all React UI (was src/)
    screens/       — POS, Queue, Clients, Credits, Settings, DGII, Reports, Inventory, etc.
    components/    — CobrarModal, Sidebar, Layout, PlanGate, etc.
    hooks/         — useDB.js, useRNC.js, usePlan.jsx
    context/       — AuthContext, LicenseContext, LayoutContext, DataContext
    i18n/          — es.js, en.js (bilingual ES/EN via useLang() hook)
    landing/       — LandingPage.jsx, SignupPage.jsx
    admin/         — AdminApp.jsx, pages/, components/
    main.jsx       — entry point
    index.css      — Tailwind 4 directives (@import "tailwindcss")
  services/        — printer.js, ecf.js, pdf.js, csv.js, license.js, etc.
  data/            — electron.js (desktop layer), web.js (Supabase layer)
  config/          — shared config

electron/
  main.js          — IPC handlers, app lifecycle, DGII sync, printing
  preload.js       — contextBridge (exposes window.electronAPI + window.printerAPI)
  database.js      — all SQLite functions (synchronous better-sqlite3)
  updater.js       — electron-updater logic
  xml-signer.js    — RSA-SHA256 enveloped signing (xml-crypto)
  xml-builder.js   — all 10 e-CF types + RFCE
  dgii-client.js   — DGII API (auth seed, submit, status, QR URL builder)

web/
  api/             — Vercel serverless functions (panel.js, validate.js, rnc.js, signup/)
  api/fe/          — DGII receiver endpoints (semilla, validarcertificado, recepcion, aprobacion)
  vercel.json      — SPA rewrites + API config
  main.jsx         — Top-level router (landing / /pos / /admin)

vite.config.mjs        — desktop Vite config
vite.web.config.mjs    — web PWA Vite config
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
            notas, rnc_contribuyentes, empleados

## Fiscal / e-CF (Dominican Republic)
- **DGII Direct — CERTIFIED Emisor Electrónico** (Step 15 complete 2026-04-01)
- RNC: 133410321 (STUDIO X SRL), Viafirma .p12 certificate
- **Legacy mode**: B01/B02 paper NCF sequences (still supported)
- **e-CF mode**: E31/E32/E33/E34... — electronic, mandatory after May 15 2026 (Ley 32-23)
- **CodigoSeguridad**: `SignatureValue[0:6]` — first 6 chars of raw base64, NO SHA-256 hashing
- QR URL: `ecf.dgii.gov.do/{env}/ConsultaTimbre` (E32<250K uses `fc.dgii.gov.do/{env}/ConsultaTimbreFC`)
- E43/E47 QR URLs omit RncComprador param
- Receiver endpoints LIVE at fe.terminalxpos.com (VPS Express) + Vercel backup at `web/api/fe/`
- Sequence offsets consumed up to ~1800 (next safe: 1900+)
- **Production switch:** change `dgii_environment` from `certecf` to `ecf` + install .p12

## RNC Lookup
- Hook: `useRNC()` from `packages/ui/hooks/useRNC.js`
- Lookup order: local SQLite (`rnc_contribuyentes`) → megaplus.com.do API fallback
- Full DGII sync (900K records) available in Settings → e-CF → Sincronizar ahora

## Printing (ESC/POS)
- Service: `packages/services/printer.js`
- 80mm thermal paper = **42 chars per line** (COL_WIDTH = 42)
- Code Page 858 charset — covers Spanish chars (ñ, á, é, etc.)
- ASCII-only separators — no unicode
- Cash drawer opens only for cash payments (not card/transfer/credit)
- Print fires BEFORE closing the cobrar modal so cashier sees change due

## Roles & Permissions
- owner, manager, cfo, accountant, cashier
- Role-gated screens checked via `useAuth()` + permissions map in Settings.jsx

## Hostinger VPS (root@srv1528760, 187.124.152.42)
- Hosts DGII e-CF Receiver (fe.terminalxpos.com) — Express on port 3100
- Hosts Content X (studioxmedia.io) — Docker Compose at `/opt/mediax`
- Claude Code installed — SSH in and run `claude` for server-side debugging

## License System
- Key format: `TXL-XXXX-XXXX-XXXX`
- HWID: SHA256 of MAC + hostname — stored in userData/hwid.json
- Offline grace: 72h cached validation
- Supabase tables: plans, licenses, license_events, admin_users
- Vercel API: `/api/validate` (license check), `/api/panel` (admin CRUD)
- WhatsApp support: `+18098282971`

## SaaS Infrastructure
- **Admin panel:** `/admin` — Dashboard/Clients/ClientDetail/Licenses/Team/Certifications
- **Landing page:** `/` — pricing (Pro RD$2,490 / Pro PLUS RD$4,490 / Pro MAX RD$6,990), annual 15% OFF
- **Signup:** `/signup` → auto-registration flow (pending → admin activates)
- **Remote config sync:** validate.js returns `remoteConfig`, desktop syncs every 4h
- **Plan gating:** `usePlan()` hook + `PlanGate` component — Pro/Pro PLUS/Pro MAX
- **e-CF Certification as a Service** — studioxrdtech.com/ecf-certification
- **Feature keys:** pos, queue, clients, credits, reports, ecf, dgii, petty_cash, credit_notes, cash_recon, inventory, remote_dashboard, commissions, whatsapp_receipts

## Build Commands
```bash
npm run dev          # Vite + Electron concurrent dev
npm run dev:web      # Web PWA dev (vite.web.config.mjs)
npm run build:web    # Web PWA build
npm run dist:win     # Windows installer
npm run dist:mac     # macOS DMG
```

## Web Deploy (terminalxpos.com)
```bash
cd "A:\Studio X HUB\Terminal X OLD"
npm run build:web
echo '{"private":true,"dependencies":{"@supabase/supabase-js":"^2.49.4","xml-crypto":"^2.1.5","@xmldom/xmldom":"^0.8.6","jsonwebtoken":"^9.0.2"}}' > dist-web/package.json
cp web/vercel.json dist-web/
mkdir -p dist-web/api/signup dist-web/api/fe dist-web/.vercel
cp web/api/panel.js web/api/validate.js web/api/rnc.js dist-web/api/
cp web/api/signup/provision.js dist-web/api/signup/
cp web/api/fe/semilla.js web/api/fe/validarcertificado.js web/api/fe/recepcion.js web/api/fe/aprobacion.js dist-web/api/fe/
echo '{"projectId":"prj_AjhpUcrbNGuSWZrs9CLxQmKkGXnL","orgId":"team_J0ZQKmOPRiXDLC7I1RA00PM9"}' > dist-web/.vercel/project.json
cd dist-web && npm install --silent && npx vercel --prod --yes
```

## Key Rules
1. Always read a file before editing it
2. Use `require()` in electron/ files, `import` in packages/ files
3. Never add fake/demo/placeholder data — all screens must use real DB
4. Never add artificial delays (setTimeout for fake loading)
5. No debug console.log statements in production code
6. Keep ESC/POS buffer in binary — never mix unicode characters
7. Supabase uses UUIDs — never `parseInt()` on IDs from Supabase
8. Web user ID may be `'web'` — guard with `(user?.id && user.id !== 'web') ? user.id : null`
9. All Vercel API routes must use ESM (`export default`) not CJS
10. Vercel Hobby plan = 12 serverless functions max — admin routes consolidated into `panel.js` with `?action=` param
11. Output deploy commands, SQL, and code blocks as single long lines for easy copy-paste
12. **Never add `Co-Authored-By: Claude` (or any Claude/Anthropic attribution) to commit messages.** No co-author trailer at all.

## Current Status (as of April 5, 2026)
- Desktop POS production-ready, all screens wired to real SQLite DB
- Web/PWA live at terminalxpos.com — Supabase backend, Vercel hosting
- SaaS infrastructure complete: admin panel, landing page, signup, plan gating, license validation
- DGII e-CF CERTIFIED — direct Emisor Electrónico (no intermediary)
- **Monorepo restructure complete** — packages/ui, packages/services, packages/data with npm workspaces + Vite aliases. Electron/web/db/assets stayed at root (no __dirname path surgery).
- **Stack upgraded:** React 18 → 19, Tailwind 3 → 4 (via @tailwindcss/vite plugin, @theme block in index.css replaces tailwind.config.js), react-router-dom 6 → 7, lucide-react 0.378 → 1.7
- **Vite configs renamed to .mjs** (vite.config.mjs, vite.web.config.mjs) to avoid ESM/CJS conflict with electron CommonJS
- **Dark mode support added to all screens** (Tailwind `dark:` variants). Pattern: `bg-white → dark:bg-white/5`, `bg-slate-50 → dark:bg-black` (containers) or `dark:bg-white/5` (cards), `text-slate-800/700 → dark:text-white`, `text-slate-500/600 → dark:text-white/60`, `text-slate-400 → dark:text-white/40`, `border-slate-100/200 → dark:border-white/10`, `hover:bg-slate-50 → dark:hover:bg-white/10`. Inputs get `dark:bg-white/5 dark:text-white dark:border-white/10`.
- **e-CF fully wired into POS flow:** CobrarModal.jsx calls `signAndSubmitECF()` on submit → `window.electronAPI.dgii_ecf.submit()` → IPC `dgii:submit` handler in electron/main.js → xml-builder + xml-signer + dgii-client do direct DGII submission. Offline queue fallback included.
- **Nómina expansion complete (2026-04-05):** Replaced single-screen PayrollReport with a 5-view payroll center under `packages/ui/screens/reports/nomina/` — Dashboard, Empleados, Pagos, Reportes, Ajustes. Features:
  - **Data layer:** new `payroll_settings` + `salary_changes` tables, extended `payroll_runs` with itemised deductions (sfs_employee, afp_employee, isr, other_deductions) and employer liabilities (sfs_employer, afp_employer, infotep_employer), extended `empleados` with puesto, email, bank_account, tss_id. SQLite migrations v1.5 + Supabase migration `20260405000002`.
  - **Helper libs:** `lib/isr.js` (DR 2026 brackets: 0% / 15% / 20% / 25% · 416,220 / 624,329 / 867,123 thresholds · cycle-aware annualization), `lib/tss.js` (separate SFS cap RD$232,230 + AFP cap RD$464,460 + INFOTEP 1% employer, no cap), `lib/payPeriod.js` (quincenal/mensual helpers), `lib/calcLiquidacion.js` (Ley 16-92 functions extracted from legacy file).
  - **Bulk pay run:** NominaPagos view lets user select period (quincenal 1-15 / 16-end / mensual / custom) and pay all active employees at once with auto-computed base, commissions, TSS, ISR, INFOTEP, net. Transactional `payrollRunsBulkCreate` auto-marks the underlying commissions as paid in the `washer_commissions`/`seller_commissions`/`cajero_commissions` tables.
  - **Accountant reports:** TSS+INFOTEP (PDF+CSV), ISR with YTD (PDF+CSV), Nómina completa (QuickBooks/Alegra CSV), Recibos batch print, Liquidaciones acumuladas (termination liability snapshot). New export functions in `csv.js` and `report-html.js`.
  - **Auto salary change log:** `empleadoUpdate` detects salary changes and inserts a `salary_changes` row automatically with old/new/effective_date/reason.
  - **Pay stub printer:** `printPaycheckStub` in `nomina/shared.jsx` with business letterhead, itemised breakdown, signature lines.
  - **Goal:** let Michael + an accountant run payroll + fiscal filings in-house without paying an external accountant.
- **Commission-only workers:** Payroll supports lavadores, vendedores, AND cajeros paid from commissions alone (no fixed salary required). `calcLiquidacion` auto-uses avg monthly commissions as base.
- **Dev Pro MAX override:** `packages/ui/hooks/usePlan.jsx` forces `pro_max` in `import.meta.env.DEV` so all gated features (DGII, Remote Dashboard, WhatsApp receipts) are visible during local dev. Production builds ignore it.
- **Next:** Publish v1.2.0 to GitHub releases, first client onboarding, PSFE application
