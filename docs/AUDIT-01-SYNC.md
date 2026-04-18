# Audit 1 — Sync Architecture

Scope: sync timing, pull/push races, LWW correctness, duplicate creation, timestamp reliability,
sync ordering. Audit performed against `electron/sync.js`, `electron/main.js`,
`electron/database.js`, `packages/ui/screens/FirstTimeSetup.jsx`,
`packages/ui/context/LicenseContext.jsx`, and live Supabase project
`csppjsoirjflumaiipqw` (staff/empleados tables, trigger definitions).

Every finding below cites file:line and is reproducible. The single root cause of ~80% of
the observed symptoms (PIN clobber, salary overwrite, duplicate empleados, settings revert)
is **F1 + F2 combined**: the pull thinks remote is always newer than local, so every
5 minutes (and on every realtime event, and on every startup) desktop edits get wiped
out by whatever was last in Supabase.

---

## Findings

### CRITICAL

- **[F1] LWW comparison is structurally broken — remote *always* wins**
  - **Where:** `electron/sync.js:1247`
  - **Evidence:** SQLite stores `updated_at` as `'YYYY-MM-DD HH:MM:SS'` (space separator,
    second precision — produced by `datetime('now')` in the auto-update triggers at
    `database.js:769-771` and by `new Date().toISOString()` calls which get coerced to
    this form on later UPDATE via the trigger). PostgREST returns Supabase `updated_at`
    as `'2026-04-16T19:47:00.169227+00:00'` (ISO-8601 with `T` separator). The comparison
    `row.updated_at <= existing.updated_at` is a raw string compare. At character index
    10, local is `' '` (0x20) and remote is `'T'` (0x54). Therefore *every* remote
    timestamp sorts higher than *every* local timestamp, regardless of actual wall-clock
    time.

    Verified:
    ```
    local  = '2026-04-16 22:00:00'
    remote = '2026-04-16T19:47:00.169227+00:00'
    remote <= local  →  false   (so the "remote not newer" early-return never fires)
    remote >  local  →  true    (even though remote is 2h 13min older)
    ```

    The user's reproduction case (local 19:47, remote 21:27): remote wins — correct by
    accident. The insidious case (local 22:00, remote 19:47): remote STILL wins,
    silently overwriting fresh desktop data with stale cloud data. This is PIN clobber,
    salary overwrite, settings revert, and "my edits disappeared after 5 minutes" all
    in one line.
  - **Root cause:** naive lexicographic string comparison between two different
    timestamp formats. Both sources ARE comparable numerically (both are second-precision
    or better UTC), but only if normalized to the same format first.
  - **Fix:** parse both sides as `Date` and compare ms. Replace `electron/sync.js:1247` with:
    ```js
    if (existing.updated_at && row.updated_at) {
      const localMs = Date.parse(existing.updated_at.replace(' ', 'T') + (existing.updated_at.includes('Z') || existing.updated_at.includes('+') ? '' : 'Z'))
      const remoteMs = Date.parse(row.updated_at)
      if (Number.isFinite(localMs) && Number.isFinite(remoteMs) && remoteMs <= localMs) return
    }
    ```
    Also backfill: add a one-time migration that rewrites every existing SQLite
    `updated_at` to ISO-8601-with-T-and-Z (`strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)`)
    so the SQLite triggers produce the same shape going forward. Then the raw string
    compare would also work, but parsed compare is defensive.

