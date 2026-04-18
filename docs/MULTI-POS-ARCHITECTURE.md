# Multi-POS Architecture — Terminal X

**Target**: 2+ desktop POS + 1 admin PC per business. Dominican Republic. Internet and power are unreliable. Every feature must tolerate 4-hour offline windows and reconcile without data loss.

**Core pattern**: **pre-allocated blocks per device (HWID)** for every scarce, monotonic resource (NCF, e-CF, doc_number). **Authoritative post-sync deduct** for inventory with oversell flagging. Everything else reuses the existing `supabase_id` UUID sync.

**Legal basis**: DGII Norma 06-18 §7 allows a contribuyente to split an authorized NCF range into sub-ranges assigned to specific terminals, provided the sub-ranges are disjoint and monotonically consumed within the terminal. Block allocation is compliant.

---

## Section 1 — NCF / e-CF Block Allocation

### 1.1 Schema — Supabase

```sql
-- Master sequence (one row per business_id + ncf_type).
-- This is the single source of truth for "what number comes next globally".
CREATE TABLE ncf_sequences_master (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ncf_type            text NOT NULL,                          -- 'B01','B02','E31','E32','E33','E34','E41','E43','E44','E45','E46','E47'
  prefix              text NOT NULL,                          -- 'B01', 'E31', etc.
  range_start         bigint NOT NULL,                        -- DGII-authorized range start (e.g., 1)
  range_end           bigint NOT NULL,                        -- DGII-authorized range end (e.g., 100000)
  next_global         bigint NOT NULL,                        -- next number to hand out in the next block
  exhausted           boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ncf_seq_master_unique UNIQUE (business_id, ncf_type)
);
CREATE INDEX idx_ncf_seq_master_biz ON ncf_sequences_master(business_id);

-- Block ledger. Each row = a contiguous sub-range permanently owned by one HWID.
CREATE TABLE ncf_blocks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id         uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  business_id         uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  hwid                text NOT NULL,                          -- SHA256(MAC+hostname) from userData/hwid.json
  device_label        text,                                   -- 'POS-Caja-1' (human readable, editable)
  ncf_type            text NOT NULL,
  prefix              text NOT NULL,
  range_start         bigint NOT NULL,                        -- inclusive
  range_end           bigint NOT NULL,                        -- inclusive
  next_available      bigint NOT NULL,                        -- range_start..=range_end+1 (==range_end+1 means exhausted)
  size                int   NOT NULL,                         -- range_end - range_start + 1 (denormalized for UI)
  allocated_at        timestamptz NOT NULL DEFAULT now(),
  exhausted_at        timestamptz,
  last_used_at        timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ncf_blocks_unique_bid UNIQUE (business_id, supabase_id),
  CONSTRAINT ncf_blocks_range_valid CHECK (range_end >= range_start AND next_available >= range_start AND next_available <= range_end + 1)
);
CREATE INDEX idx_ncf_blocks_biz_hwid_type ON ncf_blocks(business_id, hwid, ncf_type) WHERE exhausted_at IS NULL;
CREATE INDEX idx_ncf_blocks_biz_type      ON ncf_blocks(business_id, ncf_type);

-- Disjointness guarantee: no two blocks of the same (business,type) overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE ncf_blocks ADD CONSTRAINT ncf_blocks_no_overlap
  EXCLUDE USING gist (
    business_id WITH =,
    ncf_type    WITH =,
    int8range(range_start, range_end, '[]') WITH &&
  );
```

### 1.2 RPC — `allocate_ncf_block`

