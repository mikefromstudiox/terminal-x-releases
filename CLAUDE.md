# Terminal X — POS System

## Mission
Desktop + web POS for the Dominican Republic, resold to multiple verticals. Flagship: **CERTIFIED DGII Emisor Electrónico** (e-CF, Ley 32-23). RNC 133410321, Viafirma .p12.

## ⚠️ READ FIRST — verification-before-claim protocol

This codebase has been bitten multiple times by code-grep-only diagnoses that turned out to be wrong about the deployed schema. Examples shipped, then reverted:
- A "partial unique index" that didn't exist (constraint was 3-col NULLS NOT DISTINCT).
- An `app_metadata`-vs-`user_metadata` RLS migration that was already applied via Management API.
- An `atomic_next_ncf` "broken signature" that was actually correct.

**Before you claim a bug that depends on schema, RLS, function signature, trigger, or constraint shape: VERIFY against live `pg_catalog`.** Code-grep + migration files lie. The deployed DB is the only truth.

How:
1. Open `docs/SCHEMA-SNAPSHOT.md` first. That file is the snapshot of every public table, constraint, RLS policy, function, trigger, and the realtime publication. Re-generate via `node scripts/schema-snapshot.mjs` if it looks stale.
2. If a finding still requires a live check, query via Management API:
   - `POST https://api.supabase.com/v1/projects/csppjsoirjflumaiipqw/database/query` with body `{"query": "SELECT ..."}` and `Authorization: Bearer $SUPABASE_ACCESS_TOKEN` (in `.env`).
   - Examples: `pg_constraint` for UNIQUE/CHECK shapes, `pg_policies` for RLS bodies, `pg_proc` for function signatures, `information_schema.columns` for column types.
3. Every audit finding that names a constraint / policy / function MUST paste-and-run the verification query and capture the output as evidence. No exceptions.
4. Before writing a migration: run the verification query, confirm the targeted object exists in the claimed shape. If it doesn't, your bug isn't real.

This rule applies to:
- Spawned audit agents (include the verification clause in every prompt)
- Code-review of proposed migrations
- Any "fix" that reshapes a constraint, RLS policy, function signature, or trigger

## Stack
- **Electron 41** + **React 19 + Vite 5** (JSX, no TS) + **Tailwind 4** (`@tailwindcss/vite` — no PostCSS)
- **better-sqlite3** at-rest encrypted with **SQLCipher** (HKDF/HWID + safeStorage). Use `better-sqlite3-multiple-ciphers` + derived key for any local-DB script.
- **react-router-dom 7**, **lucide-react 1.7**, **electron-updater** (GitHub releases)
- CommonJS in `electron/`, ES modules everywhere else.

## Layout
```
packages/
  ui/        screens, components, hooks, context, i18n, landing, admin
  services/  printer.js, ecf.js, pdf.js, csv.js, license.js, sync.js (DELETED — see electron/sync.js)
  data/      electron.js (desktop), web.js (Supabase)
  config/    tiendaSubtypes.js, businessTypes.js
electron/
  main.js          IPC handlers, lifecycle
  preload.js       contextBridge → window.electronAPI / window.printerAPI
  database.js      ALL SQLite functions (sync better-sqlite3)
  sync.js          SQLite ↔ Supabase bidirectional sync (every 5min + on sale/payment/void)
  xml-builder.js   all 10 e-CF types + RFCE + ANECF
  xml-signer.js    RSA-SHA256 (xml-crypto v6 for e-CFs, dgii-ecf for seed) — DO NOT MIX
  dgii-client.js   DGII API
  cert-manager.js  .p12 loading
web/
  api/             Vercel serverless (12-function Hobby cap — currently 9/12)
  lib/             ESM ports of xml-builder/xml-signer/dgii-client/rate-limit
vite.config.mjs (desktop), vite.web.config.mjs (PWA)
scripts/
  rls-policy-audit.mjs       MUST RUN before every release
  ranoza-e2e-smoke.mjs       22-scenario web E2E harness (~10s)
```

