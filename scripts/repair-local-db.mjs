#!/usr/bin/env node
/**
 * repair-local-db.mjs — one-shot SQLite schema repair for Terminal X desktop.
 *
 * When an install upgrades across many versions, the migration loop can
 * silently skip ALTER TABLEs (mid-upgrade crashes, corrupt WAL, etc.). The
 * result: INSERTs fail with "no such column" errors that are maddening to
 * reproduce because the migration code LOOKS right.
 *
 * This script runs the full expected schema against your local DB. Every
 * CREATE is IF NOT EXISTS, every ALTER is wrapped in a try/catch so duplicate-
 * column errors are swallowed. Idempotent. Safe to run against prod data.
 *
 * Usage (on the PC running Terminal X):
 *   1. Close Terminal X first (the DB is locked while open).
 *   2. cd to the Terminal X repo on that PC (or wherever this script lives).
 *   3. node scripts/repair-local-db.mjs
 *   4. The script auto-finds your DB at %APPDATA%/Terminal X/terminal-x.db
 *      and prints a report of what it fixed.
 *   5. Reopen Terminal X.
 *
 * Before touching anything it creates a timestamped backup of your DB at
 * terminal-x.db.repair-<timestamp>.bak so you can roll back by renaming.
 */
import Database from 'better-sqlite3'
import { existsSync, copyFileSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import os from 'os'

// ── Locate the DB ────────────────────────────────────────────────────────────
function resolveDbPath() {
  if (process.argv[2]) return resolve(process.argv[2])
  const home = os.homedir()
  const candidates = [
    join(process.env.APPDATA || '', 'Terminal X', 'terminal-x.db'),
    join(home, 'Library', 'Application Support', 'Terminal X', 'terminal-x.db'),
    join(home, '.config', 'Terminal X', 'terminal-x.db'),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  throw new Error(`Could not find terminal-x.db. Pass the path as arg:\n  node repair-local-db.mjs "C:\\Users\\You\\AppData\\Roaming\\Terminal X\\terminal-x.db"`)
}

const dbPath = resolveDbPath()
console.log(`[repair] Target DB: ${dbPath}`)

// ── Backup first ─────────────────────────────────────────────────────────────
const backupPath = `${dbPath}.repair-${Date.now()}.bak`
copyFileSync(dbPath, backupPath)
console.log(`[repair] Backup created: ${backupPath}`)

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = OFF') // let us ALTER without FK complaints

// ── Apply schema.sql if available (all CREATE IF NOT EXISTS, safe) ──────────
try {
  const schemaPath = resolve(process.cwd(), 'db', 'schema.sql')
  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, 'utf8')
    try { db.exec(schema); console.log('[repair] Base schema applied (no-ops for existing tables)') }
    catch (e) { console.log(`[repair] Base schema: ${e.message.slice(0, 200)}`) }
  }
} catch {}

