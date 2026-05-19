# Terminal X — Testing & Release-Gate Architecture

> Single source of truth. Supersedes 13 scattered audit docs and 30+ ad-hoc smoke scripts
> consolidated in Waves 1–5 of the audit-consolidation programme (Apr–May 2026).

---

## TL;DR

**One command to ship:**

```bash
NODE_OPTIONS=--use-system-ca node scripts/pre-release.mjs
```

- **2,278 scenarios** across 5 suites + Mega Smoke continuous monitor.
- **Exit 0 = green light.** Ship it.
- **Exit 1 = stop.** A suite failed or unresolved findings exist (override with `--allow-findings`).
- **Exit 2 = pre-flight failure.** env / build / git tree problem — fix infra, retry.

`NODE_OPTIONS=--use-system-ca` is mandatory on Mike's Windows network (TLS interception
breaks Node's bundled CA). The orchestrator auto-injects it, but child processes need it
too — keep it on every invocation.

---

## Architecture at a glance

```
                       scripts/pre-release.mjs            ← NASA gate (one command)
                              │
            ┌─────────┬───────┼────────┬─────────┬──────────┐
            ▼         ▼       ▼        ▼         ▼          ▼
       vertical    schema  security  stress    rls       mega-smoke
       (116)      (709)    (125)    (589)     (1)       (~55 / tick)
            │         │       │        │         │          │
            └─────────┴───────┴────────┴─────────┘          │
                         lib/audit-harness.js               │
                              (386 lines)                   │
                                                            │
              cron every 15min ─────────────────────────────┘
              lib/mega-smoke-runner.js (739 scenarios total)
```

---

## The harness — `lib/audit-harness.js`

The single foundation every suite consumes. Replaces the per-script boilerplate that
was previously copy-pasted across ~15 individual smoke scripts.

### Public API

```js
import { createHarness } from '../lib/audit-harness.js'

const h = createHarness({
  name:           'my-suite',                        // required, printed + stored in mega_smoke_runs
  supabaseUrl:    process.env.SUPABASE_URL,          // required
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY, // required, used for admin queries / demo writes
  anonKey:        process.env.SUPABASE_ANON_KEY,     // required for RLS-denial tests
  accessToken:    process.env.SUPABASE_ACCESS_TOKEN, // pg_catalog queries via Management API
  functionsUrl:   process.env.SUPABASE_FUNCTIONS_URL,// for license-JWT mint (per-business authed clients)
  jsonOutput:     process.env.JSON === '1',          // pretty-text vs single-line JSON
  parallel:       4,                                 // CATEGORIES run concurrently; scenarios within a category are serial
  filter:         'vertical.licoreria',              // prefix or /regex/
  only:           'vertical.licoreria.cobrar_efectivo', // exact id (overrides filter)
  failFast:       false,                             // stop at first failure
  reportCritical: false,                             // escalate failures to client_errors (cron-only)
})

h.scenario('cat.subcat.name', async (ctx) => { /* ... */ })
const result = await h.run()        // → { total, passed, failed, skipped, scenarios: [...] }
process.exit(result.failed > 0 ? 1 : 0)
```

### Scenario context (`ctx`)

| Member | Use |
|---|---|
| `ctx.supabase` | service-role client (admin reads/writes) |
| `ctx.anon` | anon client (RLS-denial assertions) |
| `ctx.businessClient({ licenseKey, machineId })` | per-business authed client (mints license JWT under the hood) |
| `ctx.pgQuery(sql)` | Management API → live `pg_catalog`. **The only acceptable source of schema truth.** |
| `ctx.fixture('ranoza')` | resolves a well-known business by name → `{ id, name, real, vertical, settings }` |
| `ctx.fixtures()` | snapshot of every resolved fixture |
| `ctx.cleanup(fn)` | LIFO cleanup — runs even on failure |
| `ctx.skip(reason)` | mark scenario as skipped (counts as neither pass nor fail) |
| `ctx.uuid()` / `ctx.timestamp()` / `ctx.timing()` | id + clock helpers |
| `ctx.assert / assertEq / assertNotNull / assertSchema` | assertions throw `AssertionError` (reported distinctly from runtime throws) |
| `ctx.expectError(fn, /regex/)` | invert: assert that `fn` throws matching pattern |
| `ctx.mintLicenseJwt(key, machineId)` | Edge Function passthrough — returns full `{ access_token, ... }` bundle |
| `ctx.runMegaSmokeTick({ base, vercelToken })` | inline Mega Smoke from inside any harness scenario |

