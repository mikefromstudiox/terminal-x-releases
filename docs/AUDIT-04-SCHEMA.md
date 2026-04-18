# Audit 4 — Schema Parity (SQLite <-> Supabase)

Date: 2026-04-16
Scope: Every table in `electron/sync.js` SYNC_TABLES + PULL_TABLES manifests.
Method: `information_schema.columns` + `information_schema.table_constraints` via Supabase Management API; `db/schema.sql` + `electron/database.js` grep for SQLite.

---

## TOP 5 CRITICAL SCHEMA BUGS (read this first)

1. **`queue_deletions` + `ecf_submissions` have NO UNIQUE `(business_id, supabase_id)` constraint on Supabase.** `sync.js` line 882 upserts every sync table with `?on_conflict=business_id,supabase_id`. For these two tables PostgREST has no matching unique constraint — every retry re-INSERTs duplicate rows (or 400s). Bugs: duplicate queue-deletion audit rows, duplicate e-CF submission log rows.

2. **`salary_changes.empleado_id` is `bigint` on Supabase but the column is **meaningless** (desktop sends `empleado_supabase_id` only).** Supabase schema has both `empleado_id int8` AND `empleado_supabase_id uuid`. Web-created rows can never fill `empleado_id` (web has no local INTEGER — only UUID), so web joins that try `empleados.id = salary_changes.empleado_id` return zero rows. The int8 column is legacy rot. Same rot pattern in `payroll_runs.empleado_id int8`, `ecf_submissions.ticket_id int8`.

3. **`tickets.cajero_id` and `tickets.client_id` on Supabase are `text` not `uuid`.** Every other `*_id` column on the tickets table is properly typed uuid (`seller_id uuid`, `void_by uuid`, `mesa_supabase_id uuid`), but `cajero_id text` and `client_id text` are inconsistent. Desktop sync doesn't write them (writes `cajero_supabase_id` / `client_supabase_id` instead) so they're null everywhere — but any web code that still references them will coerce-compare a UUID string and silently return wrong joins. Should be `uuid` or dropped outright.

4. **`tickets.washer_ids`/`services_json` stored as TEXT on SQLite but JSONB on Supabase.** Pull code in `sync.js` already handles this via `JSON_COLUMNS` stringify, but `ecf_result` (jsonb on Supabase, TEXT on SQLite) and `denominaciones` (same) require the same path. Verified `JSON_COLUMNS` set covers them — OK. But every new jsonb column added later (e.g. `appointments.services jsonb`, `activity_log.metadata jsonb`) must be added to `JSON_COLUMNS` or pulls will write `[object Object]` into SQLite TEXT cells.

5. **`inventory_items.aplica_itbis` is `int4` on Supabase but declared `INTEGER NOT NULL DEFAULT 1` on SQLite — meanwhile `services.aplica_itbis` is `bool NOT NULL DEFAULT true` on Supabase and `INTEGER NOT NULL DEFAULT 1` on SQLite.** The two tables disagree with each other on the server side. Sync code coerces via `!!(...)` for services but raw-passes for inventory. Pull of inventory with `aplica_itbis=1` writes "1" to SQLite correctly; pull of services with `aplica_itbis=true` writes 1 via the boolean branch in `sqliteValue`. OK today but brittle — normalize both to bool.

---

## Table-by-table diff

Legend: **MISSING-REMOTE** = in SQLite not Supabase (silent drop on push). **MISSING-LOCAL** = in Supabase not SQLite (lost on pull). **TYPE-MISMATCH** = column exists both sides with incompatible storage class. **LEGACY** = deprecated `local_*` scaffolding per memory — should be dropped.

### services

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK AUTOINCR | uuid PK DEFAULT gen_random_uuid | OK (different PK domains intentional) |
| supabase_id | TEXT (UNIQUE idx) | uuid NN UNIQUE | OK |
| business_id | n/a (single-tenant) | uuid NN | OK |
| name | TEXT NN | text NN | OK |
| name_en | TEXT | text | OK |
| category | TEXT NN DEF='Lavado' | text NN DEF='Lavado' | OK |
| categoria_id | INTEGER FK→categorias_servicio(id) | uuid | TYPE-MISMATCH (LEGACY — desktop never syncs this column; remove from both) |
| price | REAL NN | numeric NN | OK |
| cost | REAL NN DEF=0 | numeric NN DEF=0 | OK |
| aplica_itbis | INTEGER NN DEF=1 | bool NN DEF=true | TYPE-MISMATCH (coerced OK via `!!()` on push and via `sqliteValue` bool→int on pull) |
| active | INTEGER NN DEF=1 | bool NN DEF=true | TYPE-MISMATCH (coerced OK) |
| is_wash | INTEGER NN DEF=1 | bool NN DEF=true | TYPE-MISMATCH (coerced OK) |
| no_commission | INTEGER DEF=0 | bool DEF=false | TYPE-MISMATCH (coerced OK) |
| commission_washer | INTEGER DEF=1 | bool DEF=true | TYPE-MISMATCH (coerced OK) |
| commission_seller | INTEGER DEF=1 | bool DEF=true | TYPE-MISMATCH (coerced OK) |
| commission_cashier | INTEGER DEF=1 | bool DEF=true | TYPE-MISMATCH (coerced OK) |
| sort_order | INTEGER NN DEF=0 | int4 NN DEF=0 | OK |
| printer_route | TEXT DEF='receipt' | text DEF='receipt' | OK |
| is_menu_item | INTEGER DEF=0 | bool DEF=false | TYPE-MISMATCH (coerced OK) |
| course | TEXT | text | OK |
| station | TEXT | text | OK |
| created_at | n/a (no column!) | timestamptz NN DEF=now() | MISSING-LOCAL (PULL_TABLES cols intentionally omits created_at because "SQLite never declared it") — push always sends `new Date().toISOString()` fallback; pull strips it — OK as-is but confusing |
| updated_at | TEXT (migration-added) | timestamptz NN DEF=now() | OK |
| local_id | n/a | int4 | LEGACY |

**Bugs:** None active today. The `services.created_at` asymmetry (no SQLite column, present on Supabase) is working by accident via PULL_TABLES omission. Add `created_at` to SQLite services for cleanliness.

**Fix:**
```sql
-- SQLite (additive)
ALTER TABLE services ADD COLUMN created_at TEXT DEFAULT (datetime('now'));
-- Supabase (drop LEGACY)
ALTER TABLE services DROP COLUMN local_id;
ALTER TABLE services DROP COLUMN categoria_id; -- only if no web code references it
```

---

### washers

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| business_id | n/a | uuid NN | OK |
| name | TEXT NN UNIQUE | text NN | OK (SQLite enforces uniqueness — natural-key heal works) |
| phone | TEXT | text | OK |
| cedula | TEXT | text | OK |
| commission_pct | REAL NN DEF=20 | numeric NN DEF=20 | OK |
| start_date | TEXT | date | TYPE-MISMATCH (Postgres date vs SQLite TEXT ISO — Supabase accepts ISO strings; OK in practice) |
| active | INTEGER NN DEF=1 | bool NN DEF=true | TYPE-MISMATCH (coerced OK) |
| created_at | TEXT NN DEF=(datetime('now')) | timestamptz NN DEF=now() | OK |
| updated_at | TEXT (ALTER) | timestamptz NN DEF=now() | OK |
| local_id | n/a | int4 | LEGACY |

**Bugs:** None active. **Fix:** `ALTER TABLE washers DROP COLUMN local_id;`

---

