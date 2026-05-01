# Fix Ledger — 2026-04-30

**v2.16.10** — comprehensive audit + fix sweep across web + desktop. ~40 P0s identified across 10 dataLEAKS audits. This doc catalogs every fix, why it was made, what it closed, and how to verify.

## Status: 25 P0s shipped, 15 deferred to Batch 5/6

**Shipped today (web live on terminalxpos.com, desktop staged for installer):**

Schema/RLS:
- ✅ 1.1 / 1.2 — sealed `restaurant_reservations` + `service_recipe_items` anon leaks
- ✅ 1.3 / 1.4 — added `tickets.servicio_pct/servicio_amount/appointment_supabase_id`, `work_orders.ticket_id/ticket_supabase_id/facturado_at`
- ✅ 1.5 — added `restaurant_reservations.deposit_amount/deposit_status/deposit_ticket_supabase_id` + `vehicle_warranties.claim_ticket_supabase_id` + `vehicle_reservations.deposit_ticket_supabase_id`
- ✅ 1.6 — added `cuadre_caja.status/opened_at/opening_cash`
- ✅ 1.7 — RLS lockdown: dropped 10 wide-open INSERT policies, replaced with JWT-claim-only Pattern 1
- ✅ 1.8 — set `go_live_date='2026-04-25'` for Studio X SRL (was empty → `_liveWeb=false`)
- ✅ added `tickets.descuento_reason`, `tickets.mac_jti`, `ticket_items.oferta_supabase_id`, `services.duration_min`, `empleados.foto_url`

Web:
- ✅ 2.1–2.11 — Batches 1+2+3 (already shipped earlier today)
- ✅ 2.12 — tickets.create persists ncf, ncf_type, descuento_reason, mac_jti, notes (← comentario), mode, beverage_subtotal; cajero_supabase_id resolved from numeric cajero_id
- ✅ 2.12 — ticket_items.create persists oferta_supabase_id, course, guest_number, preparation_notes
- ✅ 2.13 — clients.create returns id+supabase_id (was id-only)
- ✅ 2.16 — Queue washer reassign resolves int→UUID via empleados lookup
- ✅ 2.17 — Returns dispatches E33 (parcial) / E34 (anulación) / B04 (paper) based on coverage + ECF-live flag
- ✅ 2.18 — partial credit payment cumulative-paid logic (web)
- ✅ 2.20 — `commission_pct` → `comision_pct` (insurance_batches productivity query); caja_chica.update writes both `approved_by` + `approved_by_supabase_id`

Desktop:
- ✅ 3.1 — cuadreCreate now UPDATEs the open shift row instead of inserting an orphan
- ✅ 3.2 — desktop collectCredit cumulative-paid logic (mirror of 2.18)
- ✅ 3.3 — inventoryDelete + empleadoDelete + empleadoHardDelete activity_log
- ✅ 3.4 — `app.requestSingleInstanceLock()` for ANECF + DGII drainers
- ✅ 3.5 — tickets push descriptor adds 9 missing cols (servicio_pct, servicio_amount, currency, fx_rate, appointment_supabase_id, project_*, origin_hwid, origin_device_label, is_test, descuento_reason, mac_jti)
- ✅ 3.6 — APPEND_ONLY_TABLES expanded from 1 to 18 (every table verified to have no UPDATE policy on Supabase)
- ✅ 3.7 — cuadre_caja push descriptor adds status, opened_at, opening_cash

