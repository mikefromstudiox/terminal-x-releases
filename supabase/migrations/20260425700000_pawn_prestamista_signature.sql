-- C9 — Papeleta legalmente vinculante: prestamista signature column.
-- Idempotent.
DO $$ BEGIN
  ALTER TABLE pawn_items ADD COLUMN prestamista_signature_dataurl TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
