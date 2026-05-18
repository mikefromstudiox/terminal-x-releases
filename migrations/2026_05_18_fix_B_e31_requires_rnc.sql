-- 2026-05-18 Fix B — E31 e-CF without client_rnc was accepted at the DB layer.
-- Per DGII Norma 32-23, E31 (Factura de Crédito Fiscal) requires a buyer RNC.
-- CobrarModal.jsx already guarded the UI path; this prevents non-UI writes
-- (sync, ad-hoc scripts, importers, future API surfaces) from shipping invalid
-- e-CFs to DGII.

ALTER TABLE tickets
  ADD CONSTRAINT chk_e31_requires_rnc
  CHECK (
    NOT (
      (ncf_type = 'E31' OR (ncf IS NOT NULL AND ncf LIKE 'E31%'))
      AND (client_rnc IS NULL OR length(trim(client_rnc)) = 0)
    )
  ) NOT VALID;

-- NOT VALID: skips backfill check so historical rows with the bad shape don't
-- block deploy; new rows still rejected.
DO $$
BEGIN
  BEGIN
    ALTER TABLE tickets VALIDATE CONSTRAINT chk_e31_requires_rnc;
  EXCEPTION WHEN check_violation THEN
    -- Pre-existing E31 rows without RNC remain in place (historical record).
    -- They will fail any UPDATE that touches ncf/client_rnc, which is desired.
    NULL;
  END;
END $$;
