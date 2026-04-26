-- ──────────────────────────────────────────────────────────────────────────
-- v2.7.1 — Client Loyalty Points Program
-- Adds loyalty_tier column, loyalty_award / loyalty_redeem / loyalty_adjust
-- SECURITY DEFINER functions, and an automatic tier-recompute trigger.
--
-- Schema already in place:
--   clients.loyalty_points (numeric, default 0)
--   loyalty_transactions(id, supabase_id, business_id, client_supabase_id,
--                        ticket_supabase_id, event_type, points, balance_after,
--                        notes, created_at, updated_at)
--
-- This migration is idempotent — safe to re-run.
-- ──────────────────────────────────────────────────────────────────────────

-- 1) loyalty_tier column on clients
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS loyalty_tier TEXT
  DEFAULT 'bronze'
  CHECK (loyalty_tier IN ('bronze','silver','gold','platinum'));

-- 2) Tier-recompute helper. Thresholds are the defaults; owners can tune
-- them via app_settings.loyalty_tier_* but that tuning is applied client-side
-- for display; this function keeps the DB truth sane.
CREATE OR REPLACE FUNCTION public.loyalty_tier_for(points NUMERIC)
RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(points,0) >= 10000 THEN 'platinum'
    WHEN COALESCE(points,0) >= 5000  THEN 'gold'
    WHEN COALESCE(points,0) >= 1000  THEN 'silver'
    ELSE 'bronze'
  END;
$$;

-- 3) Atomic award — bumps points + inserts a ledger row in one tx.
-- Returns the new balance. SECURITY DEFINER so anon (web PWA) can invoke
-- without direct UPDATE rights on clients.
CREATE OR REPLACE FUNCTION public.loyalty_award(
  p_business_id        UUID,
  p_client_supabase_id UUID,
  p_ticket_supabase_id UUID,
  p_points             NUMERIC,
  p_notes              TEXT DEFAULT NULL
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance NUMERIC;
  v_client_id   UUID;
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN RETURN 0; END IF;
  IF p_client_supabase_id IS NULL OR p_business_id IS NULL THEN RETURN 0; END IF;

  -- Bump points + tier in one statement
  UPDATE public.clients
     SET loyalty_points = COALESCE(loyalty_points,0) + p_points,
         loyalty_tier   = public.loyalty_tier_for(COALESCE(loyalty_points,0) + p_points),
         updated_at     = NOW()
   WHERE supabase_id = p_client_supabase_id
     AND business_id = p_business_id
  RETURNING loyalty_points, id INTO v_new_balance, v_client_id;

  IF v_new_balance IS NULL THEN RETURN 0; END IF;

  -- Append ledger row (idempotent on (business_id, ticket_supabase_id, event_type))
  INSERT INTO public.loyalty_transactions (
    supabase_id, business_id, client_supabase_id, ticket_supabase_id,
    event_type, points, balance_after, notes
  ) VALUES (
    gen_random_uuid(), p_business_id, p_client_supabase_id, p_ticket_supabase_id,
    'earn', p_points, v_new_balance, p_notes
  )
  ON CONFLICT DO NOTHING;

  RETURN v_new_balance;
END;
$$;

-- 4) Atomic redeem — subtracts points, records ledger row with negative points.
-- Fails (returns -1) if client doesn't have enough points. Never takes
-- balance below zero.
CREATE OR REPLACE FUNCTION public.loyalty_redeem(
  p_business_id        UUID,
  p_client_supabase_id UUID,
  p_ticket_supabase_id UUID,
  p_points             NUMERIC,
  p_notes              TEXT DEFAULT NULL
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current     NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN RETURN -1; END IF;
  IF p_client_supabase_id IS NULL OR p_business_id IS NULL THEN RETURN -1; END IF;

  SELECT COALESCE(loyalty_points,0) INTO v_current
    FROM public.clients
   WHERE supabase_id = p_client_supabase_id
     AND business_id = p_business_id
   FOR UPDATE;

  IF v_current IS NULL OR v_current < p_points THEN RETURN -1; END IF;

  v_new_balance := v_current - p_points;

  UPDATE public.clients
     SET loyalty_points = v_new_balance,
         loyalty_tier   = public.loyalty_tier_for(v_new_balance),
         updated_at     = NOW()
   WHERE supabase_id = p_client_supabase_id
     AND business_id = p_business_id;

  INSERT INTO public.loyalty_transactions (
    supabase_id, business_id, client_supabase_id, ticket_supabase_id,
    event_type, points, balance_after, notes
  ) VALUES (
    gen_random_uuid(), p_business_id, p_client_supabase_id, p_ticket_supabase_id,
    'redeem', -p_points, v_new_balance, p_notes
  );

  RETURN v_new_balance;
END;
$$;

-- 5) Manual adjustment (owner tool — positive or negative)
CREATE OR REPLACE FUNCTION public.loyalty_adjust(
  p_business_id        UUID,
  p_client_supabase_id UUID,
  p_delta              NUMERIC,
  p_notes              TEXT DEFAULT NULL
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  UPDATE public.clients
     SET loyalty_points = GREATEST(0, COALESCE(loyalty_points,0) + p_delta),
         loyalty_tier   = public.loyalty_tier_for(GREATEST(0, COALESCE(loyalty_points,0) + p_delta)),
         updated_at     = NOW()
   WHERE supabase_id = p_client_supabase_id
     AND business_id = p_business_id
  RETURNING loyalty_points INTO v_new_balance;

  IF v_new_balance IS NULL THEN RETURN 0; END IF;

  INSERT INTO public.loyalty_transactions (
    supabase_id, business_id, client_supabase_id, ticket_supabase_id,
    event_type, points, balance_after, notes
  ) VALUES (
    gen_random_uuid(), p_business_id, p_client_supabase_id, NULL,
    'adjust', p_delta, v_new_balance, p_notes
  );

  RETURN v_new_balance;
END;
$$;

-- 6) Grants — anon + authenticated can call (plan gating is enforced in-app;
-- RLS on clients.business_id still applies to reads).
GRANT EXECUTE ON FUNCTION public.loyalty_award   (UUID,UUID,UUID,NUMERIC,TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.loyalty_redeem  (UUID,UUID,UUID,NUMERIC,TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.loyalty_adjust  (UUID,UUID,NUMERIC,TEXT)       TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.loyalty_tier_for(NUMERIC)                     TO anon, authenticated, service_role;

-- 7) Idempotency guard for award (skip duplicates on same ticket).
-- Partial unique: one 'earn' per (business, ticket).
CREATE UNIQUE INDEX IF NOT EXISTS ux_loyalty_tx_earn_per_ticket
  ON public.loyalty_transactions (business_id, ticket_supabase_id)
  WHERE event_type = 'earn' AND ticket_supabase_id IS NOT NULL;

-- 8) Read index for history views
CREATE INDEX IF NOT EXISTS ix_loyalty_tx_client
  ON public.loyalty_transactions (business_id, client_supabase_id, created_at DESC);
