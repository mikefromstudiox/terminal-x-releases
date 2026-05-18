-- 2026-05-17 — Claude Triage (Layer 5).
--
-- When a critical incident lands (new client_errors severity='critical', OR a
-- failure row in deploy_smoke_results / cron_health_runs / flow_drift_runs),
-- a cron (every 2 min) calls the Anthropic API to diagnose it and writes the
-- structured diagnosis back to the source row. For client_errors the diagnosis
-- lives at metadata.claude_diagnosis (no schema change). For the three "runs"
-- tables we add a single `claude_diagnosed_at` timestamp marker plus a small
-- `claude_diagnosis` JSONB so we can render it inline on admin surfaces and
-- never re-diagnose the same row.
--
-- All ALTERs are IF EXISTS / IF NOT EXISTS so this is safe to re-run and safe
-- against future Layer-N tables that aren't deployed yet.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='deploy_smoke_results') THEN
    ALTER TABLE public.deploy_smoke_results ADD COLUMN IF NOT EXISTS claude_diagnosed_at TIMESTAMPTZ;
    ALTER TABLE public.deploy_smoke_results ADD COLUMN IF NOT EXISTS claude_diagnosis     JSONB;
    CREATE INDEX IF NOT EXISTS idx_deploy_smoke_results_undiagnosed_fails
      ON public.deploy_smoke_results (ran_at DESC)
      WHERE claude_diagnosed_at IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cron_health_runs') THEN
    ALTER TABLE public.cron_health_runs ADD COLUMN IF NOT EXISTS claude_diagnosed_at TIMESTAMPTZ;
    ALTER TABLE public.cron_health_runs ADD COLUMN IF NOT EXISTS claude_diagnosis     JSONB;
    CREATE INDEX IF NOT EXISTS idx_cron_health_runs_undiagnosed_fails
      ON public.cron_health_runs (ran_at DESC)
      WHERE claude_diagnosed_at IS NULL AND failed_count > 0;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='flow_drift_runs') THEN
    ALTER TABLE public.flow_drift_runs ADD COLUMN IF NOT EXISTS claude_diagnosed_at TIMESTAMPTZ;
    ALTER TABLE public.flow_drift_runs ADD COLUMN IF NOT EXISTS claude_diagnosis     JSONB;
    CREATE INDEX IF NOT EXISTS idx_flow_drift_runs_undiagnosed
      ON public.flow_drift_runs (ran_at DESC)
      WHERE claude_diagnosed_at IS NULL;
  END IF;
END $$;

-- 2026-05-17 (Layer 5 follow-up) — the existing CHECK constraint on
-- client_errors.severity allowed only ('error','warning','info') but the
-- application code in /api/panel.js (handleReportError) and Layer 3
-- (cron_health_verifier) both write severity='critical'. Those writes were
-- silently violating the constraint and being eaten by try/catch — so
-- "critical" rows never actually landed in prod. This expands the constraint
-- without dropping any value already in use.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_errors_severity_check') THEN
    ALTER TABLE public.client_errors DROP CONSTRAINT client_errors_severity_check;
  END IF;
  ALTER TABLE public.client_errors
    ADD CONSTRAINT client_errors_severity_check
    CHECK (severity = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text, 'critical'::text]));
END $$;

-- For fast lookup of un-triaged critical client_errors. Predicate uses jsonb
-- key check so we can re-diagnose if metadata.claude_diagnosis is later
-- intentionally cleared.
CREATE INDEX IF NOT EXISTS idx_client_errors_critical_undiagnosed
  ON public.client_errors (created_at DESC)
  WHERE severity = 'critical' AND (metadata ? 'claude_diagnosis') = false;
