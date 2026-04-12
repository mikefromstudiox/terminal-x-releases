# Terminal X — POS System

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
    admin/         — AdminApp.jsx (Dashboard/Clients/ClientDetail/Licenses/Team/Certifications)
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
  xml-signer.js    — RSA-SHA256 enveloped signing (xml-crypto for e-CFs, dgii-ecf for seed)
  xml-builder.js   — all 10 e-CF types + RFCE + ANECF
  dgii-client.js   — DGII API (auth seed, submit, status, QR URL builder, ANECF void)
  cert-manager.js  — .p12 certificate loading + cert info (installed, subject, expiry)

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
- `empleados` has `role TEXT DEFAULT 'none'` (access control) + `comision_pct REAL` + `tipo TEXT` (lavador/vendedor/cajero/hybrid)
- `users` has `employee_id INTEGER` FK to `empleados` — links login credentials to employee record
- `services` has `no_commission INTEGER DEFAULT 0` — exempts service from commission calculation

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
- **Seed auth:** Uses `dgii-ecf` npm library's `Signature` class for seed signing (handles custom namespace-sorted digest). Auth POST uses `multipart/form-data` (NOT raw XML). e-CF submission remains raw `application/xml`.
- **IndicadorEnvioDiferido:** Set to `1` on offline-queued e-CFs when resubmitted from `processDgiiQueue()` (72-hour deferred submission rule)
- **ANECF (sequence voiding):** `dgii-client.js` → `submitANECF()` voids unused e-CF ranges via DGII API. UI in DGII.jsx third tab "Anular e-NCF". IPC: `dgii:void-sequence`
- **Cert status sync:** Desktop sends cert info (installed, subject, expiry, expired, environment) to Supabase via `bizSync` payload during license validation. Stored in `businesses.settings`. Admin panel shows e-CF Status card per client.

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
- Print fires AFTER DB persistence (Queue) or BEFORE closing modal (POS) so cashier sees change due

## Roles & Permissions
- owner, manager, cfo, accountant, cashier, none
- Roles live on `empleados.role` column (not on `users` table). `users.employee_id` FK links user to employee.
- AuthContext `resolveRole()` joins `users` → `empleados` at login to resolve role from employee record.
- Role-gated screens checked via `useAuth()` + permissions map in Settings.jsx
- `tipo` (lavador/vendedor/cajero/hybrid) = operational/payroll classification. `role` = access control. Independent axes.

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
- **Landing page:** `/` — pricing (Pro RD$2,490 / Pro PLUS RD$4,490 / Pro MAX RD$6,990), annual 15% OFF, 7-day free trial on Pro MAX for all signups
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
cd "A:\Studio X HUB\Terminal X"
npm run build:web
echo '{"private":true,"type":"module","dependencies":{"@supabase/supabase-js":"^2.49.4","xml-crypto":"^2.1.5","@xmldom/xmldom":"^0.8.6","jsonwebtoken":"^9.0.2","dgii-ecf":"^1.6.8","node-forge":"^1.3.3"}}' > dist-web/package.json
cp web/vercel.json dist-web/
mkdir -p dist-web/api/signup dist-web/api/fe dist-web/lib dist-web/.vercel
cp web/api/panel.js web/api/validate.js web/api/rnc.js web/api/ecf-sign.js dist-web/api/
cp web/api/signup/provision.js dist-web/api/signup/
cp web/api/fe/semilla.js web/api/fe/validarcertificado.js web/api/fe/recepcion.js web/api/fe/aprobacion.js dist-web/api/fe/
cp web/lib/xml-builder.js web/lib/xml-signer.js web/lib/dgii-client.js dist-web/lib/
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

