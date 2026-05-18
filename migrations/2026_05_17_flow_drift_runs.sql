-- 2026-05-17 — Flow Drift Smoke (Layer 4) results table.
--
-- WHY: Layer 1 (HTTP smoke) catches deploy regressions. Layer 2 (withReporting)
-- catches server-side throws. Layer 3 (cron output verifier) catches silent
-- 200-no-output crons. NONE of them caught the 2026-05-17 queue.ticket_id=NULL
-- bug — markPaid was silently skipped because the FK was never backfilled, so
-- every "cobrar a queued ticket" appeared to succeed while DB stayed pendiente.
--
-- Layer 4 walks REAL user actions end-to-end (encolar → cobrar, mesa addon,
-- void → NCF decrement, mesa occupied vs byMesa, /pos route resolution) and
-- asserts the DB side-effects match the UI claim. Runs every 15 min from
-- /api/panel?action=cron_flow_drift_smoke. Failures escalate to client_errors
-- as severity='critical', category='flow_drift.fail'.
--
-- Admin-read only via service role. No RLS policies — anon + authenticated have
-- ALL privileges revoked. The cron writes via service role; admin panel reads
-- via the requireAdmin()-gated /api/panel?action=flow_drift_history endpoint.

CREATE TABLE IF NOT EXISTS public.flow_drift_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  passed_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,
  total_count  INTEGER NOT NULL,
  failures     JSONB,   -- array of { scenario, expected, observed, detail }
  duration_ms  INTEGER,
  source       TEXT     -- 'cron' | 'local' | 'github-actions'
);

CREATE INDEX IF NOT EXISTS idx_flow_drift_runs_ran_at
  ON public.flow_drift_runs (ran_at DESC);

ALTER TABLE public.flow_drift_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flow_drift_runs FROM anon, authenticated;
