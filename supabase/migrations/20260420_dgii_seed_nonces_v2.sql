-- v2.13.0 (architectural correction) — dgii_seed_nonces dual-state schema.
--
-- Prior model treated insert-on-verify as the replay guard: row exists =
-- seed consumed. That only works if DGII signs the seed. They don't — the
-- emisor signs our seed with their .p12 and posts it back. So "nonce exists"
-- must mean "we issued it", and "consumed" must be a separate, second-phase
-- transition set atomically at verify time.
--
-- Schema evolution:
--   * Add issued_at (default now()) — set at /semilla issue
--   * Make consumed_at nullable — NULL = outstanding, timestamp = consumed
--   * Keep valor PK + UNIQUE (already PK in v1 migration)
--   * Atomic consume via UPDATE ... WHERE consumed_at IS NULL (row count = 1 wins)

BEGIN;

-- Ensure the table exists (idempotent with v1 migration)
CREATE TABLE IF NOT EXISTS public.dgii_seed_nonces (
  valor        TEXT PRIMARY KEY,
  consumed_at  TIMESTAMPTZ NULL DEFAULT NULL
);

-- Add issued_at if missing
ALTER TABLE public.dgii_seed_nonces
  ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Drop the NOT NULL on consumed_at if v1 set it, then re-default to NULL
ALTER TABLE public.dgii_seed_nonces
  ALTER COLUMN consumed_at DROP NOT NULL,
  ALTER COLUMN consumed_at SET DEFAULT NULL;

-- Backfill: any legacy row with a consumed_at already-set is fine;
-- if issued_at ended up defaulting to now() but consumed_at is earlier,
-- clamp issued_at to consumed_at so age math stays monotonic.
UPDATE public.dgii_seed_nonces
   SET issued_at = consumed_at
 WHERE consumed_at IS NOT NULL
   AND issued_at > consumed_at;

-- Replace old consumed_at index with issued_at index (sweep key)
DROP INDEX IF EXISTS public.dgii_seed_nonces_consumed_at_idx;
CREATE INDEX IF NOT EXISTS dgii_seed_nonces_issued_at_idx
  ON public.dgii_seed_nonces (issued_at);

-- Sweep now expires by issued_at (the true TTL anchor — regardless of
-- whether the nonce was ever consumed). 15 min window is comfortable
-- relative to DGII's seed TTL.
CREATE OR REPLACE FUNCTION public.sweep_dgii_seed_nonces()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted INTEGER;
BEGIN
  DELETE FROM public.dgii_seed_nonces
   WHERE issued_at < now() - INTERVAL '15 minutes';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sweep_dgii_seed_nonces() FROM anon, authenticated;

-- RLS hardening (idempotent)
ALTER TABLE public.dgii_seed_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dgii_seed_nonces FROM anon, authenticated;

COMMIT;
