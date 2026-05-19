# Terminal X — POS System

## Cleanup Summary
- Lines: 276 → 118 (57% reduction).
- Removed: verbose verification-protocol prose, duplicated supabase_id explainers, redundant release-history bullets (kept in `git log` + `memory/project_release_history.md`), prose-heavy deploy walkthroughs, repeated brand/rule restatements.
- Preserved: stack, layout, all 20 Hard Rules, supabase_id architecture, IPC, DB tables, roles, full Plan-gating table, Tienda subtype system, all verticals, full DGII/e-CF flow, RNC, printing, license, SaaS, activity_log, RLS, web.js patterns, build/deploy/release, verification harnesses, current sprint + journal_entries spine status.
- Note: no "38 Mega Smoke / Wave / Phase A/B" sections existed in source — nothing to fold in.

## Mission
Desktop + web POS for Dominican Republic, multi-vertical. **CERTIFIED DGII Emisor Electrónico** (e-CF, Ley 32-23). RNC 133410321, Viafirma .p12.

## ⚠️ Verify-before-claim
Code-grep + migration files LIE about deployed schema. Before claiming any bug touching schema/RLS/function sig/trigger/constraint: (1) read `docs/SCHEMA-SNAPSHOT.md` (regen via `node scripts/schema-snapshot.mjs`), (2) if still unsure, query Management API `POST https://api.supabase.com/v1/projects/csppjsoirjflumaiipqw/database/query` with `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`. Every finding naming a constraint/policy/function MUST paste pg_catalog evidence. Applies to audit subagents, migration reviews, all "fixes".

## Stack
Electron 41 + React 19 + Vite 5 (JSX, no TS) + Tailwind 4 (`@tailwindcss/vite`, no PostCSS). `better-sqlite3` + SQLCipher (HKDF/HWID + safeStorage; use `better-sqlite3-multiple-ciphers` + derived key for local-DB scripts). react-router-dom 7, lucide-react 1.7, electron-updater. CommonJS in `electron/`, ESM everywhere else.

## Layout
```
packages/ui/ (screens, components, hooks, context, i18n, landing, admin)
packages/services/ (printer, ecf, pdf, csv, license, journal; sync.js DELETED → electron/sync.js)
packages/data/ (electron.js desktop, web.js Supabase)
packages/config/ (tiendaSubtypes.js, businessTypes.js)
electron/ main.js (IPC) | preload.js (contextBridge) | database.js (sync better-sqlite3) | sync.js (5min + on sale/payment/void) | xml-builder.js (all e-CF + RFCE + ANECF) | xml-signer.js (xml-crypto v6 for e-CF, dgii-ecf for seed — DO NOT MIX) | dgii-client.js | cert-manager.js
web/ api/ (Vercel 10/12 used) | lib/ (ESM ports)
scripts/ rls-policy-audit.mjs | ranoza-e2e-smoke.mjs | restaurant-e2e-smoke.mjs | audit-flows.mjs
```

## Hard Rules
1. Read file before editing.
2. `require()` in `electron/`, `import` elsewhere.
3. No fake/placeholder data, no debug `console.log`, no `setTimeout` fake delays.
4. ESC/POS buffers stay binary — never mix unicode.
5. Supabase = UUIDs — never `parseInt()`.
6. Web user.id may be `'web'` — guard `(user?.id && user.id !== 'web') ? user.id : null`.
7. Vercel API routes = ESM (`export default`).
8. New endpoints → `panel.js?action=` or `fe.js?action=` (Hobby cap 12; currently 10).
9. SQL/deploy/curl as single long lines.
10. No fake demo creds; real demos handed out via WhatsApp. `/demo/:vertical` killed 2026-04-25.
11. Brand: black, white, `#b3001e`. No gray. PY pink `#FA0050` only on PY toggle.
12. All UI text es-DO.
13. Never add `Co-Authored-By: Claude` or any Anthropic attribution to commits.
14. `main` requires signed commits — Mike pushes.
15. `mesas`/`tickets` status changes need `rev: OLD_REV + 1` (trg_*_rev_guard).
16. New sidebar route → matching `web/main.jsx` `<Navigate to="/pos/X" replace />`; fullscreen routes (KDS) also need pathname check in App.jsx.
17. Use `api.services.all()` / `api.categorias.all()` — `getAll()` does NOT exist; `?.()` hides this as silent empty.
18. Provisioning MUST set `businesses.is_demo:false` + `licenses` row + `app_settings` upserts with `is_device_local:false` + `supabase_id:randomUUID()` + `device_hwid:null`. Use `scripts/activate-client.mjs`.
19. Per-item `ticket_items.itbis = price - price/(1+factor)` (embedded extraction). NEVER `price * factor` — `price` is GROSS in DR retail. Fixed 2026-05-17.
20. New financial mutation MUST post `journal_entries` via `packages/services/journal.js` behind `app_settings.journal_entries_v1` flag. `tryWrite` only, append-only (reversals = new rows).

