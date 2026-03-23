-- ============================================================================
-- Terminal X POS — Upgrade Migration
-- Upgrades existing Supabase tables (businesses, tickets) and creates
-- all new tables needed for the web/PWA version.
--
-- Safe to run multiple times (uses IF NOT EXISTS / IF NOT EXISTS patterns).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ############################################################################
-- # UPGRADE EXISTING TABLES
-- ############################################################################

-- ── Upgrade businesses table ────────────────────────────────────────────────
-- Add columns that the new schema needs
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── Upgrade tickets table ───────────────────────────────────────────────────
-- The existing tickets table has a simplified schema for sync.
-- Add the columns the full POS needs.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_id UUID;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS washer_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cajero_id UUID;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS descuento NUMERIC(12,2) DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS itbis NUMERIC(12,2) DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ley NUMERIC(12,2) DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS comprobante_type TEXT DEFAULT 'B02';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ncf TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ecf_result JSONB DEFAULT '{}'::jsonb;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tipo_venta TEXT DEFAULT 'contado';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS void_by UUID;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS void_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS vehicle_plate TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS vehicle_color TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS vehicle_make TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS notes TEXT;

-- Drop old open policies that conflict with new RLS
DROP POLICY IF EXISTS "open insert" ON businesses;
DROP POLICY IF EXISTS "open select" ON businesses;
DROP POLICY IF EXISTS "open update" ON businesses;
DROP POLICY IF EXISTS "open insert" ON tickets;
DROP POLICY IF EXISTS "open select" ON tickets;


-- ############################################################################
-- # NEW TABLES (all use IF NOT EXISTS)
-- ############################################################################

