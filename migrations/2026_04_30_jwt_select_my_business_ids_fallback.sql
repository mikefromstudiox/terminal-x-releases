-- 2026_04_30 — Close the PUSH/PULL RLS asymmetry that wiped Mike's master tables.
--
-- Bug: every <table>_jwt_select policy is `business_id = JWT.app_metadata.business_id`.
-- When the license-scoped _userJwt has a missing/stale/wrong app_metadata.business_id
-- (which can happen after a license rebind, a fresh install, or a multi-business owner
-- switching context), SELECT returns 0 for every table. Meanwhile <table>_ins_auth uses
-- `my_business_ids()` which still recognizes the user's access via the businesses /
-- staff tables — so INSERT/UPDATE keep working. Sync's reconcileDeletes interpreted the
-- empty SELECT as "cloud is empty" and DELETE'd every local row across master tables.
-- This wiped Mike's empleados/services repeatedly between 04-26 and 04-30.
--
-- Fix: make every _jwt_select also accept rows where the user has legitimate access
-- through `my_business_ids()`. my_business_ids() is SECURITY DEFINER and keyed on
-- auth.uid() — it returns only businesses the caller owns OR is active staff at, so
-- cross-tenant access remains impossible. PUSH and PULL now use the same effective
-- access set; reconcile cannot lose data due to JWT scope drift.
--
-- This is a wholesale rewrite of every existing <table>_jwt_select policy.
-- Generated programmatically so we don't miss any. Run as service role / superuser.

DO $$
DECLARE
  pol RECORD;
  tbl_qualified text;
  new_using text;
BEGIN
  FOR pol IN
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      p.polname AS policy_name
    FROM pg_policy p
    JOIN pg_class c   ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.polname LIKE '%_jwt_select'
      AND n.nspname = 'public'
      AND p.polcmd = 'r'
  LOOP
    tbl_qualified := format('%I.%I', pol.schema_name, pol.table_name);
    new_using := $expr$
      (
        business_id = NULLIF((auth.jwt() -> 'app_metadata' ->> 'business_id'), '')::uuid
        OR business_id IN (SELECT public.my_business_ids())
      )
    $expr$;

    EXECUTE format(
      'ALTER POLICY %I ON %s USING (%s)',
      pol.policy_name,
      tbl_qualified,
      new_using
    );

    RAISE NOTICE 'rewrote % on %', pol.policy_name, tbl_qualified;
  END LOOP;
END$$;

-- Sanity check (informational only — comment out if running in prod with no console):
-- SELECT polname, pg_get_expr(polqual, polrelid)
--   FROM pg_policy
--  WHERE polname LIKE '%_jwt_select'
--    AND polrelid::regclass::text NOT LIKE 'pg_%'
--  ORDER BY polrelid::regclass::text
--  LIMIT 10;
