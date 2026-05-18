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
  // v2.16.3 — fail LOUD. Previously a thrown bcrypt error (corrupted hash,
  // native lib failure, malformed salt) was swallowed and returned `false`,
  // which silently denied a valid PIN and produced the generic "PIN
  // incorrecto" error in the UI — leaving the operator with no diagnostic
  // signal. Now we log the underlying cause and rethrow with a tagged
  // message the UI/IPC layer can surface verbatim.
  try {
    return bcrypt.compareSync(String(pin) + (salt || ''), String(hash || ''))
  } catch (err) {
    console.error('[bcrypt] compare failed:', err && err.message ? err.message : err)
    const e = new Error('bcrypt_compare_failed: ' + (err && err.message ? err.message : 'unknown'))
    e.code = 'BCRYPT_COMPARE_FAILED'
    e.cause = err
    throw e
  }
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
    // Diagnostic only — fallback path is healthy. Surface in dev.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[db] ciphers fork unavailable, using plain better-sqlite3:', err1.message)
    }
  } catch (err2) {
    dbLoadError = err2.message
    // FATAL — no sqlite driver available at all. Always log.
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

  if (process.env.NODE_ENV !== 'production') {
    console.log('[db] plaintext DB detected, running first-boot encryption migration...')
  }
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
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[db] encryption migration complete — ${tableCount} tables / ${rowsCopied} rows. backup at ${bakPath}`)
  }
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
    // FIX-HIGH-8 — fallback queue for activity_log writes that fail at the
    // canonical INSERT step (extremely rare on local SQLite, but possible
    // during DB self-heal / disk-full / SQLCipher key rotation windows).
    // Drained at the end of every sync cycle by electron/sync.js. NEVER
    // raw-INSERT into activity_log from the drainer — always re-call
    // activityLogRecord() so the single chokepoint stays canonical.
    `CREATE TABLE IF NOT EXISTS activity_log_fallback (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      payload         TEXT NOT NULL,
      attempts        INTEGER NOT NULL DEFAULT 0,
      last_error      TEXT,
      status          TEXT NOT NULL DEFAULT 'pending',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      last_attempt_at TEXT,
      next_attempt_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_activity_log_fallback_status ON activity_log_fallback(status, next_attempt_at)`,
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
    // v2.16.3 — Restaurant: 86-list (sold-out plates). 1=available, 0=agotado.
    // Idempotent ALTER swallowed by the migration loop's "duplicate column" filter.
    'ALTER TABLE services ADD COLUMN in_stock INTEGER NOT NULL DEFAULT 1',
    // v2.2 — Restaurant: per-item course tag, KDS fire timestamp, guest-split tag
    'ALTER TABLE ticket_items ADD COLUMN course TEXT',
    'ALTER TABLE ticket_items ADD COLUMN kds_fired_at TEXT',
    'ALTER TABLE ticket_items ADD COLUMN guest_number INTEGER',
    // v2.2 — Restaurant: split-bill persistence (parts[] as JSON on ticket)
    'ALTER TABLE tickets ADD COLUMN payment_parts TEXT',
    'ALTER TABLE tickets ADD COLUMN split_bill    INTEGER DEFAULT 0',
    'ALTER TABLE tickets ADD COLUMN tip_amount REAL DEFAULT 0',
    // H2 — Restaurant: 10% Servicio (Ley 16-92 / costumbre RD). Persisted
    // per-ticket so historical reports + commission splits stay accurate
    // even when the owner changes the global default later.
    'ALTER TABLE tickets ADD COLUMN servicio_amount REAL NOT NULL DEFAULT 0',
    'ALTER TABLE tickets ADD COLUMN servicio_pct REAL DEFAULT 0',
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
    // v2.16.4 — Restaurant: persist open tickets at mesa-seating time. The
    // existing `status` column is overloaded for finance state
    // (cobrado/pendiente/nula/anulado), so we add a parallel `open_status`
    // column with values 'open' (mesa seated, items being added) | 'closed'
    // (paid or never opened). Default 'closed' keeps every legacy/finance
    // ticket out of the open-tickets index. The partial index makes
    // ticketGetActiveByMesa O(1) even with 100k tickets.
    "ALTER TABLE tickets ADD COLUMN open_status TEXT NOT NULL DEFAULT 'closed'",
    "CREATE INDEX IF NOT EXISTS idx_tickets_open_by_mesa ON tickets(mesa_id, open_status) WHERE open_status='open'",
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
    // v2.16.2 C7 — per-business default mora rate (centralizes the 0.5% literal)
    "ALTER TABLE businesses ADD COLUMN mora_rate_daily REAL DEFAULT 0.005",
    // v2.16.2 C8 — pawn_listings remate override audit trail
    "ALTER TABLE pawn_listings ADD COLUMN list_price_override INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE pawn_listings ADD COLUMN override_reason TEXT",

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

    // ── v2.16.2 — Prestamos hardening: amortization + renewals + contracts + listings ──
    "ALTER TABLE loans ADD COLUMN amortization_method TEXT NOT NULL DEFAULT 'interest_only'",
    "ALTER TABLE loans ADD COLUMN renewal_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE pawn_items ADD COLUMN default_alert_days INTEGER NOT NULL DEFAULT 3",
    "ALTER TABLE pawn_items ADD COLUMN valoracion_notes TEXT",
    "ALTER TABLE pawn_items ADD COLUMN offered_pct REAL NOT NULL DEFAULT 60",
    "ALTER TABLE pawn_items ADD COLUMN signature_dataurl TEXT",

    `CREATE TABLE IF NOT EXISTS loan_contracts (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id         TEXT,
      business_id         TEXT,
      loan_id             INTEGER REFERENCES loans(id),
      loan_supabase_id    TEXT,
      pdf_url             TEXT,
      signature_dataurl   TEXT,
      dpi_photo_url       TEXT,
      signed_at           TEXT,
      apr_monthly         REAL,
      apr_annual_equiv    REAL,
      clauses_version     TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(business_id, supabase_id)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_loan_contracts_supabase_id ON loan_contracts(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_loan_contracts_loan ON loan_contracts(loan_supabase_id)`,

    `CREATE TABLE IF NOT EXISTS loan_renewals (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id         TEXT,
      business_id         TEXT,
      loan_id             INTEGER REFERENCES loans(id),
      loan_supabase_id    TEXT,
      renewal_count       INTEGER,
      interest_paid       REAL,
      new_due_date        TEXT,
      previous_due_date   TEXT,
      renewed_at          TEXT NOT NULL DEFAULT (datetime('now')),
      notes               TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(business_id, supabase_id)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_loan_renewals_supabase_id ON loan_renewals(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_loan_renewals_loan ON loan_renewals(loan_supabase_id)`,

    `CREATE TABLE IF NOT EXISTS pawn_documents (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id         TEXT,
      business_id         TEXT,
      pawn_id             INTEGER REFERENCES pawn_items(id),
      pawn_supabase_id    TEXT,
      doc_type            TEXT,
      file_url            TEXT,
      mime_type           TEXT,
      notes               TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(business_id, supabase_id)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_pawn_documents_supabase_id ON pawn_documents(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pawn_documents_pawn ON pawn_documents(pawn_supabase_id)`,

    `CREATE TABLE IF NOT EXISTS pawn_listings (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id              TEXT,
      business_id              TEXT,
      pawn_id                  INTEGER REFERENCES pawn_items(id),
      pawn_supabase_id         TEXT,
      list_price               REAL,
      published_at             TEXT,
      slug                     TEXT,
      status                   TEXT NOT NULL DEFAULT 'draft',
      sold_ticket_supabase_id  TEXT,
      notes                    TEXT,
      list_price_override      INTEGER NOT NULL DEFAULT 0,
      override_reason          TEXT,
      created_at               TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(business_id, supabase_id)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_pawn_listings_supabase_id ON pawn_listings(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pawn_listings_pawn ON pawn_listings(pawn_supabase_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_pawn_listings_biz_slug ON pawn_listings(business_id, slug) WHERE slug IS NOT NULL`,

    `CREATE TABLE IF NOT EXISTS collections_attempts (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id         TEXT,
      business_id         TEXT,
      loan_id             INTEGER REFERENCES loans(id),
      loan_supabase_id    TEXT,
      attempt_at          TEXT NOT NULL DEFAULT (datetime('now')),
      outcome             TEXT,
      notes               TEXT,
      next_followup_at    TEXT,
      whatsapp_sent       INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(business_id, supabase_id)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_attempts_supabase_id ON collections_attempts(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_collections_attempts_loan ON collections_attempts(loan_supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_collections_attempts_next ON collections_attempts(next_followup_at)`,

    // ── v2.16.x — Servicios vertical: minimal service_projects table ──
    // Mirrors supabase/migrations/20260426200000_service_projects.sql.
    // SQLite does not enforce CHECK constraints on enum strings the same way,
    // but the Supabase side is the source of truth via RLS + CHECK; sync
    // round-trips will raise on bad enums there.
    `CREATE TABLE IF NOT EXISTS service_projects (
      id                            INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id                   TEXT,
      business_id                   TEXT,
      client_supabase_id            TEXT,
      project_name                  TEXT NOT NULL,
      description                   TEXT,
      status                        TEXT NOT NULL DEFAULT 'active',
      billing_type                  TEXT NOT NULL DEFAULT 'project',
      estimated_hours               REAL,
      hourly_rate                   REAL,
      fixed_price                   REAL,
      total_billed                  REAL NOT NULL DEFAULT 0,
      total_paid                    REAL NOT NULL DEFAULT 0,
      started_at                    TEXT,
      due_date                      TEXT,
      completed_at                  TEXT,
      assigned_empleado_supabase_id TEXT,
      notes                         TEXT,
      created_at                    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(business_id, supabase_id)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_service_projects_supabase_id ON service_projects(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_service_projects_client ON service_projects(client_supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_service_projects_status ON service_projects(status)`,

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
    // v2.16.3 — bill_requested_at stamped by mesaRequestBill() / cleared by
    // any non-'acuenta' status transition. Drives the amber 'acuenta' card
    // in RestaurantPOS and any future bill-pending KDS surfacing.
    'ALTER TABLE mesas ADD COLUMN bill_requested_at TEXT',
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
    "ALTER TABLE users ADD COLUMN pin_hash_algo TEXT DEFAULT 'bcrypt'",
    "ALTER TABLE users ADD COLUMN pin_salt TEXT",
    "ALTER TABLE users ADD COLUMN pin_failed_attempts INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN pin_locked_until TEXT",
    // Normalise NULL algo on any row added before the default took effect
    // Legacy rows kept their existing (unsalted) SHA-256 hash; tag them as
    // 'sha256' so authByPin knows to rehash to bcrypt on the next successful
    // login. Only writes where no prior algo was recorded.
    "UPDATE users SET pin_hash_algo='sha256' WHERE pin_hash_algo IS NULL AND length(pin_hash)=64 AND pin_hash GLOB '*[0-9a-f]*'",
    "UPDATE users SET pin_hash_algo='bcrypt' WHERE pin_hash_algo IS NULL AND pin_hash LIKE '$2%' AND length(pin_hash)=60",

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

    // v2.14.20 — price-change recalc needs the per-row ITBIS flag. priceChange()
    // SELECTs aplica_itbis from ticket_items; legacy installs never had the
    // column ("no such column: aplica_itbis"). Backfill from services snapshot
    // where we still have the service_id — otherwise default to 1 (ITBIS-inclusive).
    "ALTER TABLE ticket_items ADD COLUMN aplica_itbis INTEGER NOT NULL DEFAULT 1",
    "UPDATE ticket_items SET aplica_itbis = COALESCE((SELECT s.aplica_itbis FROM services s WHERE s.id = ticket_items.service_id), 1) WHERE service_id IS NOT NULL",
    // v2.14.11 — Auto-heal emisor fields into app_settings KV when the
    // businesses row has them as top-level columns but app_settings doesn't.
    // Root cause of the SXAD e-CF rejection (codigo=2, empty rncemisor):
    // CobrarModal reads bizSettings.biz_rnc from app_settings, but
    // FirstTimeSetup / Admin → Mi Empresa only wrote to businesses.rnc.
    // Without this migration a client whose biz row has the RNC but never
    // touched the KV would silently emit e-CFs with empty emisor RNC,
    // every DGII submit would fail. INSERT OR IGNORE only fills empty
    // slots — never overwrites a user-set value.
    "INSERT OR IGNORE INTO app_settings(key, value, updated_at) SELECT 'biz_rnc',     REPLACE(REPLACE(rnc,'-',''),' ','') , datetime('now') FROM businesses WHERE id=1 AND rnc     IS NOT NULL AND rnc     <> ''",
    "INSERT OR IGNORE INTO app_settings(key, value, updated_at) SELECT 'biz_name',    name,    datetime('now') FROM businesses WHERE id=1 AND name    IS NOT NULL AND name    <> ''",
    "INSERT OR IGNORE INTO app_settings(key, value, updated_at) SELECT 'biz_phone',   phone,   datetime('now') FROM businesses WHERE id=1 AND phone   IS NOT NULL AND phone   <> ''",
    "INSERT OR IGNORE INTO app_settings(key, value, updated_at) SELECT 'biz_address', address, datetime('now') FROM businesses WHERE id=1 AND address IS NOT NULL AND address <> ''",
    "INSERT OR IGNORE INTO app_settings(key, value, updated_at) SELECT 'biz_email',   email,   datetime('now') FROM businesses WHERE id=1 AND email   IS NOT NULL AND email   <> ''",

    // ─────────────────────────────────────────────────────────────────────
    // v2.16.1 — Salón / Barbería hardening (parity with
    // supabase/migrations/20260425200000_salon_v2_16_1.sql).
    // SQLite has no `ADD COLUMN IF NOT EXISTS`; the wrapper try/catch above
    // already swallows "duplicate column" so plain ALTERs are safe + idempotent.
    // The existing carwash `memberships` table is extended additively; the
    // salon catalog columns coexist with the carwash subscription columns.
    // `active_template` is the salon-only flag (carwash uses `status`).
    // ─────────────────────────────────────────────────────────────────────
    "ALTER TABLE memberships ADD COLUMN nombre TEXT",
    "ALTER TABLE memberships ADD COLUMN service_supabase_id TEXT",
    "ALTER TABLE memberships ADD COLUMN total_sessions INTEGER",
    "ALTER TABLE memberships ADD COLUMN price_dop REAL",
    "ALTER TABLE memberships ADD COLUMN validity_days INTEGER DEFAULT 365",
    "ALTER TABLE memberships ADD COLUMN active_template INTEGER NOT NULL DEFAULT 1",
    // v2.16.2 (item #15) — explicit vertical discriminator. Backfill below
    // mirrors the supabase migration.
    "ALTER TABLE memberships ADD COLUMN vertical TEXT",
    "UPDATE memberships SET vertical='salon' WHERE vertical IS NULL AND total_sessions IS NOT NULL AND COALESCE(active_template,1)=1",
    "UPDATE memberships SET vertical='carwash' WHERE vertical IS NULL AND wash_quota_per_month IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_memberships_biz_supabase ON memberships(business_id, supabase_id)",
    "CREATE INDEX IF NOT EXISTS idx_memberships_biz_vertical ON memberships(business_id, vertical)",

    // appointments — salon hardening columns
    "ALTER TABLE appointments ADD COLUMN is_walk_in INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE appointments ADD COLUMN deposit_dop REAL NOT NULL DEFAULT 0",
    "ALTER TABLE appointments ADD COLUMN deposit_status TEXT NOT NULL DEFAULT 'none'",
    "ALTER TABLE appointments ADD COLUMN no_show_fee_charged INTEGER NOT NULL DEFAULT 0",
    // v2.16.3 — direct join key for tickets.voidNoShowFee. Stamped at no-show
    // charge time; the void helper resolves the original E32 in O(1).
    "ALTER TABLE appointments ADD COLUMN no_show_fee_ticket_supabase_id TEXT",
    "ALTER TABLE appointments ADD COLUMN public_booking_token TEXT",
    "ALTER TABLE appointments ADD COLUMN client_membership_supabase_id TEXT",

    // clients — no-show counters
    "ALTER TABLE clients ADD COLUMN no_show_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE clients ADD COLUMN last_no_show_at TEXT",
    // H8 — WhatsApp opt-out (DR ley protección de datos)
    "ALTER TABLE clients ADD COLUMN wa_opt_out INTEGER NOT NULL DEFAULT 0",
    // C9 — Papeleta legalmente vinculante: firma del prestamista
    "ALTER TABLE pawn_items ADD COLUMN prestamista_signature_dataurl TEXT",

    // client_memberships — per-client balance ledger
    `CREATE TABLE IF NOT EXISTS client_memberships (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id              TEXT,
      business_id              TEXT,
      client_supabase_id       TEXT NOT NULL,
      membership_supabase_id   TEXT NOT NULL,
      sessions_remaining       INTEGER NOT NULL,
      purchased_at             TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at               TEXT NOT NULL,
      ticket_supabase_id       TEXT,
      created_at               TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_client_memberships_supabase_id ON client_memberships(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_client_memberships_biz_supabase ON client_memberships(business_id, supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_client_memberships_client_expires ON client_memberships(client_supabase_id, expires_at)`,

    // membership_redemptions — audit trail
    `CREATE TABLE IF NOT EXISTS membership_redemptions (
      id                              INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id                     TEXT,
      business_id                     TEXT,
      client_membership_supabase_id   TEXT NOT NULL,
      ticket_supabase_id              TEXT NOT NULL,
      appointment_supabase_id         TEXT,
      redeemed_at                     TEXT NOT NULL DEFAULT (datetime('now')),
      created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_redemptions_supabase_id ON membership_redemptions(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_membership_redemptions_biz_supabase ON membership_redemptions(business_id, supabase_id)`,

    // appointment_reminders — 24h / 2h / manual / confirm queue
    `CREATE TABLE IF NOT EXISTS appointment_reminders (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id                 TEXT,
      business_id                 TEXT,
      appointment_supabase_id     TEXT NOT NULL,
      fire_at                     TEXT NOT NULL,
      kind                        TEXT NOT NULL CHECK (kind IN ('24h','2h','manual','confirm')),
      status                      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
      ultramsg_message_id         TEXT,
      error                       TEXT,
      sent_at                     TEXT,
      created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_appointment_reminders_supabase_id ON appointment_reminders(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_appointment_reminders_biz_supabase ON appointment_reminders(business_id, supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_appointment_reminders_dispatch ON appointment_reminders(appointment_supabase_id, status, fire_at)`,

    // ── v2.16.1 patch (20260425300000) — silent-failure audit fixes ─────────
    // ticket_items.empleado_supabase_id — per-line commission credit (#2)
    "ALTER TABLE ticket_items ADD COLUMN empleado_supabase_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_ticket_items_empleado ON ticket_items(empleado_supabase_id) WHERE empleado_supabase_id IS NOT NULL",
    // inventory_items.salon_upsell + salon_upsell_order — curated upsell tiles (#4)
    "ALTER TABLE inventory_items ADD COLUMN salon_upsell INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE inventory_items ADD COLUMN salon_upsell_order INTEGER",
    "CREATE INDEX IF NOT EXISTS idx_inventory_items_salon_upsell ON inventory_items(salon_upsell_order) WHERE salon_upsell=1",
    // appointments — partial unique index to block double-bookings (#7).
    // SQLite supports partial indexes; honours the same predicate as Postgres.
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_no_double_book ON appointments(business_id, empleado_supabase_id, date, start_time) WHERE status NOT IN ('cancelled','no_show')",

    // ── v2.16.3 — Carnicería hardening release ──────────────────────────────
    // Cortes catalog with photo + DR-popular name + nutrition JSON.
    `CREATE TABLE IF NOT EXISTS carniceria_corte_categories (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id         TEXT,
      business_id         TEXT,
      nombre              TEXT NOT NULL,
      nombre_dr_popular   TEXT,
      tooltip_traduccion  TEXT,
      especie             TEXT NOT NULL,
      photo_url           TEXT,
      nutrition_json      TEXT,
      sort_order          INTEGER DEFAULT 0,
      active              INTEGER NOT NULL DEFAULT 1,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_corte_cat_sup ON carniceria_corte_categories(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_corte_cat_biz ON carniceria_corte_categories(business_id, active)`,
    `CREATE TRIGGER IF NOT EXISTS trg_corte_cat_updated_at
       AFTER UPDATE ON carniceria_corte_categories FOR EACH ROW
       BEGIN UPDATE carniceria_corte_categories SET updated_at = datetime('now') WHERE id = NEW.id; END`,

    // inventory_items extension — prepacked / corte cat / freshness dates
    `ALTER TABLE inventory_items ADD COLUMN prepacked INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE inventory_items ADD COLUMN corte_category_supabase_id TEXT`,
    `ALTER TABLE inventory_items ADD COLUMN expires_at TEXT`,
    `ALTER TABLE inventory_items ADD COLUMN received_at TEXT`,

    // Freshness batches
    `CREATE TABLE IF NOT EXISTS inventory_freshness_log (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id                 TEXT,
      business_id                 TEXT,
      inventory_item_supabase_id  TEXT NOT NULL,
      batch_lote                  TEXT,
      received_at                 TEXT NOT NULL,
      expires_at                  TEXT NOT NULL,
      qty_received                REAL NOT NULL,
      qty_remaining               REAL NOT NULL,
      unit                        TEXT DEFAULT 'lb',
      auto_discount_applied       INTEGER NOT NULL DEFAULT 0,
      created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_fresh_sup ON inventory_freshness_log(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fresh_biz_item ON inventory_freshness_log(business_id, inventory_item_supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fresh_expires ON inventory_freshness_log(expires_at)`,
    `CREATE TRIGGER IF NOT EXISTS trg_fresh_updated_at
       AFTER UPDATE ON inventory_freshness_log FOR EACH ROW
       BEGIN UPDATE inventory_freshness_log SET updated_at = datetime('now') WHERE id = NEW.id; END`,

    // Discards (with motivo + photo)
    `CREATE TABLE IF NOT EXISTS inventory_discards (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id                 TEXT,
      business_id                 TEXT,
      inventory_item_supabase_id  TEXT NOT NULL,
      freshness_log_supabase_id   TEXT,
      qty                         REAL NOT NULL,
      unit                        TEXT DEFAULT 'lb',
      motivo                      TEXT NOT NULL,
      photo_url                   TEXT,
      empleado_supabase_id        TEXT,
      created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_disc_sup ON inventory_discards(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_disc_biz_date ON inventory_discards(business_id, created_at DESC)`,
    `CREATE TRIGGER IF NOT EXISTS trg_disc_updated_at
       AFTER UPDATE ON inventory_discards FOR EACH ROW
       BEGIN UPDATE inventory_discards SET updated_at = datetime('now') WHERE id = NEW.id; END`,

    // Prep notes on ticket items (for kitchen-style tickets)
    `ALTER TABLE ticket_items ADD COLUMN preparation_notes TEXT`,

    // v2.16.4 — discard provenance for E33 NCC trigger
    `ALTER TABLE inventory_discards ADD COLUMN is_post_sale INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE inventory_discards ADD COLUMN related_ticket_supabase_id TEXT`,
    `ALTER TABLE inventory_discards ADD COLUMN e33_encf TEXT`,

    // Mayoreo recurring orders
    `CREATE TABLE IF NOT EXISTS recurring_orders (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id         TEXT,
      business_id         TEXT,
      client_supabase_id  TEXT NOT NULL,
      nombre              TEXT NOT NULL,
      dia_semana          INTEGER,
      items_json          TEXT NOT NULL,
      total_estimado      REAL,
      whatsapp_confirmar  INTEGER NOT NULL DEFAULT 1,
      last_sent_at        TEXT,
      active              INTEGER NOT NULL DEFAULT 1,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_sup ON recurring_orders(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_recurring_biz_dia ON recurring_orders(business_id, dia_semana, active)`,
    `CREATE TRIGGER IF NOT EXISTS trg_recurring_updated_at
       AFTER UPDATE ON recurring_orders FOR EACH ROW
       BEGIN UPDATE recurring_orders SET updated_at = datetime('now') WHERE id = NEW.id; END`,

    // Multi-scale registry
    `CREATE TABLE IF NOT EXISTS carniceria_scales (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id       TEXT,
      business_id       TEXT,
      nombre            TEXT NOT NULL,
      tipo              TEXT NOT NULL,
      device_path       TEXT,
      protocol          TEXT DEFAULT 'generic',
      baud_rate         INTEGER DEFAULT 9600,
      capacidad_max_lb  REAL,
      tare_default      REAL DEFAULT 0,
      active_default    INTEGER NOT NULL DEFAULT 0,
      active            INTEGER NOT NULL DEFAULT 1,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_scales_sup ON carniceria_scales(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_scales_biz ON carniceria_scales(business_id, active)`,
    `CREATE TRIGGER IF NOT EXISTS trg_scales_updated_at
       AFTER UPDATE ON carniceria_scales FOR EACH ROW
       BEGIN UPDATE carniceria_scales SET updated_at = datetime('now') WHERE id = NEW.id; END`,

    // Generic promotions (used by all verticals; carnicería seeds DR seasonal)
    `CREATE TABLE IF NOT EXISTS promotions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id     TEXT,
      business_id     TEXT,
      name            TEXT NOT NULL,
      tipo            TEXT NOT NULL,
      discount_pct    REAL,
      discount_fixed  REAL,
      min_purchase    REAL,
      start_date      TEXT,
      end_date        TEXT,
      season_key      TEXT,
      banner_text     TEXT,
      active          INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_promos_sup ON promotions(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_promos_biz ON promotions(business_id, active)`,
    `CREATE INDEX IF NOT EXISTS idx_promos_window ON promotions(business_id, start_date, end_date)`,
    `CREATE TRIGGER IF NOT EXISTS trg_promos_updated_at
       AFTER UPDATE ON promotions FOR EACH ROW
       BEGIN UPDATE promotions SET updated_at = datetime('now') WHERE id = NEW.id; END`,

    `CREATE TABLE IF NOT EXISTS promotion_items (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id            TEXT,
      promotion_id           INTEGER REFERENCES promotions(id) ON DELETE CASCADE,
      promotion_supabase_id  TEXT NOT NULL,
      item_type              TEXT NOT NULL,
      item_supabase_id       TEXT NOT NULL,
      created_at             TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_items_sup ON promotion_items(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_promo_items_promo ON promotion_items(promotion_supabase_id)`,
    `CREATE TRIGGER IF NOT EXISTS trg_promo_items_updated_at
       AFTER UPDATE ON promotion_items FOR EACH ROW
       BEGIN UPDATE promotion_items SET updated_at = datetime('now') WHERE id = NEW.id; END`,

    // ── v2.16.0 — Taller Mecánico hardening ──────────────────────────────────
    `ALTER TABLE work_orders ADD COLUMN aseguradora_supabase_id TEXT`,
    `ALTER TABLE work_orders ADD COLUMN poliza_no TEXT`,
    `ALTER TABLE work_orders ADD COLUMN reclamo_no TEXT`,
    `ALTER TABLE work_orders ADD COLUMN aseguradora_status TEXT`,
    `ALTER TABLE work_orders ADD COLUMN started_at TEXT`,
    `ALTER TABLE work_orders ADD COLUMN finished_at TEXT`,
    `ALTER TABLE work_orders ADD COLUMN ready_at TEXT`,
    `ALTER TABLE work_orders ADD COLUMN delivery_required INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE work_orders ADD COLUMN delivery_fee REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE work_orders ADD COLUMN validity_until TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_work_orders_aseguradora ON work_orders(aseguradora_supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_work_orders_validity_until ON work_orders(validity_until)`,

    `CREATE TABLE IF NOT EXISTS aseguradoras (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id        TEXT,
      business_id        TEXT,
      nombre             TEXT NOT NULL,
      rnc                TEXT,
      contacto_telefono  TEXT,
      contacto_email     TEXT,
      ecf_mode           TEXT NOT NULL DEFAULT 'per_wo',
      notas              TEXT,
      active             INTEGER NOT NULL DEFAULT 1,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_aseguradoras_supabase_id ON aseguradoras(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_aseguradoras_biz_active ON aseguradoras(business_id, active)`,
    `CREATE TRIGGER IF NOT EXISTS trg_aseguradoras_updated_at
       AFTER UPDATE ON aseguradoras FOR EACH ROW
       BEGIN UPDATE aseguradoras SET updated_at = datetime('now') WHERE id = NEW.id; END`,

    `CREATE TABLE IF NOT EXISTS suppliers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id  TEXT,
      business_id  TEXT,
      nombre       TEXT NOT NULL,
      rnc          TEXT,
      telefono     TEXT,
      contacto     TEXT,
      notas        TEXT,
      active       INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_supabase_id ON suppliers(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_suppliers_biz_active ON suppliers(business_id, active)`,
    `CREATE TRIGGER IF NOT EXISTS trg_suppliers_updated_at
       AFTER UPDATE ON suppliers FOR EACH ROW
       BEGIN UPDATE suppliers SET updated_at = datetime('now') WHERE id = NEW.id; END`,

    `CREATE TABLE IF NOT EXISTS parts_orders (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id              TEXT,
      business_id              TEXT,
      work_order_supabase_id   TEXT,
      supplier_supabase_id     TEXT,
      part_name                TEXT NOT NULL,
      part_sku                 TEXT,
      quantity                 REAL NOT NULL DEFAULT 1,
      unit_cost_estimate       REAL NOT NULL DEFAULT 0,
      expected_at              TEXT,
      received_at              TEXT,
      received_barcode         TEXT,
      status                   TEXT NOT NULL DEFAULT 'pendiente',
      notes                    TEXT,
      created_at               TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_orders_supabase_id ON parts_orders(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_parts_orders_biz_status ON parts_orders(business_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_parts_orders_wo ON parts_orders(work_order_supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_parts_orders_barcode ON parts_orders(business_id, received_barcode)`,
    `CREATE TRIGGER IF NOT EXISTS trg_parts_orders_updated_at
       AFTER UPDATE ON parts_orders FOR EACH ROW
       BEGIN UPDATE parts_orders SET updated_at = datetime('now') WHERE id = NEW.id; END`,

    `CREATE TABLE IF NOT EXISTS work_order_photos (
      id                              INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id                     TEXT,
      business_id                     TEXT,
      work_order_supabase_id          TEXT,
      vehicle_supabase_id             TEXT,
      phase                           TEXT NOT NULL,
      storage_path                    TEXT NOT NULL,
      taken_by_empleado_supabase_id   TEXT,
      caption                         TEXT,
      created_at                      TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_wo_photos_supabase_id ON work_order_photos(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_wo_photos_wo ON work_order_photos(work_order_supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_wo_photos_vehicle ON work_order_photos(vehicle_supabase_id)`,

    `CREATE TABLE IF NOT EXISTS insurance_batches (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id              TEXT,
      business_id              TEXT,
      aseguradora_supabase_id  TEXT NOT NULL,
      period_month             TEXT NOT NULL,
      ecf_supabase_id          TEXT,
      ecf_ncf                  TEXT,
      total_amount             REAL NOT NULL DEFAULT 0,
      itbis_amount             REAL NOT NULL DEFAULT 0,
      pdf_storage_path         TEXT,
      work_order_count         INTEGER NOT NULL DEFAULT 0,
      status                   TEXT NOT NULL DEFAULT 'borrador',
      notes                    TEXT,
      created_at               TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_insurance_batches_supabase_id ON insurance_batches(supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_insurance_batches_biz_period ON insurance_batches(business_id, aseguradora_supabase_id, period_month)`,
    `CREATE TRIGGER IF NOT EXISTS trg_insurance_batches_updated_at
       AFTER UPDATE ON insurance_batches FOR EACH ROW
       BEGIN UPDATE insurance_batches SET updated_at = datetime('now') WHERE id = NEW.id; END`,
    // v2.16.2 — concesionario compliance: capture WHY an anecf was queued so the
    // owner Actividad feed can distinguish a manual void from a deal_close_failed
    // compensation. Guarded ALTER — silently no-ops if column already exists.
    "ALTER TABLE anecf_queue ADD COLUMN reason TEXT",

    // v2.16.x FIX-H5 — Mecánica: freeze comisión at WO close. Mirrors the
    // seller_commissions / cajero_commissions pattern. Stamped once at close
    // so retroactive `commission_pct` edits don't rewrite historical payroll.
    `CREATE TABLE IF NOT EXISTS mechanic_commissions (
      id                                 INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id                        TEXT,
      business_id                        TEXT,
      work_order_supabase_id             TEXT NOT NULL,
      technician_empleado_supabase_id    TEXT NOT NULL,
      ticket_supabase_id                 TEXT,
      base_amount                        REAL NOT NULL DEFAULT 0,
      commission_pct                     REAL NOT NULL DEFAULT 0,
      calc_amount                        REAL NOT NULL DEFAULT 0,
      paid                               INTEGER NOT NULL DEFAULT 0,
      paid_at                            TEXT,
      paid_by_supabase_id                TEXT,
      manual_reason                      TEXT,
      created_at                         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                         TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_mech_comm_supabase_id ON mechanic_commissions(supabase_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_mech_comm_wo_tech ON mechanic_commissions(business_id, work_order_supabase_id, technician_empleado_supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mech_comm_biz_paid ON mechanic_commissions(business_id, paid, created_at DESC)`,
    `CREATE TRIGGER IF NOT EXISTS trg_mech_comm_updated_at
       AFTER UPDATE ON mechanic_commissions FOR EACH ROW
       BEGIN UPDATE mechanic_commissions SET updated_at = datetime('now') WHERE id = NEW.id; END`,

    // v2.16.3 — Restaurante: recetas (Bill-of-Materials per service). At
    // ticket close the close path multiplies qty_per_unit × line qty and
    // decrements the linked inventory item via inventoryAdjust(). Failures
    // are logged as `recipe_inventory_skip` and never block the sale.
    `CREATE TABLE IF NOT EXISTS service_recipe_items (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id                 TEXT,
      business_id                 TEXT,
      service_id                  INTEGER,
      service_supabase_id         TEXT,
      inventory_item_id           INTEGER,
      inventory_item_supabase_id  TEXT,
      qty_per_unit                REAL NOT NULL DEFAULT 0,
      created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_service_recipe_items_supabase_id ON service_recipe_items(supabase_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_service_recipe_items_biz_svc_inv
       ON service_recipe_items(business_id, service_supabase_id, inventory_item_supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_service_recipe_items_svc ON service_recipe_items(service_supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_service_recipe_items_inv ON service_recipe_items(inventory_item_supabase_id)`,
    `CREATE TRIGGER IF NOT EXISTS trg_service_recipe_items_updated_at
       AFTER UPDATE ON service_recipe_items FOR EACH ROW
       BEGIN UPDATE service_recipe_items SET updated_at = datetime('now') WHERE id = NEW.id; END`,

    // v2.16.x — Ofertas (product bundles): bundle multiple services / inventory
    // items at a custom promo price. At sale time POS explodes into component
    // ticket_items + a discount line, with each line tagged via
    // ticket_items.oferta_supabase_id for reporting / undo grouping.
    `CREATE TABLE IF NOT EXISTS ofertas (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id   TEXT UNIQUE,
      business_id   TEXT,
      name          TEXT NOT NULL,
      description   TEXT,
      price         REAL NOT NULL,
      active        INTEGER NOT NULL DEFAULT 1,
      starts_at     TEXT,
      ends_at       TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ofertas_biz_active ON ofertas(business_id, active)`,
    `CREATE TRIGGER IF NOT EXISTS trg_ofertas_updated_at
       AFTER UPDATE ON ofertas FOR EACH ROW
       BEGIN UPDATE ofertas SET updated_at = datetime('now') WHERE id = NEW.id; END`,

    `CREATE TABLE IF NOT EXISTS oferta_items (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id                 TEXT UNIQUE,
      business_id                 TEXT,
      oferta_supabase_id          TEXT NOT NULL,
      service_supabase_id         TEXT,
      inventory_item_supabase_id  TEXT,
      qty                         REAL NOT NULL DEFAULT 1,
      created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_oferta_items_oferta ON oferta_items(oferta_supabase_id)`,
    `CREATE INDEX IF NOT EXISTS idx_oferta_items_biz ON oferta_items(business_id)`,
    `CREATE TRIGGER IF NOT EXISTS trg_oferta_items_updated_at
       AFTER UPDATE ON oferta_items FOR EACH ROW
       BEGIN UPDATE oferta_items SET updated_at = datetime('now') WHERE id = NEW.id; END`,

    // ticket_items.oferta_supabase_id — tag each cart line with the parent
    // oferta so a single bundle sale can be reported / undone as a unit.
    "ALTER TABLE ticket_items ADD COLUMN oferta_supabase_id TEXT",

    // Food Truck (v2.17) — favorite stops + waste log + cuadre/ticket
    // breadcrumbs. All columns nullable so non-foodtruck tenants are untouched.
    `CREATE TABLE IF NOT EXISTS food_truck_locations (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id  TEXT UNIQUE,
      name         TEXT NOT NULL,
      lat          REAL,
      lng          REAL,
      notes        TEXT,
      active       INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_food_truck_locations_active ON food_truck_locations(active)`,
    `CREATE TRIGGER IF NOT EXISTS trg_food_truck_locations_updated_at
       AFTER UPDATE ON food_truck_locations FOR EACH ROW
       BEGIN UPDATE food_truck_locations SET updated_at = datetime('now') WHERE id = NEW.id; END`,

    `CREATE TABLE IF NOT EXISTS waste_log (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_id                 TEXT UNIQUE,
      inventory_item_id           INTEGER REFERENCES inventory_items(id),
      inventory_item_supabase_id  TEXT,
      qty                         REAL NOT NULL,
      unit                        TEXT,
      reason                      TEXT NOT NULL,
      photo_url                   TEXT,
      occurred_at                 TEXT NOT NULL DEFAULT (datetime('now')),
      cuadre_id                   INTEGER,
      cuadre_supabase_id          TEXT,
      created_by                  TEXT,
      created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_waste_log_occurred ON waste_log(occurred_at)`,
    `CREATE INDEX IF NOT EXISTS idx_waste_log_item ON waste_log(inventory_item_supabase_id)`,
    `CREATE TRIGGER IF NOT EXISTS trg_waste_log_updated_at
       AFTER UPDATE ON waste_log FOR EACH ROW
       BEGIN UPDATE waste_log SET updated_at = datetime('now') WHERE id = NEW.id; END`,

    "ALTER TABLE cuadre_caja ADD COLUMN start_location_supabase_id TEXT",
    "ALTER TABLE cuadre_caja ADD COLUMN start_lat REAL",
    "ALTER TABLE cuadre_caja ADD COLUMN start_lng REAL",
    "ALTER TABLE cuadre_caja ADD COLUMN start_notes TEXT",
    "ALTER TABLE tickets ADD COLUMN food_truck_location_supabase_id TEXT",
    // v2.17.9 (2026-05-18) — sync was failing on Ranoza's first desktop install
    // because notas_credito locally has only the integer FK original_ticket_id
    // but Supabase has both that and the UUID FK original_ticket_supabase_id.
    // The local pullUpsertRow threw "no such column: original_ticket_supabase_id".
    "ALTER TABLE notas_credito ADD COLUMN original_ticket_supabase_id TEXT",
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
  // FIX-HIGH-5 (v2.16.7): also skip bump when the UPDATE supplies a DIFFERENT
  // updated_at than the existing row — that means the write came from sync's
  // pull upsert which carries the authoritative remote timestamp. Bumping it
  // to local now() would corrupt the LWW comparison cursor and trigger an
  // immediate re-push of the row we just pulled.
  try {
    db.exec(`DROP TRIGGER IF EXISTS trg_app_settings_updated_at`)
    db.exec(`CREATE TRIGGER trg_app_settings_updated_at AFTER UPDATE ON app_settings
             FOR EACH ROW
             WHEN NEW.value IS NOT OLD.value
              AND (NEW.updated_at IS OLD.updated_at OR NEW.updated_at IS NULL)
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

  // v2.16.3 H4 — Restaurant front-of-house reservations. Mirrors the
  // Supabase migration in migrations/2026_04_26_restaurant_reservations.sql.
  // Idempotent — safe to run on every boot.
  db.exec(`CREATE TABLE IF NOT EXISTS restaurant_reservations (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                 TEXT,
    business_id                 TEXT,
    mesa_id                     INTEGER,
    mesa_supabase_id            TEXT,
    fecha                       TEXT NOT NULL,
    hora                        TEXT NOT NULL,
    duration_min                INTEGER NOT NULL DEFAULT 90,
    nombre                      TEXT NOT NULL,
    telefono                    TEXT,
    guests                      INTEGER NOT NULL DEFAULT 2 CHECK (guests > 0),
    notas                       TEXT,
    status                      TEXT NOT NULL DEFAULT 'pendiente'
                                CHECK (status IN ('pendiente','confirmada','sentada','cancelada','no_show')),
    whatsapp_sent_at            TEXT,
    cancelled_reason            TEXT,
    seated_ticket_supabase_id   TEXT,
    created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_reservations_supabase_id ON restaurant_reservations(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_restaurant_reservations_fecha ON restaurant_reservations(fecha, hora)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_restaurant_reservations_status ON restaurant_reservations(status)') } catch {}

  // H2 — Restaurant: Servicio (10%) distribution among empleados. v2.16.3
  // ships ONE row per ticket where the entire amount routes to the waiter.
  // TODO v2.17: multi-empleado tip split by points (a points-weighted
  // distribution across waiters / busboys / kitchen).
  db.exec(`CREATE TABLE IF NOT EXISTS tip_distributions (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id              TEXT,
    ticket_id                INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
    ticket_supabase_id       TEXT,
    empleado_id              INTEGER REFERENCES empleados(id) ON DELETE SET NULL,
    empleado_supabase_id     TEXT,
    points                   REAL NOT NULL DEFAULT 1,
    amount                   REAL NOT NULL DEFAULT 0,
    business_id              TEXT,
    created_at               TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  // ── Phase 1B — Contabilidad firm-side suite (desktop parity) ───────────────
  // Mirrors migrations/2026_05_01_contabilidad_phase1.sql column-for-column.
  // SQLite type translation: UUID→TEXT, TIMESTAMPTZ→TEXT (ISO8601),
  // JSONB→TEXT (JSON), BOOLEAN→INTEGER (0/1), DECIMAL/NUMERIC→REAL.
  // FK across devices: schema deployed in Phase 1A uses BIGINT
  // accounting_client_id (auto-increment per side). Cross-device firms with
  // multiple desktops should treat this as single-device-of-truth until
  // Phase 2 introduces accounting_client_supabase_id to the public schema.
  // Idempotent — safe to run on every boot.
  db.exec(`CREATE TABLE IF NOT EXISTS accounting_clients (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                 TEXT,
    business_id                 TEXT,
    client_business_supabase_id TEXT,
    nombre_comercial            TEXT NOT NULL DEFAULT '',
    rnc                         TEXT,
    cedula                      TEXT,
    tipo_persona                TEXT NOT NULL DEFAULT 'pj' CHECK (tipo_persona IN ('pf','pj','eirl')),
    regimen                     TEXT NOT NULL DEFAULT 'ordinario',
    fecha_cierre_mes            INTEGER,
    fecha_cierre_dia            INTEGER,
    honorarios_mensuales        REAL NOT NULL DEFAULT 0,
    currency                    TEXT NOT NULL DEFAULT 'DOP',
    assigned_to_user_id         INTEGER,
    status                      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
    notes                       TEXT,
    created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_clients_supabase_id ON accounting_clients(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_clients_status ON accounting_clients(status)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_inbox (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                 TEXT,
    business_id                 TEXT,
    accounting_client_id        INTEGER,
    source                      TEXT NOT NULL DEFAULT 'dropzone' CHECK (source IN ('dropzone','email','whatsapp','api')),
    original_filename           TEXT NOT NULL DEFAULT 'sin-nombre',
    mime                        TEXT NOT NULL DEFAULT 'application/octet-stream',
    size                        INTEGER NOT NULL DEFAULT 0,
    r2_key                      TEXT,
    ocr_status                  TEXT NOT NULL DEFAULT 'pending' CHECK (ocr_status IN ('pending','done','failed')),
    ocr_text                    TEXT,
    classified_type             TEXT NOT NULL DEFAULT 'otro' CHECK (classified_type IN ('ecf_xml','factura_pdf','retencion','banco_estado','tss','csv','contrato','otro')),
    classification_confidence   REAL NOT NULL DEFAULT 0,
    status                      TEXT NOT NULL DEFAULT 'unclassified' CHECK (status IN ('unclassified','classified','posted','archived')),
    posted_journal_entry_id     INTEGER,
    posted_at                   TEXT,
    notes                       TEXT,
    created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_inbox_supabase_id ON accounting_inbox(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_inbox_status ON accounting_inbox(status)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_inbox_client ON accounting_inbox(accounting_client_id)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_obligations_calendar (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                 TEXT,
    business_id                 TEXT,
    accounting_client_id        INTEGER NOT NULL,
    form_type                   TEXT NOT NULL,
    period_year                 INTEGER NOT NULL,
    period_month                INTEGER NOT NULL DEFAULT 0,
    due_date                    TEXT NOT NULL,
    status                      TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','en_revision','firmado','radicado','pagado','vencido')),
    filed_at                    TEXT,
    filed_by_user_id            INTEGER,
    dgii_constancia_no          TEXT,
    attachment_supabase_id      TEXT,
    notes                       TEXT,
    created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(business_id, accounting_client_id, form_type, period_year, period_month)
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_obl_supabase_id ON accounting_obligations_calendar(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_obl_due ON accounting_obligations_calendar(due_date)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_obl_client ON accounting_obligations_calendar(accounting_client_id)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_documents (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                 TEXT,
    business_id                 TEXT,
    accounting_client_id        INTEGER,
    category                    TEXT NOT NULL DEFAULT 'otro',
    period_year                 INTEGER,
    period_month                INTEGER,
    filename                    TEXT NOT NULL DEFAULT 'sin-nombre',
    r2_key                      TEXT,
    mime                        TEXT NOT NULL DEFAULT 'application/octet-stream',
    size                        INTEGER NOT NULL DEFAULT 0,
    uploaded_by_user_id         INTEGER,
    expires_at                  TEXT,
    tags                        TEXT,
    notes                       TEXT,
    created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_docs_supabase_id ON accounting_documents(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_docs_client ON accounting_documents(accounting_client_id)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_billing_plans (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                 TEXT,
    business_id                 TEXT,
    accounting_client_id        INTEGER,
    monthly_amount              REAL NOT NULL DEFAULT 0,
    currency                    TEXT NOT NULL DEFAULT 'DOP',
    bill_day                    INTEGER NOT NULL DEFAULT 1,
    ecf_type                    TEXT NOT NULL DEFAULT 'e32' CHECK (ecf_type IN ('e31','e32')),
    late_fee_pct                REAL NOT NULL DEFAULT 0,
    late_fee_after_days         INTEGER NOT NULL DEFAULT 0,
    active                      INTEGER NOT NULL DEFAULT 1,
    notes                       TEXT,
    created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_bp_supabase_id ON accounting_billing_plans(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_bp_client ON accounting_billing_plans(accounting_client_id)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_billing_invoices (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                 TEXT,
    business_id                 TEXT,
    accounting_client_id        INTEGER,
    ticket_supabase_id          TEXT,
    period_year                 INTEGER NOT NULL,
    period_month                INTEGER NOT NULL,
    amount                      REAL NOT NULL DEFAULT 0,
    currency                    TEXT NOT NULL DEFAULT 'DOP',
    status                      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','paid','void')),
    ecf_track_id                TEXT,
    ecf_status                  TEXT,
    paid_at                     TEXT,
    created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_inv_supabase_id ON accounting_billing_invoices(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_inv_period ON accounting_billing_invoices(period_year DESC, period_month DESC)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_inv_client ON accounting_billing_invoices(accounting_client_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_inv_status ON accounting_billing_invoices(status)') } catch {}
  try { db.exec('ALTER TABLE accounting_billing_invoices ADD COLUMN late_fee_amount REAL NOT NULL DEFAULT 0') } catch {}
  try { db.exec('ALTER TABLE accounting_billing_invoices ADD COLUMN paid_late INTEGER NOT NULL DEFAULT 0') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_csv_mappings (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                 TEXT,
    business_id                 TEXT,
    accounting_client_id        INTEGER,
    doc_type                    TEXT NOT NULL,
    name                        TEXT NOT NULL,
    mapping_json                TEXT NOT NULL,
    created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_csv_supabase_id ON accounting_csv_mappings(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_csv_client ON accounting_csv_mappings(accounting_client_id)') } catch {}

  // Phase 2 Slice 1 — accounting_client_supabase_id companion column on every
  // Phase 1 child table that references accounting_clients(id). Lets cross-
  // device firms resolve FKs via the UUID after a desktop rebuild and lets
  // web/desktop dual-key joins land. Idempotent ALTER TABLE — duplicate column
  // throws and is swallowed.
  for (const t of [
    'accounting_inbox',
    'accounting_obligations_calendar',
    'accounting_documents',
    'accounting_billing_plans',
    'accounting_billing_invoices',
    'accounting_csv_mappings',
  ]) {
    try { db.exec(`ALTER TABLE ${t} ADD COLUMN accounting_client_supabase_id TEXT`) } catch {}
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_acc_cli_sid ON ${t}(accounting_client_supabase_id)`) } catch {}
  }

  // ── Phase 2 Slice 1 — Contabilidad full firm-side schema ─────────────────
  // 14 new tables: COA + journal + auto-post rules, bank reconciliation,
  // fixed assets, retentions emitidas/recibidas, payroll periods/lines,
  // TSS filings, tasks, foreign payments. Mirrors
  // migrations/2026_05_02_contabilidad_phase2.sql column-for-column.
  // Type translation: UUID→TEXT, NUMERIC→REAL, BOOLEAN→INTEGER, JSONB→TEXT.
  // Idempotent — safe to re-run on every boot.

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_chart_of_accounts (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                     TEXT,
    business_id                     TEXT,
    accounting_client_id            INTEGER,
    accounting_client_supabase_id   TEXT,
    code                            TEXT NOT NULL,
    parent_id                       INTEGER,
    parent_supabase_id              TEXT,
    name                            TEXT NOT NULL DEFAULT '',
    type                            TEXT NOT NULL DEFAULT 'activo' CHECK (type IN ('activo','pasivo','patrimonio','ingreso','costo','gasto')),
    is_postable                     INTEGER NOT NULL DEFAULT 1,
    currency                        TEXT NOT NULL DEFAULT 'DOP',
    notes                           TEXT,
    created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_coa_supabase_id ON accounting_chart_of_accounts(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_coa_biz ON accounting_chart_of_accounts(business_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_coa_client ON accounting_chart_of_accounts(accounting_client_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_coa_parent ON accounting_chart_of_accounts(parent_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_coa_code ON accounting_chart_of_accounts(accounting_client_id, code)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_journal_entries (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                     TEXT,
    business_id                     TEXT,
    accounting_client_id            INTEGER,
    accounting_client_supabase_id   TEXT,
    fecha                           TEXT,
    description                     TEXT,
    type                            TEXT NOT NULL DEFAULT 'manual' CHECK (type IN ('manual','auto_sales','auto_purchase','auto_payroll','auto_depreciation','adjustment','closing')),
    reference_doc_supabase_id       TEXT,
    status                          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')),
    posted_by_user_id               INTEGER,
    period_year                     INTEGER,
    period_month                    INTEGER,
    totals_debit                    REAL NOT NULL DEFAULT 0,
    totals_credit                   REAL NOT NULL DEFAULT 0,
    created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_je_supabase_id ON accounting_journal_entries(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_je_biz ON accounting_journal_entries(business_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_je_client ON accounting_journal_entries(accounting_client_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_je_period ON accounting_journal_entries(accounting_client_id, period_year DESC, period_month DESC)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_je_fecha ON accounting_journal_entries(fecha)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_journal_lines (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                     TEXT,
    business_id                     TEXT,
    journal_entry_id                INTEGER,
    journal_entry_supabase_id       TEXT,
    account_id                      INTEGER,
    account_supabase_id             TEXT,
    debit                           REAL NOT NULL DEFAULT 0,
    credit                          REAL NOT NULL DEFAULT 0,
    currency                        TEXT NOT NULL DEFAULT 'DOP',
    exchange_rate                   REAL NOT NULL DEFAULT 1,
    memo                            TEXT,
    created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_jl_supabase_id ON accounting_journal_lines(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_jl_biz ON accounting_journal_lines(business_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_jl_entry ON accounting_journal_lines(journal_entry_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_jl_account ON accounting_journal_lines(account_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_jl_entry_account ON accounting_journal_lines(journal_entry_id, account_id)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_coa_auto_post_rules (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                     TEXT,
    business_id                     TEXT,
    accounting_client_id            INTEGER,
    accounting_client_supabase_id   TEXT,
    event                           TEXT NOT NULL CHECK (event IN ('sale','purchase','payment','refund','payroll','depreciation')),
    condition_json                  TEXT,
    debit_account_id                INTEGER,
    debit_account_supabase_id       TEXT,
    credit_account_id               INTEGER,
    credit_account_supabase_id      TEXT,
    priority                        INTEGER NOT NULL DEFAULT 100,
    active                          INTEGER NOT NULL DEFAULT 1,
    created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_apr_supabase_id ON accounting_coa_auto_post_rules(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_apr_biz ON accounting_coa_auto_post_rules(business_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_apr_client ON accounting_coa_auto_post_rules(accounting_client_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_apr_event ON accounting_coa_auto_post_rules(accounting_client_id, event, priority)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_bank_accounts (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                     TEXT,
    business_id                     TEXT,
    accounting_client_id            INTEGER,
    accounting_client_supabase_id   TEXT,
    banco                           TEXT NOT NULL DEFAULT 'otro' CHECK (banco IN ('bhd_leon','banreservas','banco_popular','scotiabank','otro')),
    account_no_last4                TEXT,
    account_type                    TEXT NOT NULL DEFAULT 'checking' CHECK (account_type IN ('checking','savings')),
    currency                        TEXT NOT NULL DEFAULT 'DOP',
    opening_balance                 REAL NOT NULL DEFAULT 0,
    active                          INTEGER NOT NULL DEFAULT 1,
    created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_ba_supabase_id ON accounting_bank_accounts(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_ba_biz ON accounting_bank_accounts(business_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_ba_client ON accounting_bank_accounts(accounting_client_id)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_bank_statement_lines (
    id                                INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                       TEXT,
    business_id                       TEXT,
    bank_account_id                   INTEGER,
    bank_account_supabase_id          TEXT,
    fecha                             TEXT,
    descripcion                       TEXT,
    referencia                        TEXT,
    debit                             REAL NOT NULL DEFAULT 0,
    credit                            REAL NOT NULL DEFAULT 0,
    balance                           REAL,
    matched_journal_line_id           INTEGER,
    matched_journal_line_supabase_id  TEXT,
    match_status                      TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','matched','ignored','adjustment')),
    raw_row                           TEXT,
    created_at                        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                        TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_bsl_supabase_id ON accounting_bank_statement_lines(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_bsl_biz ON accounting_bank_statement_lines(business_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_bsl_account ON accounting_bank_statement_lines(bank_account_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_bsl_status ON accounting_bank_statement_lines(bank_account_id, match_status)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_fixed_assets (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                     TEXT,
    business_id                     TEXT,
    accounting_client_id            INTEGER,
    accounting_client_supabase_id   TEXT,
    name                            TEXT NOT NULL DEFAULT '',
    categoria                       TEXT NOT NULL DEFAULT 'cat_2' CHECK (categoria IN ('cat_1','cat_2','cat_3')),
    fecha_adquisicion               TEXT,
    costo                           REAL NOT NULL DEFAULT 0,
    vida_util_meses                 INTEGER NOT NULL DEFAULT 0,
    valor_residual                  REAL NOT NULL DEFAULT 0,
    depreciacion_acumulada          REAL NOT NULL DEFAULT 0,
    status                          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold','written_off')),
    sold_at                         TEXT,
    sold_amount                     REAL,
    notes                           TEXT,
    created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_fa_supabase_id ON accounting_fixed_assets(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_fa_biz ON accounting_fixed_assets(business_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_fa_client ON accounting_fixed_assets(accounting_client_id)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_retentions_emitidas (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                     TEXT,
    business_id                     TEXT,
    accounting_client_id            INTEGER,
    accounting_client_supabase_id   TEXT,
    fecha                           TEXT,
    beneficiario_rnc                TEXT,
    beneficiario_nombre             TEXT,
    tipo                            TEXT NOT NULL DEFAULT 'servicios_no_dom' CHECK (tipo IN ('alquiler','honorarios','dividendos','servicios_no_dom')),
    base                            REAL NOT NULL DEFAULT 0,
    tasa                            REAL NOT NULL DEFAULT 0,
    retencion                       REAL NOT NULL DEFAULT 0,
    ncf_emitido                     TEXT,
    comprobante_url                 TEXT,
    created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_re_supabase_id ON accounting_retentions_emitidas(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_re_biz ON accounting_retentions_emitidas(business_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_re_client ON accounting_retentions_emitidas(accounting_client_id)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_retentions_recibidas (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                     TEXT,
    business_id                     TEXT,
    accounting_client_id            INTEGER,
    accounting_client_supabase_id   TEXT,
    fecha                           TEXT,
    retenedor_rnc                   TEXT,
    retenedor_nombre                TEXT,
    tipo                            TEXT,
    base                            REAL NOT NULL DEFAULT 0,
    tasa                            REAL NOT NULL DEFAULT 0,
    retencion                       REAL NOT NULL DEFAULT 0,
    comprobante_url                 TEXT,
    created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_rr_supabase_id ON accounting_retentions_recibidas(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_rr_biz ON accounting_retentions_recibidas(business_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_rr_client ON accounting_retentions_recibidas(accounting_client_id)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_payroll_periods (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                     TEXT,
    business_id                     TEXT,
    accounting_client_id            INTEGER,
    accounting_client_supabase_id   TEXT,
    year                            INTEGER NOT NULL,
    month                           INTEGER NOT NULL,
    status                          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','paid')),
    totals_json                     TEXT,
    created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_pp_supabase_id ON accounting_payroll_periods(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_pp_biz ON accounting_payroll_periods(business_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_pp_client ON accounting_payroll_periods(accounting_client_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_pp_period ON accounting_payroll_periods(accounting_client_id, year DESC, month DESC)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_payroll_lines (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                     TEXT,
    business_id                     TEXT,
    payroll_period_id               INTEGER,
    payroll_period_supabase_id      TEXT,
    employee_name                   TEXT,
    employee_cedula                 TEXT,
    employee_nss                    TEXT,
    salario_base                    REAL NOT NULL DEFAULT 0,
    dependientes                    INTEGER NOT NULL DEFAULT 0,
    afp                             REAL NOT NULL DEFAULT 0,
    ars                             REAL NOT NULL DEFAULT 0,
    sfs                             REAL NOT NULL DEFAULT 0,
    riesgos_laborales               REAL NOT NULL DEFAULT 0,
    isr                             REAL NOT NULL DEFAULT 0,
    otras_deducciones               REAL NOT NULL DEFAULT 0,
    neto                            REAL NOT NULL DEFAULT 0,
    created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_pl_supabase_id ON accounting_payroll_lines(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_pl_biz ON accounting_payroll_lines(business_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_pl_period ON accounting_payroll_lines(payroll_period_id)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_tss_filings (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                     TEXT,
    business_id                     TEXT,
    accounting_client_id            INTEGER,
    accounting_client_supabase_id   TEXT,
    year                            INTEGER NOT NULL,
    month                           INTEGER NOT NULL,
    filename                        TEXT,
    file_supabase_id                TEXT,
    status                          TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','radicado')),
    created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_tss_supabase_id ON accounting_tss_filings(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_tss_biz ON accounting_tss_filings(business_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_tss_client ON accounting_tss_filings(accounting_client_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_tss_period ON accounting_tss_filings(accounting_client_id, year DESC, month DESC)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_tasks (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                     TEXT,
    business_id                     TEXT,
    accounting_client_id            INTEGER,
    accounting_client_supabase_id   TEXT,
    title                           TEXT NOT NULL DEFAULT '',
    description                     TEXT,
    assigned_to_user_id             INTEGER,
    status                          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','review','done')),
    priority                        TEXT NOT NULL DEFAULT 'med' CHECK (priority IN ('low','med','high')),
    due_date                        TEXT,
    parent_obligation_supabase_id   TEXT,
    created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_tk_supabase_id ON accounting_tasks(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_tk_biz ON accounting_tasks(business_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_tk_client ON accounting_tasks(accounting_client_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_tk_status ON accounting_tasks(accounting_client_id, status, due_date)') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS accounting_foreign_payments (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                     TEXT,
    business_id                     TEXT,
    accounting_client_id            INTEGER,
    accounting_client_supabase_id   TEXT,
    fecha                           TEXT,
    beneficiario_id                 TEXT,
    beneficiario_pais               TEXT,
    beneficiario_nombre             TEXT,
    tipo_renta                      TEXT,
    moneda                          TEXT NOT NULL DEFAULT 'USD',
    monto_moneda_pago               REAL NOT NULL DEFAULT 0,
    tasa_cambio                     REAL NOT NULL DEFAULT 1,
    monto_local                     REAL NOT NULL DEFAULT 0,
    isr_retenido                    REAL NOT NULL DEFAULT 0,
    created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_fp_supabase_id ON accounting_foreign_payments(supabase_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_fp_biz ON accounting_foreign_payments(business_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acc_fp_client ON accounting_foreign_payments(accounting_client_id)') } catch {}

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
    // H2 — tip_distributions
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_tip_distributions_supabase_id ON tip_distributions(supabase_id)',
    'CREATE INDEX IF NOT EXISTS idx_tip_distributions_ticket ON tip_distributions(ticket_id)',
    'CREATE INDEX IF NOT EXISTS idx_tip_distributions_empleado ON tip_distributions(empleado_id)',
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
  const triggerTables = ['businesses', 'services', 'washers', 'sellers', 'clients', 'inventory_items', 'tickets', 'empleados', 'ncf_sequences', 'ticket_items', 'queue', 'washer_commissions', 'seller_commissions', 'cajero_commissions', 'credit_payments', 'cuadre_caja', 'caja_chica', 'notas_credito', 'inventory_transactions', 'compras_607', 'categorias_servicio', 'users', 'salary_changes', 'payroll_runs', 'ecf_submissions', 'queue_deletions', 'activity_log', 'mesas', 'modificadores', 'service_modificadores', 'ticket_item_modificadores', 'kds_events', 'restaurant_reservations', 'vehicles', 'service_bays', 'work_orders', 'work_order_items', 'appointments', 'stylist_schedules', 'loans', 'loan_payments', 'pawn_items', 'subscriptions', 'service_packages', 'projects', 'client_service_rates', 'accounting_clients', 'accounting_inbox', 'accounting_obligations_calendar', 'accounting_documents', 'accounting_billing_plans', 'accounting_billing_invoices', 'accounting_csv_mappings', 'accounting_chart_of_accounts', 'accounting_journal_entries', 'accounting_journal_lines', 'accounting_coa_auto_post_rules', 'accounting_bank_accounts', 'accounting_bank_statement_lines', 'accounting_fixed_assets', 'accounting_retentions_emitidas', 'accounting_retentions_recibidas', 'accounting_payroll_periods', 'accounting_payroll_lines', 'accounting_tss_filings', 'accounting_tasks', 'accounting_foreign_payments']

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

  // v2.17.9 (2026-05-18) — Fresh-install schema-parity for empleados.
  // The main migrations array (~line 310-2057) runs BEFORE this CREATE TABLE,
  // so empleados-specific ALTER TABLEs there silently fail with
  // "no such table: empleados" on a clean install. Existing installs got
  // these columns via the migration loop because empleados existed from
  // a prior version. Ranoza's first-ever desktop install on 2026-05-18
  // surfaced the gap — sync.pull.empleados threw "no such column: updated_at"
  // 1,081 times in 5 minutes. Re-run the column ALTERs here, post-CREATE,
  // so fresh installs land on the full synced-table schema.
  const _empleadosPostCreate = [
    "ALTER TABLE empleados ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))",
    "ALTER TABLE empleados ADD COLUMN supabase_id TEXT",
    "ALTER TABLE empleados ADD COLUMN business_id TEXT",
    "ALTER TABLE empleados ADD COLUMN role TEXT DEFAULT 'none'",
    "ALTER TABLE empleados ADD COLUMN comision_pct REAL DEFAULT 0",
    "ALTER TABLE empleados ADD COLUMN puesto TEXT",
    "ALTER TABLE empleados ADD COLUMN email TEXT",
    "ALTER TABLE empleados ADD COLUMN bank_account TEXT",
    "ALTER TABLE empleados ADD COLUMN tss_id TEXT",
  ]
  for (const sql of _empleadosPostCreate) {
    try { db.exec(sql) } catch (e) {
      if (!(e.message || '').includes('duplicate column')) {
        console.warn('[db] empleados post-create migration warning:', e.message)
      }
    }
  }

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

  // ── Concesionario v2 / v2.5 — dealership tables ─────────────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS vehicle_inventory (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id        TEXT,
    stock_number       TEXT,
    vin                TEXT,
    make               TEXT,
    model              TEXT,
    year               INTEGER,
    color              TEXT,
    mileage            INTEGER DEFAULT 0,
    condition          TEXT DEFAULT 'used',
    acquisition_cost   REAL DEFAULT 0,
    listing_price      REAL DEFAULT 0,
    status             TEXT DEFAULT 'available',
    title_status       TEXT DEFAULT 'clean',
    photo_urls         TEXT,
    featured           INTEGER DEFAULT 0,
    notes              TEXT,
    listing_date       TEXT,
    sold_date          TEXT,
    active             INTEGER NOT NULL DEFAULT 1,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_inventory_supabase_id ON vehicle_inventory(supabase_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_vehicle_inventory_status ON vehicle_inventory(status, active)')

  db.exec(`CREATE TABLE IF NOT EXISTS sales_deals (
    id                            INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                   TEXT,
    client_id                     INTEGER,
    client_supabase_id            TEXT,
    vehicle_inventory_id          INTEGER,
    vehicle_inventory_supabase_id TEXT,
    salesperson_id                INTEGER,
    salesperson_supabase_id       TEXT,
    sale_price                    REAL DEFAULT 0,
    trade_in_vehicle_id           INTEGER,
    trade_in_supabase_id          TEXT,
    trade_in_value                REAL DEFAULT 0,
    down_payment                  REAL DEFAULT 0,
    financed_amount               REAL DEFAULT 0,
    term_months                   INTEGER DEFAULT 0,
    apr                           REAL DEFAULT 0,
    monthly_payment               REAL DEFAULT 0,
    commission_pct                REAL,
    commission_amount             REAL,
    commission_paid               INTEGER DEFAULT 0,
    commission_paid_at            TEXT,
    ticket_id                     INTEGER,
    ticket_supabase_id            TEXT,
    status                        TEXT DEFAULT 'open',
    notes                         TEXT,
    closed_at                     TEXT,
    active                        INTEGER NOT NULL DEFAULT 1,
    created_at                    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                    TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_deals_supabase_id ON sales_deals(supabase_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_sales_deals_status ON sales_deals(status, closed_at)')

  db.exec(`CREATE TABLE IF NOT EXISTS leads (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                     TEXT,
    name                            TEXT NOT NULL,
    phone                           TEXT,
    email                           TEXT,
    source                          TEXT DEFAULT 'walk_in',
    budget                          REAL,
    notes                           TEXT,
    stage                           TEXT DEFAULT 'lead',
    next_followup_at                TEXT,
    last_contacted_at               TEXT,
    interested_vehicle_supabase_id  TEXT,
    active                          INTEGER NOT NULL DEFAULT 1,
    created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_supabase_id ON leads(supabase_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage, active)')

  db.exec(`CREATE TABLE IF NOT EXISTS test_drives (
    id                            INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                   TEXT,
    client_id                     INTEGER,
    client_supabase_id            TEXT,
    vehicle_inventory_id          INTEGER,
    vehicle_inventory_supabase_id TEXT,
    staff_id                      INTEGER,
    staff_supabase_id             TEXT,
    scheduled_at                  TEXT,
    completed_at                  TEXT,
    license_number                TEXT,
    signed_waiver_url             TEXT,
    notes                         TEXT,
    outcome                       TEXT,
    outcome_notes                 TEXT,
    deal_supabase_id              TEXT,
    active                        INTEGER NOT NULL DEFAULT 1,
    created_at                    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                    TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_test_drives_supabase_id ON test_drives(supabase_id)')

  db.exec(`CREATE TABLE IF NOT EXISTS vehicle_documents (
    id                            INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                   TEXT,
    vehicle_inventory_supabase_id TEXT NOT NULL,
    doc_type                      TEXT NOT NULL,
    file_url                      TEXT NOT NULL,
    file_name                     TEXT,
    expires_at                    TEXT,
    notes                         TEXT,
    active                        INTEGER NOT NULL DEFAULT 1,
    uploaded_at                   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                    TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_documents_supabase_id ON vehicle_documents(supabase_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vehicle ON vehicle_documents(vehicle_inventory_supabase_id, active)')

  // Concesionario v2.1 — fiscal/AML markers + INTRANT titulo tracking.
  // Safe ALTERs: try/catch since ADD COLUMN fails when column already exists.
  const safeAlter = (sql) => { try { db.exec(sql) } catch {} }
  safeAlter('ALTER TABLE sales_deals ADD COLUMN dgii_e31_required INTEGER DEFAULT 0')
  safeAlter('ALTER TABLE sales_deals ADD COLUMN uaf_threshold_exceeded INTEGER DEFAULT 0')
  safeAlter('ALTER TABLE sales_deals ADD COLUMN uaf_report_url TEXT')
  safeAlter('ALTER TABLE sales_deals ADD COLUMN uaf_acknowledged_by TEXT')
  safeAlter('ALTER TABLE sales_deals ADD COLUMN uaf_acknowledged_at TEXT')

  db.exec(`CREATE TABLE IF NOT EXISTS vehicle_titulo (
    id                            INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                   TEXT,
    sales_deal_supabase_id        TEXT NOT NULL,
    vehicle_inventory_supabase_id TEXT,
    intrant_status                TEXT NOT NULL DEFAULT 'pendiente',
    placa                         TEXT,
    matricula_url                 TEXT,
    traspaso_initiated_at         TEXT,
    traspaso_completed_at         TEXT,
    notes                         TEXT,
    active                        INTEGER NOT NULL DEFAULT 1,
    created_at                    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                    TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_titulo_supabase_id ON vehicle_titulo(supabase_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_vehicle_titulo_deal ON vehicle_titulo(sales_deal_supabase_id, active)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_vehicle_titulo_status ON vehicle_titulo(intrant_status, active)')

  // v2.16.4 — Concesionario Sprint 2A H2: vehicle reservations with deposit + expiry.
  db.exec(`CREATE TABLE IF NOT EXISTS vehicle_reservations (
    id                            INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                   TEXT,
    vehicle_inventory_supabase_id TEXT,
    client_id                     INTEGER,
    client_supabase_id            TEXT,
    salesperson_id                INTEGER,
    salesperson_supabase_id       TEXT,
    deposit_amount                REAL DEFAULT 0,
    deposit_method                TEXT,
    expires_at                    TEXT NOT NULL,
    released_at                   TEXT,
    released_reason               TEXT,
    converted_deal_supabase_id    TEXT,
    status                        TEXT NOT NULL DEFAULT 'active',
    notes                         TEXT,
    active                        INTEGER NOT NULL DEFAULT 1,
    created_at                    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                    TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_reservations_supabase_id ON vehicle_reservations(supabase_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_vehicle_reservations_vehicle ON vehicle_reservations(vehicle_inventory_supabase_id, status, active)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_vehicle_reservations_expires ON vehicle_reservations(expires_at, status)')

  // v2.16.4 — Concesionario Sprint 2B H3: post-sale warranties (garantia 30/60/90d / 1yr).
  // claims is a TEXT JSON array — JSON.parse/stringify handled in the CRUD layer.
  db.exec(`CREATE TABLE IF NOT EXISTS vehicle_warranties (
    id                            INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                   TEXT,
    sales_deal_supabase_id        TEXT NOT NULL,
    vehicle_inventory_supabase_id TEXT,
    client_id                     INTEGER,
    client_supabase_id            TEXT,
    kind                          TEXT NOT NULL DEFAULT 'general',
    starts_at                     TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at                    TEXT NOT NULL,
    terms                         TEXT,
    claims                        TEXT NOT NULL DEFAULT '[]',
    status                        TEXT NOT NULL DEFAULT 'active',
    notes                         TEXT,
    active                        INTEGER NOT NULL DEFAULT 1,
    created_at                    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                    TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_warranties_supabase_id ON vehicle_warranties(supabase_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_vehicle_warranties_deal ON vehicle_warranties(sales_deal_supabase_id, active)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_vehicle_warranties_expires ON vehicle_warranties(expires_at, status, active)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_vehicle_warranties_status ON vehicle_warranties(status, active)')

  // v2.16.4 Sprint 2C — Concesionario bank pre-approvals (manual workflow).
  // status flow: solicitada → en_revision → pre_aprobada → utilizada (when
  // attached to a closed deal) | rechazada | expirada (auto by sweep when
  // expires_at < now AND status not in utilizada/rechazada).
  db.exec(`CREATE TABLE IF NOT EXISTS bank_preapprovals (
    id                            INTEGER PRIMARY KEY AUTOINCREMENT,
    supabase_id                   TEXT,
    client_id                     INTEGER,
    client_supabase_id            TEXT,
    lead_supabase_id              TEXT,
    vehicle_inventory_supabase_id TEXT,
    salesperson_id                INTEGER,
    salesperson_supabase_id       TEXT,
    bank                          TEXT NOT NULL,
    bank_contact                  TEXT,
    requested_amount              REAL NOT NULL DEFAULT 0,
    term_months                   INTEGER,
    rate_offered                  REAL,
    monthly_quota_offered         REAL,
    status                        TEXT NOT NULL DEFAULT 'solicitada',
    expires_at                    TEXT,
    decision_at                   TEXT,
    decision_letter_url           TEXT,
    notes                         TEXT,
    active                        INTEGER NOT NULL DEFAULT 1,
    created_at                    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at                    TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_preapprovals_supabase_id ON bank_preapprovals(supabase_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_bank_preapprovals_client ON bank_preapprovals(client_supabase_id, status, active)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_bank_preapprovals_status ON bank_preapprovals(status, active)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_bank_preapprovals_expires ON bank_preapprovals(expires_at, status, active)')
  // Safe ALTER — link the chosen pre-approval onto a closed deal so reports can join.
  try { db.exec('ALTER TABLE sales_deals ADD COLUMN bank_preapproval_supabase_id TEXT') } catch {}

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
  const row = db.prepare('SELECT id,name,rnc,address,phone,email,logo,settings,plan,mora_rate_daily FROM businesses WHERE id=1').get() ?? null
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
  const allowed = ['name', 'rnc', 'address', 'phone', 'email', 'logo', 'settings', 'plan', 'mora_rate_daily', 'updated_at']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  // Stamp updated_at on every save so sync.js LWW pull won't clobber a fresh
  // local edit before its async push has completed (user-close race). Caller
  // can pass an explicit updated_at to override (e.g. pullBusinessMeta carrying
  // remote's timestamp through). Fresh local edits always get NOW.
  if (!('updated_at' in patch)) patch.updated_at = new Date().toISOString()

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

// ── PRODUCTION GATE ───────────────────────────────────────────────────────────
// Master TEST → LIVE switch. While `go_live_date` is empty or in the future,
// the POS is in TEST MODE: tickets are flagged is_test=1, no commissions
// accrue, no client credit grants, no cloud push of sales rows, no DGII
// submission. Once the date is reached and goLiveCommit() runs, all is_test
// rows are wiped and the POS goes live.
function isProductionLive() {
  if (!db) return false
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key='go_live_date'").get()
    const v = row?.value
    if (!v) return false
    // ISO date YYYY-MM-DD; compare date-only against local today.
    const today = new Date(); today.setHours(0,0,0,0)
    const d = new Date(`${v}T00:00:00`)
    if (Number.isNaN(d.getTime())) return false
    return d.getTime() <= today.getTime()
  } catch { return false }
}

function testDataCount() {
  if (!db) return { tickets: 0, items: 0, payments: 0 }
  try {
    return {
      tickets:  db.prepare('SELECT COUNT(*) c FROM tickets WHERE is_test=1').get()?.c || 0,
      items:    db.prepare('SELECT COUNT(*) c FROM ticket_items WHERE ticket_id IN (SELECT id FROM tickets WHERE is_test=1)').get()?.c || 0,
      payments: (() => {
        try { return db.prepare('SELECT COUNT(*) c FROM ticket_payments WHERE ticket_id IN (SELECT id FROM tickets WHERE is_test=1)').get()?.c || 0 } catch { return 0 }
      })(),
    }
  } catch { return { tickets: 0, items: 0, payments: 0 } }
}

function wipeTestData() {
  if (!db) return { ticketsWiped: 0 }
  // Self-heal: ensure column exists before WHERE.
  try { db.exec('ALTER TABLE tickets ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0') } catch {}
  const tx = db.transaction(() => {
    const ids = db.prepare('SELECT id FROM tickets WHERE is_test=1').all().map(r => r.id)
    if (!ids.length) return { ticketsWiped: 0 }
    const placeholders = ids.map(() => '?').join(',')
    // Children — each guarded so a missing table doesn't abort the wipe.
    const childTables = [
      'ticket_items','ticket_payments','ticket_item_modificadores',
      'washer_commissions','seller_commissions','cajero_commissions',
    ]
    for (const t of childTables) {
      try { db.prepare(`DELETE FROM ${t} WHERE ticket_id IN (${placeholders})`).run(...ids) } catch {}
    }
    db.prepare(`DELETE FROM tickets WHERE id IN (${placeholders})`).run(...ids)
    return { ticketsWiped: ids.length }
  })
  return tx()
}

function goLiveCommit() {
  if (!db) return { ok: false }
  const wiped = wipeTestData()
  // Stamp commit time directly so we don't recurse through settingsUpdate.
  try {
    const stamp = new Date().toISOString()
    db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES('go_live_committed_at',?,datetime('now'))
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`).run(stamp)
  } catch {}
  return { ok: true, ...wiped }
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
  // v2.16.3 — bcryptComparePin now THROWS on engine failure (corrupted hash,
  // native lib crash). We must not let one bad row abort the loop, but we
  // also refuse to silently deny a valid PIN if the matching row was the
  // one that threw. So: capture the first throw, continue scanning, and if
  // no row matches at the end, surface the captured error to the IPC layer.
  let lastBcryptError = null

  for (const r of rows) {
    // Locked? Skip — neither a match nor a miss counts against this row.
    if (r.pin_locked_until && r.pin_locked_until > nowIso) continue

    // v2.14.20 — trust the hash FORMAT, not the algo column. Cloud pulls have
    // repeatedly delivered bcrypt hashes tagged sha256 (and vice versa); the
    // algo column is unreliable. Shape-detect and try both as a belt:
    //   bcrypt:  starts with '$2', length 60
    //   sha256:  64-char lowercase hex
    let hit = false
    const h = String(r.pin_hash || '')
    const looksBcrypt = h.startsWith('$2') && h.length === 60
    const looksSha256 = /^[0-9a-f]{64}$/.test(h)
    try {
      if (looksBcrypt) {
        hit = bcryptComparePin(pinStr, r.pin_salt, r.pin_hash)
      } else if (looksSha256) {
        hit = (r.pin_hash === legacyHash)
      } else {
        // Unknown shape — try both, last resort.
        hit = bcryptComparePin(pinStr, r.pin_salt, r.pin_hash) || (r.pin_hash === legacyHash)
      }
    } catch (cmpErr) {
      // Loud (already console.error'd inside bcryptComparePin). Track and
      // continue so we still scan the rest of the staff table.
      if (!lastBcryptError) lastBcryptError = cmpErr
      continue
    }

    if (hit) {
      matched = r
      break
    }
    incrementCandidates.push(r.id)
  }

  // No match AND a bcrypt engine failure was observed → surface it. Otherwise
  // a corrupted hash row would silently deny a valid PIN.
  if (!matched && lastBcryptError) throw lastBcryptError

  if (matched) {
    // Reset lockout counters + opportunistic rehash to bcrypt.
    const upgrade = db.transaction(() => {
      let newHash = matched.pin_hash
      let newSalt = matched.pin_salt
      const h = String(matched.pin_hash || '')
      const isBcrypt = h.startsWith('$2') && h.length === 60
      let newAlgo = isBcrypt ? 'bcrypt' : 'sha256'
      // Rehash to bcrypt whenever the stored hash isn't already bcrypt — this
      // also self-heals rows whose algo tag drifted out of sync with the hash.
      if (!isBcrypt) {
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
      // Auto-detect algo from hash format so an upstream forgetting to pass
      // pin_hash_algo doesn't silently re-introduce legacy drift.
      const h = String(data.pin_hash)
      const detected = (h.startsWith('$2') && h.length === 60) ? 'bcrypt'
                      : (/^[0-9a-f]{64}$/.test(h) ? 'sha256' : 'bcrypt')
      return {
        pin_hash: data.pin_hash,
        pin_hash_algo: data.pin_hash_algo || detected,
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
  const target = db.prepare('SELECT name, username, supabase_id, business_id FROM users WHERE id=?').get(id)
  const targetName = target ? `${target.name} (@${target.username})` : `#${id}`
  db.prepare('UPDATE users SET active=0, updated_at=datetime(?) WHERE id=?').run(new Date().toISOString(), id)
  if (target?.supabase_id) tombstoneAdd('staff', target.supabase_id, target.business_id)
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
// v2.16.3 — Top sellers ranked by ticket_items.quantity over the last `days`
// days for non-voided tickets. Mirrors the Postgres services_top_sellers RPC
// semantics exactly: dual-key join (service_id OR service_supabase_id),
// status NOT IN voided/anulado/nula, full service rows in qty-desc order.
// Returns same shape as servicesGetAll() so the UI renders through the
// same MenuItemCard.
function servicesTopSellers({ days = 30, limit = 8 } = {}) {
  if (!db) return []
  const since = new Date(Date.now() - Math.max(1, days) * 86400000).toISOString()
  const cap   = Math.max(1, Math.min(limit | 0, 50))
  return db.prepare(`
    SELECT s.*, agg.total_qty
    FROM services s
    JOIN (
      SELECT
        COALESCE(CAST(ti.service_id AS TEXT), ti.service_supabase_id) AS svc_key,
        SUM(COALESCE(ti.quantity, 1)) AS total_qty
      FROM ticket_items ti
      JOIN tickets t ON t.id = ti.ticket_id
      WHERE t.created_at >= ?
        AND t.status NOT IN ('voided','anulado','nula')
        AND (ti.service_id IS NOT NULL OR ti.service_supabase_id IS NOT NULL)
      GROUP BY 1
    ) agg ON agg.svc_key = COALESCE(CAST(s.id AS TEXT), s.supabase_id)
    WHERE s.active = 1
    ORDER BY agg.total_qty DESC
    LIMIT ?
  `).all(since, cap)
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
// v2.17.8 — Reference count for hard-delete pre-check. Counts ticket_items
// referencing this service via either the legacy integer service_id or the
// supabase_id UUID dual-key column. UI blocks hard-delete when > 0.
function serviceRefCount(id) {
  if (!db) return { count: 0 }
  const svc = db.prepare('SELECT id, supabase_id FROM services WHERE id=?').get(id)
  if (!svc) return { count: 0 }
  let total = 0
  try {
    const a = db.prepare('SELECT COUNT(*) AS c FROM ticket_items WHERE service_id=?').get(svc.id)
    total += Number(a?.c || 0)
  } catch {}
  if (svc.supabase_id) {
    try {
      const b = db.prepare('SELECT COUNT(*) AS c FROM ticket_items WHERE service_supabase_id=?').get(svc.supabase_id)
      total += Number(b?.c || 0)
    } catch {}
  }
  return { count: total }
}

function serviceDelete(id) {
  if (!db) return { deleted: false }
  // v2.14.20 — try hard DELETE first so the row actually disappears (owner
  // expectation: "delete = gone"). If the service has historical ticket_items
  // referencing it (FK), fall back to soft-delete. The cloud deletion is
  // handled by main.js after we return: it calls sync.supabaseDelete so the
  // row doesn't resurrect on the next pull.
  const svc = db.prepare('SELECT name, price, supabase_id FROM services WHERE id=?').get(id)
  if (!svc) return { deleted: false, error: 'Servicio no encontrado' }
  try {
    db.prepare('DELETE FROM services WHERE id=?').run(id)
    activityLogRecord({ event_type: 'service_deleted', severity: 'warn',
      target_type: 'service', target_id: id, target_name: svc?.name || `#${id}`,
      amount: svc?.price, metadata: { hard: true } })
    return { deleted: true, supabase_id: svc.supabase_id }
  } catch (e) {
    // 19 = SQLITE_CONSTRAINT — usually an FK from ticket_items. Soft-delete so
    // historical sales stay queryable and the row is hidden from POS.
    const fkBlocked = /FOREIGN KEY|constraint/i.test(e.message || '')
    if (!fkBlocked) throw e
    db.prepare('UPDATE services SET active=0, updated_at=? WHERE id=?').run(new Date().toISOString(), id)
    if (svc?.supabase_id) tombstoneAdd('services', svc.supabase_id, svc.business_id)
    activityLogRecord({ event_type: 'service_deleted', severity: 'warn',
      target_type: 'service', target_id: id, target_name: svc?.name || `#${id}`,
      amount: svc?.price, metadata: { soft: true, reason: 'has_history' } })
    return { softDeleted: true, supabase_id: svc.supabase_id }
  }
}
// v2.16.3 — 86-list toggle. Polymorphic key (numeric local id OR supabase_id
// UUID), so callers from web-synced rows (no local id yet) work too. Records
// to the activity log under service_set_oos / service_back_in_stock.
function serviceSetInStock(serviceKey, inStock) {
  if (!db) return { ok: false, error: 'db_unavailable' }
  const next = inStock ? 1 : 0
  const isUuid = typeof serviceKey === 'string' && /^[0-9a-f]{8}-/i.test(serviceKey)
  const row = isUuid
    ? db.prepare('SELECT id, supabase_id, name, in_stock FROM services WHERE supabase_id=?').get(serviceKey)
    : db.prepare('SELECT id, supabase_id, name, in_stock FROM services WHERE id=?').get(Number(serviceKey))
  if (!row) return { ok: false, error: 'not_found' }
  if ((row.in_stock ?? 1) === next) return { ok: true, unchanged: true, id: row.id, supabase_id: row.supabase_id, in_stock: next }
  db.prepare('UPDATE services SET in_stock=?, updated_at=? WHERE id=?')
    .run(next, new Date().toISOString(), row.id)
  activityLogRecord({
    event_type: next === 0 ? 'service_set_oos' : 'service_back_in_stock',
    severity: 'info',
    target_type: 'service',
    target_id: row.id,
    target_name: row.name,
    old_value: row.in_stock ?? 1,
    new_value: next,
  })
  return { ok: true, id: row.id, supabase_id: row.supabase_id, in_stock: next }
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
  // v2.16.13 — exclude owners (admin hybrids) from operational lavador list.
  return db.prepare(`SELECT * FROM empleados WHERE active=1 AND tipo IN ('lavador','hybrid') AND COALESCE(role,'none')!='owner' ORDER BY nombre`).all().map(_empLavadorRow)
}
function washersGetAllAdmin() {
  if (!db) return []
  return db.prepare(`SELECT * FROM empleados WHERE tipo IN ('lavador','hybrid') AND COALESCE(role,'none')!='owner' ORDER BY nombre`).all().map(_empLavadorRow)
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
  const row = db.prepare(`SELECT supabase_id, business_id FROM empleados WHERE id=? AND tipo IN ('lavador','hybrid')`).get(id)
  db.prepare(`UPDATE empleados SET active=0 WHERE id=? AND tipo IN ('lavador','hybrid')`).run(id)
  if (row?.supabase_id) tombstoneAdd('empleados', row.supabase_id, row.business_id)
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
  // v2.16.10 2026-04-30 — DO NOT REVERT (FIX-LEDGER §3.3). Soft-delete + tombstone
  // was silent. Audit log is mandatory on owner-visible destructive ops.
  const row = db.prepare('SELECT id, supabase_id, business_id, nombre FROM empleados WHERE id=?').get(id)
  db.prepare('UPDATE empleados SET active=0 WHERE id=?').run(id)
  if (row?.supabase_id) tombstoneAdd('empleados', row.supabase_id, row.business_id)
  if (row) {
    activityLogRecord({ event_type: 'empleado_deleted', severity: 'warn',
      target_type: 'empleado', target_id: row.id, target_name: row.nombre || '',
      reason: 'Soft-deleted via empleadoDelete' })
  }
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
    const bizRow = db.prepare('SELECT business_id FROM empleados WHERE id=?').get(id)
    db.prepare('UPDATE empleados SET active=0 WHERE id=?').run(id)
    if (emp.supabase_id) tombstoneAdd('empleados', emp.supabase_id, bizRow?.business_id)
    return { ok: true, softDeleted: true, reason: 'has-history', runs, commissions: commCount }
  }
  // No history — fully erase the employee + their salary_changes log.
  // v2.16.10 2026-04-30 — DO NOT REVERT (FIX-LEDGER §3.3). Hard delete drops
  // financial paper trail. MUST emit a critical audit row first so the
  // destruction is provable post-hoc.
  const empRow = db.prepare('SELECT id, supabase_id, business_id, nombre FROM empleados WHERE id=?').get(id)
  const salaryRowsCount = db.prepare('SELECT COUNT(*) AS n FROM salary_changes WHERE empleado_id=?').get(id)?.n || 0
  if (empRow) {
    activityLogRecord({ event_type: 'empleado_hard_deleted', severity: 'critical',
      target_type: 'empleado', target_id: empRow.id, target_name: empRow.nombre || '',
      reason: 'Hard delete — no payroll/commission history',
      metadata: { salary_changes_dropped: salaryRowsCount, supabase_id: empRow.supabase_id || null } })
  }
  db.prepare('DELETE FROM salary_changes WHERE empleado_id=?').run(id)
  db.prepare('DELETE FROM empleados WHERE id=?').run(id)
  return { ok: true, softDeleted: false }
}

// ── Mesas (floor plan) ──────────────────────────────────────────────────────
// v2.16.3 — surfaces active_ticket_total (running total of the open ticket on
// each mesa) so RestaurantPOS idle ocupada cards can render RD$ amounts.
// Total formula matches the live cart: SUM((price + sum(modifier delta)) * qty).
// Open ticket = mesa-bound ticket whose status is NOT cobrado/voided/anulado/nula.
// Mirrors the Supabase mesas_with_active_total VIEW semantics exactly.
function mesasGetAll() {
  if (!db) return []
  return db.prepare(`
    SELECT m.*,
      COALESCE((
        SELECT SUM(
          (COALESCE(ti.price, 0)
           + COALESCE((
               SELECT SUM(tim.price_delta_snapshot)
               FROM ticket_item_modificadores tim
               WHERE tim.ticket_item_id = ti.id
             ), 0)
          ) * COALESCE(ti.quantity, 1)
        )
        FROM tickets t
        JOIN ticket_items ti ON ti.ticket_id = t.id
        WHERE t.mesa_id = m.id
          AND t.status NOT IN ('cobrado','voided','anulado','nula')
      ), 0) AS active_ticket_total
    FROM mesas m
    WHERE m.active=1
    ORDER BY m.sort_order, m.name
  `).all()
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
  const allowed = ['name','zone','capacity','status','waiter_empleado_id','waiter_empleado_supabase_id','guests_count','seated_at','sort_order','active','bill_requested_at']
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
  const current = db.prepare('SELECT waiter_empleado_id, waiter_empleado_supabase_id, guests_count, bill_requested_at FROM mesas WHERE id=?').get(id)
  if (!current) return null
  const waiterId    = opts.waiter_empleado_id          !== undefined ? opts.waiter_empleado_id          : current.waiter_empleado_id
  const waiterSid   = opts.waiter_empleado_supabase_id !== undefined ? opts.waiter_empleado_supabase_id : current.waiter_empleado_supabase_id
  const guests      = opts.guests_count                !== undefined ? opts.guests_count                : current.guests_count
  // v2.16.3 — bill_requested_at: caller can pass null (post-cobro cleanup),
  // an explicit ISO string, or omit. On any transition OUT of 'acuenta'
  // (and the opt wasn't explicitly provided) auto-clear so the amber card
  // doesn't linger. mesaRequestBill() is the canonical entry into 'acuenta'.
  let billReq
  if (opts.bill_requested_at !== undefined)        billReq = opts.bill_requested_at
  else if (status === 'acuenta')                   billReq = current.bill_requested_at
  else                                             billReq = null
  // seated_at: opts override > stamp on first ocupada > preserve current.
  const seatedAtFragment = opts.seated_at !== undefined
    ? '?'  // explicit value (incl. null)
    : "COALESCE(seated_at, CASE WHEN ?='ocupada' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') END)"
  const seatedAtArg = opts.seated_at !== undefined ? opts.seated_at : status
  // v1.9.25 — bump monotonic rev so Supabase trigger can reject a slower
  // concurrent status change. See sync.js header "mesas.status race".
  db.prepare(`UPDATE mesas
    SET status=?, waiter_empleado_id=?, waiter_empleado_supabase_id=?, guests_count=?,
        seated_at=${seatedAtFragment},
        bill_requested_at=?,
        rev=COALESCE(rev,0)+1,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=?`).run(status, waiterId, waiterSid, guests, seatedAtArg, billReq, id)
  return db.prepare('SELECT * FROM mesas WHERE id=?').get(id)
}
// v2.16.3 — "Pedir cuenta" workflow. Stamps mesas.status='acuenta' +
// bill_requested_at=NOW(). The cobrar→sucia transition in mesaSetStatus
// auto-clears bill_requested_at (status !== 'acuenta' branch above).
function mesaRequestBill(id) {
  if (!db) return null
  db.prepare(`UPDATE mesas
    SET status='acuenta',
        bill_requested_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        rev=COALESCE(rev,0)+1,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=?`).run(id)
  return db.prepare('SELECT * FROM mesas WHERE id=?').get(id)
}
function mesaDelete(id) {
  if (!db) return
  const row = db.prepare('SELECT supabase_id, business_id FROM mesas WHERE id=?').get(id)
  db.prepare('UPDATE mesas SET active=0, updated_at=datetime(\'now\') WHERE id=?').run(id)
  if (row?.supabase_id) tombstoneAdd('mesas', row.supabase_id, row.business_id)
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
  const row = db.prepare('SELECT supabase_id, business_id FROM modificadores WHERE id=?').get(id)
  db.prepare('UPDATE modificadores SET active=0, updated_at=datetime(\'now\') WHERE id=?').run(id)
  if (row?.supabase_id) tombstoneAdd('modificadores', row.supabase_id, row.business_id)
}
// C3 — polymorphic: accepts integer id or supabase_id (UUID). Web POS
// passes svc.supabase_id; desktop callers historically pass svc.id. We
// resolve the UUID branch via service_modificadores.service_supabase_id
// and fall back to integer service_id when the input is numeric.
function modificadoresListForService(serviceKey) {
  if (!db) return []
  if (serviceKey == null || serviceKey === '') {
    console.warn('[modificadoresListForService] empty serviceKey')
    return []
  }
  const isUuid = typeof serviceKey === 'string' && /^[0-9a-f-]{36}$/i.test(serviceKey)
  if (isUuid) {
    return db.prepare(`SELECT m.*, sm.is_required
      FROM service_modificadores sm
      JOIN modificadores m ON m.supabase_id = sm.modificador_supabase_id
      WHERE sm.service_supabase_id=? AND m.active=1
      ORDER BY m.group_name, m.sort_order, m.name`).all(serviceKey)
  }
  return db.prepare(`SELECT m.*, sm.is_required
    FROM service_modificadores sm
    JOIN modificadores m ON m.id = sm.modificador_id
    WHERE sm.service_id=? AND m.active=1
    ORDER BY m.group_name, m.sort_order, m.name`).all(serviceKey)
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
  // v2.16.13 — exclude owners (admin hybrids) from operational vendedor list.
  return db.prepare(`SELECT * FROM empleados WHERE active=1 AND tipo IN ('vendedor','hybrid') AND COALESCE(role,'none')!='owner' ORDER BY nombre`).all().map(_empVendedorRow)
}
function sellersGetAllAdmin() {
  if (!db) return []
  return db.prepare(`SELECT * FROM empleados WHERE tipo IN ('vendedor','hybrid') AND COALESCE(role,'none')!='owner' ORDER BY nombre`).all().map(_empVendedorRow)
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
  const row = db.prepare(`SELECT supabase_id, business_id FROM empleados WHERE id=? AND tipo IN ('vendedor','hybrid')`).get(id)
  db.prepare(`UPDATE empleados SET active=0 WHERE id=? AND tipo IN ('vendedor','hybrid')`).run(id)
  if (row?.supabase_id) tombstoneAdd('empleados', row.supabase_id, row.business_id)
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
    // v2.16.10 2026-04-30 — DO NOT REVERT (FIX-LEDGER §3.2). Previous code
    // flipped ALL ticket_ids to cobrado regardless of cumulative paid. A
    // RD$500 abono on RD$3000 of debt closed everything. Now: only flip
    // cobrado when cumulative paid covers ticket.total. Else leave pendiente,
    // just decrement balance + insert credit_payments row for traceability.
    const updFull = db.prepare("UPDATE tickets SET status='cobrado', payment_method=?, rev=COALESCE(rev,0)+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
    const updRev  = db.prepare("UPDATE tickets SET rev=COALESCE(rev,0)+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
    const tInfo   = db.prepare('SELECT id,total FROM tickets WHERE id=?')
    const priorPaidStmt = db.prepare("SELECT COALESCE(SUM(amount),0) AS paid FROM credit_payments WHERE ticket_ids LIKE '%' || ? || '%'")
    let remaining = Number(amount) || 0
    for (const tid of ticketIds) {
      const t = tInfo.get(tid)
      if (!t) continue
      const total = Number(t.total) || 0
      const prior = Number(priorPaidStmt.get(String(tid))?.paid || 0)
      const stillOwed = Math.max(0, total - prior)
      const applied = Math.min(remaining, stillOwed)
      remaining -= applied
      const fullyPaid = (prior + applied) + 0.01 >= total
      if (fullyPaid) updFull.run(paymentMethod, tid)
      else updRev.run(tid)
    }
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
  let sql  = `SELECT t.*, COALESCE(t.client_name, c.name) as client_name, COALESCE(t.client_rnc, c.rnc) as client_rnc,
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
    `SELECT t.*, COALESCE(t.client_name, c.name) as client_name, COALESCE(t.client_rnc, c.rnc) as client_rnc, u.name as cajero_name
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

// ── Restaurant open-ticket lifecycle (v2.16.4) ────────────────────────────────
// Persist tickets the moment a mesa is seated, not at cobro. Power loss / app
// crash mid-dinner no longer drops in-flight items + KDS rows. The `open_status`
// column ('open' | 'closed') is orthogonal to financial `status` so cuadre and
// reports stay correct.
function _selfHealOpenTicketsCols() {
  if (!db) return
  const cols = [
    "ALTER TABLE tickets ADD COLUMN open_status TEXT NOT NULL DEFAULT 'closed'",
    "CREATE INDEX IF NOT EXISTS idx_tickets_open_by_mesa ON tickets(mesa_id, open_status) WHERE open_status='open'",
  ]
  for (const sql of cols) { try { db.exec(sql) } catch {} }
}

// 2026-05-09 — generalized to ticketOpenForFulfillment so food_truck (and any
// future fire-then-pay vertical) shares the same lifecycle as restaurant. The
// legacy ticketOpenForMesa is now a thin wrapper.
function ticketOpenForFulfillment({
  fulfillment_type, mode, mesa_id, mesa_supabase_id,
  food_truck_location_supabase_id, order_source, notes,
  supabase_id,
} = {}) {
  if (!db) return null
  _selfHealOpenTicketsCols()
  const ticketSid = supabase_id || crypto.randomUUID()
  const last = db.prepare('SELECT doc_number FROM tickets ORDER BY id DESC LIMIT 1').get()
  let nextNum = 1
  if (last?.doc_number) {
    const m = String(last.doc_number).match(/T-(\d+)/)
    if (m) nextNum = parseInt(m[1], 10) + 1
  }
  const docNumber = `T-${String(nextNum).padStart(4, '0')}`
  const ff = fulfillment_type || (mesa_supabase_id ? 'dine_in' : 'take_out')
  const md = mode || (mesa_supabase_id ? 'mesa' : 'take_out')
  const src = order_source || 'pos'
  const tx = db.transaction(() => {
    const result = db.prepare(`INSERT INTO tickets
      (doc_number, supabase_id, mesa_id, mesa_supabase_id,
       food_truck_location_supabase_id,
       fulfillment_type, mode, subtotal, descuento, itbis, ley, total,
       payment_method, status, open_status, tipo_venta, order_source,
       notes, created_at)
      VALUES(?,?,?,?,?,?,?,0,0,0,0,0,?,?,?,?,?,?,datetime('now'))`).run(
      docNumber, ticketSid, mesa_id || null, mesa_supabase_id || null,
      food_truck_location_supabase_id || null,
      ff, md, 'pending', 'pendiente', 'open', 'contado', src,
      notes || null,
    )
    return { id: result.lastInsertRowid, supabase_id: ticketSid, doc_number: docNumber }
  })
  return tx()
}

function ticketOpenForMesa(args = {}) {
  return ticketOpenForFulfillment({ ...args, fulfillment_type: 'dine_in', mode: 'mesa' })
}

// listOpen — every ticket with open_status='open' for the active business +
// item count + running subtotal (pre-aggregated so the UI doesn't fetch
// ticket_items per row).
function ticketsListOpen({ source = null, limit = 100 } = {}) {
  if (!db) return []
  try { _selfHealOpenTicketsCols() } catch {}
  const params = []
  let where = `WHERE open_status='open' AND status<>'nula'`
  if (source) { where += ' AND order_source=?'; params.push(source) }
  params.push(Math.max(1, Math.min(500, Number(limit) || 100)))
  const rows = db.prepare(`
    SELECT t.id, t.supabase_id, t.doc_number, t.mesa_supabase_id,
           t.food_truck_location_supabase_id, t.order_source, t.notes,
           t.fulfillment_type, t.mode, t.created_at, t.updated_at,
           COALESCE(SUM(ti.quantity), 0)            AS item_count,
           COALESCE(SUM(ti.price * ti.quantity), 0) AS running_total
      FROM tickets t
 LEFT JOIN ticket_items ti ON ti.ticket_id = t.id
       ${where}
     GROUP BY t.id
     ORDER BY t.created_at DESC
     LIMIT ?
  `).all(...params)
  return rows
}

function ticketAddItem({ ticket_id, ticket_supabase_id, service_id, service_supabase_id, name, price, qty, modifiers, course, happy_hour_applied, guest_number, preparation_notes, empleado_supabase_id } = {}) {
  if (!db) return null
  const itemSid = crypto.randomUUID()
  const safeQty = Math.max(1, parseInt(qty || 1, 10))
  let svcSid = service_supabase_id || null
  if (!svcSid && service_id) {
    try { svcSid = db.prepare('SELECT supabase_id FROM services WHERE id=?').get(service_id)?.supabase_id || null } catch {}
  }
  const tx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO ticket_items
      (ticket_id, service_id, name, price, cost, itbis, is_wash, quantity,
       course, kds_fired_at, guest_number, preparation_notes, empleado_supabase_id,
       supabase_id, ticket_supabase_id, service_supabase_id)
      VALUES(?,?,?,?,0,0,1,?,?,?,?,?,?,?,?,?)`).run(
      ticket_id || null, service_id || null, name || '', Number(price) || 0,
      safeQty, course || null, null, guest_number || null,
      preparation_notes ? String(preparation_notes).trim() || null : null,
      empleado_supabase_id || null,
      itemSid, ticket_supabase_id || null, svcSid,
    )
    if (Array.isArray(modifiers) && modifiers.length) {
      const ins = db.prepare(`INSERT INTO ticket_item_modificadores
        (supabase_id, ticket_item_id, ticket_item_supabase_id, modificador_id, modificador_supabase_id, name_snapshot, price_delta_snapshot)
        VALUES(?,?,?,?,?,?,?)`)
      for (const m of modifiers) {
        ins.run(crypto.randomUUID(), r.lastInsertRowid, itemSid,
          m.modificador_id || null, m.modificador_supabase_id || null,
          m.name || m.name_snapshot || '', Number(m.price_delta || m.price_delta_snapshot || 0))
      }
    }
    if (ticket_id) {
      db.prepare("UPDATE tickets SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(ticket_id)
    }
    return { id: r.lastInsertRowid, supabase_id: itemSid }
  })
  return tx()
}

function ticketUpdateItemQty({ ticket_item_id, qty } = {}) {
  if (!db || !ticket_item_id) return null
  const safeQty = Math.max(0, parseInt(qty || 0, 10))
  if (safeQty === 0) return ticketRemoveItem({ ticket_item_id })
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT ticket_id FROM ticket_items WHERE id=?').get(ticket_item_id)
    db.prepare('UPDATE ticket_items SET quantity=? WHERE id=?').run(safeQty, ticket_item_id)
    if (row?.ticket_id) {
      db.prepare("UPDATE tickets SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(row.ticket_id)
    }
    return { id: ticket_item_id, qty: safeQty }
  })
  return tx()
}

function ticketRemoveItem({ ticket_item_id } = {}) {
  if (!db || !ticket_item_id) return null
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT ticket_id, supabase_id FROM ticket_items WHERE id=?').get(ticket_item_id)
    if (!row) return { id: ticket_item_id, removed: false }
    if (row.supabase_id) {
      try { db.prepare('DELETE FROM ticket_item_modificadores WHERE ticket_item_supabase_id=?').run(row.supabase_id) } catch {}
    }
    try { db.prepare('DELETE FROM ticket_item_modificadores WHERE ticket_item_id=?').run(ticket_item_id) } catch {}
    db.prepare('DELETE FROM ticket_items WHERE id=?').run(ticket_item_id)
    if (row.ticket_id) {
      db.prepare("UPDATE tickets SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(row.ticket_id)
    }
    return { id: ticket_item_id, removed: true }
  })
  return tx()
}

function ticketGetActiveByMesa(mesaId) {
  if (!db || !mesaId) return null
  _selfHealOpenTicketsCols()
  const ticket = db.prepare(
    `SELECT * FROM tickets WHERE mesa_id=? AND open_status='open' ORDER BY id DESC LIMIT 1`
  ).get(mesaId)
  if (!ticket) return null
  const items = db.prepare(
    `SELECT * FROM ticket_items WHERE ticket_id=? ORDER BY id ASC`
  ).all(ticket.id)
  const modsByItem = {}
  if (items.length) {
    const itemIds = items.map(i => i.id).filter(Boolean)
    const itemSids = items.map(i => i.supabase_id).filter(Boolean)
    let mods = []
    if (itemIds.length) {
      const placeholders = itemIds.map(() => '?').join(',')
      try { mods = db.prepare(`SELECT * FROM ticket_item_modificadores WHERE ticket_item_id IN (${placeholders})`).all(...itemIds) } catch { mods = [] }
    }
    if (!mods.length && itemSids.length) {
      const ph2 = itemSids.map(() => '?').join(',')
      try { mods = db.prepare(`SELECT * FROM ticket_item_modificadores WHERE ticket_item_supabase_id IN (${ph2})`).all(...itemSids) } catch { mods = [] }
    }
    for (const m of mods) {
      const key = m.ticket_item_id || m.ticket_item_supabase_id
      if (!modsByItem[key]) modsByItem[key] = []
      modsByItem[key].push({
        modificador_id: m.modificador_id,
        modificador_supabase_id: m.modificador_supabase_id,
        name: m.name_snapshot,
        price_delta: Number(m.price_delta_snapshot || 0),
      })
    }
  }
  ticket.items = items.map(it => ({
    ...it,
    qty: it.quantity,
    modifiers: modsByItem[it.id] || modsByItem[it.supabase_id] || [],
  }))
  return ticket
}

// ─── v2.16.3 H3 — Restaurante "Mover" (transfer to mesa) ──────────────────
function ticketTransferToMesa({ ticket_supabase_id, new_mesa_id } = {}) {
  if (!db) throw new Error('DB no inicializada')
  if (!ticket_supabase_id || !new_mesa_id) throw new Error('Faltan parámetros')
  const tx = db.transaction(() => {
    const ticket = db.prepare(
      `SELECT id, supabase_id, mesa_id, mesa_supabase_id, guests, waiter_empleado_supabase_id,
              doc_number, status, created_at, rev
         FROM tickets WHERE supabase_id=?`
    ).get(ticket_supabase_id)
    if (!ticket) throw new Error('Ticket no encontrado')
    if (['cobrado','nula','anulado','voided'].includes(ticket.status)) throw new Error('Ticket ya cerrado')
    if (ticket.mesa_id === new_mesa_id) throw new Error('La mesa destino es la misma')

    const newMesa = db.prepare('SELECT id, supabase_id, name, status FROM mesas WHERE id=?').get(new_mesa_id)
    if (!newMesa) throw new Error('Mesa destino no existe')
    if (!['libre','sucia','reservada'].includes(newMesa.status)) {
      throw new Error('Mesa destino no está disponible')
    }

    const oldMesa = ticket.mesa_id
      ? db.prepare('SELECT id, supabase_id, name, guests_count, waiter_empleado_supabase_id, seated_at FROM mesas WHERE id=?').get(ticket.mesa_id)
      : null

    const nextRev = Number(ticket.rev || 0) + 1
    db.prepare(`UPDATE tickets SET mesa_id=?, mesa_supabase_id=?, rev=?,
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
      .run(newMesa.id, newMesa.supabase_id, nextRev, ticket.id)

    if (oldMesa?.id) {
      db.prepare(`UPDATE mesas SET status='sucia', guests_count=NULL,
                  waiter_empleado_supabase_id=NULL, seated_at=NULL, bill_requested_at=NULL,
                  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(oldMesa.id)
    }

    const seatedAt = oldMesa?.seated_at || ticket.created_at || new Date().toISOString()
    db.prepare(`UPDATE mesas SET status='ocupada', guests_count=?,
                waiter_empleado_supabase_id=?, seated_at=?, bill_requested_at=NULL,
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(
      oldMesa?.guests_count ?? ticket.guests ?? null,
      oldMesa?.waiter_empleado_supabase_id ?? ticket.waiter_empleado_supabase_id ?? null,
      seatedAt,
      newMesa.id,
    )

    activityLogRecord({
      event_type: 'restaurant_mesa_transfer', severity: 'info',
      target_type: 'ticket', target_id: ticket.id,
      target_name: ticket.doc_number || `#${ticket.id}`,
      metadata: {
        from_mesa_id: oldMesa?.id ?? null,
        from_mesa_name: oldMesa?.name ?? null,
        to_mesa_id: newMesa.id,
        to_mesa_name: newMesa.name,
      },
    })
    return { ok: true, ticket_id: ticket.id, new_mesa_id: newMesa.id }
  })
  return tx()
}

// ── Mesas add-on: running-tab support ─────────────────────────────────────
// ticketGetActiveByMesaSupabaseId — latest active ticket on a mesa with items.
// Used by the POS to re-hydrate the cart when reclicking an occupied mesa.
//
// 2026-05-17 FIX: dropped open_status='open' filter (carwash tickets are
// open_status='closed' even when in cola — they're not restaurant-style
// open tabs). Match instead on non-terminal status so we find whatever
// the occupied poll considers occupied. See web.js byMesa for context.
function ticketGetActiveByMesaSupabaseId(mesaSupabaseId) {
  if (!db) throw new Error('DB no inicializada')
  if (!mesaSupabaseId) return null
  const ticket = db.prepare(
    `SELECT * FROM tickets
       WHERE mesa_supabase_id=?
         AND LOWER(COALESCE(status,'')) NOT IN ('cobrado','done','cancelled','voided','nula','anulado','merged')
       ORDER BY created_at DESC LIMIT 1`
  ).get(mesaSupabaseId)
  if (!ticket) return null
  const items = db.prepare(
    `SELECT id, supabase_id, name, price, quantity, preparation_notes, weight,
            service_id, inventory_item_id, service_supabase_id,
            inventory_item_supabase_id, is_wash, itbis, cost
       FROM ticket_items
       WHERE ticket_id=? OR ticket_supabase_id=?
       ORDER BY id ASC`
  ).all(ticket.id, ticket.supabase_id || '')
  return {
    ...ticket,
    items: items.map(i => ({
      ...i,
      qty: i.quantity,
      _cartKey: i.supabase_id || `tk-${i.id}`,
      _wasExisting: true,
    })),
  }
}

// ticketAppendItems — append NEW items to an open ticket, recompute totals.
// Loud throws on race (closed/voided between load and save). Activity-logged.
// KNOWN GAPS: see web.js companion — commissions + journal_entries not wired.
function ticketAppendItems({ ticket_supabase_id, items } = {}) {
  if (!db) throw new Error('DB no inicializada')
  if (!ticket_supabase_id) throw new Error('Falta ticket_supabase_id')
  if (!Array.isArray(items) || items.length === 0) throw new Error('No hay items para agregar')

  const tx = db.transaction(() => {
    const cur = db.prepare(
      `SELECT id, supabase_id, open_status, status, doc_number, mesa_supabase_id, business_id
         FROM tickets WHERE supabase_id=?`
    ).get(ticket_supabase_id)
    if (!cur) throw new Error('Ticket no encontrado')
    // 2026-05-17 — drop open_status gate (rejected carwash tickets in cola).
    if (['cobrado','done','cancelled','voided','nula','anulado','merged'].includes(String(cur.status || '').toLowerCase())) {
      throw new Error('Ticket ya cerrado')
    }

    let itbisFactor = 0.18
    try {
      const pctRow = db.prepare(
        `SELECT value FROM app_settings WHERE business_id=? AND key='itbis_pct' LIMIT 1`
      ).get(cur.business_id || '')
      const pctNum = Number(pctRow?.value)
      if (Number.isFinite(pctNum) && pctNum >= 0) itbisFactor = pctNum / 100
    } catch (e) {
      throw new Error('itbis_pct lookup: ' + e.message)
    }

    const svcIds = items.map(i => i.service_id).filter(Boolean)
    const svcMeta = new Map()
    if (svcIds.length) {
      const placeholders = svcIds.map(() => '?').join(',')
      const svcRows = db.prepare(
        `SELECT id, cost, aplica_itbis FROM services WHERE id IN (${placeholders})`
      ).all(...svcIds)
      for (const r of svcRows) svcMeta.set(r.id, { cost: r.cost || 0, aplica_itbis: r.aplica_itbis ?? 1 })
    }

    const insStmt = db.prepare(
      `INSERT INTO ticket_items
        (supabase_id, ticket_id, ticket_supabase_id, service_id, inventory_item_id,
         service_supabase_id, inventory_item_supabase_id, name, price, cost, itbis,
         is_wash, quantity, weight, preparation_notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )

    let addedTotal = 0
    for (const i of items) {
      const price = Number(i.price) || 0
      const qty = Number(i.quantity || i.qty || 1)
      const meta = i.service_id ? svcMeta.get(i.service_id) : null
      const aplica = i.aplica_itbis !== undefined ? i.aplica_itbis : (meta?.aplica_itbis ?? 1)
      const itbis = aplica === 0 ? 0 : parseFloat((price - price / (1 + itbisFactor)).toFixed(2))
      const cost = i.cost != null ? Number(i.cost) : (meta?.cost || 0)
      insStmt.run(
        i.supabase_id || crypto.randomUUID(),
        cur.id,
        cur.supabase_id || ticket_supabase_id,
        i.service_id || null,
        i.inventory_item_id || null,
        i.service_supabase_id || null,
        i.inventory_item_supabase_id || null,
        i.name,
        price,
        cost,
        itbis,
        i.is_wash != null ? (i.is_wash ? 1 : 0) : 1,
        qty,
        i.weight != null ? Number(i.weight) : null,
        i.preparation_notes || null,
      )
      addedTotal += price * qty
    }

    const allRows = db.prepare(
      `SELECT price, quantity, itbis FROM ticket_items
         WHERE ticket_id=? OR ticket_supabase_id=?`
    ).all(cur.id, cur.supabase_id || '')
    let subtotal = 0, itbis = 0
    for (const r of allRows) {
      const line = (Number(r.price) || 0) * (Number(r.quantity) || 1)
      subtotal += line
      itbis    += (Number(r.itbis) || 0) * (Number(r.quantity) || 1)
    }
    subtotal = parseFloat(subtotal.toFixed(2))
    itbis    = parseFloat(itbis.toFixed(2))
    const total = subtotal

    db.prepare(
      `UPDATE tickets SET subtotal=?, itbis=?, total=?, updated_at=datetime('now')
         WHERE id=?`
    ).run(subtotal, itbis, total, cur.id)

    try {
      activityLogRecord({
        event_type: 'ticket_append_items',
        severity: 'info',
        target_type: 'ticket',
        target_id: cur.id,
        target_name: cur.doc_number || `#${cur.id}`,
        amount: parseFloat(addedTotal.toFixed(2)),
        metadata: {
          ticket_supabase_id,
          mesa_supabase_id: cur.mesa_supabase_id,
          added_count: items.length,
          added_total: parseFloat(addedTotal.toFixed(2)),
          new_total: total,
        },
      })
    } catch (e) {
      // Activity log is best-effort. Log to console for diagnostics but
      // never fail the append on a logging issue.
      console.error('[ticketAppendItems] activity log failed:', e.message)
    }

    return { ok: true, ticket_supabase_id, added: items.length, subtotal, itbis, total }
  })
  return tx()
}

// ─── v2.16.3 H3 — Restaurante "Juntar" (merge tickets) ─────────────────────
function ticketMerge({ target_ticket_supabase_id, source_ticket_supabase_id } = {}) {
  if (!db) throw new Error('DB no inicializada')
  if (!target_ticket_supabase_id || !source_ticket_supabase_id) throw new Error('Faltan parámetros')
  if (target_ticket_supabase_id === source_ticket_supabase_id) throw new Error('No se puede juntar consigo mismo')
  const tx = db.transaction(() => {
    const target = db.prepare(
      `SELECT id, supabase_id, mesa_id, mesa_supabase_id, guests, doc_number, status, rev
         FROM tickets WHERE supabase_id=?`
    ).get(target_ticket_supabase_id)
    if (!target) throw new Error('Ticket destino no encontrado')
    if (['cobrado','nula','anulado','voided','merged'].includes(target.status)) throw new Error('Ticket destino ya cerrado')

    const source = db.prepare(
      `SELECT id, supabase_id, mesa_id, mesa_supabase_id, guests, doc_number, status, rev
         FROM tickets WHERE supabase_id=?`
    ).get(source_ticket_supabase_id)
    if (!source) throw new Error('Ticket origen no encontrado')
    if (['cobrado','nula','anulado','voided','merged'].includes(source.status)) throw new Error('Ticket origen ya cerrado')

    db.prepare(`UPDATE ticket_items SET ticket_supabase_id=?, ticket_id=?
                WHERE ticket_supabase_id=? OR ticket_id=?`).run(
      target.supabase_id, target.id, source.supabase_id, source.id,
    )

    const totalGuests = Number(target.guests || 0) + Number(source.guests || 0)
    const tNextRev = Number(target.rev || 0) + 1
    db.prepare(`UPDATE tickets SET guests=?, rev=?,
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
      .run(totalGuests || null, tNextRev, target.id)

    const sNextRev = Number(source.rev || 0) + 1
    db.prepare(`UPDATE tickets SET status='merged', notes=?, rev=?,
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(
      `Combinado con ${target.doc_number || target.id}`, sNextRev, source.id,
    )

    if (source.mesa_id) {
      db.prepare(`UPDATE mesas SET status='sucia', guests_count=NULL,
                  waiter_empleado_supabase_id=NULL, seated_at=NULL, bill_requested_at=NULL,
                  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(source.mesa_id)
    }
    if (target.mesa_id && totalGuests) {
      try {
        db.prepare(`UPDATE mesas SET guests_count=?,
                    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(totalGuests, target.mesa_id)
      } catch {}
    }

    activityLogRecord({
      event_type: 'restaurant_mesa_merge', severity: 'info',
      target_type: 'ticket', target_id: target.id,
      target_name: target.doc_number || `#${target.id}`,
      metadata: {
        target_ticket_id: target.id,
        source_ticket_id: source.id,
        source_doc_number: source.doc_number,
        target_mesa_id: target.mesa_id,
        source_mesa_id: source.mesa_id,
        total_guests: totalGuests,
      },
    })
    return { ok: true, target_ticket_id: target.id, source_ticket_id: source.id }
  })
  return tx()
}

// ─── v2.16.3 H4 — Restaurant front-of-house reservations ──────────────────
function reservationsList({ date, status, dateFrom, dateTo } = {}) {
  if (!db) return []
  const conds = []
  const params = []
  if (date)     { conds.push('fecha = ?');  params.push(date) }
  if (dateFrom) { conds.push('fecha >= ?'); params.push(dateFrom) }
  if (dateTo)   { conds.push('fecha <= ?'); params.push(dateTo) }
  if (status && status !== 'all') { conds.push('status = ?'); params.push(status) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  try {
    return db.prepare(
      `SELECT * FROM restaurant_reservations ${where}
        ORDER BY fecha ASC, hora ASC`
    ).all(...params)
  } catch { return [] }
}

function reservationsCreate(data = {}) {
  if (!db) throw new Error('DB no inicializada')
  if (!data.fecha || !data.hora || !data.nombre) throw new Error('Faltan datos requeridos (fecha/hora/nombre)')
  const sid = crypto.randomUUID()
  const guests = Math.max(1, Number(data.guests || 2))
  const result = db.prepare(`INSERT INTO restaurant_reservations
    (supabase_id, mesa_id, mesa_supabase_id, fecha, hora, duration_min,
     nombre, telefono, guests, notas, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    sid,
    data.mesa_id || null,
    data.mesa_supabase_id || null,
    String(data.fecha),
    String(data.hora),
    Number(data.duration_min || 90),
    String(data.nombre).trim(),
    data.telefono ? String(data.telefono).trim() : null,
    guests,
    data.notas || null,
    data.status || 'pendiente',
  )
  const row = db.prepare('SELECT * FROM restaurant_reservations WHERE id=?').get(result.lastInsertRowid)
  activityLogRecord({
    event_type: 'reservation_created', severity: 'info',
    target_type: 'reservation', target_id: row.id, target_name: row.nombre,
    metadata: { fecha: row.fecha, hora: row.hora, guests: row.guests, mesa_id: row.mesa_id },
  })
  return row
}

function reservationsUpdate(id, data = {}) {
  if (!db || !id) return null
  const allowed = ['mesa_id','mesa_supabase_id','fecha','hora','duration_min','nombre','telefono','guests','notas','status','whatsapp_sent_at','cancelled_reason','seated_ticket_supabase_id']
  const sets = []
  const params = []
  for (const k of allowed) {
    if (k in (data || {})) {
      sets.push(`${k} = ?`)
      params.push(data[k])
    }
  }
  if (!sets.length) {
    return db.prepare('SELECT * FROM restaurant_reservations WHERE id=?').get(id) || null
  }
  params.push(id)
  db.prepare(`UPDATE restaurant_reservations SET ${sets.join(', ')},
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(...params)
  return db.prepare('SELECT * FROM restaurant_reservations WHERE id=?').get(id) || null
}

function reservationsConfirm(id) {
  if (!db || !id) return null
  db.prepare(`UPDATE restaurant_reservations SET status='confirmada',
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(id)
  const row = db.prepare('SELECT * FROM restaurant_reservations WHERE id=?').get(id)
  if (!row) return null
  activityLogRecord({
    event_type: 'reservation_confirmed', severity: 'info',
    target_type: 'reservation', target_id: row.id, target_name: row.nombre,
    metadata: { fecha: row.fecha, hora: row.hora, guests: row.guests },
  })
  return row
}

function reservationsCancel(id, reason) {
  if (!db || !id) return null
  db.prepare(`UPDATE restaurant_reservations SET status='cancelada', cancelled_reason=?,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(reason || null, id)
  const row = db.prepare('SELECT * FROM restaurant_reservations WHERE id=?').get(id)
  if (!row) return null
  activityLogRecord({
    event_type: 'reservation_cancelled', severity: 'warn',
    target_type: 'reservation', target_id: row.id, target_name: row.nombre,
    reason: reason || null,
    metadata: { fecha: row.fecha, hora: row.hora },
  })
  return row
}

function reservationsMarkNoShow(id) {
  if (!db || !id) return null
  db.prepare(`UPDATE restaurant_reservations SET status='no_show',
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(id)
  const row = db.prepare('SELECT * FROM restaurant_reservations WHERE id=?').get(id)
  if (!row) return null
  activityLogRecord({
    event_type: 'reservation_no_show', severity: 'warn',
    target_type: 'reservation', target_id: row.id, target_name: row.nombre,
    metadata: { fecha: row.fecha, hora: row.hora, guests: row.guests },
  })
  return row
}

function reservationsSeat(id, mesaId) {
  if (!db || !id) return null
  const tx = db.transaction(() => {
    let mesaSid = null
    if (mesaId) {
      const m = db.prepare('SELECT id, supabase_id, name FROM mesas WHERE id=?').get(mesaId)
      if (!m) throw new Error('Mesa no encontrada')
      mesaSid = m.supabase_id
      const res = db.prepare('SELECT guests, nombre FROM restaurant_reservations WHERE id=?').get(id)
      try {
        db.prepare(`UPDATE mesas SET status='ocupada', guests_count=?,
                    seated_at=?, bill_requested_at=NULL,
                    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(
          res?.guests || null,
          new Date().toISOString(),
          mesaId,
        )
      } catch {}
    }
    const sets = ["status='sentada'"]
    const params = []
    if (mesaId)  { sets.push('mesa_id=?');          params.push(mesaId) }
    if (mesaSid) { sets.push('mesa_supabase_id=?'); params.push(mesaSid) }
    sets.push("updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
    params.push(id)
    db.prepare(`UPDATE restaurant_reservations SET ${sets.join(', ')} WHERE id=?`).run(...params)
    const row = db.prepare('SELECT * FROM restaurant_reservations WHERE id=?').get(id)
    if (row) {
      activityLogRecord({
        event_type: 'reservation_seated', severity: 'info',
        target_type: 'reservation', target_id: row.id, target_name: row.nombre,
        metadata: { fecha: row.fecha, hora: row.hora, mesa_id: mesaId },
      })
    }
    return row
  })
  return tx()
}

function reservationsStampWhatsapp(id) {
  if (!db || !id) return null
  db.prepare(`UPDATE restaurant_reservations SET whatsapp_sent_at=?,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(new Date().toISOString(), id)
  return db.prepare('SELECT * FROM restaurant_reservations WHERE id=?').get(id) || null
}

// ── v2.17 — Food Truck: favorite stops ─────────────────────────────────────
function foodTruckLocationsList({ activeOnly } = {}) {
  if (!db) return []
  try {
    const where = activeOnly ? 'WHERE active=1' : ''
    return db.prepare(`SELECT * FROM food_truck_locations ${where} ORDER BY name ASC`).all()
  } catch { return [] }
}

function foodTruckLocationsCreate(data = {}) {
  if (!db) throw new Error('DB no inicializada')
  if (!data.name || !String(data.name).trim()) throw new Error('Nombre requerido')
  const sid = crypto.randomUUID()
  const result = db.prepare(`INSERT INTO food_truck_locations
    (supabase_id, name, lat, lng, notes, active)
    VALUES (?,?,?,?,?,?)`).run(
    sid,
    String(data.name).trim(),
    data.lat != null ? Number(data.lat) : null,
    data.lng != null ? Number(data.lng) : null,
    data.notes || null,
    data.active === false ? 0 : 1,
  )
  return db.prepare('SELECT * FROM food_truck_locations WHERE id=?').get(result.lastInsertRowid)
}

function foodTruckLocationsUpdate(id, patch = {}) {
  if (!db || !id) return null
  const allowed = ['name','lat','lng','notes','active']
  const sets = []
  const params = []
  for (const k of allowed) {
    if (k in (patch || {})) {
      sets.push(`${k} = ?`)
      params.push(k === 'active' ? (patch[k] ? 1 : 0) : patch[k])
    }
  }
  if (!sets.length) return db.prepare('SELECT * FROM food_truck_locations WHERE id=?').get(id) || null
  params.push(id)
  db.prepare(`UPDATE food_truck_locations SET ${sets.join(', ')},
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(...params)
  return db.prepare('SELECT * FROM food_truck_locations WHERE id=?').get(id) || null
}

function foodTruckLocationsDelete(id) {
  if (!db || !id) return null
  db.prepare('DELETE FROM food_truck_locations WHERE id=?').run(id)
  return { ok: true }
}

// ── v2.17 — Food Truck: waste log ──────────────────────────────────────────
function wasteLogList({ dateFrom, dateTo, limit = 200 } = {}) {
  if (!db) return []
  const conds = []
  const params = []
  if (dateFrom) { conds.push('occurred_at >= ?'); params.push(dateFrom) }
  if (dateTo)   { conds.push('occurred_at <= ?'); params.push(dateTo) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  try {
    return db.prepare(
      `SELECT w.*, i.name AS item_name
         FROM waste_log w
    LEFT JOIN inventory_items i ON i.id = w.inventory_item_id
        ${where}
     ORDER BY w.occurred_at DESC
        LIMIT ?`
    ).all(...params, Math.max(1, Math.min(1000, Number(limit) || 200)))
  } catch { return [] }
}

function wasteLogCreate(data = {}) {
  if (!db) throw new Error('DB no inicializada')
  if (data.qty == null || !Number.isFinite(Number(data.qty))) throw new Error('Cantidad requerida')
  if (!data.reason || !String(data.reason).trim()) throw new Error('Motivo requerido')
  const sid = crypto.randomUUID()
  let invItemSid = data.inventory_item_supabase_id || null
  if (data.inventory_item_id && !invItemSid) {
    try {
      const it = db.prepare('SELECT supabase_id FROM inventory_items WHERE id=?').get(data.inventory_item_id)
      invItemSid = it?.supabase_id || null
    } catch {}
  }
  const result = db.prepare(`INSERT INTO waste_log
    (supabase_id, inventory_item_id, inventory_item_supabase_id, qty, unit, reason, photo_url,
     occurred_at, cuadre_id, cuadre_supabase_id, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    sid,
    data.inventory_item_id || null,
    invItemSid,
    Number(data.qty),
    data.unit || null,
    String(data.reason).trim(),
    data.photo_url || null,
    data.occurred_at || new Date().toISOString(),
    data.cuadre_id || null,
    data.cuadre_supabase_id || null,
    data.created_by || null,
  )
  const row = db.prepare('SELECT * FROM waste_log WHERE id=?').get(result.lastInsertRowid)
  activityLogRecord({
    event_type: 'food_truck_waste_logged', severity: 'warn',
    target_type: 'waste_log', target_id: row.id, target_name: data.item_name || null,
    amount: Number(data.qty),
    reason: row.reason,
    metadata: { unit: row.unit, inventory_item_supabase_id: invItemSid },
  })
  return row
}

function wasteLogDelete(id) {
  if (!db || !id) return null
  db.prepare('DELETE FROM waste_log WHERE id=?').run(id)
  return { ok: true }
}

function ticketCloseWithPayment({ ticket_id, ticket_supabase_id, payload } = {}) {
  if (!db) return null
  if (!ticket_id && !ticket_supabase_id) return null
  const row = ticket_id
    ? db.prepare('SELECT * FROM tickets WHERE id=?').get(ticket_id)
    : db.prepare('SELECT * FROM tickets WHERE supabase_id=?').get(ticket_supabase_id)
  if (!row) return null
  const data = payload || {}
  const itbisPctRow = db.prepare('SELECT value FROM app_settings WHERE key=?').get('itbis_pct')
  const itbisPct = Number(itbisPctRow?.value)
  const itbisFactor = (Number.isFinite(itbisPct) && itbisPct >= 0 ? itbisPct : 18) / 100

  // v2.3 — multi-POS NCF block dispatch. Mirrors ticketCreate so close-time
  // NCF assignment also runs through the HWID-scoped block consumer when
  // multi_pos_enabled='1'. Without this, dual-desktop installs that close a
  // credit ticket fall through to the legacy ncf_sequences UPDATE and can
  // mint duplicate NCFs across terminals.
  const _multiPos = multiPosEnabled()
  const _bizIdLocal = _bizId()
  const _hwidLocal  = (() => {
    try { return db.prepare("SELECT value FROM app_settings WHERE key='hwid'").get()?.value || null }
    catch { return null }
  })()

  const tx = db.transaction(() => {
    let ncf = (data.ncf && String(data.ncf).trim()) ? String(data.ncf).trim().toUpperCase() : (row.ncf || null)
    const ncfType = data.comprobante_type || row.comprobante_type || 'B02'
    let ncfFromBlock = false
    if (!ncf && _multiPos && _bizIdLocal && _hwidLocal) {
      const blk = ncfBlockConsumeNext({ businessId: _bizIdLocal, hwid: _hwidLocal, ncfType })
      if (blk?.ncf) {
        ncf = blk.ncf
        ncfFromBlock = true
      }
    }
    if (!ncf && !ncfFromBlock) {
      const ncfRow = db.prepare('SELECT * FROM ncf_sequences WHERE type=? AND active=1').get(ncfType)
      if (ncfRow) {
        const nextNCF = ncfRow.current_number + 1
        const ncfPrefix = String(ncfType).toUpperCase()
        const pad = /^E/.test(ncfPrefix) ? 10 : 8
        ncf = `${ncfPrefix}${String(nextNCF).padStart(pad, '0')}`
        db.prepare("UPDATE ncf_sequences SET current_number=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE type=?")
          .run(nextNCF, ncfRow.type)
      }
    }

    const status = data.status || (data.tipo_venta === 'credito' || data.payment_method === 'credit' ? 'pendiente' : 'cobrado')
    let paymentPartsJson = null
    if (Array.isArray(data.payment_parts) && data.payment_parts.length) {
      try { paymentPartsJson = JSON.stringify(data.payment_parts) } catch { paymentPartsJson = null }
    }
    const splitBillFlag = (data.split === true || (Array.isArray(data.payment_parts) && data.payment_parts.length > 1)) ? 1 : 0

    db.prepare(`UPDATE tickets SET
       open_status='closed',
       status=?,
       subtotal=?, descuento=?, itbis=?, ley=?, total=?,
       beverage_subtotal=?, payment_method=?, comprobante_type=?, ncf=?,
       ecf_result=?, tipo_venta=?, vehicle_plate=COALESCE(?,vehicle_plate),
       client_id=COALESCE(?,client_id), client_supabase_id=COALESCE(?,client_supabase_id),
       cajero_id=COALESCE(?,cajero_id), cajero_supabase_id=COALESCE(?,cajero_supabase_id),
       seller_empleado_supabase_id=COALESCE(?,seller_empleado_supabase_id),
       washer_empleado_supabase_ids=COALESCE(?,washer_empleado_supabase_ids),
       tip_amount=?, servicio_amount=?, servicio_pct=?, fulfillment_type=COALESCE(?,fulfillment_type),
       mode=COALESCE(?,mode), notes=COALESCE(?,notes),
       order_source=COALESCE(?,order_source),
       payment_parts=?, split_bill=?,
       rev=COALESCE(rev,0)+1,
       updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id=?`).run(
      status,
      Number(data.subtotal || 0), Number(data.descuento || 0), Number(data.itbis || 0),
      Number(data.ley || 0), Number(data.total || 0),
      Number(data.beverage_subtotal || 0),
      data.payment_method || 'cash',
      ncfType, ncf,
      JSON.stringify(data.ecf_result || data.ecf || {}),
      data.tipo_venta || 'contado',
      data.vehicle_plate || null,
      data.client_id || null, data.client_supabase_id || null,
      data.cajero_id || null, data.cajero_supabase_id || null,
      data.seller_empleado_supabase_id || null,
      Array.isArray(data.washer_empleado_supabase_ids) ? JSON.stringify(data.washer_empleado_supabase_ids) : null,
      Number(data.tip_amount || 0),
      Number(data.servicio_amount || 0),
      Number(data.servicio_pct || 0),
      data.fulfillment_type || null,
      data.mode || null,
      data.comentario || data.notes || null,
      data.order_source || null,
      paymentPartsJson, splitBillFlag,
      row.id,
    )

    // Refresh cost + itbis on persisted items using current service rows
    // (parity with ticketCreate snapshot). Items inserted at seat-time had
    // cost=0/itbis=0 — fix here at close so profit reports stay accurate.
    const svcRows = db.prepare('SELECT id, cost, aplica_itbis FROM services').all()
    const svcCostById = new Map(svcRows.map(r => [r.id, r.cost || 0]))
    const svcAplicaById = new Map(svcRows.map(r => [r.id, r.aplica_itbis ?? 1]))
    const items = db.prepare('SELECT * FROM ticket_items WHERE ticket_id=?').all(row.id)
    const updItem = db.prepare('UPDATE ticket_items SET cost=?, itbis=? WHERE id=?')
    for (const it of items) {
      const cost = it.service_id ? (svcCostById.get(it.service_id) || 0) : 0
      const aplica = it.service_id ? (svcAplicaById.get(it.service_id) ?? 1) : 1
      // DR retail convention: `it.price` is GROSS (price tag includes ITBIS).
      // Extract embedded ITBIS: gross - gross/(1+factor). Was `price * factor`,
      // which over-counted by ~18% on every line item.
      const itbis = aplica !== 0 ? parseFloat((Number(it.price) - Number(it.price) / (1 + itbisFactor)).toFixed(2)) : 0
      updItem.run(cost, itbis, it.id)
    }

    // Commission writes — wipe any pre-existing rows for idempotency, then
    // recompute against the canonical seller/washer/cajero set.
    const sellerSid = data.seller_empleado_supabase_id || row.seller_empleado_supabase_id || null
    let washerSids = []
    try {
      const raw = data.washer_empleado_supabase_ids || row.washer_empleado_supabase_ids || '[]'
      washerSids = Array.isArray(raw) ? raw : JSON.parse(raw || '[]')
    } catch { washerSids = [] }
    const cajeroId = data.cajero_id || row.cajero_id || null

    const gross2base = 1 + itbisFactor
    let washerBaseGross = 0, sellerBaseGross = 0, cashierBaseGross = 0
    for (const it of items) {
      const line = (Number(it.price) || 0) * (Number(it.quantity) || 1)
      washerBaseGross += line
      sellerBaseGross += line
      if (!sellerSid) cashierBaseGross += line
    }
    const washerBase  = parseFloat((washerBaseGross  / gross2base).toFixed(2))
    const sellerBase  = parseFloat((sellerBaseGross  / gross2base).toFixed(2))
    const cashierBase = parseFloat((cashierBaseGross / gross2base).toFixed(2))

    try { db.prepare('DELETE FROM washer_commissions WHERE ticket_id=?').run(row.id) } catch {}
    try { db.prepare('DELETE FROM seller_commissions WHERE ticket_id=?').run(row.id) } catch {}
    try { db.prepare('DELETE FROM cajero_commissions WHERE ticket_id=?').run(row.id) } catch {}

    // Go-Live gate: in TEST MODE skip all commission/credit writes. Mirrors
    // ticketCreate. The DELETE-then-INSERT idempotency above already cleared
    // any pre-existing commission rows for this ticket.
    const _liveClose = isProductionLive()
    if (_liveClose && washerBase > 0 && washerSids.length) {
      for (const empSid of washerSids) {
        const emp = db.prepare(`SELECT comision_pct FROM empleados WHERE supabase_id=? AND tipo IN ('lavador','hybrid') LIMIT 1`).get(empSid)
        const pct = Number(emp?.comision_pct || 0)
        if (!emp || pct <= 0) continue
        const amt = parseFloat((washerBase * pct / 100).toFixed(2))
        db.prepare(`INSERT INTO washer_commissions
          (empleado_supabase_id,ticket_id,base_amount,commission_pct,commission_amount,paid,supabase_id,ticket_supabase_id)
          VALUES(?,?,?,?,?,0,?,?)`).run(empSid, row.id, washerBase, pct, amt, crypto.randomUUID(), row.supabase_id)
      }
    }
    if (_liveClose && sellerSid && sellerBase > 0) {
      const emp = db.prepare(`SELECT comision_pct FROM empleados WHERE supabase_id=? AND tipo IN ('vendedor','hybrid') LIMIT 1`).get(sellerSid)
      const pct = Number(emp?.comision_pct || 0)
      if (emp && pct > 0) {
        const amt = parseFloat((sellerBase * pct / 100).toFixed(2))
        db.prepare(`INSERT INTO seller_commissions
          (empleado_supabase_id,ticket_id,base_amount,commission_pct,commission_amount,paid,supabase_id,ticket_supabase_id)
          VALUES(?,?,?,?,?,0,?,?)`).run(sellerSid, row.id, sellerBase, pct, amt, crypto.randomUUID(), row.supabase_id)
      }
    }
    if (_liveClose && cajeroId && cashierBase > 0) {
      const cajero = db.prepare('SELECT commission_pct, supabase_id FROM users WHERE id=?').get(cajeroId)
      if (cajero && cajero.commission_pct > 0) {
        const amt = parseFloat((cashierBase * cajero.commission_pct / 100).toFixed(2))
        db.prepare(`INSERT INTO cajero_commissions
          (cajero_id,ticket_id,base_amount,commission_pct,commission_amount,paid,supabase_id,cajero_supabase_id,ticket_supabase_id)
          VALUES(?,?,?,?,?,0,?,?,?)`).run(cajeroId, row.id, cashierBase, cajero.commission_pct, amt,
            crypto.randomUUID(), cajero.supabase_id || null, row.supabase_id)
      }
    }

    if (_liveClose && data.client_id && data.tipo_venta === 'credito') {
      db.prepare('UPDATE clients SET balance=balance+?,visits=visits+1,total_spent=total_spent+? WHERE id=?')
        .run(Number(data.total || 0), Number(data.total || 0), data.client_id)
    } else if (_liveClose && data.client_id) {
      db.prepare('UPDATE clients SET visits=visits+1,total_spent=total_spent+? WHERE id=?')
        .run(Number(data.total || 0), data.client_id)
    }

    // v2.16.3 — Restaurante recetas: deduct ingredient inventory per ticket line.
    // Wrapped in try/catch — recipe deduction failures must NEVER block a sale.
    try { _applyRecipeDeduction(row, items, data.cajero_id || null) } catch {}

    return { ticketId: row.id, supabase_id: row.supabase_id, doc_number: row.doc_number, ncf }
  })
  return tx()
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
    // H2 — restaurant servicio (Ley 16-92) — repeated in self-heal so installs
    // that skipped the early migration block still get the columns.
    "ALTER TABLE tickets ADD COLUMN servicio_amount REAL NOT NULL DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN servicio_pct REAL DEFAULT 0",
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
    // v2.16.10 — Go-Live gate. While empty/future go_live_date, tickets are
    // flagged is_test=1 so they're skipped by sync push, DGII, commissions,
    // and credit. Wiped on goLiveCommit().
    "ALTER TABLE tickets ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN client_name TEXT",
    "ALTER TABLE tickets ADD COLUMN client_rnc TEXT",
  ]
  for (const sql of SELF_HEAL_TICKETS_COLS) { try { db.exec(sql) } catch {} }

  // Go-Live gate snapshot — read once, used on every gated branch below.
  const _live = isProductionLive()

  // Resolve the ITBIS rate once per ticket creation — stored as a string
  // percentage in app_settings.itbis_pct (default '18'). Avoid hitting the
  // settings table inside the per-item loop below.
  const itbisPctRow = db.prepare('SELECT value FROM app_settings WHERE key=?').get('itbis_pct')
  const itbisPct = Number(itbisPctRow?.value)
  const itbisFactor = (Number.isFinite(itbisPct) && itbisPct >= 0 ? itbisPct : 18) / 100

  // v2.16.31 follow-up — auto-charge Servicio 10% (Ley 16-92) on restaurant +
  // food_truck. Mirrors the web tickets.create branch so desktop / cloud
  // produce the same ticket totals for the same input. Skipped when:
  //   - caller already supplied data.ley > 0 (explicit override path)
  //   - data.servicio_amount > 0 (RestaurantPOS mesa flow drives that field)
  //   - owner set receipt_show_servicio_ley='0' in app_settings (opt-out is
  //     bidirectional — toggles both render AND charge).
  try {
    const incomingLey_ = Number(data.ley)
    const hasExplicitLey_ = Number.isFinite(incomingLey_) && incomingLey_ > 0
    const hasServicioAmount_ = Number(data.servicio_amount) > 0
    if (!hasExplicitLey_ && !hasServicioAmount_) {
      const bizTypeRow = db.prepare("SELECT value FROM app_settings WHERE key='business_type'").get()
      const bizType_ = String(bizTypeRow?.value || '').toLowerCase()
      if (bizType_ === 'restaurant' || bizType_ === 'food_truck') {
        const flagRow = db.prepare("SELECT value FROM app_settings WHERE key='receipt_show_servicio_ley'").get()
        const fv = flagRow?.value
        const optedOut_ = (fv === '0' || fv === 0 || fv === 'false' || fv === false)
        if (!optedOut_) {
          const grossSub_ = Number(data.subtotal) || 0
          const subEx_ = grossSub_ > 0 ? grossSub_ / (1 + itbisFactor) : 0
          const computed_ = Math.round(subEx_ * 0.10 * 100) / 100
          if (computed_ > 0) {
            data.ley = computed_
            data.total = Math.round(((Number(data.total) || 0) + computed_) * 100) / 100
          }
        }
      }
    }
  } catch (e) { try { console.error('[database.js] ley auto-compute failed:', e.message) } catch {} }

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

    // v2.14.19 — honor a caller-provided NCF. The e-CF flow (CobrarModal)
    // already reserved an eNCF via api.ncf.next() and built+signed the XML
    // against it. If we generate a fresh one here we double-increment the
    // sequence: the ticket stores ncf=N+1 while the eNCF actually sent to
    // DGII was N, causing the receipt/DB mismatch seen on the first real
    // E320000000018 sale.
    if (data.ncf && typeof data.ncf === 'string' && data.ncf.trim()) {
      ncf = data.ncf.trim().toUpperCase()
    } else if (multiPos && bizId && hwid) {
      const blk = ncfBlockConsumeNext({ businessId: bizId, hwid, ncfType })
      if (blk?.ncf) {
        ncf = blk.ncf
        ncfFromBlock = true
      }
      // If the block system is ON but no block is available, fall through to
      // legacy. Caller UI (CobrarModal) is responsible for prompting a refill
      // when offline+exhausted; here we keep the ticket atomic.
    }
    if (!ncf && !ncfFromBlock) {
      const ncfRow = db.prepare('SELECT * FROM ncf_sequences WHERE type=? AND active=1').get(ncfType)
      if (ncfRow) {
        const nextNCF = ncfRow.current_number + 1
        // Use canonical 3-char type prefix — guards against a corrupted
        // ncf_sequences.prefix column (we saw 'E320' in the wild).
        const ncfPrefix = String(ncfType).toUpperCase()
        const pad = /^E/.test(ncfPrefix) ? 10 : 8
        ncf = `${ncfPrefix}${String(nextNCF).padStart(pad, '0')}`
        db.prepare("UPDATE ncf_sequences SET current_number=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE type=?").run(nextNCF, ncfRow.type)
        if (multiPos) usedLegacyCounter = 1
      }
    }

    const ticketSid = crypto.randomUUID()
    // v2.14.20 — pre-validate client_id + cajero_id against the local tables
    // so a stale / freshly-pulled / cloud-only row doesn't blow up the INSERT
    // with "FOREIGN KEY constraint failed". Missing FK is better than a
    // blocked ticket — we null it out and let the cashier finish the sale.
    // The supabase_id lookups below still capture the UUID link so the row
    // can be rejoined by sync once the FK target lands locally.
    const _clientRow = data.client_id
      ? db.prepare('SELECT id, supabase_id FROM clients WHERE id=?').get(data.client_id)
      : null
    if (data.client_id && !_clientRow) {
      console.warn(`[ticketCreate] client_id=${data.client_id} not found — nulling FK`)
      data.client_id = null
    }
    const clientSid = _clientRow?.supabase_id || null

    const _cajeroRow = data.cajero_id
      ? db.prepare('SELECT id, supabase_id FROM users WHERE id=?').get(data.cajero_id)
      : null
    if (data.cajero_id && !_cajeroRow) {
      console.warn(`[ticketCreate] cajero_id=${data.cajero_id} not found — nulling FK`)
      data.cajero_id = null
    }
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
      (doc_number,client_id,client_name,client_rnc,washer_empleado_supabase_ids,seller_empleado_supabase_id,cajero_id,subtotal,descuento,itbis,ley,total,
       beverage_subtotal,payment_method,comprobante_type,ncf,ecf_result,tipo_venta,status,vehicle_plate,supabase_id,client_supabase_id,seller_supabase_id,cajero_supabase_id,
       mesa_id,mesa_supabase_id,fulfillment_type,tip_amount,servicio_amount,servicio_pct,mode,converted_from_mesa_id,converted_from_mesa_supabase_id,converted_from_ticket_id,converted_from_ticket_supabase_id,
       origin_hwid,used_legacy_counter,notes,order_source,payment_parts,split_bill,is_test,
       created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
      docNumber,
      data.client_id || null,
      data.client_name || null,
      data.client_rnc || null,
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
      Number(data.servicio_amount || 0),
      Number(data.servicio_pct || 0),
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
      _live ? 0 : 1,
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
    // v2.16.1 patch (#2) — per-line empleado_supabase_id stamped on the row
    // so commission writers below can credit the picker, not the ticket-level
    // seller. Default null → existing roll-up commission paths still apply.
    const insItem = db.prepare(`INSERT INTO ticket_items(ticket_id,service_id,name,price,cost,itbis,is_wash,quantity,sku,inventory_item_id,weight,unit,price_per_unit,is_deposit,preparation_notes,empleado_supabase_id,supabase_id,ticket_supabase_id,service_supabase_id,inventory_item_supabase_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    // v2.3 multi-POS — collected per-item deduct payloads enqueued at end of loop.
    const _pendingDeductItems = []
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
        item.preparation_notes ? String(item.preparation_notes).trim() || null : null, // v2.16.3 carnicería
        item.empleado_supabase_id || null, // v2.16.1 patch (#2) — per-line stylist
        itemSid, ticketSid, svcId ? svcSidById.get(svcId) : null, invItemSid)

      // Auto-deduct inventory stock (floor at 0 — never go negative).
      // RPT-H4: when requested > available, record a shortage row in
      // inventory_oversells so void-time reversal can restore only the
      // fulfilled amount (not the requested qty), preventing phantom stock.
      //
      // v2.3 multi-POS: when multi_pos_enabled='1' the local decrement is
      // SKIPPED and the deduct is enqueued in pending_inventory_deducts for
      // sync.js processPendingDeducts() to apply server-side via the atomic
      // RPC. This is the single-source-of-truth fix for dual-desktop: cloud
      // quantity is authoritative, local refreshes on next pull. Without
      // this skip, both desktops decrement local + push LWW + RPC = triple
      // decrement.
      if (item.inventory_item_id) {
        const invRow = db.prepare('SELECT supabase_id, quantity, name FROM inventory_items WHERE id=?').get(item.inventory_item_id)
        if (multiPos) {
          // Track for the pending-deduct enqueue collected outside the loop.
          // Local quantity stays put — pull will refresh it post-RPC.
          if (invRow?.supabase_id) {
            _pendingDeductItems.push({
              item_supabase_id: invRow.supabase_id,
              qty,
              name: invRow.name || item.name || null,
            })
          }
        } else {
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
    }

    // v2.3 multi-POS — enqueue all collected items into pending_inventory_deducts.
    // sync.js processPendingDeducts() picks this up on the next refill tick
    // (every 30s after boot, then every 10min), calls deduct_inventory_atomic
    // server-side with FOR UPDATE locks on each row. Oversells get written to
    // inventory_oversells by the RPC. Local SQLite refreshes via phase-1 pull.
    if (multiPos && _pendingDeductItems.length) {
      try { pendingDeductEnqueue({ ticketSupabaseId: ticketSid, items: _pendingDeductItems }) }
      catch (e) { /* non-fatal — sync will retry on next tick if the row landed */ }
    }

    // H2 — Restaurant Servicio (Ley 16-92) tip distribution. v2.16.3 ships
    // ONE row per ticket where the entire amount routes to the waiter.
    // TODO v2.17: multi-empleado tip split by points (waiters / busboys /
    // kitchen weighted distribution).
    const servicioAmt = Number(data.servicio_amount || 0)
    if (servicioAmt > 0 && data.waiter_empleado_id) {
      try {
        const w = db.prepare('SELECT id, supabase_id FROM empleados WHERE id=?').get(data.waiter_empleado_id)
        if (w) {
          db.prepare(`INSERT INTO tip_distributions
            (supabase_id, ticket_id, ticket_supabase_id, empleado_id, empleado_supabase_id, points, amount, business_id)
            VALUES (?,?,?,?,?,?,?,?)`).run(
              crypto.randomUUID(),
              ticketId, ticketSid,
              w.id, w.supabase_id || null,
              1, servicioAmt, bizId || null,
            )
        }
      } catch (e) { /* non-fatal — tip distribution is audit-grade, never blocks sale */ }
    }

    // Update client balance if credit — gated by Go-Live: in TEST mode we
    // never grant credit balance or stamp visit/spend (would pollute clients).
    if (_live) {
      if (data.client_id && data.tipo_venta === 'credito') {
        db.prepare('UPDATE clients SET balance=balance+?,visits=visits+1,total_spent=total_spent+? WHERE id=?')
          .run(data.total, data.total, data.client_id)
      } else if (data.client_id) {
        db.prepare('UPDATE clients SET visits=visits+1,total_spent=total_spent+? WHERE id=?')
          .run(data.total, data.client_id)
      }
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
    // v2.16.1 patch (#2) — per-line stylist credit. When the cashier picked a
    // stylist for a specific line (CobrarModal salon flow), that line's
    // commission goes to THAT stylist, not the ticket-level seller/washer
    // roll-up. Collect those credits separately and exclude their gross from
    // the bulk washer/seller bases below.
    const perLineCredits = [] // [{ empleado_supabase_id, baseGross }]
    for (const item of (data.items || [])) {
      const svcId = item.service_id && validSvcIds.has(item.service_id) ? item.service_id : null
      const qty = Math.max(1, parseInt(item.quantity || 1, 10))
      const line = (item.price || 0) * qty
      const itemIsWash = svcId ? (svcIsWashById.get(svcId) ?? 1) : (item.is_wash ?? 1)
      const washerOn  = svcId ? !!svcWasherById.get(svcId)  : (itemIsWash !== 0)
      const sellerOn  = svcId ? !!svcSellerById.get(svcId)  : (itemIsWash !== 0)
      const cashierOn = svcId ? !!svcCashierById.get(svcId) : true
      // Per-line stylist trumps the roll-up (only relevant when the line is
      // commission-eligible at all — washerOn || sellerOn).
      if (item.empleado_supabase_id && (washerOn || sellerOn)) {
        perLineCredits.push({ empleado_supabase_id: item.empleado_supabase_id, baseGross: line })
        // Cashier still earns on products/no-seller services per existing rule.
        if (cashierOn && (itemIsWash === 0 || !hasSeller)) cashierBaseGross += line
        continue
      }
      if (washerOn)  washerBaseGross += line
      if (sellerOn)  sellerBaseGross += line
      // Cashier: products always, services only when no seller
      if (cashierOn && (itemIsWash === 0 || !hasSeller)) cashierBaseGross += line
    }
    const gross2base  = 1 + itbisFactor
    const washerBase  = parseFloat((washerBaseGross  / gross2base).toFixed(2))
    const sellerBase  = parseFloat((sellerBaseGross  / gross2base).toFixed(2))
    const cashierBase = parseFloat((cashierBaseGross / gross2base).toFixed(2))

    if (_live && washerBase > 0 && washerEmpSids.length) {
      // v2.14.20 — optional per-washer commission override. When the cashier
      // enters a specific RD$ amount for a given lavador on a 2+ washer
      // ticket, that amount wins over the auto-calc (empleado.comision_pct
      // × washerBase). Shape: [{ empleado_supabase_id, amount }]. Any washer
      // without an override row falls back to the auto-calc.
      const overrideMap = new Map()
      if (Array.isArray(data.washer_commission_overrides)) {
        for (const o of data.washer_commission_overrides) {
          if (o?.empleado_supabase_id && Number(o.amount) > 0) {
            overrideMap.set(o.empleado_supabase_id, Number(o.amount))
          }
        }
      }
      // v2.1: walk the UUID array, JOIN empleados for commission_pct.
      for (const empSid of washerEmpSids) {
        const emp = db.prepare(`SELECT comision_pct FROM empleados WHERE supabase_id=? AND tipo IN ('lavador','hybrid') LIMIT 1`).get(empSid)
        if (!emp) continue
        const override = overrideMap.get(empSid)
        const pct = Number(emp?.comision_pct || 0)
        let commAmount, storedPct
        if (override != null) {
          commAmount = parseFloat(override.toFixed(2))
          // Back-solve a display pct from the override so reports stay coherent.
          storedPct = washerBase > 0 ? parseFloat(((commAmount / washerBase) * 100).toFixed(2)) : 0
        } else {
          if (pct <= 0) continue
          commAmount = parseFloat((washerBase * pct / 100).toFixed(2))
          storedPct = pct
        }
        const wcSid = crypto.randomUUID()
        db.prepare(`INSERT INTO washer_commissions
          (empleado_supabase_id,ticket_id,base_amount,commission_pct,commission_amount,paid,supabase_id,ticket_supabase_id)
          VALUES(?,?,?,?,?,0,?,?)`).run(empSid, ticketId, washerBase, storedPct, commAmount, wcSid, ticketSid)
      }
    }

    if (_live && sellerEmpSid && sellerBase > 0) {
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

    if (_live && data.cajero_id && cashierBase > 0) {
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

    // v2.16.1 patch (#2) — per-line stylist credits. Writes to the role's
    // canonical commission table based on empleados.tipo (lavador/hybrid →
    // washer_commissions, vendedor → seller_commissions). Sum bases per
    // empleado before writing so two lines for the same stylist collapse
    // into one row (matches the roll-up shape).
    if (_live && perLineCredits.length) {
      const grossSumByEmp = new Map()
      for (const c of perLineCredits) {
        grossSumByEmp.set(c.empleado_supabase_id, (grossSumByEmp.get(c.empleado_supabase_id) || 0) + c.baseGross)
      }
      for (const [empSid, gross] of grossSumByEmp.entries()) {
        try {
          const emp = db.prepare(`SELECT tipo, comision_pct FROM empleados WHERE supabase_id=?`).get(empSid)
          if (!emp) continue
          const pct = Number(emp.comision_pct || 0)
          if (pct <= 0) continue
          const baseStripped = parseFloat((gross / (1 + itbisFactor)).toFixed(2))
          const commAmt = parseFloat((baseStripped * pct / 100).toFixed(2))
          const sid = crypto.randomUUID()
          const tbl = (emp.tipo === 'vendedor') ? 'seller_commissions' : 'washer_commissions'
          db.prepare(`INSERT INTO ${tbl}
            (empleado_supabase_id,ticket_id,base_amount,commission_pct,commission_amount,paid,supabase_id,ticket_supabase_id)
            VALUES(?,?,?,?,?,0,?,?)`).run(empSid, ticketId, baseStripped, pct, commAmt, sid, ticketSid)
        } catch (e) { /* per-line credit write failure is non-fatal — roll-up still on */ }
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

    // v2.16.3 — Restaurante recetas: legacy non-restaurant fallback also
    // honors recipes (mesa-mode goes through ticketCloseWithPayment instead).
    // Build the items shape the recipe helper expects (service_supabase_id +
    // quantity), then deduct. Wrapped — must never break a sale.
    try {
      const recipeItems = (data.items || []).map(it => ({
        service_supabase_id: it.service_supabase_id
          || (it.service_id ? db.prepare('SELECT supabase_id FROM services WHERE id=?').get(it.service_id)?.supabase_id : null),
        quantity: Number(it.quantity || 1),
      })).filter(x => x.service_supabase_id)
      if (recipeItems.length) {
        const ticketRow = { id: ticketId, supabase_id: ticketSid, doc_number: docNumber }
        _applyRecipeDeduction(ticketRow, recipeItems, data.cajero_id || null)
      }
    } catch {}

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
    // v2.14.23 — CRITICAL FIX: bump updated_at. Sync push cursor is
    // `WHERE updated_at > lastSyncedAt`; without this bump the row's
    // new state (cobrado + new NCF) never pushes to Supabase, and the
    // next pull tick overwrites it back to pendiente via statusSync
    // columns. Cobrar-from-Cola silently reverts within seconds — real
    // money goes untracked. Identified by desktop-Claude audit 2026-04-24.
    db.prepare(`UPDATE tickets SET status=?,
      payment_method=COALESCE(?,payment_method),
      ncf=COALESCE(?,ncf),
      ecf_result=COALESCE(?,ecf_result),
      cajero_id=COALESCE(?,cajero_id),
      notes=COALESCE(?,notes),
      descuento=COALESCE(?,descuento),
      rev=COALESCE(rev,0)+1,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=?`).run(
      newStatus,
      paymentMethod || null, ncf || null,
      ecfResult ? JSON.stringify(ecfResult) : null,
      cajeroId || null,
      noteVal,
      (descuento != null ? Number(descuento) : null),
      id)

    if (tipoVenta === 'credito' && clientId && isProductionLive()) {
      // Fetch original tipo_venta to avoid double-counting if ticket was already posted as credit
      const row = db.prepare('SELECT total, descuento, tipo_venta FROM tickets WHERE id=?').get(id)
      if (row && row.tipo_venta !== 'credito') {
        // Use NET amount (total - descuento) so descuento applied in CobrarModal
        // is honored on the client's balance. The gross total stays on the ticket.
        const netOwed = Number(row.total || 0) - Number(row.descuento || 0)
        const amount = Math.max(0, netOwed)
        db.prepare(`UPDATE tickets SET tipo_venta=?,client_id=?,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
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
    // v2.14.23 — bump updated_at or the void gets reverted by next pull.
    db.prepare(`UPDATE tickets SET status='nula',void_reason=?,void_by=?,void_at=datetime('now'),
      rev=COALESCE(rev,0)+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
      .run(reason, voidById || null, id)
    // Reverse client balance if it was a credit ticket (clamped at 0, net of descuento)
    reverseClientBalanceForTicket(ticket)
    // Reverse commissions — any washer/seller/cajero commission rows tied to
    // this ticket are now unearned, delete them so liquidación stays honest.
    // v2.14.23 — also tombstone each row so the delete propagates to Supabase.
    // Prior behavior was local-only DELETE; remote rows survived forever
    // (audit D-i 2026-04-24: voided ticket's commissions kept showing on
    // Supabase + remote payroll).
    const bizIdForT = ticket.business_id || _bizId() || null
    for (const tbl of ['washer_commissions','seller_commissions','cajero_commissions']) {
      const rows = db.prepare(`SELECT supabase_id FROM ${tbl} WHERE ticket_id=? OR (ticket_supabase_id IS NOT NULL AND ticket_supabase_id=?)`).all(id, ticket.supabase_id || null)
      for (const r of rows) { if (r.supabase_id) { try { tombstoneAdd(tbl, r.supabase_id, bizIdForT) } catch {} } }
      db.prepare(`DELETE FROM ${tbl} WHERE ticket_id=? OR (ticket_supabase_id IS NOT NULL AND ticket_supabase_id=?)`).run(id, ticket.supabase_id || null)
    }
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

// v2.14.36 — variant that hydrates each ticket with its items[] array. Used by
// BottleDepositReport (needs to scan ticket_items for is_deposit / SKU='DEP').
// One extra query per range, batched by ticket id list. Cheap enough for the
// 30-day windows BottleDepositReport uses.
function ticketGetByDateRangeWithItems(dateFrom, dateTo) {
  if (!db) return []
  const rows = ticketsGetAll({ dateFrom, dateTo })
  if (!rows.length) return rows
  const ids = rows.map(r => r.id)
  const placeholders = ids.map(() => '?').join(',')
  const itemRows = db.prepare(`SELECT * FROM ticket_items WHERE ticket_id IN (${placeholders})`).all(...ids)
  const byTicket = new Map()
  for (const it of itemRows) {
    if (!byTicket.has(it.ticket_id)) byTicket.set(it.ticket_id, [])
    byTicket.get(it.ticket_id).push(it)
  }
  for (const r of rows) r.items = byTicket.get(r.id) || []
  return rows
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

    // v2.14.23 — bump updated_at so the recalc survives next pull
    db.prepare(`UPDATE tickets SET subtotal=?, itbis=?, total=?, beverage_subtotal=?,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
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
    // v2.14.20 — also pull ALL washer names via washer_commissions (one row
     // per washer-on-ticket). queue itself only stores the first empleado_supabase_id,
     // so tickets with 2+ washers lost the rest. washer_names is a " + "-joined
     // string of every worker on the ticket — Queue.jsx maps it for display.
    return db.prepare(
      `SELECT q.*, t.doc_number, t.total, t.vehicle_plate, t.created_at as ticket_created,
              t.mesa_id, t.mesa_supabase_id, m.name as mesa_name,
              c.name as client_name, c.phone as client_phone,
              (SELECT GROUP_CONCAT(ti.name, ' + ') FROM ticket_items ti WHERE ti.ticket_id = t.id) as services,
              e.nombre as washer_name,
              (SELECT GROUP_CONCAT(e2.nombre, ' + ')
                 FROM washer_commissions wc
                 JOIN empleados e2 ON e2.supabase_id = wc.empleado_supabase_id
                WHERE wc.ticket_id = t.id OR wc.ticket_supabase_id = t.supabase_id) AS washer_names
       FROM queue q
       JOIN tickets t ON (t.id = q.ticket_id OR t.supabase_id = q.ticket_supabase_id)
       LEFT JOIN clients c ON (c.id = t.client_id OR c.supabase_id = t.client_supabase_id)
       LEFT JOIN empleados e ON e.supabase_id = q.empleado_supabase_id
       LEFT JOIN mesas m ON (m.id = t.mesa_id OR m.supabase_id = t.mesa_supabase_id)
       WHERE q.status NOT IN ('done', 'cancelled')
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
  // FIX 5.5 — idempotent: a second delete (multi-bay race / network retry)
  // must NOT double-reverse balance, double-restore inventory, or double-
  // tombstone commissions. If the queue row is already cancelled, return a
  // soft-success so the renderer's optimistic update still resolves.
  if (row.status === 'cancelled') return { id, ticketId: row.ticket_id, alreadyCancelled: true }
  const now = new Date().toISOString()
  db.transaction(() => {
    // Reverse any credit-ticket balance BEFORE we mark the ticket anulado.
    // Without this, deleted credit tickets leave a ghost debt on the client.
    if (row.ticket_id) {
      const ticket = db.prepare('SELECT id, client_id, tipo_venta, total, descuento FROM tickets WHERE id=?').get(row.ticket_id)
      reverseClientBalanceForTicket(ticket)
      // Also reverse any commissions tied to this ticket — they were written
      // at create time; if the ticket is cancelled, they're unearned.
      // v2.14.23 — tombstone before DELETE so the removal propagates to Supabase.
      const bizIdQD = ticket?.business_id || _bizId() || null
      for (const tbl of ['washer_commissions','seller_commissions','cajero_commissions']) {
        const rows = db.prepare(`SELECT supabase_id FROM ${tbl} WHERE ticket_id=? OR ticket_supabase_id IN (SELECT supabase_id FROM tickets WHERE id=?)`).all(row.ticket_id, row.ticket_id)
        for (const r of rows) { if (r.supabase_id) { try { tombstoneAdd(tbl, r.supabase_id, bizIdQD) } catch {} } }
        db.prepare(`DELETE FROM ${tbl} WHERE ticket_id=? OR ticket_supabase_id IN (SELECT supabase_id FROM tickets WHERE id=?)`).run(row.ticket_id, row.ticket_id)
      }
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
    // v2.14.23 — bump updated_at so void survives next pull.
    db.prepare(`UPDATE tickets SET status='anulado', rev=COALESCE(rev,0)+1,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(row.ticket_id)
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

// v2.14.24 — used by Queue.jsx Cobrar-from-Cola to print one conduce per
// washer. queue rows store only the first empleado_supabase_id (schema
// limit), so we read the authoritative list from washer_commissions where
// one row was inserted per washer at ticketCreate time.
function washerCommissionsByTicket(ticketId) {
  if (!db || !ticketId) return []
  try {
    const ticket = db.prepare('SELECT supabase_id FROM tickets WHERE id=?').get(ticketId)
    const tsid = ticket?.supabase_id || null
    return db.prepare(
      `SELECT wc.empleado_supabase_id, e.nombre,
              wc.base_amount, wc.commission_pct, wc.commission_amount
         FROM washer_commissions wc
         JOIN empleados e ON e.supabase_id = wc.empleado_supabase_id
        WHERE wc.ticket_id = ? OR (wc.ticket_supabase_id IS NOT NULL AND wc.ticket_supabase_id = ?)
        ORDER BY wc.id ASC`
    ).all(ticketId, tsid)
  } catch (e) { console.error('[washerCommissionsByTicket]', e.message); return [] }
}

function commissionsGetByPeriod(dateFrom, dateTo) {
  if (!db) return []
  try {
    // v2.13.9 — scalar ticket lookup instead of LEFT JOIN to avoid fanout.
    // v2.14.24 — also return total_paid + total_acumulado so liquidación
    // screens can show the full accrual, not just the unpaid balance.
    // `total_commission` stays as unpaid-only for callers that rely on
    // "pagar ahora" view. New fields: total_paid, total_acumulado,
    // ticket_count_total, ticket_count_paid.
    // 2026-04-30 — LEFT JOIN empleados, NOT inner. The "Liquidación shows 0"
    // bug has now hit 8 times: every time `empleados` resyncs (rows recreated
    // with fresh supabase_ids, or pull misses the worker row entirely), an
    // INNER JOIN here silently drops every StarSISA-imported / manual
    // commission whose empleado_supabase_id no longer matches a local
    // empleados row. The commissions never actually disappeared — they were
    // just hidden by the JOIN. With LEFT JOIN + COALESCE name, an orphan
    // commission shows up under "(sin empleado)" instead of vanishing, which
    // is both correct and self-healing.
    return db.prepare(
      `SELECT wc.empleado_supabase_id, e.id as washer_id,
              COALESCE(e.nombre, '(sin empleado)') as washer_name,
              e.comision_pct as commission_pct,
              SUM(CASE WHEN COALESCE(wc.paid,0)=0 THEN 1 ELSE 0 END)   as ticket_count,
              SUM(CASE WHEN COALESCE(wc.paid,0)=1 THEN 1 ELSE 0 END)   as ticket_count_paid,
              COUNT(wc.id)                                             as ticket_count_total,
              SUM(CASE WHEN COALESCE(wc.paid,0)=0 THEN wc.base_amount ELSE 0 END) as total_base,
              SUM(CASE WHEN COALESCE(wc.paid,0)=0 THEN wc.commission_amount ELSE 0 END) as total_commission,
              SUM(CASE WHEN COALESCE(wc.paid,0)=1 THEN wc.commission_amount ELSE 0 END) as total_paid,
              SUM(wc.commission_amount)                                as total_acumulado
       FROM washer_commissions wc
       LEFT JOIN empleados e ON e.supabase_id = wc.empleado_supabase_id
       WHERE COALESCE(
               (SELECT t.status FROM tickets t WHERE t.id = wc.ticket_id LIMIT 1),
               (SELECT t.status FROM tickets t WHERE t.supabase_id = wc.ticket_supabase_id LIMIT 1),
               'cobrado'
             ) = 'cobrado'
         AND COALESCE(
               (SELECT t.created_at FROM tickets t WHERE t.id = wc.ticket_id LIMIT 1),
               (SELECT t.created_at FROM tickets t WHERE t.supabase_id = wc.ticket_supabase_id LIMIT 1),
               wc.created_at
             ) BETWEEN ? AND ?
       GROUP BY wc.empleado_supabase_id ORDER BY total_acumulado DESC`
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
    // v2.14.24 — parallel to commissionsGetByPeriod: return total_paid +
    // total_acumulado for liquidación. See that function for rationale.
    // 2026-04-30 — same LEFT JOIN fix as commissionsGetByPeriod.
    return db.prepare(
      `SELECT sc.empleado_supabase_id, e.id as seller_id,
              COALESCE(e.nombre, '(sin empleado)') as seller_name,
              e.comision_pct as commission_pct,
              SUM(CASE WHEN COALESCE(sc.paid,0)=0 THEN 1 ELSE 0 END)   as ticket_count,
              SUM(CASE WHEN COALESCE(sc.paid,0)=1 THEN 1 ELSE 0 END)   as ticket_count_paid,
              COUNT(sc.id)                                             as ticket_count_total,
              SUM(CASE WHEN COALESCE(sc.paid,0)=0 THEN sc.base_amount ELSE 0 END) as total_base,
              SUM(CASE WHEN COALESCE(sc.paid,0)=0 THEN sc.commission_amount ELSE 0 END) as total_commission,
              SUM(CASE WHEN COALESCE(sc.paid,0)=1 THEN sc.commission_amount ELSE 0 END) as total_paid,
              SUM(sc.commission_amount)                                as total_acumulado
       FROM seller_commissions sc
       LEFT JOIN empleados e ON e.supabase_id = sc.empleado_supabase_id
       WHERE COALESCE(
               (SELECT t.status FROM tickets t WHERE t.id = sc.ticket_id LIMIT 1),
               (SELECT t.status FROM tickets t WHERE t.supabase_id = sc.ticket_supabase_id LIMIT 1),
               'cobrado'
             ) = 'cobrado'
         AND COALESCE(
               (SELECT t.created_at FROM tickets t WHERE t.id = sc.ticket_id LIMIT 1),
               (SELECT t.created_at FROM tickets t WHERE t.supabase_id = sc.ticket_supabase_id LIMIT 1),
               sc.created_at
             ) BETWEEN ? AND ?
       GROUP BY sc.empleado_supabase_id ORDER BY total_acumulado DESC`
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
    // v2.14.24 — parallel to commissionsGetByPeriod: return total_paid +
    // total_acumulado for liquidación view.
    return db.prepare(
      `SELECT cc.empleado_supabase_id, cc.cajero_id,
              e.id as cajero_emp_id, e.nombre as cajero_name, e.comision_pct as commission_pct,
              SUM(CASE WHEN COALESCE(cc.paid,0)=0 THEN 1 ELSE 0 END)   as ticket_count,
              SUM(CASE WHEN COALESCE(cc.paid,0)=1 THEN 1 ELSE 0 END)   as ticket_count_paid,
              COUNT(cc.id)                                             as ticket_count_total,
              SUM(CASE WHEN COALESCE(cc.paid,0)=0 THEN cc.base_amount ELSE 0 END) as total_base,
              SUM(CASE WHEN COALESCE(cc.paid,0)=0 THEN cc.commission_amount ELSE 0 END) as total_commission,
              SUM(CASE WHEN COALESCE(cc.paid,0)=1 THEN cc.commission_amount ELSE 0 END) as total_paid,
              SUM(cc.commission_amount)                                as total_acumulado
       FROM cajero_commissions cc
       JOIN empleados e ON e.supabase_id = cc.empleado_supabase_id
       WHERE COALESCE(
               (SELECT t.status FROM tickets t WHERE t.id = cc.ticket_id LIMIT 1),
               (SELECT t.status FROM tickets t WHERE t.supabase_id = cc.ticket_supabase_id LIMIT 1),
               'cobrado'
             ) = 'cobrado'
         AND COALESCE(
               (SELECT t.created_at FROM tickets t WHERE t.id = cc.ticket_id LIMIT 1),
               (SELECT t.created_at FROM tickets t WHERE t.supabase_id = cc.ticket_supabase_id LIMIT 1),
               cc.created_at
             ) BETWEEN ? AND ?
       GROUP BY cc.empleado_supabase_id ORDER BY total_acumulado DESC`
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
  // v2.16.10 2026-04-30 — DO NOT REVERT (FIX-LEDGER §3.1). Previous code did
  // unconditional INSERT — left `status='abierto'` shift row orphaned forever
  // because cuadreOpenShift creates a separate row. Now: if an open shift
  // exists for (cajero_id, date), UPGRADE that row to status='cerrado' and
  // stamp the closing values. Else INSERT new (closed) row.
  const existing = db.prepare(
    `SELECT id, supabase_id FROM cuadre_caja
       WHERE cajero_id=@cajero_id AND date=@date AND status='abierto' LIMIT 1`
  ).get({ cajero_id: data.cajero_id, date: data.date })
  let sid, lastId
  if (existing) {
    sid = existing.supabase_id
    lastId = existing.id
    db.prepare(`UPDATE cuadre_caja SET
      fondo=@fondo, efectivo_conteo=@efectivo_conteo, efectivo_sistema=@efectivo_sistema,
      tarjeta=@tarjeta, transferencia=@transferencia, cheque=@cheque, creditos=@creditos,
      salidas=@salidas, total_vendido=@total_vendido, total_cobrado=@total_cobrado,
      cierre_total=@cierre_total, diferencia=@diferencia, comentario=@comentario,
      denominaciones=@denominaciones, status='cerrado', closed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=@id`).run({
      ...data,
      denominaciones: JSON.stringify(data.denominaciones || {}),
      id: existing.id,
    })
  } else {
    sid = crypto.randomUUID()
    const ins = db.prepare(`INSERT INTO cuadre_caja
      (cajero_id,date,fondo,efectivo_conteo,efectivo_sistema,tarjeta,transferencia,
       cheque,creditos,salidas,total_vendido,total_cobrado,cierre_total,diferencia,
       comentario,denominaciones,supabase_id,status,closed_at)
      VALUES(@cajero_id,@date,@fondo,@efectivo_conteo,@efectivo_sistema,@tarjeta,
             @transferencia,@cheque,@creditos,@salidas,@total_vendido,@total_cobrado,
             @cierre_total,@diferencia,@comentario,@denominaciones,@supabase_id,'cerrado',
             strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).run({
      ...data,
      denominaciones: JSON.stringify(data.denominaciones || {}),
      supabase_id: sid,
    })
    lastId = ins.lastInsertRowid
  }
  const diff = Number(data.diferencia || 0)
  if (Math.abs(diff) > 50) {
    activityLogRecord({ event_type: 'cuadre_discrepancy',
      severity: Math.abs(diff) >= 500 ? 'critical' : 'warn',
      actor_user_id: data.cajero_id || null,
      target_type: 'cuadre_caja', target_id: lastId,
      target_name: `Cuadre ${data.date || ''}`.trim(),
      amount: diff,
      old_value: String(data.efectivo_sistema || 0),
      new_value: String(data.efectivo_conteo || 0),
      reason: data.comentario || (diff > 0 ? 'Sobrante' : 'Faltante'),
      metadata: { cierre_total: data.cierre_total, total_cobrado: data.total_cobrado } })
  }
  return { id: lastId, supabase_id: sid }
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
  db.prepare("UPDATE ncf_sequences SET current_number=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE type=?").run(next, type)
  // DGII NCF spec is absolute: 3-char prefix + 8-digit seq for legacy
  // (B01/B02/B14/B15) = 11 char total; 3-char prefix + 10-digit seq for
  // electronic (E31/E32/…) = 13 char total. The `type` column is the
  // canonical 3-char prefix by definition — use it directly. Ignore
  // whatever row.prefix stored, since a stray sync once wrote 'E320'
  // (4 chars) there, producing 14-char eNCFs DGII rejected with
  // 'Archivo no válido'.
  const prefix = String(type).toUpperCase()
  const pad = /^E/.test(prefix) ? 10 : 8
  return `${prefix}${String(next).padStart(pad, '0')}`
}
function ncfUpdateSequence(type, data) {
  if (!db) return
  const allowed = ['prefix', 'current_number', 'limit_number', 'active', 'enabled', 'valid_until']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return
  // v2.16.28 (L1) — Desktop parity port of the v2.16.27 web UPSERT fix.
  // The original UPDATE-only path matched 0 rows on a fresh client (or any
  // type the user hadn't pre-seeded) and silently succeeded. Now: read
  // existing first, INSERT if missing, UPDATE if present. Same shape +
  // defaults as the web side at packages/data/web.js::updateSequence.
  const existing = db.prepare(`SELECT id FROM ncf_sequences WHERE type=?`).get(type)
  if (existing) {
    const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
    db.prepare(`UPDATE ncf_sequences SET ${fields} WHERE type=@type`).run({ ...patch, type })
  } else {
    const insert = {
      type,
      prefix:         patch.prefix         ?? type,
      current_number: patch.current_number ?? 0,
      limit_number:   patch.limit_number   ?? 500,
      enabled:        patch.enabled        ?? 0,
      active:         patch.active         ?? 1,
      valid_until:    patch.valid_until    ?? null,
    }
    db.prepare(`INSERT INTO ncf_sequences (type, prefix, current_number, limit_number, enabled, active, valid_until)
                VALUES (@type, @prefix, @current_number, @limit_number, @enabled, @active, @valid_until)`).run(insert)
  }
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
  // v2.14.22 — also join on client_supabase_id so web-created or not-yet-pulled
  // client rows still resolve the name/RNC instead of showing NULL (Audit D4).
  return db.prepare(
    `SELECT t.id, t.ncf, t.comprobante_type as tipo, t.created_at as fecha,
            t.subtotal, t.itbis, t.ley, t.total, t.status as estado,
            COALESCE(t.client_name, c.name) as client_name, COALESCE(t.client_rnc, c.rnc) as client_rnc
     FROM tickets t
     LEFT JOIN clients c
            ON (c.id = t.client_id OR c.supabase_id = t.client_supabase_id)
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
  const initialQty = Number(data.quantity) || 0
  const r = db.prepare(`INSERT INTO inventory_items(sku,name,category,quantity,min_quantity,price,price_pedidos_ya,cost,barcode,aplica_itbis,sold_by_weight,unit,price_per_unit,bottle_deposit,tare_default,prepacked,corte_category_supabase_id,received_at,expires_at,supabase_id)
    VALUES(@sku,@name,@category,@quantity,@min_quantity,@price,@price_pedidos_ya,@cost,@barcode,@aplica_itbis,@sold_by_weight,@unit,@price_per_unit,@bottle_deposit,@tare_default,@prepacked,@corte_category_supabase_id,@received_at,@expires_at,@supabase_id)`).run({
    sku: data.sku || null, name: data.name, category: data.category || '',
    quantity: initialQty, min_quantity: data.min_quantity ?? 5,
    price: data.price || 0,
    price_pedidos_ya: data.price_pedidos_ya != null && data.price_pedidos_ya !== '' ? Number(data.price_pedidos_ya) : null,
    cost: data.cost || 0,
    barcode: data.barcode || null, aplica_itbis: data.aplica_itbis ?? 1,
    sold_by_weight: data.sold_by_weight ? 1 : 0,
    unit: data.unit || null,
    price_per_unit: data.price_per_unit != null ? Number(data.price_per_unit) : null,
    bottle_deposit: data.bottle_deposit != null ? Number(data.bottle_deposit) : null,
    tare_default: data.tare_default != null ? Number(data.tare_default) : null,
    // v2.16.3 carnicería
    prepacked: data.prepacked ? 1 : 0,
    corte_category_supabase_id: data.corte_category_supabase_id || null,
    received_at: data.received_at || null,
    expires_at: data.expires_at || null,
    supabase_id: sid,
  })
  const newId = r.lastInsertRowid
  // v2.16.3 — when a carnicería item is created with received_at + expires_at,
  // auto-open a freshness_log batch so FreshnessAlerts shows it without
  // requiring a separate manual step. Idempotent: only fires on initial create
  // with both dates populated.
  if (data.received_at && data.expires_at && initialQty > 0) {
    try {
      const fSid = crypto.randomUUID()
      db.prepare(`INSERT INTO inventory_freshness_log
        (supabase_id, business_id, inventory_item_supabase_id, batch_lote, received_at, expires_at, qty_received, qty_remaining, unit, auto_discount_applied)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(
          fSid, _bizId(), sid,
          data.batch_lote || ('LOTE-' + new Date().toISOString().slice(0,10).replace(/-/g,'')),
          data.received_at, data.expires_at,
          initialQty, initialQty,
          data.unit || 'lb'
        )
    } catch {}
  }
  // v2.14.35 — emit opening-balance ledger row + activity_log entry so a brand-new
  // product's stock has the same audit footprint as any later adjustment. Skip
  // the ledger insert when initialQty is 0 (no movement to log).
  try {
    if (initialQty > 0) {
      db.prepare('INSERT INTO inventory_transactions(item_id,type,delta,notes,user_id,supabase_id,item_supabase_id) VALUES(?,?,?,?,?,?,?)')
        .run(newId, 'opening', initialQty, 'Cantidad inicial al crear el producto', data.user_id || null, crypto.randomUUID(), sid)
    }
    activityLogRecord({
      event_type: 'inventory_created', severity: 'info',
      actor_user_id: data.user_id || null,
      target_type: 'inventory_item', target_id: newId, target_name: data.name || `#${newId}`,
      amount: initialQty,
      new_value: String(initialQty),
      reason: data.sku ? `SKU: ${data.sku}` : null,
      metadata: { sku: data.sku || null, category: data.category || null, price: data.price || 0, cost: data.cost || 0 },
    })
  } catch {}
  return { id: newId, supabase_id: sid }
}
function inventoryUpdate(id, data) {
  if (!db) return
  // Build a dynamic SET clause so bulk-edit patches (e.g. { category } or
  // { price_pedidos_ya }) only touch the fields provided and never blank out
  // the rest of the row.
  // v2.14.35 — `quantity` REMOVED from ALLOWED list. Stock changes must flow
  // through inventoryAdjust() so every change writes an inventory_transactions
  // row + activity_log entry. Silent qty edits during a price/category bulk
  // update are now impossible. (Sales, voids, and conteo apply still update
  // qty directly via their own audited paths.)
  const ALLOWED = ['sku','name','category','min_quantity','price','price_pedidos_ya','cost','barcode','aplica_itbis','sold_by_weight','unit','price_per_unit','bottle_deposit','tare_default',
    // v2.16.3 carnicería
    'prepacked','corte_category_supabase_id','received_at','expires_at']
  const sets = []
  const params = { id }
  for (const k of ALLOWED) {
    if (!(k in data)) continue
    let v = data[k]
    if (k === 'sold_by_weight' || k === 'prepacked') v = v ? 1 : 0
    else if (k === 'aplica_itbis') v = v ?? 1
    else if (['price_pedidos_ya','price_per_unit','bottle_deposit','tare_default'].includes(k)) {
      v = (v === '' || v == null) ? null : Number(v)
    } else if (['price','cost'].includes(k)) {
      v = v === '' || v == null ? 0 : Number(v)
    } else if (k === 'min_quantity') {
      v = v ?? 5
    } else if (['sku','barcode','unit','corte_category_supabase_id','received_at','expires_at'].includes(k)) {
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
  // v2.16.10 2026-04-30 — DO NOT REVERT (FIX-LEDGER §3.3). Soft-delete was
  // silent. Ley 32-23 traceability requires audit row on inventory removal.
  const row = db.prepare('SELECT id, supabase_id, business_id, name, sku, quantity FROM inventory_items WHERE id=?').get(id)
  db.prepare('UPDATE inventory_items SET active=0 WHERE id=?').run(id)
  if (row?.supabase_id) tombstoneAdd('inventory_items', row.supabase_id, row.business_id)
  if (row) {
    activityLogRecord({ event_type: 'inventory_deleted', severity: 'warn',
      target_type: 'inventory_item', target_id: row.id, target_name: row.name || '',
      reason: 'Soft-deleted via inventoryDelete',
      metadata: { sku: row.sku || null, quantity_at_delete: Number(row.quantity || 0) } })
  }
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

// ── v2.16.3 — Service recipes (Bill-of-Materials) ───────────────────────────
// Polymorphic id|supabase_id detection: UUID (8-4-4-4-12 hex) → supabase_id
// lookup; everything else → numeric id. Mirrors modificadoresListForService.
const _UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function recipeItemsListForService(serviceKey) {
  if (!db || serviceKey == null || serviceKey === '') return []
  let svcSid = null
  if (typeof serviceKey === 'string' && _UUID_RX.test(serviceKey)) {
    svcSid = serviceKey
  } else {
    const row = db.prepare('SELECT supabase_id FROM services WHERE id=?').get(Number(serviceKey))
    svcSid = row?.supabase_id || null
  }
  if (!svcSid) return []
  return db.prepare(`
    SELECT
      r.id, r.supabase_id, r.business_id,
      r.service_supabase_id, r.inventory_item_supabase_id,
      r.qty_per_unit, r.created_at, r.updated_at,
      i.id              AS inventory_item_id,
      i.name            AS inventory_item_name,
      i.sku             AS inventory_item_sku,
      i.unit            AS inventory_item_unit,
      i.quantity        AS inventory_item_quantity
    FROM service_recipe_items r
    LEFT JOIN inventory_items i ON i.supabase_id = r.inventory_item_supabase_id
    WHERE r.service_supabase_id = ?
    ORDER BY i.name COLLATE NOCASE
  `).all(svcSid)
}

function recipeItemsAdd({ service_supabase_id, inventory_item_supabase_id, qty_per_unit, business_id } = {}) {
  if (!db) return null
  if (!service_supabase_id || !inventory_item_supabase_id) {
    throw new Error('recipeItemsAdd: service_supabase_id + inventory_item_supabase_id required')
  }
  const sid = crypto.randomUUID()
  const biz = business_id || _bizId() || null
  // Resolve local FK ids for the integer-id columns (best-effort; sync uses sid).
  const svc = db.prepare('SELECT id FROM services WHERE supabase_id=?').get(service_supabase_id)
  const inv = db.prepare('SELECT id FROM inventory_items WHERE supabase_id=?').get(inventory_item_supabase_id)
  const qpu = Number(qty_per_unit) || 0
  const r = db.prepare(`INSERT INTO service_recipe_items
    (supabase_id, business_id, service_id, service_supabase_id,
     inventory_item_id, inventory_item_supabase_id, qty_per_unit)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(sid, biz, svc?.id || null, service_supabase_id, inv?.id || null, inventory_item_supabase_id, qpu)
  return { id: r.lastInsertRowid, supabase_id: sid }
}

function recipeItemsUpdate(id, qty_per_unit) {
  if (!db || !id) return null
  const qpu = Number(qty_per_unit) || 0
  db.prepare(`UPDATE service_recipe_items
              SET qty_per_unit = ?, updated_at = datetime('now')
              WHERE id = ?`).run(qpu, id)
  return db.prepare('SELECT * FROM service_recipe_items WHERE id=?').get(id)
}

function recipeItemsRemove(id) {
  if (!db || !id) return null
  const row = db.prepare('SELECT supabase_id, business_id FROM service_recipe_items WHERE id=?').get(id)
  db.prepare('DELETE FROM service_recipe_items WHERE id=?').run(id)
  if (row?.supabase_id) {
    try { tombstoneAdd('service_recipe_items', row.supabase_id, row.business_id) } catch {}
  }
  return { deleted: true }
}

// ── v2.16.x — Ofertas (product bundles) ─────────────────────────────────────
// Components can reference EITHER a service (services.in_stock=0 → out of
// stock, treated as 0 available) OR an inventory_item (quantity / qty per
// component, floored). oferta_available = floor(min(per-component available)).

function _ofertaComponentAvailable(comp) {
  // comp: { service_supabase_id, inventory_item_supabase_id, qty }
  const need = Number(comp.qty || 1) || 1
  if (need <= 0) return Infinity
  if (comp.service_supabase_id) {
    const svc = db.prepare('SELECT in_stock FROM services WHERE supabase_id=?').get(comp.service_supabase_id)
    if (!svc) return 0
    // services.in_stock is a boolean 86-list flag. NULL = in stock (default).
    if (svc.in_stock === 0) return 0
    return Infinity
  }
  if (comp.inventory_item_supabase_id) {
    const inv = db.prepare('SELECT quantity FROM inventory_items WHERE supabase_id=?').get(comp.inventory_item_supabase_id)
    if (!inv) return 0
    return Math.floor(Number(inv.quantity || 0) / need)
  }
  return 0
}

function _ofertaEnrichItems(items) {
  const out = []
  for (const it of items) {
    let component_name = null, component_kind = null, component_price = null, component_quantity = null, component_unit = null
    let aplica = 1
    let comp_cost = 0
    let comp_id = null
    let comp_sku = ''
    if (it.service_supabase_id) {
      const svc = db.prepare('SELECT id, name, price, cost, in_stock, aplica_itbis FROM services WHERE supabase_id=?').get(it.service_supabase_id)
      component_kind = 'service'
      component_name = svc?.name || null
      component_price = svc?.price != null ? Number(svc.price) : null
      component_quantity = (svc && svc.in_stock === 0) ? 0 : null
      aplica = svc?.aplica_itbis ?? 1
      comp_cost = Number(svc?.cost || 0)
      comp_id = svc?.id || null
    } else if (it.inventory_item_supabase_id) {
      const inv = db.prepare('SELECT id, name, sku, unit, quantity, price, cost, aplica_itbis FROM inventory_items WHERE supabase_id=?').get(it.inventory_item_supabase_id)
      component_kind = 'inventory_item'
      component_name = inv?.name || null
      component_price = inv?.price != null ? Number(inv.price) : null
      component_quantity = inv?.quantity != null ? Number(inv.quantity) : 0
      component_unit = inv?.unit || null
      aplica = inv?.aplica_itbis ?? 1
      comp_cost = Number(inv?.cost || 0)
      comp_id = inv?.id || null
      comp_sku = inv?.sku || ''
    }
    const available_units = _ofertaComponentAvailable(it)
    out.push({
      ...it,
      component_kind,
      component_name,
      component_price,
      component_quantity,
      component_unit,
      // POS reads `name`, `base_price`, `cost`, `inventory_item_id`/`service_id`,
      // and `sku` directly off each component when adding the oferta to the
      // cart. Hydrate them here so the resulting ticket_items capture the
      // canonical FK + cost (otherwise reports show profit = revenue).
      name: component_name,
      base_price: component_price != null ? component_price : 0,
      cost: comp_cost,
      inventory_item_id: component_kind === 'inventory_item' ? comp_id : null,
      service_id:        component_kind === 'service'        ? comp_id : null,
      sku: comp_sku,
      aplica_itbis: aplica,
      available_units: Number.isFinite(available_units) ? available_units : null,
    })
  }
  return out
}

function _ofertaAvailable(items) {
  if (!items.length) return 0
  let min = Infinity
  for (const it of items) {
    const a = _ofertaComponentAvailable(it)
    if (a < min) min = a
  }
  return Number.isFinite(min) ? Math.floor(min) : 0
}

function ofertasList({ activeOnly = false } = {}) {
  if (!db) return []
  const biz = _bizId()
  const rows = db.prepare(`
    SELECT * FROM ofertas
    WHERE (business_id IS NULL OR business_id = ?)
      ${activeOnly ? 'AND active = 1' : ''}
    ORDER BY active DESC, name COLLATE NOCASE
  `).all(biz)
  return rows.map(o => {
    const items = db.prepare('SELECT * FROM oferta_items WHERE oferta_supabase_id = ?').all(o.supabase_id)
    const enriched = _ofertaEnrichItems(items)
    return {
      ...o,
      active: !!o.active,
      items: enriched,
      components_count: enriched.length,
      oferta_available: _ofertaAvailable(items),
    }
  })
}

function ofertasGet(supabase_id) {
  if (!db || !supabase_id) return null
  const o = db.prepare('SELECT * FROM ofertas WHERE supabase_id = ?').get(supabase_id)
  if (!o) return null
  const items = db.prepare('SELECT * FROM oferta_items WHERE oferta_supabase_id = ? ORDER BY id').all(supabase_id)
  const enriched = _ofertaEnrichItems(items)
  return {
    ...o,
    active: !!o.active,
    items: enriched,
    oferta_available: _ofertaAvailable(items),
  }
}

function ofertasUpsert(data = {}) {
  if (!db) return null
  if (!data.name || data.price == null) {
    throw new Error('ofertasUpsert: name + price required')
  }
  const biz = data.business_id || _bizId() || null
  const sid = data.supabase_id || crypto.randomUUID()
  const items = Array.isArray(data.items) ? data.items : []
  const isNew = !db.prepare('SELECT 1 FROM ofertas WHERE supabase_id=?').get(sid)

  const tx = db.transaction(() => {
    if (isNew) {
      db.prepare(`INSERT INTO ofertas
        (supabase_id, business_id, name, description, price, active, starts_at, ends_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(sid, biz, data.name, data.description || null,
             Number(data.price) || 0,
             data.active === false || data.active === 0 ? 0 : 1,
             data.starts_at || null, data.ends_at || null)
    } else {
      db.prepare(`UPDATE ofertas SET
        name=?, description=?, price=?, active=?, starts_at=?, ends_at=?,
        business_id = COALESCE(business_id, ?), updated_at=datetime('now')
        WHERE supabase_id=?`)
        .run(data.name, data.description || null,
             Number(data.price) || 0,
             data.active === false || data.active === 0 ? 0 : 1,
             data.starts_at || null, data.ends_at || null, biz, sid)
    }

    // Replace components — collect existing ids for tombstones, then nuke.
    const existing = db.prepare('SELECT supabase_id, business_id FROM oferta_items WHERE oferta_supabase_id=?').all(sid)
    db.prepare('DELETE FROM oferta_items WHERE oferta_supabase_id=?').run(sid)
    for (const ex of existing) {
      if (ex.supabase_id) {
        try { tombstoneAdd('oferta_items', ex.supabase_id, ex.business_id) } catch {}
      }
    }

    const ins = db.prepare(`INSERT INTO oferta_items
      (supabase_id, business_id, oferta_supabase_id, service_supabase_id, inventory_item_supabase_id, qty)
      VALUES (?, ?, ?, ?, ?, ?)`)
    for (const it of items) {
      const svc = it.service_supabase_id || null
      const inv = it.inventory_item_supabase_id || null
      if (!svc && !inv) continue
      // Mutually exclusive — service wins if both supplied.
      const useSvc = svc ? svc : null
      const useInv = svc ? null : inv
      ins.run(it.supabase_id || crypto.randomUUID(), biz, sid, useSvc, useInv, Number(it.qty) || 1)
    }
  })
  tx()

  try {
    activityLogRecord({
      event_type: isNew ? 'oferta_create' : 'oferta_update',
      severity: 'info',
      target_type: 'oferta',
      target_id: sid,
      target_name: data.name,
      amount: Number(data.price) || 0,
      metadata: { components: items.length },
    })
  } catch {}

  return ofertasGet(sid)
}

function ofertasDelete(supabase_id) {
  if (!db || !supabase_id) return null
  const o = db.prepare('SELECT supabase_id, business_id, name FROM ofertas WHERE supabase_id=?').get(supabase_id)
  if (!o) return { deleted: false }
  const items = db.prepare('SELECT supabase_id, business_id FROM oferta_items WHERE oferta_supabase_id=?').all(supabase_id)

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM oferta_items WHERE oferta_supabase_id=?').run(supabase_id)
    db.prepare('DELETE FROM ofertas WHERE supabase_id=?').run(supabase_id)
  })
  tx()

  for (const it of items) {
    if (it.supabase_id) { try { tombstoneAdd('oferta_items', it.supabase_id, it.business_id) } catch {} }
  }
  try { tombstoneAdd('ofertas', o.supabase_id, o.business_id) } catch {}
  try {
    activityLogRecord({
      event_type: 'oferta_delete', severity: 'info',
      target_type: 'oferta', target_id: supabase_id, target_name: o.name,
    })
  } catch {}
  return { deleted: true }
}

// Internal — applies recipe-driven inventory deduction for a single ticket.
// Wrapped in try/catch by the caller; emits `recipe_inventory_skip` on failure.
function _applyRecipeDeduction(ticketRow, items, userId) {
  if (!db || !Array.isArray(items) || !items.length) return
  const lookup = db.prepare(`SELECT inventory_item_id, qty_per_unit
                             FROM service_recipe_items
                             WHERE service_supabase_id = ?`)
  for (const it of items) {
    const svcSid = it.service_supabase_id
    if (!svcSid) continue
    const recipeRows = lookup.all(svcSid)
    if (!recipeRows.length) continue
    const lineQty = Number(it.quantity || 1)
    for (const rr of recipeRows) {
      try {
        if (!rr.inventory_item_id) continue
        const delta = -(Number(rr.qty_per_unit || 0) * lineQty)
        if (!delta) continue
        inventoryAdjust(rr.inventory_item_id, delta,
          `Receta — ticket ${ticketRow?.doc_number || ticketRow?.id || ''}`.trim(),
          userId || null)
      } catch (e) {
        try {
          activityLogRecord({
            event_type: 'recipe_inventory_skip', severity: 'warn',
            actor_user_id: userId || null,
            target_type: 'inventory_item', target_id: rr.inventory_item_id || null,
            target_name: `Receta servicio ${svcSid.substring(0, 8)}`,
            reason: e?.message || 'recipe deduction failed',
            metadata: {
              ticket_id: ticketRow?.id || null,
              ticket_supabase_id: ticketRow?.supabase_id || null,
              service_supabase_id: svcSid,
              line_qty: lineQty,
              qty_per_unit: rr.qty_per_unit,
            },
          })
        } catch {}
      }
    }
  }
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
function anecfQueueEnqueue({ ncf, ticketId, ticketSupabaseId, environment, reason } = {}) {
  if (!db) return null
  if (!isECF(ncf)) return null
  try {
    const tipoEcf = ncf.substring(1, 3)           // '31','32','33','34',...
    const rango = ncf                              // single-NCF range: desde == hasta
    const env = environment || getSetting('dgii_environment') || 'certecf'
    const sid = crypto.randomUUID()
    const info = db.prepare(
      `INSERT OR IGNORE INTO anecf_queue
         (ticket_id, ticket_supabase_id, ncf, tipo_ecf, rango_desde, rango_hasta, environment, supabase_id, reason)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(ticketId || null, ticketSupabaseId || null, ncf, tipoEcf, rango, rango, env, sid, reason || null)
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
// Rollback path for an eNCF/NCF that was reserved via ncfGetNext but the
// downstream e-CF submission FAILED before reaching DGII. Unlike
// ncfSequenceDecrementIfLast (which refuses E-prefixes because ANECF handles
// them), this is the pre-submit rollback: safe to decrement E-series IF and
// only IF this is still the last issued sequence number AND the ticket never
// got a DGII trackId. Caller is responsible for verifying no DGII roundtrip
// occurred. Returns { decremented, reason }.
function ncfSequenceRollback(ncf) {
  if (!db || !ncf || typeof ncf !== 'string') return { decremented: false, reason: 'invalid-ncf' }
  const m = ncf.trim().match(/^([A-Z]\d{2})(\d+)$/)
  if (!m) return { decremented: false, reason: 'bad-format' }
  const prefix = m[1]
  const num = parseInt(m[2], 10)
  if (!Number.isFinite(num) || num <= 0) return { decremented: false, reason: 'bad-number' }
  const row = db.prepare('SELECT type, current_number FROM ncf_sequences WHERE prefix=? AND active=1').get(prefix)
  if (!row) return { decremented: false, reason: 'no-sequence' }
  if (Number(row.current_number) !== num) {
    return { decremented: false, reason: 'not-last', prefix, number: num, current: Number(row.current_number) }
  }
  db.prepare("UPDATE ncf_sequences SET current_number=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE type=?").run(num - 1, row.type)
  return { decremented: true, prefix, number: num }
}

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
  db.prepare("UPDATE ncf_sequences SET current_number=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE type=?").run(num - 1, row.type)
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

// 2026-04-30 — parent-acceptance gate for Notas de Crédito (E33/E34).
// Other DR POS systems hit a known DGII race: when an NC is submitted
// before its parent factura's eNCF is registered on DGII's side, the NC
// is rejected with "comprobante no encontrado", the factura then arrives
// and gets accepted, and the books permanently disagree with DGII (607
// breaks). Terminal X gates this by refusing to submit any NC until its
// parent eNCF shows dgii_status=1 (ACEPTADO) here. Lookup is keyed on the
// eNCF string (which is unique per business + emisor by DGII contract).
function ecfSubmissionGetByEncf(encf) {
  if (!db || !encf) return null
  // Latest accepted record wins if there are duplicates (shouldn't happen
  // post-supabase_id idempotency but defensive).
  return db.prepare(
    'SELECT * FROM ecf_submissions WHERE encf=? ORDER BY submitted_at DESC LIMIT 1'
  ).get(String(encf))
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
    // FIX-HIGH-8 — never silent-drop an audit row. Persist to fallback queue
    // for retry on the next sync cycle. The drainer re-calls this function
    // (so the canonical INSERT path stays the single chokepoint) but skips
    // re-enqueue on its own failures to avoid an infinite loop — the row
    // simply stays at status='pending' until next cycle, or escalates to
    // 'dead' after MAX_ATTEMPTS.
    try { _activityFallbackEnqueue(evt, e?.message || String(e)) } catch {}
    return null
  }
}

// ── activity_log fallback queue (desktop) ────────────────────────────────────
const _AL_FALLBACK_MAX_ATTEMPTS = 5
// Backoff in seconds — applied to next_attempt_at so the drainer skips the
// row until the timer elapses. Mirrors the renderer queue (30s,1m,2m,5m,10m).
const _AL_FALLBACK_BACKOFF_S    = [30, 60, 120, 300, 600]
let _al_draining = false

function _activityFallbackEnqueue(evt, errMsg) {
  if (!db || !evt || !evt.event_type) return
  try {
    db.prepare(`INSERT INTO activity_log_fallback
      (payload, attempts, last_error, status, created_at, next_attempt_at)
      VALUES (?, 0, ?, 'pending', datetime('now'), datetime('now'))`
    ).run(JSON.stringify(evt), errMsg ? String(errMsg).slice(0, 500) : null)
  } catch (e) {
    // Last resort — log only. We've already lost the canonical INSERT, so
    // surfacing the queue-insert failure is the only signal left.
    console.error('[activity_log fallback] enqueue failed:', e?.message || e)
    if (_activityErrorSink) {
      try { _activityErrorSink('activity_log:fallback-enqueue', e, evt) } catch {}
    }
  }
}

// Called by electron/sync.js at the end of every sync cycle.
function activityLogDrainFallback() {
  if (!db) return { drained: 0, dead: 0, remaining: 0 }
  if (_al_draining) return { drained: 0, dead: 0, remaining: 0, skipped: 'busy' }
  _al_draining = true
  let drained = 0, dead = 0, remaining = 0
  try {
    const rows = db.prepare(
      `SELECT id, payload, attempts FROM activity_log_fallback
        WHERE status='pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
        ORDER BY id ASC LIMIT 200`
    ).all()
    for (const row of rows) {
      let payload = null
      try { payload = JSON.parse(row.payload) } catch {}
      if (!payload || !payload.event_type) {
        // Corrupt row — mark dead so we don't keep retrying garbage.
        db.prepare(`UPDATE activity_log_fallback SET status='dead', last_attempt_at=datetime('now'), last_error='corrupt-payload' WHERE id=?`).run(row.id)
        dead++; continue
      }
      // Inline retry of the canonical INSERT — but bypass the catch's
      // re-enqueue path so a persistent failure doesn't multiply rows. We
      // achieve this by replicating the INSERT here against the same
      // schema. If it succeeds, delete the fallback row.
      try {
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
          event_type:  payload.event_type,
          severity:    payload.severity || 'info',
          actor_user_id:     (payload.actor_user_id != null && Number.isFinite(Number(payload.actor_user_id))) ? Number(payload.actor_user_id) : null,
          actor_supabase_id: payload.actor_supabase_id || null,
          actor_name:        payload.actor_name || 'system',
          actor_role:        payload.actor_role || 'system',
          target_type: payload.target_type || null,
          target_id:   payload.target_id != null ? String(payload.target_id) : null,
          target_name: payload.target_name || null,
          amount:      payload.amount != null ? Number(payload.amount) : null,
          old_value:   payload.old_value != null ? String(payload.old_value) : null,
          new_value:   payload.new_value != null ? String(payload.new_value) : null,
          reason:      payload.reason || null,
          metadata:    payload.metadata ? JSON.stringify(payload.metadata) : null,
          created_at:  nowIso,
          updated_at:  nowIso,
        })
        db.prepare(`DELETE FROM activity_log_fallback WHERE id=?`).run(row.id)
        drained++
      } catch (e) {
        const attempts = (row.attempts || 0) + 1
        if (attempts >= _AL_FALLBACK_MAX_ATTEMPTS) {
          db.prepare(
            `UPDATE activity_log_fallback
                SET status='dead', attempts=?, last_error=?, last_attempt_at=datetime('now')
              WHERE id=?`
          ).run(attempts, String(e?.message || e).slice(0, 500), row.id)
          dead++
          // Emit a terminal `activity_log_dropped` row through the canonical
          // path so the owner sees the compliance gap in the audit feed. If
          // THIS write also fails (shouldn't happen — it's a different INSERT
          // with no metadata schema mismatch risk), it'll be enqueued again
          // and we'll keep trying. That's acceptable — drop-of-drop is rare.
          try {
            activityLogRecord({
              event_type: 'activity_log_dropped',
              severity:   'critical',
              target_type: 'activity_log',
              reason:     'Audit row dropped after 5 retries (desktop fallback)',
              metadata: {
                original_event_type: payload.event_type,
                original_severity:   payload.severity,
                last_error:          String(e?.message || e).slice(0, 500),
                attempts,
              },
            })
          } catch {}
        } else {
          const backoffSec = _AL_FALLBACK_BACKOFF_S[Math.min(attempts - 1, _AL_FALLBACK_BACKOFF_S.length - 1)]
          db.prepare(
            `UPDATE activity_log_fallback
                SET attempts=?, last_error=?, last_attempt_at=datetime('now'),
                    next_attempt_at=datetime('now', '+' || ? || ' seconds')
              WHERE id=?`
          ).run(attempts, String(e?.message || e).slice(0, 500), backoffSec, row.id)
          remaining++
        }
      }
    }
  } finally {
    _al_draining = false
  }
  if (drained || dead) {
    try { console.log(`[activity_log fallback] drained=${drained} dead=${dead} remaining=${remaining}`) } catch {}
  }
  return { drained, dead, remaining }
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
function vehicleList({ client_id, active, search, limit } = {}) {
  if (!db) return []
  let sql = 'SELECT v.*, c.name AS client_name FROM vehicles v LEFT JOIN clients c ON c.id = v.client_id WHERE 1=1'
  const params = []
  if (client_id) { sql += ' AND v.client_id = ?'; params.push(client_id) }
  if (active !== undefined) { sql += ' AND v.active = ?'; params.push(active ? 1 : 0) }
  // FIX 5.6 — server-side placa/make/model filter for PlateLookup. Case-
  // insensitive LIKE; clients pass `search:'ABC'` and get matches without
  // pulling the full vehicle list across the IPC bridge.
  if (search && String(search).trim()) {
    const like = `%${String(search).trim().toUpperCase()}%`
    sql += ' AND (UPPER(COALESCE(v.plate,\'\')) LIKE ? OR UPPER(COALESCE(v.make,\'\')) LIKE ? OR UPPER(COALESCE(v.model,\'\')) LIKE ?)'
    params.push(like, like, like)
  }
  sql += ' ORDER BY v.created_at DESC'
  if (limit && Number(limit) > 0) { sql += ' LIMIT ?'; params.push(Number(limit)) }
  return db.prepare(sql).all(...params)
}
function vehicleGetById(id) {
  if (!db) return null
  return db.prepare('SELECT v.*, c.name AS client_name FROM vehicles v LEFT JOIN clients c ON c.id = v.client_id WHERE v.id=?').get(id)
}
function vehicleDelete(id) {
  if (!db) return
  const row = db.prepare('SELECT supabase_id, business_id FROM vehicles WHERE id=?').get(id)
  db.prepare("UPDATE vehicles SET active=0, updated_at=datetime('now') WHERE id=?").run(id)
  if (row?.supabase_id) tombstoneAdd('vehicles', row.supabase_id, row.business_id)
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
  const row = db.prepare('SELECT supabase_id, business_id FROM service_bays WHERE id=?').get(id)
  db.prepare("UPDATE service_bays SET active=0, updated_at=datetime('now') WHERE id=?").run(id)
  if (row?.supabase_id) tombstoneAdd('service_bays', row.supabase_id, row.business_id)
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
  const allowed = ['vehicle_id','vehicle_supabase_id','client_id','client_supabase_id','technician_empleado_id','technician_empleado_supabase_id','bay_id','bay_supabase_id','status','estimated_total','actual_total','labor_total','parts_total','itbis','total','inspection_json','estimate_approved_at','customer_signature_url','customer_approval_token','expected_parts_arrival','odometer_in_km','odometer_out_km','promised_date','completed_date','notes','aseguradora_supabase_id','poliza_no','reclamo_no','aseguradora_status','started_at','finished_at','ready_at','delivery_required','delivery_fee','validity_until']
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
  const wo = db.prepare('SELECT vehicle_id, supabase_id, business_id, technician_empleado_supabase_id, labor_total FROM work_orders WHERE id=?').get(work_order_id)
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
  // FIX-H5 — freeze comisión for the technician at WO close. UNIQUE on
  // (business_id, work_order_supabase_id, technician_empleado_supabase_id)
  // protects against double-stamping if close fires twice.
  try {
    if (wo?.supabase_id && wo?.technician_empleado_supabase_id) {
      const tech = db.prepare("SELECT supabase_id, commission_pct, comision_pct FROM empleados WHERE supabase_id=?").get(wo.technician_empleado_supabase_id)
      const pct = Number(tech?.commission_pct ?? tech?.comision_pct ?? 0)
      const base = Number(wo.labor_total) || 0
      const calc = Math.round(base * (pct / 100) * 100) / 100
      const sid = crypto.randomUUID()
      db.prepare(`INSERT OR IGNORE INTO mechanic_commissions
        (supabase_id, business_id, work_order_supabase_id, technician_empleado_supabase_id,
         base_amount, commission_pct, calc_amount, paid)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)`).run(
          sid, wo.business_id || null, wo.supabase_id, wo.technician_empleado_supabase_id,
          base, pct, calc
        )
    }
  } catch (e) { log?.warn?.(`[workOrderClose] mechanic_commissions stamp failed: ${e.message}`) }
  return db.prepare('SELECT * FROM work_orders WHERE id=?').get(work_order_id)
}

// FIX-H5 — list helpers + paid toggle for the productivity report.
function mechanicCommissionsByPeriod(period_start, period_end) {
  if (!db) return []
  return db.prepare(`SELECT mc.*, e.nombre AS technician_name
    FROM mechanic_commissions mc
    LEFT JOIN empleados e ON e.supabase_id = mc.technician_empleado_supabase_id
    WHERE date(mc.created_at) BETWEEN date(?) AND date(?)
    ORDER BY mc.created_at DESC`).all(period_start, period_end)
}
function mechanicCommissionsMarkPaid(id, paid_by_supabase_id) {
  if (!db) return null
  db.prepare(`UPDATE mechanic_commissions SET paid=1, paid_at=datetime('now'),
    paid_by_supabase_id=?, updated_at=datetime('now') WHERE id=?`).run(paid_by_supabase_id || null, id)
  return db.prepare('SELECT * FROM mechanic_commissions WHERE id=?').get(id)
}

// ── APPOINTMENTS ─────────────────────────────────────────────────────────────
function appointmentCreate({ client_id, empleado_id, date, start_time, end_time, services, notes, is_walk_in, deposit_dop, deposit_status, public_booking_token, client_membership_supabase_id }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const client = client_id ? db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(client_id) : null
  const emp = empleado_id ? db.prepare('SELECT supabase_id FROM empleados WHERE id=?').get(empleado_id) : null
  const walkIn = (is_walk_in === true || is_walk_in === 1) ? 1 : 0
  const r = db.prepare(`INSERT INTO appointments(
      supabase_id, client_id, client_supabase_id, empleado_id, empleado_supabase_id,
      date, start_time, end_time, services, notes,
      is_walk_in, deposit_dop, deposit_status, public_booking_token, client_membership_supabase_id)
    VALUES(@sid, @client_id, @client_sid, @empleado_id, @emp_sid,
           @date, @start_time, @end_time, @services, @notes,
           @walk_in, @deposit_dop, @deposit_status, @pbt, @cms)`).run({
    sid, client_id: client_id || null, client_sid: client?.supabase_id || null,
    empleado_id: empleado_id || null, emp_sid: emp?.supabase_id || null,
    date, start_time, end_time: end_time || null,
    services: typeof services === 'string' ? services : JSON.stringify(services || []),
    notes: notes || null,
    walk_in: walkIn,
    deposit_dop: Number(deposit_dop) || 0,
    deposit_status: deposit_status || 'none',
    pbt: public_booking_token || null,
    cms: client_membership_supabase_id || null,
  })
  // Auto-schedule reminders for non-walk-in citas (mirrors web.js logic)
  if (!walkIn) {
    try { appointmentReminderScheduleForAppointment({ supabase_id: sid, date, start_time }) }
    catch (e) { console.warn('[appointmentCreate] reminder schedule failed:', e?.message || e) }
  }
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function appointmentUpdate(id, data) {
  if (!db) return
  // v2.16.3 (followup #1) — accept either local int PK or supabase_id (UUID).
  // Renderer screens (Appointments.jsx, voidNoShowFee orchestrator) pass the
  // UUID since that's what survives sync. Resolve to the int PK first; the
  // UPDATE then always runs against `id=@id` as before.
  const looksUuid = typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  let resolvedId = id
  if (looksUuid) {
    const row = db.prepare('SELECT id FROM appointments WHERE supabase_id=?').get(id)
    if (!row) return null  // unknown — caller surfaces error rather than silent no-op
    resolvedId = row.id
  } else if (typeof id === 'string') {
    // Numeric-string fallback (some web callers pass int as string).
    const n = Number(id)
    if (Number.isFinite(n) && n > 0) resolvedId = n
  }
  const allowed = ['client_id','client_supabase_id','empleado_id','empleado_supabase_id','date','start_time','end_time','status','services','notes',
                   'is_walk_in','deposit_dop','deposit_status','no_show_fee_charged','no_show_fee_ticket_supabase_id','public_booking_token','client_membership_supabase_id']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (data.client_id && !data.client_supabase_id) { const c = db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(data.client_id); if (c) patch.client_supabase_id = c.supabase_id }
  if (data.empleado_id && !data.empleado_supabase_id) { const e = db.prepare('SELECT supabase_id FROM empleados WHERE id=?').get(data.empleado_id); if (e) patch.empleado_supabase_id = e.supabase_id }
  if (data.services && typeof data.services !== 'string') patch.services = JSON.stringify(data.services)
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM appointments WHERE id=?').get(resolvedId)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE appointments SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id: resolvedId })
  return db.prepare('SELECT * FROM appointments WHERE id=?').get(resolvedId)
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

// v2.16.1 — mark a salon appointment as no-show. Returns shouldChargeFee +
// fee_amount when a deposit was held; the caller (cobro path) emits the E32.
function appointmentMarkNoShow(supabase_id) {
  if (!db || !supabase_id) return { ok: false, error: 'missing_id' }
  const appt = db.prepare(`SELECT id, supabase_id, client_id, client_supabase_id, deposit_status, deposit_dop, no_show_fee_charged
    FROM appointments WHERE supabase_id=?`).get(supabase_id)
  if (!appt) return { ok: false, error: 'not_found' }
  db.prepare(`UPDATE appointments SET status='no_show', updated_at=datetime('now') WHERE id=?`).run(appt.id)
  if (appt.client_id) {
    db.prepare(`UPDATE clients SET no_show_count = COALESCE(no_show_count,0) + 1,
        last_no_show_at = datetime('now'), updated_at = datetime('now') WHERE id=?`).run(appt.client_id)
  }
  let shouldChargeFee = appt.deposit_status === 'held' && !appt.no_show_fee_charged
  let fee_amount = 0
  if (shouldChargeFee) {
    const feeRow = db.prepare(`SELECT value FROM app_settings WHERE key='salon_no_show_fee_dop'`).get()
    fee_amount = Number(feeRow?.value) || Number(appt.deposit_dop) || 500
  }
  return {
    ok: true,
    shouldChargeFee,
    fee_amount,
    client_supabase_id: appt.client_supabase_id || null,
    appointment_supabase_id: supabase_id,
  }
}

// ── SALON MEMBERSHIPS (templates — extends `memberships` table additively) ──
function salonMembershipList() {
  if (!db) return []
  // v2.16.2 (item #15) — prefer explicit vertical='salon'. Legacy rows that
  // pre-date the column still match via the heuristic fallback.
  return db.prepare(`SELECT m.*, s.name AS service_name FROM memberships m
    LEFT JOIN services s ON s.supabase_id = m.service_supabase_id
    WHERE COALESCE(m.active_template,0)=1
      AND (m.vertical='salon' OR (m.vertical IS NULL AND m.total_sessions IS NOT NULL))
    ORDER BY m.created_at DESC`).all()
}
function salonMembershipCreate({ nombre, service_supabase_id, total_sessions, price_dop, validity_days }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO memberships(
      supabase_id, nombre, plan_name, service_supabase_id, total_sessions,
      price_dop, plan_price, validity_days, active_template, status, vertical,
      wash_quota_per_month, washes_used_this_period, period_start, period_end, start_date)
    VALUES(@sid, @nombre, @nombre, @ssid, @total, @price, @price, @validity, 1, 'active', 'salon',
           0, 0, date('now'), date('now','+1 year'), date('now'))`).run({
    sid, nombre: String(nombre || '').trim(),
    ssid: service_supabase_id || null,
    total: Number(total_sessions) || 0,
    price: Number(price_dop) || 0,
    validity: Number(validity_days) || 365,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function salonMembershipUpdate(supabase_id, patch) {
  if (!db || !supabase_id) return
  const allowed = ['nombre','service_supabase_id','total_sessions','price_dop','validity_days','active_template']
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)))
  if (clean.nombre != null) clean.plan_name = clean.nombre
  if (clean.price_dop != null) clean.plan_price = clean.price_dop
  if (!Object.keys(clean).length) return
  const fields = Object.keys(clean).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE memberships SET ${fields}, updated_at=datetime('now') WHERE supabase_id=@sid`).run({ ...clean, sid: supabase_id })
  return { supabase_id }
}
function salonMembershipArchive(supabase_id) {
  if (!db || !supabase_id) return
  db.prepare(`UPDATE memberships SET active_template=0, updated_at=datetime('now') WHERE supabase_id=?`).run(supabase_id)
  return { supabase_id }
}

// ── CLIENT MEMBERSHIPS (per-client balances) ────────────────────────────────
function clientMembershipsByClient(client_supabase_id) {
  if (!db || !client_supabase_id) return []
  return db.prepare(`SELECT cm.*, m.nombre AS membership_nombre, m.total_sessions AS membership_total_sessions,
      m.service_supabase_id AS service_supabase_id
    FROM client_memberships cm
    LEFT JOIN memberships m ON m.supabase_id = cm.membership_supabase_id
    WHERE cm.client_supabase_id=? AND cm.sessions_remaining > 0
      AND cm.expires_at >= datetime('now')
    ORDER BY cm.expires_at ASC`).all(client_supabase_id)
}
function clientMembershipPurchase({ client_supabase_id, membership_supabase_id, ticket_supabase_id }) {
  if (!db || !client_supabase_id || !membership_supabase_id) return { ok: false, error: 'missing_args' }
  const tpl = db.prepare(`SELECT total_sessions, validity_days FROM memberships WHERE supabase_id=?`).get(membership_supabase_id)
  if (!tpl) return { ok: false, error: 'template_not_found' }
  const sid = crypto.randomUUID()
  const validity = Number(tpl.validity_days) || 365
  const expires_at = new Date(Date.now() + validity * 86400000).toISOString()
  const r = db.prepare(`INSERT INTO client_memberships(
      supabase_id, client_supabase_id, membership_supabase_id,
      sessions_remaining, expires_at, ticket_supabase_id)
    VALUES(?, ?, ?, ?, ?, ?)`).run(
    sid, client_supabase_id, membership_supabase_id,
    Number(tpl.total_sessions) || 0, expires_at, ticket_supabase_id || null,
  )
  return { id: r.lastInsertRowid, supabase_id: sid, sessions_remaining: tpl.total_sessions, expires_at }
}
function clientMembershipConsume({ client_membership_supabase_id, ticket_supabase_id, appointment_supabase_id }) {
  if (!db || !client_membership_supabase_id || !ticket_supabase_id) return { ok: false, error: 'missing_args' }
  // v2.16.1 patch (#8) — compare-and-swap inside a transaction. better-sqlite3
  // serialises writes per-process, so the race window is small but realtime
  // sync from a peer desktop can still mutate sessions_remaining between the
  // SELECT and UPDATE. WHERE sessions_remaining=? makes the decrement a no-op
  // when another writer beat us to it; we re-read and retry up to 3 times.
  const txn = db.transaction(() => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cm = db.prepare(`SELECT id, sessions_remaining, expires_at FROM client_memberships WHERE supabase_id=?`).get(client_membership_supabase_id)
      if (!cm) return { ok: false, error: 'not_found' }
      if (cm.sessions_remaining <= 0) return { ok: false, error: 'no_sessions_remaining' }
      if (cm.expires_at && new Date(cm.expires_at) < new Date()) return { ok: false, error: 'expired' }
      const r = db.prepare(`UPDATE client_memberships
          SET sessions_remaining = sessions_remaining - 1, updated_at=datetime('now')
          WHERE id=? AND sessions_remaining=?`).run(cm.id, cm.sessions_remaining)
      if (r.changes === 1) {
        const rsid = crypto.randomUUID()
        db.prepare(`INSERT INTO membership_redemptions(
            supabase_id, client_membership_supabase_id, ticket_supabase_id, appointment_supabase_id)
          VALUES(?,?,?,?)`).run(rsid, client_membership_supabase_id, ticket_supabase_id, appointment_supabase_id || null)
        return { ok: true, remaining: cm.sessions_remaining - 1, redemption_supabase_id: rsid }
      }
      // CAS missed; loop and retry with a fresh read.
    }
    return { ok: false, error: 'concurrent_consume' }
  })
  return txn()
}
function clientMembershipsExpiringSoon(days) {
  if (!db) return []
  const horizon = new Date(Date.now() + (Number(days) || 14) * 86400000).toISOString()
  return db.prepare(`SELECT cm.*, c.name AS client_name, c.phone AS client_phone
    FROM client_memberships cm
    LEFT JOIN clients c ON c.supabase_id = cm.client_supabase_id
    WHERE cm.sessions_remaining > 0
      AND cm.expires_at >= datetime('now') AND cm.expires_at <= ?
    ORDER BY cm.expires_at ASC`).all(horizon)
}

// ── APPOINTMENT REMINDERS (24h / 2h / manual / confirm) ─────────────────────
function appointmentReminderSchedule(appointment_supabase_id, fire_at, kind) {
  if (!db || !appointment_supabase_id || !fire_at || !kind) return null
  const sid = crypto.randomUUID()
  const fa = typeof fire_at === 'string' ? fire_at : new Date(fire_at).toISOString()
  const r = db.prepare(`INSERT INTO appointment_reminders(supabase_id, appointment_supabase_id, fire_at, kind, status)
    VALUES(?,?,?,?, 'pending')`).run(sid, appointment_supabase_id, fa, kind)
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function appointmentRemindersPendingDue(now) {
  if (!db) return []
  const cutoff = now ? (typeof now === 'string' ? now : new Date(now).toISOString()) : new Date().toISOString()
  return db.prepare(`SELECT * FROM appointment_reminders
    WHERE status='pending' AND fire_at <= ?
    ORDER BY fire_at ASC LIMIT 25`).all(cutoff)
}
function appointmentRemindersRecent({ days = 30 } = {}) {
  if (!db) return []
  const since = new Date(Date.now() - Math.max(1, Number(days) || 30) * 86400000).toISOString()
  return db.prepare(`SELECT * FROM appointment_reminders
    WHERE fire_at >= ?
    ORDER BY fire_at DESC LIMIT 500`).all(since)
}
function appointmentReminderMarkSent(id, ultramsg_message_id) {
  if (!db) return
  db.prepare(`UPDATE appointment_reminders SET status='sent', ultramsg_message_id=?, sent_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
    .run(ultramsg_message_id || null, id)
  return { id, ok: true }
}
function appointmentReminderMarkFailed(id, error) {
  if (!db) return
  db.prepare(`UPDATE appointment_reminders SET status='failed', error=?, updated_at=datetime('now') WHERE id=?`)
    .run(String(error || '').slice(0, 500), id)
  return { id, ok: true }
}
function appointmentReminderScheduleForAppointment(appt) {
  if (!db || !appt?.supabase_id || !appt.date || !appt.start_time) return { scheduled: 0 }
  // v2.16.1 patch (#5) — DR is fixed UTC-4 (no DST). Without an explicit TZ
  // suffix the parser uses the executing host's local TZ, which on a Vercel
  // function (UTC) shifts reminders 4 hours early. Pin to -04:00.
  const startMs = new Date(`${appt.date}T${appt.start_time}:00-04:00`).getTime()
  if (!Number.isFinite(startMs)) return { scheduled: 0 }
  const now = Date.now()
  const out = []
  const errors = []
  const want = [
    { kind: '24h', fireMs: startMs - 24 * 60 * 60 * 1000 },
    { kind: '2h',  fireMs: startMs -  2 * 60 * 60 * 1000 },
  ]
  for (const w of want) {
    if (w.fireMs <= now) continue
    try {
      const r = appointmentReminderSchedule(appt.supabase_id, new Date(w.fireMs).toISOString(), w.kind)
      if (r) out.push(r.id)
    } catch (e) {
      // v2.16.2 (item #11) — surface per-row errors so callers can flag
      // partial failure instead of trusting a green `scheduled: N`.
      errors.push({ kind: w.kind, error: String(e?.message || e).slice(0, 300) })
    }
  }
  return { scheduled: out.length, ids: out, errors }
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
  const row = db.prepare('SELECT supabase_id, business_id FROM stylist_schedules WHERE id=?').get(id)
  db.prepare("UPDATE stylist_schedules SET active=0, updated_at=datetime('now') WHERE id=?").run(id)
  if (row?.supabase_id) tombstoneAdd('stylist_schedules', row.supabase_id, row.business_id)
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
  // FIX 5.3 — atomic create. If validation fails, FK lookup throws, or any
  // post-insert step (activity log, sync queue) raises, rollback so the user
  // never sees a "ghost" membership row that wasn't fully provisioned.
  if (!plan_name || !String(plan_name).trim()) {
    throw new Error('Nombre del plan requerido')
  }
  const sid = crypto.randomUUID()
  const txn = db.transaction(() => {
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
      name: String(plan_name).trim(), price: Number(plan_price) || 0,
      quota: Number(wash_quota_per_month) || 0,
      ps: period_start, pe: period_end,
      start: start_date || new Date().toISOString().slice(0, 10),
      end: end_date || null, notes: notes || null,
    })
    try {
      activityLogRecord({
        event_type: 'membership_created',
        severity: 'info',
        target_type: 'membership',
        target_id: String(r.lastInsertRowid),
        target_name: String(plan_name).trim(),
        amount: Number(plan_price) || 0,
        metadata: { client_id: client_id || null, vehicle_id: vehicle_id || null, supabase_id: sid },
      })
    } catch (e) {
      throw new Error('No se pudo registrar la membresía en bitácora — operación revertida: ' + e.message)
    }
    return { id: r.lastInsertRowid, supabase_id: sid }
  })
  return txn()
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
  // FIX 5.9 — atomic update with audit trail. Status transitions (active →
  // paused/cancelled) are owner-relevant events; activity_log inside the txn
  // means a logging failure rolls the status change back.
  const before = db.prepare('SELECT status, plan_name FROM memberships WHERE id=?').get(id)
  const txn = db.transaction(() => {
    const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
    db.prepare(`UPDATE memberships SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
    if (patch.status && before && patch.status !== before.status) {
      activityLogRecord({
        event_type: 'membership_status_changed',
        severity: patch.status === 'cancelled' ? 'warn' : 'info',
        target_type: 'membership',
        target_id: String(id),
        target_name: before.plan_name,
        old_value: before.status,
        new_value: patch.status,
      })
    }
    return db.prepare('SELECT * FROM memberships WHERE id=?').get(id)
  })
  return txn()
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
  // v2.14.22 — fall back to client_supabase_id so cross-device / post-pull
  // rows still attach to the history. Web-created tickets on another POS
  // may have client_id=NULL locally until the clients pull lands but
  // ticket.client_supabase_id is always set. Audit D3 + D4 root-cause.
  // washer_commissions join tolerates NULL ticket_id (post-wipe state)
  // by also trying ticket_supabase_id.
  const clientSid = db.prepare('SELECT supabase_id FROM clients WHERE id=?').get(client_id)?.supabase_id || null
  return db.prepare(`
    SELECT t.id, t.doc_number, t.total, t.status, t.created_at, t.vehicle_plate,
           e.nombre AS washer_name,
           (SELECT GROUP_CONCAT(ti.name, ' + ')
              FROM ticket_items ti WHERE ti.ticket_id = t.id OR ti.ticket_supabase_id = t.supabase_id) AS services
      FROM tickets t
      LEFT JOIN washer_commissions w
             ON (w.ticket_id = t.id OR w.ticket_supabase_id = t.supabase_id)
      LEFT JOIN empleados e
             ON (e.id = w.empleado_id OR e.supabase_id = w.empleado_supabase_id)
     WHERE (t.client_id = ? OR (? IS NOT NULL AND t.client_supabase_id = ?))
       AND COALESCE(t.status, '') != 'nula'
     GROUP BY t.id
     ORDER BY t.created_at DESC
     LIMIT ?
  `).all(client_id, clientSid, clientSid, Math.min(Number(limit) || 10, 50))
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
    // E-series eNCF = 13-char (E + 2 digits + 10-digit sequence).
    // Legacy NCF    = 11-char (B + 2 digits + 8-digit sequence).
    const blockPad = /^E/i.test(row.prefix || row.ncf_type) ? 10 : 8
    const ncf = `${row.prefix || row.ncf_type}${String(consumed).padStart(blockPad, '0')}`
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
      // v2.14.35 — emit a per-item inventory_transactions row for every variance
      // so "qty went 50→40 because of conteo X" is fully traceable. Type is
      // 'count_in' / 'count_out' to distinguish from manual ajustes.
      const ledgerInsert = db.prepare(`INSERT INTO inventory_transactions(item_id,type,delta,notes,user_id,supabase_id,item_supabase_id)
        VALUES(?,?,?,?,?,?,?)`)
      const itemIdLookup = db.prepare('SELECT id FROM inventory_items WHERE supabase_id=?')
      for (const r of counted) {
        const sid = db.prepare('SELECT inventory_item_supabase_id FROM inventory_count_items WHERE count_supabase_id=? AND sku IS ? AND name=?')
          .get(countSid, r.sku, r.name)?.inventory_item_supabase_id
        if (!sid) continue
        const newQty = Number(r.counted_qty) || 0
        upd.run(newQty, sid)
        const variance = Number(r.variance_qty) || 0
        if (variance !== 0) {
          const itemId = itemIdLookup.get(sid)?.id || null
          ledgerInsert.run(
            itemId,
            variance >= 0 ? 'count_in' : 'count_out',
            variance,
            `Conteo Fisico — ${header.title || countSid.slice(0, 8)}${header.counted_by_name ? ` (${header.counted_by_name})` : ''}`,
            null,
            crypto.randomUUID(),
            sid,
          )
        }
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

// Consistent online snapshot via VACUUM INTO. We do NOT use better-sqlite3's
// native .backup() because better-sqlite3-multiple-ciphers opens the
// destination as a plain (no-cipher) database, and the SQLite Online Backup
// API then rejects an SQLCipher source with "backup is not supported with
// incompatible source database". VACUUM INTO writes an encrypted copy with
// the current key, which is what we actually want.
function dbBackupTo(destPath) {
  if (!db) return Promise.reject(new Error('db not initialized'))
  try {
    db.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`)
    return Promise.resolve()
  } catch (e) {
    return Promise.reject(e)
  }
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

// ── Concesionario v2 / v2.5 — dealership CRUD ───────────────────────────────
function _parsePhotoUrls(row) {
  if (!row) return row
  if (typeof row.photo_urls === 'string') {
    try { row.photo_urls = JSON.parse(row.photo_urls) } catch { row.photo_urls = [] }
  }
  return row
}
function _serializePhotoUrls(arr) {
  if (Array.isArray(arr)) return JSON.stringify(arr)
  if (typeof arr === 'string') return arr
  return null
}
const VEHICLE_INVENTORY_COLS = ['supabase_id','stock_number','vin','make','model','year','color','mileage','condition','acquisition_cost','listing_price','status','title_status','photo_urls','featured','notes','listing_date','sold_date','active']
function vehicleInventoryList(filters = {}) {
  const where = ['active = 1']
  const params = {}
  if (filters.status) { where.push('status = @status'); params.status = filters.status }
  const sql = `SELECT * FROM vehicle_inventory WHERE ${where.join(' AND ')} ORDER BY COALESCE(listing_date, created_at) DESC`
  return db.prepare(sql).all(params).map(_parsePhotoUrls)
}
function vehicleInventoryGetById(id) { return _parsePhotoUrls(db.prepare('SELECT * FROM vehicle_inventory WHERE id = ?').get(id)) }
function vehicleInventoryCreate(data) {
  const sid = data.supabase_id || (require('crypto').randomUUID ? require('crypto').randomUUID() : String(Date.now()))
  const photoUrls = _serializePhotoUrls(data.photo_urls)
  const r = db.prepare(`INSERT INTO vehicle_inventory(supabase_id, stock_number, vin, make, model, year, color, mileage, condition, acquisition_cost, listing_price, status, title_status, photo_urls, featured, notes, listing_date)
    VALUES (@supabase_id, @stock_number, @vin, @make, @model, @year, @color, @mileage, @condition, @acquisition_cost, @listing_price, @status, @title_status, @photo_urls, @featured, @notes, @listing_date)`)
    .run({
      supabase_id: sid, stock_number: data.stock_number || null, vin: data.vin || null,
      make: data.make || null, model: data.model || null, year: data.year || null, color: data.color || null,
      mileage: data.mileage || 0, condition: data.condition || 'used',
      acquisition_cost: data.acquisition_cost || 0, listing_price: data.listing_price || 0,
      status: data.status || 'available', title_status: data.title_status || 'clean',
      photo_urls: photoUrls, featured: data.featured ? 1 : 0,
      notes: data.notes || null, listing_date: data.listing_date || new Date().toISOString(),
    })
  return _parsePhotoUrls(db.prepare('SELECT * FROM vehicle_inventory WHERE id = ?').get(r.lastInsertRowid))
}
function vehicleInventoryUpdate(id, patch) {
  const allowed = VEHICLE_INVENTORY_COLS.filter(c => c !== 'supabase_id')
  const cleaned = {}
  for (const k of allowed) if (patch[k] !== undefined) cleaned[k] = patch[k]
  if (cleaned.photo_urls !== undefined) cleaned.photo_urls = _serializePhotoUrls(cleaned.photo_urls)
  if (!Object.keys(cleaned).length) return vehicleInventoryGetById(id)
  const fields = Object.keys(cleaned).map(k => `${k} = @${k}`).join(', ')
  db.prepare(`UPDATE vehicle_inventory SET ${fields}, updated_at=datetime('now') WHERE id = @id`).run({ ...cleaned, id })
  return vehicleInventoryGetById(id)
}
function vehicleInventorySetStatus(id, status) {
  const patch = { status }
  if (status === 'sold') patch.sold_date = new Date().toISOString()
  return vehicleInventoryUpdate(id, patch)
}
function vehicleInventoryDelete(id) {
  const row = db.prepare('SELECT supabase_id, business_id FROM vehicle_inventory WHERE id=?').get(id)
  db.prepare("UPDATE vehicle_inventory SET active=0, updated_at=datetime('now') WHERE id=?").run(id)
  if (row?.supabase_id) tombstoneAdd('vehicle_inventory', row.supabase_id, row.business_id)
}

const SALES_DEAL_COLS = ['supabase_id','client_id','client_supabase_id','vehicle_inventory_id','vehicle_inventory_supabase_id','salesperson_id','salesperson_supabase_id','sale_price','trade_in_vehicle_id','trade_in_supabase_id','trade_in_value','down_payment','financed_amount','term_months','apr','monthly_payment','commission_pct','commission_amount','commission_paid','commission_paid_at','ticket_id','ticket_supabase_id','status','notes','closed_at','active']
function salesDealsList(filters = {}) {
  const where = ['active = 1']; const params = {}
  if (filters.status) { where.push('status = @status'); params.status = filters.status }
  return db.prepare(`SELECT * FROM sales_deals WHERE ${where.join(' AND ')} ORDER BY COALESCE(closed_at, created_at) DESC`).all(params)
}
function salesDealsGetById(id) { return db.prepare('SELECT * FROM sales_deals WHERE id = ?').get(id) }
function salesDealsCreate(data) {
  const sid = data.supabase_id || require('crypto').randomUUID()
  const cleaned = { supabase_id: sid }
  for (const c of SALES_DEAL_COLS) if (c !== 'supabase_id' && data[c] !== undefined) cleaned[c] = data[c]
  cleaned.commission_paid = cleaned.commission_paid ? 1 : 0
  cleaned.active = 1
  const cols = Object.keys(cleaned)
  const placeholders = cols.map(c => `@${c}`).join(', ')
  const r = db.prepare(`INSERT INTO sales_deals(${cols.join(', ')}) VALUES (${placeholders})`).run(cleaned)
  return salesDealsGetById(r.lastInsertRowid)
}
function salesDealsUpdate(id, patch) {
  const allowed = SALES_DEAL_COLS.filter(c => c !== 'supabase_id')
  const cleaned = {}
  for (const k of allowed) if (patch[k] !== undefined) cleaned[k] = patch[k]
  if (cleaned.commission_paid !== undefined) cleaned.commission_paid = cleaned.commission_paid ? 1 : 0
  if (!Object.keys(cleaned).length) return salesDealsGetById(id)
  const fields = Object.keys(cleaned).map(k => `${k} = @${k}`).join(', ')
  db.prepare(`UPDATE sales_deals SET ${fields}, updated_at=datetime('now') WHERE id = @id`).run({ ...cleaned, id })
  return salesDealsGetById(id)
}
function salesDealsClose(id, ticketInfo = {}) {
  const patch = { status: 'closed', closed_at: new Date().toISOString() }
  if (ticketInfo.ticket_id) patch.ticket_id = ticketInfo.ticket_id
  if (ticketInfo.ticket_supabase_id) patch.ticket_supabase_id = ticketInfo.ticket_supabase_id
  return salesDealsUpdate(id, patch)
}
function salesDealsMarkCommissionPaid(id) {
  return salesDealsUpdate(id, { commission_paid: 1, commission_paid_at: new Date().toISOString() })
}
function salesDealsCommissionsForPeriod({ from, to, salespersonSupabaseId } = {}) {
  const where = ["active = 1", "status = 'closed'", "commission_amount IS NOT NULL"]
  const params = {}
  if (from) { where.push('closed_at >= @from'); params.from = from }
  if (to) { where.push('closed_at <= @to'); params.to = to }
  if (salespersonSupabaseId) { where.push('salesperson_supabase_id = @sid'); params.sid = salespersonSupabaseId }
  return db.prepare(`SELECT id, supabase_id, salesperson_id, salesperson_supabase_id, commission_amount, commission_paid, closed_at, sale_price FROM sales_deals WHERE ${where.join(' AND ')} ORDER BY closed_at DESC`).all(params)
}
function salesDealsDelete(id) {
  const row = db.prepare('SELECT supabase_id, business_id FROM sales_deals WHERE id=?').get(id)
  db.prepare("UPDATE sales_deals SET active=0, updated_at=datetime('now') WHERE id=?").run(id)
  if (row?.supabase_id) tombstoneAdd('sales_deals', row.supabase_id, row.business_id)
}

const LEAD_COLS = ['supabase_id','name','phone','email','source','budget','notes','stage','next_followup_at','last_contacted_at','interested_vehicle_supabase_id','active']
function leadsList(filters = {}) {
  const where = ['active = 1']; const params = {}
  if (filters.stage) { where.push('stage = @stage'); params.stage = filters.stage }
  return db.prepare(`SELECT * FROM leads WHERE ${where.join(' AND ')} ORDER BY updated_at DESC`).all(params)
}
function leadsCreate(data) {
  const sid = data.supabase_id || require('crypto').randomUUID()
  const cleaned = { supabase_id: sid }
  for (const c of LEAD_COLS) if (c !== 'supabase_id' && data[c] !== undefined) cleaned[c] = data[c]
  cleaned.active = 1
  if (!cleaned.stage) cleaned.stage = 'lead'
  const cols = Object.keys(cleaned)
  const r = db.prepare(`INSERT INTO leads(${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`).run(cleaned)
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(r.lastInsertRowid)
}
function leadsUpdate(id, patch) {
  const allowed = LEAD_COLS.filter(c => c !== 'supabase_id')
  const cleaned = {}
  for (const k of allowed) if (patch[k] !== undefined) cleaned[k] = patch[k]
  if (!Object.keys(cleaned).length) return db.prepare('SELECT * FROM leads WHERE id = ?').get(id)
  const fields = Object.keys(cleaned).map(k => `${k} = @${k}`).join(', ')
  db.prepare(`UPDATE leads SET ${fields}, updated_at=datetime('now') WHERE id = @id`).run({ ...cleaned, id })
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id)
}
function leadsSetStage(id, stage, extra = {}) { return leadsUpdate(id, { stage, ...extra }) }
function leadsLogContact(id, { nextFollowupAt, notes } = {}) {
  const patch = { last_contacted_at: new Date().toISOString() }
  if (nextFollowupAt) patch.next_followup_at = nextFollowupAt
  if (notes !== undefined) patch.notes = notes
  return leadsUpdate(id, patch)
}
function leadsOverdue() {
  return db.prepare(`SELECT * FROM leads WHERE active=1 AND next_followup_at IS NOT NULL AND next_followup_at <= datetime('now') AND stage NOT IN ('closed','lost') ORDER BY next_followup_at`).all()
}
function leadsDelete(id) {
  const row = db.prepare('SELECT supabase_id, business_id FROM leads WHERE id=?').get(id)
  db.prepare("UPDATE leads SET active=0, updated_at=datetime('now') WHERE id=?").run(id)
  if (row?.supabase_id) tombstoneAdd('leads', row.supabase_id, row.business_id)
}

const TEST_DRIVE_COLS = ['supabase_id','client_id','client_supabase_id','vehicle_inventory_id','vehicle_inventory_supabase_id','staff_id','staff_supabase_id','scheduled_at','completed_at','license_number','signed_waiver_url','notes','outcome','outcome_notes','deal_supabase_id','active']
function testDrivesList() {
  return db.prepare("SELECT td.*, c.name AS _client_name FROM test_drives td LEFT JOIN clients c ON c.id=td.client_id WHERE td.active=1 ORDER BY td.scheduled_at DESC").all()
    .map(r => ({ ...r, clients: r._client_name ? { name: r._client_name } : null }))
}
function testDrivesCreate(data) {
  const sid = data.supabase_id || require('crypto').randomUUID()
  const cleaned = { supabase_id: sid }
  for (const c of TEST_DRIVE_COLS) if (c !== 'supabase_id' && data[c] !== undefined) cleaned[c] = data[c]
  cleaned.active = 1
  const cols = Object.keys(cleaned)
  const r = db.prepare(`INSERT INTO test_drives(${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`).run(cleaned)
  return db.prepare('SELECT * FROM test_drives WHERE id = ?').get(r.lastInsertRowid)
}
function testDrivesUpdate(id, patch) {
  const allowed = TEST_DRIVE_COLS.filter(c => c !== 'supabase_id')
  const cleaned = {}
  for (const k of allowed) if (patch[k] !== undefined) cleaned[k] = patch[k]
  if (!Object.keys(cleaned).length) return db.prepare('SELECT * FROM test_drives WHERE id = ?').get(id)
  const fields = Object.keys(cleaned).map(k => `${k} = @${k}`).join(', ')
  db.prepare(`UPDATE test_drives SET ${fields}, updated_at=datetime('now') WHERE id = @id`).run({ ...cleaned, id })
  return db.prepare('SELECT * FROM test_drives WHERE id = ?').get(id)
}
function testDrivesComplete(id, notes) { return testDrivesUpdate(id, { completed_at: new Date().toISOString(), notes }) }
function testDrivesSetOutcome(id, { outcome, outcomeNotes, dealSupabaseId } = {}) {
  const patch = { outcome, outcome_notes: outcomeNotes || null }
  if (dealSupabaseId) patch.deal_supabase_id = dealSupabaseId
  if (outcome) patch.completed_at = new Date().toISOString()
  return testDrivesUpdate(id, patch)
}
function testDrivesDelete(id) {
  const row = db.prepare('SELECT supabase_id, business_id FROM test_drives WHERE id=?').get(id)
  db.prepare("UPDATE test_drives SET active=0, updated_at=datetime('now') WHERE id=?").run(id)
  if (row?.supabase_id) tombstoneAdd('test_drives', row.supabase_id, row.business_id)
}

const VEHICLE_DOC_COLS = ['supabase_id','vehicle_inventory_supabase_id','doc_type','file_url','file_name','expires_at','notes','active']
function vehicleDocumentsByVehicle(vehicleSupabaseId) {
  if (!vehicleSupabaseId) return []
  return db.prepare("SELECT * FROM vehicle_documents WHERE active=1 AND vehicle_inventory_supabase_id=? ORDER BY uploaded_at DESC").all(vehicleSupabaseId)
}
function vehicleDocumentsExpiringSoon(days = 30) {
  const cutoff = new Date(Date.now() + days * 86400000).toISOString()
  return db.prepare("SELECT * FROM vehicle_documents WHERE active=1 AND expires_at IS NOT NULL AND expires_at <= ? ORDER BY expires_at").all(cutoff)
}
function vehicleDocumentsCreate(data) {
  const sid = data.supabase_id || require('crypto').randomUUID()
  const cleaned = { supabase_id: sid }
  for (const c of VEHICLE_DOC_COLS) if (c !== 'supabase_id' && data[c] !== undefined) cleaned[c] = data[c]
  cleaned.active = 1
  const cols = Object.keys(cleaned)
  const r = db.prepare(`INSERT INTO vehicle_documents(${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`).run(cleaned)
  return db.prepare('SELECT * FROM vehicle_documents WHERE id = ?').get(r.lastInsertRowid)
}
function vehicleDocumentsDelete(id) {
  const row = db.prepare('SELECT supabase_id, business_id FROM vehicle_documents WHERE id=?').get(id)
  db.prepare("UPDATE vehicle_documents SET active=0, updated_at=datetime('now') WHERE id=?").run(id)
  if (row?.supabase_id) tombstoneAdd('vehicle_documents', row.supabase_id, row.business_id)
}

// ── Vehicle Titulo (INTRANT matricula/traspaso) — v2.16.2 ────────────────
const VEHICLE_TITULO_COLS = ['supabase_id','sales_deal_supabase_id','vehicle_inventory_supabase_id','intrant_status','placa','matricula_url','traspaso_initiated_at','traspaso_completed_at','notes','active']
function vehicleTituloList() {
  return db.prepare("SELECT * FROM vehicle_titulo WHERE active=1 ORDER BY created_at DESC").all()
}
function vehicleTituloByDeal(dealSupabaseId) {
  if (!dealSupabaseId) return null
  return db.prepare("SELECT * FROM vehicle_titulo WHERE active=1 AND sales_deal_supabase_id=? ORDER BY created_at DESC LIMIT 1").get(dealSupabaseId)
}
function vehicleTituloUpsert(data) {
  if (!db) return null
  const sid = data.supabase_id || crypto.randomUUID()
  const existing = data.id
    ? db.prepare('SELECT * FROM vehicle_titulo WHERE id=?').get(data.id)
    : (data.sales_deal_supabase_id ? vehicleTituloByDeal(data.sales_deal_supabase_id) : null)
  if (existing) {
    const cleaned = {}
    for (const k of VEHICLE_TITULO_COLS) if (k !== 'supabase_id' && data[k] !== undefined) cleaned[k] = data[k]
    if (!Object.keys(cleaned).length) return existing
    const fields = Object.keys(cleaned).map(k => `${k} = @${k}`).join(', ')
    db.prepare(`UPDATE vehicle_titulo SET ${fields}, updated_at=datetime('now') WHERE id = @id`).run({ ...cleaned, id: existing.id })
    return db.prepare('SELECT * FROM vehicle_titulo WHERE id=?').get(existing.id)
  }
  const cleaned = { supabase_id: sid }
  for (const k of VEHICLE_TITULO_COLS) if (k !== 'supabase_id' && data[k] !== undefined) cleaned[k] = data[k]
  if (!cleaned.intrant_status) cleaned.intrant_status = 'pendiente'
  cleaned.active = 1
  const cols = Object.keys(cleaned)
  const r = db.prepare(`INSERT INTO vehicle_titulo(${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`).run(cleaned)
  return db.prepare('SELECT * FROM vehicle_titulo WHERE id=?').get(r.lastInsertRowid)
}
function vehicleTituloDelete(id) {
  const row = db.prepare('SELECT supabase_id, business_id FROM vehicle_titulo WHERE id=?').get(id)
  db.prepare("UPDATE vehicle_titulo SET active=0, updated_at=datetime('now') WHERE id=?").run(id)
  if (row?.supabase_id) tombstoneAdd('vehicle_titulo', row.supabase_id, row.business_id)
}

// ── Vehicle Reservations (deposit + expiry) — v2.16.4 ─────────────────────
const VEHICLE_RES_COLS = ['supabase_id','vehicle_inventory_supabase_id','client_id','client_supabase_id','salesperson_id','salesperson_supabase_id','deposit_amount','deposit_method','expires_at','released_at','released_reason','converted_deal_supabase_id','status','notes','active']

// Internal: flip the reserved unit's inventory status. Two rules:
//   1. Activating a reservation only flips 'available' → 'reserved' (don't
//      stomp 'sold' or anything in flight).
//   2. Releasing/expiring only flips 'reserved' → 'available' AND only when
//      no OTHER active reservation still holds the same unit.
function _vehicleResMarkReserved(vehicle_supabase_id) {
  if (!vehicle_supabase_id) return
  try {
    db.prepare("UPDATE vehicle_inventory SET status='reserved', updated_at=datetime('now') WHERE supabase_id=? AND status='available'").run(vehicle_supabase_id)
  } catch {}
}
function _vehicleResMarkAvailableIfFree(vehicle_supabase_id) {
  if (!vehicle_supabase_id) return
  try {
    const stillHeld = db.prepare("SELECT 1 FROM vehicle_reservations WHERE active=1 AND status='active' AND vehicle_inventory_supabase_id=? LIMIT 1").get(vehicle_supabase_id)
    if (stillHeld) return
    db.prepare("UPDATE vehicle_inventory SET status='available', updated_at=datetime('now') WHERE supabase_id=? AND status='reserved'").run(vehicle_supabase_id)
  } catch {}
}
function _vehicleResMarkSold(vehicle_supabase_id) {
  if (!vehicle_supabase_id) return
  try {
    db.prepare("UPDATE vehicle_inventory SET status='sold', sold_date=?, updated_at=datetime('now') WHERE supabase_id=?").run(new Date().toISOString(), vehicle_supabase_id)
  } catch {}
}

function vehicleReservationList(business_id) {
  // business_id arg kept for API parity with the namespace contract — desktop
  // SQLite is single-tenant per install so it's a no-op here.
  void business_id
  return db.prepare("SELECT * FROM vehicle_reservations WHERE active=1 ORDER BY expires_at ASC").all()
}
function vehicleReservationsActive(business_id) {
  void business_id
  return db.prepare("SELECT * FROM vehicle_reservations WHERE active=1 AND status='active' ORDER BY expires_at ASC").all()
}
function vehicleReservationGetById(id) {
  return db.prepare("SELECT * FROM vehicle_reservations WHERE id=?").get(id)
}
function vehicleReservationUpsert(payload) {
  if (!db) return null
  const data = payload || {}
  const sid = data.supabase_id || crypto.randomUUID()
  const existing = data.id ? vehicleReservationGetById(data.id) : null
  if (existing) {
    const cleaned = {}
    for (const k of VEHICLE_RES_COLS) if (k !== 'supabase_id' && data[k] !== undefined) cleaned[k] = data[k]
    if (!Object.keys(cleaned).length) return existing
    const fields = Object.keys(cleaned).map(k => `${k} = @${k}`).join(', ')
    db.prepare(`UPDATE vehicle_reservations SET ${fields}, updated_at=datetime('now') WHERE id = @id`).run({ ...cleaned, id: existing.id })
    const row = vehicleReservationGetById(existing.id)
    if (row?.status === 'active' && row.active) _vehicleResMarkReserved(row.vehicle_inventory_supabase_id)
    return row
  }
  const cleaned = { supabase_id: sid }
  for (const k of VEHICLE_RES_COLS) if (k !== 'supabase_id' && data[k] !== undefined) cleaned[k] = data[k]
  if (!cleaned.status) cleaned.status = 'active'
  if (!cleaned.expires_at) throw new Error('expires_at requerido')
  cleaned.active = 1
  const cols = Object.keys(cleaned)
  const r = db.prepare(`INSERT INTO vehicle_reservations(${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`).run(cleaned)
  const row = vehicleReservationGetById(r.lastInsertRowid)
  if (row?.status === 'active') _vehicleResMarkReserved(row.vehicle_inventory_supabase_id)
  return row
}
function vehicleReservationRelease({ id, reason } = {}) {
  if (!db || !id) return null
  const row = vehicleReservationGetById(id)
  if (!row) return null
  db.prepare("UPDATE vehicle_reservations SET status='released', released_at=?, released_reason=?, updated_at=datetime('now') WHERE id=?")
    .run(new Date().toISOString(), reason || null, id)
  _vehicleResMarkAvailableIfFree(row.vehicle_inventory_supabase_id)
  return vehicleReservationGetById(id)
}
function vehicleReservationConvert({ id, deal_supabase_id } = {}) {
  if (!db || !id) return null
  const row = vehicleReservationGetById(id)
  if (!row) return null
  db.prepare("UPDATE vehicle_reservations SET status='converted', converted_deal_supabase_id=?, updated_at=datetime('now') WHERE id=?")
    .run(deal_supabase_id || null, id)
  _vehicleResMarkSold(row.vehicle_inventory_supabase_id)
  return vehicleReservationGetById(id)
}
function vehicleReservationsExpire() {
  if (!db) return { expired: 0, ids: [] }
  const nowIso = new Date().toISOString()
  const due = db.prepare("SELECT id, supabase_id, vehicle_inventory_supabase_id FROM vehicle_reservations WHERE active=1 AND status='active' AND expires_at <= ?").all(nowIso)
  if (!due.length) return { expired: 0, ids: [] }
  const upd = db.prepare("UPDATE vehicle_reservations SET status='expired', released_at=?, released_reason='auto_expired', updated_at=datetime('now') WHERE id=?")
  const ids = []
  for (const r of due) {
    upd.run(nowIso, r.id)
    _vehicleResMarkAvailableIfFree(r.vehicle_inventory_supabase_id)
    ids.push({ id: r.id, supabase_id: r.supabase_id, vehicle_inventory_supabase_id: r.vehicle_inventory_supabase_id })
  }
  return { expired: ids.length, ids }
}

// ═══════════════════════════════════════════════════════════════════════════
// v2.16.4 Sprint 2B H3 — Vehicle Warranties (post-sale).
// Claims live as a JSON array on each warranty row. Status transitions:
//   active → claimed (one or more claims registered) → expired (date passed)
//   active → expired (date passed without claims) → voided (manually anulada)
// vehicleWarrantiesExpire() flips date-due rows to 'expired' (only if not
// already 'voided' or 'claimed'), called from main.js setInterval next to
// the reservations sweep. Cheap query (indexed expires_at + status + active).
// ═══════════════════════════════════════════════════════════════════════════
const VEHICLE_WARRANTY_COLS = ['supabase_id','sales_deal_supabase_id','vehicle_inventory_supabase_id','client_id','client_supabase_id','kind','starts_at','expires_at','terms','claims','status','notes','active']
function _parseClaims(row) {
  if (!row) return row
  let claims = []
  try { claims = JSON.parse(row.claims || '[]') } catch { claims = [] }
  if (!Array.isArray(claims)) claims = []
  return { ...row, claims }
}
function vehicleWarrantyList(business_id) {
  void business_id
  if (!db) return []
  return db.prepare("SELECT * FROM vehicle_warranties WHERE active=1 ORDER BY expires_at ASC").all().map(_parseClaims)
}
function vehicleWarrantyByDeal(sales_deal_supabase_id) {
  if (!db || !sales_deal_supabase_id) return []
  return db.prepare("SELECT * FROM vehicle_warranties WHERE active=1 AND sales_deal_supabase_id=? ORDER BY created_at DESC").all(sales_deal_supabase_id).map(_parseClaims)
}
function vehicleWarrantyGetById(id) {
  if (!db || !id) return null
  const row = db.prepare("SELECT * FROM vehicle_warranties WHERE id=?").get(id)
  return row ? _parseClaims(row) : null
}
function vehicleWarrantyUpsert(payload) {
  if (!db) return null
  const data = payload || {}
  const sid = data.supabase_id || crypto.randomUUID()
  const existing = data.id ? vehicleWarrantyGetById(data.id) : null
  if (existing) {
    const cleaned = {}
    for (const k of VEHICLE_WARRANTY_COLS) {
      if (k === 'supabase_id') continue
      if (data[k] === undefined) continue
      cleaned[k] = (k === 'claims' && Array.isArray(data[k])) ? JSON.stringify(data[k]) : data[k]
    }
    if (!Object.keys(cleaned).length) return existing
    const fields = Object.keys(cleaned).map(k => `${k} = @${k}`).join(', ')
    db.prepare(`UPDATE vehicle_warranties SET ${fields}, updated_at=datetime('now') WHERE id = @id`).run({ ...cleaned, id: existing.id })
    return vehicleWarrantyGetById(existing.id)
  }
  if (!data.sales_deal_supabase_id) throw new Error('sales_deal_supabase_id requerido')
  if (!data.expires_at) throw new Error('expires_at requerido')
  const cleaned = { supabase_id: sid }
  for (const k of VEHICLE_WARRANTY_COLS) {
    if (k === 'supabase_id') continue
    if (data[k] === undefined) continue
    cleaned[k] = (k === 'claims' && Array.isArray(data[k])) ? JSON.stringify(data[k]) : data[k]
  }
  if (!cleaned.kind) cleaned.kind = 'general'
  if (!cleaned.status) cleaned.status = 'active'
  if (!cleaned.starts_at) cleaned.starts_at = new Date().toISOString()
  if (!cleaned.claims) cleaned.claims = '[]'
  cleaned.active = 1
  const cols = Object.keys(cleaned)
  const r = db.prepare(`INSERT INTO vehicle_warranties(${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`).run(cleaned)
  return vehicleWarrantyGetById(r.lastInsertRowid)
}
function vehicleWarrantyAddClaim({ id, claim } = {}) {
  if (!db || !id || !claim) return null
  const row = vehicleWarrantyGetById(id)
  if (!row) return null
  const next = Array.isArray(row.claims) ? row.claims.slice() : []
  next.push({
    date:        claim.date || new Date().toISOString(),
    description: String(claim.description || '').slice(0, 1000),
    status:      ['open','in_progress','resolved','rejected'].includes(claim.status) ? claim.status : 'open',
    cost:        Number(claim.cost) || 0,
  })
  // Promote warranty to 'claimed' the first time a claim is recorded so the
  // dashboard tile counts match what the owner expects to see.
  const newStatus = row.status === 'active' ? 'claimed' : row.status
  db.prepare("UPDATE vehicle_warranties SET claims=?, status=?, updated_at=datetime('now') WHERE id=?")
    .run(JSON.stringify(next), newStatus, id)
  // v2.16.2 Sprint 2E — surface warranty claims in the owner activity feed.
  try {
    activityLogRecord({
      event_type:  'vehicle_warranty_claim_added',
      severity:    'info',
      target_type: 'vehicle_warranty',
      target_id:   id,
      target_name: row.kind || 'general',
      amount:      Number(claim.cost) || 0,
      metadata: {
        warranty_supabase_id: row.supabase_id || null,
        sales_deal_supabase_id: row.sales_deal_supabase_id || null,
        vehicle_inventory_supabase_id: row.vehicle_inventory_supabase_id || null,
        claim_status: ['open','in_progress','resolved','rejected'].includes(claim.status) ? claim.status : 'open',
        description:  String(claim.description || '').slice(0, 200),
      },
    })
  } catch {}
  return vehicleWarrantyGetById(id)
}
function vehicleWarrantyVoid({ id, reason } = {}) {
  if (!db || !id) return null
  const row = vehicleWarrantyGetById(id)
  if (!row) return null
  const notes = reason ? `${row.notes ? row.notes + '\n' : ''}[ANULADA] ${reason}` : row.notes
  db.prepare("UPDATE vehicle_warranties SET status='voided', notes=?, updated_at=datetime('now') WHERE id=?")
    .run(notes, id)
  return vehicleWarrantyGetById(id)
}
function vehicleWarrantyExpiringSoon(business_id, days) {
  void business_id
  if (!db) return []
  const d = Math.max(1, Number(days) || 30)
  const cutoff = new Date(Date.now() + d * 86400000).toISOString()
  const nowIso = new Date().toISOString()
  return db.prepare("SELECT * FROM vehicle_warranties WHERE active=1 AND status='active' AND expires_at > ? AND expires_at <= ? ORDER BY expires_at ASC")
    .all(nowIso, cutoff).map(_parseClaims)
}
function vehicleWarrantiesExpire() {
  if (!db) return { expired: 0, ids: [] }
  const nowIso = new Date().toISOString()
  // Only flip rows whose status is still 'active' or 'claimed' — voided rows
  // should never get re-stamped, and rows already 'expired' are no-ops.
  const due = db.prepare("SELECT id, supabase_id, sales_deal_supabase_id FROM vehicle_warranties WHERE active=1 AND status IN ('active','claimed') AND expires_at <= ?").all(nowIso)
  if (!due.length) return { expired: 0, ids: [] }
  const upd = db.prepare("UPDATE vehicle_warranties SET status='expired', updated_at=datetime('now') WHERE id=?")
  const ids = []
  for (const r of due) {
    upd.run(r.id)
    ids.push({ id: r.id, supabase_id: r.supabase_id, sales_deal_supabase_id: r.sales_deal_supabase_id })
  }
  return { expired: ids.length, ids }
}

// ═══════════════════════════════════════════════════════════════════════════
// v2.16.4 Sprint 2C — Bank Pre-approvals (manual workflow, no API).
// Vendedor llama el banco, registra la oferta. Estado avanza manual:
//   solicitada → en_revision → pre_aprobada → utilizada (al cerrar trato)
//                                          ↘ rechazada
//                                          ↘ expirada (sweep)
// bankPreapprovalsExpire() flips date-due rows to 'expirada' (only if not
// already utilizada/rechazada), called from main.js setInterval next to the
// reservations + warranty sweeps.
// ═══════════════════════════════════════════════════════════════════════════
const BANK_PREAPPROVAL_COLS = ['supabase_id','client_id','client_supabase_id','lead_supabase_id','vehicle_inventory_supabase_id','salesperson_id','salesperson_supabase_id','bank','bank_contact','requested_amount','term_months','rate_offered','monthly_quota_offered','status','expires_at','decision_at','decision_letter_url','notes','active']
function bankPreapprovalList(business_id, opts) {
  void business_id
  if (!db) return []
  const { status, since } = opts || {}
  const where = ['active=1']
  const args = []
  if (status) { where.push('status=?'); args.push(status) }
  if (since)  { where.push('created_at >= ?'); args.push(since) }
  const sql = `SELECT * FROM bank_preapprovals WHERE ${where.join(' AND ')} ORDER BY created_at DESC`
  return db.prepare(sql).all(...args)
}
function bankPreapprovalActiveByClient(client_supabase_id) {
  if (!db || !client_supabase_id) return []
  const nowIso = new Date().toISOString()
  return db.prepare(
    "SELECT * FROM bank_preapprovals WHERE active=1 AND client_supabase_id=? AND status='pre_aprobada' AND (expires_at IS NULL OR expires_at > ?) ORDER BY decision_at DESC, created_at DESC"
  ).all(client_supabase_id, nowIso)
}
function bankPreapprovalGetById(id) {
  if (!db || !id) return null
  return db.prepare("SELECT * FROM bank_preapprovals WHERE id=?").get(id) || null
}
function bankPreapprovalUpsert(payload) {
  if (!db) return null
  const data = payload || {}
  const sid = data.supabase_id || crypto.randomUUID()
  const existing = data.id ? bankPreapprovalGetById(data.id) : null
  if (existing) {
    const cleaned = {}
    for (const k of BANK_PREAPPROVAL_COLS) {
      if (k === 'supabase_id') continue
      if (data[k] === undefined) continue
      cleaned[k] = data[k]
    }
    if (!Object.keys(cleaned).length) return existing
    const fields = Object.keys(cleaned).map(k => `${k} = @${k}`).join(', ')
    db.prepare(`UPDATE bank_preapprovals SET ${fields}, updated_at=datetime('now') WHERE id = @id`).run({ ...cleaned, id: existing.id })
    return bankPreapprovalGetById(existing.id)
  }
  if (!data.bank) throw new Error('bank requerido')
  const cleaned = { supabase_id: sid }
  for (const k of BANK_PREAPPROVAL_COLS) {
    if (k === 'supabase_id') continue
    if (data[k] === undefined) continue
    cleaned[k] = data[k]
  }
  if (!cleaned.status) cleaned.status = 'solicitada'
  if (cleaned.requested_amount == null) cleaned.requested_amount = 0
  cleaned.active = 1
  const cols = Object.keys(cleaned)
  const r = db.prepare(`INSERT INTO bank_preapprovals(${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`).run(cleaned)
  return bankPreapprovalGetById(r.lastInsertRowid)
}
function bankPreapprovalSetStatus({ id, status, decision_letter_url, notes } = {}) {
  if (!db || !id || !status) return null
  const allowed = ['solicitada','en_revision','pre_aprobada','rechazada','expirada','utilizada']
  if (!allowed.includes(status)) throw new Error(`status invalido: ${status}`)
  const row = bankPreapprovalGetById(id)
  if (!row) return null
  const decisionAt = (status === 'pre_aprobada' || status === 'rechazada') ? new Date().toISOString() : row.decision_at
  const url = decision_letter_url !== undefined ? decision_letter_url : row.decision_letter_url
  const mergedNotes = notes ? `${row.notes ? row.notes + '\n' : ''}${notes}` : row.notes
  db.prepare("UPDATE bank_preapprovals SET status=?, decision_at=?, decision_letter_url=?, notes=?, updated_at=datetime('now') WHERE id=?")
    .run(status, decisionAt, url, mergedNotes, id)
  return bankPreapprovalGetById(id)
}
function bankPreapprovalsExpire() {
  if (!db) return { expired: 0, ids: [] }
  const nowIso = new Date().toISOString()
  const due = db.prepare(
    "SELECT id, supabase_id, client_supabase_id, bank FROM bank_preapprovals WHERE active=1 AND status IN ('solicitada','en_revision','pre_aprobada') AND expires_at IS NOT NULL AND expires_at <= ?"
  ).all(nowIso)
  if (!due.length) return { expired: 0, ids: [] }
  const upd = db.prepare("UPDATE bank_preapprovals SET status='expirada', updated_at=datetime('now') WHERE id=?")
  const ids = []
  for (const r of due) {
    upd.run(r.id)
    ids.push({ id: r.id, supabase_id: r.supabase_id, client_supabase_id: r.client_supabase_id, bank: r.bank })
  }
  return { expired: ids.length, ids }
}

// ═══════════════════════════════════════════════════════════════════════════
// v2.16.0 — Taller Mecánico hardening: aseguradoras / suppliers / parts_orders
// / work_order_photos / insurance_batches CRUD.
// ═══════════════════════════════════════════════════════════════════════════

function aseguradoraCreate({ nombre, rnc, contacto_telefono, contacto_email, ecf_mode, notas }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO aseguradoras(supabase_id, business_id, nombre, rnc, contacto_telefono, contacto_email, ecf_mode, notas)
    VALUES(@sid, @biz, @nombre, @rnc, @tel, @email, @mode, @notas)`).run({
    sid, biz: _bizId(), nombre, rnc: rnc || null,
    tel: contacto_telefono || null, email: contacto_email || null,
    mode: ecf_mode === 'monthly_batch' ? 'monthly_batch' : 'per_wo',
    notas: notas || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function aseguradoraUpdate(id, data) {
  if (!db) return null
  const allowed = ['nombre','rnc','contacto_telefono','contacto_email','ecf_mode','notas','active']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM aseguradoras WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE aseguradoras SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM aseguradoras WHERE id=?').get(id)
}
function aseguradoraList({ active = 1 } = {}) {
  if (!db) return []
  return db.prepare('SELECT * FROM aseguradoras WHERE active=? ORDER BY nombre').all(active ? 1 : 0)
}
function aseguradoraGetById(id) {
  if (!db) return null
  return db.prepare('SELECT * FROM aseguradoras WHERE id=?').get(id)
}
function aseguradoraGetBySupabaseId(supabase_id) {
  if (!db || !supabase_id) return null
  return db.prepare('SELECT * FROM aseguradoras WHERE supabase_id=?').get(supabase_id)
}
function aseguradoraDelete(id) {
  if (!db) return
  const row = db.prepare('SELECT supabase_id, business_id FROM aseguradoras WHERE id=?').get(id)
  db.prepare("UPDATE aseguradoras SET active=0, updated_at=datetime('now') WHERE id=?").run(id)
  if (row?.supabase_id) tombstoneAdd('aseguradoras', row.supabase_id, row.business_id)
}

// ── v2.16.2 — Loan renewals (M2 desktop preload parity) ────────────────────
function loanRenewalsList({ loanSupabaseId, loan_supabase_id, businessId } = {}) {
  if (!db) return []
  const biz = businessId || _bizId()
  const lsid = loanSupabaseId || loan_supabase_id || null
  if (lsid) {
    return db.prepare(`SELECT * FROM loan_renewals
      WHERE (business_id=? OR business_id IS NULL) AND loan_supabase_id=?
      ORDER BY renewed_at DESC`).all(biz, lsid)
  }
  return db.prepare(`SELECT * FROM loan_renewals
    WHERE (business_id=? OR business_id IS NULL)
    ORDER BY renewed_at DESC`).all(biz)
}
function loanRenewalCreate(data) {
  if (!db) return null
  const sid = data?.supabase_id || crypto.randomUUID()
  const r = db.prepare(`INSERT INTO loan_renewals
    (supabase_id, business_id, loan_id, loan_supabase_id, renewal_count, interest_paid,
     new_due_date, previous_due_date, renewed_at, notes)
    VALUES (@sid, @biz, @lid, @lsid, @rc, @ip, @ndd, @pdd, COALESCE(@ra, datetime('now')), @notes)`).run({
      sid,
      biz: _bizId(),
      lid:  data?.loan_id != null ? Number(data.loan_id) : null,
      lsid: data?.loan_supabase_id || null,
      rc:   Number(data?.renewal_count) || 0,
      ip:   data?.interest_paid != null ? Number(data.interest_paid) : null,
      ndd:  data?.new_due_date || null,
      pdd:  data?.previous_due_date || null,
      ra:   data?.renewed_at || null,
      notes: data?.notes || null,
    })
  return { id: r.lastInsertRowid, supabase_id: sid }
}

function supplierCreate({ nombre, rnc, telefono, contacto, notas }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO suppliers(supabase_id, business_id, nombre, rnc, telefono, contacto, notas)
    VALUES(@sid, @biz, @nombre, @rnc, @tel, @contacto, @notas)`).run({
    sid, biz: _bizId(), nombre, rnc: rnc || null,
    tel: telefono || null, contacto: contacto || null, notas: notas || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function supplierUpdate(id, data) {
  if (!db) return null
  const allowed = ['nombre','rnc','telefono','contacto','notas','active']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM suppliers WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE suppliers SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM suppliers WHERE id=?').get(id)
}
function supplierList({ active = 1 } = {}) {
  if (!db) return []
  return db.prepare('SELECT * FROM suppliers WHERE active=? ORDER BY nombre').all(active ? 1 : 0)
}
function supplierGetById(id) {
  if (!db) return null
  return db.prepare('SELECT * FROM suppliers WHERE id=?').get(id)
}
function supplierDelete(id) {
  if (!db) return
  const row = db.prepare('SELECT supabase_id, business_id FROM suppliers WHERE id=?').get(id)
  db.prepare("UPDATE suppliers SET active=0, updated_at=datetime('now') WHERE id=?").run(id)
  if (row?.supabase_id) tombstoneAdd('suppliers', row.supabase_id, row.business_id)
}

function partsOrderCreate({ work_order_supabase_id, supplier_supabase_id, part_name, part_sku, quantity, unit_cost_estimate, expected_at, notes }) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO parts_orders(supabase_id, business_id, work_order_supabase_id, supplier_supabase_id, part_name, part_sku, quantity, unit_cost_estimate, expected_at, notes)
    VALUES(@sid, @biz, @wo_sid, @sup_sid, @name, @sku, @qty, @cost, @exp, @notes)`).run({
    sid, biz: _bizId(),
    wo_sid: work_order_supabase_id || null, sup_sid: supplier_supabase_id || null,
    name: part_name, sku: part_sku || null,
    qty: Number(quantity) || 1, cost: Number(unit_cost_estimate) || 0,
    exp: expected_at || null, notes: notes || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function partsOrderUpdate(id, data) {
  if (!db) return null
  const allowed = ['work_order_supabase_id','supplier_supabase_id','part_name','part_sku','quantity','unit_cost_estimate','expected_at','received_at','received_barcode','status','notes']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM parts_orders WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE parts_orders SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM parts_orders WHERE id=?').get(id)
}
function partsOrderMarkReceived(id, { received_barcode } = {}) {
  if (!db) return null
  db.prepare(`UPDATE parts_orders SET status='recibido', received_at=datetime('now'),
    received_barcode=COALESCE(?, received_barcode), updated_at=datetime('now') WHERE id=?`)
    .run(received_barcode || null, id)
  const row = db.prepare('SELECT * FROM parts_orders WHERE id=?').get(id)
  if (!row) return null

  // FIX-H2 — bump inventory_items.quantity if the part_sku matches an
  // existing inventory item for this business. The DR shop that also sells
  // repuestos al mostrador needs stock to stay in sync.
  try {
    if (row.part_sku) {
      const inv = db.prepare(
        "SELECT id FROM inventory_items WHERE sku=? AND (business_id IS NULL OR business_id = ?) LIMIT 1"
      ).get(row.part_sku, row.business_id || null)
      if (inv?.id) {
        const delta = Number(row.quantity) || 0
        if (delta > 0) {
          inventoryAdjust(inv.id, delta, `Recepción suministro #${row.id} (${row.part_name})`, null)
        }
      }
    }
  } catch (e) {
    log?.warn?.(`[partsOrderMarkReceived] inventory bump failed: ${e.message}`)
  }

  // FIX-H1 — register the supplier expense in compras_607 so the contador's
  // monthly DGII filing includes the gasto. Skipped when supplier has no RNC
  // (non-fiscal informal vendor — would be rejected by the 607 schema anyway).
  try {
    if (row.supplier_supabase_id) {
      const sup = db.prepare("SELECT nombre, rnc FROM suppliers WHERE supabase_id=?").get(row.supplier_supabase_id)
      const rncDigits = String(sup?.rnc || '').replace(/\D/g, '')
      if (sup?.nombre && rncDigits.length >= 9) {
        const monto = (Number(row.quantity) || 0) * (Number(row.unit_cost_estimate) || 0)
        if (monto > 0) {
          // Existing helper handles supabase_id + signed inserts. We default to
          // tipo_ncf='B01' (factura de crédito fiscal) since suppliers in DR
          // typically issue B01. The cashier can edit it later in 607 review.
          const itbis = Math.round(monto / 1.18 * 0.18 * 100) / 100
          const monto_bienes = Math.round((monto - itbis) * 100) / 100
          addCompra607({
            rnc_proveedor:    rncDigits,
            nombre_proveedor: sup.nombre,
            tipo_ncf:         'B01',
            ncf:              '',
            fecha_ncf:        new Date().toISOString().slice(0, 10),
            fecha_pago:       new Date().toISOString().slice(0, 10),
            monto_servicios:  0,
            monto_bienes:     monto_bienes,
            total:            monto,
            itbis_facturado:  itbis,
            forma_pago:       'efectivo',
            notas:            `Recepción suministro #${row.id}: ${row.part_name}${row.part_sku ? ' (' + row.part_sku + ')' : ''}`,
          })
        }
      }
    }
  } catch (e) {
    log?.warn?.(`[partsOrderMarkReceived] 607 insert failed: ${e.message}`)
  }

  return row
}
function partsOrderListByWO(work_order_supabase_id) {
  if (!db || !work_order_supabase_id) return []
  return db.prepare(`SELECT po.*, s.nombre AS supplier_name
    FROM parts_orders po
    LEFT JOIN suppliers s ON s.supabase_id = po.supplier_supabase_id
    WHERE po.work_order_supabase_id=? ORDER BY po.created_at DESC`).all(work_order_supabase_id)
}
function partsOrderListAwaiting() {
  if (!db) return []
  return db.prepare(`SELECT po.*, s.nombre AS supplier_name, wo.id AS wo_id, v.plate AS vehicle_plate, c.name AS client_name, c.phone AS client_phone
    FROM parts_orders po
    LEFT JOIN suppliers s ON s.supabase_id = po.supplier_supabase_id
    LEFT JOIN work_orders wo ON wo.supabase_id = po.work_order_supabase_id
    LEFT JOIN vehicles v ON v.id = wo.vehicle_id
    LEFT JOIN clients c ON c.id = wo.client_id
    WHERE po.status IN ('pendiente','en_camino') ORDER BY po.expected_at, po.created_at`).all()
}
function partsOrderFindByBarcode(barcode) {
  if (!db || !barcode) return null
  return db.prepare(`SELECT * FROM parts_orders WHERE received_barcode=? AND status IN ('pendiente','en_camino') ORDER BY created_at DESC LIMIT 1`).get(barcode)
}
function partsOrderDelete(id) {
  if (!db) return
  const row = db.prepare('SELECT supabase_id, business_id FROM parts_orders WHERE id=?').get(id)
  db.prepare('DELETE FROM parts_orders WHERE id=?').run(id)
  if (row?.supabase_id) tombstoneAdd('parts_orders', row.supabase_id, row.business_id)
}

function workOrderPhotoInsert({ work_order_supabase_id, vehicle_supabase_id, phase, storage_path, taken_by_empleado_supabase_id, caption }) {
  if (!db) return null
  if (phase !== 'antes' && phase !== 'despues') throw new Error('phase must be antes|despues')
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO work_order_photos(supabase_id, business_id, work_order_supabase_id, vehicle_supabase_id, phase, storage_path, taken_by_empleado_supabase_id, caption)
    VALUES(@sid, @biz, @wo_sid, @veh_sid, @phase, @path, @emp_sid, @caption)`).run({
    sid, biz: _bizId(),
    wo_sid: work_order_supabase_id || null, veh_sid: vehicle_supabase_id || null,
    phase, path: storage_path,
    emp_sid: taken_by_empleado_supabase_id || null, caption: caption || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function workOrderPhotoListByWO(work_order_supabase_id) {
  if (!db || !work_order_supabase_id) return []
  return db.prepare('SELECT * FROM work_order_photos WHERE work_order_supabase_id=? ORDER BY created_at').all(work_order_supabase_id)
}
function workOrderPhotoListByVehicle(vehicle_supabase_id) {
  if (!db || !vehicle_supabase_id) return []
  return db.prepare('SELECT * FROM work_order_photos WHERE vehicle_supabase_id=? ORDER BY created_at DESC').all(vehicle_supabase_id)
}
function workOrderPhotoDelete(id) {
  if (!db) return
  const row = db.prepare('SELECT supabase_id, business_id FROM work_order_photos WHERE id=?').get(id)
  db.prepare('DELETE FROM work_order_photos WHERE id=?').run(id)
  if (row?.supabase_id) tombstoneAdd('work_order_photos', row.supabase_id, row.business_id)
}

function insuranceBatchCreate({ aseguradora_supabase_id, period_month, notes }) {
  if (!db || !aseguradora_supabase_id || !period_month) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO insurance_batches(supabase_id, business_id, aseguradora_supabase_id, period_month, notes)
    VALUES(@sid, @biz, @aseg_sid, @period, @notes)`).run({
    sid, biz: _bizId(), aseg_sid: aseguradora_supabase_id, period: period_month, notes: notes || null,
  })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function insuranceBatchUpdate(id, data) {
  if (!db) return null
  const allowed = ['ecf_supabase_id','ecf_ncf','total_amount','itbis_amount','pdf_storage_path','work_order_count','status','notes']
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(patch).length) return db.prepare('SELECT * FROM insurance_batches WHERE id=?').get(id)
  const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE insurance_batches SET ${fields}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
  return db.prepare('SELECT * FROM insurance_batches WHERE id=?').get(id)
}
function insuranceBatchListByPeriod({ aseguradora_supabase_id, period_month } = {}) {
  if (!db) return []
  let sql = 'SELECT * FROM insurance_batches WHERE 1=1'
  const params = []
  if (aseguradora_supabase_id) { sql += ' AND aseguradora_supabase_id=?'; params.push(aseguradora_supabase_id) }
  if (period_month)            { sql += ' AND period_month=?';            params.push(period_month) }
  sql += ' ORDER BY period_month DESC'
  return db.prepare(sql).all(...params)
}
function insuranceBatchGet(id) {
  if (!db) return null
  return db.prepare('SELECT * FROM insurance_batches WHERE id=?').get(id)
}

// Work-orders for a given insurer + month, used to assemble a monthly batch.
function workOrdersForInsuranceBatch(aseguradora_supabase_id, period_month) {
  if (!db || !aseguradora_supabase_id || !period_month) return []
  return db.prepare(`SELECT wo.*, v.plate AS vehicle_plate, v.make AS vehicle_make, v.model AS vehicle_model, c.name AS client_name
    FROM work_orders wo
    LEFT JOIN vehicles v ON v.id = wo.vehicle_id
    LEFT JOIN clients c ON c.id = wo.client_id
    WHERE wo.aseguradora_supabase_id=?
      AND substr(COALESCE(wo.completed_date, wo.finished_at, wo.updated_at),1,7) = ?
      AND wo.status IN ('facturado','closed','listo')
    ORDER BY wo.completed_date, wo.id`).all(aseguradora_supabase_id, period_month)
}

// Mechanic productivity: hours-on-WO per technician for a period.
function mechanicProductivityForPeriod(period_start, period_end) {
  if (!db) return []
  return db.prepare(`SELECT
      e.id AS empleado_id, e.supabase_id AS empleado_supabase_id, e.nombre,
      e.commission_pct,
      COUNT(wo.id) AS wo_count,
      SUM(CASE WHEN wo.started_at IS NOT NULL AND wo.finished_at IS NOT NULL
               THEN (julianday(wo.finished_at) - julianday(wo.started_at)) * 24 ELSE 0 END) AS hours_total,
      SUM(COALESCE(wo.labor_total,0)) AS labor_total,
      SUM(COALESCE(wo.total,0)) AS revenue_total
    FROM empleados e
    LEFT JOIN work_orders wo ON wo.technician_empleado_id = e.id
      AND wo.completed_date BETWEEN ? AND ?
    WHERE e.active = 1
    GROUP BY e.id
    ORDER BY hours_total DESC`).all(period_start, period_end)
}

// Daily reminder candidates (vehicles needing service soon).
function mechanicServiceRemindersDue() {
  if (!db) return []
  return db.prepare(`SELECT v.*, c.name AS client_name, c.phone AS client_phone
    FROM vehicles v
    LEFT JOIN clients c ON c.id = v.client_id
    WHERE v.active = 1 AND (
      (v.next_service_km IS NOT NULL AND v.odometer_km IS NOT NULL
        AND v.odometer_km >= v.next_service_km - 500)
      OR
      (v.next_service_at IS NOT NULL
        AND date(v.next_service_at) <= date('now','+7 days'))
    )
    ORDER BY v.next_service_at, v.next_service_km`).all()
}

// ─── Phase 1B — Contabilidad firm-side helpers ─────────────────────────────
//
// Calendar templates live in `electron/contabilidadCalendar.cjs` (CJS shim of
// `packages/config/contabilidadCalendar.js`). Phase 2 Slice 1 deduped the
// previously-inlined array.
const { applicableTemplates: _accApplicableTemplates, dueDateFor: _accDueDate } = require('./contabilidadCalendar.cjs')

function _accNowIso() { return new Date().toISOString() }
function _accUuid()   { return crypto.randomUUID() }

// ── accounting_clients ────────────────────────────────────────────────────
function accountingClientCreate(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const now = _accNowIso()
  const r = db.prepare(`INSERT INTO accounting_clients
    (supabase_id, business_id, client_business_supabase_id, nombre_comercial, rnc, cedula,
     tipo_persona, regimen, fecha_cierre_mes, fecha_cierre_dia, honorarios_mensuales,
     currency, assigned_to_user_id, status, notes, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.client_business_supabase_id || null,
    payload.nombre_comercial || '',
    payload.rnc || null,
    payload.cedula || null,
    payload.tipo_persona || 'pj',
    payload.regimen || 'ordinario',
    payload.fecha_cierre_mes ?? null,
    payload.fecha_cierre_dia ?? null,
    payload.honorarios_mensuales ?? 0,
    payload.currency || 'DOP',
    payload.assigned_to_user_id ?? null,
    payload.status || 'active',
    payload.notes || null,
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_clients WHERE id=?').get(r.lastInsertRowid)
}

function accountingClientUpdate(id, patch = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const allowed = ['client_business_supabase_id','nombre_comercial','rnc','cedula','tipo_persona','regimen',
    'fecha_cierre_mes','fecha_cierre_dia','honorarios_mensuales','currency','assigned_to_user_id','status','notes']
  const sets = []
  const vals = []
  for (const k of allowed) {
    if (k in patch) { sets.push(`${k}=?`); vals.push(patch[k]) }
  }
  if (!sets.length) return db.prepare('SELECT * FROM accounting_clients WHERE id=?').get(id) || null
  sets.push('updated_at=?'); vals.push(_accNowIso())
  vals.push(id)
  db.prepare(`UPDATE accounting_clients SET ${sets.join(', ')} WHERE id=?`).run(...vals)
  return db.prepare('SELECT * FROM accounting_clients WHERE id=?').get(id) || null
}

function accountingClientList({ businessId, status } = {}) {
  if (!db) return []
  const conds = []
  const params = []
  if (businessId) { conds.push('business_id=?'); params.push(businessId) }
  if (status)     { conds.push('status=?');      params.push(status) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_clients ${where} ORDER BY nombre_comercial ASC`).all(...params)
}

function accountingClientGet(id) {
  if (!db) return null
  return db.prepare('SELECT * FROM accounting_clients WHERE id=?').get(id) || null
}

function accountingClientDelete(id) {
  if (!db) throw new Error('Base de datos no disponible')
  // Soft-delete (parity with web layer): flip status to archived.
  db.prepare(`UPDATE accounting_clients SET status='archived', updated_at=? WHERE id=?`).run(_accNowIso(), id)
  return db.prepare('SELECT * FROM accounting_clients WHERE id=?').get(id) || null
}

// ── accounting_inbox ──────────────────────────────────────────────────────
function accountingInboxAdd(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const now = _accNowIso()
  const cliSid = payload.accounting_client_supabase_id || _resolveClientSupabaseId(payload.accounting_client_id)
  const r = db.prepare(`INSERT INTO accounting_inbox
    (supabase_id, business_id, accounting_client_id, accounting_client_supabase_id, source,
     original_filename, mime, size, r2_key, ocr_status, ocr_text, classified_type,
     classification_confidence, status, posted_journal_entry_id, posted_at, notes,
     created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.accounting_client_id ?? null,
    cliSid,
    payload.source || 'dropzone',
    payload.original_filename || 'sin-nombre',
    payload.mime || 'application/octet-stream',
    payload.size ?? 0,
    payload.r2_key || null,
    payload.ocr_status || 'pending',
    payload.ocr_text || null,
    payload.classified_type || 'otro',
    payload.classification_confidence ?? 0,
    payload.status || 'unclassified',
    payload.posted_journal_entry_id ?? null,
    payload.posted_at || null,
    payload.notes || null,
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_inbox WHERE id=?').get(r.lastInsertRowid)
}

function accountingInboxList({ businessId, status, accountingClientId } = {}) {
  if (!db) return []
  const conds = []
  const params = []
  if (businessId)         { conds.push('business_id=?');          params.push(businessId) }
  if (status)             { conds.push('status=?');               params.push(status) }
  if (accountingClientId) { conds.push('accounting_client_id=?'); params.push(accountingClientId) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_inbox ${where} ORDER BY created_at DESC LIMIT 500`).all(...params)
}

function accountingInboxClassify(id, patch = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const sets = []
  const vals = []
  if ('classified_type' in patch)      { sets.push('classified_type=?');      vals.push(patch.classified_type) }
  if ('accounting_client_id' in patch) { sets.push('accounting_client_id=?'); vals.push(patch.accounting_client_id) }
  if ('notes' in patch)                { sets.push('notes=?');                vals.push(patch.notes) }
  sets.push('status=?'); vals.push(patch.status || 'classified')
  sets.push('updated_at=?'); vals.push(_accNowIso())
  vals.push(id)
  db.prepare(`UPDATE accounting_inbox SET ${sets.join(', ')} WHERE id=?`).run(...vals)
  return db.prepare('SELECT * FROM accounting_inbox WHERE id=?').get(id) || null
}

function accountingInboxPost(id, { posted_journal_entry_id = null } = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const now = _accNowIso()
  db.prepare(`UPDATE accounting_inbox
    SET status='posted', posted_journal_entry_id=?, posted_at=?, updated_at=?
    WHERE id=?`).run(posted_journal_entry_id, now, now, id)
  return db.prepare('SELECT * FROM accounting_inbox WHERE id=?').get(id) || null
}

function accountingInboxDelete(id) {
  if (!db) throw new Error('Base de datos no disponible')
  db.prepare('DELETE FROM accounting_inbox WHERE id=?').run(id)
  return { id }
}

// ── accounting_obligations_calendar ───────────────────────────────────────
function accountingObligationGenerateYear({ businessId, accountingClientId, year } = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  if (!accountingClientId || !year) throw new Error('Faltan parámetros: accountingClientId y year son requeridos')
  // Look up the client's regimen + tipo_persona to filter applicable templates.
  const cli = db.prepare('SELECT regimen, tipo_persona FROM accounting_clients WHERE id=?').get(accountingClientId)
  if (!cli) throw new Error('Cliente de contabilidad no encontrado')
  const templates = _accApplicableTemplates({ regimen: cli.regimen, persona: cli.tipo_persona })
  const now = _accNowIso()
  const cliSid = _resolveClientSupabaseId(accountingClientId)
  const stmt = db.prepare(`INSERT OR IGNORE INTO accounting_obligations_calendar
    (supabase_id, business_id, accounting_client_id, accounting_client_supabase_id, form_type,
     period_year, period_month, due_date, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?, 'pendiente', ?, ?)`)
  let inserted = 0
  const tx = db.transaction(() => {
    for (const t of templates) {
      if (t.periodicity === 'annual') {
        const r = stmt.run(_accUuid(), businessId || null, accountingClientId, cliSid,
          t.form_type, year, 0, _accDueDate(t, year, 0), now, now)
        if (r.changes) inserted++
      } else {
        for (let m = 1; m <= 12; m++) {
          const r = stmt.run(_accUuid(), businessId || null, accountingClientId, cliSid,
            t.form_type, year, m, _accDueDate(t, year, m), now, now)
          if (r.changes) inserted++
        }
      }
    }
  })
  tx()
  return { inserted }
}

function accountingObligationsList({ businessId, accountingClientId, dateFrom, dateTo, status } = {}) {
  if (!db) return []
  const conds = []
  const params = []
  if (businessId)         { conds.push('business_id=?');          params.push(businessId) }
  if (accountingClientId) { conds.push('accounting_client_id=?'); params.push(accountingClientId) }
  if (dateFrom)           { conds.push('due_date >= ?');          params.push(dateFrom) }
  if (dateTo)             { conds.push('due_date <= ?');          params.push(dateTo) }
  if (status && status !== 'all') { conds.push('status=?');       params.push(status) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_obligations_calendar ${where}
    ORDER BY due_date ASC`).all(...params)
}

function accountingObligationMarkFiled(id, payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const now = _accNowIso()
  db.prepare(`UPDATE accounting_obligations_calendar
    SET status=?, filed_at=?, filed_by_user_id=?, dgii_constancia_no=?,
        attachment_supabase_id=?, updated_at=?
    WHERE id=?`).run(
    payload.status || 'radicado',
    now,
    payload.filed_by_user_id ?? null,
    payload.dgii_constancia_no || null,
    payload.attachment_supabase_id || null,
    now,
    id,
  )
  return db.prepare('SELECT * FROM accounting_obligations_calendar WHERE id=?').get(id) || null
}

// ── accounting_documents ──────────────────────────────────────────────────
function accountingDocumentAdd(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const now = _accNowIso()
  const cliSid = payload.accounting_client_supabase_id || _resolveClientSupabaseId(payload.accounting_client_id)
  const r = db.prepare(`INSERT INTO accounting_documents
    (supabase_id, business_id, accounting_client_id, accounting_client_supabase_id, category,
     period_year, period_month, filename, r2_key, mime, size, uploaded_by_user_id,
     expires_at, tags, notes, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.accounting_client_id ?? null,
    cliSid,
    payload.category || 'otro',
    payload.period_year ?? null,
    payload.period_month ?? null,
    payload.filename || 'sin-nombre',
    payload.r2_key || null,
    payload.mime || 'application/octet-stream',
    payload.size ?? 0,
    payload.uploaded_by_user_id ?? null,
    payload.expires_at || null,
    Array.isArray(payload.tags) ? JSON.stringify(payload.tags) : (payload.tags || null),
    payload.notes || null,
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_documents WHERE id=?').get(r.lastInsertRowid)
}

function accountingDocumentList({ businessId, accountingClientId, category } = {}) {
  if (!db) return []
  const conds = []
  const params = []
  if (businessId)         { conds.push('business_id=?');          params.push(businessId) }
  if (accountingClientId) { conds.push('accounting_client_id=?'); params.push(accountingClientId) }
  if (category)           { conds.push('category=?');             params.push(category) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_documents ${where}
    ORDER BY created_at DESC LIMIT 500`).all(...params)
}

function accountingDocumentDelete(id) {
  if (!db) throw new Error('Base de datos no disponible')
  db.prepare('DELETE FROM accounting_documents WHERE id=?').run(id)
  return { id }
}

// ── accounting_billing_plans ──────────────────────────────────────────────
function accountingBillingPlanCreate(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const now = _accNowIso()
  const cliSid = payload.accounting_client_supabase_id || _resolveClientSupabaseId(payload.accounting_client_id)
  const r = db.prepare(`INSERT INTO accounting_billing_plans
    (supabase_id, business_id, accounting_client_id, accounting_client_supabase_id, monthly_amount,
     currency, bill_day, ecf_type, late_fee_pct, late_fee_after_days, active, notes,
     created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.accounting_client_id ?? null,
    cliSid,
    payload.monthly_amount ?? 0,
    payload.currency || 'DOP',
    payload.bill_day ?? 1,
    payload.ecf_type || 'e32',
    payload.late_fee_pct ?? 0,
    payload.late_fee_after_days ?? 0,
    payload.active === false ? 0 : 1,
    payload.notes || null,
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_billing_plans WHERE id=?').get(r.lastInsertRowid)
}

function accountingBillingPlanUpdate(id, patch = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const allowed = ['accounting_client_id','monthly_amount','currency','bill_day','ecf_type',
    'late_fee_pct','late_fee_after_days','active','notes']
  const sets = []
  const vals = []
  for (const k of allowed) {
    if (k in patch) {
      sets.push(`${k}=?`)
      vals.push(k === 'active' ? (patch[k] ? 1 : 0) : patch[k])
    }
  }
  if (!sets.length) return db.prepare('SELECT * FROM accounting_billing_plans WHERE id=?').get(id) || null
  sets.push('updated_at=?'); vals.push(_accNowIso())
  vals.push(id)
  db.prepare(`UPDATE accounting_billing_plans SET ${sets.join(', ')} WHERE id=?`).run(...vals)
  return db.prepare('SELECT * FROM accounting_billing_plans WHERE id=?').get(id) || null
}

function accountingBillingPlanList({ businessId, accountingClientId } = {}) {
  if (!db) return []
  const conds = []
  const params = []
  if (businessId)         { conds.push('business_id=?');          params.push(businessId) }
  if (accountingClientId) { conds.push('accounting_client_id=?'); params.push(accountingClientId) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_billing_plans ${where}
    ORDER BY created_at DESC`).all(...params)
}

// ── accounting_billing_invoices ───────────────────────────────────────────
function accountingBillingInvoiceCreate(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  if (payload.period_year == null || payload.period_month == null) {
    throw new Error('Período (period_year, period_month) requerido')
  }
  const now = _accNowIso()
  const cliSid = payload.accounting_client_supabase_id || _resolveClientSupabaseId(payload.accounting_client_id)
  const r = db.prepare(`INSERT INTO accounting_billing_invoices
    (supabase_id, business_id, accounting_client_id, accounting_client_supabase_id,
     ticket_supabase_id, period_year, period_month, amount, currency, status, ecf_track_id,
     ecf_status, paid_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.accounting_client_id ?? null,
    cliSid,
    payload.ticket_supabase_id || null,
    payload.period_year,
    payload.period_month,
    payload.amount ?? 0,
    payload.currency || 'DOP',
    payload.status || 'draft',
    payload.ecf_track_id || null,
    payload.ecf_status || null,
    payload.paid_at || null,
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_billing_invoices WHERE id=?').get(r.lastInsertRowid)
}

function accountingBillingInvoiceMarkPaid(id) {
  if (!db) throw new Error('Base de datos no disponible')
  const now = _accNowIso()
  const inv = db.prepare('SELECT * FROM accounting_billing_invoices WHERE id=?').get(id)
  if (!inv) return null
  // Resolve plan for this client to get late_fee_pct + late_fee_after_days
  let lateFeeAmount = 0
  let paidLate = 0
  try {
    const plan = db.prepare(`SELECT late_fee_pct, late_fee_after_days, monthly_amount
      FROM accounting_billing_plans
      WHERE accounting_client_id=? AND active=1
      ORDER BY id DESC LIMIT 1`).get(inv.accounting_client_id)
    const pct  = Number(plan?.late_fee_pct || 0)
    const days = Number(plan?.late_fee_after_days || 0)
    if (pct > 0 && days > 0 && inv.created_at) {
      const issued = new Date(inv.created_at).getTime()
      const paidMs = Date.now()
      const ageDays = Math.floor((paidMs - issued) / 86400000)
      if (ageDays > days) {
        const base = Number(inv.amount || plan?.monthly_amount || 0)
        lateFeeAmount = Math.round(base * (pct / 100) * 100) / 100
        paidLate = 1
      }
    }
  } catch {}
  db.prepare(`UPDATE accounting_billing_invoices
    SET status='paid', paid_at=?, late_fee_amount=?, paid_late=?, updated_at=?
    WHERE id=?`).run(now, lateFeeAmount, paidLate, now, id)
  return db.prepare('SELECT * FROM accounting_billing_invoices WHERE id=?').get(id) || null
}

function accountingBillingInvoiceList({ businessId, accountingClientId, status } = {}) {
  if (!db) return []
  const conds = []
  const params = []
  if (businessId)         { conds.push('business_id=?');          params.push(businessId) }
  if (accountingClientId) { conds.push('accounting_client_id=?'); params.push(accountingClientId) }
  if (status)             { conds.push('status=?');               params.push(status) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_billing_invoices ${where}
    ORDER BY period_year DESC, period_month DESC`).all(...params)
}

// ── accounting_csv_mappings ───────────────────────────────────────────────
function accountingCsvMappingCreate(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  if (!payload.doc_type || !payload.name || !payload.mapping_json) {
    throw new Error('doc_type, name y mapping_json son requeridos')
  }
  const now = _accNowIso()
  const cliSid = payload.accounting_client_supabase_id || _resolveClientSupabaseId(payload.accounting_client_id)
  const r = db.prepare(`INSERT INTO accounting_csv_mappings
    (supabase_id, business_id, accounting_client_id, accounting_client_supabase_id, doc_type,
     name, mapping_json, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.accounting_client_id ?? null,
    cliSid,
    payload.doc_type,
    payload.name,
    typeof payload.mapping_json === 'string' ? payload.mapping_json : JSON.stringify(payload.mapping_json),
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_csv_mappings WHERE id=?').get(r.lastInsertRowid)
}

function accountingCsvMappingList({ businessId, accountingClientId, docType } = {}) {
  if (!db) return []
  const conds = []
  const params = []
  if (businessId)         { conds.push('business_id=?');          params.push(businessId) }
  if (accountingClientId) { conds.push('accounting_client_id=?'); params.push(accountingClientId) }
  if (docType)            { conds.push('doc_type=?');             params.push(docType) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_csv_mappings ${where}
    ORDER BY created_at DESC`).all(...params)
}

// ─── Phase 2 Slice 1 — Contabilidad full firm-side helpers ────────────────────
//
// _resolveClientSupabaseId(accounting_client_id) → uuid | null. Looks up the
// parent's UUID so every child insert that carries an integer FK can also set
// the companion *_supabase_id column (Phase 1 hardening + Phase 2 parity).
function _resolveClientSupabaseId(accountingClientId) {
  if (!db || !accountingClientId) return null
  try {
    const r = db.prepare('SELECT supabase_id FROM accounting_clients WHERE id=?').get(accountingClientId)
    return r?.supabase_id || null
  } catch { return null }
}

function _resolveJournalEntrySupabaseId(journalEntryId) {
  if (!db || !journalEntryId) return null
  try {
    const r = db.prepare('SELECT supabase_id FROM accounting_journal_entries WHERE id=?').get(journalEntryId)
    return r?.supabase_id || null
  } catch { return null }
}

function _resolveAccountSupabaseId(accountId) {
  if (!db || !accountId) return null
  try {
    const r = db.prepare('SELECT supabase_id FROM accounting_chart_of_accounts WHERE id=?').get(accountId)
    return r?.supabase_id || null
  } catch { return null }
}

function _resolveBankAccountSupabaseId(bankAccountId) {
  if (!db || !bankAccountId) return null
  try {
    const r = db.prepare('SELECT supabase_id FROM accounting_bank_accounts WHERE id=?').get(bankAccountId)
    return r?.supabase_id || null
  } catch { return null }
}

function _resolvePayrollPeriodSupabaseId(periodId) {
  if (!db || !periodId) return null
  try {
    const r = db.prepare('SELECT supabase_id FROM accounting_payroll_periods WHERE id=?').get(periodId)
    return r?.supabase_id || null
  } catch { return null }
}

// ── accounting_chart_of_accounts ─────────────────────────────────────────────
function accountingCoaCreate(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  if (!payload.code) throw new Error('code requerido')
  const now = _accNowIso()
  const cliSid = payload.accounting_client_supabase_id || _resolveClientSupabaseId(payload.accounting_client_id)
  let parentSid = payload.parent_supabase_id || null
  if (!parentSid && payload.parent_id) {
    try {
      const p = db.prepare('SELECT supabase_id FROM accounting_chart_of_accounts WHERE id=?').get(payload.parent_id)
      parentSid = p?.supabase_id || null
    } catch {}
  }
  const r = db.prepare(`INSERT INTO accounting_chart_of_accounts
    (supabase_id, business_id, accounting_client_id, accounting_client_supabase_id, code,
     parent_id, parent_supabase_id, name, type, is_postable, currency, notes, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.accounting_client_id ?? null,
    cliSid,
    payload.code,
    payload.parent_id ?? null,
    parentSid,
    payload.name || '',
    payload.type || 'activo',
    payload.is_postable === false ? 0 : 1,
    payload.currency || 'DOP',
    payload.notes || null,
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_chart_of_accounts WHERE id=?').get(r.lastInsertRowid)
}

function accountingCoaUpdate(id, patch = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const allowed = ['code','parent_id','parent_supabase_id','name','type','is_postable','currency','notes',
    'accounting_client_supabase_id']
  const sets = []
  const vals = []
  for (const k of allowed) {
    if (k in patch) {
      sets.push(`${k}=?`)
      vals.push(k === 'is_postable' ? (patch[k] ? 1 : 0) : patch[k])
    }
  }
  if (!sets.length) return db.prepare('SELECT * FROM accounting_chart_of_accounts WHERE id=?').get(id) || null
  sets.push('updated_at=?'); vals.push(_accNowIso())
  vals.push(id)
  db.prepare(`UPDATE accounting_chart_of_accounts SET ${sets.join(', ')} WHERE id=?`).run(...vals)
  return db.prepare('SELECT * FROM accounting_chart_of_accounts WHERE id=?').get(id) || null
}

function accountingCoaList({ businessId, accountingClientId, type } = {}) {
  if (!db) return []
  const conds = []; const params = []
  if (businessId)         { conds.push('business_id=?');          params.push(businessId) }
  if (accountingClientId) { conds.push('accounting_client_id=?'); params.push(accountingClientId) }
  if (type)               { conds.push('type=?');                 params.push(type) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_chart_of_accounts ${where} ORDER BY code ASC`).all(...params)
}

function accountingCoaGet(id) {
  if (!db) return null
  return db.prepare('SELECT * FROM accounting_chart_of_accounts WHERE id=?').get(id) || null
}

function accountingCoaDelete(id) {
  if (!db) throw new Error('Base de datos no disponible')
  db.prepare('DELETE FROM accounting_chart_of_accounts WHERE id=?').run(id)
  return { id }
}

// ── accounting_journal_entries + journal_lines ───────────────────────────────
function accountingJournalEntryCreate(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const now = _accNowIso()
  const cliSid = payload.accounting_client_supabase_id || _resolveClientSupabaseId(payload.accounting_client_id)
  const r = db.prepare(`INSERT INTO accounting_journal_entries
    (supabase_id, business_id, accounting_client_id, accounting_client_supabase_id, fecha,
     description, type, reference_doc_supabase_id, status, posted_by_user_id, period_year,
     period_month, totals_debit, totals_credit, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.accounting_client_id ?? null,
    cliSid,
    payload.fecha || null,
    payload.description || null,
    payload.type || 'manual',
    payload.reference_doc_supabase_id || null,
    payload.status || 'draft',
    payload.posted_by_user_id ?? null,
    payload.period_year ?? null,
    payload.period_month ?? null,
    payload.totals_debit ?? 0,
    payload.totals_credit ?? 0,
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_journal_entries WHERE id=?').get(r.lastInsertRowid)
}

function accountingJournalEntryUpdate(id, patch = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const allowed = ['fecha','description','type','reference_doc_supabase_id','status','posted_by_user_id',
    'period_year','period_month','totals_debit','totals_credit','accounting_client_supabase_id']
  const sets = []; const vals = []
  for (const k of allowed) {
    if (k in patch) { sets.push(`${k}=?`); vals.push(patch[k]) }
  }
  if (!sets.length) return db.prepare('SELECT * FROM accounting_journal_entries WHERE id=?').get(id) || null
  sets.push('updated_at=?'); vals.push(_accNowIso())
  vals.push(id)
  db.prepare(`UPDATE accounting_journal_entries SET ${sets.join(', ')} WHERE id=?`).run(...vals)
  return db.prepare('SELECT * FROM accounting_journal_entries WHERE id=?').get(id) || null
}

function accountingJournalEntryList({ businessId, accountingClientId, periodYear, periodMonth, status } = {}) {
  if (!db) return []
  const conds = []; const params = []
  if (businessId)         { conds.push('business_id=?');          params.push(businessId) }
  if (accountingClientId) { conds.push('accounting_client_id=?'); params.push(accountingClientId) }
  if (periodYear  != null){ conds.push('period_year=?');          params.push(periodYear) }
  if (periodMonth != null){ conds.push('period_month=?');         params.push(periodMonth) }
  if (status)             { conds.push('status=?');               params.push(status) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_journal_entries ${where}
    ORDER BY fecha DESC, id DESC LIMIT 1000`).all(...params)
}

function accountingJournalEntryGet(id) {
  if (!db) return null
  const e = db.prepare('SELECT * FROM accounting_journal_entries WHERE id=?').get(id) || null
  if (e) {
    e.lines = db.prepare(`SELECT * FROM accounting_journal_lines
      WHERE journal_entry_id=? ORDER BY id ASC`).all(id)
  }
  return e
}

function accountingJournalEntryDelete(id) {
  if (!db) throw new Error('Base de datos no disponible')
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM accounting_journal_lines WHERE journal_entry_id=?').run(id)
    db.prepare('DELETE FROM accounting_journal_entries WHERE id=?').run(id)
  })
  tx()
  return { id }
}

function accountingJournalLineAdd(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const now = _accNowIso()
  const entrySid = payload.journal_entry_supabase_id || _resolveJournalEntrySupabaseId(payload.journal_entry_id)
  const acctSid  = payload.account_supabase_id || _resolveAccountSupabaseId(payload.account_id)
  const r = db.prepare(`INSERT INTO accounting_journal_lines
    (supabase_id, business_id, journal_entry_id, journal_entry_supabase_id, account_id,
     account_supabase_id, debit, credit, currency, exchange_rate, memo, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.journal_entry_id ?? null,
    entrySid,
    payload.account_id ?? null,
    acctSid,
    payload.debit ?? 0,
    payload.credit ?? 0,
    payload.currency || 'DOP',
    payload.exchange_rate ?? 1,
    payload.memo || null,
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_journal_lines WHERE id=?').get(r.lastInsertRowid)
}

function accountingJournalLineList({ businessId, journalEntryId, accountId } = {}) {
  if (!db) return []
  const conds = []; const params = []
  if (businessId)     { conds.push('business_id=?');      params.push(businessId) }
  if (journalEntryId) { conds.push('journal_entry_id=?'); params.push(journalEntryId) }
  if (accountId)      { conds.push('account_id=?');       params.push(accountId) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_journal_lines ${where} ORDER BY id ASC`).all(...params)
}

function accountingJournalLineDelete(id) {
  if (!db) throw new Error('Base de datos no disponible')
  db.prepare('DELETE FROM accounting_journal_lines WHERE id=?').run(id)
  return { id }
}

// ── accounting_coa_auto_post_rules ───────────────────────────────────────────
function accountingAutoPostRuleCreate(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  if (!payload.event) throw new Error('event requerido')
  const now = _accNowIso()
  const cliSid    = payload.accounting_client_supabase_id || _resolveClientSupabaseId(payload.accounting_client_id)
  const debitSid  = payload.debit_account_supabase_id  || _resolveAccountSupabaseId(payload.debit_account_id)
  const creditSid = payload.credit_account_supabase_id || _resolveAccountSupabaseId(payload.credit_account_id)
  const r = db.prepare(`INSERT INTO accounting_coa_auto_post_rules
    (supabase_id, business_id, accounting_client_id, accounting_client_supabase_id, event,
     condition_json, debit_account_id, debit_account_supabase_id, credit_account_id,
     credit_account_supabase_id, priority, active, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.accounting_client_id ?? null,
    cliSid,
    payload.event,
    typeof payload.condition_json === 'string' ? payload.condition_json : (payload.condition_json ? JSON.stringify(payload.condition_json) : null),
    payload.debit_account_id ?? null,
    debitSid,
    payload.credit_account_id ?? null,
    creditSid,
    payload.priority ?? 100,
    payload.active === false ? 0 : 1,
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_coa_auto_post_rules WHERE id=?').get(r.lastInsertRowid)
}

function accountingAutoPostRuleUpdate(id, patch = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const allowed = ['event','condition_json','debit_account_id','debit_account_supabase_id',
    'credit_account_id','credit_account_supabase_id','priority','active','accounting_client_supabase_id']
  const sets = []; const vals = []
  for (const k of allowed) {
    if (k in patch) {
      let v = patch[k]
      if (k === 'active') v = v ? 1 : 0
      if (k === 'condition_json' && typeof v !== 'string') v = v ? JSON.stringify(v) : null
      sets.push(`${k}=?`); vals.push(v)
    }
  }
  if (!sets.length) return db.prepare('SELECT * FROM accounting_coa_auto_post_rules WHERE id=?').get(id) || null
  sets.push('updated_at=?'); vals.push(_accNowIso())
  vals.push(id)
  db.prepare(`UPDATE accounting_coa_auto_post_rules SET ${sets.join(', ')} WHERE id=?`).run(...vals)
  return db.prepare('SELECT * FROM accounting_coa_auto_post_rules WHERE id=?').get(id) || null
}

function accountingAutoPostRuleList({ businessId, accountingClientId, event } = {}) {
  if (!db) return []
  const conds = []; const params = []
  if (businessId)         { conds.push('business_id=?');          params.push(businessId) }
  if (accountingClientId) { conds.push('accounting_client_id=?'); params.push(accountingClientId) }
  if (event)              { conds.push('event=?');                params.push(event) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_coa_auto_post_rules ${where}
    ORDER BY priority ASC, id ASC`).all(...params)
}

function accountingAutoPostRuleDelete(id) {
  if (!db) throw new Error('Base de datos no disponible')
  db.prepare('DELETE FROM accounting_coa_auto_post_rules WHERE id=?').run(id)
  return { id }
}

// ── accounting_bank_accounts ─────────────────────────────────────────────────
function accountingBankAccountCreate(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const now = _accNowIso()
  const cliSid = payload.accounting_client_supabase_id || _resolveClientSupabaseId(payload.accounting_client_id)
  const r = db.prepare(`INSERT INTO accounting_bank_accounts
    (supabase_id, business_id, accounting_client_id, accounting_client_supabase_id, banco,
     account_no_last4, account_type, currency, opening_balance, active, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.accounting_client_id ?? null,
    cliSid,
    payload.banco || 'otro',
    payload.account_no_last4 || null,
    payload.account_type || 'checking',
    payload.currency || 'DOP',
    payload.opening_balance ?? 0,
    payload.active === false ? 0 : 1,
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_bank_accounts WHERE id=?').get(r.lastInsertRowid)
}

function accountingBankAccountUpdate(id, patch = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const allowed = ['banco','account_no_last4','account_type','currency','opening_balance','active',
    'accounting_client_supabase_id']
  const sets = []; const vals = []
  for (const k of allowed) {
    if (k in patch) {
      sets.push(`${k}=?`); vals.push(k === 'active' ? (patch[k] ? 1 : 0) : patch[k])
    }
  }
  if (!sets.length) return db.prepare('SELECT * FROM accounting_bank_accounts WHERE id=?').get(id) || null
  sets.push('updated_at=?'); vals.push(_accNowIso())
  vals.push(id)
  db.prepare(`UPDATE accounting_bank_accounts SET ${sets.join(', ')} WHERE id=?`).run(...vals)
  return db.prepare('SELECT * FROM accounting_bank_accounts WHERE id=?').get(id) || null
}

function accountingBankAccountList({ businessId, accountingClientId } = {}) {
  if (!db) return []
  const conds = []; const params = []
  if (businessId)         { conds.push('business_id=?');          params.push(businessId) }
  if (accountingClientId) { conds.push('accounting_client_id=?'); params.push(accountingClientId) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_bank_accounts ${where} ORDER BY banco ASC, id ASC`).all(...params)
}

function accountingBankAccountDelete(id) {
  if (!db) throw new Error('Base de datos no disponible')
  db.prepare('DELETE FROM accounting_bank_accounts WHERE id=?').run(id)
  return { id }
}

// ── accounting_bank_statement_lines ──────────────────────────────────────────
function accountingBankStatementLineAdd(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const now = _accNowIso()
  const baSid = payload.bank_account_supabase_id || _resolveBankAccountSupabaseId(payload.bank_account_id)
  const r = db.prepare(`INSERT INTO accounting_bank_statement_lines
    (supabase_id, business_id, bank_account_id, bank_account_supabase_id, fecha, descripcion,
     referencia, debit, credit, balance, matched_journal_line_id, matched_journal_line_supabase_id,
     match_status, raw_row, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.bank_account_id ?? null,
    baSid,
    payload.fecha || null,
    payload.descripcion || null,
    payload.referencia || null,
    payload.debit ?? 0,
    payload.credit ?? 0,
    payload.balance ?? null,
    payload.matched_journal_line_id ?? null,
    payload.matched_journal_line_supabase_id || null,
    payload.match_status || 'unmatched',
    typeof payload.raw_row === 'string' ? payload.raw_row : (payload.raw_row ? JSON.stringify(payload.raw_row) : null),
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_bank_statement_lines WHERE id=?').get(r.lastInsertRowid)
}

function accountingBankStatementLineUpdate(id, patch = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const allowed = ['fecha','descripcion','referencia','debit','credit','balance',
    'matched_journal_line_id','matched_journal_line_supabase_id','match_status','raw_row',
    'bank_account_supabase_id']
  const sets = []; const vals = []
  for (const k of allowed) {
    if (k in patch) {
      let v = patch[k]
      if (k === 'raw_row' && typeof v !== 'string') v = v ? JSON.stringify(v) : null
      sets.push(`${k}=?`); vals.push(v)
    }
  }
  if (!sets.length) return db.prepare('SELECT * FROM accounting_bank_statement_lines WHERE id=?').get(id) || null
  sets.push('updated_at=?'); vals.push(_accNowIso())
  vals.push(id)
  db.prepare(`UPDATE accounting_bank_statement_lines SET ${sets.join(', ')} WHERE id=?`).run(...vals)
  return db.prepare('SELECT * FROM accounting_bank_statement_lines WHERE id=?').get(id) || null
}

function accountingBankStatementLineList({ businessId, bankAccountId, matchStatus } = {}) {
  if (!db) return []
  const conds = []; const params = []
  if (businessId)    { conds.push('business_id=?');     params.push(businessId) }
  if (bankAccountId) { conds.push('bank_account_id=?'); params.push(bankAccountId) }
  if (matchStatus)   { conds.push('match_status=?');    params.push(matchStatus) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_bank_statement_lines ${where}
    ORDER BY fecha ASC, id ASC LIMIT 5000`).all(...params)
}

function accountingBankStatementLineDelete(id) {
  if (!db) throw new Error('Base de datos no disponible')
  db.prepare('DELETE FROM accounting_bank_statement_lines WHERE id=?').run(id)
  return { id }
}

// ── accounting_fixed_assets ──────────────────────────────────────────────────
function accountingFixedAssetCreate(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const now = _accNowIso()
  const cliSid = payload.accounting_client_supabase_id || _resolveClientSupabaseId(payload.accounting_client_id)
  const r = db.prepare(`INSERT INTO accounting_fixed_assets
    (supabase_id, business_id, accounting_client_id, accounting_client_supabase_id, name,
     categoria, fecha_adquisicion, costo, vida_util_meses, valor_residual, depreciacion_acumulada,
     status, sold_at, sold_amount, notes, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.accounting_client_id ?? null,
    cliSid,
    payload.name || '',
    payload.categoria || 'cat_2',
    payload.fecha_adquisicion || null,
    payload.costo ?? 0,
    payload.vida_util_meses ?? 0,
    payload.valor_residual ?? 0,
    payload.depreciacion_acumulada ?? 0,
    payload.status || 'active',
    payload.sold_at || null,
    payload.sold_amount ?? null,
    payload.notes || null,
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_fixed_assets WHERE id=?').get(r.lastInsertRowid)
}

function accountingFixedAssetUpdate(id, patch = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const allowed = ['name','categoria','fecha_adquisicion','costo','vida_util_meses','valor_residual',
    'depreciacion_acumulada','status','sold_at','sold_amount','notes','accounting_client_supabase_id']
  const sets = []; const vals = []
  for (const k of allowed) {
    if (k in patch) { sets.push(`${k}=?`); vals.push(patch[k]) }
  }
  if (!sets.length) return db.prepare('SELECT * FROM accounting_fixed_assets WHERE id=?').get(id) || null
  sets.push('updated_at=?'); vals.push(_accNowIso())
  vals.push(id)
  db.prepare(`UPDATE accounting_fixed_assets SET ${sets.join(', ')} WHERE id=?`).run(...vals)
  return db.prepare('SELECT * FROM accounting_fixed_assets WHERE id=?').get(id) || null
}

function accountingFixedAssetList({ businessId, accountingClientId, status } = {}) {
  if (!db) return []
  const conds = []; const params = []
  if (businessId)         { conds.push('business_id=?');          params.push(businessId) }
  if (accountingClientId) { conds.push('accounting_client_id=?'); params.push(accountingClientId) }
  if (status)             { conds.push('status=?');               params.push(status) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_fixed_assets ${where} ORDER BY fecha_adquisicion DESC, id DESC`).all(...params)
}

function accountingFixedAssetDelete(id) {
  if (!db) throw new Error('Base de datos no disponible')
  db.prepare('DELETE FROM accounting_fixed_assets WHERE id=?').run(id)
  return { id }
}

// ── accounting_retentions_emitidas ───────────────────────────────────────────
function accountingRetentionEmitidaCreate(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const now = _accNowIso()
  const cliSid = payload.accounting_client_supabase_id || _resolveClientSupabaseId(payload.accounting_client_id)
  const r = db.prepare(`INSERT INTO accounting_retentions_emitidas
    (supabase_id, business_id, accounting_client_id, accounting_client_supabase_id, fecha,
     beneficiario_rnc, beneficiario_nombre, tipo, base, tasa, retencion, ncf_emitido,
     comprobante_url, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.accounting_client_id ?? null,
    cliSid,
    payload.fecha || null,
    payload.beneficiario_rnc || null,
    payload.beneficiario_nombre || null,
    payload.tipo || 'servicios_no_dom',
    payload.base ?? 0,
    payload.tasa ?? 0,
    payload.retencion ?? 0,
    payload.ncf_emitido || null,
    payload.comprobante_url || null,
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_retentions_emitidas WHERE id=?').get(r.lastInsertRowid)
}

function accountingRetentionEmitidaUpdate(id, patch = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const allowed = ['fecha','beneficiario_rnc','beneficiario_nombre','tipo','base','tasa','retencion',
    'ncf_emitido','comprobante_url','accounting_client_supabase_id']
  const sets = []; const vals = []
  for (const k of allowed) {
    if (k in patch) { sets.push(`${k}=?`); vals.push(patch[k]) }
  }
  if (!sets.length) return db.prepare('SELECT * FROM accounting_retentions_emitidas WHERE id=?').get(id) || null
  sets.push('updated_at=?'); vals.push(_accNowIso())
  vals.push(id)
  db.prepare(`UPDATE accounting_retentions_emitidas SET ${sets.join(', ')} WHERE id=?`).run(...vals)
  return db.prepare('SELECT * FROM accounting_retentions_emitidas WHERE id=?').get(id) || null
}

function accountingRetentionEmitidaList({ businessId, accountingClientId, dateFrom, dateTo } = {}) {
  if (!db) return []
  const conds = []; const params = []
  if (businessId)         { conds.push('business_id=?');          params.push(businessId) }
  if (accountingClientId) { conds.push('accounting_client_id=?'); params.push(accountingClientId) }
  if (dateFrom)           { conds.push('fecha >= ?');             params.push(dateFrom) }
  if (dateTo)             { conds.push('fecha <= ?');             params.push(dateTo) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_retentions_emitidas ${where} ORDER BY fecha DESC, id DESC`).all(...params)
}

function accountingRetentionEmitidaDelete(id) {
  if (!db) throw new Error('Base de datos no disponible')
  db.prepare('DELETE FROM accounting_retentions_emitidas WHERE id=?').run(id)
  return { id }
}

// ── accounting_retentions_recibidas ──────────────────────────────────────────
function accountingRetentionRecibidaCreate(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const now = _accNowIso()
  const cliSid = payload.accounting_client_supabase_id || _resolveClientSupabaseId(payload.accounting_client_id)
  const r = db.prepare(`INSERT INTO accounting_retentions_recibidas
    (supabase_id, business_id, accounting_client_id, accounting_client_supabase_id, fecha,
     retenedor_rnc, retenedor_nombre, tipo, base, tasa, retencion, comprobante_url,
     created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.accounting_client_id ?? null,
    cliSid,
    payload.fecha || null,
    payload.retenedor_rnc || null,
    payload.retenedor_nombre || null,
    payload.tipo || null,
    payload.base ?? 0,
    payload.tasa ?? 0,
    payload.retencion ?? 0,
    payload.comprobante_url || null,
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_retentions_recibidas WHERE id=?').get(r.lastInsertRowid)
}

function accountingRetentionRecibidaUpdate(id, patch = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const allowed = ['fecha','retenedor_rnc','retenedor_nombre','tipo','base','tasa','retencion',
    'comprobante_url','accounting_client_supabase_id']
  const sets = []; const vals = []
  for (const k of allowed) {
    if (k in patch) { sets.push(`${k}=?`); vals.push(patch[k]) }
  }
  if (!sets.length) return db.prepare('SELECT * FROM accounting_retentions_recibidas WHERE id=?').get(id) || null
  sets.push('updated_at=?'); vals.push(_accNowIso())
  vals.push(id)
  db.prepare(`UPDATE accounting_retentions_recibidas SET ${sets.join(', ')} WHERE id=?`).run(...vals)
  return db.prepare('SELECT * FROM accounting_retentions_recibidas WHERE id=?').get(id) || null
}

function accountingRetentionRecibidaList({ businessId, accountingClientId, dateFrom, dateTo } = {}) {
  if (!db) return []
  const conds = []; const params = []
  if (businessId)         { conds.push('business_id=?');          params.push(businessId) }
  if (accountingClientId) { conds.push('accounting_client_id=?'); params.push(accountingClientId) }
  if (dateFrom)           { conds.push('fecha >= ?');             params.push(dateFrom) }
  if (dateTo)             { conds.push('fecha <= ?');             params.push(dateTo) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_retentions_recibidas ${where} ORDER BY fecha DESC, id DESC`).all(...params)
}

function accountingRetentionRecibidaDelete(id) {
  if (!db) throw new Error('Base de datos no disponible')
  db.prepare('DELETE FROM accounting_retentions_recibidas WHERE id=?').run(id)
  return { id }
}

// ── accounting_payroll_periods + payroll_lines ───────────────────────────────
function accountingPayrollPeriodCreate(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  if (payload.year == null || payload.month == null) throw new Error('year y month requeridos')
  const now = _accNowIso()
  const cliSid = payload.accounting_client_supabase_id || _resolveClientSupabaseId(payload.accounting_client_id)
  const r = db.prepare(`INSERT INTO accounting_payroll_periods
    (supabase_id, business_id, accounting_client_id, accounting_client_supabase_id, year, month,
     status, totals_json, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.accounting_client_id ?? null,
    cliSid,
    payload.year,
    payload.month,
    payload.status || 'draft',
    typeof payload.totals_json === 'string' ? payload.totals_json : (payload.totals_json ? JSON.stringify(payload.totals_json) : null),
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_payroll_periods WHERE id=?').get(r.lastInsertRowid)
}

function accountingPayrollPeriodUpdate(id, patch = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const allowed = ['status','totals_json','accounting_client_supabase_id']
  const sets = []; const vals = []
  for (const k of allowed) {
    if (k in patch) {
      let v = patch[k]
      if (k === 'totals_json' && typeof v !== 'string') v = v ? JSON.stringify(v) : null
      sets.push(`${k}=?`); vals.push(v)
    }
  }
  if (!sets.length) return db.prepare('SELECT * FROM accounting_payroll_periods WHERE id=?').get(id) || null
  sets.push('updated_at=?'); vals.push(_accNowIso())
  vals.push(id)
  db.prepare(`UPDATE accounting_payroll_periods SET ${sets.join(', ')} WHERE id=?`).run(...vals)
  return db.prepare('SELECT * FROM accounting_payroll_periods WHERE id=?').get(id) || null
}

function accountingPayrollPeriodList({ businessId, accountingClientId, year, status } = {}) {
  if (!db) return []
  const conds = []; const params = []
  if (businessId)         { conds.push('business_id=?');          params.push(businessId) }
  if (accountingClientId) { conds.push('accounting_client_id=?'); params.push(accountingClientId) }
  if (year != null)       { conds.push('year=?');                 params.push(year) }
  if (status)             { conds.push('status=?');               params.push(status) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_payroll_periods ${where} ORDER BY year DESC, month DESC`).all(...params)
}

function accountingPayrollPeriodGet(id) {
  if (!db) return null
  const p = db.prepare('SELECT * FROM accounting_payroll_periods WHERE id=?').get(id) || null
  if (p) {
    p.lines = db.prepare(`SELECT * FROM accounting_payroll_lines
      WHERE payroll_period_id=? ORDER BY id ASC`).all(id)
  }
  return p
}

function accountingPayrollPeriodDelete(id) {
  if (!db) throw new Error('Base de datos no disponible')
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM accounting_payroll_lines WHERE payroll_period_id=?').run(id)
    db.prepare('DELETE FROM accounting_payroll_periods WHERE id=?').run(id)
  })
  tx()
  return { id }
}

function accountingPayrollLineAdd(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const now = _accNowIso()
  const periodSid = payload.payroll_period_supabase_id || _resolvePayrollPeriodSupabaseId(payload.payroll_period_id)
  const r = db.prepare(`INSERT INTO accounting_payroll_lines
    (supabase_id, business_id, payroll_period_id, payroll_period_supabase_id, employee_name,
     employee_cedula, employee_nss, salario_base, dependientes, afp, ars, sfs, riesgos_laborales,
     isr, otras_deducciones, neto, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.payroll_period_id ?? null,
    periodSid,
    payload.employee_name || null,
    payload.employee_cedula || null,
    payload.employee_nss || null,
    payload.salario_base ?? 0,
    payload.dependientes ?? 0,
    payload.afp ?? 0,
    payload.ars ?? 0,
    payload.sfs ?? 0,
    payload.riesgos_laborales ?? 0,
    payload.isr ?? 0,
    payload.otras_deducciones ?? 0,
    payload.neto ?? 0,
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_payroll_lines WHERE id=?').get(r.lastInsertRowid)
}

function accountingPayrollLineList({ businessId, payrollPeriodId } = {}) {
  if (!db) return []
  const conds = []; const params = []
  if (businessId)      { conds.push('business_id=?');       params.push(businessId) }
  if (payrollPeriodId) { conds.push('payroll_period_id=?'); params.push(payrollPeriodId) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_payroll_lines ${where} ORDER BY id ASC`).all(...params)
}

function accountingPayrollLineDelete(id) {
  if (!db) throw new Error('Base de datos no disponible')
  db.prepare('DELETE FROM accounting_payroll_lines WHERE id=?').run(id)
  return { id }
}

// ── accounting_tss_filings ───────────────────────────────────────────────────
function accountingTssFilingCreate(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  if (payload.year == null || payload.month == null) throw new Error('year y month requeridos')
  const now = _accNowIso()
  const cliSid = payload.accounting_client_supabase_id || _resolveClientSupabaseId(payload.accounting_client_id)
  const r = db.prepare(`INSERT INTO accounting_tss_filings
    (supabase_id, business_id, accounting_client_id, accounting_client_supabase_id, year, month,
     filename, file_supabase_id, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.accounting_client_id ?? null,
    cliSid,
    payload.year,
    payload.month,
    payload.filename || null,
    payload.file_supabase_id || null,
    payload.status || 'pendiente',
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_tss_filings WHERE id=?').get(r.lastInsertRowid)
}

function accountingTssFilingUpdate(id, patch = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const allowed = ['filename','file_supabase_id','status','accounting_client_supabase_id']
  const sets = []; const vals = []
  for (const k of allowed) {
    if (k in patch) { sets.push(`${k}=?`); vals.push(patch[k]) }
  }
  if (!sets.length) return db.prepare('SELECT * FROM accounting_tss_filings WHERE id=?').get(id) || null
  sets.push('updated_at=?'); vals.push(_accNowIso())
  vals.push(id)
  db.prepare(`UPDATE accounting_tss_filings SET ${sets.join(', ')} WHERE id=?`).run(...vals)
  return db.prepare('SELECT * FROM accounting_tss_filings WHERE id=?').get(id) || null
}

function accountingTssFilingList({ businessId, accountingClientId, year, status } = {}) {
  if (!db) return []
  const conds = []; const params = []
  if (businessId)         { conds.push('business_id=?');          params.push(businessId) }
  if (accountingClientId) { conds.push('accounting_client_id=?'); params.push(accountingClientId) }
  if (year != null)       { conds.push('year=?');                 params.push(year) }
  if (status)             { conds.push('status=?');               params.push(status) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_tss_filings ${where} ORDER BY year DESC, month DESC`).all(...params)
}

function accountingTssFilingDelete(id) {
  if (!db) throw new Error('Base de datos no disponible')
  db.prepare('DELETE FROM accounting_tss_filings WHERE id=?').run(id)
  return { id }
}

// ── accounting_tasks ─────────────────────────────────────────────────────────
function accountingTaskCreate(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const now = _accNowIso()
  const cliSid = payload.accounting_client_supabase_id || _resolveClientSupabaseId(payload.accounting_client_id)
  const r = db.prepare(`INSERT INTO accounting_tasks
    (supabase_id, business_id, accounting_client_id, accounting_client_supabase_id, title,
     description, assigned_to_user_id, status, priority, due_date, parent_obligation_supabase_id,
     created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.accounting_client_id ?? null,
    cliSid,
    payload.title || '',
    payload.description || null,
    payload.assigned_to_user_id ?? null,
    payload.status || 'pending',
    payload.priority || 'med',
    payload.due_date || null,
    payload.parent_obligation_supabase_id || null,
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_tasks WHERE id=?').get(r.lastInsertRowid)
}

function accountingTaskUpdate(id, patch = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const allowed = ['title','description','assigned_to_user_id','status','priority','due_date',
    'parent_obligation_supabase_id','accounting_client_supabase_id']
  const sets = []; const vals = []
  for (const k of allowed) {
    if (k in patch) { sets.push(`${k}=?`); vals.push(patch[k]) }
  }
  if (!sets.length) return db.prepare('SELECT * FROM accounting_tasks WHERE id=?').get(id) || null
  sets.push('updated_at=?'); vals.push(_accNowIso())
  vals.push(id)
  db.prepare(`UPDATE accounting_tasks SET ${sets.join(', ')} WHERE id=?`).run(...vals)
  return db.prepare('SELECT * FROM accounting_tasks WHERE id=?').get(id) || null
}

function accountingTaskList({ businessId, accountingClientId, status, assignedToUserId } = {}) {
  if (!db) return []
  const conds = []; const params = []
  if (businessId)         { conds.push('business_id=?');           params.push(businessId) }
  if (accountingClientId) { conds.push('accounting_client_id=?');  params.push(accountingClientId) }
  if (status)             { conds.push('status=?');                params.push(status) }
  if (assignedToUserId)   { conds.push('assigned_to_user_id=?');   params.push(assignedToUserId) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_tasks ${where} ORDER BY due_date ASC, priority DESC, id ASC`).all(...params)
}

function accountingTaskDelete(id) {
  if (!db) throw new Error('Base de datos no disponible')
  db.prepare('DELETE FROM accounting_tasks WHERE id=?').run(id)
  return { id }
}

// ── accounting_foreign_payments ──────────────────────────────────────────────
function accountingForeignPaymentCreate(payload = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const now = _accNowIso()
  const cliSid = payload.accounting_client_supabase_id || _resolveClientSupabaseId(payload.accounting_client_id)
  const r = db.prepare(`INSERT INTO accounting_foreign_payments
    (supabase_id, business_id, accounting_client_id, accounting_client_supabase_id, fecha,
     beneficiario_id, beneficiario_pais, beneficiario_nombre, tipo_renta, moneda,
     monto_moneda_pago, tasa_cambio, monto_local, isr_retenido, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    payload.supabase_id || _accUuid(),
    payload.business_id || null,
    payload.accounting_client_id ?? null,
    cliSid,
    payload.fecha || null,
    payload.beneficiario_id || null,
    payload.beneficiario_pais || null,
    payload.beneficiario_nombre || null,
    payload.tipo_renta || null,
    payload.moneda || 'USD',
    payload.monto_moneda_pago ?? 0,
    payload.tasa_cambio ?? 1,
    payload.monto_local ?? 0,
    payload.isr_retenido ?? 0,
    now, now,
  )
  return db.prepare('SELECT * FROM accounting_foreign_payments WHERE id=?').get(r.lastInsertRowid)
}

function accountingForeignPaymentUpdate(id, patch = {}) {
  if (!db) throw new Error('Base de datos no disponible')
  const allowed = ['fecha','beneficiario_id','beneficiario_pais','beneficiario_nombre','tipo_renta',
    'moneda','monto_moneda_pago','tasa_cambio','monto_local','isr_retenido','accounting_client_supabase_id']
  const sets = []; const vals = []
  for (const k of allowed) {
    if (k in patch) { sets.push(`${k}=?`); vals.push(patch[k]) }
  }
  if (!sets.length) return db.prepare('SELECT * FROM accounting_foreign_payments WHERE id=?').get(id) || null
  sets.push('updated_at=?'); vals.push(_accNowIso())
  vals.push(id)
  db.prepare(`UPDATE accounting_foreign_payments SET ${sets.join(', ')} WHERE id=?`).run(...vals)
  return db.prepare('SELECT * FROM accounting_foreign_payments WHERE id=?').get(id) || null
}

function accountingForeignPaymentList({ businessId, accountingClientId, dateFrom, dateTo } = {}) {
  if (!db) return []
  const conds = []; const params = []
  if (businessId)         { conds.push('business_id=?');          params.push(businessId) }
  if (accountingClientId) { conds.push('accounting_client_id=?'); params.push(accountingClientId) }
  if (dateFrom)           { conds.push('fecha >= ?');             params.push(dateFrom) }
  if (dateTo)             { conds.push('fecha <= ?');             params.push(dateTo) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM accounting_foreign_payments ${where} ORDER BY fecha DESC, id DESC`).all(...params)
}

function accountingForeignPaymentDelete(id) {
  if (!db) throw new Error('Base de datos no disponible')
  db.prepare('DELETE FROM accounting_foreign_payments WHERE id=?').run(id)
  return { id }
}

module.exports = {
  init, isReady, getError, rawPrepare, rawExec, closeDb, dbBackupTo,
  tombstoneAdd, tombstonesPending, tombstoneMarkSent, tombstoneMarkFailed,
  // Concesionario v2 / v2.5
  vehicleInventoryList, vehicleInventoryGetById, vehicleInventoryCreate, vehicleInventoryUpdate, vehicleInventorySetStatus, vehicleInventoryDelete,
  salesDealsList, salesDealsGetById, salesDealsCreate, salesDealsUpdate, salesDealsClose, salesDealsMarkCommissionPaid, salesDealsCommissionsForPeriod, salesDealsDelete,
  leadsList, leadsCreate, leadsUpdate, leadsSetStage, leadsLogContact, leadsOverdue, leadsDelete,
  testDrivesList, testDrivesCreate, testDrivesUpdate, testDrivesComplete, testDrivesSetOutcome, testDrivesDelete,
  vehicleDocumentsByVehicle, vehicleDocumentsExpiringSoon, vehicleDocumentsCreate, vehicleDocumentsDelete,
  vehicleTituloList, vehicleTituloByDeal, vehicleTituloUpsert, vehicleTituloDelete,
  vehicleReservationList, vehicleReservationsActive, vehicleReservationGetById, vehicleReservationUpsert, vehicleReservationRelease, vehicleReservationConvert, vehicleReservationsExpire,
  vehicleWarrantyList, vehicleWarrantyByDeal, vehicleWarrantyGetById, vehicleWarrantyUpsert, vehicleWarrantyAddClaim, vehicleWarrantyVoid, vehicleWarrantyExpiringSoon, vehicleWarrantiesExpire,
  bankPreapprovalList, bankPreapprovalActiveByClient, bankPreapprovalGetById, bankPreapprovalUpsert, bankPreapprovalSetStatus, bankPreapprovalsExpire,
  // Empresa
  configGet, configSet,
  empresaGet, empresaSave,
  // Settings
  settingsGet, settingsUpdate, getSetting, setSetting,
  isProductionLive, testDataCount, wipeTestData, goLiveCommit,
  // Auth
  authByPin, authLockoutStatus, usersGetAll, userCreate, userUpdate, userDelete, userDeleteHard,
  staffGenerateAuthCard, staffRevokeAuthCard, staffVerifyAuthToken,
  // Categorías de servicio
  categoriasGetAll, categoriaCreate, categoriaUpdate, categoriaDelete,
  // Services
  servicesGetAll, servicesGetAllAdmin, servicesTopSellers, serviceCreate, serviceUpdate, serviceDelete, serviceRefCount, serviceSetInStock,
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
  ticketsGetAll, ticketGetById, ticketCreate, ticketMarkPaid, ticketVoid, ticketGetByDateRange, ticketGetByDateRangeWithItems,
  ticketOpenForMesa, ticketAddItem, ticketUpdateItemQty, ticketRemoveItem, ticketGetActiveByMesa, ticketCloseWithPayment,
  // v2.16.3 H3 — Restaurante Mover/Juntar
  ticketTransferToMesa, ticketMerge,
  ticketGetActiveByMesaSupabaseId, ticketAppendItems,
  // v2.16.3 H4 — Restaurant front-of-house reservations
  reservationsList, reservationsCreate, reservationsUpdate,
  reservationsConfirm, reservationsCancel, reservationsMarkNoShow,
  reservationsSeat, reservationsStampWhatsapp,
  // v2.17 — Food Truck: favorite stops + waste log
  foodTruckLocationsList, foodTruckLocationsCreate, foodTruckLocationsUpdate, foodTruckLocationsDelete,
  wasteLogList, wasteLogCreate, wasteLogDelete,
  // Price changes
  ticketItemUpdatePrice, priceChangesGetByTicket, priceChangesGetAll,
  // Queue
  queueGetActive, queueUpdateStatus, queueDelete,
  // Commissions
  commissionsGetByWasher, commissionsGetByPeriod, commissionsMarkPaid, commissionsMarkPaidByPeriod, washerCommissionsByTicket,
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
  ncfSequenceDecrementIfLast, ncfSequenceRollback,
  anecfQueueCount, anecfQueueList, isECF,
  // e-CF submissions log
  ecfSubmissionAdd, ecfSubmissionUpdate, ecfSubmissionGetByTrackId, ecfSubmissionGetByTicket,
  ecfSubmissionGetByEncf, ecfSubmissionGetPending, ecfSubmissionGetAll,
  // Activity log (owner audit feed)
  setActiveUser, getActiveUser, activityLogRecord, activityLogList, activityLogSelfHeal, setActivityErrorSink, activityLogDrainFallback,
  // e-CF certificate rotation history (audit trail — append-only, synced)
  ecfCertHistoryInsert, ecfCertHistoryList,
  // Restaurant Mode — mesas / modificadores / kds / ticket-item modifier snapshots
  mesasGetAll, mesaCreate, mesaUpdate, mesaSetStatus, mesaRequestBill, mesaDelete,
  modificadoresGetAll, modificadoresGetAllAdmin, modificadorCreate, modificadorUpdate, modificadorDelete,
  modificadoresListForService, modificadorAttachToService, modificadorDetachFromService,
  // v2.16.3 — Restaurante: recetas (Bill-of-Materials per service)
  recipeItemsListForService, recipeItemsAdd, recipeItemsUpdate, recipeItemsRemove,
  // v2.16.x — Ofertas (product bundles)
  ofertasList, ofertasGet, ofertasUpsert, ofertasDelete,
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
  appointmentMarkNoShow,
  // Salon v2.16.1 — memberships, client balances, reminders
  salonMembershipList, salonMembershipCreate, salonMembershipUpdate, salonMembershipArchive,
  clientMembershipsByClient, clientMembershipPurchase, clientMembershipConsume, clientMembershipsExpiringSoon,
  appointmentReminderSchedule, appointmentRemindersPendingDue, appointmentRemindersRecent,
  appointmentReminderMarkSent, appointmentReminderMarkFailed, appointmentReminderScheduleForAppointment,
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
  // v2.16.0 — Taller Mecánico hardening
  aseguradoraCreate, aseguradoraUpdate, aseguradoraList, aseguradoraGetById, aseguradoraGetBySupabaseId, aseguradoraDelete,
  loanRenewalsList, loanRenewalCreate,
  supplierCreate, supplierUpdate, supplierList, supplierGetById, supplierDelete,
  partsOrderCreate, partsOrderUpdate, partsOrderMarkReceived, partsOrderListByWO, partsOrderListAwaiting, partsOrderFindByBarcode, partsOrderDelete,
  workOrderPhotoInsert, workOrderPhotoListByWO, workOrderPhotoListByVehicle, workOrderPhotoDelete,
  insuranceBatchCreate, insuranceBatchUpdate, insuranceBatchListByPeriod, insuranceBatchGet,
  workOrdersForInsuranceBatch, mechanicProductivityForPeriod, mechanicServiceRemindersDue,
  mechanicCommissionsByPeriod, mechanicCommissionsMarkPaid,
  // v2.16.3 — Carnicería hardening
  carniceriaCorteList, carniceriaCorteCreate, carniceriaCorteUpdate, carniceriaCorteDelete,
  carniceriaFreshnessList, carniceriaFreshnessCreate, carniceriaFreshnessApplyDiscount,
  carniceriaDiscardCreate, carniceriaDiscardList,
  carniceriaRecurringList, carniceriaRecurringCreate, carniceriaRecurringUpdate, carniceriaRecurringDelete, carniceriaRecurringMarkSent,
  carniceriaScalesList, carniceriaScalesCreate, carniceriaScalesUpdate, carniceriaScalesDelete, carniceriaScalesSetActiveDefault,
  carniceriaResumenGet,
  carniceriaActiveDiscounts,
  carniceriaEnqueueE33ForDiscard,
  // Phase 1B — Contabilidad firm-side suite
  accountingClientCreate, accountingClientUpdate, accountingClientList, accountingClientGet, accountingClientDelete,
  accountingInboxAdd, accountingInboxList, accountingInboxClassify, accountingInboxPost, accountingInboxDelete,
  accountingObligationGenerateYear, accountingObligationsList, accountingObligationMarkFiled,
  accountingDocumentAdd, accountingDocumentList, accountingDocumentDelete,
  accountingBillingPlanCreate, accountingBillingPlanUpdate, accountingBillingPlanList,
  accountingBillingInvoiceCreate, accountingBillingInvoiceMarkPaid, accountingBillingInvoiceList,
  accountingCsvMappingCreate, accountingCsvMappingList,
  // Phase 2 Slice 1 — Contabilidad full firm-side schema
  accountingCoaCreate, accountingCoaUpdate, accountingCoaList, accountingCoaGet, accountingCoaDelete,
  accountingJournalEntryCreate, accountingJournalEntryUpdate, accountingJournalEntryList, accountingJournalEntryGet, accountingJournalEntryDelete,
  accountingJournalLineAdd, accountingJournalLineList, accountingJournalLineDelete,
  accountingAutoPostRuleCreate, accountingAutoPostRuleUpdate, accountingAutoPostRuleList, accountingAutoPostRuleDelete,
  accountingBankAccountCreate, accountingBankAccountUpdate, accountingBankAccountList, accountingBankAccountDelete,
  accountingBankStatementLineAdd, accountingBankStatementLineUpdate, accountingBankStatementLineList, accountingBankStatementLineDelete,
  accountingFixedAssetCreate, accountingFixedAssetUpdate, accountingFixedAssetList, accountingFixedAssetDelete,
  accountingRetentionEmitidaCreate, accountingRetentionEmitidaUpdate, accountingRetentionEmitidaList, accountingRetentionEmitidaDelete,
  accountingRetentionRecibidaCreate, accountingRetentionRecibidaUpdate, accountingRetentionRecibidaList, accountingRetentionRecibidaDelete,
  accountingPayrollPeriodCreate, accountingPayrollPeriodUpdate, accountingPayrollPeriodList, accountingPayrollPeriodGet, accountingPayrollPeriodDelete,
  accountingPayrollLineAdd, accountingPayrollLineList, accountingPayrollLineDelete,
  accountingTssFilingCreate, accountingTssFilingUpdate, accountingTssFilingList, accountingTssFilingDelete,
  accountingTaskCreate, accountingTaskUpdate, accountingTaskList, accountingTaskDelete,
  accountingForeignPaymentCreate, accountingForeignPaymentUpdate, accountingForeignPaymentList, accountingForeignPaymentDelete,
}

// ── v2.16.3 — Carnicería data helpers ───────────────────────────────────────
function _hydrateCorte(r) {
  if (!r) return r
  if (r.nutrition_json && typeof r.nutrition_json === 'string') {
    try { r.nutrition_json = JSON.parse(r.nutrition_json) } catch {}
  }
  return r
}
function _hydrateRecurring(r) {
  if (!r) return r
  if (r.items_json && typeof r.items_json === 'string') {
    try { r.items_json = JSON.parse(r.items_json) } catch { r.items_json = [] }
  }
  return r
}

function carniceriaCorteList() {
  if (!db) return []
  const biz = _bizId()
  const rows = db.prepare(`SELECT * FROM carniceria_corte_categories
    WHERE active=1 AND (business_id=? OR business_id IS NULL)
    ORDER BY sort_order, especie, nombre`).all(biz)
  return rows.map(_hydrateCorte)
}
function carniceriaCorteCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO carniceria_corte_categories
    (supabase_id, business_id, nombre, nombre_dr_popular, tooltip_traduccion, especie, photo_url, nutrition_json, sort_order, active)
    VALUES (@sid, @biz, @nombre, @drp, @tt, @esp, @photo, @nut, @sort, 1)`).run({
      sid, biz: _bizId(),
      nombre: data.nombre || '',
      drp: data.nombre_dr_popular || null,
      tt: data.tooltip_traduccion || null,
      esp: data.especie || 'otros',
      photo: data.photo_url || null,
      nut: data.nutrition_json ? (typeof data.nutrition_json === 'string' ? data.nutrition_json : JSON.stringify(data.nutrition_json)) : null,
      sort: data.sort_order || 0,
    })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function carniceriaCorteUpdate(data) {
  if (!db || !data?.id) return null
  const allowed = ['nombre','nombre_dr_popular','tooltip_traduccion','especie','photo_url','nutrition_json','sort_order','active']
  const patch = {}
  for (const k of allowed) if (k in data) patch[k] = k === 'nutrition_json' && data[k] && typeof data[k] !== 'string' ? JSON.stringify(data[k]) : data[k]
  if (!Object.keys(patch).length) return null
  const set = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE carniceria_corte_categories SET ${set} WHERE id=@id`).run({ ...patch, id: data.id })
  return _hydrateCorte(db.prepare('SELECT * FROM carniceria_corte_categories WHERE id=?').get(data.id))
}
function carniceriaCorteDelete(id) {
  if (!db) return
  const row = db.prepare('SELECT supabase_id, business_id FROM carniceria_corte_categories WHERE id=?').get(id)
  db.prepare(`UPDATE carniceria_corte_categories SET active=0, updated_at=datetime('now') WHERE id=?`).run(id)
  if (row?.supabase_id) tombstoneAdd('carniceria_corte_categories', row.supabase_id, row.business_id)
}

function carniceriaFreshnessList() {
  if (!db) return []
  const biz = _bizId()
  return db.prepare(`SELECT f.*, i.name AS item_name
    FROM inventory_freshness_log f
    LEFT JOIN inventory_items i ON i.supabase_id = f.inventory_item_supabase_id
    WHERE (f.business_id=? OR f.business_id IS NULL) AND f.qty_remaining > 0
    ORDER BY f.expires_at ASC`).all(biz)
}
function carniceriaFreshnessCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO inventory_freshness_log
    (supabase_id, business_id, inventory_item_supabase_id, batch_lote, received_at, expires_at, qty_received, qty_remaining, unit, auto_discount_applied)
    VALUES (@sid, @biz, @item, @lote, @rec, @exp, @qty, @qty, @unit, 0)`).run({
      sid, biz: _bizId(),
      item: data.inventory_item_supabase_id,
      lote: data.batch_lote || null,
      rec: data.received_at, exp: data.expires_at,
      qty: Number(data.qty_received) || 0,
      unit: data.unit || 'lb',
    })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function carniceriaFreshnessApplyDiscount({ id, pct = 50 }) {
  if (!db || !id) return null
  const f = db.prepare('SELECT * FROM inventory_freshness_log WHERE id=?').get(id)
  if (!f) return null
  // Mark batch as auto-discounted; persist a promotions row tied to the item.
  db.prepare(`UPDATE inventory_freshness_log SET auto_discount_applied=1, updated_at=datetime('now') WHERE id=?`).run(id)
  const promoSid = crypto.randomUUID()
  db.prepare(`INSERT INTO promotions
    (supabase_id, business_id, name, tipo, discount_pct, start_date, end_date, season_key, banner_text, active)
    VALUES (@sid, @biz, @name, 'auto_50_vence', @pct, date('now'), @end, NULL, @banner, 1)`).run({
      sid: promoSid, biz: _bizId(),
      name: `Vence pronto -${pct}%`,
      pct, end: f.expires_at,
      banner: `Lote ${f.batch_lote || ''} -${pct}% por vencimiento`,
    })
  if (f.inventory_item_supabase_id) {
    db.prepare(`INSERT INTO promotion_items
      (supabase_id, promotion_supabase_id, item_type, item_supabase_id)
      VALUES (?, ?, 'inventory_item', ?)`).run(crypto.randomUUID(), promoSid, f.inventory_item_supabase_id)
  }
  return { ok: true }
}

function carniceriaDiscardCreate(data) {
  if (!db) return null
  // Caller may pre-mint a supabase_id so the photo's storage path matches
  // the eventual DB row. Falls back to a fresh UUID otherwise.
  const sid = data.supabase_id || crypto.randomUUID()
  const isPostSale = data.is_post_sale ? 1 : 0
  const r = db.prepare(`INSERT INTO inventory_discards
    (supabase_id, business_id, inventory_item_supabase_id, freshness_log_supabase_id, qty, unit, motivo, photo_url, empleado_supabase_id, is_post_sale, related_ticket_supabase_id)
    VALUES (@sid, @biz, @item, @flog, @qty, @unit, @motivo, @photo, @emp, @isPost, @relTicket)`).run({
      sid, biz: _bizId(),
      item: data.inventory_item_supabase_id,
      flog: data.freshness_log_supabase_id || null,
      qty: Number(data.qty) || 0,
      unit: data.unit || 'lb',
      motivo: data.motivo || '',
      photo: data.photo_url || null,
      emp: data.empleado_supabase_id || null,
      isPost: isPostSale,
      relTicket: data.related_ticket_supabase_id || null,
    })
  // Decrement freshness log qty_remaining if linked
  if (data.freshness_log_supabase_id) {
    db.prepare(`UPDATE inventory_freshness_log
      SET qty_remaining = MAX(0, qty_remaining - ?), updated_at=datetime('now')
      WHERE supabase_id=?`).run(Number(data.qty) || 0, data.freshness_log_supabase_id)
  }
  // Decrement actual stock so reports stay consistent.
  try {
    db.prepare(`UPDATE inventory_items
      SET quantity = MAX(0, quantity - ?), updated_at=datetime('now')
      WHERE supabase_id = ?`).run(Number(data.qty) || 0, data.inventory_item_supabase_id)
  } catch {}
  // v2.16.4 — post-venta merma triggers an E33 Nota de Crédito.
  let e33 = null
  if (isPostSale) {
    e33 = carniceriaEnqueueE33ForDiscard({
      inventory_item_supabase_id: data.inventory_item_supabase_id,
      qty: Number(data.qty) || 0,
      motivo: data.motivo || 'Merma post-venta',
      related_ticket_supabase_id: data.related_ticket_supabase_id || null,
    })
    if (e33?.encf) {
      db.prepare(`UPDATE inventory_discards SET e33_encf = ?, related_ticket_supabase_id = COALESCE(related_ticket_supabase_id, ?), updated_at = datetime('now')
                  WHERE supabase_id = ?`).run(e33.encf, e33.ticket_supabase_id, sid)
    }
  }
  // Audit trail
  try {
    activityLogRecord({
      event_type: isPostSale ? 'carniceria_discard_post_sale' : 'carniceria_discard_internal',
      severity: isPostSale ? 'warn' : 'info',
      target_type: 'inventory_item',
      target_name: data.inventory_item_supabase_id,
      amount: Number(data.qty) || 0,
      reason: data.motivo || null,
      metadata: { unit: data.unit || 'lb', e33_encf: e33?.encf || null },
    })
  } catch {}
  return { id: r.lastInsertRowid, supabase_id: sid, e33_enqueued: e33 || null }
}
function carniceriaDiscardList({ since } = {}) {
  if (!db) return []
  const biz = _bizId()
  const sinceClause = since ? ' AND created_at >= ?' : ''
  const params = since ? [biz, since] : [biz]
  return db.prepare(`SELECT * FROM inventory_discards
    WHERE (business_id=? OR business_id IS NULL)${sinceClause}
    ORDER BY created_at DESC`).all(...params)
}

function carniceriaRecurringList() {
  if (!db) return []
  const biz = _bizId()
  const rows = db.prepare(`SELECT * FROM recurring_orders
    WHERE active=1 AND (business_id=? OR business_id IS NULL)
    ORDER BY dia_semana, nombre`).all(biz)
  return rows.map(_hydrateRecurring)
}
function carniceriaRecurringCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO recurring_orders
    (supabase_id, business_id, client_supabase_id, nombre, dia_semana, items_json, total_estimado, whatsapp_confirmar, active)
    VALUES (@sid, @biz, @client, @nombre, @dia, @items, @total, @wa, 1)`).run({
      sid, biz: _bizId(),
      client: data.client_supabase_id || '',
      nombre: data.nombre || '',
      dia: data.dia_semana ?? null,
      items: typeof data.items_json === 'string' ? data.items_json : JSON.stringify(data.items_json || []),
      total: data.total_estimado != null ? Number(data.total_estimado) : null,
      wa: data.whatsapp_confirmar ? 1 : 0,
    })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function carniceriaRecurringUpdate(data) {
  if (!db || !data?.id) return null
  const allowed = ['client_supabase_id','nombre','dia_semana','items_json','total_estimado','whatsapp_confirmar','active']
  const patch = {}
  for (const k of allowed) {
    if (k in data) {
      patch[k] = k === 'items_json' && typeof data[k] !== 'string' ? JSON.stringify(data[k]) : data[k]
      if (k === 'whatsapp_confirmar' || k === 'active') patch[k] = data[k] ? 1 : 0
    }
  }
  if (!Object.keys(patch).length) return null
  const set = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE recurring_orders SET ${set} WHERE id=@id`).run({ ...patch, id: data.id })
  return _hydrateRecurring(db.prepare('SELECT * FROM recurring_orders WHERE id=?').get(data.id))
}
function carniceriaRecurringDelete(id) {
  if (!db) return
  const row = db.prepare('SELECT supabase_id, business_id FROM recurring_orders WHERE id=?').get(id)
  db.prepare(`UPDATE recurring_orders SET active=0, updated_at=datetime('now') WHERE id=?`).run(id)
  if (row?.supabase_id) tombstoneAdd('recurring_orders', row.supabase_id, row.business_id)
}
function carniceriaRecurringMarkSent({ id }) {
  if (!db || !id) return null
  db.prepare(`UPDATE recurring_orders SET last_sent_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(id)
  return { ok: true }
}

function carniceriaScalesList() {
  if (!db) return []
  const biz = _bizId()
  return db.prepare(`SELECT * FROM carniceria_scales
    WHERE active=1 AND (business_id=? OR business_id IS NULL)
    ORDER BY active_default DESC, nombre`).all(biz)
}
function carniceriaScalesCreate(data) {
  if (!db) return null
  const sid = crypto.randomUUID()
  const r = db.prepare(`INSERT INTO carniceria_scales
    (supabase_id, business_id, nombre, tipo, device_path, protocol, baud_rate, capacidad_max_lb, tare_default, active_default, active)
    VALUES (@sid, @biz, @nombre, @tipo, @path, @proto, @baud, @cap, @tare, @def, 1)`).run({
      sid, biz: _bizId(),
      nombre: data.nombre || '',
      tipo: data.tipo || 'plataforma',
      path: data.device_path || null,
      proto: data.protocol || 'generic',
      baud: data.baud_rate || 9600,
      cap: data.capacidad_max_lb != null ? Number(data.capacidad_max_lb) : null,
      tare: data.tare_default || 0,
      def: data.active_default ? 1 : 0,
    })
  return { id: r.lastInsertRowid, supabase_id: sid }
}
function carniceriaScalesUpdate(data) {
  if (!db || !data?.id) return null
  const allowed = ['nombre','tipo','device_path','protocol','baud_rate','capacidad_max_lb','tare_default','active_default','active']
  const patch = {}
  for (const k of allowed) if (k in data) {
    patch[k] = k === 'active_default' || k === 'active' ? (data[k] ? 1 : 0) : data[k]
  }
  if (!Object.keys(patch).length) return null
  const set = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
  db.prepare(`UPDATE carniceria_scales SET ${set} WHERE id=@id`).run({ ...patch, id: data.id })
  return db.prepare('SELECT * FROM carniceria_scales WHERE id=?').get(data.id)
}
function carniceriaScalesDelete(id) {
  if (!db) return
  const row = db.prepare('SELECT supabase_id, business_id FROM carniceria_scales WHERE id=?').get(id)
  db.prepare(`UPDATE carniceria_scales SET active=0, updated_at=datetime('now') WHERE id=?`).run(id)
  if (row?.supabase_id) tombstoneAdd('carniceria_scales', row.supabase_id, row.business_id)
}
function carniceriaScalesSetActiveDefault(id) {
  if (!db || !id) return null
  const biz = _bizId()
  const tx = db.transaction(() => {
    db.prepare(`UPDATE carniceria_scales SET active_default=0, updated_at=datetime('now')
      WHERE business_id=? OR business_id IS NULL`).run(biz)
    db.prepare(`UPDATE carniceria_scales SET active_default=1, updated_at=datetime('now') WHERE id=?`).run(id)
  })
  tx()
  return { ok: true }
}

// v2.16.4 — return active discounts (auto_50_vence + seasonal) per item.
// Input:  { item_supabase_ids: string[] }
// Output: { [item_supabase_id]: [{ source, pct, label, banner_text, season_key }] }
//
// Rules:
//   • auto_50_vence: a freshness_log row exists for the item with
//     auto_discount_applied=1 AND qty_remaining > 0 AND today ≤ expires_at.
//   • season:<key>:  a promotions row with active=1, today between
//     start_date/end_date, AND either (a) a promotion_items row pointing at
//     this inventory item OR (b) NO promotion_items rows at all (general
//     promo applies to the whole catalog).
function carniceriaActiveDiscounts({ item_supabase_ids } = {}) {
  if (!db) return {}
  const ids = Array.isArray(item_supabase_ids) ? item_supabase_ids.filter(Boolean) : []
  if (!ids.length) return {}
  const biz = _bizId()
  const out = {}
  for (const sid of ids) out[sid] = []

  // 1. auto_50_vence — derived from freshness rows
  try {
    const placeholders = ids.map(() => '?').join(',')
    const fresh = db.prepare(`
      SELECT inventory_item_supabase_id AS item_sid, expires_at, qty_remaining, batch_lote
      FROM inventory_freshness_log
      WHERE auto_discount_applied = 1
        AND qty_remaining > 0
        AND date(expires_at) >= date('now')
        AND inventory_item_supabase_id IN (${placeholders})
        AND (business_id = ? OR business_id IS NULL)
    `).all(...ids, biz)
    for (const f of fresh) {
      out[f.item_sid].push({
        source: 'auto_50_vence',
        pct: 50,
        label: `Lote ${f.batch_lote || 's/lote'} vence ${f.expires_at}`,
        banner_text: `−50 % por vencimiento`,
        season_key: null,
      })
    }
  } catch (e) {
    console.warn('[carniceriaActiveDiscounts] freshness query failed:', e?.message)
  }

  // 2. seasonal / item-targeted promotions
  try {
    const placeholders = ids.map(() => '?').join(',')
    const targeted = db.prepare(`
      SELECT pi.item_supabase_id AS item_sid,
             p.name, p.tipo, p.discount_pct, p.season_key, p.banner_text
      FROM promotion_items pi
      JOIN promotions p ON p.supabase_id = pi.promotion_supabase_id
      WHERE p.active = 1
        AND p.tipo = 'pct'
        AND date('now') BETWEEN date(p.start_date) AND date(p.end_date)
        AND pi.item_supabase_id IN (${placeholders})
        AND (p.business_id = ? OR p.business_id IS NULL)
    `).all(...ids, biz)
    for (const t of targeted) {
      out[t.item_sid].push({
        source: t.season_key ? `season:${t.season_key}` : `promo:${t.name}`,
        pct: Number(t.discount_pct) || 0,
        label: t.banner_text || t.name,
        banner_text: t.banner_text,
        season_key: t.season_key,
      })
    }

    // General promotions (NO promotion_items rows = applies to entire carnicería catalog).
    // Gated to season_key set so a blank promo can't accidentally discount everything.
    const general = db.prepare(`
      SELECT p.name, p.discount_pct, p.season_key, p.banner_text
      FROM promotions p
      WHERE p.active = 1
        AND p.tipo = 'pct'
        AND p.season_key IS NOT NULL
        AND date('now') BETWEEN date(p.start_date) AND date(p.end_date)
        AND (p.business_id = ? OR p.business_id IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM promotion_items pi WHERE pi.promotion_supabase_id = p.supabase_id
        )
    `).all(biz)
    if (general.length) {
      for (const sid of ids) {
        for (const g of general) {
          out[sid].push({
            source: `season:${g.season_key}`,
            pct: Number(g.discount_pct) || 0,
            label: g.banner_text || g.name,
            banner_text: g.banner_text,
            season_key: g.season_key,
          })
        }
      }
    }
  } catch (e) {
    console.warn('[carniceriaActiveDiscounts] promotions query failed:', e?.message)
  }

  return out
}

// v2.16.4 — Generate E33 NCC for a post-sale merma. Looks up the most-recent
// unvoided ticket carrying this inventory item (last 7 days), then enqueues
// an E33 in the standard ecf_queue (offline-first, 72h retry already wired).
// Returns { encf, ticket_supabase_id } when enqueued, null when no source ticket.
function carniceriaEnqueueE33ForDiscard({ inventory_item_supabase_id, qty, motivo, related_ticket_supabase_id } = {}) {
  if (!db || !inventory_item_supabase_id) return null
  const biz = _bizId()
  let ticket = null
  try {
    if (related_ticket_supabase_id) {
      ticket = db.prepare(`SELECT id, supabase_id, doc_number, ncf, comprobante_type, total
                           FROM tickets WHERE supabase_id = ? LIMIT 1`).get(related_ticket_supabase_id)
    }
    if (!ticket) {
      // Most-recent ticket within 7 days that carries this inventory item.
      ticket = db.prepare(`
        SELECT t.id, t.supabase_id, t.doc_number, t.ncf, t.comprobante_type, t.total
        FROM tickets t
        JOIN ticket_items ti ON ti.ticket_id = t.id
        WHERE ti.inventory_item_supabase_id = ?
          AND t.status NOT IN ('anulado','nula','voided')
          AND datetime(t.created_at) >= datetime('now', '-7 days')
        ORDER BY t.created_at DESC
        LIMIT 1
      `).get(inventory_item_supabase_id)
    }
    if (!ticket) return null
    // Reserve the next E33 NCF
    let nextEncf = null
    try {
      const seq = db.prepare(`SELECT id, prefix, current_number, limit_number, active, enabled
                              FROM ncf_sequences WHERE business_id = ? AND type = 'E33' LIMIT 1`).get(biz)
      if (seq && seq.active && seq.enabled && seq.current_number < (seq.limit_number || 1e12)) {
        const num = String(seq.current_number).padStart(10, '0')
        nextEncf = `${seq.prefix || 'E33'}${num}`
        db.prepare(`UPDATE ncf_sequences SET current_number = current_number + 1, updated_at = datetime('now')
                    WHERE id = ?`).run(seq.id)
      }
    } catch (e) {
      console.warn('[E33 enqueue] NCF reservation failed:', e?.message)
    }

    const sid = crypto.randomUUID()
    const body = JSON.stringify({
      tipo_ecf: 'E33',
      ncf_modificado: ticket.ncf || ticket.doc_number,
      tipo_ecf_modificado: ticket.comprobante_type || 'E32',
      razon_modificacion: motivo || 'Merma post-venta',
      codigo_modificacion: '2', // 2 = anulación parcial / devolución (DGII)
      original_total: Number(ticket.total) || 0,
      qty: Number(qty) || 0,
      inventory_item_supabase_id,
      reserved_encf: nextEncf,
      enqueued_at: new Date().toISOString(),
    })
    db.prepare(`INSERT INTO ecf_queue
      (supabase_id, business_id, ticket_supabase_id, encf, tipo_ecf, body_json, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'E33', ?, 'pending', 0, datetime('now'), datetime('now'))`).run(
        sid, biz, ticket.supabase_id, nextEncf, body
      )
    return { encf: nextEncf, ticket_supabase_id: ticket.supabase_id, queue_supabase_id: sid }
  } catch (e) {
    console.error('[carniceriaEnqueueE33ForDiscard] failed:', e?.message)
    return null
  }
}

function carniceriaResumenGet() {
  if (!db) return {}
  const biz = _bizId()
  const todayStart = new Date(); todayStart.setHours(0,0,0,0)
  const sinceIso = todayStart.toISOString()
  // Ventas hoy por corte (top 5)
  let ventas_por_corte = []
  try {
    ventas_por_corte = db.prepare(`
      SELECT ti.name AS label, SUM(ti.price * COALESCE(ti.quantity,1)) AS value
      FROM ticket_items ti
      JOIN tickets t ON t.id = ti.ticket_id
      WHERE t.created_at >= ? AND t.status != 'voided'
      GROUP BY ti.name ORDER BY value DESC LIMIT 5
    `).all(sinceIso) || []
  } catch {}
  // Top 5 mayoreo (clientes por venta hoy)
  let top_mayoreo = []
  try {
    top_mayoreo = db.prepare(`
      SELECT c.name AS client_name, SUM(t.total) AS total
      FROM tickets t JOIN clients c ON c.id = t.client_id
      WHERE t.created_at >= ? AND t.status != 'voided' AND t.client_id IS NOT NULL
      GROUP BY c.id ORDER BY total DESC LIMIT 5
    `).all(sinceIso) || []
  } catch {}
  // Lb vendidas hoy
  let lb_vendidas = 0
  try {
    const r = db.prepare(`
      SELECT COALESCE(SUM(ti.weight),0) AS lb
      FROM ticket_items ti JOIN tickets t ON t.id = ti.ticket_id
      WHERE t.created_at >= ? AND t.status != 'voided' AND ti.unit IN ('lb','LB')
    `).get(sinceIso)
    lb_vendidas = Number(r?.lb || 0)
  } catch {}
  // Margen por corte (price-cost) %
  let margen_por_corte = []
  try {
    margen_por_corte = db.prepare(`
      SELECT ti.name, SUM(ti.price - ti.cost) * 100.0 / NULLIF(SUM(ti.price), 0) AS margin_pct
      FROM ticket_items ti JOIN tickets t ON t.id = ti.ticket_id
      WHERE t.created_at >= ? AND t.status != 'voided'
      GROUP BY ti.name ORDER BY margin_pct DESC LIMIT 5
    `).all(sinceIso) || []
  } catch {}
  // Mermas (kg + % del inventario)
  let mermas = { kg: 0, pct: 0 }
  try {
    const d = db.prepare(`
      SELECT COALESCE(SUM(qty),0) AS qty FROM inventory_discards
      WHERE created_at >= ?
    `).get(sinceIso)
    const stk = db.prepare(`
      SELECT COALESCE(SUM(quantity),0) AS qty FROM inventory_items WHERE active=1
    `).get()
    const dQty = Number(d?.qty || 0)
    const sQty = Number(stk?.qty || 1)
    mermas = {
      kg: dQty * 0.453592, // assume lb → kg conversion
      pct: sQty > 0 ? (dQty / sQty) * 100 : 0,
    }
  } catch {}
  return { ventas_por_corte, top_mayoreo, lb_vendidas, margen_por_corte, mermas, biz }
}
