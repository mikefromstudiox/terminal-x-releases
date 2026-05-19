-- 2026_05_19 — app_settings UNIQUE on (business_id, key, device_hwid)
--
-- Finding #7 from inaugural schema-suite run. Suite flagged 25 "dupes"
-- on (business_id, key) — but inspection revealed those rows have
-- DIFFERENT device_hwid values: they're legitimately per-terminal local
-- copies (Ranoza has 3 desktop terminals, each with its own printer /
-- drawer_pulse_hex / kiosk_* settings; STUDIO X SRL has 2 terminals).
--
-- The real natural key is (business_id, key, COALESCE(device_hwid,
-- '<global>')). One row per device per key. A single business-wide row
-- (device_hwid IS NULL) can coexist with per-device overrides (one per
-- hwid).
--
-- This migration adds a partial-unique INDEX shape that catches BOTH
-- buckets:
--   - per-device rows: UNIQUE (business_id, key, device_hwid) WHERE
--     device_hwid IS NOT NULL
--   - business-level rows: UNIQUE (business_id, key) WHERE device_hwid
--     IS NULL
--
-- Without this guard, two writers on the same terminal could each push
-- the same key (e.g. via electron/sync.js retry on transient timeout)
-- and create a true dupe that drifts over time. Today 0 such dupes
-- exist; this index makes that 0 a hard guarantee.

BEGIN;

-- Pre-flight: confirm 0 true dupes on the corrected natural key.
DO $$
DECLARE
  bad_per_device int;
  bad_global int;
BEGIN
  SELECT COALESCE(SUM(cnt-1),0) INTO bad_per_device
  FROM (
    SELECT business_id, key, device_hwid, count(*) AS cnt
    FROM public.app_settings
    WHERE business_id IS NOT NULL AND key IS NOT NULL AND device_hwid IS NOT NULL
    GROUP BY business_id, key, device_hwid
    HAVING count(*) > 1
  ) g;

  SELECT COALESCE(SUM(cnt-1),0) INTO bad_global
  FROM (
    SELECT business_id, key, count(*) AS cnt
    FROM public.app_settings
    WHERE business_id IS NOT NULL AND key IS NOT NULL AND device_hwid IS NULL
    GROUP BY business_id, key
    HAVING count(*) > 1
  ) g;

  IF bad_per_device > 0 OR bad_global > 0 THEN
    RAISE EXCEPTION 'app_settings has true dupes: per_device=%, global=% — manual dedup needed before constraint',
      bad_per_device, bad_global;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_settings_biz_key_device
  ON public.app_settings (business_id, key, device_hwid)
  WHERE device_hwid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_settings_biz_key_global
  ON public.app_settings (business_id, key)
  WHERE device_hwid IS NULL;

COMMIT;
