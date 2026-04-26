-- Terminal X v2.16.7 — Carwash memberships rolling-period RPC
--
-- Background: until v2.16.6 the rolling period (`period_start`, `period_end`,
-- `washes_used_this_period`) on `memberships` was advanced *only* by the
-- desktop helper `membershipGetActiveForClient()` in `electron/database.js`.
-- A multi-device shop where the web tablet was the first to ring up a wash
-- on the 1st of the month would consume against the *previous* period until
-- the desktop happened to read the row. The web client had no way to advance
-- the period authoritatively.
--
-- This RPC moves the rolling-period calculation to the database, where:
--   • every device sees the same authoritative truth (no SPOF on desktop),
--   • RLS still applies (we filter by `business_id IN (SELECT my_business_ids())`
--     using the policy already enforced on `memberships`),
--   • the operation is atomic — no read-then-write race between two POS
--     terminals trying to advance the same membership simultaneously.
--
-- Behavior: read the membership row, compute new period_start = old period_end + 1 day,
-- new period_end = period_start + interval (1 month, anchored to start_date day),
-- reset washes_used_this_period to 0, return the updated row. If the current
-- period is still in the future (period_end >= today), no advance happens and
-- the row is returned unchanged so callers can use this RPC as the single
-- entrypoint regardless of whether an advance is required.

CREATE OR REPLACE FUNCTION public.carwash_memberships_advance_period(membership_id uuid)
RETURNS public.memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m public.memberships%ROWTYPE;
  today date := (now() AT TIME ZONE 'America/Santo_Domingo')::date;
  new_start date;
  new_end   date;
BEGIN
  -- Lock the row to prevent two terminals from rolling the period twice.
  SELECT * INTO m
  FROM public.memberships
  WHERE supabase_id = membership_id
    AND business_id IN (SELECT my_business_ids())
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'membership_not_found_or_forbidden' USING ERRCODE = 'P0002';
  END IF;

  -- Only carwash rows are advanced by this RPC. Salon rows use a different
  -- session-counter model and must not be touched here.
  IF m.vertical IS NOT NULL AND m.vertical <> 'carwash' THEN
    RETURN m;
  END IF;

  -- Period still in the future → no-op, return as-is.
  IF m.period_end IS NOT NULL AND m.period_end::date >= today THEN
    RETURN m;
  END IF;

  -- Roll forward: new period starts the day after the old period ended.
  -- If period_end is null (legacy row), anchor on today.
  new_start := COALESCE(m.period_end::date + 1, today);
  new_end   := (new_start + INTERVAL '1 month' - INTERVAL '1 day')::date;

  UPDATE public.memberships
     SET period_start            = new_start::text,
         period_end              = new_end::text,
         washes_used_this_period = 0,
         updated_at              = now()
   WHERE supabase_id = membership_id
  RETURNING * INTO m;

  RETURN m;
END;
$$;

REVOKE ALL ON FUNCTION public.carwash_memberships_advance_period(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carwash_memberships_advance_period(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.carwash_memberships_advance_period(uuid) IS
  'v2.16.7 — Atomic rolling-period advance for carwash memberships. RLS-aware via my_business_ids(). Idempotent when period still active.';
