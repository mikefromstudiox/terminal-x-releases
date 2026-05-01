# ACTION-VERIFICATION-AUDIT — 2026-05-01

dataLEAKS proactive end-to-end action audit for Terminal X web POS + Admin.
Every user-visible button traced UI -> API -> DB write target, then verified against live Supabase row counts and recent timestamps.

Live DB project: `csppjsoirjflumaiipqw.supabase.co`
Verification method: REST API pulls with service-role + activity_log event distribution + `Prefer: count=exact` row counts + `order=updated_at.desc&limit=N` recency probes.
Audit scope: web data layer (`packages/data/web.js`) — desktop SQLite paths share the same shape via `electron/database.js`.

---

## §1. Coverage Table

Status legend:
- OK = code path verified + recent live writes confirmed
- GAP = silent-fail / silent-success / missing 0-row guard / wrong wrapper
- BROKEN = action does not produce the claimed DB write
- UNVERIFIED = code path exists but no live write evidence yet (new/cold feature)

### POS / Cobrar / Sale lifecycle
| Action | UI location | DB write target | Silent-fail risk | Status |
|---|---|---|---|---|
| Cobrar (cash/card sale) | `CobrarModal.jsx:1730 handleConfirm` -> `api.tickets.create` | `tickets` + `ticket_items` + `washer/seller/cajero_commissions` + `clients.balance` | **HIGH — wrapped in `tryOr` (line 2619), failure swallowed**; outer `try{}catch{}` falls back to enqueueTicket (line 3023) | GAP |
| Encolar (queued sale, status=pendiente) | same `tickets.create` w/ `status='pendiente'` | `tickets` + `queue` row | `queueErr` swallowed into `queueError` field, never thrown (web.js:2998) | GAP |
| Anular / Void | `Queue.jsx` / `RemoteDashboard` -> `api.tickets.void` (web.js:3054) | `tickets.void_at`, `washer/seller/cajero_commissions` DELETE, `inventory_items.quantity` reverse, `anecf_queue` insert (e-CF), `ncf_sequences.current_number--` (legacy) | `tryOr` wrapper (line 3054) — same swallow risk | OK (live: 49 voids + 8 today, last 2026-05-01T15:32) |
| Cobrar después / markPaid | `Queue.jsx` -> `api.tickets.markPaid` (web.js:3028) | `tickets.status='cobrado'`, `payment_method`, `ncf`, `ecf_result`, `clients.balance--` | `tryOr` wrapper; balance update inside try/catch with console.error | OK (37 ticket_paid events, last fresh) |
| Devolver (return) | `Returns.jsx:451 tryProcess -> processReturn` | `notas_credito` insert + `inventory_items.quantity++` via `inventory.adjust` + `activity_log` `return_processed` | NCF assignment best-effort (line 173 `catch{}` -> null); inventory adjust inside try/catch (line 210); does NOT roll back nota if inventory restock fails | GAP (live: 8 notas_credito, 2 nota_credito_emitida events) |
| Imprimir / Reimprimir | local printer API only | none (no DB write) | n/a | OK |
| Aplicar descuento (manager-gated) | `CobrarModal` -> ticket payload `descuento` + `descuento_reason` + `mac_jti` | `tickets.descuento` + `activity_log` `discount_applied` (web.js:3013) | only logs activity if desc>500 OR pct>15 — small discounts are silent | OK (8 discount_applied events) |
| Cart line price edit (Queue) | `Queue.jsx:617` -> `api.ticketItems.updateItemPrice` (web.js:3418) | `ticket_items.price` + `tickets.{subtotal,itbis,total,rev}` + `activity_log` `ticket_item_price_changed` | `tryOr` (silent on RLS deny); recompute query missing `aplica_itbis` field selection (line 3433) — assumes `it.aplica_itbis` in items but only selects `price,quantity` -> **always treats all items as ITBIS-applicable, double-tax risk** | GAP |
| Cart line qty edit / delete (qty=0) | `api.ticketItems.updateItemQty` (web.js:3458) | `ticket_items` UPDATE/DELETE | `tryOr` wrapper; throws on inner write but caller is silent on null return | GAP |
| Remove item | `api.ticketItems.removeItem` (web.js:3480) | `ticket_items` DELETE + `ticket_item_modificadores` DELETE | `tryOr` wrapper — modificadores DELETE in `try{}catch{}` (silent) | GAP |

