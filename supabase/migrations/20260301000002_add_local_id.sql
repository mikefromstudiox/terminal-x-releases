-- ============================================================================
-- Add local_id columns for desktop ↔ Supabase sync mapping.
-- Maps SQLite integer IDs to Supabase UUID rows.
-- ============================================================================

ALTER TABLE services ADD COLUMN IF NOT EXISTS local_id INTEGER;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS local_id INTEGER;
ALTER TABLE washers ADD COLUMN IF NOT EXISTS local_id INTEGER;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS local_id INTEGER;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS local_id INTEGER;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS local_id INTEGER;
ALTER TABLE ncf_sequences ADD COLUMN IF NOT EXISTS local_id INTEGER;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS local_id INTEGER;
ALTER TABLE cuadre_caja ADD COLUMN IF NOT EXISTS local_id INTEGER;
ALTER TABLE caja_chica ADD COLUMN IF NOT EXISTS local_id INTEGER;
ALTER TABLE credit_payments ADD COLUMN IF NOT EXISTS local_id INTEGER;
ALTER TABLE notas_credito ADD COLUMN IF NOT EXISTS local_id INTEGER;
ALTER TABLE compras_607 ADD COLUMN IF NOT EXISTS local_id INTEGER;
ALTER TABLE washer_commissions ADD COLUMN IF NOT EXISTS local_id INTEGER;

-- Indexes for fast lookups during sync
CREATE INDEX IF NOT EXISTS idx_services_local ON services(business_id, local_id) WHERE local_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_local ON clients(business_id, local_id) WHERE local_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_washers_local ON washers(business_id, local_id) WHERE local_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sellers_local ON sellers(business_id, local_id) WHERE local_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_local ON staff(business_id, local_id) WHERE local_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_local ON tickets(business_id, local_id) WHERE local_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ncf_seq_local ON ncf_sequences(business_id, local_id) WHERE local_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_local ON inventory_items(business_id, local_id) WHERE local_id IS NOT NULL;
