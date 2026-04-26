-- v2.16.4 Sprint 2B H3 — Concesionario post-sale warranties.
-- DR concesionario reality: garantia 30/60/90d o 1 año. Cliente regresa con
-- reclamo, dealer rastrea claims contra la unidad vendida. status flips to
-- 'expired' por job nocturno cuando expires_at vence. claims is JSONB array
-- de {date, description, status, cost} apended via vehicleWarrantyAddClaim.
CREATE TABLE IF NOT EXISTS vehicle_warranties (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  sales_deal_supabase_id UUID NOT NULL,
  vehicle_inventory_supabase_id UUID,
  client_id BIGINT,
  client_supabase_id UUID,
  kind TEXT DEFAULT 'general' CHECK (kind IN ('motor','transmision','electrico','general','extendida')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  terms TEXT,
  claims JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','expired','voided','claimed')),
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_warranties_business ON vehicle_warranties(business_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_warranties_deal ON vehicle_warranties(sales_deal_supabase_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_warranties_expires ON vehicle_warranties(expires_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_warranties_status ON vehicle_warranties(status);
ALTER TABLE vehicle_warranties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicle_warranties_anon_rw ON vehicle_warranties;
CREATE POLICY vehicle_warranties_anon_rw ON vehicle_warranties FOR ALL TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
DROP POLICY IF EXISTS vehicle_warranties_auth_rw ON vehicle_warranties;
CREATE POLICY vehicle_warranties_auth_rw ON vehicle_warranties FOR ALL TO authenticated USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
DROP TRIGGER IF EXISTS vehicle_warranties_updated_at ON vehicle_warranties;
CREATE TRIGGER vehicle_warranties_updated_at BEFORE UPDATE ON vehicle_warranties FOR EACH ROW EXECUTE FUNCTION set_updated_at();