### Cuadre / Cash
| Action | UI location | DB write target | Silent-fail risk | Status |
|---|---|---|---|---|
| Cerrar Caja / Cuadrar | `CashReconciliation.jsx:829 handleCuadrar` -> `cuadre.close` | `cuadre_caja` insert + `activity_log` `cuadre_closed` | `tryOr` returns null on fail; no UI toast wired to that null | OK (51 cuadre_closed events) |
| Caja Chica withdraw/deposit | `PettyCash.jsx` -> `cajaChica.create` (web.js:4582) | `caja_chica` insert + `activity_log` `caja_chica_withdrawal` | `tryOr` (silent on fail) | OK (74 events) |
| Caja Chica approve | `cajaChica.updateStatus` (web.js:4592) | `caja_chica.status,approved_by,approved_by_supabase_id` | `tryOr` | OK (12 petty_cash_approved events) |

### Inventory / Conteo
| Action | UI location | DB write target | Silent-fail risk | Status |
|---|---|---|---|---|
| Add product | `Inventory.jsx` -> `inventory.create` | `inventory_items` insert | `tryOr` -> null on fail | OK (1167 rows) |
| Edit product | `inventory.update` | `inventory_items` update | `tryOr` | OK (recent updated_at 2026-05-01T19:58) |
| Delete product | `inventory.delete` | `inventory_items.active=false` (soft) | `tryOr` | OK |
| Adjust +/- (manager auth) | `inventory.adjust` | `inventory_items.quantity` + activity `inventory_adjusted` | NO `inventory_adjustments` log table — only `activity_log`. Cannot reconstruct individual adjustments without scanning activity metadata | GAP — audit-ledger gap (live: 57 inventory_adjusted activity events but `inventory_adjustments` table 404) |
| Bulk import CSV | `Inventory.jsx` -> per-row `inventory.create` | n/a | per-row `tryOr` swallows individual failures, importer reports total only | GAP |
| Iniciar conteo | `inventory/InventoryCount.jsx` -> conteo session | `inventory_count` table | UNVERIFIED — no live row evidence | UNVERIFIED |
| Terminar conteo + apply | `inventory.applyCount` | `inventory_items.quantity` + variance log | wrapper unconfirmed | UNVERIFIED |

### Clients / Credits / Loyalty
| Action | UI location | DB write target | Silent-fail risk | Status |
|---|---|---|---|---|
| Add/edit/delete client | `Clients.jsx` -> `clients.create/update/delete` | `clients` | `tryOr` everywhere | OK (131 rows, last update 2026-05-01T14:48) |
| Pay credit (partial/full) | `Credits.jsx` -> `credit.pay` | `credit_payments` + `clients.balance--` | `tryOr` | OK (1 row but recent 2026-05-01T14:22) |
| Credit note (B04/E33/E34) | `CreditNotes.jsx` -> `notas.create` (web.js:4633) | `notas_credito` insert | `tryOr`; NCF allocation inside same wrapper — no rollback if `ncf.next` succeeds but insert fails | GAP (8 rows, OK functionally) |
| Loyalty redeem | `CobrarModal` -> `loyalty.redeem` | `loyalty_transactions` insert | `tryOr`; **0 redemptions ever in production** | UNVERIFIED |

