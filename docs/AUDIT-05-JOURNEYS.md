# Audit 5 — User Journey Acceptance Matrix

Scope: every user-visible state transition from first install to wipe-and-recover.
Each step has a PRECONDITION, ACTION, EXPECTED, PASS, FAIL-TODAY, and ROOT-CAUSE (file:line).
If any PASS fails on release candidate, the app is wiped and restarted.

Brokenness key (1 = works today, 5 = completely broken today).

---

## J1 — First install, brand new business (brokenness: 3/5)

### J1.1 Launch installer
- Precondition: no Terminal X installed on Windows machine.
- Action: double-click `Terminal X Setup 1.9.29.exe`.
- Expected: installer extracts, creates desktop shortcut, places app in `%LOCALAPPDATA%\Programs\terminal-x\`, launches.
- Pass: main window opens within 10s; no Windows SmartScreen dialog blocks launch.
- Fail today: installer is signed but recently-bumped versions occasionally trigger SmartScreen "unrecognized app" on first publish; user must click "More info → Run anyway".
- Root cause: `package.json` build config + Windows code-signing reputation accumulation. Not a code bug.
- Mitigation: document in release notes; no action required in code.

### J1.2 LicenseGate first render
- Precondition: fresh install, no license key in `%APPDATA%\terminal-x\hwid.json` or app_settings.
- Action: app finishes launching.
- Expected: `LicenseGate` shows "Activación de Licencia" card with key + RNC inputs; hwid loaded and displayed.
- Pass: inputs render, HWID visible in lower card, Activate button disabled until both fields filled.
- Fail today: on extremely fast boots, `runCheck()` fires before hwid loads (`LicenseContext.jsx:89` — `if (!h) return`); result is `checking=true` forever if hwid IPC ever errors.
- Root cause: `packages/ui/context/LicenseContext.jsx:50-69` — no timeout fallback on hwid load.
- Fix: wrap `api.license.hwid()` in a 3s timeout; fall back to `'browser-dev'`.

### J1.3 Enter key + RNC → activate
- Precondition: valid TXL-XXXX-XXXX-XXXX key, matching RNC on the license row in Supabase `licenses`.
- Action: type key + RNC, click "Activar Terminal X".
- Expected: (a) `validate.js` POST succeeds, (b) `license.hardware_id` bound to this HWID in Supabase, (c) `tx_last_valid` timestamp stored, (d) `supabase_business_id` saved to `app_settings`, (e) **blocking** `sync.pull()` pulls remote data, (f) `bizSettings` (logo, ciudad, whatsapp, fiscal mode, cert) hydrated locally.
- Pass:
  - Supabase `licenses.hardware_id` equals hwid of this machine.
  - `SELECT value FROM app_settings WHERE key='supabase_business_id'` returns the UUID.
  - `SELECT name, logo FROM businesses WHERE id=1` returns expected values.
  - After activation completes, app is NO LONGER on LicenseGate.
- Fail today: pull completes silently — there is no user-visible progress indicator. `LicenseContext.jsx:138` awaits `pullFn()` inside the activate path but does not surface "Syncing your business data…" UI, so users on slow connections stare at a spinner for 15-60s with no feedback.
- Root cause: `packages/ui/context/LicenseContext.jsx:136-141` — blocking pull has no UI state.
- Fix: expose `checking` + `syncStage` ('validating' | 'pulling' | 'done') from LicenseContext; LicenseGate displays stage.

### J1.4 FirstTimeSetup wizard appears (no remote data — brand new biz)
- Precondition: license activated, zero rows pulled from Supabase (new business).
- Action: LicenseGate dismisses.
- Expected: `FirstTimeSetup` mounts because `configuracion.setup_complete != '1'`.
- Pass: wizard renders at Step 0 (Welcome).
- Fail today: the setup_complete check in `empresaGet` (database.js:1220) returns `null` → main app sees empty empresa → wizard fires. OK.
- Root cause: correct.
- Fix: none.

### J1.5 Wizard Step 1 — Business info + logo
- Precondition: at Step 1.
- Action: select business type, enter business name, optional RNC/phone/address/email, upload logo (PNG ≤ 2MB), click Continue.
- Expected: `api.admin.saveEmpresa()` writes to `businesses` row id=1 with logo BLOB decoded from data-URL; `settings.business_type` written to `app_settings`.
- Pass:
  - `SELECT name, logo FROM businesses WHERE id=1` returns non-null name and binary logo.
  - Next button advances to Step 2 (web) or Step 3 (desktop, skips Supabase signup).
- Fail today: `empresaSave` (database.js:1245-1284) strips any key not in `['name','rnc','address','phone','email','logo','settings','plan']`. If wizard ever passes `ciudad` or `biz_city` separately (it doesn't here, but LicenseContext bizSettings hydration path does), they are silently dropped. The wizard itself is OK; the hydration path is not — see J3.
- Root cause: `electron/database.js:1247`.
- Fix: verified ciudad now goes through `settings` JSON at `LicenseContext.jsx:163` via payload wrapping. Ship-blocker only for J3.

### J1.6 Wizard Step 3 — Admin user creation
- Precondition: at Step 3 (Admin User).
- Action: enter full name, username (auto-slugged from name), PIN 4-6 digits, confirm PIN, Continue.
- Expected: `api.admin.saveUsuario()` creates user with role='owner' and `pin_hash = SHA256(pin)`.
- Pass:
  - `SELECT name, username, pin_hash FROM users` returns the new user with non-null `pin_hash`.
  - Wizard verifies creation via `getUsuarios()` check (FirstTimeSetup.jsx:1092-1093) and throws if empty.
  - PIN is stored unchanged through sync (pin_hash pushed to Supabase `staff.pin_hash`).
- Fail today: if user clicks Continue twice during the `saving` state, there's no double-submit guard beyond the `saving` flag. `userCreate` (database.js:1331-1378) is idempotent on username (line 1347 UPSERT), so the second click is absorbed. OK.
- Root cause: adequate.
- Fix: none critical.

### J1.7 Wizard Step 5 — Activation (redundant for J1 because already activated in J1.3)
- Precondition: license already active.
- Action: wizard's own activation polling runs.
- Expected: poll detects `status==='active'` within 10s and auto-advances to Step 6.
- Pass: polling sees active license, Step 6 renders within 15s.
- Fail today: **DEAD CODE ON J1 PATH** — user just activated in J1.3, but Step 5 RE-REGISTERS via `panel?action=register` (FirstTimeSetup.jsx:1229). On desktop this hits an already-registered license and returns an existing `license_key`. The polling then works. Extra API call, no user-visible bug.
- Root cause: `FirstTimeSetup.jsx:1215-1244` — no branch for "license already activated, skip registration".
- Fix: check `useLicense().result?.valid` before re-registering.

### J1.8 Wizard Step 6 → main app, first POS render
- Precondition: setup_complete='1', license valid, at least one user.
- Action: "Comenzar" button fires `markSetupComplete()` → `onComplete()` reloads to POS.
- Expected: Login screen appears (PIN pad).
- Pass: Login renders, PIN pad accepts input.
- Fail today: none observed.
- Root cause: OK.
- Fix: none.

### J1.9 First login with new PIN
- Precondition: user created in J1.6.
- Action: type the PIN entered in J1.6.
- Expected: `authByPin(pin)` finds user; `setUser()` fires; routes to `/pos`.
- Pass: first attempt works; no retry needed.
- Fail today: if J1.3 blocking pull populated `users` from Supabase `staff` before Step 3 created the new owner user, the Step 3 upsert finds the existing row (by username) and overwrites its `pin_hash`. That's correct. OK.
- Root cause: verified OK via `database.js:1347` username upsert.
- Fix: none.

### J1.10 POS renders with data
- Precondition: logged in.
- Action: POS mounts.
- Expected: empleados list, services list, clients list all populated from SQLite (either wizard-created or sync-pulled).
- Pass: no empty-state message on a NEW biz, or "Add your first service" empty state if nothing pulled. Either is acceptable — UX message must be clear.
- Fail today: new biz correctly shows empty states. OK.
- Fix: none.

---

## J2 — Returning user, normal login (brokenness: 2/5)

### J2.1 App re-open after prior valid session
- Precondition: app closed with `tx_last_valid` < 72h.
- Action: launch Terminal X.
- Expected: LicenseGate brief flash → background revalidate → Login screen appears.
- Pass: LicenseGate hidden within 1s if `tx_last_valid` is fresh; Login mounts immediately.
- Fail today: `LicenseContext.runCheck()` always re-runs on mount and blocks on `validateLicense()` HTTP call. On slow networks the Login can delay 2-10s. No cached-valid fast path.
- Root cause: `packages/ui/context/LicenseContext.jsx:72-217` — no "if tx_last_valid < 1h, skip revalidate".
- Fix: within the LicenseContext runCheck, if `lastValid < 1h ago`, synthesize `valid=true` immediately and revalidate in the background.

### J2.2 Sync behavior on reopen — blocking vs background
- Precondition: app launches with existing license.
- Action: LicenseContext completes revalidate.
- Expected: pull runs but does NOT block Login UI (user can log in immediately); background sync updates data afterwards.
- Pass: Login screen is interactive within 2s of launch; sync toast/indicator shows "Syncing…" in sidebar but doesn't block input.
- Fail today: `LicenseContext.jsx:136-141` awaits the pull on EVERY call to `runCheck()`, including the mount call. So every launch blocks on pull. Periodic revalidate at 4h also awaits. Slow pull = unresponsive Login.
- Root cause: `packages/ui/context/LicenseContext.jsx:134-141`.
- Fix: only await pull when `businessId` was JUST discovered (i.e. `settings.supabase_business_id` was empty before this call). Otherwise fire-and-forget.

### J2.3 Login with same PIN
- Precondition: user has logged in before; `pin_hash` exists locally.
- Action: type PIN.
- Expected: first attempt succeeds.
- Pass: `authByPin` returns user row; no "PIN incorrecto" error.
- Fail today: if the prior app run updated the PIN on Device A and Device B's pull has not yet refreshed `users.pin_hash`, Device B rejects the new PIN. Conversely, if Device B's `updated_at` on local user row is NEWER than server's (edited locally then restart), pull could clobber with stale server hash. Actual LWW logic in `pullUpsertRow` needs auditing.
- Root cause: `electron/sync.js` LWW strategy on `users` — if both sides have identical `updated_at` on old changes, no deterministic winner.
- Fix: pull's upsert MUST only overwrite local if `server.updated_at > local.updated_at`. Verify in `pullUpsertRow` (sync.js ~1200 range).

### J2.4 All data present post-login
- Precondition: logged in.
- Action: navigate POS, Clients, Empleados, Reportes.
- Expected: every screen shows rows that match Supabase.
- Pass: `SELECT COUNT(*) FROM services` local = Supabase count for this `business_id`.
- Fail today: new tables added in Phase 2 (10 tables, per recent commit) may not yet be in `PULL_TABLES`. Silent missing data.
- Root cause: `electron/sync.js` PULL_TABLES enumeration (~line 1080).
- Fix: audit 4 tracks — see `docs/_audit4_supabase.md`.

---

## J3 — Wipe + reactivate (THE disaster scenario — brokenness: 5/5 as of yesterday, needs full verification)

### J3.1 Wipe APPDATA
- Precondition: working Terminal X install with valid business data in Supabase.
- Action: close app; `rmdir /s /q %APPDATA%\terminal-x`.
- Expected: all local SQLite + hwid.json + license cache gone.
- Pass: folder re-created empty on next launch.
- Fail today: OK.
- Fix: none.

### J3.2 Relaunch + license enter
- Precondition: empty APPDATA.
- Action: launch → LicenseGate → enter same key + same RNC.
- Expected: `validate.js` matches hwid (new, but license was previously bound → **HARDWARE_MISMATCH**).
- Pass: one of two paths:
  - (a) admin has reset `hardware_id=null` → validate binds new hwid → success.
  - (b) no reset → user gets `hardware_mismatch` error + WhatsApp CTA.
- Fail today: wipe on SAME MACHINE keeps same hwid (MAC+hostname), so mismatch does NOT fire. OK for the "same PC wipe" scenario.
- Root cause: `web/api/validate.js:66` — strict hardware_id equality. Matches on same PC.
- Fix: none for same-PC wipe. See J10 for new-PC rebind.

### J3.3 Blocking pull populates local DB
- Precondition: license activated after wipe.
- Action: LicenseContext fires blocking pull.
- Expected: every synced table (21+ in canonical list, 10 more added Phase 2 = 31 total) is repopulated.
- Pass:
  - `SELECT COUNT(*) FROM empleados` > 0 if biz had employees.
  - `SELECT COUNT(*) FROM services` > 0 if biz had services.
  - `SELECT COUNT(*) FROM clients` matches Supabase count.
- Fail today: this was THE bug yesterday. PULL_TABLES omitted tables; phase 2 commit `891f894` added 10 more. Still to verify: does every table in the canonical list appear in `PULL_TABLES` with correct cols?
- Root cause: `electron/sync.js` PULL_TABLES array.
- Fix: integration test — seed Supabase with 1 row per table, wipe, reactivate, assert every table has 1 row locally.

### J3.4 bizSettings hydration — logo, ciudad, fiscal, WhatsApp, cert
- Precondition: activated on wiped install.
- Action: `validate.js` response includes `bizSettings` = `{name, rnc, phone, address, logo, plan, ...biz.settings}` (validate.js:133).
- Expected: `LicenseContext.jsx:161-187` wraps everything that isn't a top-level column into `settings` JSON and calls `saveEmpresa()`. Logo URL is fetched via `fetch()` and converted to data-URL on desktop.
- Pass:
  - `SELECT logo FROM businesses WHERE id=1` returns non-null BLOB.
  - `SELECT settings FROM businesses WHERE id=1` JSON contains `ciudad`, `biz_city`, `whatsapp_instance`, `whatsapp_token`, `fiscal_mode`, `ecf_cert_installed`, etc.
  - Mi Empresa screen shows ciudad, WhatsApp settings pre-populated.
- Fail today:
  - Logo fetch may fail CORS — catch at `LicenseContext.jsx:180-181` logs a warning but silently drops the logo. User sees no logo on receipts until they re-upload.
  - PEM cert (`ecf_private_key_pem`, `ecf_certificate_pem`) is pushed BY desktop during bizSync but the PULL path does not restore the .p12 file to disk — so e-CF signing is broken post-wipe until user reinstalls .p12.
- Root cause:
  - Logo: `packages/ui/context/LicenseContext.jsx:170-181` — no retry.
  - Cert: `LicenseContext.jsx:161-187` has no branch to write `ecf_private_key_pem` back to disk as .p12.
- Fix: logo fetch retry x2; for cert, either (a) also pull .p12 bytes to Storage and restore on wipe, or (b) document that .p12 must be reinstalled manually (and show banner in DGII screen).

### J3.5 Users with real pin_hash pulled
- Precondition: activated on wiped install, remote `staff` rows exist with real `pin_hash`.
- Action: pull runs for `users` table.
- Expected: local `users.pin_hash` = remote `staff.pin_hash` (SHA256 of original PIN).
- Pass: `SELECT pin_hash FROM users` is the 64-char hex string from Supabase (not null, not `sha256('0000')`).
- Fail today: verified via `FirstTimeSetup.jsx:565` (`pin_hash: u.pin_hash  // forward remote hash directly — never clobber with 0000`). However, the J3 wipe path never goes through FirstTimeSetup (because empresaGet returns non-null post-pull, so `setup_complete='1'` already via pulled config row). The path IS through `pullUpsertRow` → `userCreate` with `data.pin_hash` → `resolvePinHash` at database.js:1336 which takes remote hash first. Should be OK.
- Root cause: appears OK. Needs end-to-end test.
- Fix: add integration test that wipes, pulls, and asserts `pin_hash` ends with the same 8 chars as Supabase.

