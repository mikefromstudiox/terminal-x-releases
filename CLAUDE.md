# Terminal X — POS System

## What This App Is
Full-featured desktop POS for the Dominican Republic market, resold to multiple clients. Flagship differentiator: 100% working e-CF (electronic fiscal receipts) per Ley 32-23.

## Restaurante UX (v2.16.3 — DR-restaurant-operator hardening, 2026-04-26)
- **Course pacing automático** — new setting `restaurant_course_pacing_minutes` (default `'0'` = disabled, range 0–120). UI in `Sistema.jsx → Preferencias → Restaurante` ("Tiempo entre tiempos (min)") visible only when `business_type === 'restaurant'`. Logic in `RestaurantPOS.jsx`: after a discrete `fireToKDS(courseId)` succeeds and pacing > 0, schedules a `setTimeout` to auto-fire the next course in `COURSES` order (entradas → principales → bebidas → cocteles → postres → otros) that still has unfired items. Persisted to `localStorage` under `tx_pacing_${ticket_supabase_id}` as `{next_course, fire_at_iso}` so reloads restore mid-flight timers (fires immediately if past, otherwise arms remainder). Amber banner inside `CartSidebar` shows live countdown (`⏱ Disparando ${label} en Mm SSs`, refreshed every 10s) with "Cancelar" button. Auto-cancels on cobro success (both single + split paths), manual cancel, target course's unfired set emptying, and ticket switch. Chains recursively because each auto-fire re-enters the same scheduler block. Sweep on mount drops orphaned keys older than 6h past their fire time.
- **C3** — Web POS modifier loading: `RestaurantPOS.addServiceToTicket` now passes `svc.supabase_id` (UUID) to `api.modificadores.listForService`. Desktop `modificadoresListForService(serviceKey)` is polymorphic — accepts integer id or supabase_id (UUID detected by regex), `console.warn` if neither. Both platforms now show modifier prompts for any plato with `service_modificadores` rows.
- **H1** — Pre-cuenta print on "Pedir cuenta": new `printPreCuenta(data, api, printerApi)` + `buildPreCuenta(data)` in `packages/services/printer.js`. ESC/POS 80mm 42-col, header "PRE-CUENTA", per-item lines + modifiers + line totals, subtotal + ITBIS-included breakdown + Servicio % (if set) + TOTAL + tip suggestions (10/15/18%) + INVERT-bar disclaimer "*** NO ES COMPROBANTE FISCAL ***". Cash drawer NEVER opens (no `DRAWER_KICK` byte). Wired in `RestaurantPOS.handleRequestBill` after `requestBill` API call. Print failure surfaces toast "Cuenta enviada. Impresora no disponible." but does not roll back the status flip. Setting: `restaurant_print_precuenta_enabled` (default `'1'`).
- **H2** — 10% Servicio (Ley 16-92 / costumbre RD): settings `restaurant_servicio_pct` (default `'10'`) + `restaurant_servicio_auto_apply` (default `'1'`). UI in `Sistema.jsx → Preferencias → Restaurante` (visible only when `business_type === 'restaurant'`). `TipEntryModal` reads both via props (`servicioPct`, `servicioAutoApply`); when auto-apply is on it pre-selects the chip matching servicio_pct, surfaces it in the chip grid even if not in 0/10/15/20, and shows banner `Servicio N% incluido (Ley 16-92)`. Persisted as `tickets.servicio_amount REAL NOT NULL DEFAULT 0` + `tickets.servicio_pct REAL DEFAULT 0` (self-heal ALTERs in `electron/database.js`, both legacy `ticketCreate` INSERT and `closeWithPayment` UPDATE paths). New table `tip_distributions(id, supabase_id, ticket_id, ticket_supabase_id, empleado_id, empleado_supabase_id, points, amount, business_id, created_at, updated_at)` — v2.16.3 ships ONE row per ticket with full amount routed to `waiter_empleado_id`. `// TODO v2.17: multi-empleado tip split by points`.
- **H3** — Mover / Juntar mesas (this sprint, 2026-04-26). `MoveMesaModal` + `JoinMesaModal` in `packages/ui/screens/restaurant/MesaActionModals.jsx` wrapped in `ManagerAuthGate`. Web layer: `api.tickets.transferToMesa(ticketSupabaseId, newMesaId)` updates `tickets.{mesa_id, mesa_supabase_id}`, frees old mesa to `'sucia'`, seats new mesa with copied guests/waiter/seated_at; `api.tickets.merge(targetTicketSupabaseId, sourceTicketSupabaseId)` reassigns `ticket_items.ticket_supabase_id` to target, sums guests, marks source `status='merged'`, frees source mesa. Activity log: `restaurant_mesa_transfer` (info) + `restaurant_mesa_merge` (info). Buttons live in `CartSidebar` next to Dividir/Por plato. Desktop IPC stubs reject with upgrade message until matching ipcMain handlers land.
- **H5** — Service recipes (Bill-of-Materials per service). New table `service_recipe_items(id, supabase_id, business_id, service_id, service_supabase_id, inventory_item_id, inventory_item_supabase_id, qty_per_unit REAL, created_at, updated_at)` with `UNIQUE(business_id, service_supabase_id, inventory_item_supabase_id)` + RLS scoped by `business_id`, anon revoked from writes. Migration `migrations/2026_04_26_service_recipes.sql` idempotent (drop-policy/create-policy + DO $$ trigger guard). SQLite migration in `electron/database.js` `migrations` array (idempotent CREATE TABLE IF NOT EXISTS + 4 indexes + updated_at trigger). DB functions: `recipeItemsListForService(serviceKey)` polymorphic id|supabase_id (UUID regex `^[0-9a-f]{8}-...`), join inventory_items for `inventory_item_name / sku / unit / quantity`; `recipeItemsAdd({service_supabase_id, inventory_item_supabase_id, qty_per_unit, business_id})` returns `{id, supabase_id}`; `recipeItemsUpdate(id, qty_per_unit)`; `recipeItemsRemove(id)` (tombstone-aware). Auto-deduction: in `ticketCloseWithPayment` (mesa close path) and legacy `ticketCreate` (direct cobro), `_applyRecipeDeduction(row, items, userId)` walks each ticket line's `service_supabase_id`, fetches matching recipe rows, calls `inventoryAdjust(inventory_item_id, -(qty_per_unit * lineQty), 'Receta — ticket #N', userId)`. Wrapped in try/catch — failures emit `recipe_inventory_skip` (severity warn, metadata: `ticket_id`, `service_supabase_id`, `line_qty`, `qty_per_unit`) and **never block the sale**. IPC: `recipeItems:listForService / add / update / remove`. Preload + `packages/data/electron.js` (passthrough via `...raw`) + `packages/data/web.js` `api.recipeItems.*` (Supabase two-step listForService → fetch links + inventory_items in parallel; close-path mirrors with direct `inventory_items.update({quantity: max(0, current + delta)})` and same `recipe_inventory_skip` fallback). Sync: `service_recipe_items` added to `SYNC_TABLES` push, `PUSH_DESCRIPTORS` pull (LWW, fkCols → services + inventory_items), `RECONCILE_TABLES` for cloud-side delete propagation. UI: `MenuBuilder.jsx → Items del Menú` table now has a chef-hat action button per row that opens `RecipeModal` — search inventory via `api.inventory.search`, click to add (qty_per_unit defaults 1), inline number input (`step=0.001 min=0`) auto-saves on change, trash icon with confirm to remove. Spanish-only copy, brand colors only. Activity events `recipe_updated` + `recipe_inventory_skip` in `EVENT_META`.
- **H4** — Reservas (this sprint). New table `restaurant_reservations` (`id`, `supabase_id` UUID UNIQUE, `business_id`, `mesa_id`/`mesa_supabase_id` nullable, `fecha` DATE, `hora` TIME, `duration_min` default 90, `nombre`, `telefono`, `guests` ≥ 1, `notas`, `status` IN(`pendiente`,`confirmada`,`sentada`,`cancelada`,`no_show`), `whatsapp_sent_at`, `cancelled_reason`, `seated_ticket_supabase_id`, `created_at`, `updated_at`). RLS scoped by business_id, anon revoked from writes. Migration `migrations/2026_04_26_restaurant_reservations.sql` idempotent. Screen at `packages/ui/screens/restaurant/Reservations.jsx` (route `/reservas`, sidebar entry "Reservas" gated `restaurant_reservations` + `business_type==='restaurant'`). API namespace `api.restaurantReservations.{list,create,update,confirm,cancel,markNoShow,seat,stampWhatsapp}` in `packages/data/web.js` + electron passthrough stubs in `packages/data/electron.js`. WhatsApp deep link via `wa.me/${normalizeWaPhone(telefono)}` with template `"Hola ${nombre}, confirmamos su reserva en ${biz_name} para ${fecha} a las ${hora} para ${guests} personas."`. Activity events emitted on every transition: `reservation_created`, `reservation_confirmed`, `reservation_cancelled`, `reservation_no_show`, `reservation_seated` — all in `EVENT_META`. "Sentar" flips assigned mesa to `'ocupada'` and stamps `seated_at`. Plan key `restaurant_reservations` (Pro PLUS+).
- **H5** — Resumen del Salón (this sprint). Manager-only dashboard at `/salon-dashboard` (RESTRICTED, owner/cfo/accountant/manager). `packages/ui/screens/restaurant/SalonDashboard.jsx`. 4 tiles: (1) Mesas activas with progress bar, (2) Tiempo prom mesa hoy (live ocupadas avg + closed-today avg blended), (3) Cuenta más alta (live `active_ticket_total`), (4) Ventas turno (sum `tickets.total` mode='mesa' + status='cobrado' since `cuadre_caja.opened_at`). Lists: "Mesas que tardan" (`seated_at` > 90 min, sorted desc, with mesero name), "Top platos hoy" (agg `ticket_items` by service, top 10), "Por mesero hoy" (agg by `waiter_empleado_supabase_id` — # mesas, ventas, propinas). Polls every 30s. Pure read-only — no mutations. Sidebar entry "Resumen Salón" + plan key `restaurant_salon_dashboard` (Pro PLUS+).
- **H6** — 86-list (sold-out plates, this sprint 2026-04-26). New column `services.in_stock INTEGER NOT NULL DEFAULT 1` on SQLite (idempotent ALTER) + Supabase migration `migrations/2026_04_26_services_in_stock.sql` (`ADD COLUMN IF NOT EXISTS in_stock boolean NOT NULL DEFAULT true` + partial index `idx_services_oos WHERE in_stock = false`). API `api.services.setInStock(key, inStock)` — polymorphic key (numeric local id OR supabase_id UUID) on both desktop (IPC `services:set-in-stock` → `db.serviceSetInStock`, owner/manager-guarded) and web (`packages/data/web.js`, owner/manager-guarded, optimistic). `sync.js` services column block extended with `in_stock`. UI: (1) MenuBuilder Items tab — new "86" column with `Slash` icon button per row (amber when agotado, white when available, instant flip via `setInStock`); (2) RestaurantPOS `MenuItemCard` — when `svc.in_stock === 0|false` card dims to `opacity-50`, crimson `AGOTADO` badge top-right (`#b3001e` bg / white text), click intercepted → fixed bottom-center toast "Plato agotado: ${name}" for 2.5s instead of adding to cart; (3) KDS — fixed bottom-right floating crimson button "86 list" → modal listing all menu items grouped by category, big tappable rows for cocina-friendly toggle, optimistic UI with revert on failure, search filter + live agotado count in header. Activity events: `service_set_oos` + `service_back_in_stock` (info severity), both with `Slash` icon in `EVENT_META`.
- **H7** — ManagerAuthGate on void of fired-to-kitchen items: `RestaurantPOS.removeItem` and `incQty(localId, -1 → 0)` route through gate when `it.kds_fired_at` is set. Trash icon now rendered on fired lines (was hidden) so the gate can trigger. `onManagerApprove` writes `activity_log` with event_type `restaurant_void_fired_item`, severity `warn`, target_type `ticket_item`, full metadata (mesa_name, mesa_supabase_id, item_name, qty, modifiers, ticket_supabase_id, ticket_item_supabase_id, manager_empleado_id, manager_name, manager_method, reason). Added to `EVENT_META` in `RemoteDashboard.jsx` (icon `XCircle`, amber).

### v2.16.3 feature flags & tables quick-ref
| Setting key | Default | Where |
|---|---|---|
| `restaurant_print_precuenta_enabled` | `'1'` | Sistema.jsx → Preferencias → Restaurante |
| `restaurant_servicio_pct` | `'10'` | Sistema.jsx → Preferencias → Restaurante |
| `restaurant_servicio_auto_apply` | `'1'` | Sistema.jsx → Preferencias → Restaurante |
| `kds_warn_seconds` | `'300'` | Sistema.jsx → Preferencias → Restaurante (M3) |
| `kds_stale_seconds` | `'600'` | Sistema.jsx → Preferencias → Restaurante (M3, replaces legacy `kds_stale_order_seconds` which is still read for back-compat) |
| `tickets.servicio_amount` | 0 | per-ticket persistence |
| `tickets.servicio_pct` | 0 | per-ticket persistence |
| Table `tip_distributions` | new | 1 row/ticket (v2.16.3); multi-empleado in v2.17 |
| Activity event `restaurant_void_fired_item` | new | manager-gated kitchen voids |

### Restaurante polish sprint (2026-04-26 — sibling C track)
- **C4** — KDS route role-gated in `App.jsx`. Allowed roles: owner, manager, cfo, accountant, cashier, kitchen. Wrong role → in-place 403 "Acceso denegado" page with link back to `/pos`. Auth gate (`if (!user) <Login />`) was already present. TODO add `kitchen` to `empleados.role` enum; for now manager+owner are the practical KDS users.
- **H6** — Comisiones por mesero. `RestaurantPOS.handleTicketPaid` + `handleSplitPay` now alias `waiter_empleado_id` → `seller_supabase_id` / `seller_empleado_supabase_id` so the existing `seller_commissions` insert path (desktop `database.js` ticketCreate + web `web.js` ticket create) credits the waiter using their `comision_pct`. No schema change required. `WorkerReport.jsx` already relabels the primary tab to "Meseros" for restaurant/hybrid via `WORKER_LABELS` and queries `seller_commissions` for the Vendedores tab — both views now populate.
- **H8** — KDS realtime reconnect banner. `KDS.jsx` infers connection health from refresh cadence (>15s without a successful ingest = unhealthy). Shows amber "⚠ Reconectando... (intento N)" while degraded, green "✓ Conectado" flash for 2s on recovery. No new realtime API surface.
- **H9** — `services.topSellers({days, limit})` was already implemented end-to-end in v2.16.3 (Postgres RPC `services_top_sellers`, desktop `database.js#servicesTopSellers`, IPC `services:top-sellers`, both data adapters). Verified live; no changes needed.
- **M1** — ITBIS desglose in CartSidebar: 3-line footer (Subtotal sin ITBIS / ITBIS 18% / Total). Items with `service.aplica_itbis === 0` are excluded from the tax line.
- **M2** — `MesaCard` wrapped in `React.memo` with custom equality (mesa.id/status/bill_requested_at/guests/seated_at + active + total + 3-min elapsed bucket). Cuts re-renders ~12x during the 15s POS tick.
- **M3** — KDS thresholds editable via Sistema → Preferencias → Restaurante (`kds_warn_seconds`, `kds_stale_seconds`). KDS reads new keys with fallback to legacy `kds_stale_order_seconds`.
- **M4** — `playBell` exponential ramp endpoints bumped from `0.0001` to `0.001` to stay strictly positive across browsers. Imperceptible audibly.
- **M5** — KDS audio-gesture banner. Yellow top banner "Toca para activar sonido..." until first click/keydown calls `audioCtx.resume()`. Persisted in `localStorage.kds_audio_unlocked` so subsequent sessions skip the banner.
- **M6** — Fired+qty=0 line renders ANULADO (red border, strike-through name, crimson badge). Coordinated with H7 ManagerAuthGate via `it.void_authorized_at` field (sibling-B persists).
- **M7** — `fireToKDS` station resolution falls back to `service_supabase_id` when integer `service_id` doesn't match — synced cloud items now route to `bar` correctly.
- **M10** — `payment_parts` sum validated to within 1¢ of the expected total in both `RestaurantPOS.handleSplitPay` and `SplitBillModal.handlePay`. Mismatch surfaces a Spanish toast and aborts.
- **M11** — `truthy()` helper at file scope (accepts `1/'1'/true/'true'/'yes'/'si'/'sí'`); applied to `restaurant_happy_hour_enabled`. Other restaurant booleans use the sibling agent's local `truthy` already.
- **M8 / M9 / M12** — DEFERRED to a follow-up sprint. Each requires multi-table migrations (service_recipe_items, services.in_stock) + IPC + sync.js entries + UI in MenuBuilder + course-pacing timer persistence; partial implementations would risk silent data drift. Tracked in this section so the next agent can pick them up cleanly.

## Current Release — v2.16.8 (2026-04-27 — PG17 optimization sprint: 5 GIN(jsonb_path_ops) indexes on hot jsonb cols [tickets.payment_parts/ecf_result, businesses.settings, activity_log.metadata, ecf_queue.body_json], 7 BRIN(created_at) indexes on append-mostly tables, 10 duplicate indexes/constraints dropped, transaction_timeout per-role [auth=60s/anon=15s/service=∞], autovacuum scale_factor tuned on 10 hot tables, 5 multi-col CREATE STATISTICS objects, server-side MERGE … RETURNING upsert RPC `sync_merge_upsert(p_table,p_rows,p_business_id,p_append_only)` covering 76 sync tables, feature flag `sync_use_merge_v17` in app_settings [default OFF, 5s cache, auto-fallback to legacy on error]. Health 97 → ~99.5. STUDIO X SRL flag flipped 2026-04-26.)
- **v2.16.2** — (2026-04-25 — Concesionario hardening sprint 2E: matriculas + INTRANT stub, reservations w/ deposit, warranties + claims, bank pre-approvals, UAF Ley 155-17 modal, RNC guard for E31, dynamic ITBIS, lead scoring + hot-lead filter, conversion funnel report, inventory aging report, WhatsApp triggers, QuotePdfModal pre-sale PDF, AppraisalChecklist with photo upload, full plan-gating sweep across 12 dealership feature keys, EVENT_META completed for 4 new events, training manual section 34.)
- **v2.16.1** — Barbería/Salón hardening: appointments + stylist_schedules promoted to Pro PLUS, salon_* feature gates added, salon modules expanded with memberships/retail_upsell/public_booking/walk_in/dashboard.
- **v2.13.2** — Apertura cashier-only + input hardening
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
- **v2.13.2** — Apertura de Turno gated to `role='cashier'` only (owner/manager/cfo/accountant exempt — they open shifts for cashiers from Cuadre) + AperturaTurnoModal input hardening: suppressed 1Password/LastPass/Chrome autofill icons (`autoComplete=off`, `data-1p-ignore`, `data-lpignore`, `data-form-type=other`) + bumped padding `pl-12 → pl-14` + `pointer-events-none` on RD$ label for click-through.
- **v2.13.1** — Dependency CVE patches: `xlsx 0.18.5 → 0.20.3` (via SheetJS CDN — HIGH prototype-pollution + ReDoS, package no longer on npm registry), `lodash` override `^4.18.0` (HIGH), + medium-severity overrides `brace-expansion ^2.0.3`, `picomatch ^4.0.4`, `esbuild ^0.25.0`. No behavior changes. Both builds green, Ranoza smoke 22/22.
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
| appointments / stylist_schedules | — | ✓ | ✓ | v2.16.1 promoted from Pro MAX |
| commissions | — | — | ✓ | |
| whatsapp_receipts | — | — | ✓ | |
| remote_dashboard | — | — | ✓ | also gates activity badge + daily digest |
| multi_location | — | — | ✓ | gates ticket locks |
| offline_mode | — | — | ✓ | gates service worker registration |
| salon_* (preferred_stylist=free, walk_in/memberships/public_booking/dashboard/whatsapp_reminders=Pro PLUS+, no_show_deposit/offline_whatsapp_queue=Pro MAX) | partial | ✓ | ✓ | v2.16.1 — see `packages/ui/hooks/usePlan.jsx` |
| concesionario_resumen | ✓ | ✓ | ✓ | v2.16.2 — visible at every tier as upgrade hook |
| vehicle_inventory / sales_pipeline / test_drives / deal_builder | — | ✓ | ✓ | v2.16.2 dealership core |
| matriculas / reservations / warranties / preapprovals | — | ✓ | ✓ | v2.16.2 dealership ops |
| concesionario_reports (commissions / aging / funnel) | — | ✓ | ✓ | v2.16.2 dealership reports |
| intrant_api / whatsapp_auto | — | — | ✓ | v2.16.2 — Pro MAX exclusives, stubs in v2.16.2 |
| carniceria_resumen | ✓ | ✓ | ✓ | FIX-HIGH-6 — visible at every tier as upgrade hook (mirrors concesionario_resumen) |
| carniceria_corte_catalog / carniceria_mayoreo / carniceria_freshness_alerts | — | ✓ | ✓ | FIX-HIGH-6 carnicería core (Pro PLUS+) |
| restaurant_reservations / restaurant_salon_dashboard | — | ✓ | ✓ | v2.16.3 H4+H5 — Reservas + Resumen del Salón (Pro PLUS+) |
Gating lives in `packages/ui/hooks/usePlan.jsx` — add new keys there.

## Concesionario Vertical
v2.16.2 hardening sprint shipped 2026-04-25. Screens: `VehicleInventory`, `SalesPipeline` (kanban + lead scoring), `TestDrives`, `DealBuilder` (UAF + E31 RNC guard + dynamic ITBIS + QuotePdfModal + AppraisalChecklist), `Matriculas` (INTRANT stub for Pro MAX), `Reservations`, `Warranties`, `Preapprovals`, `Resumen` (dashboard tile). Reports: `ConcesionarioCommissionsReport`, `InventoryAgingReport`, `TestDriveFunnelReport`. Tables: `vehicle_inventory`, `vehicle_documents`, `leads`, `test_drives`, `sales_deals`, `vehicle_titulos`, `vehicle_reservations`, `vehicle_warranties`, `bank_preapprovals`. WhatsApp triggers in `packages/services/whatsapp-dealership.js` — wa.me deep links by default, `sendAutomatic` from `whatsapp-business-stub.js` (Pro MAX) once WABA is approved. INTRANT integration is a website lookup stub in `packages/services/intrant-stub.js`. Activity events: `deal_closed`, `deal_close_failed`, `deal_commission_paid`, `pipeline_stage_change`, `pipeline_followup_logged`, `vehicle_reservation_expired`, `reservation_override`, `vehicle_warranty_expired`, `vehicle_warranty_claim_added`, `warranty_create_failed`, `bank_preapproval_expired`, `preapproval_used`, `appraisal_recorded`.

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
- Receiver endpoints LIVE at fe.terminalxpos.com (VPS Express) + Vercel backup in `web/api/fe.js` (consolidated v2.16.3 — single function routing semilla/validarcertificado/recepcion/aprobacion via `?action=<name>`; old `/fe/...` public URLs preserved via vercel.json rewrites).
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
echo '{"private":true,"type":"module","dependencies":{"@supabase/supabase-js":"^2.49.4","xml-crypto":"^2.1.5","@xmldom/xmldom":"^0.8.6","jsonwebtoken":"^9.0.2","dgii-ecf":"^1.6.8","node-forge":"^1.3.3","busboy":"^1.6.0","bcryptjs":"^2.4.3"}}' > dist-web/package.json
cp web/vercel.json dist-web/
mkdir -p dist-web/api/signup dist-web/api/digest dist-web/lib dist-web/.vercel
cp web/api/panel.js web/api/validate.js web/api/rnc.js web/api/ecf-sign.js web/api/dgii-cert-upload.js web/api/staff-verify-auth.js web/api/fe.js dist-web/api/
cp web/api/signup/provision.js dist-web/api/signup/
cp web/api/digest/daily.js dist-web/api/digest/
cp web/lib/xml-builder.js web/lib/xml-signer.js web/lib/dgii-client.js web/lib/rate-limit.js dist-web/lib/
cp web/middleware.js dist-web/middleware.js
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
10. Vercel Hobby = 12 serverless function cap — admin consolidated in `panel.js?action=`, fe receivers consolidated in `fe.js?action=` (v2.16.3 — 9/12 used)
11. Deploy commands / SQL / code blocks as single long lines for copy-paste

## RLS Audit
Run `node scripts/rls-policy-audit.mjs` before EVERY release. The script connects to Supabase via `SUPABASE_ACCESS_TOKEN` (Management API) or `SUPABASE_SERVICE_ROLE_KEY` (RPC fallback) from `.env`, scans every `public` table where `pg_class.relrowsecurity = true`, and fails (exit 1) if any of them have ZERO policies in `pg_policies` — those tables 42501-reject every read/write from anon and authenticated roles. Add policies (or disable RLS) before shipping.

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
