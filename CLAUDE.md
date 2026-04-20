# Terminal X — POS System

## What This App Is
Full-featured desktop POS for the Dominican Republic market, resold to multiple clients. Flagship differentiator: 100% working e-CF (electronic fiscal receipts) per Ley 32-23.

## Current Release — v2.13.0 (2026-04-20 — Consolidation + fiscal CRITs + receiver security + bug sweep)
- **v2.4.0** — Retail POS categorization (tabs + count badges) + Pedidos Ya channel pricing (one-click toggle, `order_source` stamped on tickets).
- **v2.4.1** — 1024px cash-register grid fix.
- **v2.5.0** — Per-client pricing (`client_item_prices`, precedence: client > PY > base) + Conteo Físico + variance report PDF/CSV + severity-scaled activity log.
- **v2.6.0** — Manager Authorization Card system (Code128 barcode cards, `ManagerAuthGate`, PIN fallback, audit trail).
- **v2.6.1** — CxC ghost-balance fix.
- **v2.7.0** — POS 2-row category tabs + drag-reorder + hide + cloud-sync (`pos_tab_order`, `pos_tab_hidden`).
- **v2.10.x** — CSP strict-dynamic, tickets.rev concurrency, CSRF groundwork, restaurant split-payment parts persistence, inventory oversells ledger, DGII cert expiry alerts, persistent rate limiting.
- **v2.11.0** — Cart-line price edit + Returns flow + persistent strike counter + multi-device ticket locks (Pro MAX) + daily owner digest (Pro MAX) + loyalty points (Pro PLUS/MAX) + offline PWA (Pro MAX) + full RLS audit completion.
- **v2.11.1** / **v2.11.2** — hardening sprints.
- **v2.12.0** — **Tienda subtype templates** (licorería/farmacia/colmado/supermercado/ferretería/papelería/boutique/otro with feature flags + default categories) + `loyalty_transactions` sync desktop↔cloud + admin panel Lealtad/Digest visibility + Terminal X vs STARSISA sales PDF + demo re-seed with v2.11 state + 22/22 Ranoza E2E smoke harness.
- **v2.13.0** — **Licorería dual-source consolidation** (`BUSINESS_TYPES.licoreria` block → `TIENDA_SUBTYPES.licoreria.config`, 4-tier precedence selector in `useBusinessType().licoreriaConfig`, legacy block DEPRECATED v2.13 / deletion v2.14) + **fiscal CRITs**: NCF last-issued decrement (`ncfSequenceDecrementIfLast`) on `ticketVoid` + `queueDelete` (desktop + web parity) and auto-ANECF enqueue on void with classified `ncf_auto_anecf` activity log + confirmed `payment_parts` persistence with cuadre bucket-by-part + **security**: `dgii:cert-pem` IPC owner-role re-verify from DB with critical `cert_pem_export` audit (subject + expiry in metadata), validarcertificado threat-model correction (rewritten `dgii-seed-verify.js` — embedded emisor cert verify + our-nonce issued/consumed gate + RNC extraction, `semilla.js` persists nonces), RLS scoped INSERT on `businesses` + `license_events` with anon revoked, pg_cron enabled + nightly nonce sweep + **bug**: web POS logout "failed to fetch" race fix (`stopOfflineSync()` export + `window.__txResetSupabase()` cache reset wired into `AuthContext` logout).
- **v2.12.2** — Error-handling hardening + cleanup: 10 silent-swallow patches in revenue paths (CobrarModal loyalty redeem/earn, DepositReturnModal compensating reversal, Returns audit surfacing, Loans defaulted/cancel, DealBuilder close warning, POS post-sale, Inventory bulk-delete summary, WorkOrders fallback) + web Kiosk fix (`KioskProvider` wraps POS shell) + dead-code purge (`schema.js`, `print-web.js`, `ef2-proxy/`, `.env.example` EF2 block, stray TODOs) + 12 new `EVENT_META` entries + 9 stale `event_type` renames in seed scripts + 13 `parseInt` radix fixes across 8 files + phone normalizer consolidation in Clients + bcrypt update for ranoza-e2e-smoke (22/22) + audit prompt v2.2.
- **v2.12.1** — Sprint 12 mega-bundle: **CSP strict-dynamic prod-blanker fix**, SQLCipher SQLite at-rest encryption (HKDF/HWID + safeStorage), Sentry telemetry (DSN-gated, PII-scrubbed), nightly SQLite→Supabase backup (3 AM, 14d retention, SQLCipher-aware), DGII EN_PROCESO reconciler + IndicadorEnvioDiferido cleanup, xml-crypto v6 fe receiver port (not yet deployed), inventory clamp symmetry (shortage-aware void reversal), apertura de turno prompt, kiosk idle auto-lock w/ session-preserve PIN, admin License Rebind approval UI, **Loyalty tiers Bronce/Plata/Oro** (lifetime-earned multipliers x1.0/1.25/1.5), **licorería deposit/bottle-return flow**, **WO→ticket bridge (mecánica)**, **DealBuilder→CobrarModal+E31 routing ≥250K (concesionario)**, restaurant mesa bridge (E-C4 fix), print queue USB retry+banner, activity log classification (kiosk/backup/dgii/rebind events), GitHub secret scanning + Dependabot + branch protection on main (signed commits required), training manual sections 28-33, ef2_token dead-field removal, Sidebar polls gated on user.id + tryOr console-error demotion (kills 250+ false E2E errors).