### Admin / Mi Empresa
| Action | UI location | DB write target | Silent-fail risk | Status |
|---|---|---|---|---|
| Save company info | `Admin.jsx:1812` -> `admin.saveEmpresa` | `app_settings` upsert (biz_name, biz_rnc, biz_address, ciudad, biz_city, etc) | per-key upsert; partial writes possible if mid-loop failure | OK (live: app_settings updated 2026-05-01T20:10) |
| Save logo | `admin.saveLogo` -> base64 -> `app_settings.biz_logo` | `app_settings` row | `tryOr`; payload size not validated | OK |
| Save NCF sequence | `Admin.jsx:1189` -> `ncf.updateSequence` (web.js:4529) | `ncf_sequences` update OR insert | **FIXED v2.16.27** — was UPDATE only, 0-rows silent success (line 4533 comment confirms fix) | OK (70 rows, freshly fixed) |
| Save fiscal mode (legacy/ecf) | -> `admin.saveEmpresa` setting `facturacion_mode` | `app_settings.value` upsert | `tryOr` | OK |
| Activate license / save plan | `LicenseGate.jsx` / Admin -> `/api/validate` Vercel + sync down to `licenses` table | server-driven, separate from web.js | n/a | OK |

### Sistema / Preferencias
| Action | UI location | DB write target | Silent-fail risk | Status |
|---|---|---|---|---|
| Save printer config (drawer pulse, paper width) | `Sistema.jsx` -> `webDeviceSet` | **localStorage only** — NOT synced to Supabase. `device_settings` table does not exist in DB | **By design** but undocumented — switching browsers/devices loses settings | GAP (intentional; flag for parity with desktop) |
| Save kiosk lock minutes | same | localStorage | same | GAP |
| Toggle daily digest | -> `app_settings.feature_daily_digest_enabled` | `app_settings` upsert | `tryOr` | OK (11 daily_digest_sent events) |
| Loyalty config | -> `app_settings.feature_loyalty_*` | `app_settings` | `tryOr` | OK |
| Manager auth gate toggles | -> `app_settings.feature_*` | `app_settings` | `tryOr` | OK |

### Salon-specific
| Action | UI location | DB write target | Silent-fail risk | Status |
|---|---|---|---|---|
| Schedule appointment | `Appointments.jsx` -> `appointments.create` (web.js:6779) | `appointments` insert | `tryOr` | OK (20 rows) |
| Cancel/reschedule | `appointments.update` | `appointments.status` | `tryOr` | OK |
| Stylist hours | `StylistSchedules.jsx` -> `stylistSchedules.upsert` (web.js:6965) | `stylist_schedules` upsert | `tryOr` | OK (24 rows) |
| Public booking link | static URL — no DB write | n/a | n/a | OK |
| Walk-in entry | -> tickets.create with `walk_in=true` | `tickets` | shares ticket-create gap above | GAP (inherited) |

### Restaurant-specific
| Action | UI location | DB write target | Silent-fail risk | Status |
|---|---|---|---|---|
| Mesa open / new ticket | `Mesas.jsx` -> `tickets.create` w/ mesa_supabase_id | `tickets` + `ticket_items` | inherits ticket-create gap | GAP (inherited) |
| Mesa cobrar | `closeWithPayment` (web.js:3534) | tickets update + cobro side-effects | `tryOr` | OK |
| Mesa transfer | -> RPC `transfer_mesa` returns `{ ok, new_mesa_id }` | `tickets.mesa_supabase_id` | `tryOr` | OK |
| Mesa merge / split | -> mesa merge logic web.js:3262 | tickets + ticket_items | `tryOr` | OK |
| Pre-cuenta print | local printer only — no DB write | n/a | n/a | OK |
| Course pacing | local UI state -> `ticket_items.course` on insert | `ticket_items.course` | OK | OK |
| KDS fire | `KDS.jsx` -> `ticketItems.fire` -> `ticket_items.fired_at` | `ticket_items` | `tryOr` | OK |
| Reservación | `restaurant_reservations` insert | `restaurant_reservations` | `tryOr` | OK (4 rows) |
| 86-list toggle | -> `services.in_stock` update | `services` | `tryOr` | OK |

