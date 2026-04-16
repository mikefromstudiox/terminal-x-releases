/**
 * database.js — SQLite database layer for Terminal X POS
 *
 * Uses better-sqlite3 (synchronous API — safe for main process).
 * All public functions are synchronous; IPC handlers wrap them.
 *
 * DB file location: app.getPath('userData') / terminal-x.db
 * Schema:    db/schema.sql  (auto-applied on first run)
 * Seed data: db/seed.js     (runs once when tables are empty)
 */

const path    = require('path')
const fs      = require('fs')
const crypto  = require('crypto')

let Database
let dbLoadError = null
try {
  Database = require('better-sqlite3')
} catch (err) {
  dbLoadError = err.message
  console.error('[db] better-sqlite3 not available:', err.message)
  Database = null
}

let db = null
let dbInitError = null

// ── Initialise ────────────────────────────────────────────────────────────────
function isReady() { return !!db }
function getError() { return dbInitError || dbLoadError || null }

function init(userDataPath) {
  if (!Database) { dbInitError = dbLoadError || 'better-sqlite3 not available'; return false }

  const dbPath     = path.join(userDataPath, 'terminal-x.db')
  const schemaPath = path.join(__dirname, '../db/schema.sql')
  const seedPath   = path.join(__dirname, '../db/seed.js')

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -2000')
  db.pragma('temp_store = MEMORY')
  db.pragma('foreign_keys = ON')

  // Apply schema
  const schema = fs.readFileSync(schemaPath, 'utf8')
  db.exec(schema)

  // Schema migrations — safe to run multiple times (ignored if column exists)
  const migrations = [
    'ALTER TABLE washers ADD COLUMN start_date TEXT',
    'ALTER TABLE sellers ADD COLUMN phone TEXT',
    'ALTER TABLE ncf_sequences ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0',
    // v1.1 — categorias_servicio support
    'ALTER TABLE services ADD COLUMN categoria_id INTEGER REFERENCES categorias_servicio(id)',
    'ALTER TABLE services ADD COLUMN aplica_itbis INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE users ADD COLUMN vendedor_id INTEGER REFERENCES sellers(id)',
    'ALTER TABLE users ADD COLUMN commission_pct REAL NOT NULL DEFAULT 0',
    'ALTER TABLE tickets ADD COLUMN beverage_subtotal REAL NOT NULL DEFAULT 0',
    // v1.2 — DGII direct e-CF: add columns to ecf_queue for XML storage
    "ALTER TABLE ecf_queue ADD COLUMN xml_signed TEXT",
    "ALTER TABLE ecf_queue ADD COLUMN encf TEXT",
    "ALTER TABLE ecf_queue ADD COLUMN tipo_ecf TEXT",
    "ALTER TABLE ecf_queue ADD COLUMN environment TEXT NOT NULL DEFAULT 'testecf'",
    // v1.3 — plan column on businesses for license sync
    "ALTER TABLE businesses ADD COLUMN plan TEXT NOT NULL DEFAULT 'pro'",
    // v1.4 — cost tracking for profit margins (services + ticket_items snapshot)
    'ALTER TABLE services ADD COLUMN cost REAL NOT NULL DEFAULT 0',
    'ALTER TABLE ticket_items ADD COLUMN cost REAL NOT NULL DEFAULT 0',
    // v1.5 — nómina expansion: employee fields for TSS/ISR filings
    'ALTER TABLE empleados ADD COLUMN puesto TEXT',
    'ALTER TABLE empleados ADD COLUMN email TEXT',
    'ALTER TABLE empleados ADD COLUMN bank_account TEXT',
    'ALTER TABLE empleados ADD COLUMN tss_id TEXT',
    // v1.5 — payroll_runs: itemised deductions + employer liabilities
    'ALTER TABLE payroll_runs ADD COLUMN sfs_employee REAL NOT NULL DEFAULT 0',
    'ALTER TABLE payroll_runs ADD COLUMN afp_employee REAL NOT NULL DEFAULT 0',
    'ALTER TABLE payroll_runs ADD COLUMN isr REAL NOT NULL DEFAULT 0',
    'ALTER TABLE payroll_runs ADD COLUMN other_deductions REAL NOT NULL DEFAULT 0',
    'ALTER TABLE payroll_runs ADD COLUMN sfs_employer REAL NOT NULL DEFAULT 0',
    'ALTER TABLE payroll_runs ADD COLUMN afp_employer REAL NOT NULL DEFAULT 0',
    'ALTER TABLE payroll_runs ADD COLUMN infotep_employer REAL NOT NULL DEFAULT 0',
    // v1.4 — business type + retail support
    "INSERT OR IGNORE INTO app_settings(key, value) VALUES('business_type', 'carwash')",
    'ALTER TABLE ticket_items ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE ticket_items ADD COLUMN sku TEXT',
    'ALTER TABLE ticket_items ADD COLUMN inventory_item_id INTEGER REFERENCES inventory_items(id)',
    'ALTER TABLE inventory_items ADD COLUMN barcode TEXT',
    'ALTER TABLE inventory_items ADD COLUMN aplica_itbis INTEGER NOT NULL DEFAULT 1',
    // v1.8.4 — start_date + cedula for sellers, cedula + start_date for users (cashiers)
    'ALTER TABLE sellers ADD COLUMN start_date TEXT',
    'ALTER TABLE sellers ADD COLUMN cedula TEXT',
    'ALTER TABLE users ADD COLUMN cedula TEXT',
    'ALTER TABLE users ADD COLUMN start_date TEXT',
    // SQLite doesn't support ALTER CHECK — recreate constraint by adding the column check is ignored
    // Instead, we drop the old constraint by recreating — but that's destructive. Safer: just allow any value
    // since the UI controls the allowed types. The CHECK was on CREATE TABLE, can't be altered.
    // We'll handle validation in code instead.
    // v1.6 — supabase_id UUID columns for cloud sync
    'ALTER TABLE services ADD COLUMN supabase_id TEXT',
    'ALTER TABLE washers ADD COLUMN supabase_id TEXT',
    'ALTER TABLE sellers ADD COLUMN supabase_id TEXT',
    'ALTER TABLE clients ADD COLUMN supabase_id TEXT',
    'ALTER TABLE inventory_items ADD COLUMN supabase_id TEXT',
    'ALTER TABLE ncf_sequences ADD COLUMN supabase_id TEXT',
    'ALTER TABLE empleados ADD COLUMN supabase_id TEXT',
    'ALTER TABLE categorias_servicio ADD COLUMN supabase_id TEXT',
    'ALTER TABLE tickets ADD COLUMN supabase_id TEXT',
    'ALTER TABLE ticket_items ADD COLUMN supabase_id TEXT',
    'ALTER TABLE queue ADD COLUMN supabase_id TEXT',
    'ALTER TABLE washer_commissions ADD COLUMN supabase_id TEXT',
    'ALTER TABLE seller_commissions ADD COLUMN supabase_id TEXT',
    'ALTER TABLE cajero_commissions ADD COLUMN supabase_id TEXT',
    'ALTER TABLE credit_payments ADD COLUMN supabase_id TEXT',
    'ALTER TABLE cuadre_caja ADD COLUMN supabase_id TEXT',
    'ALTER TABLE caja_chica ADD COLUMN supabase_id TEXT',
    'ALTER TABLE notas_credito ADD COLUMN supabase_id TEXT',
    'ALTER TABLE inventory_transactions ADD COLUMN supabase_id TEXT',
    'ALTER TABLE compras_607 ADD COLUMN supabase_id TEXT',
    'ALTER TABLE users ADD COLUMN supabase_id TEXT',
    // v1.6 — FK supabase_id columns for relational sync
    'ALTER TABLE ticket_items ADD COLUMN ticket_supabase_id TEXT',
    'ALTER TABLE ticket_items ADD COLUMN service_supabase_id TEXT',
    'ALTER TABLE queue ADD COLUMN ticket_supabase_id TEXT',
    'ALTER TABLE queue ADD COLUMN washer_supabase_id TEXT',
    'ALTER TABLE washer_commissions ADD COLUMN ticket_supabase_id TEXT',
    'ALTER TABLE washer_commissions ADD COLUMN washer_supabase_id TEXT',
    'ALTER TABLE seller_commissions ADD COLUMN ticket_supabase_id TEXT',
    'ALTER TABLE seller_commissions ADD COLUMN seller_supabase_id TEXT',
    'ALTER TABLE cajero_commissions ADD COLUMN ticket_supabase_id TEXT',
    'ALTER TABLE cajero_commissions ADD COLUMN cajero_supabase_id TEXT',
    'ALTER TABLE credit_payments ADD COLUMN client_supabase_id TEXT',
    'ALTER TABLE credit_payments ADD COLUMN cajero_supabase_id TEXT',
    'ALTER TABLE notas_credito ADD COLUMN client_supabase_id TEXT',
    'ALTER TABLE notas_credito ADD COLUMN ticket_supabase_id TEXT',
    'ALTER TABLE notas_credito ADD COLUMN cajero_supabase_id TEXT',
    'ALTER TABLE inventory_transactions ADD COLUMN item_supabase_id TEXT',
    // v1.6 — backfill UUIDs for existing rows
    "UPDATE services SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE washers SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE sellers SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE clients SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE inventory_items SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE ncf_sequences SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE empleados SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE categorias_servicio SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE tickets SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE ticket_items SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE queue SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE washer_commissions SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE seller_commissions SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE cajero_commissions SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE credit_payments SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE cuadre_caja SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE caja_chica SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE notas_credito SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE inventory_transactions SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE compras_607 SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    "UPDATE users SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
    // v1.6 — backfill FK supabase_ids for existing rows
    "UPDATE ticket_items SET ticket_supabase_id = (SELECT supabase_id FROM tickets WHERE tickets.id = ticket_items.ticket_id) WHERE ticket_supabase_id IS NULL AND ticket_id IS NOT NULL",
    "UPDATE ticket_items SET service_supabase_id = (SELECT supabase_id FROM services WHERE services.id = ticket_items.service_id) WHERE service_supabase_id IS NULL AND service_id IS NOT NULL",
    "UPDATE queue SET ticket_supabase_id = (SELECT supabase_id FROM tickets WHERE tickets.id = queue.ticket_id) WHERE ticket_supabase_id IS NULL AND ticket_id IS NOT NULL",
    "UPDATE queue SET washer_supabase_id = (SELECT supabase_id FROM washers WHERE washers.id = queue.washer_id) WHERE washer_supabase_id IS NULL AND washer_id IS NOT NULL",
    "UPDATE washer_commissions SET ticket_supabase_id = (SELECT supabase_id FROM tickets WHERE tickets.id = washer_commissions.ticket_id) WHERE ticket_supabase_id IS NULL AND ticket_id IS NOT NULL",
    "UPDATE washer_commissions SET washer_supabase_id = (SELECT supabase_id FROM washers WHERE washers.id = washer_commissions.washer_id) WHERE washer_supabase_id IS NULL AND washer_id IS NOT NULL",
    "UPDATE seller_commissions SET ticket_supabase_id = (SELECT supabase_id FROM tickets WHERE tickets.id = seller_commissions.ticket_id) WHERE ticket_supabase_id IS NULL AND ticket_id IS NOT NULL",
    "UPDATE seller_commissions SET seller_supabase_id = (SELECT supabase_id FROM sellers WHERE sellers.id = seller_commissions.seller_id) WHERE seller_supabase_id IS NULL AND seller_id IS NOT NULL",
    "UPDATE cajero_commissions SET ticket_supabase_id = (SELECT supabase_id FROM tickets WHERE tickets.id = cajero_commissions.ticket_id) WHERE ticket_supabase_id IS NULL AND ticket_id IS NOT NULL",
    "UPDATE cajero_commissions SET cajero_supabase_id = (SELECT supabase_id FROM users WHERE users.id = cajero_commissions.cajero_id) WHERE cajero_supabase_id IS NULL AND cajero_id IS NOT NULL",
    "UPDATE credit_payments SET client_supabase_id = (SELECT supabase_id FROM clients WHERE clients.id = credit_payments.client_id) WHERE client_supabase_id IS NULL AND client_id IS NOT NULL",
    "UPDATE credit_payments SET cajero_supabase_id = (SELECT supabase_id FROM users WHERE users.id = credit_payments.cajero_id) WHERE cajero_supabase_id IS NULL AND cajero_id IS NOT NULL",
    "UPDATE notas_credito SET client_supabase_id = (SELECT supabase_id FROM clients WHERE clients.id = notas_credito.client_id) WHERE client_supabase_id IS NULL AND client_id IS NOT NULL",
    "UPDATE notas_credito SET ticket_supabase_id = (SELECT supabase_id FROM tickets WHERE tickets.id = notas_credito.original_ticket_id) WHERE ticket_supabase_id IS NULL AND original_ticket_id IS NOT NULL",
    "UPDATE notas_credito SET cajero_supabase_id = (SELECT supabase_id FROM users WHERE users.id = notas_credito.cajero_id) WHERE cajero_supabase_id IS NULL AND cajero_id IS NOT NULL",
    "UPDATE inventory_transactions SET item_supabase_id = (SELECT supabase_id FROM inventory_items WHERE inventory_items.id = inventory_transactions.item_id) WHERE item_supabase_id IS NULL AND item_id IS NOT NULL",
    // v1.9 — FK supabase_id columns on tickets for sync
    'ALTER TABLE tickets ADD COLUMN client_supabase_id TEXT',
    'ALTER TABLE tickets ADD COLUMN seller_supabase_id TEXT',
    'ALTER TABLE tickets ADD COLUMN cajero_supabase_id TEXT',
    // v1.9 — FK supabase_id columns on other tables
    'ALTER TABLE ticket_items ADD COLUMN inventory_item_supabase_id TEXT',
    'ALTER TABLE cuadre_caja ADD COLUMN cajero_supabase_id TEXT',
    'ALTER TABLE caja_chica ADD COLUMN cajero_supabase_id TEXT',
    'ALTER TABLE caja_chica ADD COLUMN approved_by_supabase_id TEXT',
    'ALTER TABLE inventory_transactions ADD COLUMN user_supabase_id TEXT',
    // v1.9 — backfill FK supabase_ids
    "UPDATE tickets SET client_supabase_id = (SELECT supabase_id FROM clients WHERE clients.id = tickets.client_id) WHERE client_supabase_id IS NULL AND client_id IS NOT NULL",
    "UPDATE tickets SET seller_supabase_id = (SELECT supabase_id FROM sellers WHERE sellers.id = tickets.seller_id) WHERE seller_supabase_id IS NULL AND seller_id IS NOT NULL",
    "UPDATE tickets SET cajero_supabase_id = (SELECT supabase_id FROM users WHERE users.id = tickets.cajero_id) WHERE cajero_supabase_id IS NULL AND cajero_id IS NOT NULL",
    "UPDATE ticket_items SET inventory_item_supabase_id = (SELECT supabase_id FROM inventory_items WHERE inventory_items.id = ticket_items.inventory_item_id) WHERE inventory_item_supabase_id IS NULL AND inventory_item_id IS NOT NULL",
    // v1.9 — updated_at columns for sync re-push (so updates are re-synced, not just new rows)
    "ALTER TABLE services ADD COLUMN updated_at TEXT",
    "ALTER TABLE washers ADD COLUMN updated_at TEXT",
    "ALTER TABLE sellers ADD COLUMN updated_at TEXT",
    "ALTER TABLE clients ADD COLUMN updated_at TEXT",
    "ALTER TABLE inventory_items ADD COLUMN updated_at TEXT",
    "ALTER TABLE tickets ADD COLUMN updated_at TEXT",
    "ALTER TABLE empleados ADD COLUMN updated_at TEXT",
    "ALTER TABLE ncf_sequences ADD COLUMN updated_at TEXT",
    // Backfill updated_at — use created_at if available, else datetime('now')
    "UPDATE services SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL",
    "UPDATE washers SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL",
    "UPDATE sellers SET updated_at = datetime('now') WHERE updated_at IS NULL",
    "UPDATE clients SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL",
    "UPDATE inventory_items SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL",
    "UPDATE tickets SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL",
    "UPDATE empleados SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL",
    // v1.9.1 — updated_at for remaining synced tables (complete re-sync coverage)
    'ALTER TABLE ticket_items ADD COLUMN updated_at TEXT',
    'ALTER TABLE queue ADD COLUMN updated_at TEXT',
    'ALTER TABLE washer_commissions ADD COLUMN updated_at TEXT',
    'ALTER TABLE seller_commissions ADD COLUMN updated_at TEXT',
    'ALTER TABLE cajero_commissions ADD COLUMN updated_at TEXT',
    'ALTER TABLE credit_payments ADD COLUMN updated_at TEXT',
    'ALTER TABLE cuadre_caja ADD COLUMN updated_at TEXT',
    'ALTER TABLE caja_chica ADD COLUMN updated_at TEXT',
    'ALTER TABLE notas_credito ADD COLUMN updated_at TEXT',
    'ALTER TABLE inventory_transactions ADD COLUMN updated_at TEXT',
    'ALTER TABLE compras_607 ADD COLUMN updated_at TEXT',
    'ALTER TABLE categorias_servicio ADD COLUMN updated_at TEXT',
    'ALTER TABLE users ADD COLUMN updated_at TEXT',
    // Backfill updated_at for new tables
    "UPDATE ticket_items SET updated_at = datetime('now') WHERE updated_at IS NULL",
    "UPDATE queue SET updated_at = created_at WHERE updated_at IS NULL",
    "UPDATE washer_commissions SET updated_at = created_at WHERE updated_at IS NULL",
    "UPDATE seller_commissions SET updated_at = created_at WHERE updated_at IS NULL",
    "UPDATE cajero_commissions SET updated_at = created_at WHERE updated_at IS NULL",
    "UPDATE credit_payments SET updated_at = created_at WHERE updated_at IS NULL",
    "UPDATE cuadre_caja SET updated_at = datetime('now') WHERE updated_at IS NULL",
    "UPDATE caja_chica SET updated_at = created_at WHERE updated_at IS NULL",
    "UPDATE notas_credito SET updated_at = created_at WHERE updated_at IS NULL",
    "UPDATE inventory_transactions SET updated_at = created_at WHERE updated_at IS NULL",
    "UPDATE compras_607 SET updated_at = created_at WHERE updated_at IS NULL",
    "UPDATE categorias_servicio SET updated_at = datetime('now') WHERE updated_at IS NULL",
    "UPDATE users SET updated_at = created_at WHERE updated_at IS NULL",
    // Employee consolidation — role on empleados, employee_id on users, no_commission on services
    "ALTER TABLE empleados ADD COLUMN role TEXT DEFAULT 'none'",
    "ALTER TABLE empleados ADD COLUMN comision_pct REAL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN employee_id INTEGER",
    "ALTER TABLE services ADD COLUMN no_commission INTEGER DEFAULT 0",
    // v1.9.4 — per-role commission flags on services (lavador/vendedor/cajera independent toggles)
    "ALTER TABLE services ADD COLUMN commission_washer INTEGER DEFAULT 1",
    "ALTER TABLE services ADD COLUMN commission_seller INTEGER DEFAULT 1",
    "ALTER TABLE services ADD COLUMN commission_cashier INTEGER DEFAULT 1",
    // Backfill from existing is_wash/no_commission state
    "UPDATE services SET commission_washer = is_wash WHERE commission_washer IS NULL",
    "UPDATE services SET commission_seller = is_wash WHERE commission_seller IS NULL",
    "UPDATE services SET commission_cashier = 1 WHERE commission_cashier IS NULL",
    "UPDATE services SET commission_washer = 0, commission_seller = 0, commission_cashier = 0 WHERE no_commission = 1",
    // v1.9.5 — queue_deletions: supabase_id + updated_at for sync coverage
    "ALTER TABLE queue_deletions ADD COLUMN supabase_id TEXT",
    "ALTER TABLE queue_deletions ADD COLUMN updated_at TEXT",
    "UPDATE queue_deletions SET updated_at = deleted_at WHERE updated_at IS NULL",
    // v1.9.5 — payroll_runs: supabase_id + updated_at + empleado_supabase_id for sync coverage
    "ALTER TABLE payroll_runs ADD COLUMN supabase_id TEXT",
    "ALTER TABLE payroll_runs ADD COLUMN updated_at TEXT",
    "ALTER TABLE payroll_runs ADD COLUMN empleado_supabase_id TEXT",
    "UPDATE payroll_runs SET updated_at = created_at WHERE updated_at IS NULL",
    "UPDATE payroll_runs SET empleado_supabase_id = (SELECT supabase_id FROM empleados WHERE empleados.id = payroll_runs.empleado_id) WHERE empleado_supabase_id IS NULL",
    // v1.9.5 — salary_changes: empleado_supabase_id for clean FK sync
    "ALTER TABLE salary_changes ADD COLUMN empleado_supabase_id TEXT",
    "UPDATE salary_changes SET empleado_supabase_id = (SELECT supabase_id FROM empleados WHERE empleados.id = salary_changes.empleado_id) WHERE empleado_supabase_id IS NULL",
    // v1.9.5 — ecf_submissions: supabase_id + updated_at + ticket_supabase_id for sync coverage
    "ALTER TABLE ecf_submissions ADD COLUMN supabase_id TEXT",
    "ALTER TABLE ecf_submissions ADD COLUMN updated_at TEXT",
    "ALTER TABLE ecf_submissions ADD COLUMN ticket_supabase_id TEXT",
    "UPDATE ecf_submissions SET updated_at = submitted_at WHERE updated_at IS NULL",
    "UPDATE ecf_submissions SET ticket_supabase_id = (SELECT supabase_id FROM tickets WHERE tickets.id = ecf_submissions.ticket_id) WHERE ticket_supabase_id IS NULL",
    // v1.9.21 — owner activity_log (append-only audit feed)
    `CREATE TABLE IF NOT EXISTS activity_log (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id       TEXT NOT NULL,
      event_type        TEXT NOT NULL,
      severity          TEXT NOT NULL DEFAULT 'info',
      actor_user_id     INTEGER,
      actor_supabase_id TEXT,
      actor_name        TEXT,
      actor_role        TEXT,
      target_type       TEXT,
      target_id         TEXT,
      target_name       TEXT,
      amount            REAL,
      old_value         TEXT,
      new_value         TEXT,
      reason            TEXT,
      metadata          TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_log_event_type ON activity_log(event_type)`,
    // v1.9.22 — heal any app_settings rows previously poisoned with the
    // literal string 'undefined' or 'null' (from settingsUpdate's pre-fix
    // String(undefined) call). Most visible symptom: the printer dropdown
    // reverting to "Predeterminada" because cfg.printer === 'undefined'
    // doesn't match any <option value>.
    `DELETE FROM app_settings WHERE value IN ('undefined','null')`,
    // v2.0 — Restaurant Mode Phase 2: services + tickets columns for menu/KDS/floor-plan
    'ALTER TABLE services ADD COLUMN printer_route TEXT DEFAULT \'receipt\'',
    'ALTER TABLE services ADD COLUMN is_menu_item INTEGER DEFAULT 0',
    'ALTER TABLE services ADD COLUMN course TEXT',
    'ALTER TABLE services ADD COLUMN station TEXT',
    'ALTER TABLE tickets ADD COLUMN tip_amount REAL DEFAULT 0',
    'ALTER TABLE tickets ADD COLUMN fulfillment_type TEXT',
    'ALTER TABLE tickets ADD COLUMN mesa_id INTEGER',
    'ALTER TABLE tickets ADD COLUMN mesa_supabase_id TEXT',
    'ALTER TABLE tickets ADD COLUMN void_by TEXT',
    'ALTER TABLE tickets ADD COLUMN void_at TEXT',
    // v2.0 — ticket_items needs created_at for pull parity (web-created items include it)
    'ALTER TABLE ticket_items ADD COLUMN created_at TEXT',
    // v2.0 — Restaurant Mode tables are CREATE'd empty with AUTOINCREMENT ids;
    // rows get a supabase_id assigned at INSERT time via the usual helper, so
    // no UUID backfill UPDATE is needed here (would just log "no such table"
    // on first install since migrations run before the CREATE TABLE block).
    // v2.1 — Adelantos de nomina (salary advances)
    `CREATE TABLE IF NOT EXISTS adelantos (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_adelantos_empleado ON adelantos(empleado_id)`,
    `CREATE INDEX IF NOT EXISTS idx_adelantos_status   ON adelantos(status)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_adelantos_supabase_id ON adelantos(supabase_id)`,
    // v2.1 — updated_at trigger for adelantos
    `CREATE TRIGGER IF NOT EXISTS trg_adelantos_updated_at
     AFTER UPDATE ON adelantos FOR EACH ROW
     BEGIN UPDATE adelantos SET updated_at = datetime('now') WHERE id = NEW.id; END`,
    // v2.2 — Multi-vertical expansion: inventory_items columns for auto parts
    'ALTER TABLE inventory_items ADD COLUMN oem_part_number TEXT',
    'ALTER TABLE inventory_items ADD COLUMN compatibility TEXT',
    'ALTER TABLE inventory_items ADD COLUMN reorder_quantity INTEGER DEFAULT 0',
    'ALTER TABLE inventory_items ADD COLUMN supplier TEXT',
    // v2.2 — Multi-vertical expansion: 9 new tables
    `CREATE TABLE IF NOT EXISTS vehicles (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id         TEXT,
      vin                 TEXT,
      plate               TEXT,
      make                TEXT,
      model               TEXT,
      year                INTEGER,
      color               TEXT,
      mileage             INTEGER,
      client_id           INTEGER REFERENCES clients(id),
      client_supabase_id  TEXT,
      notes               TEXT,
      active              INTEGER NOT NULL DEFAULT 1,
      created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_supabase_id ON vehicles(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_vehicles_client ON vehicles(client_id)`,
    `CREATE INDEX IF NOT EXISTS idx_vehicles_plate  ON vehicles(plate)`,
    `CREATE TABLE IF NOT EXISTS service_bays (
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
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_service_bays_supabase_id ON service_bays(supabase_id)`,
    `CREATE TABLE IF NOT EXISTS work_orders (
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
      promised_date                     TEXT,
      completed_date                    TEXT,
      notes                             TEXT,
      created_at                        TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at                        TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_work_orders_supabase_id ON work_orders(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_work_orders_vehicle ON work_orders(vehicle_id)`,
    `CREATE INDEX IF NOT EXISTS idx_work_orders_status  ON work_orders(status)`,
    `CREATE TABLE IF NOT EXISTS work_order_items (
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
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_work_order_items_supabase_id ON work_order_items(supabase_id)`,
    `CREATE TABLE IF NOT EXISTS appointments (
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
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_supabase_id ON appointments(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_appointments_date     ON appointments(date)`,
    `CREATE INDEX IF NOT EXISTS idx_appointments_empleado ON appointments(empleado_id)`,
    `CREATE TABLE IF NOT EXISTS stylist_schedules (
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
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_stylist_schedules_supabase_id ON stylist_schedules(supabase_id)`,
    `CREATE TABLE IF NOT EXISTS loans (
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
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_loans_supabase_id ON loans(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_loans_client ON loans(client_id)`,
    `CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status)`,
    `CREATE TABLE IF NOT EXISTS loan_payments (
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
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_loan_payments_supabase_id ON loan_payments(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_loan_payments_loan ON loan_payments(loan_id)`,
    `CREATE TABLE IF NOT EXISTS pawn_items (
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
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_pawn_items_supabase_id ON pawn_items(supabase_id)`,
    // v2.3 — missing columns that Supabase has but SQLite doesn't (causes pull failures)
    'ALTER TABLE categorias_servicio ADD COLUMN active INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE salary_changes ADD COLUMN active INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE salary_changes ADD COLUMN updated_at TEXT',
    "UPDATE salary_changes SET updated_at = created_at WHERE updated_at IS NULL",
    'ALTER TABLE salary_changes ADD COLUMN supabase_id TEXT',
    "UPDATE salary_changes SET supabase_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE supabase_id IS NULL",
  ]
  for (const sql of migrations) {
    try { db.exec(sql) } catch (e) {
      if (!e.message?.includes('duplicate column') && !e.message?.includes('already exists') && !e.message?.includes('UNIQUE constraint')) {
        console.error('[db] Migration failed:', sql.substring(0, 80), '—', e.message)
      }
    }
  }

  // ── Employee consolidation backfill ──────────────────────────────────────
  // Backfill empleados.role from users (one-time)
  try {
    const needsBackfill = db.prepare("SELECT COUNT(*) as c FROM empleados WHERE role != 'none'").get()
    if (needsBackfill.c === 0) {
      // Match by cedula first (most reliable)
      db.exec(`
        UPDATE empleados SET role = (
          SELECT u.role FROM users u
          WHERE u.cedula IS NOT NULL AND u.cedula != '' AND u.cedula = empleados.cedula
          LIMIT 1
        ) WHERE cedula IS NOT NULL AND cedula != '' AND EXISTS (
          SELECT 1 FROM users u WHERE u.cedula IS NOT NULL AND u.cedula != '' AND u.cedula = empleados.cedula
        )
      `)
      // Fallback: match by name
      db.exec(`
        UPDATE empleados SET role = (
          SELECT u.role FROM users u WHERE LOWER(TRIM(u.name)) = LOWER(TRIM(empleados.nombre))
          LIMIT 1
        ) WHERE role = 'none' AND EXISTS (
          SELECT 1 FROM users u WHERE LOWER(TRIM(u.name)) = LOWER(TRIM(empleados.nombre))
        )
      `)
      // Default mapping for unmatched
      db.exec("UPDATE empleados SET role = 'cashier' WHERE role = 'none' AND tipo = 'cajero'")
      db.exec("UPDATE empleados SET role = 'none' WHERE role = 'none' AND tipo IN ('lavador', 'vendedor')")
    }
  } catch (e) { console.error('Employee role backfill error:', e.message) }

  // Backfill users.employee_id
  try {
    const needsLink = db.prepare("SELECT COUNT(*) as c FROM users WHERE employee_id IS NOT NULL").get()
    if (needsLink.c === 0) {
      // Match by cedula
      db.exec(`
        UPDATE users SET employee_id = (
          SELECT e.id FROM empleados e
          WHERE e.cedula IS NOT NULL AND e.cedula != '' AND e.cedula = users.cedula
          LIMIT 1
        ) WHERE cedula IS NOT NULL AND cedula != '' AND EXISTS (
          SELECT 1 FROM empleados e WHERE e.cedula IS NOT NULL AND e.cedula != '' AND e.cedula = users.cedula
        )
      `)
      // Fallback: match by name
      db.exec(`
        UPDATE users SET employee_id = (
          SELECT e.id FROM empleados e WHERE LOWER(TRIM(e.nombre)) = LOWER(TRIM(users.name))
          LIMIT 1
        ) WHERE employee_id IS NULL AND EXISTS (
          SELECT 1 FROM empleados e WHERE LOWER(TRIM(e.nombre)) = LOWER(TRIM(users.name))
        )
      `)
    }
  } catch (e) { console.error('User employee_id backfill error:', e.message) }

  // v1.9.22 — backfill empleados for every washer/seller without one.
  // Otherwise legacy car-wash clients have zero Nómina visibility for their
  // lavadores because Empleados screen reads from empleados, not washers.
  try {
    db.exec(`
      INSERT INTO empleados(nombre, tipo, ref_id, salary, start_date, cedula, phone, active, supabase_id, updated_at)
      SELECT w.name, 'lavador', w.id, 0,
             COALESCE(w.start_date, date('now')),
             w.cedula, w.phone, w.active,
             lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
             datetime('now')
      FROM washers w
      WHERE NOT EXISTS (SELECT 1 FROM empleados e WHERE e.ref_id = w.id AND e.tipo = 'lavador')
    `)
    db.exec(`
      INSERT INTO empleados(nombre, tipo, ref_id, salary, start_date, cedula, phone, active, supabase_id, updated_at)
      SELECT s.name, 'vendedor', s.id, 0,
             COALESCE(s.start_date, date('now')),
             s.cedula, s.phone, s.active,
             lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
             datetime('now')
      FROM sellers s
      WHERE NOT EXISTS (SELECT 1 FROM empleados e WHERE e.ref_id = s.id AND e.tipo = 'vendedor')
    `)
  } catch (e) { console.error('[db] washer/seller → empleado backfill:', e.message) }

  // v2.0 — Restaurant Mode Phase 2: mesas, modificadores, service_modificadores,
  // ticket_item_modificadores, kds_events. CREATE'd here (before indexes/triggers)
  // so that the supabase_id indexes and updated_at triggers below can reference them.
  db.exec(`CREATE TABLE IF NOT EXISTS mesas (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                 TEXT,
    name                        TEXT NOT NULL,
    zone                        TEXT,
    capacity                    INTEGER DEFAULT 4,
    status                      TEXT NOT NULL DEFAULT 'libre',
    waiter_empleado_id          INTEGER,
    waiter_empleado_supabase_id TEXT,
    guests_count                INTEGER DEFAULT 0,
    seated_at                   TEXT,
    sort_order                  INTEGER DEFAULT 0,
    active                      INTEGER NOT NULL DEFAULT 1,
    created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.exec(`CREATE TABLE IF NOT EXISTS modificadores (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id       TEXT,
    name              TEXT NOT NULL,
    group_name        TEXT,
    price_delta       REAL NOT NULL DEFAULT 0,
    min_select        INTEGER DEFAULT 0,
    max_select        INTEGER DEFAULT 1,
    default_selected  INTEGER NOT NULL DEFAULT 0,
    sort_order        INTEGER DEFAULT 0,
    active            INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.exec(`CREATE TABLE IF NOT EXISTS service_modificadores (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id              TEXT,
    service_id               INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    service_supabase_id      TEXT,
    modificador_id           INTEGER NOT NULL REFERENCES modificadores(id) ON DELETE CASCADE,
    modificador_supabase_id  TEXT,
    is_required              INTEGER NOT NULL DEFAULT 0,
    created_at               TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.exec(`CREATE TABLE IF NOT EXISTS ticket_item_modificadores (
    id                         INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                TEXT,
    ticket_item_id             INTEGER NOT NULL REFERENCES ticket_items(id) ON DELETE CASCADE,
    ticket_item_supabase_id    TEXT,
    modificador_id             INTEGER REFERENCES modificadores(id) ON DELETE SET NULL,
    modificador_supabase_id    TEXT,
    name_snapshot              TEXT NOT NULL,
    price_delta_snapshot       REAL NOT NULL DEFAULT 0,
    created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                 TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.exec(`CREATE TABLE IF NOT EXISTS kds_events (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id              TEXT,
    ticket_item_id           INTEGER NOT NULL REFERENCES ticket_items(id) ON DELETE CASCADE,
    ticket_item_supabase_id  TEXT,
    mesa_id                  INTEGER,
    mesa_supabase_id         TEXT,
    station                  TEXT,
    status                   TEXT NOT NULL DEFAULT 'fired',
    fired_at                 TEXT NOT NULL DEFAULT (datetime('now')),
    started_at               TEXT,
    ready_at                 TEXT,
    bumped_at                TEXT,
    created_at               TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  // v1.6 — unique indexes on supabase_id (safe to run multiple times)
  const sidIndexes = [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_services_supabase_id ON services(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_washers_supabase_id ON washers(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_sellers_supabase_id ON sellers(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_supabase_id ON clients(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_supabase_id ON inventory_items(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_ncf_sequences_supabase_id ON ncf_sequences(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_empleados_supabase_id ON empleados(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_categorias_servicio_supabase_id ON categorias_servicio(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_supabase_id ON tickets(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_items_supabase_id ON ticket_items(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_supabase_id ON queue(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_washer_commissions_supabase_id ON washer_commissions(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_commissions_supabase_id ON seller_commissions(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_cajero_commissions_supabase_id ON cajero_commissions(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_payments_supabase_id ON credit_payments(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_cuadre_caja_supabase_id ON cuadre_caja(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_caja_chica_supabase_id ON caja_chica(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_notas_credito_supabase_id ON notas_credito(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_transactions_supabase_id ON inventory_transactions(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_compras_607_supabase_id ON compras_607(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_supabase_id ON users(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_log_supabase_id ON activity_log(supabase_id)',
    // v2.0 — Restaurant Mode Phase 2 unique + lookup indexes
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_mesas_supabase_id ON mesas(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_modificadores_supabase_id ON modificadores(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_service_modificadores_supabase_id ON service_modificadores(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_item_modificadores_supabase_id ON ticket_item_modificadores(supabase_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_kds_events_supabase_id ON kds_events(supabase_id)',
    'CREATE INDEX IF NOT EXISTS idx_tim_ticket_item ON ticket_item_modificadores(ticket_item_id)',
    'CREATE INDEX IF NOT EXISTS idx_sm_service ON service_modificadores(service_id)',
    'CREATE INDEX IF NOT EXISTS idx_kds_events_status ON kds_events(status)',
    'CREATE INDEX IF NOT EXISTS idx_kds_events_ticket_item ON kds_events(ticket_item_id)',
  ]
  for (const sql of sidIndexes) {
    try { db.exec(sql) } catch (e) {
      if (!e.message?.includes('already exists')) {
        console.error('[db] Index creation failed:', sql.substring(0, 80), '—', e.message)
      }
    }
  }

  // v1.9 — auto-update updated_at via triggers (so sync can detect changed rows)
  const triggerTables = ['services', 'washers', 'sellers', 'clients', 'inventory_items', 'tickets', 'empleados', 'ncf_sequences', 'ticket_items', 'queue', 'washer_commissions', 'seller_commissions', 'cajero_commissions', 'credit_payments', 'cuadre_caja', 'caja_chica', 'notas_credito', 'inventory_transactions', 'compras_607', 'categorias_servicio', 'users', 'salary_changes', 'payroll_runs', 'ecf_submissions', 'queue_deletions', 'activity_log', 'mesas', 'modificadores', 'service_modificadores', 'ticket_item_modificadores', 'kds_events', 'vehicles', 'service_bays', 'work_orders', 'work_order_items', 'appointments', 'stylist_schedules', 'loans', 'loan_payments', 'pawn_items']
  for (const t of triggerTables) {
    try {
      db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${t}_updated_at AFTER UPDATE ON ${t} FOR EACH ROW
        WHEN NEW.updated_at IS OLD.updated_at OR NEW.updated_at IS NULL
        BEGIN UPDATE ${t} SET updated_at = datetime('now') WHERE id = NEW.id; END`)
    } catch (e) {
      if (!e.message?.includes('already exists')) console.error(`[db] Trigger ${t}:`, e.message)
    }
  }

  // ── Dedup washers & sellers (fix: INSERT OR IGNORE had no UNIQUE constraint) ─
  // Reassign FK references from duplicate rows to the original (lowest id) before deleting.
  try {
    const dupWashers = db.prepare(`SELECT w.id AS dup_id, keeper.id AS keep_id
      FROM washers w JOIN (SELECT MIN(id) AS id, name FROM washers GROUP BY name) keeper
      ON w.name = keeper.name WHERE w.id != keeper.id`).all()
    for (const { dup_id, keep_id } of dupWashers) {
      db.prepare('UPDATE washer_commissions SET washer_id=? WHERE washer_id=?').run(keep_id, dup_id)
      db.prepare('UPDATE queue SET washer_id=? WHERE washer_id=?').run(keep_id, dup_id)
      // Remap washer IDs inside the tickets.washer_ids JSON array
      const rows = db.prepare("SELECT id, washer_ids FROM tickets WHERE washer_ids LIKE ?").all(`%${dup_id}%`)
      for (const row of rows) {
        try {
          const ids = JSON.parse(row.washer_ids || '[]')
          const fixed = ids.map(id => id === dup_id ? keep_id : id)
          db.prepare('UPDATE tickets SET washer_ids=? WHERE id=?').run(JSON.stringify(fixed), row.id)
        } catch { /* skip malformed JSON */ }
      }
    }
    db.exec(`DELETE FROM washers WHERE id NOT IN (SELECT MIN(id) FROM washers GROUP BY name)`)

    const dupSellers = db.prepare(`SELECT s.id AS dup_id, keeper.id AS keep_id
      FROM sellers s JOIN (SELECT MIN(id) AS id, name FROM sellers GROUP BY name) keeper
      ON s.name = keeper.name WHERE s.id != keeper.id`).all()
    for (const { dup_id, keep_id } of dupSellers) {
      db.prepare('UPDATE tickets SET seller_id=? WHERE seller_id=?').run(keep_id, dup_id)
      db.prepare('UPDATE users SET vendedor_id=? WHERE vendedor_id=?').run(keep_id, dup_id)
    }
    db.exec(`DELETE FROM sellers WHERE id NOT IN (SELECT MIN(id) FROM sellers GROUP BY name)`)
  } catch (e) { if (e.message && !e.message.includes('no such table')) console.error('[db] Dedup error:', e.message) }
  // Add unique index so INSERT OR IGNORE works correctly going forward
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_washers_name ON washers(name)`) } catch { /* already exists */ }
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sellers_name ON sellers(name)`) } catch { /* already exists */ }

  // Seller & Cajero commissions tables (v1.2)
  db.exec(`CREATE TABLE IF NOT EXISTS seller_commissions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id       INTEGER NOT NULL REFERENCES sellers(id),
    ticket_id       INTEGER NOT NULL REFERENCES tickets(id),
    base_amount     REAL    NOT NULL,
    commission_pct  REAL    NOT NULL,
    commission_amount REAL  NOT NULL,
    paid            INTEGER NOT NULL DEFAULT 0,
    paid_at         TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS cajero_commissions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    cajero_id       INTEGER NOT NULL REFERENCES users(id),
    ticket_id       INTEGER NOT NULL REFERENCES tickets(id),
    base_amount     REAL    NOT NULL,
    commission_pct  REAL    NOT NULL,
    commission_amount REAL  NOT NULL,
    paid            INTEGER NOT NULL DEFAULT 0,
    paid_at         TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )`)

  // RNC contribuyentes — full DGII database + API lookup cache
  db.exec(`CREATE TABLE IF NOT EXISTS rnc_contribuyentes (
    rnc              TEXT PRIMARY KEY,
    nombre           TEXT NOT NULL DEFAULT '',
    nombre_comercial TEXT         DEFAULT '',
    actividad        TEXT         DEFAULT '',
    estado           TEXT         DEFAULT 'ACTIVO',
    regimen          TEXT         DEFAULT 'NORMAL',
    provincia        TEXT         DEFAULT '',
    source           TEXT NOT NULL DEFAULT 'api',
    synced_at        TEXT NOT NULL
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_rnc_contrib ON rnc_contribuyentes(rnc)')

  // e-CF offline queue — stores failed submissions for auto-retry (DGII 72h contingency)
  db.exec(`CREATE TABLE IF NOT EXISTS ecf_queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    url_path    TEXT NOT NULL,
    body_json   TEXT NOT NULL,
    token       TEXT NOT NULL DEFAULT '',
    xml_signed  TEXT,
    encf        TEXT,
    tipo_ecf    TEXT,
    environment TEXT NOT NULL DEFAULT 'testecf',
    attempts    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_tried  TEXT
  )`)

  // e-CF submission log — tracks every e-CF sent to DGII with status
  db.exec(`CREATE TABLE IF NOT EXISTS ecf_submissions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    encf           TEXT NOT NULL,
    tipo_ecf       TEXT NOT NULL,
    ticket_id      INTEGER,
    xml_hash       TEXT,
    track_id       TEXT,
    dgii_status    INTEGER DEFAULT 3,
    dgii_message   TEXT,
    security_code  TEXT,
    signature_date TEXT,
    submitted_at   TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at   TEXT,
    xml_path       TEXT,
    environment    TEXT NOT NULL DEFAULT 'testecf',
    UNIQUE(encf, environment)
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_ecf_sub_track ON ecf_submissions(track_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_ecf_sub_ticket ON ecf_submissions(ticket_id)')

  // Inventory items + transaction log
  db.exec(`CREATE TABLE IF NOT EXISTS inventory_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sku          TEXT UNIQUE,
    name         TEXT NOT NULL,
    category     TEXT NOT NULL DEFAULT '',
    quantity     INTEGER NOT NULL DEFAULT 0,
    min_quantity INTEGER NOT NULL DEFAULT 5,
    price        REAL NOT NULL DEFAULT 0,
    cost         REAL NOT NULL DEFAULT 0,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS inventory_transactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    INTEGER NOT NULL REFERENCES inventory_items(id),
    type       TEXT NOT NULL,
    delta      INTEGER NOT NULL,
    notes      TEXT NOT NULL DEFAULT '',
    user_id    INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_inv_item ON inventory_transactions(item_id)')

  // Empleados — unified payroll table for all worker types.
  // No CHECK on `tipo` — the UI enforces valid values (lavador/vendedor/cajero/servicio/hybrid).
  // Adding new tipos used to require an ALTER CHECK which SQLite doesn't support,
  // so v1.9.15+ drops the constraint and leaves validation to the renderer layer.
  db.exec(`CREATE TABLE IF NOT EXISTS empleados (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre      TEXT NOT NULL,
    tipo        TEXT NOT NULL,
    ref_id      INTEGER,
    salary      REAL NOT NULL DEFAULT 0,
    start_date  TEXT NOT NULL,
    cedula      TEXT,
    phone       TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  // v1.9.15 — migrate existing empleados tables off the old CHECK(tipo IN ('lavador','vendedor','cajero'))
  // constraint so new tipos ('servicio', 'hybrid') can be inserted. SQLite can't ALTER a CHECK,
  // so we recreate the table and copy data. Idempotent: only runs if the old constraint is present.
  try {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='empleados'").get()?.sql || ''
    if (tableSql.includes("CHECK(tipo IN ('lavador','vendedor','cajero'))") || tableSql.includes('CHECK (tipo IN')) {
      console.log('[db] Migrating empleados to remove tipo CHECK constraint…')
      db.exec('PRAGMA foreign_keys = OFF')
      db.exec('BEGIN TRANSACTION')
      try {
        // Build new table with same columns as existing (preserve any ALTER-added cols)
        const cols = db.prepare('PRAGMA table_info(empleados)').all()
        const colNames = cols.map(c => c.name).join(', ')
        db.exec(`CREATE TABLE empleados_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          nombre      TEXT NOT NULL,
          tipo        TEXT NOT NULL,
          ref_id      INTEGER,
          salary      REAL NOT NULL DEFAULT 0,
          start_date  TEXT NOT NULL,
          cedula      TEXT,
          phone       TEXT,
          active      INTEGER NOT NULL DEFAULT 1,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )`)
        // Add the same ALTER-added columns to the new table
        const baseCols = ['id','nombre','tipo','ref_id','salary','start_date','cedula','phone','active','created_at']
        for (const c of cols) {
          if (baseCols.includes(c.name)) continue
          const typeDef = c.type || 'TEXT'
          const nullDef = c.notnull ? ' NOT NULL' : ''
          const defDef = c.dflt_value != null ? ` DEFAULT ${c.dflt_value}` : ''
          db.exec(`ALTER TABLE empleados_new ADD COLUMN ${c.name} ${typeDef}${nullDef}${defDef}`)
        }
        db.exec(`INSERT INTO empleados_new (${colNames}) SELECT ${colNames} FROM empleados`)
        db.exec('DROP TABLE empleados')
        db.exec('ALTER TABLE empleados_new RENAME TO empleados')
        db.exec('COMMIT')
        console.log('[db] empleados migration complete — CHECK constraint removed')
      } catch (e) {
        db.exec('ROLLBACK')
        console.error('[db] empleados migration failed:', e.message)
      }
      db.exec('PRAGMA foreign_keys = ON')
    }
  } catch (e) { console.error('[db] empleados migration check failed:', e.message) }

  // v1.9.18 — heal businesses.logo rows stored as UTF-8 bytes of a data URL
  // string (bug: empresaSave used to write the FileReader data URL directly into
  // the BLOB, so the "bytes" were literal "data:image/png;base64,..." text).
  // sync.js then uploaded that text to Supabase Storage as a fake .png, breaking
  // the web preview. Detect and decode in place so sync pushes a real PNG/JPEG
  // on the next tick.
  try {
    const row = db.prepare('SELECT logo FROM businesses WHERE id=1').get()
    if (row?.logo) {
      const buf = Buffer.isBuffer(row.logo) ? row.logo : Buffer.from(row.logo)
      const peek = buf.slice(0, 32).toString('utf8')
      if (peek.startsWith('data:image/')) {
        const full = buf.toString('utf8')
        const comma = full.indexOf(',')
        if (comma > 0) {
          const realBytes = Buffer.from(full.slice(comma + 1), 'base64')
          db.prepare('UPDATE businesses SET logo=? WHERE id=1').run(realBytes)
          // Invalidate the cached logo hash so sync.js re-uploads to Supabase Storage
          db.prepare("DELETE FROM app_settings WHERE key='logo_synced_hash'").run()
          db.prepare("DELETE FROM app_settings WHERE key='logo_synced_url'").run()
          console.log('[db] Healed businesses.logo — decoded stored data URL to real image bytes')
        }
      }
    }
  } catch (e) { console.error('[db] logo heal migration failed:', e.message) }

  // Payroll runs — paycheck history per employee (v1.4, extended v1.5)
  // Fresh installs get the full schema; existing DBs pick up new columns via ALTER migrations above.
  db.exec(`CREATE TABLE IF NOT EXISTS payroll_runs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    empleado_id      INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
    period_start     TEXT    NOT NULL,
    period_end       TEXT    NOT NULL,
    base             REAL    NOT NULL DEFAULT 0,
    commissions      REAL    NOT NULL DEFAULT 0,
    bonuses          REAL    NOT NULL DEFAULT 0,
    sfs_employee     REAL    NOT NULL DEFAULT 0,
    afp_employee     REAL    NOT NULL DEFAULT 0,
    isr              REAL    NOT NULL DEFAULT 0,
    other_deductions REAL    NOT NULL DEFAULT 0,
    deductions       REAL    NOT NULL DEFAULT 0,
    sfs_employer     REAL    NOT NULL DEFAULT 0,
    afp_employer     REAL    NOT NULL DEFAULT 0,
    infotep_employer REAL    NOT NULL DEFAULT 0,
    net              REAL    NOT NULL,
    notes            TEXT,
    paid_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    paid_by          INTEGER REFERENCES users(id),
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_payroll_runs_empleado ON payroll_runs(empleado_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_payroll_runs_paid_at ON payroll_runs(paid_at)')

  // Payroll settings — per-business config for pay cycle, TSS/ISR rates, caps (v1.5)
  db.exec(`CREATE TABLE IF NOT EXISTS payroll_settings (
    id                    INTEGER PRIMARY KEY,
    business_id           INTEGER NOT NULL DEFAULT 1,
    pay_cycle             TEXT NOT NULL DEFAULT 'quincenal',
    sfs_employee_rate     REAL NOT NULL DEFAULT 0.0304,
    afp_employee_rate     REAL NOT NULL DEFAULT 0.0287,
    sfs_employer_rate     REAL NOT NULL DEFAULT 0.0709,
    afp_employer_rate     REAL NOT NULL DEFAULT 0.0710,
    infotep_employer_rate REAL NOT NULL DEFAULT 0.01,
    sfs_monthly_cap       REAL NOT NULL DEFAULT 232230,
    afp_monthly_cap       REAL NOT NULL DEFAULT 464460,
    isr_enabled           INTEGER NOT NULL DEFAULT 1,
    isr_brackets          TEXT NOT NULL DEFAULT '[[0,416220,0],[416220,624329,0.15],[624329,867123,0.20],[867123,999999999,0.25]]',
    navidad_enabled       INTEGER NOT NULL DEFAULT 1,
    vacation_days         INTEGER NOT NULL DEFAULT 14,
    daily_divisor         REAL NOT NULL DEFAULT 23.83,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  // Ensure a default row exists (business_id=1, single-tenant on desktop)
  db.prepare(`INSERT OR IGNORE INTO payroll_settings (id, business_id) VALUES (1, 1)`).run()

  // Salary changes — audit log for raises and cuts (v1.5)
  db.exec(`CREATE TABLE IF NOT EXISTS salary_changes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    empleado_id    INTEGER NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
    old_salary     REAL NOT NULL,
    new_salary     REAL NOT NULL,
    effective_date TEXT NOT NULL,
    reason         TEXT,
    changed_by     INTEGER REFERENCES users(id),
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_salary_changes_empleado ON salary_changes(empleado_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_salary_changes_effective ON salary_changes(empleado_id, effective_date)')
  // Add supabase_id + updated_at for sync compliance (v1.9.3)
  try { db.exec('ALTER TABLE salary_changes ADD COLUMN supabase_id TEXT') } catch {}
  try { db.exec('ALTER TABLE salary_changes ADD COLUMN updated_at TEXT') } catch {}

  // Backfill: ensure every employee has at least one salary_changes row (initial salary)
  // Single statement — no JS loop, generates supabase_id inline via hex(randomblob(16))
  db.prepare(`
    INSERT OR IGNORE INTO salary_changes
      (empleado_id, old_salary, new_salary, effective_date, reason, supabase_id)
    SELECT id, 0, salary, COALESCE(start_date, '2020-01-01'),
           'initial_salary', hex(randomblob(16))
    FROM empleados
    WHERE salary > 0
      AND id NOT IN (SELECT empleado_id FROM salary_changes)
  `).run()
  // Backfill supabase_id on any pre-existing salary_changes rows that lack one
  db.prepare(`UPDATE salary_changes SET supabase_id = hex(randomblob(16)) WHERE supabase_id IS NULL`).run()

  // 607 — Compras y gastos de proveedores
  db.exec(`CREATE TABLE IF NOT EXISTS compras_607 (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    rnc_proveedor    TEXT NOT NULL DEFAULT '',
    nombre_proveedor TEXT NOT NULL DEFAULT '',
    tipo_ncf         TEXT NOT NULL DEFAULT 'B01',
    ncf              TEXT NOT NULL DEFAULT '',
    ncf_modificado   TEXT         DEFAULT '',
    fecha_ncf        TEXT NOT NULL,
    fecha_pago       TEXT         DEFAULT '',
    monto_servicios  REAL NOT NULL DEFAULT 0,
    monto_bienes     REAL NOT NULL DEFAULT 0,
    total            REAL NOT NULL DEFAULT 0,
    itbis_facturado  REAL NOT NULL DEFAULT 0,
    itbis_retenido   REAL NOT NULL DEFAULT 0,
    retencion_renta  REAL NOT NULL DEFAULT 0,
    forma_pago       TEXT NOT NULL DEFAULT 'efectivo',
    notas            TEXT         DEFAULT '',
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_compras607_fecha ON compras_607(fecha_ncf)')

  db.exec(`CREATE TABLE IF NOT EXISTS price_changes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id       INTEGER NOT NULL REFERENCES tickets(id),
    ticket_item_id  INTEGER NOT NULL REFERENCES ticket_items(id),
    item_name       TEXT    NOT NULL DEFAULT '',
    old_price       REAL    NOT NULL,
    new_price       REAL    NOT NULL,
    reason          TEXT    NOT NULL,
    authorized_by   INTEGER NOT NULL REFERENCES users(id),
    authorizer_name TEXT    NOT NULL DEFAULT '',
    changed_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_price_changes_ticket ON price_changes(ticket_id)')

  db.exec(`CREATE TABLE IF NOT EXISTS queue_deletions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_id    INTEGER NOT NULL,
    ticket_id   INTEGER,
    doc_number  TEXT DEFAULT '',
    deleted_by  TEXT NOT NULL DEFAULT 'unknown',
    deleted_at  TEXT NOT NULL DEFAULT (datetime('now')),
    reason      TEXT DEFAULT 'manual'
  )`)

  // Performance indexes for report queries at scale
  db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_client ON tickets(client_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_cajero ON tickets(cajero_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_ticket_items_ticket ON ticket_items(ticket_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_credit_pay_date ON credit_payments(created_at)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_credit_pay_client ON credit_payments(client_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_cuadre_date ON cuadre_caja(date)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_cuadre_cajero ON cuadre_caja(cajero_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_commissions_date ON washer_commissions(created_at)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_commissions_washer ON washer_commissions(washer_id)')

  // Ensure all sequence types exist in ncf_sequences (INSERT OR IGNORE — never overwrites existing)
  const ECF_SEED = [
    // Legacy NCF (B01/B02) — valid until May 2026
    { type: 'B01', prefix: 'B01', enabled: 1 },
    { type: 'B02', prefix: 'B02', enabled: 1 },
    // e-CF (electronic, mandatory from May 2026)
    { type: 'E31', prefix: 'E310', enabled: 1 },
    { type: 'E32', prefix: 'E320', enabled: 1 },
    { type: 'E33', prefix: 'E330', enabled: 0 },
    { type: 'E34', prefix: 'E340', enabled: 1 },
    { type: 'E41', prefix: 'E410', enabled: 0 },
    { type: 'E43', prefix: 'E430', enabled: 0 },
    { type: 'E44', prefix: 'E440', enabled: 0 },
    { type: 'E45', prefix: 'E450', enabled: 0 },
    { type: 'E46', prefix: 'E460', enabled: 0 },
    { type: 'E47', prefix: 'E470', enabled: 0 },
  ]
  const insertECF = db.prepare(
    'INSERT OR IGNORE INTO ncf_sequences(type,prefix,current_number,limit_number,active,enabled) VALUES(?,?,0,500,1,?)'
  )
  for (const s of ECF_SEED) insertECF.run(s.type, s.prefix, s.enabled)

  // Seed default services if none exist — prevents FK failures when POS falls back to DEMO_SERVICES
  // (DEMO_SERVICES uses hardcoded IDs 1-17; without real rows those IDs fail ticket_items FK check)
  const svcCount = db.prepare('SELECT COUNT(*) as n FROM services').get()
  if (svcCount.n === 0) {
    const insDefSvc = db.prepare(`INSERT OR IGNORE INTO services
      (id,name,name_en,category,price,aplica_itbis,is_wash,active,sort_order)
      VALUES (?,?,?,?,?,1,?,1,?)`)
    const defServices = [
      [1,  'Lavado Básico',      'Basic Wash',        'Lavado',       500,  1, 1],
      [2,  'Lavado Completo',    'Full Wash',         'Lavado',       800,  1, 2],
      [3,  'Lavado de Motor',    'Engine Wash',       'Lavado',       1200, 1, 3],
      [4,  'Lavado Jeepeta',     'SUV Wash',          'Lavado',       1000, 1, 4],
      [5,  'Lavado Camión',      'Truck Wash',        'Lavado',       1800, 1, 5],
      [6,  'Aromatizante',       'Air Freshener',     'Adicionales',  150,  1, 1],
      [7,  'Brillo de Gomas',    'Tire Shine',        'Adicionales',  200,  1, 2],
      [8,  'Aspirado Interior',  'Interior Vacuum',   'Adicionales',  400,  1, 3],
      [9,  'Ozono',              'Ozone Treatment',   'Adicionales',  1200, 1, 4],
      [10, 'Lavado + Cera',      'Wash + Wax',        'Detallado',    2000, 1, 1],
      [11, 'Lavado + Aspirado',  'Wash + Vacuum',     'Detallado',    1100, 1, 2],
      [12, 'Detailing Completo', 'Full Detailing',    'Detallado',    4500, 1, 3],
      [13, 'Agua Fría',          'Cold Water',        'Bebidas',      50,   0, 1],
      [14, 'Refresco',           'Soda',              'Bebidas',      100,  0, 2],
      [15, 'Café',               'Coffee',            'Bebidas',      75,   0, 3],
      [16, 'Papitas',            'Chips',             'Bebidas',      80,   0, 4],
      [17, 'Galletas',           'Cookies',           'Bebidas',      60,   0, 5],
    ]
    db.transaction(() => defServices.forEach(r => insDefSvc.run(...r)))()
  }

  // Seed if empty — DEV ONLY (skip in packaged production builds)
  const isProd = typeof process !== 'undefined' && process.resourcesPath && !process.defaultApp
  const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get()
  if (userCount.n === 0 && !isProd && fs.existsSync(seedPath)) {
    try {
      const seed = require(seedPath)
      seed(db)
    } catch (err) {
      console.error('[SEED ERROR]', err.message, err.stack)
    }
  }

  return true
}

// ── CONFIGURACION ─────────────────────────────────────────────────────────────
function configGet(key) {
  if (!db) return null
  const row = db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(key)
  return row?.valor ?? null
}
function configSet(key, value) {
  if (!db) return
  db.prepare('INSERT OR REPLACE INTO configuracion(clave,valor) VALUES(?,?)').run(key, String(value))
}

// ── EMPRESA ───────────────────────────────────────────────────────────────────
function empresaGet() {
  if (!db) return null
  // Setup is complete only when configuracion.setup_complete = '1'
  if (configGet('setup_complete') !== '1') return null
  const row = db.prepare('SELECT id,name,rnc,address,phone,email,logo,settings,plan FROM businesses WHERE id=1').get() ?? null
  if (row && row.logo) {
    // `logo` is a BLOB. Existing rows store either:
    //   - the UTF-8 bytes of a "data:image/...;base64,..." string (new saves), or
    //   - raw binary bytes of the image file (legacy / imports).
    // We normalise both paths to a string data-URL so callers in the renderer
    // can just drop `row.logo` straight into an <img src> or pass to the
    // thermal printer's buildLogoEscPos without any buffer gymnastics.
    const buf = Buffer.isBuffer(row.logo) ? row.logo : Buffer.from(row.logo)
    // Peek the first 32 bytes — if it already starts with "data:image/", it's a stored data URL.
    const peek = buf.slice(0, 32).toString('utf8')
    if (peek.startsWith('data:image/')) {
      row.logo = buf.toString('utf8')
    } else {
      // Raw image bytes — detect mime and wrap.
      let mime = 'image/png'
      if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) mime = 'image/jpeg'
      else if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) mime = 'image/gif'
      else if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45) mime = 'image/webp'
      row.logo = `data:${mime};base64,${buf.toString('base64')}`
    }
  }
  return row
}
function empresaSave(data) {
  if (!db) return
  const allowed = ['name', 'rnc', 'address', 'phone', 'email', 'logo', 'settings', 'plan']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return

  // Normalise the logo field. The renderer sends it as a `data:image/...;base64,...`
  // string from FileReader. If we just store that as-is, SQLite writes the UTF-8
  // bytes of the TEXT into the BLOB — then electron/sync.js::pushBusinessMeta reads
  // those bytes and uploads them to Supabase Storage as if they were a real PNG,
  // producing a broken image on the web. Decode to real image bytes here so every
  // downstream consumer (sync, printer, admin preview via empresaGet) gets a proper
  // binary buffer.
  if ('logo' in patch) {
    const v = patch.logo
    if (!v) {
      patch.logo = null
    } else if (typeof v === 'string' && v.startsWith('data:image/')) {
      const comma = v.indexOf(',')
      const b64 = comma >= 0 ? v.slice(comma + 1) : ''
      try { patch.logo = Buffer.from(b64, 'base64') } catch { patch.logo = null }
    } else if (Buffer.isBuffer(v)) {
      // Already a buffer — pass through (legacy/direct callers)
    } else if (v instanceof Uint8Array) {
      patch.logo = Buffer.from(v)
    } else {
      // Unknown shape — don't clobber existing logo
      delete patch.logo
    }
  }

  const exists = db.prepare('SELECT id FROM businesses WHERE id=1').get()
  if (exists) {
    const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
    db.prepare(`UPDATE businesses SET ${fields} WHERE id=1`).run(patch)
  } else {
    const cols = Object.keys(patch)
    const placeholders = cols.map(k => `@${k}`).join(',')
    db.prepare(`INSERT INTO businesses(id,${cols.join(',')}) VALUES(1,${placeholders})`).run(patch)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex')
}
function getSetting(key) {
  if (!db) return null
  const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key)
  return row?.value ?? null
}
function setSetting(key, value) {
  if (!db) return
  db.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)').run(key, String(value))
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
function settingsGet() {
  if (!db) return {}
  const rows = db.prepare('SELECT key,value FROM app_settings').all()
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}
function settingsUpdate(obj) {
  if (!db) return
  const stmt = db.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)')
  const run  = db.transaction(() => {
    for (const [k, v] of Object.entries(obj)) {
      // Skip undefined/null so we never poison a setting with the literal
      // string 'undefined'. An empty string is still a valid stored value.
      if (v === undefined || v === null) continue
      stmt.run(k, String(v))
    }
  })
  run()
}

// ── USERS / AUTH ──────────────────────────────────────────────────────────────
function authByPin(pin) {
  if (!db) return null
  const hash = sha256(pin)
  return db.prepare('SELECT id,name,username,role,discount_pct FROM users WHERE pin_hash=? AND active=1').get(hash)
}
function usersGetAll() {
  if (!db) return []
  return db.prepare('SELECT id,name,username,role,discount_pct,active FROM users ORDER BY id').all()
}
function userCreate(data) {
  if (!db) return null
  // Check if username exists — update PIN if so (re-run setup), otherwise insert
  const existing = db.prepare('SELECT id, supabase_id FROM users WHERE username=?').get(data.username)
  if (existing) {
    const hash = (() => { if (!data.pin) throw new Error('PIN requerido'); return sha256(data.pin) })()
    db.prepare('UPDATE users SET name=@name, pin_hash=@pin_hash, role=@role, discount_pct=@discount_pct, employee_id=@employee_id, cedula=@cedula, start_date=@start_date, active=1 WHERE id=@id')
      .run({ name: data.name, pin_hash: hash, role: data.role, discount_pct: data.discount_pct || 0, employee_id: data.employee_id || null, cedula: data.cedula || null, start_date: data.start_date || null, id: existing.id })
    return { id: existing.id, supabase_id: existing.supabase_id }
  }
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO users(name,username,pin_hash,role,discount_pct,employee_id,cedula,start_date,active,supabase_id)
    VALUES(@name,@username,@pin_hash,@role,@discount_pct,@employee_id,@cedula,@start_date,1,@supabase_id)`).run({
    ...data,
    pin_hash: (() => { if (!data.pin) throw new Error('PIN requerido'); return sha256(data.pin) })(),
    discount_pct: data.discount_pct || 0,
    employee_id: data.employee_id || null,
    cedula: data.cedula || null,
    start_date: data.start_date || null,
    supabase_id: sid,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function userUpdate(id, data) {
  if (!db) return
  const allowed = ['name', 'username', 'pin_hash', 'role', 'discount_pct', 'employee_id', 'vendedor_id', 'commission_pct', 'active']
  const { pin, ...rest } = data
  if (pin) rest.pin_hash = sha256(pin)
  const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE users SET ${fields} WHERE id=@id`).run({ ...patch, id })
}
function userDelete(id) {
  if (!db) return { softDeleted: true }
  const target = db.prepare('SELECT name, username FROM users WHERE id=?').get(id)
  const targetName = target ? `${target.name} (@${target.username})` : `#${id}`
  db.prepare('UPDATE users SET active=0, updated_at=datetime(?) WHERE id=?').run(new Date().toISOString(), id)
  activityLogRecord({ event_type: 'user_deactivated', severity: 'warn',
    target_type: 'user', target_id: id, target_name: targetName })
  return { deleted: true }
}

// ── CATEGORIAS SERVICIO ───────────────────────────────────────────────────────
function categoriasGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM categorias_servicio ORDER BY orden, nombre').all()
}
function categoriaCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare('INSERT INTO categorias_servicio(nombre, orden, supabase_id) VALUES(@nombre, @orden, @supabase_id)')
    .run({ nombre: data.nombre, orden: data.orden || 0, supabase_id: sid })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function categoriaUpdate(id, data) {
  if (!db) return
  const allowed = ['nombre', 'orden']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE categorias_servicio SET ${fields} WHERE id=@id`).run({ ...patch, id })
}
function categoriaDelete(id) {
  if (!db) return
  // Only delete if no services reference it
  const count = db.prepare('SELECT COUNT(*) as n FROM services WHERE categoria_id=?').get(id)
  if (count?.n > 0) throw new Error('Categoría tiene servicios asociados')
  db.prepare('DELETE FROM categorias_servicio WHERE id=?').run(id)
}

// ── SERVICES ──────────────────────────────────────────────────────────────────
function servicesGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM services WHERE active=1 ORDER BY category, sort_order, id').all()
}
function servicesGetAllAdmin() {
  if (!db) return []
  return db.prepare('SELECT * FROM services ORDER BY category, sort_order, id').all()
}
function serviceCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const cw = data.commission_washer ?? 1
  const cs = data.commission_seller ?? 1
  const cc = data.commission_cashier ?? 1
  const noComm = (!cw && !cs && !cc) ? 1 : 0
  const r = db.prepare(`INSERT INTO services(name,name_en,category,categoria_id,price,cost,aplica_itbis,is_wash,no_commission,commission_washer,commission_seller,commission_cashier,active,sort_order,supabase_id)
    VALUES(@name,@name_en,@category,@categoria_id,@price,COALESCE(@cost,0),COALESCE(@aplica_itbis,1),@is_wash,@no_commission,@commission_washer,@commission_seller,@commission_cashier,1,COALESCE(@sort_order,0),@supabase_id)`).run({
    name: data.name, name_en: data.name_en || null,
    category: data.category || 'Lavado', categoria_id: data.categoria_id || null,
    price: data.price, cost: data.cost || 0, aplica_itbis: data.aplica_itbis ?? 1,
    is_wash: data.is_wash ?? 1, no_commission: noComm,
    commission_washer: cw, commission_seller: cs, commission_cashier: cc,
    sort_order: data.sort_order || 0,
    supabase_id: sid,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function serviceUpdate(id, data) {
  if (!db) return
  const allowed = ['name','name_en','category','categoria_id','price','cost','aplica_itbis','is_wash','no_commission','commission_washer','commission_seller','commission_cashier','active','sort_order']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  // Auto-derive no_commission when all 3 role flags are off (or any provided)
  if ('commission_washer' in patch || 'commission_seller' in patch || 'commission_cashier' in patch) {
    const existing = db.prepare('SELECT commission_washer, commission_seller, commission_cashier FROM services WHERE id=?').get(id) || {}
    const cw = patch.commission_washer ?? existing.commission_washer ?? 1
    const cs = patch.commission_seller ?? existing.commission_seller ?? 1
    const cc = patch.commission_cashier ?? existing.commission_cashier ?? 1
    patch.no_commission = (!cw && !cs && !cc) ? 1 : 0
  }
  if (!Object.keys(patch).length) return
  const priorRow = 'price' in patch
    ? db.prepare('SELECT name, price FROM services WHERE id=?').get(id)
    : null
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE services SET ${fields} WHERE id=@id`).run({ ...patch, id })
  if (priorRow && Number(priorRow.price) !== Number(patch.price)) {
    activityLogRecord({ event_type: 'service_price_changed', severity: 'warn',
      target_type: 'service', target_id: id, target_name: priorRow.name,
      old_value: priorRow.price, new_value: patch.price, amount: Number(patch.price) - Number(priorRow.price) })
  }
}
function serviceDelete(id) {
  if (!db) return { deleted: false }
  // Soft-delete — hard-delete resurrects on the next pull (Supabase still
  // has the row and pullUpsertRow reinserts it locally). Historical reports
  // are already safe: ticket_items snapshot name/price/cost/itbis at sale.
  const svc = db.prepare('SELECT name, price FROM services WHERE id=?').get(id)
  db.prepare('UPDATE services SET active=0, updated_at=? WHERE id=?').run(new Date().toISOString(), id)
  activityLogRecord({ event_type: 'service_deleted', severity: 'warn',
    target_type: 'service', target_id: id, target_name: svc?.name || `#${id}`, amount: svc?.price })
  return { deleted: true }
}

// ── WASHERS ───────────────────────────────────────────────────────────────────
function washersGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM washers WHERE active=1 ORDER BY name').all()
}
function washersGetAllAdmin() {
  if (!db) return []
  return db.prepare('SELECT * FROM washers ORDER BY name').all()
}
function washerCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO washers(name,phone,cedula,commission_pct,start_date,active,supabase_id)
    VALUES(@name,@phone,@cedula,@commission_pct,@start_date,1,@supabase_id)`).run({
    name: data.name, phone: data.phone || null, cedula: data.cedula || null,
    commission_pct: data.commission_pct || 20, start_date: data.start_date || null,
    supabase_id: sid,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function washerUpdate(id, data) {
  if (!db) return
  const allowed = ['name','phone','cedula','commission_pct','start_date','active']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE washers SET ${fields} WHERE id=@id`).run({ ...patch, id })
}
function washerDelete(id) {
  if (!db) return
  db.prepare('UPDATE washers SET active=0 WHERE id=?').run(id)
}

// ── Empleados (payroll) ─────────────────────────────────────────────────────
function empleadosGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM empleados WHERE active=1 ORDER BY nombre').all()
}
function empleadosGetAllAdmin() {
  if (!db) return []
  return db.prepare('SELECT * FROM empleados ORDER BY nombre').all()
}
function empleadoCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO empleados(nombre,tipo,ref_id,salary,start_date,cedula,phone,puesto,email,bank_account,tss_id,role,active,supabase_id)
    VALUES(@nombre,@tipo,@ref_id,@salary,@start_date,@cedula,@phone,@puesto,@email,@bank_account,@tss_id,@role,1,@supabase_id)`).run({
    nombre: data.nombre, tipo: data.tipo, ref_id: data.ref_id || null,
    salary: data.salary || 0, start_date: data.start_date,
    cedula: data.cedula || null, phone: data.phone || null,
    puesto: data.puesto || null, email: data.email || null,
    bank_account: data.bank_account || null, tss_id: data.tss_id || null,
    role: data.role || 'none',
    supabase_id: sid,
  })
  // Log initial salary so salaryAtDate() works from day one.
  // Also set empleado_supabase_id so sync can push this row to the web without
  // losing the FK join — sync.js's cols mapping reads this column verbatim.
  // Guard: don't double-insert if one already exists (e.g. empleado was first
  // created on the web and then pulled down — pull already carries the
  // initial_salary row in salary_changes).
  const sal = data.salary || 0
  if (sal > 0) {
    const existing = db.prepare(`SELECT id FROM salary_changes WHERE empleado_supabase_id=? AND reason='initial_salary' LIMIT 1`).get(sid)
    if (!existing) {
      db.prepare(`INSERT INTO salary_changes (empleado_id, empleado_supabase_id, old_salary, new_salary, effective_date, reason, supabase_id)
        VALUES (?, ?, 0, ?, ?, 'initial_salary', ?)`).run(r.lastInsertRowid, sid, sal, data.start_date || new Date().toISOString().slice(0, 10), crypto.randomUUID())
    }
  }
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function empleadoUpdate(id, data) {
  if (!db) return
  const allowed = ['nombre','tipo','ref_id','salary','start_date','cedula','phone','puesto','email','bank_account','tss_id','role','active']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return

  // Auto-log salary changes. Pull empleado_supabase_id from the existing row
  // so the sync push can find the employee on the web side via FK join.
  if (patch.salary != null) {
    const current = db.prepare('SELECT salary, supabase_id FROM empleados WHERE id=?').get(id)
    const oldSalary = Number(current?.salary || 0)
    const newSalary = Number(patch.salary || 0)
    if (current && oldSalary !== newSalary) {
      db.prepare(`INSERT INTO salary_changes
        (empleado_id, empleado_supabase_id, old_salary, new_salary, effective_date, reason, changed_by, supabase_id)
        VALUES (?, ?, ?, ?, date('now'), ?, ?, ?)`).run(
        id, current.supabase_id || null, oldSalary, newSalary, data.salary_change_reason || null, data.changed_by || null, crypto.randomUUID()
      )
    }
  }

  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE empleados SET ${fields} WHERE id=@id`).run({ ...patch, id })
}
function empleadoDelete(id) {
  if (!db) return
  db.prepare('UPDATE empleados SET active=0 WHERE id=?').run(id)
}
function empleadoHardDelete(id) {
  if (!db) return { ok: false, reason: 'no-db' }
  const emp = db.prepare('SELECT id FROM empleados WHERE id=?').get(id)
  if (!emp) return { ok: false, reason: 'not-found' }
  // Safety: refuse hard delete if there's financial history referencing this empleado.
  const runs = db.prepare('SELECT COUNT(*) AS n FROM payroll_runs WHERE empleado_id=?').get(id)?.n || 0
  let commCount = 0
  try { commCount += db.prepare('SELECT COUNT(*) AS n FROM washer_commissions WHERE washer_id IN (SELECT id FROM washers WHERE ref_id=?)').get(id)?.n || 0 } catch {}
  try { commCount += db.prepare('SELECT COUNT(*) AS n FROM seller_commissions WHERE seller_id IN (SELECT id FROM sellers WHERE ref_id=?)').get(id)?.n || 0 } catch {}
  if (runs > 0 || commCount > 0) {
    db.prepare('UPDATE empleados SET active=0 WHERE id=?').run(id)
    return { ok: true, softDeleted: true, reason: 'has-history', runs, commissions: commCount }
  }
  // No history — fully erase the employee + their salary_changes log.
  db.prepare('DELETE FROM salary_changes WHERE empleado_id=?').run(id)
  db.prepare('DELETE FROM empleados WHERE id=?').run(id)
  return { ok: true, softDeleted: false }
}

// ── Mesas (floor plan) ──────────────────────────────────────────────────────
function mesasGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM mesas WHERE active=1 ORDER BY sort_order, name').all()
}
function mesaCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO mesas(supabase_id,name,zone,capacity,status,sort_order,active)
    VALUES(?,?,?,?,?,?,1)`).run(
    sid,
    data.name,
    data.zone || null,
    data.capacity != null ? data.capacity : 4,
    data.status || 'libre',
    data.sort_order || 0,
  )
  return db.prepare('SELECT * FROM mesas WHERE id=?').get(r.lastInsertRowid)
}
function mesaUpdate(id, data) {
  if (!db) return
  const allowed = ['name','zone','capacity','status','waiter_empleado_id','waiter_empleado_supabase_id','guests_count','seated_at','sort_order','active']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM mesas WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE mesas SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM mesas WHERE id=?').get(id)
}
function mesaSetStatus(id, status, opts = {}) {
  if (!db) return
  // Stamps seated_at once when transitioning into 'ocupada'; other waiter/guest
  // fields are only overwritten when explicitly provided (undefined → keep).
  const current = db.prepare('SELECT waiter_empleado_id, waiter_empleado_supabase_id, guests_count FROM mesas WHERE id=?').get(id)
  if (!current) return null
  const waiterId    = opts.waiter_empleado_id          !== undefined ? opts.waiter_empleado_id          : current.waiter_empleado_id
  const waiterSid   = opts.waiter_empleado_supabase_id !== undefined ? opts.waiter_empleado_supabase_id : current.waiter_empleado_supabase_id
  const guests      = opts.guests_count                !== undefined ? opts.guests_count                : current.guests_count
  db.prepare(`UPDATE mesas
    SET status=?, waiter_empleado_id=?, waiter_empleado_supabase_id=?, guests_count=?,
        seated_at=COALESCE(seated_at, CASE WHEN ?='ocupada' THEN datetime('now') END),
        updated_at=datetime('now')
    WHERE id=?`).run(status, waiterId, waiterSid, guests, status, id)
  return db.prepare('SELECT * FROM mesas WHERE id=?').get(id)
}
function mesaDelete(id) {
  if (!db) return
  db.prepare('UPDATE mesas SET active=0, updated_at=datetime(\'now\') WHERE id=?').run(id)
}

// ── Modificadores (menu add-ons) ────────────────────────────────────────────
function modificadoresGetAll() {
  if (!db) return []
  return db.prepare(`SELECT * FROM modificadores WHERE active=1 ORDER BY group_name, sort_order, name`).all()
}
function modificadoresGetAllAdmin() {
  if (!db) return []
  return db.prepare(`SELECT * FROM modificadores ORDER BY group_name, sort_order, name`).all()
}
function modificadorCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO modificadores(supabase_id,name,group_name,price_delta,min_select,max_select,default_selected,sort_order,active)
    VALUES(?,?,?,?,?,?,?,?,1)`).run(
    sid,
    data.name,
    data.group_name || null,
    Number(data.price_delta || 0),
    data.min_select != null ? data.min_select : 0,
    data.max_select != null ? data.max_select : 1,
    data.default_selected ? 1 : 0,
    data.sort_order || 0,
  )
  return db.prepare('SELECT * FROM modificadores WHERE id=?').get(r.lastInsertRowid)
}
function modificadorUpdate(id, data) {
  if (!db) return
  const allowed = ['name','group_name','price_delta','min_select','max_select','default_selected','sort_order','active']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if ('default_selected' in patch) patch.default_selected = patch.default_selected ? 1 : 0
  if ('active' in patch)           patch.active           = patch.active ? 1 : 0
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM modificadores WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE modificadores SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM modificadores WHERE id=?').get(id)
}
function modificadorDelete(id) {
  if (!db) return
  db.prepare('UPDATE modificadores SET active=0, updated_at=datetime(\'now\') WHERE id=?').run(id)
}
function modificadoresListForService(serviceId) {
  if (!db) return []
  return db.prepare(`SELECT m.*, sm.is_required
    FROM service_modificadores sm
    JOIN modificadores m ON m.id = sm.modificador_id
    WHERE sm.service_id=? AND m.active=1
    ORDER BY m.group_name, m.sort_order, m.name`).all(serviceId)
}
function modificadorAttachToService(serviceId, modificadorId, isRequired = 0) {
  if (!db) return
  const svc = db.prepare('SELECT supabase_id FROM services WHERE id=?').get(serviceId)
  const mod = db.prepare('SELECT supabase_id FROM modificadores WHERE id=?').get(modificadorId)
  if (!svc || !mod) return
  db.prepare(`INSERT INTO service_modificadores(supabase_id,service_id,service_supabase_id,modificador_id,modificador_supabase_id,is_required)
    VALUES(?,?,?,?,?,?)`).run(
    crypto.randomUUID(),
    serviceId, svc.supabase_id || null,
    modificadorId, mod.supabase_id || null,
    isRequired ? 1 : 0,
  )
}
function modificadorDetachFromService(serviceId, modificadorId) {
  if (!db) return
  db.prepare('DELETE FROM service_modificadores WHERE service_id=? AND modificador_id=?').run(serviceId, modificadorId)
}

