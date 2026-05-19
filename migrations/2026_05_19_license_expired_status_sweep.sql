-- 2026_05_19 — License status drift catcher
--
-- Finding #8 from inaugural Mega Smoke run. 9 demo licenses had
-- status='active' with expires_at in the past — semantic drift.
-- Status + expires_at are both consulted by /api/validate; if status
-- says 'active' but expires_at is past, downstream code can disagree.
--
-- Two-part fix:
-- 1. Demo licenses extended to 2030-12-31 (data migration applied
--    separately — demos shouldn't expire and clutter signal).
-- 2. This migration: a function that any cron / triage job can call to
--    sweep stale-active licenses to status='expired'. Safer than a
--    trigger on UPDATE/SELECT (would fire on every read).
--
-- Usage:
--   SELECT public.sweep_expired_licenses();
-- Returns: number of rows flipped to 'expired'.
--
-- Wire into existing cron infrastructure (vercel.json cron_mega_smoke or
-- a new cron_license_sweep) so any expired-active drift gets cleared
-- within 15 min and Mega Smoke's check stays green.

BEGIN;

CREATE OR REPLACE FUNCTION public.sweep_expired_licenses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  flipped int;
BEGIN
  WITH upd AS (
    UPDATE public.licenses
    SET status = 'expired',
        updated_at = now()
    WHERE status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at < now()
    RETURNING 1
  )
  SELECT count(*) INTO flipped FROM upd;
  RETURN flipped;
END $$;

COMMIT;

-- Quick smoke after install:
--   SELECT public.sweep_expired_licenses();  -- should return 0 (we just cleared demos)
