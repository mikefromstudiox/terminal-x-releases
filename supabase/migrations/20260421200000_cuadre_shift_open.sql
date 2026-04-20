-- v2.6.2 — Apertura de Turno (shift open) on cuadre_caja.
-- One row represents a full shift: opening_cash + opened_at + status='abierto'
-- while in progress, then the normal closure flow updates the same row to
-- status='cerrado' with the end-of-day cash counts. Pre-existing (closed)
-- rows default to status='cerrado' and are untouched by this migration.

ALTER TABLE cuadre_caja
  ADD COLUMN IF NOT EXISTS opening_cash NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE cuadre_caja
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;

ALTER TABLE cuadre_caja
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'cerrado';

-- Lookup index: "is there an open shift for this cashier today?" is a hot
-- path on every POS entry. Partial index keeps it tiny (only abierto rows).
CREATE INDEX IF NOT EXISTS idx_cuadre_caja_open_shift
  ON cuadre_caja (business_id, cajero_supabase_id, date)
  WHERE status = 'abierto';
