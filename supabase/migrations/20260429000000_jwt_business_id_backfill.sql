-- ════════════════════════════════════════════════════════════════════════════
-- 20260429000000_jwt_business_id_backfill.sql
--
-- Phase B prerequisite for the cross-tenant lockdown work that follows the
-- 2026-04-29 incident: every existing and future auth.users row MUST carry
-- raw_app_meta_data.business_id. The new JWT-claim RLS policies (added by
-- 20260427000001_per_license_jwt_lockdown.sql + 20260427100002) compare
-- row.business_id against ((auth.jwt()->'app_metadata')->>'business_id')::uuid.
-- Without that claim, JWT-only policies deny every read.
--
-- Today's state (audited via Management API on 2026-04-29):
--   • 6 real auth.users; only 1 has business_id in app_metadata.
--   • All others fall through to the legacy `my_business_ids()` policies.
--   • Once we drop those legacy policies (next migration), unbackfilled users
--     are locked out instantly.
--
-- This migration:
--   1) Backfills raw_app_meta_data.business_id for every existing user with
--      a determinable business (owner_id on businesses, or active staff row).
--   2) Adds triggers on businesses (owner_id) and staff (auth_user_id, active)
--      so future inserts/updates maintain the claim automatically.
--   3) Adds an RPC `sync_user_business_metadata(user_id uuid)` for emergency
--      re-sync (callable by service_role only).
--   4) Adds the missing covering index on staff(auth_user_id, active) that
--      `my_business_ids()` depends on. Cheap insurance for the legacy path
--      while it remains in production.
--
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 1 — Defensive index for the legacy my_business_ids() path.
-- The function does `SELECT business_id FROM staff WHERE auth_user_id=auth.uid()
-- AND active = true`. Without a covering index, that's a heap scan on every
-- RLS evaluation. At 1000 clients × 30+ table reads × 5 min sync cycle, that
-- alone can saturate Postgres CPU. Costs nothing now, prevents the cliff.
-- ────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS staff_auth_user_id_active_idx
  ON public.staff (auth_user_id)
  WHERE active = true;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2 — Helper function: resolve a user's effective business_id.
-- Priority: businesses.owner_id match → active staff row. Returns NULL if the
-- user has neither. SECURITY DEFINER so triggers can call it without the
-- caller needing direct read access to auth.users.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_user_business_id(p_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bid FROM (
    SELECT id AS bid, 1 AS pri FROM public.businesses WHERE owner_id = p_user_id
    UNION ALL
    SELECT business_id AS bid, 2 AS pri FROM public.staff
      WHERE auth_user_id = p_user_id AND active = true
  ) sub
  ORDER BY pri ASC
  LIMIT 1;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 3 — Sync RPC. Idempotent merge of business_id into app_metadata.
-- Safe to re-run, never clobbers other claims (provider, providers, etc.).
-- service_role only; not callable from anon / authenticated.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_user_business_metadata(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_biz UUID;
BEGIN
  v_biz := public.resolve_user_business_id(p_user_id);
  IF v_biz IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                          || jsonb_build_object('business_id', v_biz::text)
   WHERE id = p_user_id
     AND COALESCE((raw_app_meta_data ->> 'business_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid) <> v_biz;

  RETURN v_biz;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_user_business_metadata(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_user_business_metadata(UUID) TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 4 — Trigger: keep app_metadata in sync when business owner changes.
-- Fires on INSERT or when owner_id changes. Updates the new owner's claim.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_business_sync_owner_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL THEN
    PERFORM public.sync_user_business_metadata(NEW.owner_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS businesses_sync_owner_metadata ON public.businesses;
CREATE TRIGGER businesses_sync_owner_metadata
  AFTER INSERT OR UPDATE OF owner_id ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.tg_business_sync_owner_metadata();


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 5 — Trigger: keep app_metadata in sync when staff row changes.
-- Covers: new staff with auth_user_id, activation toggle, business reassignment.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_staff_sync_user_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.auth_user_id IS NOT NULL AND COALESCE(NEW.active, false) = true THEN
    PERFORM public.sync_user_business_metadata(NEW.auth_user_id);
  END IF;
  -- If a row deactivates / reassigns, the user's previous business may no
  -- longer be valid; resolve_user_business_id() will pick the next active
  -- business (or NULL) on the next call.
  IF TG_OP = 'UPDATE' AND OLD.auth_user_id IS NOT NULL AND OLD.auth_user_id <> COALESCE(NEW.auth_user_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    PERFORM public.sync_user_business_metadata(OLD.auth_user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_sync_user_metadata ON public.staff;
CREATE TRIGGER staff_sync_user_metadata
  AFTER INSERT OR UPDATE OF auth_user_id, business_id, active ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.tg_staff_sync_user_metadata();


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 6 — Backfill every existing user. Single statement, idempotent.
-- For users with neither owner_id nor active staff row (test/dev accounts),
-- nothing changes — they remain claim-less and rightly cannot read tenant
-- data. They will not be impacted until the legacy policies are dropped in a
-- separate maintenance migration (and even then, they have no tenant to lose).
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
  cnt INT := 0;
BEGIN
  FOR r IN SELECT u.id FROM auth.users u LOOP
    IF public.sync_user_business_metadata(r.id) IS NOT NULL THEN
      cnt := cnt + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'sync_user_business_metadata backfill complete: % users updated', cnt;
END;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 7 — Verification queries (run manually to confirm migration health).
-- Commented out; uncomment + re-run to inspect.
-- ────────────────────────────────────────────────────────────────────────────
-- SELECT u.id, u.email,
--        u.raw_app_meta_data->>'business_id' AS jwt_biz_id,
--        public.resolve_user_business_id(u.id) AS expected_biz_id
--   FROM auth.users u
--  WHERE u.email NOT LIKE '%demo%'
--  ORDER BY u.created_at;
