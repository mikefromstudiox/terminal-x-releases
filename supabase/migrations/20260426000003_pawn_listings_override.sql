-- C8 — Track manual overrides of the legal 70% avalúo de remate.
-- Default flow uses 0.7 * estimated_value silently. Override forces a conscious
-- decision via owner-PIN gate and writes both a flag + reason here, plus an
-- activity_log entry (handled in app code).
-- Idempotent: safe to re-run.
DO $$
BEGIN
  ALTER TABLE public.pawn_listings
    ADD COLUMN list_price_override BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.pawn_listings
    ADD COLUMN override_reason TEXT;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

COMMENT ON COLUMN public.pawn_listings.list_price_override
  IS 'TRUE when the cashier manually overrode the legal 70% avalúo de remate.';
COMMENT ON COLUMN public.pawn_listings.override_reason
  IS 'Optional explanation for an override (defended in court if disputed).';
