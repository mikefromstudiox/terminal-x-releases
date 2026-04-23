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
const bcrypt  = require('bcryptjs')
const { isDeviceLocalCloudMirror } = require('./settingsWhitelist')

// Sprint 10 (v2.10.5) — PIN hashing config
//   - Legacy rows: unsalted SHA-256 (pin_hash_algo='sha256'). Accepted on login
//     exactly once; immediately rehashed to bcrypt in the same transaction.
//   - New rows: bcryptjs @ cost 10 (~50ms on a 2020-era laptop — slow enough
//     that 5 attempts/5-min lockout defeats brute force, fast enough that a
//     cashier never notices on sign-in).
//   - pin_salt stores a per-row 32-byte random suffix, appended to the PIN
//     before bcrypt. bcrypt has its own internal salt, but this extra suffix
//     makes the hash per-install unique even if two staff pick the same PIN
//     and the DB file is exfiltrated — rainbow tables built against the
//     world never apply.
const BCRYPT_COST = 10
function generatePinSalt() {
  return crypto.randomBytes(24).toString('base64')
}
function bcryptHashPin(pin, salt) {
  return bcrypt.hashSync(String(pin) + (salt || ''), BCRYPT_COST)
}
function bcryptComparePin(pin, salt, hash) {
  try { return bcrypt.compareSync(String(pin) + (salt || ''), String(hash || '')) }
  catch { return false }
}

// Lockout policy — 5 consecutive wrong guesses per row trigger a 5-minute
// cooldown. Desktop enforces this in-process against SQLite; web enforces the
// same rule against Supabase's staff table (atomic via a single UPDATE).
const PIN_MAX_FAILED_ATTEMPTS = 5
const PIN_LOCKOUT_MS = 5 * 60 * 1000

// v2.13 — at-rest encryption via better-sqlite3-multiple-ciphers (SQLCipher-
// compatible AES-256). API-identical fork of better-sqlite3, so every sync call
// in this 6k-line file keeps working byte-for-byte. If the ciphers fork ever
// fails to load we fall back to stock better-sqlite3 so the POS doesn't brick.
let Database
let dbLoadError = null
let dbEngine    = null
try {
  Database = require('better-sqlite3-multiple-ciphers')
  dbEngine = 'ciphers'
} catch (err1) {
  try {
    Database = require('better-sqlite3')
    dbEngine = 'plain'
    console.warn('[db] ciphers fork unavailable, using plain better-sqlite3:', err1.message)
  } catch (err2) {
    dbLoadError = err2.message
    console.error('[db] no sqlite driver available:', err2.message)
    Database = null
  }
}

let db = null
let dbInitError = null

// ── Initialise ────────────────────────────────────────────────────────────────
function isReady() { return !!db }
function getError() { return dbInitError || dbLoadError || null }

