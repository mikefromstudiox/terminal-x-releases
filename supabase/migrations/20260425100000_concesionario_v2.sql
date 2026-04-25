-- Concesionario v2 — expand dealership vertical
-- Adds: vehicle photos, deal commission, lead CRM follow-up,
-- test drive outcome, vehicle_documents table.

-- 1. vehicle_inventory: photos + featured flag
ALTER TABLE vehicle_inventory
  ADD COLUMN IF NOT EXISTS photo_urls TEXT[] DEFAULT '{}'::TEXT[],
  ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT false;

-- 2. sales_deals: commission tracking
ALTER TABLE sales_deals
  ADD COLUMN IF NOT EXISTS commission_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS commission_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS commission_paid BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS commission_paid_at TIMESTAMPTZ;

-- 3. leads (sales_pipeline): CRM follow-up
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS next_followup_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS interested_vehicle_supabase_id UUID;

-- 4. test_drives: outcome tracking
ALTER TABLE test_drives
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS outcome_notes TEXT,
  ADD COLUMN IF NOT EXISTS deal_supabase_id UUID;

DO $$ BEGIN
  ALTER TABLE test_drives ADD CONSTRAINT test_drives_outcome_check
    CHECK (outcome IS NULL OR outcome IN ('pending','sold','lost','follow_up'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. vehicle_documents: title / registration / insurance / inspection / other
CREATE TABLE IF NOT EXISTS vehicle_documents (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vehicle_inventory_supabase_id UUID NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('title','registration','insurance','inspection','other')),
  file_url TEXT NOT NULL,
  file_name TEXT,
  expires_at TIMESTAMPTZ,
  notes TEXT,
  active BOOLEAN DEFAULT true,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_documents_biz_vehicle_idx
  ON vehicle_documents (business_id, vehicle_inventory_supabase_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS vehicle_documents_expiry_idx
  ON vehicle_documents (business_id, expires_at) WHERE active = true AND expires_at IS NOT NULL;

ALTER TABLE vehicle_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY vehicle_documents_anon_select ON vehicle_documents
    FOR SELECT TO anon USING (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY vehicle_documents_anon_insert ON vehicle_documents
    FOR INSERT TO anon WITH CHECK (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY vehicle_documents_anon_update ON vehicle_documents
    FOR UPDATE TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY vehicle_documents_anon_delete ON vehicle_documents
    FOR DELETE TO anon USING (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION trg_vehicle_documents_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vehicle_documents_set_updated_at ON vehicle_documents;
CREATE TRIGGER vehicle_documents_set_updated_at
  BEFORE UPDATE ON vehicle_documents
  FOR EACH ROW EXECUTE FUNCTION trg_vehicle_documents_set_updated_at();

-- 6. Storage bucket for vehicle photos (idempotent)
INSERT INTO storage.buckets (id, name, public)
  VALUES ('vehicle-photos', 'vehicle-photos', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
  VALUES ('vehicle-documents', 'vehicle-documents', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "vehicle-photos public read" ON storage.objects
    FOR SELECT USING (bucket_id = 'vehicle-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "vehicle-photos anon write" ON storage.objects
    FOR INSERT TO anon WITH CHECK (bucket_id = 'vehicle-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "vehicle-photos anon update" ON storage.objects
    FOR UPDATE TO anon USING (bucket_id = 'vehicle-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "vehicle-photos anon delete" ON storage.objects
    FOR DELETE TO anon USING (bucket_id = 'vehicle-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "vehicle-documents anon all" ON storage.objects
    FOR ALL TO anon USING (bucket_id = 'vehicle-documents') WITH CHECK (bucket_id = 'vehicle-documents');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
