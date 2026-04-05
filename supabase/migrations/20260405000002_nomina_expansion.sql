-- ── Nómina expansion (v1.5) ───────────────────────────────────────────────────
-- 1. Extend empleados with fields needed for TSS/ISR filings
-- 2. Extend payroll_runs with itemised deductions + employer liabilities
-- 3. Create payroll_settings (per-tenant payroll config)
-- 4. Create salary_changes (audit log for raises/cuts)

-- 1. empleados fields
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS puesto        text;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS email         text;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS bank_account  text;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS tss_id        text;

-- 2. payroll_runs itemised fields
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS sfs_employee      numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS afp_employee      numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS isr               numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS other_deductions  numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS sfs_employer      numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS afp_employer      numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS infotep_employer  numeric(12,2) NOT NULL DEFAULT 0;

-- 3. payroll_settings table
CREATE TABLE IF NOT EXISTS payroll_settings (
  id                    bigserial PRIMARY KEY,
  business_id           uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  pay_cycle             text NOT NULL DEFAULT 'quincenal',
  sfs_employee_rate     numeric(6,4) NOT NULL DEFAULT 0.0304,
  afp_employee_rate     numeric(6,4) NOT NULL DEFAULT 0.0287,
  sfs_employer_rate     numeric(6,4) NOT NULL DEFAULT 0.0709,
  afp_employer_rate     numeric(6,4) NOT NULL DEFAULT 0.0710,
  infotep_employer_rate numeric(6,4) NOT NULL DEFAULT 0.01,
  sfs_monthly_cap       numeric(12,2) NOT NULL DEFAULT 232230,
  afp_monthly_cap       numeric(12,2) NOT NULL DEFAULT 464460,
  isr_enabled           boolean NOT NULL DEFAULT true,
  isr_brackets          jsonb NOT NULL DEFAULT '[[0,416220,0],[416220,624329,0.15],[624329,867123,0.20],[867123,999999999,0.25]]'::jsonb,
  navidad_enabled       boolean NOT NULL DEFAULT true,
  vacation_days         integer NOT NULL DEFAULT 14,
  daily_divisor         numeric(6,2) NOT NULL DEFAULT 23.83,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_settings_business ON payroll_settings(business_id);

ALTER TABLE payroll_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_settings_tenant_select ON payroll_settings FOR SELECT
  USING (business_id IN (SELECT business_id FROM staff WHERE auth_user_id = auth.uid()));
CREATE POLICY payroll_settings_tenant_insert ON payroll_settings FOR INSERT
  WITH CHECK (business_id IN (SELECT business_id FROM staff WHERE auth_user_id = auth.uid()));
CREATE POLICY payroll_settings_tenant_update ON payroll_settings FOR UPDATE
  USING (business_id IN (SELECT business_id FROM staff WHERE auth_user_id = auth.uid()));

-- 4. salary_changes table
CREATE TABLE IF NOT EXISTS salary_changes (
  id             bigserial PRIMARY KEY,
  business_id    uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  empleado_id    bigint NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  old_salary     numeric(12,2) NOT NULL,
  new_salary     numeric(12,2) NOT NULL,
  effective_date date NOT NULL,
  reason         text,
  changed_by     uuid REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salary_changes_empleado ON salary_changes(empleado_id);
CREATE INDEX IF NOT EXISTS idx_salary_changes_business ON salary_changes(business_id);

ALTER TABLE salary_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY salary_changes_tenant_select ON salary_changes FOR SELECT
  USING (business_id IN (SELECT business_id FROM staff WHERE auth_user_id = auth.uid()));
CREATE POLICY salary_changes_tenant_insert ON salary_changes FOR INSERT
  WITH CHECK (business_id IN (SELECT business_id FROM staff WHERE auth_user_id = auth.uid()));
CREATE POLICY salary_changes_tenant_delete ON salary_changes FOR DELETE
  USING (business_id IN (SELECT business_id FROM staff WHERE auth_user_id = auth.uid()));