### sellers

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT | uuid NN UNIQUE | OK |
| business_id | n/a | uuid NN | OK |
| name | TEXT NN UNIQUE | text NN | OK |
| commission_pct | REAL NN DEF=5 | numeric NN DEF=5 | OK |
| phone | TEXT (ALTER) | text | OK |
| cedula | TEXT (ALTER) | text | OK |
| start_date | TEXT (ALTER) | text | OK (Supabase uses text, not date — same as empleados.start_date anomaly) |
| active | INTEGER NN DEF=1 | bool NN DEF=true | TYPE-MISMATCH (coerced OK) |
| created_at | n/a (SQLite original CREATE omits) | timestamptz NN DEF=now() | MISSING-LOCAL (pull omits `created_at` from cols — OK by design) |
| updated_at | TEXT (ALTER) | timestamptz NN DEF=now() | OK |
| local_id | n/a | int4 | LEGACY |

**Fix:** Add `created_at` to local sellers for cleanliness. Drop `local_id` on Supabase.

---

### clients

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| name | TEXT NN | text NN | OK |
| rnc, phone, email, address, notes | TEXT | text | OK |
| credit_limit, balance, total_spent | REAL NN | numeric NN | OK |
| visits | INTEGER NN | int4 NN | OK |
| active | INTEGER NN DEF=1 | bool NN DEF=true | TYPE-MISMATCH (coerced OK) |
| created_at, updated_at | TEXT | timestamptz | OK |
| local_id | n/a | int4 | LEGACY |

**Fix:** Drop `local_id`.

---

### inventory_items

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| name | TEXT NN | text NN | OK |
| sku | TEXT UNIQUE | text | OK |
| barcode | TEXT (ALTER) | text | OK |
| category | TEXT NN DEF='' | text NN DEF='' | OK |
| price, cost | REAL NN | numeric NN | OK |
| quantity | INTEGER NN DEF=0 | int4 NN DEF=0 | OK |
| min_quantity | INTEGER NN DEF=5 | int4 NN DEF=5 | OK |
| aplica_itbis | INTEGER NN DEF=1 (ALTER) | int4 DEF=1 | OK (both int) — but inconsistent with services.aplica_itbis (bool) — see Critical #5 |
| oem_part_number, compatibility, supplier | TEXT (ALTER v2.2) | **ABSENT** | MISSING-REMOTE — push silently drops these fields. Desktop auto-parts vertical won't sync |
| reorder_quantity | INTEGER DEF=0 (ALTER v2.2) | **ABSENT** | MISSING-REMOTE |
| active | INTEGER NN DEF=1 | bool NN DEF=true | TYPE-MISMATCH (coerced OK) |
| created_at, updated_at | TEXT | timestamptz | OK |
| local_id | n/a | int4 | LEGACY |

**Bugs:** **v2.2 auto-parts fields (`oem_part_number`, `compatibility`, `reorder_quantity`, `supplier`) are MISSING on Supabase.** Desktop push will silently drop these.

**Fix (Supabase migration):**
```sql
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS oem_part_number text;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS compatibility text;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS reorder_quantity int4 DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS supplier text;
```
Then add those columns to `SYNC_TABLES[inventory_items].cols` and `PULL_TABLES[inventory_items].cols` in `electron/sync.js`.

---

### mesas

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE DEF=gen_random_uuid | OK |
| name | TEXT NN | text NN | OK |
| zone, status | TEXT | text | OK |
| capacity | INTEGER DEF=4 | int4 DEF=4 | OK |
| waiter_empleado_id | INTEGER (SQLite has) | **ABSENT on Supabase** | MISSING-REMOTE (intentional — only `waiter_empleado_supabase_id` syncs; integer FK is local-only — OK) |
| waiter_empleado_supabase_id | TEXT | uuid | OK |
| guests_count | INTEGER DEF=0 | int4 DEF=0 | OK |
| seated_at | TEXT | timestamptz | OK |
| sort_order | INTEGER DEF=0 | int4 DEF=0 | OK |
| active | INTEGER NN DEF=1 | bool NN DEF=true | TYPE-MISMATCH (coerced OK) |
| created_at, updated_at | TEXT NN | timestamptz NN | OK |

**Bugs:** None. Solid.

---

### modificadores

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| name | TEXT NN | text NN | OK |
| group_name | TEXT | text | OK |
| price_delta | REAL NN DEF=0 | numeric NN DEF=0 | OK |
| min_select, max_select | INTEGER | int4 | OK |
| default_selected | INTEGER NN DEF=0 | bool NN DEF=false | TYPE-MISMATCH (coerced OK) |
| sort_order | INTEGER DEF=0 | int4 DEF=0 | OK |
| active | INTEGER NN DEF=1 | bool NN DEF=true | TYPE-MISMATCH (coerced OK) |
| created_at, updated_at | TEXT | timestamptz | OK |

**Bugs:** None.

---

### service_modificadores

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| service_id | INTEGER NN FK | **ABSENT** | OK (local-only int FK; sync writes supabase_id variant) |
| service_supabase_id | TEXT | uuid NN | OK |
| modificador_id | INTEGER NN FK | **ABSENT** | OK (local-only int FK) |
| modificador_supabase_id | TEXT | uuid NN | OK |
| is_required | INTEGER NN DEF=0 | bool NN DEF=false | TYPE-MISMATCH (coerced OK) |
| created_at, updated_at | TEXT | timestamptz | OK |

---

### ncf_sequences

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| type | TEXT NN UNIQUE | text NN | OK (SQLite uniqueness only) |
| prefix | TEXT NN | text NN | OK |
| current_number | INTEGER NN DEF=0 | int4 NN DEF=0 | OK |
| limit_number | INTEGER NN DEF=500 | int4 NN DEF=500 | OK |
| valid_until | TEXT | date | TYPE-MISMATCH minor (Postgres date accepts ISO-ish) |
| active | INTEGER NN DEF=1 | bool NN DEF=true | TYPE-MISMATCH (coerced OK) |
| enabled | INTEGER NN DEF=0 | bool NN DEF=false | TYPE-MISMATCH (coerced OK) |
| updated_at | TEXT (ALTER) | timestamptz NN DEF=now() | OK |
| created_at | n/a (SQLite original omits) | timestamptz NN DEF=now() | MISSING-LOCAL (PULL_TABLES omits — OK) |
| local_id | n/a | int4 | LEGACY |

---

### empleados

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| nombre | TEXT NN | text NN | OK |
| tipo | TEXT NN | text NN | OK (CHECK removed in v1.9.15 migration) |
| ref_id | INTEGER (points to washers/sellers) | text | TYPE-MISMATCH — SQLite int vs Supabase text. Desktop writes integer; Supabase accepts it but text-typed column means join to washers/sellers on server is impossible. Low severity (ref_id is mostly a local-relationship remnant for washer/seller backfill). |
| salary | REAL NN DEF=0 | numeric NN DEF=0 | OK |
| start_date | TEXT NN | date NN | TYPE-MISMATCH minor |
| cedula, phone, email, puesto, bank_account, tss_id | TEXT | text | OK |
| active | INTEGER NN DEF=1 | bool NN DEF=true | TYPE-MISMATCH (coerced OK) |
| role | TEXT DEF='none' | text DEF='none' | OK |
| comision_pct | REAL DEF=0 | numeric DEF=0 | OK |
| created_at, updated_at | TEXT | timestamptz | OK |
| local_id | n/a | int4 | LEGACY |

---

### categorias_servicio

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| nombre | TEXT NN UNIQUE | text NN | OK |
| orden | INTEGER NN DEF=0 | int4 NN DEF=0 | OK |
| active | INTEGER NN DEF=1 (ALTER) | bool DEF=true | TYPE-MISMATCH (coerced OK) |
| updated_at | TEXT (ALTER) | timestamptz NN DEF=now() | OK |
| created_at | n/a | timestamptz NN DEF=now() | MISSING-LOCAL (PULL omits) |
| local_id | n/a | int4 | LEGACY |

