-- Parity copy of db/supabase-migration-v2.16.7-carwash-memberships-rpc.sql
-- Kept in sync so `supabase db push` and the manual SQL-editor path produce
-- identical schemas. Edit one, copy to the other.

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
  SELECT * INTO m
  FROM public.memberships
  WHERE supabase_id = membership_id
    AND business_id IN (SELECT my_business_ids())
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'membership_not_found_or_forbidden' USING ERRCODE = 'P0002';
  END IF;

  IF m.vertical IS NOT NULL AND m.vertical <> 'carwash' THEN
    RETURN m;
  END IF;

  IF m.period_end IS NOT NULL AND m.period_end::date >= today THEN
    RETURN m;
  END IF;

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