Brand: crimson `#b3001e`/black/white only across Studio X sites. Pedidos Ya pink `#FA0050` appears ONLY inside POS on the PY channel toggle.

## Tienda Subtype System (v2.12 architecture)
`tienda` is the base business_type. Verticals are **subtypes** chosen via `app_settings.tienda_subtype` (licoreria/farmacia/colmado/supermercado/ferreteria/papeleria/boutique/otro). Each subtype is a template at `packages/config/tiendaSubtypes.js` with:
- `features`: map of `{feature_name: boolean}` defaults (age_verification, pedidos_ya, bottle_deposit, prescription_tracking, credit_sales, pricing_by_weight, deli_counter, etc.)
- `defaultCategories`: suggested category list for the vertical
- `es` / `en` display names

Owner overrides a feature per business via `app_settings.feature_<name>_enabled = 'true' | 'false'`. `useBusinessType()` exposes `hasFeature(name)` which reads override first then falls back to subtype preset. When adding a new feature gate, prefer `hasFeature('xxx')` over `isLicoreria`/`isRetail` hardcoded checks.

**v2.13 consolidation — licorería config**: the licorería-specific rules block (`ageVerification`, `bottleDeposit`, `quickSell`, `brandSuggestions`) now lives on `TIENDA_SUBTYPES.licoreria.config` in `tiendaSubtypes.js` — the canonical source of truth. Consumers read it via `useBusinessType().licoreriaConfig`, which prefers the active subtype's `.config`, falls back to the implicit licoreria subtype when `business_type='licoreria'` with no `tienda_subtype` set, and finally to the legacy `BUSINESS_TYPES.licoreria.licoreria` block. The legacy block is marked DEPRECATED v2.13 and scheduled for deletion in v2.14 — do NOT add new fields there. When extending licorería behavior, add fields to `TIENDA_SUBTYPES.licoreria.config` only.

## Plan gating quick-reference (v2.12)
| Feature key | Pro | Pro PLUS | Pro MAX | Notes |
|---|---|---|---|---|
| pos / queue / clients / credits / inventory (basic) | ✓ | ✓ | ✓ | core POS |
| reports | — | ✓ | ✓ | includes products report + margin ITBIS-net |
| credit_notes (also gates Returns) | — | ✓ | ✓ | |
| ecf / dgii | — | ✓ | ✓ | |
| petty_cash / cash_recon | — | ✓ | ✓ | |
| loyalty | — | ✓ | ✓ | per-client points + tiers |
| commissions | — | — | ✓ | |
| whatsapp_receipts | — | — | ✓ | |
| remote_dashboard | — | — | ✓ | also gates activity badge + daily digest |
| multi_location | — | — | ✓ | gates ticket locks |
| offline_mode | — | — | ✓ | gates service worker registration |
Gating lives in `packages/ui/hooks/usePlan.jsx` — add new keys there.