## supabase_id Architecture (MANDATORY, every synced table)
- SQLite `id INTEGER PK` + `supabase_id TEXT` (UUID v4 at insert). Supabase `id UUID PK` + `supabase_id UUID UNIQUE`. Sync upserts on `(business_id, supabase_id)`.
- FK refs via `*_supabase_id`. Never `local_id`/`local_*_id` (deprecated).
- `updated_at` + trigger on every synced table. Pass 2 sync uses `updated_at > last_synced_at`.
- web.js joins MUST dual-key (integer FK AND `*_supabase_id`).
- Every web INSERT MUST set `supabase_id = crypto.randomUUID()` or invisible to desktop pull.
- `users` is a VIEW on `staff` base table.
- After ANY sync.js change → matching Supabase migration in `migrations/` (Supabase drops unknown columns silently).
- Real UNIQUE CONSTRAINT (not partial index) for `on_conflict` targets — PostgREST rejects partial indexes.
- Embed Supabase anon key as installer fallback or sync dies on fresh installs.
- Autonomous SQL via Management API (`SUPABASE_ACCESS_TOKEN` in `.env`) or service-role; never ask Mike. Legacy anon/service_role keys CANNOT be rotated.

## IPC
Renderer → `window.electronAPI.module.method()` → preload contextBridge → `ipcMain.handle()`. Printer: `window.printerAPI.print(buffer)`, `openDrawer()`.

## DB (better-sqlite3, sync API)
Key tables: businesses, users/staff, services, tickets, ticket_items, clients, credit_payments, ncf_sequences, cuadre, caja_chica, notas, rnc_contribuyentes, empleados, inventory_items, activity_log + vertical-specific (vehicle_inventory, sales_deals, restaurant_reservations, service_recipe_items, etc).
- `empleados.role` = access; `empleados.tipo` (lavador/vendedor/cajero/hybrid) = payroll/commission. **Independent axes**.
- `users.employee_id` FK → empleados.
- `services.no_commission` exempts commission. `services.in_stock` = 86-list. `services.aplica_itbis` excludes ITBIS line.

## Roles
`empleados.role`: owner, manager, cfo, accountant, cashier, kitchen, none. AuthContext `resolveRole()` joins users→empleados at login. Gated via `useAuth()` + Settings.jsx permission map. **Manager Authorization Card**: Code128 cards or PIN via `ManagerAuthGate`; always emit `activityLogRecord`.

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
| concesionario_resumen / carniceria_resumen (upgrade-hook tiles) | ✓ | ✓ | ✓ |
| dealership core (vehicle_inventory / sales_pipeline / test_drives / deal_builder / matriculas / reservations / warranties / preapprovals / concesionario_reports) | — | ✓ | ✓ |
| dealership Pro MAX (intrant_api / whatsapp_auto) | — | — | ✓ |
| carniceria_corte_catalog / mayoreo / freshness_alerts | — | ✓ | ✓ |
| restaurant_reservations / restaurant_salon_dashboard | — | ✓ | ✓ |

## Tienda Subtypes (v2.12)
`tienda` = base; subtype via `app_settings.tienda_subtype` ∈ {licoreria, farmacia, colmado, supermercado, ferreteria, papeleria, boutique, otro}. Templates in `packages/config/tiendaSubtypes.js` (features, defaultCategories, es/en). Owner override: `app_settings.feature_<name>_enabled = 'true'|'false'`. Use `useBusinessType().hasFeature(name)` (NOT hardcoded `isLicoreria`). Licorería rules block lives on `TIENDA_SUBTYPES.licoreria.config` (read via `licoreriaConfig`); legacy `BUSINESS_TYPES.licoreria.licoreria` deleted v2.14. `app_settings` business-keyed — needs `business_id` + `updated_at` + key in sync.js descriptors. City as both `ciudad` AND `biz_city` in `businesses.settings`.

