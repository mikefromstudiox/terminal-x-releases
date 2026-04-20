-- =============================================================
-- Sprint 11 — memberships + wash_combos business_id bigint -> uuid
-- 2026-04-21
--
-- Audit flagged 3 schema outliers with business_id BIGINT while
-- every other business-scoped table uses UUID:
--   - memberships   (0 rows in prod — safe ALTER)
--   - wash_combos   (0 rows in prod — safe ALTER)
--   - license_events has NO business_id column; skipped type change,
--     keeps the Sprint 6 license-join SELECT policy untouched.
--
-- Also installs the full 4-policy my_business_ids() RLS set on both
-- tables. Sprint 5 dropped the old permissive anon policies but never
-- added replacements, so these two tables were RLS-enabled with zero
-- policies (total lockout). This closes that gap.
--
-- trg_touch_updated_at BEFORE-UPDATE triggers already attached
-- (confirmed via information_schema.triggers) — not re-created here.
-- =============================================================

-- 1. Abort if either table has rows (defensive; both confirmed empty
--    via Management API pre-migration).
DO $$
DECLARE
  m_count BIGINT;
  w_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO m_count FROM public.memberships;
  SELECT COUNT(*) INTO w_count FROM public.wash_combos;
  IF m_count > 0 OR w_count > 0 THEN
    RAISE EXCEPTION 'Refusing to migrate: memberships=%, wash_combos=%. Abort.', m_count, w_count;
  END IF;
END $$;

-- 2. Type conversion bigint -> uuid (empty tables; USING NULL is safe)
ALTER TABLE public.memberships ALTER COLUMN business_id DROP DEFAULT;
ALTER TABLE public.memberships ALTER COLUMN business_id TYPE UUID USING NULL;

ALTER TABLE public.wash_combos ALTER COLUMN business_id DROP DEFAULT;
ALTER TABLE public.wash_combos ALTER COLUMN business_id TYPE UUID USING NULL;

-- 3. RLS policies — my_business_ids() scoping (matches Sprint 5 pattern)
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wash_combos ENABLE ROW LEVEL SECURITY;

-- memberships
DROP POLICY IF EXISTS memberships_sel ON public.memberships;
DROP POLICY IF EXISTS memberships_ins ON public.memberships;
DROP POLICY IF EXISTS memberships_upd ON public.memberships;
DROP POLICY IF EXISTS memberships_del ON public.memberships;

CREATE POLICY memberships_sel ON public.memberships
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY memberships_ins ON public.memberships
  FOR INSERT TO authenticated
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY memberships_upd ON public.memberships
  FOR UPDATE TO authenticated
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY memberships_del ON public.memberships
  FOR DELETE TO authenticated
  USING (business_id IN (SELECT my_business_ids()));

-- wash_combos
DROP POLICY IF EXISTS wash_combos_sel ON public.wash_combos;
DROP POLICY IF EXISTS wash_combos_ins ON public.wash_combos;
DROP POLICY IF EXISTS wash_combos_upd ON public.wash_combos;
DROP POLICY IF EXISTS wash_combos_del ON public.wash_combos;

CREATE POLICY wash_combos_sel ON public.wash_combos
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY wash_combos_ins ON public.wash_combos
  FOR INSERT TO authenticated
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY wash_combos_upd ON public.wash_combos
  FOR UPDATE TO authenticated
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY wash_combos_del ON public.wash_combos
  FOR DELETE TO authenticated
  USING (business_id IN (SELECT my_business_ids()));
