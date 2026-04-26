-- v2.13.0 — durable replay guard for DGII seed verification
--
-- fe/validarcertificado.js previously relied on an in-memory Map for nonce
-- dedup, which does nothing across Vercel cold starts or multi-region
-- invocations. A captured seed could be replayed indefinitely from a
-- different serverless instance to mint fresh JWTs. This table closes
-- the loop with a UNIQUE(valor) constraint so insert = first use,
-- 23505 on conflict = replay.
--
-- Retention: 15 min. DGII's seed window is well under that. A pg_cron
-- job (or manual sweep) deletes rows older than 15 min.

BEGIN;

CREATE TABLE IF NOT EXISTS public.dgii_seed_nonces (
  valor        TEXT PRIMARY KEY,
  consumed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dgii_seed_nonces_consumed_at_idx
  ON public.dgii_seed_nonces (consumed_at);

-- RLS — no direct client access. Service role bypasses.
ALTER TABLE public.dgii_seed_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dgii_seed_nonces FROM anon, authenticated;

-- Sweep helper (callable by scheduled job or cron).
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
   WHERE consumed_at < now() - INTERVAL '15 minutes';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sweep_dgii_seed_nonces() FROM anon, authenticated;

COMMIT;
