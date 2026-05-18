# Claude Triage (Layer 5) — Runbook

**Status:** shipped 2026-05-17
**Owner:** Mike (admin@terminalxpos.com)
**Cron:** `/api/panel?action=cron_claude_triage` every 2 min (Vercel)

## What it does

Every 2 minutes the cron picks up any *new* critical incident from the four
existing observability layers and calls the Anthropic API for a structured
root-cause diagnosis. The diagnosis is written back to the source row and
surfaced inline on the Admin Dashboard. For `client_errors` with
`severity='critical'`, a WhatsApp alert is also fired to Mike.

| Layer | Source | What gets triaged |
|---|---|---|
| 2 | `client_errors` | `severity='critical'` AND no `metadata.claude_diagnosis` yet, created in the last 15 min |
| 1 | `deploy_smoke_results` | `failed_count > 0` AND `claude_diagnosed_at IS NULL`, last 15 min |
| 3 | `cron_health_runs` | `failed_count > 0` AND `claude_diagnosed_at IS NULL`, last 15 min |
| 4 | `flow_drift_runs` | `failed_count > 0` AND `claude_diagnosed_at IS NULL`, last 15 min |

Hard cap: **10 events per run** (5 per source). Anthropic model:
`claude-haiku-4-5-20251001`, `max_tokens=1024`, `temperature=0`.

## Where the diagnosis lands

- **`client_errors`:** appended at `metadata.claude_diagnosis` (no schema change).
- **`deploy_smoke_results` / `cron_health_runs` / `flow_drift_runs`:** dedicated
  `claude_diagnosis JSONB` column + `claude_diagnosed_at TIMESTAMPTZ` marker.

Diagnosis shape (model is asked for pure JSON):
```json
{
  "likely_cause": "one sentence",
  "confidence": "low | medium | high",
  "suspected_commit": "sha or 'none'",
  "suspected_files": ["path1", "path2"],
  "next_step": "one actionable sentence",
  "user_impact": "one sentence — who is affected and what they cannot do"
}
```

If the model returns non-JSON, the raw text is stored at
`claude_diagnosis.raw_text` with `parse_failed: true` so the gap is visible.

## WhatsApp escalation

For `client_errors` severity=`critical` only. Sender uses the same UltraMsg
transport as the rest of the product but a **dedicated internal alert
instance** so a client's expired UltraMsg subscription can't break Mike's
alerts.

Required Vercel env:
- `TX_ALERT_ULTRAMSG_INSTANCE` (e.g. `instance123456`)
- `TX_ALERT_ULTRAMSG_TOKEN`
- `TX_ALERT_WHATSAPP_TO` (optional, defaults to `+18098282971`)

If unset, the cron still runs and writes diagnoses — it just inserts a
`severity='warning'` `client_errors` row with
`category='claude.triage.whatsapp_skipped'` so the gap is auditable on the
Dashboard instead of failing silently.

## Cost ballpark

Haiku 4.5 input ≈ \$0.0008/1K tokens, output ≈ \$0.004/1K tokens. Each prompt
~1.5K in / ~0.3K out ≈ **\$0.002/triage**. Worst case 10/run × 30 runs/h × 24h
= ~**\$14.40/day**. Realistic case (a few critical/hour) ≈ **\$0.50–\$2/day**.

## How to disable

- **Soft:** set `ANTHROPIC_API_KEY` to empty string in Vercel env. Cron still
  runs but skips Claude calls and records `skipped: true` in the response.
- **Hard:** remove the `cron_claude_triage` entry from `vercel.json` and
  redeploy.

## Required Vercel env vars

| Var | Required? | What happens if missing |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Cron returns `skipped: true`, no diagnosis written |
| `CRON_SECRET` | Yes (already set) | 401 on manual `curl` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Yes (already set) | 500 |
| `TX_ALERT_ULTRAMSG_INSTANCE` | Optional | WhatsApp skipped, gap logged as `warning` |
| `TX_ALERT_ULTRAMSG_TOKEN` | Optional | same |
| `TX_ALERT_WHATSAPP_TO` | Optional | defaults to `+18098282971` |

## Manual triggers

```bash
# Force a run (idempotent — returns 200 even with no events):
curl -X POST "https://terminalxpos.com/api/panel?action=cron_claude_triage" \
  -H "Authorization: Bearer $CRON_SECRET"

# Browse history (admin JWT required):
curl "https://terminalxpos.com/api/panel?action=claude_triage_history&limit=20" \
  -H "Authorization: Bearer $ADMIN_JWT"
```

## Migration

`migrations/2026_05_17_claude_triage.sql` — additive only (`ADD COLUMN IF NOT
EXISTS` + partial indexes for fast "next undiagnosed" lookup). Safe to re-run.

## Admin Dashboard surface

A "Triage Claude" card sits directly above the Recent Errors card and shows:
- Count diagnosed in the last 24h
- The most recent diagnosis inline (cause + confidence + next step)
- Click "Ver historial" to expand the last 20 diagnosed events across all 4 sources
- Amber badges if `ANTHROPIC_API_KEY` or WhatsApp creds are missing in env

Each row in Recent Errors with a `metadata.claude_diagnosis` also renders the
diagnosis inline (cause / next / impact) inside a red-tinted panel.

## Out of scope

- No auto-fix. Diagnosis only — human acts.
- Not exposed to non-admin users (admin JWT gated via `requireAdmin`).
- Not triggered for `severity='info' | 'warning' | 'error'` — would burn budget
  and dilute signal.
