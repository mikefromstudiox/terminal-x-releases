-- 2026_05_19 — tickets.age_verified column
--
-- Cleanup #1 from Operation Cristal fold-in. Predicted Cristal bug:
-- age verification is currently a modal-only flag — once the cashier
-- clicks "verified", the boolean lives in component state and the sale
-- proceeds. After the ticket is written, NO column persists the fact
-- that age was verified. Receipt reprints + audit trail lose the
-- record, and DGII receipts for alcohol sales can't carry the proof.
--
-- This migration ADDS the column. Wiring CobrarModal.jsx to populate
-- it on Cobrar is a separate code change (Phase B — not in this commit).
-- Until then the column is DEFAULT false on every row, and the audit
-- scenario `vertical.licoreria.cristal.age_verification_persists`
-- flips from skip → pass because direct INSERTs can carry the flag.

BEGIN;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS age_verified boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tickets.age_verified IS
  'True when the cashier confirmed the customer is of legal age at sale time. Licorería trigger categories surface the modal that flips this. Persisted so reprints + DGII alcohol-sale audits keep the record.';

COMMIT;