---

### users / staff

**IMPORTANT: `users` is a VIEW on Supabase, `staff` is the base table.** Per CLAUDE.md "never alter users directly". sync.js correctly points at `staff` via `supabaseTable: 'staff'`. Verified: `table_type = VIEW` on users, `BASE TABLE` on staff.

| Column | SQLite users | Supabase staff (base) | Status |
|--------|--------------|-----------------------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| name | TEXT NN | text NN | OK |
| username | TEXT NN UNIQUE | text NN DEF='' | OK (SQLite uniqueness only) |
| password_hash | TEXT | **ABSENT** | MISSING-REMOTE (not synced — OK, PIN-only auth) |
| pin_hash | TEXT NN | text | OK (but SQLite requires NOT NULL and Supabase doesn't — staff without pin_hash can sync back and fail SQLite insert. HIGH SEVERITY) |
| role | TEXT NN CHECK | text NN DEF='cashier' | OK in practice but SQLite CHECK(role IN ('owner','manager','cfo','accountant','cashier')) can reject remote 'none' values — cross-ref: empleados uses 'none' default. If server ever stores role='none' on staff, pull will fail the SQLite CHECK. |
| discount_pct | REAL NN DEF=0 | numeric NN DEF=0 | OK |
| commission_pct | REAL NN DEF=0 (ALTER) | numeric NN DEF=0 | OK |
| vendedor_id | INTEGER FK→sellers(id) | **ABSENT** on staff; staff has `seller_id uuid` | MISSING-REMOTE for vendedor_id (intentional — sync uses supabase_id route) but staff.seller_id isn't in sync.js users cols. Probably dead column. |
| cedula | TEXT (ALTER) | text | OK |
| start_date | TEXT (ALTER) | text | OK |
| employee_id | INTEGER (ALTER) | int4 | TYPE-MISMATCH (both are local-ish integer IDs; empleados on Supabase is UUID-keyed — this column is stale). Pull writes integer to SQLite = OK. Web code that joins `staff.employee_id = empleados.id` breaks because empleados.id is UUID. **HIGH SEVERITY for web**. |
| active | INTEGER NN DEF=1 | bool NN DEF=true | TYPE-MISMATCH (coerced OK) |
| created_at, updated_at | TEXT | timestamptz | OK |
| auth_user_id | n/a | uuid | MISSING-LOCAL (Supabase auth link; desktop doesn't need it — OK) |
| local_id, seller_id | n/a | int4 / uuid | LEGACY |

**Bugs caused:**
- **`staff.employee_id int4` is broken for web** — web queries that try to join staff→empleados via `employee_id` get zero rows because `empleados.id` on Supabase is UUID. Need `employee_supabase_id uuid` or drop entirely.
- **`users.pin_hash NOT NULL` on SQLite but nullable on `staff`** — pull of a staff row without pin_hash (e.g. web-only user) will fail the SQLite NOT NULL and get skipped forever (cursor advance bug already fixed in sync.js).

**Fix (Supabase):**
```sql
ALTER TABLE staff ADD COLUMN IF NOT EXISTS employee_supabase_id uuid;
-- Backfill from existing int4:
UPDATE staff s SET employee_supabase_id = e.supabase_id
  FROM empleados e
  WHERE s.business_id = e.business_id AND s.employee_id = e.local_id;
ALTER TABLE staff ALTER COLUMN pin_hash SET NOT NULL; -- enforce parity with SQLite
```
**Fix (SQLite migration in database.js):**
```sql
-- Relax users.pin_hash NOT NULL so web-only users can pull
-- (SQLite can't drop NOT NULL — recreate table). Defer to next major migration.
ALTER TABLE users ADD COLUMN employee_supabase_id TEXT;
```

---

### activity_log

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK AUTOINCR | int8 PK | OK (both bigint — acceptable for append-only log) |
| supabase_id | TEXT NN | uuid NN UNIQUE (via uq_activity_log_biz_sid) | OK |
| business_id | n/a | uuid NN | OK |
| event_type | TEXT NN | text NN | OK |
| severity | TEXT NN DEF='info' | text NN DEF='info' (+ CHECK severity_check) | OK |
| actor_user_id | INTEGER | **ABSENT** | MISSING-REMOTE (intentional — actor_supabase_id is the synced one) |
| actor_supabase_id | TEXT | uuid | OK |
| actor_name, actor_role, target_type, target_id, target_name | TEXT | text | OK |
| amount | REAL | numeric | OK |
| old_value, new_value, reason | TEXT | text | OK |
| metadata | TEXT (JSON string) | jsonb | TYPE-MISMATCH handled via `JSON_COLUMNS` set — OK |
| created_at | TEXT NN DEF=(datetime('now')) | timestamptz NN DEF=now() | OK |
| updated_at | TEXT | timestamptz NN DEF=now() | TYPE-MISMATCH (nullable on SQLite, NN on Supabase — push fills with now() via coalesce in sync.js line 874 — OK) |

**Bugs:** None active.

---

### tickets  — 45 COLUMNS, HOT SPOT

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| doc_number | TEXT NN UNIQUE | text | OK (SQLite unique only) |
| client_id | INTEGER FK | **text** | TYPE-MISMATCH **CRITICAL #3** — should be uuid or dropped (sync writes to `client_supabase_id` only) |
| client_supabase_id | TEXT | uuid | OK |
| client_name | n/a (denorm) | text | MISSING-LOCAL (denormalized cache built in sync.js tickets.cols — OK, one-way) |
| cajero_id | INTEGER FK users | **text** | TYPE-MISMATCH **CRITICAL #3** |
| cajero_supabase_id | TEXT | uuid | OK |
| cajero_name, cajero | n/a | text | MISSING-LOCAL (denorm — OK) |
| seller_id | INTEGER FK | uuid | TYPE-MISMATCH (desktop writes seller_supabase_id; Supabase seller_id uuid is used by web). Sync doesn't populate it — joins on Supabase via seller_id fail for desktop-synced tickets. |
| seller_supabase_id | TEXT | uuid | OK |
| washer_ids | TEXT (JSON string) | jsonb DEF='[]' | OK via `JSON_COLUMNS` |
| services_json | n/a (denorm) | jsonb | MISSING-LOCAL (denorm built from ticket_items on push — OK) |
| subtotal, descuento, itbis, ley, total | REAL NN | numeric | OK (subtotal/itbis/etc are NULL-able on Supabase per schema! `data_type:numeric, is_nullable:YES` — SQLite NN is stricter, so pull of a ticket with null subtotal would fail SQLite) |
| beverage_subtotal | REAL NN DEF=0 | **float4** NN DEF=0 | TYPE-MISMATCH (float4 loses precision vs REAL=float8 — money column should be numeric) |
| payment_method, comprobante_type, ncf, ncf_type | TEXT | text | OK |
| ecf_result | TEXT (JSON string) | jsonb DEF='{}' | OK via JSON_COLUMNS |
| tipo_venta | TEXT NN DEF='contado' | text | OK (Supabase no default — desktop sends explicit) |
| status | TEXT NN DEF='cobrado' | text DEF='cobrado' | OK |
| void_reason | TEXT | text | OK |
| void_by | INTEGER FK users | **uuid** | TYPE-MISMATCH — SQLite INTEGER, Supabase uuid. Sync writes `r.void_by` raw (see sync.js line 378) — if local void_by is an integer it goes to Supabase as `"3"` and Postgres rejects uuid cast **HIGH SEVERITY**. |
| void_at | TEXT | timestamptz | OK |
| vehicle_plate, vehicle_color, vehicle_make | TEXT | text | OK |
| notes | TEXT | text | OK |
| tip_amount | REAL DEF=0 | numeric DEF=0 | OK |
| fulfillment_type | TEXT | text | OK |
| mesa_id | INTEGER (ALTER v2.0) | **ABSENT** | OK (only supabase_id variant syncs) |
| mesa_supabase_id | TEXT (ALTER v2.0) | uuid | OK |
| paid_at | n/a | timestamptz DEF=now() | MISSING-LOCAL (computed on push from status=='cobrado' — OK one-way) |
| created_at, updated_at | TEXT | timestamptz | OK |
| local_id, local_client_id, local_seller_id, local_cajero_id | n/a | int4 | LEGACY |

**Bugs:**
- **`tickets.void_by TYPE-MISMATCH` (critical) — SQLite INTEGER, Supabase uuid.** Sync push path in sync.js line 378 sends `r.void_by` (a local INTEGER) as-is to Supabase uuid column → Postgres 400 on every voided ticket sync. Need conversion: `void_by_supabase_id = resolveUserSupabaseId(r.void_by)` before push.
- **`tickets.client_id`/`cajero_id` typed as text not uuid** (critical #3). Non-functional but lying types.
- **`tickets.beverage_subtotal float4`** (money precision risk).
- **`tickets.subtotal/itbis/ley/total nullable** on Supabase but SQLite NOT NULL — potential pull failure if server row is null.

**Fix (Supabase):**
```sql
-- Fix client_id/cajero_id types
ALTER TABLE tickets ALTER COLUMN client_id TYPE uuid USING NULL;
ALTER TABLE tickets ALTER COLUMN cajero_id TYPE uuid USING NULL;
-- Or drop outright if unused
ALTER TABLE tickets DROP COLUMN client_id, DROP COLUMN cajero_id;
-- Fix money precision
ALTER TABLE tickets ALTER COLUMN beverage_subtotal TYPE numeric USING beverage_subtotal::numeric;
-- Tighten NOT NULL on money columns
ALTER TABLE tickets ALTER COLUMN subtotal SET NOT NULL;
ALTER TABLE tickets ALTER COLUMN itbis SET NOT NULL;
ALTER TABLE tickets ALTER COLUMN total SET NOT NULL;
-- Drop legacy
ALTER TABLE tickets DROP COLUMN local_id, DROP COLUMN local_client_id, DROP COLUMN local_seller_id, DROP COLUMN local_cajero_id;
```

**Fix (sync.js — critical path):**
```js
// In SYNC_TABLES[tickets].cols, replace raw void_by with uuid lookup:
void_by: r.void_by ? (_db.rawPrepare('SELECT supabase_id FROM users WHERE id=?').get(r.void_by)?.supabase_id || null) : null,
```

---

### ticket_items

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| ticket_id | INTEGER NN FK | uuid | TYPE-MISMATCH (SQLite writes integer, Supabase uuid — but sync sends `ticket_supabase_id` not `ticket_id`; Supabase ticket_id is nullable and left null for desktop-synced rows → web joins using ticket_id must fall back to ticket_supabase_id = dual-key, per CLAUDE.md). |
| ticket_supabase_id | TEXT | uuid | OK |
| service_id | INTEGER FK | uuid | Same pattern — OK via dual-key |
| service_supabase_id | TEXT | uuid | OK |
| inventory_item_id | INTEGER FK (ALTER) | uuid | Same — dual key |
| inventory_item_supabase_id | TEXT | uuid | OK |
| name | TEXT NN | text NN | OK |
| price | REAL NN | numeric NN | OK |
| cost | REAL NN DEF=0 | numeric NN DEF=0 | OK |
| itbis | REAL NN DEF=0 | numeric NN DEF=0 | OK |
| is_wash | INTEGER NN DEF=1 | bool NN DEF=true | TYPE-MISMATCH (coerced OK) |
| quantity | INTEGER NN DEF=1 (ALTER) | int4 DEF=1 | OK |
| sku | TEXT (ALTER) | text | OK |
| created_at | TEXT (ALTER v2.0) | timestamptz NN DEF=now() | OK |
| updated_at | TEXT (ALTER) | timestamptz NN DEF=now() | OK |
| local_id, local_ticket_id, local_service_id, local_inventory_item_id | n/a | int4 | LEGACY |

**Bugs:** None active (dual-key joins handle FK mismatch per memory).

**Fix:** Drop 4 legacy int4 columns.

---

### ticket_item_modificadores

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| ticket_item_id | INTEGER NN FK | **ABSENT** | OK (only supabase_id route) |
| ticket_item_supabase_id | TEXT | uuid NN | OK |
| modificador_id | INTEGER FK | **ABSENT** | OK |
| modificador_supabase_id | TEXT | uuid | OK |
| name_snapshot | TEXT NN | text NN | OK |
| price_delta_snapshot | REAL NN DEF=0 | numeric NN DEF=0 | OK |
| created_at, updated_at | TEXT | timestamptz | OK |

---

### kds_events

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| ticket_item_id | INTEGER NN FK | **ABSENT** | OK (supabase_id only) |
| ticket_item_supabase_id | TEXT | uuid NN | OK |
| mesa_id | INTEGER | **ABSENT** | OK |
| mesa_supabase_id | TEXT | uuid | OK |
| station | TEXT | text | OK |
| status | TEXT NN DEF='fired' | text NN DEF='fired' | OK |
| fired_at | TEXT NN DEF=(datetime('now')) | timestamptz NN DEF=now() | OK |
| started_at, ready_at, bumped_at | TEXT | timestamptz | OK |
| created_at, updated_at | TEXT | timestamptz | OK |

---

### queue

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| ticket_id | INTEGER NN FK | uuid | Dual-key pattern — OK |
| ticket_supabase_id | TEXT (ALTER) | uuid | OK |
| washer_id | INTEGER FK | uuid | Dual-key — OK |
| washer_supabase_id | TEXT (ALTER) | uuid | OK |
| status | TEXT NN DEF='waiting' | text NN DEF='waiting' | OK |
| assigned_at, completed_at | TEXT | timestamptz | OK |
| created_at, updated_at | TEXT | timestamptz | OK |
| local_id, local_ticket_id, local_washer_id | n/a | int4 | LEGACY |

---

### washer_commissions / seller_commissions / cajero_commissions

Identical structure across all three. Diff template:

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| washer_id / seller_id / cajero_id | INTEGER NN FK | uuid | Dual-key — OK |
| washer_supabase_id etc. | TEXT (ALTER) | uuid | OK |
| ticket_id | INTEGER NN FK | uuid | Dual-key — OK |
| ticket_supabase_id | TEXT (ALTER) | uuid | OK |
| base_amount, commission_pct, commission_amount | REAL NN | numeric NN | OK |
| paid | INTEGER NN DEF=0 | bool NN DEF=false | TYPE-MISMATCH (coerced OK via `r.paid === 1` in sync.js cols) |
| paid_at | TEXT | timestamptz | OK |
| created_at, updated_at | TEXT | timestamptz | OK |
| local_* | n/a | int4 x3 | LEGACY |

**Bugs:** None active. Drop the three legacy `local_*` columns per table.

---

### credit_payments

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| client_id | INTEGER NN FK | uuid NN | Dual-key OK |
| client_supabase_id | TEXT (ALTER) | uuid | OK |
| cajero_id | INTEGER FK | uuid | Dual-key OK |
| cajero_supabase_id | TEXT (ALTER) | uuid | OK |
| ticket_ids | TEXT (JSON) NN DEF='[]' | jsonb NN DEF='[]' | OK via JSON_COLUMNS |
| amount | REAL NN | numeric NN | OK |
| payment_method | TEXT NN DEF='cash' | text NN DEF='cash' | OK |
| ncf, notes | TEXT | text | OK |
| created_at, updated_at | TEXT | timestamptz | OK |
| local_* | n/a | int4 x3 | LEGACY |

---

### cuadre_caja

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| cajero_id | INTEGER FK | uuid | Dual-key — OK |
| cajero_supabase_id | TEXT (ALTER) | uuid | OK |
| date | TEXT NN | date NN | TYPE-MISMATCH minor |
| fondo, efectivo_conteo, efectivo_sistema, tarjeta, transferencia, cheque, creditos, salidas, total_vendido, total_cobrado, cierre_total, diferencia | REAL NN | numeric NN | OK |
| comentario | TEXT | text | OK |
| denominaciones | TEXT (JSON) | jsonb DEF='{}' | OK via JSON_COLUMNS |
| closed_at | TEXT NN DEF=(datetime('now')) | timestamptz NN DEF=now() | OK |
| updated_at | TEXT (ALTER) | timestamptz NN DEF=now() | OK |
| created_at | n/a | n/a | OK (neither side has it) |
| local_* | n/a | int4 x2 | LEGACY |

---

### caja_chica

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| description | TEXT NN | text NN | OK |
| category | TEXT NN DEF='Otros' | text NN DEF='Otros' | OK |
| type | TEXT NN DEF='Gasto' | text NN DEF='Gasto' | OK |
| amount | REAL NN | numeric NN | OK |
| recibo | TEXT | text | OK |
| status | TEXT NN DEF='pendiente' | text NN DEF='pendiente' | OK |
| approved_by | INTEGER FK | uuid | Dual-key — OK |
| approved_by_supabase_id | TEXT (ALTER) | uuid | OK |
| cajero_id | INTEGER FK | uuid | Dual-key — OK |
| cajero_supabase_id | TEXT (ALTER) | uuid | OK |
| created_at, updated_at | TEXT | timestamptz | OK |
| local_id, local_approved_by, local_cajero_id | n/a | int4 x3 | LEGACY |

---

### notas_credito

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| ncf | TEXT NN | text NN | OK |
| client_id | INTEGER FK | uuid | Dual-key — OK |
| client_supabase_id | TEXT (ALTER) | uuid | OK |
| original_ticket_id | INTEGER FK | uuid | Dual-key — OK (note: SQLite col is `original_ticket_id`, Supabase matches) |
| original_ticket_supabase_id | TEXT (mapped from `ticket_supabase_id` in sync.js line 614!) | uuid | **NAMING INCONSISTENCY** — SQLite column is `ticket_supabase_id` (per ALTER at line 137), but sync maps it to `original_ticket_supabase_id` on push and pull config reads `original_ticket_supabase_id`. Works today but confusing. |
| motivo | TEXT NN DEF='Devolución' (local uses accented char!) | text NN DEF='Devolucion' (no accent) | MINOR mismatch — default mismatch only |
| amount | REAL NN | numeric NN | OK |
| itbis_revertido | REAL NN DEF=0 | numeric NN DEF=0 | OK |
| forma_devolucion | TEXT NN DEF='Efectivo' | text NN DEF='Efectivo' | OK |
| comentario | TEXT | text | OK |
| cajero_id | INTEGER FK | uuid | Dual-key — OK |
| cajero_supabase_id | TEXT (ALTER) | uuid | OK |
| created_at, updated_at | TEXT | timestamptz | OK |
| local_* | n/a | int4 x4 | LEGACY |

**Bugs:** Naming drift on `ticket_supabase_id` vs `original_ticket_supabase_id` (works via sync mapping, but the SQLite ALTER didn't create a column named `original_ticket_supabase_id` — check this).

---

### inventory_transactions

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| item_id | INTEGER NN FK | uuid NN | Dual-key — OK |
| item_supabase_id | TEXT (ALTER) | uuid | OK |
| user_id | INTEGER | uuid | Dual-key — OK |
| user_supabase_id | TEXT (ALTER) | uuid | OK |
| type | TEXT NN | text NN | OK |
| delta | INTEGER NN | int4 NN | OK |
| notes | TEXT NN DEF='' | text NN DEF='' | OK |
| created_at, updated_at | TEXT | timestamptz | OK |
| local_* | n/a | int4 x3 | LEGACY |

---

### compras_607

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT UNIQUE | uuid NN UNIQUE | OK |
| rnc_proveedor, nombre_proveedor | TEXT NN DEF='' | text NN DEF='' | OK |
| tipo_ncf | TEXT NN DEF='B01' | text NN DEF='B01' | OK |
| ncf | TEXT NN DEF='' | text NN DEF='' | OK |
| ncf_modificado | TEXT DEF='' | text DEF='' | OK |
| fecha_ncf | TEXT NN | date NN DEF=CURRENT_DATE | TYPE-MISMATCH minor |
| fecha_pago | TEXT DEF='' | date | TYPE-MISMATCH — SQLite sends '' empty string; Postgres date cannot parse '' → reject. Need to send NULL, not empty string. **HIGH SEVERITY** if empty fecha_pago ever syncs. |
| monto_servicios, monto_bienes, total, itbis_facturado, itbis_retenido, retencion_renta | REAL NN DEF=0 | numeric NN DEF=0 | OK |
| forma_pago | TEXT NN DEF='efectivo' | text NN DEF='efectivo' | OK |
| notas | TEXT DEF='' | text | OK |
| created_at, updated_at | TEXT | timestamptz | OK |
| local_id | n/a | int4 | LEGACY |

**Bugs:** **`fecha_pago`** — SQLite default `''` empty string gets pushed to Supabase `date` column and fails cast. Sync already coalesces null, but if the column is explicitly empty string the push breaks.

**Fix (sync.js):**
```js
// In compras_607 cols mapper — coerce empty strings to null for date columns
fecha_pago: r.fecha_pago && r.fecha_pago !== '' ? r.fecha_pago : null,
```

---

### salary_changes

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | int8 PK | OK |
| supabase_id | TEXT (ALTER) | uuid NN UNIQUE | OK |
| empleado_id | INTEGER NN FK | **int8** | TYPE-MISMATCH (both integer — OK since Supabase kept it bigint, not uuid). But this column is dead for web — empleados.id is UUID, so web can never join on it. |
| empleado_supabase_id | TEXT (ALTER) | uuid | OK |
| old_salary | REAL NN | numeric NN | OK |
| new_salary | REAL NN | numeric NN | OK |
| effective_date | TEXT NN | date NN | TYPE-MISMATCH minor |
| reason | TEXT | text | OK |
| changed_by | INTEGER FK users | uuid | TYPE-MISMATCH — SQLite integer vs Supabase uuid. Not in sync.js cols list (so not pushed), but Supabase has it as uuid NN? No — nullable per schema. OK. |
| active | INTEGER NN DEF=1 (ALTER) | bool DEF=true | TYPE-MISMATCH (coerced OK) |
| created_at, updated_at | TEXT | timestamptz | OK |

**Bugs:** Mentioned in user prompt — `empleado_id` BIGINT vs expected UUID. Confirmed: the column is bigint (int8) on Supabase, integer on SQLite — both sides agree on "integer", which is the problem. **The column is dead for cross-platform joins** — Supabase `empleados.id` is UUID. Only `empleado_supabase_id` works.

**Fix (Supabase):** Drop `salary_changes.empleado_id int8` or ensure all joins use `empleado_supabase_id`. Ditto `payroll_runs.empleado_id int8`.

---

### payroll_runs

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | int8 PK | OK |
| supabase_id | TEXT (ALTER) | uuid NN UNIQUE | OK |
| empleado_id | INTEGER NN FK | **int8** | TYPE-MISMATCH same pattern as salary_changes — dead cross-platform join |
| empleado_supabase_id | TEXT (ALTER) | uuid | OK |
| period_start, period_end | TEXT NN | date NN | TYPE-MISMATCH minor |
| base, commissions, bonuses, sfs_employee, afp_employee, isr, other_deductions, deductions, sfs_employer, afp_employer, infotep_employer, net | REAL NN DEF=0 | numeric NN DEF=0 | OK (SQLite `net REAL NOT NULL` with no default; sync must send a value) |
| notes | TEXT | text | OK |
| paid_at | TEXT NN DEF=(datetime('now')) | timestamptz NN DEF=now() | OK |
| paid_by | INTEGER FK | uuid | TYPE-MISMATCH (not synced — OK) |
| created_at, updated_at | TEXT | timestamptz | OK |

---

### adelantos

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | uuid PK | OK |
| supabase_id | TEXT | uuid UNIQUE | OK |
| empleado_id | INTEGER NN FK | uuid | TYPE-MISMATCH (SQLite int, Supabase uuid). Sync doesn't push empleado_id (only empleado_supabase_id). OK in practice. |
| empleado_supabase_id | TEXT | uuid | OK |
| amount | REAL NN | numeric NN | OK |
| date | TEXT NN DEF=(date('now')) | date NN DEF=CURRENT_DATE | TYPE-MISMATCH minor |
| notes | TEXT | text | OK |
| status | TEXT NN DEF='pendiente' | text NN DEF='pendiente' | OK |
| deducted_from_payroll_id | INTEGER FK | uuid | TYPE-MISMATCH — not synced. OK. |
| deducted_at | TEXT | timestamptz | OK |
| approved_by | TEXT | text | OK (note: text on both — not a user FK, just a name/string) |
| created_at, updated_at | TEXT NN | timestamptz | OK |

---

### ecf_submissions (push-only per sync manifest)

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | int8 PK | OK |
| supabase_id | TEXT (ALTER) | uuid (nullable, **NO UNIQUE CONSTRAINT** on `business_id, supabase_id`) | **CRITICAL #1** — upsert on_conflict target missing |
| ticket_id | INTEGER | int8 | TYPE-MISMATCH (both integer, dead for web join) |
| ticket_supabase_id | TEXT (ALTER) | uuid | OK |
| encf | TEXT NN | text | OK (Supabase nullable) |
| tipo_ecf | TEXT NN | text | OK |
| track_id | TEXT | text | OK |
| dgii_status (SQLite) / status (Supabase) | INTEGER DEF=3 / text | **NAMING/TYPE MISMATCH** — sync.js line 724 maps `typeof r.dgii_status === 'number' ? String(r.dgii_status) : r.status` — works on push but pull would fail. Sync manifest correctly marks this PUSH-ONLY. |
| environment | TEXT NN DEF='testecf' | text | OK |
| submitted_at | TEXT NN DEF=(datetime('now')) | timestamptz NN DEF=now() | OK |
| response_json | n/a | jsonb | MISSING-LOCAL (Supabase-only — OK) |
| created_at, updated_at | n/a / TEXT (ALTER) | timestamptz NN | Updated_at OK; created_at — sync.js sets it from submitted_at on push — OK |

**Bugs:** **CRITICAL #1 — no `uq_ecf_submissions_biz_sid` constraint on Supabase.** Every push attempts on_conflict=business_id,supabase_id and fails or inserts duplicates.

**Fix (Supabase):**
```sql
-- Dedup first, then enforce uniqueness
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY business_id, supabase_id ORDER BY created_at DESC) AS rn
  FROM ecf_submissions WHERE supabase_id IS NOT NULL
)
DELETE FROM ecf_submissions WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
ALTER TABLE ecf_submissions ALTER COLUMN supabase_id SET NOT NULL;
ALTER TABLE ecf_submissions ADD CONSTRAINT uq_ecf_submissions_biz_sid UNIQUE (business_id, supabase_id);
```

---

### queue_deletions (push-only)

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK | int8 PK | OK |
| supabase_id | TEXT (ALTER) | uuid (nullable, **NO UNIQUE CONSTRAINT**) | **CRITICAL #1** |
| queue_id | INTEGER NN | uuid | Sync resolves to UUID via rawPrepare lookup — OK |
| ticket_id | INTEGER | uuid | Same — resolved on push |
| doc_number | TEXT DEF='' | **ABSENT** | MISSING-REMOTE (not synced per sync.js — OK) |
| deleted_by | TEXT NN DEF='unknown' | text | OK (Supabase nullable) |
| deleted_at | TEXT NN DEF=(datetime('now')) | timestamptz DEF=now() | OK |
| reason | TEXT DEF='manual' | text | OK |
| created_at | n/a | timestamptz | Computed in sync from deleted_at — OK |
| updated_at | TEXT (ALTER) | timestamptz NN DEF=now() | OK |

**Bugs:** **CRITICAL #1** — no unique constraint. Same fix pattern as ecf_submissions.

**Fix (Supabase):**
```sql
ALTER TABLE queue_deletions ALTER COLUMN supabase_id SET NOT NULL;
ALTER TABLE queue_deletions ADD CONSTRAINT uq_queue_deletions_biz_sid UNIQUE (business_id, supabase_id);
```

---

### vehicles / service_bays / work_orders / work_order_items / appointments / stylist_schedules / loans / loan_payments / pawn_items (multi-vertical)

All follow the same successful pattern:
- SQLite `id INTEGER PK` + `supabase_id TEXT UNIQUE`
- Supabase `id uuid PK` + `supabase_id uuid` + `UNIQUE(business_id, supabase_id)` constraint
- `*_supabase_id` FK columns on both sides
- `active INTEGER` ↔ `bool` (coerced OK)
- All have `created_at, updated_at timestamptz` on Supabase and TEXT on SQLite

**All 9 multi-vertical tables have the `uq_<table>_biz_sid` unique constraint confirmed** (via `_audit4_constraints.md`). Sync upserts work.

**Bugs:** None active in base schema. `service_bays.current_work_order_supabase_id` and `service_bays.current_work_order_id` both sync — OK. `work_orders.completed_date timestamptz` but SQLite is TEXT — works via ISO string pass-through.

**Only real concern:** `loans.client_id uuid NOT NULL` on Supabase but SQLite `client_id INTEGER NOT NULL` — push sends `client_supabase_id` only; Supabase `client_id` column is NOT NULL with no default → every desktop-originated loan push FAILS because client_id gets coalesced out by sync.js `cleaned` loop.

**Fix (Supabase):**
```sql
ALTER TABLE loans ALTER COLUMN client_id DROP NOT NULL;
-- (Or keep NOT NULL and have desktop resolve client_supabase_id → client uuid before push. Dropping NN is simpler since client_supabase_id carries the identity.)
```

Same concern for `loan_payments.loan_id uuid NOT NULL`, `inventory_transactions.item_id uuid NOT NULL`, `queue.ticket_id uuid` (nullable OK), `credit_payments.client_id uuid NOT NULL`, `washer_commissions.washer_id uuid` (nullable OK per schema), `seller_commissions.seller_id uuid` (nullable OK), `cajero_commissions.cajero_id uuid NOT NULL`, `ticket_items.ticket_id uuid` (nullable OK), `appointments.client_id` (nullable OK), `service_modificadores.service_supabase_id uuid NOT NULL` (OK — sync sends this).

**Check which NOT NULL columns the sync silently drops:**
- `credit_payments.client_id uuid NN` — sync pushes `client_supabase_id` only → Postgres rejects on first insert ever.
- `inventory_transactions.item_id uuid NN` — sync pushes `item_supabase_id` only → fails.
- `cajero_commissions.cajero_id uuid NN` — sync pushes `cajero_supabase_id` only → fails.

**This is potentially widespread silent sync failure.** Verify with test push or loosen the NN on Supabase.

**Fix (Supabase bulk):**
```sql
ALTER TABLE credit_payments ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE inventory_transactions ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE cajero_commissions ALTER COLUMN cajero_id DROP NOT NULL;
ALTER TABLE cajero_commissions ALTER COLUMN ticket_id DROP NOT NULL;
ALTER TABLE loans ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE loan_payments ALTER COLUMN loan_id DROP NOT NULL;
```

---

### businesses

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| id | INTEGER PK (single row id=1) | uuid PK | OK (multi-tenant on server, single-tenant on desktop) |
| name | TEXT NN DEF='' | text NN | OK |
| rnc, address, phone, email | TEXT DEF='' | text DEF='' | OK |
| logo | BLOB | **ABSENT** (Supabase uses `logo_url text`) | MISSING-REMOTE (intentional — logos go to Supabase Storage; a separate path uploads and caches the URL per CLAUDE.md v1.9.18 heal migration) |
| logo_url | n/a | text | MISSING-LOCAL (Supabase-side only — SQLite keeps raw bytes) |
| settings | TEXT DEF='{}' | jsonb NN DEF='{}' | TYPE-MISMATCH — but sync handles this. Businesses is not in SYNC_TABLES — it's synced through a bespoke bizSync path. Per Audit 3 scope, out of scope here. |
| plan | TEXT NN DEF='pro' | text NN DEF='free' | DEFAULT-MISMATCH — SQLite defaults to 'pro', Supabase defaults to 'free'. New installs will disagree. Minor. |
| owner_id | n/a | uuid | MISSING-LOCAL (RLS owner; no desktop equivalent — OK) |
| created_at | n/a | timestamptz DEF=now() | MISSING-LOCAL (not synced from this table anyway) |
| updated_at | n/a | timestamptz NN DEF=now() | MISSING-LOCAL |

**Bugs:** `plan` default differs ('pro' vs 'free'). Unify.

**Fix (Supabase):**
```sql
ALTER TABLE businesses ALTER COLUMN plan SET DEFAULT 'pro';
```

---

### app_settings

| Column | SQLite | Supabase | Status |
|--------|--------|----------|--------|
| key | TEXT PK | text NN | OK (PK on SQLite; Supabase uses (business_id,key) unique) |
| value | TEXT NN DEF='' | text NN DEF='' | OK |
| business_id | n/a | uuid NN | OK (Supabase multi-tenant) |
| id | n/a | uuid PK DEF=uuid_generate_v4 | OK |
| updated_at | n/a | timestamptz NN DEF=now() | OK |

**Bugs:** app_settings is NOT in sync.js SYNC_TABLES/PULL_TABLES — it's desktop-only. Out of scope for sync parity.

---

## updated_at TRIGGER AUDIT (SQLite side)

`database.js` line 766 declares triggers for 39 tables:
`services, washers, sellers, clients, inventory_items, tickets, empleados, ncf_sequences, ticket_items, queue, washer_commissions, seller_commissions, cajero_commissions, credit_payments, cuadre_caja, caja_chica, notas_credito, inventory_transactions, compras_607, categorias_servicio, users, salary_changes, payroll_runs, ecf_submissions, queue_deletions, activity_log, mesas, modificadores, service_modificadores, ticket_item_modificadores, kds_events, vehicles, service_bays, work_orders, work_order_items, appointments, stylist_schedules, loans, loan_payments, pawn_items`

**`adelantos` trigger declared separately** (line 338) — OK.

All 41 synced tables have an updated_at trigger.

### Supabase trigger audit (sampled via defaults, not direct query)

All synced tables have `updated_at timestamptz NN DEF=now()` but Supabase uses column DEFAULT only (set on INSERT) — there's no AFTER UPDATE trigger to bump updated_at on update. LWW conflict resolution requires updated_at to change on every UPDATE.

**Known Supabase migrations add triggers:** Check `supabase/migrations/` for `moddatetime` triggers. If missing, any row UPDATEd on the server (e.g. via Admin panel) won't bump updated_at → desktop pull misses the change.

**Fix (Supabase — verify, then add if missing):**
```sql
-- For every synced table:
CREATE TRIGGER set_updated_at_<table> BEFORE UPDATE ON <table>
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
```

---

## LEGACY `local_*` COLUMNS — Supabase cleanup

Per memory: `local_id, local_*_id` columns are deprecated scaffolding. Every synced Supabase table except multi-vertical (vehicles, work_orders, etc., which are new) carries them. Dropping is safe — sync.js never writes them.

**Cleanup SQL (Supabase):**
```sql
ALTER TABLE caja_chica DROP COLUMN IF EXISTS local_id, DROP COLUMN IF EXISTS local_approved_by, DROP COLUMN IF EXISTS local_cajero_id;
ALTER TABLE cajero_commissions DROP COLUMN IF EXISTS local_id, DROP COLUMN IF EXISTS local_cajero_id, DROP COLUMN IF EXISTS local_ticket_id;
ALTER TABLE categorias_servicio DROP COLUMN IF EXISTS local_id;
ALTER TABLE clients DROP COLUMN IF EXISTS local_id;
ALTER TABLE compras_607 DROP COLUMN IF EXISTS local_id;
ALTER TABLE credit_payments DROP COLUMN IF EXISTS local_id, DROP COLUMN IF EXISTS local_client_id, DROP COLUMN IF EXISTS local_cajero_id;
ALTER TABLE cuadre_caja DROP COLUMN IF EXISTS local_id, DROP COLUMN IF EXISTS local_cajero_id;
ALTER TABLE empleados DROP COLUMN IF EXISTS local_id;
ALTER TABLE inventory_items DROP COLUMN IF EXISTS local_id;
ALTER TABLE inventory_transactions DROP COLUMN IF EXISTS local_id, DROP COLUMN IF EXISTS local_item_id, DROP COLUMN IF EXISTS local_user_id;
ALTER TABLE ncf_sequences DROP COLUMN IF EXISTS local_id;
ALTER TABLE notas_credito DROP COLUMN IF EXISTS local_id, DROP COLUMN IF EXISTS local_client_id, DROP COLUMN IF EXISTS local_original_ticket_id, DROP COLUMN IF EXISTS local_cajero_id;
ALTER TABLE queue DROP COLUMN IF EXISTS local_id, DROP COLUMN IF EXISTS local_ticket_id, DROP COLUMN IF EXISTS local_washer_id;
ALTER TABLE seller_commissions DROP COLUMN IF EXISTS local_id, DROP COLUMN IF EXISTS local_seller_id, DROP COLUMN IF EXISTS local_ticket_id;
ALTER TABLE sellers DROP COLUMN IF EXISTS local_id;
ALTER TABLE services DROP COLUMN IF EXISTS local_id;
ALTER TABLE staff DROP COLUMN IF EXISTS local_id;
ALTER TABLE ticket_items DROP COLUMN IF EXISTS local_id, DROP COLUMN IF EXISTS local_ticket_id, DROP COLUMN IF EXISTS local_service_id, DROP COLUMN IF EXISTS local_inventory_item_id;
ALTER TABLE tickets DROP COLUMN IF EXISTS local_id, DROP COLUMN IF EXISTS local_client_id, DROP COLUMN IF EXISTS local_seller_id, DROP COLUMN IF EXISTS local_cajero_id;
ALTER TABLE washer_commissions DROP COLUMN IF EXISTS local_id, DROP COLUMN IF EXISTS local_washer_id, DROP COLUMN IF EXISTS local_ticket_id;
ALTER TABLE washers DROP COLUMN IF EXISTS local_id;
```

---

## MASTER FIX MIGRATION (apply in order)

```sql
-- ============================================================================
-- AUDIT-04 SCHEMA PARITY FIXES — apply to Supabase
-- ============================================================================

BEGIN;

-- 1. CRITICAL: Unique constraints for on_conflict target
UPDATE ecf_submissions SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
WITH r AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY business_id, supabase_id ORDER BY created_at DESC) rn FROM ecf_submissions)
DELETE FROM ecf_submissions WHERE id IN (SELECT id FROM r WHERE rn > 1);
ALTER TABLE ecf_submissions ALTER COLUMN supabase_id SET NOT NULL;
ALTER TABLE ecf_submissions ADD CONSTRAINT uq_ecf_submissions_biz_sid UNIQUE (business_id, supabase_id);

