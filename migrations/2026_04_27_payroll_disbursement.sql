-- 2026-04-27 — Payroll bank disbursement (Pago Masivo)
-- Adds beneficiary bank fields to accounting_payroll_lines so contadoras
-- can generate BHD León / Banreservas mass-payment files, and tracks when
-- a period was last exported as a disbursement file.

ALTER TABLE public.accounting_payroll_lines
  ADD COLUMN IF NOT EXISTS cuenta_destino TEXT,
  ADD COLUMN IF NOT EXISTS banco_destino  TEXT,
  ADD COLUMN IF NOT EXISTS tipo_cuenta    TEXT;

-- Light enum guard (DR retail set: corriente, ahorros). Permissive on NULL.
ALTER TABLE public.accounting_payroll_lines
  DROP CONSTRAINT IF EXISTS chk_acc_pl_tipo_cuenta;
ALTER TABLE public.accounting_payroll_lines
  ADD CONSTRAINT chk_acc_pl_tipo_cuenta
  CHECK (tipo_cuenta IS NULL OR tipo_cuenta IN ('corriente','ahorros'));

ALTER TABLE public.accounting_payroll_periods
  ADD COLUMN IF NOT EXISTS disbursement_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disbursement_bank         TEXT;

-- Optional roster-level cache so cuenta info persists across periods without
-- forcing re-entry. Per (business, accounting_client, employee_cedula).
CREATE TABLE IF NOT EXISTS public.accounting_payroll_employee_bank (
  id BIGSERIAL PRIMARY KEY,
  supabase_id UUID NOT NULL UNIQUE,
  business_id UUID NOT NULL,
  accounting_client_id BIGINT,
  accounting_client_supabase_id UUID,
  employee_cedula TEXT NOT NULL,
  employee_name   TEXT,
  employee_email  TEXT,
  cuenta_destino  TEXT,
  banco_destino   TEXT,
  tipo_cuenta     TEXT CHECK (tipo_cuenta IS NULL OR tipo_cuenta IN ('corriente','ahorros')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_acc_pl_emp_bank
  ON public.accounting_payroll_employee_bank(business_id, accounting_client_id, employee_cedula);

CREATE INDEX IF NOT EXISTS idx_acc_pl_emp_bank_biz
  ON public.accounting_payroll_employee_bank(business_id);

DROP TRIGGER IF EXISTS tg_acc_pl_emp_bank_updated_at ON public.accounting_payroll_employee_bank;
CREATE TRIGGER tg_acc_pl_emp_bank_updated_at BEFORE UPDATE ON public.accounting_payroll_employee_bank
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.accounting_payroll_employee_bank ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_acc_pl_emp_bank_select ON public.accounting_payroll_employee_bank;
CREATE POLICY p_acc_pl_emp_bank_select ON public.accounting_payroll_employee_bank
  FOR SELECT TO authenticated
  USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));

DROP POLICY IF EXISTS p_acc_pl_emp_bank_write ON public.accounting_payroll_employee_bank;
CREATE POLICY p_acc_pl_emp_bank_write ON public.accounting_payroll_employee_bank
  FOR ALL TO authenticated
  USING (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''))
  WITH CHECK (business_id IS NOT NULL AND business_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'business_id',''));

REVOKE INSERT, UPDATE, DELETE ON public.accounting_payroll_employee_bank FROM anon;
