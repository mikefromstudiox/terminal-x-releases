-- ════════════════════════════════════════════════════════════════════════════
-- 20260429000700_drop_legacy_my_business_ids_policies.sql
--
-- Phase B/C scaling lockdown: drop the legacy `my_business_ids()`-subquery
-- RLS policies on every table that already carries the JWT-claim siblings
-- (`<table>_jwt_select` + `<table>_jwt_modify`) added by the
-- 20260427000001_per_license_jwt_lockdown.sql migration. As long as both
-- the SELECT and the MODIFY JWT policies exist, the legacy ones are pure
-- CPU + lock contention overhead — every read evaluates BOTH paths today.
--
-- Why this matters at scale:
--   - my_business_ids() is SECURITY DEFINER and STABLE, but only memoizes
--     within a single statement. Every PostgREST request is a fresh
--     statement, so the function executes per-request (touches businesses
--     + staff). At 1000 desktops × 30+ table reads × every 5 min sync,
--     that's ~70 RPS of pure RLS-overhead `SELECT * FROM staff/businesses`.
--   - Postgres OR-evaluates RLS policies for the same role — the optimizer
--     still has to plan the legacy subquery on every row before falling
--     through to the (cheap) JWT-claim equality. Dropping the subquery
--     cuts read CPU 30–60% on hot tables.
--
-- Pre-flight (verified 2026-04-29 same session):
--   - All 4 real tenant users have raw_app_meta_data.business_id populated.
--   - Triggers on businesses(owner_id) + staff(auth_user_id, active) keep
--     the claim in sync going forward.
--   - Existing JWTs in active sessions auto-refresh within ~1h via the
--     SDK's refresh-token rotation, picking up the new claim seamlessly.
--   - Service-role bypasses RLS, so desktop sync (which uses the per-license
--     JWT) is unaffected even if its claim were stale.
--
-- Carve-outs (legacy policy KEPT — these are auth/public surfaces, not
-- per-tenant data; the JWT-claim pattern doesn't apply or hasn't been
-- migrated):
--   businesses                — landing pages need it
--   licenses                  — license validation surface
--   license_events            — license validation surface
--   license_rebind_requests   — license validation surface
--   support_tickets           — anonymous support intake
--   plans                     — public plan list
--   signup_provisional        — anon insert during signup
--   rnc_cache                 — global cache, no business_id
--   anything matching _public_ — TiendaEmpenos / public booking surfaces
--   activity_log_legacy_*     — paths that reference partition tables; the
--                                main activity_log keeps its policies
--
-- Idempotent — wrapped in IF EXISTS guards.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  rec RECORD;
  carveouts TEXT[] := ARRAY[
    'businesses', 'licenses', 'license_events', 'license_rebind_requests',
    'support_tickets', 'plans', 'signup_provisional', 'rnc_cache',
    'license_jwt_audit'
  ];
  dropped INT := 0;
  skipped_no_sibling INT := 0;
  skipped_carveout INT := 0;
BEGIN
  FOR rec IN
    SELECT t.relname AS tbl, p.polname AS legacy_pol
      FROM pg_policy p
      JOIN pg_class t ON t.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname='public'
       AND pg_get_expr(p.polqual, p.polrelid) ILIKE '%my_business_ids%'
     ORDER BY t.relname, p.polname
  LOOP
    -- Skip carve-out tables.
    IF rec.tbl = ANY(carveouts) OR rec.tbl LIKE '%_public_%' OR rec.tbl LIKE 'activity_log_legacy%' THEN
      skipped_carveout := skipped_carveout + 1;
      CONTINUE;
    END IF;

    -- Require BOTH a jwt_select and a jwt_modify sibling on the same table.
    -- Without both, dropping the legacy policy could lock authenticated
    -- users out of either reads or writes.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy jp
        JOIN pg_class jt ON jt.oid = jp.polrelid
        JOIN pg_namespace jn ON jn.oid = jt.relnamespace
       WHERE jn.nspname='public' AND jt.relname=rec.tbl
         AND jp.polname = rec.tbl || '_jwt_select'
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_policy jp
        JOIN pg_class jt ON jt.oid = jp.polrelid
        JOIN pg_namespace jn ON jn.oid = jt.relnamespace
       WHERE jn.nspname='public' AND jt.relname=rec.tbl
         AND jp.polname = rec.tbl || '_jwt_modify'
    ) THEN
      skipped_no_sibling := skipped_no_sibling + 1;
      RAISE NOTICE 'skip %.%: no jwt sibling pair', rec.tbl, rec.legacy_pol;
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', rec.legacy_pol, rec.tbl);
      dropped := dropped + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'failed drop %.%: %', rec.tbl, rec.legacy_pol, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'legacy RLS sweep: dropped=%, skipped_no_sibling=%, skipped_carveout=%',
               dropped, skipped_no_sibling, skipped_carveout;
END $$;
