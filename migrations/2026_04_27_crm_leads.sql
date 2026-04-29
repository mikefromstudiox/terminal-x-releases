-- 2026_04_27_crm_leads.sql
-- CRM tab for the admin panel: track every signup as a sales lead with
-- assignment + status + follow-up date + activity feed (notes / calls /
-- whatsapp). Auto-created on signup/provision. Manual cold-leads also
-- supported (business_id NULL until they actually sign up).
--
-- Service-role only. Anon has no access. Admin panel uses service role
-- behind the JWT-verified requireAdmin() gate in web/api/panel.js.

-- ── crm_leads ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  email             text,
  phone             text,
  contact_name      text,
  business_name     text,
  rnc               text,
  requested_plan    text,
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  business_type     text,
  assigned_to       uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','contacted','qualified','demo_scheduled','proposal','won','lost')),
  last_contacted_at timestamptz,
  next_followup_at  timestamptz,
  source            text NOT NULL DEFAULT 'signup'
                    CHECK (source IN ('signup','manual','import')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_leads_business_id_uniq
  ON public.crm_leads(business_id) WHERE business_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_leads_status_idx       ON public.crm_leads(status);
CREATE INDEX IF NOT EXISTS crm_leads_assigned_to_idx  ON public.crm_leads(assigned_to);
CREATE INDEX IF NOT EXISTS crm_leads_created_at_idx   ON public.crm_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS crm_leads_followup_idx     ON public.crm_leads(next_followup_at)
  WHERE next_followup_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_leads_plan_idx         ON public.crm_leads(requested_plan);

-- ── crm_lead_activity ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_lead_activity (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  admin_user_id   uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  admin_name      text,
  kind            text NOT NULL DEFAULT 'note'
                  CHECK (kind IN ('note','call','whatsapp','email','status_change','assignment','followup_set')),
  body            text,
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_lead_activity_lead_idx
  ON public.crm_lead_activity(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_lead_activity_admin_idx
  ON public.crm_lead_activity(admin_user_id, created_at DESC);

-- ── updated_at trigger ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_leads_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS crm_leads_touch ON public.crm_leads;
CREATE TRIGGER crm_leads_touch
  BEFORE UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.crm_leads_set_updated_at();

-- ── RLS — service role only ───────────────────────────────────────────
ALTER TABLE public.crm_leads         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_lead_activity ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.crm_leads         FROM anon, authenticated;
REVOKE ALL ON public.crm_lead_activity FROM anon, authenticated;

DROP POLICY IF EXISTS crm_leads_no_anon         ON public.crm_leads;
DROP POLICY IF EXISTS crm_lead_activity_no_anon ON public.crm_lead_activity;

-- Stub policies so rls-policy-audit.mjs sees a policy; service role
-- bypasses RLS. Anon/authenticated still get nothing because we revoked
-- table grants above.
CREATE POLICY crm_leads_no_anon ON public.crm_leads
  FOR SELECT TO authenticated USING (false);
CREATE POLICY crm_lead_activity_no_anon ON public.crm_lead_activity
  FOR SELECT TO authenticated USING (false);

-- ── Backfill: every existing business becomes a lead (idempotent) ────
INSERT INTO public.crm_leads (business_id, business_name, rnc, phone,
                              requested_plan, source, status, created_at)
SELECT
  b.id,
  b.name,
  b.rnc,
  b.phone,
  COALESCE((b.settings->>'requested_plan'), b.plan, 'pro'),
  'signup',
  'new',
  b.created_at
FROM public.businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM public.crm_leads l WHERE l.business_id = b.id
);
