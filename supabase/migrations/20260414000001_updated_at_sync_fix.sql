-- ============================================================================
-- Universal updated_at hardening — every table that is pulled to desktop
-- uses `updated_at > last_pull_at` as its sync cursor. Rows with NULL
-- updated_at fail the comparison forever and are silently orphaned.
--
-- Audit on 2026-04-14 found NULL updated_at values on: seller_commissions,
-- ticket_items, tickets, washer_commissions — 4 tickets stranded per table.
--
-- This migration: for every synced table, backfills NULLs, sets DEFAULT now(),
-- enforces NOT NULL, and wires a BEFORE INSERT trigger so any client that
-- sends NULL (explicit or absent) gets stamped automatically.
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_set_updated_at_insert() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.updated_at IS NULL THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'caja_chica','cajero_commissions','categorias_servicio','compras_607',
    'credit_payments','cuadre_caja','inventory_transactions','ncf_sequences',
    'notas_credito','queue','seller_commissions','sellers','ticket_items',
    'tickets','washer_commissions','washers'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- backfill — some tables (cuadre_caja) lack created_at, so pick whichever exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='created_at') THEN
      EXECUTE format('UPDATE %I SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL', t);
    ELSE
      EXECUTE format('UPDATE %I SET updated_at = now() WHERE updated_at IS NULL', t);
    END IF;
    -- default
    EXECUTE format('ALTER TABLE %I ALTER COLUMN updated_at SET DEFAULT now()', t);
    -- not null
    EXECUTE format('ALTER TABLE %I ALTER COLUMN updated_at SET NOT NULL', t);
    -- insert trigger (idempotent)
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at_insert ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at_insert BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at_insert()', t, t);
  END LOOP;
END $$;