### J3.6 First PIN login after wipe
- Precondition: wipe + pull complete.
- Action: type the exact PIN used before wipe.
- Expected: first try succeeds.
- Pass: `authByPin` returns user; routes to POS.
- Fail today: if the pull's `users` table has not yet completed when Login mounts (race), `authByPin` returns null. `LicenseContext.jsx:136-141` awaits the initial pull, but only one pull pass — if `users` is pulled AFTER a pull-pass-1 error, pass 2 might not cover `users`.
- Root cause: need to verify pull is transactional OR that Login screen waits for sync state = `idle`.
- Fix: Login screen subscribes to `window.electronAPI.sync.status` and shows "Syncing users…" blocker until first pull of `users` completes.

---

## J4 — Change PIN + restart (brokenness: 3/5)

### J4.1 Change PIN in Usuarios admin
- Precondition: logged in as owner.
- Action: Config → Usuarios → edit user → new PIN → save.
- Expected: `userUpdate()` hashes new PIN; local `users.pin_hash` updated; `users.updated_at` = now; sync pushes to Supabase staff.
- Pass:
  - `SELECT pin_hash, updated_at FROM users WHERE id=?` shows fresh hash + new updated_at.
  - Within 5 min (or next sync trigger), Supabase `staff.pin_hash` matches.