// ── The definitive expected-column list ─────────────────────────────────────
// Every column referenced by the current ticketCreate / queueAdd / ticketVoid
// INSERT + UPDATE statements. Run each as an ALTER; duplicates are ignored.
// Ordered by table for readability.
const ALTERS = [
  // tickets — full list
  "ALTER TABLE tickets ADD COLUMN washer_empleado_supabase_ids TEXT DEFAULT '[]'",
  "ALTER TABLE tickets ADD COLUMN seller_empleado_supabase_id TEXT",
  "ALTER TABLE tickets ADD COLUMN beverage_subtotal REAL NOT NULL DEFAULT 0",
  "ALTER TABLE tickets ADD COLUMN supabase_id TEXT",
  "ALTER TABLE tickets ADD COLUMN client_supabase_id TEXT",
  "ALTER TABLE tickets ADD COLUMN seller_supabase_id TEXT",
  "ALTER TABLE tickets ADD COLUMN cajero_supabase_id TEXT",
  "ALTER TABLE tickets ADD COLUMN mesa_id INTEGER",
  "ALTER TABLE tickets ADD COLUMN mesa_supabase_id TEXT",
  "ALTER TABLE tickets ADD COLUMN fulfillment_type TEXT",
  "ALTER TABLE tickets ADD COLUMN tip_amount REAL DEFAULT 0",
  "ALTER TABLE tickets ADD COLUMN split_bill INTEGER DEFAULT 0",
  "ALTER TABLE tickets ADD COLUMN payment_parts TEXT",
  "ALTER TABLE tickets ADD COLUMN void_by TEXT",
  "ALTER TABLE tickets ADD COLUMN void_at TEXT",
  "ALTER TABLE tickets ADD COLUMN mode TEXT",
  "ALTER TABLE tickets ADD COLUMN converted_from_mesa_id INTEGER",
  "ALTER TABLE tickets ADD COLUMN converted_from_mesa_supabase_id TEXT",
  "ALTER TABLE tickets ADD COLUMN converted_from_ticket_id INTEGER",
  "ALTER TABLE tickets ADD COLUMN converted_from_ticket_supabase_id TEXT",
  "ALTER TABLE tickets ADD COLUMN origin_hwid TEXT",
  "ALTER TABLE tickets ADD COLUMN origin_device_label TEXT",
  "ALTER TABLE tickets ADD COLUMN used_legacy_counter INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE tickets ADD COLUMN vehicle_plate TEXT",
  "ALTER TABLE tickets ADD COLUMN comprobante_type TEXT",
  "ALTER TABLE tickets ADD COLUMN ecf_result TEXT",
  "ALTER TABLE tickets ADD COLUMN ncf TEXT",
  "ALTER TABLE tickets ADD COLUMN updated_at TEXT",

  // ticket_items
  "ALTER TABLE ticket_items ADD COLUMN created_at TEXT",
  "ALTER TABLE ticket_items ADD COLUMN updated_at TEXT",
  "ALTER TABLE ticket_items ADD COLUMN supabase_id TEXT",
  "ALTER TABLE ticket_items ADD COLUMN ticket_supabase_id TEXT",
  "ALTER TABLE ticket_items ADD COLUMN service_supabase_id TEXT",
  "ALTER TABLE ticket_items ADD COLUMN inventory_item_supabase_id TEXT",
  "ALTER TABLE ticket_items ADD COLUMN inventory_item_id INTEGER",
  "ALTER TABLE ticket_items ADD COLUMN sku TEXT",
  "ALTER TABLE ticket_items ADD COLUMN cost REAL DEFAULT 0",
  "ALTER TABLE ticket_items ADD COLUMN weight REAL",
  "ALTER TABLE ticket_items ADD COLUMN unit TEXT",
  "ALTER TABLE ticket_items ADD COLUMN price_per_unit REAL",
  "ALTER TABLE ticket_items ADD COLUMN quantity INTEGER DEFAULT 1",

  // queue
  "ALTER TABLE queue ADD COLUMN empleado_supabase_id TEXT",
  "ALTER TABLE queue ADD COLUMN ticket_supabase_id TEXT",
  "ALTER TABLE queue ADD COLUMN supabase_id TEXT",
  "ALTER TABLE queue ADD COLUMN updated_at TEXT",

  // inventory_items
  "ALTER TABLE inventory_items ADD COLUMN supabase_id TEXT",
  "ALTER TABLE inventory_items ADD COLUMN updated_at TEXT",
  "ALTER TABLE inventory_items ADD COLUMN aplica_itbis INTEGER DEFAULT 1",
  "ALTER TABLE inventory_items ADD COLUMN barcode TEXT",
  "ALTER TABLE inventory_items ADD COLUMN category TEXT",

  // empleados
  "ALTER TABLE empleados ADD COLUMN supabase_id TEXT",
  "ALTER TABLE empleados ADD COLUMN updated_at TEXT",
  "ALTER TABLE empleados ADD COLUMN cedula TEXT",
  "ALTER TABLE empleados ADD COLUMN start_date TEXT",
  "ALTER TABLE empleados ADD COLUMN phone TEXT",
  "ALTER TABLE empleados ADD COLUMN email TEXT",
  "ALTER TABLE empleados ADD COLUMN role TEXT DEFAULT 'none'",
  "ALTER TABLE empleados ADD COLUMN comision_pct REAL DEFAULT 0",
  "ALTER TABLE empleados ADD COLUMN active INTEGER DEFAULT 1",
  "ALTER TABLE empleados ADD COLUMN salary REAL DEFAULT 0",

  // services
  "ALTER TABLE services ADD COLUMN supabase_id TEXT",
  "ALTER TABLE services ADD COLUMN updated_at TEXT",
  "ALTER TABLE services ADD COLUMN categoria_id INTEGER",
  "ALTER TABLE services ADD COLUMN aplica_itbis INTEGER DEFAULT 1",
  "ALTER TABLE services ADD COLUMN no_commission INTEGER DEFAULT 0",
  "ALTER TABLE services ADD COLUMN commission_washer INTEGER DEFAULT 1",
  "ALTER TABLE services ADD COLUMN commission_seller INTEGER DEFAULT 1",
  "ALTER TABLE services ADD COLUMN commission_cashier INTEGER DEFAULT 1",
  "ALTER TABLE services ADD COLUMN name_en TEXT",
  "ALTER TABLE services ADD COLUMN cost REAL DEFAULT 0",

  // ncf_sequences
  "ALTER TABLE ncf_sequences ADD COLUMN supabase_id TEXT",
  "ALTER TABLE ncf_sequences ADD COLUMN updated_at TEXT",
  "ALTER TABLE ncf_sequences ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE ncf_sequences ADD COLUMN valid_until TEXT",

  // clients
  "ALTER TABLE clients ADD COLUMN supabase_id TEXT",
  "ALTER TABLE clients ADD COLUMN updated_at TEXT",
  "ALTER TABLE clients ADD COLUMN balance REAL DEFAULT 0",
  "ALTER TABLE clients ADD COLUMN credit_limit REAL DEFAULT 0",
  "ALTER TABLE clients ADD COLUMN visits INTEGER DEFAULT 0",
  "ALTER TABLE clients ADD COLUMN total_spent REAL DEFAULT 0",

  // users / staff
  "ALTER TABLE users ADD COLUMN supabase_id TEXT",
  "ALTER TABLE users ADD COLUMN updated_at TEXT",
  "ALTER TABLE users ADD COLUMN employee_id INTEGER",
  "ALTER TABLE users ADD COLUMN commission_pct REAL NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN discount_pct REAL NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1",

  // businesses
  "ALTER TABLE businesses ADD COLUMN plan TEXT NOT NULL DEFAULT 'pro'",
  "ALTER TABLE businesses ADD COLUMN supabase_id TEXT",
  "ALTER TABLE businesses ADD COLUMN settings TEXT",

  // activity_log
  "ALTER TABLE activity_log ADD COLUMN supabase_id TEXT",
  "ALTER TABLE activity_log ADD COLUMN updated_at TEXT",

  // Multi-POS v2.3 tables (CREATE handled below if missing)
]

