# AUDIT-03 — Business Settings Roundtrip

**Scope:** `businesses.settings`, `app_settings`, logo, WhatsApp, ciudad, fiscal, e-CF cert keys — desktop ↔ Supabase.
**Date:** 2026-04-16
**Auditor:** dataLEAKS
**Status:** 3 critical defects, 5 high, 4 medium. All actionable.

---

## Executive Summary

Today's incident (owner wiped local data, re-activated license, lost ciudad / logo / WhatsApp) is the visible tip of a deeper integrity flaw: **`businesses.settings` does NOT have a single canonical shape contract across writers**. The Supabase column is `jsonb` (confirmed via `information_schema`), and the happy path stores an object — BUT multiple writers (the demo seeder, and historically the admin panel) have stored a JSON **string** inside the JSONB column, yielding rows where `jsonb_typeof(settings) = 'string'`. Every consumer that does `{ ...(biz.settings || {}) }` on such a row corrupts the column irrecoverably by spreading the string's character indices as keys.

The current fixes (v1.9.38) are correct at three of the seven layers but INCOMPLETE. Two server-side write paths still spread raw `biz.settings`, four desktop screens still assume `JSON.parse` works (will throw on web when Supabase returns an object), and no one normalises on read. There is also a latent race between two devices pushing to the same row that silently clobbers keys from the other device.

This document inventories every key, every writer, every consumer, and prescribes the exact shape contract that closes the loop.

---

## 1. `businesses.settings` Column Type — CONFIRMED JSONB

### Evidence

```sql
-- information_schema
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'businesses';
```

Result: `settings | jsonb | NOT NULL`

The production row (Studio X Auto Detailing `1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79`) has `jsonb_typeof(settings) = 'object'`:

```json
{"biz_city":"Santo Domingo","biz_type":""}
```

However, the 9 demo rows seeded by `tmp/seed-demo-businesses.mjs` have `jsonb_typeof(settings) = 'string'`:

```
preview: "{\"itbis_pct\":18,\"ley_pct\":10,...}"
```

This is a **valid JSONB string value**, not an object. PostgreSQL accepted it because JSONB allows any JSON root type (object, array, string, number, bool, null).

### Root cause of today's incident

The original symptom `"settings":"{\"biz_city\":...}"` the user observed was NOT the production row — it was likely a demo row or a row written by the admin panel at `web/api/panel.js` if the admin ever PATCHed a business whose settings was already a string (see §3). The owner's own production row is currently `object`, which is correct.

But the DEFECT is architectural: nothing enforces the column shape. The next seeder run, the next admin PATCH on a freshly-seeded demo, or any user operation on a "poisoned" row rewrites the column to a corrupted object like `{"0":"{","1":"\"","2":"i",…}` (see §3 reproduction).

### Recommendation — three-layer defense

1. **CHECK constraint** on the column so PostgreSQL rejects non-object writes at the DB level:
   ```sql
   ALTER TABLE businesses
     ADD CONSTRAINT businesses_settings_is_object
     CHECK (jsonb_typeof(settings) = 'object');
   ```
   This will reject any future string/array/null write with a hard error instead of silently corrupting.

2. **Heal existing bad rows** (all 9 demo rows + any production row that ever got poisoned):
   ```sql
   UPDATE businesses
     SET settings = settings #>> '{}'::text[]::jsonb
     WHERE jsonb_typeof(settings) = 'string';
   -- Actually simpler:
   UPDATE businesses
     SET settings = (settings #>> '{}')::jsonb
     WHERE jsonb_typeof(settings) = 'string';
   ```
   (`#>> '{}'` extracts the string value, then `::jsonb` re-parses it as an object.)

3. **Fix the seeder** `tmp/seed-demo-businesses.mjs:357` — remove `JSON.stringify`:
   ```js
   // BEFORE
   settings: JSON.stringify(settingsObj),
   // AFTER
   settings: settingsObj,
   ```
   The Supabase client auto-serialises objects to JSONB. Passing a string forces it to store as a JSON string value.

Apply order: fix seeder first → heal rows → add CHECK. If the CHECK goes first, healing cannot run because the UPDATE temporarily produces a valid object state.

---

## 2. `web/api/validate.js` — bizSettings construction

### Current state (lines 100-133)

Line 127-132 correctly normalises on READ:

```js
let bizSettingsJson = biz.settings
if (typeof bizSettingsJson === 'string') {
  try { bizSettingsJson = JSON.parse(bizSettingsJson) } catch { bizSettingsJson = {} }
}
const bizSettings = { name: ..., ...(bizSettingsJson || {}) }
```

This fix is **correct and complete** for the READ path.

### BUG: line 114 WRITES through the raw string

```js
// Line 113-117
if (bizSync.ecf_cert_installed !== undefined) {
  const existingSettings = license.businesses?.settings || {}   // ← NOT normalised
  const ecfStatus = { ecf_cert_installed: ..., ... }
  await supabase.from('businesses').update({
    settings: { ...existingSettings, ...ecfStatus },            // ← spread-string corruption
    updated_at: new Date().toISOString()
  }).eq('id', license.business_id)
}
```

If `license.businesses.settings` is a string (any poisoned row), `{ ...existingSettings }` spreads character indices — the row's settings column gets permanently rewritten as `{"0":"{", "1":"\"", ..., "ecf_cert_installed": true, ...}`.

**Severity: CRITICAL.** This fires on EVERY license re-validation when cert info is available (every 4h). A single validate-against-a-poisoned-row destroys the column forever.

### Fix

