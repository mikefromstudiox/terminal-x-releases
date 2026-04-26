-- H8 — WhatsApp opt-out per cliente. Idempotent.
DO $$ BEGIN
  ALTER TABLE clients ADD COLUMN wa_opt_out BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
