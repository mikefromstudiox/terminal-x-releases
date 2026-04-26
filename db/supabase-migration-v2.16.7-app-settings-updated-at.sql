-- supabase-migration-v2.16.7-app-settings-updated-at.sql
-- FIX-HIGH-5 — Close the app_settings sync race so business-level keys
-- (dgii_environment, timezone, tienda_subtype, pos_tab_order, etc.) cannot
-- diverge between desktop devices.
--
-- ROOT CAUSE:
--   Migration 20260418100000_app_settings_sync_parity.sql installed a
--   BEFORE UPDATE trigger that unconditionally did `NEW.updated_at := NOW()`.
--   That trigger DESTROYS Last-Write-Wins:
--     • Device A flips dgii_environment to 'prod' at 10:00 → server row
--       value='prod', updated_at=10:00:01 (post-trigger).
--     • Device B (still has stale 'certecf' from 09:00) pushes its row.
--       The merge-duplicates upsert UPDATEs the existing row; the trigger
--       bumps updated_at to NOW() (10:05). Result: value='certecf',
--       updated_at=10:05. Device A's flip is gone.
--     • A pulls (cursor advances past 10:00) → gets value='certecf'.
--
-- FIX:
--   Replace the trigger with an LWW gatekeeper that:
--     1. Compares the incoming NEW.updated_at against OLD.updated_at.
--     2. If NEW.updated_at < OLD.updated_at → suppress the UPDATE entirely
--        (return OLD). The stale write is silently rejected.
--     3. Otherwise → preserve the client-supplied NEW.updated_at as the
--        authoritative timestamp. NO auto-bump. The push path in
--        electron/sync.js sets updated_at from the local row, which itself
--        is bumped by the SQLite AFTER UPDATE trigger when value changed.
--
--   This is single-source-of-truth LWW: the originating device writes its
--   wall-clock time once, and that timestamp follows the row across all
--   devices. Pulls compare on it, the push pre-check in sync.js compares
--   on it, and the server enforces it as a final guard.
--
-- Defense in depth (paired changes shipped in v2.16.7):
--   • electron/sync.js push path adds an LWW pre-check that fetches the
--     remote updated_at and drops stale rows before upserting. So this
--     trigger is the LAST line of defense, not the first.
--   • electron/database.js AFTER UPDATE trigger now skips its bump when
--     the UPDATE supplies a different updated_at (i.e. a pull-driven write
--     carrying remote truth) — preserves authoritative timestamps locally.
--
-- Idempotent. Safe to re-run.

CREATE OR REPLACE FUNCTION public.app_settings_lww_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  -- INSERT path: if the client didn't supply updated_at, default to now().
  IF (TG_OP = 'INSERT') THEN
    IF NEW.updated_at IS NULL THEN
      NEW.updated_at := NOW();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE path: enforce Last-Write-Wins on updated_at.
  -- A NULL incoming updated_at is treated as "client didn't care" → use now().
  IF NEW.updated_at IS NULL THEN
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  -- If the incoming write is older than what's already stored, REJECT it
  -- by returning OLD. PostgREST will report the row as "updated" (the row
  -- count is 1) but the values are unchanged — the stale push is a no-op.
  IF OLD.updated_at IS NOT NULL AND NEW.updated_at < OLD.updated_at THEN
    RETURN OLD;
  END IF;

  -- Otherwise: preserve the client-supplied timestamp verbatim. Do NOT bump.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Replace the old unconditional-bump trigger with the LWW gatekeeper.
-- Fires on BOTH INSERT and UPDATE so the INSERT default path is consistent.
DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER trg_app_settings_updated_at
  BEFORE INSERT OR UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.app_settings_lww_updated_at();

-- Sanity: ensure the column has a default for direct INSERTs that bypass
-- the trigger (shouldn't happen, but belt-and-suspenders).
ALTER TABLE public.app_settings
  ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE public.app_settings
  ALTER COLUMN updated_at SET NOT NULL;

-- Hot-path index already exists from 20260418100000 (idx_app_settings_business_updated)
-- and 20260420700000 (idx_app_settings_biz_key_hwid + idx_app_settings_biz_key_business_level).
-- No new indexes needed — pull cursor is `business_id, updated_at.asc` which
-- is already covered.

-- Verification queries (run manually post-deploy):
--   SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.app_settings'::regclass;
--   -- expect: trg_app_settings_updated_at | O
--
--   -- Stale-write test: should be a no-op.
--   UPDATE public.app_settings SET value = 'STALE', updated_at = '2020-01-01'
--     WHERE business_id = '<biz>' AND key = 'dgii_environment';
--   SELECT value, updated_at FROM public.app_settings
--     WHERE business_id = '<biz>' AND key = 'dgii_environment';
--   -- expect: original value, original updated_at (NOT 'STALE', NOT 2020-01-01).
