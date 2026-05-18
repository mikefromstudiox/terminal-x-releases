# Cron Health Verifier (Layer 3)

Three-layer defense against silent prod failures:

| Layer | Catches | Implementation |
|---|---|---|
| 1 | HTTP endpoint down / 5xx | `cron_deploy_smoke` every 15 min → `deploy_smoke_results` |
| 2 | Handler throws / exception | `withReporting()` wrapper in `web/api/lib/report-server-error.js` |
| 3 | Handler returns 200 but no downstream side-effect | **this file** — `cron_health_verifier` every 30 min → `cron_health_runs` |

## Why Layer 3 exists

Layer 1 only proves an endpoint *responded*. Layer 2 only catches *thrown* errors. Neither catches the scenario where a cron returns `{ ok: true }` but the actual business output never landed — e.g. `digest/daily` 200s but Resend is misconfigured, `cron_dgii_pull` 200s but the scraper stub returns 0 rows, `anecf-drain` 200s but no queue rows ever update.

Layer 3 watches the **downstream side-effect table** of every scheduled cron. If the expected row is stale beyond the cron's window, it's a silent failure — escalate.

## Verifications

| ID | Cron | Schedule | Side-effect table | Column | Window |
|---|---|---|---|---|---|
| V1 | `/api/digest/daily` | `0 13 * * *` | `activity_log` where `event_type='daily_digest_sent'` | `created_at` | 26h |
| V2 | `/api/panel?action=cron_dgii_pull` | `0 7 * * *` | `client_dgii_credentials` where `status='active'` | `last_pull_at` | 26h |
| V3 | `/api/panel?action=anecf-drain` | `0 */6 * * *` | `anecf_queue` | `updated_at` | 8h |
| V4 | `/api/panel?action=cron_deploy_smoke` | `*/15 * * * *` | `deploy_smoke_results` where `source='cron'` | `ran_at` | 30 min |

**No-work-to-do is NOT a failure.** V2 passes if no active creds exist; V3 passes if the queue is empty. Detail string explains which path was taken.

## Failure handling

Each failure writes:
- 1 row to `client_errors` (`severity='critical'`, `category='cron.output.missing'`, `metadata.cron_path` + `observed_at` + `detail` + `verifier_run_at`). This routes through the existing `fireCriticalAlert` Slack pipeline.
- 1 entry in the `failures` JSONB array of the run's `cron_health_runs` row.

Successes never write to `client_errors` (would flood). Each verifier RUN writes exactly one `cron_health_runs` row with pass/fail counts.

## How to interpret a fail

> `Cron output missing: /api/panel?action=cron_dgii_pull last observed 2026-05-15T07:00:42Z; expected within 26h`

The cron itself may have run and returned 200. The actual downstream side-effect (a `last_pull_at` update) didn't happen. Next steps:

1. Check Vercel function logs for the cron's most recent invocation — was it 200? Did it log warnings?
2. Run the cron manually with the CRON_SECRET:
   ```
   curl -X POST "https://terminalxpos.com/api/panel?action=cron_dgii_pull" \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
3. Inspect the response — `processed: 0` means no active credentials (legitimate empty) but Layer 3 only flags V2 if active creds DO exist.
4. For V1 (digest), the most common cause is `RESEND_API_KEY` env missing — daily.js continues running and 200s but no email + no `daily_digest_sent` row (it actually does write the activity_log row regardless of email success, so a missing row means the entire handler didn't reach line 244).

## Manual trigger

```
curl -X POST "https://terminalxpos.com/api/panel?action=cron_health_verifier" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Returns `{ ok, ran_at, total, passed, failed, duration_ms, results[] }`.

Admin dashboard pulls the last 20 runs via `/api/panel?action=cron_health_history`.

## Adding a new verification

Open `web/api/panel.js`, find `_CRON_HEALTH_SPEC` array, append:

```js
{
  cron_path: '/api/panel?action=YOUR_NEW_CRON',
  expected_within_hours: 2,
  schedule: '*/30 * * * *',
  side_effect: 'your_table.column',
  async check(sb) {
    const { data, error } = await sb.from('your_table')
      .select('updated_at').order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (error) return { ok: false, observed_at: null, detail: `query_error: ${error.message}` }
    const observed_at = data?.updated_at || null
    if (!observed_at) return { ok: false, observed_at: null, detail: 'never observed' }
    const ageH = (Date.now() - new Date(observed_at).getTime()) / 3600000
    return { ok: ageH <= 2, observed_at, detail: `${ageH.toFixed(1)}h ago` }
  },
},
```

Rules:
- Always verify the side-effect table/column against `pg_catalog` via Management API BEFORE adding the verification — code-grep on a handler can be wrong.
- Distinguish "no work to do" from "should have run but didn't". Empty queue is not a failure.
- Window = schedule interval + 2h buffer minimum, to absorb Vercel cron jitter.
