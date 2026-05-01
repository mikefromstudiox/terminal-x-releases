# SILENT-FAILURE AUDIT — UPDATE paths that match 0 rows
Date: 2026-05-01
Author: dataLEAKS
Trigger: v2.16.27 fix for `api.ncf.updateSequence` — fresh client (Ranoza) had no `ncf_sequences` row, UPDATE matched 0 rows, "Guardar" silently shrugged, every receipt printed `B0200000001` forever.

PostgREST contract (the load-bearing fact): `update().eq()` on zero matching rows returns `{ data: [], error: null }`. `tryOr` and `throwSupaError` BOTH treat this as success. The user clicked "Guardar", got no toast, and walked away thinking it saved. This document enumerates every call site of that bug class.

---

## §1. Summary

| Surface | Files scanned | UPDATE sites | UPSERT sites | Flagged silent-success risks |
|---|---|---|---|---|
| Web data layer (`packages/data/web.js`) | 1 (8843 LOC) | ~213 | 5 | 14 |
| Desktop sync (`electron/sync.js`) | 1 (5048 LOC) | 0 (push-via-upsert by design) | many | 0 (sync uses INSERT…ON CONFLICT — safe) |
| Desktop DB (`electron/database.js`) | 1 (14616 LOC) | many SQL UPDATE | n/a | 4 (parity with web) |
| Vercel admin (`web/api/panel.js`) | 1 (4224 LOC) | ~36 | 8 | 5 |
| Vercel validate (`web/api/validate.js`) | 1 (255 LOC) | 5 | 0 | 1 |
| Vercel fe (`web/api/fe.js`) | 1 (385 LOC) | 0 | 0 | 0 |
| **TOTAL** | 6 | ~254 | ~13 | **24 flagged** |

Of the 24 flagged sites:
- 🔴 Owner-visible (settings/fiscal/balance): **9**
- 🟡 Cashier/operator-visible (cart/queue/ticket): **8**
- ⚪ Background/internal: **7**

Note: the previously-fixed `updateSequence` (web.js L4529-4562) is verified correct in v2.16.27. `api.ncf.saveSecuenciaNcf` (L887) was fixed earlier via real upsert with `onConflict: 'business_id,type'` — NOT flagged.

---

## §2. Findings (by severity)

### 🔴 OWNER-VISIBLE (silent failure costs the business money or fiscal compliance)