```sql
CREATE OR REPLACE FUNCTION allocate_ncf_block(
  p_business_id uuid,
  p_hwid        text,
  p_ncf_type    text,
  p_size        int DEFAULT 500
) RETURNS ncf_blocks
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  m          ncf_sequences_master%ROWTYPE;
  partial    ncf_blocks%ROWTYPE;
  new_start  bigint;
  new_end    bigint;
  out_row    ncf_blocks%ROWTYPE;
BEGIN
  IF p_size < 1 OR p_size > 10000 THEN
    RAISE EXCEPTION 'block size out of range';
  END IF;

  -- 1) Reuse a partially consumed block already owned by this HWID (no new allocation needed).
  SELECT * INTO partial
  FROM ncf_blocks
  WHERE business_id = p_business_id
    AND hwid        = p_hwid
    AND ncf_type    = p_ncf_type
    AND exhausted_at IS NULL
    AND next_available <= range_end
  ORDER BY range_start ASC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    RETURN partial;
  END IF;

  -- 2) Lock master row and carve a new contiguous sub-range.
  SELECT * INTO m
  FROM ncf_sequences_master
  WHERE business_id = p_business_id AND ncf_type = p_ncf_type
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no master sequence for % / %', p_business_id, p_ncf_type;
  END IF;
  IF m.exhausted OR m.next_global > m.range_end THEN
    UPDATE ncf_sequences_master SET exhausted = true, updated_at = now() WHERE id = m.id;
    RAISE EXCEPTION 'NCF range exhausted for %', p_ncf_type;
  END IF;

  new_start := m.next_global;
  new_end   := LEAST(m.next_global + p_size - 1, m.range_end);

  INSERT INTO ncf_blocks(business_id, hwid, ncf_type, prefix,
                         range_start, range_end, next_available, size)
  VALUES (p_business_id, p_hwid, p_ncf_type, m.prefix,
          new_start, new_end, new_start, (new_end - new_start + 1))
  RETURNING * INTO out_row;

  UPDATE ncf_sequences_master
     SET next_global = new_end + 1,
         exhausted   = (new_end + 1 > range_end),
         updated_at  = now()
   WHERE id = m.id;

  RETURN out_row;
END $$;
```

The row lock on `ncf_sequences_master` + the `EXCLUDE` constraint on `ncf_blocks` guarantee **zero collisions even under concurrent allocation from N devices**.

### 1.3 SQLite mirror

```sql
CREATE TABLE IF NOT EXISTS ncf_blocks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  supabase_id     TEXT UNIQUE,
  business_id     TEXT,
  hwid            TEXT NOT NULL,
  ncf_type        TEXT NOT NULL,
  prefix          TEXT NOT NULL,
  range_start     INTEGER NOT NULL,
  range_end       INTEGER NOT NULL,
  next_available  INTEGER NOT NULL,
  size            INTEGER NOT NULL,
  allocated_at    TEXT,
  exhausted_at    TEXT,
  last_used_at    TEXT,
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ncf_blocks_local ON ncf_blocks(ncf_type) WHERE exhausted_at IS NULL;
```

### 1.4 Client flow

```
Boot:
  for each ncf_type in enabled_types:
    if local has active block with remaining > 0: do nothing
    else: call rpc.allocate_ncf_block(biz, hwid, type, 500), store locally

Ticket emission (atomic SQLite transaction):
  row = SELECT * FROM ncf_blocks
        WHERE ncf_type=? AND exhausted_at IS NULL
        ORDER BY range_start ASC LIMIT 1 FOR local (BEGIN IMMEDIATE)
  if row.next_available > row.range_end: FAIL
  ncf = row.prefix + lpad(row.next_available, 8)
  UPDATE ncf_blocks SET next_available = next_available+1,
         last_used_at = now(),
         exhausted_at = CASE WHEN next_available+1 > range_end THEN now() END
         WHERE id = row.id
  COMMIT

Post-emission (non-blocking):
  remaining = range_end - next_available + 1
  if remaining < 100 AND no other unexhausted block for this type:
     enqueue async allocate_ncf_block(..., 500)
  push ncf_blocks row (updated_at changed) to Supabase via sync.js

Exhausted + offline:
  show modal "Solicita bloque de NCF — conecta a internet"
  block POS sales for this NCF type until sync succeeds
  fallback NCF types (e.g., drop from B02→B01 consumer-final) if biz opted in
```

### 1.5 Block size: **500**

| Size | Pros                              | Cons                              |
|------|-----------------------------------|-----------------------------------|
| 100  | Minimal waste on decommission     | Refills every ~day for busy POS   |
| 500  | ~1 refill/week for 70 tickets/day | 500 NCFs wasted if PC dies        |
| 2000 | Refills monthly                   | Big waste; exhausts DGII range faster |

500 is the sweet spot. Owner can override via `app_settings.ncf_block_size`.

### 1.6 HWID lock

Block is permanently bound to HWID. If a PC dies, the remaining `next_available..range_end` is **abandoned** (DGII allows unused NCFs). Owner can manually mark `exhausted_at = now()` via admin UI → "Retirar dispositivo". The master sequence does NOT reclaim those numbers — monotonicity within the DGII-authorized range is preserved.

### 1.7 All 10 e-CF types + B01/B02

