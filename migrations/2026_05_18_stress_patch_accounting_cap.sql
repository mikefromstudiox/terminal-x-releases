-- 2026-05-18 Stress audit follow-up — DB-level cap on accounting_clients.
-- Closes the multi-tab race where two concurrent clientCreate() calls at
-- count=9 both pass the client-side check and land 11 rows.
CREATE OR REPLACE FUNCTION trg_accounting_clients_cap() RETURNS TRIGGER AS $$
DECLARE _plan text; _count int; _cap int;
BEGIN
  IF current_setting('role', true) IN ('service_role','postgres') THEN RETURN NEW; END IF;
  SELECT plan INTO _plan FROM businesses WHERE id = NEW.business_id;
  IF _plan IN ('pro_max','contabilidad_max') THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO _count FROM accounting_clients
    WHERE business_id = NEW.business_id AND status <> 'archived';
  _cap := 10;
  IF _count >= _cap THEN
    RAISE EXCEPTION 'accounting_clients_cap_exceeded: plan=% allows max=% (current=%). Upgrade to Pro MAX for unlimited.',
      _plan, _cap, _count USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_accounting_clients_cap_ins ON accounting_clients;
CREATE TRIGGER trg_accounting_clients_cap_ins
  BEFORE INSERT ON accounting_clients
  FOR EACH ROW EXECUTE FUNCTION trg_accounting_clients_cap();
