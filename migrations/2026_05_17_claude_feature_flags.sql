-- 2026-05-17 — Claude per-business feature flags (Layers 6-8).
--
-- Three (eventually five) Claude-powered features land behind PER-BUSINESS
-- toggles + a monthly USD budget. Default OFF for every business — Mike (admin)
-- flips them on per-client via the admin ClientDetail screen. Studio X SRL's
-- row is pre-seeded with the 3 launch features ON (Mike dogfoods first).
--
-- No RLS — admin-only access via service_role from /api/panel. Authed
-- end-users never read this table directly.

CREATE TABLE IF NOT EXISTS public.claude_feature_flags (
  business_id           UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  dgii_error_translator BOOLEAN NOT NULL DEFAULT false,
  cuadre_anomaly        BOOLEAN NOT NULL DEFAULT false,
  insights_digest       BOOLEAN NOT NULL DEFAULT false,
  -- Reserved for future expansion (no UI yet — show as próximamente toggles).
  reorder_suggestions   BOOLEAN NOT NULL DEFAULT false,
  faq_autoreply         BOOLEAN NOT NULL DEFAULT false,
  monthly_budget_usd    NUMERIC(8,2) NOT NULL DEFAULT 2.00,
  spent_this_month_usd  NUMERIC(8,2) NOT NULL DEFAULT 0,
  spent_reset_at        DATE NOT NULL DEFAULT date_trunc('month', now())::date,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            TEXT
);

CREATE INDEX IF NOT EXISTS idx_claude_feature_flags_updated_at
  ON public.claude_feature_flags (updated_at DESC);

-- Atomically bump usage + reset monthly counter at month boundary.
-- Returns true if the spend was accepted, false if it would exceed budget
-- (caller skips the Claude call).
CREATE OR REPLACE FUNCTION public.bump_claude_usage(p_business_id UUID, p_cost_usd NUMERIC)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_budget   NUMERIC;
  v_spent    NUMERIC;
  v_reset_at DATE;
BEGIN
  SELECT monthly_budget_usd, spent_this_month_usd, spent_reset_at
    INTO v_budget, v_spent, v_reset_at
  FROM public.claude_feature_flags
  WHERE business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_reset_at < date_trunc('month', now())::date THEN
    v_spent    := 0;
    v_reset_at := date_trunc('month', now())::date;
  END IF;

  IF (v_spent + COALESCE(p_cost_usd, 0)) > v_budget THEN
    RETURN false;
  END IF;

  UPDATE public.claude_feature_flags
     SET spent_this_month_usd = v_spent + COALESCE(p_cost_usd, 0),
         spent_reset_at       = v_reset_at,
         updated_at           = now()
   WHERE business_id = p_business_id;

  RETURN true;
END $$;

-- Queue for WhatsApp alert payloads that couldn't be delivered (cron-out-of-scope retry).
CREATE TABLE IF NOT EXISTS public.claude_alerts_pending (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  feature       TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('info','warn','critical')),
  message       TEXT NOT NULL,
  to_phone      TEXT,
  sent_at       TIMESTAMPTZ,
  failed_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claude_alerts_pending_unsent
  ON public.claude_alerts_pending (created_at DESC)
  WHERE sent_at IS NULL;

-- Seed Studio X SRL (Mike dogfoods) with all 3 launch features ON.
INSERT INTO public.claude_feature_flags
  (business_id, dgii_error_translator, cuadre_anomaly, insights_digest, monthly_budget_usd, updated_by)
VALUES
  ('1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79', true, true, true, 10.00, 'migration_seed')
ON CONFLICT (business_id) DO UPDATE
  SET dgii_error_translator = EXCLUDED.dgii_error_translator,
      cuadre_anomaly        = EXCLUDED.cuadre_anomaly,
      insights_digest       = EXCLUDED.insights_digest,
      monthly_budget_usd    = EXCLUDED.monthly_budget_usd,
      updated_at            = now(),
      updated_by            = EXCLUDED.updated_by;