## Tech Stack
- **Electron 41** — desktop shell, IPC bridge
- **React 19 + Vite 5** — UI (JSX, no TS)
- **Tailwind CSS 4** — via `@tailwindcss/vite` plugin (no PostCSS)
- **react-router-dom 7**, **lucide-react 1.7**
- **better-sqlite3** — local DB (sync, main process only)
- **electron-updater** — auto-update via GitHub releases
- CommonJS in `electron/`, ES modules in `packages/`

## Project Structure
```
packages/
  ui/              screens, components, hooks, context, i18n, landing, admin
  services/        printer.js, ecf.js, pdf.js, csv.js, license.js
  data/            electron.js (desktop), web.js (Supabase)
electron/
  main.js          IPC handlers, lifecycle, DGII sync, printing
  preload.js       contextBridge (window.electronAPI + window.printerAPI)
  database.js      all SQLite functions (sync better-sqlite3)
  sync.js          SQLite → Supabase bidirectional sync
  updater.js       electron-updater
  xml-signer.js    RSA-SHA256 (xml-crypto for e-CFs, dgii-ecf for seed)
  xml-builder.js   all 10 e-CF types + RFCE + ANECF
  dgii-client.js   DGII API (auth, submit, status, QR, ANECF void)
  cert-manager.js  .p12 loading + info
web/
  api/             Vercel serverless (panel.js, validate.js, rnc.js, signup/)
  api/fe/          DGII receiver endpoints
vite.config.mjs, vite.web.config.mjs
```

## IPC Pattern
Renderer → `window.electronAPI.module.method()` → preload `contextBridge` → `ipcMain.handle()` in `main.js`. Printer API separate: `window.printerAPI.print(buffer)`, `openDrawer()`.

## Database (SQLite — better-sqlite3)
All `electron/database.js` functions synchronous. Key tables: businesses, users/staff, services, tickets, ticket_items, clients, credit_payments, washers, sellers, ncf_sequences, cuadre, caja_chica, notas, rnc_contribuyentes, empleados, inventory_items, activity_log.
- `empleados.role` = access control; `empleados.tipo` (lavador/vendedor/cajero/hybrid) = payroll/commission. Independent axes.
- `users.employee_id` FK to empleados — links login to employee record.
- `services.no_commission` — exempts from commission calc.

## Fiscal / e-CF (Dominican Republic)
- **CERTIFIED Emisor Electrónico** (DGII Direct). RNC 133410321, Viafirma .p12.
- **Legacy**: B01/B02 paper NCF sequences (still supported).
- **e-CF**: E31/E32/E33/E34… mandatory after May 15 2026.
- **CodigoSeguridad**: `SignatureValue[0:6]` (raw base64, NO SHA-256).
- **QR URL**: `ecf.dgii.gov.do/{env}/ConsultaTimbre` (E32<250K → `fc.dgii.gov.do/{env}/ConsultaTimbreFC`). E43/E47 omit `RncComprador`.
- Receiver endpoints LIVE at fe.terminalxpos.com (VPS Express) + Vercel backup in `web/api/fe/`.
- **Production switch**: change `dgii_environment` from `certecf` to `ecf` + install .p12.
- **Seed auth**: `dgii-ecf` lib's `Signature` class (namespace-sorted digest). POST `multipart/form-data`. e-CF submission stays raw `application/xml`.
- **IndicadorEnvioDiferido**: set to `1` on offline-queued e-CFs resubmitted by `processDgiiQueue()` (72h deferred rule).
- **ANECF (voiding)**: `submitANECF()` voids unused ranges. UI in DGII.jsx tab 3. IPC `dgii:void-sequence`.
- **Cert status sync**: desktop sends cert info to Supabase via `bizSync` during license validation → `businesses.settings`. Admin panel renders per-client e-CF Status card.
- **DGII deps**: `dgii-ecf` for seed signing ONLY; `xml-crypto` v6 for e-CF signing via `xml-signer.js`. Do NOT mix.

## RNC Lookup
`useRNC()` in `packages/ui/hooks/useRNC.js`. Order: local `rnc_contribuyentes` → megaplus.com.do fallback. Full DGII sync (900K records) in Settings → e-CF.

