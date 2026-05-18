-- 2026-05-18 Fix Q — tickets.cuadre_supabase_id FK + auto-stamp trigger.
-- Binds every ticket to the cuadre it landed in instead of relying on
-- date-window joins (which double-count or gap on midnight-cross / reopen).

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cuadre_supabase_id UUID;
CREATE INDEX IF NOT EXISTS idx_tickets_cuadre_supabase_id ON tickets(cuadre_supabase_id) WHERE cuadre_supabase_id IS NOT NULL;
ALTER TABLE tickets ADD CONSTRAINT fk_tickets_cuadre_supabase_id
  FOREIGN KEY (cuadre_supabase_id) REFERENCES cuadre_caja(supabase_id) ON DELETE SET NULL NOT VALID;

CREATE OR REPLACE FUNCTION trg_tickets_stamp_cuadre() RETURNS TRIGGER AS $$
DECLARE _cuadre_sid uuid;
BEGIN
  IF NEW.cuadre_supabase_id IS NOT NULL THEN RETURN NEW; END IF;
  -- 2026-05-18 stress-audit revision: status filter removed. Credito tickets
  -- are inserted as 'pendiente' (later flipped to 'cobrado' on payment) and
  -- were missing the cuadre stamp because the original filter only matched
  -- paid/cobrado/nula/open. Cuadre is now the source of truth: if a cuadre is
  -- open, every newly-inserted ticket belongs to it regardless of status.
  -- Tie-break on id DESC for the case where two cuadres share an updated_at
  -- (extremely rare; same-timestamp bulk inserts).
  SELECT cc.supabase_id INTO _cuadre_sid
  FROM cuadre_caja cc
  WHERE cc.business_id = NEW.business_id AND cc.status = 'abierto'
  ORDER BY cc.updated_at DESC NULLS LAST, cc.id DESC LIMIT 1;
  IF _cuadre_sid IS NOT NULL THEN NEW.cuadre_supabase_id := _cuadre_sid; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tickets_stamp_cuadre ON tickets;
CREATE TRIGGER trg_tickets_stamp_cuadre
  BEFORE INSERT ON tickets
  FOR EACH ROW EXECUTE FUNCTION trg_tickets_stamp_cuadre();