```js
if (bizSync.ecf_cert_installed !== undefined) {
  let existingSettings = license.businesses?.settings || {}
  if (typeof existingSettings === 'string') {
    try { existingSettings = JSON.parse(existingSettings) } catch { existingSettings = {} }
  }
  if (!existingSettings || typeof existingSettings !== 'object' || Array.isArray(existingSettings)) {
    existingSettings = {}
  }
  const ecfStatus = { /* as before */ }
  await supabase.from('businesses').update({
    settings: { ...existingSettings, ...ecfStatus },
    updated_at: new Date().toISOString()
  }).eq('id', license.business_id)
}
```

Apply the same `typeof === 'string' → JSON.parse → object-guard` sequence everywhere `biz.settings` is spread.

### Other callers that consume `businesses.settings` — FULL INVENTORY

| File | Line | Action | Safe? |
|------|------|--------|-------|
| `web/api/validate.js` | 114 | spread + write | **NO — fix required** |
| `web/api/validate.js` | 129-132 | read + normalise | YES |
| `web/api/panel.js` | 331 | return raw to admin UI | PARTIAL — UI does `biz?.settings || {}`, will show `{}` when string — silent data loss |
| `web/api/panel.js` | 342 | spread + write (`bizSettings` merge) | **NO — fix required** |
| `web/api/panel.js` | 428 | read `biz.settings?.facturacion_mode` | PARTIAL — returns `undefined` when string, flag flips to `false` |
| `web/api/panel.js` | 862 | spread + write (feature_toggle) | **NO — fix required** |
| `web/api/panel.js` | 1086, 1107 | spread + write (visits) | **NO — fix required (2 sites)** |
| `web/api/ecf-sign.js` | 53, 76-78 | read `biz.settings?.ecf_*` | PARTIAL — returns "not installed" when string, breaks web e-CF signing |
| `supabase/functions/whatsapp-send/index.ts` | 87-89 | normalises string → object | YES |
| `supabase/functions/ef2-proxy/index.ts` | 78-80 | normalises string → object | YES |
| `packages/data/web.js` | 166 | returns `data.settings` as-is to renderer | NO — passes object to `MiEmpresa` which does `JSON.parse(row.settings || '{}')` — THROWS `Unexpected token o in JSON` |
| `packages/data/web.js` | 2352-2353 | spread `data?.settings || {}` — but only READ | PARTIAL — same string-index corruption in the returned object |
| `packages/ui/screens/Admin.jsx` | 1215, 1248 | `JSON.parse(row.settings)` | NO on web — object reaches this code, `JSON.parse({})` stringifies to `"[object Object]"` then throws |
| `packages/ui/screens/Settings.jsx` | 261, 283, 592, 660 | `JSON.parse(biz.settings)` | NO on web (same) |
| `packages/ui/screens/FirstTimeSetup.jsx` | 547 | `business.settings \|\| {}` — no parse | PARTIAL — assumes object, breaks when string |
| `packages/ui/screens/FirstTimeSetup.jsx` | 1362 | `JSON.parse(biz.settings)` | NO on web |
| `packages/ui/screens/CreditNotes.jsx` | 312 | `JSON.parse(biz.settings)` | NO on web |
| `packages/services/printer.js` | 202 | normalises with try/catch | YES — best-in-class pattern, copy this |
| `packages/ui/admin/pages/ClientDetail.jsx` | 382 | `biz.settings \|\| {}` — no parse | PARTIAL |

### Recommended helper — add to `packages/services/settings.js`

```js
// Single canonical parse used by every caller.
export function parseBizSettings(raw) {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch { return {} }
  }
  return {}
}
```

Replace every `JSON.parse(biz.settings || '{}')` and every `biz.settings || {}` with `parseBizSettings(biz.settings)`.

---

## 3. `electron/database.js:empresaSave` allowed-list

### Current state (lines 1247-1283)

```js
const allowed = ['name', 'rnc', 'address', 'phone', 'email', 'logo', 'settings', 'plan']
const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
```

**`email` IS in the allowed list**. Good.
**`settings` IS in the allowed list**. Good.
**`plan` IS in the allowed list**. Good.

### LicenseContext fix (v1.9.38, lines 161-188) — VERIFIED CORRECT

The fix correctly:
1. Destructures top-level columns (`name, rnc, phone, address, email, logo, plan`) out of `res.bizSettings`.
2. Re-wraps the `...extra` remainder into `settings: JSON.stringify(extra)`.
3. Calls `saveEmpresa(payload)`.

With `empresaSave`'s allowed-list filter, the only fields that survive are the 8 listed. Everything inside `extra` (biz_city, ciudad, biz_type, whatsapp_*, ecf_*, etc.) is serialised into the `settings` TEXT column correctly.

### Round-trip verification (end-to-end)

**Step (a) — Desktop Mi Empresa form save to SQLite** (Admin.jsx:1251-1258):
- `settings: JSON.stringify(mergedSettings)` where `mergedSettings = { ...existing, biz_city, ciudad, biz_type }`.
- `existing` read via `api.admin.getEmpresa()` which on desktop returns SQLite row with `settings TEXT`. UI line 1248 does `JSON.parse(current.settings)` — works because SQLite always stores string.
- **PASSES** — settings TEXT in SQLite now contains all keys.

**Step (b) — Sync push to Supabase** (`electron/sync.js:pushBusinessMeta`, 1547-1549):
- Reads `emp.settings` from SQLite (string).
- `updates.settings = typeof emp.settings === 'string' ? JSON.parse(emp.settings) : emp.settings`.
- PATCH `/rest/v1/businesses?id=eq.{bizId}` with JSON body — Supabase client (here raw https) sends JSON; Supabase receives object → stores as JSONB object.
- **PASSES** — Supabase row now has JSONB object.

