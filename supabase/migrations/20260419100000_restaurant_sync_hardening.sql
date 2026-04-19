-- ============================================================================
-- 20260419100000_restaurant_sync_hardening.sql
-- Closes the remaining sync audit gaps for v1.9.25:
--   1. mesas.rev + BEFORE UPDATE guard (solves the simultaneous-waiter race)
--   2. Natural-key UNIQUE constraints on:
--        ncf_sequences              (business_id, type, prefix)
--        service_modificadores      (business_id, service_supabase_id, modificador_supabase_id)
--        ticket_item_modificadores  (business_id, ticket_item_supabase_id, modificador_supabase_id)
--        stylist_schedules          (business_id, empleado_supabase_id, day_of_week)
--
-- Idempotent — safe to re-run. Uses the same DO $$ … pg_constraint lookup
-- pattern as 20260416300000_sync_parity_fixes.sql. Dedupe CTEs run FIRST so
-- the constraint can attach even when the target table already contains
-- colliding rows (lowest id wins; everything else is removed).
-- ============================================================================

-- ── 1. mesas.rev column + guard trigger ─────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='mesas' AND column_name='rev'
  ) THEN
    ALTER TABLE mesas ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION trg_mesas_rev_guard() RETURNS TRIGGER AS $$
BEGIN
  -- Reject writes that change `status` without strictly increasing `rev`.
  -- Non-status edits (name/zone/capacity/sort_order/etc.) are free to pass.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND COALESCE(NEW.rev, 0) <= COALESCE(OLD.rev, 0) THEN
    RAISE EXCEPTION 'mesas.rev_conflict: incoming rev % did not advance stored rev % for mesa %',
      NEW.rev, OLD.rev, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mesas_rev_guard ON mesas;
CREATE TRIGGER trg_mesas_rev_guard
  BEFORE UPDATE ON mesas
  FOR EACH ROW EXECUTE FUNCTION trg_mesas_rev_guard();

-- ── 2. Dedupe helper CTEs (run BEFORE attaching UNIQUE constraints) ─────────

-- ncf_sequences: dedupe on (business_id, type, prefix), keep smallest id
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY business_id, type, prefix
           ORDER BY id
         ) AS rn
    FROM ncf_sequences
   WHERE business_id IS NOT NULL AND type IS NOT NULL AND prefix IS NOT NULL
)
DELETE FROM ncf_sequences WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- service_modificadores
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY business_id, service_supabase_id, modificador_supabase_id
           ORDER BY id
         ) AS rn
    FROM service_modificadores
   WHERE business_id IS NOT NULL
     AND service_supabase_id IS NOT NULL
     AND modificador_supabase_id IS NOT NULL
)
DELETE FROM service_modificadores WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ticket_item_modificadores
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY business_id, ticket_item_supabase_id, modificador_supabase_id
           ORDER BY id
         ) AS rn
    FROM ticket_item_modificadores
   WHERE business_id IS NOT NULL
     AND ticket_item_supabase_id IS NOT NULL
     AND modificador_supabase_id IS NOT NULL
)
DELETE FROM ticket_item_modificadores WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- stylist_schedules
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY business_id, empleado_supabase_id, day_of_week
           ORDER BY id
         ) AS rn
    FROM stylist_schedules
   WHERE business_id IS NOT NULL
     AND empleado_supabase_id IS NOT NULL
     AND day_of_week IS NOT NULL
)
DELETE FROM stylist_schedules WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── 3. UNIQUE constraints ───────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_ncf_sequences_biz_type_prefix') THEN
    ALTER TABLE ncf_sequences
      ADD CONSTRAINT uq_ncf_sequences_biz_type_prefix
      UNIQUE (business_id, type, prefix);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_service_modificadores_biz_svc_mod') THEN
    ALTER TABLE service_modificadores
      ADD CONSTRAINT uq_service_modificadores_biz_svc_mod
      UNIQUE (business_id, service_supabase_id, modificador_supabase_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_ticket_item_modificadores_biz_ti_mod') THEN
    ALTER TABLE ticket_item_modificadores
      ADD CONSTRAINT uq_ticket_item_modificadores_biz_ti_mod
      UNIQUE (business_id, ticket_item_supabase_id, modificador_supabase_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_stylist_schedules_biz_emp_dow') THEN
    ALTER TABLE stylist_schedules
      ADD CONSTRAINT uq_stylist_schedules_biz_emp_dow
      UNIQUE (business_id, empleado_supabase_id, day_of_week);
  END IF;
END $$;