UPDATE queue_deletions SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;
ALTER TABLE queue_deletions ALTER COLUMN supabase_id SET NOT NULL;
ALTER TABLE queue_deletions ADD CONSTRAINT uq_queue_deletions_biz_sid UNIQUE (business_id, supabase_id);

-- 2. HIGH: Missing inventory_items auto-parts columns
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS oem_part_number text,
  ADD COLUMN IF NOT EXISTS compatibility text,
  ADD COLUMN IF NOT EXISTS reorder_quantity int4 DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier text;

-- 3. HIGH: tickets type fixes
ALTER TABLE tickets ALTER COLUMN beverage_subtotal TYPE numeric USING beverage_subtotal::numeric;
ALTER TABLE tickets ALTER COLUMN subtotal SET NOT NULL;
ALTER TABLE tickets ALTER COLUMN itbis SET NOT NULL;
ALTER TABLE tickets ALTER COLUMN total SET NOT NULL;
-- These two are lying types — drop if no code references them:
ALTER TABLE tickets DROP COLUMN IF EXISTS client_id;  -- text, replaced by client_supabase_id uuid
ALTER TABLE tickets DROP COLUMN IF EXISTS cajero_id;  -- text, replaced by cajero_supabase_id uuid

-- 4. HIGH: Drop NOT NULL on FK columns that sync doesn't populate
ALTER TABLE credit_payments ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE inventory_transactions ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE cajero_commissions ALTER COLUMN cajero_id DROP NOT NULL;
ALTER TABLE cajero_commissions ALTER COLUMN ticket_id DROP NOT NULL;
ALTER TABLE loans ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE loan_payments ALTER COLUMN loan_id DROP NOT NULL;