// ── Ensure multi-POS v2.3 tables exist ──────────────────────────────────────
const CREATES = [
  `CREATE TABLE IF NOT EXISTS ncf_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, supabase_id TEXT, business_id TEXT NOT NULL,
    hwid TEXT NOT NULL, ncf_type TEXT NOT NULL, prefix TEXT,
    range_start INTEGER NOT NULL, range_end INTEGER NOT NULL, next_available INTEGER NOT NULL,
    allocated_at TEXT NOT NULL DEFAULT (datetime('now')), exhausted_at TEXT, last_used_at TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS doc_number_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, supabase_id TEXT, business_id TEXT NOT NULL,
    hwid TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'ticket',
    range_start INTEGER NOT NULL, range_end INTEGER NOT NULL, next_available INTEGER NOT NULL,
    allocated_at TEXT NOT NULL DEFAULT (datetime('now')), exhausted_at TEXT, last_used_at TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_oversells (
    id INTEGER PRIMARY KEY AUTOINCREMENT, supabase_id TEXT, business_id TEXT NOT NULL,
    ticket_supabase_id TEXT, item_supabase_id TEXT, item_name TEXT,
    requested_qty REAL, actual_qty REAL, detected_at TEXT, resolved_at TEXT,
    resolved_by TEXT, resolved_by_name TEXT, resolution_notes TEXT, resolution_type TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS pending_inventory_deducts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, supabase_id TEXT,
    ticket_supabase_id TEXT NOT NULL, items_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    pushed_at TEXT, last_error TEXT, attempts INTEGER NOT NULL DEFAULT 0
  )`,
]

// ── Run everything, count hits ───────────────────────────────────────────────
let added = 0, skipped = 0, created = 0
for (const sql of CREATES) {
  try { db.exec(sql); created++ }
  catch (e) { /* ignore */ }
}
for (const sql of ALTERS) {
  try { db.exec(sql); added++; console.log(`  [+] ${sql.slice(0, 90)}`) }
  catch (e) {
    if (String(e.message).includes('duplicate column') || String(e.message).includes('no such table')) {
      skipped++
    } else {
      console.log(`  [!] ${sql.slice(0, 60)} — ${e.message.slice(0, 100)}`)
    }
  }
}

// ── Seed required app_settings if missing ───────────────────────────────────
const REQUIRED_SETTINGS = {
  multi_pos_enabled: '0',
  ncf_block_size: '500',
  doc_block_size: '200',
  itbis_pct: '18',
  print_factura_auto: '0',
  print_conduce_auto: '0',
  print_preticket: '0',
}
for (const [k, v] of Object.entries(REQUIRED_SETTINGS)) {
  try { db.prepare('INSERT OR IGNORE INTO app_settings(key, value) VALUES(?, ?)').run(k, v) } catch {}
}

// ── Final report ─────────────────────────────────────────────────────────────
const ticketCols = db.prepare("SELECT name FROM pragma_table_info('tickets')").all().map(r => r.name)
const hasMode = ticketCols.includes('mode')
const hasOriginHwid = ticketCols.includes('origin_hwid')
const hasUsedLegacy = ticketCols.includes('used_legacy_counter')

console.log('\n─────────────────────────────────────────────')
console.log(`[repair] Tables created: ${created}`)
console.log(`[repair] Columns added:  ${added}`)
console.log(`[repair] Already present: ${skipped}`)
console.log(`[repair] tickets.mode             : ${hasMode ? '✓' : '✗ MISSING'}`)
console.log(`[repair] tickets.origin_hwid      : ${hasOriginHwid ? '✓' : '✗ MISSING'}`)
console.log(`[repair] tickets.used_legacy_counter : ${hasUsedLegacy ? '✓' : '✗ MISSING'}`)
console.log(`[repair] Backup at: ${backupPath}`)
console.log('─────────────────────────────────────────────')
console.log('[repair] Done. Reopen Terminal X.')

db.close()