## Data Architecture — supabase_id (MANDATORY)
Every table that syncs between Desktop (SQLite) and Web (Supabase) uses the **supabase_id** pattern:
- **SQLite:** `id INTEGER PRIMARY KEY` (auto-increment, local only) + `supabase_id TEXT` (UUID v4)
- **Supabase:** `id UUID PRIMARY KEY` (Supabase-native) + `supabase_id UUID UNIQUE` (matches SQLite)
- Desktop generates UUID at record creation: `crypto.randomUUID()`
- Sync upserts on `(business_id, supabase_id)` — single source of truth for cross-platform identity
- FK references stored as `*_supabase_id` columns (e.g., `ticket_supabase_id`, `washer_supabase_id`)
- Web queries use clean UUID joins on `supabase_id` — no integer ID hacks
- **Never use `local_id` or `local_*_id` columns** — those are deprecated scaffolding
- Sync module: `electron/sync.js` pushes SQLite → Supabase every 5 min + on every sale/payment/void
- 21 tables covered: services, washers, sellers, clients, inventory_items, ncf_sequences, empleados, categorias_servicio, users, tickets, ticket_items, queue, washer/seller/cajero_commissions, credit_payments, cuadre_caja, caja_chica, notas_credito, inventory_transactions, compras_607
- **`packages/services/sync.js` is DELETED** — was a dead legacy renderer-side sync using deprecated `local_id`. All sync goes through `electron/sync.js` only.
- **`updated_at`** columns + auto-update triggers exist on ALL 21 synced tables (both SQLite and Supabase). Sync pass 2 uses `updated_at > last_synced_at` to re-push updated rows.
- **Dual-key FK joins in `web.js`:** All web queries that join ticket_items, clients, washers etc. use BOTH `ticket_id` (web-created) AND `ticket_supabase_id` (desktop-synced) to handle both origins. Same pattern for `client_id`/`client_supabase_id`, `washer_id`/`washer_supabase_id` etc.

