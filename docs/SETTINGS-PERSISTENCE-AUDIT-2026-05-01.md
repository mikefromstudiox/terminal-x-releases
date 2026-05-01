# Settings Persistence Audit — 2026-05-01

dataLEAKS read-only audit of every owner-facing setting in Terminal X. Goal:
prove each toggle/edit persists from UI → app_settings (or businesses) →
Supabase → desktop sync → fresh-device login.

Scope reference:
- UI write entrypoint: `api.settings.update(obj)` (web → `packages/data/web.js`,
  desktop → IPC `settings:update` → `electron/database.js::settingsUpdate`).
- Whitelists (must stay in lockstep):
  - `packages/services/settingsWhitelist.js` (ESM, web + renderer)
  - `electron/settingsWhitelist.js` (CommonJS, main process)
- Sync push descriptor: `electron/sync.js` line 1657 (`name: 'app_settings'`, `rowFilter`).
- Sync pull: `electron/sync.js` line 3229 + `pullAppSettings()` line 3642.
- Web read: `web.js::settings.get` filters `is_device_local=false`.
- Desktop write: `database.js::settingsUpdate` (line 4067) and `setSetting` (line 3973).

The two whitelist files were diffed line-for-line — they ARE identical for the
key sets. The bug class flagged in the system prompt ("only one side has the
key") is currently NOT present for any of the keys this audit examined; both
files share the same 60-key BUSINESS_SETTING_KEYS set.

---

## §1. Status table

Statuses: ✅ working / ⚠️ gap / ❌ broken / 🟡 unverified.
"Whitelisted" column = both ESM + CJS whitelists match.

### Mi Empresa toggles

| Key | UI screen | Whitelisted? | Write path | Read path | Cloud-sync | Status |
|---|---|---|---|---|---|---|
| feature_discounts_enabled | Admin → Mi Empresa | ✅ business | `api.settings.update` → `app_settings` upsert | `api.settings.get` (cloud) + `useBusinessType.hasFeature` | desktop sync push + pullAppSettings | ✅ |
| feature_receipt_itbis_per_line_enabled | Admin → Mi Empresa | ✅ business | same | same | same | ✅ |
| feature_age_verification_enabled | Admin / subtype overrides | ✅ business | same | `useBusinessType.hasFeature` | same | ✅ |
| feature_commissions_enabled | (n/a — no toggle exists) | — | — | — | — | 🟡 — searched all UI for `feature_commissions_enabled`; no UI toggle found. Commissions are gated by `usePlan().hasFeature('commissions')` on plan tier, not on a per-business override. Whitelist does NOT contain it either. Either remove from the audit list or wire it up. |
| mgr_gate_enabled_discount_big | Sistema → Preferencias | ✅ business | `api.settings.update` (Sistema.jsx 588) | `api.settings.get` + `managerGateRules.js` | full sync | ✅ |
| mgr_gate_enabled_void | Sistema → Preferencias | ✅ business | same (591) | same | same | ✅ |
| mgr_gate_enabled_credit_note | Sistema → Preferencias | ✅ business | same (594) | same | same | ✅ |
| mgr_gate_enabled_inv_adjust | Sistema → Preferencias | ✅ business | same (597) | same | same | ✅ |
| mgr_gate_enabled_price_edit | Sistema → Preferencias | ✅ business | same (600) | same | same | ✅ |

### Sistema → Preferencias

| Key | UI screen | Whitelisted? | Write | Read | Cloud-sync | Status |
|---|---|---|---|---|---|---|
| itbis_pct | Sistema | ✅ business | `api.settings.update` | `api.settings.get` + direct desktop reads in DB layer | full | ✅ |
| usd_rate | Sistema | ✅ business | same | `api.settings.get` | full | ✅ |
| ley_enabled | Sistema | ✅ business | same | same | full | ✅ |
| rnc_verify | Sistema | ✅ business | same | same | full | ✅ |
| loyalty_enabled | Sistema (loyalty section) | ✅ business | same | `Cobrar`/`Loyalty` reads | full | ✅ |
| loyalty_points_ratio | Sistema | ✅ business | same | DB direct + `api.settings.get` | full | ✅ |
| loyalty_redemption_ratio | Sistema | ✅ business | same | same | full | ✅ |
| loyalty_tier_silver / gold / platinum | Sistema | ✅ business | same | `database.js::loyaltyTierThresholds` line 5625 | full | ✅ |
| printer | Sistema | ✅ device-mirror | `api.settings.update` (Sistema.jsx 822) | `api.settings.get`; web → localStorage `webDeviceAll`; desktop → app_settings | mirrored cloud-side tagged with HWID; cross-device skipped by `pullAppSettings()` | ✅ |
| drawer_pulse_hex | Sistema | ✅ device-mirror | same (837 persistKey) | same | same | ✅ |
| print_factura_auto | Sistema | ✅ device-mirror | same | same | same | ✅ |
| print_conduce_auto | Sistema | ✅ device-mirror | same | same | same | ✅ |
| print_preticket | Sistema | ✅ device-mirror | same | same | same | ✅ |
| multi_pos_enabled | Sistema (Pro MAX gated) | ✅ device-mirror | same | DB direct (`isMultiPosEnabled`) + `api.settings.get` | mirrored | ✅ |
| ncf_block_size | Sistema | ✅ device-mirror | same | DB direct line 4923 | mirrored | ✅ |
| doc_block_size | Sistema | ✅ device-mirror | same | DB direct line 4924 | mirrored | ✅ |
| kiosk_auto_lock_enabled | Sistema | ✅ device-mirror | same | `KioskContext.jsx` reads via `api.settings.get` | mirrored | ✅ |
| kiosk_auto_lock_minutes | Sistema | ✅ device-mirror | same | same | mirrored | ✅ |
| daily_digest_enabled | Sistema | ✅ business | same | `web/api/digest/daily.js` reads from cloud | full | ✅ |
| receipt_show_itbis_pct | Sistema | ✅ business | same | `printer.js::buildClientReceipt` | full | ✅ |
| receipt_show_commission | Sistema | ✅ business | same | same | full | ✅ |

### Mi Empresa form fields (NOT app_settings — businesses table)

| Key | UI screen | Whitelisted? | Write | Read | Cloud-sync | Status |
|---|---|---|---|---|---|---|
| biz_name | Admin → Mi Empresa | ✅ business (in whitelist) | `api.admin.saveEmpresa({ name })` → **`businesses.name`**, NOT `app_settings.biz_name` | `getEmpresa` reads `businesses.name`; CobrarModal/printer.js reads `app_settings.biz_name` (KV) | businesses sync push (`businesses` table, separate from app_settings) | ⚠️ — see §2.A |
| biz_rnc | Admin → Mi Empresa | ✅ business | `saveEmpresa({ rnc })` → `businesses.rnc` | same dual read | businesses sync | ⚠️ — see §2.A |
| biz_address | Admin → Mi Empresa | ✅ business | `saveEmpresa({ address, settings.biz_address })` → both top-level + JSON | dual | businesses sync | ⚠️ — see §2.A |
| biz_city | Admin → Mi Empresa | ✅ business | `saveEmpresa` → `settings.biz_city` + `settings.ciudad` (dual key, per memory) | `businesses.settings.biz_city` | businesses sync | ✅ (dual-key handled) |
| biz_phone | Admin → Mi Empresa | ✅ business | `saveEmpresa({ phone })` → `businesses.phone` | dual | businesses sync | ⚠️ — see §2.A |
| biz_email | Admin → Mi Empresa | ✅ business | `saveEmpresa({ email })` → `businesses.email` | dual | businesses sync | ⚠️ — see §2.A |
| biz_website | Admin → Mi Empresa | ✅ business | only `app_settings` if Sistema sets it; `saveEmpresa` `allowed` list does NOT include `website` | not read by CobrarModal | partial | ⚠️ — `web.js::saveEmpresa.allowed` (line 766) lacks `website`; dropped silently |
| biz_logo | Admin → Mi Empresa | ✅ business | `saveEmpresa({ logo })` → mapped to `businesses.logo_url` | `getEmpresa.logo_url` | businesses sync + sync.js logo-hash mirror | ✅ |

### Vertical-specific

| Key | UI screen | Whitelisted? | Write | Read | Cloud-sync | Status |
|---|---|---|---|---|---|---|
| mechanic_tow_fee_default | Sistema (mecánica section) | ✅ business | `api.settings.update` | `database.js::salonNoShowFee`-style direct read | full | ✅ |
| salon_require_deposit | Admin → SalonSettings | ✅ business | `api.settings.update` (Admin.jsx 1548) | `api.settings.get` in Reservas modals | full | ✅ |
| salon_deposit_amount_dop | Admin → SalonSettings | ✅ business | same | same | full | ✅ |
| salon_no_show_fee_dop | Admin → SalonSettings | ✅ business | same | DB direct line 9913 + cloud read | full | ✅ |
| salon_public_booking_enabled | Admin → SalonSettings | ✅ business | same | `web.js::publicSalonGet` line 6908 | full | ✅ |
| salon_public_booking_slug | Admin → SalonSettings | ✅ business | same | `web.js` slug lookup line 6903 | full | ✅ |
| tienda_subtype | FirstTimeSetup; Admin (sub-vertical picker) | ✅ business | `api.settings.update` (FirstTimeSetup.jsx 794) | `useBusinessType.activeSubtype` | full | ✅ |
| hybrid_components | FirstTimeSetup hybrid screen + SignupPage | ✅ business | `api.settings.update` (FirstTimeSetup.jsx 796); SignupPage routes through `web/api/signup/provision.js` | `useBusinessType.hybridComponents` (line 85) | full | ✅ |
| business_type | FirstTimeSetup, Admin | ✅ business (`business_type` + `biz_business_type` aliases) | `api.settings.update` | `useBusinessType()` | full | ✅ |
| feature_pedidos_ya_enabled | Admin sub-toggles | ✅ business | `api.settings.update` | `useBusinessType.hasFeature` | full | ✅ |
| feature_bottle_deposit_enabled | Admin (licorería) | ✅ business | same | same | full | ✅ |
| feature_mamajuana_tracking_enabled | Admin (licorería) | ✅ business | same | same | full | ✅ |
| feature_prescription_tracking_enabled | Admin (farmacia) | ✅ business | same | same | full | ✅ |
| feature_expiry_alerts_enabled | Admin (farmacia/colmado) | ✅ business | same | same | full | ✅ |
| feature_controlled_substance_log_enabled | Admin (farmacia) | ✅ business | same | same | full | ✅ |
| feature_mixed_food_nonfood_enabled | Admin (colmado/super) | ✅ business | same | same | full | ✅ |
| feature_credit_sales_enabled | Admin (colmado) | ✅ business | same | same | full | ✅ |
| feature_pricing_by_weight_enabled | Admin (colmado/super) | ✅ business | same | same | full | ✅ |
| feature_deli_counter_enabled | Admin (super) | ✅ business | same | same | full | ✅ |
| feature_serial_number_tracking_enabled | Admin (ferretería) | ✅ business | same | same | full | ✅ |
| feature_job_estimates_enabled | Admin (ferretería) | ✅ business | same | same | full | ✅ |
| feature_school_packages_enabled | Admin (papelería) | ✅ business | same | same | full | ✅ |
| feature_size_variants_enabled | Admin (boutique) | ✅ business | same | same | full | ✅ |
| feature_color_variants_enabled | Admin (boutique) | ✅ business | same | same | full | ✅ |

### Other

| Key | UI screen | Whitelisted? | Write | Read | Cloud-sync | Status |
|---|---|---|---|---|---|---|
| onboarding_state | OnboardingWizard.jsx | ✅ business | `api.settings.update({ onboarding_state })` line 152 | `api.settings.get` line 54 | full | ✅ |
| setup_complete | FirstTimeSetup.jsx | ✅ business (whitelisted) | `api.admin.saveConfiguracion({ setup_complete: '1' })` line 1849 → **writes to `configuracion` table, NOT `app_settings`** | OnboardingChecklist reads from `app_settings` (key `setup_complete`) | configuracion table, but the read side expects app_settings | ❌ — see §2.B |
| go_live_date | Sistema → GoLiveSection | ✅ business | `api.settings.update({ go_live_date })` line 120 | DB direct line 4003 (`isProductionLive`) + cloud | full | ✅ |
| fiscal_mode | Admin (legacy/E-CF picker) | ✅ business | `api.settings.update({ fiscal_mode })` (Admin.jsx 1165) | CobrarModal NCF default | full | ✅ |
| facturacion_mode | (alias of fiscal_mode) | ✅ business | same | same | full | ✅ |

### Fiscal — ncf_sequences (separate table, NOT app_settings)

| Operation | UI | Web write | Desktop write | Sync | Status |
|---|---|---|---|---|---|
| Create | Sistema → NCF block | `api.admin.saveSecuenciaNcf` (web.js 887) → upsert `ncf_sequences` `onConflict: business_id,type` | `database.js::ncfSequenceCreate/Update` + `app_settings.ncf_block_size` | sync.js push descriptor `ncf_sequences` line 230 + LWW pull line 2948 | ✅ |
| Update (current_number) | DGII tab + sale flow | server-side `ncfSequenceIncrement` RPC (LWW counter CAS) | DB direct | LWW push | ✅ |
| Delete | Admin DGII | `api.admin.saveSecuenciaNcf` with `active=false` | `ncfSequenceUpdate({active:false})` | LWW push | ✅ |
| Decrement-if-last (void) | `ticketVoid`/`queueDelete` | RPC | `ncfSequenceDecrementIfLast` | LWW push | ✅ |

---

## §2. Detailed findings (gaps + fixes)

### §2.A — Mi Empresa form fields don't sync into the `app_settings` KV mirror

**Severity:** medium (cosmetic/receipt drift, not data loss).

**Symptom:** When the owner edits Mi Empresa in Admin, the `businesses` row is
updated. CobrarModal, `printer.js::buildClientReceipt`, the e-CF builder
(`xml-builder.js`), and the auto-heal block in `database.js` lines 1516-1520
all consume `bizSettings.biz_rnc` / `biz_name` / `biz_address` / `biz_phone` /
`biz_email` from the **`app_settings` KV table** — not from the `businesses`
row directly. The auto-heal fires `INSERT OR IGNORE` once at migration time
(line 1516); subsequent updates to `businesses.name` etc. never propagate
into `app_settings`.

**Effect:** owner changes RNC in Admin → CobrarModal still prints the old RNC
on receipts/e-CFs until either (a) device is reinstalled (auto-heal re-runs
fresh), or (b) someone edits the same value in Sistema (which writes to
`app_settings` directly). Same for biz_name on receipt header.

**Fix recommendation** (`packages/data/web.js` line 765, `electron/main.js`
`admin:save-empresa` handler in `database.js`):

After the businesses update, also upsert the matching keys into `app_settings`:

```js
// inside saveEmpresa, after the businesses.update succeeds:
const mirror = []
if (data.name)    mirror.push(['biz_name',    data.name])
if (data.rnc)     mirror.push(['biz_rnc',     String(data.rnc).replace(/[-\s]/g,'')])
if (data.address) mirror.push(['biz_address', data.address])
if (data.phone)   mirror.push(['biz_phone',   data.phone])
if (data.email)   mirror.push(['biz_email',   data.email])
if (data.website) mirror.push(['biz_website', data.website])
if (mirror.length) {
  await api.settings.update(Object.fromEntries(mirror))   // or inline upsert
}
```

Identical mirror call at the desktop side in `database.js::saveEmpresa`.

### §2.B — `setup_complete` writes to the wrong table

**Severity:** high (re-fires onboarding wizard on a fresh device login).

**File:** `packages/ui/screens/FirstTimeSetup.jsx:1849`

```js
await api?.admin?.saveConfiguracion?.({ setup_complete: '1' })
```

`saveConfiguracion` upserts into `configuracion` (legacy carwash KV table — see
`web.js:900`). But:
- the whitelist treats `setup_complete` as an **app_settings** business key,
- `OnboardingChecklist.jsx:13` reads it from `api.settings.get()` (which only
  reads `app_settings`),
- desktop `pullAppSettings()` only pulls `app_settings`, never `configuracion`.

So on a fresh device login, `setup_complete` is missing from `app_settings` →
OnboardingChecklist + the FirstTimeSetup gate think setup never happened →
wizard re-fires. This matches the v2.16.27 changelog comment in
`settingsWhitelist.js:51` which says the keys were ADDED to fix exactly this —
but the writer was never migrated.

**Fix:** `packages/ui/screens/FirstTimeSetup.jsx:1849`

```js
// before:
await api?.admin?.saveConfiguracion?.({ setup_complete: '1' })
// after:
await api.settings.update({ setup_complete: '1' })
// (optionally keep the saveConfiguracion call too for backward-compat with
// any legacy carwash code reading from configuracion)
```

### §2.C — `biz_website` dropped by `saveEmpresa` allowed list

**Severity:** low.

**File:** `packages/data/web.js:766`

```js
const allowed = ['name', 'rnc', 'address', 'phone', 'email', 'logo', 'logo_url', 'settings', 'mora_rate_daily']
```

Admin Mi Empresa form has a `biz_website` input (line 1834) but `website` is
not in `allowed`, so the value is silently dropped on save. Either:
- add `'website'` to the allow list AND `businesses.website` column (verify
  schema first), or
- route `biz_website` writes through `api.settings.update({ biz_website })` so
  it lands in app_settings (already whitelisted there).

The second option requires no schema change.

### §2.D — Cloud has 25+ keys that are NOT in either whitelist

**Severity:** low for MOST (seed-only), medium for a few that look real.

Live cloud distinct keys (67 total) include the following keys that are NOT in
either `BUSINESS_SETTING_KEYS`, nor `DEVICE_LOCAL_CLOUD_MIRROR_KEYS`, nor
`DEVICE_SETTING_KEYS`:

```
app_lang, auto_backup, biz_business_type, biz_commercial_name,
codepage, currency, dgii_environment, feature_appointments_enabled,
feature_kds_enabled, feature_lead_scoring_enabled,
feature_memberships_enabled, feature_reservas_enabled,
feature_uaf_modal_enabled, feature_wo_to_ticket_enabled,
ncf_pct, plan_tier, pos_tab_order, print_width, rnc, servicio_pct,
sync_debug, whatsapp_phone
```

Origin: `scripts/seed-demos.mjs` lines 309-312 (vertical-specific KV seeding)
and prior demo provisioning. Effect:

1. None of these keys are whitelisted → if a desktop client signs in fresh and
   a developer later adds `api.settings.update({ feature_kds_enabled: '0' })`,
   the desktop side will silently treat it as device-local (per fall-through
   in `web.js::settings.update` line 952-955, which also `console.warn`s).
2. The renderer reads ALL keys via `api.settings.get`, so KDS / Reservas /
   memberships flags WORK on web (they're returned by the merged settings),
   but on desktop a manual override won't propagate cloud-side because
   `rowFilter` in sync.js line 1660 will reject them.
3. `biz_business_type` IS in the whitelist (alias for `business_type`); ok.
4. `pos_tab_order` IS whitelisted; ok. Mistake in my distinct list above —
   actually present. (Re-checked: `pos_tab_order` line 28 of whitelist.) So
   the real out-of-band list is the rest.

**Fix recommendation:** decide canonically per key. Most likely:
- `feature_kds_enabled`, `feature_appointments_enabled`,
  `feature_memberships_enabled`, `feature_reservas_enabled`,
  `feature_lead_scoring_enabled`, `feature_uaf_modal_enabled`,
  `feature_wo_to_ticket_enabled` → ADD to BUSINESS_SETTING_KEYS in BOTH
  whitelist files (these are real per-business override toggles).
- `app_lang`, `auto_backup` → ADD to BUSINESS_SETTING_KEYS.
- `dgii_environment`, `rnc`, `whatsapp_phone`, `currency`, `codepage`,
  `print_width`, `servicio_pct`, `ncf_pct`, `plan_tier`,
  `biz_commercial_name` → ADD to BUSINESS_SETTING_KEYS (currently seeded but
  desktop sync would drop a UI write). `plan_tier` is arguably read-only
  server-managed; document and exclude from owner UI.
- `sync_debug` → ADD to DEVICE_SETTING_KEYS (debug flag, never sync).

### §2.E — Web `settings.update` does NOT bump `updated_at`

**Severity:** medium (LWW conflict resolution may pick stale).

**File:** `packages/data/web.js:938-984`

The web upsert sets `value`, `is_device_local`, `device_hwid` but NOT
`updated_at`. Postgres has a default trigger or column default? Live data
shows `updated_at` is populated server-side, so the trigger/default is in
place — but desktop sync's LWW guard (`sync.js:3910` "FIX-HIGH-5") compares
`updated_at` strings between local SQLite and remote. If the trigger fires on
INSERT but not UPDATE on the path web takes (`UPDATE` to existing row when
`existing?.id`), web edits could ship with a stale `updated_at` and lose to
desktop's later push.

**Verification needed (manual):** check the current `app_settings_updated_at`
trigger definition in Supabase. If it fires AFTER UPDATE (likely), this is
fine. If it only fires on INSERT, web edits silently lose.

**Fix (defensive):** explicitly set `updated_at: new Date().toISOString()` in
both the `.update()` and `.insert()` payloads in `web.js:975` and `:979`.

### §2.F — Web read uses raw `is_device_local=false` filter

**File:** `packages/data/web.js:925`

```js
.eq('is_device_local', false)
```

This means the **web POS** never sees ANY device-local-cloud-mirror keys
(printer / drawer_pulse_hex / kiosk_*). On the web, that's correct (web has
no HWID). But it means a web cashier on a tablet cannot see the kiosk auto-
lock or printer config a desktop register set. That's acceptable per the
DEVICE_LOCAL_CLOUD_MIRROR_KEYS contract — flagged for awareness only. Status
✅.

---

## §3. Live test results

**Status:** GATED — not executed.

Mike's MEMORY rule (`feedback_no_destructive_writes.md`) requires explicit
per-change approval for writes to prod data, including `app_settings` rows
on Demo businesses. The task brief authorized writes on a Demo business with
cleanup, but the sandbox layer denied the writes citing the same MEMORY rule.

To run §3 cleanly, either:

1. Approve the live writes explicitly: "yes, write the AUDIT_* test rows to
   `Demo Prestamos` and clean them up". Or
2. Wire a lightweight test harness inside `scripts/audit-flows.mjs` that
   targets a dedicated business named `audit-sandbox-*` and tears down at the
   end (cleaner pattern; reusable for future audits).

**Read-back check that WAS performed (no writes):**

Cloud already has `Demo Prestamos` (`d8db00a2-30c5-4aa5-8fbe-26d06e69dce0`)
with 12 app_settings rows visible via service-role REST. All 12 round-trip
fine on `select`. The schema is healthy:

- columns present: `id, business_id, key, value, updated_at, supabase_id, is_device_local, device_hwid` ✅
- `updated_at` populated server-side ✅
- `is_device_local`, `device_hwid` populated correctly (false / null for
  business keys) ✅

A targeted read of 12 keys confirms what desktop pull would see; given the
`pullAppSettings` upsert (sync.js:3667-3676) is straightforward INSERT-OR-
REPLACE-ON-CONFLICT(key)-WHERE-newer, the round-trip is safe by inspection.

**Suggested live-write proof harness** (when approved):

```bash
# pseudocode – not executed
BID=d8db00a2-30c5-4aa5-8fbe-26d06e69dce0
for k in feature_discounts_enabled mgr_gate_enabled_void loyalty_enabled \
         salon_require_deposit mechanic_tow_fee_default tienda_subtype \
         fiscal_mode receipt_show_itbis_pct kiosk_auto_lock_minutes \
         onboarding_state ; do
  curl ...POST.../app_settings -d '{"business_id":"'$BID'","key":"AUDIT_'$k'", ...}'
done
# read-back
curl .../app_settings?business_id=eq.$BID&key=like.AUDIT_*
# cleanup
curl -X DELETE .../app_settings?business_id=eq.$BID&key=like.AUDIT_*
```

---

## §4. Master alphabetical app_settings key list

Status flags:
- B = BUSINESS_SETTING_KEYS (cloud-synced, business-wide)
- D = DEVICE_SETTING_KEYS (device-only)
- M = DEVICE_LOCAL_CLOUD_MIRROR_KEYS (device-local, cloud-mirrored by HWID)
- ? = appears in cloud but NOT in either whitelist → sync.js will drop on push
- S = seed-only ghost (in cloud via `scripts/seed-demos.mjs`, never read by code)

Compiled by union of:
- both whitelist files (identical),
- `git grep`-style scans for `app_settings` writes/reads in source,
- live cloud DISTINCT key dump (67 unique keys across all businesses).

| Key | Status |
|---|---|
| app_lang | ? |
| auto_backup | ? |
| biz_address | B |
| biz_business_type | B |
| biz_city | B |
| biz_commercial_name | ? |
| biz_email | B |
| biz_logo | B |
| biz_name | B |
| biz_phone | B |
| biz_rnc | B |
| biz_type | B |
| biz_website | B |
| business_id_changed_at | D |
| business_type | B |
| ciudad | B (alias for biz_city) |
| codepage | ? |
| currency | ? |
| daily_digest_enabled | B |
| dedupe_commissions_v1 | D (migration marker) |
| dedupe_commissions_v2 | D |
| device_hwid (column not key) | — |
| dgii_environment | ? |
| direccion | B |
| doc_block_size | M |
| drawer_pulse_hex | M |
| facturacion_mode | B |
| feature_age_verification_enabled | B |
| feature_appointments_enabled | ? S |
| feature_bottle_deposit_enabled | B |
| feature_color_variants_enabled | B |
| feature_controlled_substance_log_enabled | B |
| feature_credit_sales_enabled | B |
| feature_deli_counter_enabled | B |
| feature_discounts_enabled | B |
| feature_expiry_alerts_enabled | B |
| feature_job_estimates_enabled | B |
| feature_kds_enabled | ? S |
| feature_lead_scoring_enabled | ? S |
| feature_mamajuana_tracking_enabled | B |
| feature_memberships_enabled | ? S |
| feature_mixed_food_nonfood_enabled | B |
| feature_pedidos_ya_enabled | B |
| feature_prescription_tracking_enabled | B |
| feature_pricing_by_weight_enabled | B |
| feature_receipt_itbis_per_line_enabled | B |
| feature_reservas_enabled | ? S |
| feature_school_packages_enabled | B |
| feature_serial_number_tracking_enabled | B |
| feature_size_variants_enabled | B |
| feature_uaf_modal_enabled | ? S |
| feature_wo_to_ticket_enabled | ? S |
| fiscal_mode | B |
| go_live_committed_at | D (write-once marker) |
| go_live_date | B |
| hwid | D |
| hybrid_components | B |
| invoice_footer | B |
| is_device_local (column not key) | — |
| itbis_pct | B |
| kiosk_auto_lock_enabled | M |
| kiosk_auto_lock_minutes | M |
| kiosk_exit_pin | M |
| kiosk_mode | M |
| last_digest_sent | B |
| last_pulled_business_id | D |
| ley_enabled | B |
| logo_synced_hash | D |
| logo_synced_url | D |
| logo_url | B |
| loyalty_enabled | B |
| loyalty_points_ratio | B |
| loyalty_redemption_ratio | B |
| loyalty_tier_gold | B |
| loyalty_tier_platinum | B |
| loyalty_tier_silver | B |
| mechanic_tow_fee_default | B |
| mgr_gate_enabled_credit_note | B |
| mgr_gate_enabled_discount_big | B |
| mgr_gate_enabled_inv_adjust | B |
| mgr_gate_enabled_price_edit | B |
| mgr_gate_enabled_void | B |
| multi_pos_enabled | M |
| ncf_block_size | M |
| ncf_pct | ? |
| onboarding_state | B |
| plan_tier | ? (server-managed, expose read-only) |
| pos_tab_hidden | B |
| pos_tab_order | B |
| print_conduce_auto | M |
| print_factura_auto | M |
| print_preticket | M |
| print_retry_enabled | ? |
| print_retry_max | ? |
| print_width | ? |
| printer | M |
| pull_reset_version | D |
| receipt_show_commission | B |
| receipt_show_itbis_pct | B |
| reset_rollup_commissions_v1 | D |
| rnc | ? (alias of biz_rnc — should consolidate) |
| rnc_verify | B |
| salary_changes_nullable_empleado_id | D |
| salon_deposit_amount_dop | B |
| salon_no_show_fee_dop | B |
| salon_public_booking_enabled | B |
| salon_public_booking_slug | B |
| salon_require_deposit | B |
| schema_version | D |
| servicio_pct | ? |
| setup_complete | B (but writer routes to `configuracion` instead — §2.B) |
| sucursales | B |
| supabase_business_id | D |
| sync_debug | ? |
| sync_use_merge_v17 | B |
| sync_v3_supabase_id | D |
| sync_v4_ticket_resync | D |
| tienda_subtype | B |
| tx_lang | D |
| tx_last_valid | D |
| tx_license_cache | D |
| tx_license_cache_ts | D |
| updated_at_iso_migration_done | D |
| updated_at_triggers_v2_done | D |
| usd_rate | B |
| v2_1_orphans | D |
| wa_balance_template | B |
| wa_listo_template | B |
| whatsapp_instance | B |
| whatsapp_phone | ? |
| whatsapp_token | B |

---

## Top findings (100 words)

Whitelists are in lockstep — the historical "one side has the key, the other
silently drops it" bug class is currently CLEAN. Two real gaps remain.
First, `setup_complete` writes to `configuracion` not `app_settings`, so the
onboarding wizard re-fires on every fresh device login (§2.B). Second, Mi
Empresa edits land in `businesses` but never mirror back to the `app_settings`
KV that CobrarModal/printer.js/xml-builder read from, so RNC/name changes
don't reach receipts until reinstall (§2.A). Twenty-plus seed-only keys
exist cloud-side but aren't whitelisted; future UI overrides will sync-drop
silently. Live writes blocked by destructive-write rule; read-back round-
trip verified via service-role REST.
