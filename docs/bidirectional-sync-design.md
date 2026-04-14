# Bidirectional Sync Design — Terminal X

> **STATUS: IMPLEMENTED (v1.9.x+).** 21 tables covered. Sync pulls via `updated_at > last_pull_at` cursor, pushes on 5-min interval + on-demand. See CLAUDE.md §Data Architecture for current behavior. This document is retained as the original design reference.

## 1. Original State (v1.8.x, pre-bidirectional)

One-way push: SQLite -> Supabase. No pull.

- **Module:** `electron/sync.js` (CommonJS, runs in main process)
- **Trigger:** Auto-sync every 30 min + on-demand after sale/payment/void
- **Mechanism:** Paginated SELECT from SQLite (`WHERE id > cursor`), POST upsert to Supabase REST API
- **Conflict key:** `(business_id, supabase_id)` unique constraint on every Supabase table
- **Update detection:** Pass 2 queries `WHERE updated_at > last_synced_at` to catch in-place edits
- **Tables:** 20 tables in 3 phases (root entities -> tickets -> dependent records)
- **Auth:** Service role key (bypasses RLS)
- **Limitation:** Web edits (e.g., editing a client on the web POS) are invisible to desktop. Desktop always overwrites.

## 2. Proposed Architecture — Bidirectional Sync

```
Desktop (SQLite)  <-->  Supabase (PostgreSQL)  <-->  Web (Supabase JS SDK)
     |                        |                           |
     | PUSH (existing)        | source of truth           | direct read/write
     | PULL (new)             |                           |
```

**Core principle:** Supabase is the shared truth. Desktop pushes local changes up, then pulls remote changes down. Web reads/writes Supabase directly.

### Key additions to sync.js:

1. `pullTable(tableConfig)` — fetch rows from Supabase where `updated_at > last_pull_at`, upsert into SQLite
2. `last_pull_at` column on `sync_log` — per-table cursor for pull operations
3. Conflict resolution logic (see section 4)

## 3. Pull Strategy

### When to pull:
- On app startup (after boot, before first render of data screens)
- Every sync cycle (after push completes, pull new remote changes)
- On-demand via IPC (`sync:pull-now`) for manual refresh

### Pull query:
```
GET /rest/v1/{table}?business_id=eq.{bid}&updated_at=gt.{last_pull_at}&order=updated_at.asc&limit=500
```

### SQLite upsert on pull:
```sql
INSERT INTO {table} (supabase_id, name, ..., updated_at)
VALUES (?, ?, ..., ?)
ON CONFLICT(supabase_id) DO UPDATE SET
  name = excluded.name, ...,
  updated_at = excluded.updated_at
WHERE excluded.updated_at > {table}.updated_at  -- only apply if remote is newer
```

### Mapping Supabase -> SQLite:
- Supabase `id` (UUID) is ignored — SQLite auto-generates its own integer `id`
- Supabase `supabase_id` maps to SQLite `supabase_id`
- FK columns: resolve `*_supabase_id` to local integer `id` via lookup (e.g., `SELECT id FROM clients WHERE supabase_id = ?`)

## 4. Conflict Resolution

Two strategies based on record type:

### Last-Write-Wins (LWW) — Entity tables
Tables: `services`, `washers`, `sellers`, `clients`, `inventory_items`, `ncf_sequences`, `empleados`, `categorias_servicio`, `staff`, `app_settings`, `configuracion`

- Compare `updated_at` timestamps
- Most recent write wins, regardless of source (desktop or web)
- On pull: only overwrite local if `remote.updated_at > local.updated_at`
- On push: Supabase upsert with `merge-duplicates` already handles this (remote row updated if newer)

### First-Write-Wins (FWW) — Financial/immutable tables
Tables: `tickets`, `ticket_items`, `credit_payments`, `cuadre_caja`, `caja_chica`, `notas_credito`, `washer_commissions`, `seller_commissions`, `cajero_commissions`, `inventory_transactions`, `compras_607`

- Once created, these records should not be overwritten by a different source
- On pull: INSERT only if `supabase_id` does not exist locally. If it exists, skip (preserve local version).
- Exception: `status` field on tickets CAN be updated (e.g., void from web). Use a dedicated `pullTicketStatusUpdates()` that only syncs `status`, `void_reason`, and `updated_at`.

### Queue table — special case
`queue` entries are short-lived (active during a car wash session). Bidirectional sync is needed for real-time dashboard but conflicts are unlikely. Use LWW.

## 5. Implementation Plan

### Phase 1 — Pull infrastructure (1 session)
- Add `last_pull_at` column to `sync_log`
- Implement `supabaseFetch(table, filters)` — GET from Supabase REST (mirrors existing `supabaseUpsert`)
- Implement `pullTable(tableConfig)` with LWW logic
- Add `PULL_TABLES` config (reverse of SYNC_TABLES — maps Supabase columns back to SQLite)
- Wire into `syncNow()`: push first, then pull
- Test with `services` table only

