-- v2.16.7 — RLS three-table fix
--
-- Closes the last 3 RLS audit gaps caught by `scripts/rls-policy-audit.mjs`:
-- tables with `ALTER TABLE … ENABLE ROW LEVEL SECURITY` but ZERO policies.
-- All three are service-role-only by design (server-side serverless callers
-- use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS), so a "no policies"
-- posture works at runtime — but pg_policies must show at least one row to
-- pass the audit and to make intent explicit.
--
-- Tables fixed (all in `public` schema):
--   1. api_rate_limits          — accessed ONLY via SECURITY DEFINER RPC
--                                 `check_rate_limit()` (web/lib/rate-limit.js).
--                                 Direct table access must remain denied to
--                                 anon / authenticated.
--   2. dgii_seed_nonces         — accessed ONLY by web/api/fe.js (semilla
--                                 issue + validarcertificado consume) using
--                                 service-role. Direct anon/authenticated
--                                 access must remain denied.
--   3. license_rebind_requests  — accessed by web/api/panel.js admin actions
--                                 (insert/list/approve/reject/expire) and
--                                 web/api/validate.js (insert pending row),
--                                 both via service-role. Admin reads also
--                                 go through service-role (panel.js wraps
--                                 every admin call in `auth.supabase`).
--
-- Pattern: explicit service_role FOR ALL policy. Mirrors
-- `db_backups_service_role_all` in 20260420000011_db_backup_bucket.sql and
-- the policy in 20260427000001_per_license_jwt_lockdown.sql. Anon and
-- authenticated remain denied (no policy granted to them + REVOKE on grants).
--
-- Idempotent: safe to re-run.

BEGIN;

-- ── 1. api_rate_limits ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "api_rate_limits_service_role_all" ON public.api_rate_limits;
CREATE POLICY "api_rate_limits_service_role_all"
  ON public.api_rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.api_rate_limits FROM anon, authenticated;

COMMENT ON POLICY "api_rate_limits_service_role_all" ON public.api_rate_limits IS
  'Service role full access. anon/authenticated have no policy and no grants — direct access denied. Rate limiting flows exclusively through SECURITY DEFINER RPC public.check_rate_limit().';

-- ── 2. dgii_seed_nonces ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "dgii_seed_nonces_service_role_all" ON public.dgii_seed_nonces;
CREATE POLICY "dgii_seed_nonces_service_role_all"
  ON public.dgii_seed_nonces
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.dgii_seed_nonces FROM anon, authenticated;

COMMENT ON POLICY "dgii_seed_nonces_service_role_all" ON public.dgii_seed_nonces IS
  'Service role full access. DGII seed issue/consume runs server-side via web/api/fe.js with SUPABASE_SERVICE_ROLE_KEY. anon/authenticated denied — replay-guard table must never be client-readable.';

-- ── 3. license_rebind_requests ───────────────────────────────────────────────
DROP POLICY IF EXISTS "license_rebind_requests_service_role_all" ON public.license_rebind_requests;
CREATE POLICY "license_rebind_requests_service_role_all"
  ON public.license_rebind_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.license_rebind_requests FROM anon, authenticated;

COMMENT ON POLICY "license_rebind_requests_service_role_all" ON public.license_rebind_requests IS
  'Service role full access. Admin panel (web/api/panel.js) and validate (web/api/validate.js) use service-role JWT — both insert/list/approve/reject/expire pass through here. No anon/authenticated path exists.';

COMMIT;

-- Post-apply verification (run manually):
--   SELECT polname, polcmd, polroles::regrole[]
--     FROM pg_policy
--     WHERE polrelid IN (
--       'public.api_rate_limits'::regclass,
--       'public.dgii_seed_nonces'::regclass,
--       'public.license_rebind_requests'::regclass
--     )
--     ORDER BY polname;
--   -- Expect 3 rows, polroles = {service_role}, polcmd = ALL.
--
--   node scripts/rls-policy-audit.mjs   -- must exit 0.