**Step (c) — Validate.js returns it** (web/api/validate.js:129-133):
- Reads `biz.settings` from JSON (driver returns native object for JSONB).
- Normalises string → object (defensive).
- Spreads into `bizSettings = { name, rnc, ..., ...(bizSettingsJson || {}) }`.
- **PASSES** for object rows. For a poisoned string row, the READ is safe; the WRITE in §2 is unsafe.

**Step (d) — Desktop saves it back** (LicenseContext.jsx:161-186):
- Destructures top-level fields out.
- `settings: JSON.stringify(extra)` → `empresaSave` accepts it → writes TEXT to SQLite.
- **PASSES**.

### Round-trip holes

1. **Race condition — last-writer-wins on whole column.** `pushBusinessMeta` reads local settings, sends full object. If web and desktop both edit the same row within the same sync cycle, the later writer overwrites the earlier writer's edits. No merge happens on the server side. See §4.

2. **Desktop never pushes `ecf_cert_installed` etc. via `pushBusinessMeta`.** Those are set by `validate.js` (via the bizSync path). Then `validate.js` returns them in `bizSettings`. Then LicenseContext writes them BACK into SQLite via `settings: JSON.stringify(extra)`. Then the next sync tick pushes them BACK to Supabase. This is a harmless cycle but creates a 4-hour delay to reflect a cert change and slightly increases write load. Not urgent.

3. **Key dropout after round-trip.** When LicenseContext destructures `logo, plan` out of `res.bizSettings`, it correctly separates top-level from extra. But `validate.js` line 133 includes `logo: biz.logo_url, plan: license.plans?.name` in `bizSettings`. `plan` is a top-level column on SQLite businesses too, and `empresaSave` accepts it — so on round-trip, `plan` gets written to the `plan` column, not into settings. Good. But note: LicenseContext currently ALSO writes `plan` to the SQLite column via `empresaSave`. This is intentional per the code comment, but worth flagging: on web mode, the `plan` column on Supabase is authoritative (source of truth), while on desktop the SQLite copy is read-only (populated from remote). Keep this invariant.

---

## 4. `electron/sync.js:pushBusinessMeta` — merge strategy

### Current state (full-replace)

```js
if (emp.settings) {
  try { updates.settings = typeof emp.settings === 'string' ? JSON.parse(emp.settings) : emp.settings } catch {}
}
// ...
// PATCH /rest/v1/businesses SET settings = <full object>
```

This is **full-replace**, not merge. If device A has cert-installed keys that device B does not have, and device B syncs first, device A's keys get clobbered.

### Evidence of risk

`validate.js` line 113-116 writes cert keys (`ecf_private_key_pem`, `ecf_certificate_pem`, etc.) directly to Supabase. These keys are NOT in the desktop's SQLite settings unless LicenseContext already wrote them there after a prior validate. On the FIRST validate after a wipe:
1. Desktop's SQLite settings = `{biz_city, biz_type, whatsapp_*, ...}` (no cert keys yet).
2. `pushBusinessMeta` runs → pushes desktop settings object → OVERWRITES Supabase, stripping any cert keys that another device already pushed.
3. validate.js sees `ecf_cert_installed !== undefined` and re-writes cert status back.
4. The next desktop pull brings cert keys back into SQLite.
5. Steady state reached, but there was a window where web e-CF signing failed because private key was gone.

The current code happens to fire `pushBusinessMeta` in `runSyncCycle()` BEFORE `validate.js` is called next time, so the window can last up to 4 hours.

### Recommendation — JSONB deep-merge via `||` operator

PostgreSQL has a native JSONB merge operator `||`. Instead of client-side full-replace, use a Supabase RPC or an `UPDATE ... SET settings = settings || $1::jsonb` expression.

Option A — dedicated RPC:

```sql
CREATE OR REPLACE FUNCTION merge_business_settings(bid uuid, patch jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE businesses
    SET settings = settings || patch,
        updated_at = now()
    WHERE id = bid;
$$;
```

Called from sync.js:
```js
await fetch(`${_url}/rest/v1/rpc/merge_business_settings`, {
  method: 'POST',
  headers: { /* auth */, 'Content-Type': 'application/json' },
  body: JSON.stringify({ bid: bizId, patch: settingsObj }),
})
```

Option B — keep PATCH, but select first and re-merge client-side (2 round-trips, more race-prone). Do NOT recommend.

Option C — scope each writer to only its own keys:
- `pushBusinessMeta` writes ONLY `biz_city, ciudad, biz_type, facturacion_mode, language, ...` (user-editable keys).
- `validate.js` writes ONLY `ecf_*` (device-sourced keys).
- `panel.js` writes ONLY admin-set keys.
- Deep-merge on server side via `||`.

**Recommended: Option A + Option C.** Define a canonical key-namespace per writer so they never collide, enforced by the RPC (which still does full merge, but writers only pass their own subset).

### LWW strategy for JSONB columns

- Current: full-replace, `updated_at` auto-set by trigger. Timestamp tells you who wrote last but not what was clobbered.
- Recommended: field-level merge via `||`. This is additive — new keys win, old keys preserved. Conflicts (same key on both sides) are LWW at the FIELD level.
- For fields that MUST be LWW at the field level with timestamp tracking (e.g., `ecf_status_updated_at`), include a companion `_updated_at` sibling key and compare in the RPC:
  ```sql
  -- conditional merge only if incoming is newer
  SET settings = CASE
    WHEN (patch->>'ecf_status_updated_at')::timestamptz
         > COALESCE((settings->>'ecf_status_updated_at')::timestamptz, 'epoch')
    THEN settings || patch
    ELSE settings || (patch - 'ecf_status_updated_at' - 'ecf_cert_installed' - ...)
  END
  ```
  Over-engineered for current traffic — stick with Option A + C unless multi-device cert collisions become real.

