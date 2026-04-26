-- Terminal X v2.16.4 — Carnicería ship-readiness sprint
-- Adds: post-venta merma provenance on inventory_discards (E33 NCC trigger).
-- Idempotent. Safe to re-run.

BEGIN;

ALTER TABLE inventory_discards
  ADD COLUMN IF NOT EXISTS is_post_sale BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS related_ticket_supabase_id UUID,
  ADD COLUMN IF NOT EXISTS e33_encf TEXT;

CREATE INDEX IF NOT EXISTS idx_disc_post_sale ON inventory_discards(business_id, is_post_sale)
  WHERE is_post_sale = true;
CREATE INDEX IF NOT EXISTS idx_disc_e33 ON inventory_discards(e33_encf)
  WHERE e33_encf IS NOT NULL;

COMMIT;
