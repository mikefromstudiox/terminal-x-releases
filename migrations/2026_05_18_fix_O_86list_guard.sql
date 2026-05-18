-- 2026-05-18 Fix O — DB-layer 86-list (in_stock=false) enforcement on ticket_items.
-- Blocks adding an out-of-stock service to a ticket via PostgREST.
-- service_role bypasses for sync. Manager override marker
-- `set_config('app.in_stock_override','true',true)` in same TX permits.

CREATE OR REPLACE FUNCTION trg_ticket_items_in_stock_guard() RETURNS TRIGGER AS $$
DECLARE _in_stock boolean;
BEGIN
  IF NEW.service_supabase_id IS NULL THEN RETURN NEW; END IF;
  IF current_setting('role', true) IN ('service_role','postgres') THEN RETURN NEW; END IF;
  IF current_setting('app.in_stock_override', true) = 'true' THEN RETURN NEW; END IF;

  SELECT s.in_stock INTO _in_stock
  FROM services s WHERE s.supabase_id = NEW.service_supabase_id AND s.business_id = NEW.business_id
  LIMIT 1;

  IF _in_stock IS FALSE THEN
    RAISE EXCEPTION 'service_out_of_stock_86_listed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_ticket_items_in_stock_guard ON ticket_items;
CREATE TRIGGER trg_ticket_items_in_stock_guard
  BEFORE INSERT ON ticket_items
  FOR EACH ROW EXECUTE FUNCTION trg_ticket_items_in_stock_guard();