---

## 5. Logo Storage + Roundtrip

### Path
- **SQLite** `businesses.logo BLOB` — raw image bytes (healed by v1.9.18 migration; legacy data-URL string bytes decoded in place).
- **Supabase** `businesses.logo_url TEXT` — public CDN URL, `{SUPABASE_URL}/storage/v1/object/public/business-logos/{bizId}/logo.{ext}?v={ts}`.
- **Storage bucket** `business-logos` — public, 2 MB limit, `image/png|jpeg|webp|gif` allowed.

### pushBusinessMeta flow (lines 1500-1545)

1. Reads `emp.logo` from SQLite (Buffer).
2. SHA-256 hashes it.
3. Compares against `app_settings.logo_synced_hash`. If changed:
4. Detects MIME from magic bytes, uploads to Storage, writes new URL to `app_settings.logo_synced_url`.
5. Sets `updates.logo_url = logoUrl`.
6. PATCHes businesses with `logo_url`.

Idempotent + offline-safe + cache-busted with `?v={ts}`. Solid.

### LicenseContext fetch-back (v1.9.38 lines 168-185)

```js
if (logo) {
  if (window.electronAPI && typeof logo === 'string' && logo.startsWith('http')) {
    const resp = await fetch(logo, { mode: 'cors' })
    if (resp.ok) {
      const blob = await resp.blob()
      const b64 = await new Promise((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result)
        r.readAsDataURL(blob)
      })
      payload.logo = b64
    }
  } else { payload.logo = logo }
}
```

### Issues

1. **CORS** — bucket is public, but the response must include `Access-Control-Allow-Origin` header for the renderer to read the blob. Supabase Storage sends `ACAO: *` on public bucket GETs by default. **Confirmed working.** For a signed URL on a private bucket, CORS would fail — not applicable here since bucket is public.

2. **Auth-protected buckets** — N/A (bucket is public).

3. **Size limit** — bucket allows 2 MB; desktop Mi Empresa form limits local upload to 500 KB; FirstTimeSetup allows 2 MB. Desktop limit is tighter, safe.

4. **Offline** — `fetch(logo, { mode: 'cors' })` will throw on offline. The `try/catch` (line 181) warns and continues without setting `payload.logo`. `empresaSave` then does NOT include `logo` in the patch (destructuring gives `undefined`), and **`empresaSave` deletes patch.logo when it's an unknown shape** (line 1270-1273). Wait — actually the flow is:
   - `logo` starts as the URL string.
   - Fetch fails → `payload.logo` never assigned.
   - But above the fetch (line 163), `const { ..., logo, ... } = res.bizSettings` pulls `logo` OUT of the destructure. Then `payload = { name, rnc, phone, address, email, plan, settings: ... }` is built WITHOUT logo. Then `if (logo) { ... fetch or fallback }`. If fetch fails, the `else` branch at line 183 does `payload.logo = logo` (the URL).
   - So `empresaSave` receives `logo = 'https://...'` — a string that doesn't start with `data:image/`.
   - At database.js:1270-1272, this falls into the "unknown shape" branch: `delete patch.logo`. Good — the existing local logo is NOT clobbered by the URL.
   - **But — subtle — if the desktop has NO local logo (fresh install, offline, server has logo), the user gets no logo until they go back online.** This is acceptable graceful degradation.

5. **Race condition — multiple devices, logo hash mismatch.** Device A uploads logo X, hash stored locally. Device B (different logo, never synced) then uploads logo Y. Both uploads succeed, last wins. No per-device logo hash collision on server since both write to same object path. Acceptable.

6. **Cache-busting** — `?v={ts}` ensures fresh URL per upload. But the `logo_synced_url` stored locally keeps the old timestamp. Next desktop fetch of `logo_synced_url` fetches the old URL which CDN may cache as-was for up to 60s. Minor, acceptable.

### Recommendation

- On fetch failure AND desktop has no local logo, add a one-shot retry 30s later. Currently fails silently. Track via an `app_settings.logo_fetch_pending` flag.
- Confirm CORS with: `curl -I -H 'Origin: https://terminalxpos.com' {logo_url}` — response must include `Access-Control-Allow-Origin: *`. (Not run as part of this audit.)

---

## 6. WhatsApp / app_settings split

### Confirmed architecture

- **WhatsApp credentials** (`whatsapp_instance`, `whatsapp_token`) live in `app_settings` table (not `businesses.settings`).
- **app_settings schema** — verified via `information_schema`:
  ```
  id         uuid
  business_id uuid
  key        text
  value      text
  updated_at timestamptz
  ```
- **Flow:**
  1. Desktop user enters creds in Sistema.jsx → `api.settings.update({ whatsapp_instance, whatsapp_token })` → `settingsUpdate` → INSERT OR REPLACE into SQLite `app_settings`.
  2. `pushBusinessMeta` does **NOT** push `app_settings` (only business meta). WhatsApp creds never go UP from desktop.
  3. Web signup / Supabase Edge function `whatsapp-send` requires creds in `businesses.settings` (per the function code), not `app_settings`.
  4. **WARNING:** `supabase/functions/whatsapp-send/index.ts` reads from `business.settings` JSONB, but desktop writes to `app_settings` and never syncs UP. **Edge function is reading from the wrong table on desktop-originated installs.** → High-severity finding.
  5. On pull: `validate.js` reads `app_settings` rows and returns them as `remoteConfig`. LicenseContext spreads `remoteConfig` minus device-specific keys into local `app_settings.update(safeConfig)`. So web-set creds DO flow down.

