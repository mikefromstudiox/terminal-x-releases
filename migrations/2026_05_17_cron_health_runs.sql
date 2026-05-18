-- 2026-05-17 — Layer 3 cron output verifier.
--
-- WHY: Layers 1 (deploy smoke) + 2 (withReporting wrapper) catch HTTP failures
-- and thrown exceptions. What still slips: a cron that returns 200 but produces
-- NO downstream side-effect (digest 200s but Resend misconfigured, dgii_pull
-- 200s but scraper stub returns 0 rows, anecf-drain 200s but pending stays).
-- Layer 3 watches the BUSINESS OUTPUT — last_digest_sent activity_log row,
-- client_dgii_credentials.last_pull_at, anecf_queue.updated_at, deploy_smoke_results.ran_at.
--
-- One row per VERIFIER RUN. Failures are also fanned to client_errors as
-- severity=critical category=cron.output.missing for the existing alert pipeline.
-- Successes do NOT write to client_errors (would flood it).
--
-- Admin-read via service role only. No RLS policy needed since anon/authenticated
-- have ALL privileges revoked.

CREATE TABLE IF NOT EXISTS public.cron_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_checks  INTEGER NOT NULL,
  passed_count  INTEGER NOT NULL,
  failed_count  INTEGER NOT NULL,
  failures      JSONB,    -- [{ cron_path, expected_within_hours, observed_at, detail }]
  duration_ms   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_cron_health_runs_ran_at
  ON public.cron_health_runs (ran_at DESC);

ALTER TABLE public.cron_health_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cron_health_runs FROM anon, authenticated;