// ── KDS events (kitchen display) ────────────────────────────────────────────
function kdsListActive() {
  if (!db) return []
  return db.prepare(`SELECT * FROM kds_events
    WHERE status IN ('fired','in_progress','ready')
    ORDER BY fired_at DESC`).all()
}
function kdsFire(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  // Resolve ticket_item_supabase_id so sync can push this row to the web without
  // losing the FK join — same pattern as empleadoCreate → salary_changes.
  const ti = db.prepare('SELECT supabase_id FROM ticket_items WHERE id=?').get(data.ticket_item_id)
  const r = db.prepare(`INSERT INTO kds_events(supabase_id,ticket_item_id,ticket_item_supabase_id,mesa_id,mesa_supabase_id,station,status,fired_at)
    VALUES(?,?,?,?,?,?,'fired',datetime('now'))`).run(
    sid,
    data.ticket_item_id,
    ti?.supabase_id || null,
    data.mesa_id || null,
    data.mesa_supabase_id || null,
    data.station || null,
  )
  return db.prepare('SELECT * FROM kds_events WHERE id=?').get(r.lastInsertRowid)
}
function kdsSetStatus(id, status) {
  if (!db) return
  // Single UPDATE stamps the matching timestamp only when transitioning INTO
  // that state; previous timestamps are preserved via COALESCE-equivalent
  // CASE/ELSE-self pattern.
  db.prepare(`UPDATE kds_events
    SET status=?,
        started_at = CASE WHEN ?='in_progress' AND started_at IS NULL THEN datetime('now') ELSE started_at END,
        ready_at   = CASE WHEN ?='ready'       AND ready_at   IS NULL THEN datetime('now') ELSE ready_at   END,
        bumped_at  = CASE WHEN ?='bumped'      AND bumped_at  IS NULL THEN datetime('now') ELSE bumped_at  END,
        updated_at = datetime('now')
    WHERE id=?`).run(status, status, status, status, id)
  return db.prepare('SELECT * FROM kds_events WHERE id=?').get(id)
}

