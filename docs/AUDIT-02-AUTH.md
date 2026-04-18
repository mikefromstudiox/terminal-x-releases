# AUDIT 02 — Authentication + user/staff architecture

**Date:** 2026-04-16
**Scope:** PIN/login data model, staff/users view, sync identity bugs,
duplicate-row root cause, `auth_user_id` preservation, tiebreakers.
**Supabase project:** `csppjsoirjflumaiipqw`
**Live defect in prod:** 3x duplicate rows per username for business
`1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79` (Studio X Auto Detailing) —
`michael`, `esoliman`, `wlugo`.

---

## Proposed canonical identity

Every staff/user row is identified across devices by **`staff.id`
(primary UUID, Supabase-generated or desktop-minted)**. That **SAME
UUID** must appear as the desktop's `users.supabase_id`.
Any mapping where `staff.supabase_id` differs from `staff.id`, or
where desktop's `users.supabase_id` equals a DIFFERENT staff row's
`id`, is a bug.

Concretely, for the `staff` table only (and by extension the `users`
view), enforce the invariant:

```
staff.id == staff.supabase_id  -- for every row
```

and on desktop:

```
users.supabase_id == <corresponding Supabase staff.id>
```

Rationale: for every other synced table (`services`, `washers`,
`clients`, …) the desktop owns the UUID and it is written to BOTH
`id` (Supabase column, same UUID) — no, wait — those use Supabase-
generated UUIDs for `id` and the desktop's UUID for `supabase_id`.
For `staff` we also have this split today, but nothing reads or
relies on it: `auth_user_id` FK points at `auth.users.id` (not at
staff), and every FK FROM other tables points at `staff.id` (e.g.
`tickets.cajero_id` → `staff.id`, `web.js:1082` etc). So we should
collapse the two into one column on staff. The cleanest path is to
**force `staff.supabase_id` equal to `staff.id` on insert**. Then
the whole identity-aliasing class of bug (documented below) becomes
impossible.

---

## CRITICAL

### C1. FirstTimeSetup pulls remote `staff.id` and stores it as local `supabase_id` — manufactures the duplicate-row bug on every reconnect.

**File:** `packages/ui/screens/FirstTimeSetup.jsx:562-573`

```jsx
for (const u of remoteStaff) {
  await api?.admin?.saveUsuario?.({
    name: u.name || 'Admin',
    username: u.username || ...,
    pin_hash: u.pin_hash,
    role: u.role || 'admin',
    supabase_id: u.id,           // ← BUG: u.id is staff.id, NOT staff.supabase_id
    discount_pct: u.commission_pct || 0,
    cedula: u.cedula || null,
    start_date: u.start_date || null,
    employee_id: u.employee_id || null,
  })
}
```

**Mechanism of the dup explosion (live evidence):**
- Remote row B for `michael` has `id=85c630f5-5f3f-4ab1-85e2-011307156c69`,
  `supabase_id=dc3e6ad0-45f1-4535-88f3-2bdfda9558d7`.
- Reconnect wizard passes `supabase_id: u.id = 85c630f5…` to
  `userCreate` (`electron/database.js:1331`).
- `userCreate` finds no local row with `supabase_id=85c630f5…` (that
  UUID is a remote PK, not a local supabase_id), falls through to
  username-match, UPDATEs whatever local `michael` exists with
  `supabase_id=85c630f5…`.
- Sync pass 1 fires immediately (`main.js:854`) and pushes the row
  to `staff?on_conflict=business_id,supabase_id`. No existing
  Supabase row has `supabase_id=85c630f5…` so PostgREST INSERTs a
  **new** row (`id=c73be9fe…`). Row C is born.
- Every subsequent reconnect repeats — row C's `id=c73be9fe…`
  becomes the next pull's `supabase_id`, the cycle continues.

**Live proof (Supabase query, biz 1e14fdf4…):**