## Printing (ESC/POS)
`packages/services/printer.js`. 80mm thermal = **42 chars/line** (COL_WIDTH). Code Page 858. ASCII separators only. Cash drawer only on cash payment. Print fires AFTER DB persist (Queue) / BEFORE modal close (POS) so cashier sees change.

## Roles & Permissions
- Roles: owner, manager, cfo, accountant, cashier, none.
- Stored on `empleados.role` (not `users`). AuthContext `resolveRole()` joins users → empleados at login.
- Gated via `useAuth()` + permissions map in Settings.jsx.

## License System
- Key: `TXL-XXXX-XXXX-XXXX`. HWID = SHA256(MAC + hostname), stored in userData/hwid.json.
- Offline grace: 72h cached. LicenseContext denies fresh installs without prior validation.
- Supabase: plans, licenses, license_events, admin_users.
- Vercel API: `/api/validate`, `/api/panel`.
- Support WhatsApp: `+18098282971`.

## SaaS Infrastructure
- **Admin panel** `/admin` — Dashboard/Clients/ClientDetail/Licenses/Team/Certifications.
- **Landing** `/` — Pro RD$2,490 / Pro PLUS RD$4,490 / Pro MAX RD$6,990. Annual 15% OFF. 7-day Pro MAX trial on all signups.
- **Signup** `/signup` → pending → admin activates.
- **Remote config**: `validate.js` returns `remoteConfig`, desktop syncs every 4h.
- **Plan gating**: `usePlan()` + `PlanGate` (dev override forces pro_max).
- **Feature keys**: pos, queue, clients, credits, reports, ecf, dgii, petty_cash, credit_notes, cash_recon, inventory, remote_dashboard, commissions, whatsapp_receipts.
- **e-CF Certification as a Service** — studioxrdtech.com/ecf-certification.

## Build Commands
```bash
npm run dev          # Vite + Electron concurrent dev
npm run dev:web      # Web PWA dev
npm run build:web    # Web PWA build
npm run dist:win     # Windows installer
npm run dist:mac     # macOS DMG
```

## Web Deploy (terminalxpos.com)
```bash
cd "A:\Studio X HUB\Terminal X"
npm run build:web
echo '{"private":true,"type":"module","dependencies":{"@supabase/supabase-js":"^2.49.4","xml-crypto":"^2.1.5","@xmldom/xmldom":"^0.8.6","jsonwebtoken":"^9.0.2","dgii-ecf":"^1.6.8","node-forge":"^1.3.3","busboy":"^1.6.0"}}' > dist-web/package.json
cp web/vercel.json dist-web/
mkdir -p dist-web/api/signup dist-web/api/fe dist-web/api/digest dist-web/lib dist-web/.vercel
cp web/api/panel.js web/api/validate.js web/api/rnc.js web/api/ecf-sign.js web/api/dgii-cert-upload.js web/api/staff-verify-auth.js dist-web/api/
cp web/api/signup/provision.js dist-web/api/signup/
cp web/api/fe/semilla.js web/api/fe/validarcertificado.js web/api/fe/recepcion.js web/api/fe/aprobacion.js dist-web/api/fe/
cp web/api/digest/daily.js dist-web/api/digest/
cp web/lib/xml-builder.js web/lib/xml-signer.js web/lib/dgii-client.js web/lib/rate-limit.js dist-web/lib/
echo '{"projectId":"prj_AjhpUcrbNGuSWZrs9CLxQmKkGXnL","orgId":"team_J0ZQKmOPRiXDLC7I1RA00PM9"}' > dist-web/.vercel/project.json
cd dist-web && npm install --silent && npx vercel --prod --yes
```

