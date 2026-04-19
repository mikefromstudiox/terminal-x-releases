-- ============================================================================
-- Terminal X POS — Supabase PostgreSQL Migration (001_initial)
-- Complete multi-tenant schema for the web version.
--
-- Mirrors the SQLite schema from electron/database.js + db/schema.sql
-- with UUID primary keys, business_id tenant isolation, and RLS policies.
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ############################################################################
-- # TABLES
-- ############################################################################

-- ── Businesses (tenant root) ────────────────────────────────────────────────
-- Each business is owned by a Supabase Auth user.
-- All other tables reference business_id for multi-tenant isolation.
CREATE TABLE businesses (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  rnc         TEXT DEFAULT '',                   -- Dominican RNC tax ID
  address     TEXT DEFAULT '',
  phone       TEXT DEFAULT '',
  email       TEXT DEFAULT '',
  logo_url    TEXT,                               -- URL to logo in Supabase Storage
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb, -- itbis_pct, ley_pct, usd_rate, language, facturacion_mode, etc.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE businesses IS 'Tenant root table. Every other table has a business_id FK pointing here.';
COMMENT ON COLUMN businesses.settings IS 'JSON: itbis_pct, ley_pct, usd_rate, language, facturacion_mode, ley_enabled, printer, etc.';


-- ── Staff (replaces SQLite users table) ─────────────────────────────────────
-- Staff members belong to a business. They may optionally be linked to a
-- Supabase Auth account (for web login) via auth_user_id.
-- PIN-based auth is for the local POS terminal; password/auth is for web.
CREATE TABLE staff (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  auth_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- optional Supabase Auth link
  name          TEXT NOT NULL,
  username      TEXT NOT NULL,
  pin_hash      TEXT,                             -- SHA-256 of numeric PIN
  role          TEXT NOT NULL DEFAULT 'cashier'
                CHECK (role IN ('owner','manager','cfo','accountant','cashier')),
  discount_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
  seller_id     UUID,                             -- linked seller for commission tracking (FK added after sellers table)
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, username)
);

COMMENT ON TABLE staff IS 'POS users/employees. Replaces the SQLite users table. auth_user_id links to Supabase Auth for web access.';


-- ── Service Categories ──────────────────────────────────────────────────────
CREATE TABLE categorias_servicio (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  orden       INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, nombre)
);

COMMENT ON TABLE categorias_servicio IS 'User-defined service categories (e.g. Lavado, Detallado, Adicionales, Bebidas).';