## Hard Rules
1. Read a file before editing.
2. `require()` in `electron/`, `import` everywhere else.
3. No fake/demo/placeholder data, no debug `console.log`, no `setTimeout` fake delays.
4. ESC/POS buffers stay binary — never mix unicode.
5. Supabase uses UUIDs — **never** `parseInt()` on Supabase IDs.
6. Web user ID may be `'web'` — guard `(user?.id && user.id !== 'web') ? user.id : null`.
7. All Vercel API routes use ESM (`export default`).
8. New endpoints go in `panel.js?action=` or `fe.js?action=` switch — Hobby cap is 12.
9. Single long lines for SQL / deploy / curl blocks (copy-paste friendly).
10. No fake demo creds. Real demo handed out 1-on-1 over WhatsApp; in-app `/demo/:vertical` was killed 2026-04-25.
11. Brand: black, white, `#b3001e` crimson only — no gray. Pedidos Ya pink `#FA0050` ONLY on PY channel toggle.
12. All user-facing text Spanish (es-DO).
13. Never add `Co-Authored-By: Claude` or any Anthropic attribution to commits.
14. PR commits to `main` must be signed (branch protection). Mike pushes, not Claude.

## supabase_id Architecture (MANDATORY for every synced table)
- SQLite: `id INTEGER PRIMARY KEY` + `supabase_id TEXT` (UUID v4 from `crypto.randomUUID()` at insert).
- Supabase: `id UUID PRIMARY KEY` + `supabase_id UUID UNIQUE`.
- Sync upserts on `(business_id, supabase_id)`.
- FK refs via `*_supabase_id` columns (e.g. `ticket_supabase_id`).
- **Never** `local_id` / `local_*_id` (deprecated).
- `updated_at` + trigger on every synced table. Sync pass 2 uses `updated_at > last_synced_at`.
- **Dual-key joins in `web.js`**: filter on BOTH integer FK AND `*_supabase_id` so web-created and desktop-synced rows resolve.
- Every web `INSERT` MUST set `supabase_id = crypto.randomUUID()` or row is invisible to desktop pull.
- `users` is a VIEW on `staff` base table (has `supabase_id`, `cedula`, `start_date`).
- After ANY sync.js change, create matching Supabase migration in `migrations/` — Supabase silently drops unknown columns.
- Real `UNIQUE CONSTRAINT` (not partial index) for `on_conflict` targets — PostgREST rejects partial indexes.
- Embed Supabase anon key as fallback in installer or sync dies on every fresh client install.
- Use Management API (`SUPABASE_ACCESS_TOKEN` in `.env`) or service-role key for autonomous SQL — never ask Mike to run it. Legacy anon/service-role keys CANNOT be rotated.

## IPC Pattern
Renderer → `window.electronAPI.module.method()` → preload `contextBridge` → `ipcMain.handle()` in `main.js`. Printer API separate: `window.printerAPI.print(buffer)`, `openDrawer()`.

## Database (better-sqlite3, sync API)
All `electron/database.js` functions synchronous. Key tables: businesses, users/staff, services, tickets, ticket_items, clients, credit_payments, ncf_sequences, cuadre, caja_chica, notas, rnc_contribuyentes, empleados, inventory_items, activity_log + vertical-specific (vehicle_inventory, sales_deals, restaurant_reservations, service_recipe_items, etc).
- `empleados.role` = access control. `empleados.tipo` (lavador/vendedor/cajero/hybrid) = payroll/commission. **Independent axes**.
- `users.employee_id` FK to empleados — links login to employee record.
- `services.no_commission` exempts from commission calc.
- `services.in_stock` = 86-list flag (restaurant). `services.aplica_itbis` excludes from ITBIS line.

## Roles & Permissions
- Roles (on `empleados.role`): owner, manager, cfo, accountant, cashier, kitchen, none.
- AuthContext `resolveRole()` joins users → empleados at login.
- Gated via `useAuth()` + permissions map in `Settings.jsx`.
- **Manager Authorization Card**: Code128 barcode cards or PIN fallback via `ManagerAuthGate`. Always emit `activityLogRecord`.

