-- 20260425000000_app_settings_updated_at_lww.sql
-- v2.16.7 — FIX-HIGH-5 — close the app_settings divergence race.
--
-- See db/supabase-migration-v2.16.7-app-settings-updated-at.sql for the full
-- post-mortem and rationale. Short version: the previous BEFORE UPDATE trigger
-- (`app_settings_bump_updated_at` from 20260418100000) overwrote updated_at
-- to NOW() on every UPDATE, which destroyed Last-Write-Wins comparison and
-- let stale device-B pushes clobber fresh device-A flips of business-level
-- keys (dgii_environment, tienda_subtype, pos_tab_order, etc.).
--
-- This replaces the trigger with an LWW gatekeeper. Idempotent.

CREATE OR REPLACE FUNCTION public.app_settings_lww_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.updated_at IS NULL THEN
      NEW.updated_at := NOW();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.updated_at IS NULL THEN
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  -- Stale write rejected: return OLD so the row is unchanged.
  IF OLD.updated_at IS NOT NULL AND NEW.updated_at < OLD.updated_at THEN
    RETURN OLD;
  END IF;

  -- Authoritative client timestamp preserved verbatim. No auto-bump.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER trg_app_settings_updated_at
  BEFORE INSERT OR UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.app_settings_lww_updated_at();

ALTER TABLE public.app_settings
  ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE public.app_settings
  ALTER COLUMN updated_at SET NOT NULL;

-- Old function is now unreferenced. Drop it for hygiene (no-op if absent).
DROP FUNCTION IF EXISTS public.app_settings_bump_updated_at() CASCADE;

-- After CASCADE above, recreate the trigger we just installed (CASCADE drops it).
DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER trg_app_settings_updated_at
  BEFORE INSERT OR UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.app_settings_lww_updated_at();
