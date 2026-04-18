-- Terminal X POS — SQLite Schema
-- Run via: electron/database.js on first launch (auto-migrates)
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Core config ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS businesses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL DEFAULT '',
  rnc           TEXT    DEFAULT '',
  address       TEXT    DEFAULT '',
  phone         TEXT    DEFAULT '',
  email         TEXT    DEFAULT '',
  logo          BLOB,
  settings      TEXT    DEFAULT '{}'   -- JSON: itbis_pct, ley_pct, usd_rate, printer, language, ley_enabled, etc.
);
INSERT OR IGNORE INTO businesses (id) VALUES (1);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT,
  pin_hash      TEXT    NOT NULL,   -- SHA-256 of PIN (store hash, never plain)
  role          TEXT    NOT NULL CHECK(role IN ('owner','manager','cfo','accountant','cashier')),
  discount_pct  REAL    NOT NULL DEFAULT 0,
  vendedor_id   INTEGER REFERENCES sellers(id),  -- linked seller for commission tracking
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Service Categories ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categorias_servicio (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT    NOT NULL UNIQUE,
  orden  INTEGER NOT NULL DEFAULT 0
);
-- Default categories (INSERT OR IGNORE — never overwrites user edits)
INSERT OR IGNORE INTO categorias_servicio(nombre, orden) VALUES ('Lavado',      1);
INSERT OR IGNORE INTO categorias_servicio(nombre, orden) VALUES ('Detallado',   2);
INSERT OR IGNORE INTO categorias_servicio(nombre, orden) VALUES ('Adicionales', 3);
INSERT OR IGNORE INTO categorias_servicio(nombre, orden) VALUES ('Bebidas',     4);

-- ── Services ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  name_en       TEXT,
  category      TEXT    NOT NULL DEFAULT 'General',  -- Vertical-agnostic default; UI/seed pick a localized bucket
  categoria_id  INTEGER REFERENCES categorias_servicio(id),
  price         REAL    NOT NULL,
  cost          REAL    NOT NULL DEFAULT 0,   -- unit cost (for profit margin tracking)
  aplica_itbis  INTEGER NOT NULL DEFAULT 1,   -- 1 = ITBIS applies, 0 = exempt
  active        INTEGER NOT NULL DEFAULT 1,
  is_wash       INTEGER NOT NULL DEFAULT 1,   -- 0 = beverage/snack, excluded from commission
  sort_order    INTEGER NOT NULL DEFAULT 0
);

-- ── Washers/Sellers: DROPPED in v2.1.0 — consolidated into `empleados`.
--    Per-employee commission lives on `empleados.comision_pct`; `tipo` identifies
--    the role (`lavador`/`vendedor`/`hybrid`). Commissions now FK to
--    `empleados.supabase_id` via `empleado_supabase_id`. Legacy `washers` and
--    `sellers` tables are removed by the SQLite migration in database.js.

-- ── Clients ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  rnc           TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  credit_limit  REAL    NOT NULL DEFAULT 0,
  balance       REAL    NOT NULL DEFAULT 0,   -- amount currently owed
  visits        INTEGER NOT NULL DEFAULT 0,
  total_spent   REAL    NOT NULL DEFAULT 0,
  notes         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Tickets ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_number        TEXT    NOT NULL UNIQUE,
  client_id         INTEGER REFERENCES clients(id),
  washer_empleado_supabase_ids TEXT DEFAULT '[]',   -- JSON array of empleado UUIDs (v2.1)
  seller_empleado_supabase_id  TEXT,               -- empleados.supabase_id (v2.1)
  cajero_id         INTEGER REFERENCES users(id),
  subtotal          REAL    NOT NULL DEFAULT 0,
  descuento         REAL    NOT NULL DEFAULT 0,
  itbis             REAL    NOT NULL DEFAULT 0,
  ley               REAL    NOT NULL DEFAULT 0,
  total             REAL    NOT NULL DEFAULT 0,
  payment_method    TEXT    NOT NULL DEFAULT 'cash',  -- cash|card|transfer|cheque|credit
  comprobante_type  TEXT    NOT NULL DEFAULT 'B02',   -- B01|B02|E31|E32
  ncf               TEXT,
  ecf_result        TEXT    DEFAULT '{}',   -- JSON: eNCF, status, trackId, qrUrl
  tipo_venta        TEXT    NOT NULL DEFAULT 'contado',  -- contado|credito
  status            TEXT    NOT NULL DEFAULT 'cobrado',  -- cobrado|pendiente|nula
  void_reason       TEXT,
  void_by           INTEGER REFERENCES users(id),
  void_at           TEXT,
  vehicle_plate     TEXT,
  vehicle_color     TEXT,
  vehicle_make      TEXT,
  notes             TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Ticket items ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id     INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  service_id    INTEGER REFERENCES services(id),
  name          TEXT    NOT NULL,
  price         REAL    NOT NULL,
  cost          REAL    NOT NULL DEFAULT 0,   -- snapshot of unit cost at sale time (profit = price - cost)
  itbis         REAL    NOT NULL DEFAULT 0,
  is_wash       INTEGER NOT NULL DEFAULT 1
);