## Verticals
- **carwash** — default. CarWashPOS + Lavadores/queue.
- **tienda** + 8 subtypes — RetailPOS (barcode/SKU + grid + services tab for hybrid). Pricing: client > Pedidos Ya > base.
- **restaurant** — RestaurantPOS + KDS + mesas + Reservas + Resumen del Salón. Pre-cuenta (no drawer), 10% Servicio (Ley 16-92), course pacing, 86-list, ManagerAuthGate on void of fired items, mesa transfer/merge, BOM `service_recipe_items` auto-deducts inventory.
- **salon/barberia** — Appointments + stylist_schedules + memberships + walk-ins + public booking.
- **mecanica** — WO → ticket bridge.
- **concesionario** — VehicleInventory, SalesPipeline (kanban + lead scoring), TestDrives, DealBuilder (UAF + E31 RNC guard + dynamic ITBIS + QuotePdf + AppraisalChecklist), Matriculas (INTRANT stub, Pro MAX), Reservations, Warranties, Preapprovals. Reports: Commissions, Aging, Funnel. WhatsApp in `whatsapp-dealership.js` (wa.me default; `sendAutomatic` from `whatsapp-business-stub.js` post-WABA).
- **carniceria** — Corte catalog, mayoreo, freshness alerts.

## Fiscal / e-CF
- CERTIFIED. Prod switch: `dgii_environment` `certecf` → `ecf` + install .p12.
- Legacy NCF: B01/B02 paper, 8-digit pad, 11-char. e-CF: E31/E32/E33/E34/E43/E47, 10-digit pad, 13-char. Mandatory after 2026-05-15.
- **CodigoSeguridad** = `SignatureValue[0:6]` raw base64 (NO SHA-256).
- **QR**: `ecf.dgii.gov.do/{env}/ConsultaTimbre`. E32 < RD$250K → `fc.dgii.gov.do/{env}/ConsultaTimbreFC`. E43/E47 omit `RncComprador`.
- **Seed auth**: `dgii-ecf` `Signature` class (namespace-sorted digest), POST multipart/form-data. e-CF submission = raw `application/xml` EXCEPT RFCE (E32 < 250K) = multipart/form-data (field `xml`, filename `{RNC}{eNCF}.xml`).
- Emisor match: RNC 9 digits no dashes, RazonSocial uppercase exact, FechaEmision dd-mm-yyyy. Postulación env-scoped.
- `IndicadorEnvioDiferido=1`: offline 72h deferred. Re-sign on rebuild.
- NCF last-issued decrement via `ncfSequenceDecrementIfLast` on `ticketVoid` + `queueDelete` (desktop + web parity).
- ANECF: `submitANECF()` voids unused ranges; auto-enqueue on void with `ncf_auto_anecf` log. UI: DGII.jsx tab 3.
- Cert sync: desktop pushes via `bizSync` during license validation → admin renders e-CF Status card.
- `dgii:cert-pem` IPC: owner re-verify, always emit `cert_pem_export` critical log (subject + expiry).
- `dgii-seed-verify.js` (web): embedded cert verify + nonce issued/consumed gate + RNC extraction. `semilla.js` persists nonces. pg_cron nightly sweep.
- Deps: `dgii-ecf` for SEED ONLY; `xml-crypto` v6 for e-CF signing via `xml-signer.js`. DO NOT MIX.
- Receivers: LIVE `fe.terminalxpos.com` (VPS Express:3100) + Vercel backup `web/api/fe.js` (single fn, `?action=` routes semilla/validarcertificado/recepcion/aprobacion). Old `/fe/...` preserved via `vercel.json` rewrites.
- Web signing proxy: `/api/ecf-sign` (Supabase JWT).
- Parallel XML generator drift risk: `tools/cert-step4` vs `electron/xml-builder.js` — add golden-diff test on any change.

## RNC Lookup
`useRNC()` in `packages/ui/hooks/useRNC.js`. Order: local `rnc_contribuyentes` → megaplus.com.do fallback. Full DGII sync (~900K) in Settings → e-CF.

## Printing (ESC/POS)
`packages/services/printer.js`. 80mm = **42 chars/line** (`COL_WIDTH`). Code Page 858. ASCII separators only. Drawer ONLY on cash. Print AFTER DB persist (Queue) / BEFORE modal close (POS). Pre-cuenta NEVER opens drawer.
- Drawer-kick variants captured from client's existing POS via print-spool capture (universal onboarding). 3 StarSISA pulses in v2.3.23 "Probar Variantes". StarSISA tickets often DUPLICATE — commission import dedupes.
- DR margin display: divide price by 1.18 when `aplica_itbis=true`.