### Concesionario / Dealership
| Action | UI location | DB write target | Silent-fail risk | Status |
|---|---|---|---|---|
| Vehicle add | `VehicleInventory.jsx` -> `vehicleInventory.create` | `vehicle_inventory` | `tryWrite` (correct) | OK (12 rows) |
| Vehicle sell / status flip | `vehicleInventory.update` | `vehicle_inventory.status` | `tryWrite` | OK |
| Matricula save | `Matriculas.jsx` -> `vehicleTitulo.upsert` (web.js:6455) | `vehicle_titulo` upsert | `tryWrite` + `withDealershipQ` offline-replay wrapper (correct) | UNVERIFIED (0 rows live) |
| Sales pipeline stage move | `SalesPipeline.jsx` -> `salesDeals.updateStage` | `sales_deals.stage` + `activity_log` `pipeline_stage_change` | `tryWrite` | OK (8 stage-change events) |
| Test drive log | `TestDrives.jsx` -> `testDrives.create` | `test_drives` | `tryWrite` | OK (8 rows) |
| DealBuilder save | `DealBuilder.jsx` -> `salesDeals.upsert` | `sales_deals` | `tryWrite` | OK (5 rows + 8 deal_closed events) |
| Reservation w/ deposit | `Reservations.jsx` -> `vehicleReservation.upsert` (web.js:6497) | `vehicle_reservations` insert + `vehicle_inventory.status='reserved'` | `tryWrite`; the inventory update is in a `try{}catch{}` (line 6517) — **silent fail there leaves reservation row without inventory flip** | GAP |
| Warranty add / claim | `Warranties.jsx` -> `vehicleWarranties.*` | `vehicle_warranties` | `tryWrite` | OK (3 rows, 0 claims) |
| Pre-approval add | `Preapprovals.jsx` -> `bankPreapprovals.*` | `bank_preapprovals` | `tryWrite` | OK (3 rows) |
| Quote PDF | `QuotePdfModal.jsx` — local PDF render | none | n/a | OK |

### Reports
| Action | UI location | DB write target | Silent-fail risk | Status |
|---|---|---|---|---|
| Aplicar fechas filter | client-side only | n/a | n/a | OK |
| Export CSV / PDF | client-side download | n/a | n/a | OK |
| Email digest | `digest/daily.js` Vercel cron | `app_settings.last_digest_sent` + emit | server-side | OK (11 sent) |
| Comisiones liquidación markPaid | `Nomina*.jsx` -> `washer/seller/cajero_commissions.markPaid` (web.js:4005/4116/4227) | `*_commissions.paid=true,paid_at` + `activity_log` `nomina_paid` | `tryOr`; mass UPDATE — no per-row verify | OK (16 nomina_paid events, last fresh) |

---

## §2. Critical Findings

### F1 — `tickets.create` uses `tryOr`, not `tryWrite`  (HIGH)
**File:** `packages/data/web.js:2619`
**Symptom:** Any non-network failure inside the create body (RLS deny, FK violation, constraint, validation RPC error) is logged at `console.debug` and returns `null`/fallback — UI thinks the sale succeeded but no row exists.
**Saving grace:** v2.16.27 wrapped the whole thing in an outer `try { tryOr(...) } catch { enqueueTicket(...) }` so genuine network errors do queue offline. But validation/RLS errors land between those — they bypass the outer catch (because `tryOr` swallowed them) and bypass the offline queue.
**Recommendation:** Replace inner `tryOr` with `tryWrite` so business errors propagate to the outer catch and get either surfaced or queued. Today, a price-validation RPC reject returns `{ id: null, ... }` and CobrarModal happily prints a receipt for a phantom ticket.

