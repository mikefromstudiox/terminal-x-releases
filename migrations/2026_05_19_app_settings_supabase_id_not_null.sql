-- 2026_05_19 — app_settings.supabase_id NOT NULL + backfill
--
-- Finding #16 from inaugural Mega Smoke run. 10 app_settings rows had
-- NULL supabase_id — invisible to delta sync (the pull/push pipeline
-- joins on supabase_id). All on Contabilidad Perla Lugo + Ranoza Liquor
-- Store: real client rows that never got synced after creation.
--
-- Two-part fix:
-- 1. Data backfill: gen_random_uuid() for each NULL row (applied via
--    Management API before this migration).
-- 2. Schema: NOT NULL constraint so future inserts can't repeat the bug.
--
-- Why this matters: rows with NULL supabase_id are sync-invisible. The
-- desktop pulls only fetch rows where supabase_id IS NOT NULL; admin
-- edits on those rows never reach the terminal. Per CLAUDE.md
-- supabase_id Architecture: every synced row MUST have a UUID at insert.

BEGIN;

-- Pre-flight: confirm 0 nulls remain (backfill already applied).
DO $$
DECLARE
  null_count int;
BEGIN
  SELECT count(*) INTO null_count FROM public.app_settings WHERE supabase_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'app_settings has % rows with NULL supabase_id — backfill before constraint', null_count;
  END IF;
END $$;

ALTER TABLE public.app_settings
  ALTER COLUMN supabase_id SET NOT NULL;

-- Also set a default so any future insert that forgets supabase_id auto-fills.
ALTER TABLE public.app_settings
  ALTER COLUMN supabase_id SET DEFAULT gen_random_uuid();

COMMIT;