// ── Ticket-item modifier snapshots ──────────────────────────────────────────
function ticketItemModificadoresList(ticketItemId) {
  if (!db) return []
  return db.prepare('SELECT * FROM ticket_item_modificadores WHERE ticket_item_id=? ORDER BY id').all(ticketItemId)
}
function ticketItemModificadoresSnapshot(ticketItemSupabaseId, ticketItemId, selections) {
  if (!db) return
  if (!Array.isArray(selections) || selections.length === 0) return
  const ins = db.prepare(`INSERT INTO ticket_item_modificadores
    (supabase_id,ticket_item_id,ticket_item_supabase_id,modificador_id,modificador_supabase_id,name_snapshot,price_delta_snapshot)
    VALUES(?,?,?,?,?,?,?)`)
  const tx = db.transaction((rows) => {
    for (const s of rows) {
      ins.run(
        crypto.randomUUID(),
        ticketItemId || null,
        ticketItemSupabaseId || null,
        s.modificador_id || null,
        s.modificador_supabase_id || null,
        s.name_snapshot,
        Number(s.price_delta_snapshot || 0),
      )
    }
  })
  tx(selections)
}

// ── PAYROLL RUNS (paycheck history) ───────────────────────────────────────────
const PAYROLL_RUN_INSERT_SQL = `INSERT INTO payroll_runs
  (empleado_id, period_start, period_end, base, commissions, bonuses,
   sfs_employee, afp_employee, isr, other_deductions, deductions,
   sfs_employer, afp_employer, infotep_employer,
   net, notes, paid_by)
  VALUES (@empleado_id, @period_start, @period_end, @base, @commissions, @bonuses,
          @sfs_employee, @afp_employee, @isr, @other_deductions, @deductions,
          @sfs_employer, @afp_employer, @infotep_employer,
          @net, @notes, @paid_by)`

