-- ── Payroll runs (paycheck history) ────────────────────────────────────────────
-- Each row is one paycheck event for an employee. Lets us show history,
-- search by date range, compute "last paycheck / first paycheck", and
-- drive accountant exports.

CREATE TABLE IF NOT EXISTS payroll_runs (
  id             bigserial PRIMARY KEY,
  business_id    uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  empleado_id    bigint NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  base           numeric(12, 2) NOT NULL DEFAULT 0,
  commissions    numeric(12, 2) NOT NULL DEFAULT 0,
  bonuses        numeric(12, 2) NOT NULL DEFAULT 0,
  deductions     numeric(12, 2) NOT NULL DEFAULT 0,
  net            numeric(12, 2) NOT NULL,
  notes          text,
  paid_at        timestamptz NOT NULL DEFAULT now(),
  paid_by        uuid REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_business ON payroll_runs(business_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_empleado ON payroll_runs(empleado_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_paid_at  ON payroll_runs(paid_at);

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY payroll_runs_tenant_select ON payroll_runs FOR SELECT
  USING (business_id IN (SELECT business_id FROM staff WHERE auth_user_id = auth.uid()));
CREATE POLICY payroll_runs_tenant_insert ON payroll_runs FOR INSERT
  WITH CHECK (business_id IN (SELECT business_id FROM staff WHERE auth_user_id = auth.uid()));
CREATE POLICY payroll_runs_tenant_update ON payroll_runs FOR UPDATE
  USING (business_id IN (SELECT business_id FROM staff WHERE auth_user_id = auth.uid()));
CREATE POLICY payroll_runs_tenant_delete ON payroll_runs FOR DELETE
  USING (business_id IN (SELECT business_id FROM staff WHERE auth_user_id = auth.uid()));
