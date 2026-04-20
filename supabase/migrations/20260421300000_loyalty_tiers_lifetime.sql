-- ──────────────────────────────────────────────────────────────────────────
-- Loyalty Tiers + Lifetime Earned + Birthday Treat (v2.7.x ext)
--
-- Extends the loyalty program (20260421000000) with:
--   1. clients.loyalty_lifetime_earned  NUMERIC — cumulative positive delta
--   2. clients.birthday_treat_available BOOL    — gold flag owner can mark
--   3. Tier recompute trigger on loyalty_transactions INSERT
--   4. Tier multiplier helper + Spanish tier alias helper
--
-- Tier thresholds (LIFETIME earned, not current balance):
--     bronze  / bronce →     0 – 999     (multiplier 1.00)
--     silver  / plata  →  1 000 – 4 999  (multiplier 1.25)
--     gold    / oro    →  5 000+         (multiplier 1.50, + birthday flag)
--
-- Fully idempotent — safe to re-run.
-- ──────────────────────────────────────────────────────────────────────────

-- 1) New columns
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS loyalty_lifetime_earned NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS birthday_treat_available BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) Lifetime-based tier classifier (supersedes the balance-based one for
--    tier assignment, but we keep loyalty_tier_for() around for points rules).
CREATE OR REPLACE FUNCTION public.loyalty_tier_for_lifetime(lifetime NUMERIC)
RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(lifetime,0) >= 5000 THEN 'gold'
    WHEN COALESCE(lifetime,0) >= 1000 THEN 'silver'
    ELSE 'bronze'
  END;
$$;

-- Earn multiplier per tier.
CREATE OR REPLACE FUNCTION public.loyalty_tier_multiplier(tier TEXT)
RETURNS NUMERIC LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE COALESCE(tier,'bronze')
    WHEN 'gold'   THEN 1.50
    WHEN 'silver' THEN 1.25
    ELSE 1.00
  END;
$$;

-- Spanish alias (bronze→bronce, silver→plata, gold→oro). Accepts either.
CREATE OR REPLACE FUNCTION public.loyalty_tier_label_es(tier TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE LOWER(COALESCE(tier,'bronze'))
    WHEN 'gold'     THEN 'oro'
    WHEN 'silver'   THEN 'plata'
    WHEN 'platinum' THEN 'oro'       -- legacy rows map upward
    ELSE 'bronce'
  END;
$$;

-- 3) Trigger: on every loyalty_transactions INSERT, re-derive lifetime_earned
--    + loyalty_tier from the canonical ledger sum. Idempotent by construction
--    (SUM over the ledger, never incremental), so replays are safe.
CREATE OR REPLACE FUNCTION public.loyalty_recompute_tier()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_lifetime NUMERIC;
  v_tier     TEXT;
  v_biz      UUID;
  v_cli      UUID;
BEGIN
  v_biz := COALESCE(NEW.business_id, OLD.business_id);
  v_cli := COALESCE(NEW.client_supabase_id, OLD.client_supabase_id);
  IF v_cli IS NULL OR v_biz IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(points), 0) INTO v_lifetime
    FROM public.loyalty_transactions
   WHERE business_id = v_biz
     AND client_supabase_id = v_cli
     AND points > 0
     AND event_type IN ('earn','adjust');

  v_tier := public.loyalty_tier_for_lifetime(v_lifetime);

  UPDATE public.clients
     SET loyalty_lifetime_earned = v_lifetime,
         loyalty_tier            = v_tier,
         updated_at              = NOW()
   WHERE supabase_id = v_cli
     AND business_id = v_biz
     AND (loyalty_lifetime_earned IS DISTINCT FROM v_lifetime
       OR loyalty_tier            IS DISTINCT FROM v_tier);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_recompute_tier ON public.loyalty_transactions;
CREATE TRIGGER trg_loyalty_recompute_tier
  AFTER INSERT ON public.loyalty_transactions
  FOR EACH ROW EXECUTE FUNCTION public.loyalty_recompute_tier();

-- 4) Rewire loyalty_award to apply the tier multiplier BEFORE persisting.
--    Multiplier is taken from the client's CURRENT tier (snapshot at award
--    time) so crossing a threshold mid-award doesn't retroactively boost.
--    Ledger row stores the effective (multiplied) points so the trigger
--    recomputes lifetime correctly and redemptions see the real balance.
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
  v_tier        TEXT;
  v_mult        NUMERIC;
  v_effective   NUMERIC;
  v_existing    NUMERIC;
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN RETURN 0; END IF;
  IF p_client_supabase_id IS NULL OR p_business_id IS NULL THEN RETURN 0; END IF;

  -- Idempotency guard (matches ux_loyalty_tx_earn_per_ticket index)
  IF p_ticket_supabase_id IS NOT NULL THEN
    SELECT balance_after INTO v_existing
      FROM public.loyalty_transactions
     WHERE business_id = p_business_id
       AND ticket_supabase_id = p_ticket_supabase_id
       AND event_type = 'earn'
     LIMIT 1;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;

  -- Snapshot current tier → multiplier
  SELECT loyalty_tier INTO v_tier
    FROM public.clients
   WHERE supabase_id = p_client_supabase_id
     AND business_id = p_business_id
   FOR UPDATE;

  IF v_tier IS NULL THEN RETURN 0; END IF;
  v_mult      := public.loyalty_tier_multiplier(v_tier);
  v_effective := ROUND(p_points * v_mult, 2);

  UPDATE public.clients
     SET loyalty_points = COALESCE(loyalty_points,0) + v_effective,
         updated_at     = NOW()
   WHERE supabase_id = p_client_supabase_id
     AND business_id = p_business_id
  RETURNING loyalty_points INTO v_new_balance;

  INSERT INTO public.loyalty_transactions (
    supabase_id, business_id, client_supabase_id, ticket_supabase_id,
    event_type, points, balance_after, notes
  ) VALUES (
    gen_random_uuid(), p_business_id, p_client_supabase_id, p_ticket_supabase_id,
    'earn', v_effective, v_new_balance,
    CASE WHEN v_mult > 1
      THEN COALESCE(p_notes,'') || ' [x' || v_mult::TEXT || ' ' || v_tier || ']'
      ELSE p_notes END
  )
  ON CONFLICT DO NOTHING;
  -- Trigger recomputes lifetime + tier now.

  RETURN v_new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.loyalty_tier_for_lifetime(NUMERIC) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.loyalty_tier_multiplier(TEXT)      TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.loyalty_tier_label_es(TEXT)        TO anon, authenticated, service_role;

-- 5) Back-fill lifetime_earned for existing data (one-shot, safe to re-run).
UPDATE public.clients c
   SET loyalty_lifetime_earned = x.lifetime,
       loyalty_tier            = public.loyalty_tier_for_lifetime(x.lifetime)
  FROM (
    SELECT client_supabase_id, business_id, SUM(points) AS lifetime
      FROM public.loyalty_transactions
     WHERE points > 0 AND event_type IN ('earn','adjust')
     GROUP BY client_supabase_id, business_id
  ) x
 WHERE c.supabase_id = x.client_supabase_id
   AND c.business_id = x.business_id
   AND (c.loyalty_lifetime_earned IS DISTINCT FROM x.lifetime
     OR c.loyalty_tier            IS DISTINCT FROM public.loyalty_tier_for_lifetime(x.lifetime));

-- 6) Index for top-N gold leaderboard
CREATE INDEX IF NOT EXISTS ix_clients_loyalty_tier_lifetime
  ON public.clients (business_id, loyalty_tier, loyalty_lifetime_earned DESC)
  WHERE active IS TRUE OR active IS NULL;