-- ── Staff ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  auth_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL DEFAULT '',
  pin_hash      TEXT,
  role          TEXT NOT NULL DEFAULT 'cashier',
  discount_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
  seller_id     UUID,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Service Categories ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categorias_servicio (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  orden       INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Services ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  categoria_id  UUID,
  name          TEXT NOT NULL,
  name_en       TEXT,
  category      TEXT NOT NULL DEFAULT 'Lavado',
  price         NUMERIC(12,2) NOT NULL,
  aplica_itbis  BOOLEAN NOT NULL DEFAULT true,
  is_wash       BOOLEAN NOT NULL DEFAULT true,
  active        BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Washers ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS washers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  phone           TEXT,
  cedula          TEXT,
  commission_pct  NUMERIC(5,2) NOT NULL DEFAULT 20,
  start_date      DATE,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Sellers ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sellers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  phone           TEXT,
  commission_pct  NUMERIC(5,2) NOT NULL DEFAULT 5,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Clients ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  rnc           TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  credit_limit  NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance       NUMERIC(12,2) NOT NULL DEFAULT 0,
  visits        INT NOT NULL DEFAULT 0,
  total_spent   NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes         TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Ticket Items ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  service_id  UUID,
  name        TEXT NOT NULL,
  price       NUMERIC(12,2) NOT NULL,
  itbis       NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_wash     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Queue ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS queue (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ticket_id     UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'waiting',
  washer_id     UUID,
  assigned_at   TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── NCF Sequences ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ncf_sequences (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  prefix          TEXT NOT NULL,
  current_number  INT NOT NULL DEFAULT 0,
  limit_number    INT NOT NULL DEFAULT 500,
  valid_until     DATE,
  active          BOOLEAN NOT NULL DEFAULT true,
  enabled         BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── e-CF Offline Queue ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ecf_queue (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ticket_id   UUID REFERENCES tickets(id) ON DELETE SET NULL,
  url_path    TEXT NOT NULL DEFAULT '',
  body_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  token       TEXT NOT NULL DEFAULT '',
  attempts    INT NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_tried  TIMESTAMPTZ
);

-- ── Cuadre de Caja ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cuadre_caja (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  cajero_id         UUID,
  date              DATE NOT NULL,
  fondo             NUMERIC(12,2) NOT NULL DEFAULT 5000,
  efectivo_conteo   NUMERIC(12,2) NOT NULL DEFAULT 0,
  efectivo_sistema  NUMERIC(12,2) NOT NULL DEFAULT 0,
  tarjeta           NUMERIC(12,2) NOT NULL DEFAULT 0,
  transferencia     NUMERIC(12,2) NOT NULL DEFAULT 0,
  cheque            NUMERIC(12,2) NOT NULL DEFAULT 0,
  creditos          NUMERIC(12,2) NOT NULL DEFAULT 0,
  salidas           NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_vendido     NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cobrado     NUMERIC(12,2) NOT NULL DEFAULT 0,
  cierre_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
  diferencia        NUMERIC(12,2) NOT NULL DEFAULT 0,
  comentario        TEXT,
  denominaciones    JSONB DEFAULT '{}'::jsonb,
  closed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Caja Chica ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS caja_chica (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'Otros',
  type        TEXT NOT NULL DEFAULT 'Gasto',
  amount      NUMERIC(12,2) NOT NULL,
  recibo      TEXT,
  status      TEXT NOT NULL DEFAULT 'pendiente',
  approved_by UUID,
  cajero_id   UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Credit Payments ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL,
  ticket_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,
  amount          NUMERIC(12,2) NOT NULL,
  payment_method  TEXT NOT NULL DEFAULT 'cash',
  ncf             TEXT,
  notes           TEXT,
  cajero_id       UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Notas de Credito ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notas_credito (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ncf                 TEXT NOT NULL,
  client_id           UUID,
  original_ticket_id  UUID,
  motivo              TEXT NOT NULL DEFAULT 'Devolucion',
  amount              NUMERIC(12,2) NOT NULL,
  itbis_revertido     NUMERIC(12,2) NOT NULL DEFAULT 0,
  forma_devolucion    TEXT NOT NULL DEFAULT 'Efectivo',
  comentario          TEXT,
  cajero_id           UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Compras 607 ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compras_607 (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rnc_proveedor     TEXT NOT NULL DEFAULT '',
  nombre_proveedor  TEXT NOT NULL DEFAULT '',
  tipo_ncf          TEXT NOT NULL DEFAULT 'B01',
  ncf               TEXT NOT NULL DEFAULT '',
  ncf_modificado    TEXT DEFAULT '',
  fecha_ncf         DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_pago        DATE,
  monto_servicios   NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_bienes      NUMERIC(12,2) NOT NULL DEFAULT 0,
  total             NUMERIC(12,2) NOT NULL DEFAULT 0,
  itbis_facturado   NUMERIC(12,2) NOT NULL DEFAULT 0,
  itbis_retenido    NUMERIC(12,2) NOT NULL DEFAULT 0,
  retencion_renta   NUMERIC(12,2) NOT NULL DEFAULT 0,
  forma_pago        TEXT NOT NULL DEFAULT 'efectivo',
  notas             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── App Settings ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, key)
);

-- ── Inventory Items ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sku           TEXT,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT '',
  quantity      INT NOT NULL DEFAULT 0,
  min_quantity  INT NOT NULL DEFAULT 5,
  price         NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost          NUMERIC(12,2) NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Inventory Transactions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  item_id     UUID NOT NULL,
  type        TEXT NOT NULL,
  delta       INT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  user_id     UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── RNC Cache ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rnc_cache (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rnc               TEXT NOT NULL,
  nombre            TEXT NOT NULL DEFAULT '',
  nombre_comercial  TEXT DEFAULT '',
  estado            TEXT DEFAULT 'ACTIVO',
  source            TEXT NOT NULL DEFAULT 'api',
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, rnc)
);

-- ── Washer Commissions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS washer_commissions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  washer_id           UUID NOT NULL,
  ticket_id           UUID NOT NULL,
  base_amount         NUMERIC(12,2) NOT NULL,
  commission_pct      NUMERIC(5,2) NOT NULL,
  commission_amount   NUMERIC(12,2) NOT NULL,
  paid                BOOLEAN NOT NULL DEFAULT false,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ############################################################################
-- # INDEXES (IF NOT EXISTS via DO blocks)
-- ############################################################################

CREATE INDEX IF NOT EXISTS idx_businesses_owner ON businesses(owner_id);
CREATE INDEX IF NOT EXISTS idx_staff_business ON staff(business_id);
CREATE INDEX IF NOT EXISTS idx_services_business ON services(business_id);
CREATE INDEX IF NOT EXISTS idx_clients_business ON clients(business_id);
CREATE INDEX IF NOT EXISTS idx_tickets_business ON tickets(business_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_items_ticket ON ticket_items(ticket_id);
CREATE INDEX IF NOT EXISTS idx_queue_business ON queue(business_id);
CREATE INDEX IF NOT EXISTS idx_ncf_seq_business ON ncf_sequences(business_id);
CREATE INDEX IF NOT EXISTS idx_cuadre_business ON cuadre_caja(business_id);
CREATE INDEX IF NOT EXISTS idx_credit_payments_business ON credit_payments(business_id);
CREATE INDEX IF NOT EXISTS idx_app_settings_business ON app_settings(business_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_business ON inventory_items(business_id);
CREATE INDEX IF NOT EXISTS idx_rnc_cache_lookup ON rnc_cache(business_id, rnc);
CREATE INDEX IF NOT EXISTS idx_commissions_business ON washer_commissions(business_id);


-- ############################################################################
-- # HELPER FUNCTION: my_business_ids()
-- ############################################################################

CREATE OR REPLACE FUNCTION my_business_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id FROM businesses WHERE owner_id = auth.uid()
  UNION
  SELECT business_id FROM staff WHERE auth_user_id = auth.uid() AND active = true
$$;


-- ############################################################################
-- # ROW LEVEL SECURITY
-- ############################################################################

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias_servicio ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE washers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE ncf_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecf_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuadre_caja ENABLE ROW LEVEL SECURITY;
ALTER TABLE caja_chica ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notas_credito ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras_607 ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rnc_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE washer_commissions ENABLE ROW LEVEL SECURITY;


-- ############################################################################
-- # RLS POLICIES (DROP IF EXISTS + CREATE for idempotency)
-- ############################################################################

-- Helper macro: we use DO blocks to conditionally create policies

-- ── businesses ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "businesses_select" ON businesses;
DROP POLICY IF EXISTS "businesses_insert" ON businesses;
DROP POLICY IF EXISTS "businesses_update" ON businesses;
DROP POLICY IF EXISTS "businesses_delete" ON businesses;

CREATE POLICY "businesses_select" ON businesses FOR SELECT
  USING (id IN (SELECT my_business_ids()));
CREATE POLICY "businesses_insert" ON businesses FOR INSERT
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "businesses_update" ON businesses FOR UPDATE
  USING (owner_id = auth.uid());
CREATE POLICY "businesses_delete" ON businesses FOR DELETE
  USING (owner_id = auth.uid());

-- For all tenant tables, same pattern:
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'staff','categorias_servicio','services','washers','sellers','clients',
    'tickets','ticket_items','queue','ncf_sequences','ecf_queue',
    'cuadre_caja','caja_chica','credit_payments','notas_credito',
    'compras_607','app_settings','inventory_items','inventory_transactions',
    'rnc_cache','washer_commissions'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_sel', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_ins', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_upd', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_del', tbl);

    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (business_id IN (SELECT my_business_ids()))', tbl || '_sel', tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (business_id IN (SELECT my_business_ids()))', tbl || '_ins', tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (business_id IN (SELECT my_business_ids())) WITH CHECK (business_id IN (SELECT my_business_ids()))', tbl || '_upd', tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (business_id IN (SELECT my_business_ids()))', tbl || '_del', tbl);
  END LOOP;
END $$;


-- ############################################################################
-- # atomic_next_ncf() — collision-safe NCF increment
-- ############################################################################

CREATE OR REPLACE FUNCTION atomic_next_ncf(business_uuid UUID, ncf_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  seq RECORD;
  next_num INT;
BEGIN
  IF business_uuid NOT IN (SELECT my_business_ids()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT * INTO seq FROM ncf_sequences
  WHERE business_id = business_uuid AND type = ncf_type AND active = true AND enabled = true
  FOR UPDATE;

  IF NOT FOUND THEN RETURN NULL; END IF;

  next_num := seq.current_number + 1;
  IF next_num > seq.limit_number THEN
    RAISE EXCEPTION 'NCF sequence % reached limit', ncf_type;
  END IF;

  UPDATE ncf_sequences SET current_number = next_num WHERE id = seq.id;
  RETURN seq.prefix || lpad(next_num::text, 8, '0');
END;
$$;


-- ############################################################################
-- # updated_at trigger
-- ############################################################################

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_businesses_updated ON businesses;
CREATE TRIGGER trg_businesses_updated BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_staff_updated ON staff;
CREATE TRIGGER trg_staff_updated BEFORE UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_services_updated ON services;
CREATE TRIGGER trg_services_updated BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_clients_updated ON clients;
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_inventory_updated ON inventory_items;
CREATE TRIGGER trg_inventory_updated BEFORE UPDATE ON inventory_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_settings_updated ON app_settings;
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