## License
Key `TXL-XXXX-XXXX-XXXX`. HWID = SHA256(MAC + hostname), `userData/hwid.json`. Offline grace 72h cached; fresh installs without prior validation are denied. Tables: plans, licenses, license_events, admin_users. Vercel: `/api/validate`, `/api/panel`. Support WA `+18098282971`.

## SaaS
- **Admin** `/admin` — Dashboard/Clients/ClientDetail/Licenses/Team/Certifications. ClientDetail renders e-CF Status card from `businesses.settings`.
- **Landing** `/` — Pro RD$2,490 / PLUS RD$4,490 / MAX RD$6,990. Annual 15% OFF. 7-day Pro MAX trial.
- **Signup** `/signup` → pending → admin activates. Trial via `web/api/signup/provision.js` (`trial_end`, `expires_at`).
- Remote config: `validate.js` returns `remoteConfig`; desktop syncs every 4h.
- e-CF Certification as a Service: studioxrdtech.com/ecf-certification.

## Activity Log
Append-only `activity_log` (SQLite + Supabase, FWW, JSON `metadata`). Helpers in `electron/database.js`: `setActiveUser`, `activityLogRecord({event_type, severity, target_*, amount, old_value, new_value, reason, metadata})`, `activityLogList({dateFrom, dateTo, eventTypes, limit})`. IPC: `activity:set-actor`, `activity:list`. Web: `logActivity()` in web.js. UI: **Actividad** tab on `RemoteDashboard.jsx` (owner/cfo/accountant), 30-day window, severity rail (info/warn/critical → slate/amber/red). Add event: call helper → add to `EVENT_META` → add chip in RemoteDashboard. **Never** raw-INSERT.

## RLS (release gate)
`node scripts/rls-policy-audit.mjs`. Connects via `SUPABASE_ACCESS_TOKEN` or `SUPABASE_SERVICE_ROLE_KEY`. Exit 1 on RLS-enabled tables with zero `pg_policies`.
- New synced tables ship with policies, anon revoked from writes, scoped by `business_id`.
- Anon SELECT requires `business_id IS NOT NULL`. Service role bypasses RLS.
- `staff` SELECT missing once → byPin null → TEMP_OWNER fallback. Audit ALL RLS tables.
- PostgREST gotcha: `.or('col.is.null,col.not.like.X')` matches ALL rows on destructive ops. Use SELECT → DELETE-by-id.

## Data Layer (web.js)
- `tryOr()` reads w/ fallback; `tryWrite()` mutations throw. Global `window.onerror` + `unhandledrejection` in `main.jsx`. Wire `window.__txReportError(err, { severity, category, extra })` on every fix's failure paths so admin Errores catches regressions.
- e-CF: CobrarModal → `signAndSubmitECF()` → IPC `dgii:submit` → builder + signer + client. `confirmedRef` fires `onConfirm()` IMMEDIATELY after ECF success.
- Logout race: `stopOfflineSync()` + `window.__txResetSupabase()` wired into AuthContext.
- Sidebar polls gated on `user.id` to avoid pre-login bursts.
- Dark mode tokens: `bg-white→dark:bg-white/5`, `bg-slate-50→dark:bg-black`, `text-slate-800→dark:text-white`, `border-slate-200→dark:border-white/10`.

## Build
`npm run dev` (Electron+Vite) | `npm run dev:web` | `npm run build:web` | `npm run dist:win` | `npm run dist:mac`.

## Web Deploy (terminalxpos.com)
**Primary (2026-05-17+):** `git push origin main` → Vercel auto-deploys ~1.5min. Repo-root `vercel.json` + `scripts/prepare-vercel.mjs`. Linked: `mikefromstudiox/terminal-x-releases` → Vercel `terminalx`, prod branch `main`. Preview branches → `*.vercel.app`.
**Manual fallback:** `npm run build:web && node scripts/prepare-vercel.mjs && cd dist-web && npm install --silent && NODE_OPTIONS=--use-system-ca npx vercel --prod --yes`. `--use-system-ca` required on Mike's Windows (TLS interception).
Catch-all SPA rewrite blocks `sitemap.xml`/`robots.txt` — explicit rewrites in **root** `vercel.json` only (single source; `web/vercel.json` deleted 2026-05-17 after /pos 404 incident). `outputDirectory` set → Vercel ignores nested vercel.json.