### Exclusion list in LicenseContext v1.9.37 (line 150)

```js
const { printer, print_preticket, print_factura_auto, print_conduce_auto, ...safeConfig } = res.remoteConfig
```

**Is this exclusion list complete?**

Device-specific keys that must NOT be pulled down (overwriting local device config):
- `printer` — printer name on THIS device ✓ excluded
- `print_preticket`, `print_factura_auto`, `print_conduce_auto` — auto-print toggles ✓ excluded

**Keys STILL present in remoteConfig that should be excluded (per this audit):**
- `supabase_business_id` — set locally by LicenseContext AND FirstTimeSetup. If Supabase has a different value (corrupted during a business_id change), it would overwrite the correct local one. → MEDIUM risk, unlikely but add to exclusion.
- `supabase_auth_email` — per-installation auth email. Not normally written to Supabase app_settings, but if it ever were, would clobber the local one. → LOW risk, add defensively.
- `supabase_user_id` — same as above. → LOW risk, add defensively.
- `sync_debug` — HUGE string containing per-device sync stats. Never written to Supabase currently, but if it ever were (e.g., by a debug tool), it would be device-specific. → LOW.
- `logo_synced_hash`, `logo_synced_url` — strictly local cache flags. → LOW, add defensively.
- `empleados_backfill_done`, `users_dedup_done`, `pull_reset_version`, `sync_v3_supabase_id`, `sync_v4_ticket_resync` — migration markers, strictly local. → LOW, add defensively.
- `hwid` — hardware ID, strictly local. → LOW.

**Keys that must NOT be excluded (these are business-level and should sync):**
- `whatsapp_instance`, `whatsapp_token`, `whatsapp_phone` — YES sync ✓
- `itbis_pct`, `ley_pct`, `ley_enabled`, `usd_rate` — YES sync ✓
- `business_type`, `fiscal_mode`, `dgii_environment` — YES sync ✓
- `rnc_verify`, `sucursales`, `app_lang`, `auto_backup` — YES sync ✓

### Recommended exclusion list

```js
const LOCAL_ONLY_KEYS = [
  'printer', 'print_preticket', 'print_factura_auto', 'print_conduce_auto',
  'supabase_business_id', 'supabase_auth_email', 'supabase_user_id',
  'logo_synced_hash', 'logo_synced_url', 'sync_debug', 'hwid',
  'empleados_backfill_done', 'users_dedup_done', 'pull_reset_version',
  'sync_v3_supabase_id', 'sync_v4_ticket_resync',
]
const safeConfig = Object.fromEntries(
  Object.entries(res.remoteConfig).filter(([k]) => !LOCAL_ONLY_KEYS.includes(k))
)
```

Better yet: **invert the model.** Define an allow-list of keys that ARE business-wide, deny everything else by default:

```js
const BUSINESS_WIDE_KEYS = new Set([
  'itbis_pct', 'ley_pct', 'ley_enabled', 'usd_rate', 'business_type',
  'fiscal_mode', 'dgii_environment', 'rnc_verify', 'sucursales', 'app_lang',
  'auto_backup', 'whatsapp_instance', 'whatsapp_token', 'whatsapp_phone',
])
const safeConfig = Object.fromEntries(
  Object.entries(res.remoteConfig).filter(([k]) => BUSINESS_WIDE_KEYS.has(k))
)
```

Rationale: any NEW setting added to `app_settings` is by default device-local unless explicitly promoted to business-wide. The current deny-list model means new settings accidentally leak to other devices. Invert to fail-safe.

### Separate WhatsApp bug (referenced above)

Edge function `supabase/functions/whatsapp-send/index.ts` reads creds from `businesses.settings` JSONB, but desktop writes them to `app_settings`. Either:
- Fix the Edge function to read from `app_settings`, or
- Fix desktop (`pushBusinessMeta` or a new sync step) to mirror WhatsApp creds into `businesses.settings`, or
- Use the Edge function ONLY from web (where creds may have been written via a different path).

**Recommendation: fix the Edge function to read from `app_settings`** — that matches the actual source of truth and preserves the current UX.

---

## 7. Admin.jsx MiEmpresa save — merge semantics

### Current state (v1.9.38, lines 1242-1267)

```js
const current = await api?.admin?.getEmpresa?.()
let existing = {}
try { existing = current?.settings ? (typeof current.settings === 'string' ? JSON.parse(current.settings) : current.settings) : {} } catch {}
const city = form.biz_city.trim()
const mergedSettings = { ...existing, biz_city: city, ciudad: city, biz_type: form.biz_type }
await api.admin.saveEmpresa({
  name, rnc, address, phone, logo, settings: JSON.stringify(mergedSettings),
})
```

### Analysis

**Correct aspects:**
- Reads existing settings first. Handles string-vs-object. Good.
- Spreads existing into new. Preserves other keys. Good.
- Sends settings as stringified JSON (which SQLite accepts and Supabase-via-web-adapter will store as string-in-jsonb unless `web.js:saveEmpresa` re-parses).

**Problems:**

