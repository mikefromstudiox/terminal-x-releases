# Deploy smoke test — Layer 1

**Created:** 2026-05-17 (post-incident ff65749)
**Owner:** Terminal X infra
**Sister docs:** `Terminal X/CLAUDE.md` (architecture), `migrations/2026_05_17_deploy_smoke_results.sql`

## The incident this exists to prevent

On 2026-05-17 19:19 UTC, commit `ff65749` ("auto-deploy upgrade") silently broke production for ~6 hours. Five distinct failures stacked, each silent because the error-reporting pipeline itself was one of the broken pieces:

| # | Failure | Why it was silent |
|---|---|---|
| 1 | `web/middleware.js` lived in `dist-web/` instead of repo root, so Vercel never detected it. CSP `__CSP_NONCE__` literals were never replaced. | strict-dynamic CSP blocked every script. Browser console errors never reached `window.__txReportError` because Supabase client never loaded. |
| 2 | Root `vercel.json` had no SPA rewrites → `/pos` → 404. | Plain 404 page, no script context. |
| 3 | All `/api/*` returned 405 because functions lived in `dist-web/api/` and the SPA catch-all rewrite served `index.html` as fallback. | `report_error` returned HTML, so even when JS DID run, the error POST landed as a 405. |
| 4 | CSP nonces desynced between cached body and fresh header. | strict-dynamic rejected every script. |
| 5 | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` missing from Vercel env → bundle had no Supabase client → infinite spinner. | No client → no auth → no telemetry. |

Owner quote: **"i dont even want this to happen again if it does we know where it happened"**.

## What this catches

`scripts/deploy-smoke-test.mjs` runs 6 categories of checks. Each is independent (one failure does not skip the others). The script exits non-zero on any failure, so CI / cron alerts.

| Cat | Checks | Catches incident # |
|---|---|---|
| **A. SPA bootstrap** | GET /pos → 200, text/html, references `/assets/index-*.js`, 0 `__CSP_NONCE__` literals, CSP header nonce == body nonce, bundle 200 + JS ct + >1KB | 1, 2, 4 |
| **B. Env-var injection** | Bundle bytes contain `csppjsoirjflumaiipqw.supabase.co` and the anon JWT header `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9` | 5 |
| **C. API routing** | POST to all 8 critical endpoints (`/api/panel?action=report_error`, `/api/fe?action=semilla`, `/api/validate`, `/api/rnc`, `/api/ecf-sign`, `/api/staff-verify-auth`, `/api/signup/lead`, `/api/dgii-cert-upload`) — must NOT 405, must NOT serve `text/html` | 3 |
| **D. report_error round-trip** | POST a stamped error, expect `{ ok:true, id }`, then read back from `client_errors` via Management API within 10s | the silent-failure canary itself |
| **E. Vercel env presence** | (Local only — needs `VERCEL_TOKEN`.) Verifies `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `CRON_SECRET`, `DGII_CERT_PEM`, `DGII_KEY_PEM`, `RESEND_API_KEY` configured for production | 5 (pre-emptive) |
| **F. Static assets** | `/sitemap.xml`, `/robots.txt`, `/og-image.png`, `/manifest.json` → 200 + correct content-type | SPA catch-all swallowing static files |

## Running it

```bash
# default: production, full pretty output, exit 1 on any fail
node scripts/deploy-smoke-test.mjs

# JSON for CI parsing
node scripts/deploy-smoke-test.mjs --json

# different target (preview deploy, staging, localhost)
node scripts/deploy-smoke-test.mjs --base=https://terminal-x-preview.vercel.app
```

Exits: `0` healthy · `1` one or more failures · `2` script crash (network down, etc.).

Local runs persist results into `deploy_smoke_results` (source = `local`) so the admin Dashboard "Deploy Health" card sees them too.

## Cron — `*/15 * * * *`

`api/panel.js` exposes `?action=cron_deploy_smoke`. Same checks as A/B/C/D/F (E skipped — needs Vercel token cron doesn't have). Auth: `x-vercel-cron-signature` OR `Authorization: Bearer $CRON_SECRET`.

```bash
curl -X POST https://terminalxpos.com/api/panel?action=cron_deploy_smoke \
  -H "Authorization: Bearer $CRON_SECRET"
```

On any failure, the cron writes a `severity: critical` row to `client_errors` with `category: deploy.smoke.fail`. The existing critical-alert pipeline (`fireCriticalAlert`) then escalates.

Schedule (every 15 min) lives in root `vercel.json` next to the other crons.

## Schema

```sql
CREATE TABLE public.deploy_smoke_results (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  bundle_hash  TEXT,                   -- e.g. index-abc123.js
  passed_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,
  total_count  INTEGER NOT NULL,
  failures     JSONB,                  -- [{ category, check, expected, actual, severity }]
  duration_ms  INTEGER,
  source       TEXT                    -- 'cron' | 'local' | 'github-actions'
);
CREATE INDEX idx_deploy_smoke_results_ran_at
  ON public.deploy_smoke_results (ran_at DESC);
-- RLS on, anon+authenticated REVOKEd. Service role only (cron + admin endpoint).
```

Applied via Management API on 2026-05-17 (migration file kept for parity with other infra-only tables).

## Admin UI

The admin Dashboard pulls `/api/panel?action=deploy_smoke_history&limit=20` on load and renders a "Deploy Health" card above the stat grid. Green when latest run passed, red banner with click-to-expand failure list when it didn't. Pulls fresh on each Dashboard mount.

## Interpreting failures

- **[A] HTML has 0 `__CSP_NONCE__` literals** failing → middleware didn't run. Verify `web/middleware.js` is at repo root (not in dist-web/) AND that `vercel.json` doesn't exclude it.
- **[A] CSP nonce header == body nonce** failing → edge cache desync. Purge Vercel cache; suspect long `s-maxage` on HTML.
- **[B] `VITE_SUPABASE_*` baked into bundle** failing → env vars missing on Vercel. Check `vercel env ls production` and re-add. **Bundle MUST be rebuilt after** — env-vars are baked in at build time, not request time.
- **[C] `/api/*` returned 405 / HTML** → functions not detected. Verify `api/` folder is at repo root. Check `vercel.json` rewrites don't shadow `/api/*`.
- **[D] Row NOT FOUND in client_errors** → error pipeline broken. This is the canary — every fix elsewhere is invisible until D passes.
- **[F] /sitemap.xml served as HTML** → SPA catch-all swallowing it. Check `vercel.json` `rewrites` — explicit static file passthroughs must come BEFORE the catch-all.

## What's intentionally NOT here (Layer 2 / 3)

- **Layer 2 — function uncaughtError capture.** Per-function global handler that reports any thrown-but-not-caught error to `client_errors`. Separate follow-up.
- **Layer 3 — cron health monitor.** Tracks last-success timestamp of every cron and alerts if a cron silently stops firing. Separate follow-up.

These are out of scope for this commit. Layer 1 alone catches 100% of the 2026-05-17 incident classes.