-- ── Services ────────────────────────────────────────────────────────────────
CREATE TABLE services (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  categoria_id  UUID REFERENCES categorias_servicio(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  name_en       TEXT,                             -- English translation for bilingual UI
  category      TEXT NOT NULL DEFAULT 'General',  -- legacy text category; vertical-agnostic default
  price         NUMERIC(12,2) NOT NULL,
  aplica_itbis  BOOLEAN NOT NULL DEFAULT true,    -- true = ITBIS applies, false = exempt
  is_wash       BOOLEAN NOT NULL DEFAULT true,    -- false = beverage/snack, excluded from washer commission
  active        BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE services IS 'Products and services offered by the business. is_wash=false excludes from washer commission calc.';


-- ── Washers ─────────────────────────────────────────────────────────────────
CREATE TABLE washers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  phone           TEXT,
  cedula          TEXT,                           -- Dominican national ID
  commission_pct  NUMERIC(5,2) NOT NULL DEFAULT 20,
  start_date      DATE,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── Sellers ─────────────────────────────────────────────────────────────────
CREATE TABLE sellers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  phone           TEXT,
  commission_pct  NUMERIC(5,2) NOT NULL DEFAULT 5,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Now add the deferred FK from staff.seller_id → sellers.id
ALTER TABLE staff
  ADD CONSTRAINT fk_staff_seller
  FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE SET NULL;


-- ── Clients ─────────────────────────────────────────────────────────────────
CREATE TABLE clients (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  rnc           TEXT,                             -- client RNC for tax credit invoices
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  credit_limit  NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance       NUMERIC(12,2) NOT NULL DEFAULT 0, -- amount currently owed
  visits        INT NOT NULL DEFAULT 0,
  total_spent   NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes         TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── Tickets (invoices/receipts) ─────────────────────────────────────────────
CREATE TABLE tickets (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  doc_number        TEXT NOT NULL,                -- sequential document number (T-0001, T-0002, ...)
  client_id         UUID REFERENCES clients(id) ON DELETE SET NULL,
  washer_ids        JSONB DEFAULT '[]'::jsonb,    -- array of washer UUIDs
  seller_id         UUID REFERENCES sellers(id) ON DELETE SET NULL,
  cajero_id         UUID REFERENCES staff(id) ON DELETE SET NULL,
  subtotal          NUMERIC(12,2) NOT NULL DEFAULT 0,
  descuento         NUMERIC(12,2) NOT NULL DEFAULT 0,
  itbis             NUMERIC(12,2) NOT NULL DEFAULT 0,
  ley               NUMERIC(12,2) NOT NULL DEFAULT 0,
  total             NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method    TEXT NOT NULL DEFAULT 'cash'
                    CHECK (payment_method IN ('cash','card','transfer','cheque','credit')),
  comprobante_type  TEXT NOT NULL DEFAULT 'B02',  -- B01|B02|E31|E32|E33|E34|...
  ncf               TEXT,                         -- fiscal receipt number
  ecf_result        JSONB DEFAULT '{}'::jsonb,    -- e-CF response: eNCF, status, trackId, qrUrl
  tipo_venta        TEXT NOT NULL DEFAULT 'contado'
                    CHECK (tipo_venta IN ('contado','credito')),
  status            TEXT NOT NULL DEFAULT 'cobrado'
                    CHECK (status IN ('cobrado','pendiente','nula')),
  void_reason       TEXT,
  void_by           UUID REFERENCES staff(id) ON DELETE SET NULL,
  void_at           TIMESTAMPTZ,
  vehicle_plate     TEXT,
  vehicle_color     TEXT,
  vehicle_make      TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, doc_number)
);

COMMENT ON TABLE tickets IS 'Sales transactions. status: cobrado=paid, pendiente=credit pending, nula=voided.';


-- ── Ticket Items (line items) ───────────────────────────────────────────────
CREATE TABLE ticket_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  service_id  UUID REFERENCES services(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  price       NUMERIC(12,2) NOT NULL,
  itbis       NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_wash     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── Queue (wash queue / work orders) ────────────────────────────────────────
CREATE TABLE queue (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ticket_id     UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting','in_progress','done')),
  washer_id     UUID REFERENCES washers(id) ON DELETE SET NULL,
  assigned_at   TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── NCF Sequences (fiscal receipt numbering) ────────────────────────────────
-- Each business maintains independent NCF sequences per comprobante type.
CREATE TABLE ncf_sequences (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,                  -- E31|E32|E33|E34|E41|E43|E44|E45|E46|E47|B01|B02
  prefix          TEXT NOT NULL,                  -- E310, E320, B01, B02, etc.
  current_number  INT NOT NULL DEFAULT 0,
  limit_number    INT NOT NULL DEFAULT 500,
  valid_until     DATE,
  active          BOOLEAN NOT NULL DEFAULT true,
  enabled         BOOLEAN NOT NULL DEFAULT false, -- user enables per business
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, type)
);

COMMENT ON TABLE ncf_sequences IS 'Fiscal receipt number sequences. B01/B02 are legacy paper NCF. E31+ are e-CF (electronic, mandatory from May 2026).';


-- ── e-CF Offline Queue ──────────────────────────────────────────────────────
-- Stores failed e-CF submissions for auto-retry (DGII 72h contingency window).
CREATE TABLE ecf_queue (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ticket_id   UUID REFERENCES tickets(id) ON DELETE SET NULL,
  url_path    TEXT NOT NULL,
  body_json   JSONB NOT NULL,
  token       TEXT NOT NULL DEFAULT '',
  attempts    INT NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_tried  TIMESTAMPTZ
);

COMMENT ON TABLE ecf_queue IS 'Offline e-CF submission queue. Failed submissions are retried automatically within DGII 72h contingency window.';


-- ── Cuadre de Caja (cash register reconciliation) ──────────────────────────
CREATE TABLE cuadre_caja (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  cajero_id         UUID REFERENCES staff(id) ON DELETE SET NULL,
  date              DATE NOT NULL,
  fondo             NUMERIC(12,2) NOT NULL DEFAULT 5000,
  efectivo_conteo   NUMERIC(12,2) NOT NULL DEFAULT 0,  -- physical cash count
  efectivo_sistema  NUMERIC(12,2) NOT NULL DEFAULT 0,  -- system-calculated cash
  tarjeta           NUMERIC(12,2) NOT NULL DEFAULT 0,
  transferencia     NUMERIC(12,2) NOT NULL DEFAULT 0,
  cheque            NUMERIC(12,2) NOT NULL DEFAULT 0,
  creditos          NUMERIC(12,2) NOT NULL DEFAULT 0,
  salidas           NUMERIC(12,2) NOT NULL DEFAULT 0,  -- petty cash withdrawals
  total_vendido     NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cobrado     NUMERIC(12,2) NOT NULL DEFAULT 0,
  cierre_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
  diferencia        NUMERIC(12,2) NOT NULL DEFAULT 0,
  comentario        TEXT,
  denominaciones    JSONB DEFAULT '{}'::jsonb,          -- bill/coin denomination breakdown
  closed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE cuadre_caja IS 'End-of-day cash register reconciliation records.';


-- ── Caja Chica (petty cash) ─────────────────────────────────────────────────
CREATE TABLE caja_chica (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'Otros',
  type        TEXT NOT NULL DEFAULT 'Gasto'
              CHECK (type IN ('Gasto','Compra')),
  amount      NUMERIC(12,2) NOT NULL,
  recibo      TEXT,                               -- receipt reference number
  status      TEXT NOT NULL DEFAULT 'pendiente'
              CHECK (status IN ('pendiente','aprobado','rechazado')),
  approved_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  cajero_id   UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── Credit Payments ─────────────────────────────────────────────────────────
CREATE TABLE credit_payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  ticket_ids      JSONB NOT NULL DEFAULT '[]'::jsonb, -- array of ticket UUIDs being paid
  amount          NUMERIC(12,2) NOT NULL,
  payment_method  TEXT NOT NULL DEFAULT 'cash'
                  CHECK (payment_method IN ('cash','card','transfer','cheque')),
  ncf             TEXT,
  notes           TEXT,
  cajero_id       UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE credit_payments IS 'Records of credit account payments. Each payment can cover one or more pending tickets.';


-- ── Notas de Credito (credit notes / refunds) ──────────────────────────────
CREATE TABLE notas_credito (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ncf                 TEXT NOT NULL,              -- credit note NCF (E34 for e-CF)
  client_id           UUID REFERENCES clients(id) ON DELETE SET NULL,
  original_ticket_id  UUID REFERENCES tickets(id) ON DELETE SET NULL,
  motivo              TEXT NOT NULL DEFAULT 'Devolucion',
  amount              NUMERIC(12,2) NOT NULL,
  itbis_revertido     NUMERIC(12,2) NOT NULL DEFAULT 0,
  forma_devolucion    TEXT NOT NULL DEFAULT 'Efectivo',
  comentario          TEXT,
  cajero_id           UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── Compras 607 (purchase/expense records for DGII 607 report) ──────────────
CREATE TABLE compras_607 (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rnc_proveedor     TEXT NOT NULL DEFAULT '',
  nombre_proveedor  TEXT NOT NULL DEFAULT '',
  tipo_ncf          TEXT NOT NULL DEFAULT 'B01',
  ncf               TEXT NOT NULL DEFAULT '',
  ncf_modificado    TEXT DEFAULT '',
  fecha_ncf         DATE NOT NULL,
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

COMMENT ON TABLE compras_607 IS 'Supplier purchases/expenses for DGII format 607 report.';


-- ── App Settings (per-business key-value config) ────────────────────────────
CREATE TABLE app_settings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, key)
);


-- ── Inventory Items ─────────────────────────────────────────────────────────
CREATE TABLE inventory_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sku           TEXT,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT '',
  quantity      INT NOT NULL DEFAULT 0,
  min_quantity  INT NOT NULL DEFAULT 5,           -- reorder alert threshold
  price         NUMERIC(12,2) NOT NULL DEFAULT 0, -- selling price
  cost          NUMERIC(12,2) NOT NULL DEFAULT 0, -- purchase cost
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, sku)
);


-- ── Inventory Transactions ──────────────────────────────────────────────────
CREATE TABLE inventory_transactions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  item_id     UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                      -- 'in', 'out', 'adjustment', 'sale'
  delta       INT NOT NULL,                       -- positive = stock in, negative = stock out
  notes       TEXT NOT NULL DEFAULT '',
  user_id     UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── RNC Cache (DGII taxpayer directory cache) ───────────────────────────────
-- Web version caches RNC lookups per-business to avoid repeated API calls.
CREATE TABLE rnc_cache (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rnc               TEXT NOT NULL,
  nombre            TEXT NOT NULL DEFAULT '',
  nombre_comercial  TEXT DEFAULT '',
  actividad         TEXT DEFAULT '',
  estado            TEXT DEFAULT 'ACTIVO',
  regimen           TEXT DEFAULT 'NORMAL',
  provincia         TEXT DEFAULT '',
  source            TEXT NOT NULL DEFAULT 'api',  -- 'api' or 'dgii_sync'
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, rnc)
);

COMMENT ON TABLE rnc_cache IS 'Cached DGII RNC taxpayer lookups. Replaces the full rnc_contribuyentes SQLite table with a per-business cache.';


-- ── Washer Commissions ──────────────────────────────────────────────────────
CREATE TABLE washer_commissions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  washer_id           UUID NOT NULL REFERENCES washers(id) ON DELETE CASCADE,
  ticket_id           UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  base_amount         NUMERIC(12,2) NOT NULL,     -- commission base (subtotal minus beverages)
  commission_pct      NUMERIC(5,2) NOT NULL,
  commission_amount   NUMERIC(12,2) NOT NULL,
  paid                BOOLEAN NOT NULL DEFAULT false,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ############################################################################
-- # INDEXES
-- ############################################################################

-- businesses
CREATE INDEX idx_businesses_owner ON businesses(owner_id);

-- staff
CREATE INDEX idx_staff_business ON staff(business_id);
CREATE INDEX idx_staff_auth_user ON staff(auth_user_id) WHERE auth_user_id IS NOT NULL;

-- services
CREATE INDEX idx_services_business ON services(business_id);
CREATE INDEX idx_services_category ON services(business_id, category);

-- categorias_servicio
CREATE INDEX idx_categorias_business ON categorias_servicio(business_id);

-- washers
CREATE INDEX idx_washers_business ON washers(business_id);

-- sellers
CREATE INDEX idx_sellers_business ON sellers(business_id);

-- clients
CREATE INDEX idx_clients_business ON clients(business_id);
CREATE INDEX idx_clients_rnc ON clients(business_id, rnc) WHERE rnc IS NOT NULL AND rnc != '';

-- tickets
CREATE INDEX idx_tickets_business ON tickets(business_id);
CREATE INDEX idx_tickets_created ON tickets(business_id, created_at DESC);
CREATE INDEX idx_tickets_status ON tickets(business_id, status);
CREATE INDEX idx_tickets_doc ON tickets(business_id, doc_number);
CREATE INDEX idx_tickets_client ON tickets(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_tickets_cajero ON tickets(cajero_id) WHERE cajero_id IS NOT NULL;
CREATE INDEX idx_tickets_ncf ON tickets(business_id, ncf) WHERE ncf IS NOT NULL;

-- ticket_items
CREATE INDEX idx_ticket_items_ticket ON ticket_items(ticket_id);
CREATE INDEX idx_ticket_items_business ON ticket_items(business_id);

-- queue
CREATE INDEX idx_queue_business ON queue(business_id);
CREATE INDEX idx_queue_status ON queue(business_id, status);
CREATE INDEX idx_queue_washer ON queue(washer_id) WHERE washer_id IS NOT NULL;

-- ncf_sequences
CREATE INDEX idx_ncf_seq_business ON ncf_sequences(business_id);

-- ecf_queue
CREATE INDEX idx_ecf_queue_business ON ecf_queue(business_id);
CREATE INDEX idx_ecf_queue_pending ON ecf_queue(business_id, attempts) WHERE attempts < 10;

-- cuadre_caja
CREATE INDEX idx_cuadre_business ON cuadre_caja(business_id);
CREATE INDEX idx_cuadre_date ON cuadre_caja(business_id, date DESC);

-- caja_chica
CREATE INDEX idx_caja_chica_business ON caja_chica(business_id);
CREATE INDEX idx_caja_chica_status ON caja_chica(business_id, status);

-- credit_payments
CREATE INDEX idx_credit_payments_business ON credit_payments(business_id);
CREATE INDEX idx_credit_payments_client ON credit_payments(client_id);
CREATE INDEX idx_credit_payments_date ON credit_payments(business_id, created_at DESC);

-- notas_credito
CREATE INDEX idx_notas_credito_business ON notas_credito(business_id);

-- compras_607
CREATE INDEX idx_compras_607_business ON compras_607(business_id);
CREATE INDEX idx_compras_607_fecha ON compras_607(business_id, fecha_ncf);

-- app_settings
CREATE INDEX idx_app_settings_business ON app_settings(business_id);

-- inventory_items
CREATE INDEX idx_inventory_items_business ON inventory_items(business_id);

-- inventory_transactions
CREATE INDEX idx_inv_tx_business ON inventory_transactions(business_id);
CREATE INDEX idx_inv_tx_item ON inventory_transactions(item_id);

-- rnc_cache
CREATE INDEX idx_rnc_cache_business ON rnc_cache(business_id);
CREATE INDEX idx_rnc_cache_lookup ON rnc_cache(business_id, rnc);

-- washer_commissions
CREATE INDEX idx_commissions_business ON washer_commissions(business_id);
CREATE INDEX idx_commissions_washer ON washer_commissions(washer_id);
CREATE INDEX idx_commissions_ticket ON washer_commissions(ticket_id);
CREATE INDEX idx_commissions_paid ON washer_commissions(business_id, paid) WHERE paid = false;
CREATE INDEX idx_commissions_date ON washer_commissions(business_id, created_at DESC);


-- ############################################################################
-- # HELPER FUNCTION: my_business_ids()
-- ############################################################################
-- Returns all business IDs the current authenticated user can access,
-- either as the business owner or as a staff member with an auth link.

CREATE OR REPLACE FUNCTION my_business_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM businesses WHERE owner_id = auth.uid()
  UNION
  SELECT business_id FROM staff WHERE auth_user_id = auth.uid() AND active = true
$$;

COMMENT ON FUNCTION my_business_ids() IS 'Returns business UUIDs accessible to the current auth user (as owner or active staff member).';


-- ############################################################################
-- # ROW LEVEL SECURITY — Enable on ALL tables
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
-- # RLS POLICIES
-- ############################################################################

-- ── businesses ──────────────────────────────────────────────────────────────
-- Owners can see/edit their own businesses. Staff can see businesses they belong to.

CREATE POLICY "businesses_select" ON businesses FOR SELECT
  USING (id IN (SELECT my_business_ids()));

CREATE POLICY "businesses_insert" ON businesses FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "businesses_update" ON businesses FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "businesses_delete" ON businesses FOR DELETE
  USING (owner_id = auth.uid());


-- ── Generic tenant-scoped policies ──────────────────────────────────────────
-- All remaining tables use the same pattern: business_id IN (SELECT my_business_ids())

-- Helper: macro-like DO block to create policies for each table
-- (PostgreSQL doesn't have policy templates, so we create them individually.)

-- staff
CREATE POLICY "staff_select" ON staff FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "staff_insert" ON staff FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "staff_update" ON staff FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "staff_delete" ON staff FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- categorias_servicio
CREATE POLICY "categorias_select" ON categorias_servicio FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "categorias_insert" ON categorias_servicio FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "categorias_update" ON categorias_servicio FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "categorias_delete" ON categorias_servicio FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- services
CREATE POLICY "services_select" ON services FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "services_insert" ON services FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "services_update" ON services FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "services_delete" ON services FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- washers
CREATE POLICY "washers_select" ON washers FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "washers_insert" ON washers FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "washers_update" ON washers FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "washers_delete" ON washers FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- sellers
CREATE POLICY "sellers_select" ON sellers FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "sellers_insert" ON sellers FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "sellers_update" ON sellers FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "sellers_delete" ON sellers FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- clients
CREATE POLICY "clients_select" ON clients FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "clients_insert" ON clients FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "clients_update" ON clients FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "clients_delete" ON clients FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- tickets
CREATE POLICY "tickets_select" ON tickets FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "tickets_insert" ON tickets FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "tickets_update" ON tickets FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "tickets_delete" ON tickets FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- ticket_items
CREATE POLICY "ticket_items_select" ON ticket_items FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "ticket_items_insert" ON ticket_items FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "ticket_items_update" ON ticket_items FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "ticket_items_delete" ON ticket_items FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- queue
CREATE POLICY "queue_select" ON queue FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "queue_insert" ON queue FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "queue_update" ON queue FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "queue_delete" ON queue FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- ncf_sequences
CREATE POLICY "ncf_sequences_select" ON ncf_sequences FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "ncf_sequences_insert" ON ncf_sequences FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "ncf_sequences_update" ON ncf_sequences FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "ncf_sequences_delete" ON ncf_sequences FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- ecf_queue
CREATE POLICY "ecf_queue_select" ON ecf_queue FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "ecf_queue_insert" ON ecf_queue FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "ecf_queue_update" ON ecf_queue FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "ecf_queue_delete" ON ecf_queue FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- cuadre_caja
CREATE POLICY "cuadre_caja_select" ON cuadre_caja FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "cuadre_caja_insert" ON cuadre_caja FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "cuadre_caja_update" ON cuadre_caja FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "cuadre_caja_delete" ON cuadre_caja FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- caja_chica
CREATE POLICY "caja_chica_select" ON caja_chica FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "caja_chica_insert" ON caja_chica FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "caja_chica_update" ON caja_chica FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "caja_chica_delete" ON caja_chica FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- credit_payments
CREATE POLICY "credit_payments_select" ON credit_payments FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "credit_payments_insert" ON credit_payments FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "credit_payments_update" ON credit_payments FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "credit_payments_delete" ON credit_payments FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- notas_credito
CREATE POLICY "notas_credito_select" ON notas_credito FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "notas_credito_insert" ON notas_credito FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "notas_credito_update" ON notas_credito FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "notas_credito_delete" ON notas_credito FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- compras_607
CREATE POLICY "compras_607_select" ON compras_607 FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "compras_607_insert" ON compras_607 FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "compras_607_update" ON compras_607 FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "compras_607_delete" ON compras_607 FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- app_settings
CREATE POLICY "app_settings_select" ON app_settings FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "app_settings_insert" ON app_settings FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "app_settings_update" ON app_settings FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "app_settings_delete" ON app_settings FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- inventory_items
CREATE POLICY "inventory_items_select" ON inventory_items FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "inventory_items_insert" ON inventory_items FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "inventory_items_update" ON inventory_items FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "inventory_items_delete" ON inventory_items FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- inventory_transactions
CREATE POLICY "inv_tx_select" ON inventory_transactions FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "inv_tx_insert" ON inventory_transactions FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "inv_tx_update" ON inventory_transactions FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "inv_tx_delete" ON inventory_transactions FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- rnc_cache
CREATE POLICY "rnc_cache_select" ON rnc_cache FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "rnc_cache_insert" ON rnc_cache FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "rnc_cache_update" ON rnc_cache FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "rnc_cache_delete" ON rnc_cache FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));

-- washer_commissions
CREATE POLICY "commissions_select" ON washer_commissions FOR SELECT
  USING (business_id IN (SELECT my_business_ids()));
CREATE POLICY "commissions_insert" ON washer_commissions FOR INSERT
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "commissions_update" ON washer_commissions FOR UPDATE
  USING (business_id IN (SELECT my_business_ids()))
  WITH CHECK (business_id IN (SELECT my_business_ids()));
CREATE POLICY "commissions_delete" ON washer_commissions FOR DELETE
  USING (business_id IN (SELECT my_business_ids()));


-- ############################################################################
-- # RPC: atomic_next_ncf() — collision-safe NCF sequence increment
-- ############################################################################
-- Atomically increments the NCF sequence for a given business and type,
-- returning the formatted NCF string. Uses row-level locking (FOR UPDATE)
-- to prevent race conditions when multiple devices create tickets simultaneously.
--
-- Usage from client:
--   const { data } = await supabase.rpc('atomic_next_ncf', {
--     business_uuid: '...', ncf_type: 'B02'
--   });
--   // data => 'B0200000001'
--
-- Returns NULL if the sequence type is not found, inactive, or disabled.
-- Raises an exception if the sequence has reached its limit.

CREATE OR REPLACE FUNCTION atomic_next_ncf(
  business_uuid UUID,
  ncf_type TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  seq RECORD;
  next_num INT;
  ncf_string TEXT;
BEGIN
  -- Verify the caller has access to this business
  IF business_uuid NOT IN (SELECT my_business_ids()) THEN
    RAISE EXCEPTION 'Access denied to business %', business_uuid;
  END IF;

  -- Lock the row to prevent concurrent increments
  SELECT * INTO seq
  FROM ncf_sequences
  WHERE business_id = business_uuid
    AND type = ncf_type
    AND active = true
    AND enabled = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Check limit
  next_num := seq.current_number + 1;
  IF next_num > seq.limit_number THEN
    RAISE EXCEPTION 'NCF sequence % has reached its limit (%) for business %',
      ncf_type, seq.limit_number, business_uuid;
  END IF;

  -- Check validity date
  IF seq.valid_until IS NOT NULL AND seq.valid_until < CURRENT_DATE THEN
    RAISE EXCEPTION 'NCF sequence % has expired (valid until %) for business %',
      ncf_type, seq.valid_until, business_uuid;
  END IF;

  -- Increment
  UPDATE ncf_sequences
  SET current_number = next_num
  WHERE id = seq.id;

  -- Format: prefix + zero-padded 8-digit number
  ncf_string := seq.prefix || lpad(next_num::text, 8, '0');

  RETURN ncf_string;
END;
$$;

COMMENT ON FUNCTION atomic_next_ncf(UUID, TEXT) IS 'Atomically increments and returns the next NCF number for a business. Uses row locking to prevent collisions between concurrent devices.';


-- ############################################################################
-- # updated_at trigger helper
-- ############################################################################
-- Automatically updates the updated_at column on row modification.

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Apply updated_at triggers to tables that have the column
CREATE TRIGGER trg_businesses_updated_at BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_staff_updated_at BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_services_updated_at BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_inventory_items_updated_at BEFORE UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_app_settings_updated_at BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
