-- Migration: Persistent Supabase-backed rate limiter for public /api endpoints.
--
-- The in-memory `Map` rate limiter previously in web/api/validate.js + panel.js
-- was ineffective on Vercel: each serverless cold-start and each region got
-- its own fresh Map, so an attacker could brute-force license keys at
-- 30/min/region with trivial concurrency. This migration provides a shared
-- counter bucket (bucket, window_start) the RPC atomically increments in a
-- single round-trip per request.
--
-- Design:
--   * (bucket, window_start) is the identity of a 1-minute slot.
--   * bucket is free-form TEXT: typically "ip:<addr>" or "ep:<endpoint>:<ip>"
--     so we can rate-limit per endpoint class independently.
--   * RPC `check_rate_limit(bucket, max_per_min)` is SECURITY DEFINER so the
--     anon/serverless caller can execute it without table-level grants.
--   * Returns TRUE when the request is ALLOWED, FALSE when over the limit.
--   * Fails-open at the app layer on RPC/network error — never lock legitimate
--     users out because of a Supabase blip.
--   * Rows accumulate, indexed on window_start for cheap periodic purge.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  id            BIGSERIAL PRIMARY KEY,
  bucket        TEXT        NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER     NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_api_rate_limits_bucket_window
  ON public.api_rate_limits (bucket, window_start);

CREATE INDEX IF NOT EXISTS idx_api_rate_limits_window_start
  ON public.api_rate_limits (window_start);

-- RLS: clients never touch this table directly. RPC is SECURITY DEFINER and
-- runs as the table owner, which bypasses RLS. Enabling RLS without policies
-- denies all anon/authenticated direct reads/writes.
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

-- RPC: atomic upsert + returning count. Uses INSERT ... ON CONFLICT ... DO
-- UPDATE SET count = count + 1 RETURNING count, which is atomic against
-- concurrent writers (Postgres serialises on the unique index).
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_bucket       TEXT,
  p_max_per_min  INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window  TIMESTAMPTZ := date_trunc('minute', now());
  v_count   INTEGER;
BEGIN
  INSERT INTO public.api_rate_limits (bucket, window_start, count, updated_at)
  VALUES (p_bucket, v_window, 1, now())
  ON CONFLICT (bucket, window_start)
  DO UPDATE SET count = public.api_rate_limits.count + 1,
                updated_at = now()
  RETURNING count INTO v_count;

  RETURN v_count <= p_max_per_min;
END;
$$;

-- Grant exec to anon + authenticated so the Vercel serverless caller (which
-- uses the service role anyway, but also falls through to anon on some
-- paths) can invoke it. SECURITY DEFINER means the function body runs as the
-- owner regardless of caller role.
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER) TO anon, authenticated, service_role;

-- Housekeeping helper: purge buckets older than 24h. Invoke from a cron or
-- from any caller that wants to keep the table small. Separate function so
-- it isn't on the hot path of every validate() call.
CREATE OR REPLACE FUNCTION public.purge_stale_rate_limits()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.api_rate_limits
   WHERE window_start < now() - interval '24 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_stale_rate_limits() TO service_role;

COMMENT ON TABLE public.api_rate_limits IS
  'Per-(bucket,minute) counters for persistent /api rate limiting. Replaces per-instance in-memory Map that Vercel cold starts + multi-region defeated.';
COMMENT ON FUNCTION public.check_rate_limit(TEXT, INTEGER) IS
  'Atomic 1-minute-window rate-limit check. Returns TRUE when request allowed, FALSE when over limit. SECURITY DEFINER; callable by anon/authenticated/service_role.';