### Fixtures (resolved once at boot)

Real clients: `perla`, `ranoza`, `crokao`, `carwash_dj`, `sxad`.
Demo tenants: `demo_carwash`, `demo_retail`, `demo_salon`, `demo_restaurant`, `demo_mechanic`,
`demo_dealership`, `demo_foodtruck`, `demo_loans`, `demo_services`, `demo_accounting`,
`demo_licoreria`, `demo_carniceria`.

Never hardcode UUIDs — they vary across environments. Resolve by `businesses.name`.
Missing fixture = fatal at boot, not a silent zero-row query later.

### Env vars

| Var | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | ✅ | service-role + anon clients |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | admin queries + demo data writes |
| `SUPABASE_ANON_KEY` (or `VITE_SUPABASE_ANON_KEY`) | RLS suites | anon-denial assertions |
| `SUPABASE_ACCESS_TOKEN` | schema suite | Management API for `pg_catalog` |
| `SUPABASE_FUNCTIONS_URL` | optional | license-JWT mint for per-business authed clients |
| `VERCEL_TOKEN` | mega-smoke | deploy-state checks |
| `JSON=1` | optional | switch reporter to single-line JSON (consumed by `pre-release.mjs`) |
| `MEGA_SMOKE_CRON=1` | cron only | escalate failures to `client_errors` table + log to `mega_smoke_runs` |

### CLI filter syntax

```bash
node scripts/vertical-suite.mjs                          # everything
node scripts/vertical-suite.mjs --filter=vertical.licoreria   # prefix match
node scripts/schema-suite.mjs  --filter=/uniq_.*itbis/    # /regex/
node scripts/security-suite.mjs --only=security.rls.staff.select.anon_denied
```

### Exit codes

- **0** → all scenarios passed (or skipped).
- **1** → ≥1 scenario failed.
- **2** → harness misconfiguration (missing env, bad fixture spec, etc.).

---

## The 4 suites (Wave 2)

### `vertical-suite` — 116 scenarios

```bash
NODE_OPTIONS=--use-system-ca node scripts/vertical-suite.mjs
```

Covers every vertical's happy path + flow drift + multi-POS coordination + demo health.

**Absorbed (now-deleted) scripts:**
`ranoza-e2e-smoke`, `restaurant-e2e-smoke`, `concesionario-e2e-smoke`, `foodtruck-e2e-smoke`,
`ofertas-e2e-smoke`, `sandbox-demo-smoke`, `demo-e2e-smoke`, `demo-vertical-audit`,
`flow-drift-smoke`, `licoreria-helpers-smoke`, `ranoza-dual-terminal-smoke`, `audit-demos`.

**Categories:** `vertical.licoreria`, `vertical.restaurant`, `vertical.carwash`,
`vertical.dealership`, `vertical.foodtruck`, `vertical.salon`, `vertical.mechanic`,
`vertical.carniceria`, `vertical.accounting`, `vertical.loans`, `vertical.demos`,
`vertical.cross` (dual-terminal + multi-POS coordination + drift).

---

### `schema-suite` — 709 scenarios

```bash
NODE_OPTIONS=--use-system-ca node scripts/schema-suite.mjs
```

Live `pg_catalog` drift detection — constraint shapes, FK direction, index types, RLS
policy bodies, trigger presence, function signatures, materialised-view freshness.

**Absorbed (now-deleted) scripts:**
`fresh-install-schema-audit`, `dupe-audit`, `dupe-audit-targeted`, `audit-carniceria-deep`,
`audit-mechanic-schema`, `pg17-audit-inspect`, `scale-test-audit`, `audit-flows`.

**Categories:** `schema.constraints`, `schema.indexes`, `schema.fks`, `schema.rls`,
`schema.triggers`, `schema.functions`, `schema.realtime_publication`,
`schema.dupes`, `schema.materialized_views`, `schema.partitions`.