### Phase 2 — Entity tables (1 session)
- Enable pull for: `services`, `washers`, `sellers`, `clients`, `inventory_items`, `empleados`, `categorias_servicio`, `ncf_sequences`
- Handle FK resolution on pull (e.g., when pulling a client, no FKs needed; when pulling queue, resolve `ticket_supabase_id` to local `ticket_id`)
- Add `sync:pull-now` IPC handler
- Add pull status to sync status UI in Settings

### Phase 3 — Financial tables (1 session)
- Enable pull for: `tickets`, `ticket_items`, `credit_payments`, `commissions` (all 3), `cuadre_caja`, `caja_chica`, `notas_credito`
- Implement FWW: INSERT-if-not-exists logic
- Implement selective status sync for tickets
- Handle `inventory_transactions` pull with stock recalculation

### Phase 4 — Real-time (future)
- Supabase Realtime subscription for `queue` table changes (instant dashboard updates)
- Realtime for `tickets` status changes (void notifications)
- Requires WebSocket connection from Electron main process

## 6. Table Priority

| Priority | Tables | Reason |
|----------|--------|--------|
| P0 | services, clients | Most commonly edited from web. Immediate user value. |
| P1 | washers, sellers, empleados, categorias_servicio | Staff management from web. |
| P1 | inventory_items, ncf_sequences | Stock and fiscal sync. |
| P2 | tickets, ticket_items | Complex FKs, FWW logic. Needed for full web POS. |
| P2 | queue | Real-time dashboard. |
| P3 | All commission tables, credit_payments, cuadre_caja | Financial records, rarely edited after creation. |
| P4 | caja_chica, notas_credito, compras_607, inventory_transactions | Low frequency, append-only. |

## 7. Edge Cases

### Offline for days
- Pull will fetch all rows with `updated_at > last_pull_at` — could be thousands of rows
- Solution: Same pagination as push (500 rows per batch), advance `last_pull_at` after each batch
- If offline for 30+ days, consider a full re-sync (reset `last_pull_at` to epoch)

### Concurrent edits (same record, both platforms)
- LWW tables: the later `updated_at` wins. If desktop and web edit the same client within seconds, only the last save survives.
- FWW tables: the record that was created first (by `created_at`) is canonical. The duplicate is silently skipped on pull.
- Mitigation: the sync interval (30 min) means conflicts are rare. Most businesses use one platform at a time.

### Soft deletes
- Current system uses `active = 0` for soft deletes (services, clients, washers, sellers, empleados, inventory_items)
- Pull must sync `active` field changes — a web deactivation must propagate to desktop
- Hard deletes (DELETE FROM) are not synced. If a record is deleted on Supabase, desktop keeps its copy. This is acceptable for now.
- Future: add a `deleted_at` column and sync it. Pull marks local records as deleted.

### New records created on web
- Web creates records with `supabase_id` (Supabase generates the UUID as the primary key `id`, and `supabase_id` is set to match)
- Pull inserts these into SQLite with a new local integer `id` and the matching `supabase_id`
- Next push cycle sees the record already exists in Supabase (by `supabase_id`) — upsert is a no-op

### FK resolution failures
- When pulling a ticket that references a `client_supabase_id` not yet in local SQLite:
  - Option A: Pull entities before transactions (phase ordering)
  - Option B: Store the `*_supabase_id` FK as-is, resolve lazily when needed
  - Recommended: Option A (same phase ordering as push — pull entities first, then tickets, then dependents)

### Clock skew
- `updated_at` is set by each platform's local clock
- If desktop clock is wrong, LWW may produce incorrect results
- Mitigation: on push, Supabase could set `server_updated_at = now()` via trigger. Pull uses `server_updated_at` instead of `updated_at`.
- This is a Phase 4 enhancement — not critical for initial rollout.

### Interrupted sync
- If pull is interrupted mid-batch, `last_pull_at` was not yet advanced
- Next pull re-fetches the same batch — idempotent upsert handles duplicates safely
- Same resilience as current push architecture

## 8. SQLite Schema Changes Required

```sql
-- Add last_pull_at to sync_log
ALTER TABLE sync_log ADD COLUMN last_pull_at TEXT;

-- Ensure supabase_id has a UNIQUE index on every synced table (for ON CONFLICT upsert)
-- Most tables already have this. Verify and add where missing:
CREATE UNIQUE INDEX IF NOT EXISTS idx_{table}_supabase_id ON {table}(supabase_id);
```

## 9. sync.js API Changes

```javascript
// New exports
module.exports = {
  init,
  startAutoSync,
  stopAutoSync,
  syncNow,       // push + pull
  pushNow,       // push only (renamed from current syncNow)
  pullNow,       // pull only
  getStatus,     // includes pull status
}
```

## 10. Verification Checklist

Before declaring bidirectional sync complete:
- [ ] Edit a service on web -> appears on desktop after sync
- [ ] Edit a client on desktop -> appears on web after sync
- [ ] Create a ticket on web -> appears on desktop (FWW, no overwrite)
- [ ] Void a ticket on web -> status propagates to desktop
- [ ] Offline for 1 hour -> all changes sync correctly on reconnect
- [ ] Two edits to same client (web + desktop within 1 min) -> LWW resolves correctly
- [ ] New washer created on web -> appears on desktop with correct local integer id
- [ ] FK resolution: ticket with client_supabase_id pulls correctly, local client_id resolves