1. **Web path stores string-in-jsonb.** `web.js:saveEmpresa` (line 184-191) takes `patch.settings` as-is and UPDATEs the JSONB column. If MiEmpresa sends `settings: '{"biz_city":...}'` (string), the Supabase JSONB column gets a string value — same corruption as the demo seeder. Fix: `web.js:saveEmpresa` must JSON.parse if it receives a string:

   ```js
   saveEmpresa: (data) => tryOr(async () => {
     const allowed = ['name', 'rnc', 'address', 'phone', 'email', 'logo', 'logo_url', 'settings']
     const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
     if ('logo' in patch) { patch.logo_url = patch.logo; delete patch.logo }
     // JSONB column — must be an object, not a string
     if (typeof patch.settings === 'string') {
       try { patch.settings = JSON.parse(patch.settings) } catch { delete patch.settings }
     }
     if (patch.settings && (typeof patch.settings !== 'object' || Array.isArray(patch.settings))) {
       delete patch.settings
     }
     if (!Object.keys(patch).length) return null
     throwSupaError(await supabase.from('businesses').update(patch).eq('id', bid))
   }),
   ```

2. **`ecf_cert_installed`, `cert_expiry` keys.** These are written by:
   - `validate.js` line 115 (on desktop bizSync during validate) — writes directly to Supabase
   - LicenseContext on round-trip — writes back to SQLite via `settings: JSON.stringify(extra)`

   When MiEmpresa saves, it reads `current.settings` which (on desktop) is SQLite string that ALREADY contains the ecf_* keys from the last round-trip. Spread preserves them. Good.

   On WEB mode, `api.admin.getEmpresa()` → `web.js` returns native object from Supabase → line 1248 handles `typeof === 'object'` branch → spread preserves. Good.

3. **Race with validate.js during active edit.** Admin opens MiEmpresa, reads settings. Meanwhile, validate.js cycle fires and updates settings.ecf_cert_installed. Admin saves → writes stale settings back, clobbering the fresh ecf status. Window: 4-hour interval but could collide.
   
   Fix: use the deep-merge RPC from §4 so Admin's save is additive (just `biz_city, ciudad, biz_type`) rather than full-replace.

4. **`email` field missing from MiEmpresa save.** Form has no email field, but saveEmpresa is called without `email`. Since the allowed-list filter drops undefined keys, this is safe — email column not touched. Good.

5. **logo field handling.** `logo: logo || null`. If user removes the logo, `logo: null` is sent. `empresaSave` at line 1260-1262 handles null → `patch.logo = null` → UPDATE `SET logo=NULL`. Good. The next `pushBusinessMeta` will compute hash of null buffer → no hash → `logoHash === lastHash` only if both were null. Actually `!logoHash` skips the upload. Then `updates.logo_url = logoUrl` where `logoUrl = lastLogoUrlRow?.value || null`. The STALE URL gets re-pushed. **Bug: null-out on local does NOT null the CDN URL on Supabase.**
   
   Fix in `pushBusinessMeta`:
   ```js
   if (!emp.logo) {
     // Logo removed locally — clear server URL + delete cache
     updates.logo_url = null
     try { _db.rawPrepare("DELETE FROM app_settings WHERE key='logo_synced_hash'").run() } catch {}
     try { _db.rawPrepare("DELETE FROM app_settings WHERE key='logo_synced_url'").run() } catch {}
   } else if (logoHash && logoHash !== lastHash) {
     // existing upload logic
   }
   if (logoUrl && emp.logo) updates.logo_url = logoUrl
   ```
   
   Also optionally DELETE the storage object so orphaned files don't pile up. `DELETE /storage/v1/object/business-logos/{bizId}/logo.{ext}`.

---

## 8. Settings Key Inventory — CANONICAL TABLE

Use this as the source of truth for every key. Future changes MUST update this table.

### Legend

- **Storage:**
  - `biz.settings JSONB` — Supabase `businesses.settings` (object on Supabase, TEXT-of-JSON on SQLite `businesses.settings`).
  - `app_settings` — Supabase + SQLite `app_settings` (key/value text).
  - `local-only` — SQLite `app_settings` only, never synced.
  - `licenses.*` — Supabase `licenses` table column.
- **Sync direction:**
  - `↑↓` — bidirectional (desktop ↔ Supabase).
  - `↑` — desktop → Supabase only (pushed via bizSync during validate).
  - `↓` — Supabase → desktop only.
  - `—` — local-only, never synced.
- **Writers:** all writers that insert/update this key.
- **Consumers:** all readers that depend on this key.

### Business meta (TOP-LEVEL columns on `businesses`)

| Key | Writers | Consumers | Storage | Sync |
|-----|---------|-----------|---------|------|
| `name` | Mi Empresa form, FirstTimeSetup, admin panel, bizSync on validate | Receipt header, PDF header, Sidebar logo tooltip | businesses.name TEXT | ↑↓ |
| `rnc` | Mi Empresa form, FirstTimeSetup, admin panel, bizSync | Receipt, XML-builder (emisor RNC), dgii-client | businesses.rnc TEXT | ↑↓ |
| `address` | Mi Empresa form, FirstTimeSetup, admin panel, bizSync | Receipt footer | businesses.address TEXT | ↑↓ |
| `phone` | Mi Empresa form, FirstTimeSetup, admin panel, bizSync | Receipt footer, WhatsApp footer | businesses.phone TEXT | ↑↓ |
| `email` | FirstTimeSetup (web path 538), admin panel, bizSync | Receipt footer | businesses.email TEXT | ↑↓ |
| `logo` | Mi Empresa file upload, FirstTimeSetup (desktop → SQLite BLOB), seeders | Receipt header (thermal printer), PDF header, Sidebar preview | businesses.logo BLOB (SQLite) / logo_url TEXT (Supabase) + Storage bucket | ↑↓ via hash-compare |
| `plan` | License admin panel → licenses.plans; bizSettings round-trip back to desktop `businesses.plan` | usePlan() hook, PlanGate feature checks | businesses.plan TEXT (SQLite) / licenses.plans.name (Supabase) | ↓ |

