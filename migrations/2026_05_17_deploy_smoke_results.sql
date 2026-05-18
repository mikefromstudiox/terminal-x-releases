-- 2026-05-17 — Deploy smoke test results table.
--
-- WHY: On 2026-05-17 19:19 UTC commit ff65749 silently broke production for ~6h.
-- Five distinct silent failures stacked (middleware path, SPA rewrites, api/ folder,
-- CSP nonce desync, missing VITE_ env vars). Layer 1 of the recovery: a post-deploy
-- smoke test (scripts/deploy-smoke-test.mjs + cron in api/panel.js?action=cron_deploy_smoke)
-- persists every run into this table so the admin Dashboard can surface "Deploy Health".
--
-- Admin-read only via service role. No RLS policies — anon + authenticated have ALL
-- privileges revoked. The cron writes via service role; admin panel reads via the
-- existing requireAdmin()-gated /api/panel?action=deploy_smoke_history endpoint.

CREATE TABLE IF NOT EXISTS public.deploy_smoke_results (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  bundle_hash  TEXT,
  passed_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,
  total_count  INTEGER NOT NULL,
  failures     JSONB,   -- array of { category, check, expected, actual, severity }
  duration_ms  INTEGER,
  source       TEXT     -- 'cron' | 'local' | 'github-actions'
);

CREATE INDEX IF NOT EXISTS idx_deploy_smoke_results_ran_at
  ON public.deploy_smoke_results (ran_at DESC);

ALTER TABLE public.deploy_smoke_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deploy_smoke_results FROM anon, authenticated;