function normalizePayrollRun(data) {
  const sfs_employee     = Number(data.sfs_employee || 0)
  const afp_employee     = Number(data.afp_employee || 0)
  const isr              = Number(data.isr || 0)
  const other_deductions = Number(data.other_deductions || 0)
  // Back-compat: if caller passed a single `deductions` total (old shape), use it.
  // Otherwise compute it from the itemised fields.
  const deductions = data.deductions != null
    ? Number(data.deductions)
    : sfs_employee + afp_employee + isr + other_deductions
  return {
    empleado_id:      data.empleado_id,
    period_start:     data.period_start,
    period_end:       data.period_end,
    base:             Number(data.base || 0),
    commissions:      Number(data.commissions || 0),
    bonuses:          Number(data.bonuses || 0),
    sfs_employee, afp_employee, isr, other_deductions, deductions,
    sfs_employer:     Number(data.sfs_employer || 0),
    afp_employer:     Number(data.afp_employer || 0),
    infotep_employer: Number(data.infotep_employer || 0),
    net:              Number(data.net),
    notes:            data.notes || null,
    paid_by:          data.paid_by || null,
  }
}

// Mark unpaid commissions within [from, to] as paid for an employee, based on tipo → ref_id.
function markCommissionsPaidForEmpleado(empleadoId, from, to) {
  if (!db) return 0
  const emp = db.prepare('SELECT tipo, ref_id FROM empleados WHERE id=?').get(empleadoId)
  if (!emp || !emp.ref_id) return 0
  const table = emp.tipo === 'lavador'  ? 'washer_commissions'
              : emp.tipo === 'vendedor' ? 'seller_commissions'
              : emp.tipo === 'cajero'   ? 'cajero_commissions'
              : null
  if (!table) return 0
  const col = emp.tipo === 'lavador' ? 'washer_id' : emp.tipo === 'vendedor' ? 'seller_id' : 'cajero_id'
  // Note: commissions are attached to tickets whose created_at falls in the range.
  const res = db.prepare(`UPDATE ${table}
    SET paid = 1, paid_at = datetime('now')
    WHERE ${col} = ? AND paid = 0
      AND ticket_id IN (SELECT id FROM tickets WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?))`)
    .run(emp.ref_id, from, to)
  return res.changes
}

function payrollRunCreate(data) {
  if (!db) return null
  const row = normalizePayrollRun(data)
  const r = db.prepare(PAYROLL_RUN_INSERT_SQL).run(row)
  // Auto-mark underlying commissions as paid for this employee/period
  if (row.commissions > 0) {
    try { markCommissionsPaidForEmpleado(row.empleado_id, row.period_start, row.period_end) } catch (e) { console.error('[payroll] markCommissionsPaid failed:', e.message) }
  }
  return { id: r.lastInsertRowid }
}

function payrollRunsBulkCreate(runs) {
  if (!db || !Array.isArray(runs) || runs.length === 0) return { created: 0, ids: [] }
  const stmt = db.prepare(PAYROLL_RUN_INSERT_SQL)
  const ids = []
  const tx = db.transaction((list) => {
    for (const data of list) {
      const row = normalizePayrollRun(data)
      const r = stmt.run(row)
      ids.push(r.lastInsertRowid)
      if (row.commissions > 0) {
        try { markCommissionsPaidForEmpleado(row.empleado_id, row.period_start, row.period_end) } catch (e) { console.error('[payroll] markCommissionsPaid failed:', e.message) }
      }
    }
  })
  tx(runs)
  const totalNet = runs.reduce((s, r) => s + Number(r?.net || 0), 0)
  const period = runs[0] ? `${runs[0].period_start || ''} → ${runs[0].period_end || ''}` : ''
  const paidBy = runs.find(r => r?.paid_by)?.paid_by || null
  activityLogRecord({ event_type: 'payroll_paid', severity: 'critical',
    actor_user_id: paidBy,
    target_type: 'payroll_run', target_id: ids[0] || null,
    target_name: `Nómina ${period}`.trim(),
    amount: totalNet,
    metadata: { run_count: ids.length, run_ids: ids, period_start: runs[0]?.period_start, period_end: runs[0]?.period_end } })
  return { created: ids.length, ids }
}
function payrollRunsByEmpleado(empleadoId, limit = 100) {
  if (!db) return []
  return db.prepare(`
    SELECT pr.*, u.name AS paid_by_name
    FROM payroll_runs pr
    LEFT JOIN users u ON u.id = pr.paid_by
    WHERE pr.empleado_id = ?
    ORDER BY pr.paid_at DESC
    LIMIT ?
  `).all(empleadoId, limit)
}
function payrollRunsByPeriod(from, to) {
  if (!db) return []
  const params = []
  let where = '1=1'
  if (from) { where += ' AND pr.paid_at >= ?'; params.push(from) }
  if (to)   { where += ' AND pr.paid_at <= ?'; params.push(to + ' 23:59:59') }
  return db.prepare(`
    SELECT pr.*, e.nombre AS empleado_nombre, e.tipo AS empleado_tipo, u.name AS paid_by_name
    FROM payroll_runs pr
    LEFT JOIN empleados e ON e.id = pr.empleado_id
    LEFT JOIN users u     ON u.id = pr.paid_by
    WHERE ${where}
    ORDER BY pr.paid_at DESC
  `).all(...params)
}
function payrollRunDelete(id) {
  if (!db) return
  db.prepare('DELETE FROM payroll_runs WHERE id=?').run(id)
}

// ── ADELANTOS DE NOMINA (salary advances) ─────────────────────────────────────
function adelantoCreate({ empleado_id, amount, notes, approved_by }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const emp = db.prepare('SELECT supabase_id FROM empleados WHERE id=?').get(empleado_id)
  const r = db.prepare(`INSERT INTO adelantos
    (supabase_id, empleado_id, empleado_supabase_id, amount, notes, approved_by)
    VALUES (@supabase_id, @empleado_id, @empleado_supabase_id, @amount, @notes, @approved_by)`).run({
    supabase_id: sid,
    empleado_id,
    empleado_supabase_id: emp?.supabase_id || null,
    amount: Number(amount),
    notes: notes || null,
    approved_by: approved_by || null,
  })
  activityLogRecord({ event_type: 'adelanto_created', severity: 'warn',
    target_type: 'adelanto', target_id: r.lastInsertRowid,
    target_name: emp ? `Adelanto #${r.lastInsertRowid}` : `#${r.lastInsertRowid}`,
    amount: Number(amount) })
  return { id: r.lastInsertRowid, supabase_id: sid }
}

function adelantoList({ empleado_id, status, dateFrom, dateTo } = {}) {
  if (!db) return []
  let sql = `SELECT a.*, e.nombre AS empleado_nombre, e.tipo AS empleado_tipo
    FROM adelantos a LEFT JOIN empleados e ON e.id = a.empleado_id WHERE 1=1`
  const params = []
  if (empleado_id) { sql += ' AND a.empleado_id = ?'; params.push(empleado_id) }
  if (status)      { sql += ' AND a.status = ?';      params.push(status) }
  if (dateFrom)    { sql += ' AND a.date >= ?';        params.push(dateFrom) }
  if (dateTo)      { sql += ' AND a.date <= ?';        params.push(dateTo) }
  sql += ' ORDER BY a.created_at DESC'
  return db.prepare(sql).all(...params)
}

function adelantosByEmpleado(empleado_id) {
  if (!db) return []
  return db.prepare(`SELECT * FROM adelantos WHERE empleado_id = ? AND status = 'pendiente' ORDER BY date ASC`).all(empleado_id)
}