- Fail today: `userUpdate` (database.js:1380-1388) is missing an explicit `updated_at = NOW()` write. SQLite trigger may set it if installed. If the trigger isn't installed (fresh install), pin change will not sync up because sync pass 2 filters on `updated_at > last_synced_at`.
- Root cause: `electron/database.js:1380-1388` — no explicit updated_at bump on patch.
- Fix: append `updated_at=datetime('now')` to every update statement OR verify `CREATE TRIGGER` is installed at schema init.

### J4.2 Close app immediately, reopen, login with new PIN
- Precondition: PIN changed, app closed before sync pushed.
- Action: reopen.
- Expected: local pin_hash is correct; first login works.
- Pass: PIN login succeeds first try.
- Fail today: local hash is correct regardless of sync push. PASS.
- Root cause: OK.
- Fix: none.

### J4.3 Supabase side mirrors change
- Precondition: sync has run since PIN change.
- Action: `SELECT pin_hash, updated_at FROM staff WHERE business_id=? AND username=?`.
- Expected: hash matches SHA256(new PIN); updated_at is fresh.
- Pass: observable via Supabase SQL.
- Fail today: see J4.1 — if updated_at trigger missing, push doesn't fire.
- Root cause: same as J4.1.
- Fix: same as J4.1.

---