| username | id | supabase_id | auth_user_id | notes |
|----------|----|-------------|--------------|-------|
| michael | 569a6dbc… | f5a1d4e0… | 4c3d7715… | CANONICAL (owner login row) |
| michael | 85c630f5… | dc3e6ad0… | NULL | Reconnect clone 1 |
| michael | c73be9fe… | **85c630f5…** | NULL | Reconnect clone 2 (supabase_id = clone 1's id) |
| esoliman | d1f5060d… | 4883dd8e… | NULL | Original (2026-03-28) |
| esoliman | 39ac5be6… | 2ab1ddda… | NULL | Reconnect clone 1 |
| esoliman | 6aec77a7… | **39ac5be6…** | NULL | Reconnect clone 2 (supabase_id = clone 1's id) |
| wlugo | 6831db42… | 9b9fe1ae… | NULL | Original (2026-04-11), active=false, hash=`needs_reset_on_login` |
| wlugo | d8511612… | 5651d026… | NULL | Reconnect clone 1 |
| wlugo | 9a431570… | **d8511612…** | NULL | Reconnect clone 2 (supabase_id = clone 1's id) |

The second "Reconnect clone 2" row's `supabase_id` is literally the
previous row's `id`. That is the fingerprint of C1.

**Fix:** pass the Supabase row's `supabase_id`, not its `id`:

```jsx
await api?.admin?.saveUsuario?.({
  ...
  supabase_id: u.supabase_id || u.id,   // prefer true supabase_id; fall back to id only as safety net
  ...
})
```

Better: enforce the "Proposed canonical identity" rule everywhere.
Change FirstTimeSetup to always use `u.id` AND add a migration that
sets `staff.supabase_id = id` for every row with mismatched columns,
AND add a trigger `BEFORE INSERT ON staff: NEW.supabase_id := NEW.id`.
With that in place, C1's "wrong field" question disappears — there's
only one field.

**Verification:** after the fix, the 9 dup rows above collapse via
migration (see Remediation below). Run:
```
SELECT business_id, username, count(*) FROM staff GROUP BY 1,2 HAVING count(*) > 1
```
Expect 0 rows. Then trigger a reconnect on a clean desktop — the
same 3 logins should survive, no new rows appear.

---

### C2. No `UNIQUE (business_id, username) WHERE active=true` constraint on `staff` — Supabase happily accepted 3 dup rows.

**File:** Supabase schema — run
```
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.staff'::regclass;
```
Returns only `staff_pkey (id)`, two redundant `UNIQUE
(business_id, supabase_id)` (`uq_staff_sid` + `uq_staff_biz_sid`
— duplicates of each other), and FKs. **Nothing** on
`(business_id, username)`.

C1's runaway duplication could never have progressed past the
first clone if this constraint existed.

**Live count:** `SELECT business_id, username, count(*) FROM staff
GROUP BY 1,2 HAVING count(*)>1` → 3 rows, all 3x.

**Fix (migration):**

```sql
-- Dedup first — keep the row with auth_user_id (canonical owner link)
-- else the row with the lowest created_at. Soft-delete the rest.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY business_id, username
           ORDER BY
             (auth_user_id IS NOT NULL) DESC,   -- keep auth-linked first
             created_at ASC                      -- then oldest
         ) AS rn
  FROM staff
  WHERE active = true
)
UPDATE staff SET active = false, updated_at = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Partial unique index (only active rows; soft-deleted rows may repeat)
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_biz_username_active
  ON staff (business_id, lower(username))
  WHERE active = true;

-- Drop the redundant duplicate constraint (keep one)
ALTER TABLE staff DROP CONSTRAINT IF EXISTS uq_staff_sid;
-- Leave uq_staff_biz_sid (used by PostgREST on_conflict target).
```

**Verification:** after the migration, try
`INSERT INTO staff (business_id, username, name, role, active)
VALUES ('<biz>','michael','dup','cashier',true)` — expect 23505.

---

### C3. Desktop `userCreate` match-by-username fallback lets sync push overwrite Supabase with NULL `auth_user_id` (and clobber PIN).

**File:** `electron/database.js:1340-1363`

```js
if (data.supabase_id) {
  existing = db.prepare('SELECT id, supabase_id FROM users WHERE supabase_id=?').get(data.supabase_id)
}
if (!existing) {
  existing = db.prepare('SELECT id, supabase_id FROM users WHERE username=?').get(data.username)
}
if (existing) {
  db.prepare(`UPDATE users SET ... supabase_id=COALESCE(@supabase_id, supabase_id), active=1 WHERE id=@id`).run(...)
}
```

`COALESCE` protects against null-overwrite but NOT against
wrong-value overwrite. When FirstTimeSetup passes a bad
`supabase_id` (C1), it's not null, so COALESCE doesn't help —
local's correct `supabase_id` gets replaced with the remote's
`id`, which is the root mis-link that causes the duplicate push
into Supabase.

Additionally, the sync push body (`electron/sync.js:279-293`)
does **not** include `auth_user_id`, so the INSTEAD OF UPDATE rule
on the `users` view (`pg_rewrite.users_update`) sees
`auth_user_id = new.auth_user_id` with a NULL input, and NULLs out
the column. Proof: only 1 of 9 rows in biz 1e14fdf4 has
`auth_user_id` populated (query: `SELECT COUNT(*) FILTER (WHERE
auth_user_id IS NOT NULL), COUNT(*) FROM staff WHERE
business_id='1e14fdf4…'` → `1, 9`).

Since the push happens to the **`staff` table** directly (not the
view — see `sync.js:278` `supabaseTable: 'staff'`), and the push
column list (`sync.js:279-293`) excludes `auth_user_id`, PostgREST's
`resolution=merge-duplicates` upsert only writes the columns we
supply. So `auth_user_id` on the canonical row is preserved during
normal sync. **The NULLing happens because C1 creates a NEW row**
(the push targets a new `supabase_id`), and the new row's
`auth_user_id` defaults to NULL.

**Fix:**
1. Match by supabase_id only; NEVER fall back to username match.
   If supabase_id is provided but doesn't exist locally, INSERT
   a new row with that supabase_id. If supabase_id is missing
   AND the row already exists by username locally, generate a
   new `crypto.randomUUID()` and INSERT. Do not mutate existing
   rows when the caller passed a different identifier.
2. Include `auth_user_id` in the push cols once we stop
   regenerating wrong rows — currently safe only because push is
   to `staff` table and omits the column.

```js
function userCreate(data) {
  if (!db) return null
  const resolvePinHash = () => {
    if (data.pin_hash) return data.pin_hash
    if (data.pin) return sha256(data.pin)
    throw new Error('PIN requerido')
  }

  // Primary identity: supabase_id. If given, it's authoritative —
  // never fall through to username. Avoids wrong-row mutation.
  if (data.supabase_id) {
    const existing = db.prepare('SELECT id FROM users WHERE supabase_id=?').get(data.supabase_id)
    if (existing) {
      db.prepare(`UPDATE users SET name=@name, username=@username, pin_hash=@pin_hash,
        role=@role, discount_pct=@discount_pct, employee_id=@employee_id, cedula=@cedula,
        start_date=@start_date, active=1 WHERE id=@id`).run({ ...data, pin_hash: resolvePinHash(), id: existing.id })
      return { id: existing.id, supabase_id: data.supabase_id }
    }
    // New row with server-assigned supabase_id
    const r = db.prepare(`INSERT INTO users(name,username,pin_hash,role,discount_pct,employee_id,cedula,start_date,active,supabase_id)
      VALUES(@name,@username,@pin_hash,@role,@discount_pct,@employee_id,@cedula,@start_date,1,@supabase_id)`)
      .run({ ...data, pin_hash: resolvePinHash() })
    return { id: r.lastInsertRowid, supabase_id: data.supabase_id }
  }

  // No supabase_id: local-only create. If username taken, UPDATE in place;
  // else INSERT with a fresh UUID. Never reuse some other entity's id.
  const sid = crypto.randomUUID()
  const existing = db.prepare('SELECT id, supabase_id FROM users WHERE username=?').get(data.username)
  if (existing) {
    db.prepare(`UPDATE users SET name=@name, pin_hash=@pin_hash, role=@role,
      discount_pct=@discount_pct, employee_id=@employee_id, cedula=@cedula,
      start_date=@start_date, active=1 WHERE id=@id`).run({ ...data, pin_hash: resolvePinHash(), id: existing.id })
    return { id: existing.id, supabase_id: existing.supabase_id }
  }
  const r = db.prepare(`INSERT INTO users(name,username,pin_hash,role,discount_pct,employee_id,cedula,start_date,active,supabase_id)
    VALUES(@name,@username,@pin_hash,@role,@discount_pct,@employee_id,@cedula,@start_date,1,@supabase_id)`)
    .run({ ...data, pin_hash: resolvePinHash(), supabase_id: sid })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
```

**Verification:** unit test — `userCreate({ username:'michael',
pin:'1111', supabase_id:'<wrong-uuid>' })` must NOT update the
existing michael row when its stored supabase_id differs.

---

### C4. `authByPin` has no deterministic tiebreaker — two users sharing a PIN resolve to "whoever sqlite rolls".

**File:** `electron/database.js:1322-1326`

```js
function authByPin(pin) {
  if (!db) return null
  const hash = sha256(pin)
  return db.prepare('SELECT id,name,username,role,discount_pct FROM users WHERE pin_hash=? AND active=1').get(hash)
}
```

`.get()` returns the first row SQLite returns. With no `ORDER BY`,
SQLite may return any row. Practical impact: if two active users
share PIN `1111`, swap which one gets logged in based on insert
order, which changes with every rebuild. Activity log attribution
becomes wrong.

Further, in the biz 1e14fdf4 dataset, all three active `michael`
rows currently share `pin_hash=03ac6742…` AND all three active
`esoliman` rows share `pin_hash=03ac6742…` (same PIN hash — "1234"
probably, the post-setup default) — so a cashier who punched
"1234" would log in as whichever michael/esoliman dup came first.
The activity log attribution is randomized.

**Fix:**

```js
function authByPin(pin) {
  if (!db) return null
  const hash = sha256(pin)
  // Deterministic tiebreaker: prefer users linked to an employee record
  // (real logins) over orphan rows, then oldest id. NEVER return a
  // duplicate-clone row ahead of the original.
  return db.prepare(`
    SELECT id, name, username, role, discount_pct
    FROM users
    WHERE pin_hash=? AND active=1
    ORDER BY
      (employee_id IS NOT NULL) DESC,
      id ASC
    LIMIT 1
  `).get(hash)
}
```

Also emit a warning when >1 row matches:

```js
const matches = db.prepare('SELECT id, username FROM users WHERE pin_hash=? AND active=1').all(hash)
if (matches.length > 1) {
  console.warn(`[auth] PIN collision — ${matches.length} users share this PIN:`, matches.map(m=>m.username))
}
```

**Verification:** insert two users with PIN `1111`, call
`authByPin('1111')` 100 times → same `id` 100/100.

---

## HIGH

### H1. `users_dedup_done` one-shot migration deactivated wrong row when original lacked supabase_id.

**File:** `electron/database.js:625-641`

The dedup ordering was:
```sql
ORDER BY (supabase_id IS NOT NULL) DESC, id DESC
```

This favors any row with a supabase_id, regardless of whether that
supabase_id is **correct**. After C1 runs, the clone rows have
supabase_ids too (wrong ones), so dedup keeps whichever
INSERT-ORDER-came-last had a supabase_id. The correctness of the
kept row is undefined. Clean fix: use Supabase `auth_user_id` on
the remote-joined side as the oracle. Since this runs locally
without Supabase join, it can't reliably pick the right row — **the
dedup should be Supabase-side, not local-side**.

**Fix:** disable the local dedup (leave the flag set so it doesn't
re-run), and add a Supabase migration that dedups server-side by
joining the canonical signal: `auth_user_id IS NOT NULL`. See C2
remediation migration — it already does this correctly.

---

### H2. `saveUsuario` on edit: Admin.jsx sends `pin` as empty string when unchanged, but the handler unconditionally hashes it.

**File:** `packages/ui/screens/Admin.jsx:280`

```js
...(form.pin.trim() && { pin: form.pin.trim() }),
```

OK here (guard suppresses empty pin). But the web path
(`packages/data/web.js:200`):

```js
if (pin) rest.pin_hash = await hashPin(pin)
```

Also correct. **BUT** on desktop `userUpdate` (`database.js:1383-1384`):

```js
const { pin, ...rest } = data
if (pin && !rest.pin_hash) rest.pin_hash = sha256(pin)
```

Also correct — only hashes if `pin` truthy.

**No bug here.** Remove this section or mark resolved.

*(Status: NOT A BUG — retained for audit completeness.)*

---

### H3. Sync push body omits `auth_user_id`, so a desktop-originated row created with `auth_user_id=null` locally cannot link a Supabase auth user via sync.

**File:** `electron/sync.js:279-293` (`users` table cols)

```js
cols: r => ({
  supabase_id: r.supabase_id,
  name: r.name,
  username: r.username,
  pin_hash: r.pin_hash || null,
  role: r.role,
  discount_pct: r.discount_pct,
  commission_pct: r.commission_pct,
  cedula: r.cedula,
  start_date: r.start_date,
  employee_id: r.employee_id != null ? r.employee_id : null,
  active: r.active,
  created_at: r.created_at || new Date().toISOString(),
  updated_at: r.updated_at || null,
  // auth_user_id is NOT in this list
}),
```

Consequence: if an owner creates their Michael login on desktop,
sets a PIN, then separately claims their Supabase auth user via
the panel (`web/api/panel.js:493-496`), the sync push will **not**
touch `auth_user_id`, which is what we want. But the DESKTOP row
has no `auth_user_id` column either (SQLite schema lines 25-36)
— so there's no way for a desktop-only created staff to ever get
linked to an auth.users row without manual Supabase patching.

Today this only works because:
1. Signup flow (`web/api/signup/provision.js:51-54`) inserts the
   owner staff row **with** `auth_user_id` directly.
2. Reconnect flow (`FirstTimeSetup.jsx:950-956`) UPSERTs the
   owner staff row with `auth_user_id` via admin RLS override.
3. Admin "Crear Login" (`web/api/panel.js:493-496`) adds
   `auth_user_id` after the fact.

Anything created purely via desktop `userCreate` cannot ever
become a web-login row. **This is the intended admin workflow but
it's undocumented and fragile.**

**Fix:**
- Add `auth_user_id TEXT` to SQLite `users` (so pull can preserve
  it). SQLite migration:
  ```sql
  ALTER TABLE users ADD COLUMN auth_user_id TEXT;
  ```
- Add `auth_user_id` to sync push cols (so pushes preserve
  server-side linkage instead of dropping it on the next LWW round).
- Document the admin workflow in CLAUDE.md:
  > "To grant web-login access to a staff row, use Admin panel →
  > Client Detail → Crear Login. This calls
  > `web/api/panel.js:handleCreateLogin` which creates the
  > auth.users record + sets `businesses.owner_id` + UPSERTs
  > `staff.auth_user_id`. Never patch `staff.auth_user_id` by
  > hand — let the admin path do it."

**Verification:** after fix, desktop pull of a staff row with
`auth_user_id = <uuid>` should land in SQLite with that column
populated, and the next push should retain it.

---

### H4. `v1.9.37 users_dedup` runs once per SQLite database — re-runs only when local dups exist, but won't clean up Supabase.

**File:** `electron/database.js:625-641`

Flag `users_dedup_done` is set after first run, so the migration
is single-shot. But it only de-dups locally. The 3x dup rows in
Supabase live on. The sync push repeatedly overwrites the
duplicates in perpetuity. This is fine if C1 is fixed + C2
migration runs; flag this as a dependency.

**Fix:** None needed once C1 + C2 fixed. Optionally clear the flag
in the next release to re-run local dedup and pick the "canonical"
row by the new rules (C4 fix).

---

## MEDIUM

### M1. Two redundant unique constraints on `(business_id, supabase_id)` in `staff`: `uq_staff_sid` and `uq_staff_biz_sid`.

**Source:** pg_constraint query above.

Both enforce the same invariant. Harmless but noise. Drop
`uq_staff_sid`, keep `uq_staff_biz_sid` (has a clearer name).

**Fix:** included in C2 migration.

---

### M2. `users` view is simple pass-through — no filter on `active`. `api.getUsuarios` / `api.users.all` both return soft-deleted rows unless they add `.eq('active', true)`.

**File:** Supabase `users` view (from `pg_views.definition`):

```sql
SELECT id, business_id, auth_user_id, name, username, pin_hash, role,
       discount_pct, seller_id, active, created_at, updated_at,
       local_id, commission_pct, supabase_id, cedula, start_date, employee_id
FROM staff;
```

No `WHERE active=true`. That matches **intent** — admin screens
need to see inactive users to re-activate them — but:

`packages/data/web.js:194`:
```js
return throwSupaError(await supabase.from('users').select('...').eq('business_id', bid).order('id'))
```
No `active` filter.

`packages/data/web.js:429`:
```js
return throwSupaError(await supabase.from('users').select('...').eq('business_id', bid).order('id'))
```
Also no `active` filter.

Result: `authByPin` on web (`web.js:415-421`) correctly filters
`.eq('active', true)` but `getUsuarios` / `users.all` return the 9
rows (3 canonical + 6 dup clones), which is what the admin panel
"3 michael rows" visual refers to.

**Mike's note:** "my staff.active=false PATCHes didn't always
reflect in the users view". The view IS live — it always reflects
current `staff.active`. What probably happened: (a) he PATCHed the
wrong row (there are 3 michaels — he hit one, the UI showed the
other), or (b) the next sync push from desktop re-activated it via
`pullUpsertRow` → fails the `existing.active=0 && remote.active=1`
guard (`sync.js:1251`) only when local is inactive, but on push,
desktop sends `active: true` whenever it has a local active row.
Confirm: all 3 michael/esoliman/wlugo dups are `active=true` in
Supabase right now → desktop is re-pushing them as active, and
Mike's remote PATCH was overwritten by the next 5-minute sync.

**Fix:** after C1 and C2 land, there's only one row per username
per business, so `active=false` PATCHes stick.

Defensive: add a push-side guard in `sync.js` `users` cols:

```js
active: r.active,   // ← unchanged today
```

Change to consult remote before pushing:

```js
// 2-phase push for staff: check remote active status, skip re-activation
// if remote explicitly set active=false more recently than our local
// change. This is LWW behavior that currently doesn't fire because
// desktop doesn't know what Supabase thinks.
```

**This is H1 in Audit 1's territory (sync timing).** Defer.

---

### M3. Web auth.byPin's `.single()` throws on duplicate match, silently returning null via `tryOr`.

**File:** `packages/data/web.js:417-421`

```js
const { data } = await supabase.from('users')
  .select('id,name,username,role,discount_pct')
  .eq('business_id', bid).eq('pin_hash', hash).eq('active', true)
  .single()
return data || null
```

In biz 1e14fdf4 TODAY, PIN `1234` (`pin_hash=03ac67…`) has 6+
active matches across the michael/esoliman/wlugo dup sets. `.single()`
returns an error. `data` is `undefined`. Web user can't log in by
PIN at all.

**Fix:** replace `.single()` with `.maybeSingle()` + own
deterministic tiebreaker, matching C4:

```js
byPin: (pin) => tryOr(async () => {
  const hash = await hashPin(pin)
  const { data } = await supabase.from('users')
    .select('id,name,username,role,discount_pct,employee_id')
    .eq('business_id', bid).eq('pin_hash', hash).eq('active', true)
    .order('employee_id', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data || null
}, null),
```

**Verification:** test with biz 1e14fdf4's duplicate set → expect
successful login as the auth-linked michael (id 569a6dbc…), not
one of the clones.

---

### M4. `FirstTimeSetup` saves `discount_pct: u.commission_pct || 0` — maps server commission_pct to local discount_pct.

**File:** `packages/ui/screens/FirstTimeSetup.jsx:568`

Field mismatch — `commission_pct` and `discount_pct` are separate
columns with different semantics. `discount_pct` = max discount a
cashier can apply. `commission_pct` = how much they earn. Writing
commission into discount means cashiers gain discount privileges
equal to their commission %.

**Fix:**

```jsx
await api?.admin?.saveUsuario?.({
  ...
  discount_pct: u.discount_pct || 0,
  commission_pct: u.commission_pct || 0,
  ...
})
```

(And extend `userCreate` / `userUpdate` to accept `commission_pct`
— currently the `allowed` list in `userUpdate` does, but `userCreate`
silently drops it. Check `database.js:1367-1377`.)

**Verification:** reconnect an owner whose remote staff has
`commission_pct=5, discount_pct=0`. After reconnect, local users
row should have `commission_pct=5` AND `discount_pct=0`. Today it
has `discount_pct=5`.

---

### M5. Reconnect fallback creates an `admin` user with PIN `0000` when no remote staff exist — PIN never gets hashed properly if the admin flow's pin is undefined.

**File:** `packages/ui/screens/FirstTimeSetup.jsx:575-583`

```jsx
await api?.admin?.saveUsuario?.({
  name: 'Admin',
  username: 'admin',
  pin: '0000',
  role: 'owner',
  discount_pct: 0,
})
```

OK — this path's pin is hardcoded `0000` and will be hashed by
`userCreate`. Safe. But PIN `0000` is a weak default that's still
active after reconnect. **Security issue:** if a desktop gets
reconnected to a business that had its owner deleted on web, the
local gets a PIN `0000` admin that syncs to Supabase silently (no
`auth_user_id`, no oversight).

**Fix:** force the user to set a PIN on next login rather than
using `0000`. Or set `pin_hash='needs_reset_on_login'` (existing
sentinel — see the wlugo row) and short-circuit `authByPin` to
redirect to PIN-reset flow.

---

## LOW

### L1. `users` SQLite schema still has `UNIQUE` on `username` (schema.sql:28) — tolerable on desktop (single business per desktop) but blocks any future multi-business mode.

Won't cause trouble today. Note for future.

### L2. `deleteUsuario` IPC takes `{id}` wrapper (preload:21), but `users.delete` takes `{id}` too — no inconsistency but calling code passes raw id in some places. Grep `deleteUsuario(` for audit.

Noise. No action.

### L3. `staff.username` default `''::text` — empty string username is valid per schema. Empty-string usernames could slip into the (biz, username) unique index as one row.

After C2's unique index change, one biz will allow at most one
blank-username staff. Acceptable.

### L4. `users_insert` view rule uses `VALUES (..., supabase_id, ...)` — if caller omits supabase_id, it defaults to NULL, violating NOT NULL. Safe because `staff.supabase_id` has `DEFAULT gen_random_uuid()`, but the view rule passes `new.supabase_id` explicitly — if caller explicitly sets NULL, default doesn't fire. Don't use the view for INSERT.

Our codebase writes to `users` in web paths (`web.js:209, 436`)
with explicit `supabase_id: crypto.randomUUID()` — safe. But if
anyone ever drops that field, the insert will 23502.

**Fix:** add CHECK constraint:

```sql
ALTER TABLE staff ADD CONSTRAINT staff_supabase_id_not_empty
  CHECK (supabase_id IS NOT NULL);
```

Already NOT NULL by column definition. Redundant. Skip.

---

## Remediation order

1. **Supabase migration** (C2 + M1, idempotent):
   ```sql
   -- Dedup
   WITH ranked AS (
     SELECT id,
            row_number() OVER (
              PARTITION BY business_id, username
              ORDER BY
                (auth_user_id IS NOT NULL) DESC,
                created_at ASC
            ) AS rn
     FROM staff
     WHERE active = true
   )
   UPDATE staff SET active = false, updated_at = now()
   WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

   -- Prevent future dups
   CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_biz_username_active
     ON staff (business_id, lower(username))
     WHERE active = true;

   -- Drop redundant constraint
   ALTER TABLE staff DROP CONSTRAINT IF EXISTS uq_staff_sid;

   -- Collapse id/supabase_id so they always match
   UPDATE staff SET supabase_id = id WHERE supabase_id <> id;

   -- Enforce the invariant
   CREATE OR REPLACE FUNCTION staff_force_sid_equals_id()
   RETURNS trigger AS $$
   BEGIN
     IF NEW.supabase_id IS NULL OR NEW.supabase_id <> NEW.id THEN
       NEW.supabase_id := NEW.id;
     END IF;
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;

   DROP TRIGGER IF EXISTS trg_staff_sid_eq_id ON staff;
   CREATE TRIGGER trg_staff_sid_eq_id
     BEFORE INSERT OR UPDATE ON staff
     FOR EACH ROW EXECUTE FUNCTION staff_force_sid_equals_id();
   ```

2. **Desktop fix** (C1 + C3 + M4):
   - `FirstTimeSetup.jsx:567` — change `supabase_id: u.id` to
     `supabase_id: u.supabase_id || u.id`.
   - `FirstTimeSetup.jsx:568` — fix commission_pct/discount_pct split.
   - `database.js:1331` — replace `userCreate` with the
     supabase_id-first body from C3.

3. **PIN resolution** (C4 + M3):
   - `database.js:1322` — add deterministic ORDER BY to
     `authByPin`.
   - `web.js:415` — swap `.single()` for `.maybeSingle()` +
     server-side ORDER BY.

4. **Bonus** (H3):
   - SQLite migration `ALTER TABLE users ADD COLUMN auth_user_id TEXT`.
   - Add `auth_user_id` to `sync.js:279-293` users push cols list.

5. **Local dedup refresh** (H1):
   - Delete `users_dedup_done` flag from `app_settings` in this
     release so the dedup re-runs with new rules post-reconnect.

---

## Post-fix verification SQL

```sql
-- Zero duplicate active rows per (biz, username)
SELECT business_id, username, count(*) FROM staff
WHERE active = true GROUP BY 1,2 HAVING count(*) > 1;
-- Expect: 0 rows

-- id == supabase_id on every row
SELECT count(*) FROM staff WHERE id::text <> supabase_id::text;
-- Expect: 0

-- Every business with an owner-linked auth.users has exactly
-- one staff row with auth_user_id set
SELECT business_id, count(*) FILTER (WHERE auth_user_id IS NOT NULL)
FROM staff WHERE role='owner' AND active=true GROUP BY 1
HAVING count(*) FILTER (WHERE auth_user_id IS NOT NULL) <> 1;
-- Expect: 0 rows (every owner has 1 auth-linked staff)
```
