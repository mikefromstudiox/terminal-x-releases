// One-off local wipe (rev 2026-04-24). Deletes tickets + clients + ticket
// deps on the local SQLite so the next sync tick doesn't re-push rows we
// already deleted on Supabase. PRESERVES commission rows by nulling their
// ticket FKs first.
//
// Run from the Terminal X repo on the target PC:
//   node scripts/wipe-local-tickets.cjs
//
// The DB is SQLCipher-encrypted. The key is derived the same way
// electron/key-vault.js derives it; we defer to that module.
//
// Override the DB path: set TX_DB_PATH=<full-path> in the env.

const path = require('path')
const os = require('os')
const fs = require('fs')

let Database
try { Database = require('better-sqlite3-multiple-ciphers') }
catch { Database = require('better-sqlite3') }

const userData = process.env.USERDATA_DIR ||
  path.join(os.homedir(), 'AppData', 'Roaming', 'Terminal X')
const dbPath = process.env.TX_DB_PATH || path.join(userData, 'terminal-x.db')

if (!fs.existsSync(dbPath)) {
  console.error('DB not found at', dbPath)
  console.error('Set TX_DB_PATH=<path> to override.')
  process.exit(1)
}
console.log('DB:', dbPath)

const db = new Database(dbPath)

// Try to derive the SQLCipher key the same way Terminal X does.
let keyHex = process.argv[2] || null
if (!keyHex) {
  try {
    const keyVault = require('../electron/key-vault')
    if (typeof keyVault.getDerivedKeyHex === 'function') {
      keyHex = keyVault.getDerivedKeyHex()
    } else if (typeof keyVault.getKeyHex === 'function') {
      keyHex = keyVault.getKeyHex()
    }
  } catch (e) {
    console.warn('key-vault:', e.message)
  }
}
if (keyHex) {
  try {
    db.pragma(`key = "x'${keyHex}'"`)
    db.pragma('cipher_page_size = 4096')
  } catch (e) { console.warn('cipher pragma:', e.message) }
}

// Smoke-read. If this throws, the key is wrong or the DB is corrupt.
try { db.prepare('SELECT COUNT(*) FROM sqlite_master').get() }
catch (e) {
  console.error('Cannot read DB:', e.message)
  console.error('If SQLCipher-encrypted and key-vault auto-derive failed,')
  console.error('pass the 64-char hex key as the first arg:')
  console.error('  node scripts/wipe-local-tickets.cjs <HEX_KEY>')
  process.exit(1)
}

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = OFF')

const tx = db.transaction(() => {
  // 1. Detach commissions from deleted tickets. DO NOT delete the rows —
  //    owner has manual entries that must survive.
  for (const t of ['washer_commissions', 'seller_commissions', 'cajero_commissions']) {
    try {
      const r = db.prepare(
        `UPDATE ${t} SET ticket_id = NULL, ticket_supabase_id = NULL
          WHERE ticket_id IS NOT NULL OR ticket_supabase_id IS NOT NULL`
      ).run()
      console.log(`  ${t}: detached ${r.changes} rows`)
    } catch (e) { console.warn(`  ${t}: ${e.message}`) }
  }

  // 2. Delete ticket-dependent rows.
  for (const tbl of [
    'ticket_items', 'queue', 'ecf_queue', 'credit_payments',
    'inventory_oversells', 'inventory_transactions', 'price_changes',
    'queue_deletions', 'payment_parts', 'ticket_locks',
  ]) {
    try {
      const r = db.prepare(`DELETE FROM ${tbl}`).run()
      console.log(`  ${tbl}: deleted ${r.changes} rows`)
    } catch (e) {
      if (!/no such table/i.test(e.message)) console.warn(`  ${tbl}: ${e.message}`)
    }
  }

  // 3. Delete tickets + clients.
  for (const tbl of ['tickets', 'clients']) {
    try {
      const r = db.prepare(`DELETE FROM ${tbl}`).run()
      console.log(`  ${tbl}: deleted ${r.changes} rows`)
    } catch (e) { console.warn(`  ${tbl}: ${e.message}`) }
  }

  // 4. Reset NCF + doc-number sequences so next ticket starts at #1.
  try {
    const r = db.prepare('UPDATE ncf_sequences SET current_number = 0').run()
    console.log(`  ncf_sequences: reset ${r.changes} rows`)
  } catch (e) { console.warn('  ncf_sequences:', e.message) }
  try { db.prepare('DELETE FROM doc_number_blocks').run() } catch {}
  try { db.prepare('DELETE FROM ncf_blocks').run() } catch {}

  // 5. Reset PUSH cursors for ticket/client tables so sync.js doesn't try
  //    to re-push rows that no longer exist. Leave PULL cursors alone.
  try {
    const r = db.prepare(`DELETE FROM sync_log WHERE table_name IN
      ('tickets','ticket_items','clients','queue','ecf_queue',
       'credit_payments','inventory_oversells','inventory_transactions',
       'price_changes','queue_deletions')`).run()
    console.log(`  sync_log: cleared ${r.changes} cursors`)
  } catch (e) { console.warn('  sync_log:', e.message) }
})

tx()

console.log('── Verification ──')
for (const tbl of ['tickets', 'clients', 'ticket_items', 'queue',
                   'washer_commissions', 'seller_commissions', 'cajero_commissions']) {
  try {
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${tbl}`).get() || {}
    console.log(`  ${tbl}: ${n} rows`)
  } catch {}
}

db.close()
console.log('Done. Restart Terminal X. Next sync pull confirms empty state.')
