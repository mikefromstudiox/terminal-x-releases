-- v2.13.0 — RLS hardening for businesses + license_events
--
-- Context (from 2026-04-19 audit):
--   * `businesses` INSERT policy allowed anon inserts as long as the row
--     had `owner_id = auth.uid()`. Because anon keys carry no uid,
--     auth.uid() returns NULL, and NULL = NULL evaluates to NULL, which
--     behaves as false under WITH CHECK — BUT the policy was also granted
--     to the `anon` role. Any attacker with the anon key could enumerate
--     or seed tenants. Close the loop by restricting to authenticated
--     users only AND keeping owner_id = auth.uid().
--   * `license_events` INSERT policy was literally `WITH CHECK (true)`
--     for every role including anon. That means anyone holding the
--     publishable anon key could forge arbitrary license events (e.g.
--     "activation", "revocation", "trial_extended") for any tenant.
--     Restrict to service_role only — desktop sync uses service role;
--     the web path routes through `web/api/validate.js` which also uses
--     service role.
--
-- Signup path: `web/api/signup/provision.js` uses SUPABASE_SERVICE_ROLE_KEY
-- (verified in this sprint), so tightening the businesses INSERT to
-- authenticated users with matching auth.uid() is safe — the server route
-- bypasses RLS entirely via service role. Any future anon-key signup path
-- MUST go through that server route.
--
-- Rollback: restore the previous `WITH CHECK (true)` policies; do NOT do
-- this without first migrating any anon-dependent flows.

BEGIN;

-- ── businesses INSERT ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "businesses_insert" ON public.businesses;

CREATE POLICY "businesses_insert" ON public.businesses
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- Explicitly REVOKE INSERT from anon so a future permissive policy cannot
-- re-grant it silently. Defense in depth.
REVOKE INSERT ON public.businesses FROM anon;

-- ── license_events INSERT ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "license_events_insert" ON public.license_events;

-- Service role bypasses RLS entirely, so we don't need a policy for it.
-- We add a deny-by-default posture by creating no INSERT policies for
-- anon / authenticated. Keep SELECT/UPDATE/DELETE untouched (already
-- service-role only).
REVOKE INSERT ON public.license_events FROM anon, authenticated;

-- Optional: an explicit authenticated-deny policy would also work, but
-- leaving INSERT with zero policies yields the same deny-by-default
-- behavior for anon/authenticated while letting service_role through.
-- (Postgres grants remain the authoritative gate here.)

COMMIT;

-- Post-apply verification (run manually):
--   SELECT polname, polcmd, polroles::regrole[] FROM pg_policy
--     WHERE polrelid IN ('public.businesses'::regclass,'public.license_events'::regclass)
--     ORDER BY polname;
--   SELECT grantee, privilege_type FROM information_schema.table_privileges
--     WHERE table_name IN ('businesses','license_events') AND grantee IN ('anon','authenticated');
