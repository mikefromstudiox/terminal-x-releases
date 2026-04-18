# Terminal X — Consolidated Fix Plan (One Release)

**Written:** 2026-04-16
**Scope:** Desktop ↔ Supabase sync, auth, settings, schema.
**Outcome target:** v2.0.0 is the last installer. Future patches are server-side or zero-risk cosmetic. If any of the PASS criteria at the bottom fails, the client wipes and starts over — that's the bar.

---

## Executive summary (read this first)

Three compounding bugs explain every issue you've hit today:

1. **LWW comparison is literally inverted.** Desktop writes `updated_at` as `'2026-04-16 19:47:00'` (SQL datetime with a space). Supabase returns `'2026-04-16T19:47:00.169227+00:00'` (ISO 8601 with a `T`). Code compares these as strings. Space (0x20) always sorts lower than `T` (0x54), so remote *always* appears newer to the pull logic. Every pull overwrites every local edit regardless of actual time. This is why your PIN / ciudad / salary kept reverting.

2. **Identity is aliased.** `FirstTimeSetup.jsx:567` passes `supabase_id: u.id` when it should pass `u.supabase_id`. These are two different UUIDs. Every re-provision writes a wrong UUID into local SQLite, sync push creates a *new* Supabase row with the wrong conflict key, next pull brings that clone back down. This is why you ended up with 3 Michael rows, 3 Enrique rows, 3 Wendy rows in Supabase.

3. **`updated_at` is not bumped on UPDATE.** `userUpdate`, `empleadoUpdate` and many others do raw SQL updates without setting `updated_at = datetime('now')`. Combined with the broken LWW, local edits never win even on a working comparison. This is why your salary raise vanished.

Fix these three and 80% of the pain is gone. The rest is cleanup (dup rows, stringified JSONB, schema mismatches, cert restore, UI feedback).

---

## Root causes, ranked

| # | Finding | Audit | File:Line | Severity | Blast radius |
|---|---------|-------|-----------|----------|--------------|
| F1 | LWW string comparison lexicographic, space < T | 1 | `electron/sync.js:1247` | CRITICAL | All synced tables — every pull clobbers every local write |
| F2 | `supabase_id: u.id` identity aliasing | 2 | `packages/ui/screens/FirstTimeSetup.jsx:567` | CRITICAL | staff / users — creates dup rows on every wipe+reactivate |
| F3 | `updated_at` not bumped on UPDATE | 5 | `electron/database.js:1380`, `1584` | CRITICAL | users, empleados — local edits silently lose LWW |
| F4 | Server writes stringified JSON into JSONB column | 3 | `web/api/validate.js:114`, `web/api/panel.js:342,862,1086,1107`, `tmp/seed-demo-businesses.mjs:357` | CRITICAL | businesses.settings corruption — poisoned 9/10 demo rows |
| F5 | Missing `UNIQUE (business_id, supabase_id)` on `queue_deletions` + `ecf_submissions` | 4 | Supabase schema | CRITICAL | Sync upserts silently fail |
| F6 | `tickets.void_by` is INTEGER, should be UUID | 4 | Supabase schema | CRITICAL | Every voided ticket push rejected |
| F7 | No `UNIQUE (business_id, username)` on staff | 2 | Supabase schema | HIGH | Supabase accepted all the dup Michaels today |
| F8 | `userCreate` falls back to username match when supabase_id mismatches | 2 | `electron/database.js:1340-1363` | HIGH | Bad identity mutates good rows |
| F9 | `authByPin` has no tiebreaker | 2 | `electron/database.js:1322` | HIGH | 3 Michaels + same hash → random winner |
| F10 | Web `auth.byPin` uses `.single()` — throws on dup matches | 2 | `packages/data/web.js:420` | HIGH | Silent null = "wrong PIN" on web |
| F11 | FirstTimeSetup reconnect fallback hardcodes `pin='0000'` | 2 | `packages/ui/screens/FirstTimeSetup.jsx:579` | HIGH | New user pushed to Supabase with PIN 0000 |
| F12 | `pushBusinessMeta` full-replace of settings column | 3 | `electron/sync.js:pushBusinessMeta` | HIGH | Multi-device race — one device's push strips another's cert PEM |
| F13 | 6 NOT NULL FKs that sync only writes `*_supabase_id` variant of | 4 | Supabase schema (credit_payments.client_id, inventory_transactions.item_id, cajero_commissions.cajero_id + ticket_id, loans.client_id, loan_payments.loan_id) | HIGH | First-time push of these tables from desktop rejected |
| F14 | 40+ IPC mutation handlers don't `sync.syncNow()` immediately | 1 | `electron/main.js` | MEDIUM | 5-min window where pull can clobber local edit |
| F15 | No `pullBusinessMeta()` counterpart to push | 5 | `electron/sync.js:1494` | MEDIUM | Multi-device — Device B never sees Device A's ciudad/logo edits |
| F16 | Blocking pull has no UI feedback | 5 | `packages/ui/context/LicenseContext.jsx:136-141` | MEDIUM | User stares at blank screen during restore |
| F17 | `.p12` cert never auto-restored after wipe | 5 | `packages/ui/context/LicenseContext.jsx:161-187` | MEDIUM | Certified e-CF breaks until owner manually re-uploads |
| F18 | `inventory_items` v2.2 auto-parts columns missing on Supabase | 4 | Supabase schema | MEDIUM | Auto-parts vertical has zero sync |
| F19 | `tickets.client_id text` + `tickets.cajero_id text` wrong type, never populated | 4 | Supabase schema | LOW | Legacy deadcode — web code using these returns empty |