Same table, different `ncf_type` value. Each type has its own master row and its own per-HWID blocks. `E43`/`E47` govt-to-govt don't bother with RncComprador — that's an XML concern, not a block concern.

---

## Section 2 — doc_number Allocation

**Decision: Option A (block-based, unified display).** Reject Option B.

Rationale: cashiers already complain about long receipt text. Showing `POS1-T-0042` on customer receipt is unprofessional and confuses DGII reconciliation (owner reads ticket list sorted by doc_number). Internal HWID tagging happens on the row (`tickets.origin_hwid`), not in the visible number.

### 2.1 Schema

Reuse the block pattern in a separate table:

```sql
CREATE TABLE doc_number_blocks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id     uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  hwid            text NOT NULL,
  scope           text NOT NULL DEFAULT 'ticket',   -- 'ticket','quote','work_order' — future-proof
  range_start     bigint NOT NULL,
  range_end       bigint NOT NULL,
  next_available  bigint NOT NULL,
  size            int   NOT NULL,
  allocated_at    timestamptz NOT NULL DEFAULT now(),
  exhausted_at    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT doc_blocks_unique_bid UNIQUE (business_id, supabase_id),
  CONSTRAINT doc_blocks_no_overlap
    EXCLUDE USING gist (business_id WITH =, scope WITH =, int8range(range_start, range_end, '[]') WITH &&)
);

CREATE TABLE doc_number_master (
  business_id uuid NOT NULL,
  scope       text NOT NULL,
  next_global bigint NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, scope)
);
```

### 2.2 RPC — `allocate_doc_block(p_business_id, p_hwid, p_scope, p_size)`

Same pattern as `allocate_ncf_block` — lock master, reuse partial, else carve new range, bump master. Default size **200**.

### 2.3 Client flow

Replace the `SELECT MAX(doc_number)+1` at `electron/database.js:2953` with a block consumer:

```js
const blk = consumeDocBlock('ticket')   // synchronous SQLite
const docNumber = `T-${String(blk.value).padStart(4,'0')}`
tickets.origin_hwid = HWID            // new column, for later forensic
```

Owner sees `T-0042`, `T-0043`, `T-0044` unified across all 3 PCs. The numbers are no longer strictly contiguous per PC (PC1 owns 1–200, PC2 owns 201–400) — that's fine, cashier never notices gaps unless both PCs are busy.

### 2.4 New column

```sql
ALTER TABLE tickets ADD COLUMN origin_hwid text;
ALTER TABLE tickets ADD COLUMN origin_device_label text;
```

Admin "Auditoría" tab filters by device: "Show tickets from POS-Caja-1".

---

## Section 3 — Inventory Deduct with Oversell Detection

### 3.1 Strategy

| Phase          | Where     | Behavior                                                        |
|----------------|-----------|-----------------------------------------------------------------|
| Sale commit    | SQLite    | **Optimistic deduct** — UPDATE quantity = quantity - N (can go negative). Cashier never waits for network. |
| Sync push      | Supabase  | RPC `deduct_inventory_atomic` — authoritative. Returns oversell list. |
| Oversell react | Both      | Insert row in `inventory_oversells`. Red badge in admin UI.    |

### 3.2 RPC

```sql
CREATE OR REPLACE FUNCTION deduct_inventory_atomic(
  p_business_id     uuid,
  p_ticket_sid      uuid,
  p_items           jsonb   -- [{item_supabase_id:uuid, qty:numeric, name:text}]
) RETURNS TABLE(item_supabase_id uuid, requested numeric, actual numeric, oversold boolean)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  it jsonb;
  upd_qty numeric;
  nm text;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    UPDATE inventory_items
       SET quantity   = quantity - (it->>'qty')::numeric,
           updated_at = now()
     WHERE business_id = p_business_id
       AND supabase_id = (it->>'item_supabase_id')::uuid
       AND quantity   >= (it->>'qty')::numeric
    RETURNING quantity INTO upd_qty;

    IF NOT FOUND THEN
      -- oversell: deduct anyway (authoritative post-fact), log it.
      UPDATE inventory_items
         SET quantity = quantity - (it->>'qty')::numeric,
             updated_at = now()
       WHERE business_id = p_business_id
         AND supabase_id = (it->>'item_supabase_id')::uuid
      RETURNING quantity INTO upd_qty;

      SELECT name INTO nm FROM inventory_items
       WHERE business_id=p_business_id AND supabase_id=(it->>'item_supabase_id')::uuid;

      INSERT INTO inventory_oversells(business_id, ticket_supabase_id, item_supabase_id,
                                      item_name, requested_qty, actual_qty)
      VALUES (p_business_id, p_ticket_sid, (it->>'item_supabase_id')::uuid,
              COALESCE(nm, it->>'name'), (it->>'qty')::numeric, upd_qty + (it->>'qty')::numeric);

      RETURN QUERY SELECT (it->>'item_supabase_id')::uuid,
                          (it->>'qty')::numeric,
                          upd_qty + (it->>'qty')::numeric,
                          true;
    ELSE
      RETURN QUERY SELECT (it->>'item_supabase_id')::uuid,
                          (it->>'qty')::numeric,
                          upd_qty, false;
    END IF;
  END LOOP;
END $$;
```

