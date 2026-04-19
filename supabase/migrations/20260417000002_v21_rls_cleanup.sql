-- v2.1 RLS cleanup hotfix
-- Drops wide-open anon CRUD policies on commission tables and the
-- wide-open authenticated UPDATE on businesses. Service role (desktop
-- sync) bypasses RLS, so sync is unaffected. The intentional
-- rls_businesses_anon_insert policy (used by signup) is preserved.

BEGIN;

-- Drop wide-open anon CRUD on all 3 commission tables
DROP POLICY IF EXISTS rls_anon_select ON public.cajero_commissions;
DROP POLICY IF EXISTS rls_anon_insert ON public.cajero_commissions;
DROP POLICY IF EXISTS rls_anon_update ON public.cajero_commissions;
DROP POLICY IF EXISTS rls_anon_delete ON public.cajero_commissions;

DROP POLICY IF EXISTS rls_anon_select ON public.seller_commissions;
DROP POLICY IF EXISTS rls_anon_insert ON public.seller_commissions;
DROP POLICY IF EXISTS rls_anon_update ON public.seller_commissions;
DROP POLICY IF EXISTS rls_anon_delete ON public.seller_commissions;

DROP POLICY IF EXISTS rls_anon_select ON public.washer_commissions;
DROP POLICY IF EXISTS rls_anon_insert ON public.washer_commissions;
DROP POLICY IF EXISTS rls_anon_update ON public.washer_commissions;
DROP POLICY IF EXISTS rls_anon_delete ON public.washer_commissions;

-- Drop also the wide-open authenticated business UPDATE
DROP POLICY IF EXISTS rls_businesses_update_auth ON public.businesses;

COMMIT;
