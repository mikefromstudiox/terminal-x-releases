-- v2.16.4 Sprint 2C — Concesionario bank pre-approvals.
-- DR concesionario reality: vendedor llama Popular/Reservas/BHD/Promerica/Vimenca,
-- registra la oferta del banco. Cuando el cliente cierra el deal, la pre-aprobacion
-- pre_aprobada se marca 'utilizada' y los terminos (rate/term/cuota) auto-llenan
-- el formulario de financiamiento del DealBuilder.
CREATE TABLE IF NOT EXISTS bank_preapprovals (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  client_id BIGINT,
  client_supabase_id UUID,
  lead_supabase_id UUID,
  vehicle_inventory_supabase_id UUID,
  salesperson_id BIGINT,
  salesperson_supabase_id UUID,
  bank TEXT NOT NULL,
  bank_contact TEXT,
  requested_amount NUMERIC(14,2) DEFAULT 0,
  term_months INT,
  rate_offered NUMERIC(6,3),
  monthly_quota_offered NUMERIC(12,2),
  status TEXT DEFAULT 'solicitada' CHECK (status IN ('solicitada','en_revision','pre_aprobada','rechazada','expirada','utilizada')),
  expires_at TIMESTAMPTZ,
  decision_at TIMESTAMPTZ,
  decision_letter_url TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_preapprovals_business ON bank_preapprovals(business_id);
CREATE INDEX IF NOT EXISTS idx_bank_preapprovals_client ON bank_preapprovals(client_supabase_id);
CREATE INDEX IF NOT EXISTS idx_bank_preapprovals_status ON bank_preapprovals(status);
CREATE INDEX IF NOT EXISTS idx_bank_preapprovals_expires ON bank_preapprovals(expires_at);
ALTER TABLE bank_preapprovals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_preapprovals_anon_rw ON bank_preapprovals;
CREATE POLICY bank_preapprovals_anon_rw ON bank_preapprovals FOR ALL TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
DROP POLICY IF EXISTS bank_preapprovals_auth_rw ON bank_preapprovals;
CREATE POLICY bank_preapprovals_auth_rw ON bank_preapprovals FOR ALL TO authenticated USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
DROP TRIGGER IF EXISTS bank_preapprovals_updated_at ON bank_preapprovals;
CREATE TRIGGER bank_preapprovals_updated_at BEFORE UPDATE ON bank_preapprovals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE sales_deals ADD COLUMN IF NOT EXISTS bank_preapproval_supabase_id UUID;
CREATE INDEX IF NOT EXISTS idx_sales_deals_preapproval ON sales_deals(bank_preapproval_supabase_id);