### `businesses.settings` JSONB keys

| Key | Writers | Consumers | Sync | Notes |
|-----|---------|-----------|------|-------|
| `biz_city` | Mi Empresa, Settings.jsx (legacy) | Receipt address line (printer.js:202), PDF footer, **duplicated as `ciudad`** | ↑↓ | Must write BOTH `biz_city` AND `ciudad` for back-compat |
| `ciudad` | Mi Empresa, Settings.jsx (legacy) | Same as biz_city | ↑↓ | Legacy key, keep in sync with biz_city |
| `biz_type` | Mi Empresa, FirstTimeSetup | Seeded demo data, e-CF checklist defaults, visual theme | ↑↓ | Mirrors `business_type` in app_settings — both kept |
| `business_type` | Seeder, FirstTimeSetup via Step 6 | Same as biz_type | ↑↓ via app_settings | Mirrored to app_settings.business_type; canonical is app_settings |
| `facturacion_mode` | Settings DGII tab, Admin.jsx fiscal_mode toggle | CobrarModal (legacy vs e-CF branch), RemoteDashboard, Onboarding flag | ↑↓ | Values: `legacy` / `ecf` |
| `dgii_environment` | Settings DGII tab (biz.settings + app_settings mirror) | xml-builder (URL prefix), dgii-client base URL | ↑↓ | Values: `certecf` / `ecf` |
| `ecf_private_key_pem` | validate.js via bizSync | web/api/ecf-sign.js (server-side signing) | ↑ desktop→server only | SENSITIVE — never goes back down. Desktop stores locally in userData, only pushes PEM on explicit install |
| `ecf_certificate_pem` | validate.js via bizSync | web/api/ecf-sign.js | ↑ desktop→server only | Companion to private key |
| `ecf_cert_installed` | validate.js via bizSync | ClientDetail.jsx admin card, web certInfo() | ↑ | Boolean |
| `ecf_cert_subject` | validate.js via bizSync | ClientDetail.jsx | ↑ | e.g. "STUDIO X SRL" |
| `ecf_cert_expiry` | validate.js via bizSync | ClientDetail.jsx, cert-manager expiry warning | ↑ | ISO date |
| `ecf_cert_expired` | validate.js via bizSync | ClientDetail.jsx | ↑ | Boolean |
| `ecf_environment` | validate.js via bizSync (alias of `dgii_environment`) | ClientDetail.jsx | ↑ | Duplicates dgii_environment — consider deprecating |
| `ecf_status_updated_at` | validate.js | LWW timestamp for cert status | ↑ | ISO timestamp |
| `feature_overrides` | Admin panel bulk_action feature_toggle | usePlan hook override | ↑ admin→all | `{ feature_name: boolean }` map |
| `visits` | Admin panel visit scheduler | Admin ClientDetail visit timeline | ↑ admin→Supabase only | Array of `{id, scheduled_date, visit_type, notes, completed}` |
| `itbis_pct` | Seeder (legacy) | Mirrored to app_settings.itbis_pct — canonical is app_settings | ↑↓ | Seeder wrote this into biz.settings by mistake; real source is app_settings |
| `ley_pct` | Seeder | Mirrored to app_settings.ley_pct | ↑↓ | Same note |
| `language` | Seeder | Mirrored to app_settings.app_lang | ↑↓ | Same note — canonical is app_lang in app_settings |
| `demo` | Seeder | (none — marker only) | ↑ seed only | Boolean flag on demo businesses |

### `app_settings` keys (business-wide)

| Key | Writers | Consumers | Sync | Notes |
|-----|---------|-----------|------|-------|
| `itbis_pct` | Preferencias (Sistema.jsx), seeder | CobrarModal, CreditNotes, POS, reports | ↑↓ | Default `18`. Canonical tax rate source |
| `ley_pct` | Preferencias | Same | ↑↓ | Default `10` |
| `ley_enabled` | Preferencias | POS subtotal check (applies ley when enabled AND subtotal > 1000) | ↑↓ | `1` / `0` string |
| `usd_rate` | Preferencias | POS currency toggle, receipt footer | ↑↓ | String of number |
| `business_type` | FirstTimeSetup, seeder | useBusinessType hook (branches POS UI) | ↑↓ | Values: carwash, retail, service, hybrid, dealership, restaurant, mechanic, salon, prestamos |
| `fiscal_mode` | Admin.jsx Fiscal tab | Legacy NCF vs e-CF check | ↑↓ | `legacy` / `ecf` |
| `dgii_environment` | Settings.jsx DGII tab | xml-builder, dgii-client | ↑↓ | `certecf` / `ecf` |
| `rnc_verify` | Preferencias | CobrarModal (skip RNC lookup if 0) | ↑↓ | `1` / `0` |
| `sucursales` | Preferencias | Multi-branch UI (future) | ↑↓ | `1` / `0` |
| `app_lang` | Preferencias | useLang() hook | ↑↓ | `es` / `en` |
| `auto_backup` | Sistema.jsx Respaldo section | Daily backup trigger | ↑↓ | `1` / `0` |
| `whatsapp_instance` | Sistema.jsx WhatsApp section | WhatsApp send (web Edge function currently reads wrong place — see §6) | ↑↓ | UltraMSG instance id |
| `whatsapp_token` | Sistema.jsx | Same | ↑↓ | UltraMSG token |
| `whatsapp_phone` | Sistema.jsx | Receipt footer CTA | ↑↓ | +1XXXXXXXXXX |

### `app_settings` keys (LOCAL-ONLY — must NOT sync)