-- 5. MEDIUM: staff.employee_supabase_id + enforce pin_hash
ALTER TABLE staff ADD COLUMN IF NOT EXISTS employee_supabase_id uuid;
UPDATE staff s SET employee_supabase_id = e.supabase_id
  FROM empleados e
  WHERE s.business_id = e.business_id AND s.employee_id = e.local_id AND s.employee_supabase_id IS NULL;

-- 6. MEDIUM: businesses.plan default unify
ALTER TABLE businesses ALTER COLUMN plan SET DEFAULT 'pro';

-- 7. MEDIUM: updated_at auto-bump triggers (if moddatetime extension available)
CREATE EXTENSION IF NOT EXISTS moddatetime;
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'services','washers','sellers','clients','inventory_items','tickets','empleados',
    'ncf_sequences','ticket_items','queue','washer_commissions','seller_commissions',
    'cajero_commissions','credit_payments','cuadre_caja','caja_chica','notas_credito',
    'inventory_transactions','compras_607','categorias_servicio','staff','salary_changes',
    'payroll_runs','ecf_submissions','queue_deletions','activity_log','mesas','modificadores',
    'service_modificadores','ticket_item_modificadores','kds_events','vehicles','service_bays',
    'work_orders','work_order_items','appointments','stylist_schedules','loans','loan_payments',
    'pawn_items','adelantos'
  ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', t);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at)', t);
  END LOOP;
