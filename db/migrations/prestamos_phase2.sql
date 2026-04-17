-- Préstamos vertical — Phase 2 (amortization + mora + papeleta + collections)
-- Idempotent. Run via Supabase Management /database/query.

-- ── Loans: add method + daily mora rate ─────────────────────────────────────
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS method          TEXT    DEFAULT 'french';
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS mora_rate_daily NUMERIC(8,5) DEFAULT 0.005;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS days_late       INTEGER DEFAULT 0;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS mora_amount     NUMERIC(14,2) DEFAULT 0;

-- ── Pawn items: ticket_code + redemption_date ──────────────────────────────
ALTER TABLE public.pawn_items ADD COLUMN IF NOT EXISTS ticket_code     TEXT;
ALTER TABLE public.pawn_items ADD COLUMN IF NOT EXISTS redemption_date TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pawn_items_business_ticket_code
  ON public.pawn_items(business_id, ticket_code) WHERE ticket_code IS NOT NULL;

-- ── Loan schedule (amortization rows) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loan_schedule (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id       UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL,
  loan_id           BIGINT,
  loan_supabase_id  UUID,
  installment_no    INTEGER NOT NULL,
  due_date          DATE   NOT NULL,
  principal_due     NUMERIC(14,2) NOT NULL DEFAULT 0,
  interest_due      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_due         NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_at           TIMESTAMPTZ,
  status            TEXT   NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.loan_schedule
  DROP CONSTRAINT IF EXISTS loan_schedule_business_supabase_unique;
ALTER TABLE public.loan_schedule
  ADD CONSTRAINT loan_schedule_business_supabase_unique UNIQUE (business_id, supabase_id);
CREATE INDEX IF NOT EXISTS idx_loan_schedule_loan ON public.loan_schedule(loan_supabase_id);
CREATE INDEX IF NOT EXISTS idx_loan_schedule_due  ON public.loan_schedule(business_id, status, due_date);
ALTER TABLE public.loan_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS loan_schedule_anon_rw ON public.loan_schedule;
CREATE POLICY loan_schedule_anon_rw ON public.loan_schedule FOR ALL
  USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);

-- ── Collections log (debt collection CRM) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.collections_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id           UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id           UUID NOT NULL,
  client_id             BIGINT,
  client_supabase_id    UUID,
  loan_id               BIGINT,
  loan_supabase_id      UUID,
  channel               TEXT NOT NULL,
  outcome               TEXT,
  notes                 TEXT,
  contacted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_contact_date     DATE,
  created_by_staff_id   BIGINT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.collections_log
  DROP CONSTRAINT IF EXISTS collections_log_business_supabase_unique;
ALTER TABLE public.collections_log
  ADD CONSTRAINT collections_log_business_supabase_unique UNIQUE (business_id, supabase_id);
CREATE INDEX IF NOT EXISTS idx_collections_log_loan   ON public.collections_log(loan_supabase_id);
CREATE INDEX IF NOT EXISTS idx_collections_log_client ON public.collections_log(client_supabase_id);
CREATE INDEX IF NOT EXISTS idx_collections_log_next   ON public.collections_log(business_id, next_contact_date);
ALTER TABLE public.collections_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS collections_log_anon_rw ON public.collections_log;
CREATE POLICY collections_log_anon_rw ON public.collections_log FOR ALL
  USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);

-- ── updated_at triggers ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS loan_schedule_touch   ON public.loan_schedule;
CREATE TRIGGER loan_schedule_touch   BEFORE UPDATE ON public.loan_schedule   FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
DROP TRIGGER IF EXISTS collections_log_touch ON public.collections_log;
CREATE TRIGGER collections_log_touch BEFORE UPDATE ON public.collections_log FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
