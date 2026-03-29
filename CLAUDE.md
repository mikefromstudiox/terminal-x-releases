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
- Full business strategy: `A:\Studio X HUB\Business-Expansion-Master-Plan.md`

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
  screens/       — POS, Queue, Clients, Credits, Settings, DGII, Reports, Inventory, etc.
  components/    — CobrarModal, Sidebar, Layout, PlanGate, etc.
  hooks/         — useDB.js (all DB hooks), useRNC.js (RNC lookup), usePlan.jsx (plan gating)
  services/      — printer.js (ESC/POS), ecf.js (e-CF / ef2.do), pdf.js, license.js
  context/       — AuthContext, LicenseContext, LayoutContext, DataContext
  data/          — web.js (Supabase layer), electron.js (desktop layer)
  i18n/          — es.js, en.js (bilingual ES/EN via useLang() hook)
  landing/       — LandingPage.jsx, SignupPage.jsx (public marketing pages)
  admin/         — AdminApp.jsx, AdminSidebar.jsx, pages/ (admin panel)

web/
  api/           — Vercel serverless functions (panel.js, validate.js, rnc.js, signup/)
  vercel.json    — SPA rewrites + API config
  main.jsx       — Top-level router (landing / /pos / /admin)
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
            notas, rnc_contribuyentes (DGII RNC directory),
            empleados (unified payroll — lavador/vendedor/cajero with salary + start_date)

## Fiscal / e-CF (Dominican Republic)
- **Legacy mode**: B01 (tax credit) / B02 (consumer) — paper NCF sequences
- **e-CF mode**: E31/E32/E33/E34... — electronic, mandatory after May 15 2026 (Ley 32-23)
- **DGII Direct (Emisor Electrónico)** — going 100% direct, no intermediary (ef2.do dropped)
- Viafirma .p12 certificate obtained for Studio X Tech SRL (RNC 133410321)
- DGII certification in progress: Steps 1-5 COMPLETE, Step 6 waiting DGII review
- Receiver endpoints live at terminalxpos.com (4 Vercel serverless functions for Steps 7-11)
- Service: `src/services/ecf.js` — `signAndSubmitECF()`, `ECF_TYPES`, `BUSINESS_TYPES`
- XML signing: `electron/xml-signer.js` (RSA-SHA256 enveloped, xml-crypto)
- XML building: `electron/xml-builder.js` (all 10 e-CF types + RFCE)
- DGII API client: `electron/dgii-client.js` (auth seed dance, submit, status check, QR URL builder)
- Test XML generator: `electron/dgii-step4-gen.js` (Step 4 simulation XMLs)
- Step 5 PDF generator: `electron/dgii-step5-pdf.js` (Representacion Impresa from signed XMLs)
- **CodigoSeguridad**: `SignatureValue[0:6]` — first 6 chars of raw base64, NO SHA-256 hashing
- QR URL: `ecf.dgii.gov.do/{env}/ConsultaTimbre` (E32<250K uses `fc.dgii.gov.do/{env}/ConsultaTimbreFC`)
- E43/E47 QR URLs omit RncComprador param (no buyer / foreign buyer)
- QR code prints on receipt when `ncf.startsWith('E')` (e-CF only)
- Receiver endpoints: `web/api/fe/` — semilla.js, validarcertificado.js, recepcion.js, aprobacion.js

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
- **New (Supabase):** plans, licenses, license_events, admin_users tables
- **Vercel API:** `/api/validate` replaces old Railway server; `/api/panel` for admin CRUD
- **Old:** `server/` deleted — Railway fully deprecated, all on Vercel
- WhatsApp support number: `+18098282971` (Studio X Tech)