-- ── Payroll runs (paycheck history) ────────────────────────────────────────────
-- Each row is one paycheck event for an employee. Lets us show history,
-- search by date range, compute "last paycheck / first paycheck", and
-- drive accountant exports.
CREATE TABLE IF NOT EXISTS payroll_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  empleado_id     INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  period_start    TEXT    NOT NULL,                      -- YYYY-MM-DD
  period_end      TEXT    NOT NULL,                      -- YYYY-MM-DD
  base            REAL    NOT NULL DEFAULT 0,            -- base salary for period
  commissions     REAL    NOT NULL DEFAULT 0,            -- sum of commissions in period
  bonuses         REAL    NOT NULL DEFAULT 0,            -- optional bonuses
  -- Employee-side withholdings (subtracted from gross)
  sfs_employee    REAL    NOT NULL DEFAULT 0,
  afp_employee    REAL    NOT NULL DEFAULT 0,
  isr             REAL    NOT NULL DEFAULT 0,
  other_deductions REAL   NOT NULL DEFAULT 0,
  deductions      REAL    NOT NULL DEFAULT 0,            -- sum of employee-side withholdings (kept for back-compat)
  -- Employer-side liabilities (NOT withheld; tracked for TSS filing)
  sfs_employer    REAL    NOT NULL DEFAULT 0,
  afp_employer    REAL    NOT NULL DEFAULT 0,
  infotep_employer REAL   NOT NULL DEFAULT 0,
  net             REAL    NOT NULL,                      -- final amount paid
  notes           TEXT,                                  -- optional comment
  paid_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  paid_by         INTEGER REFERENCES users(id),          -- who ran payroll
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_empleado ON payroll_runs(empleado_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_paid_at  ON payroll_runs(paid_at);

-- ── Payroll settings (one row per business) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_settings (
  id                    INTEGER PRIMARY KEY,
  business_id           INTEGER NOT NULL DEFAULT 1,
  pay_cycle             TEXT NOT NULL DEFAULT 'quincenal',  -- quincenal | mensual
  -- Employee-side TSS (withheld from paycheck)
  sfs_employee_rate     REAL NOT NULL DEFAULT 0.0304,
  afp_employee_rate     REAL NOT NULL DEFAULT 0.0287,
  -- Employer-side TSS + INFOTEP (employer liability, not withheld)
  sfs_employer_rate     REAL NOT NULL DEFAULT 0.0709,
  afp_employer_rate     REAL NOT NULL DEFAULT 0.0710,
  infotep_employer_rate REAL NOT NULL DEFAULT 0.01,
  -- 2026 TSS cotization caps (editable in case DGII raises them)
  sfs_monthly_cap       REAL NOT NULL DEFAULT 232230,
  afp_monthly_cap       REAL NOT NULL DEFAULT 464460,
  -- ISR
  isr_enabled           INTEGER NOT NULL DEFAULT 1,
  isr_brackets          TEXT NOT NULL DEFAULT '[[0,416220,0],[416220,624329,0.15],[624329,867123,0.20],[867123,999999999,0.25]]',
  -- Other
  navidad_enabled       INTEGER NOT NULL DEFAULT 1,
  vacation_days         INTEGER NOT NULL DEFAULT 14,
  daily_divisor         REAL NOT NULL DEFAULT 23.83,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Salary changes (audit log for raises/cuts) ────────────────────────────────
CREATE TABLE IF NOT EXISTS salary_changes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  empleado_id    INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  old_salary     REAL NOT NULL,
  new_salary     REAL NOT NULL,
  effective_date TEXT NOT NULL,
  reason         TEXT,
  changed_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_salary_changes_empleado ON salary_changes(empleado_id);

-- ── Adelantos de nomina (salary advances) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS adelantos (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  supabase_id             TEXT,
  empleado_id             INTEGER NOT NULL REFERENCES empleados(id),
  empleado_supabase_id    TEXT,
  amount                  REAL    NOT NULL,
  date                    TEXT    NOT NULL DEFAULT (date('now')),
  notes                   TEXT,
  status                  TEXT    NOT NULL DEFAULT 'pendiente',
  deducted_from_payroll_id INTEGER REFERENCES payroll_runs(id),
  deducted_at             TEXT,
  approved_by             TEXT,
  created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_adelantos_empleado ON adelantos(empleado_id);
CREATE INDEX IF NOT EXISTS idx_adelantos_status   ON adelantos(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_adelantos_supabase_id ON adelantos(supabase_id);

-- ── Credit payments ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL REFERENCES clients(id),
  ticket_ids    TEXT    NOT NULL DEFAULT '[]',   -- JSON array
  amount        REAL    NOT NULL,
  payment_method TEXT   NOT NULL DEFAULT 'cash',
  ncf           TEXT,
  notes         TEXT,
  cajero_id     INTEGER REFERENCES users(id),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Queue (v2.1 — empleado_supabase_id → empleados, not washers) ───────────────
CREATE TABLE IF NOT EXISTS queue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_supabase_id TEXT,
  ticket_id     INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  status        TEXT    NOT NULL DEFAULT 'waiting',  -- waiting|in_progress|done
  empleado_supabase_id TEXT,                         -- empleados.supabase_id (lavador)
  assigned_at   TEXT,
  completed_at  TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Cuadre de Caja ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cuadre_caja (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cajero_id       INTEGER REFERENCES users(id),
  date            TEXT    NOT NULL,
  fondo           REAL    NOT NULL DEFAULT 5000,
  efectivo_conteo REAL    NOT NULL DEFAULT 0,
  efectivo_sistema REAL   NOT NULL DEFAULT 0,
  tarjeta         REAL    NOT NULL DEFAULT 0,
  transferencia   REAL    NOT NULL DEFAULT 0,
  cheque          REAL    NOT NULL DEFAULT 0,
  creditos        REAL    NOT NULL DEFAULT 0,
  salidas         REAL    NOT NULL DEFAULT 0,
  total_vendido   REAL    NOT NULL DEFAULT 0,
  total_cobrado   REAL    NOT NULL DEFAULT 0,
  cierre_total    REAL    NOT NULL DEFAULT 0,
  diferencia      REAL    NOT NULL DEFAULT 0,
  comentario      TEXT,
  denominaciones  TEXT    DEFAULT '{}',   -- JSON
  closed_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Caja Chica ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS caja_chica (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  description   TEXT    NOT NULL,
  category      TEXT    NOT NULL DEFAULT 'Otros',
  type          TEXT    NOT NULL DEFAULT 'Gasto',   -- Gasto|Compra
  amount        REAL    NOT NULL,
  recibo        TEXT,
  status        TEXT    NOT NULL DEFAULT 'pendiente',  -- pendiente|aprobado|rechazado
  approved_by   INTEGER REFERENCES users(id),
  cajero_id     INTEGER REFERENCES users(id),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Notas de Crédito ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notas_credito (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ncf               TEXT    NOT NULL,
  client_id         INTEGER REFERENCES clients(id),
  original_ticket_id INTEGER REFERENCES tickets(id),
  motivo            TEXT    NOT NULL DEFAULT 'Devolución',
  amount            REAL    NOT NULL,
  itbis_revertido   REAL    NOT NULL DEFAULT 0,
  forma_devolucion  TEXT    NOT NULL DEFAULT 'Efectivo',
  comentario        TEXT,
  cajero_id         INTEGER REFERENCES users(id),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Washer Commissions (v2.1 — FK empleado_supabase_id → empleados.supabase_id) ─
CREATE TABLE IF NOT EXISTS washer_commissions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  empleado_supabase_id TEXT NOT NULL,            -- empleados.supabase_id (tipo='lavador' or 'hybrid')
  ticket_supabase_id   TEXT,                     -- tickets.supabase_id (cloud-native FK)
  ticket_id       INTEGER REFERENCES tickets(id),
  base_amount     REAL    NOT NULL,
  commission_pct  REAL    NOT NULL,
  commission_amount REAL  NOT NULL,
  paid            INTEGER NOT NULL DEFAULT 0,
  paid_at         TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Seller Commissions (v2.1 — FK empleado_supabase_id → empleados.supabase_id) ─
CREATE TABLE IF NOT EXISTS seller_commissions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  empleado_supabase_id TEXT NOT NULL,            -- empleados.supabase_id (tipo='vendedor' or 'hybrid')
  ticket_supabase_id   TEXT,                     -- tickets.supabase_id
  ticket_id       INTEGER REFERENCES tickets(id),
  base_amount     REAL    NOT NULL,
  commission_pct  REAL    NOT NULL,
  commission_amount REAL  NOT NULL,
  paid            INTEGER NOT NULL DEFAULT 0,
  paid_at         TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Cajero Commissions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cajero_commissions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cajero_id       INTEGER NOT NULL REFERENCES users(id),
  ticket_id       INTEGER NOT NULL REFERENCES tickets(id),
  base_amount     REAL    NOT NULL,
  commission_pct  REAL    NOT NULL,
  commission_amount REAL  NOT NULL,
  paid            INTEGER NOT NULL DEFAULT 0,
  paid_at         TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── NCF Sequences ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ncf_sequences (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT    NOT NULL UNIQUE,  -- E31|E32|E33|E34|E41|E43|E44|E45|E46|E47 (also B01|B02 legacy)
  prefix        TEXT    NOT NULL,
  current_number INTEGER NOT NULL DEFAULT 0,
  limit_number  INTEGER NOT NULL DEFAULT 500,
  valid_until   TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  enabled       INTEGER NOT NULL DEFAULT 0
);

-- ── Backups ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT    NOT NULL,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  type          TEXT    NOT NULL DEFAULT 'auto',  -- auto|manual
  status        TEXT    NOT NULL DEFAULT 'ok',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ══════════════════════════════════════════════════════════════════════════════
-- ── Spanish-named tables (v2 admin schema) ────────────────────────────────────
-- These coexist with the English tables above.
-- Tickets / queue / reports continue to use the English tables.
-- The Admin panel (window.electronAPI.admin.*) points to these.
-- ══════════════════════════════════════════════════════════════════════════════

-- Single-row business record (guaranteed by INSERT OR IGNORE seed below)
CREATE TABLE IF NOT EXISTS empresa (
  id          INTEGER PRIMARY KEY DEFAULT 1 CHECK(id = 1),
  nombre      TEXT    NOT NULL DEFAULT '',
  rnc         TEXT    NOT NULL DEFAULT '',
  direccion   TEXT    NOT NULL DEFAULT '',
  telefono    TEXT    NOT NULL DEFAULT '',
  email       TEXT    NOT NULL DEFAULT '',
  logo_path   TEXT,
  moneda      TEXT    NOT NULL DEFAULT 'DOP',
  creado_en   TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO empresa (id) VALUES (1);

CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre        TEXT    NOT NULL,
  pin_hash      TEXT,
  password_hash TEXT,
  rol           TEXT    NOT NULL DEFAULT 'cashier'
                  CHECK(rol IN ('owner','manager','cfo','accountant','cashier')),
  descuento_pct REAL    NOT NULL DEFAULT 0,
  activo        INTEGER NOT NULL DEFAULT 1,
  creado_en     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lavadores (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre        TEXT    NOT NULL,
  comision_pct  REAL    NOT NULL DEFAULT 20,
  activo        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS vendedores (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT    NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1
);

-- Note: categorias_servicio is already defined above (shared by both families)

CREATE TABLE IF NOT EXISTS servicios (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria_id      INTEGER REFERENCES categorias_servicio(id),
  nombre            TEXT    NOT NULL,
  precio            REAL    NOT NULL DEFAULT 0,
  aplica_itbis      INTEGER NOT NULL DEFAULT 1,
  excluir_comision  INTEGER NOT NULL DEFAULT 0,
  activo            INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS secuencias_ncf (
  tipo              TEXT    PRIMARY KEY,   -- E31|E32|...|B01|B02
  prefijo           TEXT    NOT NULL DEFAULT '',
  secuencia_actual  INTEGER NOT NULL DEFAULT 0,
  secuencia_hasta   INTEGER NOT NULL DEFAULT 500,
  activo            INTEGER NOT NULL DEFAULT 0
);
-- Seed e-CF types (activo=0 — user enables them once licensed)
INSERT OR IGNORE INTO secuencias_ncf(tipo,prefijo,secuencia_actual,secuencia_hasta,activo) VALUES('B01','B01',0,500,1);
INSERT OR IGNORE INTO secuencias_ncf(tipo,prefijo,secuencia_actual,secuencia_hasta,activo) VALUES('B02','B02',0,500,1);
INSERT OR IGNORE INTO secuencias_ncf(tipo,prefijo,secuencia_actual,secuencia_hasta,activo) VALUES('E31','E310',0,500,0);
INSERT OR IGNORE INTO secuencias_ncf(tipo,prefijo,secuencia_actual,secuencia_hasta,activo) VALUES('E32','E320',0,500,0);
INSERT OR IGNORE INTO secuencias_ncf(tipo,prefijo,secuencia_actual,secuencia_hasta,activo) VALUES('E33','E330',0,500,0);
INSERT OR IGNORE INTO secuencias_ncf(tipo,prefijo,secuencia_actual,secuencia_hasta,activo) VALUES('E34','E340',0,500,0);
INSERT OR IGNORE INTO secuencias_ncf(tipo,prefijo,secuencia_actual,secuencia_hasta,activo) VALUES('E41','E410',0,500,0);
INSERT OR IGNORE INTO secuencias_ncf(tipo,prefijo,secuencia_actual,secuencia_hasta,activo) VALUES('E43','E430',0,500,0);
INSERT OR IGNORE INTO secuencias_ncf(tipo,prefijo,secuencia_actual,secuencia_hasta,activo) VALUES('E44','E440',0,500,0);
INSERT OR IGNORE INTO secuencias_ncf(tipo,prefijo,secuencia_actual,secuencia_hasta,activo) VALUES('E45','E450',0,500,0);
INSERT OR IGNORE INTO secuencias_ncf(tipo,prefijo,secuencia_actual,secuencia_hasta,activo) VALUES('E46','E460',0,500,0);
INSERT OR IGNORE INTO secuencias_ncf(tipo,prefijo,secuencia_actual,secuencia_hasta,activo) VALUES('E47','E470',0,500,0);

CREATE TABLE IF NOT EXISTS configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO configuracion(clave,valor) VALUES('setup_complete','0');

-- ── Indexes ───────────────────────────────────────────────────────────────────
-- v2.1: legacy indexes referencing dropped INT FKs (tickets.client_id,
-- tickets.cajero_id, queue.washer_id, washer_commissions.washer_id,
-- credit_payments.client_id, cuadre_caja.cajero_id, vehicles.client_id,
-- loans.client_id) are removed. Replaced with supabase_id-first indexes.
CREATE INDEX IF NOT EXISTS idx_tickets_created   ON tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_status    ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_ticket_items      ON ticket_items(ticket_id);
CREATE INDEX IF NOT EXISTS idx_queue_status      ON queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_empleado    ON queue(empleado_supabase_id);
CREATE INDEX IF NOT EXISTS idx_commissions_date  ON washer_commissions(created_at);
CREATE INDEX IF NOT EXISTS idx_commissions_empleado_w ON washer_commissions(empleado_supabase_id);
CREATE INDEX IF NOT EXISTS idx_commissions_empleado_s ON seller_commissions(empleado_supabase_id);
CREATE INDEX IF NOT EXISTS idx_cuadre_date       ON cuadre_caja(date);
CREATE INDEX IF NOT EXISTS idx_caja_chica_status ON caja_chica(status);
CREATE INDEX IF NOT EXISTS idx_credit_pay_date   ON credit_payments(created_at);

-- ── Vehicles (auto repair / detailing) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  supabase_id         TEXT,
  vin                 TEXT,
  plate               TEXT,
  make                TEXT,
  model               TEXT,
  year                INTEGER,
  color               TEXT,
  mileage             INTEGER,
  odometer_km         INTEGER,
  last_service_km     INTEGER,
  last_service_at     TEXT,
  next_service_km     INTEGER,
  next_service_at     TEXT,
  client_id           INTEGER REFERENCES clients(id),
  client_supabase_id  TEXT,
  notes               TEXT,
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_supabase_id ON vehicles(supabase_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_client_sid ON vehicles(client_supabase_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_plate  ON vehicles(plate);

-- ── Service Bays (auto repair / detailing) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS service_bays (
  id                              INTEGER PRIMARY KEY AUTOINCREMENT,
  supabase_id                     TEXT,
  name                            TEXT    NOT NULL,
  status                          TEXT    NOT NULL DEFAULT 'libre',
  current_work_order_id           INTEGER,
  current_work_order_supabase_id  TEXT,
  capacity                        INTEGER NOT NULL DEFAULT 1,
  bay_type                        TEXT,
  active                          INTEGER NOT NULL DEFAULT 1,
  created_at                      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_bays_supabase_id ON service_bays(supabase_id);

-- ── Work Orders (auto repair / detailing) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_orders (
  id                                INTEGER PRIMARY KEY AUTOINCREMENT,
  supabase_id                       TEXT,
  vehicle_id                        INTEGER REFERENCES vehicles(id),
  vehicle_supabase_id               TEXT,
  client_id                         INTEGER REFERENCES clients(id),
  client_supabase_id                TEXT,
  technician_empleado_id            INTEGER REFERENCES empleados(id),
  technician_empleado_supabase_id   TEXT,
  bay_id                            INTEGER REFERENCES service_bays(id),
  bay_supabase_id                   TEXT,
  status                            TEXT    NOT NULL DEFAULT 'estimate',
  estimated_total                   REAL    NOT NULL DEFAULT 0,
  actual_total                      REAL    NOT NULL DEFAULT 0,
  labor_total                       REAL    NOT NULL DEFAULT 0,
  parts_total                       REAL    NOT NULL DEFAULT 0,
  itbis                             REAL    NOT NULL DEFAULT 0,
  total                             REAL    NOT NULL DEFAULT 0,
  inspection_json                   TEXT,
  estimate_approved_at              TEXT,
  customer_signature_url            TEXT,
  customer_approval_token           TEXT,
  expected_parts_arrival            TEXT,
  odometer_in_km                    INTEGER,
  odometer_out_km                   INTEGER,
  promised_date                     TEXT,
  completed_date                    TEXT,
  notes                             TEXT,
  created_at                        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_orders_supabase_id ON work_orders(supabase_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_vehicle ON work_orders(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status  ON work_orders(status);

-- ── Work Order Items ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_order_items (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  supabase_id                 TEXT,
  work_order_id               INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  work_order_supabase_id      TEXT,
  type                        TEXT    NOT NULL DEFAULT 'labor',
  name                        TEXT    NOT NULL,
  description                 TEXT,
  quantity                    REAL    NOT NULL DEFAULT 1,
  unit_price                  REAL    NOT NULL DEFAULT 0,
  total                       REAL    NOT NULL DEFAULT 0,
  warranty_months             INTEGER NOT NULL DEFAULT 0,
  inventory_item_id           INTEGER REFERENCES inventory_items(id),
  inventory_item_supabase_id  TEXT,
  created_at                  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_order_items_supabase_id ON work_order_items(supabase_id);

-- ── Appointments (salon / barbershop) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  supabase_id           TEXT,
  client_id             INTEGER REFERENCES clients(id),
  client_supabase_id    TEXT,
  empleado_id           INTEGER REFERENCES empleados(id),
  empleado_supabase_id  TEXT,
  date                  TEXT    NOT NULL,
  start_time            TEXT    NOT NULL,
  end_time              TEXT,
  status                TEXT    NOT NULL DEFAULT 'scheduled',
  services              TEXT    NOT NULL DEFAULT '[]',
  notes                 TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_supabase_id ON appointments(supabase_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date     ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appointments_empleado ON appointments(empleado_id);

-- ── Stylist Schedules (salon / barbershop) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS stylist_schedules (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  supabase_id           TEXT,
  empleado_id           INTEGER NOT NULL REFERENCES empleados(id),
  empleado_supabase_id  TEXT,
  day_of_week           INTEGER NOT NULL,
  start_time            TEXT    NOT NULL,
  end_time              TEXT    NOT NULL,
  active                INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stylist_schedules_supabase_id ON stylist_schedules(supabase_id);

-- ── Loans (prestamos / empenio) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loans (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  supabase_id       TEXT,
  client_id         INTEGER NOT NULL REFERENCES clients(id),
  client_supabase_id TEXT,
  principal         REAL    NOT NULL,
  term_months       INTEGER NOT NULL,
  interest_rate     REAL    NOT NULL,
  monthly_payment   REAL    NOT NULL DEFAULT 0,
  status            TEXT    NOT NULL DEFAULT 'active',
  disbursed_at      TEXT,
  next_due_date     TEXT,
  total_paid        REAL    NOT NULL DEFAULT 0,
  total_interest    REAL    NOT NULL DEFAULT 0,
  notes             TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_loans_supabase_id ON loans(supabase_id);
CREATE INDEX IF NOT EXISTS idx_loans_client_sid ON loans(client_supabase_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);

-- ── Loan Payments ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loan_payments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  supabase_id         TEXT,
  loan_id             INTEGER NOT NULL REFERENCES loans(id),
  loan_supabase_id    TEXT,
  amount              REAL    NOT NULL,
  principal_portion   REAL    NOT NULL DEFAULT 0,
  interest_portion    REAL    NOT NULL DEFAULT 0,
  late_fee            REAL    NOT NULL DEFAULT 0,
  payment_date        TEXT    NOT NULL DEFAULT (date('now')),
  due_date            TEXT,
  status              TEXT    NOT NULL DEFAULT 'on_time',
  notes               TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_loan_payments_supabase_id ON loan_payments(supabase_id);
CREATE INDEX IF NOT EXISTS idx_loan_payments_loan ON loan_payments(loan_id);

-- ── Pawn Items (empenio) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pawn_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  supabase_id         TEXT,
  client_id           INTEGER REFERENCES clients(id),
  client_supabase_id  TEXT,
  loan_id             INTEGER REFERENCES loans(id),
  loan_supabase_id    TEXT,
  description         TEXT    NOT NULL,
  estimated_value     REAL    NOT NULL DEFAULT 0,
  storage_location    TEXT,
  status              TEXT    NOT NULL DEFAULT 'held',
  redeem_deadline     TEXT,
  notes               TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pawn_items_supabase_id ON pawn_items(supabase_id);