### 3.3 Oversell log

```sql
CREATE TABLE inventory_oversells (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id         uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  business_id         uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ticket_supabase_id  uuid,
  item_supabase_id    uuid,
  item_name           text,
  requested_qty       numeric NOT NULL,
  actual_qty          numeric NOT NULL,        -- on-hand BEFORE this deduct (can be 0 or negative)
  detected_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,
  resolved_by         uuid,                    -- staff.supabase_id
  resolution_notes    text,
  resolution_type     text,                    -- 'physical_count','write_off','supplier_shortage','accepted'
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oversells_unique_bid UNIQUE (business_id, supabase_id)
);
CREATE INDEX idx_oversells_unresolved ON inventory_oversells(business_id) WHERE resolved_at IS NULL;
```

### 3.4 UI

- **Inventory tab header**: red badge `N oversells` when `resolved_at IS NULL` exists. Click → filter list.
- **RemoteDashboard "Actividad"**: new event_type `inventory_oversell` (severity=warn; critical if >5 in 24h). Already routed through `activityLogRecord` helper.
- **Resolution modal**: owner picks resolution_type, enters physical count, optionally adjusts `inventory_items.quantity` to truth. Sets `resolved_at=now()`.
- Oversell row sync: FWW (field-wise win, `updated_at` tiebreak) — same as other tables.

---

## Section 4 — Sync Reconciliation Hardening

### 4.1 Weaknesses in current sync

| Issue                                              | Fix                                                        |
|----------------------------------------------------|------------------------------------------------------------|
| Silent failure on push                             | Exponential backoff + dead-letter queue                    |
| No user-visible sync health                        | SyncStatus pill in topbar                                  |
| Power loss mid-cobro = torn ticket                 | Already covered by SQLite WAL + single `tx` wrapping ticket+items+ncf consume — verify |
| Clock drift breaks `updated_at` LWW                | Detect drift, apply offset                                 |
| License grace collides with sync pause             | Keep sync running in grace, only block UI                  |

### 4.2 Exponential backoff

`sync.js` failure counter per table: 1s → 5s → 30s → 2m → 10m → 30m (cap). Reset on success. Dead-letter after 20 attempts → row pinned in `sync_failures` local table for manual retry.

```sql
CREATE TABLE IF NOT EXISTS sync_failures (
  id INTEGER PRIMARY KEY,
  table_name TEXT, row_supabase_id TEXT, attempt INT,
  last_error TEXT, last_attempt_at TEXT, payload_json TEXT
);
```

### 4.3 Sync status UI

Topbar pill showing:
- Green dot + "Sincronizado hace 2 min" (last success < 5 min)
- Yellow + "N pendientes" (queue > 0)
- Red + "Sin conexión hace 12 min" (consecutive failures > 3)

Click → modal: table-by-table pending count, last success timestamp, **Forzar sincronización** button (calls `syncAll({ force: true })`).

### 4.4 Clock drift detection

On every successful Supabase roundtrip, compare `response.server_time` header vs `Date.now()`. If `|diff| > 120s`, store `clock_skew_ms` in `app_settings` and:
- Stamp `updated_at = now() - skew` on local rows before push.
- Raise warning in admin Actividad: `clock_drift_detected`.

Expose `SELECT now()` via a tiny `/api/time` endpoint or use Supabase `select now()` RPC.

### 4.5 WAL + atomicity checklist