## SaaS Infrastructure (built March 2026)
- **Admin panel:** `/admin` — day/night theme toggle (system/light/dark), brand red (#b3001e) accents, Dashboard/Clients/ClientDetail/Licenses/Team pages (`src/admin/`)
  - Admin can create clients (Supabase auth + business + staff + license + NCF), delete clients, create licenses
  - **Client detail page:** `/admin/clients/:id` — full profile, license, metrics, onboarding checklist, quick actions, staff list
  - **Onboarding checklist:** 8 milestones per client (compact badge in list, full checklist in detail) — `src/admin/components/OnboardingChecklist.jsx`
  - **Quick actions:** WhatsApp welcome, reset HWID, change plan, suspend/activate/pending→active, extend +30d, copy key — `src/admin/components/QuickActions.jsx`
  - **Config editor:** `/admin/clients/:id` → Configuration tab — remote config per client (fiscal mode, ITBIS/Ley %, WhatsApp UltraMsg credentials, printer, feature flags, service templates, notes) — `src/admin/components/ConfigEditor.jsx`
  - **Remote config sync:** validate.js returns `remoteConfig` + `bizSettings`; desktop LicenseContext applies to local app_settings on each validation poll (every 4h or app restart)
  - **Activity feed:** Dashboard shows unified event feed (signups, first sales, expiring licenses, inactive clients, license events)
  - **Service templates:** Push preset service lists (car wash, mechanic, dealer) from admin to client's business via `push_service` action
  - **Auto-registration:** Desktop FirstTimeSetup sends business info + HWID to `register` endpoint → creates pending license → admin activates → desktop detects and proceeds
  - ES/EN language toggle in sidebar, sidebar always black (logo integrity)
- **Landing page:** `/` — hero + features + pricing (Pro/Pro PLUS/Pro MAX) + competitor comparison table + FAQ + CTA (`src/landing/LandingPage.jsx`)
- **Signup flow:** `/signup` — white bg, black card, TERMINAL + X logo image, brand red buttons (`src/landing/SignupPage.jsx`)
- **Plan gating:** `usePlan()` hook + `PlanGate` component — Pro/Pro PLUS/Pro MAX tiers (no free tier)
- **Pricing:** Pro RD$2,490/mes (2 users, self-service), Pro PLUS RD$4,490/mes (5 users, remote config by admin team), Pro MAX RD$6,990/mes (unlimited users, dedicated account manager, monthly on-site visit). Annual 15% OFF.
- **Support tiers:** Pro = self-service only (admin has read-only, on-site visits = paid upsell trigger). Pro PLUS = remote config + WhatsApp support. Pro MAX = priority + dedicated manager + monthly visit.
- **Feature keys:** pos, queue, clients, credits, reports, ecf, dgii, petty_cash, credit_notes, cash_recon, inventory, remote_dashboard, commissions, whatsapp_receipts
- **Payroll/Nominas:** `src/screens/reports/PayrollReport.jsx` — liquidacion calculator per Dominican labor law (Ley 16-92), unified `empleados` table
- **Routing:** `web/main.jsx` splits: `/` (landing), `/signup`, `/pos/*` (auth + POS), `/admin/*` (admin panel)

## Build Commands
```bash
npm run dev          # dev mode (Vite + Electron)
npm run dist:win     # production Windows installer → dist/Terminal X-Setup-x.x.x.exe
npm run dist:mac     # macOS DMG
```

## Web / PWA Version (terminalxpos.com)
The app also runs as a web PWA deployed to **Vercel**, backed by **Supabase** instead of SQLite.

### Key files
- `src/data/web.js` — Supabase data layer (same API shape as electron preload.js)
- `src/data/electron.js` — desktop data layer wrapper
- `src/context/DataContext.jsx` — platform abstraction (`useAPI()` returns either)
- `web/vercel.json` — SPA rewrites + API route config
- `web/api/rnc.js` — Vercel serverless function proxying megaplus.com.do for RNC lookup
- `web/api/panel.js` — Consolidated admin API (stats/licenses/clients/users/client_detail/activity_feed/client_config/push_service/register via `?action=`)
- `web/api/validate.js` — License validation endpoint (rate limited, HWID binding)
- `web/api/signup/provision.js` — Self-service signup: creates business + staff + license + NCF sequences

### Deploy workflow (MUST run after any code changes that affect the web version)
```bash
cd "A:\Studio X HUB\Terminal X"
npm run build:web
echo '{"private":true,"dependencies":{"@supabase/supabase-js":"^2.49.4","xml-crypto":"^2.1.5","@xmldom/xmldom":"^0.8.6","jsonwebtoken":"^9.0.2"}}' > dist-web/package.json
cp web/vercel.json dist-web/
mkdir -p dist-web/api/signup dist-web/.vercel
cp web/api/panel.js web/api/validate.js web/api/rnc.js dist-web/api/
cp web/api/signup/provision.js dist-web/api/signup/
mkdir -p dist-web/api/fe
cp web/api/fe/semilla.js web/api/fe/validarcertificado.js web/api/fe/recepcion.js web/api/fe/aprobacion.js dist-web/api/fe/
echo '{"projectId":"prj_AjhpUcrbNGuSWZrs9CLxQmKkGXnL","orgId":"team_J0ZQKmOPRiXDLC7I1RA00PM9"}' > dist-web/.vercel/project.json
cd dist-web && npm install --silent && npx vercel --prod --yes
```

### Web rules
11. After changing src/ or web/ files, always build and deploy the web version
12. `dist-web/` is the deploy folder — vercel.json, api/, and package.json MUST be copied in before deploy
13. Supabase uses UUIDs — never `parseInt()` on IDs from Supabase
14. Web user ID may be `'web'` — guard with `(user?.id && user.id !== 'web') ? user.id : null`
15. RNC lookup on web: rnc_cache table → rnc_contribuyentes → `/api/rnc` proxy (megaplus.com.do)
16. Commission tables: washer_commissions, seller_commissions, cajero_commissions — all created on ticket insert
17. Vercel Hobby plan = 12 serverless functions max (currently 8/12 used) — admin routes consolidated into `panel.js` with `?action=` param
18. All Vercel API routes must use ESM (`export default`) not CJS (`module.exports`)

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
11. **Output formatting:** Always output deploy commands, SQL, and code blocks as single long lines — never wrap or break into small paragraphs. The user copies commands from the terminal, so use full terminal width and keep commands on one line when possible.

## Current Status (as of March 28, 2026)
- Desktop POS production-ready, all screens wired to real SQLite DB
- Web/PWA live at terminalxpos.com — Supabase backend, Vercel hosting
- SaaS infrastructure complete: admin panel, landing page, signup, plan gating, license validation
- **Brand redesign done** — all pages: black sidebar, white content, deep crimson #b3001e accents, TERMINAL + X logo
- **UI standardized** — consistent fonts (14/16px bold), black primary buttons, slate-800 tab active states across all screens
- **Receipt system overhauled** — credit cobrar now prints same full invoice as POS (`printClientReceipt` per ticket, not separate RECIBO DE COBRO)
  - Receipt preview popup: visible window with Imprimir/WhatsApp/Cerrar buttons
  - `sendToPrinter` requires explicit thermal printer config — no more corrupted PDFs from system printers
  - ESC/POS binary stripping thoroughly cleaned for HTML preview
  - `formatFormaPago` handles both EN (cash/card) and ES (efectivo/tarjeta) keys
- **Washer conduce** — no business header, no footer, just dispatch slip + commission + cut
- **CSV exports** — professional letterhead on all 6 report types via `src/services/csv.js`
- **HTML print reports** — `src/services/report-html.js` with business logo, styled tables, print/WhatsApp buttons
- **Payroll/Nominas** — commission-based liquidacion for lavadores (avg monthly commissions, not salary)
- **Admin panel = remote management hub** — client detail w/ Overview + Configuration tabs, onboarding checklist, quick actions, activity feed, config editor (fiscal/WhatsApp/printer/features/templates/notes), day/night theme, sidebar always black
- **Remote config sync live** — validate.js returns remoteConfig, desktop syncs to local app_settings every 4h
- **Auto-registration flow** — desktop FirstTimeSetup auto-registers in Supabase (pending), admin activates, desktop detects and proceeds
- **Windows installer built** — `dist/Terminal X-Setup-1.0.0.exe` (164 MB), Electron 28, auto-updater via GitHub releases
- **Landing page updated** — plan tiers show support levels (self-service / remote config / dedicated manager), comparison table includes remote config + on-site visits
- **DGII Direct e-CF certification in progress** — Steps 1-5 COMPLETE, Step 6 awaiting DGII review
  - RNC: 133410321 (STUDIO X SRL), Viafirma .p12 certificate
  - All 21/21 test e-CFs + 4/4 RFCEs accepted in Step 4 simulation (2026-03-27)
  - Step 5 PDFs with QR codes generated and uploaded (2026-03-27)
  - Receiver endpoints (semilla, validarcertificado, recepcion, aprobacion) deployed to Vercel for Steps 7-11
  - Uses `dgii-ecf` NPM package for auth/submit (custom xml-signer fails auth)
  - CodigoSeguridad = SignatureValue[0:6] (raw base64, NO hashing)
  - QR URLs: ecf.dgii.gov.do for standard, fc.dgii.gov.do for E32<250K; E43/E47 omit RncComprador
  - Sequence offsets consumed up to ~1800 (next safe: 1900+)
  - Steps 8-15 pending after DGII approves Step 6
  - Full certification guide: `DGII-CERTIFICATION.md`
- ef2.do dropped — full direct DGII submission
- Commission system working: washer, seller, cajero commissions on ticket insert
- **Planned:** CSV import from Starsisa POS (waiting for sample file)
- **Monorepo migration:** Plan exists in `MONOREPO-MIGRATION.md` — BLOCKED until DGII certification complete (Steps 6-15). Safe to execute after, no DGII code is lost, just moved to new paths.
- **Next priorities:** See FUTUREX.md "Next Up" section
