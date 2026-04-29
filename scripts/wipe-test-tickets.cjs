// Mirror of the cloud wipe (2026-04-27): removes all tickets + ticket-linked
// dependents from the LOCAL SQLite DB, preserving:
//   - manual / imported commissions (rows with ticket_supabase_id IS NULL)
//   - clients (only nulls out balances that came from credit-ticket totals)
//   - services, inventory, employees, app_settings, NCF certs
//
// Run on the target PC from the Terminal X repo:
//   node scripts/wipe-test-tickets.cjs
//
// SQLCipher-encrypted DB. Key auto-derived via electron/key-vault.
// Override path:  TX_DB_PATH=<full-path>  node scripts/wipe-test-tickets.cjs
// Override key:   node scripts/wipe-test-tickets.cjs <64-char-hex>

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

let keyHex = process.argv[2] || null
if (!keyHex) {
  try {
    const keyVault = require('../electron/key-vault')
    if (typeof keyVault.getDerivedKeyHex === 'function') keyHex = keyVault.getDerivedKeyHex()
    else if (typeof keyVault.getKeyHex === 'function')   keyHex = keyVault.getKeyHex()
  } catch (e) { console.warn('key-vault:', e.message) }
}
if (keyHex) {
  try {
    db.pragma(`key = "x'${keyHex}'"`)
    db.pragma('cipher_page_size = 4096')
  } catch (e) { console.warn('cipher pragma:', e.message) }
}

try { db.prepare('SELECT COUNT(*) FROM sqlite_master').get() }
catch (e) {
  console.error('Cannot read DB:', e.message)
  console.error('Pass the 64-char hex key as the first arg if auto-derive failed.')
  process.exit(1)
}

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = OFF')

// ── Pre-count ────────────────────────────────────────────────────────────────
function count(sql, args = []) {
  try { return db.prepare(sql).get(...args)?.n ?? 0 } catch { return 0 }
}
const before = {
  tickets:       count('SELECT COUNT(*) AS n FROM tickets'),
  ticket_items:  count('SELECT COUNT(*) AS n FROM ticket_items'),
  washer_total:  count('SELECT COUNT(*) AS n FROM washer_commissions'),
  washer_manual: count('SELECT COUNT(*) AS n FROM washer_commissions WHERE ticket_supabase_id IS NULL AND ticket_id IS NULL'),
  seller_total:  count('SELECT COUNT(*) AS n FROM seller_commissions'),
  seller_manual: count('SELECT COUNT(*) AS n FROM seller_commissions WHERE ticket_supabase_id IS NULL AND ticket_id IS NULL'),
  cajero_total:  count('SELECT COUNT(*) AS n FROM cajero_commissions'),
  clients:       count('SELECT COUNT(*) AS n FROM clients'),
  client_debt:   count('SELECT COALESCE(SUM(balance),0) AS n FROM clients'),
}
console.log('── Before ──')
console.log(before)

