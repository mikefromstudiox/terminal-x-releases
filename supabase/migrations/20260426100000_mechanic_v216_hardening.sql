-- v2.16.0 Taller Mecánico Hardening
-- Adds: aseguradoras, parts_orders, suppliers, work_order_photos, insurance_batches.
-- Extends: work_orders (insurance, started/finished/ready_at, delivery, validity_until).
-- Storage: mechanic-photos bucket. Idempotent.

-- ── 1. work_orders: insurance, timing, delivery, cotización validity ─────────
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS aseguradora_supabase_id UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS poliza_no                TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS reclamo_no               TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS aseguradora_status       TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS started_at               TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS finished_at              TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS ready_at                 TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS delivery_required        BOOLEAN DEFAULT false;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS delivery_fee             NUMERIC(14,2) DEFAULT 0;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS validity_until           DATE;

DO $$ BEGIN
  ALTER TABLE work_orders ADD CONSTRAINT work_orders_aseguradora_status_check
    CHECK (aseguradora_status IS NULL OR aseguradora_status IN ('pendiente','aprobado','rechazado'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_work_orders_aseguradora
  ON work_orders(aseguradora_supabase_id)
  WHERE aseguradora_supabase_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_validity_until
  ON work_orders(validity_until)
  WHERE validity_until IS NOT NULL;

-- ── 2. aseguradoras ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aseguradoras (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  rnc TEXT,
  contacto_telefono TEXT,
  contacto_email TEXT,
  ecf_mode TEXT NOT NULL DEFAULT 'per_wo' CHECK (ecf_mode IN ('per_wo','monthly_batch')),
  notas TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE aseguradoras ADD CONSTRAINT aseguradoras_business_supabase_uk
    UNIQUE (business_id, supabase_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS aseguradoras_biz_active_idx
  ON aseguradoras (business_id) WHERE active = true;

ALTER TABLE aseguradoras ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY aseguradoras_anon_select ON aseguradoras
    FOR SELECT TO anon USING (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY aseguradoras_anon_insert ON aseguradoras
    FOR INSERT TO anon WITH CHECK (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY aseguradoras_anon_update ON aseguradoras
    FOR UPDATE TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY aseguradoras_anon_delete ON aseguradoras
    FOR DELETE TO anon USING (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION trg_aseguradoras_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS aseguradoras_set_updated_at ON aseguradoras;
CREATE TRIGGER aseguradoras_set_updated_at
  BEFORE UPDATE ON aseguradoras
  FOR EACH ROW EXECUTE FUNCTION trg_aseguradoras_set_updated_at();

-- ── 3. suppliers ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  rnc TEXT,
  telefono TEXT,
  contacto TEXT,
  notas TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE suppliers ADD CONSTRAINT suppliers_business_supabase_uk
    UNIQUE (business_id, supabase_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS suppliers_biz_active_idx
  ON suppliers (business_id) WHERE active = true;

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY suppliers_anon_select ON suppliers
    FOR SELECT TO anon USING (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY suppliers_anon_insert ON suppliers
    FOR INSERT TO anon WITH CHECK (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY suppliers_anon_update ON suppliers
    FOR UPDATE TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY suppliers_anon_delete ON suppliers
    FOR DELETE TO anon USING (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION trg_suppliers_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS suppliers_set_updated_at ON suppliers;
CREATE TRIGGER suppliers_set_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION trg_suppliers_set_updated_at();

-- ── 4. parts_orders ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parts_orders (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  work_order_supabase_id UUID,
  supplier_supabase_id UUID,
  part_name TEXT NOT NULL,
  part_sku TEXT,
  quantity NUMERIC(14,2) NOT NULL DEFAULT 1,
  unit_cost_estimate NUMERIC(14,2) DEFAULT 0,
  expected_at DATE,
  received_at TIMESTAMPTZ,
  received_barcode TEXT,
  status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente','en_camino','recibido','cancelado')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE parts_orders ADD CONSTRAINT parts_orders_business_supabase_uk
    UNIQUE (business_id, supabase_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS parts_orders_biz_status_idx
  ON parts_orders (business_id, status);
CREATE INDEX IF NOT EXISTS parts_orders_wo_idx
  ON parts_orders (work_order_supabase_id);
CREATE INDEX IF NOT EXISTS parts_orders_barcode_idx
  ON parts_orders (business_id, received_barcode)
  WHERE received_barcode IS NOT NULL;

ALTER TABLE parts_orders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY parts_orders_anon_select ON parts_orders
    FOR SELECT TO anon USING (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY parts_orders_anon_insert ON parts_orders
    FOR INSERT TO anon WITH CHECK (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY parts_orders_anon_update ON parts_orders
    FOR UPDATE TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY parts_orders_anon_delete ON parts_orders
    FOR DELETE TO anon USING (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION trg_parts_orders_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS parts_orders_set_updated_at ON parts_orders;
CREATE TRIGGER parts_orders_set_updated_at
  BEFORE UPDATE ON parts_orders
  FOR EACH ROW EXECUTE FUNCTION trg_parts_orders_set_updated_at();

-- ── 5. work_order_photos (append-only; no updated_at) ───────────────────────
CREATE TABLE IF NOT EXISTS work_order_photos (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  work_order_supabase_id UUID,
  vehicle_supabase_id UUID,
  phase TEXT NOT NULL CHECK (phase IN ('antes','despues')),
  storage_path TEXT NOT NULL,
  taken_by_empleado_supabase_id UUID,
  caption TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE work_order_photos ADD CONSTRAINT work_order_photos_business_supabase_uk
    UNIQUE (business_id, supabase_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS work_order_photos_wo_idx
  ON work_order_photos (work_order_supabase_id);
CREATE INDEX IF NOT EXISTS work_order_photos_vehicle_idx
  ON work_order_photos (vehicle_supabase_id);

ALTER TABLE work_order_photos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY work_order_photos_anon_select ON work_order_photos
    FOR SELECT TO anon USING (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY work_order_photos_anon_insert ON work_order_photos
    FOR INSERT TO anon WITH CHECK (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY work_order_photos_anon_delete ON work_order_photos
    FOR DELETE TO anon USING (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 6. insurance_batches ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insurance_batches (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  aseguradora_supabase_id UUID NOT NULL,
  period_month DATE NOT NULL,
  ecf_supabase_id UUID,
  ecf_ncf TEXT,
  total_amount NUMERIC(14,2) DEFAULT 0,
  itbis_amount NUMERIC(14,2) DEFAULT 0,
  pdf_storage_path TEXT,
  work_order_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'borrador'
    CHECK (status IN ('borrador','emitido','enviado','pagado','cancelado')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE insurance_batches ADD CONSTRAINT insurance_batches_business_supabase_uk
    UNIQUE (business_id, supabase_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS insurance_batches_biz_period_idx
  ON insurance_batches (business_id, aseguradora_supabase_id, period_month);

ALTER TABLE insurance_batches ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY insurance_batches_anon_select ON insurance_batches
    FOR SELECT TO anon USING (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY insurance_batches_anon_insert ON insurance_batches
    FOR INSERT TO anon WITH CHECK (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY insurance_batches_anon_update ON insurance_batches
    FOR UPDATE TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY insurance_batches_anon_delete ON insurance_batches
    FOR DELETE TO anon USING (business_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION trg_insurance_batches_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS insurance_batches_set_updated_at ON insurance_batches;
CREATE TRIGGER insurance_batches_set_updated_at
  BEFORE UPDATE ON insurance_batches
  FOR EACH ROW EXECUTE FUNCTION trg_insurance_batches_set_updated_at();

-- ── 7. mechanic-photos storage bucket (private; 10y retention = no expiry) ──
INSERT INTO storage.buckets (id, name, public)
  VALUES ('mechanic-photos', 'mechanic-photos', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "mechanic-photos anon all" ON storage.objects
    FOR ALL TO anon
    USING (bucket_id = 'mechanic-photos')
    WITH CHECK (bucket_id = 'mechanic-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "mechanic-photos service all" ON storage.objects
    FOR ALL TO service_role
    USING (bucket_id = 'mechanic-photos')
    WITH CHECK (bucket_id = 'mechanic-photos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