- `pragma journal_mode=WAL` already on. Verify.
- `pragma synchronous=NORMAL` — survives power loss at the cost of last uncommitted txn (acceptable).
- Ticket emission = single `db.transaction(() => { ... })` that wraps: doc_block consume + ncf_block consume + ticket insert + ticket_items insert + inventory optimistic deduct. **All-or-nothing.**
- After power restore on boot: `PRAGMA integrity_check` + `PRAGMA wal_checkpoint(TRUNCATE)`.

### 4.6 License + sync decoupling

License grace (72h offline) must **not** pause sync — sync is what recovers the license. Current bug: LicenseContext sets `syncPaused=true` on grace. Fix: keep sync running, only gate new license-aware features.

---

## Section 5 — SQL Migrations

### 5.1 Supabase migration (`supabase/migrations/2026xxxx_multipos.sql`)

```sql
-- 1. Enable btree_gist for EXCLUDE constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. NCF master
CREATE TABLE IF NOT EXISTS ncf_sequences_master (...);  -- see §1.1
CREATE TABLE IF NOT EXISTS ncf_blocks (...);            -- see §1.1

-- 3. Backfill master from existing ncf_sequences (single-POS installs)
INSERT INTO ncf_sequences_master(business_id, ncf_type, prefix, range_start, range_end, next_global)
SELECT business_id, type, prefix, 1, 100000, COALESCE(current_number,0) + 1
FROM ncf_sequences
WHERE active = true
ON CONFLICT (business_id, ncf_type) DO NOTHING;

-- 4. Doc number blocks
CREATE TABLE IF NOT EXISTS doc_number_master (...);
CREATE TABLE IF NOT EXISTS doc_number_blocks (...);
INSERT INTO doc_number_master(business_id, scope, next_global)
SELECT id, 'ticket', 1 FROM businesses
ON CONFLICT DO NOTHING;

-- 5. Ticket origin
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS origin_hwid text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS origin_device_label text;
CREATE INDEX IF NOT EXISTS idx_tickets_origin_hwid ON tickets(business_id, origin_hwid);

-- 6. Oversells
CREATE TABLE IF NOT EXISTS inventory_oversells (...);

-- 7. RPCs (see §1.2, §2.2, §3.2)
-- allocate_ncf_block, allocate_doc_block, deduct_inventory_atomic

-- 8. RLS
ALTER TABLE ncf_blocks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ncf_sequences_master  ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_number_blocks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_number_master     ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_oversells   ENABLE ROW LEVEL SECURITY;
-- anon policies: business_id IS NOT NULL AND business_id = current_business()
-- service_role: bypass (desktop)

-- 9. Triggers: updated_at auto-bump (reuse existing touch_updated_at trigger fn)
CREATE TRIGGER trg_ncf_blocks_upd          BEFORE UPDATE ON ncf_blocks            FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_doc_blocks_upd          BEFORE UPDATE ON doc_number_blocks     FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_oversells_upd           BEFORE UPDATE ON inventory_oversells   FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

**Rollback**: `DROP TABLE ncf_blocks, ncf_sequences_master, doc_number_blocks, doc_number_master, inventory_oversells CASCADE; ALTER TABLE tickets DROP COLUMN origin_hwid, DROP COLUMN origin_device_label;` — safe because `ncf_sequences` (legacy) remains untouched until rollout is complete.

### 5.2 SQLite migration (append to existing migration block in `electron/database.js`)

```js
// v2.3.0 — multi-POS block allocation
try { db.exec(`CREATE TABLE IF NOT EXISTS ncf_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, supabase_id TEXT UNIQUE,
  business_id TEXT, hwid TEXT NOT NULL, ncf_type TEXT NOT NULL,
  prefix TEXT NOT NULL, range_start INTEGER NOT NULL, range_end INTEGER NOT NULL,
  next_available INTEGER NOT NULL, size INTEGER NOT NULL,
  allocated_at TEXT, exhausted_at TEXT, last_used_at TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)`) } catch {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_ncf_blocks_type ON ncf_blocks(ncf_type) WHERE exhausted_at IS NULL`) } catch {}

try { db.exec(`CREATE TABLE IF NOT EXISTS doc_number_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, supabase_id TEXT UNIQUE,
  business_id TEXT, hwid TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'ticket',
  range_start INTEGER NOT NULL, range_end INTEGER NOT NULL,
  next_available INTEGER NOT NULL, size INTEGER NOT NULL,
  allocated_at TEXT, exhausted_at TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)`) } catch {}

try { db.exec(`CREATE TABLE IF NOT EXISTS inventory_oversells (
  id INTEGER PRIMARY KEY AUTOINCREMENT, supabase_id TEXT UNIQUE,
  business_id TEXT, ticket_supabase_id TEXT, item_supabase_id TEXT, item_name TEXT,
  requested_qty REAL, actual_qty REAL,
  detected_at TEXT, resolved_at TEXT, resolved_by TEXT,
  resolution_notes TEXT, resolution_type TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)`) } catch {}

try { db.exec(`CREATE TABLE IF NOT EXISTS sync_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT, row_supabase_id TEXT,
  attempt INT DEFAULT 0, last_error TEXT, last_attempt_at TEXT, payload_json TEXT
)`) } catch {}

try { db.exec(`ALTER TABLE tickets ADD COLUMN origin_hwid TEXT`) } catch {}
try { db.exec(`ALTER TABLE tickets ADD COLUMN origin_device_label TEXT`) } catch {}
```

