-- 20260427100001_mechanic_v216_polish.sql — SUPERSEDED, KEPT AS NO-OP STUB
--
-- This migration originally tried to backfill an `empleados.commission_pct`
-- column from `empleados.comision_pct`. It assumed both columns existed —
-- which is FALSE on production: the canonical column is the Spanish
-- `comision_pct` (no English counterpart). The original SQL aborted with
-- `column "commission_pct" does not exist` before the M2 (parts_orders FK)
-- and H5 (mechanic_commissions table) blocks could run.
--
-- The schema standardizes on `comision_pct`. NO renaming or backfilling
-- happens for empleados — this stub is intentionally empty.
--
-- The M2 + H5 effects shipped via:
--   supabase/migrations/20260428000000_mechanic_v216_safe.sql
--
-- Why keep this file (instead of deleting):
--   The version `20260427100001` is recorded as `applied` in
--   `supabase_migrations.schema_migrations` to keep the CLI's
--   `migration list` output 1:1 with local files. Deleting the file would
--   create an orphan remote entry and trigger
--   "Remote migration versions not found in local migrations directory"
--   on every future `supabase db push`.
--
-- Idempotent + safe to re-run anywhere — does nothing.

DO $$ BEGIN
  RAISE NOTICE 'mechanic_v216_polish (20260427100001) — superseded by 20260428000000_mechanic_v216_safe.sql, no-op stub';
END $$;