END$$;

-- 8. LOW: drop LEGACY local_* columns (big block — see LEGACY CLEANUP section above for full list)
-- (Run separately after verifying no code references any local_* column on Supabase.)

COMMIT;
```

---

## MASTER FIX MIGRATION — SQLite (database.js migrations block)

```js
// Audit-04 schema parity — add to migrations array in ensureSchema()
'ALTER TABLE users ADD COLUMN employee_supabase_id TEXT',
// Backfill from existing employee_id
"UPDATE users SET employee_supabase_id = (SELECT supabase_id FROM empleados WHERE empleados.id = users.employee_id) WHERE employee_supabase_id IS NULL AND employee_id IS NOT NULL",
// Ensure services has created_at for parity with Supabase
"ALTER TABLE services ADD COLUMN created_at TEXT DEFAULT (datetime('now'))",
"ALTER TABLE sellers ADD COLUMN created_at TEXT DEFAULT (datetime('now'))",
"ALTER TABLE ncf_sequences ADD COLUMN created_at TEXT DEFAULT (datetime('now'))",
"ALTER TABLE categorias_servicio ADD COLUMN created_at TEXT DEFAULT (datetime('now'))",
```

---

## MASTER FIX — sync.js (critical bug patches)

```js
// 1. tickets.void_by — convert local INTEGER to UUID before push
// Current (line 378): void_by: r.void_by || null,
// Fix: void_by: r.void_by ? (_db.rawPrepare('SELECT supabase_id FROM users WHERE id=?').get(r.void_by)?.supabase_id || null) : null,

