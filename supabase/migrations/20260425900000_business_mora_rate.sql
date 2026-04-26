-- C7 — Per-business default mora rate (daily, decimal). 0.005 = 0.5% diaria.
-- Idempotent: safe to re-run.
DO $$
BEGIN
  ALTER TABLE public.businesses
    ADD COLUMN mora_rate_daily NUMERIC(5,4) DEFAULT 0.005;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

COMMENT ON COLUMN public.businesses.mora_rate_daily
  IS 'Default daily mora rate for prestamos contracts (decimal, e.g. 0.005 = 0.5%/day). Replaces hardcoded 0.5 literal in pdfContracts.js / Loans.jsx.';
