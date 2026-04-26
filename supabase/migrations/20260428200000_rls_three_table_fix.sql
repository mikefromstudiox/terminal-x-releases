-- v2.16.7 — RLS three-table fix (mirror of db/supabase-migration-v2.16.7-rls-three-table-fix.sql)
--
-- Adds explicit service_role FOR ALL policies on:
--   * api_rate_limits
--   * dgii_seed_nonces
--   * license_rebind_requests
--
-- Closes the last 3 violations from scripts/rls-policy-audit.mjs. All three
-- tables are service-role-only by design — anon/authenticated remain denied.
-- See db/supabase-migration-v2.16.7-rls-three-table-fix.sql for full context.

BEGIN;

DROP POLICY IF EXISTS "api_rate_limits_service_role_all" ON public.api_rate_limits;
CREATE POLICY "api_rate_limits_service_role_all"
  ON public.api_rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
REVOKE ALL ON public.api_rate_limits FROM anon, authenticated;

DROP POLICY IF EXISTS "dgii_seed_nonces_service_role_all" ON public.dgii_seed_nonces;
CREATE POLICY "dgii_seed_nonces_service_role_all"
  ON public.dgii_seed_nonces
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
REVOKE ALL ON public.dgii_seed_nonces FROM anon, authenticated;

DROP POLICY IF EXISTS "license_rebind_requests_service_role_all" ON public.license_rebind_requests;
CREATE POLICY "license_rebind_requests_service_role_all"
  ON public.license_rebind_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
REVOKE ALL ON public.license_rebind_requests FROM anon, authenticated;

COMMIT;
