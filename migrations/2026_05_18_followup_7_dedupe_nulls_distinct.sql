-- Followup #7 — Switch accounting_comprobantes dedupe from NULLS NOT DISTINCT
-- to NULLS DISTINCT. Was collapsing NCF-less bulk imports to ONE row per
-- (business, client, kind, fecha); now each NULL-NCF row is independent.
ALTER TABLE accounting_comprobantes DROP CONSTRAINT IF EXISTS accounting_comprobantes_dedupe_uniq;
ALTER TABLE accounting_comprobantes ADD CONSTRAINT accounting_comprobantes_dedupe_uniq
  UNIQUE NULLS DISTINCT (business_id, accounting_client_id, kind, ncf, fecha_comprobante);
