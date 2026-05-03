-- 2026-05-03 — fix RLS policies that read business_id from the wrong JWT path.
--
-- Symptom: `accounting_clients` and ~25 other tables have RLS policies of the
-- shape `current_setting('request.jwt.claims')::jsonb ->> 'business_id'`. Our
-- JWTs put business_id under `app_metadata.business_id`, NOT at the top of
-- the claims object. So this expression evaluates to NULL, the row check
-- fails, and authenticated users see 0 rows from these tables.
--
-- Discovered today (2026-05-03) when Demo Contabilidad's portfolio rendered
-- empty despite seeded data. Likely affecting Perla Contabilidad in prod.
--
-- Canonical pattern (already used by mesas/services/tickets/etc):
--   business_id = ((auth.jwt() -> 'app_metadata' ->> 'business_id')::uuid)
--
-- This migration loops every policy in `public` whose USING or WITH CHECK
-- references `request.jwt.claims`, drops it, and recreates it with the
-- canonical USING/CHECK preserving role + cmd.

DO $$
DECLARE
  pol RECORD;
  canonical TEXT := '(business_id IS NOT NULL AND business_id = ((auth.jwt() -> ''app_metadata'' ->> ''business_id'')::uuid))';
  roles_csv TEXT;
  rewritten_count INT := 0;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check, permissive
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        qual LIKE '%request.jwt.claims%' OR
        with_check LIKE '%request.jwt.claims%'
      )
    ORDER BY tablename, policyname
  LOOP
    -- Skip non-business-id-scoped policies (rare but possible if a policy
    -- reads a different jwt claim like `role` or `email`).
    IF pol.qual NOT LIKE '%business_id%' AND pol.with_check NOT LIKE '%business_id%' THEN
      RAISE NOTICE 'SKIP non-business_id policy: %.% / %', pol.schemaname, pol.tablename, pol.policyname;
      CONTINUE;
    END IF;

    roles_csv := array_to_string(ARRAY(SELECT format('%I', r) FROM unnest(pol.roles) AS r), ', ');
    IF roles_csv IS NULL OR roles_csv = '' THEN roles_csv := 'public'; END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);

    IF pol.cmd = 'SELECT' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS %s FOR SELECT TO %s USING (%s)',
        pol.policyname, pol.schemaname, pol.tablename,
        CASE WHEN pol.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
        roles_csv, canonical
      );
    ELSIF pol.cmd = 'INSERT' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS %s FOR INSERT TO %s WITH CHECK (%s)',
        pol.policyname, pol.schemaname, pol.tablename,
        CASE WHEN pol.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
        roles_csv, canonical
      );
    ELSIF pol.cmd = 'UPDATE' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS %s FOR UPDATE TO %s USING (%s) WITH CHECK (%s)',
        pol.policyname, pol.schemaname, pol.tablename,
        CASE WHEN pol.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
        roles_csv, canonical, canonical
      );
    ELSIF pol.cmd = 'DELETE' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS %s FOR DELETE TO %s USING (%s)',
        pol.policyname, pol.schemaname, pol.tablename,
        CASE WHEN pol.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
        roles_csv, canonical
      );
    ELSE
      -- ALL or anything else
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS %s FOR ALL TO %s USING (%s) WITH CHECK (%s)',
        pol.policyname, pol.schemaname, pol.tablename,
        CASE WHEN pol.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
        roles_csv, canonical, canonical
      );
    END IF;

    rewritten_count := rewritten_count + 1;
    RAISE NOTICE 'Rewrote policy %.% / % (% role=%)', pol.schemaname, pol.tablename, pol.policyname, pol.cmd, roles_csv;
  END LOOP;
  RAISE NOTICE 'Total policies rewritten: %', rewritten_count;
END $$;

-- Verification (will appear in psql output, not enforced):
SELECT
  schemaname || '.' || tablename AS object,
  policyname,
  cmd,
  CASE
    WHEN qual LIKE '%request.jwt.claims%' THEN 'STILL BROKEN'
    WHEN qual LIKE '%app_metadata%' THEN 'CANONICAL'
    ELSE 'other'
  END AS check
FROM pg_policies
WHERE schemaname = 'public'
  AND (tablename LIKE 'accounting_%' OR tablename IN ('carniceria_corte_categories', 'carniceria_scales', 'inventory_discards', 'inventory_freshness_log', 'promotion_items', 'promotions', 'recurring_orders'))
ORDER BY tablename, policyname;
