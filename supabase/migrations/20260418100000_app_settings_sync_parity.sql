-- 20260418100000_app_settings_sync_parity.sql
-- v2.3 — close the app_settings sync gap.
-- Desktop pushes whitelisted BUSINESS-level keys (itbis_pct, biz_rnc, whatsapp_*, etc.)
-- via the normal sync pipeline. This migration brings Supabase's app_settings
-- schema in line with the supabase_id sync architecture so PostgREST upserts resolve.
--
-- Pre-existing columns on Supabase: id UUID, business_id UUID, key TEXT, value TEXT, updated_at TIMESTAMPTZ.
-- Missing: supabase_id UUID + UNIQUE (business_id, supabase_id) + UNIQUE (business_id, key).

-- 1. supabase_id column
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS supabase_id UUID;

-- Backfill supabase_id from the existing primary-key id so rows already in
-- Supabase survive the first post-migration sync without duplicating.
UPDATE public.app_settings SET supabase_id = id WHERE supabase_id IS NULL;

-- 2. Unique constraint on (business_id, supabase_id) — required for PostgREST
--    on_conflict upsert target used by desktop sync.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_settings_business_supabase_id_key'
  ) THEN
    ALTER TABLE public.app_settings
      ADD CONSTRAINT app_settings_business_supabase_id_key
      UNIQUE (business_id, supabase_id);
  END IF;
END $$;

-- 3. Unique constraint on (business_id, key) — web settings.update() uses this
--    as its on_conflict target.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_settings_business_key_key'
  ) THEN
    ALTER TABLE public.app_settings
      ADD CONSTRAINT app_settings_business_key_key
      UNIQUE (business_id, key);
  END IF;
END $$;

-- 4. updated_at auto-bump trigger (matches the pattern used on other synced tables).
CREATE OR REPLACE FUNCTION public.app_settings_bump_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.app_settings_bump_updated_at();

-- 5. Index on business_id for pull-by-tenant queries (hot path).
CREATE INDEX IF NOT EXISTS idx_app_settings_business_updated
  ON public.app_settings (business_id, updated_at);
