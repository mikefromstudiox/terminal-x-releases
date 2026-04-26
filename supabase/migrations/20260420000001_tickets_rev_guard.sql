-- ============================================================================
-- 20260420000000_tickets_rev_guard.sql
-- Multi-POS ticket race hardening (audit finding Y-H6 / v2.10.3).
--
-- Today's sync-integrity audit confirmed tickets has no `rev`/`version`
-- column, so two cashiers voiding the same ticket concurrently produce
-- last-writer-wins metadata loss (void_reason/void_by silently overwritten).
-- Mirrors the mesas.rev pattern shipped in v2.3.33
-- (20260419100000_restaurant_sync_hardening.sql).
--
-- Idempotent — safe to re-run.
-- ============================================================================

-- ── 1. tickets.rev column ──────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='tickets' AND column_name='rev'
  ) THEN
    ALTER TABLE tickets ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- ── 2. BEFORE UPDATE rev guard ─────────────────────────────────────────────
-- Reject writes that change `status` without strictly increasing `rev`.
-- Non-status edits (notes/descuento/ecf_result/etc.) are free to pass so the
-- guard does not block normal late-arriving syncs or metadata backfills.
CREATE OR REPLACE FUNCTION trg_tickets_rev_guard() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND COALESCE(NEW.rev, 0) <= COALESCE(OLD.rev, 0) THEN
    RAISE EXCEPTION 'tickets.rev_conflict: incoming rev % did not advance stored rev % for ticket %',
      NEW.rev, OLD.rev, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tickets_rev_guard ON tickets;
CREATE TRIGGER trg_tickets_rev_guard
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION trg_tickets_rev_guard();
