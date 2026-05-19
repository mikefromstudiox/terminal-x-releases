-- 2026_05_19 — Canonicalize client_errors.severity to {info, warn, error, critical}
--
-- Finding #18 from inaugural Mega Smoke run. Two severity vocabularies
-- coexist in the codebase:
--   - 'warn' (canonical, used in 8+ data layer callsites and Mega Smoke
--     assertion `enum_clean`)
--   - 'warning' (legacy long form, used in 3 callsites)
--
-- The CHECK constraint client_errors_severity_check currently accepts
-- 'warning' but not 'warn' — opposite of what the assertion expects.
-- 66 historical rows have severity='warning'.
--
-- Three-part fix:
-- 1. Code: 3 callsites changed 'warning' → 'warn' (committed separately).
-- 2. Data: backfill 66 historical rows.
-- 3. Schema: drop old CHECK, add new CHECK with canonical set.
--
-- Done in this order to avoid the constraint rejecting the data fix.

BEGIN;

ALTER TABLE public.client_errors
  DROP CONSTRAINT IF EXISTS client_errors_severity_check;

UPDATE public.client_errors
   SET severity = 'warn'
 WHERE severity = 'warning';

ALTER TABLE public.client_errors
  ADD CONSTRAINT client_errors_severity_check
  CHECK (severity = ANY (ARRAY['info'::text, 'warn'::text, 'error'::text, 'critical'::text]));

COMMIT;