## Plan gating (`packages/ui/hooks/usePlan.jsx`)
| Feature key | Pro | PLUS | MAX |
|---|---|---|---|
| pos / queue / clients / credits / inventory | ✓ | ✓ | ✓ |
| reports / credit_notes / ecf / dgii / petty_cash / cash_recon / loyalty | — | ✓ | ✓ |
| appointments / stylist_schedules | — | ✓ | ✓ |
| commissions / whatsapp_receipts / remote_dashboard / multi_location / offline_mode | — | — | ✓ |
| salon_preferred_stylist | ✓ | ✓ | ✓ |
| salon_walk_in / memberships / public_booking / dashboard / whatsapp_reminders | — | ✓ | ✓ |
| salon_no_show_deposit / offline_whatsapp_queue | — | — | ✓ |
| concesionario_resumen / carniceria_resumen | ✓ | ✓ | ✓ | (upgrade-hook tiles) |
| dealership core (vehicle_inventory / sales_pipeline / test_drives / deal_builder / matriculas / reservations / warranties / preapprovals / concesionario_reports) | — | ✓ | ✓ |
| dealership Pro MAX (intrant_api / whatsapp_auto) | — | — | ✓ |
| carniceria_corte_catalog / mayoreo / freshness_alerts | — | ✓ | ✓ |
| restaurant_reservations / restaurant_salon_dashboard | — | ✓ | ✓ |

## Tienda Subtype System (v2.12 architecture)
`tienda` = base business_type. Verticals are **subtypes** chosen via `app_settings.tienda_subtype` (licoreria / farmacia / colmado / supermercado / ferreteria / papeleria / boutique / otro). Templates at `packages/config/tiendaSubtypes.js` with `features`, `defaultCategories`, `es`/`en` names.
- Owner overrides per-business via `app_settings.feature_<name>_enabled = 'true' | 'false'`.
- `useBusinessType().hasFeature(name)` reads override → falls back to subtype preset.
- Prefer `hasFeature('xxx')` over hardcoded `isLicoreria`/`isRetail` checks.
- Licorería rules block (`ageVerification`, `bottleDeposit`, `quickSell`, `brandSuggestions`) lives on `TIENDA_SUBTYPES.licoreria.config` — read via `useBusinessType().licoreriaConfig`. Legacy `BUSINESS_TYPES.licoreria.licoreria` block is DEPRECATED v2.13, deleted v2.14 — do not add fields.
- `app_settings` is keyed at the business level; ensure `business_id` + `updated_at` columns and that the key is in sync.js push descriptors. Local-only `app_settings` rows do not propagate.
- City stored as both `ciudad` and `biz_city` in `businesses.settings` JSON. Read/write both.

## Verticals
- **carwash** — default. `CarWashPOS` + Lavadores/queue.
- **tienda** + 8 subtypes — `RetailPOS` (barcode/SKU + product grid + services tab for hybrid). Per-client pricing precedence: client > Pedidos Ya > base.
- **restaurant** — `RestaurantPOS` + KDS + mesas + Reservas + Resumen del Salón. Pre-cuenta print (no drawer kick), 10% Servicio (Ley 16-92), course pacing, 86-list, ManagerAuthGate on void of fired-to-kitchen items, mesa transfer/merge, BOM service recipes auto-deducting inventory.
- **salon / barberia** — Appointments + stylist_schedules + memberships + walk-ins + public booking.
- **mecanica** — WO → ticket bridge.
- **concesionario** — VehicleInventory, SalesPipeline (kanban + lead scoring), TestDrives, DealBuilder (UAF + E31 RNC guard + dynamic ITBIS + QuotePdfModal + AppraisalChecklist), Matriculas (INTRANT website-lookup stub for Pro MAX), Reservations, Warranties, Preapprovals. Reports: Commissions, Aging, Funnel. WhatsApp triggers in `whatsapp-dealership.js` (wa.me deep links by default; `sendAutomatic` from `whatsapp-business-stub.js` once WABA approved).
- **carniceria** — Corte catalog, mayoreo, freshness alerts.