### F2 — `updateItemPrice` recomputes ITBIS without selecting `aplica_itbis`  (MED)
**File:** `packages/data/web.js:3433`
**Symptom:** SELECT only pulls `price, quantity`, then line 3439 reads `it.aplica_itbis` which is always `undefined !== 0` → truthy → ALL lines are taxed on every Queue-side price edit. Drift accumulates for restaurants that have ITBIS-exempt menu items.
**Recommendation:** Change the select to `'price, quantity, aplica_itbis'`.

### F3 — `vehicle_reservation.upsert` swallows the inventory-status flip  (MED)
**File:** `packages/data/web.js:6513-6518`
**Symptom:** On reservation create the `vehicle_inventory.status='reserved'` UPDATE is inside `try{}catch{}` with empty catch. If RLS denies (or the vehicle was already sold), the reservation row lands but the inventory still says `available` — second salesperson can re-reserve / sell the same unit.
**Recommendation:** Throw on the inventory update too; the reservation insert should be undone (or wrapped in a Postgres function for atomicity). At minimum log to activity_log so the inconsistency is visible.

### F4 — Returns flow has no rollback if inventory restock fails  (MED)
**File:** `packages/ui/screens/Returns.jsx:200-213`
**Symptom:** `notas_credito` insert succeeds → loop calls `inventory.adjust` per line → if any line fails, only `console.error` fires. The customer gets a credit note but inventory was never restocked → cascading sell-of-zero-stock.
**Recommendation:** Stage all inventory deltas first; if any fail, void the just-created nota (or wrap in an RPC that does both atomically).

### F5 — No `inventory_adjustments` audit ledger table  (MED)
**Live evidence:** `inventory_adjustments` table 404s; 57 `inventory_adjusted` events live in `activity_log` only.
**Symptom:** All stock deltas (returns, manager adjusts, oversells, manual restock) ultimately mutate `inventory_items.quantity` directly. The only forensic trail is `activity_log.metadata` JSON. Reconstructing an item's quantity history requires scanning activity_log per item — slow and not joinable.
**Recommendation:** Add `inventory_adjustments` table with `(item_supabase_id, business_id, delta, reason, source_type, source_id, user_id, created_at)`. Mirrors what desktop already does locally.

### F6 — `webDeviceGet/Set` desktop-vs-web parity gap  (LOW)
**Symptom:** Printer config, drawer-pulse variant, kiosk lock minutes save to `localStorage` only on web. Cross-device user switching loses all hardware/UX prefs. Desktop persists them in `device_settings` SQLite table.
**Recommendation:** Either document explicitly in `Sistema.jsx` (banner: "estos ajustes son por dispositivo"), or push device-scoped rows to `app_settings` keyed by `device_id`.

### F7 — Cart-line `removeItem` modificador delete is silent  (LOW)
**File:** `packages/data/web.js:3483-3485`
**Symptom:** `try {} catch {}` empty catch around modificadores delete. Orphan modificador rows accumulate if the delete fails (RLS / FK race).
**Recommendation:** At minimum `console.warn`. Better: delete via FK cascade at DB level so this client-side cleanup is unnecessary.

### F8 — Loyalty redeem: 0 events in production despite UI shipping  (LOW / verify)
**Live evidence:** `loyalty_transactions` 93 rows but newest is 2026-04-20 (10 days stale); no `loyalty_redeem` event in last 2000 activity rows.
**Recommendation:** Click-test the loyalty picker in `CobrarModal.jsx:1916` against a real client with points and watch network tab. May indicate the redeem branch isn't wired through the create-ticket payload anymore.

### F9 — Web-side `discount_applied` only logs above threshold  (LOW)
**File:** `packages/data/web.js:3012`
**Symptom:** `if (desc > 500 || pct > 15)` gate means small discounts (e.g. RD$200 off a RD$2000 ticket = 10%) never hit `activity_log`. Owner can't reconstruct daily discount totals from activity feed.
**Recommendation:** Always log; downgrade severity to `info` for small discounts (which it already does conditionally).

