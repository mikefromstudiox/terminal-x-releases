-- 20260518_observability_service_role_policies.sql
--
-- Adds explicit service_role-only RLS policies on 6 internal
-- observability tables. These are written by Vercel crons (service_role)
-- and read by admin endpoints (requireAdmin → getClient also returns
-- service_role). No anon or authenticated access intended.
--
-- Before this migration the tables had RLS ENABLED but ZERO policies —
-- functionally fine because service_role bypasses RLS, but
-- rls-policy-audit.mjs (release-gate script) correctly flagged it as
-- a hygiene issue and refused to greenlight the v2.17.8 desktop ship.
--
-- Applied via Management API on 2026-05-18 (pre-release of v2.17.8).
-- This file is the source-of-truth record.

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'claude_alerts_pending',
    'claude_feature_flags',
    'cron_health_runs',
    'deploy_smoke_results',
    'flow_drift_runs',
    'mega_smoke_runs'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_role_only ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY service_role_only ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;
