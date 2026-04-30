-- ════════════════════════════════════════════════════════════════════════════
-- 20260429000600_payroll_employee_bank_roster_uniq.sql
--
-- Adds the unique constraint that `payrollEmpBankUpsert` in
-- packages/data/contabilidad.js:887 expects: one bank-info row per
-- (business, accounting_client, employee_cedula). The caller upserts with
-- `onConflict: 'business_id,accounting_client_id,employee_cedula'` and
-- without a real constraint PostgREST rejects the upsert silently.
--
-- NULLS NOT DISTINCT so a NULL accounting_client_id (employee not yet
-- assigned to a specific client roster) collides with another NULL row for
-- the same business + cedula — keeps idempotent retries safe.
--
-- 0 duplicates verified pre-flight. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.accounting_payroll_employee_bank'::regclass
       AND conname='accounting_payroll_employee_bank_roster_uniq'
  ) THEN
    ALTER TABLE public.accounting_payroll_employee_bank
      ADD CONSTRAINT accounting_payroll_employee_bank_roster_uniq
      UNIQUE NULLS NOT DISTINCT (business_id, accounting_client_id, employee_cedula);
  END IF;
END $$;
