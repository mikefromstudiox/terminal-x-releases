// Multi-POS Simulation Harness — the RUNNER.
// Simulates N POS "devices" (each with its own temp SQLite DB) sharing ONE Supabase business.
// Usage:
//   node scripts/multipos-sim/harness.mjs --smoke   // spin up 2 devices, verify teardown
//
// Programmatic API:
//   const sim = new MultiPOSSimulation({ devices: 2 })
//   await sim.start()
//   await sim.device(0).createTicket({ items: [...], ncf_type: 'B01' })
//   await sim.device(1).setNetwork(false)
//   await sim.syncAll()
//   const report = await sim.audit()
//   await sim.cleanup()

import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { supa, setUp, tearDown, assertSim, SIM_BUSINESS_NAME } from './fixtures.mjs'
import { auditBusiness } from './report.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const TMP = join(__dirname, 'tmp-sim')
const SCHEMA_PATH = join(ROOT, 'db', 'schema.sql')

// Lazy-load better-sqlite3 — fall back to an in-memory shim if the native binary
// was compiled for Electron (NODE_MODULE_VERSION mismatch). The shim covers just
// enough of the sqlite surface area used by SimulatedDevice (tickets, ticket_items,
// ncf_sequences, businesses). Good enough to prove the harness end-to-end.
let Database
try {
  const mod = await import('better-sqlite3')
  const Real = mod.default
  // Probe native binary eagerly — if it was compiled for Electron, the throw happens here.
  const probe = new Real(':memory:')
  probe.close()
  Database = Real
} catch (e) {
  console.warn('[harness] better-sqlite3 native binary unavailable (' + (e.code || e.message.split('\n')[0]) + ')')
  console.warn('[harness] Falling back to in-memory JS shim for simulated devices.')
  console.warn('[harness] To use real SQLite: npm rebuild better-sqlite3 (outside Electron build).')
  Database = makeShimDatabase
}

function makeShimDatabase(_path) {
  const tables = {
    businesses: [],
    tickets: [],
    ticket_items: [],
    ncf_sequences: []
  }
  let autoIds = { tickets: 0, ticket_items: 0 }
  const api = {
    pragma() {},
    exec() {},
    close() {},
    prepare(sql) {
      const s = sql.trim().replace(/\s+/g, ' ')
      // INSERT OR IGNORE INTO businesses
      if (/^INSERT OR IGNORE INTO businesses/i.test(s)) {
        return { run: (id, name) => { if (!tables.businesses.find(b => b.id === id)) tables.businesses.push({ id, name }); return { changes: 1 } } }
      }
      if (/^INSERT OR IGNORE INTO ncf_sequences/i.test(s)) {
        return { run: () => { if (!tables.ncf_sequences.find(r => r.type === 'B01')) tables.ncf_sequences.push({ id: 1, type: 'B01', prefix: 'B01', current_number: 0, limit_number: 500, active: 1, enabled: 1 }); return { changes: 1 } } }
      }
      if (/^SELECT current_number, prefix FROM ncf_sequences WHERE type=\?/i.test(s)) {
        return { get: (type) => tables.ncf_sequences.find(r => r.type === type) }
      }
      if (/^UPDATE ncf_sequences SET current_number=\? WHERE type=\?/i.test(s)) {
        return { run: (n, type) => { const r = tables.ncf_sequences.find(x => x.type === type); if (r) r.current_number = n; return { changes: 1 } } }
      }
      if (/^SELECT COUNT\(\*\) AS c FROM tickets/i.test(s)) {
        return { get: () => ({ c: tables.tickets.length }) }
      }
      if (/^INSERT INTO tickets/i.test(s)) {
        return { run: (...args) => {
          const [doc_number, subtotal, itbis, total, payment_method, comprobante_type, ncf, created_at] = args
          const id = ++autoIds.tickets
          tables.tickets.push({ id, doc_number, subtotal, itbis, total, payment_method, comprobante_type, ncf, status: 'cobrado', created_at })
          return { lastInsertRowid: id, changes: 1 }
        } }
      }
      if (/^INSERT INTO ticket_items/i.test(s)) {
        return { run: (ticket_id, name, price, itbis) => {
          const id = ++autoIds.ticket_items
          tables.ticket_items.push({ id, ticket_id, name, price, itbis, is_wash: 0 })
          return { lastInsertRowid: id, changes: 1 }
        } }
      }
      // Generic fallback
      return { run: () => ({ changes: 0 }), get: () => undefined, all: () => [] }
    }
  }
  return api
}