**Rollback**: drop the four tables, drop the two ticket columns. The local `ncf_sequences` table is **retained** as fallback for single-POS mode.

---

## Section 6 — Client Flow Changes

### `electron/database.js`
- NEW `allocNcfBlock(ncfType, size=500)` — wrapper calling remote RPC via supabase client injected by sync.js, inserts result row locally.
- NEW `consumeNcfNumber(ncfType)` — synchronous, `BEGIN IMMEDIATE` txn, picks oldest non-exhausted block for type, bumps `next_available`, returns `{ ncf, blockId, remaining }`. Marks `exhausted_at` when remaining hits 0.
- NEW `allocDocBlock(scope='ticket', size=200)`, `consumeDocNumber(scope='ticket')` — mirror of NCF.
- MODIFY `saveTicket()` at `electron/database.js:2953` — replace `SELECT MAX + 1` with `consumeDocNumber('ticket')`, replace NCF block at line 2962 with `consumeNcfNumber(data.comprobante_type)`. Set `origin_hwid = getHwid()` on ticket insert. Keep whole thing inside existing `db.transaction`.
- NEW `recordOversell({ ticketSid, itemSid, itemName, requested, actual })`.
- NEW `listOversells({ resolved })`, `resolveOversell({ supabase_id, resolution_type, notes, by })`.
- Feature flag check: if `app_settings.multi_pos_enabled != '1'`, fall back to legacy `ncf_sequences.current_number` path.

### `electron/sync.js`
- On boot: for each enabled ncf_type, if no active local block → RPC `allocate_ncf_block`. Same for doc block.
- Push phase: append `ncf_blocks`, `doc_number_blocks`, `inventory_oversells` to the per-table sync loop (strategy=fww, key=supabase_id).
- Inventory push: batch per-ticket items into single RPC call `deduct_inventory_atomic`. Inspect `oversold=true` rows → insert local `inventory_oversells` row + activityLogRecord.
- Background "refill" job: every 60s, for each active block with `remaining < 20% of size`, async request next block. Toast when exhausted+offline.
- Exponential backoff (§4.2), clock-drift check (§4.4).

### `electron/main.js`
- IPC handlers:
  - `ncf:alloc-block` (manual owner refill)
  - `ncf:list-blocks` (admin UI)
  - `ncf:retire-device` (mark all blocks for a HWID as exhausted)
  - `oversells:list`, `oversells:resolve`
  - `sync:status`, `sync:force`
- On boot: `ensureBlocksAllocated()` after license validation.

### POS ticket-save flow (`packages/ui/screens/CobrarModal.jsx` + `saveTicket`)
- No visible change to the cashier. Same "Cobrar" button.
- If NCF block exhausted + offline: modal "Bloque de NCF agotado. Conecta a internet para solicitar más." Sales of non-NCF types (simple ticket) keep working.
- Success toast unchanged.

### Inventory screen (`packages/ui/screens/Inventory.jsx`)
- Red `N` badge beside "Inventario" title when unresolved oversells exist.
- New tab "Oversells" → list + resolution modal.

### RemoteDashboard
- Actividad chip "Oversells" (event_type=`inventory_oversell`).
- Sync health card (last success, pending per table, force button).

---

## Section 7 — Testing Plan

### 7.1 Harness

`scripts/multipos-sim.js` — spawns 3 isolated SQLite DBs (`pos1.db`, `pos2.db`, `admin.db`) all pointing at one staging Supabase project. Fakes HWID via env var `TX_FAKE_HWID`. Reuses real `electron/database.js` + `sync.js` with a Node shim for `ipcMain`.