function adelantoPendingTotal(empleado_id) {
  if (!db) return 0
  const row = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM adelantos WHERE empleado_id = ? AND status = 'pendiente'`).get(empleado_id)
  return row?.total || 0
}

function adelantoDeduct(adelanto_id, payroll_run_id) {
  if (!db) return
  db.prepare(`UPDATE adelantos SET status = 'deducido', deducted_from_payroll_id = ?, deducted_at = datetime('now') WHERE id = ?`).run(payroll_run_id, adelanto_id)
}

function adelantoCancel(adelanto_id) {
  if (!db) return
  const row = db.prepare('SELECT amount, empleado_id FROM adelantos WHERE id=?').get(adelanto_id)
  db.prepare(`UPDATE adelantos SET status = 'cancelado' WHERE id = ? AND status = 'pendiente'`).run(adelanto_id)
  if (row) {
    activityLogRecord({ event_type: 'adelanto_cancelled', severity: 'warn',
      target_type: 'adelanto', target_id: adelanto_id,
      target_name: `Adelanto #${adelanto_id}`,
      amount: row.amount })
  }
}

function adelantoSummary() {
  if (!db) return []
  return db.prepare(`SELECT e.id, e.nombre, e.tipo, COALESCE(SUM(a.amount), 0) AS pending_total, COUNT(a.id) AS pending_count
    FROM empleados e LEFT JOIN adelantos a ON a.empleado_id = e.id AND a.status = 'pendiente'
    WHERE e.active = 1 GROUP BY e.id HAVING pending_total > 0 ORDER BY pending_total DESC`).all()
}

// ── PAYROLL SETTINGS ──────────────────────────────────────────────────────────
function payrollSettingsGet() {
  if (!db) return null
  const row = db.prepare('SELECT * FROM payroll_settings WHERE id = 1').get()
  if (!row) return null
  // Parse isr_brackets JSON for consumer convenience
  try { row.isr_brackets = JSON.parse(row.isr_brackets || '[]') } catch { row.isr_brackets = [] }
  return row
}
function payrollSettingsUpdate(data) {
  if (!db) return
  const allowed = [
    'pay_cycle',
    'sfs_employee_rate','afp_employee_rate',
    'sfs_employer_rate','afp_employer_rate','infotep_employer_rate',
    'sfs_monthly_cap','afp_monthly_cap',
    'isr_enabled','isr_brackets',
    'navidad_enabled','vacation_days','daily_divisor',
  ]
  const patch = {}
  for (const [k, v] of Object.entries(data)) {
    if (!allowed.includes(k)) continue
    // Serialize isr_brackets if caller passed an array
    patch[k] = k === 'isr_brackets' && typeof v !== 'string' ? JSON.stringify(v) : v
  }
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE payroll_settings SET ${fields}, updated_at=datetime('now') WHERE id=1`).run(patch)
}

// ── SALARY CHANGES ────────────────────────────────────────────────────────────
function salaryChangesByEmpleado(empleadoId) {
  if (!db) return []
  return db.prepare(`
    SELECT sc.*, u.name AS changed_by_name
    FROM salary_changes sc
    LEFT JOIN users u ON u.id = sc.changed_by
    WHERE sc.empleado_id = ?
    ORDER BY sc.effective_date DESC, sc.id DESC
  `).all(empleadoId)
}

function salaryChangeCreate({ empleado_id, new_salary, effective_date, reason, changed_by }) {
  if (!db) return null
  // Pull both salary AND supabase_id — the latter is stored on the new
  // salary_changes row as empleado_supabase_id so sync can join on the web side.
  const emp = db.prepare('SELECT salary, supabase_id FROM empleados WHERE id=?').get(empleado_id)
  if (!emp) throw new Error('Empleado no encontrado')
  // old_salary = whatever was in effect on the day BEFORE this change
  const prev = db.prepare(`
    SELECT new_salary FROM salary_changes
    WHERE empleado_id = ? AND effective_date < ?
    ORDER BY effective_date DESC, id DESC LIMIT 1
  `).get(empleado_id, effective_date)
  const old_salary = prev ? Number(prev.new_salary) : 0
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO salary_changes
    (empleado_id, empleado_supabase_id, old_salary, new_salary, effective_date, reason, changed_by, supabase_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    empleado_id, emp.supabase_id || null, old_salary, Number(new_salary) || 0, effective_date,
    reason || null, changed_by || null, sid
  )
  // If the new change is the most recent one, sync empleados.salary too.
  const latest = db.prepare(`
    SELECT new_salary FROM salary_changes
    WHERE empleado_id = ?
    ORDER BY effective_date DESC, id DESC LIMIT 1
  `).get(empleado_id)
  if (latest && Number(latest.new_salary) !== Number(emp.salary || 0)) {
    db.prepare('UPDATE empleados SET salary=? WHERE id=?').run(Number(latest.new_salary), empleado_id)
  }
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function salaryChangeDelete(id) {
  if (!db) return
  const row = db.prepare('SELECT empleado_id FROM salary_changes WHERE id=?').get(id)
  if (!row) return
  db.prepare('DELETE FROM salary_changes WHERE id=?').run(id)
  // Re-sync empleados.salary to whatever the new latest change is (or 0 if none)
  const latest = db.prepare(`
    SELECT new_salary FROM salary_changes
    WHERE empleado_id = ?
    ORDER BY effective_date DESC, id DESC LIMIT 1
  `).get(row.empleado_id)
  db.prepare('UPDATE empleados SET salary=? WHERE id=?').run(Number(latest?.new_salary || 0), row.empleado_id)
}

function salaryAtDate(empleadoId, date) {
  if (!db) return 0
  // Find the most recent salary change on or before the given date
  const row = db.prepare(`
    SELECT new_salary FROM salary_changes
    WHERE empleado_id = ? AND effective_date <= ?
    ORDER BY effective_date DESC, id DESC LIMIT 1
  `).get(empleadoId, date)
  if (row) return Number(row.new_salary)
  // No salary_changes before that date — fall back to employee's current salary
  const emp = db.prepare('SELECT salary FROM empleados WHERE id=?').get(empleadoId)
  return Number(emp?.salary || 0)
}

// ── SELLERS ───────────────────────────────────────────────────────────────────
function sellersGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM sellers WHERE active=1 ORDER BY name').all()
}
function sellersGetAllAdmin() {
  if (!db) return []
  return db.prepare('SELECT * FROM sellers ORDER BY name').all()
}
function sellerCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare('INSERT INTO sellers(name,commission_pct,phone,cedula,start_date,active,supabase_id) VALUES(?,?,?,?,?,1,?)')
    .run(data.name, data.commission_pct || 5, data.phone || null, data.cedula || null, data.start_date || null, sid)
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function sellerUpdate(id, data) {
  if (!db) return
  const allowed = ['name','commission_pct','phone','cedula','start_date','active']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE sellers SET ${fields} WHERE id=@id`).run({ ...patch, id })
}
function sellerDelete(id) {
  if (!db) return
  db.prepare('UPDATE sellers SET active=0 WHERE id=?').run(id)
}

// ── CLIENTS ───────────────────────────────────────────────────────────────────
function clientsGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM clients WHERE active=1 ORDER BY name').all()
}
function clientGetById(id) {
  if (!db) return null
  return db.prepare('SELECT * FROM clients WHERE id=?').get(id)
}
function clientCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO clients(name,rnc,phone,email,address,credit_limit,balance,supabase_id)
    VALUES(@name,@rnc,@phone,@email,@address,@credit_limit,0,@supabase_id)`).run({ ...data, supabase_id: sid })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function clientUpdate(id, data) {
  if (!db) return
  const allowed = ['name','rnc','phone','email','address','credit_limit','balance','visits','total_spent','notes','active']
  const patch   = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (Object.keys(patch).length === 0) return
  const fields  = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE clients SET ${fields} WHERE id=@id`).run({ ...patch, id })
}
function clientUpdateBalance(id, delta) {
  if (!db) return
  db.prepare('UPDATE clients SET balance=balance+@delta WHERE id=@id').run({ id, delta })
}
function clientGetOpenTickets(clientId) {
  if (!db) return []
  const rows = db.prepare(
    `SELECT t.*,
       json_group_array(
         json_object('name', ti.name, 'price', ti.price, 'is_wash', ti.is_wash)
       ) as items_json
     FROM tickets t
     LEFT JOIN ticket_items ti ON ti.ticket_id = t.id
     WHERE t.client_id=? AND t.tipo_venta='credito' AND t.status='pendiente'
     GROUP BY t.id ORDER BY t.created_at ASC`
  ).all(clientId)
  return rows.map(r => {
    let items = []
    try {
      const parsed = JSON.parse(r.items_json || '[]')
      items = parsed.filter(i => i.name != null)
    } catch {}
    return { ...r, items }
  })
}
function collectCredit({ clientId, ticketIds, amount, paymentMethod, ncf, notes, cajeroId }) {
  if (!db) return null
  return db.transaction(() => {
    const updTicket = db.prepare("UPDATE tickets SET status='cobrado', payment_method=? WHERE id=?")
    for (const tid of ticketIds) updTicket.run(paymentMethod, tid)
    db.prepare('UPDATE clients SET balance=MAX(0,balance-?) WHERE id=?').run(amount, clientId)
    const sid = crypto.randomUUID()
    const clientRow = clientId ? db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(clientId) : null
    const cajeroRow = cajeroId ? db.prepare('SELECT supabase_id FROM users WHERE id=?').get(cajeroId) : null
    const r = db.prepare(
      `INSERT INTO credit_payments(client_id,ticket_ids,amount,payment_method,ncf,notes,cajero_id,supabase_id,client_supabase_id,cajero_supabase_id)
       VALUES(?,?,?,?,?,?,?,?,?,?)`
    ).run(clientId, JSON.stringify(ticketIds), amount, paymentMethod, ncf||null, notes||null, cajeroId||null,
          sid, clientRow?.supabase_id||null, cajeroRow?.supabase_id||null)
    return { id: r.lastInsertRowid, supabase_id: sid }
  })()
}

