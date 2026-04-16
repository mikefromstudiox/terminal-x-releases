-- ============================================================================
-- 20260416400000_sync_parity_phase2.sql
-- Phase 2 sync parity: adds ALL missing FK *_supabase_id columns, data
-- columns, and multi-vertical tables so desktop sync pushes don't silently
-- drop data. Every ALTER is idempotent (IF NOT EXISTS).
-- ============================================================================

-- ── Helper: reusable updated_at trigger function ─────────────────────────────
CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1: Missing FK *_supabase_id columns on EXISTING tables
-- Desktop sync pushes these; Supabase silently drops unknown columns.
-- ════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  -- tickets
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='client_supabase_id') THEN
    ALTER TABLE tickets ADD COLUMN client_supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='seller_supabase_id') THEN
    ALTER TABLE tickets ADD COLUMN seller_supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='cajero_supabase_id') THEN
    ALTER TABLE tickets ADD COLUMN cajero_supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='mesa_supabase_id') THEN
    ALTER TABLE tickets ADD COLUMN mesa_supabase_id UUID;
  END IF;

  -- tickets: dashboard display columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='services_json') THEN
    ALTER TABLE tickets ADD COLUMN services_json JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='cajero_name') THEN
    ALTER TABLE tickets ADD COLUMN cajero_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='client_name') THEN
    ALTER TABLE tickets ADD COLUMN client_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='paid_at') THEN
    ALTER TABLE tickets ADD COLUMN paid_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='beverage_subtotal') THEN
    ALTER TABLE tickets ADD COLUMN beverage_subtotal NUMERIC(12,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='tip_amount') THEN
    ALTER TABLE tickets ADD COLUMN tip_amount NUMERIC(12,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='fulfillment_type') THEN
    ALTER TABLE tickets ADD COLUMN fulfillment_type TEXT;
  END IF;

  -- ticket_items
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ticket_items' AND column_name='ticket_supabase_id') THEN
    ALTER TABLE ticket_items ADD COLUMN ticket_supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ticket_items' AND column_name='service_supabase_id') THEN
    ALTER TABLE ticket_items ADD COLUMN service_supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ticket_items' AND column_name='inventory_item_supabase_id') THEN
    ALTER TABLE ticket_items ADD COLUMN inventory_item_supabase_id UUID;
  END IF;

  -- queue
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='queue' AND column_name='ticket_supabase_id') THEN
    ALTER TABLE queue ADD COLUMN ticket_supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='queue' AND column_name='washer_supabase_id') THEN
    ALTER TABLE queue ADD COLUMN washer_supabase_id UUID;
  END IF;

  -- washer_commissions
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='washer_commissions' AND column_name='washer_supabase_id') THEN
    ALTER TABLE washer_commissions ADD COLUMN washer_supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='washer_commissions' AND column_name='ticket_supabase_id') THEN
    ALTER TABLE washer_commissions ADD COLUMN ticket_supabase_id UUID;
  END IF;

  -- seller_commissions
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='seller_commissions' AND column_name='seller_supabase_id') THEN
    ALTER TABLE seller_commissions ADD COLUMN seller_supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='seller_commissions' AND column_name='ticket_supabase_id') THEN
    ALTER TABLE seller_commissions ADD COLUMN ticket_supabase_id UUID;
  END IF;

  -- cajero_commissions
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cajero_commissions' AND column_name='cajero_supabase_id') THEN
    ALTER TABLE cajero_commissions ADD COLUMN cajero_supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cajero_commissions' AND column_name='ticket_supabase_id') THEN
    ALTER TABLE cajero_commissions ADD COLUMN ticket_supabase_id UUID;
  END IF;

  -- credit_payments
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='credit_payments' AND column_name='client_supabase_id') THEN
    ALTER TABLE credit_payments ADD COLUMN client_supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='credit_payments' AND column_name='cajero_supabase_id') THEN
    ALTER TABLE credit_payments ADD COLUMN cajero_supabase_id UUID;
  END IF;

  -- cuadre_caja
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cuadre_caja' AND column_name='cajero_supabase_id') THEN
    ALTER TABLE cuadre_caja ADD COLUMN cajero_supabase_id UUID;
  END IF;

  -- caja_chica
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='caja_chica' AND column_name='cajero_supabase_id') THEN
    ALTER TABLE caja_chica ADD COLUMN cajero_supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='caja_chica' AND column_name='approved_by_supabase_id') THEN
    ALTER TABLE caja_chica ADD COLUMN approved_by_supabase_id UUID;
  END IF;

  -- notas_credito
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notas_credito' AND column_name='client_supabase_id') THEN
    ALTER TABLE notas_credito ADD COLUMN client_supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notas_credito' AND column_name='cajero_supabase_id') THEN
    ALTER TABLE notas_credito ADD COLUMN cajero_supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notas_credito' AND column_name='original_ticket_supabase_id') THEN
    ALTER TABLE notas_credito ADD COLUMN original_ticket_supabase_id UUID;
  END IF;

  -- inventory_transactions
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_transactions' AND column_name='item_supabase_id') THEN
    ALTER TABLE inventory_transactions ADD COLUMN item_supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_transactions' AND column_name='user_supabase_id') THEN
    ALTER TABLE inventory_transactions ADD COLUMN user_supabase_id UUID;
  END IF;

  -- salary_changes: missing sync columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='salary_changes' AND column_name='empleado_supabase_id') THEN
    ALTER TABLE salary_changes ADD COLUMN empleado_supabase_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='salary_changes' AND column_name='active') THEN
    ALTER TABLE salary_changes ADD COLUMN active BOOLEAN DEFAULT true;
  END IF;

  -- staff: commission_pct for sync
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff' AND column_name='commission_pct') THEN
    ALTER TABLE staff ADD COLUMN commission_pct NUMERIC(5,2) DEFAULT 0;
  END IF;

  -- empleados: ref_id for washer/seller linkage
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='empleados' AND column_name='ref_id') THEN
    ALTER TABLE empleados ADD COLUMN ref_id INTEGER;
  END IF;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2: Missing data columns on EXISTING tables