| Key | Writer | Purpose |
|-----|--------|---------|
| `printer` | Sistema.jsx Impresión | Per-device printer name |
| `print_preticket` | Sistema.jsx | Auto-print pre-ticket toggle (per-device) |
| `print_factura_auto` | Sistema.jsx | Auto-print invoice toggle (per-device) |
| `print_conduce_auto` | Sistema.jsx | Auto-print conduce toggle (per-device) |
| `supabase_business_id` | LicenseContext, FirstTimeSetup | Local cache of remote business_id — never pushed |
| `supabase_auth_email` | FirstTimeSetup | Local session email — never pushed |
| `supabase_user_id` | FirstTimeSetup | Local auth user id — never pushed |
| `hwid` | License activation | Hardware ID — cannot sync |
| `logo_synced_hash` | pushBusinessMeta | SHA-256 of last-pushed logo — per-device |
| `logo_synced_url` | pushBusinessMeta | Last-pushed CDN URL — per-device cache |
| `sync_debug` | sync.js | Last sync stats — per-device |
| `empleados_backfill_done` | db migration | Migration marker |
| `users_dedup_done` | db migration | Migration marker |
| `pull_reset_version` | sync.js | Pull-reset marker |
| `sync_v3_supabase_id` | sync.js | Schema migration marker |
| `sync_v4_ticket_resync` | sync.js | Schema migration marker |

### `licenses.*` relevant fields

| Column | Writer | Consumer | Notes |
|--------|--------|----------|-------|
| `license_key` | Admin panel, signup | validate.js | Primary key for lookup |
| `hardware_id` | validate.js on first activate | validate.js | One-device lock |
| `status` | Admin panel, validate.js | LicenseContext | active / suspended / pending / cancelled / expired |
| `expires_at` | Admin panel | LicenseContext | Grace calc |
| `last_seen` | validate.js | Admin dashboard | Timestamp |
| `activated_at` | validate.js on activate | Admin dashboard | Timestamp |
| `plan_id → plans.name` | Admin panel | usePlan hook | Joined in validate.js response |

### `configuracion` (Supabase only)

| Column | Purpose |
|--------|---------|
| `setup_complete` | Desktop-side: whether FirstTimeSetup was completed. Lives in SQLite `configuracion` table. Gate for empresaGet returning null (line 1220). Not mirrored to Supabase. |

---

## 9. Prioritized Remediation Plan

### P0 — CRITICAL (data-corrupting)

1. **Heal poisoned demo rows** — run UPDATE to convert `jsonb_typeof='string'` rows to `'object'`. SQL in §1.
2. **Fix seeder** `tmp/seed-demo-businesses.mjs:357` — remove `JSON.stringify`.
3. **Fix `web/api/validate.js:114`** — normalise `existingSettings` before spread. Patch in §2.
4. **Fix `web/api/panel.js:342, 862, 1086, 1107`** — normalise before spread (4 sites).
5. **Fix `packages/data/web.js:saveEmpresa`** — JSON.parse if string. Patch in §7.
6. **Add CHECK constraint** `jsonb_typeof(settings) = 'object'` — permanent DB-level guard.

### P1 — HIGH

7. **Add `parseBizSettings` helper** to `packages/services/settings.js`. Replace all 15 `JSON.parse(biz.settings)` + `biz.settings || {}` call sites to use it.
8. **Fix Edge function `whatsapp-send`** — read from `app_settings` instead of `businesses.settings`, OR fix desktop to mirror.
9. **Implement deep-merge RPC** `merge_business_settings(bid, patch)` and switch pushBusinessMeta + validate.js to use it. Eliminates multi-device race.
10. **Fix logo-null propagation** in `pushBusinessMeta` — clear `logo_url` on Supabase when local logo removed.
11. **Expand LicenseContext exclusion list** — use fail-safe allow-list `BUSINESS_WIDE_KEYS`.

### P2 — MEDIUM

12. **`web.js:getEmpresa`** returns object, but `Admin.jsx:1215` calls `JSON.parse(row.settings || '{}')`. On web, this calls `JSON.parse(object)` → `"[object Object]"` → throws. Use `parseBizSettings`.
13. **Same fix for** `Settings.jsx:261,283,592,660`, `CreditNotes.jsx:312`, `FirstTimeSetup.jsx:1362`.
14. **Add offline logo-fetch retry** in LicenseContext (30s backoff).
15. **Consider deprecating `ecf_environment`** in favor of canonical `dgii_environment` (alias confusion).

---

## 10. Verification Plan

After applying P0 fixes:

```sql
-- Verify all rows are objects
SELECT id, name, jsonb_typeof(settings) FROM businesses;
-- Expected: all 'object'

-- Verify CHECK constraint rejects strings
UPDATE businesses SET settings = '"oops"'::jsonb WHERE id = '<any>';
-- Expected: ERROR violates constraint
```

After applying P1 fixes:

1. Wipe a test machine's SQLite.
2. Activate license.
3. Confirm `biz_city`, `biz_type`, `whatsapp_*`, `logo` all restored from Supabase.
4. Edit Mi Empresa on web while desktop is open.
5. Force desktop sync (`pushBusinessMeta`).
6. Verify neither device clobbered the other's edit (deep merge RPC working).
7. Save logo on desktop → check Storage bucket + `logo_url` on Supabase.
8. Delete logo on desktop → check `logo_url` cleared on Supabase.

### CORS verification for logo public URL

```
curl -I -H 'Origin: https://terminalxpos.com' \
  'https://csppjsoirjflumaiipqw.supabase.co/storage/v1/object/public/business-logos/1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79/logo.png'
```

Expect `access-control-allow-origin: *` in response headers.

---

END OF AUDIT-03.