## Fiscal / e-CF (Dominican Republic)
- **CERTIFIED Emisor Electrónico**. Production switch: change `dgii_environment` from `certecf` to `ecf` + install .p12.
- **Legacy NCF**: B01/B02 paper. 8-digit pad, 11-char total.
- **e-CF**: E31/E32/E33/E34/E43/E47… 10-digit pad, 13-char total. Mandatory after May 15 2026.
- **CodigoSeguridad** = `SignatureValue[0:6]` (raw base64, NO SHA-256).
- **QR URL**: `ecf.dgii.gov.do/{env}/ConsultaTimbre`. E32 < RD$250K → `fc.dgii.gov.do/{env}/ConsultaTimbreFC`. E43/E47 omit `RncComprador`.
- **Seed auth**: `dgii-ecf` lib's `Signature` class (namespace-sorted digest). POST `multipart/form-data`. e-CF submission stays raw `application/xml` EXCEPT RFCE (E32 < 250K) which needs `multipart/form-data` (file field name `xml`, filename `{RNC}{eNCF}.xml`).
- **Emisor registry match**: RNC 9 digits no dashes. RazonSocial uppercase matching DGII registry exactly. FechaEmision dd-mm-yyyy. Postulación is env-scoped.
- **IndicadorEnvioDiferido=1**: offline-queue resubmit (72h deferred rule). Re-sign on rebuild.
- **NCF last-issued decrement**: `ncfSequenceDecrementIfLast` on `ticketVoid` + `queueDelete` (desktop + web parity).
- **ANECF (voiding)**: `submitANECF()` voids unused ranges. Auto-enqueue on void with `ncf_auto_anecf` activity log. UI in DGII.jsx tab 3.
- **Cert sync**: desktop pushes cert info to `businesses.settings` via `bizSync` during license validation. Admin panel renders e-CF Status card per client.
- **`dgii:cert-pem` IPC**: owner-role re-verify from DB. Always emit `cert_pem_export` critical activity log with subject + expiry.
- **`dgii-seed-verify.js`** (web): embedded emisor cert verify + our-nonce issued/consumed gate + RNC extraction. `semilla.js` persists nonces. `pg_cron` runs nightly nonce sweep.
- **DGII deps**: `dgii-ecf` for seed signing ONLY; `xml-crypto` v6 for e-CF signing via `xml-signer.js`. Do NOT mix.
- **Receivers**: LIVE at `fe.terminalxpos.com` (Hostinger VPS Express:3100) + Vercel backup at `web/api/fe.js` — single function routing semilla/validarcertificado/recepcion/aprobacion via `?action=`. Old `/fe/...` URLs preserved via `vercel.json` rewrites.
- **Web e-CF signing proxy**: `/api/ecf-sign` signs server-side. Auth via Supabase JWT.
- **Parallel XML generators** drift risk: `tools/cert-step4` and `electron/xml-builder.js`. Add a golden-diff test on any change to either.

## RNC Lookup
`useRNC()` in `packages/ui/hooks/useRNC.js`. Order: local `rnc_contribuyentes` → megaplus.com.do fallback. Full DGII sync (~900K records) in Settings → e-CF.

## Printing (ESC/POS)
`packages/services/printer.js`. 80mm thermal = **42 chars/line** (`COL_WIDTH`). Code Page 858. ASCII separators only. Cash drawer ONLY on cash payment. Print fires AFTER DB persist (Queue) / BEFORE modal close (POS) so cashier sees change. Pre-cuenta NEVER opens drawer (no `DRAWER_KICK` byte).
- Drawer kick variant captured from client's existing POS via print-spool capture (universal onboarding technique). 3 StarSISA pulses live in v2.3.23 "Probar Variantes".
- StarSISA tickets often DUPLICATE — commission import MUST dedupe pairs.
- DR margin display: divide price by 1.18 when `aplica_itbis=true` (ex-ITBIS).

## License System
- Key: `TXL-XXXX-XXXX-XXXX`. HWID = SHA256(MAC + hostname), stored in `userData/hwid.json`.
- Offline grace: 72h cached. LicenseContext denies fresh installs without prior validation.
- Tables: plans, licenses, license_events, admin_users.
- Vercel: `/api/validate`, `/api/panel`. Support WhatsApp `+18098282971`.

## SaaS Infrastructure
- **Admin** `/admin` — Dashboard / Clients / ClientDetail / Licenses / Team / Certifications. ClientDetail renders e-CF Status card (installed/expired/env/subject/expiry/readiness) from `businesses.settings`.
- **Landing** `/` — Pro RD$2,490 / Pro PLUS RD$4,490 / Pro MAX RD$6,990. Annual 15% OFF. 7-day Pro MAX trial on signup.
- **Signup** `/signup` → pending → admin activates. Free trial via `web/api/signup/provision.js` (`trial_end`, `expires_at`).
- **Remote config**: `validate.js` returns `remoteConfig`, desktop syncs every 4h.
- **e-CF Certification as a Service**: studioxrdtech.com/ecf-certification.