## Desktop Release Gotchas
- `gh release upload` reports 404 on 220MB .exe but ACTUALLY succeeds. Verify `gh release view v<ver> --json assets` before retry (retry = `already_exists`). Create release → upload assets separately → verify.
- `npm run dev` races `dist:win` (wipes dist/ in ~30s). Copy `.exe` + `latest.yml` + `.blockmap` to `release-staging/` immediately, release from there.
- Releases MUST include `.exe` + `latest.yml` + `.blockmap` (no latest.yml → auto-update breaks).
- Installer stays in `dist/`; never copy to Desktop.

## Hostinger VPS
`root@srv1528760` (187.124.152.42). Hosts DGII e-CF Receiver (`fe.terminalxpos.com`, Express:3100) + Content X. Claude Code installed — SSH and run `claude`.

## Verification harnesses (release gate = these 4)
- `mcp__ide__getDiagnostics` for TS/lint.
- `npm run build:web` / `npx vite build` for imports/syntax.
- `curl http://localhost:<port>` post-dev start.
- Electron: `npm run dev`, watch exit codes + Vite.
- `node scripts/rls-policy-audit.mjs` — RLS coverage.
- `node scripts/ranoza-e2e-smoke.mjs` — 22 web scenarios, ~10s.
- `node scripts/restaurant-e2e-smoke.mjs` — 21 scenarios vs Crokao, ~3s (mesas/tickets/KDS/cobro/reservas/BOM + rev-guard + RLS denial).
- `node scripts/audit-flows.mjs` — schema-payload contract + side-effects + LWW + RLS (see `scripts/audit-flows.README.md`).
- Skip only for doc edits / git ops / single-line obvious fixes on passing build.

## Current Sprint (2026-05-17, live on main)
- Per-item ITBIS fix (was over-counting ~18%/line; ticket totals correct so invisible until journal_entries reconcile).
- PIN field in Admin → Activar (owner staff PIN at provisioning, no first-login prompt).
- Vercel auto-deploy live (replaces 15-step manual chain).
- Onboarding scripts: `activate-client.mjs`, `clone-from-sxad.mjs`, `seed-carwash-bar-starter.mjs`, `wipe-test-data.mjs`.
- First hybrid carwash+restaurant client (CAR WASH DJ).

**Branch `feat/journal-entries-spine` (not merged):** Double-entry `journal_entries` SOT. Phases 1-4 done (table+RLS+helpers+15 tests+wire-forward on 7 mutation sites+12mo backfill+FK indexes+BRIN→Btree). Phase 3.5 scaling: **1K-3K concurrent customers on Pro/Micro $25/mo**. Decision ladder in `FUTUREX.md`. Phase 5 (Estado de Resultados from spine) in progress. See `memory/project_journal_entries_spine_20260517.md`.

## Recent versions (detail in `git log` + `memory/project_release_history.md`)
- **v2.16.9** (2026-04-27) — RLS sync JWT fix (critical, system-wide).
- **v2.16.8** — PG17 sprint: GIN(jsonb_path_ops), BRIN(created_at), per-role `transaction_timeout`, autovacuum tune, server-side `sync_merge_upsert` RPC behind `sync_use_merge_v17` flag (default OFF, auto-fallback). Health 97→99.5.
- **v2.16.3** — Restaurante hardening (course pacing, pre-cuenta, 10% Servicio, mover/juntar mesas, BOM, reservations, Resumen, 86-list, ManagerAuthGate on fired void, comisiones por mesero, KDS reconnect/audio banners).
- **v2.16.2** — Concesionario hardening (matriculas+INTRANT stub, reservations w/ deposit, warranties, preapprovals, UAF Ley 155-17, E31 RNC guard, dynamic ITBIS, lead scoring, funnel/aging reports, WhatsApp triggers, AppraisalChecklist).
- **v2.16.1** — Salón/Barbería hardening (appointments+stylist_schedules to PLUS; salon_* gates).
- **v2.13.0** — Licorería dual-source; NCF last-issued decrement on void; auto-ANECF; seed-verify rewrite; pg_cron nonce sweep.
- **v2.12.1** — CSP strict-dynamic fix; SQLCipher at-rest; Sentry (DSN-gated, PII-scrubbed); nightly SQLite→Supabase backup (3 AM, 14d); EN_PROCESO reconciler; loyalty tiers; licorería deposit/return; WO→ticket bridge; DealBuilder→E31 ≥250K; kiosk auto-lock; License Rebind; secret scanning + Dependabot + signed-commit protection.
- **v2.12.0** — Tienda subtype templates; `loyalty_transactions` sync; Ranoza E2E harness.
- **v2.11.0** — Cart-line price edit; Returns; multi-device ticket locks; daily owner digest; loyalty points; offline PWA; full RLS audit.
