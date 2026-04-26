-- 2026_04_27_v21617_drop_app_settings_redundant_unique.sql
-- Punch-list closure (Studio X "v2.16.14 working build" report 2026-04-26):
--
-- The unconditional UNIQUE(business_id, key) constraint
-- `app_settings_business_id_key_key` blocks every device-local push of
-- keys that ALSO exist as biz-level rows (e.g. printer config).
-- The two partial indexes that already exist enforce the correct
-- semantics:
--   * idx_app_settings_biz_key_business_level — UNIQUE(business_id, key)
--                                                WHERE device_hwid IS NULL
--   * idx_app_settings_biz_key_hwid           — UNIQUE(business_id, key,
--                                                device_hwid) WHERE
--                                                device_hwid IS NOT NULL
--
-- The unconditional one is redundant + actively harmful. Drop it. The
-- partial indexes keep biz-level keys unique AND device-local keys
-- unique-per-device.
--
-- Idempotent. No row changes. PostgREST schema reload at the bottom.

ALTER TABLE public.app_settings
  DROP CONSTRAINT IF EXISTS app_settings_business_id_key_key;

-- Drop the underlying unique index too (PostgreSQL drops it with the
-- constraint, but defensive in case it was created standalone):
DROP INDEX IF EXISTS public.app_settings_business_id_key_key;

NOTIFY pgrst, 'reload schema';
