-- v2.16.4 — Concesionario Sprint 2A H2: vehicle reservations with deposit + expiry.
-- DR concesionario reality: cliente paga deposito (RD$5K-50K) para reservar la
-- unidad por X dias; si no completa antes del vencimiento se libera y la unidad
-- vuelve a 'available'. converted_deal_supabase_id links the reservation to the
-- final sales_deal so reports can attribute deposits correctly.

CREATE TABLE IF NOT EXISTS vehicle_reservations (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  vehicle_inventory_supabase_id UUID,
  client_id BIGINT,
  client_supabase_id UUID,
  salesperson_id BIGINT,
  salesperson_supabase_id UUID,
  deposit_amount NUMERIC(12,2) DEFAULT 0,
  deposit_method TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  released_reason TEXT,
  converted_deal_supabase_id UUID,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','converted','released','expired')),
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_reservations_business ON vehicle_reservations(business_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_reservations_vehicle ON vehicle_reservations(vehicle_inventory_supabase_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_reservations_expires ON vehicle_reservations(expires_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_reservations_status ON vehicle_reservations(status);
ALTER TABLE vehicle_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicle_reservations_anon_rw ON vehicle_reservations;
CREATE POLICY vehicle_reservations_anon_rw ON vehicle_reservations FOR ALL TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
DROP POLICY IF EXISTS vehicle_reservations_auth_rw ON vehicle_reservations;
CREATE POLICY vehicle_reservations_auth_rw ON vehicle_reservations FOR ALL TO authenticated USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
DROP TRIGGER IF EXISTS vehicle_reservations_updated_at ON vehicle_reservations;
CREATE TRIGGER vehicle_reservations_updated_at BEFORE UPDATE ON vehicle_reservations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
