-- 2026_04_27_client_errors.sql
-- Per-client browser/desktop error log. Surface in admin panel so we can
-- spot regressions per business without the user having to send screenshots.

CREATE TABLE IF NOT EXISTS public.client_errors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  message       text NOT NULL,
  stack         text,
  route         text,
  user_agent    text,
  app_version   text,
  user_id       uuid,
  user_role     text,
  severity      text NOT NULL DEFAULT 'error' CHECK (severity IN ('error','warning','info')),
  resolved_at   timestamptz,
  resolved_by   uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  resolution    text,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_errors_business_id_idx ON public.client_errors(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS client_errors_unresolved_idx  ON public.client_errors(created_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS client_errors_severity_idx    ON public.client_errors(severity, created_at DESC);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

-- Anon clients can INSERT their own error rows (anonymous reports OK — auth is
-- best-effort at error time). Reads are admin-only via service role.
DROP POLICY IF EXISTS client_errors_anon_insert ON public.client_errors;
CREATE POLICY client_errors_anon_insert ON public.client_errors
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- No anon SELECT — admin panel uses service role.