**Batch 5 — SHIPPED 2026-04-30 (v2.16.25):**
- ✅ 4.1 — Server-side CAS via `sync_upsert_counter_row` RPC (LWW counter guard).
- ✅ Server-side trigger `trg_credit_ticket_bump_balance` — auto-bumps clients.balance on credit ticket insert.
- ✅ Server-side trigger `trg_ticket_item_decrement_inventory` — auto-decrements inventory_items.quantity when ticket_items inserted under a cobrado ticket. Logs to inventory_oversells when stock<qty.
- ✅ Server-side trigger `trg_ticket_complete_appointment` — auto-flips appointments.status='completed' when linked ticket reaches cobrado.
- ✅ Server-side RPC `ticket_void_with_side_effects(ticket_supabase_id, reason, void_by)` — atomic void: inventory restore + commission reversal + NCF decrement (B-prefix) or ANECF enqueue (E-prefix) + client balance reversal + status flip + activity log.
- ✅ 2.14 — `api.tickets.updateItemPrice` on web.js (manager-gated price edit + ticket totals recalc + activity log).
- ✅ 2.15 — `api.commissions.byTicket` on web.js (washer + seller + cajero unified).
- ✅ 2.19 — NCF decrement on void E-prefix → ANECF enqueue (handled in `ticket_void_with_side_effects`).
- ✅ Restaurant: KDS recall API `kds.cancel({ticket_item_supabase_id, station, reason})` — cancels kds_events + clears kds_fired_at + activity log.
- ✅ ANECF web drainer (Vercel cron `/api/panel?action=anecf-drain` every 6h) — escalates stuck-pending rows to `failed` after 24h+10 attempts; abandons rows >72h.

**Batch 6 — SHIPPED 2026-05-01 (v2.16.26):**
- ✅ 3.8 — Backup integrity verify: SHA256 of gzipped snapshot + post-upload HEAD verify (`Content-Length` match) + retention-after-good guard (purge only runs after verified upload) + consecutive-failure escalation (warn → critical at 2+ fails). Persists `backup_last_sha256` + `backup_consecutive_failures` to app_settings. `electron/db-backup.js`.
- ✅ 3.9 — Sync push/pull mutex: documented + reinforced. `_syncing` + `_pendingSync` (lines 121-122) serialize the entire syncNow including push then pull, with re-dispatch on the trailing edge if a concurrent call arrived. Multi-device coordination is server-side via `sync_upsert_counter_row` CAS RPC. `electron/sync.js`.
- ✅ Salón: per-line stylist commission auto-flow — already wired via `buildLineStylistsPayload()` → POS Queue path passes `empleado_supabase_id` per line. Tier 1 harness 3/3 salon scenarios pass.
- ✅ Restaurant: deposit UI on Reservations.jsx — `deposit_amount` + `deposit_status` inputs wired. Statuses: held / applied / refunded / forfeited. Persists via `restaurantReservations.create` + `update` (allowed list expanded).
- ✅ client_memberships cancel/refund API: `salonMemberships.cancel({client_membership_supabase_id, reason, refund_amount})` (sets sessions_remaining=0 + cancelled_at + activity log) and `.refund({amount, reason})` (logs refund without cancelling). Schema: `client_memberships.cancelled_at`, `cancelled_reason`. `packages/data/web.js`.
- ✅ Public booking endpoint route: already uses service-role via `getClient()` (panel.js line 43). RLS-tightening did NOT break it because the route runs server-side. Batch 6 audit item was already-resolved.

**STATUS**: All P0/P1 audit findings closed. Tier 1 harness 37/0/1.

**Hard rule for future Claude sessions**: every line of code with a `v2.16.10 2026-04-30` comment was fixed in this batch. **DO NOT REVERT** unless you have explicit human approval AND have re-read the audit findings in this ledger. The bug class is "PostgREST silently drops unknown keys" — reverting any of these silently breaks a production code path.

Audits referenced (all in `tasks/*.output`):
- 6 initial dataLEAKS (credit-ticket, dedupe, inventory, carwash, salon, restaurant, concesionario, e-CF, sync/RLS)
- Desktop deep-audit
- Web post-fix verify
- 4 exhaustive vertical audits (carwash+tienda, salón+restaurant, concesionario+mecánica, cross-cutting)

---

## Section 1 — RLS / Schema migrations (Management API)

### 1.1 Sealed cross-tenant leak: `restaurant_reservations`
- **Was**: 4 anon policies (SELECT/INSERT/UPDATE/DELETE) with predicate `business_id IS NOT NULL` — matches every row → fully open to any anonymous internet user. Cross-tenant read AND wipe.
- **Fix**: dropped 4 anon policies, replaced with single `restaurant_reservations_jwt_modify` (Pattern 1 — JWT-claim-only).
- **Verify**: `node scripts/rls-policy-audit.mjs` passes; `pg_policies` for the table shows only the JWT policy.