## J5 — Multi-device (brokenness: 4/5)

### J5.1 Device A changes ciudad
- Precondition: Devices A + B both online, logged in.
- Action: A → Mi Empresa → change ciudad to "Santo Domingo" → Save.
- Expected: `saveEmpresa` writes `settings` JSON with new ciudad + bumps `businesses.updated_at`; `pushBusinessMeta` sends update to Supabase.
- Pass: `SELECT settings->>'ciudad' FROM businesses WHERE id=?` in Supabase returns "Santo Domingo" within 5 min.
- Fail today: `pushBusinessMeta` (sync.js:1494-1574) only runs at Phase 0 of `syncNow`, and only sends the emp.settings if non-empty. If the save also needs to bump `updated_at` on the local row, needs check.
- Root cause: verified at `sync.js:1545-1549` — pushes settings JSON.
- Fix: add debounced push on every `saveEmpresa` call (not just 5-min polling).

### J5.2 Device B pulls the change
- Precondition: A pushed change.
- Action: Device B's next sync cycle pulls.
- Expected: B's local `businesses.settings->>'ciudad'` = "Santo Domingo".
- Pass: Mi Empresa on B shows "Santo Domingo".
- Fail today: **pull for `businesses` may not exist**. `PULL_TABLES` needs to include a business meta pull. If not present, B's settings NEVER refresh from Supabase.
- Root cause: need to grep `PULL_TABLES` for `businesses` entry.
- Fix: add explicit `pullBusinessMeta()` step that mirrors `pushBusinessMeta` — pulls `settings`, `logo_url`, `name`, etc. from Supabase to local row.

