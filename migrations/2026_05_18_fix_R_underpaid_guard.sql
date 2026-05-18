-- 2026-05-18 Fix R — server-side balance check on paid tickets.
-- Rejects sum(payment_parts.amount) < total - descuento (5 cent tolerance).
-- Skips credit + pedidos_ya (settle outside till). service_role bypasses.

CREATE OR REPLACE FUNCTION trg_ticket_payment_balance() RETURNS TRIGGER AS $$
DECLARE _sum numeric; _expected numeric;
BEGIN
  IF current_setting('role', true) IN ('service_role','postgres') THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('paid','cobrado') THEN RETURN NEW; END IF;
  IF NEW.payment_method IN ('credit','credito') THEN RETURN NEW; END IF;
  IF NEW.payment_method IN ('pedidos_ya','pedidos-ya','py') THEN RETURN NEW; END IF;
  IF NEW.payment_parts IS NULL OR jsonb_typeof(NEW.payment_parts) <> 'array' THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(SUM((p->>'amount')::numeric), 0) INTO _sum
  FROM jsonb_array_elements(NEW.payment_parts) AS p;
  _expected := COALESCE(NEW.total, 0) - COALESCE(NEW.descuento, 0);
  IF _sum < _expected - 0.05 THEN
    RAISE EXCEPTION 'underpaid_sale: sum=% expected=% diff=%',
      _sum, _expected, (_expected - _sum) USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ticket_payment_balance ON tickets;
CREATE TRIGGER trg_ticket_payment_balance
  BEFORE INSERT OR UPDATE OF status, payment_parts, total, descuento ON tickets
  FOR EACH ROW EXECUTE FUNCTION trg_ticket_payment_balance();