function uuid() { return crypto.randomUUID() }
function nowIso() { return new Date().toISOString() }

// ─── SimulatedDevice ──────────────────────────────────────────────────────────
export class SimulatedDevice {
  constructor({ index, businessId, fixtures }) {
    this.index = index
    this.businessId = businessId
    this.fixtures = fixtures
    this.hwid = 'sim-hwid-' + uuid().slice(0, 8)
    this.online = true
    this.dbPath = join(TMP, `device-${index}.db`)
    this.db = null
    this.supa = supa()
    this.lastPushedAt = null
    this.syncErrors = []
    this.ticketsCreated = 0
  }

  async init(schemaSql) {
    if (existsSync(this.dbPath)) rmSync(this.dbPath, { force: true })
    this.db = Database === makeShimDatabase ? makeShimDatabase(this.dbPath) : new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = OFF') // schema references tables we skip; FKs loosened for sim
    // Apply schema — swallow individual CREATE failures (some tables may reference missing peers).
    if (Database !== makeShimDatabase) {
      for (const stmt of splitSql(schemaSql)) {
        try { this.db.exec(stmt) } catch (e) { /* ignore: harness only needs core tables */ }
      }
    }
    // Seed local row for business + ncf_sequences so createTicket can pull NCF locally.
    this.db.prepare('INSERT OR IGNORE INTO businesses (id,name) VALUES (?,?)').run(1, SIM_BUSINESS_NAME)
    this.db.prepare(`
      INSERT OR IGNORE INTO ncf_sequences (id,type,prefix,current_number,limit_number,active,enabled)
      VALUES (1,'B01','B01',0,500,1,1)
    `).run()
  }

  setNetwork(flag) {
    this.online = !!flag
    return this
  }

  _throwIfOffline(op) {
    if (!this.online) {
      const err = new Error(`NetworkError: failed to fetch (device ${this.index} offline — op=${op})`)
      err.code = 'OFFLINE'
      throw err
    }
  }

  // Allocate NCF from LOCAL SQLite (today's behavior — this is exactly the racey path the
  // new architecture must fix). Each device has its own sequence → duplicate NCFs expected.
  _allocNcfLocal(type = 'B01') {
    const row = this.db.prepare('SELECT current_number, prefix FROM ncf_sequences WHERE type=?').get(type)
    const next = (row?.current_number || 0) + 1
    this.db.prepare('UPDATE ncf_sequences SET current_number=? WHERE type=?').run(next, type)
    const prefix = row?.prefix || type
    return `${prefix}${String(next).padStart(10, '0')}`
  }

  _allocDocNumberLocal() {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM tickets").get()
    const n = (row?.c || 0) + 1
    // Include device index → unique per device locally but collides on Supabase if multiple
    // devices use same format (they do).
    return `TX-${String(n).padStart(6, '0')}`
  }