- **[F2] FirstTimeSetup writes the wrong UUID into `supabase_id` — the single root cause of staff/empleado duplication cascade**
  - **Where:** `packages/ui/screens/FirstTimeSetup.jsx:567`
  - **Evidence:** The reconnect flow pulls `staff.*` from Supabase and calls
    `saveUsuario({ ..., supabase_id: u.id, ... })`. `u.id` is Supabase's PRIMARY KEY
    (the random UUID Supabase assigned), NOT `u.supabase_id` (the UUID the desktop
    originally generated and uses as its sync identity). `database.js:1343` then
    matches by that PK value against the local `supabase_id` column, fails to find
    (correctly, because no local row uses a Supabase PK as its supabase_id), and
    inserts a NEW local row. On the next push, `sync.js:1442` sends up a row with
    `supabase_id = <Supabase PK of someone else's row>`, which does NOT conflict with
    the original row (whose `supabase_id` is the desktop-generated UUID). Supabase
    gets a second row.

    Live proof from the Supabase project (`1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79`,
    username `esoliman`):
    ```
    row A: id=d1f5060d..., supabase_id=4883dd8e...  (original — created 2026-03-28)
    row B: id=39ac5be6..., supabase_id=2ab1ddda...  (duplicate #1 — created 2026-04-16 19:18)
    row C: id=6aec77a7..., supabase_id=39ac5be6-db8d-4f6f-be34-5a71b6467164  (duplicate #2)
                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                        This is row B's `id` — the smoking gun.
    ```
    Row C's `supabase_id` is literally row B's Supabase `id`. The only way that value
    could have been written is `saveUsuario({ supabase_id: u.id })` during a reconnect
    pass that pulled row B from Supabase. Same pattern for `michael` and `wlugo` — 3
    rows each, each duplicate's `supabase_id` pointing at the previous duplicate's `id`.
  - **Root cause:** misnamed field in the client shim. `u.id` vs `u.supabase_id`.
  - **Fix:** `packages/ui/screens/FirstTimeSetup.jsx:567` change `supabase_id: u.id` to
    `supabase_id: u.supabase_id || u.id` (prefer the explicit supabase_id column; fall
    back to id only for pre-migration rows that haven't been reshaped). After deploying,
    run the dedup migration in F3 to collapse the existing orphans. Also add a guard in
    `database.js` userCreate (line 1343-1348): before inserting, if `data.supabase_id`
    is supplied, verify it does not already appear as the `id` of any previously-pulled
    staff row — if it does, treat as a corrupted payload and reject.

- **[F3] Duplicate staff/empleado rows already in Supabase for live tenants**
  - **Where:** Supabase `staff` table, business `1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79`
    (Mike's own account — the canary)
  - **Evidence:** Query:
    ```sql
    SELECT business_id, name, username, COUNT(*) AS c FROM staff
    GROUP BY business_id, name, username HAVING COUNT(*) > 1;
    ```
    Returns 3 distinct usernames each with 3 rows:
    - `michael` × 3
    - `wlugo` × 3
    - `esoliman` × 3

    These are pre-existing corruption from F2. They will keep getting pulled into every
    new desktop install and each pull will create a fresh local empleado row per
    Supabase row (because naturalKey heal only fires on a unique match — with 3 remote
    rows all named "Michael Mejia", zero local matches, pull INSERTs all 3 as new local
    empleados).
  - **Root cause:** accumulated damage from F2 across 11 patch releases today.
  - **Fix:** one-time SQL migration in Supabase to keep the oldest row per
    `(business_id, username)` and hard-delete the rest. Run BEFORE shipping the F2 fix
    (otherwise new installs pulling today still get 3 copies):
    ```sql
    DELETE FROM staff
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY business_id, username
          ORDER BY created_at ASC
        ) AS rn FROM staff
      ) x WHERE x.rn > 1
    );
    ```
    Equivalent for `empleados` keyed on `(business_id, nombre, cedula)` (only one row is
    "canonical" — the oldest by created_at, assuming cedula is set; if not, dedupe on
    `(business_id, nombre)`).

- **[F4] 40+ IPC mutation handlers write locally but never trigger an immediate push**
  - **Where:** `electron/main.js:839-1108` (see list below)
  - **Evidence:** grep for `sync.syncNow` in `main.js` returns ~12 call sites. The
    handlers that DO push:
    ```
    save-empresa, save-usuario, delete-usuario, users:create, users:update,
    empleados:create, empleados:update, empleados:delete, empleados:hard-delete,
    salary-changes:create, salary-changes:delete, tickets:create, tickets:markPaid,
    tickets:void, sellerCommissions:create, cajeroCommissions:create
    ```
    Every other mutation handler writes to SQLite and relies on the 5-min auto-sync
    to eventually catch it. During those up-to-5 minutes, a realtime event can fire
    pullNow() which, thanks to F1, clobbers the fresh local write with whatever is
    already in Supabase.

    Handlers that MUTATE but do NOT push (explicit list, file + line):
    - `save-configuracion` (main.js:881) — all app settings including `business_type`, `ciudad`, WhatsApp, fiscal
    - `settings:update` (main.js:890)
    - `payroll-settings:update` (main.js:979)
    - `save-lavador` / `delete-lavador` (main.js:861-862)
    - `save-vendedor` / `delete-vendedor` (main.js:866-867)
    - `save-servicio` / `delete-servicio` (main.js:871-872)
    - `save-secuencia-ncf` (main.js:877)
    - `categorias:create/update/delete` (main.js:911-913)
    - `services:create/update/delete` (main.js:918-920)
    - `washers:create/update` (main.js:925-926)
    - `sellers:create/update` (main.js:931-932)
    - `mesas:create/update/setStatus/delete` (main.js:944-947)
    - `modificadores:create/update/delete/attach/detach` (main.js:952-957)
    - `kds:fire/setStatus` (main.js:961-962)
    - `restaurant:itemModificadores:snapshot` (main.js:968)
    - `payroll-runs:create/bulk-create/delete` (main.js:971-975)
    - `adelantos:create/deduct/cancel` (main.js:986-991)
    - `vehicles:create/update/delete` (main.js:995-999)
    - `serviceBays:create/update/delete` (main.js:1002-1005)
    - `workOrders:create/update` (main.js:1008-1009)
    - `workOrderItems:create/update/delete` (main.js:1014-1016)
    - `appointments:create/update/delete` (main.js:1020-1024)
    - `stylistSchedules:create/update/delete` (main.js:1027-1030)
    - `loans:create/update` (main.js:1033-1034)
    - `loanPayments:create` (main.js:1039)
    - `pawnItems:create/update/delete` (main.js:1043-1046)
    - `clients:create/update/updateBalance` (main.js:1051-1053)
    - `credits:collect` (main.js:1055)
    - `tickets:updateItemPrice` (main.js:1064)
    - `queue:updateStatus/delete` (main.js:1070-1071)
    - `commissions:markPaid` (main.js:1076)
    - `sellerCommissions:markPaid` (main.js:1081)
    - `cajeroCommissions:markPaid` (main.js:1084)
    - `cuadre:create` (main.js:1087)
    - `ncf:next/updateSequence` (main.js:1094-1095)
    - `cajachica:create/updateStatus` (main.js:1099-1100)
    - `notas:create` (main.js:1104)
    - `dgii:607:add/delete` (main.js:1109-1110)
    - `inventory:create/update/delete/adjust` (main.js:1257-1260)

    That is 40+ mutation handlers with no push. In every one of those cases, the window
    between "user clicks Save" and "sync finally runs" is 0-300 seconds during which
    a concurrent pull can erase the user's edit.
  - **Root cause:** push-after-write was added ad-hoc to only the screens whose
    symptoms became visible. The pattern was never applied uniformly.
  - **Fix:** centralize push-after-write. Replace the `handle()` helper at
    `main.js:818-835` with a variant that accepts an optional `push: true` flag and
    calls `sync.syncNow().catch(() => {})` after a successful mutation. Then flip on
    `{ push: true }` for every mutation channel. Example:
    ```js
    function handleMut(channel, fn) {
      handle(channel, async (...args) => {
        const r = await fn(...args)
        sync.syncNow().catch(() => {})
        return r
      })
    }
    ```
    Mass-rename `handle(...)` to `handleMut(...)` for every channel in the 40+ list
    above. Keep `handle()` for pure reads. This is a mechanical change — no logic
    needs to be reasoned about.

- **[F5] `pullNow()` is not gated by `_syncing`, allowing push/pull to interleave**
  - **Where:** `electron/sync.js:1393-1417` and `sync.js:1717-1763` (realtime)
  - **Evidence:** `syncNow()` at line 1604 checks `_syncing` and queues via
    `_pendingSync`. `pullNow()` has NO such guard — it just runs. The realtime handler
    at `sync.js:1731-1738` calls `pullNow()` directly. Scenario:
    1. T=0 — user saves PIN → `users:update` runs `db.userUpdate` → SQLite now has
       new pin_hash, old `updated_at` overwritten by trigger.
    2. T=10ms — handler calls `sync.syncNow()`. Push phase begins. The row gets
       upserted to Supabase. `staff.updated_at` is rewritten by `trg_set_updated_at`
       BEFORE UPDATE trigger to server `now()`.
    3. T=200ms — Supabase emits a realtime postgres_changes event for the row we
       just pushed. The realtime handler fires a 1.5s-debounced `pullNow()`.
    4. T=300ms — SQLite push phase completes, writes `last_synced_at = now()` in sync_log.
    5. T=1700ms — debounced `pullNow()` runs WHILE `syncNow()` is still in its pull
       phase (step 3 of the SYNC_TABLES loop for tables that come later). Two concurrent
       GETs against Supabase; each calls `pullUpsertRow` on the same row. The first
       one to complete UPDATE-s SQLite. Because of F1, `updated_at` compare always says
       remote is newer, so the row gets UPDATE-d with whatever Supabase returned —
       including the pin_hash we just pushed (so it's a no-op on the value), but it
       bumps SQLite's updated_at forward, which feeds into F6 below.
  - **Root cause:** realtime handler bypasses the mutex that `syncNow()` provides.
  - **Fix:** have realtime call `syncNow()` (which is gated) instead of `pullNow()`
    directly. OR extract the lock: share `_syncing`/`_pendingSync` with `pullNow()`:
    ```js
    async function pullNow() {
      if (_syncing) { _pendingSync = true; return _status }
      _syncing = true
      try { /* existing body */ } finally { _syncing = false }
      if (_pendingSync) { _pendingSync = false; return syncNow() }
    }
    ```

### HIGH

- **[F6] SQLite `updated_at` has SECOND precision, Supabase has MICROSECOND precision — every pull overwrites the local timestamp**
  - **Where:** `database.js:769-771` (SQLite trigger) and pull path `sync.js:1253-1259`
  - **Evidence:** SQLite trigger sets `datetime('now')` which is second-precision:
    `'2026-04-16 19:47:00'`. Supabase stores `timestamptz` with microseconds:
    `'2026-04-16T19:47:00.169227+00:00'`. After a push → pull round-trip of the same
    row, the SQLite row's `updated_at` gets rewritten to the Supabase value. If F1 is
    fixed (to a correct parsed compare), the same timestamp parse is *not* exactly
    equal (`19:47:00.000 < 19:47:00.169`), so the next pull still sees "remote newer"
    (by 169ms) and keeps updating. It's idempotent on data, but it floods the log,
    burns write cycles, and keeps the last_pull_at cursor racing forward.
  - **Root cause:** precision mismatch + eager overwrite of local `updated_at` with
    the value returned from Supabase (sync.js:1256-1260 — the pull UPDATE writes
    `updated_at` as one of the synced columns).
  - **Fix:** on pull, do NOT overwrite `updated_at` with the remote value. Let the
    SQLite trigger set it to local `datetime('now')` on the UPDATE. Remove
    `updated_at` from the pull `cols` array OR special-case it in pullUpsertRow:
    ```js
    for (const col of cols) {
      if (col === 'updated_at') continue  // let the trigger handle it
      if (row[col] !== undefined) { ... }
    }
    ```
    Alternatively, promote SQLite to ISO-8601+T+Z with ms precision everywhere:
    change the trigger to `strftime('%Y-%m-%dT%H:%M:%fZ','now')` and change all JS
    `new Date().toISOString()` writes (already correct) to persist via the trigger's
    format. Both fix F1 and F6 in one pass.

- **[F7] Pull strategy for `users` table is LWW with naturalKey `username` — pin_hash gets clobbered**
  - **Where:** `electron/sync.js:1088`
  - **Evidence:** Pull config:
    ```js
    { name: 'users', strategy: 'lww', naturalKey: 'username',
      cols: ['name','username','pin_hash','role','discount_pct','commission_pct',
             'cedula','start_date','employee_id','active','created_at','updated_at'] }
    ```
    `pin_hash` is in the pull cols. The naturalKey is `username`. When F1 says remote
    is newer (always), the pull rewrites the local pin_hash with Supabase's value.
    If Supabase is a stale copy (because a user changed their PIN offline and the push
    hasn't completed), the offline edit is lost. If Supabase has `pin_hash =
    'needs_reset_on_login'` (seen in the live data for Wendy Lugo), the pull writes
    that sentinel into SQLite and the user can't log in.
  - **Root cause:** `users`/`staff` is an authentication-critical table. LWW is too
    permissive — a pull should never decrement/invalidate credentials.
  - **Fix:** exclude `pin_hash` from the pull `cols` array OR add a defensive guard:
    if `row.pin_hash === 'needs_reset_on_login'` OR `existing.pin_hash !==
    row.pin_hash` AND existing has been touched locally within 60s, keep local.
    Simpler: drop `pin_hash` from `sync.js:1088` cols entirely and rely only on the
    authoritative push direction for password state. The staff seed during
    FirstTimeSetup (which DOES need pin_hash from remote) passes it explicitly via
    `saveUsuario` (FirstTimeSetup.jsx:565) — that path is unaffected by removing
    pin_hash from PULL_TABLES.

- **[F8] Natural-key heal silently adopts remote supabase_id, compounding F2**
  - **Where:** `electron/sync.js:1216-1221`
  - **Evidence:** When a pull row with supabase_id=X has no local match by
    supabase_id, but exactly one local row matches by `naturalKey` (e.g. same
    username), the code UPDATEs the local row: `UPDATE ... SET supabase_id = ? WHERE
    id = ?`. This overwrites the local row's existing `supabase_id` with the remote
    one. Combined with F2 (where the "remote supabase_id" is actually Supabase's PK
    for a DIFFERENT row), this cements the bad UUID into the local DB. On the next
    push, the row goes up under the wrong identity and Supabase sees it as a new row
    (F3 cascade).
  - **Root cause:** heal was designed for a legitimate DB-rebuild scenario but is
    unsafe when the pull payload itself carries a corrupt supabase_id.
  - **Fix:** before healing, verify the incoming `row.supabase_id` doesn't already
    exist as the `id` of any Supabase row for this table (catch F2's signature).
    Simpler: after F2 is fixed in FirstTimeSetup, the heal is safe again. But also
    add a sanity check: if the local row already has a non-null `supabase_id` and the
    incoming `row.supabase_id` differs, log a warning and DO NOT heal — this
    indicates a dual-origin conflict that should be resolved manually.

- **[F9] Pull cursor uses `gte.lastPull` which refetches every row with the same timestamp on every pull**
  - **Where:** `electron/sync.js:1348`
  - **Evidence:** `if (lastPull) params['updated_at'] = gte.${lastPull}`. Combined
    with second-precision SQLite timestamps (F6), it's trivial for 50+ rows to share
    the same `updated_at` on batch writes. Next pull starts at `gte.2026-04-16 19:47:00`
    and re-fetches all 50 rows. Each pull becomes idempotent but O(N) instead of
    O(Δ). At 5-min intervals × realtime × multi-device, this is the reason Mike's
    sync log shows "pulled 1200 rows" repeatedly even though only 3 changed.
  - **Root cause:** timestamp precision forces `gte` instead of `gt`.
  - **Fix:** after F6 (microsecond ISO-8601 in SQLite), switch back to `gt.` — the
    comment at sync.js:1345-1347 is wrong about needing `gte`. The original rationale
    (avoiding orphaned rows) is moot once local timestamps also have microsecond
    precision, because no two rows ever share the exact same updated_at in practice.

- **[F10] Supabase `trg_set_updated_at` (BEFORE UPDATE) unconditionally overwrites `updated_at = now()`**
  - **Where:** Supabase function `trg_set_updated_at`, verified via
    `SELECT prosrc FROM pg_proc WHERE proname='trg_set_updated_at'`
  - **Evidence:** Function body: `BEGIN NEW.updated_at = now(); RETURN NEW; END;`.
    This fires on EVERY UPDATE, even when the desktop supplies its own
    `updated_at` in the upsert payload. That means Supabase's `updated_at` always
    reflects server wall-clock time of the last UPSERT, NOT the original edit time.
    Two desktop pushes 1 second apart for two different fields both stamp
    `updated_at = now()` at server time, destroying any chance of detecting
    "which edit was actually more recent" across devices.
  - **Root cause:** the trigger is aggressive. For a desktop-authoritative write,
    the desktop's submitted timestamp is the truth; the server shouldn't overwrite.
  - **Fix:** change `trg_set_updated_at` to preserve a supplied non-null value:
    ```sql
    CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS trigger AS $$
    BEGIN
      IF NEW.updated_at IS NULL OR NEW.updated_at = OLD.updated_at THEN
        NEW.updated_at = now();
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    ```
    Same for the older `update_updated_at` function. This is safe because the sync
    pipeline always supplies `updated_at` (sync.js:874 coalesces to `nowIso` if null).

### MEDIUM

- **[F11] `empleadoCreate` has NO dedup check — every call INSERTs**
  - **Where:** `electron/database.js:1534-1561`
  - **Evidence:** Unlike `userCreate` (database.js:1342-1348) which checks for
    existing by `supabase_id` then `username`, `empleadoCreate` always generates a
    new `crypto.randomUUID()` and INSERTs. If the renderer calls `empleados:create`
    twice (double-click, retry, offline-queue replay), two local rows with different
    `supabase_id`s get created. Sync then pushes both up. With the
    `uq_empleados_biz_sid UNIQUE (business_id, supabase_id)` constraint, both succeed
    (different supabase_ids), so Supabase ends up with two rows too.
  - **Root cause:** missing idempotency.
  - **Fix:** add dedup check in empleadoCreate (line 1536) mirroring userCreate:
    ```js
    function empleadoCreate(data) {
      if (!db) return null
      // Dedup: match on supabase_id first, then (nombre, cedula) combo.
      let existing = null
      if (data.supabase_id) {
        existing = db.prepare('SELECT id, supabase_id FROM empleados WHERE supabase_id=?').get(data.supabase_id)
      }
      if (!existing && data.cedula) {
        existing = db.prepare('SELECT id, supabase_id FROM empleados WHERE cedula=? AND active=1').get(data.cedula)
      }
      if (!existing && data.nombre) {
        existing = db.prepare('SELECT id, supabase_id FROM empleados WHERE nombre=? AND active=1').get(data.nombre)
      }
      if (existing) { /* UPDATE path mirror of userCreate */ }
      /* else existing INSERT path */
    }
    ```

- **[F12] Blocking initial pull during license validation doesn't retry per-table failures**
  - **Where:** `packages/ui/context/LicenseContext.jsx:136-141` calls
    `window.electronAPI.sync.pull()` → `sync.pullNow()` at `sync.js:1393-1417`.
  - **Evidence:** `pullNow()` loops over `PULL_TABLES` and swallows per-table errors
    in a try/catch at line 1403 (`log.error(...); continue`). If `staff` pull fails
    (network blip, 502), the Login screen renders against empty SQLite and every
    PIN fails — the whole point of the blocking pull is defeated. There's no retry
    and no failure signal back to the renderer (the function returns
    `{ pulled: totalPulled }` silently on partial failure).
  - **Root cause:** silent per-table failure tolerance.
  - **Fix:** collect per-table errors, retry each failed table once after a 500ms
    delay, and return both `{ pulled, failed: [{ table, error }] }`. LicenseContext
    can choose to surface a "degraded sync" banner if critical tables (staff,
    empleados, services, businesses) are in `failed`.

- **[F13] `activity_log` push is listed before `users` PULL dependency, but it has `actor_supabase_id` FK to users**
  - **Where:** `electron/sync.js:296-316` (SYNC_TABLES) vs `sync.js:1070+` (PULL_TABLES)
  - **Evidence:** In SYNC_TABLES, `activity_log` is pushed after `users` (good). In
    PULL_TABLES the order is also OK. But `activity_log` pull has no `fkCols`
    mapping for `actor_supabase_id` (line 1181), so the local integer `actor_id`
    never gets resolved from the UUID. On a desktop pull, `actor_id` stays NULL
    while `actor_supabase_id` is populated — causes joins in `activityLogList` to
    miss the actor's current name.
  - **Root cause:** missing fkCols entry.
  - **Fix:** add `fkCols: { actor_supabase_id: 'users' }` to the activity_log
    PULL_TABLES entry at sync.js:1181.

- **[F14] `_pendingSync` doesn't propagate the REASON for re-sync — realtime events during sync get collapsed to one re-run**
  - **Where:** `electron/sync.js:1688-1691`
  - **Evidence:** If 20 realtime events fire during one sync, `_pendingSync = true`
    flips once and one more syncNow runs. That's fine for data consistency (pull
    will see all 20 changes), but the diagnostic log makes it look like we processed
    1 event. Not a correctness issue; logged here so F-audit is complete.
  - **Fix:** optional — increment a counter instead of a boolean, log it. Low priority.

### LOW

- **[F15] Realtime starts only from `startAutoSync` — if sync is disabled (no credentials), realtime is silently disabled too**
  - **Where:** `electron/sync.js:1697-1707`
  - **Evidence:** `startAutoSync` is only called when `env.supabaseUrl && syncKey`
    are both set (`main.js:786-789`). That's correct gating. LOW priority, documented
    only for completeness.
  - **Fix:** none needed — intended behavior.

- **[F16] Sync cursor field `last_synced_id` is effectively dead after supabase_id migration**
  - **Where:** `electron/sync.js:1427, 1434, 1453`
  - **Evidence:** The push loop still uses `WHERE id > cursor` with `last_synced_id`
    to paginate. Once a row is pushed, cursor advances past it. But Pass 2 (line
    1462-1485) separately re-scans by `updated_at > lastSyncedAt` and re-pushes any
    changed row, which is what actually keeps the sync healthy after the first
    backfill. The `last_synced_id` path is now mostly dead code for any
    long-running install.
  - **Fix:** none strictly required. Leave as-is — it's harmless and the initial
    backfill path still needs it for large initial sync batches.

---

## Fix pass (ordered)

The fixes build on each other. Ship them in this order in a single release — many
depend on F1/F2 being in place first.

1. **F2 fix — FirstTimeSetup.jsx:567** (`supabase_id: u.supabase_id || u.id`).
   *Why first:* stops the bleeding. Every new install and every reconnect today
   is actively corrupting Supabase. Deploy this within the hour.

2. **F3 migration — dedup existing Supabase staff/empleados.** SQL migration against
   Supabase Management API. Keep oldest row per (business_id, username) for staff;
   (business_id, nombre, cedula) for empleados. Also fan out local reconciliation:
   when desktop pulls after the dedup, naturalKey heal should re-adopt the canonical
   supabase_id cleanly.
   *Why second:* before F1 is fixed, the remaining dup rows would keep getting
   pulled down and multiplied on every install.

3. **F1 fix — sync.js:1247 parsed-date comparison** + one-time SQLite migration to
   rewrite all `updated_at` columns to ISO-8601 with `T` and `Z` via
   `UPDATE <table> SET updated_at = REPLACE(updated_at,' ','T')||'Z' WHERE updated_at NOT LIKE '%T%'`.
   *Why third:* single biggest impact. Stops PIN/salary/settings clobber for all
   tables at once.

4. **F6 + F9 — drop `updated_at` from pull UPDATE cols** (let local trigger refresh
   it) AND switch pull filter from `gte.` to `gt.` after the SQLite timestamp
   migration in step 3.
   *Why fourth:* cleans up the pull thrash and makes cursors actually advance.

5. **F4 — centralized `handleMut` helper with auto-push.** Rename 40+ `handle(...)`
   mutation calls to `handleMut(...)` in main.js. Mechanical.
   *Why fifth:* once F1/F6 are correct, immediate-push becomes safe (no clobber
   risk). Without F1 fix, immediate push can push → realtime → pull → clobber, so
   this must come after F1.

6. **F7 — remove `pin_hash` from users PULL_TABLES cols** (sync.js:1088).
   *Why:* even with F1 correct, credentials should be push-only from the
   authoritative device.

7. **F10 — update Supabase `trg_set_updated_at` to preserve supplied timestamp.**
   DDL migration. Applies to all tables using that trigger function.
   *Why:* lets the real edit time survive the round-trip, enabling proper LWW
   decisions across devices.

8. **F5 — gate `pullNow()` behind `_syncing`** (reuse the same flag syncNow uses).
   *Why:* removes push/pull interleave.

9. **F8 — naturalKey heal guard.** If existing local row has a supabase_id and the
   incoming row carries a different one, log and skip — don't overwrite.
   *Why:* defensive against future F2-style corruptions.

10. **F11 — `empleadoCreate` dedup check.** Add supabase_id / cedula / nombre lookup
    before INSERT, mirroring userCreate.
    *Why:* last line of defense against duplicate empleados from double-clicks
    or offline replays.

11. **F12 — per-table retry in `pullNow()`.** Collect failures, retry once, return
    `{ pulled, failed: [...] }`. LicenseContext can show a degraded-sync banner.

12. **F13 — add `fkCols: { actor_supabase_id: 'users' }` to activity_log pull
    config.** One-line fix.

---

## Do NOT touch (other agents' scope)

- Auth / `users` table logic beyond pin_hash pull (Audit 2)
- Business settings write pipeline (`empresaSave`, settings JSON structure) (Audit 3)
- Schema parity between SQLite and Supabase column lists (Audit 4)
- FirstTimeSetup business-creation flow, empresa seeding (Audit 5)
  — F2 fix touches ONLY line 567 in FirstTimeSetup.jsx (the `supabase_id: u.id`
  typo). That single-line correction is in scope for this audit because it is the
  root cause of the sync duplication cascade. Everything else about FirstTimeSetup
  (the wizard flow, empresa seeding, license reconnect) stays Audit 5's territory.
- Incident replay / historical diagnosis (Audit 6)