**Hard rule:** every finding here MUST be backed by a live `ctx.pgQuery(...)` against
`pg_catalog`. Code-grep diagnoses are forbidden — they've shipped wrong fixes 3+ times.

---

### `security-suite` — 125 scenarios

```bash
NODE_OPTIONS=--use-system-ca node scripts/security-suite.mjs
```

RLS denial, tenant isolation, PIN strength, JWT claim shape, token leak surface, e-CF
parent-acceptance gate, manager-auth pathways.

**Absorbed (now-deleted) scripts:**
`rls-systemwide-audit`, `tenant-isolation-smoke`, `pin-e2e-audit`, `ecf-parent-gate-smoke`.

**Categories:** `security.rls`, `security.tenant_isolation`, `security.pin`,
`security.jwt`, `security.ecf_gate`, `security.pii`, `security.manager_auth`.

---

### `stress-suite` — 589 scenarios

```bash
NODE_OPTIONS=--use-system-ca node scripts/stress-suite.mjs
```

Load, adversarial, property-based, regression coverage for every shipped bug-fix patch.

**Absorbed (now-deleted) scripts:** every `scripts/_test_fix_*.mjs` (17 files) and
every `scripts/_test_followup_*.mjs` (3 files).

**Categories:** `stress.load`, `stress.adversarial`, `stress.property`,
`stress.regression.*` (one per shipped fix A–TAA).

---

## The NASA gate — `scripts/pre-release.mjs`

```bash
NODE_OPTIONS=--use-system-ca node scripts/pre-release.mjs
```

### Pre-flight checks (exit 2 on any fatal)

1. `.env` has `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `VITE_SUPABASE_ANON_KEY`.
2. `git status --porcelain` clean (override: `--allow-dirty`).
3. Current branch is `main` (override: `--allow-branch`).
4. `package.json` version > latest tag (override: `--allow-version`).
5. `npm run build:web` succeeds (skip: `--skip-build`).

### Suite orchestration

Each suite spawns as its own child process for memory isolation; all run in parallel
by default. Output is parsed from the trailing `{...}` JSON line each suite emits
(`JSON=1` env var injected).

### CLI flags

| Flag | Effect |
|---|---|
| `--only=vertical,schema` | run subset (`vertical,schema,security,stress,rls,mega`) |
| `--parallel=N` | concurrent suites (default = all in parallel) |
| `--bail` | stop scheduling on first failure |
| `--allow-findings` | treat suite failures as warnings (green light still possible) |
| `--allow-dirty` / `--allow-branch` / `--allow-version` | bypass pre-flight gates |
| `--skip-build` | skip `npm run build:web` |
| `--json` | aggregate JSON to stdout (machine-consumable) |

### Legacy bridge

`scripts/rls-policy-audit.mjs` is invoked as a suite. It prints human text rather than
JSON, so `pre-release.mjs` synthesises a summary from its exit code + violation count
match. Migrate it to harness JSON output when convenient — no urgency.

---

## Continuous monitoring — `lib/mega-smoke-runner.js`

```bash
NODE_OPTIONS=--use-system-ca node scripts/mega-smoke.mjs           # one tick locally
# Production: cron every 15 min via api/panel.js?action=cron_mega_smoke
```

**739 scenarios total** spanning infra, flow drift, cron freshness, e-CF queue health,
NCF allocator concurrency, sync latency, demo tenant integrity.

- **Tick latency:** ~30–55s per run.
- **Escalation:** `MEGA_SMOKE_CRON=1` writes failures to `client_errors` via
  `lib/report-server-error.js` and logs the run summary to `mega_smoke_runs`.
- **Throttling:** identical errors deduped on 60-min window before re-raising.
- **Drift classes caught:** NCF sequence stalls, e-CF parent-rejection backlog,
  sync `updated_at` skew between SQLite and Supabase, anon RLS regression, demo tenant
  drift (e.g. category renames breaking the demo POS), JWT claim drift.

---

## How to add a scenario

```js
h.scenario('vertical.<vertical>.<flow>.<assertion>', async (ctx) => {
  const biz = ctx.fixture('ranoza')

  // 1. Set up — REGISTER cleanup BEFORE the mutation runs.
  const ticketId = ctx.uuid()
  ctx.cleanup(async () => {
    await ctx.supabase.from('tickets').delete().eq('id', ticketId)
  })

  // 2. Act.
  const { error } = await ctx.supabase.from('tickets').insert({
    id: ticketId,
    business_id: biz.id,
    /* ... */
  })
  ctx.assertNotNull(!error, `insert failed: ${error?.message}`)

  // 3. Verify via live read OR pg_catalog.
  const rows = await ctx.pgQuery(`SELECT count(*) FROM tickets WHERE id = '${ticketId}'`)
  ctx.assertEq(Number(rows[0].count), 1, 'ticket persisted')
})
```

### Naming conventions

- `<suite>.<category>.<subcategory>.<flow>.<assertion>` — dot-separated, lower-snake.
- Filter prefixes target the join points: `vertical.licoreria`, `schema.rls.staff`, etc.

### Cleanup rules

- LIFO — last registered runs first.
- Cleanup ALWAYS runs (success, failure, or thrown). Never put assertions in cleanup.
- Suite must leave **zero trash**. If you can't clean up, register a global orphan
  cleanup via the harness's exposed orphan queue.

---

## How to read a failure

```
✗ vertical.licoreria.cobrar_efectivo.ncf_advances
    AssertionError: expected B01 sequence to advance by 1
    expected: 12345
    observed: 12344
    pg_query: SELECT current_number FROM ncf_sequences WHERE ...
    cleanup: ok (3 ops, LIFO)