## Desktop Release Gotchas (learned the hard way v2.11/2.12)
- **`gh release upload` reports 404 on 220MB .exe but the upload actually succeeds.** Always verify with `gh release view v<ver> --json assets` before retrying — a retry fails with `already_exists`. Pattern: create release first, upload assets separately, verify list.
- **`npm run dev` races `dist:win`.** If the Electron dev server is running in another terminal, it watches `dist/` and overwrites the freshly-built installer within ~30 s. Workaround: immediately after `npm run dist:win`, copy the 3 artifacts (.exe, latest.yml, .blockmap) into a `release-staging/` folder, then release from there. Delete staging after.
- **Vercel Hobby cap: 12/12 functions.** Reached in v2.11. No new files in `web/api/` allowed — consolidate new endpoints into `web/api/panel.js?action=<name>` pattern and add a case to the switch.

## Hostinger VPS (root@srv1528760, 187.124.152.42)
Hosts DGII e-CF Receiver (fe.terminalxpos.com, Express:3100) and Content X. Claude Code installed — SSH in and run `claude`.

## Key Rules
1. Read a file before editing it
2. `require()` in electron/, `import` in packages/
3. No fake/demo/placeholder data
4. No artificial delays (fake loading setTimeout)
5. No debug console.log in production
6. ESC/POS buffer stays binary — never mix unicode
7. Supabase uses UUIDs — never `parseInt()` on Supabase IDs
8. Web user ID may be `'web'` — guard `(user?.id && user.id !== 'web') ? user.id : null`
9. All Vercel API routes use ESM (`export default`)
10. Vercel Hobby = 12 serverless function cap — admin consolidated in `panel.js?action=`
11. Deploy commands / SQL / code blocks as single long lines for copy-paste

## Data Architecture — supabase_id (MANDATORY)
Every synced table uses the **supabase_id** pattern:
- SQLite: `id INTEGER PRIMARY KEY` + `supabase_id TEXT` (UUID v4)
- Supabase: `id UUID PRIMARY KEY` + `supabase_id UUID UNIQUE`
- Desktop generates UUID at record creation (`crypto.randomUUID()`).
- Sync upserts on `(business_id, supabase_id)`.
- FK refs via `*_supabase_id` columns (e.g., `ticket_supabase_id`).
- **Never** `local_id` / `local_*_id` — deprecated.
- `electron/sync.js` pushes every 5 min + on sale/payment/void. `packages/services/sync.js` is DELETED.
- `updated_at` + triggers on ALL synced tables. Sync pass 2 uses `updated_at > last_synced_at`.
- **Dual-key joins in `web.js`**: join on BOTH `ticket_id` AND `ticket_supabase_id` (same for client/washer/seller) so web-created and desktop-synced rows both resolve.
- `users` is a VIEW on `staff` base table (has `supabase_id`, `cedula`, `start_date`).

