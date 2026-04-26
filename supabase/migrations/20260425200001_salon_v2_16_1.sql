-- Terminal X v2.16.1 — Barbería / Salón hardening (schema only)
-- Phase 2 of the v2.16.1 release. Adds memberships catalog (extends the
-- existing carwash `memberships` table additively — see DECISION below),
-- per-client membership balances, redemption audit trail, appointment
-- reminder queue, and salon-specific columns on `appointments` and
-- `clients`. Companion migration to electron/database.js parity block.
--
-- DECISION (memberships): the prior carwash-vertical `memberships` table
-- already exists with subscription columns (plan_name, wash_quota_per_month,
-- ...). The plan called for a salon "templates" table also named `memberships`.
-- Renaming would break carwash sync. Instead we EXTEND the table additively
-- with nullable salon columns (nombre, total_sessions, price_dop,
-- service_supabase_id, validity_days, active_template). Salon screens use
-- the new columns; carwash continues using the old. `active_template` is the
-- salon-only "active" flag because `active` would shadow carwash semantics —
-- carwash already encodes lifecycle via `status`.
--
-- app_settings keys (per-business opt-in; NOT seeded — businesses configure
-- via Settings → Salón when they enable the vertical):
--   salon_require_deposit         'true'|'false'
--   salon_deposit_amount_dop      '300'
--   salon_no_show_fee_dop         '500'
--   salon_public_booking_slug     'barberia-maritza'
--   salon_public_booking_enabled  'true'|'false'

-- =========================================================================
-- 1. memberships (templates) — additive extension of the existing table
-- =========================================================================
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS nombre              TEXT,
  ADD COLUMN IF NOT EXISTS service_supabase_id UUID,
  ADD COLUMN IF NOT EXISTS total_sessions      INTEGER,
  ADD COLUMN IF NOT EXISTS price_dop           NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS validity_days       INTEGER DEFAULT 365,
  ADD COLUMN IF NOT EXISTS active_template     BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS memberships_biz_supabase_idx
  ON memberships (business_id, supabase_id);

-- =========================================================================
-- 2. client_memberships — per-client balance ledger
-- =========================================================================
CREATE TABLE IF NOT EXISTS client_memberships (
  id                       BIGSERIAL PRIMARY KEY,
  supabase_id              UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id              UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_supabase_id       UUID NOT NULL,
  membership_supabase_id   UUID NOT NULL,
  sessions_remaining       INTEGER NOT NULL,
  purchased_at             TIMESTAMPTZ DEFAULT now(),
  expires_at               TIMESTAMPTZ NOT NULL,
  ticket_supabase_id       UUID,
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_memberships_biz_supabase_idx
  ON client_memberships (business_id, supabase_id);
CREATE INDEX IF NOT EXISTS client_memberships_client_expires_idx
  ON client_memberships (client_supabase_id, expires_at);

-- =========================================================================
-- 3. membership_redemptions — audit trail
-- =========================================================================
CREATE TABLE IF NOT EXISTS membership_redemptions (
  id                              BIGSERIAL PRIMARY KEY,
  supabase_id                     UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id                     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_membership_supabase_id   UUID NOT NULL,
  ticket_supabase_id              UUID NOT NULL,
  appointment_supabase_id         UUID,
  redeemed_at                     TIMESTAMPTZ DEFAULT now(),
  created_at                      TIMESTAMPTZ DEFAULT now(),
  updated_at                      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS membership_redemptions_biz_supabase_idx
  ON membership_redemptions (business_id, supabase_id);

-- =========================================================================
-- 4. appointment_reminders — 24h / 2h / manual / confirm queue
-- =========================================================================
CREATE TABLE IF NOT EXISTS appointment_reminders (
  id                          BIGSERIAL PRIMARY KEY,
  supabase_id                 UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  business_id                 UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  appointment_supabase_id     UUID NOT NULL,
  fire_at                     TIMESTAMPTZ NOT NULL,
  kind                        TEXT NOT NULL CHECK (kind IN ('24h','2h','manual','confirm')),
  status                      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  ultramsg_message_id         TEXT,
  error                       TEXT,
  sent_at                     TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ DEFAULT now(),
  updated_at                  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointment_reminders_biz_supabase_idx
  ON appointment_reminders (business_id, supabase_id);
CREATE INDEX IF NOT EXISTS appointment_reminders_dispatch_idx
  ON appointment_reminders (appointment_supabase_id, status, fire_at);

-- =========================================================================
-- 5. appointments — salon hardening columns
-- =========================================================================
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS is_walk_in                      BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_dop                     NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_status                  TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS no_show_fee_charged             BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_booking_token            TEXT,
  ADD COLUMN IF NOT EXISTS client_membership_supabase_id   UUID;

DO $$ BEGIN
  ALTER TABLE appointments ADD CONSTRAINT appointments_deposit_status_check
    CHECK (deposit_status IS NULL OR deposit_status IN ('none','held','applied','forfeited','refunded'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================================
-- 6. clients — no-show counters
-- =========================================================================
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS no_show_count    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_no_show_at  TIMESTAMPTZ;

-- =========================================================================
-- 7. BEFORE UPDATE triggers — mirror 20260421600000 pattern
-- =========================================================================
DO $$
DECLARE
  t text;
  targets text[] := ARRAY[
    'client_memberships',
    'membership_redemptions',
    'appointment_reminders'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=t AND column_name='updated_at'
    ) THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema='public' AND table_name=t AND table_type='BASE TABLE'
    ) THEN CONTINUE; END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_touch_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trg_touch_updated_at()', t, t);
  END LOOP;
END $$;

-- =========================================================================
-- 8. Anon RLS policies — mirror 20260421500000 pattern (business_id IS NOT NULL)
--    (memberships and appointments already covered by 20260421500000; this
--     block adds the three new tables.)
-- =========================================================================
DO $$
DECLARE
  t text;
  sync_tables text[] := ARRAY[
    'client_memberships',
    'membership_redemptions',
    'appointment_reminders'
  ];
BEGIN
  FOREACH t IN ARRAY sync_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='business_id') THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rls_anon_sync_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rls_anon_sync_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rls_anon_sync_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'rls_anon_sync_delete', t);

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon USING (business_id IS NOT NULL)', 'rls_anon_sync_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO anon WITH CHECK (business_id IS NOT NULL)', 'rls_anon_sync_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL)', 'rls_anon_sync_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO anon USING (business_id IS NOT NULL)', 'rls_anon_sync_delete', t);
  END LOOP;
END $$;
