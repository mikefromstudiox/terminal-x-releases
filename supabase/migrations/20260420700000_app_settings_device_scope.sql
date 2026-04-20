-- 20260420700000_app_settings_device_scope.sql
-- v2.10.5 — Recovery RTO fix (HIGH finding).
--
-- BEFORE: device-local app_settings keys (printer config, drawer pulse hex,
--         kiosk mode, print_factura_auto, etc.) were SQLite-only. When a cash
--         register PC died, the replacement install had to re-run every
--         wizard from scratch — "9pm Friday" unrecoverable downtime.
--
-- AFTER:  those keys can ALSO be mirrored to Supabase, tagged with the
--         writing device's HWID. Recovery on the SAME hardware pulls the
--         row back automatically. Different hardware: deliberately skipped
--         (we don't want device A's printer serial on device B), with a
--         future "Copy from other device" admin UI for explicit opt-in.
--
-- Design:
--   * is_device_local BOOLEAN — whether the row's scope is a single device.
--   * device_hwid TEXT — NULL for business-level rows; populated for
--     device-local rows with the HWID of the device that wrote it.
--   * Composite UNIQUE (business_id, key, device_hwid) — so one business can
--     have many rows for the same key, one per device. Business-level rows
--     keep the existing (business_id, key) uniqueness via a partial unique
--     index over rows where device_hwid IS NULL.
--   * All changes IF NOT EXISTS — migration is idempotent.
--
-- Pull contract (desktop):
--   * Business-level (device_hwid IS NULL): always applied.
--   * Device-local with device_hwid = my hwid: applied (recovery).
--   * Device-local with any other device_hwid: ignored — each device owns
--     its own rows, last-write-wins only within that device's partition.
--
-- This is safe for cross-device writes: each HWID partition has exactly one
-- writer, so there is no race. LWW on (business_id, key, device_hwid) is
-- single-writer under the composite key.

-- 1. Add the new columns.
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS is_device_local BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS device_hwid TEXT;

-- 2. Relax the previous global (business_id, key) unique constraint —
--    we now allow one row per (business_id, key, device_hwid) tuple.
--    Business-level rows continue to be uniquely keyed via the partial
--    unique index below, which preserves the semantic "one business row
--    per key" guarantee without blocking device-local duplicates.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_settings_business_key_key'
  ) THEN
    ALTER TABLE public.app_settings
      DROP CONSTRAINT app_settings_business_key_key;
  END IF;
END $$;

-- 3. Composite unique on (business_id, key, device_hwid). This is the
--    upsert target used by desktop sync for device-local rows.
--    Postgres UNIQUE treats multiple NULLs as distinct by default, so we
--    combine this with (4) to cover the business-level case.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_settings_biz_key_hwid
  ON public.app_settings (business_id, key, device_hwid)
  WHERE device_hwid IS NOT NULL;

-- 4. Partial unique index enforcing "one business-level row per key".
--    device_hwid IS NULL means the row is business-wide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_settings_biz_key_business_level
  ON public.app_settings (business_id, key)
  WHERE device_hwid IS NULL;

-- 5. Hot-path index for pulls filtered by this device.
CREATE INDEX IF NOT EXISTS idx_app_settings_biz_hwid
  ON public.app_settings (business_id, device_hwid)
  WHERE device_hwid IS NOT NULL;

-- 6. Quick integrity sanity check — business-level rows must never carry
--    a device_hwid, device-local rows must always carry one. Enforced via
--    CHECK constraint so a bad write is rejected at the DB.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_settings_scope_hwid_consistency'
  ) THEN
    ALTER TABLE public.app_settings
      ADD CONSTRAINT app_settings_scope_hwid_consistency
      CHECK (
        (is_device_local = FALSE AND device_hwid IS NULL)
        OR
        (is_device_local = TRUE  AND device_hwid IS NOT NULL)
      ) NOT VALID;
  END IF;
END $$;

-- NOT VALID above — we skip validating pre-existing rows (all of which
-- are business-level with device_hwid=NULL and is_device_local=FALSE, so
-- they satisfy the check anyway). Future inserts are enforced.
-- Run VALIDATE now since we know pre-existing rows comply.
ALTER TABLE public.app_settings
  VALIDATE CONSTRAINT app_settings_scope_hwid_consistency;
