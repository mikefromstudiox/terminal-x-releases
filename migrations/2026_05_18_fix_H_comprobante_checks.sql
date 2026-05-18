-- 2026-05-18 Fix H — DR fiscal-rate CHECK constraints on accounting_comprobantes.
ALTER TABLE accounting_comprobantes
  ADD CONSTRAINT chk_itbis_rate_valid
  CHECK (itbis_rate IS NULL OR itbis_rate IN (-1, 0, 16, 18)) NOT VALID;
ALTER TABLE accounting_comprobantes
  ADD CONSTRAINT chk_tipo_bs_valid
  CHECK (tipo_bienes_servicios IS NULL OR tipo_bienes_servicios BETWEEN 1 AND 11) NOT VALID;