### J5.3 Device A sees B's later change
- Precondition: B changes to "Santiago".
- Action: A syncs.
- Expected: A's ciudad now "Santiago".
- Pass: round-trip works.
- Fail today: same as J5.2 — no pull path for business meta.
- Root cause: same as J5.2.
- Fix: same.

### J5.4 No duplicate empleados / staff / categorias after sync
- Precondition: both devices have pulled and pushed.
- Action: `SELECT COUNT(*) FROM empleados` locally vs Supabase count.
- Expected: counts match exactly; no dupes.
- Pass: local count == Supabase count; every row has a `supabase_id`.
- Fail today: upserts are keyed on `(business_id, supabase_id)` UNIQUE CONSTRAINT (per feedback_supabase_unique_constraints). If B creates an empleado before pulling A's version, and A+B both assign a supabase_id at creation → both sync independently → two rows, no conflict.
- Root cause: client-generated UUIDs at creation time + no natural-key dedupe. This is the INTENDED architecture. Users cannot hit it unless both devices create the SAME empleado simultaneously before either syncs.
- Fix: add a "merge duplicates" tool in admin panel (keyed by name+cedula). Not a release blocker.

---

## J6 — Employee edits (brokenness: 3/5)

### J6.1 Add employee
- Precondition: logged in, at Empleados screen.
- Action: click "+ Nuevo Empleado", fill form, Save.
- Expected: `empleadoCreate` inserts row with `supabase_id = randomUUID()`; creates initial `salary_changes` row with `reason='initial_salary'`.
- Pass:
  - New row in Empleados list.
  - `SELECT supabase_id FROM empleados ORDER BY id DESC LIMIT 1` is a UUID.
  - `SELECT * FROM salary_changes WHERE empleado_supabase_id=?` has 1 row.
- Fail today: OK per `database.js:1552-1561`.
- Fix: none.

### J6.2 Raise salary
- Precondition: employee exists with salary=20000.
- Action: edit → salary=25000 → Save.
- Expected: `empleadoUpdate` (database.js:1563-1585) detects salary change, inserts `salary_changes` row with `old_salary=20000, new_salary=25000, effective_date=today, reason=null`, updates `empleados.salary`.
- Pass:
  - `SELECT new_salary FROM salary_changes WHERE empleado_id=? ORDER BY effective_date DESC LIMIT 1` = 25000.
  - Nomina liquidacion calc uses time-weighted salary correctly.
- Fail today: `empleadoUpdate` does NOT bump `empleados.updated_at`. Sync push won't re-push this row. If a web admin later edits the employee, the pull will use `updated_at` cursor and MAY clobber the local salary change because server row has stale salary.
- Root cause: `electron/database.js:1584-1585` — no updated_at bump.
- Fix: append `updated_at=datetime('now')` to the UPDATE empleados SET ...

### J6.3 Salary survives restart
- Precondition: salary changed to 25000.
- Action: close app, reopen.
- Expected: Empleados list still shows 25000.
- Pass: unchanged.
- Fail today: if J6.2 bug fires (no updated_at bump) AND pull happens before push, pull sees stale server value and reverts to 20000. Exactly the "revert to 20k" bug.
- Root cause: same as J6.2.
- Fix: same as J6.2.

### J6.4 Liquidacion uses time-weighted monthlySalary
- Precondition: employee has salary history: 20000 (Jan-Mar) → 25000 (Apr-present).
- Action: generate liquidacion report.
- Expected: `calcLiquidacion.js` weights salary by months at each level.
- Pass: report shows weighted average close to (3×20000 + N×25000)/(3+N).
- Fail today: need to verify `packages/ui/screens/reports/nomina/lib/calcLiquidacion.js` uses `salary_changes` history not current salary.
- Root cause: unverified.
- Fix: integration test.

---

## J7 — Business settings edits (brokenness: 3/5)

