-- Migration: License system, plans, admin users
-- Foundation for multi-client SaaS infrastructure

-- ── Plans ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL,
  price_monthly  NUMERIC(10,2) NOT NULL DEFAULT 0,
  price_yearly   NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_users      INT NOT NULL DEFAULT 3,
  features       JSONB NOT NULL DEFAULT '[]'::jsonb,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Licenses ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS licenses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  plan_id        UUID REFERENCES plans(id),
  license_key    TEXT UNIQUE,
  hardware_id    TEXT,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','pending','suspended','expired','cancelled')),
  platform       TEXT NOT NULL DEFAULT 'web'
                 CHECK (platform IN ('desktop','web','both')),
  activated_at   TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,
  last_seen      TIMESTAMPTZ,
  max_users      INT NOT NULL DEFAULT 3,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── License Events (audit log) ────────────────────────────────────────────────
-- Table may already exist from server code — add missing columns
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'license_events' AND table_schema = 'public') THEN
    CREATE TABLE license_events (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      license_id     UUID REFERENCES licenses(id) ON DELETE SET NULL,
      action         TEXT NOT NULL,
      status         TEXT,
      ip             TEXT,
      metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  ELSE
    -- Add columns that may be missing from the old server-created table
    BEGIN ALTER TABLE license_events ADD COLUMN license_id UUID REFERENCES licenses(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END;
    BEGIN ALTER TABLE license_events ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb; EXCEPTION WHEN duplicate_column THEN NULL; END;
  END IF;
END $$;

-- ── Admin Users ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  role           TEXT NOT NULL DEFAULT 'support'
                 CHECK (role IN ('super_admin','admin','support')),
  name           TEXT NOT NULL,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Add plan column to businesses ─────────────────────────────────────────────
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_licenses_business ON licenses(business_id);
CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key) WHERE license_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_licenses_plan ON licenses(plan_id);
CREATE INDEX IF NOT EXISTS idx_license_events_license ON license_events(license_id);
CREATE INDEX IF NOT EXISTS idx_license_events_date ON license_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_users_auth ON admin_users(auth_user_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Plans: readable by all authenticated users (public pricing)
CREATE POLICY "plans_select" ON plans FOR SELECT
  USING (true);

-- Licenses: clients can read their own, admin manages via service role
CREATE POLICY "licenses_select" ON licenses FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "licenses_update" ON licenses FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));

-- License events: insert-only for audit, no client reads (admin via service role)
CREATE POLICY "license_events_insert" ON license_events FOR INSERT
  WITH CHECK (true);

-- Admin users: no client access (admin panel uses service role key)
-- No SELECT/INSERT/UPDATE/DELETE policies = blocked for anon/authenticated
-- Admin API routes use service role which bypasses RLS

-- ── Seed Plans ────────────────────────────────────────────────────────────────
INSERT INTO plans (name, display_name, price_monthly, price_yearly, max_users, features) VALUES
  ('free',      'Free',     0,      0,      2,  '["pos","queue","clients"]'::jsonb),
  ('pro',       'Pro',      0,      0,      5,  '["pos","queue","clients","credits","reports","petty_cash","credit_notes","cash_recon"]'::jsonb),
  ('pro_plus',  'Pro+',     0,      0,      15, '["pos","queue","clients","credits","reports","petty_cash","credit_notes","cash_recon","ecf","dgii","inventory","commissions"]'::jsonb),
  ('pro_max',   'Pro Max',  0,      0,      999,'["pos","queue","clients","credits","reports","petty_cash","credit_notes","cash_recon","ecf","dgii","inventory","commissions","remote_dashboard","whatsapp_receipts","multi_location"]'::jsonb)
ON CONFLICT (name) DO NOTHING;
