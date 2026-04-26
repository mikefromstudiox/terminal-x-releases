-- v2.16.0 — daily service-interval reminders for mecánica
--
-- Surfaces vehicles whose next_service_km is within 500km of current odometer
-- OR whose next_service_at is within 7 days. Consumed by:
--   1. MechanicResumen.jsx "Vehículos vencidos" tile (per-business SELECT).
--   2. Daily 7AM cron (out-of-band schedule below) → invokes whatsapp-send
--      Edge Function for each row with the client's WhatsApp.
--
-- The schedule registration is left to Supabase Studio (pg_cron extension
-- must be enabled and pg_net for HTTP). Helper function is idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION public.mechanic_service_reminders_due(p_business_id UUID DEFAULT NULL)
RETURNS TABLE (
  business_id UUID,
  vehicle_supabase_id UUID,
  plate TEXT,
  vin TEXT,
  make TEXT,
  model TEXT,
  client_supabase_id UUID,
  odometer_km INTEGER,
  next_service_km INTEGER,
  next_service_at TIMESTAMPTZ,
  km_remaining INTEGER,
  days_remaining INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.business_id,
    v.supabase_id AS vehicle_supabase_id,
    v.plate,
    v.vin,
    v.make,
    v.model,
    v.client_supabase_id,
    v.odometer_km,
    v.next_service_km,
    v.next_service_at,
    CASE WHEN v.next_service_km IS NOT NULL AND v.odometer_km IS NOT NULL
         THEN v.next_service_km - v.odometer_km END AS km_remaining,
    CASE WHEN v.next_service_at IS NOT NULL
         THEN EXTRACT(DAY FROM (v.next_service_at - now()))::INTEGER END AS days_remaining
  FROM vehicles v
  WHERE v.active = true
    AND (p_business_id IS NULL OR v.business_id = p_business_id)
    AND (
      (v.next_service_km IS NOT NULL AND v.odometer_km IS NOT NULL
        AND v.odometer_km >= v.next_service_km - 500)
      OR
      (v.next_service_at IS NOT NULL
        AND v.next_service_at <= now() + INTERVAL '7 days')
    );
$$;

REVOKE EXECUTE ON FUNCTION public.mechanic_service_reminders_due(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mechanic_service_reminders_due(UUID) TO authenticated, service_role;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- v2.16.0 FIX-C4 — Activate the WhatsApp preventive-maintenance reminder cron.
-- ─────────────────────────────────────────────────────────────────────────────
-- The block below MUST be applied once via the Supabase SQL Editor (not by the
-- automated migrations runner) because it depends on:
--   1. `pg_cron` extension enabled  (Supabase: Database → Extensions → pg_cron)
--   2. `pg_net`  extension enabled  (same place)
--   3. Two database settings populated with real values:
--        ALTER DATABASE postgres SET app.whatsapp_send_url
--          = 'https://<project-ref>.supabase.co/functions/v1/whatsapp-send';
--        ALTER DATABASE postgres SET app.service_role_key
--          = '<SUPABASE_SERVICE_ROLE_KEY>';
--      (After ALTER DATABASE, restart the connection so current_setting() picks
--      up the values, or use SET LOCAL inside the cron job — we use
--      current_setting() because pg_cron jobs reconnect each run.)
--
-- The Edge Function whatsapp-send accepts kind='mechanic_service_reminder'
-- when the request carries the service-role key (Branch A in index.ts) and
-- iterates every business with WhatsApp configured. Failures per-business
-- are logged in the response but never break the cron schedule.
--
-- Cron expression `0 11 * * *` = 11:00 UTC daily = 7:00 AM in Santo Domingo
-- (UTC-4, no DST in DR). The job is idempotent — calling it twice in one day
-- just sends each candidate twice; the SQL helper does not deduplicate. If
-- duplicate-suppression becomes a concern, add a `last_reminder_sent_at`
-- column to vehicles and filter on it inside `mechanic_service_reminders_due`.
--
-- To deactivate the cron later:
--   SELECT cron.unschedule('mechanic-service-reminders-daily');
--
-- ── COPY-PASTE THIS BLOCK INTO SUPABASE SQL EDITOR ──────────────────────────
/*
SELECT cron.schedule(
  'mechanic-service-reminders-daily',
  '0 11 * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.whatsapp_send_url', true),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body := jsonb_build_object('kind', 'mechanic_service_reminder')::jsonb
    );
  $$
);
*/
-- ────────────────────────────────────────────────────────────────────────────