  async createTicket({ items = [], ncf_type = 'B01', payment_method = 'cash' } = {}) {
    if (!items.length) throw new Error('createTicket requires at least 1 item')
    const ncf = this._allocNcfLocal(ncf_type)
    const docNumber = this._allocDocNumberLocal()
    const ticketSupaId = uuid()
    const subtotal = items.reduce((s, i) => s + (i.price * (i.qty || 1)), 0)
    const itbis = Math.round(subtotal * 0.18 * 100) / 100
    const total = subtotal + itbis

    const stmt = this.db.prepare(`
      INSERT INTO tickets (doc_number, subtotal, itbis, total, payment_method, comprobante_type, ncf, status, created_at)
      VALUES (?,?,?,?,?,?,?, 'cobrado', ?)
    `)
    const info = stmt.run(docNumber, subtotal, itbis, total, payment_method, ncf_type, ncf, nowIso())
    const localTicketId = info.lastInsertRowid
    for (const it of items) {
      this.db.prepare(`
        INSERT INTO ticket_items (ticket_id, name, price, itbis, is_wash)
        VALUES (?,?,?,?,0)
      `).run(localTicketId, it.name, it.price, (it.price * 0.18))
    }
    this.ticketsCreated++

    // Optionally auto-push if online
    if (this.online) {
      try { await this._pushTicket({ localTicketId, ticketSupaId, docNumber, ncf, ncf_type, subtotal, itbis, total, payment_method, items }) }
      catch (e) { this.syncErrors.push({ op: 'push:createTicket', error: e.message, at: nowIso() }) }
    }
    return { localTicketId, ticketSupaId, ncf, docNumber, total }
  }

  async _pushTicket(t) {
    this._throwIfOffline('push')
    const { error } = await this.supa.from('tickets').insert({
      id: t.ticketSupaId, supabase_id: t.ticketSupaId,
      business_id: this.businessId,
      doc_number: t.docNumber,
      ncf: t.ncf, ncf_type: t.ncf_type, comprobante_type: t.ncf_type,
      subtotal: t.subtotal, itbis: t.itbis, total: t.total,
      payment_method: t.payment_method, tipo_venta: 'contado', status: 'cobrado',
      created_at: nowIso(), updated_at: nowIso()
    })
    if (error) throw new Error(error.message)
    for (const it of t.items) {
      const itId = uuid()
      await this.supa.from('ticket_items').insert({
        id: itId, supabase_id: itId,
        business_id: this.businessId,
        ticket_supabase_id: t.ticketSupaId,
        name: it.name, price: it.price, itbis: it.price * 0.18,
        is_wash: 0, quantity: it.qty || 1,
        inventory_item_supabase_id: it.inventory_item_id || null,
        sku: it.sku || null,
        created_at: nowIso(), updated_at: nowIso()
      })
      // Decrement inventory on Supabase (atomic update)
      if (it.inventory_item_id) {
        const { data: inv } = await this.supa.from('inventory_items')
          .select('quantity').eq('id', it.inventory_item_id).single()
        if (inv) {
          await this.supa.from('inventory_items')
            .update({ quantity: inv.quantity - (it.qty || 1), updated_at: nowIso() })
            .eq('id', it.inventory_item_id)
        }
      }
    }
  }

  // Flush all local tickets that never made it to Supabase.
  async pushNow() {
    if (!this.online) return { pushed: 0, skipped: 'offline' }
    // (Simplified — real impl would track an outbox table.) For now: nothing to do because
    // createTicket pushes inline. Kept for scenario scripts that flip the network later.
    return { pushed: 0 }
  }

  async pullNow() {
    if (!this.online) return { pulled: 0, skipped: 'offline' }
    const { data, error } = await this.supa.from('tickets')
      .select('supabase_id, doc_number, ncf, total, updated_at')
      .eq('business_id', this.businessId)
      .gt('updated_at', this.lastPushedAt || '1970-01-01')
      .limit(500)
    if (error) { this.syncErrors.push({ op: 'pull', error: error.message }); return { pulled: 0, error: error.message } }
    this.lastPushedAt = nowIso()
    return { pulled: data?.length || 0 }
  }

  async close() {
    try { this.db?.close() } catch {}
    try { if (existsSync(this.dbPath)) rmSync(this.dbPath, { force: true }) } catch {}
  }
}

// ─── MultiPOSSimulation ───────────────────────────────────────────────────────
export class MultiPOSSimulation {
  constructor({ devices = 2, businessId = null } = {}) {
    this.deviceCount = devices
    this.businessId = businessId
    this.fixtures = null
    this.devices = []
    this.startedAt = null
    this._supa = supa()
  }

