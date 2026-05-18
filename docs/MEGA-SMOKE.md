# MEGA SMOKE (Layer 6)

The comprehensive drift + silent-bug net. Built 2026-05-17 after a single
auto-deploy upgrade produced five silent infra failures + three silent
data-drift bugs in the same six-hour window.

- **Runner**: `web/lib/mega-smoke-runner.js` (pure module, same code in CLI + cron)
- **CLI**: `node scripts/mega-smoke.mjs`
- **Cron**: `/api/panel?action=cron_mega_smoke` every 15 min (`vercel.json`)
- **Audit table**: `mega_smoke_runs` (cron writes one row per run)
- **Failure escalation**: each unique failure → `client_errors` `severity='critical'` `category='mega_smoke.<scenario_id>.fail'` → Layer 5 (`cron_claude_triage`) diagnoses + WhatsApps Mike
- **Throttle**: max 5 distinct critical escalations per run; beyond that rolled into one summary critical so Mike still gets one WhatsApp ("...and N more")
- **Dashboard card**: lives in `packages/ui/admin/pages/Dashboard.jsx` — green at 100%, yellow at 1-3 failures, red at 4+

## Bug-class → scenario coverage map

Every silent failure that hit prod on 2026-05-17 maps to a Layer 6 scenario:

| Incident | Scenario(s) that would have caught it |
|---|---|
| middleware off / nonce never replaced | `infra.middleware_nonce_match` |
| `/pos` 404 | `infra.spa_pos` |
| `/api/*` 405 | `infra.api_*` (every endpoint) |
| CSP nonce desync from edge cache | `infra.middleware_nonce_match` + `infra.cdn_no_store_html` |
| `VITE_SUPABASE_*` missing | `infra.bundle_env_baked` + `env.vercel_vite_supabase_url` |
| `queue.ticket_id` NULL → silent markPaid skip | `schema.queue_ticket_id_uuid` + `flow.<vertical>.ticket_create_cobrar` (which we already had in Layer 4 — Layer 6 expands per-vertical) |
| `CAR WASH DJ` provisioned with name `STUDIO X SRL` | (manual provisioning-time check — out of scope; see `feedback_provisioning_must_be_complete.md`) |
| NCF B02 not enabled at provisioning | (provisioning-time check — see Layer 6 v2 if it recurs) |
| `client_errors.severity` CHECK rejecting `'critical'` | `schema.client_errors_severity_critical` |
| RLS policy referencing `user_metadata` (client-modifiable) | `rls.tickets_policy_uses_app_metadata` |
| Feature key leaks across plan tiers | `plan.exclusivity_*` |
| Cron schedule deleted from vercel.json | `cron.recent_run_*` |
| Synced table missing `supabase_id` / `updated_at` | `schema.sync_<tbl>_supabase_id` / `_updated_at` |
| Realtime publication missing critical table | `schema.realtime_*` |
| DGII semilla endpoint dead | `ecf.semilla_returns_signed_xml` |

## Categories

| Category | What it asserts |
|---|---|
| `infra.*` | SPA routes 200, API endpoints routed to functions (not SPA HTML, not 405), CSP nonce match, bundle has envs, static assets correct content-type, `report_error` round-trip |
| `env.*` | Required Vercel env vars present in production target. **Skipped in cron context** (no `VERCEL_TOKEN`). Runs from CLI when `.env` has `VERCEL_TOKEN`. |
| `schema.*` | Critical columns exist with correct types, sync invariants (`supabase_id` + `updated_at` on every synced table), realtime publication membership, CHECK constraints allow `'critical'` severity. Uses Management API → `pg_catalog`. **Skipped without `SUPABASE_ACCESS_TOKEN`**. |
| `rls.*` | Every RLS-enabled table has ≥1 policy. Policies on `tickets` reference `app_metadata.business_id` (the canonical JWT claim per `feedback_app_metadata_canonical_jwt_claim.md`), never `user_metadata` (client-modifiable). |
| `flow.*` | For every demo business (looked up at runtime, never hardcoded): create a ticket → mark cobrado → verify status landed. Update a ticket → verify `updated_at` trigger fires. Catches every "UI claims success, DB never changed" class. |
| `mesas.*` | `byMesa` returns open tickets across carwash + restaurant demos. Catches the 0100efe regression class. |
| `contabilidad.*` | `accounting_clients` table reachable with `access_granted` column. `/admin/aceptar-contador/:token` resolves to SPA HTML (not 404). |
| `plan.*` | `PLAN_FEATURES` in `usePlan.jsx` contains expected reference keys per tier. Exclusivity guards: `tables_addon` / `restaurant_mode` on Pro PLUS+, `remote_dashboard` / `multi_location` / `nomina_advanced` / `intrant_api` / `contabilidad_portfolio` on Pro MAX only. |
| `cron.*` | Every cron in `vercel.json` has a recent side-effect row (downstream table updated within its expected window). Mirrors Layer 3 logic but covers all crons. |
| `ecf.*` | DGII semilla endpoint returns signed XML. |

## Hard rules

- **NEVER touches non-Demo business data**. The runner looks up all targets at runtime via `SELECT … FROM businesses WHERE name ILIKE 'Demo %'` and validates the prefix per write. Real clients (Studio X SRL, Ranoza, Crokao, CAR WASH DJ, Perla, etc.) are untouchable.
- **Per-scenario 10s timeout** via `Promise.race`. A hung scenario does not freeze the whole run.
- **Unconditional cleanup** via try/finally per scenario. Every insert has a matching delete in the same block.
- **Skipped scenarios count as pass** for harness exit code. A scenario that legitimately cannot run (missing token, no demo fixture) reports `skip:true` with a detail.

## Adding a new scenario

1. Pick a category (or add a new one — convention is one builder fn per category).
2. In `web/lib/mega-smoke-runner.js`, push to the relevant `buildXxxScenarios()`:
   ```js
   out.push({
     id: 'category.subcategory_specific_thing',
     category: 'category',
     name: 'Human-readable assertion (under 80 chars)',
     fn: async () => {
       // Do the check. Return one of:
       //   { ok: true, detail: 'optional context' }
       //   { ok: false, expected: '...', observed: '...' }
       //   { ok: true, skip: true, detail: 'why skipped' }
     },
   })
   ```
3. If it writes to Supabase, use try/finally and delete what you inserted.
4. Run `node scripts/mega-smoke.mjs --category=<category>` to test in isolation.
5. Commit. Cron picks it up on the next run.

## Verification commands

```bash
# Local run against prod
NODE_OPTIONS=--use-system-ca node scripts/mega-smoke.mjs

# JSON output (machine-readable)
NODE_OPTIONS=--use-system-ca node scripts/mega-smoke.mjs --json

# Single category
NODE_OPTIONS=--use-system-ca node scripts/mega-smoke.mjs --category=schema

# Manually trigger the cron action
curl -X POST "https://terminalxpos.com/api/panel?action=cron_mega_smoke" \
  -H "Authorization: Bearer $CRON_SECRET"

# Read the latest run row
curl -s "https://api.supabase.com/v1/projects/csppjsoirjflumaiipqw/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT ran_at, source, passed_count, failed_count, total_count, duration_ms, whatsapp_sent_count FROM mega_smoke_runs ORDER BY ran_at DESC LIMIT 5;"}'
```
