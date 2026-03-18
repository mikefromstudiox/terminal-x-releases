// SQLite schema — applied once on first launch via db.exec(SCHEMA)
// Tables are added here as each feature is built.

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Users & Auth ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  role       TEXT    NOT NULL CHECK(role IN ('owner','manager','cashier','cfo','accountant')),
  pin        TEXT,
  username   TEXT    UNIQUE,
  password   TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Clients ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  rnc        TEXT,
  phone      TEXT,
  email      TEXT,
  credit     INTEGER NOT NULL DEFAULT 0,  -- 1 = credit account
  balance    REAL    NOT NULL DEFAULT 0,  -- outstanding balance in RD$
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Services ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  price      REAL    NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1
);

-- ── Workers ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  commission_pct  REAL    NOT NULL DEFAULT 20,  -- default 20%
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Salespeople ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salespeople (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  commission_pct  REAL    NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1
);

-- ── Tickets ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_no      TEXT    NOT NULL UNIQUE,
  client_id      INTEGER REFERENCES clients(id),
  client_name    TEXT,                          -- for one-time clients
  car_desc       TEXT    NOT NULL,              -- e.g. "Toyota Camry Rojo"
  service_id     INTEGER NOT NULL REFERENCES services(id),
  service_name   TEXT    NOT NULL,
  amount         REAL    NOT NULL,              -- total with ITBIS
  itbis          REAL    NOT NULL,              -- 18% of base
  salesperson_id INTEGER REFERENCES salespeople(id),
  status         TEXT    NOT NULL DEFAULT 'open'
                   CHECK(status IN ('open','paid','credit','voided')),
  payment_method TEXT    CHECK(payment_method IN ('cash','card','transfer','credit')),
  ncf_type       TEXT    CHECK(ncf_type IN ('B01','B02')),
  ncf_number     TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  paid_at        TEXT
);

-- ── Ticket Workers (many-to-many) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_workers (
  ticket_id      INTEGER NOT NULL REFERENCES tickets(id),
  worker_id      INTEGER NOT NULL REFERENCES workers(id),
  commission_pct REAL    NOT NULL,
  commission_amt REAL    NOT NULL,
  PRIMARY KEY (ticket_id, worker_id)
);

-- ── Credit Payments ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER NOT NULL REFERENCES clients(id),
  amount     REAL    NOT NULL,
  ncf_type   TEXT    CHECK(ncf_type IN ('B01','B02')),
  ncf_number TEXT,
  method     TEXT    NOT NULL CHECK(method IN ('cash','card','transfer')),
  paid_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Tickets included in a credit payment
CREATE TABLE IF NOT EXISTS credit_payment_tickets (
  payment_id INTEGER NOT NULL REFERENCES credit_payments(id),
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id),
  amount     REAL    NOT NULL,
  PRIMARY KEY (payment_id, ticket_id)
);

-- ── NCF Sequences ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ncf_sequences (
  type        TEXT    PRIMARY KEY,  -- 'B01' or 'B02'
  prefix      TEXT    NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO ncf_sequences (type, prefix, next_number)
  VALUES ('B01', 'B01', 1), ('B02', 'B02', 1);
`

module.exports = { SCHEMA }