const tx = db.transaction(() => {
  // 1. Roll back any client balance/visits/spend that came from credit tickets
  //    we're about to delete. Manual ledger adjustments outside the ticket
  //    flow are NOT touched.
  try {
    const creditTickets = db.prepare(
      `SELECT client_id, total, descuento FROM tickets
       WHERE tipo_venta='credito' AND client_id IS NOT NULL`
    ).all()
    let rolled = 0
    const upd = db.prepare(`UPDATE clients SET
                              balance = MAX(0, balance - ?),
                              visits  = MAX(0, visits  - 1),
                              total_spent = MAX(0, total_spent - ?)
                            WHERE id = ?`)
    for (const t of creditTickets) {
      const net = Math.max(0, Number(t.total || 0) - Number(t.descuento || 0))
      upd.run(net, Number(t.total || 0), t.client_id)
      rolled++
    }
    console.log(`  client balances rolled back: ${rolled} credit tickets`)
  } catch (e) { console.warn('  client rollback:', e.message) }

  // Also decrement visits/spend for non-credit tickets that bumped them.
  try {
    const cashTickets = db.prepare(
      `SELECT client_id, total FROM tickets
       WHERE (tipo_venta IS NULL OR tipo_venta!='credito') AND client_id IS NOT NULL`
    ).all()
    const upd = db.prepare(`UPDATE clients SET
                              visits      = MAX(0, visits - 1),
                              total_spent = MAX(0, total_spent - ?)
                            WHERE id = ?`)
    for (const t of cashTickets) upd.run(Number(t.total || 0), t.client_id)
    console.log(`  client visit counters rolled back: ${cashTickets.length} cash tickets`)
  } catch (e) { console.warn('  cash rollback:', e.message) }

  // 2. Detach commissions from soon-deleted tickets — preserve manual rows.
  for (const t of ['washer_commissions', 'seller_commissions', 'cajero_commissions']) {
    try {
      const r = db.prepare(
        `DELETE FROM ${t}
          WHERE ticket_id IS NOT NULL OR ticket_supabase_id IS NOT NULL`
      ).run()
      console.log(`  ${t}: deleted ${r.changes} ticket-linked rows`)
    } catch (e) { console.warn(`  ${t}:`, e.message) }
  }

  // 3. Ticket-dependent tables.
  for (const tbl of [
    'ticket_items', 'ticket_item_modificadores', 'queue', 'queue_deletions',
    'ecf_queue', 'credit_payments', 'credit_notes', 'ticket_locks',
    'inventory_oversells', 'price_changes',
  ]) {
    try {
      const r = db.prepare(`DELETE FROM ${tbl}`).run()
      console.log(`  ${tbl}: deleted ${r.changes} rows`)
    } catch (e) {
      if (!/no such table/i.test(e.message)) console.warn(`  ${tbl}:`, e.message)
    }
  }

  // 4. Tickets themselves.
  try {
    const r = db.prepare(`DELETE FROM tickets`).run()
    console.log(`  tickets: deleted ${r.changes} rows`)
  } catch (e) { console.warn('  tickets:', e.message) }

  // 5. Reset NCF + doc-number sequences so next sale starts at #1.
  try {
    const r = db.prepare('UPDATE ncf_sequences SET current_number = 0').run()
    console.log(`  ncf_sequences: reset ${r.changes} rows`)
  } catch (e) { console.warn('  ncf_sequences:', e.message) }
  try { db.prepare('DELETE FROM doc_number_blocks').run() } catch {}
  try { db.prepare('DELETE FROM ncf_blocks').run() } catch {}

  // 6. Clear push cursors so sync.js doesn't try to re-push deleted rows.
  try {
    const r = db.prepare(`DELETE FROM sync_log WHERE table_name IN
      ('tickets','ticket_items','ticket_item_modificadores','queue',
       'queue_deletions','ecf_queue','credit_payments','credit_notes',
       'ticket_locks','washer_commissions','seller_commissions',
       'cajero_commissions','clients','inventory_oversells','price_changes')`).run()
    console.log(`  sync_log: cleared ${r.changes} push cursors`)
  } catch (e) { console.warn('  sync_log:', e.message) }
})

tx()

console.log('── After ──')
console.log({
  tickets:       count('SELECT COUNT(*) AS n FROM tickets'),
  ticket_items:  count('SELECT COUNT(*) AS n FROM ticket_items'),
  washer_total:  count('SELECT COUNT(*) AS n FROM washer_commissions'),
  washer_manual: count('SELECT COUNT(*) AS n FROM washer_commissions WHERE ticket_supabase_id IS NULL AND ticket_id IS NULL'),
  seller_total:  count('SELECT COUNT(*) AS n FROM seller_commissions'),
  seller_manual: count('SELECT COUNT(*) AS n FROM seller_commissions WHERE ticket_supabase_id IS NULL AND ticket_id IS NULL'),
  cajero_total:  count('SELECT COUNT(*) AS n FROM cajero_commissions'),
  clients:       count('SELECT COUNT(*) AS n FROM clients'),
  client_debt:   count('SELECT COALESCE(SUM(balance),0) AS n FROM clients'),
})

db.close()
console.log('\nDone. Restart Terminal X. Next sync pull will confirm cloud parity.')
console.log('Manual commissions preserved — verify washer_manual / seller_manual counts above.')