---

## The one-release fix plan

All changes land in **v2.0.0**. Server-side changes deploy first, client installer second. Release notes call it out as the architecture fix, not a feature release.

### Phase 1 — Supabase server-side (no client change needed)

Can ship immediately, isolated blast radius.

**Migration: `db/migrations/v2-sync-foundation.sql`**

```sql
-- F5: missing UNIQUE constraints (sync upsert target)
ALTER TABLE queue_deletions ADD CONSTRAINT uq_queue_deletions_sid UNIQUE (business_id, supabase_id);
ALTER TABLE ecf_submissions ADD CONSTRAINT uq_ecf_submissions_sid UNIQUE (business_id, supabase_id);

-- F6: tickets.void_by wrong type
ALTER TABLE tickets ALTER COLUMN void_by TYPE uuid USING NULLIF(void_by::text, '')::uuid;

-- F7: prevent future staff dups
-- First collapse existing dups (keep row with auth_user_id, else oldest)
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY business_id, username
                            ORDER BY (auth_user_id IS NOT NULL) DESC, created_at ASC) AS rn
  FROM staff WHERE active = true
)
UPDATE staff SET active = false WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
ALTER TABLE staff ADD CONSTRAINT uq_staff_biz_username UNIQUE (business_id, username) DEFERRABLE;

-- F13: 6 FK columns that sync never populates — drop NOT NULL so pushes succeed
-- (the *_supabase_id variants are the authoritative sync key, so these are legacy)
ALTER TABLE credit_payments         ALTER COLUMN client_id  DROP NOT NULL;
ALTER TABLE inventory_transactions  ALTER COLUMN item_id    DROP NOT NULL;
ALTER TABLE cajero_commissions      ALTER COLUMN cajero_id  DROP NOT NULL;
ALTER TABLE cajero_commissions      ALTER COLUMN ticket_id  DROP NOT NULL;
ALTER TABLE loans                   ALTER COLUMN client_id  DROP NOT NULL;
ALTER TABLE loan_payments           ALTER COLUMN loan_id    DROP NOT NULL;

-- F18: inventory auto-parts columns
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS oem_part_number TEXT,
  ADD COLUMN IF NOT EXISTS compatibility    JSONB,
  ADD COLUMN IF NOT EXISTS reorder_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS supplier         TEXT;

-- F12 prep: JSONB merge helper so pushBusinessMeta can deep-merge without clobbering
CREATE OR REPLACE FUNCTION merge_business_settings(p_business_id uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  UPDATE businesses
  SET settings = COALESCE(settings, '{}'::jsonb) || p_patch,
      updated_at = now()
  WHERE id = p_business_id
  RETURNING settings;
$$;

-- F19: drop the legacy typed columns on tickets that are never populated
ALTER TABLE tickets DROP COLUMN IF EXISTS client_id;   -- keep client_supabase_id only
ALTER TABLE tickets DROP COLUMN IF EXISTS cajero_id;   -- keep cajero_supabase_id only
```