```

1. **Read the assertion line** — it names the invariant that failed.
2. **Compare expected vs observed.** Match them in the live DB before assuming a code bug.
3. **Reproduce the `pg_query`** — paste it into the Management API console.
4. **If the finding is known + tracked,** add `--allow-findings` and ship. Otherwise
   bail and fix.

### Decision flow

| Symptom | Action |
|---|---|
| Suite fails on a NEW assertion you've never seen | STOP. Investigate. Don't `--allow-findings`. |
| Pre-flight blocks on `version_unbumped` and you really did bump | check `package.json` version vs `git describe --tags --abbrev=0` |
| `vertical-suite` fails on a demo tenant only | check `scripts/heal-demo-vertical-keys.mjs` ran recently |
| `schema-suite` flags a constraint that "looks right in migrations/" | trust `pg_catalog`, not the migration file. Migrations drift. |
| `security-suite` reports RLS regression | run `node scripts/rls-policy-audit.mjs` for the human-readable view |
| `stress-suite` fails on a `_test_fix_*` regression you thought was fixed | bug came back. Don't ship. |

---

## Hard rules (cross-refs to `CLAUDE.md`)

1. **Audit findings verify via `pg_catalog`.** Code-grep alone is insufficient and has
   shipped wrong fixes 3+ times (partial-unique-index ghost, `app_metadata` swap that
   was already applied, `atomic_next_ncf` "broken signature" that was correct).
2. **Mutations use `tryWrite`, never `tryOr`.** Scenario writes follow the same rule —
   suite scaffolding does not wrap inserts in `tryOr`, ever.
3. **`mesas` and `tickets` status mutations need `rev: OLD_REV + 1`.** Triggers reject
   anything else. Scenario writes that update status must read-then-bump.
4. **Per-item itbis = `price - price / (1 + factor)`** (embedded extraction from gross).
   Never `price * factor`. Tests assert the embedded form.
5. **`supabase_id` is mandatory** on every synced-table insert. Scenarios that bypass
   this break the sync invariant the suite is meant to enforce.
6. **`app_metadata.business_id` is the canonical JWT claim** for RLS. Never test
   `user_metadata` — it's client-modifiable.
7. **No `console.log` for diagnostics** — use `ctx.log()`. Survives JSON mode and
   feeds the per-scenario log buffer.

---

## Findings backlog (live)

> 38 findings surfaced by the inaugural Wave 1–4 run (2026-05-18). Mike + Claude review
> each before flipping to `✅`. **Pre-release gate runs with `--allow-findings`
> until this table is empty.**

| # | Suite | Scenario | Severity | Status | Notes |
|---|---|---|---|---|---|
| 1  | schema    | `schema.constraints.tickets.uq_biz_ncf`            | high   | ✅ | landed in v2.17.0 |
| 2  | schema    | `schema.constraints.cuadre_caja.one_open_per_day`  | high   | ✅ | landed in v2.17.0 |
| 3  | schema    | `schema.rls.staff.select.anon_denied`              | high   | ✅ | 2026-04-19 fix |
| 4  | schema    | `schema.rls.activity_log.legacy_my_business_ids`   | med    | ✅ | dropped 2026-04-29 |
| 5  | schema    | `schema.indexes.brin_to_btree.tickets_created_at`  | low    | ✅ | v2.16.8 PG17 sprint |
| 6  | schema    | `schema.functions.atomic_next_ncf.deprecated`      | low    | ⏳ | tracked in MIGRATION-AUDIT §2.8; no live caller |
| 7  | schema    | `schema.partitions.activity_log.coverage`          | low    | ⏳ | partition rollout incomplete |
| 8  | schema    | `schema.materialized_views.commissions.freshness`  | med    | ⏳ | nightly refresh job, gap during DST |
| 9  | security  | `security.rls.accounting_clients.jwt_path`         | high   | ✅ | 2026-05-03 sweep |
| 10 | security  | `security.rls.carniceria_*.jwt_path`               | high   | ✅ | 2026-05-03 sweep |
| 11 | security  | `security.rls.inventory.jwt_path`                  | high   | ✅ | 2026-05-03 sweep |
| 12 | security  | `security.rls.promotions.jwt_path`                 | high   | ✅ | 2026-05-03 sweep |
| 13 | security  | `security.pin.bcrypt_cost`                         | med    | ✅ | sprint10 |
| 14 | security  | `security.pin.weak_pin_block`                      | med    | ✅ | fix_C |
| 15 | security  | `security.jwt.business_id_claim_present`           | high   | ✅ | 2026-04-29 swap |
| 16 | security  | `security.ecf_gate.parent_acceptance`              | high   | ✅ | proven 2026-04-30 |
| 17 | security  | `security.tenant_isolation.cross_business_read`    | high   | ✅ | last green run |
| 18 | security  | `security.manager_auth.void_fired_kitchen`         | med    | ✅ | v2.16.3 |
| 19 | vertical  | `vertical.licoreria.deposit_return`                | med    | ✅ | v2.13 |
| 20 | vertical  | `vertical.restaurant.servicio_10_pct`              | med    | ✅ | v2.16.3 |
| 21 | vertical  | `vertical.restaurant.mesa_rev_guard`               | med    | ✅ | rev trigger live |
| 22 | vertical  | `vertical.dealership.uaf_modal`                    | med    | ✅ | v2.16.2 |
| 23 | vertical  | `vertical.dealership.e31_rnc_guard`                | high   | ✅ | v2.16.2 |
| 24 | vertical  | `vertical.salon.preferred_stylist_gate`            | low    | ✅ | v2.16.1 |
| 25 | vertical  | `vertical.carniceria.freshness_alert`              | low    | ⏳ | freshness window too generous |
| 26 | vertical  | `vertical.foodtruck.offline_queue_drain`           | med    | ⏳ | drains, but with 30s latency spike |
| 27 | vertical  | `vertical.cross.dual_terminal_ncf_collision`       | high   | ✅ | v2.17.0 |
| 28 | vertical  | `vertical.demos.heal_drift`                        | low    | ⏳ | heal script idempotent, needs cron |
| 29 | stress    | `stress.regression.fix_G.journal_balance`          | high   | ✅ | phase-3 spine |
| 30 | stress    | `stress.regression.fix_H.itbis_check`              | high   | ✅ | per-item itbis fix |
| 31 | stress    | `stress.regression.fix_P.silent_zero_row`          | med    | ✅ | sweep landed |
| 32 | stress    | `stress.property.ncf_allocator.no_inmem_fallback`  | high   | ✅ | tryWrite enforced |
| 33 | stress    | `stress.adversarial.csp_strict_dynamic`            | high   | ✅ | nonce middleware live |
| 34 | stress    | `stress.load.sync_merge_upsert.p99`                | low    | ⏳ | acceptable, monitor for v2.17+ |
| 35 | mega      | `mega.cron.deploy_smoke.freshness`                 | low    | ⏳ | falls behind on Sun maintenance window |
| 36 | mega      | `mega.flow.signup_to_pos.latency`                  | low    | ⏳ | 95p > 4s during US East peak |
| 37 | mega      | `mega.ecf.parent_queue.backlog`                    | med    | ⏳ | watch — DGII certecf has been flaky |
| 38 | mega      | `mega.realtime.publication.lag`                    | low    | ⏳ | logical replication lag spikes |

Legend: ✅ closed, ⏳ open (tracked), 🔥 critical (would block release).

---

## What was replaced

### Docs absorbed (delete after review)

- `docs/AUDIT-01-SYNC.md` → `vertical-suite` (sync flows) + `schema-suite` (sync invariants)
- `docs/AUDIT-02-AUTH.md` → `security-suite` (JWT, PIN, RLS) + `stress-suite` (regression)
- `docs/AUDIT-03-SETTINGS.md` → `vertical-suite.vertical.demos` + `schema-suite.schema.rls.app_settings`
- `docs/AUDIT-04-SCHEMA.md` → `schema-suite` (every category)
- `docs/AUDIT-05-JOURNEYS.md` → `vertical-suite` (per-vertical happy paths)
- `docs/AUDIT-PROMPT-v2.2.md` → folded into "How to add a scenario" above
- `docs/SILENT-FAILURE-AUDIT-2026-05-01.md` → `stress-suite.regression.fix_P` + harness
  `tryWrite` discipline (rule #2 above)
- `docs/MIGRATION-AUDIT-2026-05-01.md` → `schema-suite` (LIVE/SUPERSEDED/PARTIAL flags
  now derived from `pg_catalog`, not maintained by hand)
- `docs/SETTINGS-PERSISTENCE-AUDIT-2026-05-01.md` → `vertical-suite.demos` + harness
  `app_settings.sync` scenarios
- `docs/DEMO-AUDIT-REPORT.md` → `vertical-suite.vertical.demos`
- `docs/DEMO-VERTICAL-AUDIT-2026-05-08.md` → `vertical-suite.vertical.demos.heal_drift`
- `docs/ACTION-VERIFICATION-AUDIT-2026-05-01.md` → harness `expectError` + "How to add"
- `docs/MEGA-SMOKE.md` → "Continuous monitoring" section above
- `docs/FLOW-DRIFT-SMOKE.md` → folded into `vertical-suite.vertical.cross`

### Kept (intentionally separate)

- `docs/CLAUDE-TRIAGE.md` — Claude memory triage workflow
- `docs/MEMORY-AUDIT-2026-05-01.md` — Claude-memory specific, not testing
- `docs/CONSOLIDATED-FIX-PLAN.md` — fix ledger (forward-looking)
- `docs/FIX-LEDGER-2026-04-30.md` — historical fix log
- `docs/SCHEMA-SNAPSHOT.md` — read FIRST for any schema-claim diagnosis; the live deployed shape
- `docs/RELEASE-CHECKLIST.md` — ops runbook, references this doc
- `docs/GO-LIVE-CHECKLIST.md` — onboarding ops
- `docs/SECURITY-BASELINE.md` — policy doc, not a test
- `docs/TROUBLESHOOTING.md` — user-facing
- `docs/DEPLOY-SMOKE-TEST.md` — describes the production cron mirrored in `api/panel.js`

### Scripts kept (have unique callers or independent value)

- `scripts/rls-policy-audit.mjs` — legacy bridge until JSON mode lands (`pre-release.mjs` parses it)
- `scripts/_harness-self-test.mjs` — smoke-test for the harness itself
- `scripts/mega-smoke.mjs` — CLI entry to `lib/mega-smoke-runner.js`
- `scripts/_audit_query.mjs` — ad-hoc query playground (humans only)
- `scripts/deploy-smoke-test.mjs` — production cron mirror (referenced by `api/panel.js`)
- `scripts/smoke-ofx.mjs` — OFX import smoke (independent of audit suites)
- `scripts/smoke-test-build.cjs` — electron post-build smoke (`npm run dist:win`)
- `scripts/fix-stringified-business-settings.mjs` — one-shot data fixer
- `scripts/ticket-sweep-dryrun.mjs` / `ticket-sweep-execute.mjs` — one-shot maintenance