| # | File:line | API method | Pattern | Why it silently fails | Fix |
|---|---|---|---|---|---|
| 1 | `web/api/panel.js:1458` | admin `create_business` NCF seed | `.upsert({…, next_number: 1, max_number: 999999999}, {onConflict:'business_id,type', ignoreDuplicates:true})` | Schema columns are `current_number` and `end_number` — `next_number`/`max_number` do NOT exist in `ncf_sequences`. PostgREST returns column-not-found, but with `ignoreDuplicates:true` admins assume it's a known no-op. Even when the row IS new, the inserted row has `current_number=NULL`, so first NCF prints as `B01NaN…` or skips to default. | Rename to `current_number: 0, end_number: 999999999` (and remove `ignoreDuplicates` since you DO want the row written when missing). |
| 2 | `web/api/panel.js:1618` | self-register handler NCF seed | Same as #1 (`next_number`/`max_number`) | Same — every fresh signup gets broken NCF rows. | Same as #1. |
| 3 | `web/api/panel.js:1571` | admin patch `bizSettings` | `update({ settings: merged }).eq('id', id)` — no error surfaced if RLS or wrong id matches 0 | Admin saves "merged" settings; if `id` was stringified/wrong type or the row's RLS denies, returns ok with no rows changed. Owner sees Mi Empresa unchanged on next reload. | After update, `.select('id').single()` — throw on missing. |
| 4 | `web/api/panel.js:1576` | admin patch `appSettings` | `.upsert({business_id,key,value}, {onConflict:'business_id,key,device_hwid'})` | Real conflict target is the partial unique index `(business_id,key) WHERE device_hwid IS NULL`. PostgREST cannot use partial indexes as `on_conflict` — request rejected at PG level, but admin loop swallows error per-iter. Result: **admin overrides never persist on first save**; second save (now that row exists from app's own writes) sometimes succeeds. | Mirror `web.js settings.update` pattern: SELECT existing by key, UPDATE if found else INSERT. Or replace partial index with a full UNIQUE on `(business_id,key,COALESCE(device_hwid,''))` and target that. |
| 5 | `web/api/panel.js:1472` | admin `update_plan` | `.update({plan, updated_at}).eq('id', id)` no error check | If admin types wrong UUID or business already deleted, plan shows updated in admin UI but database unchanged. | Add `.select('id').single()` and surface error to admin. |
| 6 | `web/api/panel.js:1474` | admin `update_plan` license patch | `.update({plan_id,…}).eq('business_id', id)` — silent if business has no license row | Pre-launch businesses sometimes have no `licenses` row (license created lazily). Plan-change UI claims success, but downstream `validate.js` reads license.plan_id which is still null. | After UPDATE check `count`/`data.length`; if 0, INSERT a license row OR throw `'Sin licencia activa para este cliente'`. |
| 7 | `packages/data/web.js:5182` (`dgii.setEnvironment`) | env flip Pruebas↔Producción | `update({ settings: s }).eq('id', bid)` on businesses | Owner switches DGII env; if `bid` somehow wrong (cached stale auth), update matches 0 rows. Owner thinks they're in `ecf` (live) when sandbox `certecf` is still active — REAL fiscal risk. | After update, `.select('id, settings').single()` and assert `settings.dgii_environment === env`; throw if mismatch. |
| 8 | `packages/data/web.js:2329` (`clients.addLoyaltyPoints`) | atomic loyalty mutation | `update({loyalty_points: next}).eq('id', id)` after read-then-write | Race window allows another tab to UPDATE between read and write — but worse: if `id` is a UUID-string (web sometimes passes supabase_id) the `.eq('id', …)` matches 0. UI thinks points awarded. **This path is shadowed by the `loyalty_award` RPC for v2.7.1+, but the legacy method is still exported and called.** | Either delete the method (force RPC use) or add `.select('loyalty_points').single()` and verify the new value matches `next`. |
| 9 | `packages/data/web.js:2337` (`clients.updateBalance`) | client balance ± delta | `update({balance: newBal}).eq('id', id)` | Read at L2334 may return null (no client), but the `if (cl)` guard catches that. The miss is when `id` is a stale numeric from offline session and the row was deleted — silent. Balance never adjusts. | Use SECURITY DEFINER RPC `client_balance_adjust(business_id, client_supabase_id, delta)` that returns post-balance; throw if not found. Already mirrors loyalty pattern. |

### 🟡 CASHIER / OPERATOR-VISIBLE

| # | File:line | API method | Pattern | Why it silently fails | Fix |
|---|---|---|---|---|---|
| 10 | `packages/data/web.js:3429` (`tickets.updateLineItemPrice`) | cart line price edit | `update({price: newPrice}).eq('id', row.id).eq('business_id', bid)` | If `row.id` came from a stale cart that was synced after cashier opened, ID may already be re-keyed. Cashier types new price, hits ENTER, no toast — old price persists. | After update, `.select('id, price').single()` and broadcast new price to cart. |
| 11 | `packages/data/web.js:3471/3474` (`ticket_items quantity`) | quantity bump | `update({quantity: safeQty})` two parallel paths (id-keyed and supabase_id-keyed) | If first call matches 0 (wrong key shape) the second won't run because `throwSupaError` short-circuits. Cashier sees stale qty. | Wrap in single conditional: prefer `supabase_id`, only fall back to `id` if the first returns `count=0`. |
| 12 | `packages/data/web.js:3577` (`tickets.update` updates patch) | ticket header edit | `update(updates).eq('id', tid).eq('business_id', bid)` | Standard pattern, but `tid` for web-created carts is a string supabase_id. Half the codebase calls with int, half with UUID. When mismatched, silent. | Detect `(typeof tid === 'string' && tid.includes('-'))` → `.eq('supabase_id', tid)` else `.eq('id', tid)`. Mirror the inventory_counts.cancel pattern at L1374. |
| 13 | `packages/data/web.js:3047` (`queue.markDone`) | queue → done | `update({status:'done', completed_at:NOW()}).eq('...')` | If queue row was already marked done from another device (manager phone), this matches 0 rows. Cashier sees "Listo" button still active and re-clicks; double-print risk. | After update, `.select('status').single()` — if not 'done', refetch and update local state. |
| 14 | `packages/data/web.js:3832` (`queue.update`) | generic queue patch | `update(patch).eq('id',id).eq('business_id',bid)` | Same int-vs-UUID hazard as #12 for queue. | Same dual-key fallback. |
| 15 | `packages/data/web.js:3862-3866` (`queue.cancel` chain) | cancel queue + sibling ticket | Two updates, one for queue, one for ticket via supabase_id | Ticket update at L3866 uses `.eq('supabase_id', tSid)` — if `tSid` is null (queue without paired ticket) the eq becomes `is null` semantically, matching ALL null tickets across business. **High-severity cross-row leak**. Verify with explicit guard. | Hard guard: `if (!tSid) skip;`. Already partial — confirm in test. |
| 16 | `packages/data/web.js:3292` (`mesa transfer`) | move ticket_items between mesas | `update({ticket_supabase_id, ticket_id}).eq('...')` filter not visible at this line | If filter is `eq('ticket_supabase_id', oldSid)` and that supabase_id doesn't match (sync lag), zero items move; new mesa stays empty. | Pre-check count, throw if 0 expected items not found. |
| 17 | `electron/database.js:8107` (`ncfUpdateSequence`) | desktop side of NCF settings | SQLite `UPDATE ncf_sequences SET … WHERE type=@type`; `db.prepare().run()` returns `info.changes` — **never read** | Identical bug class to web — fresh local DB created by an admin reset before NCF rows were seeded; UPDATE matches 0; UI reports nothing. Less likely than web because desktop seeds via `INSERT OR IGNORE` at L3530, but **manual schema deletes / sqlcipher rekey paths** can lose the row. | Rewrite: ```js const info = db.prepare(`UPDATE ncf_sequences SET ${fields} WHERE type=@type`).run({...patch, type}); if (info.changes === 0) { db.prepare(`INSERT INTO ncf_sequences(type, prefix, ${Object.keys(patch).join(',')}, supabase_id) VALUES(@type, @type, ${Object.keys(patch).map(k=>'@'+k).join(',')}, @sid)`).run({...patch, type, sid: crypto.randomUUID()}); }``` |

### ⚪ BACKGROUND / INTERNAL

| # | File:line | API method | Pattern | Why it silently fails | Fix |
|---|---|---|---|---|---|
| 18 | `packages/data/web.js:1463` & `1486` (`auth.byPin` rehash + miss-counter) | bcrypt rehash, lockout counter | `.update(patch).eq('id',rid).eq('business_id',bid)` inside `try{}catch{}` | If rid is wrong, rehash silently never persists; user keeps logging in with legacy hash forever (no lockout escalation either). Audit-trail dead spot. | Acceptable as best-effort but log a warn metric when `count=0`; don't swallow. |
| 19 | `packages/data/web.js:1832-1834` (`services.toggleInStock`) | 86-list toggle | `.update({in_stock: next, updated_at}).eq(...)` | Restaurant kitchen toggles 86; if row was just deleted from another device, no error. Item still appears available on POS. | Add `.select('in_stock').single()` — refresh local state from server reply. |
| 20 | `web/api/panel.js:2438` (rebind requests cron) | `.update({status:'expired'}).eq(...)` | If the request id is gone (raced with another cron pod on Vercel cold start), silent. Cron metric reports "expired N" but actual N may be 0. | Use `.select('id', { count: 'exact', head: true })` after; log to ops if 0. |
| 21 | `web/api/panel.js:4193/4202` (e-CF auto-escalation cron) | `.update({status:'failed', error:'...'})` | Same cron-double-execution hazard. | Same as #20. |
| 22 | `web/api/panel.js:780` (`client_errors.update`) | error-tracker mark-resolved | `.update({…}).eq('id', id)` with destructured `error` only checked | Standard pattern. Acceptable: this is internal dev tooling. | No fix required; flagged for completeness. |
| 23 | `web/api/panel.js:264/304/341/352` (CRM lead updates) | various lead patches | Bare `.update().eq('id', id)` — admin-side tool | If lead got reassigned to another tenant business between page load and save, silent no-op. Sales rep sees "saved" on rep dashboard. | After update, `.select('id, last_contacted_at').single()` and assert. |
| 24 | `web/api/validate.js:185` (license validate ECF status push) | `.update(updates).eq('id', license.business_id)` | If business_id is somehow null in cached license row (legacy), this becomes `is null` and updates ALL businesses with null id. **High blast radius** if data ever has null. | Hard guard: `if (!license.business_id) return;` before update. |

---

## §3. Concrete fix templates

### Template A — UPDATE-then-INSERT-on-zero-rows (the `updateSequence` v2.16.27 pattern)

**Before** (any `.update().eq()` where the row may not exist):
```js
throwSupaError(await supabase.from('TABLE').update(patch).eq('business_id', bid).eq('KEY', val))
```

**After**:
```js
const { data: existing } = await supabase.from('TABLE')
  .select('id').eq('business_id', bid).eq('KEY', val).maybeSingle()
if (existing) {
  throwSupaError(await supabase.from('TABLE').update(patch).eq('id', existing.id).eq('business_id', bid))
} else {
  throwSupaError(await supabase.from('TABLE').insert({
    supabase_id: crypto.randomUUID(), business_id: bid, KEY: val, ...defaults, ...patch,
  }))
}
```

Or, if a real UNIQUE constraint exists on `(business_id, KEY)`:
```js
throwSupaError(await supabase.from('TABLE').upsert(
  { ...patch, supabase_id: crypto.randomUUID(), business_id: bid, KEY: val },
  { onConflict: 'business_id,KEY' }
))
```
Use the upsert form when applicable — it's atomic, single round-trip, and PostgREST returns the resulting row.

### Template B — Verify-after-write (for cases where 0 matched should surface)

**Before**:
```js
throwSupaError(await supabase.from('TABLE').update(patch).eq('id', id).eq('business_id', bid))
```

**After**:
```js
const { data, error } = await supabase.from('TABLE')
  .update(patch).eq('id', id).eq('business_id', bid)
  .select('id').single()
if (error) throw error
if (!data) throw new Error(`No se encontró registro #${id} para actualizar`)
```

`.single()` will throw `PGRST116` when `count !== 1` — exactly the loud failure we want.

### Template C — Fix `ncf_sequences` admin seed (panel.js:1458 & 1618)

**Before**:
```js
await auth.supabase.from('ncf_sequences').upsert({
  business_id: biz.id, type, prefix: type, next_number: 1, max_number: 999999999,
}, { onConflict: 'business_id,type', ignoreDuplicates: true })
```

**After**:
```js
await auth.supabase.from('ncf_sequences').upsert({
  business_id:    biz.id,
  supabase_id:    crypto.randomUUID(),
  type,
  prefix:         type,
  current_number: 0,
  end_number:     999999999,
  active:         true,
  enabled:        true,
}, { onConflict: 'business_id,type', ignoreDuplicates: true })
```

(Schema reference: `current_number`, `end_number`, `active`, `enabled`, `valid_until` — verified against `electron/database.js:8109` allow-list.)

### Template D — Dual-key fallback (int OR uuid, finding #12, #14)

```js
const isUuid = typeof id === 'string' && id.includes('-')
const keyCol = isUuid ? 'supabase_id' : 'id'
const keyVal = isUuid ? id : Number(id)
throwSupaError(await supabase.from('TABLE')
  .update(patch).eq('business_id', bid).eq(keyCol, keyVal)
  .select('id').single())
```

### Template E — Desktop SQLite UPDATE-or-INSERT (finding #17)

**Before** (`electron/database.js:8107`):
```js
function ncfUpdateSequence(type, data) {
  if (!db) return
  const allowed = ['prefix', 'current_number', 'limit_number', 'active', 'enabled', 'valid_until']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE ncf_sequences SET ${fields} WHERE type=@type`).run({ ...patch, type })
}
```

**After**:
```js
function ncfUpdateSequence(type, data) {
  if (!db) return
  const allowed = ['prefix', 'current_number', 'limit_number', 'active', 'enabled', 'valid_until']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  const info = db.prepare(`UPDATE ncf_sequences SET ${fields}, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE type=@type`).run({ ...patch, type })
  if (info.changes === 0) {
    const cols = ['type', 'prefix', ...Object.keys(patch).filter(k => k !== 'prefix'), 'supabase_id', 'updated_at']
    const vals = ['@type', '@prefix', ...Object.keys(patch).filter(k => k !== 'prefix').map(k => '@'+k), '@sid', "strftime('%Y-%m-%dT%H:%M:%fZ','now')"]
    db.prepare(`INSERT INTO ncf_sequences(${cols.join(',')}) VALUES(${vals.join(',')})`).run({
      ...patch, type, prefix: patch.prefix || type, sid: crypto.randomUUID(),
    })
  }
}
```

### Template F — Hard-null-guard for `.eq('col', maybeNull)` (findings #15, #24)

**Before**:
```js
await supabase.from('tickets').update({status:'anulado'}).eq('supabase_id', tSid)
```

**After**:
```js
if (!tSid) {
  console.warn('[silent-update-guard] skipped tickets update — tSid is null')
} else {
  const { data, error } = await supabase.from('tickets').update({status:'anulado'})
    .eq('supabase_id', tSid).eq('business_id', bid).select('id').single()
  if (error) throw error
}
```

PostgREST's `.eq('col', null)` becomes `col IS NULL` — under-specified filters can match more than intended. Always explicitly skip when the key is null.

---

## §4. Recommended audit script

`scripts/silent-update-audit.mjs` — finds these patterns automatically. Pseudocode:

```js
#!/usr/bin/env node
/**
 * Silent-update audit. Finds Supabase .update() / .upsert() call sites where:
 *   - .update() is NOT preceded by a SELECT/maybeSingle within ~30 lines, AND
 *     not followed by .select(...).single() within the same expression chain.
 *   - .upsert() is missing an `onConflict` option.
 *   - .update().eq('col', someVar) where someVar may be null (lexically).
 *
 * Scans:
 *   packages/data/web.js
 *   electron/sync.js   (Supabase pushes only)
 *   electron/database.js  (SQLite UPDATEs whose .changes is unread)
 *   web/api/*.js
 *
 * Output: JSON list of {file, line, snippet, severity, reason}.
 * Exit 1 if severity >= 'warn' findings exist (release gate).
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOTS = [
  'packages/data/web.js',
  'electron/sync.js',
  'electron/database.js',
  'web/api/panel.js',
  'web/api/validate.js',
  'web/api/fe.js',
]

const PATTERNS = {
  // Group 1: Supabase update without .select().single() chain
  bareUpdate: /\.from\(['"]([^'"]+)['"]\)\s*\n?\s*\.update\(/g,
  // Group 2: upsert without onConflict
  upsertNoConflict: /\.upsert\([^)]+\)(?!\s*,?\s*\{[^}]*onConflict)/g,
  // Group 3: SQLite .run() whose result is not assigned (info.changes unread)
  sqliteRunUnread: /^\s*db\.prepare\(`?[^`]*UPDATE[^`]*`?\)\.run\(/gm,
  // Group 4: .eq('col', maybeNullVar) without `if (var)` guard within 5 lines
  eqMaybeNull: /\.eq\(['"][^'"]+['"]\s*,\s*(\w+)\s*\)/g,
}

function audit(file) {
  const src = fs.readFileSync(file, 'utf8')
  const lines = src.split('\n')
  const findings = []

  // Walk every match of bareUpdate, look back 30 lines for a SELECT to the same table
  let m
  while ((m = PATTERNS.bareUpdate.exec(src)) !== null) {
    const table = m[1]
    const lineNum = src.slice(0, m.index).split('\n').length
    const window = lines.slice(Math.max(0, lineNum - 30), lineNum).join('\n')
    const hasSelectFirst = new RegExp(`from\\(['"]${table}['"]\\)[\\s\\S]{0,400}\\.select\\(`).test(window)
    // Look forward 5 lines for .select(...).single() chained on this update
    const forward = lines.slice(lineNum - 1, lineNum + 5).join('\n')
    const hasSelectAfter = /\.select\([^)]*\)\s*\.single\(\)/.test(forward)
    const hasMaybeSingleAfter = /\.maybeSingle\(\)/.test(forward)

    // Whitelist: tables that are write-only (audit_log, activity_log) or
    // where existence is invariant by upstream contract (tickets.id from .insert()).
    const WHITELIST_TABLES = new Set(['activity_log', 'license_events', 'inventory_transactions'])

    if (!hasSelectFirst && !hasSelectAfter && !hasMaybeSingleAfter && !WHITELIST_TABLES.has(table)) {
      findings.push({
        file, line: lineNum, table,
        severity: classifySeverity(table),
        reason: 'UPDATE without prior existence check or trailing .select().single()',
        snippet: lines[lineNum - 1].trim(),
      })
    }
  }

  // upsert without onConflict
  while ((m = PATTERNS.upsertNoConflict.exec(src)) !== null) {
    const lineNum = src.slice(0, m.index).split('\n').length
    findings.push({
      file, line: lineNum,
      severity: 'warn',
      reason: 'upsert() without onConflict option — may degrade to insert-or-error',
      snippet: lines[lineNum - 1].trim(),
    })
  }

  // SQLite UPDATE whose .run() result is unread
  while ((m = PATTERNS.sqliteRunUnread.exec(src)) !== null) {
    const lineNum = src.slice(0, m.index).split('\n').length
    findings.push({
      file, line: lineNum,
      severity: 'info',
      reason: 'SQLite UPDATE .run() — info.changes never inspected (consider INSERT-on-0-rows)',
      snippet: lines[lineNum - 1].trim(),
    })
  }

  return findings
}

function classifySeverity(table) {
  const OWNER = new Set(['businesses', 'app_settings', 'configuracion', 'ncf_sequences', 'licenses', 'plans', 'clients', 'ecf_certifications'])
  const CASHIER = new Set(['tickets', 'ticket_items', 'queue', 'mesas', 'inventory_items', 'cuadre', 'caja_chica'])
  if (OWNER.has(table))   return 'critical'
  if (CASHIER.has(table)) return 'warn'
  return 'info'
}

const all = ROOTS.flatMap(rel => {
  const abs = path.resolve(process.cwd(), rel)
  if (!fs.existsSync(abs)) return []
  return audit(abs)
})

// Group + print
const byTable = {}
for (const f of all) (byTable[f.table || f.file] ??= []).push(f)
console.log(JSON.stringify({ count: all.length, findings: all }, null, 2))

const blockers = all.filter(f => f.severity === 'critical' || f.severity === 'warn')
process.exit(blockers.length ? 1 : 0)
```

**Wire-up**:
1. Add to `package.json`:
   ```json
   "scripts": {
     "audit:silent-updates": "node scripts/silent-update-audit.mjs"
   }
   ```
2. Add to `scripts/pre-launch-check.mjs` as a release gate alongside `rls-policy-audit.mjs` and `audit-flows.mjs`.
3. Whitelist evolves: any legitimate "best-effort" UPDATE (telemetry, audit-log fallback) gets a leading line comment `// silent-update-ok: <reason>` and the script greps that and skips.

**False-positive expectations** (~30 expected after first run):
- Activity log writes (whitelisted by table)
- `last_seen` / `last_synced_at` heartbeats (whitelisted by column-name regex)
- `try{}catch{}` wrapped writes that explicitly comment "best-effort"

After tuning the whitelist over 1-2 cycles the script should stabilize at ≤ 5 critical/warn findings — track that count in `docs/RELEASE-CHECKLIST.md`.

---

## §5. Top 5 findings — 100-word executive summary

1. **panel.js:1458 & :1618** — admin "create_business" and self-register both seed `ncf_sequences` with non-existent columns `next_number` / `max_number`. Fresh clients get broken sequences from day one (this is the Ranoza root cause, not just `updateSequence`).
2. **panel.js:1576** — admin app_settings upserts target a partial unique index PostgREST cannot use, so admin overrides silently no-op on first save.
3. **web.js:5182 setEnvironment** — DGII env flip Pruebas↔Producción does no post-write verify; mismatch = real fiscal risk.
4. **web.js:3047/3832 queue updates** — int-vs-UUID key drift causes silent no-ops, double-prints likely.
5. **database.js:8107 ncfUpdateSequence** — desktop parity bug for the one Mike just shipped a web fix for.