// ── TICKETS ───────────────────────────────────────────────────────────────────
function ticketsGetAll({ dateFrom, dateTo, status, limit = 200 } = {}) {
  if (!db) return []
  const safeLimit = Math.min(limit || 200, 500)
  let sql  = `SELECT t.*, c.name as client_name, c.rnc as client_rnc,
                     u.name as cajero_name,
                     GROUP_CONCAT(ti.name, ' + ') as service_names
              FROM tickets t
              LEFT JOIN clients c ON c.id = t.client_id
              LEFT JOIN users u ON u.id = t.cajero_id
              LEFT JOIN ticket_items ti ON ti.ticket_id = t.id
              WHERE 1=1`
  const params = []
  if (dateFrom) { sql += ' AND t.created_at >= ?'; params.push(dateFrom) }
  if (dateTo)   { sql += ' AND t.created_at <= ?'; params.push(dateTo)   }
  if (status)   { sql += ' AND t.status = ?';      params.push(status)   }
  sql += ' GROUP BY t.id ORDER BY t.created_at DESC LIMIT ?'
  params.push(safeLimit)
  return db.prepare(sql).all(...params)
}
function ticketGetById(id) {
  if (!db) return null
  const ticket = db.prepare(
    `SELECT t.*, c.name as client_name, c.rnc as client_rnc, u.name as cajero_name
     FROM tickets t
     LEFT JOIN clients c ON c.id=t.client_id
     LEFT JOIN users u ON u.id=t.cajero_id
     WHERE t.id=?`
  ).get(id)
  if (ticket) {
    ticket.items = db.prepare('SELECT * FROM ticket_items WHERE ticket_id=?').all(id)
    try { ticket.ecf_result = JSON.parse(ticket.ecf_result || '{}') } catch { ticket.ecf_result = {} }
    try { ticket.washer_ids = JSON.parse(ticket.washer_ids || '[]') } catch { ticket.washer_ids = [] }
    if (ticket.washer_ids.length) {
      const placeholders = ticket.washer_ids.map(() => '?').join(',')
      ticket.washer_names = db.prepare(`SELECT name FROM washers WHERE id IN (${placeholders})`).all(...ticket.washer_ids).map(r => r.name)
    } else {
      ticket.washer_names = []
    }
  }
  return ticket
}
function ticketCreate(data) {
  if (!db) return null

  const tx = db.transaction(() => {
    // Get next doc number
    const last = db.prepare('SELECT doc_number FROM tickets ORDER BY id DESC LIMIT 1').get()
    let nextNum = 1
    if (last?.doc_number) {
      const m = last.doc_number.match(/T-(\d+)/)
      if (m) nextNum = parseInt(m[1]) + 1
    }
    const docNumber = `T-${String(nextNum).padStart(4, '0')}`

    // Get next NCF
    const ncfRow = db.prepare('SELECT * FROM ncf_sequences WHERE type=? AND active=1').get(data.comprobante_type || 'B02')
    let ncf = null
    if (ncfRow) {
      const nextNCF = ncfRow.current_number + 1
      ncf = `${ncfRow.prefix}${String(nextNCF).padStart(8, '0')}`
      db.prepare('UPDATE ncf_sequences SET current_number=? WHERE type=?').run(nextNCF, ncfRow.type)
    }

    const ticketSid = crypto.randomUUID()
    const clientSid = data.client_id ? (db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(data.client_id)?.supabase_id || null) : null
    const sellerSid = data.seller_id ? (db.prepare('SELECT supabase_id FROM sellers WHERE id=?').get(data.seller_id)?.supabase_id || null) : null
    const cajeroSid = data.cajero_id ? (db.prepare('SELECT supabase_id FROM users WHERE id=?').get(data.cajero_id)?.supabase_id || null) : null
    const status = data.status || (data.payment_method === 'credit' ? 'pendiente' : 'cobrado')
    const result = db.prepare(`INSERT INTO tickets
      (doc_number,client_id,washer_ids,seller_id,cajero_id,subtotal,descuento,itbis,ley,total,
       beverage_subtotal,payment_method,comprobante_type,ncf,ecf_result,tipo_venta,status,vehicle_plate,supabase_id,client_supabase_id,seller_supabase_id,cajero_supabase_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
      docNumber,
      data.client_id || null,
      JSON.stringify(data.washer_ids || []),
      data.seller_id || null,
      data.cajero_id || null,
      data.subtotal,
      data.descuento || 0,
      data.itbis,
      data.ley || 0,
      data.total,
      data.beverage_subtotal || 0,
      data.payment_method || 'cash',
      data.comprobante_type || 'B02',
      ncf,
      JSON.stringify(data.ecf_result || {}),
      data.tipo_venta || 'contado',
      status,
      data.vehicle_plate || null,
      ticketSid,
      clientSid,
      sellerSid,
      cajeroSid,
    )
    const ticketId = result.lastInsertRowid

    // Insert items — pre-validate service IDs to avoid FK violations from stale/demo IDs
    // Snapshot cost from services table into ticket_items at sale time so historical
    // profit reports stay accurate even if a service's cost changes later.
    const svcRows = db.prepare('SELECT id, cost, supabase_id, no_commission, commission_washer, commission_seller, commission_cashier FROM services').all()
    const validSvcIds = new Set(svcRows.map(r => r.id))
    const svcCostById = new Map(svcRows.map(r => [r.id, r.cost || 0]))
    const svcSidById = new Map(svcRows.map(r => [r.id, r.supabase_id || null]))
    const svcNoCommById = new Map(svcRows.map(r => [r.id, r.no_commission || 0]))
    const svcWasherById = new Map(svcRows.map(r => [r.id, r.commission_washer ?? 1]))
    const svcSellerById = new Map(svcRows.map(r => [r.id, r.commission_seller ?? 1]))
    const svcCashierById = new Map(svcRows.map(r => [r.id, r.commission_cashier ?? 1]))
    // Lookup aplica_itbis for inventory items
    const invRows = db.prepare('SELECT id, aplica_itbis, supabase_id FROM inventory_items').all()
    const invItbisById = new Map(invRows.map(r => [r.id, r.aplica_itbis]))
    const invSidById = new Map(invRows.map(r => [r.id, r.supabase_id || null]))
    const insItem = db.prepare(`INSERT INTO ticket_items(ticket_id,service_id,name,price,cost,itbis,is_wash,quantity,sku,inventory_item_id,supabase_id,ticket_supabase_id,service_supabase_id,inventory_item_supabase_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    for (const item of (data.items || [])) {
      const svcId = (item.service_id && validSvcIds.has(item.service_id)) ? item.service_id : null
      const qty = item.quantity || 1
      // Explicit item.cost wins (e.g. inventory products with dynamic cost);
      // otherwise look up the current service cost by id.
      const itemCost = item.cost != null ? Number(item.cost) : (svcId ? svcCostById.get(svcId) : 0)
      const itemSid = crypto.randomUUID()
      const aplica = item.aplica_itbis !== undefined ? item.aplica_itbis : (item.inventory_item_id ? (invItbisById.get(item.inventory_item_id) ?? 1) : 1)
      const itemItbis = aplica !== 0 ? parseFloat((item.price * 0.18).toFixed(2)) : 0
      const invItemSid = item.inventory_item_id ? (invSidById.get(item.inventory_item_id) || null) : null
      insItem.run(ticketId, svcId, item.name, item.price, itemCost,
        itemItbis, item.is_wash ?? 1,
        qty, item.sku || null, item.inventory_item_id || null,
        itemSid, ticketSid, svcId ? svcSidById.get(svcId) : null, invItemSid)

      // Auto-deduct inventory stock (floor at 0 — never go negative)
      if (item.inventory_item_id) {
        const invRow = db.prepare('SELECT supabase_id, quantity FROM inventory_items WHERE id=?').get(item.inventory_item_id)
        db.prepare('UPDATE inventory_items SET quantity = MAX(0, quantity - ?) WHERE id = ?')
          .run(qty, item.inventory_item_id)
        const txSid = crypto.randomUUID()
        db.prepare('INSERT INTO inventory_transactions(item_id,type,delta,notes,user_id,supabase_id,item_supabase_id) VALUES(?,?,?,?,?,?,?)')
          .run(item.inventory_item_id, 'sale', -qty, `Ticket #${ticketId}`, data.cajero_id || null,
               txSid, invRow?.supabase_id || null)
      }
    }

    // Update client balance if credit
    if (data.client_id && data.tipo_venta === 'credito') {
      db.prepare('UPDATE clients SET balance=balance+?,visits=visits+1,total_spent=total_spent+? WHERE id=?')
        .run(data.total, data.total, data.client_id)
    } else if (data.client_id) {
      db.prepare('UPDATE clients SET visits=visits+1,total_spent=total_spent+? WHERE id=?')
        .run(data.total, data.client_id)
    }

    // Per-role commission base — iterate items and sum only those where the
    // role's commission toggle is on. Prices are ITBIS-inclusive (strip /1.18).
    //
    // Business rule: cashier earns on EVERY eligible item when NO seller is on
    // the ticket. When a seller IS on the ticket, cashier only earns on
    // products (is_wash=0, drinks/snacks). Services (is_wash=1) go to seller.
    const svcIsWashById = new Map(svcRows.map(r => [r.id, r.is_wash ?? 1]))
    const hasSeller = !!data.seller_id
    let washerBaseGross = 0, sellerBaseGross = 0, cashierBaseGross = 0
    for (const item of (data.items || [])) {
      const svcId = item.service_id && validSvcIds.has(item.service_id) ? item.service_id : null
      const qty = Math.max(1, parseInt(item.quantity || 1))
      const line = (item.price || 0) * qty
      const itemIsWash = svcId ? (svcIsWashById.get(svcId) ?? 1) : (item.is_wash ?? 1)
      const washerOn  = svcId ? !!svcWasherById.get(svcId)  : (itemIsWash !== 0)
      const sellerOn  = svcId ? !!svcSellerById.get(svcId)  : (itemIsWash !== 0)
      const cashierOn = svcId ? !!svcCashierById.get(svcId) : true
      if (washerOn)  washerBaseGross += line
      if (sellerOn)  sellerBaseGross += line
      // Cashier: products always, services only when no seller
      if (cashierOn && (itemIsWash === 0 || !hasSeller)) cashierBaseGross += line
    }
    const washerBase  = parseFloat((washerBaseGross  / 1.18).toFixed(2))
    const sellerBase  = parseFloat((sellerBaseGross  / 1.18).toFixed(2))
    const cashierBase = parseFloat((cashierBaseGross / 1.18).toFixed(2))

    if (washerBase > 0) {
      for (const wid of (data.washer_ids || [])) {
        const washer  = db.prepare('SELECT commission_pct, supabase_id FROM washers WHERE id=?').get(wid)
        if (!washer || washer.commission_pct <= 0) continue
        const commAmount = parseFloat((washerBase * washer.commission_pct / 100).toFixed(2))
        const wcSid = crypto.randomUUID()
        db.prepare(`INSERT INTO washer_commissions
          (washer_id,ticket_id,base_amount,commission_pct,commission_amount,paid,supabase_id,washer_supabase_id,ticket_supabase_id)
          VALUES(?,?,?,?,?,0,?,?,?)`).run(wid, ticketId, washerBase, washer.commission_pct, commAmount,
          wcSid, washer.supabase_id || null, ticketSid)
      }
    }

    if (data.seller_id && sellerBase > 0) {
      const seller = db.prepare('SELECT commission_pct, supabase_id FROM sellers WHERE id=?').get(data.seller_id)
      if (seller && seller.commission_pct > 0) {
        const commAmount = parseFloat((sellerBase * seller.commission_pct / 100).toFixed(2))
        const scSid = crypto.randomUUID()
        db.prepare(`INSERT INTO seller_commissions
          (seller_id,ticket_id,base_amount,commission_pct,commission_amount,paid,supabase_id,seller_supabase_id,ticket_supabase_id)
          VALUES(?,?,?,?,?,0,?,?,?)`).run(data.seller_id, ticketId, sellerBase, seller.commission_pct, commAmount,
          scSid, seller.supabase_id || null, ticketSid)
      }
    }

    if (data.cajero_id && cashierBase > 0) {
      const cajero = db.prepare('SELECT commission_pct, supabase_id FROM users WHERE id=?').get(data.cajero_id)
      if (cajero && cajero.commission_pct > 0) {
        const commAmount = parseFloat((cashierBase * cajero.commission_pct / 100).toFixed(2))
        const ccSid = crypto.randomUUID()
        db.prepare(`INSERT INTO cajero_commissions
          (cajero_id,ticket_id,base_amount,commission_pct,commission_amount,paid,supabase_id,cajero_supabase_id,ticket_supabase_id)
          VALUES(?,?,?,?,?,0,?,?,?)`).run(data.cajero_id, ticketId, cashierBase, cajero.commission_pct, commAmount,
          ccSid, cajero.supabase_id || null, ticketSid)
      }
    }

    // Add to queue ONLY for pendiente tickets (Encolar workflow).
    // Cobrado tickets (direct Cobrar) skip the queue — already paid.
    if (status === 'pendiente') {
      const rawFirstWasher = (data.washer_ids || [])[0] || null
      const firstWasherRow = rawFirstWasher
        ? db.prepare('SELECT id, supabase_id FROM washers WHERE id=?').get(rawFirstWasher)
        : null
      const firstWasherId = firstWasherRow ? firstWasherRow.id : null
      if (rawFirstWasher && !firstWasherId) {
        console.warn(`[ticketCreate] washer_id ${rawFirstWasher} not found in washers — inserting queue with null washer_id`)
      }
      const qSid = crypto.randomUUID()
      db.prepare(`INSERT INTO queue(ticket_id,status,washer_id,supabase_id,ticket_supabase_id,washer_supabase_id) VALUES(?,?,?,?,?,?)`)
        .run(ticketId, 'waiting', firstWasherId, qSid, ticketSid, firstWasherRow?.supabase_id || null)
    }

    return { ticketId, docNumber, ncf, supabase_id: ticketSid }
  })

  const res = tx()
  const desc = Number(data.descuento || 0)
  const subt = Number(data.subtotal || 0)
  const pct  = subt > 0 ? (desc / subt) * 100 : 0
  if (desc > 500 || pct > 15) {
    activityLogRecord({ event_type: 'discount_applied',
      severity: desc > 2000 || pct > 30 ? 'warn' : 'info',
      actor_user_id: data.cajero_id || null,
      target_type: 'ticket', target_id: res.ticketId, target_name: res.docNumber || `#${res.ticketId}`,
      amount: desc,
      metadata: { subtotal: subt, total: data.total, pct: Math.round(pct * 10) / 10, payment_method: data.payment_method } })
  }
  return res
}
function ticketMarkPaid(id, { paymentMethod, ncf, ecfResult, cajeroId, tipoVenta, clientId } = {}) {
  if (!db) return null
  db.transaction(() => {
    // Credit tickets stay 'pendiente' so they appear in Cuentas x Cobrar.
    // Only mark 'cobrado' when collected as contado/cash/card/transfer.
    const newStatus = tipoVenta === 'credito' ? 'pendiente' : 'cobrado'

    db.prepare(`UPDATE tickets SET status=?,
      payment_method=COALESCE(?,payment_method),
      ncf=COALESCE(?,ncf),
      ecf_result=COALESCE(?,ecf_result),
      cajero_id=COALESCE(?,cajero_id)
      WHERE id=?`).run(
      newStatus,
      paymentMethod || null, ncf || null,
      ecfResult ? JSON.stringify(ecfResult) : null,
      cajeroId || null, id)

    if (tipoVenta === 'credito' && clientId) {
      // Fetch original tipo_venta to avoid double-counting if ticket was already posted as credit
      const row = db.prepare('SELECT total, tipo_venta FROM tickets WHERE id=?').get(id)
      if (row && row.tipo_venta !== 'credito') {
        const amount = row.total || 0
        db.prepare('UPDATE tickets SET tipo_venta=?,client_id=? WHERE id=?')
          .run('credito', clientId, id)
        db.prepare('UPDATE clients SET balance=balance+?,visits=visits+1,total_spent=total_spent+? WHERE id=?')
          .run(amount, amount, clientId)
      }
    }
  })()
  return { id }
}
function ticketVoid(id, reason, voidById) {
  if (!db) return
  let voidedTicket = null
  db.transaction(() => {
    const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(id)
    if (!ticket) return
    voidedTicket = ticket
    db.prepare(`UPDATE tickets SET status='nula',void_reason=?,void_by=?,void_at=datetime('now') WHERE id=?`)
      .run(reason, voidById || null, id)
    // Reverse client balance if it was a credit ticket
    if (ticket.client_id && ticket.tipo_venta === 'credito') {
      db.prepare('UPDATE clients SET balance=balance-? WHERE id=?').run(ticket.total, ticket.client_id)
    }
    // Reverse inventory stock for product items
    const items = db.prepare('SELECT * FROM ticket_items WHERE ticket_id=? AND inventory_item_id IS NOT NULL').all(id)
    for (const item of items) {
      const qty = item.quantity || 1
      db.prepare('UPDATE inventory_items SET quantity = quantity + ? WHERE id = ?').run(qty, item.inventory_item_id)
      const invRow = db.prepare('SELECT supabase_id FROM inventory_items WHERE id=?').get(item.inventory_item_id)
      const vtSid = crypto.randomUUID()
      db.prepare('INSERT INTO inventory_transactions(item_id,type,delta,notes,user_id,supabase_id,item_supabase_id) VALUES(?,?,?,?,?,?,?)')
        .run(item.inventory_item_id, 'void_reversal', qty, `Void ticket #${id}`, voidById || null,
             vtSid, invRow?.supabase_id || null)
    }
  })()
  if (voidedTicket) {
    activityLogRecord({ event_type: 'ticket_voided', severity: 'critical',
      actor_user_id: voidById || null,
      target_type: 'ticket', target_id: id, target_name: voidedTicket.doc_number || `#${id}`,
      amount: voidedTicket.total, reason: reason || null,
      metadata: { payment_method: voidedTicket.payment_method, tipo_venta: voidedTicket.tipo_venta, ncf: voidedTicket.ncf } })
  }
}
function ticketGetByDateRange(dateFrom, dateTo) {
  return ticketsGetAll({ dateFrom, dateTo })
}

// ── PRICE CHANGES (queued ticket item price modification) ────────────────────
function ticketItemUpdatePrice({ ticketItemId, newPrice, reason, adminPin }) {
  if (!db) return { ok: false, error: 'DB not ready' }

  // 1. Verify admin PIN
  const hash = crypto.createHash('sha256').update(String(adminPin)).digest('hex')
  const admin = db.prepare("SELECT id, name, role FROM users WHERE pin_hash=? AND active=1 AND role IN ('owner','manager')").get(hash)
  if (!admin) return { ok: false, error: 'PIN invalido o no tiene permisos de administrador' }

  // 2. Get current item + ticket
  const item = db.prepare('SELECT * FROM ticket_items WHERE id=?').get(ticketItemId)
  if (!item) return { ok: false, error: 'Item no encontrado' }

  const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(item.ticket_id)
  if (!ticket) return { ok: false, error: 'Ticket no encontrado' }
  if (ticket.status === 'cobrado') return { ok: false, error: 'No se puede modificar un ticket ya cobrado' }

  const oldPrice = item.price

  // 3. Update item price + recalculate ticket totals
  db.transaction(() => {
    const newItbis = item.aplica_itbis !== 0 ? newPrice * 0.18 / 1.18 : 0
    db.prepare('UPDATE ticket_items SET price=?, itbis=? WHERE id=?').run(newPrice, newItbis, ticketItemId)

    // Recalculate ticket totals from all items
    const items = db.prepare('SELECT id, price, is_wash, aplica_itbis FROM ticket_items WHERE ticket_id=?').all(item.ticket_id)
    // Replace old price with new for the changed item
    const allPrices = items.map(i => i.id === ticketItemId ? newPrice : i.price)
    const total = allPrices.reduce((s, p) => s + p, 0)
    const itbisItems = items.filter(i => i.aplica_itbis !== 0)
    const itbisTotal = itbisItems.reduce((s, i) => s + (i.id === ticketItemId ? newPrice : i.price), 0)
    const itbis = parseFloat((itbisTotal * 0.18 / 1.18).toFixed(2))
    const subtotal = total - itbis
    const beverageSub = items.filter(i => !i.is_wash).reduce((s, i) => s + (i.id === ticketItemId ? newPrice : i.price), 0)

    db.prepare('UPDATE tickets SET subtotal=?, itbis=?, total=?, beverage_subtotal=? WHERE id=?')
      .run(subtotal, itbis, total, beverageSub, item.ticket_id)

    // 4. Log to audit table
    db.prepare(`INSERT INTO price_changes (ticket_id, ticket_item_id, item_name, old_price, new_price, reason, authorized_by, authorizer_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(item.ticket_id, ticketItemId, item.name, oldPrice, newPrice, reason, admin.id, admin.name)
  })()

  return { ok: true, ticketId: item.ticket_id, oldPrice, newPrice, authorizedBy: admin.name }
}

function priceChangesGetByTicket(ticketId) {
  if (!db) return []
  return db.prepare('SELECT * FROM price_changes WHERE ticket_id=? ORDER BY changed_at DESC').all(ticketId)
}

function priceChangesGetAll(dateFrom, dateTo) {
  if (!db) return []
  return db.prepare('SELECT pc.*, t.doc_number FROM price_changes pc JOIN tickets t ON pc.ticket_id=t.id WHERE pc.changed_at BETWEEN ? AND ? ORDER BY pc.changed_at DESC')
    .all(dateFrom || '2000-01-01', dateTo || '2099-12-31')
}

// ── QUEUE ─────────────────────────────────────────────────────────────────────
function queueGetActive() {
  if (!db) return []
  return db.prepare(
    `SELECT q.*, t.doc_number, t.total, t.vehicle_plate, t.created_at as ticket_created,
            c.name as client_name,
            GROUP_CONCAT(ti.name, ' + ') as services,
            w.name as washer_name
     FROM queue q
     JOIN tickets t ON t.id = q.ticket_id
     LEFT JOIN clients c ON c.id = t.client_id
     LEFT JOIN ticket_items ti ON ti.ticket_id = t.id
     LEFT JOIN washers w ON w.id = q.washer_id
     WHERE q.status NOT IN ('done', 'cancelled')
     GROUP BY q.id
     ORDER BY q.created_at ASC`
  ).all()
}
function queueUpdateStatus(id, status, washerId = null) {
  if (!db) return
  const now = new Date().toISOString()
  if (status === 'in_progress') {
    db.prepare(`UPDATE queue SET status=?,washer_id=?,assigned_at=? WHERE id=?`).run(status, washerId, now, id)
  } else if (status === 'done') {
    db.prepare(`UPDATE queue SET status=?,completed_at=? WHERE id=?`).run(status, now, id)
  } else {
    db.prepare(`UPDATE queue SET status=? WHERE id=?`).run(status, id)
  }
}

function queueDelete(id, deletedBy) {
  if (!db) return null
  const row = db.prepare('SELECT q.*, t.doc_number FROM queue q LEFT JOIN tickets t ON t.id = q.ticket_id WHERE q.id=?').get(id)
  if (!row) return null
  const now = new Date().toISOString()
  db.transaction(() => {
    db.prepare(`UPDATE queue SET status='cancelled', completed_at=? WHERE id=?`).run(now, id)
    db.prepare(`UPDATE tickets SET status='anulado' WHERE id=?`).run(row.ticket_id)
    db.prepare(`INSERT OR IGNORE INTO queue_deletions (queue_id, ticket_id, doc_number, deleted_by, deleted_at, reason) VALUES (?,?,?,?,?,?)`)
      .run(id, row.ticket_id, row.doc_number || '', deletedBy || 'unknown', now, 'manual')
  })()
  return { id, ticketId: row.ticket_id }
}

// ── COMMISSIONS ───────────────────────────────────────────────────────────────
function commissionsGetByWasher(washerId, dateFrom, dateTo) {
  if (!db) return []
  let sql = `SELECT wc.*, t.doc_number, t.created_at as ticket_date, t.vehicle_plate,
                    w.name as washer_name, w.commission_pct,
                    GROUP_CONCAT(ti.name, ' + ') as services
             FROM washer_commissions wc
             JOIN tickets t ON t.id = wc.ticket_id
             JOIN washers w ON w.id = wc.washer_id
             LEFT JOIN ticket_items ti ON ti.ticket_id = t.id AND ti.is_wash=1
             WHERE wc.washer_id=? AND t.status='cobrado'`
  const params = [washerId]
  if (dateFrom) { sql += ' AND t.created_at >= ?'; params.push(dateFrom) }
  if (dateTo)   { sql += ' AND t.created_at <= ?'; params.push(dateTo)   }
  sql += ' GROUP BY wc.id ORDER BY t.created_at DESC LIMIT 2000'
  return db.prepare(sql).all(...params)
}
function commissionsGetByPeriod(dateFrom, dateTo) {
  if (!db) return []
  return db.prepare(
    `SELECT wc.washer_id, w.name as washer_name, w.commission_pct,
            COUNT(wc.id) as ticket_count,
            SUM(wc.base_amount) as total_base,
            SUM(wc.commission_amount) as total_commission
     FROM washer_commissions wc
     JOIN tickets t ON t.id = wc.ticket_id
     JOIN washers w ON w.id = wc.washer_id
     WHERE t.status='cobrado'
       AND t.created_at >= ? AND t.created_at <= ?
     GROUP BY wc.washer_id ORDER BY total_commission DESC`
  ).all(dateFrom || '2000-01-01', dateTo || '2099-12-31')
}
function commissionsMarkPaid(washerCommissionIds) {
  if (!db) return
  const stmt = db.prepare(`UPDATE washer_commissions SET paid=1,paid_at=datetime('now') WHERE id=?`)
  db.transaction(() => washerCommissionIds.forEach(id => stmt.run(id)))()
}

// ── SELLER COMMISSIONS ────────────────────────────────────────────────────────
function sellerCommissionsBySeller(sellerId, dateFrom, dateTo) {
  if (!db) return []
  let sql = `SELECT sc.*, t.doc_number, t.created_at as ticket_date, t.vehicle_plate,
                    s.name as seller_name, s.commission_pct,
                    GROUP_CONCAT(ti.name, ' + ') as services
             FROM seller_commissions sc
             JOIN tickets t ON t.id = sc.ticket_id
             JOIN sellers s ON s.id = sc.seller_id
             LEFT JOIN ticket_items ti ON ti.ticket_id = t.id AND ti.is_wash=1
             WHERE sc.seller_id=? AND t.status='cobrado'`
  const params = [sellerId]
  if (dateFrom) { sql += ' AND t.created_at >= ?'; params.push(dateFrom) }
  if (dateTo)   { sql += ' AND t.created_at <= ?'; params.push(dateTo)   }
  sql += ' GROUP BY sc.id ORDER BY t.created_at DESC LIMIT 2000'
  return db.prepare(sql).all(...params)
}
function sellerCommissionsByPeriod(dateFrom, dateTo) {
  if (!db) return []
  return db.prepare(
    `SELECT sc.seller_id, s.name as seller_name, s.commission_pct,
            COUNT(sc.id) as ticket_count,
            SUM(sc.base_amount) as total_base,
            SUM(sc.commission_amount) as total_commission
     FROM seller_commissions sc
     JOIN tickets t ON t.id = sc.ticket_id
     JOIN sellers s ON s.id = sc.seller_id
     WHERE t.status='cobrado'
       AND t.created_at >= ? AND t.created_at <= ?
     GROUP BY sc.seller_id ORDER BY total_commission DESC`
  ).all(dateFrom || '2000-01-01', dateTo || '2099-12-31')
}
function sellerCommissionsMarkPaid(ids) {
  if (!db) return
  const stmt = db.prepare(`UPDATE seller_commissions SET paid=1,paid_at=datetime('now') WHERE id=?`)
  db.transaction(() => ids.forEach(id => stmt.run(id)))()
}

// ── CAJERO COMMISSIONS ───────────────────────────────────────────────────────
function cajeroCommissionsByCajero(cajeroId, dateFrom, dateTo) {
  if (!db) return []
  let sql = `SELECT cc.*, t.doc_number, t.created_at as ticket_date, t.vehicle_plate,
                    u.name as cajero_name, u.commission_pct,
                    GROUP_CONCAT(ti.name, ' + ') as services
             FROM cajero_commissions cc
             JOIN tickets t ON t.id = cc.ticket_id
             JOIN users u ON u.id = cc.cajero_id
             LEFT JOIN ticket_items ti ON ti.ticket_id = t.id AND ti.is_wash=0
             WHERE cc.cajero_id=? AND t.status='cobrado'`
  const params = [cajeroId]
  if (dateFrom) { sql += ' AND t.created_at >= ?'; params.push(dateFrom) }
  if (dateTo)   { sql += ' AND t.created_at <= ?'; params.push(dateTo)   }
  sql += ' GROUP BY cc.id ORDER BY t.created_at DESC LIMIT 2000'
  return db.prepare(sql).all(...params)
}
function cajeroCommissionsByPeriod(dateFrom, dateTo) {
  if (!db) return []
  return db.prepare(
    `SELECT cc.cajero_id, u.name as cajero_name, u.commission_pct,
            COUNT(cc.id) as ticket_count,
            SUM(cc.base_amount) as total_base,
            SUM(cc.commission_amount) as total_commission
     FROM cajero_commissions cc
     JOIN tickets t ON t.id = cc.ticket_id
     JOIN users u ON u.id = cc.cajero_id
     WHERE t.status='cobrado'
       AND t.created_at >= ? AND t.created_at <= ?
     GROUP BY cc.cajero_id ORDER BY total_commission DESC`
  ).all(dateFrom || '2000-01-01', dateTo || '2099-12-31')
}
function cajeroCommissionsMarkPaid(ids) {
  if (!db) return
  const stmt = db.prepare(`UPDATE cajero_commissions SET paid=1,paid_at=datetime('now') WHERE id=?`)
  db.transaction(() => ids.forEach(id => stmt.run(id)))()
}

// ── CUADRE DE CAJA ────────────────────────────────────────────────────────────
function cuadreCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO cuadre_caja
    (cajero_id,date,fondo,efectivo_conteo,efectivo_sistema,tarjeta,transferencia,
     cheque,creditos,salidas,total_vendido,total_cobrado,cierre_total,diferencia,
     comentario,denominaciones,supabase_id)
    VALUES(@cajero_id,@date,@fondo,@efectivo_conteo,@efectivo_sistema,@tarjeta,
           @transferencia,@cheque,@creditos,@salidas,@total_vendido,@total_cobrado,
           @cierre_total,@diferencia,@comentario,@denominaciones,@supabase_id)`).run({
    ...data,
    denominaciones: JSON.stringify(data.denominaciones || {}),
    supabase_id: sid,
  })
  const diff = Number(data.diferencia || 0)
  if (Math.abs(diff) > 50) {
    activityLogRecord({ event_type: 'cuadre_discrepancy',
      severity: Math.abs(diff) >= 500 ? 'critical' : 'warn',
      actor_user_id: data.cajero_id || null,
      target_type: 'cuadre_caja', target_id: r.lastInsertRowid,
      target_name: `Cuadre ${data.date || ''}`.trim(),
      amount: diff,
      old_value: String(data.efectivo_sistema || 0),
      new_value: String(data.efectivo_conteo || 0),
      reason: data.comentario || (diff > 0 ? 'Sobrante' : 'Faltante'),
      metadata: { cierre_total: data.cierre_total, total_cobrado: data.total_cobrado } })
  }
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function cuadreGetHistory(limit = 20) {
  if (!db) return []
  return db.prepare(
    `SELECT c.*, u.name as cajero_name FROM cuadre_caja c
     LEFT JOIN users u ON u.id=c.cajero_id
     ORDER BY c.closed_at DESC LIMIT ?`
  ).all(limit)
}
function cuadreList({ dateFrom, dateTo, limit = 100 } = {}) {
  if (!db) return []
  let sql = `SELECT c.*, u.name as cajero_name FROM cuadre_caja c
             LEFT JOIN users u ON u.id=c.cajero_id WHERE 1=1`
  const params = []
  if (dateFrom) { sql += ' AND c.date >= ?'; params.push(dateFrom) }
  if (dateTo)   { sql += ' AND c.date <= ?'; params.push(dateTo) }
  sql += ' ORDER BY c.closed_at DESC LIMIT ?'
  params.push(limit)
  return db.prepare(sql).all(...params)
}
function cuadreDailySummary(date) {
  if (!db) return {}
  const d = date || new Date().toISOString().slice(0, 10)
  const from = `${d}T00:00:00`
  const to   = `${d}T23:59:59`
  const rows = db.prepare(
    `SELECT payment_method, SUM(total) as sum FROM tickets
     WHERE status='cobrado' AND created_at BETWEEN ? AND ?
     GROUP BY payment_method`
  ).all(from, to)
  const result = { efectivo:0, tarjeta:0, transferencia:0, cheque:0, credito:0 }
  for (const r of rows) result[r.payment_method] = r.sum || 0
  const totals = db.prepare(
    `SELECT SUM(total) as vendido,
            SUM(CASE WHEN payment_method != 'credit' THEN total ELSE 0 END) as cobrado,
            COUNT(*) as count
     FROM tickets WHERE status='cobrado' AND created_at BETWEEN ? AND ?`
  ).get(from, to)
  return { ...result, totalVendido: totals?.vendido||0, totalCobrado: totals?.cobrado||0, count: totals?.count||0 }
}

// ── NCF ───────────────────────────────────────────────────────────────────────
function ncfGetSequences() {
  if (!db) return []
  return db.prepare('SELECT * FROM ncf_sequences ORDER BY type').all()
}
function ncfGetNext(type) {
  if (!db) return null
  const row = db.prepare('SELECT * FROM ncf_sequences WHERE type=? AND active=1 AND enabled=1').get(type)
  if (!row) return null
  const next = row.current_number + 1
  db.prepare('UPDATE ncf_sequences SET current_number=? WHERE type=?').run(next, type)
  return `${row.prefix}${String(next).padStart(8, '0')}`
}
function ncfUpdateSequence(type, data) {
  if (!db) return
  const allowed = ['prefix', 'current_number', 'limit_number', 'active', 'enabled', 'valid_until']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE ncf_sequences SET ${fields} WHERE type=@type`).run({ ...patch, type })
}

// ── CAJA CHICA ────────────────────────────────────────────────────────────────
function cajaChicaGetAll() {
  if (!db) return []
  return db.prepare(
    `SELECT cc.*, u.name as approved_name FROM caja_chica cc
     LEFT JOIN users u ON u.id=cc.approved_by
     ORDER BY cc.created_at DESC LIMIT 100`
  ).all()
}
function cajaChicaCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO caja_chica(description,category,type,amount,recibo,status,cajero_id,supabase_id)
    VALUES(@description,@category,@type,@amount,@recibo,@status,@cajero_id,@supabase_id)`).run({ ...data, supabase_id: sid })
  activityLogRecord({ event_type: 'caja_chica_withdrawal',
    severity: Number(data.amount) >= 2000 ? 'warn' : 'info',
    actor_user_id: data.cajero_id || null,
    target_type: 'caja_chica', target_id: r.lastInsertRowid,
    target_name: data.description || data.category || 'Retiro',
    amount: data.amount, reason: data.category || null,
    metadata: { type: data.type, recibo: data.recibo || null, status: data.status } })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function cajaChicaUpdateStatus(id, status, approvedBy) {
  if (!db) return
  db.prepare(`UPDATE caja_chica SET status=?,approved_by=? WHERE id=?`).run(status, approvedBy, id)
}

// ── NOTAS DE CREDITO ──────────────────────────────────────────────────────────
function notasGetAll() {
  if (!db) return []
  return db.prepare(
    `SELECT n.*, c.name as client_name FROM notas_credito n
     LEFT JOIN clients c ON c.id=n.client_id
     ORDER BY n.created_at DESC LIMIT 100`
  ).all()
}
function notaCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const clientRow = data.client_id ? db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(data.client_id) : null
  const ticketRow = data.original_ticket_id ? db.prepare('SELECT supabase_id FROM tickets WHERE id=?').get(data.original_ticket_id) : null
  const cajeroRow = data.cajero_id ? db.prepare('SELECT supabase_id FROM users WHERE id=?').get(data.cajero_id) : null
  const r = db.prepare(`INSERT INTO notas_credito
    (ncf,client_id,original_ticket_id,motivo,amount,itbis_revertido,forma_devolucion,comentario,cajero_id,supabase_id,client_supabase_id,ticket_supabase_id,cajero_supabase_id)
    VALUES(@ncf,@client_id,@original_ticket_id,@motivo,@amount,@itbis_revertido,@forma_devolucion,@comentario,@cajero_id,@supabase_id,@client_supabase_id,@ticket_supabase_id,@cajero_supabase_id)`
  ).run({ ...data, supabase_id: sid, client_supabase_id: clientRow?.supabase_id||null, ticket_supabase_id: ticketRow?.supabase_id||null, cajero_supabase_id: cajeroRow?.supabase_id||null })
  activityLogRecord({ event_type: 'nota_credito_created', severity: 'critical',
    actor_user_id: data.cajero_id || null,
    target_type: 'nota_credito', target_id: r.lastInsertRowid, target_name: data.ncf || `#${r.lastInsertRowid}`,
    amount: data.amount, reason: data.motivo || null,
    metadata: { original_ticket_id: data.original_ticket_id || null, itbis_revertido: data.itbis_revertido, forma_devolucion: data.forma_devolucion } })
  return { id: r.lastInsertRowid, supabase_id: sid }
}

// ── EXPORT ALL (for backup) ───────────────────────────────────────────────────
function exportAll() {
  if (!db) return {}
  // Checkpoint WAL to ensure backup includes all recent writes
  try { db.pragma('wal_checkpoint(PASSIVE)') } catch {}
  const tables = ['tickets','ticket_items','clients','credit_payments','queue',
    'cuadre_caja','caja_chica','notas_credito','washer_commissions','ncf_sequences','app_settings']
  const snap = { exported_at: new Date().toISOString(), version: '1.0.0', tables: {} }
  for (const t of tables) {
    try { snap.tables[t] = db.prepare(`SELECT * FROM ${t}`).all() }
    catch (e) { console.error('[backup] Failed to export', t, ':', e.message); snap.tables[t] = [] }
  }
  return snap
}
function exportSince(since) {
  if (!db) return { tickets:[], clients:[], payments:[] }
  // Checkpoint WAL to ensure export includes all recent writes
  try { db.pragma('wal_checkpoint(PASSIVE)') } catch {}
  return {
    tickets: db.prepare(`SELECT * FROM tickets WHERE created_at > ?`).all(since),
    clients: db.prepare(`SELECT * FROM clients WHERE created_at > ?`).all(since),
    payments: db.prepare(`SELECT * FROM credit_payments WHERE created_at > ?`).all(since),
  }
}

// ── Export to Supabase (full dump for cloud sync) ─────────────────────────────
function exportToSupabase() {
  if (!db) return {}
  // Checkpoint WAL to ensure sync export includes all recent writes
  try { db.pragma('wal_checkpoint(PASSIVE)') } catch {}
  return {
    business:        db.prepare('SELECT * FROM businesses WHERE id=1').get() || null,
    users:           db.prepare('SELECT * FROM users WHERE active=1').all(),
    services:        db.prepare('SELECT * FROM services').all(),
    washers:         db.prepare('SELECT * FROM washers WHERE active=1').all(),
    sellers:         db.prepare('SELECT * FROM sellers WHERE active=1').all(),
    clients:         db.prepare('SELECT * FROM clients WHERE active=1').all(),
    tickets:         db.prepare('SELECT * FROM tickets ORDER BY created_at DESC LIMIT 500').all(),
    ticket_items:    db.prepare('SELECT * FROM ticket_items').all(),
    ncf_sequences:   db.prepare('SELECT * FROM ncf_sequences').all(),
    inventory_items: db.prepare('SELECT * FROM inventory_items WHERE active=1').all(),
  }
}

// ── DGII 607 — Compras ────────────────────────────────────────────────────────
function getCompras607(dateFrom, dateTo) {
  if (!db) return []
  return db.prepare(
    `SELECT * FROM compras_607 WHERE fecha_ncf BETWEEN ? AND ? ORDER BY fecha_ncf DESC`
  ).all(dateFrom || '2000-01-01', dateTo || '2099-12-31')
}

function addCompra607(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const stmt = db.prepare(`
    INSERT INTO compras_607
      (rnc_proveedor, nombre_proveedor, tipo_ncf, ncf, ncf_modificado,
       fecha_ncf, fecha_pago, monto_servicios, monto_bienes, total,
       itbis_facturado, itbis_retenido, retencion_renta, forma_pago, notas, supabase_id)
    VALUES
      (@rnc_proveedor, @nombre_proveedor, @tipo_ncf, @ncf, @ncf_modificado,
       @fecha_ncf, @fecha_pago, @monto_servicios, @monto_bienes, @total,
       @itbis_facturado, @itbis_retenido, @retencion_renta, @forma_pago, @notas, @supabase_id)
  `)
  const result = stmt.run({
    rnc_proveedor:    data.rnc_proveedor    || '',
    nombre_proveedor: data.nombre_proveedor || '',
    tipo_ncf:         data.tipo_ncf         || 'B01',
    ncf:              data.ncf              || '',
    ncf_modificado:   data.ncf_modificado   || '',
    fecha_ncf:        data.fecha_ncf        || new Date().toISOString().slice(0,10),
    fecha_pago:       data.fecha_pago       || '',
    monto_servicios:  Number(data.monto_servicios)  || 0,
    monto_bienes:     Number(data.monto_bienes)     || 0,
    total:            Number(data.total)            || 0,
    itbis_facturado:  Number(data.itbis_facturado)  || 0,
    itbis_retenido:   Number(data.itbis_retenido)   || 0,
    retencion_renta:  Number(data.retencion_renta)  || 0,
    forma_pago:       data.forma_pago       || 'efectivo',
    notas:            data.notas            || '',
    supabase_id:      sid,
  })
  return { id: result.lastInsertRowid, supabase_id: sid }
}

function deleteCompra607(id) {
  if (!db) return null
  return db.prepare('DELETE FROM compras_607 WHERE id=?').run(id)
}

// ── DGII data ─────────────────────────────────────────────────────────────────
function get606Data(dateFrom, dateTo) {
  if (!db) return []
  return db.prepare(
    `SELECT t.id, t.ncf, t.comprobante_type as tipo, t.created_at as fecha,
            t.subtotal, t.itbis, t.ley, t.total, t.status as estado,
            c.name as client_name, c.rnc as client_rnc
     FROM tickets t
     LEFT JOIN clients c ON c.id=t.client_id
     WHERE t.created_at BETWEEN ? AND ?
     ORDER BY t.created_at DESC`
  ).all(dateFrom || '2000-01-01', dateTo || '2099-12-31')
}

// ── RNC contribuyentes ────────────────────────────────────────────────────────

// Single lookup — DGII-synced rows never expire; API-cached rows expire in 90d
function rncLookupLocal(rnc) {
  if (!db) return null
  const row = db.prepare('SELECT * FROM rnc_contribuyentes WHERE rnc=?').get(rnc)
  if (!row) return null
  if (row.source === 'api') {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    if (row.synced_at < cutoff) return null
  }
  return row
}

// Save a single API-lookup result
function rncSave(rnc, data, source = 'api') {
  if (!db) return
  db.prepare(`INSERT OR REPLACE INTO rnc_contribuyentes
    (rnc,nombre,nombre_comercial,actividad,estado,regimen,provincia,source,synced_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(
    rnc,
    data.nombre            || '',
    data.nombreComercial   || data.nombre_comercial || '',
    data.actividadEconomica|| data.actividad        || '',
    data.estado            || 'ACTIVO',
    data.regimen           || 'NORMAL',
    data.provincia         || '',
    source,
    new Date().toISOString()
  )
}

// Bulk insert from DGII ZIP sync — called inside a transaction batch
function rncBulkSync(rows) {
  if (!db || !rows.length) return 0
  const stmt = db.prepare(`INSERT OR REPLACE INTO rnc_contribuyentes
    (rnc,nombre,nombre_comercial,actividad,estado,regimen,provincia,source,synced_at)
    VALUES(?,?,?,?,?,?,?,?,?)`)
  const now = new Date().toISOString()
  const tx  = db.transaction(items => {
    for (const r of items) {
      stmt.run(r.rnc, r.nombre, r.nombre_comercial, r.actividad, r.estado, r.regimen, r.provincia, 'dgii_sync', now)
    }
  })
  tx(rows)
  return rows.length
}

function rncCount() {
  if (!db) return 0
  return db.prepare('SELECT COUNT(*) as c FROM rnc_contribuyentes').get()?.c || 0
}

function rncLastSync() {
  if (!db) return null
  return db.prepare("SELECT MAX(synced_at) as last FROM rnc_contribuyentes WHERE source='dgii_sync'").get()?.last || null
}

// ── Inventory ─────────────────────────────────────────────────────────────────

function inventoryGetAll() {
  if (!db) return []
  return db.prepare('SELECT * FROM inventory_items WHERE active=1 ORDER BY name COLLATE NOCASE').all()
}
function inventoryCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO inventory_items(sku,name,category,quantity,min_quantity,price,cost,barcode,aplica_itbis,supabase_id)
    VALUES(@sku,@name,@category,@quantity,@min_quantity,@price,@cost,@barcode,@aplica_itbis,@supabase_id)`).run({
    sku: data.sku || null, name: data.name, category: data.category || '',
    quantity: data.quantity || 0, min_quantity: data.min_quantity ?? 5,
    price: data.price || 0, cost: data.cost || 0,
    barcode: data.barcode || null, aplica_itbis: data.aplica_itbis ?? 1,
    supabase_id: sid,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function inventoryUpdate(id, data) {
  if (!db) return
  db.prepare(`UPDATE inventory_items
    SET sku=@sku, name=@name, category=@category, min_quantity=@min_quantity, price=@price, cost=@cost, barcode=@barcode, aplica_itbis=@aplica_itbis
    WHERE id=@id`).run({ sku: data.sku || null, name: data.name, category: data.category || '',
    min_quantity: data.min_quantity ?? 5, price: data.price || 0, cost: data.cost || 0,
    barcode: data.barcode || null, aplica_itbis: data.aplica_itbis ?? 1, id })
}
function inventoryDelete(id) {
  if (!db) return
  db.prepare('UPDATE inventory_items SET active=0 WHERE id=?').run(id)
}
function inventoryAdjust(id, delta, notes, userId) {
  if (!db) return null
  const txSid = crypto.randomUUID()
  const invRow = db.prepare('SELECT supabase_id, name, quantity FROM inventory_items WHERE id=?').get(id)
  const run = db.transaction(() => {
    db.prepare('UPDATE inventory_items SET quantity = quantity + ? WHERE id=?').run(delta, id)
    db.prepare('INSERT INTO inventory_transactions(item_id,type,delta,notes,user_id,supabase_id,item_supabase_id) VALUES(?,?,?,?,?,?,?)')
      .run(id, delta >= 0 ? 'in' : 'out', delta, notes || '', userId || null, txSid, invRow?.supabase_id || null)
  })
  run()
  const newQty = db.prepare('SELECT quantity FROM inventory_items WHERE id=?').get(id)?.quantity ?? null
  activityLogRecord({ event_type: 'inventory_adjusted', severity: 'info',
    actor_user_id: userId || null,
    target_type: 'inventory_item', target_id: id, target_name: invRow?.name || `#${id}`,
    amount: delta,
    old_value: invRow?.quantity != null ? String(invRow.quantity) : null,
    new_value: newQty != null ? String(newQty) : null,
    reason: notes || null })
  return newQty
}
function inventoryTransactions(itemId) {
  if (!db) return []
  return db.prepare(`SELECT t.*, u.name as user_name FROM inventory_transactions t
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.item_id=? ORDER BY t.created_at DESC LIMIT 50`).all(itemId)
}

function inventoryLowStockCount() {
  if (!db) return 0
  const row = db.prepare('SELECT COUNT(*) as cnt FROM inventory_items WHERE active=1 AND quantity <= min_quantity').get()
  return row?.cnt || 0
}

function inventoryLookupBySku(sku) {
  if (!db || !sku) return null
  return db.prepare('SELECT * FROM inventory_items WHERE active=1 AND (sku=? OR barcode=?) LIMIT 1').get(sku, sku) || null
}

function inventorySearch(query) {
  if (!db || !query) return []
  const q = `%${query}%`
  return db.prepare(`SELECT * FROM inventory_items WHERE active=1
    AND (name LIKE ? OR sku LIKE ? OR barcode LIKE ? OR category LIKE ?)
    ORDER BY name COLLATE NOCASE LIMIT 20`).all(q, q, q, q)
}

// ── e-CF offline queue ────────────────────────────────────────────────────────

function ecfQueueAdd(urlPath, bodyJson, token, { xmlSigned, encf, tipoEcf, environment } = {}) {
  if (!db) return
  db.prepare('INSERT INTO ecf_queue (url_path, body_json, token, xml_signed, encf, tipo_ecf, environment) VALUES (?,?,?,?,?,?,?)')
    .run(urlPath, typeof bodyJson === 'string' ? bodyJson : JSON.stringify(bodyJson), token || '',
         xmlSigned || null, encf || null, tipoEcf || null, environment || 'testecf')
}

// Only items within DGII's 72h contingency window
function ecfQueueGetPending(limit = 10) {
  if (!db) return []
  return db.prepare(
    `SELECT * FROM ecf_queue WHERE attempts < 500 AND created_at > datetime('now','-72 hours') ORDER BY id ASC LIMIT ?`
  ).all(limit)
}

function ecfQueueDelete(id) {
  if (!db) return
  db.prepare('DELETE FROM ecf_queue WHERE id=?').run(id)
}

function ecfQueueIncrAttempts(id) {
  if (!db) return
  db.prepare(`UPDATE ecf_queue SET attempts=attempts+1, last_tried=datetime('now') WHERE id=?`).run(id)
}

function ecfQueueCount() {
  if (!db) return 0
  return db.prepare(`SELECT COUNT(*) as c FROM ecf_queue WHERE created_at > datetime('now','-72 hours')`).get()?.c || 0
}

// ── e-CF submissions log ──────────────────────────────────────────────────────

function ecfSubmissionAdd({ encf, tipoEcf, ticketId, xmlHash, trackId, dgiiStatus, dgiiMessage, securityCode, signatureDate, xmlPath, environment }) {
  if (!db) return null
  const info = db.prepare(`INSERT OR REPLACE INTO ecf_submissions
    (encf, tipo_ecf, ticket_id, xml_hash, track_id, dgii_status, dgii_message, security_code, signature_date, xml_path, environment)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(encf, tipoEcf, ticketId || null, xmlHash || null, trackId || null,
         dgiiStatus ?? 3, dgiiMessage || null, securityCode || null,
         signatureDate || null, xmlPath || null, environment || 'testecf')
  return info.lastInsertRowid
}

function ecfSubmissionUpdate(trackId, { dgiiStatus, dgiiMessage, confirmedAt }) {
  if (!db) return
  db.prepare(`UPDATE ecf_submissions SET dgii_status=?, dgii_message=?, confirmed_at=? WHERE track_id=?`)
    .run(dgiiStatus, dgiiMessage || null, confirmedAt || new Date().toISOString(), trackId)
}

function ecfSubmissionGetByTrackId(trackId) {
  if (!db) return null
  return db.prepare('SELECT * FROM ecf_submissions WHERE track_id=?').get(trackId)
}

function ecfSubmissionGetByTicket(ticketId) {
  if (!db) return null
  return db.prepare('SELECT * FROM ecf_submissions WHERE ticket_id=? ORDER BY submitted_at DESC LIMIT 1').get(ticketId)
}

function ecfSubmissionGetPending(env) {
  if (!db) return []
  return db.prepare('SELECT * FROM ecf_submissions WHERE dgii_status=3 AND environment=? ORDER BY submitted_at ASC LIMIT 20')
    .all(env || 'testecf')
}

function ecfSubmissionGetAll(limit = 50) {
  if (!db) return []
  return db.prepare('SELECT * FROM ecf_submissions ORDER BY submitted_at DESC LIMIT ?').all(limit)
}

// ── ACTIVITY LOG (owner audit feed) ───────────────────────────────────────────
// Module-level actor context — set by UI on login so every mutation knows "who"
// without needing to thread an actor_id param through every function signature.
let _currentActor = null
function setActiveUser(user) {
  if (!user || !user.id) { _currentActor = null; return }
  _currentActor = { id: user.id, name: user.name || null, role: user.role || null }
}
function getActiveUser() { return _currentActor }

function activityLogRecord(evt) {
  if (!db || !evt || !evt.event_type) return
  try {
    let { actor_user_id, actor_name, actor_role } = evt
    if (!actor_user_id && _currentActor) {
      actor_user_id = _currentActor.id
      actor_name    = actor_name || _currentActor.name
      actor_role    = actor_role || _currentActor.role
    }
    let actor_supabase_id = null
    if (actor_user_id) {
      const u = db.prepare('SELECT name, role, supabase_id FROM users WHERE id=?').get(actor_user_id)
      if (u) {
        actor_supabase_id = u.supabase_id || null
        if (!actor_name) actor_name = u.name
        if (!actor_role) actor_role = u.role
      }
    }
    const sid = crypto.randomUUID()
    db.prepare(`INSERT INTO activity_log
      (supabase_id, event_type, severity, actor_user_id, actor_supabase_id, actor_name, actor_role,
       target_type, target_id, target_name, amount, old_value, new_value, reason, metadata)
      VALUES (@supabase_id, @event_type, @severity, @actor_user_id, @actor_supabase_id, @actor_name, @actor_role,
              @target_type, @target_id, @target_name, @amount, @old_value, @new_value, @reason, @metadata)`).run({
      supabase_id: sid,
      event_type:  evt.event_type,
      severity:    evt.severity || 'info',
      actor_user_id:     actor_user_id || null,
      actor_supabase_id: actor_supabase_id,
      actor_name:        actor_name || null,
      actor_role:        actor_role || null,
      target_type: evt.target_type || null,
      target_id:   evt.target_id != null ? String(evt.target_id) : null,
      target_name: evt.target_name || null,
      amount:      evt.amount != null ? Number(evt.amount) : null,
      old_value:   evt.old_value != null ? String(evt.old_value) : null,
      new_value:   evt.new_value != null ? String(evt.new_value) : null,
      reason:      evt.reason || null,
      metadata:    evt.metadata ? JSON.stringify(evt.metadata) : null,
    })
  } catch (e) { console.error('[activity_log] record failed:', e.message) }
}

function activityLogList({ dateFrom, dateTo, eventTypes, limit = 200 } = {}) {
  if (!db) return []
  let sql = `SELECT * FROM activity_log WHERE 1=1`
  const params = []
  if (dateFrom) { sql += ' AND created_at >= ?'; params.push(dateFrom) }
  if (dateTo)   { sql += ' AND created_at <= ?'; params.push(dateTo) }
  if (Array.isArray(eventTypes) && eventTypes.length) {
    sql += ` AND event_type IN (${eventTypes.map(() => '?').join(',')})`
    params.push(...eventTypes)
  }
  sql += ' ORDER BY created_at DESC LIMIT ?'
  params.push(Math.min(Number(limit) || 200, 1000))
  return db.prepare(sql).all(...params)
}

// ── VEHICLES ─────────────────────────────────────────────────────────────────
function vehicleCreate({ vin, plate, make, model, year, color, mileage, client_id, notes }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const client = client_id ? db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(client_id) : null
  const r = db.prepare(`INSERT INTO vehicles(supabase_id, vin, plate, make, model, year, color, mileage, client_id, client_supabase_id, notes)
    VALUES(@supabase_id, @vin, @plate, @make, @model, @year, @color, @mileage, @client_id, @client_supabase_id, @notes)`).run({
    supabase_id: sid, vin: vin || null, plate: plate || null, make: make || null, model: model || null,
    year: year != null ? Number(year) : null, color: color || null, mileage: mileage != null ? Number(mileage) : null,
    client_id: client_id || null, client_supabase_id: client?.supabase_id || null, notes: notes || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function vehicleUpdate(id, data) {
  if (!db) return
  const allowed = ['vin','plate','make','model','year','color','mileage','client_id','client_supabase_id','notes','active']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (data.client_id && !data.client_supabase_id) {
    const c = db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(data.client_id)
    if (c) patch.client_supabase_id = c.supabase_id
  }
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM vehicles WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE vehicles SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM vehicles WHERE id=?').get(id)
}
function vehicleList({ client_id, active } = {}) {
  if (!db) return []
  let sql = 'SELECT v.*, c.name AS client_name FROM vehicles v LEFT JOIN clients c ON c.id = v.client_id WHERE 1=1'
  const params = []
  if (client_id) { sql += ' AND v.client_id = ?'; params.push(client_id) }
  if (active !== undefined) { sql += ' AND v.active = ?'; params.push(active ? 1 : 0) }
  sql += ' ORDER BY v.created_at DESC'
  return db.prepare(sql).all(...params)
}
function vehicleGetById(id) {
  if (!db) return null
  return db.prepare('SELECT v.*, c.name AS client_name FROM vehicles v LEFT JOIN clients c ON c.id = v.client_id WHERE v.id=?').get(id)
}
function vehicleDelete(id) {
  if (!db) return
  db.prepare("UPDATE vehicles SET active=0, updated_at=datetime('now') WHERE id=?").run(id)
}

// ── SERVICE BAYS ─────────────────────────────────────────────────────────────
function serviceBayCreate({ name, capacity, bay_type }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO service_bays(supabase_id, name, capacity, bay_type) VALUES(?,?,?,?)`).run(
    sid, name, capacity != null ? Number(capacity) : 1, bay_type || null,
  )
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function serviceBayUpdate(id, data) {
  if (!db) return
  const allowed = ['name','status','current_work_order_id','current_work_order_supabase_id','capacity','bay_type','active']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM service_bays WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE service_bays SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM service_bays WHERE id=?').get(id)
}
function serviceBayList({ active } = {}) {
  if (!db) return []
  if (active !== undefined) return db.prepare('SELECT * FROM service_bays WHERE active=? ORDER BY name').all(active ? 1 : 0)
  return db.prepare('SELECT * FROM service_bays ORDER BY name').all()
}
function serviceBayDelete(id) {
  if (!db) return
  db.prepare("UPDATE service_bays SET active=0, updated_at=datetime('now') WHERE id=?").run(id)
}

// ── WORK ORDERS ──────────────────────────────────────────────────────────────
function workOrderCreate({ vehicle_id, client_id, technician_empleado_id, bay_id, status, estimated_total, promised_date, notes }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const vehicle = vehicle_id ? db.prepare('SELECT supabase_id FROM vehicles WHERE id=?').get(vehicle_id) : null
  const client = client_id ? db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(client_id) : null
  const tech = technician_empleado_id ? db.prepare('SELECT supabase_id FROM empleados WHERE id=?').get(technician_empleado_id) : null
  const bay = bay_id ? db.prepare('SELECT supabase_id FROM service_bays WHERE id=?').get(bay_id) : null
  const r = db.prepare(`INSERT INTO work_orders(supabase_id, vehicle_id, vehicle_supabase_id, client_id, client_supabase_id,
    technician_empleado_id, technician_empleado_supabase_id, bay_id, bay_supabase_id, status, estimated_total, promised_date, notes)
    VALUES(@sid, @vehicle_id, @vehicle_sid, @client_id, @client_sid, @tech_id, @tech_sid, @bay_id, @bay_sid, @status, @estimated_total, @promised_date, @notes)`).run({
    sid, vehicle_id: vehicle_id || null, vehicle_sid: vehicle?.supabase_id || null,
    client_id: client_id || null, client_sid: client?.supabase_id || null,
    tech_id: technician_empleado_id || null, tech_sid: tech?.supabase_id || null,
    bay_id: bay_id || null, bay_sid: bay?.supabase_id || null,
    status: status || 'estimate', estimated_total: Number(estimated_total) || 0,
    promised_date: promised_date || null, notes: notes || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function workOrderUpdate(id, data) {
  if (!db) return
  const allowed = ['vehicle_id','vehicle_supabase_id','client_id','client_supabase_id','technician_empleado_id','technician_empleado_supabase_id','bay_id','bay_supabase_id','status','estimated_total','actual_total','promised_date','completed_date','notes']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  // Resolve FK supabase_ids
  if (data.vehicle_id && !data.vehicle_supabase_id) { const v = db.prepare('SELECT supabase_id FROM vehicles WHERE id=?').get(data.vehicle_id); if (v) patch.vehicle_supabase_id = v.supabase_id }
  if (data.client_id && !data.client_supabase_id) { const c = db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(data.client_id); if (c) patch.client_supabase_id = c.supabase_id }
  if (data.technician_empleado_id && !data.technician_empleado_supabase_id) { const t = db.prepare('SELECT supabase_id FROM empleados WHERE id=?').get(data.technician_empleado_id); if (t) patch.technician_empleado_supabase_id = t.supabase_id }
  if (data.bay_id && !data.bay_supabase_id) { const b = db.prepare('SELECT supabase_id FROM service_bays WHERE id=?').get(data.bay_id); if (b) patch.bay_supabase_id = b.supabase_id }
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM work_orders WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE work_orders SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  // If bay assigned, update service_bays
  if (data.bay_id && data.status && data.status !== 'estimate' && data.status !== 'completed') {
    db.prepare("UPDATE service_bays SET current_work_order_id=?, status='ocupado', updated_at=datetime('now') WHERE id=?").run(id, data.bay_id)
  }
  return db.prepare('SELECT * FROM work_orders WHERE id=?').get(id)
}
function workOrderList({ status, vehicle_id, client_id } = {}) {
  if (!db) return []
  let sql = `SELECT wo.*, v.plate AS vehicle_plate, v.make AS vehicle_make, v.model AS vehicle_model, v.color AS vehicle_color,
    c.name AS client_name, e.nombre AS technician_name, sb.name AS bay_name
    FROM work_orders wo
    LEFT JOIN vehicles v ON v.id = wo.vehicle_id
    LEFT JOIN clients c ON c.id = wo.client_id
    LEFT JOIN empleados e ON e.id = wo.technician_empleado_id
    LEFT JOIN service_bays sb ON sb.id = wo.bay_id
    WHERE 1=1`
  const params = []
  if (status) { sql += ' AND wo.status = ?'; params.push(status) }
  if (vehicle_id) { sql += ' AND wo.vehicle_id = ?'; params.push(vehicle_id) }
  if (client_id) { sql += ' AND wo.client_id = ?'; params.push(client_id) }
  sql += ' ORDER BY wo.created_at DESC'
  return db.prepare(sql).all(...params)
}
function workOrderGetById(id) {
  if (!db) return null
  const wo = db.prepare(`SELECT wo.*, v.plate AS vehicle_plate, v.make AS vehicle_make, v.model AS vehicle_model, v.color AS vehicle_color,
    c.name AS client_name, e.nombre AS technician_name, sb.name AS bay_name
    FROM work_orders wo
    LEFT JOIN vehicles v ON v.id = wo.vehicle_id
    LEFT JOIN clients c ON c.id = wo.client_id
    LEFT JOIN empleados e ON e.id = wo.technician_empleado_id
    LEFT JOIN service_bays sb ON sb.id = wo.bay_id
    WHERE wo.id=?`).get(id)
  if (wo) wo.items = db.prepare('SELECT * FROM work_order_items WHERE work_order_id=? ORDER BY id').all(id)
  return wo
}

// ── WORK ORDER ITEMS ─────────────────────────────────────────────────────────
function workOrderItemCreate({ work_order_id, type, name, description, quantity, unit_price, warranty_months, inventory_item_id }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const wo = db.prepare('SELECT supabase_id FROM work_orders WHERE id=?').get(work_order_id)
  const inv = inventory_item_id ? db.prepare('SELECT supabase_id FROM inventory_items WHERE id=?').get(inventory_item_id) : null
  const total = (Number(quantity) || 1) * (Number(unit_price) || 0)
  const r = db.prepare(`INSERT INTO work_order_items(supabase_id, work_order_id, work_order_supabase_id, type, name, description, quantity, unit_price, total, warranty_months, inventory_item_id, inventory_item_supabase_id)
    VALUES(@sid, @work_order_id, @wo_sid, @type, @name, @description, @quantity, @unit_price, @total, @warranty_months, @inv_id, @inv_sid)`).run({
    sid, work_order_id, wo_sid: wo?.supabase_id || null, type: type || 'labor', name,
    description: description || null, quantity: Number(quantity) || 1, unit_price: Number(unit_price) || 0,
    total, warranty_months: Number(warranty_months) || 0,
    inv_id: inventory_item_id || null, inv_sid: inv?.supabase_id || null,
  })
  // Recalculate work order totals
  const sum = db.prepare('SELECT COALESCE(SUM(total),0) AS t FROM work_order_items WHERE work_order_id=?').get(work_order_id)
  db.prepare("UPDATE work_orders SET estimated_total=?, updated_at=datetime('now') WHERE id=?").run(sum.t, work_order_id)
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function workOrderItemUpdate(id, data) {
  if (!db) return
  const allowed = ['type','name','description','quantity','unit_price','warranty_months','inventory_item_id','inventory_item_supabase_id']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (data.quantity !== undefined || data.unit_price !== undefined) {
    const existing = db.prepare('SELECT quantity, unit_price FROM work_order_items WHERE id=?').get(id)
    const qty = data.quantity !== undefined ? Number(data.quantity) : existing.quantity
    const price = data.unit_price !== undefined ? Number(data.unit_price) : existing.unit_price
    patch.total = qty * price
  }
  if (data.inventory_item_id && !data.inventory_item_supabase_id) {
    const inv = db.prepare('SELECT supabase_id FROM inventory_items WHERE id=?').get(data.inventory_item_id)
    if (inv) patch.inventory_item_supabase_id = inv.supabase_id
  }
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM work_order_items WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE work_order_items SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  // Recalculate parent
  const item = db.prepare('SELECT work_order_id FROM work_order_items WHERE id=?').get(id)
  if (item) {
    const sum = db.prepare('SELECT COALESCE(SUM(total),0) AS t FROM work_order_items WHERE work_order_id=?').get(item.work_order_id)
    db.prepare("UPDATE work_orders SET estimated_total=?, updated_at=datetime('now') WHERE id=?").run(sum.t, item.work_order_id)
  }
  return db.prepare('SELECT * FROM work_order_items WHERE id=?').get(id)
}
function workOrderItemDelete(id) {
  if (!db) return
  const item = db.prepare('SELECT work_order_id FROM work_order_items WHERE id=?').get(id)
  db.prepare('DELETE FROM work_order_items WHERE id=?').run(id)
  if (item) {
    const sum = db.prepare('SELECT COALESCE(SUM(total),0) AS t FROM work_order_items WHERE work_order_id=?').get(item.work_order_id)
    db.prepare("UPDATE work_orders SET estimated_total=?, updated_at=datetime('now') WHERE id=?").run(sum.t, item.work_order_id)
  }
}
function workOrderItemsByOrder(work_order_id) {
  if (!db) return []
  return db.prepare('SELECT * FROM work_order_items WHERE work_order_id=? ORDER BY id').all(work_order_id)
}

// ── APPOINTMENTS ─────────────────────────────────────────────────────────────
function appointmentCreate({ client_id, empleado_id, date, start_time, end_time, services, notes }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const client = client_id ? db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(client_id) : null
  const emp = empleado_id ? db.prepare('SELECT supabase_id FROM empleados WHERE id=?').get(empleado_id) : null
  const r = db.prepare(`INSERT INTO appointments(supabase_id, client_id, client_supabase_id, empleado_id, empleado_supabase_id, date, start_time, end_time, services, notes)
    VALUES(@sid, @client_id, @client_sid, @empleado_id, @emp_sid, @date, @start_time, @end_time, @services, @notes)`).run({
    sid, client_id: client_id || null, client_sid: client?.supabase_id || null,
    empleado_id: empleado_id || null, emp_sid: emp?.supabase_id || null,
    date, start_time, end_time: end_time || null,
    services: typeof services === 'string' ? services : JSON.stringify(services || []),
    notes: notes || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function appointmentUpdate(id, data) {
  if (!db) return
  const allowed = ['client_id','client_supabase_id','empleado_id','empleado_supabase_id','date','start_time','end_time','status','services','notes']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (data.client_id && !data.client_supabase_id) { const c = db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(data.client_id); if (c) patch.client_supabase_id = c.supabase_id }
  if (data.empleado_id && !data.empleado_supabase_id) { const e = db.prepare('SELECT supabase_id FROM empleados WHERE id=?').get(data.empleado_id); if (e) patch.empleado_supabase_id = e.supabase_id }
  if (data.services && typeof data.services !== 'string') patch.services = JSON.stringify(data.services)
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM appointments WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE appointments SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM appointments WHERE id=?').get(id)
}
function appointmentList({ date, empleado_id, status, dateFrom, dateTo } = {}) {
  if (!db) return []
  let sql = `SELECT a.*, c.name AS client_name, e.nombre AS empleado_name
    FROM appointments a LEFT JOIN clients c ON c.id = a.client_id LEFT JOIN empleados e ON e.id = a.empleado_id WHERE 1=1`
  const params = []
  if (date)        { sql += ' AND a.date = ?';        params.push(date) }
  if (empleado_id) { sql += ' AND a.empleado_id = ?'; params.push(empleado_id) }
  if (status)      { sql += ' AND a.status = ?';      params.push(status) }
  if (dateFrom)    { sql += ' AND a.date >= ?';        params.push(dateFrom) }
  if (dateTo)      { sql += ' AND a.date <= ?';        params.push(dateTo) }
  sql += ' ORDER BY a.date, a.start_time'
  return db.prepare(sql).all(...params)
}
function appointmentGetById(id) {
  if (!db) return null
  return db.prepare(`SELECT a.*, c.name AS client_name, e.nombre AS empleado_name
    FROM appointments a LEFT JOIN clients c ON c.id = a.client_id LEFT JOIN empleados e ON e.id = a.empleado_id WHERE a.id=?`).get(id)
}
function appointmentDelete(id) {
  if (!db) return
  db.prepare("UPDATE appointments SET status='cancelled', updated_at=datetime('now') WHERE id=?").run(id)
}

// ── STYLIST SCHEDULES ────────────────────────────────────────────────────────
function stylistScheduleCreate({ empleado_id, day_of_week, start_time, end_time }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const emp = db.prepare('SELECT supabase_id FROM empleados WHERE id=?').get(empleado_id)
  const r = db.prepare(`INSERT INTO stylist_schedules(supabase_id, empleado_id, empleado_supabase_id, day_of_week, start_time, end_time)
    VALUES(?,?,?,?,?,?)`).run(sid, empleado_id, emp?.supabase_id || null, day_of_week, start_time, end_time)
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function stylistScheduleUpdate(id, data) {
  if (!db) return
  const allowed = ['empleado_id','empleado_supabase_id','day_of_week','start_time','end_time','active']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (data.empleado_id && !data.empleado_supabase_id) { const e = db.prepare('SELECT supabase_id FROM empleados WHERE id=?').get(data.empleado_id); if (e) patch.empleado_supabase_id = e.supabase_id }
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM stylist_schedules WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE stylist_schedules SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM stylist_schedules WHERE id=?').get(id)
}
function stylistScheduleList({ empleado_id } = {}) {
  if (!db) return []
  if (empleado_id) return db.prepare('SELECT ss.*, e.nombre AS empleado_name FROM stylist_schedules ss LEFT JOIN empleados e ON e.id=ss.empleado_id WHERE ss.active=1 AND ss.empleado_id=? ORDER BY ss.day_of_week, ss.start_time').all(empleado_id)
  return db.prepare('SELECT ss.*, e.nombre AS empleado_name FROM stylist_schedules ss LEFT JOIN empleados e ON e.id=ss.empleado_id WHERE ss.active=1 ORDER BY ss.day_of_week, ss.start_time').all()
}
function stylistScheduleDelete(id) {
  if (!db) return
  db.prepare("UPDATE stylist_schedules SET active=0, updated_at=datetime('now') WHERE id=?").run(id)
}

// ── LOANS ────────────────────────────────────────────────────────────────────
function loanCreate({ client_id, principal, term_months, interest_rate, monthly_payment, disbursed_at, next_due_date, notes }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const client = db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(client_id)
  const mp = monthly_payment || (Number(principal) * (1 + Number(interest_rate) / 100 * Number(term_months) / 12)) / Number(term_months)
  const r = db.prepare(`INSERT INTO loans(supabase_id, client_id, client_supabase_id, principal, term_months, interest_rate, monthly_payment, disbursed_at, next_due_date, notes)
    VALUES(@sid, @client_id, @client_sid, @principal, @term_months, @interest_rate, @monthly_payment, @disbursed_at, @next_due_date, @notes)`).run({
    sid, client_id, client_sid: client?.supabase_id || null,
    principal: Number(principal), term_months: Number(term_months), interest_rate: Number(interest_rate),
    monthly_payment: Number(mp), disbursed_at: disbursed_at || null,
    next_due_date: next_due_date || null, notes: notes || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function loanUpdate(id, data) {
  if (!db) return
  const allowed = ['client_id','client_supabase_id','principal','term_months','interest_rate','monthly_payment','status','disbursed_at','next_due_date','total_paid','total_interest','notes']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (data.client_id && !data.client_supabase_id) { const c = db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(data.client_id); if (c) patch.client_supabase_id = c.supabase_id }
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM loans WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE loans SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM loans WHERE id=?').get(id)
}
function loanList({ client_id, status } = {}) {
  if (!db) return []
  let sql = 'SELECT l.*, c.name AS client_name FROM loans l LEFT JOIN clients c ON c.id = l.client_id WHERE 1=1'
  const params = []
  if (client_id) { sql += ' AND l.client_id = ?'; params.push(client_id) }
  if (status)    { sql += ' AND l.status = ?';    params.push(status) }
  sql += ' ORDER BY l.created_at DESC'
  return db.prepare(sql).all(...params)
}
function loanGetById(id) {
  if (!db) return null
  const loan = db.prepare('SELECT l.*, c.name AS client_name FROM loans l LEFT JOIN clients c ON c.id = l.client_id WHERE l.id=?').get(id)
  if (loan) {
    loan.payments = db.prepare('SELECT * FROM loan_payments WHERE loan_id=? ORDER BY payment_date DESC').all(id)
    loan.pawn_items = db.prepare('SELECT * FROM pawn_items WHERE loan_id=? ORDER BY id').all(id)
  }
  return loan
}

// ── LOAN PAYMENTS ────────────────────────────────────────────────────────────
function loanPaymentCreate({ loan_id, amount, principal_portion, interest_portion, late_fee, payment_date, due_date, status, notes }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const loan = db.prepare('SELECT supabase_id FROM loans WHERE id=?').get(loan_id)
  const r = db.prepare(`INSERT INTO loan_payments(supabase_id, loan_id, loan_supabase_id, amount, principal_portion, interest_portion, late_fee, payment_date, due_date, status, notes)
    VALUES(@sid, @loan_id, @loan_sid, @amount, @principal_portion, @interest_portion, @late_fee, @payment_date, @due_date, @status, @notes)`).run({
    sid, loan_id, loan_sid: loan?.supabase_id || null,
    amount: Number(amount), principal_portion: Number(principal_portion) || 0,
    interest_portion: Number(interest_portion) || 0, late_fee: Number(late_fee) || 0,
    payment_date: payment_date || new Date().toISOString().slice(0, 10),
    due_date: due_date || null, status: status || 'on_time', notes: notes || null,
  })
  // Update loan totals
  db.prepare(`UPDATE loans SET total_paid = total_paid + ?, total_interest = total_interest + ?, updated_at=datetime('now') WHERE id=?`).run(
    Number(amount), Number(interest_portion) || 0, loan_id)
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function loanPaymentList({ loan_id } = {}) {
  if (!db) return []
  if (!loan_id) return []
  return db.prepare('SELECT * FROM loan_payments WHERE loan_id=? ORDER BY payment_date DESC').all(loan_id)
}

// ── PAWN ITEMS ───────────────────────────────────────────────────────────────
function pawnItemCreate({ client_id, loan_id, description, estimated_value, storage_location, redeem_deadline, notes }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const client = client_id ? db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(client_id) : null
  const loan = loan_id ? db.prepare('SELECT supabase_id FROM loans WHERE id=?').get(loan_id) : null
  const r = db.prepare(`INSERT INTO pawn_items(supabase_id, client_id, client_supabase_id, loan_id, loan_supabase_id, description, estimated_value, storage_location, redeem_deadline, notes)
    VALUES(@sid, @client_id, @client_sid, @loan_id, @loan_sid, @description, @estimated_value, @storage_location, @redeem_deadline, @notes)`).run({
    sid, client_id: client_id || null, client_sid: client?.supabase_id || null,
    loan_id: loan_id || null, loan_sid: loan?.supabase_id || null,
    description, estimated_value: Number(estimated_value) || 0,
    storage_location: storage_location || null, redeem_deadline: redeem_deadline || null,
    notes: notes || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function pawnItemUpdate(id, data) {
  if (!db) return
  const allowed = ['client_id','client_supabase_id','loan_id','loan_supabase_id','description','estimated_value','storage_location','status','redeem_deadline','notes']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (data.client_id && !data.client_supabase_id) { const c = db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(data.client_id); if (c) patch.client_supabase_id = c.supabase_id }
  if (data.loan_id && !data.loan_supabase_id) { const l = db.prepare('SELECT supabase_id FROM loans WHERE id=?').get(data.loan_id); if (l) patch.loan_supabase_id = l.supabase_id }
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM pawn_items WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE pawn_items SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM pawn_items WHERE id=?').get(id)
}
function pawnItemList({ client_id, loan_id, status } = {}) {
  if (!db) return []
  let sql = 'SELECT pi.*, c.name AS client_name FROM pawn_items pi LEFT JOIN clients c ON c.id = pi.client_id WHERE 1=1'
  const params = []
  if (client_id) { sql += ' AND pi.client_id = ?'; params.push(client_id) }
  if (loan_id)   { sql += ' AND pi.loan_id = ?';   params.push(loan_id) }
  if (status)    { sql += ' AND pi.status = ?';     params.push(status) }
  sql += ' ORDER BY pi.created_at DESC'
  return db.prepare(sql).all(...params)
}
function pawnItemDelete(id) {
  if (!db) return
  db.prepare("UPDATE pawn_items SET status='forfeited', updated_at=datetime('now') WHERE id=?").run(id)
}

// ── Public API ────────────────────────────────────────────────────────────────
// ── Raw DB access for sync module ────────────────────────────────────────────
function rawPrepare(sql) { return db ? db.prepare(sql) : null }
function rawExec(sql) { if (db) db.exec(sql) }

function closeDb() {
  try { if (db) db.close() } catch {}
  db = null
}

module.exports = {
  init, isReady, getError, rawPrepare, rawExec, closeDb,
  // Empresa
  configGet, configSet,
  empresaGet, empresaSave,
  // Settings
  settingsGet, settingsUpdate, getSetting, setSetting,
  // Auth
  authByPin, usersGetAll, userCreate, userUpdate, userDelete,
  // Categorías de servicio
  categoriasGetAll, categoriaCreate, categoriaUpdate, categoriaDelete,
  // Services
  servicesGetAll, servicesGetAllAdmin, serviceCreate, serviceUpdate, serviceDelete,
  // Washers
  washersGetAll, washersGetAllAdmin, washerCreate, washerUpdate, washerDelete,
  // Sellers
  sellersGetAll, sellersGetAllAdmin, sellerCreate, sellerUpdate, sellerDelete,
  // Empleados (payroll)
  empleadosGetAll, empleadosGetAllAdmin, empleadoCreate, empleadoUpdate, empleadoDelete, empleadoHardDelete,
  payrollRunCreate, payrollRunsByEmpleado, payrollRunsByPeriod, payrollRunDelete, payrollRunsBulkCreate,
  payrollSettingsGet, payrollSettingsUpdate, salaryChangesByEmpleado, salaryAtDate, salaryChangeCreate, salaryChangeDelete,
  // Adelantos de nomina (salary advances)
  adelantoCreate, adelantoList, adelantosByEmpleado, adelantoPendingTotal, adelantoDeduct, adelantoCancel, adelantoSummary,
  // Clients
  clientsGetAll, clientGetById, clientCreate, clientUpdate, clientUpdateBalance, clientGetOpenTickets, collectCredit,
  // Tickets
  ticketsGetAll, ticketGetById, ticketCreate, ticketMarkPaid, ticketVoid, ticketGetByDateRange,
  // Price changes
  ticketItemUpdatePrice, priceChangesGetByTicket, priceChangesGetAll,
  // Queue
  queueGetActive, queueUpdateStatus, queueDelete,
  // Commissions
  commissionsGetByWasher, commissionsGetByPeriod, commissionsMarkPaid,
  sellerCommissionsBySeller, sellerCommissionsByPeriod, sellerCommissionsMarkPaid,
  cajeroCommissionsByCajero, cajeroCommissionsByPeriod, cajeroCommissionsMarkPaid,
  // Cuadre
  cuadreCreate, cuadreGetHistory, cuadreList, cuadreDailySummary,
  // NCF
  ncfGetSequences, ncfGetNext, ncfUpdateSequence,
  // Caja chica
  cajaChicaGetAll, cajaChicaCreate, cajaChicaUpdateStatus,
  // Notas
  notasGetAll, notaCreate,
  // Backup / export
  exportAll, exportSince, exportToSupabase,
  // DGII
  get606Data,
  getCompras607, addCompra607, deleteCompra607,
  // RNC contribuyentes
  rncLookupLocal, rncSave, rncBulkSync, rncCount, rncLastSync,
  // Inventory
  inventoryGetAll, inventoryCreate, inventoryUpdate, inventoryDelete, inventoryAdjust, inventoryTransactions,
  inventoryLookupBySku, inventorySearch, inventoryLowStockCount,
  // e-CF offline queue
  ecfQueueAdd, ecfQueueGetPending, ecfQueueDelete, ecfQueueIncrAttempts, ecfQueueCount,
  // e-CF submissions log
  ecfSubmissionAdd, ecfSubmissionUpdate, ecfSubmissionGetByTrackId, ecfSubmissionGetByTicket,
  ecfSubmissionGetPending, ecfSubmissionGetAll,
  // Activity log (owner audit feed)
  setActiveUser, getActiveUser, activityLogRecord, activityLogList,
  // Restaurant Mode — mesas / modificadores / kds / ticket-item modifier snapshots
  mesasGetAll, mesaCreate, mesaUpdate, mesaSetStatus, mesaDelete,
  modificadoresGetAll, modificadoresGetAllAdmin, modificadorCreate, modificadorUpdate, modificadorDelete,
  modificadoresListForService, modificadorAttachToService, modificadorDetachFromService,
  kdsListActive, kdsFire, kdsSetStatus,
  ticketItemModificadoresList, ticketItemModificadoresSnapshot,
  // Multi-vertical expansion — vehicles, service_bays, work_orders, appointments, schedules, loans, pawn
  vehicleCreate, vehicleUpdate, vehicleList, vehicleGetById, vehicleDelete,
  serviceBayCreate, serviceBayUpdate, serviceBayList, serviceBayDelete,
  workOrderCreate, workOrderUpdate, workOrderList, workOrderGetById,
  workOrderItemCreate, workOrderItemUpdate, workOrderItemDelete, workOrderItemsByOrder,
  appointmentCreate, appointmentUpdate, appointmentList, appointmentGetById, appointmentDelete,
  stylistScheduleCreate, stylistScheduleUpdate, stylistScheduleList, stylistScheduleDelete,
  loanCreate, loanUpdate, loanList, loanGetById,
  loanPaymentCreate, loanPaymentList,
  pawnItemCreate, pawnItemUpdate, pawnItemList, pawnItemDelete,
}