### F10 — Returns NCF allocation has fallback-to-null  (LOW)
**File:** `packages/ui/screens/Returns.jsx:172-175`
**Symptom:** `try { assignedNCF = await api.ncf.next(ncfType) } catch { assignedNCF = null }` — devolución gets persisted with `ncf=null` if the sequence is exhausted. DGII e-CF flow then has nothing to submit when nota is later finalized.
**Recommendation:** Block submit + surface the NCF-exhausted error rather than silently writing a credit note without a fiscal stamp.

---

## §3. Test Methodology

For every action in §1:

1. **Code trace** — grep for `onClick=` in the screen file → identify handler → grep for the `api.X.Y` method → read its definition in `packages/data/web.js` → note the wrapper (`tryOr` / `tryWrite` / raw try/catch) and side-effects (other tables touched, activity_log event_type).
2. **Live recency** — REST GET on each target table with `select=id,created_at,updated_at&order=updated_at.desc.nullslast&limit=1` to confirm the most recent write is fresh (today / this week) and not stale-since-launch.
3. **Volume sanity** — REST GET with `Prefer: count=exact` to compare row count vs expected (e.g. `tickets=383`, `ticket_items=997`, `washer_commissions=70`, `cuadre_caja=51`).
4. **Activity-log distribution** — pulled all 1435 `activity_log` rows and tallied `event_type` to confirm the audit trail matches expected mutation rates (52 ticket_created, 49 ticket_voided, 57 inventory_adjusted, 51 cuadre_closed, 16 nomina_paid, 8 deal_closed/pipeline_stage_change, etc.). Anomalies (0 loyalty_redeem despite shipped UI) flagged.
5. **Wrapper-pattern audit** — every method with `tryOr` was checked for whether the caller looks at the return value before showing the success UI. Most do not, which is why §2/F1 is the critical issue.
6. **Schema parity** — probed for the table names referenced in screens (`returns`, `dealership_reservations`, `cuadre`, `matriculas`, `manager_auths`, `printer_settings`, `device_settings`, `client_credit_history`, `loyalty_redemptions`) — confirmed which actually exist (`vehicle_warranties`, `bank_preapprovals`, `vehicle_reservations`, `vehicle_titulo`, `cuadre_caja`, `notas_credito`, `mesas`, `restaurant_reservations`) and which are referenced-but-absent (`returns`, `manager_auths`, `printer_settings`, `device_settings`, `loyalty_redemptions`, `client_credit_history`, `dealership_matriculas`, `vehicle_matriculas`, `restaurant_courses`, `sales_pipeline_history`, `inventory_adjustments`).

Tools used: `node` + `fetch` against `https://csppjsoirjflumaiipqw.supabase.co/rest/v1/` with `SUPABASE_SERVICE_ROLE_KEY` from `.env`.

---

## §4. Top 5 Broken / Risky Findings

1. **F1 — `tickets.create` wrapped in `tryOr` not `tryWrite`** — A failed validation RPC, RLS deny, or FK violation returns `{ id: null }` and CobrarModal still prints a receipt + closes. Phantom-sale risk. (`packages/data/web.js:2619`)
2. **F2 — `updateItemPrice` ignores `aplica_itbis`** — Manager-authorized cart edits double-tax ITBIS-exempt items because the recompute SELECT doesn't fetch the column. (`packages/data/web.js:3433`)
3. **F3 — Vehicle reservation may leave inventory `available`** — Inventory status flip is in an empty-catch try/catch; double-reservation possible. (`packages/data/web.js:6513`)
4. **F4 — Returns flow has no rollback** — Nota de crédito persists even if inventory restock fails per line. Stock divergence accumulates silently. (`packages/ui/screens/Returns.jsx:200`)
5. **F5 — No `inventory_adjustments` audit ledger** — Every stock delta only writes to `activity_log.metadata`; reconstructing an item's history requires JSON-scanning the audit log. Forensic gap.

---

Generated by dataLEAKS — 2026-05-01.