// v2.13.4 — first-boot encryption migration, rewritten.
//
// Previous approach used `sqlcipher_export()` which only exists in real
// SQLCipher — not in `better-sqlite3-multiple-ciphers` (which implements a
// SQLCipher-COMPATIBLE cipher via sqlite3mc, but doesn't ship that function).
// Every fresh install with a prior plaintext DB crashed at boot.
//
// New approach: manual schema + data copy into a fresh encrypted file.
//   1. Probe src — if opening without a key succeeds, it's plaintext.
//   2. Back up plaintext → .plaintext.bak (one-boot rollback window).
//   3. Open NEW encrypted file as `main` (so unqualified names in triggers/
//      views resolve to the encrypted schema, not the plaintext attached one).
//   4. ATTACH the plaintext src as `plain` with empty KEY (= no encryption).
//   5. Replay every CREATE TABLE/INDEX/VIEW/TRIGGER from plain.sqlite_master
//      onto main — unqualified, so the DDL lands exactly as authored.
//   6. For each table, INSERT INTO main.T SELECT * FROM plain.T.
//   7. DETACH, close, atomic rename encrypted → dbPath.
// Idempotent: already-encrypted source short-circuits on the probe.
function ensureEncrypted(dbPath, keyHex) {
  if (!fs.existsSync(dbPath)) return { ok: true, migrated: false, reason: 'no-db' }

  // Probe: can we open without a key?
  let plaintext = false
  let probe = null
  try {
    probe = new Database(dbPath, { fileMustExist: true })
    probe.prepare('SELECT count(*) FROM sqlite_master').get()
    plaintext = true
  } catch { plaintext = false }
  finally { try { probe && probe.close() } catch {} }

  if (!plaintext) return { ok: true, migrated: false, reason: 'already-encrypted' }

  console.log('[db] plaintext DB detected, running first-boot encryption migration...')
  const bakPath = dbPath + '.plaintext.bak'
  const encPath = dbPath + '.enc.tmp'
  try { fs.copyFileSync(dbPath, bakPath) } catch (err) { return { ok: false, error: 'backup failed: ' + err.message } }
  try { fs.existsSync(encPath) && fs.unlinkSync(encPath) } catch {}

  const escapeSqlPath = p => p.replace(/'/g, "''")
  const quoteIdent    = n => '"' + String(n).replace(/"/g, '""') + '"'

  let tableRowCounts = {}

  try {
    // Open the NEW encrypted DB as main.
    const dst = new Database(encPath)
    dst.pragma(`key = "x'${keyHex}'"`)
    dst.pragma('cipher_page_size = 4096')
    // Sanity: the first write to a freshly-keyed DB is what commits the
    // encryption header. Read sqlite_master to force a page touch.
    dst.prepare('SELECT count(*) FROM sqlite_master').get()

    // ATTACH plaintext source under an empty key (= no encryption on attach).
    dst.exec(`ATTACH DATABASE '${escapeSqlPath(dbPath)}' AS plain KEY ''`)

    // Pull full object graph from the PLAIN side.
    const objects = dst.prepare(
      `SELECT type, name, sql FROM plain.sqlite_master
        WHERE sql IS NOT NULL
          AND name NOT LIKE 'sqlite_%'
          AND (type = 'table' OR type = 'index' OR type = 'view' OR type = 'trigger')
        ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'view' THEN 2 WHEN 'index' THEN 3 WHEN 'trigger' THEN 4 ELSE 5 END, rowid`
    ).all()

    // Phase 1 — schema replay on main. Transaction scope: any failure rolls
    // the entire encrypted file back to empty, then we bail.
    dst.exec('BEGIN')
    for (const obj of objects) {
      if (obj.name.startsWith('sqlite_autoindex_')) continue
      try {
        // DDL is unqualified in sqlite_master, so it targets `main` by
        // default — exactly what we want since dst = main.
        dst.exec(obj.sql)
      } catch (err) {
        dst.exec('ROLLBACK')
        throw new Error(`replay ${obj.type} ${obj.name}: ${err.message}`)
      }
    }

    // Phase 2 — copy rows. Defer FK checking so intermediate partial states
    // don't explode. SQLite doesn't enforce FKs by default but some trigger
    // patterns reference foreign tables mid-insert; suspending PRAGMA is
    // belt-and-braces.
    dst.pragma('defer_foreign_keys=ON')
    const tables = dst.prepare(
      `SELECT name FROM plain.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid`
    ).all()
    for (const t of tables) {
      try {
        dst.exec(`INSERT INTO main.${quoteIdent(t.name)} SELECT * FROM plain.${quoteIdent(t.name)}`)
        const [srcN, dstN] = [
          dst.prepare(`SELECT count(*) AS n FROM plain.${quoteIdent(t.name)}`).get()?.n || 0,
          dst.prepare(`SELECT count(*) AS n FROM main.${quoteIdent(t.name)}`).get()?.n || 0,
        ]
        tableRowCounts[t.name] = { src: srcN, dst: dstN }
        if (srcN !== dstN) throw new Error(`row-count mismatch on ${t.name}: src=${srcN} dst=${dstN}`)
      } catch (err) {
        dst.exec('ROLLBACK')
        throw new Error(`copy ${t.name}: ${err.message}`)
      }
    }

    dst.exec('COMMIT')
    dst.exec('DETACH DATABASE plain')
    dst.close()
  } catch (err) {
    try { fs.existsSync(encPath) && fs.unlinkSync(encPath) } catch {}
    return { ok: false, error: 'manual-copy: ' + err.message }
  }

  // Independent re-open verify: the file must decrypt under the key and
  // return something sensible. Catches the silent-corruption case where
  // the copy succeeded but the encrypted header didn't flush properly.
  try {
    const verify = new Database(encPath)
    verify.pragma(`key = "x'${keyHex}'"`)
    verify.pragma('cipher_page_size = 4096')
    const n = verify.prepare('SELECT count(*) FROM sqlite_master').get()
    verify.close()
    if (!n) throw new Error('sqlite_master unreadable post-encrypt')
  } catch (err) {
    try { fs.existsSync(encPath) && fs.unlinkSync(encPath) } catch {}
    return { ok: false, error: 'verify-encrypted: ' + err.message }
  }

  // Atomic-ish swap. Close nothing (we haven't opened db yet at call site).
  try {
    fs.renameSync(dbPath, dbPath + '.old')
    fs.renameSync(encPath, dbPath)
    try { fs.unlinkSync(dbPath + '.old') } catch {}
    // Drop any WAL/SHM siblings from the plaintext era.
    try { fs.unlinkSync(dbPath + '-wal') } catch {}
    try { fs.unlinkSync(dbPath + '-shm') } catch {}
  } catch (err) {
    return { ok: false, error: 'file swap: ' + err.message }
  }

  const tableCount = Object.keys(tableRowCounts).length
  const rowsCopied = Object.values(tableRowCounts).reduce((s, r) => s + r.dst, 0)
  console.log(`[db] encryption migration complete — ${tableCount} tables / ${rowsCopied} rows. backup at ${bakPath}`)
  return { ok: true, migrated: true, tableCount, rowsCopied }
}

function init(userDataPath, options = {}) {
  if (!Database) { dbInitError = dbLoadError || 'better-sqlite3 not available'; return false }

  const dbPath     = path.join(userDataPath, 'terminal-x.db')
  const schemaPath = path.join(__dirname, '../db/schema.sql')
  const seedPath   = path.join(__dirname, '../db/seed.js')

  // v2.13 — at-rest encryption. main.js passes { encryptionKey } (64-hex HKDF
  // output from key-vault.js). If the driver is the ciphers fork AND a key is
  // supplied we PRAGMA key before the first read. Plaintext -> encrypted
  // migration handled by ensureEncrypted() below.
  let encryptionKey = (dbEngine === 'ciphers' && options.encryptionKey) ? options.encryptionKey : null
  if (encryptionKey) {
    try {
      const migrated = ensureEncrypted(dbPath, encryptionKey)
      if (!migrated.ok) {
        // v2.13.3 hotfix — better-sqlite3-multiple-ciphers does NOT ship the
        // sqlcipher_export function (that belongs to real SQLCipher), so the
        // first-boot plaintext→encrypted migration always fails on installs
        // that have a pre-encryption DB file. Refusing to init would lock
        // the user out of the POS entirely. Log loudly and continue with the
        // plaintext DB — at-rest encryption is a defense-in-depth measure,
        // not a correctness requirement, and a working POS beats a bricked
        // one. A future rewrite will use sqlite3mc_* APIs instead.
        console.warn('[db] encryption migration unavailable — continuing with plaintext DB:', migrated.error)
        encryptionKey = null
      }
    } catch (err) {
      console.warn('[db] ensureEncrypted threw — continuing with plaintext DB:', err.message)
      encryptionKey = null
    }
  }

  db = new Database(dbPath)
  if (encryptionKey) {
    // Raw-key form — skip SQLCipher's built-in KDF since HKDF already ran.
    db.pragma(`key = "x'${encryptionKey}'"`)
    db.pragma('cipher_page_size = 4096')
    // Smoke-test: any read that fails with "file is not a database" means the
    // key is wrong. Better to fail here than halfway through ticket creation.
    try { db.prepare('SELECT count(*) FROM sqlite_master').get() }
    catch (err) {
      dbInitError = 'DB key mismatch: ' + err.message
      console.error('[db]', dbInitError)
      try { db.close() } catch {}
      db = null
      return false
    }
  }
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -2000')
  db.pragma('temp_store = MEMORY')
  db.pragma('foreign_keys = ON')

  // Apply schema
  const schema = fs.readFileSync(schemaPath, 'utf8')
  db.exec(schema)

  // v2.1 legacy FK stubs — users.vendedor_id references sellers(id) in the
  // checked-in schema, and washer_id references washers(id). Both tables were
  // DROPPED in v2.1 (consolidated into empleados) but the FK declarations
  // remain. With foreign_keys=ON, any INSERT into users throws
  // "no such table: main.sellers" on fresh installs. Create empty stubs so
  // the FKs have a target. Legacy single-POS installs that still have real
  // sellers/washers data are unaffected (IF NOT EXISTS).
  try { db.exec('CREATE TABLE IF NOT EXISTS sellers (id INTEGER PRIMARY KEY AUTOINCREMENT)') } catch {}
  try { db.exec('CREATE TABLE IF NOT EXISTS washers (id INTEGER PRIMARY KEY AUTOINCREMENT)') } catch {}

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
    // v2.10.5 — cloud mirror of ecf_queue (Recovery RTO HIGH fix).
    // supabase_id + status/track_id/submitted_at/updated_at/error let sync.js
    // push pending rows to Supabase and a fresh install pull + resume via
    // processDgiiQueue(), so a PC death mid-queue doesn't orphan signed-but-
    // unsubmitted fiscal obligations.
    "ALTER TABLE ecf_queue ADD COLUMN supabase_id TEXT",
    "ALTER TABLE ecf_queue ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'",
    "ALTER TABLE ecf_queue ADD COLUMN track_id TEXT",
    "ALTER TABLE ecf_queue ADD COLUMN submitted_at TEXT",
    "ALTER TABLE ecf_queue ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))",
    "ALTER TABLE ecf_queue ADD COLUMN last_error TEXT",
    "ALTER TABLE ecf_queue ADD COLUMN ticket_supabase_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_ecf_queue_status ON ecf_queue(status, created_at)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_ecf_queue_supabase_id ON ecf_queue(supabase_id) WHERE supabase_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_ecf_queue_encf ON ecf_queue(encf) WHERE encf IS NOT NULL",
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
    // v2.6.2 — Apertura de Turno (shift open). Columns co-located on cuadre_caja
    // so one row represents the full shift (open → close). While status='abierto'
    // the closure fields stay at 0; when the cashier closes the shift the normal
    // cuadreCreate flow upgrades the same row to 'cerrado' with the cash counts.
    'ALTER TABLE cuadre_caja ADD COLUMN opening_cash REAL NOT NULL DEFAULT 0',
    'ALTER TABLE cuadre_caja ADD COLUMN opened_at TEXT',
    "ALTER TABLE cuadre_caja ADD COLUMN status TEXT NOT NULL DEFAULT 'cerrado'",
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
    // v2.1: `washers` table is dropped in the schema-consolidation migration further
    // below. On post-v2.1 installs this UPDATE will throw `no such table: washers`,
    // which is silently swallowed by the migration loop's catch (see filter list:
    // `!m.includes('no such table: washers')`). Kept for fresh-install parity and
    // for any pre-v2.1 DB that still hasn't run the consolidation.
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
    // v2.14 — Tombstone log for cloud-delete propagation. Any time desktop
    // deletes a synced row locally we record its (table, supabase_id) here so
    // the next sync cycle can issue DELETE against Supabase. Without this,
    // remote rows persist forever and resurrect local rows on pull.
    `CREATE TABLE IF NOT EXISTS sync_tombstones (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name   TEXT NOT NULL,
      supabase_id  TEXT NOT NULL,
      business_id  TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      attempts     INTEGER DEFAULT 0,
      last_error   TEXT,
      UNIQUE(table_name, supabase_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sync_tombstones_pending ON sync_tombstones(attempts, created_at)`,
    // v2.6.2 — ecf_cert_history (DGII cert rotation audit trail, synced to Supabase)
    `CREATE TABLE IF NOT EXISTS ecf_cert_history (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id          TEXT NOT NULL,
      cert_serial          TEXT,
      subject_cn           TEXT,
      subject_rnc          TEXT,
      issued_at            TEXT,
      expires_at           TEXT,
      installed_at         TEXT NOT NULL DEFAULT (datetime('now')),
      installed_by_user_id TEXT,
      installed_by_name    TEXT,
      installed_from       TEXT,
      rotation_reason      TEXT,
      sha256_fingerprint   TEXT,
      prev_serial          TEXT,
      prev_expires_at      TEXT,
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_ecf_cert_history_supabase_id ON ecf_cert_history(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ecf_cert_history_installed_at ON ecf_cert_history(installed_at DESC)`,
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
    // v2.2 — Restaurant: happy-hour pricing window (time-of-day strings HH:MM)
    'ALTER TABLE services ADD COLUMN happy_hour_price REAL',
    'ALTER TABLE services ADD COLUMN happy_hour_start TEXT',
    'ALTER TABLE services ADD COLUMN happy_hour_end   TEXT',
    // v2.2 — Restaurant: per-item course tag, KDS fire timestamp, guest-split tag
    'ALTER TABLE ticket_items ADD COLUMN course TEXT',
    'ALTER TABLE ticket_items ADD COLUMN kds_fired_at TEXT',
    'ALTER TABLE ticket_items ADD COLUMN guest_number INTEGER',
    // v2.2 — Restaurant: split-bill persistence (parts[] as JSON on ticket)
    'ALTER TABLE tickets ADD COLUMN payment_parts TEXT',
    'ALTER TABLE tickets ADD COLUMN split_bill    INTEGER DEFAULT 0',
    'ALTER TABLE tickets ADD COLUMN tip_amount REAL DEFAULT 0',
    'ALTER TABLE tickets ADD COLUMN fulfillment_type TEXT',
    'ALTER TABLE tickets ADD COLUMN mesa_id INTEGER',
    'ALTER TABLE tickets ADD COLUMN mesa_supabase_id TEXT',
    'ALTER TABLE tickets ADD COLUMN void_by TEXT',
    'ALTER TABLE tickets ADD COLUMN void_at TEXT',
    // hybrid vertical — dine-in vs takeout vs retail mode + cross-mode conversion trail
    "ALTER TABLE tickets ADD COLUMN mode TEXT",
    "ALTER TABLE tickets ADD COLUMN converted_from_mesa_id INTEGER",
    "ALTER TABLE tickets ADD COLUMN converted_from_mesa_supabase_id TEXT",
    "ALTER TABLE tickets ADD COLUMN converted_from_ticket_id INTEGER",
    "ALTER TABLE tickets ADD COLUMN converted_from_ticket_supabase_id TEXT",
    // v2.1.3 — defensive ALTERs for v2.1 schema columns (in case the gated migration block was skipped)
    "ALTER TABLE tickets ADD COLUMN washer_empleado_supabase_ids TEXT DEFAULT '[]'",
    'ALTER TABLE tickets ADD COLUMN seller_empleado_supabase_id TEXT',
    'ALTER TABLE queue ADD COLUMN empleado_supabase_id TEXT',
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
      approved_by_supabase_id TEXT,
      created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    // v2.14 — Idempotent column add for older installs. Harmless on fresh DBs.
    "ALTER TABLE adelantos ADD COLUMN approved_by_supabase_id TEXT",
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
    // v2.3 — Carniceria / licoreria expansion: sell-by-weight + bottle deposit
    "ALTER TABLE inventory_items ADD COLUMN sold_by_weight INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE inventory_items ADD COLUMN unit TEXT",
    "ALTER TABLE inventory_items ADD COLUMN price_per_unit REAL",
    "ALTER TABLE inventory_items ADD COLUMN bottle_deposit REAL",
    "ALTER TABLE inventory_items ADD COLUMN tare_default REAL",
    "ALTER TABLE ticket_items ADD COLUMN weight REAL",
    "ALTER TABLE ticket_items ADD COLUMN unit TEXT",
    "ALTER TABLE ticket_items ADD COLUMN price_per_unit REAL",
    // v2.4 — Salon vertical: client loyalty + preferences
    "ALTER TABLE clients ADD COLUMN loyalty_points REAL NOT NULL DEFAULT 0",
    "ALTER TABLE clients ADD COLUMN allergies TEXT",
    "ALTER TABLE clients ADD COLUMN preferred_stylist_id INTEGER",
    "ALTER TABLE clients ADD COLUMN preferred_stylist_supabase_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_clients_preferred_stylist ON clients(preferred_stylist_supabase_id)",
    // v2.7.1 — cross-vertical loyalty program (ledger + tier)
    "ALTER TABLE clients ADD COLUMN loyalty_tier TEXT DEFAULT 'bronze'",
    // loyalty tiers v2 — lifetime earned + birthday flag. Idempotent ALTERs.
    "ALTER TABLE clients ADD COLUMN loyalty_lifetime_earned REAL NOT NULL DEFAULT 0",
    "ALTER TABLE clients ADD COLUMN birthday_treat_available INTEGER NOT NULL DEFAULT 0",
    `CREATE TABLE IF NOT EXISTS loyalty_transactions (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id         TEXT,
      business_id         TEXT,
      client_id           INTEGER,
      client_supabase_id  TEXT,
      ticket_id           INTEGER,
      ticket_supabase_id  TEXT,
      event_type          TEXT NOT NULL CHECK (event_type IN ('earn','redeem','adjust','expire')),
      points              REAL NOT NULL DEFAULT 0,
      balance_after       REAL NOT NULL DEFAULT 0,
      notes               TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_loyalty_tx_supabase_id ON loyalty_transactions(supabase_id) WHERE supabase_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS ix_loyalty_tx_client ON loyalty_transactions(client_supabase_id, created_at DESC)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_loyalty_tx_earn_per_ticket ON loyalty_transactions(ticket_supabase_id) WHERE event_type='earn' AND ticket_supabase_id IS NOT NULL`,
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
    // v2.5 — Mechanic vertical: odometer + digital inspection + parts back-order + estimate approval
    'ALTER TABLE vehicles ADD COLUMN odometer_km INTEGER',
    'ALTER TABLE vehicles ADD COLUMN last_service_km INTEGER',
    'ALTER TABLE vehicles ADD COLUMN last_service_at TEXT',
    'ALTER TABLE vehicles ADD COLUMN next_service_km INTEGER',
    'ALTER TABLE vehicles ADD COLUMN next_service_at TEXT',
    'ALTER TABLE work_orders ADD COLUMN labor_total REAL NOT NULL DEFAULT 0',
    'ALTER TABLE work_orders ADD COLUMN parts_total REAL NOT NULL DEFAULT 0',
    'ALTER TABLE work_orders ADD COLUMN itbis REAL NOT NULL DEFAULT 0',
    'ALTER TABLE work_orders ADD COLUMN total REAL NOT NULL DEFAULT 0',
    'ALTER TABLE work_orders ADD COLUMN inspection_json TEXT',
    'ALTER TABLE work_orders ADD COLUMN estimate_approved_at TEXT',
    'ALTER TABLE work_orders ADD COLUMN customer_signature_url TEXT',
    'ALTER TABLE work_orders ADD COLUMN customer_approval_token TEXT',
    'ALTER TABLE work_orders ADD COLUMN expected_parts_arrival TEXT',
    'ALTER TABLE work_orders ADD COLUMN odometer_in_km INTEGER',
    'ALTER TABLE work_orders ADD COLUMN odometer_out_km INTEGER',
    'CREATE INDEX IF NOT EXISTS idx_work_orders_approval_token ON work_orders(customer_approval_token)',
    // v2.4 — Carwash expansion: memberships (monthly subscription) + wash_combos (punch-card)
    `CREATE TABLE IF NOT EXISTS memberships (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id               TEXT,
      client_id                 INTEGER REFERENCES clients(id),
      client_supabase_id        TEXT,
      vehicle_id                INTEGER REFERENCES vehicles(id),
      vehicle_supabase_id       TEXT,
      plan_name                 TEXT    NOT NULL,
      plan_price                REAL    NOT NULL DEFAULT 0,
      wash_quota_per_month      INTEGER NOT NULL DEFAULT 0,
      washes_used_this_period   INTEGER NOT NULL DEFAULT 0,
      period_start              TEXT,
      period_end                TEXT,
      start_date                TEXT    NOT NULL DEFAULT (date('now')),
      end_date                  TEXT,
      status                    TEXT    NOT NULL DEFAULT 'active',
      notes                     TEXT,
      created_at                TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at                TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_supabase_id ON memberships(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_memberships_client ON memberships(client_id)`,
    `CREATE INDEX IF NOT EXISTS idx_memberships_status ON memberships(status)`,
    `CREATE TABLE IF NOT EXISTS wash_combos (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id          TEXT,
      client_id            INTEGER REFERENCES clients(id),
      client_supabase_id   TEXT,
      vehicle_id           INTEGER REFERENCES vehicles(id),
      vehicle_supabase_id  TEXT,
      combo_name           TEXT    NOT NULL,
      total_washes         INTEGER NOT NULL DEFAULT 0,
      used_washes          INTEGER NOT NULL DEFAULT 0,
      purchase_price       REAL    NOT NULL DEFAULT 0,
      purchased_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      expires_at           TEXT,
      status               TEXT    NOT NULL DEFAULT 'active',
      notes                TEXT,
      created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_wash_combos_supabase_id ON wash_combos(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_wash_combos_client ON wash_combos(client_id)`,
    `CREATE INDEX IF NOT EXISTS idx_wash_combos_status ON wash_combos(status)`,

    // v2.6 — Service vertical: recurring billing, prepaid packages, projects, per-client rates, hourly billing
    `CREATE TABLE IF NOT EXISTS subscriptions (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id          TEXT,
      client_id            INTEGER REFERENCES clients(id),
      client_supabase_id   TEXT,
      service_id           INTEGER REFERENCES services(id),
      service_supabase_id  TEXT,
      plan_name            TEXT,
      interval_days        INTEGER NOT NULL DEFAULT 30,
      amount               REAL    NOT NULL DEFAULT 0,
      start_date           TEXT    NOT NULL DEFAULT (date('now')),
      next_billing_date    TEXT    NOT NULL DEFAULT (date('now')),
      last_billed_at       TEXT,
      status               TEXT    NOT NULL DEFAULT 'active',
      notes                TEXT,
      created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_supabase_id ON subscriptions(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_subscriptions_next ON subscriptions(next_billing_date)`,
    `CREATE INDEX IF NOT EXISTS idx_subscriptions_client ON subscriptions(client_id)`,
    `CREATE TABLE IF NOT EXISTS service_packages (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id          TEXT,
      client_id            INTEGER REFERENCES clients(id),
      client_supabase_id   TEXT,
      service_id           INTEGER REFERENCES services(id),
      service_supabase_id  TEXT,
      package_name         TEXT    NOT NULL,
      total_sessions       INTEGER NOT NULL DEFAULT 0,
      used_sessions        INTEGER NOT NULL DEFAULT 0,
      purchase_price       REAL    NOT NULL DEFAULT 0,
      purchased_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      expires_at           TEXT,
      status               TEXT    NOT NULL DEFAULT 'active',
      notes                TEXT,
      created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_service_packages_supabase_id ON service_packages(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_service_packages_client ON service_packages(client_id)`,
    `CREATE INDEX IF NOT EXISTS idx_service_packages_status ON service_packages(status)`,
    `CREATE TABLE IF NOT EXISTS projects (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id          TEXT,
      client_id            INTEGER REFERENCES clients(id),
      client_supabase_id   TEXT,
      name                 TEXT    NOT NULL,
      description          TEXT,
      status               TEXT    NOT NULL DEFAULT 'draft',
      total_billed         REAL    NOT NULL DEFAULT 0,
      created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      closed_at            TEXT,
      updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_supabase_id ON projects(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id)`,
    `CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)`,
    `CREATE TABLE IF NOT EXISTS client_service_rates (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id          TEXT,
      client_id            INTEGER REFERENCES clients(id),
      client_supabase_id   TEXT NOT NULL,
      service_id           INTEGER REFERENCES services(id),
      service_supabase_id  TEXT NOT NULL,
      custom_price         REAL NOT NULL,
      notes                TEXT,
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_csr_supabase_id ON client_service_rates(supabase_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_csr_client_service ON client_service_rates(client_supabase_id, service_supabase_id)`,

    // v2.5 — Per-client custom item pricing (inventory overrides). Mirrors
    // client_service_rates exactly but scoped to inventory_items. Hard rule:
    // never merge the two tables — keep service/item axes separate.
    `CREATE TABLE IF NOT EXISTS client_item_prices (
      id                         INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id                TEXT,
      client_id                  INTEGER REFERENCES clients(id),
      client_supabase_id         TEXT NOT NULL,
      inventory_item_id          INTEGER REFERENCES inventory_items(id),
      inventory_item_supabase_id TEXT NOT NULL,
      custom_price               REAL NOT NULL,
      notes                      TEXT,
      created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                 TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_cip_supabase_id ON client_item_prices(supabase_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_cip_client_item ON client_item_prices(client_supabase_id, inventory_item_supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cip_client ON client_item_prices(client_supabase_id)`,
    `CREATE TRIGGER IF NOT EXISTS trg_cip_updated_at
       AFTER UPDATE ON client_item_prices
       FOR EACH ROW BEGIN
         UPDATE client_item_prices SET updated_at = datetime('now') WHERE id = NEW.id;
       END`,
    // Tickets: project link
    'ALTER TABLE tickets ADD COLUMN project_id INTEGER',
    'ALTER TABLE tickets ADD COLUMN project_supabase_id TEXT',
    'CREATE INDEX IF NOT EXISTS idx_tickets_project ON tickets(project_supabase_id)',
    // Ticket items: hourly billing
    'ALTER TABLE ticket_items ADD COLUMN duration_minutes INTEGER',
    'ALTER TABLE ticket_items ADD COLUMN hourly_rate REAL',

    // v2.7 — Prestamos phase 2: amortization + mora + papeleta + collections
    "ALTER TABLE loans ADD COLUMN method TEXT NOT NULL DEFAULT 'french'",
    "ALTER TABLE loans ADD COLUMN mora_rate_daily REAL NOT NULL DEFAULT 0.005",
    "ALTER TABLE loans ADD COLUMN days_late INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE loans ADD COLUMN mora_amount REAL NOT NULL DEFAULT 0",
    "ALTER TABLE pawn_items ADD COLUMN ticket_code TEXT",
    "ALTER TABLE pawn_items ADD COLUMN redemption_date TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_pawn_items_ticket_code ON pawn_items(ticket_code) WHERE ticket_code IS NOT NULL",

    `CREATE TABLE IF NOT EXISTS loan_schedule (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id         TEXT,
      loan_id             INTEGER NOT NULL REFERENCES loans(id),
      loan_supabase_id    TEXT,
      installment_no      INTEGER NOT NULL,
      due_date            TEXT    NOT NULL,
      principal_due       REAL    NOT NULL DEFAULT 0,
      interest_due        REAL    NOT NULL DEFAULT 0,
      total_due           REAL    NOT NULL DEFAULT 0,
      paid_amount         REAL    NOT NULL DEFAULT 0,
      paid_at             TEXT,
      status              TEXT    NOT NULL DEFAULT 'pending',
      created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_loan_schedule_supabase_id ON loan_schedule(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_loan_schedule_loan ON loan_schedule(loan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_loan_schedule_due  ON loan_schedule(due_date, status)`,

    `CREATE TABLE IF NOT EXISTS collections_log (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id           TEXT,
      client_id             INTEGER REFERENCES clients(id),
      client_supabase_id    TEXT,
      loan_id               INTEGER REFERENCES loans(id),
      loan_supabase_id      TEXT,
      channel               TEXT NOT NULL,
      outcome               TEXT,
      notes                 TEXT,
      contacted_at          TEXT NOT NULL DEFAULT (datetime('now')),
      next_contact_date     TEXT,
      created_by_staff_id   INTEGER,
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_log_supabase_id ON collections_log(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_collections_log_loan   ON collections_log(loan_supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_collections_log_client ON collections_log(client_supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_collections_log_next   ON collections_log(next_contact_date)`,

    // ── v2.3 — Multi-POS block allocation (NCF, doc_number, inventory oversell) ──
    // Mirrors Supabase ncf_blocks / doc_number_blocks / inventory_oversells.
    // See docs/MULTI-POS-ARCHITECTURE.md §1–§3 and backend migration
    // 20260418000000_multipos_blocks.sql. Every write is feature-flagged by
    // app_settings.multi_pos_enabled (default '0') so single-POS installs stay
    // on the legacy ncf_sequences + MAX(doc_number)+1 path.
    `CREATE TABLE IF NOT EXISTS ncf_blocks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id     TEXT UNIQUE,
      business_id     TEXT NOT NULL,
      hwid            TEXT NOT NULL,
      ncf_type        TEXT NOT NULL,
      prefix          TEXT,
      range_start     INTEGER NOT NULL,
      range_end       INTEGER NOT NULL,
      next_available  INTEGER NOT NULL,
      size            INTEGER,
      allocated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      exhausted_at    TEXT,
      last_used_at    TEXT,
      updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ncf_blocks_lookup ON ncf_blocks(business_id, hwid, ncf_type, exhausted_at)`,
    `CREATE INDEX IF NOT EXISTS idx_ncf_blocks_type_active ON ncf_blocks(ncf_type) WHERE exhausted_at IS NULL`,

    `CREATE TABLE IF NOT EXISTS doc_number_blocks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id     TEXT UNIQUE,
      business_id     TEXT NOT NULL,
      hwid            TEXT NOT NULL,
      scope           TEXT NOT NULL DEFAULT 'ticket',
      range_start     INTEGER NOT NULL,
      range_end       INTEGER NOT NULL,
      next_available  INTEGER NOT NULL,
      size            INTEGER,
      allocated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      exhausted_at    TEXT,
      updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_doc_blocks_lookup ON doc_number_blocks(business_id, hwid, scope, exhausted_at)`,
    `CREATE INDEX IF NOT EXISTS idx_doc_blocks_scope_active ON doc_number_blocks(scope) WHERE exhausted_at IS NULL`,

    `CREATE TABLE IF NOT EXISTS inventory_oversells (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id          TEXT UNIQUE,
      business_id          TEXT NOT NULL,
      ticket_supabase_id   TEXT,
      item_supabase_id     TEXT,
      item_name            TEXT,
      requested_qty        REAL NOT NULL,
      actual_qty           REAL NOT NULL,
      detected_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      resolved_at          TEXT,
      resolved_by          TEXT,
      resolution_notes     TEXT,
      resolution_type      TEXT,
      updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_oversells_unresolved ON inventory_oversells(business_id) WHERE resolved_at IS NULL`,

    // Queued oversell-aware deducts for post-sync RPC (see §3.1 in spec).
    `CREATE TABLE IF NOT EXISTS pending_inventory_deducts (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id         TEXT UNIQUE,
      ticket_supabase_id  TEXT NOT NULL,
      items_json          TEXT NOT NULL,
      created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      pushed_at           TEXT,
      last_error          TEXT,
      attempts            INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_pending_deducts_unpushed ON pending_inventory_deducts(pushed_at)`,

    // Multi-POS ticket origin forensic columns (null on existing rows).
    `ALTER TABLE tickets ADD COLUMN origin_hwid TEXT`,
    `ALTER TABLE tickets ADD COLUMN origin_device_label TEXT`,
    `ALTER TABLE tickets ADD COLUMN used_legacy_counter INTEGER NOT NULL DEFAULT 0`,

    // Default flag off.
    `INSERT OR IGNORE INTO app_settings(key, value) VALUES('multi_pos_enabled','0')`,
    `INSERT OR IGNORE INTO app_settings(key, value) VALUES('ncf_block_size','500')`,
    `INSERT OR IGNORE INTO app_settings(key, value) VALUES('doc_block_size','200')`,
    // v2.3 — app_settings sync parity: add business_id/updated_at/supabase_id
    // so business-level keys (itbis_pct, biz_rnc, whatsapp_*, etc.) can ride
    // the normal push pipeline. Device-only keys (printer, print_*) stay local
    // via the whitelist in electron/settingsWhitelist.js.
    'ALTER TABLE app_settings ADD COLUMN business_id TEXT',
    'ALTER TABLE app_settings ADD COLUMN updated_at TEXT',
    'ALTER TABLE app_settings ADD COLUMN supabase_id TEXT',
    // v2.10.5 — device-local cloud mirror (Recovery RTO). Columns mirror the
    // Supabase schema in 20260420700000_app_settings_device_scope.sql so
    // push/pull round-trip without field-mapping.
    'ALTER TABLE app_settings ADD COLUMN is_device_local INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE app_settings ADD COLUMN device_hwid TEXT',
    // v1.9.25 — mesas.rev: monotonic revision counter used to detect the
    // simultaneous-waiter status race (see electron/sync.js header comment).
    'ALTER TABLE mesas ADD COLUMN rev INTEGER NOT NULL DEFAULT 0',
    // v2.10.3 — tickets.rev: same optimistic concurrency guard for tickets.
    // Supabase trigger trg_tickets_rev_guard rejects status changes unless
    // NEW.rev > OLD.rev. Every status-changing UPDATE in this file must bump
    // rev = COALESCE(rev,0)+1 in the same statement.
    'ALTER TABLE tickets ADD COLUMN rev INTEGER NOT NULL DEFAULT 0',
    // v2.3.32 — Pedidos Ya per-channel pricing + ticket order source
    'ALTER TABLE inventory_items ADD COLUMN price_pedidos_ya REAL',
    "ALTER TABLE tickets ADD COLUMN order_source TEXT DEFAULT 'pos'",
    // DGII audit D-H — offline-deferred flag. Set to 1 when ticket's e-CF was
    // queued while offline; cleared by ecfClearDeferredForTicket() after DGII
    // accept so a later manual resubmit doesn't carry a stale IndicadorEnvioDiferido.
    "ALTER TABLE tickets ADD COLUMN ecf_indicator_diferido INTEGER NOT NULL DEFAULT 0",

    // v2.6 — Manager Authorization Card (barcode token, stored as hash)
    'ALTER TABLE users ADD COLUMN manager_auth_hash TEXT',
    'ALTER TABLE users ADD COLUMN manager_auth_rotated_at TEXT',

    // v2.10.5 — PIN hash hardening (S-H4/H5/H6)
    //   pin_hash_algo  : 'sha256' (legacy) | 'bcrypt' (current)
    //   pin_salt       : per-row entropy suffix appended before bcrypt
    //   pin_failed_attempts : consecutive wrong guesses
    //   pin_locked_until    : ISO timestamp — while > now, authByPin skips row
    "ALTER TABLE users ADD COLUMN pin_hash_algo TEXT DEFAULT 'sha256'",
    "ALTER TABLE users ADD COLUMN pin_salt TEXT",
    "ALTER TABLE users ADD COLUMN pin_failed_attempts INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN pin_locked_until TEXT",
    // Normalise NULL algo on any row added before the default took effect
    "UPDATE users SET pin_hash_algo='sha256' WHERE pin_hash_algo IS NULL",

    // v2.5 — Conteo Fisico (physical inventory count + variance / theft report)
    `CREATE TABLE IF NOT EXISTS inventory_counts (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id           TEXT,
      title                 TEXT    NOT NULL DEFAULT 'Conteo Fisico',
      started_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      completed_at          TEXT,
      counted_by_name       TEXT,
      status                TEXT    NOT NULL DEFAULT 'abierto',
      notes                 TEXT,
      total_expected_value  REAL    NOT NULL DEFAULT 0,
      total_counted_value   REAL    NOT NULL DEFAULT 0,
      total_variance_value  REAL    NOT NULL DEFAULT 0,
      signature_dataurl     TEXT,
      created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,
    'ALTER TABLE inventory_counts ADD COLUMN signature_dataurl TEXT',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_counts_supabase_id ON inventory_counts(supabase_id)`,
    `CREATE INDEX        IF NOT EXISTS idx_inv_counts_status      ON inventory_counts(status, started_at DESC)`,
    `CREATE TRIGGER IF NOT EXISTS trg_inventory_counts_updated_at
      AFTER UPDATE ON inventory_counts
      FOR EACH ROW
      BEGIN
        UPDATE inventory_counts SET updated_at = datetime('now') WHERE rowid = NEW.rowid;
      END`,

    `CREATE TABLE IF NOT EXISTS inventory_count_items (
      id                         INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id                TEXT,
      count_id                   INTEGER REFERENCES inventory_counts(id) ON DELETE CASCADE,
      count_supabase_id          TEXT NOT NULL,
      inventory_item_id          INTEGER REFERENCES inventory_items(id),
      inventory_item_supabase_id TEXT NOT NULL,
      sku                        TEXT,
      name                       TEXT NOT NULL,
      category                   TEXT,
      expected_qty               REAL NOT NULL DEFAULT 0,
      counted_qty                REAL,
      unit_cost                  REAL NOT NULL DEFAULT 0,
      unit_price                 REAL NOT NULL DEFAULT 0,
      notes                      TEXT,
      created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                 TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_count_items_supabase_id ON inventory_count_items(supabase_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_count_items_count_item  ON inventory_count_items(count_supabase_id, inventory_item_supabase_id)`,
    `CREATE INDEX        IF NOT EXISTS idx_inv_count_items_count       ON inventory_count_items(count_supabase_id)`,
    `CREATE TRIGGER IF NOT EXISTS trg_inventory_count_items_updated_at
      AFTER UPDATE ON inventory_count_items
      FOR EACH ROW
      BEGIN
        UPDATE inventory_count_items SET updated_at = datetime('now') WHERE rowid = NEW.rowid;
      END`,

    // v2.6 — Licoreria bottle/envase deposit segregation on ticket_items.
    // Canonical flag for deposit-only lines so cuadre / reports / refunds
    // can treat them separately from product revenue. Back-fills legacy
    // 'DEP' SKU rows for continuity with the pre-flag encoding.
    "ALTER TABLE ticket_items ADD COLUMN is_deposit INTEGER NOT NULL DEFAULT 0",
    "UPDATE ticket_items SET is_deposit = 1 WHERE is_deposit = 0 AND UPPER(COALESCE(sku,'')) = 'DEP'",
    "CREATE INDEX IF NOT EXISTS idx_ticket_items_is_deposit ON ticket_items(ticket_supabase_id) WHERE is_deposit = 1",

    // v2.14 — manual commission entry. Owners can add a commission row without
    // a backing ticket (e.g. historical liquidación, adjustments). Presence of
    // manual_reason distinguishes manual rows from auto-generated ones.
    "ALTER TABLE washer_commissions ADD COLUMN manual_reason TEXT",
    "ALTER TABLE seller_commissions ADD COLUMN manual_reason TEXT",
    "ALTER TABLE cajero_commissions ADD COLUMN manual_reason TEXT",
  ]
  for (const sql of migrations) {
    try { db.exec(sql) } catch (e) {
      const m = e.message || ''
      // v2.1: washers/sellers tables are dropped post-consolidation. Pre-2.1
      // ALTER/UPDATE statements that touch them log "no such table" — that's
      // the new normal, not an error.
      if (
        !m.includes('duplicate column') &&
        !m.includes('already exists') &&
        !m.includes('UNIQUE constraint') &&
        !m.includes('no such table: washers') &&
        !m.includes('no such table: sellers') &&
        !m.includes('no such column')
      ) {
        console.error('[db] Migration failed:', sql.substring(0, 80), '—', m)
      }
    }
  }

  // ── app_settings sync parity backfill (v2.3) ─────────────────────────────
  // Stamp business_id / updated_at / supabase_id on pre-existing rows so the
  // normal push pipeline can lift business-level keys to Supabase. Device-only
  // keys still get the columns populated (harmless), but the rowFilter in
  // electron/sync.js keeps them out of the push batch.
  try {
    const bizId = db.prepare("SELECT value FROM app_settings WHERE key='supabase_business_id'").get()?.value
    if (bizId) {
      db.prepare("UPDATE app_settings SET business_id = ? WHERE business_id IS NULL").run(bizId)
    }
    db.prepare("UPDATE app_settings SET updated_at = datetime('now') WHERE updated_at IS NULL").run()
    // UUID v4 generator inline (matches the randomblob pattern used elsewhere)
    const uuidSql = "lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))"
    db.exec(`UPDATE app_settings SET supabase_id = ${uuidSql} WHERE supabase_id IS NULL`)
  } catch (e) { console.error('[db] app_settings backfill error:', e.message) }

  // Trigger — auto-bump updated_at on UPDATE (matches pattern for other synced
  // tables in this file). We keep it narrow (only when value actually changes)
  // to avoid storms when the setters write the same value.
  try {
    db.exec(`DROP TRIGGER IF EXISTS trg_app_settings_updated_at`)
    db.exec(`CREATE TRIGGER trg_app_settings_updated_at AFTER UPDATE ON app_settings
             FOR EACH ROW WHEN NEW.value IS NOT OLD.value
             BEGIN
               UPDATE app_settings SET updated_at = datetime('now') WHERE rowid = NEW.rowid;
             END`)
  } catch (e) { console.error('[db] app_settings trigger error:', e.message) }

  // Patch the setter so INSERT OR REPLACE also stamps business_id/supabase_id/updated_at.
  // See setSetting() below — it now reads the live tenant on write.

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

  // v2.1: v1.9.22 washer/seller → empleado backfill and v1.9.37 users_dedup
  // blocks are removed. Both are now handled by the v2.1.0 migration below,
  // which also drops the washers/sellers tables entirely. The app_settings
  // flags `empleados_backfill_done` and `users_dedup_done` are deleted by
  // the v2.1 migration so they can't interfere with future migrations.

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
  // v2.0 — trigger body writes ISO-8601 UTC with ms precision so local + remote
  // timestamps compare cleanly as strings OR as Date.parse()-ed numbers. The
  // old `datetime('now')` shape produced "YYYY-MM-DD HH:MM:SS" (space), which
  // sorted lower than Supabase's "YYYY-MM-DDTHH:MM:SS.µµµ+00:00" (T). That was
  // the root cause of the LWW inversion that clobbered every local edit.
  const triggerTables = ['businesses', 'services', 'washers', 'sellers', 'clients', 'inventory_items', 'tickets', 'empleados', 'ncf_sequences', 'ticket_items', 'queue', 'washer_commissions', 'seller_commissions', 'cajero_commissions', 'credit_payments', 'cuadre_caja', 'caja_chica', 'notas_credito', 'inventory_transactions', 'compras_607', 'categorias_servicio', 'users', 'salary_changes', 'payroll_runs', 'ecf_submissions', 'queue_deletions', 'activity_log', 'mesas', 'modificadores', 'service_modificadores', 'ticket_item_modificadores', 'kds_events', 'vehicles', 'service_bays', 'work_orders', 'work_order_items', 'appointments', 'stylist_schedules', 'loans', 'loan_payments', 'pawn_items', 'subscriptions', 'service_packages', 'projects', 'client_service_rates']

  // v2.0 — one-shot: drop the legacy SQL-space triggers so the ISO-8601
  // replacements below are the only ones that fire. Gated so we don't drop
  // triggers on every boot.
  let v2TriggersDone = '0'
  try { v2TriggersDone = db.prepare("SELECT value FROM app_settings WHERE key='updated_at_triggers_v2_done'").get()?.value || '0' } catch {}
  if (v2TriggersDone !== '1') {
    for (const t of triggerTables) {
      try { db.exec(`DROP TRIGGER IF EXISTS trg_${t}_updated_at`) } catch {}
    }
  }

  // v2.0.1 — ensure every synced table has an updated_at column BEFORE creating
  // the auto-bump trigger. Previously the trigger was created on businesses
  // (which ships without an explicit updated_at column), then fired on the first
  // real UPDATE and failed with "no such column: NEW.updated_at", blocking the
  // FirstTimeSetup wizard's empresaSave. Run ALTER TABLE ... ADD COLUMN
  // unconditionally; SQLite errors on duplicate column name which we swallow.
  for (const t of triggerTables) {
    try { db.exec(`ALTER TABLE ${t} ADD COLUMN updated_at TEXT`) } catch {}
  }

  for (const t of triggerTables) {
    try {
      db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${t}_updated_at AFTER UPDATE ON ${t} FOR EACH ROW
        WHEN NEW.updated_at IS OLD.updated_at OR NEW.updated_at IS NULL
        BEGIN UPDATE ${t} SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id; END`)
    } catch (e) {
      if (!e.message?.includes('already exists')) {
        console.error(`[db] Trigger ${t}:`, e.message)
      }
    }
  }
  if (v2TriggersDone !== '1') {
    try { db.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('updated_at_triggers_v2_done','1')").run() } catch {}
  }

  // v2.2.1 — activity_log self-heal (idempotent column + index backfill). Runs
  // every boot so legacy installs that never had the v1.9.21 migration still
  // get the columns sync + the unique index.
  try { activityLogSelfHeal() } catch (e) { console.error('[db] activityLogSelfHeal:', e.message) }

  // v2.0 — one-shot migration: rewrite any existing SQL-space timestamps to ISO-8601
  // with `T` + `.fff` + `Z`. Idempotent on ISO-formatted rows (REPLACE(' ','T') is a no-op).
  // Gated by app_settings so we only run once per database lifetime.
  try {
    const migrated = db.prepare("SELECT value FROM app_settings WHERE key='updated_at_iso_migration_done'").get()?.value
    if (migrated !== '1') {
      const migrateStmt = (tbl) => `
        UPDATE ${tbl}
        SET updated_at = REPLACE(updated_at, ' ', 'T')
                         || CASE
                              WHEN updated_at LIKE '%.%' THEN ''
                              ELSE '.000'
                            END
                         || CASE
                              WHEN updated_at LIKE '%Z' THEN ''
                              WHEN updated_at GLOB '*[-+][0-9][0-9]:[0-9][0-9]' THEN ''
                              WHEN updated_at GLOB '*[-+][0-9][0-9][0-9][0-9]' THEN ''
                              ELSE 'Z'
                            END
        WHERE updated_at IS NOT NULL
          AND updated_at NOT LIKE '%T%'`
      for (const t of triggerTables) {
        try { db.exec(migrateStmt(t)) } catch (e) {
          if (!e.message?.includes('no such column') && !e.message?.includes('no such table')) {
            console.error(`[db] updated_at ISO migration ${t}:`, e.message)
          }
        }
      }
      // Also migrate created_at on the same tables for symmetry (optional, safe)
      const createdMigrate = (tbl) => `
        UPDATE ${tbl}
        SET created_at = REPLACE(created_at, ' ', 'T')
                         || CASE WHEN created_at LIKE '%.%' THEN '' ELSE '.000' END
                         || CASE
                              WHEN created_at LIKE '%Z' THEN ''
                              WHEN created_at GLOB '*[-+][0-9][0-9]:[0-9][0-9]' THEN ''
                              WHEN created_at GLOB '*[-+][0-9][0-9][0-9][0-9]' THEN ''
                              ELSE 'Z'
                            END
        WHERE created_at IS NOT NULL
          AND created_at NOT LIKE '%T%'`
      for (const t of triggerTables) {
        try { db.exec(createdMigrate(t)) } catch { /* column may not exist — ignore */ }
      }
      db.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('updated_at_iso_migration_done','1')").run()
      console.log('[db] v2 updated_at ISO-8601 migration: complete')
    }
  } catch (e) { console.error('[db] updated_at ISO migration:', e.message) }

  // v2.1: legacy washers/sellers dedup block removed — washers/sellers tables
  // are dropped by the v2.1 migration below; no more duplicates to clean up.
  // The seller_commissions table is created by schema.sql with the v2.1
  // empleado_supabase_id FK shape. Only cajero_commissions still has the
  // legacy guard below for installs older than v1.2.

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

  // e-CF offline queue — stores failed submissions for auto-retry (DGII 72h contingency).
  // v2.10.5: cloud-mirrored via sync.js so a PC death doesn't orphan signed-but-
  // unsubmitted e-CFs (Recovery RTO HIGH finding).
  db.exec(`CREATE TABLE IF NOT EXISTS ecf_queue (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    url_path           TEXT NOT NULL DEFAULT '',
    body_json          TEXT NOT NULL,
    token              TEXT NOT NULL DEFAULT '',
    xml_signed         TEXT,
    encf               TEXT,
    tipo_ecf           TEXT,
    environment        TEXT NOT NULL DEFAULT 'certecf',
    attempts           INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    last_tried         TEXT,
    supabase_id        TEXT,
    ticket_supabase_id TEXT,
    status             TEXT NOT NULL DEFAULT 'pending',
    track_id           TEXT,
    submitted_at       TEXT,
    updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    last_error         TEXT
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_ecf_queue_status ON ecf_queue(status, created_at)')
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_ecf_queue_supabase_id ON ecf_queue(supabase_id) WHERE supabase_id IS NOT NULL')
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_ecf_queue_encf ON ecf_queue(encf) WHERE encf IS NOT NULL')

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

  // v2.10.4 — ANECF auto-queue for voided e-CFs (audit finding E-C6).
  // Every void of an e-CF (E3x) enqueues one row here; processAnecfQueue()
  // in electron/main.js submits to DGII in the background on a 60s tick.
  // Legacy B01/B02 paper NCFs are never enqueued (no ANECF flow exists).
  db.exec(`CREATE TABLE IF NOT EXISTS anecf_queue (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id          INTEGER,
    ticket_supabase_id TEXT,
    ncf                TEXT NOT NULL,
    tipo_ecf           TEXT NOT NULL,
    rango_desde        TEXT NOT NULL,
    rango_hasta        TEXT NOT NULL,
    voided_at          TEXT NOT NULL DEFAULT (datetime('now')),
    submitted_at       TEXT,
    track_id           TEXT,
    status             TEXT NOT NULL DEFAULT 'pending',
    last_error         TEXT,
    attempts           INTEGER NOT NULL DEFAULT 0,
    last_tried         TEXT,
    environment        TEXT NOT NULL DEFAULT 'certecf',
    supabase_id        TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(ncf)
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_anecf_queue_status ON anecf_queue(status, voided_at)')

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
  // v2.0.2 — drop NOT NULL on empleado_id so pulls of legacy rows (where
  // empleado_id wasn't populated, only empleado_supabase_id) no longer fail
  // with "NOT NULL constraint failed". SQLite can't DROP NOT NULL directly,
  // so we recreate via the standard table-rewrite dance, gated by a one-shot.
  // v2.1: ALL-CAPS guard removed — the v2.1 migration below deletes the
  // `empleados_caps_cleanup_done` flag so any new cleanup can re-run if needed.

  try {
    const done = db.prepare("SELECT value FROM app_settings WHERE key='salary_changes_nullable_empleado_id'").get()?.value
    if (done !== '1') {
      const hasNotNull = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='salary_changes'").get()?.sql?.includes('empleado_id    INTEGER NOT NULL')
      if (hasNotNull) {
        db.exec(`BEGIN;
          CREATE TABLE salary_changes_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            empleado_id INTEGER REFERENCES empleados(id) ON DELETE CASCADE,
            old_salary REAL NOT NULL,
            new_salary REAL NOT NULL,
            effective_date TEXT NOT NULL,
            reason TEXT,
            changed_by INTEGER REFERENCES users(id),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            supabase_id TEXT,
            updated_at TEXT,
            empleado_supabase_id TEXT,
            business_id TEXT,
            active INTEGER DEFAULT 1
          );
          INSERT INTO salary_changes_new SELECT id, empleado_id, old_salary, new_salary, effective_date, reason, changed_by, created_at, supabase_id, updated_at,
            (SELECT empleado_supabase_id FROM salary_changes AS s WHERE s.id = salary_changes.id),
            (SELECT business_id FROM salary_changes AS s WHERE s.id = salary_changes.id),
            1
          FROM salary_changes;
          DROP TABLE salary_changes;
          ALTER TABLE salary_changes_new RENAME TO salary_changes;
          CREATE INDEX IF NOT EXISTS idx_salary_changes_empleado ON salary_changes(empleado_id);
          CREATE INDEX IF NOT EXISTS idx_salary_changes_effective ON salary_changes(empleado_id, effective_date);
          COMMIT;`)
      }
      db.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('salary_changes_nullable_empleado_id','1')").run()
    }
  } catch (e) { console.error('[db] salary_changes nullable migration:', e.message); try { db.exec('ROLLBACK') } catch {} }

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
  // v2.1: legacy washer_id column is dropped by the v2.1 migration below.
  // Index creation throws after migration — silently skip.
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_commissions_washer ON washer_commissions(washer_id)') } catch {}

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

  // ══════════════════════════════════════════════════════════════════════════════
  // v2.1.0 — Schema consolidation migration: drops legacy `washers`/`sellers`
  //   tables and remaps every dependent FK onto `empleados.supabase_id`.
  //
  //   Safety guarantees:
  //     1. Creates `<userData>/terminal-x.db.pre-v2.1.bak` BEFORE any DDL.
  //        Aborts (returns; leaves schema_version unset) if backup fails.
  //     2. Wraps every DDL + data statement in a single db.transaction() —
  //        any failure rolls back to pre-migration state.
  //     3. Runs an integrity check before committing: if any commission row
  //        lost its empleado link, throw to trigger ROLLBACK.
  //     4. Gated on app_settings['schema_version']='2.1.0' so it only fires
  //        once per database. If the transaction throws, schema_version is
  //        NOT written, and the migration retries on next launch.
  //     5. On orphan detection: writes diagnostic to app_settings['v2_1_orphans']
  //        and throws. Admin panel surfaces the flag for owner triage.
  // ══════════════════════════════════════════════════════════════════════════════
  {
    const alreadyMigrated = db.prepare("SELECT value FROM app_settings WHERE key='schema_version'").get()?.value
    if (alreadyMigrated !== '2.1.0') {
      // Step 0 — auto-backup. Non-negotiable. If this fails, abort.
      const dbPath = path.join(userDataPath, 'terminal-x.db')
      const bakPath = dbPath + '.pre-v2.1.bak'
      let backupOk = false
      try {
        if (!fs.existsSync(bakPath)) {
          // Checkpoint WAL so the .bak is a full snapshot, not half-empty.
          try { db.pragma('wal_checkpoint(FULL)') } catch {}
          fs.copyFileSync(dbPath, bakPath)
        }
        backupOk = true
        console.log('[db] v2.1 migration: backup ready at', bakPath)
      } catch (e) {
        console.error('[db] v2.1 pre-migration backup FAILED — aborting migration:', e.message)
        // Do NOT set schema_version; migration will retry next launch once the disk issue is fixed.
      }

      if (backupOk) {
        // Helper: table-rewrite to drop legacy INT FK columns without losing data.
        // Mirrors the salary_changes pattern at database.js:1101-1126.
        // Only rewrites the table if at least one of the legacy cols actually exists.
        const rewriteTable = (table, dropCols, indexes = []) => {
          const info = db.prepare(`PRAGMA table_info(${table})`).all()
          if (!info.length) return // table doesn't exist
          const existing = info.map(c => c.name)
          const toDrop = dropCols.filter(c => existing.includes(c))
          if (!toDrop.length) return
          const keep = existing.filter(c => !dropCols.includes(c))
          if (!keep.length) return
          const colsCsv = keep.join(',')
          // Rebuild using the same PRAGMA info (preserves NOT NULL, DEFAULT, type).
          // We can't fully reconstruct the source-level SQL, so we write a permissive
          // schema: TYPE, keep NOT NULL flag, carry forward DEFAULT literals.
          const newCols = info.filter(c => !dropCols.includes(c.name)).map(c => {
            let line = `${c.name} ${c.type || 'TEXT'}`
            if (c.notnull) line += ' NOT NULL'
            if (c.dflt_value != null) line += ` DEFAULT ${c.dflt_value}`
            return line
          }).join(', ')
          // PK column name is the one with pk=1; keep it as the id column with AUTOINCREMENT behavior.
          // Most of our tables follow `id INTEGER PRIMARY KEY AUTOINCREMENT`, so override the line for pk cols.
          const pkCol = info.find(c => c.pk === 1)
          const newColsWithPk = info.filter(c => !dropCols.includes(c.name)).map(c => {
            if (c.pk === 1) return `${c.name} INTEGER PRIMARY KEY AUTOINCREMENT`
            let line = `${c.name} ${c.type || 'TEXT'}`
            if (c.notnull) line += ' NOT NULL'
            if (c.dflt_value != null) line += ` DEFAULT ${c.dflt_value}`
            return line
          }).join(', ')
          const tmp = `${table}__v21_new`
          db.exec(`CREATE TABLE ${tmp} (${newColsWithPk})`)
          db.exec(`INSERT INTO ${tmp} (${colsCsv}) SELECT ${colsCsv} FROM ${table}`)
          db.exec(`DROP TABLE ${table}`)
          db.exec(`ALTER TABLE ${tmp} RENAME TO ${table}`)
          for (const idx of indexes) {
            try { db.exec(idx) } catch (e) { console.warn(`[db] v2.1 rewriteTable index:`, e.message) }
          }
        }

        const uuidExpr = `lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))`

        const migrate = db.transaction(() => {
          // Step 1 — backfill empleados.comision_pct from washers/sellers (best-effort).
          //          If the washers/sellers tables were already dropped on a prior boot
          //          (unusual), the try/catch below swallows the "no such table".
          try {
            db.exec(`UPDATE empleados SET comision_pct = (SELECT commission_pct FROM washers w WHERE w.id = empleados.ref_id) WHERE tipo='lavador' AND (comision_pct IS NULL OR comision_pct = 0) AND ref_id IS NOT NULL`)
          } catch (e) { if (!String(e.message).includes('no such table')) throw e }
          try {
            db.exec(`UPDATE empleados SET comision_pct = (SELECT commission_pct FROM sellers s WHERE s.id = empleados.ref_id) WHERE tipo='vendedor' AND (comision_pct IS NULL OR comision_pct = 0) AND ref_id IS NOT NULL`)
          } catch (e) { if (!String(e.message).includes('no such table')) throw e }

          // Step 2 — add empleado_supabase_id columns to commission/queue tables.
          const addCol = (table, col = 'empleado_supabase_id') => {
            try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`) } catch (e) {
              if (!String(e.message).includes('duplicate column')) throw e
            }
          }
          addCol('washer_commissions')
          addCol('seller_commissions')
          addCol('cajero_commissions') // cajero uses cajero_supabase_id still — keep column for future unification
          addCol('queue')

          // Step 3 — backfill empleado_supabase_id on commission tables via empleados.ref_id join.
          //          washer_commissions.washer_id → empleados (tipo='lavador', ref_id=washer_id)
          //          seller_commissions.seller_id → empleados (tipo='vendedor', ref_id=seller_id)
          try {
            db.exec(`UPDATE washer_commissions
              SET empleado_supabase_id = (
                SELECT e.supabase_id FROM empleados e
                WHERE e.ref_id = washer_commissions.washer_id AND e.tipo='lavador'
                LIMIT 1
              )
              WHERE empleado_supabase_id IS NULL AND washer_id IS NOT NULL`)
          } catch (e) { if (!String(e.message).includes('no such column')) throw e }
          try {
            db.exec(`UPDATE seller_commissions
              SET empleado_supabase_id = (
                SELECT e.supabase_id FROM empleados e
                WHERE e.ref_id = seller_commissions.seller_id AND e.tipo='vendedor'
                LIMIT 1
              )
              WHERE empleado_supabase_id IS NULL AND seller_id IS NOT NULL`)
          } catch (e) { if (!String(e.message).includes('no such column')) throw e }
          // Fallback path: if ref_id wasn't populated on empleados, try matching by supabase_id
          // (washer_supabase_id / seller_supabase_id columns already exist on the commission tables
          // from v1.6, pointing at the legacy washers/sellers rows which carry the same supabase_id).
          try {
            db.exec(`UPDATE washer_commissions
              SET empleado_supabase_id = washer_supabase_id
              WHERE empleado_supabase_id IS NULL
                AND washer_supabase_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM empleados e WHERE e.supabase_id = washer_commissions.washer_supabase_id)`)
          } catch {}
          try {
            db.exec(`UPDATE seller_commissions
              SET empleado_supabase_id = seller_supabase_id
              WHERE empleado_supabase_id IS NULL
                AND seller_supabase_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM empleados e WHERE e.supabase_id = seller_commissions.seller_supabase_id)`)
          } catch {}

          // Step 4 — queue.empleado_supabase_id backfill from queue.washer_id.
          try {
            db.exec(`UPDATE queue
              SET empleado_supabase_id = (
                SELECT e.supabase_id FROM empleados e
                WHERE e.ref_id = queue.washer_id AND e.tipo='lavador'
                LIMIT 1
              )
              WHERE empleado_supabase_id IS NULL AND washer_id IS NOT NULL`)
          } catch (e) { if (!String(e.message).includes('no such column')) throw e }
          // Fallback: match by washer_supabase_id if column exists.
          try {
            db.exec(`UPDATE queue
              SET empleado_supabase_id = washer_supabase_id
              WHERE empleado_supabase_id IS NULL
                AND washer_supabase_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM empleados e WHERE e.supabase_id = queue.washer_supabase_id)`)
          } catch {}

          // Step 5 — tickets.washer_empleado_supabase_ids column + JSON remap.
          try { db.exec(`ALTER TABLE tickets ADD COLUMN washer_empleado_supabase_ids TEXT`) } catch (e) {
            if (!String(e.message).includes('duplicate column')) throw e
          }
          try {
            const ticketRows = db.prepare(`SELECT id, washer_ids FROM tickets WHERE washer_ids IS NOT NULL AND washer_ids != '[]' AND (washer_empleado_supabase_ids IS NULL OR washer_empleado_supabase_ids = '[]')`).all()
            const mapLavador = db.prepare(`SELECT supabase_id FROM empleados WHERE ref_id = ? AND tipo='lavador' LIMIT 1`)
            const updTicket = db.prepare(`UPDATE tickets SET washer_empleado_supabase_ids = ? WHERE id = ?`)
            for (const t of ticketRows) {
              try {
                const rawIds = JSON.parse(t.washer_ids || '[]')
                const sids = rawIds.map(wid => mapLavador.get(wid)?.supabase_id).filter(Boolean)
                updTicket.run(JSON.stringify(sids), t.id)
              } catch {
                // malformed JSON — leave ticket's new column as default; safe fallback
                updTicket.run('[]', t.id)
              }
            }
          } catch (e) {
            // `washer_ids` column might already be gone on a partial-migration retry — skip.
            if (!String(e.message).includes('no such column')) throw e
          }

          // Step 6 — seller_empleado_supabase_id on tickets (mirror of seller_supabase_id).
          try { db.exec(`ALTER TABLE tickets ADD COLUMN seller_empleado_supabase_id TEXT`) } catch (e) {
            if (!String(e.message).includes('duplicate column')) throw e
          }
          try {
            db.exec(`UPDATE tickets
              SET seller_empleado_supabase_id = (
                SELECT e.supabase_id FROM empleados e
                WHERE e.ref_id = tickets.seller_id AND e.tipo='vendedor'
                LIMIT 1
              )
              WHERE seller_empleado_supabase_id IS NULL AND seller_id IS NOT NULL`)
          } catch (e) { if (!String(e.message).includes('no such column')) throw e }
          try {
            db.exec(`UPDATE tickets
              SET seller_empleado_supabase_id = seller_supabase_id
              WHERE seller_empleado_supabase_id IS NULL
                AND seller_supabase_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM empleados e WHERE e.supabase_id = tickets.seller_supabase_id)`)
          } catch {}

          // Step 7 — INTEGRITY CHECK. If any row with a legacy FK lost its empleado,
          //          abort the whole migration so we can re-run once data is clean.
          let orphW = 0, orphS = 0
          try { orphW = db.prepare(`SELECT COUNT(*) AS c FROM washer_commissions WHERE washer_id IS NOT NULL AND empleado_supabase_id IS NULL`).get()?.c || 0 } catch {}
          try { orphS = db.prepare(`SELECT COUNT(*) AS c FROM seller_commissions WHERE seller_id IS NOT NULL AND empleado_supabase_id IS NULL`).get()?.c || 0 } catch {}
          if (orphW > 0 || orphS > 0) {
            // Surface for admin panel triage before rolling back.
            db.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('v2_1_orphans', ?)").run(`washers:${orphW}, sellers:${orphS}`)
            throw new Error(`v2.1 ABORT — orphan commission rows W=${orphW} S=${orphS}. Link empleados.ref_id to resolve, migration retries next boot.`)
          }
          // Clear any stale orphan flag from a prior aborted run.
          try { db.prepare("DELETE FROM app_settings WHERE key='v2_1_orphans'").run() } catch {}

          // Step 8 — drop legacy INT FK columns via table rewrite.
          //          Only touches columns that still exist; safe to re-run.
          rewriteTable('tickets', ['washer_ids', 'seller_id'], [
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_supabase_id ON tickets(supabase_id)`,
            `CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at)`,
            `CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)`,
          ])
          rewriteTable('washer_commissions', ['washer_id', 'washer_supabase_id'], [
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_washer_commissions_supabase_id ON washer_commissions(supabase_id)`,
            `CREATE INDEX IF NOT EXISTS idx_commissions_date ON washer_commissions(created_at)`,
            `CREATE INDEX IF NOT EXISTS idx_commissions_empleado_w ON washer_commissions(empleado_supabase_id)`,
          ])
          rewriteTable('seller_commissions', ['seller_id', 'seller_supabase_id'], [
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_commissions_supabase_id ON seller_commissions(supabase_id)`,
            `CREATE INDEX IF NOT EXISTS idx_commissions_empleado_s ON seller_commissions(empleado_supabase_id)`,
          ])
          rewriteTable('queue', ['washer_id', 'washer_supabase_id'], [
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_supabase_id ON queue(supabase_id)`,
            `CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status)`,
            `CREATE INDEX IF NOT EXISTS idx_queue_empleado ON queue(empleado_supabase_id)`,
          ])

          // Step 9 — drop washers + sellers tables.
          db.exec(`DROP TABLE IF EXISTS washers`)
          db.exec(`DROP TABLE IF EXISTS sellers`)

          // Step 10 — clear legacy migration flags (so any future re-runs of
          //           matching logic inside the main init path short-circuit out).
          db.prepare("DELETE FROM app_settings WHERE key IN ('empleados_backfill_done','empleados_caps_cleanup_done','users_dedup_done')").run()

          // Step 11 — mark schema version. Only reached if every step above succeeded.
          db.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('schema_version','2.1.0')").run()
        })

        try {
          migrate()
          console.log('[db] v2.1.0 migration: complete')
        } catch (e) {
          console.error('[db] v2.1 migration FAILED — rolled back, will retry next launch:', e.message)
          // schema_version intentionally NOT written so startup retries.
        }
      }
    }
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
// v2.10.5 — device_hwid stamping helper. Returns the HWID stored by main.js
// (or null if not yet stamped — rare, only on a brand-new first boot before
// getHardwareId() wrote into app_settings). Unknown-hwid rows fall back to
// business-level behavior (is_device_local=0, device_hwid=NULL) so they don't
// get orphaned.
function getLocalHwid() {
  if (!db) return null
  try { return db.prepare("SELECT value FROM app_settings WHERE key='hwid'").get()?.value || null }
  catch { return null }
}
function scopeForKey(key) {
  const hwid = getLocalHwid()
  if (isDeviceLocalCloudMirror(key) && hwid) {
    return { is_device_local: 1, device_hwid: hwid }
  }
  return { is_device_local: 0, device_hwid: null }
}

