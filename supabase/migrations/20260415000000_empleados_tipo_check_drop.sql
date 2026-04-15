-- ============================================================================
-- Drop the CHECK constraint on empleados.tipo so it matches desktop (v1.9.15
-- dropped it in SQLite). This unblocks new tipos like 'seguridad' without
-- another migration every time the business adds a role.
-- ============================================================================

ALTER TABLE empleados DROP CONSTRAINT IF EXISTS empleados_tipo_check;
