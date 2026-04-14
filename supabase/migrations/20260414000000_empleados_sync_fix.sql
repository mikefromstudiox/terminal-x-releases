-- ============================================================================
-- Empleados sync-fix — root cause of "empleados not syncing to desktop"
--
-- All the expected columns (supabase_id, updated_at, role, comision_pct) were
-- already on the table — BUT:
--   * The updated_at trigger only fires BEFORE UPDATE, so web inserts left
--     updated_at = NULL.
--   * Desktop pull filters rows with `updated_at gte <cursor>`; NULL rows
--     never satisfy that comparison and are silently skipped forever.
--   * Result on 2026-04-14: 6 of 10 empleados stranded on Supabase.
--
-- Fix: backfill, enforce DEFAULT + NOT NULL, and stamp updated_at on INSERT too.
-- ============================================================================

-- 1. Backfill any existing NULL updated_at rows so the next desktop pull sees them
UPDATE empleados SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL;

-- 2. Guarantee future INSERTs always populate updated_at
ALTER TABLE empleados ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE empleados ALTER COLUMN updated_at SET NOT NULL;

-- 3. Also stamp updated_at on INSERT (belt + braces vs clients that send
--    an explicit NULL). The existing BEFORE UPDATE trigger handles edits.
CREATE OR REPLACE FUNCTION trg_set_updated_at_insert() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.updated_at IS NULL THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_empleados_updated_at_insert ON empleados;
CREATE TRIGGER trg_empleados_updated_at_insert
  BEFORE INSERT ON empleados
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at_insert();