## Architecture Notes
- **Monorepo:** packages/ui, packages/services, packages/data with npm workspaces + Vite aliases. Electron/web/db/assets at root.
- **Vite configs:** .mjs extension (vite.config.mjs, vite.web.config.mjs) to avoid ESM/CJS conflict with electron CommonJS.
- **Dark mode:** All screens support Tailwind `dark:` variants. Pattern: `bg-white → dark:bg-white/5`, `bg-slate-50 → dark:bg-black`, `text-slate-800 → dark:text-white`, `border-slate-200 → dark:border-white/10`.
- **e-CF flow:** CobrarModal → `signAndSubmitECF()` → IPC `dgii:submit` → xml-builder + xml-signer + dgii-client → DGII API. Offline queue fallback included. CobrarModal fires `onConfirm()` (ticket creation) IMMEDIATELY after ECF success via `confirmedRef` guard — never waits for user to close the success view. `handleSuccessClose()` just calls `onClose()`. Offline queue (`processDgiiQueue()`) rebuilds XML with `IndicadorEnvioDiferido=1` and re-signs before resubmission.
- **Error handling:** `web.js` has `tryOr()` for reads (returns fallback) and `tryWrite()` for mutations (throws). Global `window.onerror` + `unhandledrejection` handlers in `main.jsx`. All commission/stock/void catches log errors.
- **RLS:** Enabled on all 26+ Supabase tables. Anon role has permissive policies requiring `business_id IS NOT NULL`. Service role (desktop sync) bypasses RLS. `users` is a VIEW on `staff` table.
- **License:** LicenseContext enforces 72h offline grace — only grants access if `tx_last_valid` localStorage timestamp is within 72 hours. Fresh installs without prior validation are denied.
- **Supabase `users` table:** Actually `staff` (base table) with `users` as a VIEW. The `staff` table has `supabase_id`, `cedula`, `start_date` columns for sync compatibility.
- **Nómina / Empleados:** Payroll center under `packages/ui/screens/reports/nomina/`. Helper libs: `lib/isr.js` (DR 2026 brackets), `lib/tss.js` (SFS/AFP/INFOTEP caps), `lib/payPeriod.js`, `lib/calcLiquidacion.js` (Ley 16-92). Supports commission-only workers. Top-level sidebar item "Empleados" routes to `/empleados` (NominaEmpleados). Employee form includes `role` dropdown (access role) and `comision_pct` field. `hybrid` tipo supported.
- **Employee consolidation:** Lavadores/Vendedores/Cajeras tabs REMOVED from Admin (Config). Admin.jsx has 3 tabs: Mi Empresa, Usuarios, Servicios. Usuarios simplified to: pick employee from dropdown, set username + PIN only. All employee management (role, commission, tipo) is in the Empleados screen. Nominas tab removed from Reportes — Empleados sidebar is the single entry point.
- **Settings structure:** Sistema.jsx has 3 tabs: Preferencias, Actualizaciones, Licencias TX. Mi Empresa tab has collapsible sections for WhatsApp, Fiscal/NCF, Respaldo/Nube. Preferencias includes Impresion (printing settings). Sidebar reduced from 13 to 8 config children (removed fiscal, impresion, whatsapp, respaldo, lavadores, vendedores, cajeras).
- **Dev override:** `usePlan.jsx` forces `pro_max` in dev mode so all gated features are visible.
- **Business Type System:** `useBusinessType()` hook + `BusinessTypeProvider` in `packages/ui/hooks/useBusinessType.jsx`. Stores `business_type` in `app_settings` (values: `carwash`, `tienda`, `otro`). Switches POS between `CarWashPOS` (service grid + queue + washers) and `RetailPOS` (product search + barcode + cart with qty). Sidebar nav filters items via `businessTypes` array prop. Settings panel at Configuración → Tipo de Negocio. FirstTimeSetup Step 1 includes business type selector.
- **Retail POS:** `RetailPOS` component in `POS.jsx` — barcode/SKU search bar, product grid from inventory, services tab for hybrid mode, cart with qty +/- buttons. Uses `api.inventory.search()` and `api.inventory.lookupSku()`. Tickets store `quantity`, `sku`, `inventory_item_id` on `ticket_items`. Auto-deducts stock on sale, reverses on void. CobrarModal, printer, PDF all quantity-aware (`qty > 1` shows `2x Product Name`).
- **CSV Import:** Inventory screen has "Importar CSV" button. Parses CSV/TSV, auto-maps columns (Spanish + English headers), preview table with manual re-mapping, bulk insert. Supports SKU, Barcode, Name, Category, Price, Cost, Stock, Min Stock.
- **Products Report:** `packages/ui/screens/reports/ProductsReport.jsx` — "Productos" tab in Reports (tienda/otro mode only). Units sold, revenue, cost, profit by SKU. Date range, search, sortable columns.
- **Web entry point:** `web/main.jsx` — landing page is eager-loaded (LCP), everything else lazy. Supabase SDK lazy-loaded via dynamic import (only fetches on /pos, /signup, /admin). GA deferred 3s after load. qz-tray only loads on /pos routes.
- **Free trial:** All signups get 7-day Pro MAX trial. Provision API (`web/api/signup/provision.js`) sets `trial_end` and `expires_at` on license.
- **Security headers:** CSP, HSTS with preload, COOP, X-Frame-Options DENY, X-Content-Type-Options nosniff — all in `web/vercel.json`.
- **Images:** WebP format, resized to 2x display size (logo 150px, x-mark 200px). All `<img>` tags have explicit `width`/`height` attributes.
- **SEO:** `<html lang="es-DO">`, hreflang tags, geo.region DO, FAQPage + SoftwareApplication + Organization JSON-LD schemas, `<noscript>` fallback content, Google Analytics (G-WV4EDKWVJP).
- **Web e-CF signing proxy:** `/api/ecf-sign` Vercel serverless function signs e-CFs server-side for web users. Uses ESM ports in `web/lib/` (xml-builder.mjs, xml-signer.mjs, dgii-client.mjs). Desktop pushes PEM cert keys to `businesses.settings` via bizSync. Web client calls proxy transparently via `dgii_ecf` in `web.js`. Auth: Supabase JWT.
- **DGII dependencies:** `dgii-ecf` npm library for seed signing (Signature class with custom Digest that sorts xmlns attributes alphabetically). Project also has `xml-crypto` v6 for e-CF document signing (different from dgii-ecf's bundled v2). Do NOT mix — seed uses dgii-ecf, e-CFs use xml-signer.js with xml-crypto v6.
- **Admin e-CF Status:** `ClientDetail.jsx` shows per-client cert status card (installed, expired, environment, subject, expiry, readiness). Data comes from `businesses.settings` populated by desktop bizSync.
- **Kiosk fullscreen mode (v1.9.9):** Full-screen lockdown mode with ESC exit confirmation — prevents accidental exits during POS operation. Toggle in Settings.