**Data repair: `db/migrations/v2-data-repair.sql`**

```sql
-- Rescue the 9 poisoned demo businesses — unescape the stringified settings
UPDATE businesses
SET settings = (settings::text)::jsonb
WHERE jsonb_typeof(settings) = 'string';

-- Collapse empleados duplicates the same way we did for staff
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY business_id, nombre
                            ORDER BY (ref_id IS NOT NULL) DESC, created_at ASC) AS rn
  FROM empleados WHERE active = true
)
UPDATE empleados SET active = false WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Fix the 8 existing active Michael/Enrique/Wendy dups for Studio X Auto Detailing
-- (already done today via PATCH; this is idempotent safety net)
```

**Server endpoints (web/api/) — F4 fix:**

- `validate.js:114` — parse `biz.settings` if string before spread.
- `panel.js:342, 862, 1086, 1107` — same guard at each spread.
- Also add JSONB safety: if the incoming `bizSettings.settings` is a string, parse it before writing.

Both are ~10-line changes. Redeploy Vercel. Runs on all existing clients with zero installer change.

### Phase 2 — Desktop client (v2.0.0 installer)

**F1 — fix LWW comparison**

In `electron/sync.js:1247`, replace string compare with `Date` compare:

```js
// OLD: if (row.updated_at <= existing.updated_at) return 'skip'
const remoteMs = new Date(row.updated_at).getTime()
const localMs  = new Date(existing.updated_at).getTime()
if (Number.isFinite(remoteMs) && Number.isFinite(localMs) && remoteMs <= localMs) return 'skip'
```

Also normalize the SQLite side: every `updated_at` write uses `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` (ISO 8601, milliseconds, UTC) instead of `datetime('now')`. Add a one-shot migration that rewrites all existing `updated_at` strings into ISO 8601 on v2 first-launch.

**F2 — fix FirstTimeSetup identity**

`packages/ui/screens/FirstTimeSetup.jsx:567`:

```js
// OLD:
supabase_id: u.id,
// NEW:
supabase_id: u.supabase_id || u.id,   // prefer true sync identity; fall back to PK only if legacy row
```

And add an assertion in `userCreate` that refuses to create a row whose `supabase_id` is already used by another row with a different `username` (defensive).

**F3 — bump updated_at on every UPDATE**

In `database.js`, update `userUpdate`, `empleadoUpdate`, `servicesUpdate`, `clientsUpdate`, `categoriaUpdate`, `inventoryUpdate`, `empresaSave`, `salaryChangeCreate`, every mutation helper:

```js
// Every UPDATE statement gets:
UPDATE <table> SET <fields>, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = @id
```

Alternative: add SQLite triggers that auto-bump `updated_at` on UPDATE for every synced table. Equivalent to what Supabase has. Less error-prone than remembering in every helper.

**F8, F9, F10 — auth hardening**

- `userCreate`: only upsert on `supabase_id`. If no match, INSERT a new row. Never fall back to username match.
- `authByPin`: `ORDER BY (employee_id IS NOT NULL) DESC, id ASC LIMIT 1` as tiebreaker.
- `web.js auth.byPin`: use `.maybeSingle()`, order by `(auth_user_id IS NOT NULL) DESC` + limit 1.

**F11 — FirstTimeSetup fallback**

The `pin: '0000'` hardcoded fallback at line 579 fires only when the remote has zero staff. Change behavior: instead of creating a fake admin with `0000`, prompt the user to set a PIN before completing the wizard. A signup flow should never silently push PIN=0000 to Supabase.

**F12 — pushBusinessMeta merge**

Replace the full PATCH-replace with a call to the new `merge_business_settings` RPC:

```js
await rpc('merge_business_settings', { p_business_id: bizId, p_patch: updates.settings })
```

