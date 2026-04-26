-- ════════════════════════════════════════════════════════════════════════════
-- C5 — Lending sync completeness
--
-- Mirrors two SQLite tables (electron/database.js ~1059 + ~1079) into Postgres
-- so the sync.js push for them (electron/sync.js:2204-2209) actually has a
-- destination instead of failing silently.
--
--   loan_schedule   → installment schedule per loan
--   collections_log → collections contact log
--
-- Postgres-side conventions:
--   id UUID PK, supabase_id UUID for cross-device dedupe, business_id FK to
--   businesses ON DELETE CASCADE, money cols NUMERIC(12,2), timestamps
--   TIMESTAMPTZ where appropriate (TEXT preserved where SQLite stored ISO
--   strings the app already parses as text).
--
-- Idempotent — safe to re-run. RLS is enabled here; the tightened anon
-- policies are added in 20260425500000_prestamos_rls_tighten.sql which
-- includes both of these tables in its loop.
-- ════════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────────
-- loan_schedule
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS loan_schedule (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id         UUID,
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  loan_supabase_id    UUID,
  installment_no      INTEGER NOT NULL,
  due_date            TEXT    NOT NULL,
  principal_due       NUMERIC(12,2) NOT NULL DEFAULT 0,
  interest_due        NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_due           NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_at             TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_loan_schedule_biz_sid UNIQUE (business_id, supabase_id)
);

CREATE INDEX IF NOT EXISTS idx_loan_schedule_loan
  ON loan_schedule (loan_supabase_id);
CREATE INDEX IF NOT EXISTS idx_loan_schedule_due
  ON loan_schedule (due_date, status);


-- ────────────────────────────────────────────────────────────────────────────
-- collections_log
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS collections_log (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id          UUID,
  business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  loan_supabase_id     UUID,
  channel              TEXT,
  outcome              TEXT,
  notes                TEXT,
  contacted_at         TIMESTAMPTZ DEFAULT now(),
  next_contact_date    TEXT,
  created_by_staff_id  UUID,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_collections_log_biz_sid UNIQUE (business_id, supabase_id)
);

CREATE INDEX IF NOT EXISTS idx_collections_log_loan
  ON collections_log (loan_supabase_id);
CREATE INDEX IF NOT EXISTS idx_collections_log_next
  ON collections_log (next_contact_date);


-- ────────────────────────────────────────────────────────────────────────────
-- RLS + updated_at triggers (anon policies come from 20260425500000)
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['loan_schedule','collections_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_' || tbl || '_updated_at') THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at()',
        'trg_' || tbl || '_updated_at', tbl
      );
    END IF;
  END LOOP;
END $$;