### J7.1 Change ciudad → save → restart
- Precondition: Mi Empresa screen.
- Action: type new ciudad, Save.
- Expected: `saveEmpresa({ settings: JSON({...existing, ciudad, biz_city}) })` persists.
- Pass: `SELECT settings FROM businesses WHERE id=1` includes both `ciudad` and `biz_city`.
- Fail today: see feedback_ciudad_dual_key. Pattern must read/write both keys. If Mi Empresa save only writes `ciudad`, sync pulls down `biz_city` and overwrites. Round-trip risk.
- Root cause: `packages/ui/screens/empresa/*` (needs grep).
- Fix: `saveEmpresa` should always write both keys in settings JSON.

### J7.2 Upload logo → save → restart
- Precondition: Mi Empresa.
- Action: upload logo PNG, Save.
- Expected: logo decoded from data-URL to Buffer in `empresaSave` (database.js:1258-1273); stored as BLOB.
- Pass: `SELECT LENGTH(logo) FROM businesses WHERE id=1` > 0. Restart: logo appears on receipts.
- Fail today: OK.
- Fix: none.

### J7.3 WhatsApp instance + token → restart
- Precondition: Mi Empresa → WhatsApp section.
- Action: enter instance + token, Save.
- Expected: written to `app_settings` keys `whatsapp_instance`, `whatsapp_token`.
- Pass: `SELECT value FROM app_settings WHERE key IN ('whatsapp_instance','whatsapp_token')` returns values.
- Fail today: app_settings is NOT synced to Supabase for these keys (device-specific? or oversight?). On wipe, these are lost.
- Root cause: `app_settings` is not in `SYNC_TABLES`; `settingsUpdate` in database.js:1307 writes only locally. The J3 hydration from bizSettings restores them because they're in `biz.settings` JSON (pushed via `pushBusinessMeta`). Round-trip OK.
- Fix: verify `saveEmpresa` also writes whatsapp_instance/token into `businesses.settings` JSON, not just `app_settings`. Grep required.

### J7.4 Toggle auto-print factura
- Precondition: Preferencias.
- Action: toggle `print_factura_auto`, save.
- Expected: written to `app_settings`; remains on restart.
- Pass: setting persists.
- Fail today: intentionally NOT synced — LicenseContext.jsx:150 excludes `print_factura_auto` from remoteConfig sync. Local only = correct.
- Fix: none.

### J7.5 Change ITBIS %
- Precondition: Preferencias → Fiscal.
- Action: change itbis_pct from 18 to 16, Save. Create new ticket.
- Expected: new tickets use 16%. Historical tickets retain their stored tax.
- Pass: old tickets' `itbis_amount` in SQLite unchanged; new ticket uses 16%.
- Fail today: need to verify that each ticket persists the ITBIS rate at time of sale, not recomputes from current setting.
- Root cause: `ticketCreate` in database.js — should snapshot current itbis_pct.
- Fix: unverified — needs audit.

---

## J8 — Logout + switch user (brokenness: 2/5)

### J8.1 Logout
- Precondition: logged in as User A.
- Action: click logout.
- Expected: `logout()` in AuthContext clears `user` state + web Supabase session; PIN screen appears.
- Pass: PIN screen mounts; no cached data leaks into new session.
- Fail today: on web, `logout` uses `window.__txSupabase` handle — if the handle is not set (race), signOut silently skipped. Desktop uses simple state clear. OK.
- Root cause: `packages/ui/context/AuthContext.jsx:98-111`.
- Fix: desktop is fine; web edge case documented.

### J8.2 Switch to User B with different PIN
- Precondition: logged out.
- Action: type B's PIN.
- Expected: `authByPin(B.pin)` returns B; setUser fires.
- Pass: B's role + discount_pct + permissions active; role-gated screens hidden/shown correctly.
- Fail today: `resolveRole` in AuthContext.jsx:65-73 joins on `employee_id`. If `empleados.role` is 'none' for this user, fallback to `users.role` which may be stale. OK for current data model.
- Root cause: OK.
- Fix: none.

### J8.3 Return to PIN screen cleanly after logout
- Precondition: logged in.
- Action: logout.
- Expected: PIN screen only — no flicker to POS.
- Pass: clean transition.
- Fail today: OK.
- Fix: none.

---

## J9 — Offline 72h grace (brokenness: 2/5)

### J9.1 Disconnect + app usable
- Precondition: valid license, `tx_last_valid` set, internet online.
- Action: disable network, continue using app.
- Expected: revalidate catches at `LicenseContext.jsx:190-213`, `withinGrace = true` → `status='offline_grace'`, app remains usable.
- Pass: POS, ventas, all operations work; red banner shows "Modo sin conexión".
- Fail today: OK per `LicenseContext.jsx:194-202`.
- Fix: none.

