-- v2.16.3 — Restaurant 86-list (sold-out plates).
-- Adds services.in_stock boolean (default true). Mirrors SQLite ALTER on desktop.
-- Idempotent: ADD COLUMN IF NOT EXISTS is Postgres-native.

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS in_stock boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.services.in_stock IS
  '86-list: false = agotado / sold-out, hidden from POS menu grid. v2.16.3.';

-- Optional partial index — speeds the POS menu grid query when most plates
-- stay in stock and only a handful flip to false during service.
CREATE INDEX IF NOT EXISTS idx_services_oos
  ON public.services (business_id)
  WHERE in_stock = false;