-- ════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  -- services: commission flags, cost, menu/KDS columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='no_commission') THEN
    ALTER TABLE services ADD COLUMN no_commission BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='commission_washer') THEN
    ALTER TABLE services ADD COLUMN commission_washer BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='commission_seller') THEN
    ALTER TABLE services ADD COLUMN commission_seller BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='commission_cashier') THEN
    ALTER TABLE services ADD COLUMN commission_cashier BOOLEAN DEFAULT true;
  END IF;

  -- sellers: cedula + start_date
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sellers' AND column_name='cedula') THEN
    ALTER TABLE sellers ADD COLUMN cedula TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sellers' AND column_name='start_date') THEN
    ALTER TABLE sellers ADD COLUMN start_date DATE;
  END IF;

  -- inventory_items: barcode + aplica_itbis
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='barcode') THEN
    ALTER TABLE inventory_items ADD COLUMN barcode TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='aplica_itbis') THEN
    ALTER TABLE inventory_items ADD COLUMN aplica_itbis BOOLEAN DEFAULT true;
  END IF;

  -- categorias_servicio: active
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='categorias_servicio' AND column_name='active') THEN
    ALTER TABLE categorias_servicio ADD COLUMN active BOOLEAN DEFAULT true;
  END IF;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3: Multi-vertical tables (mechanic, salon, lending, dealership)
-- These 10 tables exist in SQLite but have NEVER been created in Supabase.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS vehicles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id           UUID,
  business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vin                   TEXT,
  plate                 TEXT,
  make                  TEXT,
  model                 TEXT,
  year                  INTEGER,
  color                 TEXT,
  mileage               INTEGER,
  client_id             UUID REFERENCES clients(id),
  client_supabase_id    UUID,
  notes                 TEXT,
  active                BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_vehicles_biz_sid UNIQUE (business_id, supabase_id)
);

CREATE TABLE IF NOT EXISTS service_bays (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id                     UUID,
  business_id                     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name                            TEXT NOT NULL,
  status                          TEXT DEFAULT 'libre',
  current_work_order_supabase_id  UUID,
  capacity                        INTEGER DEFAULT 1,
  bay_type                        TEXT,
  active                          BOOLEAN DEFAULT true,
  created_at                      TIMESTAMPTZ DEFAULT now(),
  updated_at                      TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_service_bays_biz_sid UNIQUE (business_id, supabase_id)
);

CREATE TABLE IF NOT EXISTS work_orders (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id                       UUID,
  business_id                       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vehicle_supabase_id               UUID,
  client_supabase_id                UUID,
  technician_empleado_supabase_id   UUID,
  bay_supabase_id                   UUID,
  status                            TEXT DEFAULT 'estimate',
  estimated_total                   NUMERIC(12,2) DEFAULT 0,
  actual_total                      NUMERIC(12,2) DEFAULT 0,
  promised_date                     TEXT,
  completed_date                    TEXT,
  notes                             TEXT,
  created_at                        TIMESTAMPTZ DEFAULT now(),
  updated_at                        TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_work_orders_biz_sid UNIQUE (business_id, supabase_id)
);

CREATE TABLE IF NOT EXISTS work_order_items (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id                 UUID,
  business_id                 UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  work_order_supabase_id      UUID,
  type                        TEXT DEFAULT 'labor',
  name                        TEXT NOT NULL,
  description                 TEXT,
  quantity                    NUMERIC(10,2) DEFAULT 1,
  unit_price                  NUMERIC(12,2) DEFAULT 0,
  total                       NUMERIC(12,2) DEFAULT 0,
  warranty_months             INTEGER DEFAULT 0,
  inventory_item_supabase_id  UUID,
  created_at                  TIMESTAMPTZ DEFAULT now(),
  updated_at                  TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_work_order_items_biz_sid UNIQUE (business_id, supabase_id)
);

