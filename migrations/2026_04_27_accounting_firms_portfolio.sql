-- 2026_04_27_accounting_firms_portfolio.sql
-- Phase 3 — Contadora portfolio mode.
--
-- A contadora (firm = her own business) manages N client firms (each = a
-- separate `businesses` row). The mapping is many-to-many through
-- firm_memberships. She gets a portfolio cockpit at /portfolio (Pro MAX
-- contabilidad gate) showing traffic-light status across all clients for
-- IT-1, IR-3, IR-17, 606/607/608/609, anticipos, TSS, etc.
--
-- Tables:
--   firm_memberships          — contadora <-> client business mapping
--   client_received_ecfs      — DGII "Mis Comprobantes" auto-pull dump
--   client_dgii_credentials   — encrypted per-client DGII Oficina Virtual creds
--   ecf_classification        — AI auto-classifier results (Norma 07-18 categories 1-11)
--
-- Service-role for writes (sensitive data); admin reads via requireAdmin().

-- ── firm_memberships ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.firm_memberships (
  id                       BIGSERIAL PRIMARY KEY,
  supabase_id              UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  -- The contadora's own business (firm tenant). Pro MAX gating happens here.
  firm_business_id         UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  -- The client business she manages.
  client_business_id       UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  -- Optional link back to the accounting_clients row (her local roster).
  accounting_client_id     BIGINT,
  role                     TEXT NOT NULL DEFAULT 'contador'
                           CHECK (role IN ('contador','reviewer','readonly')),
  status                   TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','paused','revoked')),
  invited_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at              TIMESTAMPTZ,
  revoked_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT firm_membership_uniq UNIQUE (firm_business_id, client_business_id)
);

CREATE INDEX IF NOT EXISTS firm_memberships_firm_idx
  ON public.firm_memberships(firm_business_id, status);
CREATE INDEX IF NOT EXISTS firm_memberships_client_idx
  ON public.firm_memberships(client_business_id);