### J9.2 Reconnect + catchup
- Precondition: offline for 1-72h, reconnect.
- Action: revalidate runs (4h interval or on next user trigger).
- Expected: license valid; sync catches up on queued local changes (push) then pulls remote changes.
- Pass: no data loss on either side.
- Fail today: sync has retry but no guaranteed "run catch-up on network-back" event. If app sat idle offline for 3h then reconnects, catch-up only happens on next 4h tick or user action.
- Root cause: no `navigator.onLine` listener in sync loop.
- Fix: add online/offline event listener to trigger immediate sync on reconnect.

---

## J10 — License rebind on new PC (brokenness: 5/5 — no self-serve rebind today)

### J10.1 Wipe Device A completely, install on Device B, activate same key
- Precondition: same license key, new physical machine → new hwid.
- Action: LicenseGate → enter key + RNC.
- Expected: validate.js sees `hardware_id != new_hwid` → returns `hardware_mismatch`.
- Pass: user gets clear error + WhatsApp CTA.
- Fail today: correct. But there's no self-serve rebind — user MUST WhatsApp support who manually sets `hardware_id=null` in Supabase.
- Root cause: `web/api/validate.js:66` strict match.
- Fix: (optional) add a `?rebind=1` param with OTP confirmation via email for self-serve rebind. Not a launch blocker.

### J10.2 After manual rebind by admin, activate succeeds
- Precondition: admin set `hardware_id=null`.
- Action: user retries activate.
- Expected: validate.js binds new hwid (line 73-76), activates.
- Pass: license active, data pulls.
- Fail today: OK.
- Fix: none.

### J10.3 Data syncs down to Device B
- Precondition: activation succeeded on B.
- Action: blocking pull runs.
- Expected: identical data set to A.
- Pass: counts match. See J3.3.
- Fail today: same risk as J3 — PULL_TABLES completeness.
- Root cause: same.
- Fix: same.

---

## J11 — License admin panel access (brokenness: 3/5)

### J11.1 Owner logs in to terminalxpos.com/admin
- Precondition: owner has a `staff` row in Supabase with `auth_user_id` + Supabase Auth account.
- Action: navigate to /admin, sign in with email+password.
- Expected: sees ONLY their own business (RLS enforces).
- Pass: business card loads; other businesses not visible.
- Fail today: admin panel was built for STUDIO X HQ (internal admin). Client-facing self-admin doesn't exist yet. The app routes to `/admin` for Studio X staff only (see `AdminApp.jsx`).
- Root cause: no client-admin panel exists.
- Fix: out of scope for this release. Client self-admin is a separate roadmap item.

### J11.2 Owner resets their own staff PIN (via web)
- Precondition: web admin panel functional.
- Action: edit staff row, reset PIN.
- Expected: `staff.pin_hash` updated; push-to-desktop via sync.
- Pass: desktop shows new PIN on next pull.
- Fail today: feature does not exist for clients.
- Root cause: see J11.1.
- Fix: future.

### J11.3 Changes on web propagate to desktop
- Precondition: staff/user row edited in web admin.
- Action: Supabase `staff` row updated with new `updated_at`.
- Expected: desktop pull picks up change within 5 min.
- Pass: verified by checking local pin_hash.
- Fail today: depends on J4.1 updated_at bump on the web side. If web edit doesn't bump `updated_at`, pull won't fetch.
- Root cause: `web/api/panel.js` UPDATE statements need explicit `updated_at=now()`.
- Fix: audit web admin panel update endpoints.

---

## J12 — FirstTimeSetup wizard UX (brokenness: 2/5)

### J12.1 Fresh install WITH remote staff rows
- Precondition: license activated; blocking pull populated `users` from `staff`.
- Action: what does the wizard do?
- Expected: wizard detects `users.length > 0` (from pull) and SKIPS Step 3 (Admin User) OR calls this an "existing setup" and sets `setup_complete='1'`.
- Pass: user doesn't have to re-create an already-synced owner.
- Fail today: `empresaGet` returns null until `setup_complete='1'` is set. If pull doesn't pull the `configuracion` table, wizard fires on top of already-populated data. Wizard Step 3 (`saveUsuario`) then re-upserts by username (line 1347), which MAY hash a fresh PIN over the synced one.
- Root cause: `electron/database.js:1220` + pull completeness for `configuracion` table.
- Fix: include `configuracion` in PULL_TABLES; or change logic to `setup_complete = (users.length > 0 && businesses.name IS NOT NULL)`.

### J12.2 Fresh install with NO remote data (new signup)
- Precondition: new license, no business data in Supabase.
- Action: full wizard flow Steps 0→6.
- Expected: wizard creates business row, owner user, fiscal mode. Sync pushes everything to Supabase.
- Pass:
  - Supabase `businesses` has a new row with correct name + rnc.
  - Supabase `staff` has a new owner row with real `pin_hash`.
  - `setup_complete='1'` locally.
- Fail today: OK for the happy path.
- Fix: none.

---

## Summary — how broken per journey

