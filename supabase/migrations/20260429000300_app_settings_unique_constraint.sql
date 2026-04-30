-- ════════════════════════════════════════════════════════════════════════════
-- 20260429000300_app_settings_unique_constraint.sql
--
-- Replace the two partial unique indexes on app_settings with a single
-- UNIQUE NULLS NOT DISTINCT constraint that PostgREST can use as an
-- onConflict target.
--
-- Before:
--   idx_app_settings_biz_key_business_level  UNIQUE (business_id, key)
--                                            WHERE device_hwid IS NULL
--   idx_app_settings_biz_key_hwid            UNIQUE (business_id, key, device_hwid)
--                                            WHERE device_hwid IS NOT NULL
--
-- These enforce uniqueness correctly but PostgREST rejects partial indexes
-- as conflict targets — every web.js settings write has to do SELECT-then-
-- UPDATE-or-INSERT (packages/data/web.js ~955-973) and every smoke test
-- doing `.upsert(..., { onConflict: 'business_id,key' })` fails with
-- "no unique or exclusion constraint matching the ON CONFLICT specification".
--
-- After (PG 15+ feature, we're on PG 17):
--   app_settings_business_key_hwid_uniq      UNIQUE NULLS NOT DISTINCT
--                                            (business_id, key, device_hwid)
--
-- NULLS NOT DISTINCT means two rows with the same (biz,key) and a NULL
-- device_hwid collide — exactly the semantic the partial indexes were
-- approximating. Cleaner: one constraint, PostgREST-compatible, half the
-- index storage.
--
-- Pre-check: 0 duplicate (business_id, key, COALESCE(device_hwid,'<null>'))
-- tuples exist in production today (verified 2026-04-29). Migration is safe.
--
-- After this lands, callers can simplify:
--   .upsert(rows, { onConflict: 'business_id,key,device_hwid' })
-- ════════════════════════════════════════════════════════════════════════════

-- Idempotency: only apply if the new constraint isn't already present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.app_settings'::regclass
       AND conname  = 'app_settings_business_key_hwid_uniq'
  ) THEN
    -- Drop the partial indexes (their job is being taken over by the new constraint).
    DROP INDEX IF EXISTS public.idx_app_settings_biz_key_business_level;
    DROP INDEX IF EXISTS public.idx_app_settings_biz_key_hwid;

    -- Add the real unique constraint. NULLS NOT DISTINCT requires PG 15+.
    EXECUTE 'ALTER TABLE public.app_settings
             ADD CONSTRAINT app_settings_business_key_hwid_uniq
             UNIQUE NULLS NOT DISTINCT (business_id, key, device_hwid)';
  END IF;
END $$;
