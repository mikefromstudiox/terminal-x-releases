-- ════════════════════════════════════════════════════════════════════════════
-- v2.16.7 — Collections daily auto-fire (loan_reminders + pg_cron)
-- Mirror of db/supabase-migration-v2.16.7-collections-cron.sql kept in
-- supabase/migrations/ for the migration runner. Source of truth: db/.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.loan_reminders (
  id                       BIGSERIAL PRIMARY KEY,
  supabase_id              UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  business_id              UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  loan_supabase_id         UUID,
  schedule_supabase_id     UUID,
  client_supabase_id       UUID,
  kind                     TEXT NOT NULL CHECK (kind IN ('24h','2h')),
  due_date                 TEXT NOT NULL,
  fire_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','opened','sent','skipped','failed')),
  message                  TEXT,
  wa_link                  TEXT,
  phone                    TEXT,
  attempts                 INTEGER NOT NULL DEFAULT 0,
  error                    TEXT,
  opened_at                TIMESTAMPTZ,
  sent_at                  TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_reminders_biz_schedule_kind
  ON public.loan_reminders (business_id, schedule_supabase_id, kind)
  WHERE schedule_supabase_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_reminders_biz_loan_kind_loanlevel
  ON public.loan_reminders (business_id, loan_supabase_id, kind, due_date)
  WHERE schedule_supabase_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_loan_reminders_pending
  ON public.loan_reminders (business_id, status, fire_at)
  WHERE status IN ('pending','opened');

CREATE INDEX IF NOT EXISTS idx_loan_reminders_loan
  ON public.loan_reminders (loan_supabase_id);

DROP TRIGGER IF EXISTS trg_loan_reminders_touch ON public.loan_reminders;
CREATE TRIGGER trg_loan_reminders_touch
  BEFORE UPDATE ON public.loan_reminders
  FOR EACH ROW EXECUTE FUNCTION public.trg_touch_updated_at();

ALTER TABLE public.loan_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loan_reminders_select  ON public.loan_reminders;
DROP POLICY IF EXISTS loan_reminders_insert  ON public.loan_reminders;
DROP POLICY IF EXISTS loan_reminders_update  ON public.loan_reminders;
DROP POLICY IF EXISTS loan_reminders_delete  ON public.loan_reminders;
DROP POLICY IF EXISTS loan_reminders_anon_rw ON public.loan_reminders;

CREATE POLICY loan_reminders_select ON public.loan_reminders
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT public.my_business_ids()));

CREATE POLICY loan_reminders_insert ON public.loan_reminders
  FOR INSERT TO authenticated
  WITH CHECK (business_id IN (SELECT public.my_business_ids()));

CREATE POLICY loan_reminders_update ON public.loan_reminders
  FOR UPDATE TO authenticated
  USING (business_id IN (SELECT public.my_business_ids()))
  WITH CHECK (business_id IN (SELECT public.my_business_ids()));

CREATE POLICY loan_reminders_delete ON public.loan_reminders
  FOR DELETE TO authenticated
  USING (business_id IN (SELECT public.my_business_ids()));

CREATE POLICY loan_reminders_anon_rw ON public.loan_reminders
  FOR ALL TO anon
  USING (business_id IS NOT NULL)
  WITH CHECK (business_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.lending_reminders_due(p_business_id UUID DEFAULT NULL)
RETURNS TABLE (
  business_id            UUID,
  loan_supabase_id       UUID,
  schedule_supabase_id   UUID,
  client_supabase_id     UUID,
  client_name            TEXT,
  client_phone           TEXT,
  business_name          TEXT,
  monthly_payment        NUMERIC,
  due_date               TEXT,
  kind                   TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH dr_now AS (
    SELECT (now() AT TIME ZONE 'America/Santo_Domingo')::timestamp AS ts,
           (now() AT TIME ZONE 'America/Santo_Domingo')::date      AS today,
           EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Santo_Domingo'))::int AS hr
  ),
  candidates AS (
    SELECT
      l.business_id,
      l.supabase_id          AS loan_supabase_id,
      ls.supabase_id         AS schedule_supabase_id,
      l.client_supabase_id,
      ls.due_date,
      ls.total_due           AS monthly_payment,
      '24h'::text            AS kind
    FROM loan_schedule ls
    JOIN loans l ON l.supabase_id = ls.loan_supabase_id
    JOIN dr_now ON TRUE
    WHERE ls.status = 'pending'
      AND ls.due_date::date = (dr_now.today + 1)
      AND (p_business_id IS NULL OR l.business_id = p_business_id)

    UNION ALL

    SELECT
      l.business_id,
      l.supabase_id,
      ls.supabase_id,
      l.client_supabase_id,
      ls.due_date,
      ls.total_due,
      '2h'::text
    FROM loan_schedule ls
    JOIN loans l ON l.supabase_id = ls.loan_supabase_id
    JOIN dr_now ON TRUE
    WHERE ls.status = 'pending'
      AND ls.due_date::date = dr_now.today
      AND dr_now.hr BETWEEN 7 AND 11
      AND (p_business_id IS NULL OR l.business_id = p_business_id)
  )
  SELECT
    c.business_id,
    c.loan_supabase_id,
    c.schedule_supabase_id,
    c.client_supabase_id,
    cl.name      AS client_name,
    cl.phone     AS client_phone,
    b.name       AS business_name,
    c.monthly_payment,
    c.due_date,
    c.kind
  FROM candidates c
  LEFT JOIN clients   cl ON cl.supabase_id = c.client_supabase_id
  LEFT JOIN businesses b ON b.id           = c.business_id
  WHERE
    (cl.wa_opt_out IS NULL OR cl.wa_opt_out = false)
    AND cl.phone IS NOT NULL AND length(trim(cl.phone)) > 0
    AND NOT EXISTS (
      SELECT 1 FROM loan_reminders r
      WHERE r.business_id = c.business_id
        AND r.schedule_supabase_id = c.schedule_supabase_id
        AND r.kind = c.kind
        AND r.created_at > now() - INTERVAL '12 hours'
    );
$$;

REVOKE EXECUTE ON FUNCTION public.lending_reminders_due(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.lending_reminders_due(UUID) TO authenticated, service_role;

COMMIT;
