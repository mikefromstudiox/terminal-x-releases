-- 2026-05-18 Fix I — period_year/month auto-derived from fecha_comprobante.
-- Prevents back-dated comprobantes from being misfiled in the wrong DGII period.
CREATE OR REPLACE FUNCTION trg_comprobante_period_derive() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.fecha_comprobante IS NOT NULL THEN
    NEW.period_year  := EXTRACT(YEAR  FROM NEW.fecha_comprobante)::int;
    NEW.period_month := EXTRACT(MONTH FROM NEW.fecha_comprobante)::int;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comprobante_period_derive_ins ON accounting_comprobantes;
DROP TRIGGER IF EXISTS trg_comprobante_period_derive_upd ON accounting_comprobantes;
CREATE TRIGGER trg_comprobante_period_derive_ins
  BEFORE INSERT ON accounting_comprobantes
  FOR EACH ROW EXECUTE FUNCTION trg_comprobante_period_derive();
CREATE TRIGGER trg_comprobante_period_derive_upd
  BEFORE UPDATE OF fecha_comprobante, period_year, period_month ON accounting_comprobantes
  FOR EACH ROW EXECUTE FUNCTION trg_comprobante_period_derive();
