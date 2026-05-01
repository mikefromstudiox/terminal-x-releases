-- ════════════════════════════════════════════════════════════════════════════
-- v2.16.30 — Rewrite atomic_next_ncf to actually work
--
-- Two bugs in the prior body (initial.sql + upgrade_existing.sql line 469-495):
--
--   1. Padding hardcoded to 8 digits via `lpad(next_num::text, 8, '0')`. Correct
--      for legacy B-series (B01/B02/B14/B15) which are 11-char NCFs (3 prefix +
--      8 digits) but WRONG for electronic E-series (E31/E32/E33/E34/E41/E43/
--      E44/E45/E46/E47) which DGII spec'd as 13-char NCFs (3 prefix + 10
--      digits). The function would emit `E310000001` (12 chars) instead of
--      `E3100000001` (13 chars). DGII rejects with "Archivo no valido".
--
--   2. Authorization check via `business_uuid NOT IN (SELECT my_business_ids())`
--      reads `auth.uid()` which returns NULL for license-JWT callers (their
--      JWT `sub` is the business UUID, NOT a real auth.users id) and for
--      service-role callers. Result: every modern caller (web mint-license-jwt
--      flow, Edge Functions, server-side scripts) gets "Access denied".
--
-- Fix:
--   1. Pad based on type prefix: type starts with 'E' → 10 digits, else 8.
--      Use the `type` ARGUMENT directly as the canonical 3-char prefix; ignore
--      `row.prefix` because a stray sync once wrote 'E320' (4 chars) into
--      prefix and produced 14-char eNCFs DGII rejected. Pattern matches
--      electron/database.js:8100-8104 (desktop SQLite equivalent already
--      correct).
--
--   2. Dual-path auth:
--        - service_role caller → bypass (RLS bypass is intrinsic to service-role).
--        - authenticated caller → trust app_metadata.business_id JWT claim,
--          must match `business_uuid` argument. Same pattern as every modern
--          RLS policy in the schema (see docs/SCHEMA-SNAPSHOT.md §2). Notably
--          NOT user_metadata which is client-modifiable.
--
-- Concurrency model unchanged: SELECT ... FOR UPDATE locks the (business_id,
-- type) row so two cashiers issuing simultaneously each get a unique
-- sequential NCF, never duplicate, never skip.
--
-- Failure modes upgraded from silent NULL return to RAISE EXCEPTION:
--   - missing sequence row
--   - sequence row exists but disabled / inactive
--   - current_number would exceed limit_number (range exhausted)
-- These are user-visible errors that the cashier UI should surface ("set up
-- B02 in Sistema → DGII", "request a new range from DGII"), not silent nulls
-- that leave the caller guessing.
--
-- See: docs/MIGRATION-AUDIT-2026-05-01.md §2.8 + memory
-- feedback_atomic_next_ncf_drift.md.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.atomic_next_ncf(business_uuid uuid, ncf_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  seq RECORD;
  next_num int;
  pad_width int;
  jwt_business_id uuid;
  caller_role text;
BEGIN
  -- ── Authorization (dual-path) ─────────────────────────────────────────────
  caller_role := coalesce(auth.role(), '');
  IF caller_role = 'service_role' THEN
    -- service-role keys (Edge Functions, server-side scripts, sync workers)
    -- bypass — they're trusted to pass the correct business_uuid. RLS bypass
    -- is intrinsic to service-role anyway.
    NULL;
  ELSE
    -- Authenticated path (license-JWT or GoTrue session). Trust the
    -- app_metadata.business_id claim — same pattern as every modern RLS
    -- policy. user_metadata is client-modifiable and must NOT be used.
    jwt_business_id := ((auth.jwt() -> 'app_metadata') ->> 'business_id')::uuid;
    IF jwt_business_id IS NULL OR jwt_business_id <> business_uuid THEN
      RAISE EXCEPTION 'atomic_next_ncf: caller business_id mismatch (jwt=% arg=%)',
        coalesce(jwt_business_id::text, '<null>'), business_uuid;
    END IF;
  END IF;

  -- ── Lock + read current state ─────────────────────────────────────────────
  SELECT id, current_number, limit_number, active, enabled
    INTO seq
    FROM public.ncf_sequences
   WHERE business_id = business_uuid
     AND type = ncf_type
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'atomic_next_ncf: no ncf_sequence row for business=% type=% — owner must create one in Sistema -> DGII',
      business_uuid, ncf_type;
  END IF;
  IF NOT seq.active OR NOT seq.enabled THEN
    RAISE EXCEPTION 'atomic_next_ncf: sequence (% %) is not enabled — owner must enable it in Sistema -> DGII',
      business_uuid, ncf_type;
  END IF;

  next_num := seq.current_number + 1;
  IF next_num > seq.limit_number THEN
    RAISE EXCEPTION 'atomic_next_ncf: sequence (% %) exhausted (current=% limit=%) — owner must request a new range from DGII',
      business_uuid, ncf_type, seq.current_number, seq.limit_number;
  END IF;

  -- ── Increment ─────────────────────────────────────────────────────────────
  UPDATE public.ncf_sequences
     SET current_number = next_num,
         updated_at = now()
   WHERE id = seq.id;

  -- ── Format (prefix-aware padding) ─────────────────────────────────────────
  -- B-series (B01/B02/B14/B15)               → 8 digits  → 11 chars total.
  -- E-series (E31/E32/E33/E34/E41/E43/...)   → 10 digits → 13 chars total.
  -- Use the `type` ARGUMENT as the canonical prefix; ignore row.prefix
  -- (historical sync corruption: stray 'E320' in prefix produced 14-char
  --  eNCFs DGII rejected — see electron/database.js:8100-8104).
  pad_width := CASE WHEN upper(ncf_type) LIKE 'E%' THEN 10 ELSE 8 END;
  RETURN upper(ncf_type) || lpad(next_num::text, pad_width, '0');
END;
$$;

-- ── Permissions ────────────────────────────────────────────────────────────
-- Tighten EXECUTE: anon must NOT mint NCFs; only authenticated (license-JWT
-- or session) and service_role (Edge Functions / server scripts).
REVOKE EXECUTE ON FUNCTION public.atomic_next_ncf(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_next_ncf(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.atomic_next_ncf(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.atomic_next_ncf(uuid, text) IS
  'Atomic NCF allocator. SECURITY DEFINER, FOR UPDATE-locked. Service-role bypasses auth check; authenticated callers must have app_metadata.business_id matching the argument. Padding derived from type prefix (B*=8, E*=10). RAISE on missing/disabled/exhausted. Rewritten 2026-05-02 — see docs/MIGRATION-AUDIT-2026-05-01.md §2.8 + memory feedback_atomic_next_ncf_drift.md.';

-- ── Verification queries (paste-and-run after applying) ───────────────────
-- 1. Confirm new body deployed:
--    SELECT pg_get_functiondef(p.oid)
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public' AND p.proname = 'atomic_next_ncf';
--
-- 2. Confirm grants:
--    SELECT grantee, privilege_type
--      FROM information_schema.role_routine_grants
--     WHERE specific_schema = 'public' AND routine_name = 'atomic_next_ncf';
--    Expected: authenticated EXECUTE; service_role EXECUTE; (NOT anon, NOT PUBLIC).
--
-- 3. Smoke test (service-role):
--    SELECT public.atomic_next_ncf(
--      '4f789f41-76d2-4402-838f-5fe20a91641f'::uuid, 'B02'
--    );
--    -- Expected: 'B02000000XX' for the next Ranoza B02 (11 chars).