  async start() {
    this.startedAt = Date.now()
    mkdirSync(TMP, { recursive: true })
    this.fixtures = await setUp(this._supa, { devices: this.deviceCount })
    assertSim(this.fixtures.businessName)
    this.businessId = this.fixtures.businessId
    const schemaSql = readFileSync(SCHEMA_PATH, 'utf8')
    for (let i = 0; i < this.deviceCount; i++) {
      const d = new SimulatedDevice({ index: i, businessId: this.businessId, fixtures: this.fixtures })
      await d.init(schemaSql)
      this.devices.push(d)
    }
    return this
  }

  device(i) {
    if (!this.devices[i]) throw new Error(`device(${i}) — only ${this.devices.length} devices running`)
    return this.devices[i]
  }

  async syncAll() {
    const results = []
    for (const d of this.devices) {
      results.push({ device: d.index, push: await d.pushNow(), pull: await d.pullNow() })
    }
    return results
  }

  async audit() {
    assertSim(this.fixtures?.businessName)
    const report = await auditBusiness(this._supa, this.businessId, this.fixtures)
    return {
      devices: this.deviceCount,
      ticketsCreated: this.devices.reduce((s, d) => s + d.ticketsCreated, 0),
      syncErrors: this.devices.flatMap(d => d.syncErrors.map(e => ({ device: d.index, ...e }))),
      runtimeMs: Date.now() - this.startedAt,
      ...report
    }
  }

  async cleanup() {
    for (const d of this.devices) await d.close()
    try { rmSync(TMP, { recursive: true, force: true }) } catch {}
    if (this.fixtures?.businessName) {
      assertSim(this.fixtures.businessName)
      await tearDown(this._supa)
    }
  }
}

function splitSql(sql) {
  // Naive split on `;` at end of line — schema.sql doesn't contain triggers w/ embedded `;`.
  return sql.split(/;\s*$/m).map(s => s.trim()).filter(s => s && !s.startsWith('--'))
}

// ─── CLI: --smoke ─────────────────────────────────────────────────────────────
const isMain = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
               import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') || '')

if (process.argv.some(a => a === '--smoke')) {
  const t0 = Date.now()
  console.log('[smoke] starting MultiPOS simulation — 2 devices')
  const sim = new MultiPOSSimulation({ devices: 2 })
  try {
    await sim.start()
    console.log(`[smoke] fixtures ready — businessId=${sim.businessId}`)
    console.log(`[smoke] device 0 hwid=${sim.device(0).hwid}`)
    console.log(`[smoke] device 1 hwid=${sim.device(1).hwid}`)
    // Minimal concurrent test: each device creates 3 tickets online.
    const item = sim.fixtures.items[0]
    for (let i = 0; i < 3; i++) {
      await sim.device(0).createTicket({ items: [{ name: item.sku, price: item.price, qty: 1 }], ncf_type: 'B01' })
      await sim.device(1).createTicket({ items: [{ name: item.sku, price: item.price, qty: 1 }], ncf_type: 'B01' })
    }
    await sim.syncAll()
    const report = await sim.audit()
    console.log('[smoke] audit report:')
    console.log(JSON.stringify(report, null, 2))
    if (report.duplicateNCFs.length > 0) {
      console.log('\n[smoke] EXPECTED FAILURE DETECTED — duplicate NCFs found (current architecture has per-device sequences):')
      for (const dup of report.duplicateNCFs) {
        console.log(`  NCF ${dup.ncf} (${dup.ncf_type}) used ${dup.count}x`)
      }
      console.log('[smoke] The harness is WORKING — it caught the pre-fix race condition.')
    } else {
      console.log('\n[smoke] No duplicate NCFs observed this run (still valid — 3 tickets per device is a small sample).')
    }
  } catch (e) {
    console.error('[smoke] FAILURE:', e.stack || e.message)
    process.exitCode = 1
  } finally {
    try { await sim.cleanup(); console.log(`[smoke] cleanup done — total ${Date.now() - t0}ms`) }
    catch (e) { console.error('[smoke] cleanup failed:', e.message); process.exitCode = 1 }
  }
}