### 7.2 Scenarios

| # | Scenario                                  | Pass criteria                                                          |
|---|-------------------------------------------|------------------------------------------------------------------------|
| 1 | Cold boot, 3 POS each allocate B02 block  | 3 disjoint ranges in Supabase, no EXCLUDE violation                    |
| 2 | Each POS emits 100 tickets concurrently   | 300 unique NCFs, 300 unique doc_numbers                                |
| 3 | POS1 offline 4h, emits 150 tickets        | All 150 get valid NCFs from its local block. After reconnect, pushed.  |
| 4 | POS1 and POS2 both sell last unit of SKU-X (stock=1) | 2 tickets succeed locally. On push, second gets `oversold=true`. Row in `inventory_oversells`. Badge appears. |
| 5 | Owner resolves oversell (physical count=0) | `resolved_at` set, badge clears, stock adjusts, Activity log entry.    |
| 6 | Clock drift +5 min on POS1                | Detected, `clock_skew_ms` stored, warning raised, sync continues working. |
| 7 | Force kill during cobro (simulate power)  | On restart: no torn ticket, no half-consumed NCF, WAL replays cleanly. |
| 8 | Block refill at 80% consumed              | Second block allocated in background; when first exhausts, second used without cashier interruption. |
| 9 | NCF master exhausted                      | RPC raises, UI shows "Solicita nueva autorización DGII".               |
| 10| Single-POS legacy install (flag off)      | Existing ncf_sequences path still works. No ncf_blocks rows created.   |

### 7.3 CI

`npm run test:multipos` — runs scenarios 1–9 against ephemeral Supabase branch. Target: full suite < 3 min.

---

## Section 8 — Rollout Plan

| Stage | Who                     | Action                                                                 |
|-------|-------------------------|------------------------------------------------------------------------|
| 0     | All existing clients    | Migration deployed. `app_settings.multi_pos_enabled='0'` default. No behavior change. `ncf_sequences_master` backfilled from `ncf_sequences` but unused. |
| 1     | New installs (signup)   | `multi_pos_enabled='1'` by default. Block flow active from install.    |
| 2     | Opt-in single-POS biz   | Owner clicks "Activar Multi-POS" in Settings → Sistema. One-time migration: move `ncf_sequences.current_number` → `ncf_sequences_master.next_global`; allocate first block to this HWID. Flag flips. Cannot revert (NCFs would collide). |
| 3     | Licorería (new 2nd PC)  | Install Terminal X on PC2. On first boot, PC2's HWID gets fresh block. PC1's existing block continues untouched. No data loss. |
| 4     | Admin panel             | Surface "Dispositivos activos" list (HWIDs, labels, last_seen, active blocks) under Mi Empresa → Dispositivos. Retire button. |

### Safety gates
- **Stage 2 migration** runs inside a single Supabase txn. If it fails, flag does NOT flip. Idempotent.
- **Forensic**: every block alloc/consume writes an `activityLogRecord({event_type:'ncf_block_allocated'|'ncf_block_exhausted', ...})`. If a DGII dispute arises, owner can prove which number came from which device at what time.
- **Feature flag kill switch**: if a subtle bug surfaces, flip `multi_pos_enabled='0'` per-business in Supabase → client falls back to legacy `ncf_sequences` counter on next restart. Unused blocks stay dormant.

---

## Appendix — Conflict matrix

| Resource          | Offline policy                 | Online-reconcile                      | Collision risk              |
|-------------------|--------------------------------|---------------------------------------|-----------------------------|
| NCF / e-CF        | Consume from local block       | Push block `next_available` (FWW)     | **Zero** (EXCLUDE constraint) |
| doc_number        | Consume from local block       | Push block next (FWW)                 | Zero                        |
| Inventory qty     | Optimistic deduct (can go neg) | RPC authoritative deduct, log oversell| Detected, flagged, resolved |
| Ticket rows       | Insert w/ supabase_id          | Upsert FWW                            | Zero (UUID)                 |
| Cash drawer close | Local cuadre                   | FWW push; owner review                | Low (one cashier per drawer)|
| Clients           | Local insert w/ supabase_id    | FWW; duplicate detection by cedula    | Low                         |

---

**End of spec.** Implementer can start with §5 (migrations) → §6 (client) → §7 (harness).
