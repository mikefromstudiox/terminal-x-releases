-- ============================================================================
-- marketing_leads + demo_sessions
--
-- Backend support for the v2.15 terminalxpos.com landing redesign:
--   * marketing_leads — exit-intent / blog / ROI calc / newsletter capture.
--     anon can INSERT (rate-limited at the app layer); only service_role reads.
--   * demo_sessions  — telemetry for /api/panel?action=demo-login one-click
--     vertical demo logins. anon can INSERT; service_role reads.
-- Both tables follow the supabase_id pattern (id UUID PK + supabase_id UUID
-- UNIQUE) and rely on the existing public.set_updated_at() trigger function
-- defined in earlier migrations:
--     CREATE FUNCTION set_updated_at() RETURNS trigger
--       LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
-- (Verified present in DB on 2026-04-25 before this migration ran.)
-- ============================================================================

-- ── marketing_leads ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketing_leads (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id   uuid        UNIQUE      DEFAULT gen_random_uuid(),
  email         text        NOT NULL,
  source        text        NOT NULL,
  vertical      text,
  business_size text,
  ip            text,
  user_agent    text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_leads_email      ON public.marketing_leads(email);
CREATE INDEX IF NOT EXISTS idx_marketing_leads_source     ON public.marketing_leads(source);
CREATE INDEX IF NOT EXISTS idx_marketing_leads_created_at ON public.marketing_leads(created_at DESC);

DROP TRIGGER IF EXISTS trg_marketing_leads_updated_at ON public.marketing_leads;
CREATE TRIGGER trg_marketing_leads_updated_at
  BEFORE UPDATE ON public.marketing_leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.marketing_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_insert_only" ON public.marketing_leads;
CREATE POLICY "anon_insert_only" ON public.marketing_leads
  FOR INSERT TO anon
  WITH CHECK (
    email IS NOT NULL
    AND length(email) <= 320
    AND source IS NOT NULL
    AND length(source) <= 64
  );

-- service_role bypasses RLS by default; no explicit SELECT/UPDATE/DELETE
-- policies for anon — reads stay private to admin / serverless service-role.

-- ── demo_sessions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.demo_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id   uuid        UNIQUE      DEFAULT gen_random_uuid(),
  vertical      text        NOT NULL,
  ip            text,
  user_agent    text,
  staff_id      uuid,
  business_id   uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demo_sessions_vertical   ON public.demo_sessions(vertical);
CREATE INDEX IF NOT EXISTS idx_demo_sessions_created_at ON public.demo_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demo_sessions_ip         ON public.demo_sessions(ip);

DROP TRIGGER IF EXISTS trg_demo_sessions_updated_at ON public.demo_sessions;
CREATE TRIGGER trg_demo_sessions_updated_at
  BEFORE UPDATE ON public.demo_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.demo_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_insert_only" ON public.demo_sessions;
CREATE POLICY "anon_insert_only" ON public.demo_sessions
  FOR INSERT TO anon
  WITH CHECK (vertical IS NOT NULL AND length(vertical) <= 64);
