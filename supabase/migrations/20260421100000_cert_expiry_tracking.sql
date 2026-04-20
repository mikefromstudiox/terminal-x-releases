-- ──────────────────────────────────────────────────────────────────────────
-- v2.11.2 — DGII Certificate Expiry Tracking
-- Tracks the last-notified tier per business so the 90/60/30-day alert
-- check on the desktop doesn't spam activity_log on every 12h tick.
--
-- Tiers (days until cert.expiry):
--   'none'       — > 90d, no alert
--   'info'       — 61-90d, silent activity_log entry
--   'warn'       — 31-60d, banner in UI + activity_log
--   'critical'   — 1-30d, modal on startup + activity_log
--   'expired'    — <= 0d, block new e-CF emissions
--
-- Idempotent — safe to re-run.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cert_expiry_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  cert_serial     TEXT,
  cert_expiry     TIMESTAMPTZ,
  last_tier       TEXT NOT NULL DEFAULT 'none'
                    CHECK (last_tier IN ('none','info','warn','critical','expired')),
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_notified_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One alert row per (business, certificate serial). A new cert install
-- creates a fresh row and tier resets to 'none'.
CREATE UNIQUE INDEX IF NOT EXISTS cert_expiry_alerts_biz_serial_unique
  ON public.cert_expiry_alerts(business_id, COALESCE(cert_serial, ''));

CREATE INDEX IF NOT EXISTS cert_expiry_alerts_biz_idx
  ON public.cert_expiry_alerts(business_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.cert_expiry_alerts_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS cert_expiry_alerts_touch ON public.cert_expiry_alerts;
CREATE TRIGGER cert_expiry_alerts_touch
  BEFORE UPDATE ON public.cert_expiry_alerts
  FOR EACH ROW EXECUTE FUNCTION public.cert_expiry_alerts_touch();

-- RLS — mirrors activity_log policy shape (per-tenant via business_id).
ALTER TABLE public.cert_expiry_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cert_expiry_alerts_anon_read ON public.cert_expiry_alerts;
CREATE POLICY cert_expiry_alerts_anon_read
  ON public.cert_expiry_alerts FOR SELECT TO anon, authenticated
  USING (business_id IS NOT NULL);

DROP POLICY IF EXISTS cert_expiry_alerts_anon_insert ON public.cert_expiry_alerts;
CREATE POLICY cert_expiry_alerts_anon_insert
  ON public.cert_expiry_alerts FOR INSERT TO anon, authenticated
  WITH CHECK (business_id IS NOT NULL);

DROP POLICY IF EXISTS cert_expiry_alerts_anon_update ON public.cert_expiry_alerts;
CREATE POLICY cert_expiry_alerts_anon_update
  ON public.cert_expiry_alerts FOR UPDATE TO anon, authenticated
  USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL);
