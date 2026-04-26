-- ════════════════════════════════════════════════════════════════════════════
-- v2.16.2 — Prestamos hardening
-- Adds amortization method + renewal tracking to loans, valuation/signature
-- fields to pawn_items, and 5 new tables for contracts, renewals, pawn docs,
-- public listings, and collections attempts. Plus 3 storage buckets.
-- All idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 1: ALTER existing tables
-- ────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE loans ADD COLUMN amortization_method TEXT DEFAULT 'interest_only';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE loans ADD CONSTRAINT loans_amortization_method_check
    CHECK (amortization_method IN ('french','german','interest_only'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE loans ADD COLUMN renewal_count INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE pawn_items ADD COLUMN default_alert_days INTEGER DEFAULT 3;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE pawn_items ADD COLUMN valoracion_notes TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE pawn_items ADD COLUMN offered_pct NUMERIC(5,2) DEFAULT 60;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE pawn_items ADD COLUMN signature_dataurl TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2: New tables
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS loan_contracts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id         UUID,
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  loan_supabase_id    UUID,
  pdf_url             TEXT,
  signature_dataurl   TEXT,
  dpi_photo_url       TEXT,
  signed_at           TIMESTAMPTZ,
  apr_monthly         NUMERIC(6,4),
  apr_annual_equiv    NUMERIC(6,4),
  clauses_version     TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_loan_contracts_biz_sid UNIQUE (business_id, supabase_id)
);

CREATE TABLE IF NOT EXISTS loan_renewals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id         UUID,
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  loan_supabase_id    UUID,
  renewal_count       INTEGER,
  interest_paid       NUMERIC(12,2),
  new_due_date        TEXT,
  previous_due_date   TEXT,
  renewed_at          TIMESTAMPTZ DEFAULT now(),
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_loan_renewals_biz_sid UNIQUE (business_id, supabase_id)
);

CREATE TABLE IF NOT EXISTS pawn_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id         UUID,
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  pawn_supabase_id    UUID,
  doc_type            TEXT CHECK (doc_type IN ('foto','dpi','matricula','firma','contrato','otro')),
  file_url            TEXT,
  mime_type           TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_pawn_documents_biz_sid UNIQUE (business_id, supabase_id)
);

CREATE TABLE IF NOT EXISTS pawn_listings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id              UUID,
  business_id              UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  pawn_supabase_id         UUID,
  list_price               NUMERIC(12,2),
  published_at             TIMESTAMPTZ,
  slug                     TEXT,
  status                   TEXT DEFAULT 'draft' CHECK (status IN ('draft','published','sold','removed')),
  sold_ticket_supabase_id  UUID,
  notes                    TEXT,
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_pawn_listings_biz_sid UNIQUE (business_id, supabase_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pawn_listings_biz_slug
  ON pawn_listings (business_id, slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS collections_attempts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id         UUID,
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  loan_supabase_id    UUID,
  attempt_at          TIMESTAMPTZ DEFAULT now(),
  outcome             TEXT CHECK (outcome IN ('called','promised','paid','no_answer','refused')),
  notes               TEXT,
  next_followup_at    TIMESTAMPTZ,
  whatsapp_sent       BOOLEAN DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_collections_attempts_biz_sid UNIQUE (business_id, supabase_id)
);


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 3: RLS + updated_at triggers (loop pattern)
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'loan_contracts','loan_renewals','pawn_documents','pawn_listings','collections_attempts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=tbl AND policyname=tbl || '_anon_all') THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL)',
        tbl || '_anon_all', tbl
      );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_' || tbl || '_updated_at') THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at()',
        'trg_' || tbl || '_updated_at', tbl
      );
    END IF;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 4: Storage buckets
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
  VALUES ('pawn-photos', 'pawn-photos', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
  VALUES ('pawn-documents', 'pawn-documents', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
  VALUES ('loan-documents', 'loan-documents', false)
ON CONFLICT (id) DO NOTHING;

-- pawn-photos: public read, anon write/update/delete
DO $$ BEGIN
  CREATE POLICY "pawn-photos public read" ON storage.objects
    FOR SELECT USING (bucket_id = 'pawn-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "pawn-photos anon write" ON storage.objects
    FOR INSERT TO anon WITH CHECK (bucket_id = 'pawn-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "pawn-photos anon update" ON storage.objects
    FOR UPDATE TO anon USING (bucket_id = 'pawn-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "pawn-photos anon delete" ON storage.objects
    FOR DELETE TO anon USING (bucket_id = 'pawn-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- pawn-documents: anon all (private)
DO $$ BEGIN
  CREATE POLICY "pawn-documents anon all" ON storage.objects
    FOR ALL TO anon USING (bucket_id = 'pawn-documents') WITH CHECK (bucket_id = 'pawn-documents');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- loan-documents: anon all (private)
DO $$ BEGIN
  CREATE POLICY "loan-documents anon all" ON storage.objects
    FOR ALL TO anon USING (bucket_id = 'loan-documents') WITH CHECK (bucket_id = 'loan-documents');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
