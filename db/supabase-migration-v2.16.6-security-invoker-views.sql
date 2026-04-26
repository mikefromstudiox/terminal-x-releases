-- ============================================================================
-- v2.16.6 — Flip SECURITY DEFINER views to SECURITY INVOKER
-- ----------------------------------------------------------------------------
-- Supabase Database Linter flagged two public views as defined with the
-- SECURITY DEFINER property. By default, Postgres views run with the privileges
-- of the role that CREATED them — which means they bypass RLS for the user
-- querying through them.
--
-- The Supabase-recommended fix is to set `security_invoker = true` on the
-- view, so it enforces RLS using the *querying* user's identity instead.
--
-- Affected views:
--   - public.mesas_with_active_total  (restaurant mesas + live ticket total)
--   - public.users                    (legacy view on staff base table)
--
-- Both are read-only joins on tables that already have RLS policies against
-- business_id, so flipping to INVOKER tightens security with no behavior
-- change for the legitimate query path: Supabase JWT carries business_id;
-- RLS policies on the underlying tables (mesas, tickets, ticket_items, staff)
-- already filter by business_id; the view will now respect those policies.
--
-- Idempotent: SET (security_invoker = true) is a no-op when already set.
-- ============================================================================

BEGIN;

-- 1) mesas_with_active_total — restaurant active-bill helper
ALTER VIEW public.mesas_with_active_total SET (security_invoker = true);

-- 2) users — legacy view on `staff` (CLAUDE.md: users is a VIEW on staff
--    base table, has supabase_id, cedula, start_date)
ALTER VIEW public.users SET (security_invoker = true);

COMMIT;
