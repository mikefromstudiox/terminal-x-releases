-- Concesionario v2.1 compliance: matricula/traspaso/UAF (Ley 155-17 + INTRANT)
-- Adds AML markers to sales_deals + new vehicle_titulo table for INTRANT tracking.

ALTER TABLE sales_deals ADD COLUMN IF NOT EXISTS dgii_e31_required BOOLEAN DEFAULT false;
ALTER TABLE sales_deals ADD COLUMN IF NOT EXISTS uaf_threshold_exceeded BOOLEAN DEFAULT false;
ALTER TABLE sales_deals ADD COLUMN IF NOT EXISTS uaf_report_url TEXT;
ALTER TABLE sales_deals ADD COLUMN IF NOT EXISTS uaf_acknowledged_by TEXT;
ALTER TABLE sales_deals ADD COLUMN IF NOT EXISTS uaf_acknowledged_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS vehicle_titulo (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  sales_deal_supabase_id UUID NOT NULL,
  vehicle_inventory_supabase_id UUID,
  intrant_status TEXT DEFAULT 'pendiente' CHECK (intrant_status IN ('pendiente','en_tramite','entregada','rechazada')),
  placa TEXT,
  matricula_url TEXT,
  traspaso_initiated_at TIMESTAMPTZ,
  traspaso_completed_at TIMESTAMPTZ,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_titulo_business ON vehicle_titulo(business_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_titulo_deal ON vehicle_titulo(sales_deal_supabase_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_titulo_status ON vehicle_titulo(intrant_status);

ALTER TABLE vehicle_titulo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicle_titulo_anon_rw ON vehicle_titulo;
CREATE POLICY vehicle_titulo_anon_rw ON vehicle_titulo FOR ALL TO anon
  USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
DROP POLICY IF EXISTS vehicle_titulo_auth_rw ON vehicle_titulo;
CREATE POLICY vehicle_titulo_auth_rw ON vehicle_titulo FOR ALL TO authenticated
  USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);

DROP TRIGGER IF EXISTS vehicle_titulo_updated_at ON vehicle_titulo;
CREATE TRIGGER vehicle_titulo_updated_at BEFORE UPDATE ON vehicle_titulo
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
