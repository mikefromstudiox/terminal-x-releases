-- ecf_cert_history — append-only audit trail for DGII .p12 certificate rotations.
--
-- Why: businesses.settings.ecf_cert_* is a single-row snapshot. When a client
-- renews their Viafirma .p12, the new cert overwrites the old one and we lose
-- "when was this cert rotated and by whom?". This table preserves that history.
--
-- Write sites:
--   1. web/api/dgii-cert-upload.js   (rotation_reason derived from prior state)
--   2. electron/cert-manager.js      (installCert → local row → sync push)
--   3. Admin panel cert bundling     (installed_from='admin')
--
-- Read site:
--   packages/ui/admin/pages/ClientDetail.jsx — "Historial de Certificados" card
--
-- RLS: SELECT scoped via my_business_ids() so tenants see only their own rows.
-- INSERT allowed to anon+authenticated (business_id IS NOT NULL) because
-- desktop sync runs with the anon key on most client installs; service_role
-- continues to bypass RLS for the web upload endpoint. This mirrors the
-- activity_log policy pattern and honors the "never hardcode service_role"
-- rule while still giving strict per-tenant read isolation.

CREATE TABLE IF NOT EXISTS public.ecf_cert_history (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id           UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id           UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  cert_serial           TEXT,
  subject_rnc           TEXT,
  subject_cn            TEXT,
  issued_at             TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ,
  installed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  installed_by_user_id  UUID,
  installed_by_name     TEXT,
  installed_from        TEXT CHECK (installed_from IN ('desktop','web','admin')),
  rotation_reason       TEXT CHECK (rotation_reason IN ('initial','renewal','replacement')),
  sha256_fingerprint    TEXT,
  prev_serial           TEXT,
  prev_expires_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ecf_cert_history_business
  ON public.ecf_cert_history(business_id, installed_at DESC);

CREATE INDEX IF NOT EXISTS ecf_cert_history_fingerprint
  ON public.ecf_cert_history(sha256_fingerprint);

-- updated_at trigger (matches pattern from 20260419300000_sync_update_triggers.sql)
CREATE OR REPLACE FUNCTION public.ecf_cert_history_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ecf_cert_history_updated_at ON public.ecf_cert_history;
CREATE TRIGGER ecf_cert_history_updated_at
  BEFORE UPDATE ON public.ecf_cert_history
  FOR EACH ROW EXECUTE FUNCTION public.ecf_cert_history_set_updated_at();

-- RLS
ALTER TABLE public.ecf_cert_history ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped SELECT (authenticated sees only own business rows).
DROP POLICY IF EXISTS ecf_cert_history_sel ON public.ecf_cert_history;
CREATE POLICY ecf_cert_history_sel ON public.ecf_cert_history
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT my_business_ids()));

-- Desktop sync (anon key) and authenticated web clients can append rows for
-- any business they're pushing to. service_role bypasses. We do NOT allow
-- UPDATE or DELETE — this table is append-only.
DROP POLICY IF EXISTS ecf_cert_history_ins ON public.ecf_cert_history;
CREATE POLICY ecf_cert_history_ins ON public.ecf_cert_history
  FOR INSERT TO anon, authenticated
  WITH CHECK (business_id IS NOT NULL);

-- Admin panel (authenticated via service_role inside panel.js) reads across
-- all businesses via service_role which bypasses RLS — no extra policy needed.