| # | Journey | Brokenness (1-5) | Top fail |
|---|---|---|---|
| J1 | First install | 3 | J1.3 no UI for blocking pull; J1.7 dead re-register |
| J2 | Returning login | 2 | J2.2 blocks UI on every launch pull |
| J3 | Wipe + reactivate | 5 | J3.3 PULL_TABLES may miss tables; J3.4 .p12 not restored |
| J4 | Change PIN + restart | 3 | J4.1 no updated_at bump on userUpdate |
| J5 | Multi-device | 4 | J5.2 no pull for `businesses` meta → B never sees A's ciudad |
| J6 | Employee edits | 3 | J6.2 no updated_at bump → salary revert risk |
| J7 | Settings edits | 3 | J7.1 ciudad dual-key; J7.5 ITBIS snapshot unverified |
| J8 | Logout + switch | 2 | minor web signOut race |
| J9 | Offline grace | 2 | J9.2 no network-reconnect event |
| J10 | License rebind | 5 | no self-serve; WhatsApp-only |
| J11 | Admin panel | 3 | client-facing admin doesn't exist |
| J12 | Wizard UX | 2 | J12.1 wizard may fire on populated DB |

---

## Top-5 fix priorities (derived from PASS criteria)

### 1. Add `updated_at = datetime('now')` to EVERY mutation in database.js (fixes J4.1, J6.2, J6.3 — the "revert to 20k" class of bugs)

Files: `electron/database.js` — every UPDATE statement on: `users`, `empleados`, `services`, `clients`, `businesses`, `categorias_servicio`, `inventory_items`. Either explicit `SET updated_at=datetime('now')` or verified `CREATE TRIGGER AFTER UPDATE` on each table.

Verification: after any edit, `SELECT updated_at FROM <table> WHERE id=?` should equal current timestamp ± 2s.

### 2. Add pull path for `businesses` meta (fixes J5.2, J5.3, J7.1)

File: `electron/sync.js` — add `pullBusinessMeta(bizId)` that fetches `name, rnc, phone, address, email, logo_url, settings, updated_at` from Supabase and applies to local `businesses` row 1 via `empresaSave`. Wire into `pullNow` and periodic sync.

Verification: change ciudad on Device A, wait 2 min, verify Device B's Mi Empresa shows the new ciudad.

### 3. Audit PULL_TABLES completeness (fixes J3.3, J10.3, J12.1)

File: `electron/sync.js` PULL_TABLES array. Assert that every table in `SYNC_TABLES` has a corresponding entry in `PULL_TABLES` (unless intentionally push-only).

Add to PULL_TABLES if missing: `configuracion`, `app_settings` (selective keys), all Phase 2 tables.

Verification: integration test — seed Supabase with one row per SYNC_TABLE, wipe APPDATA, reactivate, assert every table has the row locally.

### 4. Block Login screen on first pull completion (fixes J3.6, J1.3 UX)

File: `packages/ui/context/LicenseContext.jsx` + `packages/ui/screens/Login.jsx`. LicenseContext should expose a `firstPullDone` boolean. Login renders a "Syncing your team…" overlay until `firstPullDone=true`. Once true, PIN pad becomes interactive.

Verification: slow-network test (throttle to 3G in DevTools) — user should see "Syncing…" not "PIN incorrecto".

### 5. Restore .p12 cert from Supabase on wipe (fixes J3.4 for e-CF clients)

File: `packages/ui/context/LicenseContext.jsx:161-187` — after pulling `bizSettings.ecf_private_key_pem` + `bizSettings.ecf_certificate_pem`, call a new IPC `dgii:restoreCert(pemKey, pemCert)` that rebuilds a .p12 in `%APPDATA%\terminal-x\cert.p12` so the e-CF flow works immediately after wipe.

Alternative fix: show a large banner on DGII screen "Certificate not installed — reinstall .p12" with direct link.

Verification: wipe APPDATA on an e-CF-certified biz, reactivate, attempt to sign an e-CF → should succeed OR show clear "reinstall .p12" banner.

---

## Go / No-Go decision matrix

- **J1, J4, J7, J8, J9, J12** must be PASS for release.
- **J2** PASS-acceptable with cold-start delay < 5s.
- **J3** PASS required: J3.1, J3.2, J3.3, J3.5, J3.6. J3.4 PASS-acceptable if .p12 banner is shown (cert restore is a v1.10 feature).
- **J5, J11** PASS-acceptable: J5.2/J5.3 deferred to v1.10 (no multi-device customers yet). J11 is internal-only for v1.9.x.
- **J6** PASS required: J6.1, J6.2, J6.3. J6.4 audit before 1.10.
- **J10** PASS-acceptable: WhatsApp support path is documented and sufficient for v1.9.x.

**GO condition:** all PASS-required items verified on a fresh Windows VM with a real Supabase business, at least once end-to-end, recorded for reproducibility.

**NO-GO condition:** any of J1.3 (first activation), J3.6 (wipe → login first try), J4.2 (PIN change survives restart), J6.3 (salary survives restart) fails.