-- ── client_received_ecfs ─────────────────────────────────────────────────
-- Stash of e-CFs pulled from DGII "Mis Comprobantes" per client. Source of
-- truth for auto-classification + 606 generation. Deduped on (rnc, ncf).
CREATE TABLE IF NOT EXISTS public.client_received_ecfs (
  id                       BIGSERIAL PRIMARY KEY,
  supabase_id              UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  firm_business_id         UUID NOT NULL,
  client_business_id       UUID NOT NULL,
  client_rnc               TEXT NOT NULL,
  ecf_type                 TEXT NOT NULL,        -- B01/B02/B14/B15/E31/E32/E33/E34/E43/E47
  ncf                      TEXT NOT NULL,
  ncf_modificado           TEXT,
  fecha_emision            DATE,
  fecha_vencimiento        DATE,
  emisor_rnc               TEXT,
  emisor_razon_social      TEXT,
  monto_facturado          NUMERIC(16,2) NOT NULL DEFAULT 0,
  itbis_facturado          NUMERIC(16,2) NOT NULL DEFAULT 0,
  itbis_rate               SMALLINT NOT NULL DEFAULT 18,
  itbis_retenido           NUMERIC(16,2) NOT NULL DEFAULT 0,
  isr_retenido             NUMERIC(16,2) NOT NULL DEFAULT 0,
  monto_total              NUMERIC(16,2) NOT NULL DEFAULT 0,
  -- Norma 07-18 Tipo de Bienes y Servicios (1-11). Set by AI classifier;
  -- contadora can override.
  tipo_bienes_servicios    SMALLINT,
  classification_source    TEXT NOT NULL DEFAULT 'pending'
                           CHECK (classification_source IN ('pending','ai','manual','rule')),
  classification_confidence NUMERIC(5,4) DEFAULT 0,
  posted_to_606            SMALLINT NOT NULL DEFAULT 0,
  posted_journal_entry_id  BIGINT,
  raw_xml_url              TEXT,
  source                   TEXT NOT NULL DEFAULT 'dgii_pull'
                           CHECK (source IN ('dgii_pull','manual','xml_upload','api')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_received_ecfs_dedupe UNIQUE (client_business_id, ncf)
);

CREATE INDEX IF NOT EXISTS client_received_ecfs_firm_idx
  ON public.client_received_ecfs(firm_business_id, fecha_emision DESC);
CREATE INDEX IF NOT EXISTS client_received_ecfs_period_idx
  ON public.client_received_ecfs(client_business_id, fecha_emision DESC);
CREATE INDEX IF NOT EXISTS client_received_ecfs_unposted_idx
  ON public.client_received_ecfs(client_business_id, fecha_emision DESC) WHERE posted_to_606 = 0;

-- ── client_dgii_credentials ──────────────────────────────────────────────
-- Encrypted per-client DGII Oficina Virtual creds for the auto-pull worker.
-- Body is opaque base64 — encrypted client-side with the firm's master key
-- (SQLCipher pattern) before transit. Server stores cipher only.
CREATE TABLE IF NOT EXISTS public.client_dgii_credentials (
  id                       BIGSERIAL PRIMARY KEY,
  supabase_id              UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  firm_business_id         UUID NOT NULL,
  client_business_id       UUID NOT NULL UNIQUE,
  rnc                      TEXT NOT NULL,
  -- Encrypted blob: { user, pass, p12_b64?, last_session_cookie? }
  -- Wrapped client-side with AES-GCM using a key derived from the firm's
  -- master HKDF + per-client salt.
  cred_cipher              TEXT NOT NULL,
  cred_iv                  TEXT NOT NULL,
  cred_salt                TEXT NOT NULL,
  -- Last successful auto-pull (for status badge in cockpit).
  last_pull_at             TIMESTAMPTZ,
  last_pull_count          INT,
  last_pull_error          TEXT,
  status                   TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','paused','failed','revoked')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS client_dgii_creds_firm_idx
  ON public.client_dgii_credentials(firm_business_id, status);

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Tenant-scoped: only the contadora's firm can read her memberships + pulls.
-- All writes go through service role (anon revoked).
ALTER TABLE public.firm_memberships          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_received_ecfs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_dgii_credentials   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS firm_memberships_select ON public.firm_memberships;
CREATE POLICY firm_memberships_select ON public.firm_memberships
  FOR SELECT TO authenticated USING (firm_business_id IS NOT NULL);

DROP POLICY IF EXISTS client_received_ecfs_select ON public.client_received_ecfs;
CREATE POLICY client_received_ecfs_select ON public.client_received_ecfs
  FOR SELECT TO authenticated USING (firm_business_id IS NOT NULL);

DROP POLICY IF EXISTS client_received_ecfs_update ON public.client_received_ecfs;
CREATE POLICY client_received_ecfs_update ON public.client_received_ecfs
  FOR UPDATE TO authenticated USING (firm_business_id IS NOT NULL);

-- credentials: tenants can only INSERT/SELECT/UPDATE their own (no DELETE
-- via anon — service role only).
DROP POLICY IF EXISTS client_dgii_creds_select ON public.client_dgii_credentials;
CREATE POLICY client_dgii_creds_select ON public.client_dgii_credentials
  FOR SELECT TO authenticated USING (firm_business_id IS NOT NULL);

DROP POLICY IF EXISTS client_dgii_creds_insert ON public.client_dgii_credentials;
CREATE POLICY client_dgii_creds_insert ON public.client_dgii_credentials
  FOR INSERT TO authenticated WITH CHECK (firm_business_id IS NOT NULL);

DROP POLICY IF EXISTS client_dgii_creds_update ON public.client_dgii_credentials;
CREATE POLICY client_dgii_creds_update ON public.client_dgii_credentials
  FOR UPDATE TO authenticated USING (firm_business_id IS NOT NULL);