CREATE TABLE IF NOT EXISTS appointments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id           UUID,
  business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_supabase_id    UUID,
  empleado_supabase_id  UUID,
  date                  TEXT NOT NULL,
  start_time            TEXT NOT NULL,
  end_time              TEXT,
  status                TEXT DEFAULT 'scheduled',
  services              JSONB DEFAULT '[]',
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_appointments_biz_sid UNIQUE (business_id, supabase_id)
);

CREATE TABLE IF NOT EXISTS stylist_schedules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id           UUID,
  business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  empleado_supabase_id  UUID,
  day_of_week           INTEGER NOT NULL,
  start_time            TEXT NOT NULL,
  end_time              TEXT NOT NULL,
  active                BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_stylist_schedules_biz_sid UNIQUE (business_id, supabase_id)
);

CREATE TABLE IF NOT EXISTS loans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id         UUID,
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_supabase_id  UUID,
  principal           NUMERIC(12,2) NOT NULL,
  term_months         INTEGER NOT NULL,
  interest_rate       NUMERIC(6,4) NOT NULL,
  monthly_payment     NUMERIC(12,2) DEFAULT 0,
  status              TEXT DEFAULT 'active',
  disbursed_at        TIMESTAMPTZ,
  next_due_date       TEXT,
  total_paid          NUMERIC(12,2) DEFAULT 0,
  total_interest      NUMERIC(12,2) DEFAULT 0,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_loans_biz_sid UNIQUE (business_id, supabase_id)
);

CREATE TABLE IF NOT EXISTS loan_payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id         UUID,
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  loan_supabase_id    UUID,
  amount              NUMERIC(12,2) NOT NULL,
  principal_portion   NUMERIC(12,2) DEFAULT 0,
  interest_portion    NUMERIC(12,2) DEFAULT 0,
  late_fee            NUMERIC(12,2) DEFAULT 0,
  payment_date        TEXT DEFAULT CURRENT_DATE,
  due_date            TEXT,
  status              TEXT DEFAULT 'on_time',
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_loan_payments_biz_sid UNIQUE (business_id, supabase_id)
);

CREATE TABLE IF NOT EXISTS pawn_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_id         UUID,
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_supabase_id  UUID,
  loan_supabase_id    UUID,
  description         TEXT NOT NULL,
  estimated_value     NUMERIC(12,2) DEFAULT 0,
  storage_location    TEXT,
  status              TEXT DEFAULT 'held',
  redeem_deadline     TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_pawn_items_biz_sid UNIQUE (business_id, supabase_id)
);


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 4: RLS + triggers for all new tables
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'vehicles','service_bays','work_orders','work_order_items',
    'appointments','stylist_schedules','loans','loan_payments','pawn_items'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=tbl AND policyname=tbl || '_anon_all') THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL TO anon USING (business_id IS NOT NULL) WITH CHECK (business_id IS NOT NULL)',
        tbl || '_anon_all', tbl
      );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_' || tbl || '_updated_at') THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at()',
        'trg_' || tbl || '_updated_at', tbl
      );
    END IF;
  END LOOP;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 5: Recreate users VIEW to include new staff columns
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW users AS SELECT * FROM staff;

CREATE OR REPLACE RULE users_insert AS ON INSERT TO users
  DO INSTEAD INSERT INTO staff VALUES (NEW.*) RETURNING *;

CREATE OR REPLACE RULE users_update AS ON UPDATE TO users
  DO INSTEAD UPDATE staff SET
    business_id    = NEW.business_id,
    auth_user_id   = NEW.auth_user_id,
    name           = NEW.name,
    username       = NEW.username,
    pin_hash       = NEW.pin_hash,
    role           = NEW.role,
    discount_pct   = NEW.discount_pct,
    commission_pct = NEW.commission_pct,
    seller_id      = NEW.seller_id,
    active         = NEW.active,
    supabase_id    = NEW.supabase_id,
    cedula         = NEW.cedula,
    start_date     = NEW.start_date,
    employee_id    = NEW.employee_id,
    created_at     = NEW.created_at,
    updated_at     = NEW.updated_at
  WHERE staff.id = OLD.id RETURNING *;

CREATE OR REPLACE RULE users_delete AS ON DELETE TO users
  DO INSTEAD DELETE FROM staff WHERE staff.id = OLD.id;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 6: Storage bucket policy for logo uploads (anon key)
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public)
VALUES ('business-logos', 'business-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anon to upload/read logos (desktop uses anon key for sync)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='business_logos_anon_insert') THEN
    CREATE POLICY business_logos_anon_insert ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'business-logos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='business_logos_anon_select') THEN
    CREATE POLICY business_logos_anon_select ON storage.objects FOR SELECT TO anon USING (bucket_id = 'business-logos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='business_logos_anon_update') THEN
    CREATE POLICY business_logos_anon_update ON storage.objects FOR UPDATE TO anon USING (bucket_id = 'business-logos');
  END IF;
END $$;
