-- ════════════════════════════════════════════════════════════════════════════
-- v2.16.7 — Collections daily auto-fire (loan_reminders + pg_cron)
-- ════════════════════════════════════════════════════════════════════════════
-- Wires hourly cron → collections_remind action → wa.me deep-link reminders.
--
--   * loan_reminders         — per (business, schedule, kind) idempotent queue
--   * lending_reminders_due  — RPC returning unsent matches in the 24h/2h windows
--   * cron job (commented)   — hourly tick to /api/panel?action=collections_remind
--
-- IMPORTANT — automated-send claim. We DO NOT have WhatsApp Business API
-- approved as of v2.16.7. The reminders are queued + presented in-app with
-- a one-click wa.me link the user opens themselves. UI strings must reflect
-- this honestly ("Recordatorios pendientes", "Abrir WhatsApp" — never
-- "Enviado" until WABA is live and `app_settings.waba_approved='true'`).
--
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- loan_reminders — durable queue, one row per (loan, schedule, kind, business)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.loan_reminders (
  id                       BIGSERIAL PRIMARY KEY,
  supabase_id              UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  business_id              UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  loan_supabase_id         UUID,
  schedule_supabase_id     UUID,                                  -- loan_schedule row, NULL when reminder is whole-loan-level
  client_supabase_id       UUID,
  kind                     TEXT NOT NULL CHECK (kind IN ('24h','2h')),
  due_date                 TEXT NOT NULL,                         -- 'YYYY-MM-DD' mirror from loan_schedule
  fire_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),    -- when the cron picked it up
  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','opened','sent','skipped','failed')),
  message                  TEXT,                                  -- pre-rendered Spanish body
  wa_link                  TEXT,                                  -- pre-built wa.me URL
  phone                    TEXT,                                  -- normalised E.164-ish
  attempts                 INTEGER NOT NULL DEFAULT 0,
  error                    TEXT,
  opened_at                TIMESTAMPTZ,                           -- user clicked the link
  sent_at                  TIMESTAMPTZ,                           -- WABA-only future
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: same business cannot enqueue the same (schedule_row, kind) twice
-- within its life. Loan-level fallback (schedule_supabase_id NULL) keys on loan.
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

-- Touch updated_at on UPDATE for LWW sync.
DROP TRIGGER IF EXISTS trg_loan_reminders_touch ON public.loan_reminders;
CREATE TRIGGER trg_loan_reminders_touch
  BEFORE UPDATE ON public.loan_reminders
  FOR EACH ROW EXECUTE FUNCTION public.trg_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- RLS — match collections_attempts / loan_schedule tenancy
-- ────────────────────────────────────────────────────────────────────────────

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

-- ────────────────────────────────────────────────────────────────────────────
-- lending_reminders_due — RPC: rows that should be enqueued *right now*
-- ────────────────────────────────────────────────────────────────────────────
-- Returns one row per (business, schedule, kind) that is:
--   * 24h kind  → due_date == (current_date_dr + 1)
--   * 2h kind   → due_date == current_date_dr   AND now_dr_hour BETWEEN 7 AND 11
--                  (morning courtesy — due_date is date-only, not timestamp,
--                   so "2h before midnight" is meaningless. We use a same-day
--                   morning window instead. Owners get one nudge before noon.)
-- Excludes any (schedule_supabase_id, kind) that already has a reminder row
-- in the last 12h (matches spec: "no reminder of that type sent in last 12h").
-- DR is UTC-4, no DST, so `now() AT TIME ZONE 'America/Santo_Domingo'` is safe.

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
    -- 24h ahead: due tomorrow (any time of day this is valid)
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

    -- Same-day morning courtesy ("2h" kind — see header note)
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
    -- DR-honest opt-out
    (cl.wa_opt_out IS NULL OR cl.wa_opt_out = false)
    -- Need a phone to send anything
    AND cl.phone IS NOT NULL AND length(trim(cl.phone)) > 0
    -- 12h dedupe
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

-- ─────────────────────────────────────────────────────────────────────────────
-- ── COPY-PASTE INTO SUPABASE SQL EDITOR (requires pg_cron + pg_net) ─────────
-- ─────────────────────────────────────────────────────────────────────────────
-- Cron expression `0 * * * *` = top of every hour UTC. The action is idempotent
-- (12h dedupe inside lending_reminders_due) so multiple ticks are safe.
--
-- Pre-reqs in DB settings:
--   ALTER DATABASE postgres SET app.collections_remind_url
--     = 'https://terminalxpos.com/api/panel?action=collections_remind';
--   ALTER DATABASE postgres SET app.cron_secret = '<CRON_SECRET-from-Vercel-env>';
--
-- /*
-- SELECT cron.schedule(
--   'lending-collections-remind-hourly',
--   '0 * * * *',
--   $$
--     SELECT net.http_post(
--       url := current_setting('app.collections_remind_url', true),
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'x-cron-secret', current_setting('app.cron_secret', true)
--       ),
--       body := '{"mode":"cron"}'::jsonb
--     );
--   $$
-- );
-- */
--
-- To deactivate later:
--   SELECT cron.unschedule('lending-collections-remind-hourly');
-- ────────────────────────────────────────────────────────────────────────────