## Architecture Notes
- **Monorepo**: npm workspaces + Vite aliases. `.mjs` vite configs avoid ESM/CJS conflict with CommonJS electron.
- **Dark mode**: Tailwind `dark:` variants. Pattern `bg-white → dark:bg-white/5`, `bg-slate-50 → dark:bg-black`, `text-slate-800 → dark:text-white`, `border-slate-200 → dark:border-white/10`.
- **e-CF flow**: CobrarModal → `signAndSubmitECF()` → IPC `dgii:submit` → builder + signer + client → DGII. `CobrarModal` fires `onConfirm()` IMMEDIATELY after ECF success via `confirmedRef` guard — never waits for success view close. Offline queue rebuilds XML with `IndicadorEnvioDiferido=1` and re-signs.
- **Error handling**: `web.js` has `tryOr()` (reads, fallback) and `tryWrite()` (mutations, throws). Global `window.onerror` + `unhandledrejection` in `main.jsx`.
- **RLS**: enabled on all Supabase tables. Anon policies require `business_id IS NOT NULL`. Service role (desktop sync) bypasses.
- **Business Type System**: `useBusinessType()` + `BusinessTypeProvider`. Stores `business_type` in `app_settings` (`carwash` | `tienda` | `otro`). Switches POS between `CarWashPOS` and `RetailPOS`. Sidebar nav filters via `businessTypes` prop. Settings → Tipo de Negocio. FirstTimeSetup Step 1 includes selector.
- **Retail POS**: barcode/SKU search, product grid from inventory, services tab for hybrid, qty +/- cart. Uses `api.inventory.search()`/`lookupSku()`. Tickets store `quantity`, `sku`, `inventory_item_id`. Auto-deducts stock on sale, reverses on void. CobrarModal/printer/PDF quantity-aware.
- **Employee consolidation**: Lavadores/Vendedores/Cajeras tabs REMOVED from Admin. Admin.jsx = Mi Empresa / Usuarios / Servicios. Usuarios simplified (pick employee + username + PIN). All employee mgmt (role/commission/tipo) lives in Empleados screen (top-level sidebar → `/empleados`). Nominas tab removed from Reportes.
- **Settings structure**: Sistema.jsx tabs = Preferencias / Actualizaciones / Licencias TX. Mi Empresa has collapsibles (WhatsApp, Fiscal/NCF, Respaldo/Nube). Preferencias includes Impresion. Sidebar = 8 config children (down from 13).
- **Nómina**: `packages/ui/screens/reports/nomina/`. Libs: `lib/isr.js` (DR 2026 brackets), `lib/tss.js` (SFS/AFP/INFOTEP caps), `lib/payPeriod.js`, `lib/calcLiquidacion.js` (Ley 16-92). Supports commission-only + hybrid.
- **CSV Import**: Inventory "Importar CSV" — CSV/TSV parse, auto-map columns (ES+EN headers), preview with re-map, bulk insert. SKU/Barcode/Name/Category/Price/Cost/Stock/Min Stock.
- **Products Report**: `reports/ProductsReport.jsx` — tienda/otro mode only. Units sold / revenue / cost / profit by SKU.
- **Web entry**: `web/main.jsx` — landing eager-loaded (LCP), rest lazy. Supabase SDK lazy-loaded (/pos, /signup, /admin). GA deferred 3s. qz-tray only on /pos.
- **Free trial**: signups get 7-day Pro MAX via `web/api/signup/provision.js` (`trial_end`, `expires_at`).
- **Security headers**: CSP, HSTS preload, COOP, X-Frame-Options DENY, X-Content-Type-Options nosniff (all in `web/vercel.json`).
- **Images**: WebP, resized to 2x display size. All `<img>` have explicit `width`/`height`.
- **SEO**: `<html lang="es-DO">`, hreflang, geo.region DO, FAQPage/SoftwareApplication/Organization JSON-LD, `<noscript>` fallback, GA (G-WV4EDKWVJP).
- **Web e-CF signing proxy**: `/api/ecf-sign` signs server-side for web users. ESM ports in `web/lib/` (xml-builder.mjs, xml-signer.mjs, dgii-client.mjs). Desktop pushes PEM cert keys to `businesses.settings` via bizSync. Web client calls proxy transparently via `dgii_ecf` in `web.js`. Auth: Supabase JWT.
- **Admin e-CF Status**: `ClientDetail.jsx` renders cert status card (installed/expired/env/subject/expiry/readiness) from `businesses.settings`.
- **Kiosk fullscreen**: lockdown mode with ESC exit confirmation. Toggle in Settings.
- **Owner Activity Feed**: append-only audit log. Table `activity_log` (SQLite + Supabase), synced FWW with JSON `metadata`. Helpers in `electron/database.js`: `setActiveUser({id,name,role})` (called from AuthContext on login), `activityLogRecord({event_type,severity,target_type,target_id,target_name,amount,old_value,new_value,reason,metadata})`, `activityLogList({dateFrom,dateTo,eventTypes,limit})`. IPC: `activity:set-actor`, `activity:list`. Web writes via `logActivity()` helper in `packages/data/web.js`. UI: **Actividad** tab on `RemoteDashboard.jsx` (owner/cfo/accountant) — 9 filter chips, 30-day window, severity rail (info/warn/critical → slate/amber/red), expandable rows with old→new diff + metadata JSON. Covers: user deletions, service deletions/price changes, ticket voids, notas de crédito, nómina payouts, big discounts (>RD$500 or >15%), inventory adjustments, caja chica withdrawals, cuadre discrepancies (>RD$50). Adding new audited events: call `activityLogRecord` at mutation site + add event_type to `EVENT_META` + filter chip in `RemoteDashboard.jsx`. Never raw-INSERT into `activity_log` — always route through helper.