### 1.2 Sealed cross-tenant leak: `service_recipe_items`
- Same shape, same fix as 1.1.

### 1.3 Schema additions: `tickets`
- Added: `servicio_pct numeric`, `servicio_amount numeric`, `appointment_supabase_id uuid` + index.
- **Closes**: restaurant 10% Servicio (Ley 16-92) was charged to customer but lost on save — column didn't exist. Salón ticket→appointment linkage couldn't persist.

### 1.4 Schema additions: `work_orders`
- Added: `ticket_id integer`, `ticket_supabase_id uuid` + index, `facturado_at timestamptz`.
- **Closes**: WO→ticket bridge wrote columns that didn't exist. Every facturado WO was silently lost.

### 1.5 (PENDING THIS BATCH) Schema additions: `restaurant_reservations`
- Plan: add `deposit_amount numeric`, `deposit_status text`, `deposit_ticket_supabase_id uuid`.
- **Closes**: reservation deposits had no fiscal trail (cash collected without ticket/e-CF).

### 1.6 (PENDING THIS BATCH) Schema additions: `cuadre_caja`
- Plan: add `status text`, `opened_at timestamptz`, `opening_cash numeric`.
- **Closes**: desktop SQLite has shift lifecycle cols, cloud doesn't. Multi-device shifts invisible to peers.

### 1.7 (PENDING THIS BATCH) RLS lockdown: replace `{public}` qual=null INSERT policies
- Affected: `tickets_ins`, `app_settings_ins`, `cuadre_caja_ins`, `ecf_queue_ins`, `empleados_insert`, `inventory_items_ins`, `inventory_transactions_ins`, `kds_events_insert`, `ecf_cert_history_ins`, `insurance_batches_anon_insert`.
- Plan: replace each with Pattern 1 JWT-claim-only INSERT.
- **Closes**: anon-INSERT vector. Stolen anon key + crafted JWT → cross-tenant ticket insert.

### 1.8 (PENDING THIS BATCH) Set `go_live_date` for Studio X SRL
- Was: `app_settings.go_live_date = ''` for biz `1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79`.
- Plan: set to `2026-04-25` (SXAD certified live date).
- **Closes**: `_liveWeb=false` → every web-issued ticket flagged `is_test=true`, commissions/NCF/ANECF all skipped.

---

## Section 2 — Web POS / data layer (`packages/data/web.js` + `packages/ui/`)

### 2.1 Stock-zero hard block (POS.jsx addToCart)
- **Was**: grid disabled out-of-stock buttons, but barcode scan + search bypassed the visual disable. New cart line created at qty=1 even when product.quantity=0.
- **Fix**: `addToCart` guard at top: if `tracks_stock !== false && quantity <= 0` → flash + return.
- **Verify**: scan a zero-stock SKU → toast "Sin stock — {name}", no cart line.

### 2.2 Per-business toggles (Mi Empresa)
- Added 4 toggles via `BusinessFeatureToggles` in Admin.jsx: Comisiones, Descuentos al cobrar, ITBIS por producto en recibo, Verificación de edad.
- All persist via `app_settings.feature_<name>_enabled` (existing override scheme from `useBusinessType.jsx`).

### 2.3 Receipt ITBIS per-line (printer.js)
- Optional sub-line "  ITBIS 18%   X.XX" under each taxable item, gated on `cfg.receipt_itbis_per_line`. INFORMATIONAL — totals block remains authoritative.
- Default OFF. Re-introduces v2.14.34 deleted feature, but only when the owner explicitly toggles it.

### 2.4 Discount section gating (CobrarModal.jsx)
- `discountsEnabled = useBusinessType().hasFeature('discounts')` — when OFF, descuento input + reason hidden, manualDescuento forced to 0.
- 3 onConfirm sites: `clientId`, `clientSupabaseId`, `clientName` all passed.

