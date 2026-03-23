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
  category      TEXT    NOT NULL DEFAULT 'Lavado',  -- Lavado | Detallado | Adicionales | Bebidas
  categoria_id  INTEGER REFERENCES categorias_servicio(id),
  price         REAL    NOT NULL,
  aplica_itbis  INTEGER NOT NULL DEFAULT 1,   -- 1 = ITBIS applies, 0 = exempt
  active        INTEGER NOT NULL DEFAULT 1,
  is_wash       INTEGER NOT NULL DEFAULT 1,   -- 0 = beverage/snack, excluded from commission
  sort_order    INTEGER NOT NULL DEFAULT 0
);

-- ── Washers ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS washers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL UNIQUE,
  phone         TEXT,
  cedula        TEXT,
  commission_pct REAL   NOT NULL DEFAULT 20,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Sellers ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sellers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL UNIQUE,
  commission_pct REAL   NOT NULL DEFAULT 5,
  active        INTEGER NOT NULL DEFAULT 1
);

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
  washer_ids        TEXT    DEFAULT '[]',   -- JSON array of washer ids
  seller_id         INTEGER REFERENCES sellers(id),
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
  itbis         REAL    NOT NULL DEFAULT 0,
  is_wash       INTEGER NOT NULL DEFAULT 1
);

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

-- ── Queue ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS queue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id     INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  status        TEXT    NOT NULL DEFAULT 'waiting',  -- waiting|in_progress|done
  washer_id     INTEGER REFERENCES washers(id),
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

-- ── Washer Commissions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS washer_commissions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  washer_id       INTEGER NOT NULL REFERENCES washers(id),
  ticket_id       INTEGER NOT NULL REFERENCES tickets(id),
  base_amount     REAL    NOT NULL,
  commission_pct  REAL    NOT NULL,
  commission_amount REAL  NOT NULL,
  paid            INTEGER NOT NULL DEFAULT 0,
  paid_at         TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Seller Commissions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seller_commissions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id       INTEGER NOT NULL REFERENCES sellers(id),
  ticket_id       INTEGER NOT NULL REFERENCES tickets(id),
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
CREATE INDEX IF NOT EXISTS idx_tickets_created   ON tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_client    ON tickets(client_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status    ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_cajero    ON tickets(cajero_id);
CREATE INDEX IF NOT EXISTS idx_ticket_items      ON ticket_items(ticket_id);
CREATE INDEX IF NOT EXISTS idx_queue_status      ON queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_washer      ON queue(washer_id);
CREATE INDEX IF NOT EXISTS idx_commissions_washer ON washer_commissions(washer_id);
CREATE INDEX IF NOT EXISTS idx_commissions_date  ON washer_commissions(created_at);
CREATE INDEX IF NOT EXISTS idx_cuadre_date       ON cuadre_caja(date);
CREATE INDEX IF NOT EXISTS idx_caja_chica_status ON caja_chica(status);
