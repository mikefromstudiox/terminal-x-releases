# Flow Drift Smoke — Layer 4

End-to-end user-action assertions against the live deploy. Walks the SAME
paths a real user takes (encolar → cobrar, mesa addon, void → NCF decrement,
mesa occupied vs byMesa, /pos route resolution) and asserts the DB side
effects match the UI claim.

Catches the silent-success bug class that Layers 1, 2, and 3 cannot see.

## Why this layer exists

| Layer | What it watches | Blind spot |
|-------|------------------|------------|
| L1 — Deploy Smoke (`cron_deploy_smoke`, 15m) | HTTP endpoints, middleware, env vars, static assets | Code that runs at the wrong moment, FK NULLs, silent no-ops |
| L2 — `withReporting` wrappers | Server-side throws | Functions that should run but never get called |
| L3 — Cron Health (`cron_health_verifier`, 30m) | Cron output rows landing in expected tables | User-flow drift (cron didn't fire ≠ user action lied) |
| **L4 — Flow Drift (`cron_flow_drift_smoke`, 15m)** | **DB after a simulated user click** | Anthropic + WhatsApp logic specifically |

## The 2026-05-17 incident it catches

`queue.ticket_id` was NULL on web-created queue rows. `cobrar.markPaid`
silently skipped because the resolver returned NULL. Every "cobrar a queued
ticket" in the UI looked successful — modal closed, ticket disappeared from
cola — but the DB row stayed `status='pendiente'` forever.

- Layer 1 saw `/api/panel?action=stats` return 200. Pass.
- Layer 2 saw no thrown errors (markPaid simply returned early). Pass.
- Layer 3 saw the queue cron drain rows. Pass.
- Layer 4 (S1) asserts: after the resolver runs, `tickets.id` is non-null AND
  the subsequent update flips `status` to `cobrado` on the live row. FAIL.

## Scenarios → bug classes

| Scenario | Walks | Catches |
|----------|-------|---------|
| **S1 — encolar → cobrar** | Insert ticket + queue row with `ticket_id=NULL` (the bug shape), resolve via `ticket_supabase_id`, flip status with `rev+1`, verify both sides moved | Silent `markPaid` skip from FK-NULL resolver returning null. The 2026-05-17 incident. |
| **S2 — mesas append** | Open ticket on test mesa, byMesa lookup (post-0100efe filter shape), append a second `ticket_items` row | Over-aggressive `byMesa` filter that returns NULL when an active cola ticket is present. "Add another beer" flow regression. |
| **S3 — void → NCF decrement** | Synthetic NCF sequence at `current_number=10`, ticket with last-issued NCF, void simulation, assert `current_number` rolled back to 9 | The v2.13 `ncfSequenceDecrementIfLast` invariant. If a trigger or RLS swallows the decrement, NCF gap opens silently. |
| **S4 — mesa occupied parity** | Pendiente ticket on mesa, compare "occupied poll" set to "byMesa" lookup | UI badge says occupied but byMesa returns null. User taps mesa, sees empty state, then sees badge red. Layer 1 cannot see this. |
| **S5 — route resolution** | `/pos/queue` → SPA HTML (DOCTYPE + csp-nonce), random path → catch-all SPA HTML, `/api/panel?action=stats` → NOT SPA HTML | The ff65749 incident class: `api/` mis-routed, SPA catch-all eats endpoints, `/pos` 404s. |

## Run it

```powershell
NODE_OPTIONS=--use-system-ca node scripts/flow-drift-smoke.mjs
# Expect: 5/5 passed
```

Options:
- `--base=https://stage.terminalxpos.com` — point at a non-prod deploy
- `--json` — machine-readable output

Exit codes:
- `0` — all 5 pass
- `1` — one or more failed (script continues, reports all, exits non-zero)
- `2` — script could not run (env, network, etc.)

## Production cron

`/api/panel?action=cron_flow_drift_smoke` (every 15 min via Vercel cron).
- Auth: `Authorization: Bearer $CRON_SECRET` OR `x-vercel-cron-signature` header.
- Writes one row per run to `flow_drift_runs`.
- On any failure: also inserts a `client_errors` row with
  `severity='critical'`, `category='flow_drift.fail'`, full failure list in
  `metadata`. Triggers the existing fan-out (Dashboard alerts + Telegram).

Manual trigger:
```powershell
curl -X POST 'https://terminalxpos.com/api/panel?action=cron_flow_drift_smoke' \
  -H "Authorization: Bearer $env:CRON_SECRET"
```

## Admin surface

Dashboard at `/admin/dashboard` shows the **Flow Drift** card adjacent to
**Deploy Health** and **Cron Health**. Last run, pass/fail counts, click-to-
expand showing the failing scenario, expected vs observed.

History API (admin-gated): `GET /api/panel?action=flow_drift_history&limit=20`.

## Fixture safety

Uses **Demo Car Wash** only (`id=e5fa6fc1-75d1-4bab-8e07-6480de202b1b`).
Every scenario uses a `try/finally` block to DELETE every row it created,
even on assertion failure. `is_test=true` is set on tickets so any future
reporting filter can exclude them. S3's NCF sequence uses a synthetic
`type='FD<6-digit>'` so it never collides with real `B01`/`B02`/`E31`.

## Files

- `scripts/flow-drift-smoke.mjs` — thin CLI runner
- `web/lib/flow-drift-runner.js` — scenario logic (the real harness)
- `lib/flow-drift-runner.js` — mirror for repo-root API functions (Vercel)
- `api/panel.js` / `web/api/panel.js` — `cron_flow_drift_smoke` + `flow_drift_history`
- `migrations/2026_05_17_flow_drift_runs.sql` — results table
- `packages/ui/admin/pages/Dashboard.jsx` — Flow Drift card