## Activity Log (audit trail)
Append-only `activity_log` (SQLite + Supabase, FWW sync, JSON `metadata`). Helpers in `electron/database.js`: `setActiveUser({id,name,role})`, `activityLogRecord({event_type,severity,target_type,target_id,target_name,amount,old_value,new_value,reason,metadata})`, `activityLogList({dateFrom,dateTo,eventTypes,limit})`. IPC: `activity:set-actor`, `activity:list`. Web writes via `logActivity()` in `web.js`. UI: **Actividad** tab on `RemoteDashboard.jsx` (owner/cfo/accountant), 30-day window, severity rail (info/warn/critical → slate/amber/red).
- Adding new audited events: call `activityLogRecord` at mutation site → add `event_type` to `EVENT_META` → add filter chip in `RemoteDashboard.jsx`.
- **Never** raw-INSERT into `activity_log` — always route through helper.

## RLS (mandatory before every release)
Run `node scripts/rls-policy-audit.mjs`. Connects via `SUPABASE_ACCESS_TOKEN` (Management API) or `SUPABASE_SERVICE_ROLE_KEY` (RPC fallback) from `.env`. Fails (exit 1) on RLS-enabled tables with zero `pg_policies` — those 42501-reject anon and authenticated.
- New synced tables MUST ship with policies, anon revoked from writes, scoped by `business_id`.
- Anon SELECT policies require `business_id IS NOT NULL`. Service role (desktop sync) bypasses RLS.
- `staff` SELECT policy missing once → byPin null → TEMP_OWNER fallback. Audit ALL RLS-enabled tables.
- PostgREST `.or()` filter gotcha: `.or('col.is.null,col.not.like.X')` matches ALL rows for destructive ops. Use SELECT → DELETE-by-id.