So multi-device writes stack cleanly.

**F14 — immediate push on mutation**

Already started in v1.9.39-40. Complete it across all 40+ handlers: every `save-*` / `*:create` / `*:update` IPC triggers `sync.syncNow()` before returning.

**F15 — pullBusinessMeta counterpart**

New function in sync.js that pulls `businesses.settings` + logo_url on every sync cycle. Wired into pullNow. Deep-merge into local SQLite settings column with same LWW semantics.

**F16 — UI feedback during first pull**

`LicenseContext.jsx`: add `firstPullDone` flag. `App.jsx`: if license valid but `firstPullDone=false`, render `<FirstPullSpinner />` showing "Sincronizando datos iniciales… (N/total tables)". Landing page flips to Login only when firstPullDone = true.

**F17 — cert auto-restore after wipe**

New IPC handler `dgii:restoreCertFromPEM`. On first launch after wipe, LicenseContext reads `bizSettings.ecf_private_key_pem` + `ecf_certificate_pem`, rebuilds a `.p12` using `node-forge`, writes to userData. Cert works without manual re-upload.

### Phase 3 — Verification (acceptance test matrix from Audit 5)

Pre-release gate — every one of these MUST pass on a fresh install against a production-shaped Supabase.

| Journey | PASS criterion | Today | v2.0 target |
|---------|----------------|-------|-------------|
| J1.3 First install — blocking pull completes | Spinner shows, completes <30s, counts visible | Blank screen | Spinner + table counters |
| J3.3 Wipe + reactivate — empleados restore | Empleados list shows 11 rows (same count as Supabase) | Empty | Matches Supabase |
| J3.4 Wipe + reactivate — cert restored | DGII screen shows cert installed = green | "No instalado" | Auto-restored from PEM |
| J3.6 Wipe + reactivate — PIN works first try | Real PIN from Supabase works, NOT 0000 | 0000 only | Real PIN |
| J4.2 Change PIN → restart → new PIN works | New PIN hash in SQLite after pull | Reverts to old | Persists |
| J5.2 Multi-device ciudad propagation | Device B sees Device A's ciudad edit within 1 sync cycle | Never | Propagates |
| J6.3 Salary raise survives restart | Wendy 20→25k survives restart, liquidation uses time-weighted | Reverts | Persists + correct calc |
| J7.1 Mi Empresa edits survive restart | Every bizSettings field survives | ciudad/logo/WhatsApp silently dropped | All keys persist |

If any row above fails on the v2 release candidate, we do not ship. Period.

### Phase 4 — Dedup today's mess

One-time data repair script run by me, before the v2 release, against Supabase:

- Deactivate duplicate staff rows (keep auth_user_id row or oldest).
- Deactivate duplicate empleados (keep row with ref_id or oldest).
- Deactivate duplicate categorias_servicio.
- Unescape stringified JSONB settings on all 10 businesses.
- Set all active staff PIN hashes to SHA256 of whatever you pick (tell me the digits).

Then on v2 first launch, the app pulls clean state and everything aligns.

---

## Release sequence

1. **Day 0** — Phase 1 migrations + Phase 1 API endpoint fixes → Vercel deploy. Runs on every existing client within a sync cycle.
2. **Day 0** — Phase 4 data repair script (my PATCHes against your business + the 9 demos).
3. **Day 1** — Phase 2 code changes → build v2.0.0 installer.
4. **Day 1** — acceptance test (Phase 3) on a test business (wipe a demo account, run through every journey, every PASS must pass).
5. **Day 1** — if acceptance passes, ship v2.0.0 to GH releases + web. Electron-updater pulls automatically.
6. **Done.** No more patch releases for sync. Future work is feature additions that layer on a stable foundation.

---

## What I'm asking you (Mike) to decide

1. **OK this plan?** Reply yes/no + any changes.
2. **Pick a permanent PIN** you want for your Michael user — I set it during data repair with a fresh `updated_at` so v2.0 launches and it survives forever.
3. **Acceptance window** — when do you want to run the Phase 3 acceptance tests? (I recommend after Phase 1 deploys so Supabase is already patched when we test.)

No code touched until you OK.