// 2. compras_607 — coerce empty-string date columns to null
// Add to SYNC_TABLES[compras_607].cols mapper:
fecha_ncf: r.fecha_ncf && r.fecha_ncf !== '' ? r.fecha_ncf : null,
fecha_pago: r.fecha_pago && r.fecha_pago !== '' ? r.fecha_pago : null,

// 3. inventory_items — add v2.2 auto-parts fields to both manifests
// Add to SYNC_TABLES[inventory_items].cols:
oem_part_number: r.oem_part_number,
compatibility: r.compatibility,
reorder_quantity: r.reorder_quantity,
supplier: r.supplier,
// Add to PULL_TABLES[inventory_items].cols array:
'oem_part_number','compatibility','reorder_quantity','supplier',
```

---

## VERIFICATION

Run after applying migrations:

```sql
-- 1. Confirm all synced tables have uq_<table>_biz_sid
SELECT table_name
FROM information_schema.table_constraints
WHERE constraint_type='UNIQUE' AND constraint_name LIKE 'uq_%_biz_sid';
-- Expect 40 rows (one per synced table)

-- 2. Confirm no synced table has MISSING-REMOTE columns referenced in sync.js cols
-- (manual diff between SYNC_TABLES[t].cols keys and information_schema.columns)

-- 3. Smoke test push after fix
-- Desktop: void a ticket, check sync-diag.json for successful push of tickets
-- Check supabase ecf_submissions for no duplicate (business_id, supabase_id)

-- 4. Confirm triggers fire
UPDATE services SET name=name WHERE id=(SELECT id FROM services LIMIT 1);
SELECT updated_at FROM services WHERE id=(SELECT id FROM services LIMIT 1);
-- updated_at should be now()
```