### 2.5 Cart qty editable input (POS.jsx)
- New `setQty(cartId, raw)` function. Editable number field on each cart line replaces the click-N-times +/- pattern.

### 2.6 Cuadre redesign (CashReconciliation.jsx)
- Full replace: 3-card flow (auto resumen → 3-input conteo → notes). Removed denomination grid + USD breakdown + V.Azul/Carnet/Visanet split + 4 outflow inputs.
- Now 3 inputs: efectivo + tarjeta + transferencia. `api.cuadre.create` payload contract preserved.

### 2.7 Schema-drift sweep — `tickets.client_supabase_id` + `client_name`
- **Was**: POS sent `client_id` but Supabase tickets has only `client_supabase_id` + `local_client_id` + `client_name`. PostgREST swallowed the unknown key. Every Ranoza ticket landed with `client_supabase_id=NULL` → balance never updated → Credits screen empty.
- **Fix**: CobrarModal × 3 onConfirm sites pass `clientSupabaseId` + `clientName`. POS × 3 ticket-create sites forward to API. web.js insert persists both.
- **Verify**: ring credit ticket → check `clients.balance` increments; Credits screen lists open ticket.
- **DO NOT REVERT**: PostgREST silent-drop bug. Without these fields the credit flow is dead.

### 2.8 Schema-drift sweep — `ticket_items.inventory_item_supabase_id`
- **Was**: cart only set `inventory_item_id: product.id` (a UUID written to int column → silently NULL). Payload mapper × 2 dropped the field. web.js auto-deduct gate `if (invSid)` always false → UPDATE skipped. **Web POS had NEVER decremented inventory since launch.**
- **Fix**: 3 cart-add paths set `inventory_item_supabase_id: product.supabase_id`. 2 payload mappers forward it. WO bridge hydrates it from `inventory.all()` lookup at cobrar-time for legacy WOs.
- **Verify**: ring tienda sale → check `inventory_items.quantity` decrements.
- **DO NOT REVERT**: same bug class as 2.7.

### 2.9 Schema-drift sweep — `tickets.mesa_supabase_id` (web.js mesa flow)
- **Was**: web.js mesa transferToMesa + merge selected `mesa_id` from tickets — column doesn't exist. NULL → same-mesa guard fell open, old mesa never freed.
- **Fix**: replaced ~6 references. All lookups via `mesa_supabase_id`.

### 2.10 Schema-drift sweep — `Appointments.jsx` no-show fee
- **Was**: sent legacy `client_id` to tickets.create.
- **Fix**: now sends `client_supabase_id` + `client_name`.