## Data Layer (web.js)
- `tryOr()` (reads, fallback) and `tryWrite()` (mutations, throws). Global `window.onerror` + `unhandledrejection` in `main.jsx`.
- e-CF flow: CobrarModal → `signAndSubmitECF()` → IPC `dgii:submit` → builder + signer + client → DGII. `confirmedRef` guard fires `onConfirm()` IMMEDIATELY after ECF success — never waits for success view close.
- Logout race fix: `stopOfflineSync()` export + `window.__txResetSupabase()` cache reset wired into `AuthContext` logout.
- Sidebar polls gated on `user.id` to avoid pre-login bursts.
- Dark mode: Tailwind `dark:` variants. `bg-white → dark:bg-white/5`, `bg-slate-50 → dark:bg-black`, `text-slate-800 → dark:text-white`, `border-slate-200 → dark:border-white/10`.

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
echo '{"private":true,"type":"module","dependencies":{"@supabase/supabase-js":"^2.49.4","xml-crypto":"^2.1.5","@xmldom/xmldom":"^0.8.6","jsonwebtoken":"^9.0.2","dgii-ecf":"^1.6.8","node-forge":"^1.3.3","busboy":"^1.6.0","bcryptjs":"^2.4.3"}}' > dist-web/package.json
cp web/vercel.json dist-web/
mkdir -p dist-web/api/signup dist-web/api/digest dist-web/lib dist-web/.vercel
cp web/api/panel.js web/api/validate.js web/api/rnc.js web/api/ecf-sign.js web/api/dgii-cert-upload.js web/api/staff-verify-auth.js web/api/fe.js dist-web/api/
cp web/api/signup/provision.js web/api/signup/lead.js dist-web/api/signup/
cp web/api/digest/daily.js dist-web/api/digest/
cp web/lib/*.js dist-web/lib/  # sync ALL libs — cherry-picking caused FUNCTION_INVOCATION_FAILED when new lib files (salon-wa-templates.js, dgii-seed-verify.js) were added without updating this line. Wildcard prevents recurrence.
cp web/middleware.js dist-web/middleware.js
echo '{"projectId":"prj_AjhpUcrbNGuSWZrs9CLxQmKkGXnL","orgId":"team_J0ZQKmOPRiXDLC7I1RA00PM9"}' > dist-web/.vercel/project.json
cd dist-web && npm install --silent && npx vercel --prod --yes
```
Catch-all SPA rewrite blocks `sitemap.xml` / `robots.txt` — add explicit rewrites first. Every deploy wipes `dist-web/.vercel/project.json` — re-run the full chain.

## Desktop Release Gotchas (load-bearing)
- `gh release upload` reports 404 on 220MB .exe but the upload **actually succeeds**. Verify with `gh release view v<ver> --json assets` before retrying — a retry fails with `already_exists`. Pattern: create release first, upload assets separately, verify.
- `npm run dev` races `dist:win`. Dev server overwrites the freshly-built installer in `dist/` within ~30s. Workaround: copy `.exe` + `latest.yml` + `.blockmap` into `release-staging/` immediately after `npm run dist:win`, release from there.
- Releases MUST include `.exe` + `latest.yml` + `.blockmap`. Missing `latest.yml` breaks auto-update.
- Branch protection on `main`: signed commits required. Mike pushes — Claude cannot.
- Installer stays in `dist/` — never copy to Desktop.

## Hostinger VPS (root@srv1528760, 187.124.152.42)
Hosts DGII e-CF Receiver (`fe.terminalxpos.com`, Express:3100) and Content X. Claude Code installed — SSH in and run `claude`.

## Verifying changes
- TS/lint: `mcp__ide__getDiagnostics`.
- Build: `npm run build:web` or `npx vite build` (catches imports/syntax).
- Server: `curl http://localhost:<port>` after dev start.
- Electron: `npm run dev`, watch exit codes + Vite output.
- Ranoza E2E smoke: `node scripts/ranoza-e2e-smoke.mjs` (22 scenarios, ~10s).
- Tier 1 audit-flows harness: `node scripts/audit-flows.mjs` — schema-payload contract + side-effect rules + LWW sync + RLS. See `scripts/audit-flows.README.md`. Three-script release gate alongside `rls-policy-audit.mjs` and `ranoza-e2e-smoke.mjs`.
- Skip verification ONLY for: doc-only edits, git ops, single-line obvious fixes on a passing build.

## Current Release — v2.16.9 (2026-04-27)
RLS sync JWT fix (critical, system-wide).

Recent (release notes detail in `git log` + `memory/project_release_history.md`):
- **v2.16.8** — PG17 optimization sprint: GIN(jsonb_path_ops) on hot jsonb cols, BRIN(created_at) on append-mostly tables, `transaction_timeout` per-role, autovacuum tuning, server-side `sync_merge_upsert` RPC behind `sync_use_merge_v17` flag (default OFF, auto-fallback). Health 97 → ~99.5.
- **v2.16.3** — Restaurante hardening: course pacing, pre-cuenta print, 10% Servicio (Ley 16-92), mover/juntar mesas, BOM `service_recipe_items` auto-deducting inventory, `restaurant_reservations`, Resumen del Salón, 86-list (`services.in_stock`), ManagerAuthGate on void of fired-to-kitchen items, comisiones por mesero, KDS reconnect banner + audio-gesture banner.
- **v2.16.2** — Concesionario hardening: matriculas + INTRANT stub, reservations w/ deposit, warranties + claims, bank pre-approvals, UAF Ley 155-17 modal, RNC guard for E31, dynamic ITBIS, lead scoring, conversion funnel report, inventory aging report, WhatsApp triggers, AppraisalChecklist with photo upload.
- **v2.16.1** — Salón/Barbería hardening: appointments + stylist_schedules promoted to Pro PLUS; salon_* feature gates added.
- **v2.13.0** — Licorería dual-source consolidation; NCF last-issued decrement on void; auto-ANECF enqueue; dgii-seed-verify rewrite; pg_cron nonce sweep.
- **v2.12.1** — CSP strict-dynamic prod-blanker fix; SQLCipher at-rest; Sentry telemetry (DSN-gated, PII-scrubbed); nightly SQLite→Supabase backup (3 AM, 14d retention); EN_PROCESO reconciler; loyalty tiers Bronce/Plata/Oro; licorería deposit/bottle-return; WO→ticket bridge; DealBuilder→E31 routing ≥250K; kiosk idle auto-lock; License Rebind UI; GitHub secret scanning + Dependabot + signed-commit branch protection.
- **v2.12.0** — Tienda subtype templates (8 subtypes); `loyalty_transactions` sync; Ranoza E2E smoke harness.
- **v2.11.0** — Cart-line price edit, Returns, multi-device ticket locks, daily owner digest, loyalty points, offline PWA, full RLS audit.
