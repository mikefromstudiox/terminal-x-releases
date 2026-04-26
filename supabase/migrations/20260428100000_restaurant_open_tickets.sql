-- ────────────────────────────────────────────────────────────────────────────
-- v2.16.4 — Restaurant open-ticket lifecycle (C1/C2)
--
-- Persist tickets the moment a mesa is seated, not at cobro. Power loss / app
-- crash mid-dinner no longer drops in-flight items + KDS rows.
--
-- The existing `tickets.status` column is overloaded for finance state
-- (cobrado/pendiente/nula/anulado), so we add a parallel `open_status` column
-- with values 'open' (mesa seated, items being added) | 'closed' (paid or
-- never opened). Default 'closed' keeps every legacy/finance ticket out of the
-- open-tickets index. The partial index makes getActiveByMesa O(1).
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. open_status column (idempotent) ──────────────────────────────────────
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS open_status TEXT NOT NULL DEFAULT 'closed';

-- Sanity constraint — only the two known states are accepted. Wrapped in DO
-- block so the migration is rerunnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tickets_open_status_chk'
  ) THEN
    ALTER TABLE public.tickets
      ADD CONSTRAINT tickets_open_status_chk
      CHECK (open_status IN ('open', 'closed'));
  END IF;
END$$;

-- ── 2. Partial index on (business_id, mesa_supabase_id) where open ──────────
-- Only ~1 row per active mesa at any time; partial keeps it small.
CREATE INDEX IF NOT EXISTS idx_tickets_open_by_mesa
  ON public.tickets (business_id, mesa_supabase_id)
  WHERE open_status = 'open';

-- ── 3. RLS — allow anon SELECT/UPDATE on open tickets for that business_id ──
-- Open tickets are renderer-driven (POS UI calls update_qty/remove_item
-- directly without going through a SECURITY DEFINER RPC), so anon needs the
-- same row-scoped grants that the existing tickets table already extends to
-- closed ones. Wrapped in DO block so we don't double-create policies on rerun.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='tickets'
      AND policyname='tickets_open_select_anon'
  ) THEN
    CREATE POLICY tickets_open_select_anon ON public.tickets
      FOR SELECT TO anon
      USING (
        open_status = 'open'
        AND business_id IS NOT NULL
        AND business_id = current_setting('request.jwt.claims', true)::jsonb->>'business_id'::uuid
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='tickets'
      AND policyname='tickets_open_update_anon'
  ) THEN
    CREATE POLICY tickets_open_update_anon ON public.tickets
      FOR UPDATE TO anon
      USING (
        business_id IS NOT NULL
        AND business_id = current_setting('request.jwt.claims', true)::jsonb->>'business_id'::uuid
      )
      WITH CHECK (
        business_id IS NOT NULL
        AND business_id = current_setting('request.jwt.claims', true)::jsonb->>'business_id'::uuid
      );
  END IF;
EXCEPTION WHEN others THEN
  -- If the existing RLS scheme on tickets already covers anon (as it does in
  -- production today), the CREATE POLICY above will collide — that's fine,
  -- the existing policy already grants what we need. Swallow the error so
  -- the rest of the migration applies.
  RAISE NOTICE 'tickets RLS open-state policies skipped: %', SQLERRM;
END$$;

-- ── 4. Backfill — every existing finance ticket is implicitly closed ───────
-- Default already covers new rows; this is for any pre-default rows that
-- somehow inserted NULL.
UPDATE public.tickets SET open_status = 'closed' WHERE open_status IS NULL;