function setSetting(key, value) {
  if (!db) return
  // UPSERT that preserves business_id/supabase_id on existing rows and stamps
  // them on new rows. updated_at is bumped by the AFTER UPDATE trigger; for
  // INSERT we set it explicitly.
  const bizId = db.prepare("SELECT value FROM app_settings WHERE key='supabase_business_id'").get()?.value || null
  const uuid  = crypto.randomUUID()
  const scope = scopeForKey(key)
  db.prepare(`
    INSERT INTO app_settings(key, value, business_id, supabase_id, is_device_local, device_hwid, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value           = excluded.value,
      business_id     = COALESCE(app_settings.business_id, excluded.business_id),
      supabase_id     = COALESCE(app_settings.supabase_id, excluded.supabase_id),
      is_device_local = excluded.is_device_local,
      device_hwid     = excluded.device_hwid,
      updated_at      = datetime('now')
  `).run(key, String(value), bizId, uuid, scope.is_device_local, scope.device_hwid)
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
function settingsGet() {
  if (!db) return {}
  const rows = db.prepare('SELECT key,value FROM app_settings').all()
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}
function settingsUpdate(obj) {
  if (!db) return
  const bizId = db.prepare("SELECT value FROM app_settings WHERE key='supabase_business_id'").get()?.value || null
  const hwid  = getLocalHwid()
  const stmt = db.prepare(`
    INSERT INTO app_settings(key, value, business_id, supabase_id, is_device_local, device_hwid, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value           = excluded.value,
      business_id     = COALESCE(app_settings.business_id, excluded.business_id),
      supabase_id     = COALESCE(app_settings.supabase_id, excluded.supabase_id),
      is_device_local = excluded.is_device_local,
      device_hwid     = excluded.device_hwid,
      updated_at      = datetime('now')
  `)
  const run  = db.transaction(() => {
    for (const [k, v] of Object.entries(obj)) {
      // Skip undefined/null so we never poison a setting with the literal
      // string 'undefined'. An empty string is still a valid stored value.
      if (v === undefined || v === null) continue
      const isDev = isDeviceLocalCloudMirror(k) && hwid ? 1 : 0
      const tag   = isDev ? hwid : null
      stmt.run(k, String(v), bizId, crypto.randomUUID(), isDev, tag)
    }
  })
  run()
}

// ── USERS / AUTH ──────────────────────────────────────────────────────────────
// Sprint 10 (v2.10.5) — PIN auth hardened for S-H4/H5/H6.
//
//   S-H4: bcryptjs @ cost 10 with per-row 24-byte salt. Legacy SHA-256 rows
//         (pin_hash_algo='sha256') remain authenticatable until first success,
//         then are rehashed to bcrypt atomically in the same transaction.
//   S-H5: 5 consecutive wrong attempts lock the row for 5 minutes
//         (pin_failed_attempts / pin_locked_until). The ENTIRE table-level
//         attempt budget is per-row, not global, so a bad-actor guess against
//         one cashier can't lock out another. A correct PIN clears both.
//   S-H6: userUpdate refuses a self-PIN change unless data.oldPin verifies.
//
// authByPin scans every active, unlocked row with O(N) bcrypt compares. For
// a realistic staff size (≤ ~30) this is ~0.5s worst case per login — well
// within the UX budget and, crucially, slow enough that brute-forcing a
// specific PIN requires ~2M bcrypt ops (1M candidates × 2 cost factor),
// physically bounded by the 5-attempt lockout.
function authByPin(pin) {
  if (!db) return null
  const pinStr = String(pin || '').replace(/\D/g, '')
  if (!pinStr) return null

  const nowIso = new Date().toISOString()
  const rows = db.prepare(`
    SELECT id, name, username, role, discount_pct, pin_hash, pin_hash_algo,
           pin_salt, pin_failed_attempts, pin_locked_until, supabase_id,
           employee_id
      FROM users
     WHERE active=1
     ORDER BY (employee_id IS NOT NULL) DESC, id ASC
  `).all()

  const legacyHash = sha256(pinStr)
  let matched = null
  const incrementCandidates = []

  for (const r of rows) {
    // Locked? Skip — neither a match nor a miss counts against this row.
    if (r.pin_locked_until && r.pin_locked_until > nowIso) continue

    let hit = false
    const algo = r.pin_hash_algo || 'sha256'
    if (algo === 'bcrypt') {
      hit = bcryptComparePin(pinStr, r.pin_salt, r.pin_hash)
    } else {
      // Legacy unsalted SHA-256 — constant-time eq is fine since both sides
      // are hex digests of identical length.
      hit = (r.pin_hash === legacyHash)
    }

    if (hit) {
      matched = r
      break
    }
    incrementCandidates.push(r.id)
  }

  if (matched) {
    // Reset lockout counters + opportunistic rehash to bcrypt.
    const upgrade = db.transaction(() => {
      let newHash = matched.pin_hash
      let newSalt = matched.pin_salt
      let newAlgo = matched.pin_hash_algo || 'sha256'
      if (newAlgo !== 'bcrypt') {
        newSalt = generatePinSalt()
        newHash = bcryptHashPin(pinStr, newSalt)
        newAlgo = 'bcrypt'
      }
      db.prepare(`
        UPDATE users
           SET pin_hash=?, pin_hash_algo=?, pin_salt=?,
               pin_failed_attempts=0, pin_locked_until=NULL,
               updated_at=?
         WHERE id=?
      `).run(newHash, newAlgo, newSalt, nowIso, matched.id)
    })
    try { upgrade() } catch (e) { console.warn('[auth] rehash/reset failed:', e.message) }

    return {
      id: matched.id,
      name: matched.name,
      username: matched.username,
      role: matched.role,
      discount_pct: matched.discount_pct,
      supabase_id: matched.supabase_id,
      employee_id: matched.employee_id,
    }
  }

  // Miss — increment attempts on every non-locked row we tried, lock any
  // that crossed the threshold. Doing this per-row (not global) means an
  // attacker guessing PIN X can't starve the ownership row into a lockout.
  if (incrementCandidates.length) {
    const lockAt = new Date(Date.now() + PIN_LOCKOUT_MS).toISOString()
    const stmt = db.prepare(`
      UPDATE users
         SET pin_failed_attempts = pin_failed_attempts + 1,
             pin_locked_until    = CASE
               WHEN pin_failed_attempts + 1 >= ? THEN ?
               ELSE pin_locked_until
             END,
             updated_at = ?
       WHERE id = ?
    `)
    const tx = db.transaction(() => {
      for (const id of incrementCandidates) {
        try { stmt.run(PIN_MAX_FAILED_ATTEMPTS, lockAt, nowIso, id) } catch {}
      }
    })
    try { tx() } catch (e) { console.warn('[auth] lockout bump failed:', e.message) }
  }

  return null
}

// Telemetry helper — UI can surface "Cuenta bloqueada" if ANY active row is
// currently locked. Returns { locked: boolean, until: ISO|null } for the row
// closest to unlocking (earliest pin_locked_until).
function authLockoutStatus() {
  if (!db) return { locked: false, until: null }
  const nowIso = new Date().toISOString()
  const row = db.prepare(`
    SELECT pin_locked_until AS until
      FROM users
     WHERE active=1 AND pin_locked_until IS NOT NULL AND pin_locked_until > ?
     ORDER BY pin_locked_until ASC
     LIMIT 1
  `).get(nowIso)
  return row ? { locked: true, until: row.until } : { locked: false, until: null }
}
function usersGetAll() {
  if (!db) return []
  return db.prepare(`SELECT id,name,username,role,discount_pct,active,employee_id,supabase_id,
    manager_auth_hash IS NOT NULL AS has_auth_card,
    manager_auth_rotated_at
    FROM users ORDER BY id`).all()
}
function userCreate(data) {
  if (!db) return null
  // Sprint 10 — new local rows bcrypt the PIN with a per-row salt. Remote
  // pulls (data.pin_hash supplied) keep whatever algo the remote row used;
  // the caller MUST also pass pin_hash_algo + pin_salt or default stays
  // sha256 so authByPin recognises it as legacy and rehashes on next login.
  //
  // resolvePinCreds() returns { pin_hash, pin_hash_algo, pin_salt }.
  const resolvePinCreds = () => {
    if (data.pin_hash) {
      return {
        pin_hash: data.pin_hash,
        pin_hash_algo: data.pin_hash_algo || 'sha256',
        pin_salt: data.pin_salt || null,
      }
    }
    if (data.pin) {
      const salt = generatePinSalt()
      return {
        pin_hash: bcryptHashPin(data.pin, salt),
        pin_hash_algo: 'bcrypt',
        pin_salt: salt,
      }
    }
    throw new Error('PIN requerido')
  }

  // F2 / F8 — supabase_id is AUTHORITATIVE identity. If the caller supplies
  // one, we ONLY match on that. We never fall back to username match when a
  // supabase_id is present, because that was the exact mechanism by which
  // FirstTimeSetup's `supabase_id: u.id` bug (F2) re-wrote a correct local
  // row's identity and poisoned sync forever. If the supplied supabase_id
  // doesn't exist locally, we INSERT a new row regardless of whether a row
  // with the same username exists (defensive — two users with the same
  // username but different Supabase UUIDs is a legitimate state during
  // dedup / migration and must not auto-merge).
  if (data.supabase_id) {
    const existing = db.prepare('SELECT id, supabase_id FROM users WHERE supabase_id=?').get(data.supabase_id)
    if (existing) {
      const creds = resolvePinCreds()
      db.prepare(`UPDATE users SET name=@name, username=@username,
                  pin_hash=@pin_hash, pin_hash_algo=@pin_hash_algo, pin_salt=@pin_salt,
                  pin_failed_attempts=0, pin_locked_until=NULL,
                  role=@role, discount_pct=@discount_pct,
                  commission_pct=COALESCE(@commission_pct, commission_pct),
                  employee_id=@employee_id, cedula=@cedula, start_date=@start_date,
                  active=1 WHERE id=@id`)
        .run({
          name: data.name,
          username: data.username,
          pin_hash: creds.pin_hash,
          pin_hash_algo: creds.pin_hash_algo,
          pin_salt: creds.pin_salt,
          role: data.role,
          discount_pct: data.discount_pct || 0,
          commission_pct: data.commission_pct ?? null,
          employee_id: data.employee_id || null,
          cedula: data.cedula || null,
          start_date: data.start_date || null,
          id: existing.id,
        })
      return { id: existing.id, supabase_id: data.supabase_id }
    }
    // No match on supabase_id → INSERT new row, even if username collides.
    try {
      const creds = resolvePinCreds()
      const r = db.prepare(`INSERT INTO users(name,username,pin_hash,pin_hash_algo,pin_salt,role,discount_pct,commission_pct,employee_id,cedula,start_date,active,supabase_id)
        VALUES(@name,@username,@pin_hash,@pin_hash_algo,@pin_salt,@role,@discount_pct,@commission_pct,@employee_id,@cedula,@start_date,1,@supabase_id)`).run({
        name: data.name,
        username: data.username,
        pin_hash: creds.pin_hash,
        pin_hash_algo: creds.pin_hash_algo,
        pin_salt: creds.pin_salt,
        role: data.role,
        discount_pct: data.discount_pct || 0,
        commission_pct: data.commission_pct || 0,
        employee_id: data.employee_id || null,
        cedula: data.cedula || null,
        start_date: data.start_date || null,
        supabase_id: data.supabase_id,
      })
      return { id: r.lastInsertRowid, supabase_id: data.supabase_id }
    } catch (e) {
      if (e.message?.includes('UNIQUE') && e.message?.includes('username')) {
        console.warn(`[db] userCreate: username "${data.username}" already exists under a different supabase_id. Skipping — caller should resolve the collision.`)
        return null
      }
      throw e
    }
  }

  // No supabase_id supplied → local-only create.
  let existing = db.prepare('SELECT id, supabase_id FROM users WHERE username=?').get(data.username)
  if (existing) {
    const creds = resolvePinCreds()
    db.prepare(`UPDATE users SET name=@name,
                pin_hash=@pin_hash, pin_hash_algo=@pin_hash_algo, pin_salt=@pin_salt,
                pin_failed_attempts=0, pin_locked_until=NULL,
                role=@role, discount_pct=@discount_pct,
                commission_pct=COALESCE(@commission_pct, commission_pct),
                employee_id=@employee_id, cedula=@cedula, start_date=@start_date,
                active=1 WHERE id=@id`)
      .run({
        name: data.name,
        pin_hash: creds.pin_hash,
        pin_hash_algo: creds.pin_hash_algo,
        pin_salt: creds.pin_salt,
        role: data.role,
        discount_pct: data.discount_pct || 0,
        commission_pct: data.commission_pct ?? null,
        employee_id: data.employee_id || null,
        cedula: data.cedula || null,
        start_date: data.start_date || null,
        id: existing.id,
      })
    return { id: existing.id, supabase_id: existing.supabase_id }
  }
  const sid = crypto.randomUUID()
  const creds = resolvePinCreds()
  const r = db.prepare(`INSERT INTO users(name,username,pin_hash,pin_hash_algo,pin_salt,role,discount_pct,commission_pct,employee_id,cedula,start_date,active,supabase_id)
    VALUES(@name,@username,@pin_hash,@pin_hash_algo,@pin_salt,@role,@discount_pct,@commission_pct,@employee_id,@cedula,@start_date,1,@supabase_id)`).run({
    name: data.name,
    username: data.username,
    pin_hash: creds.pin_hash,
    pin_hash_algo: creds.pin_hash_algo,
    pin_salt: creds.pin_salt,
    role: data.role,
    discount_pct: data.discount_pct || 0,
    commission_pct: data.commission_pct || 0,
    employee_id: data.employee_id || null,
    cedula: data.cedula || null,
    start_date: data.start_date || null,
    supabase_id: sid,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
// Inline role hierarchy — mirror of electron/auth-guard.js ROLE_LEVEL.
// Duplicated here to avoid a circular require (auth-guard.js loads this
// module via the `db` param it receives). Keep in sync.
const _USER_ROLE_LEVEL = Object.freeze({
  owner: 100, cfo: 70, accountant: 60, manager: 50, cashier: 10, none: 0,
})
function _roleRank(r) { return _USER_ROLE_LEVEL[r] ?? 0 }

function userUpdate(id, data) {
  if (!db) return
  // v2.11.2 — DEFENSE IN DEPTH: role-hierarchy enforcement at the DB layer.
  // Primary gate is electron/auth-guard.js guardUserUpdate (IPC), but any
  // direct call into this fn must also be safe. actorId is injected by the
  // IPC handlers in main.js (save-usuario, users:update) from the trusted
  // server-side session — renderer cannot override it.
  //
  // Closes project_security_queue.md: manager cannot reset owner's PIN /
  // promote anyone / deactivate a superior.
  if (data.actorId != null && String(data.actorId) !== String(id)) {
    try {
      const actorRow = db.prepare('SELECT id, role FROM users WHERE id=?').get(data.actorId)
      const targetRow = db.prepare('SELECT id, role FROM users WHERE id=?').get(id)
      if (actorRow && targetRow) {
        const actorRank  = _roleRank(actorRow.role)
        const targetRank = _roleRank(targetRow.role)
        // Any mutation of a peer-or-superior (rank >= actor) is forbidden.
        // That blocks PIN reset, active toggle, role change, rename, etc.
        if (targetRank >= actorRank) {
          throw new Error('No tienes permiso para modificar este usuario')
        }
        // Role escalation: cannot set a role rank >= actor's own unless owner.
        if (data.role && _roleRank(data.role) >= actorRank && actorRow.role !== 'owner') {
          throw new Error('Solo el propietario puede asignar este rol')
        }
        // Deactivation of superior already caught by targetRank >= actorRank
        // check above. Self-deactivate is handled by the IPC guard + the
        // same-id short-circuit means we never enter this block for self.
      }
    } catch (e) {
      if (e && /permiso|propietario/.test(String(e.message))) throw e
      // Any other lookup error: fail-closed only if actorId was set.
      // (If DB shape differs in a test harness, don't silently bypass.)
      throw e
    }
  }
  // Sprint 10 (S-H6) — self-PIN changes MUST prove knowledge of the old PIN.
  // Manager/owner-driven resets for OTHER users are already gated by the IPC
  // auth-guard; they don't have to re-enter that user's old PIN. We
  // distinguish the two by comparing data.actorId (set by the IPC layer from
  // session state) against the target id.
  const selfPinChange = !!data.pin && data.actorId != null && String(data.actorId) === String(id)
  if (selfPinChange) {
    if (!data.oldPin) throw new Error('Old PIN required')
    const row = db.prepare('SELECT pin_hash, pin_hash_algo, pin_salt, pin_locked_until FROM users WHERE id=?').get(id)
    if (!row) throw new Error('User not found')
    if (row.pin_locked_until && row.pin_locked_until > new Date().toISOString()) {
      throw new Error('Account locked')
    }
    const algo = row.pin_hash_algo || 'sha256'
    const ok = algo === 'bcrypt'
      ? bcryptComparePin(data.oldPin, row.pin_salt, row.pin_hash)
      : row.pin_hash === sha256(String(data.oldPin))
    if (!ok) throw new Error('Old PIN incorrect')
  }

  const allowed = ['name', 'username', 'pin_hash', 'pin_hash_algo', 'pin_salt', 'pin_failed_attempts', 'pin_locked_until', 'role', 'discount_pct', 'employee_id', 'vendedor_id', 'commission_pct', 'active', 'supabase_id', 'cedula', 'start_date']
  const { pin, oldPin, actorId, ...rest } = data
  if (pin && !rest.pin_hash) {
    const salt = generatePinSalt()
    rest.pin_hash      = bcryptHashPin(pin, salt)
    rest.pin_hash_algo = 'bcrypt'
    rest.pin_salt      = salt
  }
  const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  // v2.2.1 — capture "before" row so we can audit sensitive changes (PIN, role).
  let before = null
  try { before = db.prepare('SELECT name, username, role, pin_hash FROM users WHERE id=?').get(id) } catch {}
  // Any PIN rotation wipes the lockout counters — otherwise a freshly reset
  // PIN could inherit a locked state from the previous PIN's bad-guess streak.
  if (patch.pin_hash) {
    patch.pin_failed_attempts = 0
    patch.pin_locked_until    = null
  }
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE users SET ${fields} WHERE id=@id`).run({ ...patch, id })
  if (before) {
    const targetName = `${before.name || ''} (@${before.username || ''})`
    try {
      if (patch.pin_hash && patch.pin_hash !== before.pin_hash) {
        activityLogRecord({ event_type: 'user_pin_changed', severity: 'critical',
          target_type: 'user', target_id: id, target_name: targetName,
          reason: 'PIN reset from Admin/Usuarios' })
      }
      if (patch.role && patch.role !== before.role) {
        activityLogRecord({ event_type: 'user_role_changed', severity: 'warn',
          target_type: 'user', target_id: id, target_name: targetName,
          old_value: before.role, new_value: patch.role })
      }
    } catch {}
  }
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

function userDeleteHard(id) {
  if (!db) return { deleted: false }
  const target = db.prepare('SELECT name, username FROM users WHERE id=?').get(id)
  if (!target) return { deleted: false, error: 'User not found' }
  const targetName = `${target.name} (@${target.username})`
  const tx = db.transaction(() => {
    db.prepare('UPDATE tickets SET cajero_id=NULL WHERE cajero_id=?').run(id)
    db.prepare('UPDATE tickets SET void_by=NULL WHERE void_by=?').run(id)
    try { db.prepare('UPDATE nominas SET paid_by=NULL WHERE paid_by=?').run(id) } catch {}
    try { db.prepare('UPDATE service_price_history SET changed_by=NULL WHERE changed_by=?').run(id) } catch {}
    try { db.prepare('UPDATE cuadre_caja SET cajero_id=NULL WHERE cajero_id=?').run(id) } catch {}
    try { db.prepare('UPDATE caja_chica SET cajero_id=NULL, approved_by=NULL WHERE cajero_id=? OR approved_by=?').run(id, id) } catch {}
    try { db.prepare('UPDATE notas_credito SET cajero_id=NULL WHERE cajero_id=?').run(id) } catch {}
    try { db.prepare('DELETE FROM cajero_commissions WHERE cajero_id=?').run(id) } catch {}
    db.prepare('DELETE FROM users WHERE id=?').run(id)
  })
  tx()
  activityLogRecord({ event_type: 'user_hard_deleted', severity: 'critical',
    target_type: 'user', target_id: id, target_name: targetName,
    reason: 'force delete from Admin → Usuarios' })
  return { deleted: true, hard: true }
}

// ── MANAGER AUTHORIZATION CARD (v2.6) ─────────────────────────────────────────
// Scan-only physical card holding a 20-char random token. Raw token stays in
// the cashier's hand once (for printing) and immediately disappears — only the
// SHA-256 hash lives in the DB. Role-gated: only owner/manager can hold a card.

const MGR_TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const MGR_TOKEN_LENGTH   = 20

function _mgrGenerateToken() {
  const bytes = crypto.randomBytes(MGR_TOKEN_LENGTH)
  const A = MGR_TOKEN_ALPHABET
  let out = ''
  for (let i = 0; i < MGR_TOKEN_LENGTH; i++) out += A[bytes[i] % A.length]
  return out
}
function _mgrHashToken(token) {
  const raw = String(token || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex')
}

/**
 * Rotate (or first-time issue) a manager card for a user. Returns the PLAIN
 * token exactly ONCE — caller MUST print it immediately.
 * Rejects users whose role is not owner/manager.
 */
function staffGenerateAuthCard(userId) {
  if (!db) return { ok: false, error: 'DB not ready' }
  const u = db.prepare('SELECT id, name, username, role, active FROM users WHERE id=?').get(userId)
  if (!u) return { ok: false, error: 'Usuario no encontrado' }
  if (!u.active) return { ok: false, error: 'Usuario inactivo' }
  if (u.role !== 'owner' && u.role !== 'manager') {
    return { ok: false, error: 'Solo dueño o gerente pueden tener tarjeta' }
  }
  const token = _mgrGenerateToken()
  const hash  = _mgrHashToken(token)
  const now   = new Date().toISOString()
  db.prepare(`UPDATE users SET manager_auth_hash=@hash, manager_auth_rotated_at=@now, updated_at=@now WHERE id=@id`)
    .run({ hash, now, id: userId })
  activityLogRecord({
    event_type: 'manager_card_rotated', severity: 'warn',
    target_type: 'user', target_id: userId,
    target_name: `${u.name} (@${u.username})`,
    reason: 'Tarjeta de autorización emitida/rotada',
  })
  return { ok: true, token, rotatedAt: now, user: { id: u.id, name: u.name, username: u.username, role: u.role } }
}

function staffRevokeAuthCard(userId) {
  if (!db) return { ok: false }
  const u = db.prepare('SELECT id, name, username, role FROM users WHERE id=?').get(userId)
  if (!u) return { ok: false, error: 'Usuario no encontrado' }
  const now = new Date().toISOString()
  db.prepare(`UPDATE users SET manager_auth_hash=NULL, manager_auth_rotated_at=@now, updated_at=@now WHERE id=@id`)
    .run({ now, id: userId })
  activityLogRecord({
    event_type: 'manager_card_revoked', severity: 'warn',
    target_type: 'user', target_id: userId,
    target_name: `${u.name} (@${u.username})`,
    reason: 'Tarjeta de autorización revocada',
  })
  return { ok: true, rotatedAt: now }
}

/**
 * Verify a scanned token. Returns the matching active manager/owner user or
 * null. Constant-time-ish: we hash the input before touching the DB.
 */
function staffVerifyAuthToken(token) {
  if (!db) return null
  const raw = String(token || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (raw.length < 8) return null
  const hash = _mgrHashToken(raw)
  const row = db.prepare(`SELECT id, name, username, role, supabase_id, manager_auth_rotated_at
                            FROM users
                           WHERE manager_auth_hash = ?
                             AND active = 1
                             AND role IN ('owner','manager')
                           LIMIT 1`).get(hash)
  if (!row) return null
  return { id: row.id, name: row.name, username: row.username, role: row.role,
           supabase_id: row.supabase_id, rotatedAt: row.manager_auth_rotated_at }
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
  const row = db.prepare('SELECT supabase_id, business_id FROM categorias_servicio WHERE id=?').get(id)
  db.prepare('DELETE FROM categorias_servicio WHERE id=?').run(id)
  if (row?.supabase_id) tombstoneAdd('categorias_servicio', row.supabase_id, row.business_id)
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
  const r = db.prepare(`INSERT INTO services(name,name_en,category,categoria_id,price,cost,aplica_itbis,is_wash,no_commission,commission_washer,commission_seller,commission_cashier,active,sort_order,supabase_id,is_menu_item,course,station,printer_route,happy_hour_price,happy_hour_start,happy_hour_end)
    VALUES(@name,@name_en,@category,@categoria_id,@price,COALESCE(@cost,0),COALESCE(@aplica_itbis,1),@is_wash,@no_commission,@commission_washer,@commission_seller,@commission_cashier,1,COALESCE(@sort_order,0),@supabase_id,@is_menu_item,@course,@station,@printer_route,@happy_hour_price,@happy_hour_start,@happy_hour_end)`).run({
    name: data.name, name_en: data.name_en || null,
    category: data.category || 'Lavado', categoria_id: data.categoria_id || null,
    price: data.price, cost: data.cost || 0, aplica_itbis: data.aplica_itbis ?? 1,
    is_wash: data.is_wash ?? 1, no_commission: noComm,
    commission_washer: cw, commission_seller: cs, commission_cashier: cc,
    sort_order: data.sort_order || 0,
    supabase_id: sid,
    is_menu_item: data.is_menu_item ? 1 : 0,
    course: data.course || null,
    station: data.station || null,
    printer_route: data.printer_route || null,
    happy_hour_price: data.happy_hour_price != null ? data.happy_hour_price : null,
    happy_hour_start: data.happy_hour_start || null,
    happy_hour_end:   data.happy_hour_end   || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function serviceUpdate(id, data) {
  if (!db) return
  const allowed = ['name','name_en','category','categoria_id','price','cost','aplica_itbis','is_wash','no_commission','commission_washer','commission_seller','commission_cashier','active','sort_order','is_menu_item','course','station','printer_route','happy_hour_price','happy_hour_start','happy_hour_end']
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

// ── WASHERS (v2.1 shims → empleados tipo='lavador'/'hybrid') ─────────────────
// Preserves the pre-v2.1 function signatures + return shape so existing IPC
// handlers, UI callers, and report screens keep working unchanged. Internally
// all writes/reads route through `empleados`; `commission_pct` maps to
// `comision_pct`, `name` maps to `nombre`. `hybrid` employees show up in BOTH
// washer and seller lists.
function _empLavadorRow(e) {
  if (!e) return e
  // Present the historic shape: `name`, `commission_pct`, etc.
  return {
    id: e.id,
    supabase_id: e.supabase_id,
    name: e.nombre,
    phone: e.phone,
    cedula: e.cedula,
    commission_pct: e.comision_pct != null ? e.comision_pct : 0,
    start_date: e.start_date,
    active: e.active,
    created_at: e.created_at,
    updated_at: e.updated_at,
  }
}
function washersGetAll() {
  if (!db) return []
  return db.prepare(`SELECT * FROM empleados WHERE active=1 AND tipo IN ('lavador','hybrid') ORDER BY nombre`).all().map(_empLavadorRow)
}
function washersGetAllAdmin() {
  if (!db) return []
  return db.prepare(`SELECT * FROM empleados WHERE tipo IN ('lavador','hybrid') ORDER BY nombre`).all().map(_empLavadorRow)
}
function washerCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO empleados(nombre,tipo,phone,cedula,comision_pct,start_date,role,active,supabase_id,updated_at,salary)
    VALUES(@nombre,'lavador',@phone,@cedula,@comision_pct,@start_date,'none',1,@supabase_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),0)`).run({
    nombre: data.name, phone: data.phone || null, cedula: data.cedula || null,
    comision_pct: data.commission_pct != null ? data.commission_pct : 20,
    start_date: data.start_date || new Date().toISOString().slice(0, 10),
    supabase_id: sid,
  })
  return { id: r.lastInsertRowid, supabase_id: sid, name: data.name, commission_pct: data.commission_pct || 20 }
}
function washerUpdate(id, data) {
  if (!db) return
  // Translate legacy column names → empleados columns.
  const patch = {}
  if (data.name != null) patch.nombre = data.name
  if (data.phone != null) patch.phone = data.phone
  if (data.cedula != null) patch.cedula = data.cedula
  if (data.commission_pct != null) patch.comision_pct = data.commission_pct
  if (data.start_date != null) patch.start_date = data.start_date
  if (data.active != null) patch.active = data.active
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE empleados SET ${fields} WHERE id=@id AND tipo IN ('lavador','hybrid')`).run({ ...patch, id })
}
function washerDelete(id) {
  if (!db) return
  db.prepare(`UPDATE empleados SET active=0 WHERE id=? AND tipo IN ('lavador','hybrid')`).run(id)
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
  const r = db.prepare(`INSERT INTO empleados(nombre,tipo,ref_id,salary,comision_pct,start_date,cedula,phone,puesto,email,bank_account,tss_id,role,active,supabase_id)
    VALUES(@nombre,@tipo,@ref_id,@salary,@comision_pct,@start_date,@cedula,@phone,@puesto,@email,@bank_account,@tss_id,@role,1,@supabase_id)`).run({
    nombre: data.nombre, tipo: data.tipo, ref_id: data.ref_id || null,
    salary: data.salary || 0, comision_pct: data.comision_pct || 0,
    start_date: data.start_date,
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
  const allowed = ['nombre','tipo','ref_id','salary','comision_pct','start_date','cedula','phone','puesto','email','bank_account','tss_id','role','active']
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
  const emp = db.prepare('SELECT id, supabase_id FROM empleados WHERE id=?').get(id)
  if (!emp) return { ok: false, reason: 'not-found' }
  // Safety: refuse hard delete if there's financial history referencing this empleado.
  const runs = db.prepare('SELECT COUNT(*) AS n FROM payroll_runs WHERE empleado_id=?').get(id)?.n || 0
  // v2.1: commission tables FK to empleados.supabase_id directly.
  let commCount = 0
  try { commCount += db.prepare('SELECT COUNT(*) AS n FROM washer_commissions WHERE empleado_supabase_id=?').get(emp.supabase_id)?.n || 0 } catch {}
  try { commCount += db.prepare('SELECT COUNT(*) AS n FROM seller_commissions WHERE empleado_supabase_id=?').get(emp.supabase_id)?.n || 0 } catch {}
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
  // v1.9.25 — bump monotonic rev so Supabase trigger can reject a slower
  // concurrent status change. See sync.js header "mesas.status race".
  db.prepare(`UPDATE mesas
    SET status=?, waiter_empleado_id=?, waiter_empleado_supabase_id=?, guests_count=?,
        seated_at=COALESCE(seated_at, CASE WHEN ?='ocupada' THEN datetime('now') END),
        rev=COALESCE(rev,0)+1,
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
  const row = db.prepare('SELECT supabase_id, business_id FROM payroll_runs WHERE id=?').get(id)
  db.prepare('DELETE FROM payroll_runs WHERE id=?').run(id)
  if (row?.supabase_id) tombstoneAdd('payroll_runs', row.supabase_id, row.business_id)
}

// ── ADELANTOS DE NOMINA (salary advances) ─────────────────────────────────────
function adelantoCreate({ empleado_id, amount, notes, approved_by, approved_by_user_id }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const emp = db.prepare('SELECT supabase_id FROM empleados WHERE id=?').get(empleado_id)
  // Resolve stable approver supabase_id when caller passes their user id, so
  // the audit trail survives renames. `approved_by` (display string) is kept
  // for legacy readers that don't join the user row.
  let approver_sid = null
  if (approved_by_user_id) {
    try { approver_sid = db.prepare('SELECT supabase_id FROM users WHERE id=?').get(approved_by_user_id)?.supabase_id || null } catch {}
  }
  const r = db.prepare(`INSERT INTO adelantos
    (supabase_id, empleado_id, empleado_supabase_id, amount, notes, approved_by, approved_by_supabase_id)
    VALUES (@supabase_id, @empleado_id, @empleado_supabase_id, @amount, @notes, @approved_by, @approved_by_supabase_id)`).run({
    supabase_id: sid,
    empleado_id,
    empleado_supabase_id: emp?.supabase_id || null,
    amount: Number(amount),
    notes: notes || null,
    approved_by: approved_by || null,
    approved_by_supabase_id: approver_sid,
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
  if (!db) return null
  const row = db.prepare('SELECT empleado_id, supabase_id, business_id FROM salary_changes WHERE id=?').get(id)
  if (!row) return null
  db.prepare('DELETE FROM salary_changes WHERE id=?').run(id)
  if (row.supabase_id) tombstoneAdd('salary_changes', row.supabase_id, row.business_id)
  // Re-sync empleados.salary to whatever the new latest change is (or 0 if none)
  const latest = db.prepare(`
    SELECT new_salary FROM salary_changes
    WHERE empleado_id = ?
    ORDER BY effective_date DESC, id DESC LIMIT 1
  `).get(row.empleado_id)
  db.prepare('UPDATE empleados SET salary=? WHERE id=?').run(Number(latest?.new_salary || 0), row.empleado_id)
  return { supabase_id: row.supabase_id || null }
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

// ── SELLERS (v2.1 shims → empleados tipo='vendedor'/'hybrid') ────────────────
function _empVendedorRow(e) {
  if (!e) return e
  return {
    id: e.id,
    supabase_id: e.supabase_id,
    name: e.nombre,
    phone: e.phone,
    cedula: e.cedula,
    commission_pct: e.comision_pct != null ? e.comision_pct : 0,
    start_date: e.start_date,
    active: e.active,
    created_at: e.created_at,
    updated_at: e.updated_at,
  }
}
function sellersGetAll() {
  if (!db) return []
  return db.prepare(`SELECT * FROM empleados WHERE active=1 AND tipo IN ('vendedor','hybrid') ORDER BY nombre`).all().map(_empVendedorRow)
}
function sellersGetAllAdmin() {
  if (!db) return []
  return db.prepare(`SELECT * FROM empleados WHERE tipo IN ('vendedor','hybrid') ORDER BY nombre`).all().map(_empVendedorRow)
}
function sellerCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO empleados(nombre,tipo,phone,cedula,comision_pct,start_date,role,active,supabase_id,updated_at,salary)
    VALUES(@nombre,'vendedor',@phone,@cedula,@comision_pct,@start_date,'none',1,@supabase_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),0)`).run({
    nombre: data.name, phone: data.phone || null, cedula: data.cedula || null,
    comision_pct: data.commission_pct != null ? data.commission_pct : 5,
    start_date: data.start_date || new Date().toISOString().slice(0, 10),
    supabase_id: sid,
  })
  return { id: r.lastInsertRowid, supabase_id: sid, name: data.name, commission_pct: data.commission_pct || 5 }
}
function sellerUpdate(id, data) {
  if (!db) return
  const patch = {}
  if (data.name != null) patch.nombre = data.name
  if (data.phone != null) patch.phone = data.phone
  if (data.cedula != null) patch.cedula = data.cedula
  if (data.commission_pct != null) patch.comision_pct = data.commission_pct
  if (data.start_date != null) patch.start_date = data.start_date
  if (data.active != null) patch.active = data.active
  if (!Object.keys(patch).length) return
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE empleados SET ${fields} WHERE id=@id AND tipo IN ('vendedor','hybrid')`).run({ ...patch, id })
}
function sellerDelete(id) {
  if (!db) return
  db.prepare(`UPDATE empleados SET active=0 WHERE id=? AND tipo IN ('vendedor','hybrid')`).run(id)
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
  const allowed = ['name','rnc','phone','email','address','credit_limit','balance','visits','total_spent','notes','active','loyalty_points','birthday_treat_available','allergies','preferred_stylist_id','preferred_stylist_supabase_id','last_service_date']
  const patch   = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  // Keep preferred_stylist_supabase_id in sync when only the numeric id is given.
  if (data.preferred_stylist_id && !data.preferred_stylist_supabase_id) {
    const e = db.prepare('SELECT supabase_id FROM empleados WHERE id=?').get(data.preferred_stylist_id)
    if (e) patch.preferred_stylist_supabase_id = e.supabase_id
  }
  if (Object.keys(patch).length === 0) return
  const fields  = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE clients SET ${fields} WHERE id=@id`).run({ ...patch, id })
}
// Tier bucket derived from LIFETIME earned (not current balance).
// Owner-tunable via app_settings.loyalty_tier_{silver,gold}. Defaults per spec:
//   bronze  <  1 000
//   silver  >= 1 000
//   gold    >= 5 000
// Legacy 'platinum' rows are treated as 'gold' by the Spanish label helper.
function _loyaltyTierFor(lifetime) {
  const pts = Number(lifetime) || 0
  const g = (k, d) => { try { const v = db.prepare('SELECT value FROM app_settings WHERE key=?').get(k)?.value; const n = Number(v); return Number.isFinite(n) ? n : d } catch { return d } }
  const tSilver = g('loyalty_tier_silver', 1000)
  const tGold   = g('loyalty_tier_gold',   5000)
  if (pts >= tGold)   return 'gold'
  if (pts >= tSilver) return 'silver'
  return 'bronze'
}

// Earn multiplier per tier (snapshot BEFORE the current earn so crossing a
// threshold mid-award never retro-boosts previous points).
function _loyaltyTierMultiplier(tier) {
  switch (tier) {
    case 'gold':
    case 'platinum': return 1.5
    case 'silver':   return 1.25
    default:         return 1.0
  }
}

// Recompute lifetime_earned from the canonical ledger. Idempotent.
function _loyaltyRecomputeLifetime(clientId) {
  if (!db || !clientId) return { lifetime: 0, tier: 'bronze' }
  const row = db.prepare(`
    SELECT COALESCE(SUM(points), 0) AS lifetime
      FROM loyalty_transactions
     WHERE client_id = ?
       AND points > 0
       AND event_type IN ('earn','adjust')
  `).get(clientId)
  const lifetime = Number(row?.lifetime) || 0
  const tier = _loyaltyTierFor(lifetime)
  db.prepare("UPDATE clients SET loyalty_lifetime_earned=?, loyalty_tier=?, updated_at=datetime('now') WHERE id=?")
    .run(lifetime, tier, clientId)
  return { lifetime, tier }
}

// Legacy: numeric-id loyalty delta (v2.4 salon). Does NOT go through the
// ledger so it doesn't affect lifetime_earned or tier — intentionally, since
// the salon auto-accrual path predates the tier system and shouldn't be
// gaming tier progression.
function clientAddLoyaltyPoints(id, delta) {
  if (!db || !id) return
  const d = Number(delta) || 0
  db.prepare("UPDATE clients SET loyalty_points = MAX(0, COALESCE(loyalty_points,0) + @delta) WHERE id=@id").run({ id, delta: d })
}

// Ledger-backed loyalty award. Idempotent per ticket_supabase_id.
// Applies the tier-earn multiplier (bronze 1.00 / silver 1.25 / gold 1.50)
// from a snapshot of the client's CURRENT tier — a mid-award threshold
// crossing doesn't retro-boost. Lifetime_earned + tier recomputed from the
// ledger after insert so Supabase trigger + local logic stay bit-identical.
function loyaltyAward({ clientId, clientSupabaseId, ticketId, ticketSupabaseId, points, notes } = {}) {
  if (!db) return 0
  const p = Number(points) || 0
  if (p <= 0) return 0
  const client = clientSupabaseId
    ? db.prepare('SELECT id, supabase_id, loyalty_points, loyalty_tier, business_id FROM clients WHERE supabase_id=?').get(clientSupabaseId)
    : (clientId ? db.prepare('SELECT id, supabase_id, loyalty_points, loyalty_tier, business_id FROM clients WHERE id=?').get(clientId) : null)
  if (!client) return 0
  if (ticketSupabaseId) {
    const existing = db.prepare("SELECT balance_after FROM loyalty_transactions WHERE ticket_supabase_id=? AND event_type='earn'").get(ticketSupabaseId)
    if (existing) return existing.balance_after
  }

  const mult       = _loyaltyTierMultiplier(client.loyalty_tier || 'bronze')
  const effective  = Math.round(p * mult * 100) / 100
  const newBalance = Math.max(0, (Number(client.loyalty_points) || 0) + effective)
  const tag        = mult > 1 ? ` [x${mult} ${client.loyalty_tier}]` : ''

  db.prepare("UPDATE clients SET loyalty_points=?, updated_at=datetime('now') WHERE id=?")
    .run(newBalance, client.id)

  const sid = crypto.randomUUID()
  db.prepare(`INSERT INTO loyalty_transactions
    (supabase_id,business_id,client_id,client_supabase_id,ticket_id,ticket_supabase_id,event_type,points,balance_after,notes)
    VALUES(@supabase_id,@business_id,@client_id,@client_supabase_id,@ticket_id,@ticket_supabase_id,'earn',@points,@balance_after,@notes)`).run({
    supabase_id: sid,
    business_id: client.business_id || null,
    client_id: client.id,
    client_supabase_id: client.supabase_id,
    ticket_id: ticketId || null,
    ticket_supabase_id: ticketSupabaseId || null,
    points: effective,
    balance_after: newBalance,
    notes: (notes || '') + tag || null,
  })

  // Recompute lifetime + tier from ledger sum (trigger-equivalent).
  _loyaltyRecomputeLifetime(client.id)
  return newBalance
}

function loyaltyRedeem({ clientId, clientSupabaseId, ticketId, ticketSupabaseId, points, notes } = {}) {
  if (!db) return { ok: false, reason: 'no_db' }
  const p = Number(points) || 0
  if (p <= 0) return { ok: false, reason: 'invalid_amount' }
  const client = clientSupabaseId
    ? db.prepare('SELECT id, supabase_id, loyalty_points, business_id FROM clients WHERE supabase_id=?').get(clientSupabaseId)
    : (clientId ? db.prepare('SELECT id, supabase_id, loyalty_points, business_id FROM clients WHERE id=?').get(clientId) : null)
  if (!client) return { ok: false, reason: 'no_client' }
  const current = Number(client.loyalty_points) || 0
  if (current < p) return { ok: false, reason: 'insufficient', current }
  const newBalance = current - p
  // Redeem does NOT touch loyalty_tier — tier is lifetime-driven.
  db.prepare("UPDATE clients SET loyalty_points=?, updated_at=datetime('now') WHERE id=?")
    .run(newBalance, client.id)
  const tier = client.loyalty_tier || 'bronze'
  const sid = crypto.randomUUID()
  db.prepare(`INSERT INTO loyalty_transactions
    (supabase_id,business_id,client_id,client_supabase_id,ticket_id,ticket_supabase_id,event_type,points,balance_after,notes)
    VALUES(@supabase_id,@business_id,@client_id,@client_supabase_id,@ticket_id,@ticket_supabase_id,'redeem',@points,@balance_after,@notes)`).run({
    supabase_id: sid,
    business_id: client.business_id || null,
    client_id: client.id,
    client_supabase_id: client.supabase_id,
    ticket_id: ticketId || null,
    ticket_supabase_id: ticketSupabaseId || null,
    points: -p,
    balance_after: newBalance,
    notes: notes || null,
  })
  return { ok: true, balance: newBalance, tier }
}

function loyaltyAdjust({ clientId, clientSupabaseId, delta, notes } = {}) {
  if (!db) return 0
  const d = Number(delta) || 0
  const client = clientSupabaseId
    ? db.prepare('SELECT id, supabase_id, loyalty_points, business_id FROM clients WHERE supabase_id=?').get(clientSupabaseId)
    : (clientId ? db.prepare('SELECT id, supabase_id, loyalty_points, business_id FROM clients WHERE id=?').get(clientId) : null)
  if (!client) return 0
  const newBalance = Math.max(0, (Number(client.loyalty_points) || 0) + d)
  db.prepare("UPDATE clients SET loyalty_points=?, updated_at=datetime('now') WHERE id=?")
    .run(newBalance, client.id)
  const sid = crypto.randomUUID()
  db.prepare(`INSERT INTO loyalty_transactions
    (supabase_id,business_id,client_id,client_supabase_id,event_type,points,balance_after,notes)
    VALUES(@supabase_id,@business_id,@client_id,@client_supabase_id,'adjust',@points,@balance_after,@notes)`).run({
    supabase_id: sid,
    business_id: client.business_id || null,
    client_id: client.id,
    client_supabase_id: client.supabase_id,
    points: d,
    balance_after: newBalance,
    notes: notes || null,
  })
  // Positive delta counts toward lifetime; negative only affects balance.
  _loyaltyRecomputeLifetime(client.id)
  return newBalance
}

function loyaltyHistory({ clientId, clientSupabaseId, limit = 100 } = {}) {
  if (!db) return []
  const lim = Math.max(1, Math.min(500, Number(limit) || 100))
  if (clientSupabaseId) {
    return db.prepare(`SELECT * FROM loyalty_transactions WHERE client_supabase_id=? ORDER BY created_at DESC LIMIT ?`).all(clientSupabaseId, lim)
  }
  if (clientId) {
    return db.prepare(`SELECT * FROM loyalty_transactions WHERE client_id=? ORDER BY created_at DESC LIMIT ?`).all(clientId, lim)
  }
  return []
}
function clientUpdateBalance(id, delta) {
  if (!db) return
  db.prepare('UPDATE clients SET balance=balance+@delta WHERE id=@id').run({ id, delta })
}

// Reverse a credit ticket's effect on clients.balance. Used by any path that
// removes / voids / cancels a ticket (ticketVoid, queueDelete, tickets:void web).
// `ticket.total` is already NET (POS sends `netTotal = gross - descuento` to
// ticketCreate, so clients.balance was incremented by that net figure). Reverse
// by the same net — do NOT subtract descuento again. Clamped at 0 to guard
// against double-invocation.
// Leaves credit_payments rows in place as audit history.
function reverseClientBalanceForTicket(ticket) {
  if (!db || !ticket) return
  if (ticket.tipo_venta !== 'credito') return
  const cid = ticket.client_id || null
  if (!cid) return
  const delta = Number(ticket.total || 0)
  if (delta <= 0) return
  db.prepare('UPDATE clients SET balance=MAX(0,balance-?) WHERE id=?').run(delta, cid)
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
    // v2.10.3 — bump rev alongside status so Supabase trg_tickets_rev_guard accepts.
    const updTicket = db.prepare("UPDATE tickets SET status='cobrado', payment_method=?, rev=COALESCE(rev,0)+1 WHERE id=?")
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
function ticketsGetAll({ dateFrom, dateTo, status, limit = 5000 } = {}) {
  if (!db) return []
  // Bumped from 500 after the StarSISA migration landed 11.5 months of history
  // (7,557 tickets). Carwashes doing 500+/mo need to see the full month in one
  // view. 50k is the new hard cap — enough for any reasonable dateFrom/dateTo.
  const safeLimit = Math.min(limit || 5000, 50000)
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
  const rows = db.prepare(sql).all(...params)
  // v2.10.4 — surface payment_parts as a parsed array (or null) so Cuadre +
  // reports don't each have to JSON.parse a TEXT blob.
  for (const r of rows) {
    if (r.payment_parts) {
      try {
        r.payment_parts = typeof r.payment_parts === 'string' ? JSON.parse(r.payment_parts) : r.payment_parts
      } catch { r.payment_parts = null }
    } else {
      r.payment_parts = null
    }
  }
  return rows
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
    // v2.10.4 — payment_parts stored as JSON string locally, JSONB on cloud.
    // Readers always see an array or null.
    try {
      ticket.payment_parts = ticket.payment_parts
        ? (typeof ticket.payment_parts === 'string' ? JSON.parse(ticket.payment_parts) : ticket.payment_parts)
        : null
    } catch { ticket.payment_parts = null }
    // v2.1: read washer UUIDs from the new column, fall back to legacy on a
    // partially-migrated DB. Populate washer_ids (empleados.id array) for UI
    // back-compat AND washer_supabase_ids (UUID array).
    let empSids = []
    try {
      empSids = JSON.parse(ticket.washer_empleado_supabase_ids || ticket.washer_ids || '[]')
      if (!Array.isArray(empSids)) empSids = []
    } catch { empSids = [] }
    // Detect legacy INT-id arrays that slipped into the new column on a partial migration.
    const looksUuid = (v) => typeof v === 'string' && v.length >= 32 && v.includes('-')
    const onlyUuids = empSids.filter(looksUuid)
    ticket.washer_empleado_supabase_ids = onlyUuids
    if (onlyUuids.length) {
      const placeholders = onlyUuids.map(() => '?').join(',')
      const rows = db.prepare(`SELECT id, nombre, supabase_id FROM empleados WHERE supabase_id IN (${placeholders})`).all(...onlyUuids)
      ticket.washer_names = rows.map(r => r.nombre)
      ticket.washer_ids = rows.map(r => r.id) // legacy UI shape
    } else {
      ticket.washer_names = []
      ticket.washer_ids = []
    }
  }
  return ticket
}
function ticketCreate(data) {
  if (!db) return null

  // v2.1.7+ — self-heal: some upgraded installs are missing columns because
  // the gated migration block was skipped/aborted. Add them on every ticket
  // create (no-op if already present). The INSERT below references every
  // column in this list — if any is missing the INSERT throws "no such column"
  // with no clue. Self-heal = zero surprises on upgrade.
  const SELF_HEAL_TICKETS_COLS = [
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
    "ALTER TABLE queue ADD COLUMN empleado_supabase_id TEXT",
    "ALTER TABLE queue ADD COLUMN ticket_supabase_id TEXT",
    "ALTER TABLE queue ADD COLUMN supabase_id TEXT",
  ]
  for (const sql of SELF_HEAL_TICKETS_COLS) { try { db.exec(sql) } catch {} }

  // Resolve the ITBIS rate once per ticket creation — stored as a string
  // percentage in app_settings.itbis_pct (default '18'). Avoid hitting the
  // settings table inside the per-item loop below.
  const itbisPctRow = db.prepare('SELECT value FROM app_settings WHERE key=?').get('itbis_pct')
  const itbisPct = Number(itbisPctRow?.value)
  const itbisFactor = (Number.isFinite(itbisPct) && itbisPct >= 0 ? itbisPct : 18) / 100

  // v2.3 — multi-POS gates. HWID is stamped by main.js onto app_settings so
  // database.js (no electron dep) can read it without reaching back up.
  const multiPos = multiPosEnabled()
  const bizId    = _bizId()
  const hwid     = (() => {
    try { return db.prepare("SELECT value FROM app_settings WHERE key='hwid'").get()?.value || null }
    catch { return null }
  })()

  const tx = db.transaction(() => {
    let docNumber  = null
    let usedLegacyCounter = 0

    // ── doc_number ────────────────────────────────────────────────────────
    if (multiPos && bizId && hwid) {
      const blk = docNumberBlockConsumeNext({ businessId: bizId, hwid, scope: 'ticket' })
      if (blk && Number.isFinite(blk.value)) {
        docNumber = `T-${String(blk.value).padStart(4, '0')}`
      }
    }
    if (!docNumber) {
      // Legacy fallback — MAX(doc_number)+1. Flag the ticket so forensic
      // can tell it was born outside the block system (offline-from-install
      // edge case).
      usedLegacyCounter = 1
      const last = db.prepare('SELECT doc_number FROM tickets ORDER BY id DESC LIMIT 1').get()
      let nextNum = 1
      if (last?.doc_number) {
        const m = last.doc_number.match(/T-(\d+)/)
        if (m) nextNum = parseInt(m[1], 10) + 1
      }
      docNumber = `T-${String(nextNum).padStart(4, '0')}`
    }

    // ── NCF / e-CF ────────────────────────────────────────────────────────
    const ncfType = data.comprobante_type || 'B02'
    let ncf = null
    let ncfFromBlock = false
    if (multiPos && bizId && hwid) {
      const blk = ncfBlockConsumeNext({ businessId: bizId, hwid, ncfType })
      if (blk?.ncf) {
        ncf = blk.ncf
        ncfFromBlock = true
      }
      // If the block system is ON but no block is available, fall through to
      // legacy. Caller UI (CobrarModal) is responsible for prompting a refill
      // when offline+exhausted; here we keep the ticket atomic.
    }
    if (!ncfFromBlock) {
      const ncfRow = db.prepare('SELECT * FROM ncf_sequences WHERE type=? AND active=1').get(ncfType)
      if (ncfRow) {
        const nextNCF = ncfRow.current_number + 1
        ncf = `${ncfRow.prefix}${String(nextNCF).padStart(8, '0')}`
        db.prepare('UPDATE ncf_sequences SET current_number=? WHERE type=?').run(nextNCF, ncfRow.type)
        if (multiPos) usedLegacyCounter = 1
      }
    }

    const ticketSid = crypto.randomUUID()
    const clientSid = data.client_id ? (db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(data.client_id)?.supabase_id || null) : null
    // v2.1: resolve seller to empleados.supabase_id. Accept either:
    //   - data.seller_empleado_supabase_id (preferred — already a UUID)
    //   - data.seller_id (legacy INT, resolved via empleados.id → supabase_id)
    let sellerEmpSid = data.seller_empleado_supabase_id || null
    if (!sellerEmpSid && data.seller_id) {
      const r = db.prepare(`SELECT supabase_id FROM empleados WHERE id=? AND tipo IN ('vendedor','hybrid') LIMIT 1`).get(data.seller_id)
      sellerEmpSid = r?.supabase_id || null
    }
    const cajeroSid = data.cajero_id ? (db.prepare('SELECT supabase_id FROM users WHERE id=?').get(data.cajero_id)?.supabase_id || null) : null
    // v2.1: washer UUIDs — prefer the new array, fall back to legacy INT resolution.
    let washerEmpSids = Array.isArray(data.washer_empleado_supabase_ids) ? data.washer_empleado_supabase_ids.filter(Boolean) : []
    if (!washerEmpSids.length && Array.isArray(data.washer_ids) && data.washer_ids.length) {
      const lookup = db.prepare(`SELECT supabase_id FROM empleados WHERE id=? AND tipo IN ('lavador','hybrid') LIMIT 1`)
      washerEmpSids = data.washer_ids.map(wid => lookup.get(wid)?.supabase_id).filter(Boolean)
    }
    const status = data.status || (data.payment_method === 'credit' ? 'pendiente' : 'cobrado')
    // v2.10.4 — split-bill parts persisted as JSON string on local SQLite
    // (JSONB on Supabase). NULL == single-method ticket; non-null == split.
    // See supabase/migrations/20260420100000_tickets_payment_parts.sql.
    let paymentPartsJson = null
    if (Array.isArray(data.payment_parts) && data.payment_parts.length) {
      try { paymentPartsJson = JSON.stringify(data.payment_parts) } catch { paymentPartsJson = null }
    }
    const splitBillFlag = (data.split === true || (Array.isArray(data.payment_parts) && data.payment_parts.length > 1)) ? 1 : 0

    const result = db.prepare(`INSERT INTO tickets
      (doc_number,client_id,washer_empleado_supabase_ids,seller_empleado_supabase_id,cajero_id,subtotal,descuento,itbis,ley,total,
       beverage_subtotal,payment_method,comprobante_type,ncf,ecf_result,tipo_venta,status,vehicle_plate,supabase_id,client_supabase_id,seller_supabase_id,cajero_supabase_id,
       mesa_id,mesa_supabase_id,fulfillment_type,tip_amount,mode,converted_from_mesa_id,converted_from_mesa_supabase_id,converted_from_ticket_id,converted_from_ticket_supabase_id,
       origin_hwid,used_legacy_counter,notes,order_source,payment_parts,split_bill,
       created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
      docNumber,
      data.client_id || null,
      JSON.stringify(washerEmpSids),
      sellerEmpSid,
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
      sellerEmpSid,
      cajeroSid,
      data.mesa_id || null,
      data.mesa_supabase_id || null,
      data.fulfillment_type || null,
      Number(data.tip_amount || 0),
      data.mode || null,
      data.converted_from_mesa_id || null,
      data.converted_from_mesa_supabase_id || null,
      data.converted_from_ticket_id || null,
      data.converted_from_ticket_supabase_id || null,
      hwid || null,
      usedLegacyCounter,
      data.comentario || data.notes || null,
      data.order_source || 'pos',
      paymentPartsJson,
      splitBillFlag,
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
    const insItem = db.prepare(`INSERT INTO ticket_items(ticket_id,service_id,name,price,cost,itbis,is_wash,quantity,sku,inventory_item_id,weight,unit,price_per_unit,is_deposit,supabase_id,ticket_supabase_id,service_supabase_id,inventory_item_supabase_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    for (const item of (data.items || [])) {
      const svcId = (item.service_id && validSvcIds.has(item.service_id)) ? item.service_id : null
      const qty = item.quantity || 1
      // Explicit item.cost wins (e.g. inventory products with dynamic cost);
      // otherwise look up the current service cost by id.
      const itemCost = item.cost != null ? Number(item.cost) : (svcId ? svcCostById.get(svcId) : 0)
      const itemSid = crypto.randomUUID()
      const aplica = item.aplica_itbis !== undefined ? item.aplica_itbis : (item.inventory_item_id ? (invItbisById.get(item.inventory_item_id) ?? 1) : 1)
      const itemItbis = aplica !== 0 ? parseFloat((item.price * itbisFactor).toFixed(2)) : 0
      const invItemSid = item.inventory_item_id ? (invSidById.get(item.inventory_item_id) || null) : null
      // v2.6 — persist deposit flag. Accepts either the canonical `is_deposit`
      // or the legacy runtime flag `bottle_deposit_line` (cart-side name).
      const isDeposit = (item.is_deposit === true || item.is_deposit === 1 ||
                         item.bottle_deposit_line === true) ? 1 : 0
      insItem.run(ticketId, svcId, item.name, item.price, itemCost,
        itemItbis, item.is_wash ?? 1,
        qty, item.sku || null, item.inventory_item_id || null,
        item.weight != null ? Number(item.weight) : null,
        item.unit || null,
        item.price_per_unit != null ? Number(item.price_per_unit) : null,
        isDeposit,
        itemSid, ticketSid, svcId ? svcSidById.get(svcId) : null, invItemSid)

      // Auto-deduct inventory stock (floor at 0 — never go negative).
      // RPT-H4: when requested > available, record a shortage row in
      // inventory_oversells so void-time reversal can restore only the
      // fulfilled amount (not the requested qty), preventing phantom stock.
      if (item.inventory_item_id) {
        const invRow = db.prepare('SELECT supabase_id, quantity, name FROM inventory_items WHERE id=?').get(item.inventory_item_id)
        const available = Math.max(0, Number(invRow?.quantity || 0))
        const fulfilled = Math.min(qty, available)
        db.prepare('UPDATE inventory_items SET quantity = MAX(0, quantity - ?) WHERE id = ?')
          .run(qty, item.inventory_item_id)
        if (qty > available) {
          const osSid = crypto.randomUUID()
          try {
            db.prepare(`INSERT INTO inventory_oversells
              (supabase_id, business_id, ticket_supabase_id, item_supabase_id, item_name, requested_qty, actual_qty)
              VALUES (?,?,?,?,?,?,?)`).run(
                osSid, _bizId(), ticketSid, invRow?.supabase_id || null,
                invRow?.name || item.name || null, qty, available)
          } catch (e) { /* non-fatal: shortage ledger is audit, never blocks sale */ }
        }
        const txSid = crypto.randomUUID()
        db.prepare('INSERT INTO inventory_transactions(item_id,type,delta,notes,user_id,supabase_id,item_supabase_id) VALUES(?,?,?,?,?,?,?)')
          .run(item.inventory_item_id, 'sale', -fulfilled, `Ticket #${ticketId}`, data.cajero_id || null,
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
    // role's commission toggle is on. Prices are ITBIS-inclusive, so divide by
    // (1 + itbisFactor) to strip tax before applying the commission percentage.
    //
    // Business rule: cashier earns on EVERY eligible item when NO seller is on
    // the ticket. When a seller IS on the ticket, cashier only earns on
    // products (is_wash=0, drinks/snacks). Services (is_wash=1) go to seller.
    const svcIsWashById = new Map(svcRows.map(r => [r.id, r.is_wash ?? 1]))
    const hasSeller = !!sellerEmpSid
    let washerBaseGross = 0, sellerBaseGross = 0, cashierBaseGross = 0
    for (const item of (data.items || [])) {
      const svcId = item.service_id && validSvcIds.has(item.service_id) ? item.service_id : null
      const qty = Math.max(1, parseInt(item.quantity || 1, 10))
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
    const gross2base  = 1 + itbisFactor
    const washerBase  = parseFloat((washerBaseGross  / gross2base).toFixed(2))
    const sellerBase  = parseFloat((sellerBaseGross  / gross2base).toFixed(2))
    const cashierBase = parseFloat((cashierBaseGross / gross2base).toFixed(2))

    if (washerBase > 0 && washerEmpSids.length) {
      // v2.1: walk the UUID array, JOIN empleados for commission_pct.
      for (const empSid of washerEmpSids) {
        const emp = db.prepare(`SELECT comision_pct FROM empleados WHERE supabase_id=? AND tipo IN ('lavador','hybrid') LIMIT 1`).get(empSid)
        const pct = Number(emp?.comision_pct || 0)
        if (!emp || pct <= 0) continue
        const commAmount = parseFloat((washerBase * pct / 100).toFixed(2))
        const wcSid = crypto.randomUUID()
        db.prepare(`INSERT INTO washer_commissions
          (empleado_supabase_id,ticket_id,base_amount,commission_pct,commission_amount,paid,supabase_id,ticket_supabase_id)
          VALUES(?,?,?,?,?,0,?,?)`).run(empSid, ticketId, washerBase, pct, commAmount, wcSid, ticketSid)
      }
    }

    if (sellerEmpSid && sellerBase > 0) {
      const emp = db.prepare(`SELECT comision_pct FROM empleados WHERE supabase_id=? AND tipo IN ('vendedor','hybrid') LIMIT 1`).get(sellerEmpSid)
      const pct = Number(emp?.comision_pct || 0)
      if (emp && pct > 0) {
        const commAmount = parseFloat((sellerBase * pct / 100).toFixed(2))
        const scSid = crypto.randomUUID()
        db.prepare(`INSERT INTO seller_commissions
          (empleado_supabase_id,ticket_id,base_amount,commission_pct,commission_amount,paid,supabase_id,ticket_supabase_id)
          VALUES(?,?,?,?,?,0,?,?)`).run(sellerEmpSid, ticketId, sellerBase, pct, commAmount, scSid, ticketSid)
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
    // v2.1: queue.empleado_supabase_id → empleados (tipo='lavador'/'hybrid').
    if (status === 'pendiente') {
      const firstEmpSid = washerEmpSids[0] || null
      const qSid = crypto.randomUUID()
      db.prepare(`INSERT INTO queue(ticket_id,status,empleado_supabase_id,supabase_id,ticket_supabase_id) VALUES(?,?,?,?,?)`)
        .run(ticketId, 'waiting', firstEmpSid, qSid, ticketSid)
    }

    // v2.3 — queue post-sync inventory deduct for oversell detection. The
    // optimistic local deduct already happened in the items loop above
    // (UPDATE inventory_items SET quantity = MAX(0, quantity - ?) ...);
    // sync.js reads pending_inventory_deducts and calls the authoritative
    // deduct_inventory_atomic RPC, logging any oversells server-detected.
    // Gated by multiPos so single-POS installs don't accumulate a queue
    // that nothing drains.
    if (multiPos) {
      const invItems = []
      for (const item of (data.items || [])) {
        if (!item.inventory_item_id) continue
        const sid = invSidById.get(item.inventory_item_id)
        if (!sid) continue
        invItems.push({
          item_supabase_id: sid,
          qty: Math.max(1, parseInt(item.quantity || 1, 10)),
          name: item.name || null,
        })
      }
      if (invItems.length) {
        const pdSid = crypto.randomUUID()
        db.prepare(`INSERT INTO pending_inventory_deducts
          (supabase_id, ticket_supabase_id, items_json) VALUES (?,?,?)`)
          .run(pdSid, ticketSid, JSON.stringify(invItems))
      }
    }

    return { ticketId, docNumber, ncf, supabase_id: ticketSid }
  })

  const res = tx()
  const desc = Number(data.descuento || 0)
  const subt = Number(data.subtotal || 0)
  const pct  = subt > 0 ? (desc / subt) * 100 : 0
  if (desc > 500 || pct > 15) {
    activityLogRecord({ event_type: 'discount_applied',
      severity: desc > 2000 || pct > 30 ? 'critical' : 'warn',
      actor_user_id: data.cajero_id || null,
      target_type: 'ticket', target_id: res.ticketId, target_name: res.docNumber || `#${res.ticketId}`,
      amount: desc,
      metadata: { subtotal: subt, total: data.total, pct: Math.round(pct * 10) / 10, payment_method: data.payment_method, reason: data.descuento_reason || null } })
  }
  return res
}
function ticketMarkPaid(id, { paymentMethod, ncf, ecfResult, cajeroId, tipoVenta, clientId, comentario, notes, descuento, descuento_reason } = {}) {
  if (!db) return null
  db.transaction(() => {
    const newStatus = tipoVenta === 'credito' ? 'pendiente' : 'cobrado'
    const noteVal = (comentario ?? notes ?? null) || null

    // v2.10.3 — bump rev alongside status so Supabase trg_tickets_rev_guard accepts.
    db.prepare(`UPDATE tickets SET status=?,
      payment_method=COALESCE(?,payment_method),
      ncf=COALESCE(?,ncf),
      ecf_result=COALESCE(?,ecf_result),
      cajero_id=COALESCE(?,cajero_id),
      notes=COALESCE(?,notes),
      descuento=COALESCE(?,descuento),
      rev=COALESCE(rev,0)+1
      WHERE id=?`).run(
      newStatus,
      paymentMethod || null, ncf || null,
      ecfResult ? JSON.stringify(ecfResult) : null,
      cajeroId || null,
      noteVal,
      (descuento != null ? Number(descuento) : null),
      id)

    if (tipoVenta === 'credito' && clientId) {
      // Fetch original tipo_venta to avoid double-counting if ticket was already posted as credit
      const row = db.prepare('SELECT total, descuento, tipo_venta FROM tickets WHERE id=?').get(id)
      if (row && row.tipo_venta !== 'credito') {
        // Use NET amount (total - descuento) so descuento applied in CobrarModal
        // is honored on the client's balance. The gross total stays on the ticket.
        const netOwed = Number(row.total || 0) - Number(row.descuento || 0)
        const amount = Math.max(0, netOwed)
        db.prepare('UPDATE tickets SET tipo_venta=?,client_id=? WHERE id=?')
          .run('credito', clientId, id)
        db.prepare('UPDATE clients SET balance=balance+?,visits=visits+1,total_spent=total_spent+? WHERE id=?')
          .run(amount, amount, clientId)
      }
    }
  })()
  // v2.3.20 — discount_applied audit event on the queue→cobrar path. Previously
  // only fired in ticketCreate, which is the direct-cobro path; queued tickets
  // cobraron via markPaid bypassed audit. Mirror the same threshold logic.
  const desc = Number(descuento || 0)
  if (desc > 0) {
    const row = db.prepare('SELECT doc_number, subtotal, total, payment_method FROM tickets WHERE id=?').get(id)
    const subt = Number(row?.subtotal || 0)
    const pct  = subt > 0 ? (desc / subt) * 100 : 0
    if (desc > 500 || pct > 15) {
      activityLogRecord({ event_type: 'discount_applied',
        severity: desc > 2000 || pct > 30 ? 'critical' : 'warn',
        actor_user_id: cajeroId || null,
        target_type: 'ticket', target_id: id, target_name: row?.doc_number || `#${id}`,
        amount: desc,
        metadata: { subtotal: subt, total: row?.total, pct: Math.round(pct * 10) / 10, payment_method: row?.payment_method, source: 'markPaid', reason: descuento_reason || null } })
    }
  }
  return { id }
}
function ticketVoid(id, reason, voidById) {
  if (!db) return
  let voidedTicket = null
  db.transaction(() => {
    const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(id)
    if (!ticket) return
    voidedTicket = ticket
    // v2.10.3 — bump rev alongside status so Supabase trg_tickets_rev_guard accepts.
    db.prepare(`UPDATE tickets SET status='nula',void_reason=?,void_by=?,void_at=datetime('now'),rev=COALESCE(rev,0)+1 WHERE id=?`)
      .run(reason, voidById || null, id)
    // Reverse client balance if it was a credit ticket (clamped at 0, net of descuento)
    reverseClientBalanceForTicket(ticket)
    // Reverse commissions — any washer/seller/cajero commission rows tied to
    // this ticket are now unearned, delete them so liquidación stays honest.
    db.prepare('DELETE FROM washer_commissions WHERE ticket_id=? OR (ticket_supabase_id IS NOT NULL AND ticket_supabase_id=?)').run(id, ticket.supabase_id || null)
    db.prepare('DELETE FROM seller_commissions WHERE ticket_id=? OR (ticket_supabase_id IS NOT NULL AND ticket_supabase_id=?)').run(id, ticket.supabase_id || null)
    db.prepare('DELETE FROM cajero_commissions WHERE ticket_id=? OR (ticket_supabase_id IS NOT NULL AND ticket_supabase_id=?)').run(id, ticket.supabase_id || null)
    // Reverse inventory stock for product items.
    // RPT-H4: if a shortage was recorded at sale-time (requested > available),
    // restore ONLY the fulfilled amount (actual_qty) — what was actually
    // deducted — not the requested qty. Otherwise voids can create phantom
    // stock (sold 3 of stock=1 → deducted 1 → voiding qty=3 would leave 3).
    const items = db.prepare('SELECT * FROM ticket_items WHERE ticket_id=? AND inventory_item_id IS NOT NULL').all(id)
    for (const item of items) {
      const qty = item.quantity || 1
      const invRow = db.prepare('SELECT supabase_id FROM inventory_items WHERE id=?').get(item.inventory_item_id)
      // Sum fulfilled across any shortage rows for (ticket, item). If none,
      // fulfilled == qty (full deduction occurred at sale time).
      let fulfilled = qty
      if (ticket.supabase_id && invRow?.supabase_id) {
        const sh = db.prepare(`SELECT COALESCE(SUM(actual_qty),0) AS actual, COALESCE(SUM(requested_qty),0) AS req
          FROM inventory_oversells WHERE ticket_supabase_id=? AND item_supabase_id=?`)
          .get(ticket.supabase_id, invRow.supabase_id)
        if (sh && Number(sh.req) > 0) fulfilled = Number(sh.actual) || 0
      }
      db.prepare('UPDATE inventory_items SET quantity = quantity + ? WHERE id = ?').run(fulfilled, item.inventory_item_id)
      const vtSid = crypto.randomUUID()
      db.prepare('INSERT INTO inventory_transactions(item_id,type,delta,notes,user_id,supabase_id,item_supabase_id) VALUES(?,?,?,?,?,?,?)')
        .run(item.inventory_item_id, 'void_reversal', fulfilled, `Void ticket #${id}`, voidById || null,
             vtSid, invRow?.supabase_id || null)
      // RPT-H4: mark shortage rows as voided so the Quiebres tab shows the
      // original shortage as historical (stock was already restored to its
      // true pre-sale level; the ledger entry should reflect resolution).
      if (ticket.supabase_id && invRow?.supabase_id) {
        db.prepare(`UPDATE inventory_oversells
          SET resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              resolved_by = ?, resolution_type = 'voided',
              resolution_notes = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE ticket_supabase_id=? AND item_supabase_id=? AND resolved_at IS NULL`)
          .run(voidById || null, `Void ticket #${id}`, ticket.supabase_id, invRow.supabase_id)
      }
    }
  })()
  if (voidedTicket) {
    activityLogRecord({ event_type: 'ticket_voided', severity: 'critical',
      actor_user_id: voidById || null,
      target_type: 'ticket', target_id: id, target_name: voidedTicket.doc_number || `#${id}`,
      amount: voidedTicket.total, reason: reason || null,
      metadata: { payment_method: voidedTicket.payment_method, tipo_venta: voidedTicket.tipo_venta, ncf: voidedTicket.ncf } })
    // v2.13.0 — legacy-only NCF counter reclaim (e-CFs guarded inside helper).
    if (voidedTicket.ncf) {
      try { ncfSequenceDecrementIfLast(voidedTicket.ncf) } catch (e) {
        try { console.warn('[ticketVoid] ncf decrement skip:', e.message) } catch {}
      }
    }
    // v2.10.4 — auto-enqueue ANECF for voided e-CFs (audit E-C6).
    // Outside the transaction: never block the void on queue insertion.
    // Legacy B01/B02 NCFs are skipped inside anecfQueueEnqueue.
    anecfQueueEnqueue({ ncf: voidedTicket.ncf, ticketId: id, ticketSupabaseId: voidedTicket.supabase_id })
  }
}
function ticketGetByDateRange(dateFrom, dateTo) {
  return ticketsGetAll({ dateFrom, dateTo })
}

// ── PRICE CHANGES (queued ticket item price modification) ────────────────────
function ticketItemUpdatePrice({ ticketItemId, newPrice, reason, adminPin }) {
  if (!db) return { ok: false, error: 'DB not ready' }

  // 1. Verify admin PIN — delegate to authByPin so the bcrypt/SHA-256 fallback
  //    + per-row lockout + opportunistic rehash all run uniformly. Inline
  //    SELECT on pin_hash alone would miss already-rehashed bcrypt rows.
  const admin = authByPin(String(adminPin).replace(/\D/g, ''))
  if (!admin || !['owner', 'manager'].includes(admin.role)) {
    return { ok: false, error: 'PIN invalido o no tiene permisos de administrador' }
  }

  // 2. Get current item + ticket
  const item = db.prepare('SELECT * FROM ticket_items WHERE id=?').get(ticketItemId)
  if (!item) return { ok: false, error: 'Item no encontrado' }

  const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(item.ticket_id)
  if (!ticket) return { ok: false, error: 'Ticket no encontrado' }
  if (ticket.status === 'cobrado') return { ok: false, error: 'No se puede modificar un ticket ya cobrado' }

  const oldPrice = item.price

  // Pull the per-business ITBIS rate once before the transaction. Prices in the
  // DB are ITBIS-inclusive, so the effective extraction factor is pct/(1+pct).
  const itbisPctRow = db.prepare('SELECT value FROM app_settings WHERE key=?').get('itbis_pct')
  const itbisPct = Number(itbisPctRow?.value)
  const itbisFrac = (Number.isFinite(itbisPct) && itbisPct >= 0 ? itbisPct : 18) / 100
  const extractFactor = itbisFrac / (1 + itbisFrac)

  // 3. Update item price + recalculate ticket totals
  db.transaction(() => {
    const newItbis = item.aplica_itbis !== 0 ? newPrice * extractFactor : 0
    db.prepare('UPDATE ticket_items SET price=?, itbis=? WHERE id=?').run(newPrice, newItbis, ticketItemId)

    // Recalculate ticket totals from all items
    const items = db.prepare('SELECT id, price, is_wash, aplica_itbis FROM ticket_items WHERE ticket_id=?').all(item.ticket_id)
    // Replace old price with new for the changed item
    const allPrices = items.map(i => i.id === ticketItemId ? newPrice : i.price)
    const total = allPrices.reduce((s, p) => s + p, 0)
    const itbisItems = items.filter(i => i.aplica_itbis !== 0)
    const itbisTotal = itbisItems.reduce((s, i) => s + (i.id === ticketItemId ? newPrice : i.price), 0)
    const itbis = parseFloat((itbisTotal * extractFactor).toFixed(2))
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

// ── QUEUE (v2.1 — empleado_supabase_id → empleados) ──────────────────────────
function queueGetActive() {
  if (!db) return []
  try {
    return db.prepare(
      `SELECT q.*, t.doc_number, t.total, t.vehicle_plate, t.created_at as ticket_created,
              c.name as client_name, c.phone as client_phone,
              GROUP_CONCAT(ti.name, ' + ') as services,
              e.nombre as washer_name
       FROM queue q
       JOIN tickets t ON (t.id = q.ticket_id OR t.supabase_id = q.ticket_supabase_id)
       LEFT JOIN clients c ON (c.id = t.client_id OR c.supabase_id = t.client_supabase_id)
       LEFT JOIN ticket_items ti ON ti.ticket_id = t.id
       LEFT JOIN empleados e ON e.supabase_id = q.empleado_supabase_id
       WHERE q.status NOT IN ('done', 'cancelled')
       GROUP BY q.id
       ORDER BY q.created_at ASC`
    ).all()
  } catch (e) { console.error('[queueGetActive]', e.message); return [] }
}
// v2.1: `washerId` parameter accepts either an empleados.id (INT) or a
// direct empleados.supabase_id. Resolves to UUID before the UPDATE.
function queueUpdateStatus(id, status, washerId = null) {
  if (!db) return
  const now = new Date().toISOString()
  let empSid = null
  if (washerId != null) {
    if (typeof washerId === 'string' && washerId.includes('-')) {
      empSid = washerId
    } else {
      const row = db.prepare(`SELECT supabase_id FROM empleados WHERE id=? AND tipo IN ('lavador','hybrid') LIMIT 1`).get(washerId)
      empSid = row?.supabase_id || null
    }
  }
  if (status === 'in_progress') {
    if (empSid) {
      db.prepare(`UPDATE queue SET status=?,empleado_supabase_id=?,assigned_at=? WHERE id=?`).run(status, empSid, now, id)
    } else {
      db.prepare(`UPDATE queue SET status=?,assigned_at=? WHERE id=?`).run(status, now, id)
    }
  } else if (status === 'ready') {
    if (empSid) {
      db.prepare(`UPDATE queue SET status=?,empleado_supabase_id=? WHERE id=?`).run(status, empSid, id)
    } else {
      db.prepare(`UPDATE queue SET status=? WHERE id=?`).run(status, id)
    }
  } else if (status === 'done') {
    db.prepare(`UPDATE queue SET status=?,completed_at=? WHERE id=?`).run(status, now, id)
  } else {
    db.prepare(`UPDATE queue SET status=? WHERE id=?`).run(status, id)
  }
}

function queueDelete(id, deletedBy) {
  if (!db) return null
  const row = db.prepare('SELECT q.*, t.doc_number, t.ncf as t_ncf, t.supabase_id as t_supabase_id FROM queue q LEFT JOIN tickets t ON t.id = q.ticket_id WHERE q.id=?').get(id)
  if (!row) return null
  const now = new Date().toISOString()
  db.transaction(() => {
    // Reverse any credit-ticket balance BEFORE we mark the ticket anulado.
    // Without this, deleted credit tickets leave a ghost debt on the client.
    if (row.ticket_id) {
      const ticket = db.prepare('SELECT id, client_id, tipo_venta, total, descuento FROM tickets WHERE id=?').get(row.ticket_id)
      reverseClientBalanceForTicket(ticket)
      // Also reverse any commissions tied to this ticket — they were written
      // at create time; if the ticket is cancelled, they're unearned.
      db.prepare('DELETE FROM washer_commissions WHERE ticket_id=? OR ticket_supabase_id IN (SELECT supabase_id FROM tickets WHERE id=?)').run(row.ticket_id, row.ticket_id)
      db.prepare('DELETE FROM seller_commissions WHERE ticket_id=? OR ticket_supabase_id IN (SELECT supabase_id FROM tickets WHERE id=?)').run(row.ticket_id, row.ticket_id)
      db.prepare('DELETE FROM cajero_commissions WHERE ticket_id=? OR ticket_supabase_id IN (SELECT supabase_id FROM tickets WHERE id=?)').run(row.ticket_id, row.ticket_id)
      // RPT-H4: reverse inventory stock for product items on cancelled pendiente
      // ticket (sale deducted stock; cancel never returned it before this).
      // Shortage-aware: restore fulfilled amount only, never phantom stock.
      const tRow = db.prepare('SELECT supabase_id FROM tickets WHERE id=?').get(row.ticket_id)
      const tSid = tRow?.supabase_id || null
      const titems = db.prepare('SELECT * FROM ticket_items WHERE ticket_id=? AND inventory_item_id IS NOT NULL').all(row.ticket_id)
      for (const it of titems) {
        const qty = it.quantity || 1
        const invRow = db.prepare('SELECT supabase_id FROM inventory_items WHERE id=?').get(it.inventory_item_id)
        let fulfilled = qty
        if (tSid && invRow?.supabase_id) {
          const sh = db.prepare(`SELECT COALESCE(SUM(actual_qty),0) AS actual, COALESCE(SUM(requested_qty),0) AS req
            FROM inventory_oversells WHERE ticket_supabase_id=? AND item_supabase_id=?`)
            .get(tSid, invRow.supabase_id)
          if (sh && Number(sh.req) > 0) fulfilled = Number(sh.actual) || 0
        }
        db.prepare('UPDATE inventory_items SET quantity = quantity + ? WHERE id = ?').run(fulfilled, it.inventory_item_id)
        const vtSid = crypto.randomUUID()
        db.prepare('INSERT INTO inventory_transactions(item_id,type,delta,notes,user_id,supabase_id,item_supabase_id) VALUES(?,?,?,?,?,?,?)')
          .run(it.inventory_item_id, 'void_reversal', fulfilled, `Queue cancel ticket #${row.ticket_id}`, deletedBy || null,
               vtSid, invRow?.supabase_id || null)
        // RPT-H4: mark shortage rows voided (see ticketVoid for rationale).
        if (tSid && invRow?.supabase_id) {
          db.prepare(`UPDATE inventory_oversells
            SET resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                resolved_by = ?, resolution_type = 'voided',
                resolution_notes = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE ticket_supabase_id=? AND item_supabase_id=? AND resolved_at IS NULL`)
            .run(deletedBy || null, `Queue cancel ticket #${row.ticket_id}`, tSid, invRow.supabase_id)
        }
      }
    }
    db.prepare(`UPDATE queue SET status='cancelled', completed_at=? WHERE id=?`).run(now, id)
    // v2.10.3 — bump rev alongside status so Supabase trg_tickets_rev_guard accepts.
    db.prepare(`UPDATE tickets SET status='anulado', rev=COALESCE(rev,0)+1 WHERE id=?`).run(row.ticket_id)
    db.prepare(`INSERT OR IGNORE INTO queue_deletions (queue_id, ticket_id, doc_number, deleted_by, deleted_at, reason, supabase_id, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, row.ticket_id, row.doc_number || '', deletedBy || 'unknown', now, 'manual', crypto.randomUUID(), now)
  })()
  // v2.10.4 — auto-enqueue ANECF for voided e-CFs (audit E-C6).
  // Outside the transaction — non-blocking. Dedup vs ticketVoid path is
  // enforced by the UNIQUE(ncf) constraint on anecf_queue.
  if (row.t_ncf) {
    // v2.13.0 — legacy-only NCF counter reclaim (guarded inside helper).
    try { ncfSequenceDecrementIfLast(row.t_ncf) } catch (e) {
      try { console.warn('[queueDelete] ncf decrement skip:', e.message) } catch {}
    }
    anecfQueueEnqueue({ ncf: row.t_ncf, ticketId: row.ticket_id, ticketSupabaseId: row.t_supabase_id })
  }
  return { id, ticketId: row.ticket_id }
}

// ── COMMISSIONS (v2.1 — JOIN empleados on empleado_supabase_id) ─────────────
// Param still named `washerId` for IPC signature stability — callers pass the
// empleados.id. The query joins `empleados` via empleado_supabase_id for a
// clean UUID FK, AND also accepts a legacy INT id via a fallback match on
// empleados.id so older UI code that still resolves INT ids keeps working.
function commissionsGetByWasher(washerId, dateFrom, dateTo) {
  if (!db) return []
  try {
    let empSid = null
    if (washerId) {
      if (typeof washerId === 'string' && washerId.includes('-')) {
        empSid = washerId
      } else {
        const row = db.prepare(`SELECT supabase_id FROM empleados WHERE id=? AND tipo IN ('lavador','hybrid') LIMIT 1`).get(washerId)
        empSid = row?.supabase_id || null
      }
    }
    if (!empSid) return []
    let sql = `SELECT wc.*, t.doc_number, COALESCE(t.created_at, wc.created_at) as ticket_date, t.vehicle_plate,
                      e.nombre as washer_name, e.comision_pct as commission_pct,
                      GROUP_CONCAT(ti.name, ' + ') as services
               FROM washer_commissions wc
               LEFT JOIN tickets t ON (t.id = wc.ticket_id OR t.supabase_id = wc.ticket_supabase_id)
               JOIN empleados e ON e.supabase_id = wc.empleado_supabase_id
               LEFT JOIN ticket_items ti ON ti.ticket_id = t.id AND ti.is_wash=1
               WHERE wc.empleado_supabase_id=? AND (t.id IS NULL OR t.status='cobrado')`
    const params = [empSid]
    if (dateFrom) { sql += ' AND COALESCE(t.created_at, wc.created_at) >= ?'; params.push(dateFrom) }
    if (dateTo)   { sql += ' AND COALESCE(t.created_at, wc.created_at) <= ?'; params.push(dateTo)   }
    sql += ' GROUP BY wc.id ORDER BY ticket_date DESC LIMIT 2000'
    return db.prepare(sql).all(...params)
  } catch (e) { console.error('[commissionsGetByWasher]', e.message); return [] }
}
function commissionsGetByPeriod(dateFrom, dateTo) {
  if (!db) return []
  try {
    // v2.13.9 — the old LEFT JOIN on tickets used `ON (t.id = wc.ticket_id OR
    // t.supabase_id = wc.ticket_supabase_id)`. When a StarSISA import (or any
    // scenario) produces more than one ticket matching both halves of the OR,
    // the LEFT JOIN fanout makes each commission row appear N times and
    // SUM(wc.commission_amount) returns N× the real value. Resolve the
    // ticket scalar-style instead: at most one ticket per commission, no
    // fanout regardless of how dirty the ticket table gets.
    return db.prepare(
      `SELECT wc.empleado_supabase_id, e.id as washer_id,
              e.nombre as washer_name, e.comision_pct as commission_pct,
              COUNT(wc.id) as ticket_count,
              SUM(wc.base_amount) as total_base,
              SUM(wc.commission_amount) as total_commission
       FROM washer_commissions wc
       JOIN empleados e ON e.supabase_id = wc.empleado_supabase_id
       WHERE COALESCE(wc.paid, 0) = 0
         AND COALESCE(
               (SELECT t.status FROM tickets t WHERE t.id = wc.ticket_id LIMIT 1),
               (SELECT t.status FROM tickets t WHERE t.supabase_id = wc.ticket_supabase_id LIMIT 1),
               'cobrado'
             ) = 'cobrado'
         AND COALESCE(
               (SELECT t.created_at FROM tickets t WHERE t.id = wc.ticket_id LIMIT 1),
               (SELECT t.created_at FROM tickets t WHERE t.supabase_id = wc.ticket_supabase_id LIMIT 1),
               wc.created_at
             ) BETWEEN ? AND ?
       GROUP BY wc.empleado_supabase_id ORDER BY total_commission DESC`
    ).all(dateFrom || '2000-01-01', dateTo || '2099-12-31')
  } catch (e) { console.error('[commissionsGetByPeriod]', e.message); return [] }
}
function commissionsMarkPaid(washerCommissionIds) {
  if (!db) return
  const stmt = db.prepare(`UPDATE washer_commissions SET paid=1,paid_at=datetime('now') WHERE id=?`)
  db.transaction(() => washerCommissionIds.forEach(id => stmt.run(id)))()
}
function commissionsMarkPaidByPeriod({ empleado_supabase_ids, from, to }) {
  if (!db || !empleado_supabase_ids?.length) return { updated: 0 }
  const placeholders = empleado_supabase_ids.map(() => '?').join(',')
  const res = db.prepare(
    `UPDATE washer_commissions SET paid=1, paid_at=datetime('now')
     WHERE COALESCE(paid,0)=0
       AND empleado_supabase_id IN (${placeholders})
       AND created_at BETWEEN ? AND ?`
  ).run(...empleado_supabase_ids, from, to + ' 23:59:59')
  return { updated: res.changes }
}

// ── SELLER COMMISSIONS (v2.1 — JOIN empleados on empleado_supabase_id) ──────
function sellerCommissionsBySeller(sellerId, dateFrom, dateTo) {
  if (!db) return []
  try {
  let empSid = null
  if (sellerId) {
    if (typeof sellerId === 'string' && sellerId.includes('-')) {
      empSid = sellerId
    } else {
      const row = db.prepare(`SELECT supabase_id FROM empleados WHERE id=? AND tipo IN ('vendedor','hybrid') LIMIT 1`).get(sellerId)
      empSid = row?.supabase_id || null
    }
  }
  if (!empSid) return []
  let sql = `SELECT sc.*, t.doc_number, COALESCE(t.created_at, sc.created_at) as ticket_date, t.vehicle_plate,
                    e.nombre as seller_name, e.comision_pct as commission_pct,
                    GROUP_CONCAT(ti.name, ' + ') as services
             FROM seller_commissions sc
             LEFT JOIN tickets t ON (t.id = sc.ticket_id OR t.supabase_id = sc.ticket_supabase_id)
             JOIN empleados e ON e.supabase_id = sc.empleado_supabase_id
             LEFT JOIN ticket_items ti ON ti.ticket_id = t.id AND ti.is_wash=1
             WHERE sc.empleado_supabase_id=? AND (t.id IS NULL OR t.status='cobrado')`
  const params = [empSid]
  if (dateFrom) { sql += ' AND COALESCE(t.created_at, sc.created_at) >= ?'; params.push(dateFrom) }
  if (dateTo)   { sql += ' AND COALESCE(t.created_at, sc.created_at) <= ?'; params.push(dateTo)   }
  sql += ' GROUP BY sc.id ORDER BY ticket_date DESC LIMIT 2000'
  return db.prepare(sql).all(...params)
  } catch (e) { console.error('[sellerCommissionsBySeller]', e.message); return [] }
}
function sellerCommissionsByPeriod(dateFrom, dateTo) {
  if (!db) return []
  try {
    // v2.13.9 — see commissionsGetByPeriod for the OR-join fanout rationale.
    return db.prepare(
      `SELECT sc.empleado_supabase_id, e.id as seller_id,
              e.nombre as seller_name, e.comision_pct as commission_pct,
              COUNT(sc.id) as ticket_count,
              SUM(sc.base_amount) as total_base,
              SUM(sc.commission_amount) as total_commission
       FROM seller_commissions sc
       JOIN empleados e ON e.supabase_id = sc.empleado_supabase_id
       WHERE COALESCE(sc.paid, 0) = 0
         AND COALESCE(
               (SELECT t.status FROM tickets t WHERE t.id = sc.ticket_id LIMIT 1),
               (SELECT t.status FROM tickets t WHERE t.supabase_id = sc.ticket_supabase_id LIMIT 1),
               'cobrado'
             ) = 'cobrado'
         AND COALESCE(
               (SELECT t.created_at FROM tickets t WHERE t.id = sc.ticket_id LIMIT 1),
               (SELECT t.created_at FROM tickets t WHERE t.supabase_id = sc.ticket_supabase_id LIMIT 1),
               sc.created_at
             ) BETWEEN ? AND ?
       GROUP BY sc.empleado_supabase_id ORDER BY total_commission DESC`
    ).all(dateFrom || '2000-01-01', dateTo || '2099-12-31')
  } catch (e) { console.error('[sellerCommissionsByPeriod]', e.message); return [] }
}
function sellerCommissionsMarkPaid(ids) {
  if (!db) return
  const stmt = db.prepare(`UPDATE seller_commissions SET paid=1,paid_at=datetime('now') WHERE id=?`)
  db.transaction(() => ids.forEach(id => stmt.run(id)))()
}
function sellerCommissionsMarkPaidByPeriod({ empleado_supabase_ids, from, to }) {
  if (!db || !empleado_supabase_ids?.length) return { updated: 0 }
  const placeholders = empleado_supabase_ids.map(() => '?').join(',')
  const res = db.prepare(
    `UPDATE seller_commissions SET paid=1, paid_at=datetime('now')
     WHERE COALESCE(paid,0)=0
       AND empleado_supabase_id IN (${placeholders})
       AND created_at BETWEEN ? AND ?`
  ).run(...empleado_supabase_ids, from, to + ' 23:59:59')
  return { updated: res.changes }
}
// Standalone commission row insert — used by the invoicing flow where the
// flat `invoiceTotal * pct / 100` model replaces ticketCreate's per-item gating.
// v2.1: accepts `seller_id` (legacy INT — resolved to empleados.supabase_id)
// OR `empleado_supabase_id` (preferred) OR `seller_supabase_id` (back-compat alias).
// v2.14: ticket_id is now optional — manual entries from the Nómina UI pass
// `manual_reason` + `created_at` and no ticket FK.
// v2.14.1: rewritten with NAMED placeholders to remove any positional-binding
// ambiguity (desktop saw empleado_supabase_id land as NULL on v2.14.0).
function sellerCommissionCreate({ seller_id, empleado_supabase_id, seller_supabase_id, ticket_id, ticket_supabase_id, base_amount, commission_pct, commission_amount, created_at, manual_reason }) {
  if (!db) return null
  let empSid = empleado_supabase_id || seller_supabase_id || null
  if (!empSid && seller_id) {
    const row = db.prepare(`SELECT supabase_id FROM empleados WHERE id=? AND tipo IN ('vendedor','hybrid') LIMIT 1`).get(seller_id)
    empSid = row?.supabase_id || null
  }
  if (!empSid) return null
  if (!ticket_id && !manual_reason) return null
  const tSid = ticket_supabase_id || (ticket_id ? db.prepare('SELECT supabase_id FROM tickets WHERE id=?').get(ticket_id)?.supabase_id || null : null)
  const sid = crypto.randomUUID()
  const nowIso = new Date().toISOString()
  const payload = {
    empleado_supabase_id: empSid,
    ticket_id:            ticket_id || null,
    base_amount:          Number(base_amount || 0),
    commission_pct:       Number(commission_pct || 0),
    commission_amount:    Number(commission_amount || 0),
    supabase_id:          sid,
    ticket_supabase_id:   tSid,
    created_at:           created_at || nowIso,
    updated_at:           nowIso,
    manual_reason:        manual_reason || null,
  }
  const r = db.prepare(`INSERT INTO seller_commissions
    (empleado_supabase_id, ticket_id, base_amount, commission_pct, commission_amount, paid,
     supabase_id, ticket_supabase_id, created_at, updated_at, manual_reason)
    VALUES (@empleado_supabase_id, @ticket_id, @base_amount, @commission_pct, @commission_amount, 0,
            @supabase_id, @ticket_supabase_id, @created_at, @updated_at, @manual_reason)`).run(payload)
  if (manual_reason) {
    try {
      activityLogRecord({
        event_type: 'commission_manual_add',
        severity: 'info',
        target_type: 'seller_commissions',
        target_id: r.lastInsertRowid,
        target_name: empSid,
        amount: Number(commission_amount || 0),
        reason: manual_reason,
      })
    } catch {}
  }
  return { id: r.lastInsertRowid, supabase_id: sid }
}

// v2.14 — manual washer commission insert (mirrors seller; ticket refs nullable).
// v2.14.1: named placeholders — see sellerCommissionCreate note.
function washerCommissionCreate({ empleado_supabase_id, base_amount, commission_pct, commission_amount, created_at, manual_reason }) {
  if (!db) return null
  if (!empleado_supabase_id || !manual_reason) return null
  const sid = crypto.randomUUID()
  const nowIso = new Date().toISOString()
  const payload = {
    empleado_supabase_id,
    base_amount:       Number(base_amount || 0),
    commission_pct:    Number(commission_pct || 0),
    commission_amount: Number(commission_amount || 0),
    supabase_id:       sid,
    created_at:        created_at || nowIso,
    updated_at:        nowIso,
    manual_reason,
  }
  const r = db.prepare(`INSERT INTO washer_commissions
    (empleado_supabase_id, ticket_id, base_amount, commission_pct, commission_amount, paid,
     supabase_id, ticket_supabase_id, created_at, updated_at, manual_reason)
    VALUES (@empleado_supabase_id, NULL, @base_amount, @commission_pct, @commission_amount, 0,
            @supabase_id, NULL, @created_at, @updated_at, @manual_reason)`).run(payload)
  try {
    activityLogRecord({
      event_type: 'commission_manual_add',
      severity: 'info',
      target_type: 'washer_commissions',
      target_id: r.lastInsertRowid,
      target_name: empleado_supabase_id,
      amount: Number(commission_amount || 0),
      reason: manual_reason,
    })
  } catch {}
  return { id: r.lastInsertRowid, supabase_id: sid }
}


// ── CAJERO COMMISSIONS ───────────────────────────────────────────────────────
function cajeroCommissionsByCajero(cajeroId, dateFrom, dateTo) {
  if (!db) return []
  try {
    // Resolve to empleado_supabase_id so StarSISA rows (cajero_id NULL) still match
    let empSid = null
    if (cajeroId) {
      if (typeof cajeroId === 'string' && cajeroId.includes('-')) {
        empSid = cajeroId
      } else {
        const row = db.prepare(`SELECT supabase_id FROM empleados WHERE id=? AND tipo IN ('cajero','hybrid') LIMIT 1`).get(cajeroId)
        empSid = row?.supabase_id || null
      }
    }
    let sql = `SELECT cc.*, t.doc_number, COALESCE(t.created_at, cc.created_at) as ticket_date, t.vehicle_plate,
                      e.nombre as cajero_name, e.comision_pct as commission_pct,
                      GROUP_CONCAT(ti.name, ' + ') as services
               FROM cajero_commissions cc
               LEFT JOIN tickets t ON (t.id = cc.ticket_id OR t.supabase_id = cc.ticket_supabase_id)
               JOIN empleados e ON e.supabase_id = cc.empleado_supabase_id
               LEFT JOIN ticket_items ti ON ti.ticket_id = t.id AND ti.is_wash=0
               WHERE cc.empleado_supabase_id=? AND (t.id IS NULL OR t.status='cobrado')`
    const params = [empSid]
    if (dateFrom) { sql += ' AND COALESCE(t.created_at, cc.created_at) >= ?'; params.push(dateFrom) }
    if (dateTo)   { sql += ' AND COALESCE(t.created_at, cc.created_at) <= ?'; params.push(dateTo)   }
    sql += ' GROUP BY cc.id ORDER BY ticket_date DESC LIMIT 2000'
    return db.prepare(sql).all(...params)
  } catch (e) { console.error('[cajeroCommissionsByCajero]', e.message); return [] }
}
function cajeroCommissionsByPeriod(dateFrom, dateTo) {
  if (!db) return []
  try {
    // v2.13.9 — see commissionsGetByPeriod for the OR-join fanout rationale.
    return db.prepare(
      `SELECT cc.empleado_supabase_id, cc.cajero_id,
              e.id as cajero_emp_id, e.nombre as cajero_name, e.comision_pct as commission_pct,
              COUNT(cc.id) as ticket_count,
              SUM(cc.base_amount) as total_base,
              SUM(cc.commission_amount) as total_commission
       FROM cajero_commissions cc
       JOIN empleados e ON e.supabase_id = cc.empleado_supabase_id
       WHERE COALESCE(cc.paid, 0) = 0
         AND COALESCE(
               (SELECT t.status FROM tickets t WHERE t.id = cc.ticket_id LIMIT 1),
               (SELECT t.status FROM tickets t WHERE t.supabase_id = cc.ticket_supabase_id LIMIT 1),
               'cobrado'
             ) = 'cobrado'
         AND COALESCE(
               (SELECT t.created_at FROM tickets t WHERE t.id = cc.ticket_id LIMIT 1),
               (SELECT t.created_at FROM tickets t WHERE t.supabase_id = cc.ticket_supabase_id LIMIT 1),
               cc.created_at
             ) BETWEEN ? AND ?
       GROUP BY cc.empleado_supabase_id ORDER BY total_commission DESC`
    ).all(dateFrom || '2000-01-01', dateTo || '2099-12-31')
  } catch (e) { console.error('[cajeroCommissionsByPeriod]', e.message); return [] }
}
function cajeroCommissionsMarkPaid(ids) {
  if (!db) return
  const stmt = db.prepare(`UPDATE cajero_commissions SET paid=1,paid_at=datetime('now') WHERE id=?`)
  db.transaction(() => ids.forEach(id => stmt.run(id)))()
}
function cajeroCommissionsMarkPaidByPeriod({ empleado_supabase_ids, from, to }) {
  if (!db || !empleado_supabase_ids?.length) return { updated: 0 }
  const placeholders = empleado_supabase_ids.map(() => '?').join(',')
  const res = db.prepare(
    `UPDATE cajero_commissions SET paid=1, paid_at=datetime('now')
     WHERE COALESCE(paid,0)=0
       AND empleado_supabase_id IN (${placeholders})
       AND created_at BETWEEN ? AND ?`
  ).run(...empleado_supabase_ids, from, to + ' 23:59:59')
  return { updated: res.changes }
}
// v2.14 — supports both auto (cajero_id + ticket_id) and manual
// (empleado_supabase_id + manual_reason, no ticket) entries.
// v2.14.1: manual branch rewritten with NAMED placeholders.
function cajeroCommissionCreate({ cajero_id, empleado_supabase_id, ticket_id, ticket_supabase_id, base_amount, commission_pct, commission_amount, created_at, manual_reason }) {
  if (!db) return null
  const isManual = !!manual_reason
  if (isManual) {
    if (!empleado_supabase_id) return null
    const sid = crypto.randomUUID()
    const nowIso = new Date().toISOString()
    const payload = {
      empleado_supabase_id,
      base_amount:       Number(base_amount || 0),
      commission_pct:    Number(commission_pct || 0),
      commission_amount: Number(commission_amount || 0),
      supabase_id:       sid,
      created_at:        created_at || nowIso,
      updated_at:        nowIso,
      manual_reason,
    }
    const r = db.prepare(`INSERT INTO cajero_commissions
      (empleado_supabase_id, ticket_id, base_amount, commission_pct, commission_amount, paid,
       supabase_id, ticket_supabase_id, created_at, updated_at, manual_reason)
      VALUES (@empleado_supabase_id, NULL, @base_amount, @commission_pct, @commission_amount, 0,
              @supabase_id, NULL, @created_at, @updated_at, @manual_reason)`).run(payload)
    try {
      activityLogRecord({
        event_type: 'commission_manual_add',
        severity: 'info',
        target_type: 'cajero_commissions',
        target_id: r.lastInsertRowid,
        target_name: empleado_supabase_id,
        amount: Number(commission_amount || 0),
        reason: manual_reason,
      })
    } catch {}
    return { id: r.lastInsertRowid, supabase_id: sid }
  }
  // Legacy ticket-bound path
  if (!cajero_id || !ticket_id) return null
  const cajero = db.prepare('SELECT supabase_id FROM users WHERE id=?').get(cajero_id)
  if (!cajero) return null
  const tSid = ticket_supabase_id || db.prepare('SELECT supabase_id FROM tickets WHERE id=?').get(ticket_id)?.supabase_id || null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO cajero_commissions
    (cajero_id,ticket_id,base_amount,commission_pct,commission_amount,paid,supabase_id,cajero_supabase_id,ticket_supabase_id)
    VALUES(?,?,?,?,?,0,?,?,?)`).run(
    cajero_id, ticket_id,
    Number(base_amount || 0), Number(commission_pct || 0), Number(commission_amount || 0),
    sid, cajero.supabase_id || null, tSid)
  return { id: r.lastInsertRowid, supabase_id: sid }
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
// v2.6.2 — Apertura de Turno
// Returns the currently-open shift row for `cajero_id` (today), or null.
// "Open" = status='abierto' AND date=today. Any older abierto row is treated
// as stale (POS screen auto-closes it client-side on next reconciliation).
function cuadreGetOpen({ user_id, cajero_id } = {}) {
  if (!db) return null
  const id = Number(cajero_id ?? user_id)
  if (!id) return null
  const today = new Date().toISOString().slice(0, 10)
  return db.prepare(
    `SELECT * FROM cuadre_caja
       WHERE cajero_id = ? AND date = ? AND status = 'abierto'
       ORDER BY id DESC LIMIT 1`
  ).get(id, today) || null
}

function cuadreOpenShift({ user_id, cajero_id, opening_cash, opened_at } = {}) {
  if (!db) return null
  const id = Number(cajero_id ?? user_id)
  if (!id) return null
  const fondo = Number(opening_cash || 0)
  const when = opened_at || new Date().toISOString()
  const today = when.slice(0, 10)
  // Idempotent: if a shift is already open today for this cashier, return it.
  const existing = cuadreGetOpen({ cajero_id: id })
  if (existing) return { id: existing.id, supabase_id: existing.supabase_id, existed: true }
  const sid = crypto.randomUUID()
  const cajeroSid = db.prepare('SELECT supabase_id FROM users WHERE id=?').get(id)?.supabase_id || null
  const r = db.prepare(`INSERT INTO cuadre_caja
    (cajero_id, cajero_supabase_id, date, fondo, opening_cash, opened_at, status, supabase_id)
    VALUES(?,?,?,?,?,?, 'abierto', ?)`).run(id, cajeroSid, today, fondo, fondo, when, sid)
  try {
    activityLogRecord({
      event_type: 'shift_opened', severity: 'info',
      actor_user_id: id,
      target_type: 'cuadre_caja', target_id: r.lastInsertRowid,
      target_name: `Turno ${today}`,
      amount: fondo,
      reason: 'Apertura de turno',
      metadata: { opening_cash: fondo, opened_at: when },
    })
  } catch {}
  return { id: r.lastInsertRowid, supabase_id: sid, existed: false }
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
  // v2.10.4 — tickets with payment_parts (restaurant split bills) credit each
  // part to its own bucket instead of lumping the whole total under the single
  // ticket.payment_method. Per-row scan (not GROUP BY) so parts can split.
  // ES/EN method codes normalize through the same alias map web.js uses.
  const tickets = db.prepare(
    `SELECT total, payment_method, payment_parts FROM tickets
     WHERE status='cobrado' AND created_at BETWEEN ? AND ?`
  ).all(from, to)
  const PM_ALIAS = {
    cash: 'efectivo', efectivo: 'efectivo',
    card: 'tarjeta',  tarjeta: 'tarjeta',
    transfer: 'transferencia', transferencia: 'transferencia',
    check: 'cheque',  cheque: 'cheque',
    credit: 'credito', credito: 'credito',
  }
  const result = { efectivo:0, tarjeta:0, transferencia:0, cheque:0, credito:0 }
  let totalVendido = 0, totalCobrado = 0
  for (const t of tickets) {
    const tot = Number(t.total || 0)
    totalVendido += tot
    let parts = null
    if (t.payment_parts) {
      try {
        const parsed = typeof t.payment_parts === 'string' ? JSON.parse(t.payment_parts) : t.payment_parts
        if (Array.isArray(parsed) && parsed.length) parts = parsed
      } catch { parts = null }
    }
    if (parts) {
      for (const p of parts) {
        const pm = PM_ALIAS[p?.method] || p?.method || 'efectivo'
        const amt = Number(p?.amount || 0)
        if (!(pm in result)) result[pm] = 0
        result[pm] += amt
        if (pm !== 'credito') totalCobrado += amt
      }
    } else {
      const pm = PM_ALIAS[t.payment_method] || t.payment_method || 'efectivo'
      if (!(pm in result)) result[pm] = 0
      result[pm] += tot
      if (pm !== 'credito') totalCobrado += tot
    }
  }
  // v2.6 — Licoreria: segregate envase deposits for cuadre reconciliation.
  // `depositos_cobrados`  = sum of ticket_items.is_deposit=1 price*qty on
  //                         paid tickets in the window (revenue carried by
  //                         deposits, *already* included in totalVendido).
  // `depositos_devueltos` = sum of negative-total refund tickets tagged
  //                         `refund_type='deposit_return'` in metadata —
  //                         these are persisted as regular paid tickets
  //                         with negative totals so sync stays trivial.
  // `depositos_neto`      = cobrados − devueltos (= outstanding liability).
  let depositos_cobrados = 0, depositos_devueltos = 0
  try {
    const depRows = db.prepare(
      `SELECT COALESCE(SUM(ti.price * ti.quantity), 0) AS total
         FROM ticket_items ti
         JOIN tickets t ON t.id = ti.ticket_id
        WHERE ti.is_deposit = 1
          AND t.status = 'cobrado'
          AND t.total >= 0
          AND t.created_at BETWEEN ? AND ?`
    ).get(from, to)
    depositos_cobrados = Number(depRows?.total || 0)
    const refundRows = db.prepare(
      `SELECT COALESCE(SUM(ABS(total)), 0) AS total
         FROM tickets
        WHERE status = 'cobrado'
          AND total < 0
          AND payment_method IN ('efectivo','cash','credito','credit')
          AND COALESCE(notes,'') LIKE '%[deposit_return]%'
          AND created_at BETWEEN ? AND ?`
    ).get(from, to)
    depositos_devueltos = Number(refundRows?.total || 0)
  } catch {}
  return {
    ...result,
    totalVendido, totalCobrado, count: tickets.length,
    depositos_cobrados,
    depositos_devueltos,
    depositos_neto: depositos_cobrados - depositos_devueltos,
  }
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
    // v2.1: washers + sellers are empleados now. Export two projections
    //       so any consumer of exportToSupabase keeps the legacy shape.
    washers:         db.prepare(`SELECT id, supabase_id, nombre AS name, phone, cedula, comision_pct AS commission_pct, active, start_date, created_at, updated_at FROM empleados WHERE active=1 AND tipo IN ('lavador','hybrid')`).all(),
    sellers:         db.prepare(`SELECT id, supabase_id, nombre AS name, phone, cedula, comision_pct AS commission_pct, active, start_date, created_at, updated_at FROM empleados WHERE active=1 AND tipo IN ('vendedor','hybrid')`).all(),
    empleados:       db.prepare('SELECT * FROM empleados WHERE active=1').all(),
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
  const row = db.prepare('SELECT supabase_id, business_id FROM compras_607 WHERE id=?').get(id)
  const res = db.prepare('DELETE FROM compras_607 WHERE id=?').run(id)
  if (row?.supabase_id) tombstoneAdd('compras_607', row.supabase_id, row.business_id)
  return res
}

// ── DGII data ─────────────────────────────────────────────────────────────────
function get606Data(dateFrom, dateTo) {
  if (!db) return []
  // Exclude anulado/nula so voided tickets don't over-report to DGII.
  return db.prepare(
    `SELECT t.id, t.ncf, t.comprobante_type as tipo, t.created_at as fecha,
            t.subtotal, t.itbis, t.ley, t.total, t.status as estado,
            c.name as client_name, c.rnc as client_rnc
     FROM tickets t
     LEFT JOIN clients c ON c.id=t.client_id
     WHERE t.created_at BETWEEN ? AND ?
       AND t.status NOT IN ('anulado','nula')
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
  const r = db.prepare(`INSERT INTO inventory_items(sku,name,category,quantity,min_quantity,price,price_pedidos_ya,cost,barcode,aplica_itbis,sold_by_weight,unit,price_per_unit,bottle_deposit,tare_default,supabase_id)
    VALUES(@sku,@name,@category,@quantity,@min_quantity,@price,@price_pedidos_ya,@cost,@barcode,@aplica_itbis,@sold_by_weight,@unit,@price_per_unit,@bottle_deposit,@tare_default,@supabase_id)`).run({
    sku: data.sku || null, name: data.name, category: data.category || '',
    quantity: data.quantity || 0, min_quantity: data.min_quantity ?? 5,
    price: data.price || 0,
    price_pedidos_ya: data.price_pedidos_ya != null && data.price_pedidos_ya !== '' ? Number(data.price_pedidos_ya) : null,
    cost: data.cost || 0,
    barcode: data.barcode || null, aplica_itbis: data.aplica_itbis ?? 1,
    sold_by_weight: data.sold_by_weight ? 1 : 0,
    unit: data.unit || null,
    price_per_unit: data.price_per_unit != null ? Number(data.price_per_unit) : null,
    bottle_deposit: data.bottle_deposit != null ? Number(data.bottle_deposit) : null,
    tare_default: data.tare_default != null ? Number(data.tare_default) : null,
    supabase_id: sid,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function inventoryUpdate(id, data) {
  if (!db) return
  // Build a dynamic SET clause so bulk-edit patches (e.g. { category } or
  // { price_pedidos_ya }) only touch the fields provided and never blank out
  // the rest of the row.
  const ALLOWED = ['sku','name','category','min_quantity','price','price_pedidos_ya','cost','barcode','aplica_itbis','sold_by_weight','unit','price_per_unit','bottle_deposit','tare_default','quantity']
  const sets = []
  const params = { id }
  for (const k of ALLOWED) {
    if (!(k in data)) continue
    let v = data[k]
    if (k === 'sold_by_weight') v = v ? 1 : 0
    else if (k === 'aplica_itbis') v = v ?? 1
    else if (['price_pedidos_ya','price_per_unit','bottle_deposit','tare_default'].includes(k)) {
      v = (v === '' || v == null) ? null : Number(v)
    } else if (['price','cost'].includes(k)) {
      v = v === '' || v == null ? 0 : Number(v)
    } else if (k === 'min_quantity') {
      v = v ?? 5
    } else if (k === 'quantity') {
      v = Number(v) || 0
    } else if (['sku','barcode','unit'].includes(k)) {
      v = v || null
    } else if (k === 'category') {
      v = v || ''
    }
    sets.push(`${k}=@${k}`)
    params[k] = v
  }
  if (!sets.length) return
  sets.push(`updated_at=datetime('now')`)
  db.prepare(`UPDATE inventory_items SET ${sets.join(', ')} WHERE id=@id`).run(params)
}
function inventoryBulkUpdate(ids, patch) {
  if (!db || !Array.isArray(ids) || !ids.length) return 0
  const run = db.transaction(() => {
    for (const id of ids) inventoryUpdate(id, patch)
  })
  run()
  return ids.length
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

function ecfQueueAdd(urlPath, bodyJson, token, { xmlSigned, encf, tipoEcf, environment, ticketSupabaseId } = {}) {
  if (!db) return
  // v2.10.5 — stamp supabase_id at creation so the row is syncable on the next
  // 5-min push. If `encf` is present, the UNIQUE(encf) partial index would
  // collide on a double-enqueue of the same e-CF; INSERT OR IGNORE preserves
  // the original row (its supabase_id is the canonical cloud identity).
  const supabaseId = crypto.randomUUID()
  db.prepare(`INSERT OR IGNORE INTO ecf_queue
    (url_path, body_json, token, xml_signed, encf, tipo_ecf, environment,
     supabase_id, ticket_supabase_id, status, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`)
    .run(
      urlPath || '',
      typeof bodyJson === 'string' ? bodyJson : JSON.stringify(bodyJson),
      token || '',
      xmlSigned || null,
      encf || null,
      tipoEcf || null,
      environment || 'certecf',
      supabaseId,
      ticketSupabaseId || null,
      'pending',
    )
}

// Only pending items within DGII's 72h contingency window.
// v2.10.5 — `status='pending'` filter ensures peer-device submissions (pulled
// in via cloud sync with status='submitted') never double-fire from this PC.
function ecfQueueGetPending(limit = 10) {
  if (!db) return []
  return db.prepare(
    `SELECT * FROM ecf_queue
      WHERE status='pending'
        AND attempts < 500
        AND created_at > datetime('now','-72 hours')
      ORDER BY id ASC LIMIT ?`
  ).all(limit)
}

// v2.10.5 — live row read used right before submission so processDgiiQueue()
// can detect a cloud-pull race (status flipped to 'submitted' by a peer).
function ecfQueueGetById(id) {
  if (!db) return null
  return db.prepare('SELECT * FROM ecf_queue WHERE id=?').get(id) || null
}

// v2.10.5 — soft-mark submitted instead of DELETE so the LWW transition
// propagates to peer devices on the next sync push. Rows remain queryable
// for audit / support debugging.
function ecfQueueMarkSubmitted(id, trackId) {
  if (!db) return
  db.prepare(`UPDATE ecf_queue
                 SET status='submitted',
                     track_id=COALESCE(?, track_id),
                     submitted_at=datetime('now'),
                     updated_at=datetime('now'),
                     last_error=NULL
               WHERE id=?`).run(trackId || null, id)
}

function ecfQueueMarkFailed(id, errorMsg) {
  if (!db) return
  db.prepare(`UPDATE ecf_queue
                 SET status='failed',
                     last_error=?,
                     updated_at=datetime('now')
               WHERE id=?`).run(String(errorMsg || '').slice(0, 500), id)
}

// Legacy DELETE path. Still used by the legacy ef2.do branch + pre-migration
// call sites that don't track encf. All new DGII-direct code flows through
// ecfQueueMarkSubmitted so the row survives for cloud propagation.
function ecfQueueDelete(id) {
  if (!db) return
  db.prepare('DELETE FROM ecf_queue WHERE id=?').run(id)
}

function ecfQueueIncrAttempts(id, errorMsg) {
  if (!db) return
  db.prepare(`UPDATE ecf_queue
                 SET attempts=attempts+1,
                     last_tried=datetime('now'),
                     updated_at=datetime('now'),
                     last_error=COALESCE(?, last_error)
               WHERE id=?`).run(errorMsg ? String(errorMsg).slice(0, 500) : null, id)
}

function ecfQueueCount() {
  if (!db) return 0
  return db.prepare(
    `SELECT COUNT(*) as c FROM ecf_queue
       WHERE status='pending' AND created_at > datetime('now','-72 hours')`
  ).get()?.c || 0
}

// ── ANECF auto-queue (v2.10.4) ───────────────────────────────────────────────
// Every e-CF void enqueues one row; electron/main.js processAnecfQueue()
// flushes pending rows to DGII. The NCF UNIQUE constraint guarantees a
// single void of any given e-CF even if ticketVoid + queueDelete both fire.

/** Is this NCF an e-CF (E31..E47) vs legacy paper (B01/B02)? */
function isECF(ncf) {
  if (!ncf || typeof ncf !== 'string') return false
  // E + 2-digit tipo + 10-digit sequence = 13 chars total, e.g. E310000000001
  return /^E\d{12}$/.test(ncf.trim())
}

/**
 * Enqueue an ANECF for a voided e-CF. Fire-and-forget — never throws into
 * the caller's transaction. Silently no-ops for legacy NCFs and duplicates.
 * Returns the row id on insert, null on skip/error.
 *
 * v2.13.0 — also emits a classified `ncf_auto_anecf` activity_log event so
 * the owner Actividad feed (DGII chip) shows every auto-anulación. Only on
 * an actual insert (not on duplicate/skip) to avoid noise on double-voids.
 */
function anecfQueueEnqueue({ ncf, ticketId, ticketSupabaseId, environment } = {}) {
  if (!db) return null
  if (!isECF(ncf)) return null
  try {
    const tipoEcf = ncf.substring(1, 3)           // '31','32','33','34',...
    const rango = ncf                              // single-NCF range: desde == hasta
    const env = environment || getSetting('dgii_environment') || 'certecf'
    const sid = crypto.randomUUID()
    const info = db.prepare(
      `INSERT OR IGNORE INTO anecf_queue
         (ticket_id, ticket_supabase_id, ncf, tipo_ecf, rango_desde, rango_hasta, environment, supabase_id)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(ticketId || null, ticketSupabaseId || null, ncf, tipoEcf, rango, rango, env, sid)
    if (info.changes > 0) {
      // Classified audit event — never block the void on log failure.
      try {
        activityLogRecord({
          event_type: 'ncf_auto_anecf',
          severity: 'warn',
          target_type: 'ticket',
          target_id: ticketId || null,
          target_name: ncf,
          metadata: { ncf, tipo_ecf: tipoEcf, environment: env, ticket_supabase_id: ticketSupabaseId || null }
        })
      } catch (e) { try { console.warn('[anecfQueueEnqueue] activity log skip:', e.message) } catch {} }
      return info.lastInsertRowid
    }
    return null
  } catch (e) {
    // Never block a void on queue insert failure — log and move on.
    try { console.error('[anecfQueueEnqueue]', e.message, { ncf }) } catch {}
    return null
  }
}

// ── NCF sequence decrement on last-issued void (v2.13.0) ─────────────────────
// LEGACY NCFs ONLY (B01/B02). When the voided ticket's NCF matches
// `prefix + current_number`, decrement so the next issue reuses the slot.
// e-CFs are NEVER decremented — once transmitted to DGII the number is
// "published" and must stay consumed; the ANECF queue handles the
// anulación. Non-last legacy voids create a gap that's harmless for paper
// NCFs (the auditor just sees the range with a voided doc in it).
//
// Returns: { decremented: boolean, prefix, number, reason }
function ncfSequenceDecrementIfLast(ncf) {
  if (!db || !ncf || typeof ncf !== 'string') return { decremented: false, reason: 'invalid-ncf' }
  // NCF format: prefix (B01/B02/E31/E32/...) + zero-padded sequence.
  // Legacy B*: 3-char prefix + 8 or 11 digits. e-CF: E + 2 + 10 digits.
  const m = ncf.trim().match(/^([A-Z]\d{2})(\d+)$/)
  if (!m) return { decremented: false, reason: 'bad-format' }
  const prefix = m[1]
  const num = parseInt(m[2], 10)
  if (!Number.isFinite(num) || num <= 0) return { decremented: false, reason: 'bad-number' }
  // Guard: never decrement an e-CF (E3x) — ANECF handles these.
  if (prefix.startsWith('E')) return { decremented: false, reason: 'ecf-no-decrement', prefix, number: num }
  // Find active sequence whose prefix matches. Don't assume `type`: join on prefix.
  const row = db.prepare('SELECT type, current_number FROM ncf_sequences WHERE prefix=? AND active=1').get(prefix)
  if (!row) return { decremented: false, reason: 'no-sequence' }
  if (Number(row.current_number) !== num) {
    // Not the last issue — gap remains; ANECF handles.
    return { decremented: false, reason: 'not-last', prefix, number: num, current: Number(row.current_number) }
  }
  db.prepare('UPDATE ncf_sequences SET current_number=? WHERE type=?').run(num - 1, row.type)
  return { decremented: true, prefix, number: num }
}

function anecfQueueGetPending(limit = 10) {
  if (!db) return []
  return db.prepare(
    `SELECT * FROM anecf_queue
       WHERE status='pending' AND attempts < 500
       ORDER BY voided_at ASC LIMIT ?`
  ).all(limit)
}

function anecfQueueMarkSubmitted(id, trackId) {
  if (!db) return
  db.prepare(
    `UPDATE anecf_queue
       SET status='submitted', track_id=?, submitted_at=datetime('now'),
           updated_at=datetime('now'), error=NULL
     WHERE id=?`
  ).run(trackId || null, id)
}

function anecfQueueMarkFailed(id, errMsg) {
  if (!db) return
  db.prepare(
    `UPDATE anecf_queue
       SET attempts = attempts + 1,
           last_tried = datetime('now'),
           updated_at = datetime('now'),
           error = ?,
           status = CASE WHEN attempts + 1 >= 500 THEN 'failed' ELSE 'pending' END
     WHERE id=?`
  ).run(String(errMsg || '').slice(0, 500), id)
}

function anecfQueueCount() {
  if (!db) return 0
  return db.prepare(`SELECT COUNT(*) as c FROM anecf_queue WHERE status='pending'`).get()?.c || 0
}

function anecfQueueList(limit = 100) {
  if (!db) return []
  return db.prepare(`SELECT * FROM anecf_queue ORDER BY voided_at DESC LIMIT ?`).all(limit)
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

// DGII audit D-H — clear ticket.ecf_indicator_diferido after DGII accept so a
// later manual resubmit of the same ticket builds XML without a stale
// IndicadorEnvioDiferido=1. Safe to call repeatedly (idempotent UPDATE).
function ecfClearDeferredForTicket(ticketId) {
  if (!db || ticketId == null) return 0
  try {
    const info = db.prepare(
      `UPDATE tickets
          SET ecf_indicator_diferido = 0,
              updated_at = datetime('now')
        WHERE id = ?
          AND ecf_indicator_diferido = 1`
    ).run(ticketId)
    return info.changes || 0
  } catch { return 0 }
}

// Returns ecf_queue rows stuck in 'submitted' with no DGII final verdict yet.
// Only rows older than staleMinutes (so we don't hammer DGII on freshly-submitted
// e-CFs that still have their in-line pollStatus running). Capped at `limit`.
function ecfQueueGetStaleSubmitted(limit = 20, staleMinutes = 5) {
  if (!db) return []
  const cutoff = `-${Math.max(1, Number(staleMinutes) || 5)} minutes`
  return db.prepare(
    `SELECT q.*
       FROM ecf_queue q
       LEFT JOIN ecf_submissions s ON s.track_id = q.track_id
      WHERE q.status = 'submitted'
        AND q.track_id IS NOT NULL
        AND q.updated_at < datetime('now', ?)
        AND (s.dgii_status IS NULL OR s.dgii_status = 3)
      ORDER BY q.updated_at ASC
      LIMIT ?`
  ).all(cutoff, limit)
}

function ecfQueueMarkDone(id) {
  if (!db) return
  db.prepare(
    `UPDATE ecf_queue
        SET status='done',
            updated_at=datetime('now'),
            last_error=NULL
      WHERE id=?`
  ).run(id)
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

// Injectable error sink — main.js wires this to writeErrorLog() at startup so
// silent activity_log failures surface in userData/error.log instead of only
// the console (which nobody reads in production Electron builds).
let _activityErrorSink = null
function setActivityErrorSink(fn) { _activityErrorSink = typeof fn === 'function' ? fn : null }

function activityLogSelfHeal() {
  if (!db) return
  // v2.2.1 — self-heal for installs that predate one of the columns or the
  // supabase_id unique index. ALTER adds are idempotent (SQLite throws
  // "duplicate column"), so swallow per-statement.
  const cols = [
    'supabase_id TEXT', 'event_type TEXT', 'severity TEXT',
    'actor_user_id INTEGER', 'actor_supabase_id TEXT',
    'actor_name TEXT', 'actor_role TEXT',
    'target_type TEXT', 'target_id TEXT', 'target_name TEXT',
    'amount REAL', 'old_value TEXT', 'new_value TEXT',
    'reason TEXT', 'metadata TEXT',
    'created_at TEXT', 'updated_at TEXT',
  ]
  for (const c of cols) {
    try { db.exec(`ALTER TABLE activity_log ADD COLUMN ${c}`) } catch {}
  }
  // Backfill any pre-existing rows missing supabase_id so push doesn't skip them.
  // NOTE: This is the ONLY sanctioned UPDATE on activity_log — a one-time
  // local-SQLite-only supabase_id backfill for legacy rows created before the
  // column existed. Server-side Supabase has a BEFORE UPDATE/DELETE trigger
  // (trg_activity_log_immutable) that raises feature_not_supported — that is
  // the authoritative block against tampering. Do NOT add any other UPDATE or
  // DELETE paths against activity_log in this file or anywhere else in the
  // app. Any correction must go through a DBA with the trigger disabled.
  try {
    const legacy = db.prepare(`SELECT id FROM activity_log WHERE supabase_id IS NULL OR supabase_id=''`).all()
    for (const row of legacy) {
      db.prepare('UPDATE activity_log SET supabase_id=? WHERE id=?').run(crypto.randomUUID(), row.id)
    }
  } catch {}
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_log_supabase_id ON activity_log(supabase_id)`) } catch {}
}

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
    // actor_user_id may be an int (desktop local users.id) or a UUID string
    // (web / supabase_id). Only query local `users` for numeric ids — passing a
    // UUID through `WHERE id=?` is harmless but wastes a prepare cycle.
    if (actor_user_id != null && Number.isFinite(Number(actor_user_id))) {
      try {
        const u = db.prepare('SELECT name, role, supabase_id FROM users WHERE id=?').get(Number(actor_user_id))
        if (u) {
          actor_supabase_id = u.supabase_id || null
          if (!actor_name) actor_name = u.name
          if (!actor_role) actor_role = u.role
        }
      } catch {}
    } else if (typeof actor_user_id === 'string' && actor_user_id.includes('-')) {
      // Treat as a supabase_id when it looks like a UUID.
      actor_supabase_id = actor_user_id
      try {
        const u = db.prepare('SELECT id, name, role FROM users WHERE supabase_id=?').get(actor_user_id)
        if (u) {
          actor_user_id = u.id
          if (!actor_name) actor_name = u.name
          if (!actor_role) actor_role = u.role
        } else {
          actor_user_id = null
        }
      } catch { actor_user_id = null }
    }
    // Resilience: background jobs / sync callbacks may fire without an actor.
    // Mark them as 'system' so the owner can visually distinguish them in the
    // feed from unauthenticated / unknown actions.
    if (!actor_name && !actor_role && !actor_supabase_id && !actor_user_id) {
      actor_name = 'system'
      actor_role = 'system'
    }
    const sid = crypto.randomUUID()
    const nowIso = new Date().toISOString()
    db.prepare(`INSERT INTO activity_log
      (supabase_id, event_type, severity, actor_user_id, actor_supabase_id, actor_name, actor_role,
       target_type, target_id, target_name, amount, old_value, new_value, reason, metadata,
       created_at, updated_at)
      VALUES (@supabase_id, @event_type, @severity, @actor_user_id, @actor_supabase_id, @actor_name, @actor_role,
              @target_type, @target_id, @target_name, @amount, @old_value, @new_value, @reason, @metadata,
              @created_at, @updated_at)`).run({
      supabase_id: sid,
      event_type:  evt.event_type,
      severity:    evt.severity || 'info',
      actor_user_id:     (actor_user_id != null && Number.isFinite(Number(actor_user_id))) ? Number(actor_user_id) : null,
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
      created_at:  nowIso,
      updated_at:  nowIso,
    })
    return sid
  } catch (e) {
    console.error('[activity_log] record failed:', e.message)
    if (_activityErrorSink) {
      try { _activityErrorSink('activity_log:record', e, evt) } catch {}
    }
  }
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

// ── ECF CERT HISTORY ─────────────────────────────────────────────────────────
// Append-only audit trail for DGII .p12 rotations. Synced push-only to
// Supabase.ecf_cert_history via sync.js. Never edit or delete rows — each
// install/renewal/replacement is a permanent historical record.
function ecfCertHistoryInsert(row) {
  if (!db || !row) return null
  try {
    const supabase_id = row.supabase_id || crypto.randomUUID()
    const nowIso = new Date().toISOString()
    db.prepare(`INSERT INTO ecf_cert_history
      (supabase_id, cert_serial, subject_cn, subject_rnc, issued_at, expires_at,
       installed_at, installed_by_user_id, installed_by_name, installed_from,
       rotation_reason, sha256_fingerprint, prev_serial, prev_expires_at,
       created_at, updated_at)
      VALUES (@supabase_id, @cert_serial, @subject_cn, @subject_rnc, @issued_at, @expires_at,
              @installed_at, @installed_by_user_id, @installed_by_name, @installed_from,
              @rotation_reason, @sha256_fingerprint, @prev_serial, @prev_expires_at,
              @created_at, @updated_at)`).run({
      supabase_id,
      cert_serial:          row.cert_serial || null,
      subject_cn:           row.subject_cn || null,
      subject_rnc:          row.subject_rnc || null,
      issued_at:            row.issued_at || null,
      expires_at:           row.expires_at || null,
      installed_at:         row.installed_at || nowIso,
      installed_by_user_id: row.installed_by_user_id || null,
      installed_by_name:    row.installed_by_name || null,
      installed_from:       row.installed_from || 'desktop',
      rotation_reason:      row.rotation_reason || 'initial',
      sha256_fingerprint:   row.sha256_fingerprint || null,
      prev_serial:          row.prev_serial || null,
      prev_expires_at:      row.prev_expires_at || null,
      created_at:           row.created_at || nowIso,
      updated_at:           row.updated_at || nowIso,
    })
    return supabase_id
  } catch (e) {
    console.error('[ecf_cert_history] insert failed:', e.message)
    return null
  }
}
function ecfCertHistoryList({ limit = 50 } = {}) {
  if (!db) return []
  return db.prepare(`SELECT * FROM ecf_cert_history ORDER BY installed_at DESC LIMIT ?`)
    .all(Math.min(Number(limit) || 50, 500))
}

// ── VEHICLES ─────────────────────────────────────────────────────────────────
function vehicleCreate({ vin, plate, make, model, year, color, mileage, odometer_km, client_id, notes }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const client = client_id ? db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(client_id) : null
  const r = db.prepare(`INSERT INTO vehicles(supabase_id, vin, plate, make, model, year, color, mileage, odometer_km, client_id, client_supabase_id, notes)
    VALUES(@supabase_id, @vin, @plate, @make, @model, @year, @color, @mileage, @odometer_km, @client_id, @client_supabase_id, @notes)`).run({
    supabase_id: sid, vin: vin || null, plate: plate || null, make: make || null, model: model || null,
    year: year != null ? Number(year) : null, color: color || null, mileage: mileage != null ? Number(mileage) : null,
    odometer_km: odometer_km != null ? Number(odometer_km) : (mileage != null ? Number(mileage) : null),
    client_id: client_id || null, client_supabase_id: client?.supabase_id || null, notes: notes || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function vehicleUpdate(id, data) {
  if (!db) return
  const allowed = ['vin','plate','make','model','year','color','mileage','odometer_km','last_service_km','last_service_at','next_service_km','next_service_at','client_id','client_supabase_id','notes','active']
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
  const allowed = ['vehicle_id','vehicle_supabase_id','client_id','client_supabase_id','technician_empleado_id','technician_empleado_supabase_id','bay_id','bay_supabase_id','status','estimated_total','actual_total','labor_total','parts_total','itbis','total','inspection_json','estimate_approved_at','customer_signature_url','customer_approval_token','expected_parts_arrival','odometer_in_km','odometer_out_km','promised_date','completed_date','notes']
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
  recalcWorkOrderTotals(work_order_id)
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
  const item = db.prepare('SELECT work_order_id FROM work_order_items WHERE id=?').get(id)
  if (item) recalcWorkOrderTotals(item.work_order_id)
  return db.prepare('SELECT * FROM work_order_items WHERE id=?').get(id)
}
function workOrderItemDelete(id) {
  if (!db) return
  const item = db.prepare('SELECT work_order_id, supabase_id, business_id FROM work_order_items WHERE id=?').get(id)
  db.prepare('DELETE FROM work_order_items WHERE id=?').run(id)
  if (item?.supabase_id) tombstoneAdd('work_order_items', item.supabase_id, item.business_id)
  if (item) recalcWorkOrderTotals(item.work_order_id)
}
function workOrderItemsByOrder(work_order_id) {
  if (!db) return []
  return db.prepare('SELECT * FROM work_order_items WHERE work_order_id=? ORDER BY id').all(work_order_id)
}

// ── Work Order advanced: totals split, inspection, approval, parts order ────
// ITBIS 18% DR on parts only; labor exempt.
function recalcWorkOrderTotals(work_order_id) {
  if (!db || !work_order_id) return
  const labor = db.prepare(`SELECT COALESCE(SUM(total),0) AS t FROM work_order_items WHERE work_order_id=? AND type IN ('labor','service')`).get(work_order_id).t || 0
  const parts = db.prepare(`SELECT COALESCE(SUM(total),0) AS t FROM work_order_items WHERE work_order_id=? AND type='part'`).get(work_order_id).t || 0
  const itbis = Math.round(parts * 0.18 * 100) / 100
  const total = Math.round((labor + parts + itbis) * 100) / 100
  db.prepare(`UPDATE work_orders SET labor_total=?, parts_total=?, itbis=?, total=?, estimated_total=?, updated_at=datetime('now') WHERE id=?`)
    .run(labor, parts, itbis, total, total, work_order_id)
}
function workOrderSaveInspection(work_order_id, inspection) {
  if (!db) return null
  const json = typeof inspection === 'string' ? inspection : JSON.stringify(inspection || {})
  db.prepare("UPDATE work_orders SET inspection_json=?, updated_at=datetime('now') WHERE id=?").run(json, work_order_id)
  return db.prepare('SELECT * FROM work_orders WHERE id=?').get(work_order_id)
}
function workOrderGenerateApprovalToken(work_order_id) {
  if (!db) return null
  const wo = db.prepare('SELECT supabase_id FROM work_orders WHERE id=?').get(work_order_id)
  if (!wo) return null
  const token = crypto.randomUUID().replace(/-/g,'') + crypto.randomUUID().replace(/-/g,'').slice(0,16)
  db.prepare("UPDATE work_orders SET customer_approval_token=?, updated_at=datetime('now') WHERE id=?").run(token, work_order_id)
  return { token, work_order_supabase_id: wo.supabase_id }
}
function workOrderApproveEstimate(work_order_id, { signature_url } = {}) {
  if (!db) return null
  db.prepare(`UPDATE work_orders SET status='aprobado', estimate_approved_at=datetime('now'),
    customer_signature_url=COALESCE(?, customer_signature_url), updated_at=datetime('now') WHERE id=?`)
    .run(signature_url || null, work_order_id)
  return db.prepare('SELECT * FROM work_orders WHERE id=?').get(work_order_id)
}
function workOrderSetPartsOrder(work_order_id, { expected_parts_arrival } = {}) {
  if (!db) return null
  db.prepare(`UPDATE work_orders SET status='awaiting_parts', expected_parts_arrival=?, updated_at=datetime('now') WHERE id=?`)
    .run(expected_parts_arrival || null, work_order_id)
  return db.prepare('SELECT * FROM work_orders WHERE id=?').get(work_order_id)
}
function workOrderClose(work_order_id, { odometer_out_km } = {}) {
  if (!db) return null
  const wo = db.prepare('SELECT vehicle_id FROM work_orders WHERE id=?').get(work_order_id)
  db.prepare(`UPDATE work_orders SET status='closed', completed_date=datetime('now'),
    odometer_out_km=COALESCE(?, odometer_out_km), updated_at=datetime('now') WHERE id=?`)
    .run(odometer_out_km != null ? Number(odometer_out_km) : null, work_order_id)
  if (wo?.vehicle_id && odometer_out_km != null) {
    const km = Number(odometer_out_km)
    const next = km + 5000
    const nextDate = new Date(Date.now() + 1000*60*60*24*180).toISOString()
    db.prepare(`UPDATE vehicles SET odometer_km=?, last_service_km=?, last_service_at=datetime('now'),
      next_service_km=?, next_service_at=?, updated_at=datetime('now') WHERE id=?`)
      .run(km, km, next, nextDate, wo.vehicle_id)
  }
  return db.prepare('SELECT * FROM work_orders WHERE id=?').get(work_order_id)
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
// Amortization — French (cuota fija) / flat (interés fijo sobre capital) / balloon (solo intereses + capital final).
function _computeSchedule({ principal, termMonths, rateMonthlyPct, method, startDate }) {
  const P = Number(principal) || 0
  const n = Number(termMonths) || 0
  const r = (Number(rateMonthlyPct) || 0) / 100
  if (P <= 0 || n <= 0) return []
  const rows = []
  const start = startDate ? new Date(startDate) : new Date()
  const dueOf = (i) => { const d = new Date(start); d.setMonth(d.getMonth() + i); return d.toISOString().slice(0, 10) }
  if (method === 'flat') {
    const principalEach = P / n
    const interestEach  = P * r
    for (let i = 1; i <= n; i++) rows.push({ installment_no: i, due_date: dueOf(i), principal_due: principalEach, interest_due: interestEach, total_due: principalEach + interestEach })
  } else if (method === 'balloon') {
    const interestEach = P * r
    for (let i = 1; i < n; i++) rows.push({ installment_no: i, due_date: dueOf(i), principal_due: 0, interest_due: interestEach, total_due: interestEach })
    rows.push({ installment_no: n, due_date: dueOf(n), principal_due: P, interest_due: interestEach, total_due: P + interestEach })
  } else {
    // French / cuota fija
    const M = r === 0 ? P / n : P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
    let balance = P
    for (let i = 1; i <= n; i++) {
      const interest = r === 0 ? 0 : balance * r
      const principalPortion = Math.min(balance, M - interest)
      balance = Math.max(0, balance - principalPortion)
      rows.push({ installment_no: i, due_date: dueOf(i), principal_due: principalPortion, interest_due: interest, total_due: principalPortion + interest })
    }
  }
  return rows.map(r => ({
    ...r,
    principal_due: Math.round(r.principal_due * 100) / 100,
    interest_due:  Math.round(r.interest_due  * 100) / 100,
    total_due:     Math.round(r.total_due     * 100) / 100,
  }))
}

function loanCreate({ client_id, principal, term_months, interest_rate, monthly_payment, disbursed_at, next_due_date, notes, method, mora_rate_daily }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const client = db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(client_id)
  const meth = (method || 'french')
  const schedule = _computeSchedule({ principal, termMonths: term_months, rateMonthlyPct: interest_rate, method: meth, startDate: disbursed_at })
  const mp = monthly_payment || (schedule[0]?.total_due) || 0
  const nextDue = next_due_date || schedule[0]?.due_date || null
  const r = db.prepare(`INSERT INTO loans(supabase_id, client_id, client_supabase_id, principal, term_months, interest_rate, monthly_payment, disbursed_at, next_due_date, method, mora_rate_daily, notes)
    VALUES(@sid, @client_id, @client_sid, @principal, @term_months, @interest_rate, @monthly_payment, @disbursed_at, @next_due_date, @method, @mora, @notes)`).run({
    sid, client_id, client_sid: client?.supabase_id || null,
    principal: Number(principal), term_months: Number(term_months), interest_rate: Number(interest_rate),
    monthly_payment: Number(mp), disbursed_at: disbursed_at || new Date().toISOString().slice(0, 10),
    next_due_date: nextDue, method: meth, mora: Number(mora_rate_daily ?? 0.005),
    notes: notes || null,
  })
  const loanId = r.lastInsertRowid
  // Persist schedule rows
  const ins = db.prepare(`INSERT INTO loan_schedule(supabase_id, loan_id, loan_supabase_id, installment_no, due_date, principal_due, interest_due, total_due)
    VALUES(@sid, @loan_id, @loan_sid, @n, @due, @p, @i, @t)`)
  const tx = db.transaction((rows) => { for (const row of rows) ins.run({ sid: crypto.randomUUID(), loan_id: loanId, loan_sid: sid, n: row.installment_no, due: row.due_date, p: row.principal_due, i: row.interest_due, t: row.total_due }) })
  tx(schedule)
  return { id: loanId, supabase_id: sid }
}
function loanUpdate(id, data) {
  if (!db) return
  const allowed = ['client_id','client_supabase_id','principal','term_months','interest_rate','monthly_payment','status','disbursed_at','next_due_date','total_paid','total_interest','method','mora_rate_daily','days_late','mora_amount','notes']
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
function _generatePawnTicketCode() {
  // P + YYMMDD + 4 random alphanum — collision probability negligible per day
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const d = new Date()
  const yymmdd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
  let tail = ''
  for (let i = 0; i < 4; i++) tail += ALPHA[Math.floor(Math.random() * ALPHA.length)]
  return `P${yymmdd}${tail}`
}
function pawnItemCreate({ client_id, loan_id, description, estimated_value, storage_location, redeem_deadline, notes }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const client = client_id ? db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(client_id) : null
  const loan = loan_id ? db.prepare('SELECT supabase_id FROM loans WHERE id=?').get(loan_id) : null
  // Generate unique ticket_code (retry on hash collision)
  let ticket_code = null
  for (let i = 0; i < 5; i++) {
    const cand = _generatePawnTicketCode()
    const clash = db.prepare('SELECT 1 FROM pawn_items WHERE ticket_code=?').get(cand)
    if (!clash) { ticket_code = cand; break }
  }
  const r = db.prepare(`INSERT INTO pawn_items(supabase_id, client_id, client_supabase_id, loan_id, loan_supabase_id, description, estimated_value, storage_location, redeem_deadline, ticket_code, notes)
    VALUES(@sid, @client_id, @client_sid, @loan_id, @loan_sid, @description, @estimated_value, @storage_location, @redeem_deadline, @ticket_code, @notes)`).run({
    sid, client_id: client_id || null, client_sid: client?.supabase_id || null,
    loan_id: loan_id || null, loan_sid: loan?.supabase_id || null,
    description, estimated_value: Number(estimated_value) || 0,
    storage_location: storage_location || null, redeem_deadline: redeem_deadline || null,
    ticket_code,
    notes: notes || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid, ticket_code }
}
function pawnItemUpdate(id, data) {
  if (!db) return
  const allowed = ['client_id','client_supabase_id','loan_id','loan_supabase_id','description','estimated_value','storage_location','status','redeem_deadline','redemption_date','ticket_code','notes']
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
function pawnItemRedeem(id) {
  if (!db) return
  db.prepare("UPDATE pawn_items SET status='redeemed', redemption_date=datetime('now'), updated_at=datetime('now') WHERE id=?").run(id)
  return db.prepare('SELECT * FROM pawn_items WHERE id=?').get(id)
}
function pawnItemGetByCode(code) {
  if (!db || !code) return null
  return db.prepare('SELECT pi.*, c.name AS client_name, c.phone AS client_phone FROM pawn_items pi LEFT JOIN clients c ON c.id = pi.client_id WHERE pi.ticket_code=?').get(code)
}

// ── LOAN SCHEDULE (amortization) ─────────────────────────────────────────────
function loanScheduleList({ loan_id }) {
  if (!db || !loan_id) return []
  return db.prepare('SELECT * FROM loan_schedule WHERE loan_id=? ORDER BY installment_no').all(loan_id)
}
function loanScheduleMarkPaid({ id, paid_amount }) {
  if (!db) return
  db.prepare("UPDATE loan_schedule SET paid_amount=?, paid_at=datetime('now'), status='paid', updated_at=datetime('now') WHERE id=?").run(Number(paid_amount) || 0, id)
  return db.prepare('SELECT * FROM loan_schedule WHERE id=?').get(id)
}

// ── COLLECTIONS (mora + CRM log) ─────────────────────────────────────────────
function _todayYmd() { return new Date().toISOString().slice(0, 10) }

/**
 * Compute mora for every active loan whose next_due_date has passed.
 * Safe to call every startup / every day — idempotent, writes days_late + mora_amount.
 */
function loansComputeMora() {
  if (!db) return []
  const today = _todayYmd()
  const loans = db.prepare("SELECT id, principal, total_paid, mora_rate_daily, next_due_date FROM loans WHERE status='active' AND next_due_date IS NOT NULL AND next_due_date < ?").all(today)
  const upd = db.prepare("UPDATE loans SET days_late=?, mora_amount=?, updated_at=datetime('now') WHERE id=?")
  const tx = db.transaction((rows) => {
    for (const l of rows) {
      const days = Math.max(0, Math.floor((new Date(today) - new Date(l.next_due_date)) / 86400000))
      const outstanding = Math.max(0, Number(l.principal || 0) - Number(l.total_paid || 0))
      const mora = Math.round(outstanding * Number(l.mora_rate_daily || 0) * days * 100) / 100
      upd.run(days, mora, l.id)
    }
  })
  tx(loans)
  return loans.map(l => l.id)
}

/**
 * List overdue loans (post mora computation) with client contact info.
 */
function loansOverdueList() {
  if (!db) return []
  const today = _todayYmd()
  return db.prepare(`SELECT l.*, c.name AS client_name, c.phone AS client_phone
    FROM loans l LEFT JOIN clients c ON c.id = l.client_id
    WHERE l.status='active' AND l.next_due_date IS NOT NULL AND l.next_due_date < ?
    ORDER BY l.next_due_date ASC`).all(today)
}

function collectionsLogCreate({ client_id, loan_id, channel, outcome, notes, next_contact_date, created_by_staff_id }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const client = client_id ? db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(client_id) : null
  const loan   = loan_id   ? db.prepare('SELECT supabase_id FROM loans WHERE id=?').get(loan_id)   : null
  const r = db.prepare(`INSERT INTO collections_log(supabase_id, client_id, client_supabase_id, loan_id, loan_supabase_id, channel, outcome, notes, next_contact_date, created_by_staff_id)
    VALUES(@sid, @client_id, @client_sid, @loan_id, @loan_sid, @channel, @outcome, @notes, @next, @staff)`).run({
    sid, client_id: client_id || null, client_sid: client?.supabase_id || null,
    loan_id: loan_id || null, loan_sid: loan?.supabase_id || null,
    channel, outcome: outcome || null, notes: notes || null,
    next: next_contact_date || null, staff: created_by_staff_id || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function collectionsLogList({ client_id, loan_id } = {}) {
  if (!db) return []
  let sql = `SELECT cl.*, c.name AS client_name FROM collections_log cl LEFT JOIN clients c ON c.id = cl.client_id WHERE 1=1`
  const params = []
  if (client_id) { sql += ' AND cl.client_id=?'; params.push(client_id) }
  if (loan_id)   { sql += ' AND cl.loan_id=?';   params.push(loan_id) }
  sql += ' ORDER BY cl.contacted_at DESC LIMIT 500'
  return db.prepare(sql).all(...params)
}

// ── MEMBERSHIPS (carwash monthly subscription per vehicle) ───────────────────
function _membershipResolveFK({ client_id, vehicle_id }) {
  const client  = client_id  ? db.prepare('SELECT supabase_id FROM clients  WHERE id=?').get(client_id)  : null
  const vehicle = vehicle_id ? db.prepare('SELECT supabase_id FROM vehicles WHERE id=?').get(vehicle_id) : null
  return { client_supabase_id: client?.supabase_id || null, vehicle_supabase_id: vehicle?.supabase_id || null }
}
function _membershipCurrentPeriod(start) {
  const d = start ? new Date(start) : new Date()
  const ps = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
  const pe = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
  return { period_start: ps, period_end: pe }
}
function membershipCreate({ client_id, vehicle_id, plan_name, plan_price, wash_quota_per_month, start_date, end_date, notes }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const fk  = _membershipResolveFK({ client_id, vehicle_id })
  const { period_start, period_end } = _membershipCurrentPeriod(start_date)
  const r = db.prepare(`INSERT INTO memberships
    (supabase_id, client_id, client_supabase_id, vehicle_id, vehicle_supabase_id,
     plan_name, plan_price, wash_quota_per_month, washes_used_this_period,
     period_start, period_end, start_date, end_date, status, notes)
    VALUES(@sid, @cid, @csid, @vid, @vsid, @name, @price, @quota, 0,
           @ps, @pe, @start, @end, 'active', @notes)`).run({
    sid, cid: client_id || null, csid: fk.client_supabase_id,
    vid: vehicle_id || null, vsid: fk.vehicle_supabase_id,
    name: plan_name, price: Number(plan_price) || 0,
    quota: Number(wash_quota_per_month) || 0,
    ps: period_start, pe: period_end,
    start: start_date || new Date().toISOString().slice(0, 10),
    end: end_date || null, notes: notes || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function membershipUpdate(id, data) {
  if (!db) return
  const allowed = ['plan_name','plan_price','wash_quota_per_month','washes_used_this_period',
                   'period_start','period_end','start_date','end_date','status','notes',
                   'client_id','client_supabase_id','vehicle_id','vehicle_supabase_id']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (data.client_id  && !data.client_supabase_id)  { const c = db.prepare('SELECT supabase_id FROM clients  WHERE id=?').get(data.client_id);  if (c) patch.client_supabase_id  = c.supabase_id }
  if (data.vehicle_id && !data.vehicle_supabase_id) { const v = db.prepare('SELECT supabase_id FROM vehicles WHERE id=?').get(data.vehicle_id); if (v) patch.vehicle_supabase_id = v.supabase_id }
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM memberships WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE memberships SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM memberships WHERE id=?').get(id)
}
function membershipList({ client_id, status } = {}) {
  if (!db) return []
  let sql = `SELECT m.*, c.name AS client_name, v.plate AS vehicle_plate, v.make AS vehicle_make, v.model AS vehicle_model
             FROM memberships m
             LEFT JOIN clients  c ON c.id = m.client_id
             LEFT JOIN vehicles v ON v.id = m.vehicle_id
             WHERE 1=1`
  const params = []
  if (client_id) { sql += ' AND m.client_id = ?'; params.push(client_id) }
  if (status)    { sql += ' AND m.status = ?';    params.push(status) }
  sql += ' ORDER BY m.created_at DESC'
  return db.prepare(sql).all(...params)
}
function membershipGetActiveForClient(client_id) {
  if (!db || !client_id) return []
  // Roll over period if current_period has ended (LWW-ish local rollover).
  const today = new Date().toISOString().slice(0, 10)
  const rows = db.prepare(`SELECT * FROM memberships
    WHERE client_id=? AND status='active'
      AND (end_date IS NULL OR end_date >= ?)
    ORDER BY created_at DESC`).all(client_id, today)
  for (const m of rows) {
    if (!m.period_end || m.period_end < today) {
      const { period_start, period_end } = _membershipCurrentPeriod(today)
      db.prepare(`UPDATE memberships SET period_start=?, period_end=?, washes_used_this_period=0, updated_at=datetime('now') WHERE id=?`)
        .run(period_start, period_end, m.id)
      m.period_start = period_start
      m.period_end   = period_end
      m.washes_used_this_period = 0
    }
  }
  return rows
}
function membershipConsumeWash(id) {
  if (!db || !id) return null
  const m = db.prepare('SELECT * FROM memberships WHERE id=?').get(id)
  if (!m) return null
  if (m.washes_used_this_period >= m.wash_quota_per_month) {
    return { ok: false, error: 'quota_exceeded', remaining: 0 }
  }
  db.prepare(`UPDATE memberships SET washes_used_this_period = washes_used_this_period + 1, updated_at=datetime('now') WHERE id=?`).run(id)
  return { ok: true, remaining: Math.max(0, m.wash_quota_per_month - m.washes_used_this_period - 1) }
}
function membershipDelete(id) {
  if (!db) return
  db.prepare("UPDATE memberships SET status='cancelled', updated_at=datetime('now') WHERE id=?").run(id)
}

// ── WASH COMBOS (punch-card, N-wash combo pre-sold) ──────────────────────────
function washComboCreate({ client_id, vehicle_id, combo_name, total_washes, purchase_price, expires_at, notes }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const fk  = _membershipResolveFK({ client_id, vehicle_id })
  const r = db.prepare(`INSERT INTO wash_combos
    (supabase_id, client_id, client_supabase_id, vehicle_id, vehicle_supabase_id,
     combo_name, total_washes, used_washes, purchase_price, expires_at, status, notes)
    VALUES(@sid, @cid, @csid, @vid, @vsid, @name, @total, 0, @price, @expires, 'active', @notes)`).run({
    sid, cid: client_id || null, csid: fk.client_supabase_id,
    vid: vehicle_id || null, vsid: fk.vehicle_supabase_id,
    name: combo_name, total: Number(total_washes) || 0,
    price: Number(purchase_price) || 0,
    expires: expires_at || null, notes: notes || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function washComboUpdate(id, data) {
  if (!db) return
  const allowed = ['combo_name','total_washes','used_washes','purchase_price','expires_at','status','notes']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM wash_combos WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE wash_combos SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM wash_combos WHERE id=?').get(id)
}
function washComboList({ client_id, status } = {}) {
  if (!db) return []
  let sql = `SELECT wc.*, c.name AS client_name, v.plate AS vehicle_plate
             FROM wash_combos wc
             LEFT JOIN clients  c ON c.id = wc.client_id
             LEFT JOIN vehicles v ON v.id = wc.vehicle_id
             WHERE 1=1`
  const params = []
  if (client_id) { sql += ' AND wc.client_id = ?'; params.push(client_id) }
  if (status)    { sql += ' AND wc.status = ?';    params.push(status) }
  sql += ' ORDER BY wc.purchased_at DESC'
  return db.prepare(sql).all(...params)
}
function washComboActiveForClient(client_id) {
  if (!db || !client_id) return []
  const today = new Date().toISOString().slice(0, 10)
  return db.prepare(`SELECT * FROM wash_combos
    WHERE client_id=? AND status='active'
      AND used_washes < total_washes
      AND (expires_at IS NULL OR expires_at >= ?)
    ORDER BY purchased_at ASC`).all(client_id, today)
}
function washComboConsume(id) {
  if (!db || !id) return null
  const c = db.prepare('SELECT * FROM wash_combos WHERE id=?').get(id)
  if (!c) return null
  if (c.used_washes >= c.total_washes) return { ok: false, error: 'combo_exhausted' }
  const newUsed = c.used_washes + 1
  const newStatus = newUsed >= c.total_washes ? 'exhausted' : 'active'
  db.prepare(`UPDATE wash_combos SET used_washes=?, status=?, updated_at=datetime('now') WHERE id=?`).run(newUsed, newStatus, id)
  return { ok: true, remaining: c.total_washes - newUsed }
}
function washComboDelete(id) {
  if (!db) return
  db.prepare("UPDATE wash_combos SET status='cancelled', updated_at=datetime('now') WHERE id=?").run(id)
}

// ── CARWASH METRICS (queue wait + top washers) ───────────────────────────────
function queueWaitMetrics() {
  if (!db) return { avgWaitMin: 0, longestWaitMin: 0, longestTicketNo: null, count: 0 }
  // Current waiting tickets
  const waiting = db.prepare(`
    SELECT q.created_at, t.doc_number
      FROM queue q
      LEFT JOIN tickets t ON t.id = q.ticket_id
     WHERE q.status = 'waiting'
  `).all()
  if (!waiting.length) return { avgWaitMin: 0, longestWaitMin: 0, longestTicketNo: null, count: 0 }
  const now = Date.now()
  let totalMs = 0
  let longest = { ms: 0, docNo: null }
  for (const w of waiting) {
    const ms = Math.max(0, now - new Date(w.created_at).getTime())
    totalMs += ms
    if (ms > longest.ms) longest = { ms, docNo: w.doc_number }
  }
  return {
    avgWaitMin:    Math.round((totalMs / waiting.length) / 60000),
    longestWaitMin: Math.round(longest.ms / 60000),
    longestTicketNo: longest.docNo,
    count: waiting.length,
  }
}
function topWashersThisMonth(limit = 3) {
  if (!db) return []
  const ps = new Date(); ps.setDate(1); ps.setHours(0,0,0,0)
  const from = ps.toISOString().slice(0, 19).replace('T', ' ')
  // Aggregate washer commissions by empleado this month + count distinct tickets
  const rows = db.prepare(`
    SELECT e.id, e.nombre AS name,
           COUNT(DISTINCT wc.ticket_id) AS ticket_count,
           COALESCE(SUM(wc.commission_amount), 0) AS total_commission
      FROM washer_commissions wc
      JOIN empleados e ON e.id = wc.empleado_id
     WHERE wc.created_at >= ?
     GROUP BY e.id, e.nombre
     ORDER BY ticket_count DESC, total_commission DESC
     LIMIT ?
  `).all(from, Number(limit) || 3)
  return rows
}

// ── TICKETS BY CLIENT (vehicle history — last N paid tickets) ────────────────
function ticketsByClient(client_id, limit = 10) {
  if (!db || !client_id) return []
  return db.prepare(`
    SELECT t.id, t.doc_number, t.total, t.status, t.created_at, t.vehicle_plate,
           e.nombre AS washer_name,
           (SELECT GROUP_CONCAT(ti.name, ' + ')
              FROM ticket_items ti WHERE ti.ticket_id = t.id) AS services
      FROM tickets t
      LEFT JOIN washer_commissions w ON w.ticket_id = t.id
      LEFT JOIN empleados e ON e.id = w.empleado_id
     WHERE t.client_id = ?
     GROUP BY t.id
     ORDER BY t.created_at DESC
     LIMIT ?
  `).all(client_id, Math.min(Number(limit) || 10, 50))
}

// ── SERVICE VERTICAL ─────────────────────────────────────────────────────────
// Recurring billing, prepaid packages, projects, per-client rates, hourly billing.

function _svcResolveClientSid(client_id) {
  if (!client_id) return null
  const r = db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(client_id)
  return r?.supabase_id || null
}
function _svcResolveServiceSid(service_id) {
  if (!service_id) return null
  const r = db.prepare('SELECT supabase_id FROM services WHERE id=?').get(service_id)
  return r?.supabase_id || null
}
function _svcAddDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + Number(days || 0))
  return d.toISOString().split('T')[0]
}

function subscriptionCreate({ client_id, service_id, plan_name, interval_days, amount, start_date, notes }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const csid = _svcResolveClientSid(client_id)
  const svsid = _svcResolveServiceSid(service_id)
  const start = start_date || new Date().toISOString().split('T')[0]
  const r = db.prepare(`INSERT INTO subscriptions
    (supabase_id, client_id, client_supabase_id, service_id, service_supabase_id,
     plan_name, interval_days, amount, start_date, next_billing_date, status, notes)
    VALUES(@sid,@cid,@csid,@svid,@svsid,@pn,@iv,@amt,@sd,@nd,'active',@notes)`).run({
    sid, cid: client_id || null, csid, svid: service_id || null, svsid,
    pn: plan_name || null, iv: Number(interval_days) || 30,
    amt: Number(amount) || 0, sd: start, nd: start, notes: notes || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function subscriptionUpdate(id, data) {
  if (!db) return null
  const allowed = ['plan_name','interval_days','amount','next_billing_date','status','notes']
  const patch = {}
  for (const k of allowed) if (k in data) patch[k] = data[k]
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM subscriptions WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(', ')
  db.prepare(`UPDATE subscriptions SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM subscriptions WHERE id=?').get(id)
}
function subscriptionList({ status, clientId, dueWithinDays } = {}) {
  if (!db) return []
  let sql = `SELECT s.*, c.name AS client_name, sv.name AS service_name
             FROM subscriptions s
             LEFT JOIN clients  c  ON c.id = s.client_id
             LEFT JOIN services sv ON sv.id = s.service_id
             WHERE 1=1`
  const p = {}
  if (status)   { sql += ' AND s.status=@status'; p.status = status }
  if (clientId) { sql += ' AND s.client_id=@cid'; p.cid = clientId }
  if (dueWithinDays != null) { sql += " AND s.next_billing_date <= date('now', '+' || @d || ' days')"; p.d = Number(dueWithinDays) || 0 }
  sql += ' ORDER BY s.next_billing_date ASC'
  return db.prepare(sql).all(p)
}
function subscriptionMarkBilled(id) {
  if (!db) return null
  const s = db.prepare('SELECT * FROM subscriptions WHERE id=?').get(id)
  if (!s) return null
  const nextDate = _svcAddDays(s.next_billing_date, s.interval_days)
  db.prepare(`UPDATE subscriptions SET last_billed_at=datetime('now'), next_billing_date=@nd, updated_at=datetime('now') WHERE id=@id`).run({ id, nd: nextDate })
  return db.prepare('SELECT * FROM subscriptions WHERE id=?').get(id)
}
function subscriptionDelete(id) {
  if (!db) return
  db.prepare("UPDATE subscriptions SET status='cancelled', updated_at=datetime('now') WHERE id=?").run(id)
}

function servicePackageCreate({ client_id, service_id, package_name, total_sessions, purchase_price, expires_at, notes }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const csid = _svcResolveClientSid(client_id)
  const svsid = _svcResolveServiceSid(service_id)
  const r = db.prepare(`INSERT INTO service_packages
    (supabase_id, client_id, client_supabase_id, service_id, service_supabase_id,
     package_name, total_sessions, used_sessions, purchase_price, expires_at, status, notes)
    VALUES(@sid,@cid,@csid,@svid,@svsid,@pn,@tot,0,@price,@exp,'active',@notes)`).run({
    sid, cid: client_id || null, csid, svid: service_id || null, svsid,
    pn: package_name, tot: Number(total_sessions) || 0,
    price: Number(purchase_price) || 0, exp: expires_at || null, notes: notes || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function servicePackageUpdate(id, data) {
  if (!db) return null
  const allowed = ['package_name','total_sessions','purchase_price','expires_at','status','notes']
  const patch = {}
  for (const k of allowed) if (k in data) patch[k] = data[k]
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM service_packages WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(', ')
  db.prepare(`UPDATE service_packages SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM service_packages WHERE id=?').get(id)
}
function servicePackageList({ status, clientId } = {}) {
  if (!db) return []
  let sql = `SELECT sp.*, c.name AS client_name, sv.name AS service_name
             FROM service_packages sp
             LEFT JOIN clients  c  ON c.id = sp.client_id
             LEFT JOIN services sv ON sv.id = sp.service_id
             WHERE 1=1`
  const p = {}
  if (status)   { sql += ' AND sp.status=@status'; p.status = status }
  if (clientId) { sql += ' AND sp.client_id=@cid'; p.cid = clientId }
  sql += ' ORDER BY sp.purchased_at DESC'
  return db.prepare(sql).all(p)
}
function servicePackageActiveForClient(clientId) {
  if (!db || !clientId) return []
  return db.prepare(`SELECT sp.*, sv.name AS service_name
                     FROM service_packages sp
                     LEFT JOIN services sv ON sv.id = sp.service_id
                     WHERE sp.client_id=? AND sp.status='active'
                       AND sp.used_sessions < sp.total_sessions
                     ORDER BY sp.purchased_at ASC`).all(clientId)
}
function servicePackageConsume(id) {
  if (!db) return { ok: false }
  const sp = db.prepare('SELECT * FROM service_packages WHERE id=?').get(id)
  if (!sp) return { ok: false, error: 'not_found' }
  if (sp.status !== 'active') return { ok: false, error: 'inactive' }
  if (sp.used_sessions >= sp.total_sessions) return { ok: false, error: 'exhausted', remaining: 0 }
  db.prepare(`UPDATE service_packages SET used_sessions = used_sessions + 1, updated_at=datetime('now') WHERE id=?`).run(id)
  const remaining = sp.total_sessions - sp.used_sessions - 1
  if (remaining <= 0) {
    db.prepare("UPDATE service_packages SET status='exhausted', updated_at=datetime('now') WHERE id=?").run(id)
  }
  return { ok: true, remaining }
}
function servicePackageDelete(id) {
  if (!db) return
  db.prepare("UPDATE service_packages SET status='cancelled', updated_at=datetime('now') WHERE id=?").run(id)
}

function projectCreate({ client_id, name, description, status }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const csid = _svcResolveClientSid(client_id)
  const r = db.prepare(`INSERT INTO projects
    (supabase_id, client_id, client_supabase_id, name, description, status)
    VALUES(@sid,@cid,@csid,@name,@desc,@status)`).run({
    sid, cid: client_id || null, csid,
    name, desc: description || null, status: status || 'draft',
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function projectUpdate(id, data) {
  if (!db) return null
  const allowed = ['name','description','status','closed_at']
  const patch = {}
  for (const k of allowed) if (k in data) patch[k] = data[k]
  if (data.status === 'closed' && !patch.closed_at) patch.closed_at = new Date().toISOString()
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM projects WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(', ')
  db.prepare(`UPDATE projects SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM projects WHERE id=?').get(id)
}
function projectList({ status, clientId } = {}) {
  if (!db) return []
  let sql = `SELECT p.*, c.name AS client_name,
                    (SELECT COALESCE(SUM(t.total),0) FROM tickets t
                     WHERE t.project_id = p.id AND t.voided = 0) AS total_billed_live
             FROM projects p
             LEFT JOIN clients c ON c.id = p.client_id
             WHERE 1=1`
  const p = {}
  if (status)   { sql += ' AND p.status=@status'; p.status = status }
  if (clientId) { sql += ' AND p.client_id=@cid'; p.cid = clientId }
  sql += ' ORDER BY p.created_at DESC'
  return db.prepare(sql).all(p)
}
function projectGetById(id) {
  if (!db) return null
  return db.prepare(`SELECT p.*, c.name AS client_name FROM projects p
                     LEFT JOIN clients c ON c.id = p.client_id WHERE p.id=?`).get(id)
}

function clientRateSet({ client_id, service_id, custom_price, notes }) {
  if (!db) return null
  const csid = _svcResolveClientSid(client_id)
  const svsid = _svcResolveServiceSid(service_id)
  if (!csid || !svsid) return null
  const existing = db.prepare('SELECT id FROM client_service_rates WHERE client_supabase_id=? AND service_supabase_id=?').get(csid, svsid)
  if (existing) {
    db.prepare(`UPDATE client_service_rates SET custom_price=?, notes=?, updated_at=datetime('now') WHERE id=?`)
      .run(Number(custom_price) || 0, notes || null, existing.id)
    return db.prepare('SELECT * FROM client_service_rates WHERE id=?').get(existing.id)
  }
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO client_service_rates
    (supabase_id, client_id, client_supabase_id, service_id, service_supabase_id, custom_price, notes)
    VALUES(?,?,?,?,?,?,?)`).run(sid, client_id || null, csid, service_id || null, svsid, Number(custom_price) || 0, notes || null)
  return db.prepare('SELECT * FROM client_service_rates WHERE id=?').get(r.lastInsertRowid)
}
function clientRateList({ clientId } = {}) {
  if (!db) return []
  let sql = `SELECT r.*, c.name AS client_name, sv.name AS service_name, sv.price AS base_price
             FROM client_service_rates r
             LEFT JOIN clients  c  ON c.id = r.client_id
             LEFT JOIN services sv ON sv.id = r.service_id
             WHERE 1=1`
  const p = {}
  if (clientId) { sql += ' AND r.client_id=@cid'; p.cid = clientId }
  sql += ' ORDER BY c.name, sv.name'
  return db.prepare(sql).all(p)
}
function clientRateGet({ clientId, serviceId }) {
  if (!db || !clientId || !serviceId) return null
  return db.prepare(`SELECT r.*, sv.price AS base_price FROM client_service_rates r
                     LEFT JOIN services sv ON sv.id = r.service_id
                     WHERE r.client_id=? AND r.service_id=?`).get(clientId, serviceId)
}
function clientRateDelete(id) {
  if (!db) return
  db.prepare('DELETE FROM client_service_rates WHERE id=?').run(id)
}

// ── v2.5 — Per-client custom inventory pricing ──────────────────────────────
// Mirror of client_service_rates, scoped to inventory_items. Write path guards
// non-positive prices: the DR market never legitimately sells below zero, and
// a silent 0 would let a wholesaler walk out with free product. Upsert on
// natural key (client_supabase_id, inventory_item_supabase_id).
function _cipResolveItemSid(inventory_item_id) {
  if (!db || !inventory_item_id) return null
  try { return db.prepare('SELECT supabase_id FROM inventory_items WHERE id=?').get(inventory_item_id)?.supabase_id || null }
  catch { return null }
}
function clientItemPriceSet({ client_id, client_supabase_id, inventory_item_id, inventory_item_supabase_id, custom_price, notes }) {
  if (!db) return null
  const priceNum = Number(custom_price)
  if (!Number.isFinite(priceNum) || priceNum <= 0) return null
  const csid  = client_supabase_id  || _svcResolveClientSid(client_id)
  const iisid = inventory_item_supabase_id || _cipResolveItemSid(inventory_item_id)
  if (!csid || !iisid) return null
  // Resolve local IDs (best-effort; FKs may be null on rows synced from web).
  const cid = client_id || db.prepare('SELECT id FROM clients WHERE supabase_id=?').get(csid)?.id || null
  const iid = inventory_item_id || db.prepare('SELECT id FROM inventory_items WHERE supabase_id=?').get(iisid)?.id || null
  const existing = db.prepare('SELECT id FROM client_item_prices WHERE client_supabase_id=? AND inventory_item_supabase_id=?').get(csid, iisid)
  if (existing) {
    db.prepare(`UPDATE client_item_prices SET custom_price=?, notes=?, updated_at=datetime('now') WHERE id=?`)
      .run(priceNum, notes || null, existing.id)
    return db.prepare('SELECT * FROM client_item_prices WHERE id=?').get(existing.id)
  }
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO client_item_prices
    (supabase_id, client_id, client_supabase_id, inventory_item_id, inventory_item_supabase_id, custom_price, notes)
    VALUES(?,?,?,?,?,?,?)`).run(sid, cid, csid, iid, iisid, priceNum, notes || null)
  return db.prepare('SELECT * FROM client_item_prices WHERE id=?').get(r.lastInsertRowid)
}
function clientItemPriceList({ clientId, itemId } = {}) {
  if (!db) return []
  let sql = `SELECT p.*, c.name AS client_name, i.name AS item_name, i.sku,
                    i.price AS base_price, i.active AS item_active, c.active AS client_active
             FROM client_item_prices p
             LEFT JOIN clients         c ON c.id = p.client_id
             LEFT JOIN inventory_items i ON i.id = p.inventory_item_id
             WHERE 1=1`
  const params = {}
  if (clientId) { sql += ' AND p.client_id=@cid'; params.cid = clientId }
  if (itemId)   { sql += ' AND p.inventory_item_id=@iid'; params.iid = itemId }
  sql += ' ORDER BY i.name'
  return db.prepare(sql).all(params)
}
function clientItemPriceGet({ clientId, itemId }) {
  if (!db || !clientId || !itemId) return null
  return db.prepare('SELECT * FROM client_item_prices WHERE client_id=? AND inventory_item_id=?').get(clientId, itemId)
}
function clientItemPriceDelete(id) {
  if (!db) return
  const row = db.prepare('SELECT supabase_id, business_id FROM client_item_prices WHERE id=?').get(id)
  db.prepare('DELETE FROM client_item_prices WHERE id=?').run(id)
  if (row?.supabase_id) tombstoneAdd('client_item_prices', row.supabase_id, row.business_id)
}
// CSV bulk import — { client: <rnc|id>, sku: <sku|barcode>, custom_price, notes }
function clientItemPriceBulkImport(rows) {
  if (!db || !Array.isArray(rows)) return { ok: 0, skip: 0, errors: [] }
  const out = { ok: 0, skip: 0, errors: [] }
  const txn = db.transaction((list) => {
    for (const r of list) {
      try {
        const clientKey = String(r.client ?? r.client_rnc ?? r.rnc ?? '').trim()
        const skuKey    = String(r.sku ?? r.barcode ?? '').trim()
        if (!clientKey || !skuKey) { out.skip++; continue }
        const client = db.prepare('SELECT id FROM clients WHERE rnc=? OR id=?').get(clientKey, Number(clientKey) || 0)
        const item   = db.prepare('SELECT id FROM inventory_items WHERE sku=? OR barcode=?').get(skuKey, skuKey)
        if (!client || !item) { out.skip++; continue }
        const res = clientItemPriceSet({
          client_id: client.id,
          inventory_item_id: item.id,
          custom_price: r.custom_price,
          notes: r.notes || null,
        })
        if (res) out.ok++; else out.skip++
      } catch (e) { out.errors.push({ row: r, err: String(e && e.message || e) }) }
    }
  })
  try { txn(rows) } catch (e) { out.errors.push({ err: String(e && e.message || e) }) }
  return out
}

// ── Public API ────────────────────────────────────────────────────────────────
// ── Raw DB access for sync module ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// Multi-POS — NCF / doc_number block allocation + consumption (v2.3)
// ───────────────────────────────────────────────────────────────────────────────
// NETWORK-FREE. Every function here is pure SQLite (synchronous). The Supabase
// RPC that mints a block (`allocate_ncf_block` / `allocate_doc_number_block`)
// is called from electron/sync.js, which passes the resulting row to
// ncfBlockInsert / docNumberBlockInsert below.
//
// Concurrency: consume uses a BEGIN IMMEDIATE transaction — better-sqlite3
// serialises writes so two simultaneous consumers can never hand out the same
// next_available.
// ═══════════════════════════════════════════════════════════════════════════════

function _bizId() {
  if (!db) return null
  try { return db.prepare("SELECT value FROM app_settings WHERE key='supabase_business_id'").get()?.value || null }
  catch { return null }
}

function multiPosEnabled() {
  if (!db) return false
  try { return (db.prepare("SELECT value FROM app_settings WHERE key='multi_pos_enabled'").get()?.value || '0') === '1' }
  catch { return false }
}

// ── NCF blocks ──────────────────────────────────────────────────────────────
function ncfBlockInsert(row) {
  if (!db || !row) return null
  // Upsert by supabase_id so the RPC "reuse partial block" path doesn't
  // duplicate a row already living locally.
  const sid = row.supabase_id || row.id || null
  if (!sid) return null
  const existing = db.prepare('SELECT id FROM ncf_blocks WHERE supabase_id=?').get(sid)
  if (existing) {
    db.prepare(`UPDATE ncf_blocks SET
        next_available=?, exhausted_at=?, last_used_at=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=?`).run(
      Number(row.next_available),
      row.exhausted_at || null,
      row.last_used_at || null,
      existing.id,
    )
    return existing.id
  }
  const r = db.prepare(`INSERT INTO ncf_blocks
    (supabase_id, business_id, hwid, ncf_type, prefix,
     range_start, range_end, next_available, size,
     allocated_at, exhausted_at, last_used_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    sid,
    row.business_id,
    row.hwid,
    row.ncf_type,
    row.prefix || row.ncf_type,
    Number(row.range_start),
    Number(row.range_end),
    Number(row.next_available),
    Number(row.size || (row.range_end - row.range_start + 1)),
    row.allocated_at || new Date().toISOString(),
    row.exhausted_at || null,
    row.last_used_at || null,
  )
  return r.lastInsertRowid
}

function ncfBlockActive({ businessId, hwid, ncfType }) {
  if (!db) return null
  return db.prepare(`SELECT * FROM ncf_blocks
    WHERE business_id=? AND hwid=? AND ncf_type=? AND exhausted_at IS NULL
      AND next_available <= range_end
    ORDER BY range_start ASC LIMIT 1`).get(businessId, hwid, ncfType) || null
}

function ncfBlockAvailableCount({ businessId, hwid, ncfType }) {
  if (!db) return 0
  const r = db.prepare(`SELECT COALESCE(SUM(range_end - next_available + 1), 0) AS n
    FROM ncf_blocks
    WHERE business_id=? AND hwid=? AND ncf_type=?
      AND exhausted_at IS NULL AND next_available <= range_end`).get(businessId, hwid, ncfType)
  return Number(r?.n || 0)
}

function ncfBlockConsumeNext({ businessId, hwid, ncfType }) {
  if (!db) return null
  const tx = db.transaction(() => {
    const row = db.prepare(`SELECT * FROM ncf_blocks
      WHERE business_id=? AND hwid=? AND ncf_type=? AND exhausted_at IS NULL
        AND next_available <= range_end
      ORDER BY range_start ASC LIMIT 1`).get(businessId, hwid, ncfType)
    if (!row) return null
    const consumed = row.next_available
    const nextVal  = consumed + 1
    const willExhaust = nextVal > row.range_end
    const nowIso = new Date().toISOString()
    db.prepare(`UPDATE ncf_blocks
      SET next_available=?, last_used_at=?,
          exhausted_at = CASE WHEN ? = 1 THEN ? ELSE exhausted_at END,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=?`).run(nextVal, nowIso, willExhaust ? 1 : 0, nowIso, row.id)
    const ncf = `${row.prefix || row.ncf_type}${String(consumed).padStart(8, '0')}`
    return {
      ncf,
      value: consumed,
      blockId: row.id,
      blockSupabaseId: row.supabase_id,
      remaining: row.range_end - consumed,
      exhausted: willExhaust,
    }
  })
  return tx()
}

function ncfBlocksListLocal({ businessId = null, hwid = null } = {}) {
  if (!db) return []
  const where = []
  const args  = []
  if (businessId) { where.push('business_id=?'); args.push(businessId) }
  if (hwid)       { where.push('hwid=?');        args.push(hwid) }
  const sql = `SELECT * FROM ncf_blocks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ncf_type, range_start`
  return db.prepare(sql).all(...args)
}

// ── Doc-number blocks ───────────────────────────────────────────────────────
function docNumberBlockInsert(row) {
  if (!db || !row) return null
  const sid = row.supabase_id || row.id || null
  if (!sid) return null
  const existing = db.prepare('SELECT id FROM doc_number_blocks WHERE supabase_id=?').get(sid)
  if (existing) {
    db.prepare(`UPDATE doc_number_blocks SET
        next_available=?, exhausted_at=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=?`).run(Number(row.next_available), row.exhausted_at || null, existing.id)
    return existing.id
  }
  const r = db.prepare(`INSERT INTO doc_number_blocks
    (supabase_id, business_id, hwid, scope,
     range_start, range_end, next_available, size,
     allocated_at, exhausted_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    sid,
    row.business_id,
    row.hwid,
    row.scope || 'ticket',
    Number(row.range_start),
    Number(row.range_end),
    Number(row.next_available),
    Number(row.size || (row.range_end - row.range_start + 1)),
    row.allocated_at || new Date().toISOString(),
    row.exhausted_at || null,
  )
  return r.lastInsertRowid
}

function docNumberBlockActive({ businessId, hwid, scope = 'ticket' }) {
  if (!db) return null
  return db.prepare(`SELECT * FROM doc_number_blocks
    WHERE business_id=? AND hwid=? AND scope=? AND exhausted_at IS NULL
      AND next_available <= range_end
    ORDER BY range_start ASC LIMIT 1`).get(businessId, hwid, scope) || null
}

function docNumberBlockAvailableCount({ businessId, hwid, scope = 'ticket' }) {
  if (!db) return 0
  const r = db.prepare(`SELECT COALESCE(SUM(range_end - next_available + 1), 0) AS n
    FROM doc_number_blocks
    WHERE business_id=? AND hwid=? AND scope=?
      AND exhausted_at IS NULL AND next_available <= range_end`).get(businessId, hwid, scope)
  return Number(r?.n || 0)
}

function docNumberBlockConsumeNext({ businessId, hwid, scope = 'ticket' }) {
  if (!db) return null
  const tx = db.transaction(() => {
    const row = db.prepare(`SELECT * FROM doc_number_blocks
      WHERE business_id=? AND hwid=? AND scope=? AND exhausted_at IS NULL
        AND next_available <= range_end
      ORDER BY range_start ASC LIMIT 1`).get(businessId, hwid, scope)
    if (!row) return null
    const consumed = row.next_available
    const nextVal  = consumed + 1
    const willExhaust = nextVal > row.range_end
    const nowIso = new Date().toISOString()
    db.prepare(`UPDATE doc_number_blocks
      SET next_available=?,
          exhausted_at = CASE WHEN ? = 1 THEN ? ELSE exhausted_at END,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=?`).run(nextVal, willExhaust ? 1 : 0, nowIso, row.id)
    return {
      value: consumed,
      blockId: row.id,
      blockSupabaseId: row.supabase_id,
      remaining: row.range_end - consumed,
      exhausted: willExhaust,
    }
  })
  return tx()
}

function docNumberBlocksListLocal({ businessId = null, hwid = null } = {}) {
  if (!db) return []
  const where = []
  const args  = []
  if (businessId) { where.push('business_id=?'); args.push(businessId) }
  if (hwid)       { where.push('hwid=?');        args.push(hwid) }
  const sql = `SELECT * FROM doc_number_blocks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY scope, range_start`
  return db.prepare(sql).all(...args)
}

// ── Pending inventory deducts (post-sync oversell detection) ───────────────
function pendingDeductEnqueue({ ticketSupabaseId, items }) {
  if (!db || !ticketSupabaseId || !Array.isArray(items) || !items.length) return null
  const sid = crypto.randomUUID()
  db.prepare(`INSERT INTO pending_inventory_deducts
    (supabase_id, ticket_supabase_id, items_json)
    VALUES (?,?,?)`).run(sid, ticketSupabaseId, JSON.stringify(items))
  return sid
}

function pendingDeductList() {
  if (!db) return []
  return db.prepare(`SELECT * FROM pending_inventory_deducts
    WHERE pushed_at IS NULL ORDER BY id ASC`).all()
}

function pendingDeductMarkPushed(id) {
  if (!db) return
  db.prepare(`UPDATE pending_inventory_deducts
    SET pushed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_error = NULL
    WHERE id=?`).run(id)
}

function pendingDeductMarkFailed(id, errMsg) {
  if (!db) return
  db.prepare(`UPDATE pending_inventory_deducts
    SET attempts = attempts + 1, last_error = ?
    WHERE id=?`).run(String(errMsg || '').slice(0, 500), id)
}

// ── Oversells ──────────────────────────────────────────────────────────────
function oversellRecord({ businessId, ticketSupabaseId, itemSupabaseId, itemName, requested, actual }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const existing = db.prepare(`SELECT id FROM inventory_oversells
    WHERE ticket_supabase_id=? AND item_supabase_id=? AND resolved_at IS NULL`).get(ticketSupabaseId, itemSupabaseId)
  if (existing) return existing.id
  db.prepare(`INSERT INTO inventory_oversells
    (supabase_id, business_id, ticket_supabase_id, item_supabase_id, item_name, requested_qty, actual_qty)
    VALUES (?,?,?,?,?,?,?)`).run(
    sid, businessId || _bizId(), ticketSupabaseId, itemSupabaseId,
    itemName || null, Number(requested) || 0, Number(actual) || 0,
  )
  try {
    activityLogRecord({
      event_type: 'inventory_oversell',
      severity: 'warn',
      target_type: 'inventory_item',
      target_id: itemSupabaseId,
      target_name: itemName || null,
      amount: Number(requested) || 0,
      metadata: { ticket_supabase_id: ticketSupabaseId, actual: Number(actual) || 0 },
    })
  } catch {}
  return sid
}

function oversellList({ unresolvedOnly = false } = {}) {
  if (!db) return []
  const where = unresolvedOnly ? 'WHERE resolved_at IS NULL' : ''
  return db.prepare(`SELECT * FROM inventory_oversells ${where}
    ORDER BY detected_at DESC LIMIT 500`).all()
}

// v2.11.2 — Owner-facing shortage ledger for the Inventory "Quiebres" tab.
// Joins the oversell row to its source ticket (for doc_number / ncf) and
// falls back to the stored item_name when the inventory_items row was
// deleted. Bounded to 2000 rows so the UI stays responsive.
function inventoryOversellsList({ from, to, itemId, itemSupabaseId } = {}) {
  if (!db) return []
  const where = ['1=1']
  const args  = []
  if (from) { where.push('o.detected_at >= ?'); args.push(String(from)) }
  if (to)   { where.push('o.detected_at <= ?'); args.push(String(to)) }
  if (itemSupabaseId) { where.push('o.item_supabase_id = ?'); args.push(String(itemSupabaseId)) }
  else if (itemId)    { where.push('i.id = ?'); args.push(Number(itemId)) }
  const sql = `
    SELECT
      o.id,
      o.supabase_id,
      o.ticket_supabase_id,
      o.item_supabase_id,
      COALESCE(i.name, o.item_name) AS item_name,
      COALESCE(i.sku, NULL)         AS sku,
      i.id                          AS inventory_item_id,
      o.requested_qty,
      o.actual_qty,
      (o.requested_qty - o.actual_qty) AS shortage_qty,
      o.detected_at,
      o.resolved_at,
      o.resolution_type,
      o.resolution_notes,
      t.id                 AS ticket_id,
      t.ncf                AS doc_number,
      t.comprobante_type   AS comprobante_type,
      t.total              AS ticket_total,
      t.created_at         AS ticket_created_at
    FROM inventory_oversells o
    LEFT JOIN inventory_items i ON i.supabase_id = o.item_supabase_id
    LEFT JOIN tickets         t ON t.supabase_id = o.ticket_supabase_id
    WHERE ${where.join(' AND ')}
    ORDER BY o.detected_at DESC
    LIMIT 2000`
  try { return db.prepare(sql).all(...args) } catch { return [] }
}

function oversellResolveLocal({ supabase_id, resolution_type, notes, resolved_by }) {
  if (!db || !supabase_id) return false
  db.prepare(`UPDATE inventory_oversells
    SET resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        resolved_by = ?, resolution_type = ?, resolution_notes = ?,
        updated_at  = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE supabase_id = ?`).run(resolved_by || null, resolution_type || null, notes || null, supabase_id)
  return true
}

function oversellUnresolvedCount() {
  if (!db) return 0
  try {
    return Number(db.prepare(`SELECT COUNT(*) AS n FROM inventory_oversells WHERE resolved_at IS NULL`).get()?.n || 0)
  } catch { return 0 }
}

// ── CONTEO FISICO (physical inventory count + variance/theft report) ─────────
// Header = inventory_counts, one row per count session.
// Items  = inventory_count_items, snapshot of every active SKU at start time.
// variance_qty / variance_cost / variance_price are computed in SELECT — SQLite
// has GENERATED columns but portability wins. Supabase mirror uses GENERATED.

function _countRollup(countSid) {
  // v2.14 — Totals subtract sales-during-count from expected so variance
  // reflects TRUE shrinkage. counted_qty still NULL = "not counted yet" →
  // treated as adjusted-expected so the running total only moves when the
  // cashier enters a real number.
  const header = db.prepare('SELECT started_at, completed_at FROM inventory_counts WHERE supabase_id = ?').get(countSid)
  const items = db.prepare(`
    SELECT inventory_item_supabase_id, expected_qty, counted_qty, unit_cost
    FROM inventory_count_items WHERE count_supabase_id = ?
  `).all(countSid)

  const soldMap = new Map()
  if (header) {
    const windowEnd = header.completed_at || new Date().toISOString()
    const soldRows = db.prepare(`
      SELECT ii.supabase_id AS sid, SUM(COALESCE(ti.quantity, 1)) AS sold
      FROM ticket_items ti
      JOIN tickets t ON t.id = ti.ticket_id
      JOIN inventory_items ii ON ii.id = ti.inventory_item_id
      WHERE ti.inventory_item_id IS NOT NULL
        AND t.created_at >= ? AND t.created_at <= ?
        AND COALESCE(t.status, '') != 'anulado'
      GROUP BY ii.supabase_id
    `).all(header.started_at, windowEnd)
    for (const r of soldRows) soldMap.set(r.sid, Number(r.sold) || 0)
  }

  let totExp = 0, totCnt = 0, totVar = 0
  for (const r of items) {
    const exp = Number(r.expected_qty) || 0
    const sold = soldMap.get(r.inventory_item_supabase_id) || 0
    const adj = exp - sold
    const cnt = (r.counted_qty === null || r.counted_qty === undefined) ? adj : Number(r.counted_qty)
    const cost = Number(r.unit_cost) || 0
    totExp += exp * cost
    totCnt += cnt * cost
    totVar += (cnt - adj) * cost
  }
  return {
    total_expected_value: totExp,
    total_counted_value:  totCnt,
    total_variance_value: totVar,
  }
}

function _applyRollup(countSid) {
  const t = _countRollup(countSid)
  db.prepare(`UPDATE inventory_counts
    SET total_expected_value = ?, total_counted_value = ?, total_variance_value = ?,
        updated_at = datetime('now')
    WHERE supabase_id = ?`)
    .run(t.total_expected_value, t.total_counted_value, t.total_variance_value, countSid)
  return t
}

function inventoryCountStart({ title, counted_by_name, notes, categories } = {}) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const nowIso = new Date().toISOString()
  const headerTitle = (title && String(title).trim()) || `Conteo Fisico ${new Date().toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })}`
  // v2.14 — optional category pre-scope. Passing null/undefined/[] = all
  // active items (legacy behavior). Passing an array of names filters the
  // snapshot so the count only contains those categories. Also supports the
  // special token '(sin categoria)' for items with NULL/empty category.
  const catList = Array.isArray(categories) ? categories.filter(c => c != null).map(String) : null
  let whereCat = ''
  const params = []
  if (catList && catList.length) {
    const includesBlank = catList.some(c => c === '(sin categoria)' || c === 'Sin categoria')
    const named = catList.filter(c => c !== '(sin categoria)' && c !== 'Sin categoria')
    const clauses = []
    if (named.length) {
      clauses.push(`category IN (${named.map(() => '?').join(',')})`)
      params.push(...named)
    }
    if (includesBlank) clauses.push(`(category IS NULL OR TRIM(category) = '')`)
    if (clauses.length) whereCat = ' AND (' + clauses.join(' OR ') + ')'
  }
  const items = db.prepare(`
    SELECT id, supabase_id, sku, name, category, quantity, cost, price
    FROM inventory_items
    WHERE active = 1 AND supabase_id IS NOT NULL${whereCat}
    ORDER BY category COLLATE NOCASE, name COLLATE NOCASE
  `).all(...params)

  const run = db.transaction(() => {
    const r = db.prepare(`INSERT INTO inventory_counts
      (supabase_id, title, started_at, counted_by_name, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'abierto', ?, ?, ?)`)
      .run(sid, headerTitle, nowIso, counted_by_name || null, notes || null, nowIso, nowIso)
    const headerId = r.lastInsertRowid

    const insItem = db.prepare(`INSERT INTO inventory_count_items
      (supabase_id, count_id, count_supabase_id, inventory_item_id, inventory_item_supabase_id,
       sku, name, category, expected_qty, counted_qty, unit_cost, unit_price, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`)
    for (const it of items) {
      insItem.run(
        crypto.randomUUID(), headerId, sid, it.id, it.supabase_id,
        it.sku || null, it.name, it.category || null,
        Number(it.quantity) || 0,
        Number(it.cost) || 0, Number(it.price) || 0,
        nowIso, nowIso
      )
    }
    return headerId
  })
  const headerId = run()
  _applyRollup(sid)
  return inventoryCountGet(headerId)
}

function inventoryCountList({ limit = 50 } = {}) {
  if (!db) return []
  const rows = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM inventory_count_items WHERE count_supabase_id = c.supabase_id) AS items_count,
      (SELECT COUNT(*) FROM inventory_count_items WHERE count_supabase_id = c.supabase_id AND counted_qty IS NOT NULL) AS counted_count
    FROM inventory_counts c
    ORDER BY c.started_at DESC
    LIMIT ?
  `).all(Math.min(Number(limit) || 50, 500))
  return rows
}

function inventoryCountGet(idOrSid) {
  if (!db) return null
  const header = (typeof idOrSid === 'string' && idOrSid.includes('-'))
    ? db.prepare('SELECT * FROM inventory_counts WHERE supabase_id = ?').get(idOrSid)
    : db.prepare('SELECT * FROM inventory_counts WHERE id = ?').get(Number(idOrSid))
  if (!header) return null
  const items = db.prepare(`
    SELECT *,
      (COALESCE(counted_qty, 0) - expected_qty)               AS variance_qty,
      (COALESCE(counted_qty, 0) - expected_qty) * unit_cost   AS variance_cost,
      (COALESCE(counted_qty, 0) - expected_qty) * unit_price  AS variance_price
    FROM inventory_count_items
    WHERE count_supabase_id = ?
    ORDER BY category COLLATE NOCASE, name COLLATE NOCASE
  `).all(header.supabase_id)

  // v2.14 — Sales during the count window (started_at → completed_at, or now
  // if still abierto). Subtracted from expected_qty so the variance report
  // shows TRUE shrinkage, not sales-masquerading-as-shrinkage. Excludes voids.
  const windowEnd = header.completed_at || new Date().toISOString()
  const soldRows = db.prepare(`
    SELECT ii.supabase_id AS inventory_item_supabase_id,
           SUM(COALESCE(ti.quantity, 1)) AS sold
    FROM ticket_items ti
    JOIN tickets      t  ON t.id = ti.ticket_id
    JOIN inventory_items ii ON ii.id = ti.inventory_item_id
    WHERE ti.inventory_item_id IS NOT NULL
      AND t.created_at >= ?
      AND t.created_at <= ?
      AND COALESCE(t.status,'') != 'anulado'
    GROUP BY ii.supabase_id
  `).all(header.started_at, windowEnd)
  const soldMap = new Map(soldRows.map(r => [r.inventory_item_supabase_id, Number(r.sold) || 0]))
  for (const it of items) {
    it.sold_during_count = soldMap.get(it.inventory_item_supabase_id) || 0
  }
  return { ...header, items }
}

function inventoryCountSaveItem({ count_supabase_id, inventory_item_supabase_id, counted_qty, notes }) {
  if (!db || !count_supabase_id || !inventory_item_supabase_id) return false
  const qty = (counted_qty === null || counted_qty === '' || counted_qty === undefined) ? null : Number(counted_qty)
  if (qty != null && (!Number.isFinite(qty) || qty < 0)) {
    throw new Error('Cantidad invalida')
  }
  const nowIso = new Date().toISOString()
  db.prepare(`UPDATE inventory_count_items
    SET counted_qty = ?, notes = COALESCE(?, notes), updated_at = ?
    WHERE count_supabase_id = ? AND inventory_item_supabase_id = ?`)
    .run(qty, notes != null ? notes : null, nowIso, count_supabase_id, inventory_item_supabase_id)
  _applyRollup(count_supabase_id)
  return true
}

function inventoryCountComplete({ id, apply_to_inventory = true, signature_dataurl = null } = {}) {
  if (!db || !id) return { ok: false, error: 'missing_id' }
  const header = (typeof id === 'string' && id.includes('-'))
    ? db.prepare('SELECT * FROM inventory_counts WHERE supabase_id = ?').get(id)
    : db.prepare('SELECT * FROM inventory_counts WHERE id = ?').get(Number(id))
  if (!header) return { ok: false, error: 'count_not_found' }
  if (header.status !== 'abierto') return { ok: false, error: 'count_not_open' }

  const countSid = header.supabase_id
  const nowIso = new Date().toISOString()

  // Row-level variance snapshot for activity_log metadata (top 10 losses).
  // v2.14 — variance subtracts sales-during-count from expected so activity
  // feed + top losses show TRUE shrinkage, not sales masquerading as loss.
  const windowEndIso = nowIso
  const soldRows = db.prepare(`
    SELECT ii.supabase_id AS sid, SUM(COALESCE(ti.quantity, 1)) AS sold
    FROM ticket_items ti
    JOIN tickets t ON t.id = ti.ticket_id
    JOIN inventory_items ii ON ii.id = ti.inventory_item_id
    WHERE ti.inventory_item_id IS NOT NULL
      AND t.created_at >= ? AND t.created_at <= ?
      AND COALESCE(t.status, '') != 'anulado'
    GROUP BY ii.supabase_id
  `).all(header.started_at, windowEndIso)
  const soldMap = new Map(soldRows.map(r => [r.sid, Number(r.sold) || 0]))
  const counted = db.prepare(`
    SELECT inventory_item_supabase_id, sku, name, category, expected_qty, counted_qty, unit_cost, unit_price
    FROM inventory_count_items
    WHERE count_supabase_id = ? AND counted_qty IS NOT NULL
  `).all(countSid).map(r => {
    const exp = Number(r.expected_qty) || 0
    const sold = soldMap.get(r.inventory_item_supabase_id) || 0
    const adj = exp - sold
    const cnt = Number(r.counted_qty) || 0
    const varQty = cnt - adj
    return {
      ...r,
      sold_during_count: sold,
      adj_expected_qty: adj,
      variance_qty: varQty,
      variance_cost: varQty * (Number(r.unit_cost) || 0),
    }
  })

  const run = db.transaction(() => {
    if (apply_to_inventory) {
      const upd = db.prepare(`UPDATE inventory_items
        SET quantity = ?, updated_at = datetime('now')
        WHERE supabase_id = ?`)
      for (const r of counted) {
        // Look up supabase_id from the item rows in this count.
        const sid = db.prepare('SELECT inventory_item_supabase_id FROM inventory_count_items WHERE count_supabase_id=? AND sku IS ? AND name=?')
          .get(countSid, r.sku, r.name)?.inventory_item_supabase_id
        if (sid) upd.run(Number(r.counted_qty) || 0, sid)
      }
    }
    db.prepare(`UPDATE inventory_counts SET status='completado', completed_at=?, signature_dataurl=COALESCE(?, signature_dataurl), updated_at=? WHERE supabase_id=?`)
      .run(nowIso, signature_dataurl || null, nowIso, countSid)
  })
  run()

  const totals = _applyRollup(countSid)
  const varianceCost = Math.abs(Number(totals.total_variance_value) || 0)
  const severity = varianceCost > 10000 ? 'critical' : (varianceCost > 2000 ? 'warn' : 'info')
  const topLosses = counted
    .filter(r => Number(r.variance_cost) < 0)
    .sort((a, b) => Number(a.variance_cost) - Number(b.variance_cost))
    .slice(0, 10)
    .map(r => ({
      sku: r.sku || null, name: r.name,
      expected: Number(r.expected_qty) || 0,
      counted: Number(r.counted_qty) || 0,
      variance_qty: Number(r.variance_qty) || 0,
      variance_cost: Number(r.variance_cost) || 0,
    }))

  try {
    activityLogRecord({
      event_type: 'inventory_count_completed', severity,
      target_type: 'inventory_count', target_id: header.id, target_name: header.title,
      amount: totals.total_variance_value,
      reason: apply_to_inventory ? 'Conteo aplicado al inventario' : 'Conteo sin aplicar al inventario',
      metadata: {
        count_supabase_id: countSid,
        items_total: counted.length,
        total_expected_value: totals.total_expected_value,
        total_counted_value: totals.total_counted_value,
        total_variance_value: totals.total_variance_value,
        applied: !!apply_to_inventory,
        top_losses: topLosses,
      },
    })
  } catch {}

  return { ok: true, totals, severity, topLosses }
}

function inventoryCountCancel(id) {
  if (!db || !id) return false
  const nowIso = new Date().toISOString()
  const where = (typeof id === 'string' && id.includes('-')) ? 'supabase_id = ?' : 'id = ?'
  db.prepare(`UPDATE inventory_counts SET status='cancelado', completed_at=?, updated_at=? WHERE ${where} AND status='abierto'`)
    .run(nowIso, nowIso, typeof id === 'string' && id.includes('-') ? id : Number(id))
  return true
}

function inventoryCountDelete(id) {
  if (!db || !id) return false
  const header = (typeof id === 'string' && id.includes('-'))
    ? db.prepare('SELECT * FROM inventory_counts WHERE supabase_id = ?').get(id)
    : db.prepare('SELECT * FROM inventory_counts WHERE id = ?').get(Number(id))
  if (!header) return false
  const itemSids = db.prepare('SELECT supabase_id FROM inventory_count_items WHERE count_supabase_id = ?').all(header.supabase_id).map(r => r.supabase_id).filter(Boolean)
  const run = db.transaction(() => {
    db.prepare('DELETE FROM inventory_count_items WHERE count_supabase_id = ?').run(header.supabase_id)
    db.prepare('DELETE FROM inventory_counts WHERE id = ?').run(header.id)
  })
  run()
  for (const sid of itemSids) tombstoneAdd('inventory_count_items', sid, header.business_id)
  if (header.supabase_id) tombstoneAdd('inventory_counts', header.supabase_id, header.business_id)
  return true
}

function rawPrepare(sql) { return db ? db.prepare(sql) : null }
function rawExec(sql) { if (db) db.exec(sql) }

// Consistent online snapshot via better-sqlite3's native backup API.
// Preserves SQLCipher encryption page-by-page (ciphertext copied as-is).
function dbBackupTo(destPath) {
  if (!db) return Promise.reject(new Error('db not initialized'))
  if (typeof db.backup !== 'function') return Promise.reject(new Error('better-sqlite3 backup() unavailable'))
  return db.backup(destPath)
}

function closeDb() {
  try { if (db) db.close() } catch {}
  db = null
}

// ── Tombstone helpers ─────────────────────────────────────────────────────────
// Record a local delete so the sync loop can mirror it to Supabase. Safe to
// call with a falsy supabaseId (no-op — row was never synced, nothing to do).
function tombstoneAdd(tableName, supabaseId, businessId) {
  if (!tableName || !supabaseId) return
  try {
    db.prepare(`INSERT OR IGNORE INTO sync_tombstones (table_name, supabase_id, business_id) VALUES (?, ?, ?)`)
      .run(tableName, supabaseId, businessId || null)
  } catch (e) { log?.warn?.(`[db] tombstoneAdd ${tableName}/${supabaseId}: ${e.message}`) }
}
function tombstonesPending(limit = 200) {
  try {
    return db.prepare(`SELECT id, table_name, supabase_id, business_id, attempts FROM sync_tombstones ORDER BY created_at ASC LIMIT ?`).all(limit)
  } catch { return [] }
}
function tombstoneMarkSent(id) {
  try { db.prepare(`DELETE FROM sync_tombstones WHERE id = ?`).run(id) } catch {}
}
function tombstoneMarkFailed(id, err) {
  try { db.prepare(`UPDATE sync_tombstones SET attempts = attempts + 1, last_error = ? WHERE id = ?`).run(String(err || '').slice(0, 500), id) } catch {}
}

module.exports = {
  init, isReady, getError, rawPrepare, rawExec, closeDb, dbBackupTo,
  tombstoneAdd, tombstonesPending, tombstoneMarkSent, tombstoneMarkFailed,
  // Empresa
  configGet, configSet,
  empresaGet, empresaSave,
  // Settings
  settingsGet, settingsUpdate, getSetting, setSetting,
  // Auth
  authByPin, authLockoutStatus, usersGetAll, userCreate, userUpdate, userDelete, userDeleteHard,
  staffGenerateAuthCard, staffRevokeAuthCard, staffVerifyAuthToken,
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
  clientsGetAll, clientGetById, clientCreate, clientUpdate, clientUpdateBalance, clientAddLoyaltyPoints, clientGetOpenTickets, collectCredit,
  // v2.7.1 — Loyalty program (ledger)
  loyaltyAward, loyaltyRedeem, loyaltyAdjust, loyaltyHistory,
  // Tickets
  ticketsGetAll, ticketGetById, ticketCreate, ticketMarkPaid, ticketVoid, ticketGetByDateRange,
  // Price changes
  ticketItemUpdatePrice, priceChangesGetByTicket, priceChangesGetAll,
  // Queue
  queueGetActive, queueUpdateStatus, queueDelete,
  // Commissions
  commissionsGetByWasher, commissionsGetByPeriod, commissionsMarkPaid, commissionsMarkPaidByPeriod,
  sellerCommissionsBySeller, sellerCommissionsByPeriod, sellerCommissionsMarkPaid, sellerCommissionsMarkPaidByPeriod, sellerCommissionCreate,
  cajeroCommissionsByCajero, cajeroCommissionsByPeriod, cajeroCommissionsMarkPaid, cajeroCommissionsMarkPaidByPeriod, cajeroCommissionCreate,
  washerCommissionCreate,
  // Cuadre
  cuadreCreate, cuadreGetHistory, cuadreList, cuadreDailySummary,
  cuadreGetOpen, cuadreOpenShift,
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
  inventoryGetAll, inventoryCreate, inventoryUpdate, inventoryBulkUpdate, inventoryDelete, inventoryAdjust, inventoryTransactions,
  inventoryLookupBySku, inventorySearch, inventoryLowStockCount,
  // Conteo Fisico (v2.5)
  inventoryCountStart, inventoryCountList, inventoryCountGet, inventoryCountSaveItem,
  inventoryCountComplete, inventoryCountCancel, inventoryCountDelete,
  // e-CF offline queue
  ecfQueueAdd, ecfQueueGetPending, ecfQueueGetById, ecfQueueMarkSubmitted, ecfQueueMarkFailed,
  ecfQueueDelete, ecfQueueIncrAttempts, ecfQueueCount,
  // DGII reconciler (EN_PROCESO → final verdict) + deferred-flag cleanup
  ecfQueueGetStaleSubmitted, ecfQueueMarkDone, ecfClearDeferredForTicket,
  // ANECF auto-queue (v2.10.4 — audit E-C6)
  anecfQueueEnqueue, anecfQueueGetPending, anecfQueueMarkSubmitted, anecfQueueMarkFailed,
  ncfSequenceDecrementIfLast,
  anecfQueueCount, anecfQueueList, isECF,
  // e-CF submissions log
  ecfSubmissionAdd, ecfSubmissionUpdate, ecfSubmissionGetByTrackId, ecfSubmissionGetByTicket,
  ecfSubmissionGetPending, ecfSubmissionGetAll,
  // Activity log (owner audit feed)
  setActiveUser, getActiveUser, activityLogRecord, activityLogList, activityLogSelfHeal, setActivityErrorSink,
  // e-CF certificate rotation history (audit trail — append-only, synced)
  ecfCertHistoryInsert, ecfCertHistoryList,
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
  workOrderSaveInspection, workOrderGenerateApprovalToken, workOrderApproveEstimate,
  workOrderSetPartsOrder, workOrderClose, recalcWorkOrderTotals,
  appointmentCreate, appointmentUpdate, appointmentList, appointmentGetById, appointmentDelete,
  stylistScheduleCreate, stylistScheduleUpdate, stylistScheduleList, stylistScheduleDelete,
  loanCreate, loanUpdate, loanList, loanGetById,
  loanPaymentCreate, loanPaymentList,
  pawnItemCreate, pawnItemUpdate, pawnItemList, pawnItemDelete, pawnItemRedeem, pawnItemGetByCode,
  loanScheduleList, loanScheduleMarkPaid,
  loansComputeMora, loansOverdueList,
  collectionsLogCreate, collectionsLogList,
  // Carwash expansion — memberships, combos, queue metrics, top washers, vehicle history
  membershipCreate, membershipUpdate, membershipList, membershipGetActiveForClient,
  membershipConsumeWash, membershipDelete,
  washComboCreate, washComboUpdate, washComboList, washComboActiveForClient,
  washComboConsume, washComboDelete,
  queueWaitMetrics, topWashersThisMonth, ticketsByClient,
  // Service vertical — recurring, packages, projects, per-client rates
  subscriptionCreate, subscriptionUpdate, subscriptionList, subscriptionMarkBilled, subscriptionDelete,
  servicePackageCreate, servicePackageUpdate, servicePackageList, servicePackageActiveForClient,
  servicePackageConsume, servicePackageDelete,
  projectCreate, projectUpdate, projectList, projectGetById,
  clientRateSet, clientRateList, clientRateGet, clientRateDelete,
  // v2.5 — per-client item prices
  clientItemPriceSet, clientItemPriceList, clientItemPriceGet, clientItemPriceDelete, clientItemPriceBulkImport,
  // Multi-POS — block allocation + oversell detection (v2.3)
  multiPosEnabled,
  ncfBlockInsert, ncfBlockActive, ncfBlockAvailableCount, ncfBlockConsumeNext, ncfBlocksListLocal,
  docNumberBlockInsert, docNumberBlockActive, docNumberBlockAvailableCount, docNumberBlockConsumeNext, docNumberBlocksListLocal,
  pendingDeductEnqueue, pendingDeductList, pendingDeductMarkPushed, pendingDeductMarkFailed,
  oversellRecord, oversellList, oversellResolveLocal, oversellUnresolvedCount,
  inventoryOversellsList,
}
