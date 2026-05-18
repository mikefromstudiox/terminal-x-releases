-- Followup #5 — extend payment-balance trigger to flag significant overpay drift.
CREATE OR REPLACE FUNCTION trg_ticket_payment_balance() RETURNS TRIGGER AS $$
DECLARE _sum numeric; _expected numeric; _diff numeric;
BEGIN
  IF current_setting('role', true) IN ('service_role','postgres') THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('paid','cobrado') THEN RETURN NEW; END IF;
  IF NEW.payment_method IN ('credit','credito') THEN RETURN NEW; END IF;
  IF NEW.payment_method IN ('pedidos_ya','pedidos-ya','py') THEN RETURN NEW; END IF;
  IF NEW.payment_parts IS NULL OR jsonb_typeof(NEW.payment_parts) <> 'array' THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM((p->>'amount')::numeric), 0) INTO _sum
  FROM jsonb_array_elements(NEW.payment_parts) AS p;
  _expected := COALESCE(NEW.total, 0) - COALESCE(NEW.descuento, 0);
  _diff := _sum - _expected;
  IF _diff < -0.05 THEN
    RAISE EXCEPTION 'underpaid_sale: sum=% expected=% diff=%', _sum, _expected, _diff USING ERRCODE = '23514';
  END IF;
  IF _diff > 1000 THEN
    RAISE WARNING 'ticket_payment_overpay_drift: ticket=% sum=% expected=% diff=%', NEW.id, _sum, _expected, _diff;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