### 2.11 Schema-drift sweep — `TestDriveFunnelReport`
- **Was**: grouped leads by `assigned_to_supabase_id` (col doesn't exist), test_drives by `salesperson_supabase_id` (col is `staff_supabase_id`). Every funnel row bucketed into `__none__`.
- **Fix**: `leads.salesperson_supabase_id`, `test_drives.staff_supabase_id`.

### 2.12 (PENDING) tickets.create insert — persist remaining dropped fields
- Plan: add `ncf`, `descuento_reason`, `comentario` (notes), `mac_jti`, `oferta_supabase_id`, `cajero_supabase_id` (resolved from numeric).
- **Closes**: P0-A through P0-E from carwash audit. NCF=NULL on every Ranoza ticket. Discount audit has no auth-card token. Cajero commissions zero on web.

### 2.13 (PENDING) `clients.create` return supabase_id
- Plan: select+return `id, supabase_id` after insert.
- **Closes**: quick-add client → first credit ticket → no client linkage. `loyaltyAward` early-returns on missing sid.

### 2.14 (PENDING) `api.tickets.updateItemPrice` impl
- Plan: implement on web.js. Manager-gated mid-wash price edit currently throws TypeError on web.

### 2.15 (PENDING) `api.commissions.byTicket` impl
- Plan: implement on web.js. Multi-washer cobrar conduce print + factura comm line need it.

### 2.16 (PENDING) Queue washer reassign — resolve sids
- Plan: `Queue.jsx:542` passes numeric ID to UUID column → `22P02`. Resolve via `resolveEmpleadoSidsRaw` in web.js queue.updateStatus.

### 2.17 (PENDING) Returns dispatch — E33/E34 vs B04
- Plan: `Returns.jsx:171,173` and `CreditNotes.jsx:289` hardcode B04. On ECF-live (`dgii_environment='ecf'/'certecf'`) route to E33 (parcial) / E34 (anulación).
- **Closes**: DGII non-compliance. Returns under wrong sequence.

### 2.18 (PENDING) Partial credit payment fix
- **Was**: `collectCredit` flips ALL ticket_ids to `cobrado` regardless of cumulative paid. Web + desktop both have it.
- Plan: only flip cobrado if cumulative `SUM(amount)` ≥ ticket.total. Else keep `pendiente`, decrement balance.

### 2.19 (PENDING) NCF decrement on void — E-prefix
- Plan: `ncfSequenceDecrementIfLast` currently only handles legacy B-series on web. Add E-prefix branch + ANECF enqueue.

### 2.20 (PENDING) Other web column-name fixes
- `web.js:6056` `empleados.commission_pct` → `comision_pct`.
- `web.js:6637-6638` drop `services.duration_min` and `empleados.foto_url` (don't exist).
- `web.js:4366` `caja_chica.update` writes `approved_by` — should be `approved_by_supabase_id`.

---

## Section 3 — Desktop / Electron (`electron/database.js` + `sync.js`)

### 3.1 (PENDING) `cuadreCreate` UPDATE-existing-open path
- Was: unconditional INSERT — leaves `status='abierto'` orphan. Plan: UPDATE existing row WHERE date=today AND status='abierto', else INSERT.

### 3.2 (PENDING) Desktop `collectCredit` partial-pay
- Same logic as 2.18.

### 3.3 (PENDING) `inventoryDelete` + `empleadoDelete` + `empleadoHardDelete` activity_log
- Add `activityLogRecord` calls. Especially `empleadoHardDelete` which DROPs `salary_changes` rows.

### 3.4 (PENDING) `app.requestSingleInstanceLock()` for ANECF drainer
- electron/main.js — add lock so two electron instances can't double-submit ANECF rows.

### 3.5 (PENDING) Tickets push descriptor — add 9 missing columns
- electron/sync.js: add `servicio_pct`, `servicio_amount`, `currency`, `fx_rate`, `appointment_supabase_id`, `project_id`, `project_supabase_id`, `origin_hwid`, `origin_device_label`, `is_test`.

### 3.6 (PENDING) `APPEND_ONLY_TABLES` set expansion
- electron/sync.js: add `washer_commissions`, `seller_commissions`, `cajero_commissions`, `credit_payments`, `payroll_runs`, `salary_changes`, `loyalty_transactions`, `anecf_queue`, `ecf_cert_history`, `ecf_submissions`, `membership_redemptions`, etc. Currently 1 entry, cloud has 17 append-only.

### 3.7 (PENDING) `cuadre_caja` push descriptor
- Add `status`, `opened_at`, `opening_cash` columns to push (after schema migration 1.6).

### 3.8 (PENDING) Backup integrity verify
- electron/db-backup.js: add HEAD/checksum verify after upload, alert on 2+ consecutive failures, retention only after good upload.

### 3.9 (PENDING) Sync push/pull mutex
- electron/sync.js: prevent concurrent push/pull on same 5-min tick.

---

## Section 4 — Sync hardening (THE big one)

### 4.1 (PENDING) Per-table merge strategies
- electron/sync.js: replace blanket `Prefer: resolution=merge-duplicates` with:
  - **Counters** (`inventory_items.quantity`, `clients.balance`, `loyalty_points`, `ncf_sequences.current_number`, `client_memberships.sessions_remaining`, `users.pin_failed_attempts`/`pin_locked_until`, `wash_combos.used_washes`, `service_packages.used_sessions`): server-side RPC with `WHERE existing.updated_at < incoming.updated_at` guard. CAS pattern.
  - **Append-only tables** (the 17 in 3.6): `resolution=ignore-duplicates`.
  - **Status fields** (LWW currently safe): keep merge-duplicates.
- **Closes**: every counter fix above this layer is reverted within 5 min whenever desktop pushes stale.
- **Verify**: `audit-flows.mjs` LWW scenario flips green.

---

## Section 5 — Pre-existing fixes shipped earlier today (Batches 1+2+3 — already in code)

(These were the morning's work — listed for completeness.)

| Fix | Section | File:line |
|---|---|---|
| Stock guard | 2.1 | POS.jsx addToCart |
| Mi Empresa toggles | 2.2 | Admin.jsx BusinessFeatureToggles |
| Receipt ITBIS per-line | 2.3 | printer.js buildClientReceipt |
| Discount toggle | 2.4 | CobrarModal.jsx |
| Cart qty input | 2.5 | POS.jsx setQty |
| Cuadre redesign | 2.6 | CashReconciliation.jsx |
| client_supabase_id sweep | 2.7 | CobrarModal × 3 + POS × 3 + web.js insert |
| inventory_item_supabase_id sweep | 2.8 | POS × 3 cart-adds + 2 payload mappers + WO bridge |
| Mesa flow sweep | 2.9 | web.js transferToMesa + merge |
| Salon no-show fee | 2.10 | Appointments.jsx |
| TestDriveFunnelReport | 2.11 | TestDriveFunnelReport.jsx |
| Schema migrations 1.3 + 1.4 | — | Supabase Management API |
| RLS leak seal 1.1 + 1.2 | — | Supabase Management API |

---

## Section 6 — Verification (run before declaring batch done)

```bash
node scripts/rls-policy-audit.mjs   # exit 0 — RLS policies valid
node scripts/ranoza-e2e-smoke.mjs   # 28+ tests
node scripts/audit-flows.mjs        # Tier 1 harness — silent-drop detector
```

All three must exit 0.

`audit-flows.mjs` reds expected to flip green after this batch:
- ✅ "credit ticket → clients.balance increments" (after 2.7 + sync 4.1)
- ✅ "cobrado ticket → inventory.quantity decrements" (after 2.8 + sync 4.1)
- ✅ "void ticket → inventory restored + commissions reversed + NCF decremented + ANECF enqueued" (after 2.19 + 3.4 + RPC `ticket_void_with_side_effects`)
- ✅ "appointment ticket booked → appointment.status=completed" (after salón pipeline fix)
- ✅ "LWW: stale push must NOT revert newer counter" (after sync 4.1)

---

## DO NOT REVERT clauses (codified contract)

Future Claude sessions: if you find yourself about to touch any of the following, STOP and re-read the relevant section here:

- `web.js` tickets insert (Section 2.7, 2.8, 2.12) — multiple silently-dropped fields. The fields LOOK redundant if you only test the happy path. They are NOT.
- `web.js` mesa flow (Section 2.9) — `tickets.mesa_id` is GONE. Code must use `mesa_supabase_id` only.
- `Appointments.jsx` no-show fee (Section 2.10) — the legacy `client_id` is the bug. Don't put it back.
- `TestDriveFunnelReport` columns (Section 2.11) — the column names are deliberate and verified against schema.
- All `v2.16.10 2026-04-30` code comments — each closes a specific audit finding.
- `electron/sync.js` `APPEND_ONLY_TABLES` set (Section 3.6) — every entry has a verified RLS UPDATE rejection. Removing any silently corrupts the table on retry.
- `electron/sync.js` per-table merge strategies (Section 4.1) — counters MUST go through CAS RPC. Reverting to `merge-duplicates` corrupts every counter within 5 minutes of being online.

If a future change MUST modify one of these, the change MUST:
1. Re-run `audit-flows.mjs` after the change.
2. Show the test scenario that proves the new behavior is correct.
3. Update this ledger with the new date + reason.
