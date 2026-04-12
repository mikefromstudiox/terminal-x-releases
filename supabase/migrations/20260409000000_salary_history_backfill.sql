-- Salary history: add supabase_id + updated_at for sync compliance, backfill initial salaries.

-- Add sync columns to salary_changes
ALTER TABLE salary_changes ADD COLUMN IF NOT EXISTS supabase_id UUID UNIQUE DEFAULT gen_random_uuid();
ALTER TABLE salary_changes ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT now();

-- Backfill supabase_id on existing rows that got NULL
UPDATE salary_changes SET supabase_id = gen_random_uuid() WHERE supabase_id IS NULL;

-- Make supabase_id NOT NULL going forward
ALTER TABLE salary_changes ALTER COLUMN supabase_id SET NOT NULL;
ALTER TABLE salary_changes ALTER COLUMN supabase_id SET DEFAULT gen_random_uuid();

-- Better index for date-range lookups
CREATE INDEX IF NOT EXISTS idx_salary_changes_effective
  ON salary_changes(empleado_id, effective_date);

-- Backfill initial salary for employees with no salary_changes records
INSERT INTO salary_changes (business_id, empleado_id, old_salary, new_salary, effective_date, reason, supabase_id, created_at)
SELECT e.business_id, e.id, 0, e.salary, e.start_date, 'initial_salary', gen_random_uuid(), now()
FROM empleados e
WHERE e.salary > 0
  AND NOT EXISTS (
    SELECT 1 FROM salary_changes sc WHERE sc.empleado_id = e.id
  );

-- updated_at auto-trigger
CREATE OR REPLACE FUNCTION salary_changes_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_salary_changes_updated_at ON salary_changes;
CREATE TRIGGER trg_salary_changes_updated_at
  BEFORE UPDATE ON salary_changes
  FOR EACH ROW EXECUTE FUNCTION salary_changes_updated_at();
