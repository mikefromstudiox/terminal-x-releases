-- 2026-05-18 — Add staff.empleado_supabase_id (UUID FK to empleados.supabase_id).
--
-- Root cause: packages/data/web.js:1571 has been writing this column since the
-- empleado.id UUID migration, but the matching ALTER on the staff table was
-- never shipped. Result: every web-side "Agregar usuario" failed with
-- "could not find the empleado_supabase_id column of staff in the schema cache"
-- and the cajera was never created.
--
-- This migration is idempotent — it was already applied via Management API on
-- 2026-05-18; this file is the audit trail so future migration replays from
-- scratch get the same shape.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS empleado_supabase_id UUID;

CREATE INDEX IF NOT EXISTS idx_staff_empleado_supabase_id
  ON staff(empleado_supabase_id)
  WHERE empleado_supabase_id IS NOT NULL;

-- Backfill from legacy integer FK chain:
--   staff.employee_id (INT) → empleados.local_id (INT) → empleados.supabase_id (UUID)
UPDATE staff s
SET empleado_supabase_id = e.supabase_id
FROM empleados e
WHERE s.business_id = e.business_id
  AND s.employee_id = e.local_id
  AND s.empleado_supabase_id IS NULL
  AND e.supabase_id IS NOT NULL;

-- Force PostgREST to refresh its column cache so /api routes recognize the new column.
NOTIFY pgrst, 'reload schema';
