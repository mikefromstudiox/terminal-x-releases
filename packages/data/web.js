/**
 * web.js — Web/PWA data layer (Supabase).
 *
 * Provides the exact same API shape as window.electronAPI (see preload.js)
 * but backed by real Supabase queries instead of IPC calls.
 *
 * Usage:
 *   import { createClient } from '@supabase/supabase-js'
 *   import { createWebAPI, createWebPrinterAPI } from './data/web'
 *   const supabase = createClient(url, anonKey)
 *   window.electronAPI = createWebAPI(supabase, businessId)
 *   window.printerAPI  = createWebPrinterAPI()
 */

import { enqueueTicket } from '@terminal-x/services/offline-queue'
import { voidNoShowFeeOrchestrator } from '@terminal-x/services/voidNoShowFee'
import { isBusinessSetting, isDeviceSetting, DEVICE_SETTING_KEYS } from '@terminal-x/services/settingsWhitelist'
import {
  enqueueLendingWrite,
  enqueuePendingPhoto,
  isNetworkError as isLendingNetworkError,
  flushLendingQueue as _flushLendingQueue,
  flushPendingPhotos as _flushPendingPhotos,
  startLendingQueueAutoFlush,
  peekLendingQueue as _peekLendingQueue,
  peekPendingPhotos as _peekPendingPhotos,
  getLendingQueueCounts as _getLendingQueueCounts,
} from './lendingQueue.js'
import {
  getOrMintJwt as _getOrMintJwt,
  attachJwtToSupabaseClient as _attachJwt,
  loadCachedJwt as _loadCachedJwt,
  isExpiringSoon as _jwtExpiringSoon,
  clearCachedJwt as _clearCachedJwt,
} from '@terminal-x/services/perLicenseJwt'

// ── Per-license JWT boot hook ─────────────────────────────────────────────────
// At app boot, if a license_key is in localStorage (web user has been
// provisioned via signup or auto-fetched after first signInWithPassword), we
// mint a per-license JWT and attach it to the supabase client so RLS sees
// `business_id`/`plan_id` claims directly — no GoTrue session round-trip on
// every PostgREST call.
//
// Demo accounts (admin@*.demo.terminalxpos.com) never set tx_license_key, so
// this short-circuits and signInWithPassword owns the auth session as before.
// The two paths are mutually exclusive: we never call both for the same tab.
const LICENSE_KEY_LS    = 'tx_license_key'
const MACHINE_ID_LS     = 'terminalx_machine_id'
const REFRESH_INTERVAL  = 60_000

function _getOrCreateMachineId() {
  if (typeof localStorage === 'undefined') return 'web-anon'
  let id = localStorage.getItem(MACHINE_ID_LS)
  if (!id) {
    try { id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(36).slice(2)}` }
    catch { id = `web-${Date.now()}-${Math.random().toString(36).slice(2)}` }
    try { localStorage.setItem(MACHINE_ID_LS, id) } catch {}
  }
  return id
}

function _resolveFunctionsUrl(supabaseUrl) {
  if (!supabaseUrl) return null
  // Prefer the dedicated functions subdomain (xxx.functions.supabase.co) when
  // possible, else fall back to the project URL + /functions/v1 path.
  if (/\.supabase\.co/.test(supabaseUrl)) {
    return supabaseUrl.replace('.supabase.co', '.functions.supabase.co')
  }
  return supabaseUrl.replace(/\/+$/, '') + '/functions/v1'
}

let _refresherTimer = null
function _schedulePeriodicRefresh(supabase, supabaseUrl) {
  if (typeof window === 'undefined') return
  if (_refresherTimer) clearInterval(_refresherTimer)
  _refresherTimer = setInterval(async () => {
    if (typeof localStorage === 'undefined') return
    const licenseKey = localStorage.getItem(LICENSE_KEY_LS)
    if (!licenseKey) return // license cleared mid-session ⇒ stop refreshing
    const cached = _loadCachedJwt()
    if (!_jwtExpiringSoon(cached)) return
    try {
      const fresh = await _getOrMintJwt({
        licenseKey,
        machineId: _getOrCreateMachineId(),
        supabaseFunctionsUrl: _resolveFunctionsUrl(supabaseUrl),
        anonKey: (typeof globalThis !== 'undefined' && globalThis.__TX_SUPABASE_ANON_KEY) || null,
        force: true,
      })
      await _attachJwt(supabase, fresh)
    } catch (e) {
      console.warn('[license-jwt] refresh failed:', e?.message || e)
    }
  }, REFRESH_INTERVAL)
  if (typeof window !== 'undefined') window.__txJwtRefresher = _refresherTimer
}

/**
 * Mint + attach a per-license JWT, then start the periodic refresher.
 * Safe to call multiple times — subsequent calls reuse the cached JWT.
 *
 * @param {object} supabase  supabase-js v2 client
 * @param {string} supabaseUrl  e.g. https://xxx.supabase.co (used to derive functions URL)
 * @returns {Promise<boolean>} true if a JWT was attached, false if skipped/failed
 */
export async function bootLicenseJwt(supabase, supabaseUrl, supabaseAnonKey) {
  if (!supabase || typeof localStorage === 'undefined') return false
  const licenseKey = localStorage.getItem(LICENSE_KEY_LS)
  if (!licenseKey) return false // demo / unprovisioned tab — leave session alone
  // v2.16.27 — Edge Function gateway requires the anon apikey on every call
  // (verify_jwt default). Stash on globalThis so the periodic refresher and
  // the mintJwt fallback chain can read it without prop-drilling.
  if (supabaseAnonKey && typeof globalThis !== 'undefined') {
    globalThis.__TX_SUPABASE_ANON_KEY = supabaseAnonKey
  }
  try {
    const bundle = await _getOrMintJwt({
      licenseKey,
      machineId: _getOrCreateMachineId(),
      supabaseFunctionsUrl: _resolveFunctionsUrl(supabaseUrl),
      anonKey: supabaseAnonKey,
    })
    const ok = await _attachJwt(supabase, bundle)
    if (!ok) return false
    _schedulePeriodicRefresh(supabase, supabaseUrl)
    return true
  } catch (e) {
    console.warn('[license-jwt] mint failed, falling back to user signin path:', e?.message || e)
    _clearCachedJwt()
    return false
  }
}

export function stopLicenseJwtRefresh() {
  if (_refresherTimer) { clearInterval(_refresherTimer); _refresherTimer = null }
  if (typeof window !== 'undefined') window.__txJwtRefresher = null
}

// Device-local settings on web live in localStorage (one "device" = one browser).
// Defaults mirror the desktop SISTEMA_DEFAULTS so the UI sees valid strings.
const WEB_DEVICE_DEFAULTS = {
  printer: '',
  print_factura_auto: '0',
  print_conduce_auto: '0',
  print_preticket: '0',
  multi_pos_enabled: '0',
  ncf_block_size: '500',
  doc_block_size: '200',
}
const DEVICE_LS_PREFIX = 'tx_device_setting:'
function webDeviceGet(key) {
  try { return (typeof localStorage !== 'undefined' ? localStorage.getItem(DEVICE_LS_PREFIX + key) : null) ?? (WEB_DEVICE_DEFAULTS[key] ?? '') }
  catch { return WEB_DEVICE_DEFAULTS[key] ?? '' }
}
function webDeviceSet(key, value) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(DEVICE_LS_PREFIX + key, String(value)) } catch {}
}
function webDeviceAll() {
  const out = { ...WEB_DEVICE_DEFAULTS }
  for (const k of DEVICE_SETTING_KEYS) {
    const v = webDeviceGet(k)
    if (v !== null && v !== undefined) out[k] = v
  }
  return out
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function tryOr(fn, fallback, label) {
  try {
    const result = await fn()
    // Supabase returns null for empty results — coerce to fallback
    if (result === null && fallback !== undefined) return fallback
    return result
  } catch (err) {
    // Demote to debug — tryOr is the READ path; callers expect a fallback.
    // Logging every read-miss as ERROR floods the console during SPA boot
    // (session not yet attached → transient 4xx) and triggers false-positive
    // E2E audits. Writes still use tryWrite which throws + errors loudly.
    if (typeof console !== 'undefined') console.debug?.('[web.js.read]', label || '', err.message || err)
    // Surface to admin Errores panel as a WARN so silent read failures
    // (RLS denial, JWT expired, transient fetch) are visible without flooding
    // — was the root cause of "Conteo Físico is empty but data exists" 2026-05-18.
    try {
      const msg = String(err?.message || err || '')
      // Skip the boot transient (no session yet → 401) so we don't spam reports.
      const isBootAuth = /JWT|jwt expired|Invalid Refresh Token|Auth session missing|not authenticated|401/i.test(msg)
      if (!isBootAuth && typeof window !== 'undefined' && typeof window.__txReportError === 'function') {
        window.__txReportError(err, { severity: 'warn', category: label || 'web.read' })
      }
    } catch {}
    if (fallback !== undefined) return fallback
    throw err
  }
}

/** For write operations: log and re-throw so callers see failures. */
async function tryWrite(fn, label = 'web.write') {
  try {
    return await fn()
  } catch (err) {
    console.error('[web.js WRITE]', label, err.message || err)
    try {
      if (typeof window !== 'undefined' && typeof window.__txReportError === 'function') {
        window.__txReportError(err, { severity: 'error', category: label })
      }
    } catch {}
    throw err
  }
}

// 2026-05-18 Fix P — Detect PostgREST silent 0-row UPDATE/DELETE under RLS.
// PostgREST returns `{ error: null, data: [] }` when RLS denies an update by
// invisibility — caller thinks the mutation succeeded but nothing changed.
// Wrap a write that uses `.update()/.delete().select()` with this helper:
//   const r = await assertAffected(supabase.from(t).update(p).eq(...).select('id'), 'web.foo.bar')
// Throws a labeled error (which then routes through tryWrite → __txReportError)
// if no rows came back. Caller can pass `{ allowZero: true }` to opt out (rare).
async function assertAffected(query, label, opts = {}) {
  const { data, error } = await query
  if (error) throw error
  const rows = Array.isArray(data) ? data : (data ? [data] : [])
  if (rows.length === 0 && !opts.allowZero) {
    const err = new Error(`silent_zero_row_write: ${label} — RLS denial or row missing`)
    err.code = 'TX_SILENT_ZERO_ROW'
    throw err
  }
  return rows
}

// v2.16.5 — H10: generic offline write queue for prestamos. Wraps a lending
// write so that:
//   - if the browser reports offline, we enqueue immediately (no network call)
//   - if the call fails on a network-level error (timeout, fetch, dns, abort),
//     we enqueue and report `{ queued: true }` to the caller — UI shows toast
//   - if the call fails on a business error (RLS, validation, FK), we
//     re-throw so the prestamista actually sees what's wrong (e.g. cliente
//     missing, cuota inválida). Queueing those would mask real bugs forever.
//
// Caller pre-generates `payload.supabase_id` so re-flush is idempotent.
async function tryWriteOrQueue({ table, op, payload, business_id, rpc_name = null }, onlineFn) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  if (offline) {
    try {
      await enqueueLendingWrite({ table, op, payload, business_id, rpc_name })
      return { queued: true, supabase_id: payload?.supabase_id ?? null, id: null, offline: true }
    } catch (qErr) {
      console.error('[web.js QUEUE]', qErr.message || qErr)
      throw qErr
    }
  }
  try {
    return await onlineFn()
  } catch (err) {
    if (isLendingNetworkError(err)) {
      try {
        await enqueueLendingWrite({ table, op, payload, business_id, rpc_name })
        return { queued: true, supabase_id: payload?.supabase_id ?? null, id: null, error_was: err.message }
      } catch (qErr) {
        console.error('[web.js QUEUE-on-fail]', qErr.message || qErr)
        throw err  // surface the original network error
      }
    }
    console.error('[web.js WRITE]', `web.queue.${table}`, err.message || err)
    try {
      if (typeof window !== 'undefined' && typeof window.__txReportError === 'function') {
        window.__txReportError(err, { severity: 'error', category: `web.queue.${table}` })
      }
    } catch {}
    throw err
  }
}

// v2.16.2 — H4: dealership mutations get an offline-queue wrapper so a flaky
// 4G signal at the lot doesn't cost a lead/test-drive/deal write. The queue
// is drained automatically by `startDealershipReplay()` when connectivity
// returns. Lazy-imported so the dependency only loads on the web bundle.
let _dealershipQueue = null
async function getDealershipQueue() {
  if (_dealershipQueue) return _dealershipQueue
  try { _dealershipQueue = await import('../services/dealership-offline-queue.js') }
  catch (e) { console.warn('[dealership-offline-queue import failed]', e?.message); _dealershipQueue = null }
  return _dealershipQueue
}
async function withDealershipQ(opType, payload, fn) {
  const q = await getDealershipQueue()
  if (!q) return fn()
  return q.withDealershipOfflineQueue(opType, payload, fn)
}

function safeParseJSON(s) {
  try { return JSON.parse(s) } catch { return null }
}

function throwSupaError(res) {
  if (res.error) throw new Error(res.error.message || res.error.code || 'Supabase error')
  return res.data
}

// ── Embedded-join replacement helper ──────────────────────────────────────────
// PostgREST embedded selects (table(col)) require real FK constraints to exist
// on Supabase. Many of our cross-table refs use *_supabase_id UUIDs without a
// formal FK, so we resolve them via a separate IN-fetch and merge in JS.
//
//   rows: array of parent rows
//   fkCol: parent column holding the target's lookup key (e.g. 'client_supabase_id')
//   targetTable: 'clients'
//   targetKey: 'supabase_id' (or 'id')
//   selectCols: 'name,phone'
//   asKey: alias merged onto each row (e.g. 'clients' => row.clients = {...})
async function attachRel(supabase, rows, { fkCol, targetTable, targetKey = 'supabase_id', selectCols, asKey, businessId }) {
  if (!Array.isArray(rows) || !rows.length) return rows
  const ids = [...new Set(rows.map(r => r?.[fkCol]).filter(v => v != null))]
  if (!ids.length) { for (const r of rows) r[asKey] = null; return rows }
  let q = supabase.from(targetTable).select(`${targetKey}, ${selectCols}`).in(targetKey, ids)
  if (businessId) q = q.eq('business_id', businessId)
  const { data: refs } = await q
  const map = {}
  for (const x of (refs || [])) map[x[targetKey]] = x
  for (const r of rows) r[asKey] = map[r?.[fkCol]] || null
  return rows
}

// Mechanic WO totals recalc — labor (labor|service) untaxed; parts taxed 18% ITBIS DR.
async function recalcWorkOrderTotalsWeb(supabase, businessId, workOrderId) {
  const { data: rows } = await supabase.from('work_order_items').select('type,total').eq('business_id', businessId).eq('work_order_id', workOrderId)
  let labor = 0, parts = 0
  for (const r of rows || []) {
    const t = Number(r.total) || 0
    if (r.type === 'part') parts += t
    else labor += t
  }
  const itbis = Math.round(parts * 0.18 * 100) / 100
  const total = Math.round((labor + parts + itbis) * 100) / 100
  await supabase.from('work_orders').update({
    labor_total: labor, parts_total: parts, itbis, total, estimated_total: total,
    updated_at: new Date().toISOString(),
  }).eq('id', workOrderId).eq('business_id', businessId)
  return { labor, parts, itbis, total }
}

// Sprint 10 (v2.10.5) — PIN hashing hardened (S-H4/H5/H6).
//   - New PINs: bcryptjs @ cost 10 with per-row 24-byte salt appended to the
//     PIN before hashing. Rainbow tables stay useless across installs.
//   - Legacy rows (pin_hash_algo='sha256'): accepted via the old unsalted
//     SHA-256 path, then atomically rehashed to bcrypt on success.
//   - Lockout: 5 consecutive wrong attempts → 5-minute lock on that row
//     (pin_failed_attempts / pin_locked_until).
import bcryptjs from 'bcryptjs'
const BCRYPT_COST = 10
const PIN_MAX_FAILED_ATTEMPTS = 5
const PIN_LOCKOUT_MS = 5 * 60 * 1000

async function legacySha256Hex(pin) {
  const enc = new TextEncoder().encode(String(pin))
  const buf = await crypto.subtle.digest('SHA-256', enc)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
function generatePinSaltWeb() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
function bcryptHashPinWeb(pin, salt) {
  return bcryptjs.hashSync(String(pin) + (salt || ''), BCRYPT_COST)
}
function bcryptComparePinWeb(pin, salt, hash) {
  try { return bcryptjs.compareSync(String(pin) + (salt || ''), String(hash || '')) }
  catch { return false }
}

// hashPin is now a credentials factory: returns { pin_hash, pin_hash_algo,
// pin_salt }. Every write site expands the triple onto the staff row so a
// freshly-created web user is immediately bcrypt-protected — no rehash-on-
// login round-trip required for new rows. Reads on legacy rows still go
// through the authByPin fallback.
// 2026-05-18 Fix C — weak-PIN guard at the source. Any web staff create/update
// that goes through users.create/users.update routes here, so '0000' / '1234' /
// 'aaaa' / sequential / repeated patterns are rejected before bcrypt runs.
// Throws (caught by tryWrite → reported to admin Errores).
function assertStrongPin(pin) {
  const s = String(pin || '')
  if (!/^\d{4,6}$/.test(s)) throw new Error('PIN debe ser de 4 a 6 dígitos')
  if (/^(\d)\1+$/.test(s)) throw new Error('PIN no puede ser dígitos repetidos (ej. 0000, 1111)')
  const banned = new Set(['1234','12345','123456','4321','54321','654321','0000','1111','2222','3333','4444','5555','6666','7777','8888','9999'])
  if (banned.has(s)) throw new Error('PIN demasiado común — escoja otro')
  // Sequential ascending/descending (1234, 2345, ... 9876, 8765, ...)
  let ascending = true, descending = true
  for (let i = 1; i < s.length; i++) {
    if (s.charCodeAt(i) !== s.charCodeAt(i-1) + 1) ascending = false
    if (s.charCodeAt(i) !== s.charCodeAt(i-1) - 1) descending = false
  }
  if (ascending || descending) throw new Error('PIN secuencial no permitido')
}

async function hashPin(pin) {
  assertStrongPin(pin)
  const salt = generatePinSaltWeb()
  return {
    pin_hash: bcryptHashPinWeb(pin, salt),
    pin_hash_algo: 'bcrypt',
    pin_salt: salt,
  }
}

// ── Payroll helpers (shared by payrollRuns.create + bulkCreate) ────────────────
function buildPayrollRunRow(data, businessId) {
  const sfs_employee     = Number(data.sfs_employee || 0)
  const afp_employee     = Number(data.afp_employee || 0)
  const isr              = Number(data.isr || 0)
  const other_deductions = Number(data.other_deductions || 0)
  const deductions = data.deductions != null
    ? Number(data.deductions)
    : sfs_employee + afp_employee + isr + other_deductions
  return {
    supabase_id:      crypto.randomUUID(),
    empleado_id:      data.empleado_id,
    empleado_supabase_id: data.empleado_supabase_id || null,
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
    business_id:      businessId,
  }
}

// Mark unpaid commissions within [from, to] as paid for an employee.
// Commissions attach to tickets whose created_at falls in the date range.
async function markCommissionsPaidForEmpleado(supabase, businessId, empleadoId, from, to) {
  const { data: emp } = await supabase.from('empleados').select('tipo, supabase_id').eq('id', empleadoId).single()
  if (!emp || !emp.supabase_id) return 0
  const table = emp.tipo === 'lavador'  ? 'washer_commissions'
              : emp.tipo === 'vendedor' ? 'seller_commissions'
              : emp.tipo === 'cajero'   ? 'cajero_commissions'
              : emp.tipo === 'hybrid'   ? null
              : null
  if (!table) return 0
  // Find tickets in the date range, then update only rows whose ticket_supabase_id is in that set
  const { data: tickets } = await supabase.from('tickets').select('supabase_id')
    .eq('business_id', businessId)
    .gte('created_at', from)
    .lte('created_at', to + ' 23:59:59')
  const ticketSids = (tickets || []).map(t => t.supabase_id).filter(Boolean)
  if (ticketSids.length === 0) return 0
  const { data: updated } = await supabase.from(table)
    .update({ paid: true, paid_at: new Date().toISOString() })
    .eq('business_id', businessId).eq('empleado_supabase_id', emp.supabase_id).eq('paid', false)
    .in('ticket_supabase_id', ticketSids)
    .select('id')
  return (updated || []).length
}

// ── Conteo Fisico helpers (v2.5) ────────────────────────────────────────────
// Both helpers are file-scope so the `inventoryCount` namespace and any
// future consumers (e.g. scheduled variance-report jobs) can reuse them.

async function fetchCount(supabase, bid, idOrSid) {
  // inventory_counts has BOTH id (uuid) and supabase_id (uuid) as separate
  // values — the simple "has dash → supabase_id else id" heuristic breaks
  // because both are UUIDs with dashes. Query OR-matching either column so
  // the helper works regardless of which the caller passes.
  const sval = typeof idOrSid === 'string' ? idOrSid : String(idOrSid)
  const { data: header } = await supabase.from('inventory_counts')
    .select('*').eq('business_id', bid)
    .or(`id.eq.${sval},supabase_id.eq.${sval}`)
    .maybeSingle()
  if (!header) return null
  const { data: itemsRaw = [] } = await supabase.from('inventory_count_items')
    .select('*').eq('business_id', bid).eq('count_supabase_id', header.supabase_id)
    .order('category').order('name')
  const items = itemsRaw || []

  // v2.14 — Sales during the count window. Matches the desktop calc in
  // inventoryCountGet so variance shows true shrinkage, not sales. Small
  // datasets (≤ few K ticket_items typical per count) keep this cheap.
  try {
    const windowEnd = header.completed_at || new Date().toISOString()
    const { data: tix = [] } = await supabase.from('tickets')
      .select('supabase_id, status, created_at')
      .eq('business_id', bid)
      .gte('created_at', header.started_at)
      .lte('created_at', windowEnd)
      .neq('status', 'anulado')
    const liveSids = (tix || []).map(t => t.supabase_id).filter(Boolean)
    const soldMap = new Map()
    if (liveSids.length) {
      // Batch 500 at a time to stay under URL size limits on Supabase IN filter.
      for (let i = 0; i < liveSids.length; i += 500) {
        const chunk = liveSids.slice(i, i + 500)
        const { data: rows = [] } = await supabase.from('ticket_items')
          .select('inventory_item_supabase_id, quantity')
          .eq('business_id', bid)
          .in('ticket_supabase_id', chunk)
          .not('inventory_item_supabase_id', 'is', null)
        for (const r of (rows || [])) {
          const k = r.inventory_item_supabase_id
          if (!k) continue
          soldMap.set(k, (soldMap.get(k) || 0) + (Number(r.quantity) || 1))
        }
      }
    }
    for (const it of items) {
      it.sold_during_count = soldMap.get(it.inventory_item_supabase_id) || 0
    }
  } catch {
    for (const it of items) it.sold_during_count = 0
  }

  return { ...header, items }
}

async function refreshCountTotals(supabase, bid, countSid) {
  // v2.14 — Totals subtract sales-during-count so running variance is TRUE
  // shrinkage, not sales. Small datasets (≤ few K items) keep this fast.
  const { data: header } = await supabase.from('inventory_counts')
    .select('started_at, completed_at')
    .eq('business_id', bid).eq('supabase_id', countSid).maybeSingle()
  const { data = [] } = await supabase.from('inventory_count_items')
    .select('inventory_item_supabase_id, expected_qty, counted_qty, unit_cost')
    .eq('business_id', bid).eq('count_supabase_id', countSid)

  const soldMap = new Map()
  if (header) {
    try {
      const windowEnd = header.completed_at || new Date().toISOString()
      const { data: tix = [] } = await supabase.from('tickets')
        .select('supabase_id').eq('business_id', bid)
        .gte('created_at', header.started_at).lte('created_at', windowEnd)
        .neq('status', 'anulado')
      const sids = (tix || []).map(t => t.supabase_id).filter(Boolean)
      for (let i = 0; i < sids.length; i += 500) {
        const chunk = sids.slice(i, i + 500)
        const { data: rows = [] } = await supabase.from('ticket_items')
          .select('inventory_item_supabase_id, quantity')
          .eq('business_id', bid).in('ticket_supabase_id', chunk)
          .not('inventory_item_supabase_id', 'is', null)
        for (const r of (rows || [])) {
          const k = r.inventory_item_supabase_id
          if (!k) continue
          soldMap.set(k, (soldMap.get(k) || 0) + (Number(r.quantity) || 1))
        }
      }
    } catch {}
  }

  const totals = (data || []).reduce((acc, r) => {
    const exp = Number(r.expected_qty) || 0
    const sold = soldMap.get(r.inventory_item_supabase_id) || 0
    const adj = exp - sold
    const cnt = (r.counted_qty === null || r.counted_qty === undefined) ? adj : Number(r.counted_qty)
    const cost = Number(r.unit_cost) || 0
    acc.total_expected_value += exp * cost
    acc.total_counted_value  += cnt * cost
    acc.total_variance_value += (cnt - adj) * cost
    return acc
  }, { total_expected_value: 0, total_counted_value: 0, total_variance_value: 0 })
  await supabase.from('inventory_counts').update({
    ...totals, updated_at: new Date().toISOString(),
  }).eq('business_id', bid).eq('supabase_id', countSid)
  return totals
}

// ── Main factory ───────────────────────────────────────────────────────────────

export function createWebAPI(supabase, businessId) {
  const bid = businessId

  // H10 — kick the generic lending offline queue auto-flusher. Idempotent
  // (stops any prior listener first), no-op if window is unavailable.
  try { startLendingQueueAutoFlush(supabase) } catch (e) { console.warn('[lendingQueue] autoflush start failed', e?.message) }

  // Shorthand: select from a table scoped to this business
  function from(table) {
    return supabase.from(table).select('*').eq('business_id', bid)
  }

  // ── Activity log (owner audit feed) helper ───────────────────────────────
  // Web mutations write log rows directly to Supabase; the module-level actor
  // is set via api.activity.setActor(...) from AuthContext on login.
  let _webActor = null
  // Compose a fully-resolved row from a caller payload. Pulled out so both
  // the live writer and the fallback drainer build identical Supabase rows.
  function _buildActivityRow(evt) {
    const actor = _webActor || {}
    const nowIso = new Date().toISOString()
    return {
      supabase_id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      business_id: bid,
      event_type: evt.event_type,
      severity: evt.severity || 'info',
      actor_supabase_id: evt.actor_supabase_id || (actor && actor.id && typeof actor.id === 'string' && actor.id.includes('-') ? actor.id : null),
      actor_name: evt.actor_name || actor.name || null,
      actor_role: evt.actor_role || actor.role || null,
      target_type: evt.target_type || null,
      target_id:   evt.target_id != null ? String(evt.target_id) : null,
      target_name: evt.target_name || null,
      amount:      evt.amount != null ? Number(evt.amount) : null,
      old_value:   evt.old_value != null ? String(evt.old_value) : null,
      new_value:   evt.new_value != null ? String(evt.new_value) : null,
      reason:      evt.reason || null,
      metadata:    evt.metadata || null,
      created_at:  nowIso,
      updated_at:  nowIso,
    }
  }
  // Lazy import to avoid pulling `idb` into landing/admin chunks. The promise
  // resolves to the queue module once on first use and is reused thereafter.
  let _alqPromise = null
  function _alq() {
    if (!_alqPromise) _alqPromise = import('@terminal-x/services/activity-log-queue.js').catch(() => null)
    return _alqPromise
  }
  // The "writer" the queue calls during drain. Wired once on first logActivity
  // so retries land via the same code path as live writes.
  async function _writeRowViaSupabase(payload) {
    const row = _buildActivityRow(payload)
    const { error } = await supabase.from('activity_log').insert(row)
    if (error) throw new Error(error.message || 'activity_log insert failed')
  }
  let _writerRegistered = false
  async function _ensureWriter() {
    if (_writerRegistered) return
    const mod = await _alq()
    if (!mod) return
    try {
      mod.registerWriter(_writeRowViaSupabase)
      mod.startAutoDrain({ supabaseInsertFn: _writeRowViaSupabase })
      _writerRegistered = true
    } catch {}
  }
  async function logActivity(evt) {
    if (!evt || !evt.event_type) return
    // Fire-and-forget: ensure the queue has a writer + drain loop running.
    _ensureWriter()
    try {
      const { error } = await supabase.from('activity_log').insert(_buildActivityRow(evt))
      if (error) throw new Error(error.message || 'activity_log insert failed')
    } catch (e) {
      // Compliance backbone — never silent-drop. Persist to IDB fallback for
      // exponential-backoff retry. `critical` severity also re-throws so the
      // calling UI surfaces a loud failure to the operator.
      const isCritical = (evt.severity === 'critical')
      try {
        const mod = await _alq()
        if (mod) await mod.enqueueActivity(evt)
        else console.error('[activity_log web] failed (no queue):', e?.message || e)
      } catch (qe) {
        console.error('[activity_log web] enqueue failed:', qe?.message || qe)
      }
      if (isCritical) throw e
    }
  }

  // ── Server-side role-hierarchy guard (parity with electron/auth-guard.js) ─
  // Renderer can set _webActor via api.activity.setActor, but for security we
  // ALSO re-fetch the actor's role from Supabase on every mutation so a
  // tampered renderer cannot impersonate a higher role.
  const ROLE_LEVEL = { owner: 100, cfo: 70, accountant: 60, manager: 50, cashier: 10, none: 0 }
  const canActOn = (a, t) => (ROLE_LEVEL[a] ?? 0) > (ROLE_LEVEL[t] ?? 0)

  async function resolveActorRole() {
    // Prefer authoritative Supabase lookup via JWT.
    let jwtUserId = null, jwtEmail = null
    try {
      const { data: { user } = {} } = await supabase.auth.getUser()
      if (user?.id) {
        jwtUserId = user.id; jwtEmail = user.email || null
        // 1) Direct auth_user_id match on staff (strongest signal).
        const { data: row } = await supabase.from('staff')
          .select('id,name,role,username').eq('auth_user_id', user.id).eq('business_id', bid).maybeSingle()
        if (row) return { id: row.id, name: row.name, role: row.role, username: row.username, jwtUserId, jwtEmail }
        // 2) Username==email-local match as a recovery path for staff rows with NULL auth_user_id.
        //    Intentionally NOT falling back to businesses.owner_id — ownership auth_user_id can be
        //    shared with a non-owner staff row (e.g. admin@ account used by a manager).
        if (user.email) {
          const local = String(user.email).split('@')[0].toLowerCase()
          const { data: byName } = await supabase.from('staff')
            .select('id,name,role,username').eq('business_id', bid).eq('active', true)
            .or(`username.eq.${local},email.eq.${user.email}`).limit(2)
          if (byName && byName.length === 1) {
            return { id: byName[0].id, name: byName[0].name, role: byName[0].role, username: byName[0].username, jwtUserId, jwtEmail }
          }
        }
      }
    } catch {}
    // Fallback to renderer-supplied actor (still enforced — just weaker).
    if (_webActor) return { ..._webActor, jwtUserId, jwtEmail }
    return null
  }

  async function fetchTargetRole(id) {
    try {
      const { data } = await supabase.from('staff').select('id,name,username,role')
        .eq('id', id).eq('business_id', bid).maybeSingle()
      return data || null
    } catch { return null }
  }

  async function denyAndLog(op, reason, ctx = {}) {
    const actor = await resolveActorRole()
    await logActivity({
      event_type: 'permission_denied', severity: 'warn',
      actor_supabase_id: actor?.id && typeof actor.id === 'string' && actor.id.includes('-') ? actor.id : null,
      actor_name: actor?.name || null, actor_role: actor?.role || null,
      target_type: ctx.target_type || null,
      target_id:   ctx.target_id != null ? String(ctx.target_id) : null,
      target_name: ctx.target_name || null,
      reason,
      metadata: {
        attempted_op: op,
        source: 'web',
        resolved_role: actor?.role || null,
        resolved_username: actor?.username || null,
        jwt_user_id: actor?.jwtUserId || null,
        jwt_email: actor?.jwtEmail || null,
        actor_source: actor ? (actor.jwtUserId && actor.username ? 'staff_lookup' : 'renderer_fallback') : 'none',
      },
    })
    throw new Error(reason)
  }

  /** Enforce: actor can act on target user. Self-edits of role/active blocked. */
  async function guardUserMutation(op, patch) {
    const actor = await resolveActorRole()
    if (!actor) return denyAndLog(op, 'No hay usuario activo')
    const targetId = patch?.id
    if (!targetId) {
      // Create path — only owner/manager allowed, and new role cannot be >= actor
      if (!['owner', 'manager'].includes(actor.role)) return denyAndLog(op, 'Solo owner/manager pueden crear usuarios')
      if (patch?.role && (ROLE_LEVEL[patch.role] ?? 0) >= (ROLE_LEVEL[actor.role] ?? 0) && actor.role !== 'owner') {
        return denyAndLog(op, 'Solo el propietario puede asignar este rol')
      }
      return
    }
    const target = await fetchTargetRole(targetId)
    if (!target) return denyAndLog(op, 'Usuario no encontrado', { target_type: 'user', target_id: targetId })
    const ctx = { target_type: 'user', target_id: targetId, target_name: `${target.name} (@${target.username})` }
    const self = String(actor.id) === String(target.id)
    if (op.endsWith(':delete') || op.endsWith(':delete-hard')) {
      if (self) return denyAndLog(op, 'No puedes eliminar tu propia cuenta', ctx)
      if (!canActOn(actor.role, target.role)) return denyAndLog(op, 'No tienes permiso para eliminar este usuario', ctx)
      if (op.endsWith(':delete-hard') && actor.role !== 'owner') return denyAndLog(op, 'Solo el propietario puede eliminar usuarios permanentemente', ctx)
      return
    }
    // update
    const changingRole   = 'role'   in patch && patch.role   !== target.role
    const changingActive = 'active' in patch && Boolean(patch.active) !== true // self-deactivation
    if (self) {
      if (changingRole)   return denyAndLog(op, 'No puedes cambiar tu propio rol', ctx)
      if (changingActive) return denyAndLog(op, 'No puedes desactivar tu propia cuenta', ctx)
      return
    }
    if (!canActOn(actor.role, target.role)) return denyAndLog(op, 'No tienes permiso para modificar este usuario', ctx)
    if (patch.role && (ROLE_LEVEL[patch.role] ?? 0) >= (ROLE_LEVEL[actor.role] ?? 0) && actor.role !== 'owner') {
      return denyAndLog(op, 'Solo el propietario puede asignar este rol', ctx)
    }
  }

  async function requireOwnerOrManager(op) {
    const actor = await resolveActorRole()
    if (!actor) return denyAndLog(op, 'No hay usuario activo')
    if (!['owner', 'manager'].includes(actor.role)) return denyAndLog(op, `Solo owner/manager pueden ejecutar ${op}`)
  }
  async function requireOwner(op) {
    const actor = await resolveActorRole()
    if (!actor) return denyAndLog(op, 'No hay usuario activo')
    if (actor.role !== 'owner') return denyAndLog(op, `Solo el propietario puede ejecutar ${op}`)
  }

  const api = {

    // ── Activity log ─────────────────────────────────────────────────────────
    activity: {
      setActor: (user) => { _webActor = user ? { id: user.id, name: user.name, role: user.role } : null },
      record: (evt) => logActivity(evt),
      // v2.16.2 — alias so platform-agnostic callers (DealBuilder, etc.) can use
      // `api.activity.log(evt)` uniformly. Desktop adapter mirrors this in electron.js.
      log:    (evt) => logActivity(evt),
      permissionDenied: ({ action, requiredRole, currentRole, reason } = {}) => logActivity({
        event_type: 'permission_denied',
        severity: 'warn',
        target_type: 'action',
        target_id: action || null,
        reason: reason || `required=${requiredRole || '?'} current=${currentRole || '?'}`,
        metadata: { action, requiredRole, currentRole },
      }),
      list: ({ dateFrom, dateTo, eventTypes, limit = 200 } = {}) => tryOr(async () => {
        let q = supabase.from('activity_log').select('*').eq('business_id', bid)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        if (Array.isArray(eventTypes) && eventTypes.length) q = q.in('event_type', eventTypes)
        q = q.order('created_at', { ascending: false }).limit(Math.min(Number(limit) || 200, 1000))
        return throwSupaError(await q)
      }, []),
    },


    // ── Admin panel ──────────────────────────────────────────────────────────

    admin: {
      getEmpresa: () => tryOr(async () => {
        const { data } = await supabase.from('businesses').select('id,name,rnc,address,phone,email,logo_url,settings,mora_rate_daily').eq('id', bid).single()
        if (data) data.logo = data.logo_url  // map to desktop field name
        // Resolve the active license plan so usePlan() unlocks the right
        // features on web. Without this, web sessions default to 'pro' even
        // when the business is on Pro PLUS / Pro MAX — every owner appears
        // limited regardless of what they're paying for.
        try {
          const { data: lic } = await supabase.from('licenses')
            .select('plan_id, status, expires_at, plans(name)')
            .eq('business_id', bid).eq('status', 'active')
            .order('expires_at', { ascending: false })
            .limit(1).maybeSingle()
          const planName = lic?.plans?.name
          if (planName && data) data.plan = planName
        } catch {}
        return data
      }, null),

      saveEmpresa: (data) => tryWrite(async () => {
        // v2.16.28 (B4) — `website` was silently dropped: caller passed
        // `biz_website` but allowed-list only accepted unprefixed `website`,
        // and even then `businesses` table has no website column (lives in
        // settings.biz_website). The Admin handleSave now folds it into
        // settings JSONB before calling here, so this allowed-list just
        // needs to mirror the real columns of `businesses` + the catch-all
        // `settings`. Switched from tryOr → tryWrite so a 0-row UPDATE
        // (RLS denial, wrong business id) surfaces as a thrown error
        // instead of silent success.
        const allowed = ['name', 'rnc', 'address', 'phone', 'email', 'logo', 'logo_url', 'settings', 'mora_rate_daily']
        const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
        // Map `logo` → `logo_url` (Supabase column name differs from desktop)
        if ('logo' in patch) { patch.logo_url = patch.logo; delete patch.logo }
        if (!Object.keys(patch).length) return null
        throwSupaError(await supabase.from('businesses').update(patch).eq('id', bid).select('id'))
      }),

      getUsuarios: () => tryOr(async () => {
        return throwSupaError(await supabase.from('staff').select('id,name,username,role,discount_pct,active').eq('business_id', bid).order('id'))
      }, []),

      saveUsuario: (data) => tryWrite(async () => {
        if (data.id) {
          const { pin, id, ...rest } = data
          if (pin) {
            const creds = await hashPin(pin)
            Object.assign(rest, creds, { pin_failed_attempts: 0, pin_locked_until: null })
          }
          if ('active' in rest) rest.active = !!rest.active
          throwSupaError(await supabase.from('staff').update(rest).eq('id', id).eq('business_id', bid))
          return { id }
        }
        if (!data.pin) throw new Error('PIN requerido')
        const creds = await hashPin(data.pin)
        const { pin: _p, ...rest } = data
        if ('active' in rest) rest.active = !!rest.active
        const row = throwSupaError(await supabase.from('staff').insert({
          id: crypto.randomUUID(), supabase_id: crypto.randomUUID(),
          ...rest, ...creds,
          business_id: bid, active: rest.active !== false,
        }).select('id').single())
        return row
      }, 'web.admin.saveUsuario'),

      deleteUsuario: ({ id }) => tryWrite(async () => {
        throwSupaError(await supabase.from('staff').update({ active: false }).eq('id', id).eq('business_id', bid))
      }, 'web.admin.deleteUsuario'),

      getLavadores: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('empleados').select('id, supabase_id, nombre, comision_pct, active, cedula, phone, start_date').eq('business_id', bid).in('tipo', ['lavador', 'hybrid']).eq('active', true).neq('role', 'owner').order('nombre'))
        return (rows || []).map(r => ({ ...r, name: r.nombre, commission_pct: r.comision_pct }))
      }, []),

      saveLavador: (data) => tryWrite(async () => {
        const payload = {
          nombre: data.name ?? data.nombre,
          comision_pct: data.commission_pct ?? data.comision_pct ?? 20,
          cedula: data.cedula ?? null,
          phone: data.phone ?? null,
          start_date: data.start_date ?? null,
          tipo: data.tipo || 'lavador',
        }
        if ('active' in data) payload.active = !!data.active
        if (data.id) {
          throwSupaError(await supabase.from('empleados').update(payload).eq('id', data.id).eq('business_id', bid))
          return { id: data.id }
        }
        const row = throwSupaError(await supabase.from('empleados').insert({ ...payload, supabase_id: crypto.randomUUID(), business_id: bid, role: 'none', active: true }).select('id').single())
        return row
      }, 'web.admin.saveLavador'),

      deleteLavador: ({ id }) => tryWrite(async () => {
        throwSupaError(await supabase.from('empleados').update({ active: false }).eq('id', id).eq('business_id', bid))
      }, 'web.admin.deleteLavador'),

      getVendedores: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('empleados').select('id, supabase_id, nombre, comision_pct, active, cedula, phone, start_date').eq('business_id', bid).in('tipo', ['vendedor', 'hybrid']).eq('active', true).neq('role', 'owner').order('nombre'))
        return (rows || []).map(r => ({ ...r, name: r.nombre, commission_pct: r.comision_pct }))
      }, []),

      saveVendedor: (data) => tryWrite(async () => {
        const payload = {
          nombre: data.name ?? data.nombre,
          comision_pct: data.commission_pct ?? data.comision_pct ?? 5,
          phone: data.phone ?? null,
          tipo: data.tipo || 'vendedor',
        }
        if ('active' in data) payload.active = !!data.active
        if (data.id) {
          throwSupaError(await supabase.from('empleados').update(payload).eq('id', data.id).eq('business_id', bid))
          return { id: data.id }
        }
        const row = throwSupaError(await supabase.from('empleados').insert({ ...payload, supabase_id: crypto.randomUUID(), business_id: bid, role: 'none', active: true }).select('id').single())
        return row
      }, 'web.admin.saveVendedor'),

      deleteVendedor: ({ id }) => tryWrite(async () => {
        throwSupaError(await supabase.from('empleados').update({ active: false }).eq('id', id).eq('business_id', bid))
      }, 'web.admin.deleteVendedor'),

      getServicios: () => tryOr(async () => {
        return throwSupaError(await supabase.from('services').select('*').eq('business_id', bid).order('category').order('sort_order').order('id'))
      }, []),

      saveServicio: (data) => tryWrite(async () => {
        if (data.id) {
          const { id, ...rest } = data
          // Coerce booleans for bool columns
          for (const k of ['active','no_commission','commission_washer','commission_seller','commission_cashier','is_wash','aplica_itbis']) {
            if (k in rest) rest[k] = !!rest[k]
          }
          throwSupaError(await supabase.from('services').update(rest).eq('id', id).eq('business_id', bid))
          return { id }
        }
        const row = throwSupaError(await supabase.from('services').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id').single())
        return row
      }, 'web.admin.saveServicio'),

      deleteServicio: ({ id }) => tryWrite(async () => {
        throwSupaError(await supabase.from('services').update({ active: false }).eq('id', id).eq('business_id', bid))
      }, 'web.admin.deleteServicio'),

      getCategorias: () => tryOr(async () => {
        return throwSupaError(await supabase.from('categorias_servicio').select('*').eq('business_id', bid).order('orden').order('nombre'))
      }, []),

      getSecuenciasNcf: () => tryOr(async () => {
        return throwSupaError(await supabase.from('ncf_sequences').select('*').eq('business_id', bid).order('type'))
      }, []),

      saveSecuenciaNcf: (data) => tryWrite(async () => {
        if (data.type) {
          const row = { ...data, business_id: bid }
          if (!row.supabase_id) row.supabase_id = crypto.randomUUID()
          throwSupaError(await supabase.from('ncf_sequences').upsert(row, { onConflict: 'business_id,type' }))
        }
      }, 'web.admin.saveSecuenciaNcf'),

      getConfiguracion: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('configuracion').select('clave,valor').eq('business_id', bid))
        return Object.fromEntries((rows || []).map(r => [r.clave, r.valor]))
      }, {}),

      saveConfiguracion: (data) => tryWrite(async () => {
        const entries = Object.entries(data)
        for (const [clave, valor] of entries) {
          throwSupaError(await supabase.from('configuracion').upsert(
            { business_id: bid, clave, valor: String(valor), supabase_id: crypto.randomUUID() },
            { onConflict: 'business_id,clave' }
          ))
        }
      }, 'web.admin.saveConfiguracion'),
    },

    // ── Settings ─────────────────────────────────────────────────────────────

    settings: {
      // get() merges:
      //   1) BUSINESS-level keys from Supabase app_settings (cloud-synced,
      //      `is_device_local=false` only — device-local cash register rows
      //      are for desktop recovery, never for a browser).
      //   2) DEVICE-local keys from localStorage (per-browser).
      // Desktop defaults fill any gaps so the UI always sees defined strings.
      get: () => tryOr(async () => {
        const rows = throwSupaError(
          await supabase.from('app_settings')
            .select('key,value')
            .eq('business_id', bid)
            .eq('is_device_local', false)
        )
        const business = Object.fromEntries((rows || []).map(r => [r.key, r.value]))
        return { ...webDeviceAll(), ...business }
      }, webDeviceAll()),

      // update() splits writes by whitelist:
      //   - business keys               -> Supabase (synced to all devices)
      //   - device-local cloud-mirror   -> localStorage (web has no stable HWID;
      //                                    cash registers handle their own cloud
      //                                    mirroring via desktop sync)
      //   - device-only keys            -> localStorage
      //   - unknown keys                -> localStorage (safe default)
      update: (obj) => tryWrite(async () => {
        const cloudUpserts = []
        for (const [key, value] of Object.entries(obj)) {
          if (isBusinessSetting(key)) {
            cloudUpserts.push({
              business_id: bid,
              key,
              value: String(value),
              is_device_local: false,
              device_hwid: null,
              supabase_id: (crypto?.randomUUID?.() || undefined),
            })
          } else if (isDeviceSetting(key)) {
            webDeviceSet(key, value)
          } else {
            try { console.warn('[web settings] unknown key treated as device-local:', key) } catch {}
            webDeviceSet(key, value)
          }
        }
        if (cloudUpserts.length) {
          // v2.10.5: on_conflict targets the supabase_id unique constraint —
          // safest option now that (business_id,key) is a PARTIAL index
          // (WHERE device_hwid IS NULL). We generate fresh UUIDs above; to
          // avoid duplicating a row on a re-save, prefer an update-if-exists
          // fallback by key first.
          for (const row of cloudUpserts) {
            const existing = throwSupaError(
              await supabase.from('app_settings')
                .select('id,supabase_id')
                .eq('business_id', bid)
                .eq('key', row.key)
                .is('device_hwid', null)
                .maybeSingle()
            )
            if (existing?.id) {
              throwSupaError(
                await supabase.from('app_settings')
                  .update({ value: row.value, is_device_local: false, device_hwid: null })
                  .eq('id', existing.id)
              )
            } else {
              throwSupaError(await supabase.from('app_settings').insert(row))
            }
          }
        }
      }, 'web.settings.update'),
    },

    // ── Inventory ────────────────────────────────────────────────────────────

    inventory: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('inventory_items').select('*').eq('business_id', bid).eq('active', true).order('name'))
      }, []),

      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('inventory_items').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }).select('id').single())
        return row.id
      }, 'web.inventory.create'),

      update: (data) => tryWrite(async () => {
        const { id, ...rest } = data
        // v2.14.35 — strip `quantity` so stock changes can only flow through
        // inventory.adjust() (which writes the inventory_transactions ledger).
        // Mirrors the desktop ALLOWED list. Edits that need to change qty
        // must call api.inventory.adjust() explicitly.
        if ('quantity' in rest) delete rest.quantity
        // Normalize price_pedidos_ya: blank string → null so Supabase stores NULL
        if ('price_pedidos_ya' in rest) {
          rest.price_pedidos_ya = (rest.price_pedidos_ya === '' || rest.price_pedidos_ya == null)
            ? null : Number(rest.price_pedidos_ya)
        }
        rest.updated_at = new Date().toISOString()
        if (!Object.keys(rest).filter(k => k !== 'updated_at').length) return
        throwSupaError(await supabase.from('inventory_items').update(rest).eq('id', id).eq('business_id', bid))
      }, 'web.inventory.update'),

      bulkUpdate: (ids, patch) => tryWrite(async () => {
        if (!Array.isArray(ids) || !ids.length || !patch || !Object.keys(patch).length) return 0
        const clean = { ...patch }
        // v2.14.35 — same audit-trail rule as inventory.update(). Quantity
        // changes go through .adjust() only.
        if ('quantity' in clean) delete clean.quantity
        if ('price_pedidos_ya' in clean) {
          clean.price_pedidos_ya = (clean.price_pedidos_ya === '' || clean.price_pedidos_ya == null)
            ? null : Number(clean.price_pedidos_ya)
        }
        clean.updated_at = new Date().toISOString()
        throwSupaError(await supabase.from('inventory_items').update(clean).in('id', ids).eq('business_id', bid))
        return ids.length
      }, 'web.inventory.bulkUpdate'),

      delete: (data) => tryWrite(async () => {
        const id = typeof data === 'object' ? data.id : data
        throwSupaError(await supabase.from('inventory_items').update({ active: false }).eq('id', id).eq('business_id', bid))
      }, 'web.inventory.delete'),

      adjust: ({ id, supabase_id, delta, notes, userId }) => tryWrite(async () => {
        // Accept either integer id or uuid supabase_id — web-created tickets
        // store inventory_item_supabase_id but leave inventory_item_id null,
        // so callers like Returns.jsx need both lookup paths.
        if (!id && !supabase_id) throw new Error('inventory.adjust: missing id and supabase_id')
        const lookupCol = id ? 'id' : 'supabase_id'
        const lookupVal = id || supabase_id
        const current = throwSupaError(await supabase.from('inventory_items').select('id, quantity, supabase_id, name').eq(lookupCol, lookupVal).eq('business_id', bid).single())
        const newQty = Math.max(0, (current.quantity || 0) + delta)
        throwSupaError(await supabase.from('inventory_items').update({ quantity: newQty }).eq('id', current.id).eq('business_id', bid))
        await logActivity({ event_type: 'inventory_adjusted', severity: 'info',
          target_type: 'inventory_item', target_id: current.id, target_name: current?.name || `#${current.id}`,
          amount: delta,
          old_value: current?.quantity != null ? String(current.quantity) : null,
          new_value: String(newQty),
          reason: notes || null })
        // Log the adjustment in inventory_transactions (non-blocking — stock already updated)
        try {
          await supabase.from('inventory_transactions').insert({
            supabase_id: crypto.randomUUID(),
            item_id: current.id,
            item_supabase_id: current.supabase_id || null,
            type: delta > 0 ? 'adjustment_in' : 'adjustment_out',
            delta,
            notes: notes || null,
            user_id: userId || null,
            business_id: bid,
          })
        } catch (err) {
          try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'warn', category: 'web.inventory.adjustment_log', extra: { item_id: current?.id, delta, business_id: bid } }) } catch {}
        }
        return newQty
      }),

      transactions: ({ id }) => tryOr(async () => {
        const rows = throwSupaError(
          await supabase.from('inventory_transactions').select('*')
            .eq('item_id', id).order('created_at', { ascending: false }).limit(50)
        ) || []
        await attachRel(supabase, rows, { fkCol: 'user_supabase_id', targetTable: 'staff', targetKey: 'supabase_id', selectCols: 'name', asKey: 'staff', businessId: bid })
        return rows
      }, []),

      lowStockCount: () => tryOr(async () => {
        // Supabase can't compare column-to-column with .lte(), so fetch and filter client-side
        const items = throwSupaError(await supabase.from('inventory_items')
          .select('quantity, min_quantity')
          .eq('business_id', bid).eq('active', true))
        return (items || []).filter(i => i.quantity <= (i.min_quantity || 5)).length
      }, 0),

      lookupSku: (sku) => tryOr(async () => {
        if (!sku) return null
        const safe = String(sku).replace(/[,.()"'\\]/g, '')
        const { data } = await supabase.from('inventory_items').select('*')
          .eq('business_id', bid).eq('active', true)
          .or(`sku.eq."${safe}",barcode.eq."${safe}"`)
          .limit(1).maybeSingle()
        return data || null
      }),

      search: (query) => tryOr(async () => {
        if (!query) return []
        const safe = String(query).replace(/[%_,.()"'\\]/g, '')
        return throwSupaError(
          await supabase.from('inventory_items').select('*')
            .eq('business_id', bid).eq('active', true)
            .or(`name.ilike."%${safe}%",sku.ilike."%${safe}%",barcode.ilike."%${safe}%",category.ilike."%${safe}%"`)
            .order('name').limit(20)
        )
      }, []),

      // v2.11.2 — Shortage ledger. Mirrors desktop inventoryOversellsList with
      // the same return shape. Tickets / inventory_items are joined client-side
      // because PostgREST embedded joins require FK declarations we don't keep
      // on inventory_oversells (its keys are supabase_id text, not id FKs).
      oversells: {
        list: ({ from, to, itemId, itemSupabaseId } = {}) => tryOr(async () => {
          let q = supabase.from('inventory_oversells').select('*').eq('business_id', bid)
          if (from) q = q.gte('detected_at', from)
          if (to)   q = q.lte('detected_at', to)
          if (itemSupabaseId) q = q.eq('item_supabase_id', itemSupabaseId)
          q = q.order('detected_at', { ascending: false }).limit(2000)
          const rows = throwSupaError(await q) || []
          if (!rows.length) return []
          const itemSids   = [...new Set(rows.map(r => r.item_supabase_id).filter(Boolean))]
          const ticketSids = [...new Set(rows.map(r => r.ticket_supabase_id).filter(Boolean))]
          const itemMap = {}, ticketMap = {}
          if (itemSids.length) {
            const items = throwSupaError(await supabase.from('inventory_items')
              .select('id, supabase_id, name, sku').eq('business_id', bid).in('supabase_id', itemSids)) || []
            for (const it of items) itemMap[it.supabase_id] = it
          }
          if (ticketSids.length) {
            const tks = throwSupaError(await supabase.from('tickets')
              .select('id, supabase_id, ncf, comprobante_type, total, created_at')
              .eq('business_id', bid).in('supabase_id', ticketSids)) || []
            for (const t of tks) ticketMap[t.supabase_id] = t
          }
          // itemId (numeric id) filter applied client-side so web matches
          // desktop semantics even though web rows address by supabase_id.
          let out = rows.map(r => {
            const it = itemMap[r.item_supabase_id] || null
            const tk = ticketMap[r.ticket_supabase_id] || null
            return {
              id:                 r.id,
              supabase_id:        r.supabase_id,
              ticket_supabase_id: r.ticket_supabase_id,
              item_supabase_id:   r.item_supabase_id,
              item_name:          it?.name || r.item_name || null,
              sku:                it?.sku || null,
              inventory_item_id:  it?.id || null,
              requested_qty:      Number(r.requested_qty) || 0,
              actual_qty:         Number(r.actual_qty) || 0,
              shortage_qty:       (Number(r.requested_qty) || 0) - (Number(r.actual_qty) || 0),
              detected_at:        r.detected_at,
              resolved_at:        r.resolved_at,
              resolution_type:    r.resolution_type,
              resolution_notes:   r.resolution_notes,
              ticket_id:          tk?.id || null,
              doc_number:         tk?.ncf || null,
              comprobante_type:   tk?.comprobante_type || null,
              ticket_total:       tk?.total || null,
              ticket_created_at:  tk?.created_at || null,
            }
          })
          if (itemId != null && !itemSupabaseId) out = out.filter(r => r.inventory_item_id === Number(itemId))
          return out
        }, []),
        // v2.14.35 — mark an oversell row resolved from web. resolution_type:
        // 'manual' | 'voided' | 'restocked' | 'adjusted'. Web users see an
        // "Acknowledge" button that writes resolution_type='manual'.
        resolve: ({ id, supabase_id, resolution_type = 'manual', notes = null, resolved_by = null, resolved_by_name = null }) => tryWrite(async () => {
          const target = supabase_id ? { supabase_id } : { id: Number(id) }
          throwSupaError(
            await supabase.from('inventory_oversells').update({
              resolved_at: new Date().toISOString(),
              resolution_type,
              resolution_notes: notes,
              resolved_by: resolved_by,
              resolved_by_name: resolved_by_name,
            }).match({ business_id: bid, ...target })
          )
          return { ok: true }
        }),
      },
    },

    // ── Conteo Fisico (v2.5) ────────────────────────────────────────────────
    // Mirrors the Electron inventoryCount namespace. Supabase has GENERATED
    // variance_* columns — never send them in inserts/updates; always read them
    // back from SELECT so the UI renders the same numbers on web and desktop.
    inventoryCount: {
      start: ({ title, counted_by_name, notes, categories } = {}) => tryWrite(async () => {
        const sid = crypto.randomUUID()
        const nowIso = new Date().toISOString()
        const headerTitle = (title && String(title).trim()) ||
          `Conteo Fisico ${new Date().toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })}`
        // v2.14 — category pre-scope (optional). Null/empty = all active items.
        // Supabase client-side filter: fetch full list then narrow in JS so
        // "(sin categoria)" (null/blank) can be handled alongside named cats
        // without writing two queries.
        const catList = Array.isArray(categories) ? categories.filter(c => c != null).map(String) : null
        let itemsQ = supabase.from('inventory_items')
          .select('supabase_id, sku, name, category, quantity, cost, price')
          .eq('business_id', bid).eq('active', true)
          .order('category').order('name')
        const rawItems = throwSupaError(await itemsQ) || []
        let items = rawItems
        if (catList && catList.length) {
          const wantBlank = catList.some(c => c === '(sin categoria)' || c === 'Sin categoria')
          const named = new Set(catList.filter(c => c !== '(sin categoria)' && c !== 'Sin categoria'))
          items = rawItems.filter(it => {
            const k = (it.category || '').trim()
            if (!k) return wantBlank
            return named.has(it.category)
          })
        }
        const header = throwSupaError(await supabase.from('inventory_counts').insert({
          supabase_id: sid, business_id: bid,
          title: headerTitle, started_at: nowIso,
          counted_by_name: counted_by_name || null,
          status: 'abierto', notes: notes || null,
          total_expected_value: 0, total_counted_value: 0, total_variance_value: 0,
          created_at: nowIso, updated_at: nowIso,
        }).select('*').single())
        if (items.length) {
          const rows = items.map(it => ({
            supabase_id: crypto.randomUUID(), business_id: bid,
            count_supabase_id: sid,
            inventory_item_supabase_id: it.supabase_id,
            sku: it.sku || null, name: it.name, category: it.category || null,
            expected_qty: Number(it.quantity) || 0,
            counted_qty: null,
            unit_cost: Number(it.cost) || 0,
            unit_price: Number(it.price) || 0,
            created_at: nowIso, updated_at: nowIso,
          }))
          // Insert in chunks of 500 to avoid PostgREST row-size caps.
          for (let i = 0; i < rows.length; i += 500) {
            throwSupaError(await supabase.from('inventory_count_items').insert(rows.slice(i, i + 500)))
          }
        }
        // Prime header rollup so the UI shows correct totals before any count.
        await refreshCountTotals(supabase, bid, sid)
        return await fetchCount(supabase, bid, header.id)
      }, 'web.inventoryCount.start'),

      list: ({ limit = 50 } = {}) => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('inventory_counts')
          .select('*').eq('business_id', bid)
          .order('started_at', { ascending: false })
          .limit(Math.min(Number(limit) || 50, 500))) || []
        if (!rows.length) return []
        // Attach items_count + counted_count via grouped HEAD counts. One
        // round-trip per row would be N+1; do a single select of count rows and
        // reduce client-side.
        const sids = rows.map(r => r.supabase_id).filter(Boolean)
        const counts = {}
        if (sids.length) {
          const ii = throwSupaError(await supabase.from('inventory_count_items')
            .select('count_supabase_id, counted_qty')
            .eq('business_id', bid).in('count_supabase_id', sids)) || []
          for (const x of ii) {
            const k = x.count_supabase_id
            if (!counts[k]) counts[k] = { items_count: 0, counted_count: 0 }
            counts[k].items_count++
            if (x.counted_qty !== null && x.counted_qty !== undefined) counts[k].counted_count++
          }
        }
        return rows.map(r => ({ ...r, ...(counts[r.supabase_id] || { items_count: 0, counted_count: 0 }) }))
      }, [], 'web.inventoryCount.list'),

      get: (idOrSid) => tryOr(async () => fetchCount(supabase, bid, idOrSid), null, 'web.inventoryCount.get'),

      saveItem: ({ count_supabase_id, inventory_item_supabase_id, counted_qty, notes }) => tryWrite(async () => {
        if (!count_supabase_id || !inventory_item_supabase_id) throw new Error('missing_key')
        const qty = (counted_qty === null || counted_qty === '' || counted_qty === undefined) ? null : Number(counted_qty)
        if (qty != null && (!Number.isFinite(qty) || qty < 0)) throw new Error('Cantidad invalida')
        const patch = { counted_qty: qty, updated_at: new Date().toISOString() }
        if (notes != null) patch.notes = notes
        throwSupaError(await supabase.from('inventory_count_items').update(patch)
          .eq('business_id', bid)
          .eq('count_supabase_id', count_supabase_id)
          .eq('inventory_item_supabase_id', inventory_item_supabase_id))
        await refreshCountTotals(supabase, bid, count_supabase_id)
        return true
      }, 'web.inventoryCount.saveItem'),

      complete: ({ id, apply_to_inventory = true, signature_dataurl = null } = {}) => tryWrite(async () => {
        if (!id) throw new Error('missing_id')
        // inventory_counts.id and supabase_id are BOTH uuid — match either.
        const sval = typeof id === 'string' ? id : String(id)
        const header = throwSupaError(await supabase.from('inventory_counts').select('*').eq('business_id', bid)
          .or(`id.eq.${sval},supabase_id.eq.${sval}`)
          .maybeSingle())
        if (!header) throw new Error('count_not_found')
        if (header.status !== 'abierto') throw new Error('count_not_open')
        const countSid = header.supabase_id
        const nowIso = new Date().toISOString()

        // Fetch counted rows to apply + build metadata snapshot in one pass.
        const countedRaw = throwSupaError(await supabase.from('inventory_count_items')
          .select('inventory_item_supabase_id, sku, name, category, expected_qty, counted_qty, unit_cost, unit_price, variance_qty, variance_cost')
          .eq('business_id', bid).eq('count_supabase_id', countSid)
          .not('counted_qty', 'is', null)) || []

        // v2.14 — Subtract sales-during-count so variance is TRUE shrinkage.
        const soldMap = new Map()
        try {
          const { data: tix = [] } = await supabase.from('tickets')
            .select('supabase_id').eq('business_id', bid)
            .gte('created_at', header.started_at).lte('created_at', nowIso)
            .neq('status', 'anulado')
          const tixSids = (tix || []).map(t => t.supabase_id).filter(Boolean)
          for (let i = 0; i < tixSids.length; i += 500) {
            const chunk = tixSids.slice(i, i + 500)
            const { data: rows = [] } = await supabase.from('ticket_items')
              .select('inventory_item_supabase_id, quantity')
              .eq('business_id', bid).in('ticket_supabase_id', chunk)
              .not('inventory_item_supabase_id', 'is', null)
            for (const r of (rows || [])) {
              const k = r.inventory_item_supabase_id
              if (!k) continue
              soldMap.set(k, (soldMap.get(k) || 0) + (Number(r.quantity) || 1))
            }
          }
        } catch {}
        const counted = countedRaw.map(r => {
          const exp = Number(r.expected_qty) || 0
          const sold = soldMap.get(r.inventory_item_supabase_id) || 0
          const adj = exp - sold
          const cnt = Number(r.counted_qty) || 0
          const varQty = cnt - adj
          return { ...r, sold_during_count: sold, adj_expected_qty: adj, variance_qty: varQty, variance_cost: varQty * (Number(r.unit_cost) || 0) }
        })

        if (apply_to_inventory) {
          // Individual UPDATEs — Supabase has no atomic bulk-set-by-value.
          // Bounded by active SKU count (Ranoza ~= 976). Run sequential so the
          // RLS policy check path doesn't fan out to thousands of parallel JWT
          // validations on the Vercel edge.
          for (const r of counted) {
            await supabase.from('inventory_items')
              .update({ quantity: Number(r.counted_qty) || 0, updated_at: nowIso })
              .eq('business_id', bid).eq('supabase_id', r.inventory_item_supabase_id)
          }
        }
        throwSupaError(await supabase.from('inventory_counts').update({
          status: 'completado', completed_at: nowIso, updated_at: nowIso,
          ...(signature_dataurl ? { signature_dataurl } : {}),
        }).eq('business_id', bid).eq('supabase_id', countSid))

        const totals = await refreshCountTotals(supabase, bid, countSid)
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
        await logActivity({
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
        return { ok: true, totals, severity, topLosses }
      }, 'web.inventoryCount.complete'),

      cancel: (id) => tryWrite(async () => {
        const nowIso = new Date().toISOString()
        // inventory_counts.id and supabase_id are BOTH uuid — match either.
        const sval = typeof id === 'string' ? id : String(id)
        throwSupaError(await supabase.from('inventory_counts').update({
          status: 'cancelado', completed_at: nowIso, updated_at: nowIso,
        }).eq('business_id', bid).or(`id.eq.${sval},supabase_id.eq.${sval}`).eq('status', 'abierto'))
        return true
      }, 'web.inventoryCount.cancel'),

      delete: (id) => tryWrite(async () => {
        // inventory_counts.id and supabase_id are BOTH uuid — match either.
        const sval = typeof id === 'string' ? id : String(id)
        const header = throwSupaError(await supabase.from('inventory_counts').select('supabase_id').eq('business_id', bid)
          .or(`id.eq.${sval},supabase_id.eq.${sval}`)
          .maybeSingle())
        if (!header) return false
        // Delete items first — no ON DELETE CASCADE on Supabase to avoid
        // accidentally wiping historical counts on header edits.
        throwSupaError(await supabase.from('inventory_count_items').delete()
          .eq('business_id', bid).eq('count_supabase_id', header.supabase_id))
        throwSupaError(await supabase.from('inventory_counts').delete()
          .eq('business_id', bid).eq('supabase_id', header.supabase_id))
        return true
      }, 'web.inventoryCount.delete'),
    },

    // ── Auth ─────────────────────────────────────────────────────────────────

    auth: {
      // Sprint 10 — bcrypt + legacy SHA-256 fallback + per-row 5-attempt /
      // 5-min lockout. Supabase-side enforcement mirrors desktop behaviour so
      // web and desktop cashiers hit the exact same policy.
      //
      // Flow:
      //   1. Pull every active, unlocked staff row for this business.
      //   2. For each row: if pin_hash_algo='bcrypt', bcryptjs.compareSync;
      //      else legacy SHA-256 eq. First hit wins (deterministic sort).
      //   3. On hit: reset counters + opportunistic rehash to bcrypt.
      //   4. On miss: increment pin_failed_attempts on every row we tried;
      //      any row crossing PIN_MAX_FAILED_ATTEMPTS gets a 5-min lock.
      //
      // Rows with pin_locked_until > now() are excluded from the compare
      // loop AND from the increment set — neither authorised nor penalised.
      byPin: (pin) => tryOr(async () => {
        const nowIso = new Date().toISOString()
        const { data: rows } = await supabase.from('staff')
          .select('id,name,username,role,discount_pct,employee_id,supabase_id,created_at,pin_hash,pin_hash_algo,pin_salt,pin_failed_attempts,pin_locked_until')
          .eq('business_id', bid).eq('active', true)
          .order('employee_id', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: true })

        if (!rows?.length) return null

        const pinStr = String(pin || '').replace(/\D/g, '')
        if (!pinStr) return null
        const legacyHash = await legacySha256Hex(pinStr)

        let matched = null
        const tried = []

        // v2.14.20 — trust the hash FORMAT, not the algo column. Sync drift
        // has repeatedly mis-tagged rows; shape-detect and try both.
        for (const r of rows) {
          if (r.pin_locked_until && r.pin_locked_until > nowIso) continue
          const h = String(r.pin_hash || '')
          const looksBcrypt = h.startsWith('$2') && h.length === 60
          const looksSha256 = /^[0-9a-f]{64}$/.test(h)
          let hit
          if (looksBcrypt)        hit = bcryptComparePinWeb(pinStr, r.pin_salt, r.pin_hash)
          else if (looksSha256)   hit = (r.pin_hash === legacyHash)
          else                    hit = bcryptComparePinWeb(pinStr, r.pin_salt, r.pin_hash) || r.pin_hash === legacyHash
          if (hit) { matched = r; break }
          tried.push(r.id)
        }

        if (matched) {
          const patch = {
            pin_failed_attempts: 0,
            pin_locked_until: null,
            updated_at: nowIso,
          }
          const mh = String(matched.pin_hash || '')
          const isBcrypt = mh.startsWith('$2') && mh.length === 60
          if (!isBcrypt) {
            const newSalt = generatePinSaltWeb()
            patch.pin_hash      = bcryptHashPinWeb(pinStr, newSalt)
            patch.pin_salt      = newSalt
            patch.pin_hash_algo = 'bcrypt'
          } else if (matched.pin_hash_algo !== 'bcrypt') {
            patch.pin_hash_algo = 'bcrypt'
          }
          try {
            await supabase.from('staff').update(patch).eq('id', matched.id).eq('business_id', bid)
          } catch (e) { console.warn('[auth.byPin] rehash/reset failed:', e.message) }
          return {
            id: matched.id, name: matched.name, username: matched.username,
            role: matched.role, discount_pct: matched.discount_pct,
            employee_id: matched.employee_id, supabase_id: matched.supabase_id,
            created_at: matched.created_at,
          }
        }

        // Miss — bump counters, lock over-threshold rows. Done per-row (not
        // a single bulk UPDATE) so CASE-triggered locks are atomic.
        if (tried.length) {
          const lockAt = new Date(Date.now() + PIN_LOCKOUT_MS).toISOString()
          // Fetch current counts for each tried row, compute lock eligibility
          // client-side, issue one UPDATE per row. N is tiny (≤ staff size).
          await Promise.all(tried.map(async rid => {
            try {
              const { data: cur } = await supabase.from('staff')
                .select('pin_failed_attempts').eq('id', rid).eq('business_id', bid).maybeSingle()
              const next = (cur?.pin_failed_attempts || 0) + 1
              const patch = { pin_failed_attempts: next, updated_at: nowIso }
              if (next >= PIN_MAX_FAILED_ATTEMPTS) patch.pin_locked_until = lockAt
              await supabase.from('staff').update(patch).eq('id', rid).eq('business_id', bid)
            } catch (err) {
              try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'web.staff.pin_lockout_patch', extra: { staff_id: rid, business_id: bid } }) } catch {}
            }
          }))
        }

        return null
      }, null),

      lockoutStatus: () => tryOr(async () => {
        const nowIso = new Date().toISOString()
        const { data } = await supabase.from('staff')
          .select('pin_locked_until')
          .eq('business_id', bid).eq('active', true)
          .gt('pin_locked_until', nowIso)
          .order('pin_locked_until', { ascending: true })
          .limit(1)
          .maybeSingle()
        return data ? { locked: true, until: data.pin_locked_until } : { locked: false, until: null }
      }, { locked: false, until: null }),
    },

    // ── Users ────────────────────────────────────────────────────────────────

    users: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('staff').select('id,name,username,role,discount_pct,active').eq('business_id', bid).order('id'))
      }, []),

      create: (data) => tryWrite(async () => {
        await guardUserMutation('users:create', data)
        if (!data.pin) throw new Error('PIN requerido')
        const creds = await hashPin(data.pin)
        const { pin: _p, employee_id, ...rest } = data
        // Web: empleado.id is UUID — staff.employee_id is INT (legacy). Route
        // UUIDs through empleado_supabase_id and leave employee_id null.
        const empIdStr = String(employee_id || '')
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(empIdStr)
        const empFields = isUuid
          ? { empleado_supabase_id: empIdStr }
          : (empIdStr ? { employee_id: Number(empIdStr) || null } : {})
        const row = throwSupaError(await supabase.from('staff').insert({
          id: crypto.randomUUID(), supabase_id: crypto.randomUUID(),
          ...rest, ...empFields, ...creds,
          pin_failed_attempts: 0, pin_locked_until: null,
          discount_pct: rest.discount_pct || 0, business_id: bid, active: true,
        }).select('id').single())
        return row
      }, 'web.users.create'),

      update: (data) => tryWrite(async () => {
        await guardUserMutation('users:update', data)
        const { id, pin, oldPin, actorId: _actorId, employee_id, ...rest } = data
        if (pin) {
          // Sprint 10 (S-H6) — self-PIN changes must verify oldPin. The
          // guardUserMutation above already checked role; the "is this MY
          // row?" test happens here because we need the current hash.
          const actor = await resolveActorRole()
          const isSelf = actor?.id && String(actor.id) === String(id)
          if (isSelf) {
            if (!oldPin) throw new Error('Old PIN required')
            const { data: cur } = await supabase.from('staff')
              .select('pin_hash,pin_hash_algo,pin_salt,pin_locked_until')
              .eq('id', id).eq('business_id', bid).maybeSingle()
            if (!cur) throw new Error('User not found')
            const nowIso = new Date().toISOString()
            if (cur.pin_locked_until && cur.pin_locked_until > nowIso) {
              throw new Error('Account locked')
            }
            const algo = cur.pin_hash_algo || 'sha256'
            const ok = algo === 'bcrypt'
              ? bcryptComparePinWeb(oldPin, cur.pin_salt, cur.pin_hash)
              : cur.pin_hash === await legacySha256Hex(oldPin)
            if (!ok) throw new Error('Old PIN incorrect')
          }
          const creds = await hashPin(pin)
          Object.assign(rest, creds, { pin_failed_attempts: 0, pin_locked_until: null })
        }
        if ('active' in rest) rest.active = !!rest.active
        if (employee_id !== undefined) {
          const empIdStr = String(employee_id || '')
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(empIdStr)
          if (isUuid) { rest.empleado_supabase_id = empIdStr; rest.employee_id = null }
          else if (empIdStr) rest.employee_id = Number(empIdStr) || null
        }
        // v2.2.1 — audit PIN / role changes (security-critical)
        let before = null
        try {
          const snap = await supabase.from('staff').select('name, username, role, pin_hash').eq('id', id).eq('business_id', bid).maybeSingle()
          if (snap?.data) before = snap.data
        } catch {}
        throwSupaError(await supabase.from('staff').update(rest).eq('id', id).eq('business_id', bid))
        if (before) {
          const targetName = `${before.name || ''} (@${before.username || ''})`
          if (rest.pin_hash && rest.pin_hash !== before.pin_hash) {
            await logActivity({ event_type: 'user_pin_changed', severity: 'critical',
              target_type: 'user', target_id: id, target_name: targetName,
              reason: 'PIN reset from Admin/Usuarios' })
          }
          if (rest.role && rest.role !== before.role) {
            await logActivity({ event_type: 'user_role_changed', severity: 'warn',
              target_type: 'user', target_id: id, target_name: targetName,
              old_value: before.role, new_value: rest.role })
          }
        }
      }, 'web.users.update'),

      delete: ({ id }) => tryWrite(async () => {
        await guardUserMutation('users:delete', { id })
        // Soft-delete only — hard-delete resurrects after the next desktop
        // sync push (desktop still has the row locally and upserts it back).
        const snap = await supabase.from('staff').select('name, username').eq('id', id).eq('business_id', bid).maybeSingle()
        const name = snap?.data ? `${snap.data.name} (@${snap.data.username})` : `#${id}`
        throwSupaError(await supabase.from('staff').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        await logActivity({ event_type: 'user_deleted', severity: 'warn', target_type: 'user', target_id: id, target_name: name })
        return { deleted: true }
      }, 'web.users.delete'),

      deleteHard: ({ id }) => tryWrite(async () => {
        await guardUserMutation('users:delete-hard', { id })
        const snap = await supabase.from('staff').select('name, username').eq('id', id).eq('business_id', bid).maybeSingle()
        const name = snap?.data ? `${snap.data.name} (@${snap.data.username})` : `#${id}`
        throwSupaError(await supabase.from('staff').delete().eq('id', id).eq('business_id', bid))
        await logActivity({ event_type: 'user_hard_deleted', severity: 'critical', target_type: 'user', target_id: id, target_name: name, reason: 'force delete from Admin → Usuarios' })
        return { deleted: true, hard: true }
      }, 'web.users.deleteHard'),
    },

    // ── Staff / Manager Authorization Card (v2.6) ────────────────────────────
    // Generate / revoke write the hash directly via the staff table — RLS
    // already scopes to business_id, and we re-guard role client-side. Verify
    // MUST go through the server endpoint because anon JWT can read the table
    // but we don't want the hash travelling over the wire.
    staff: {
      generateAuthCard: (id) => tryWrite(async () => {
        const actor = await resolveActorRole()
        if (!actor || (actor.role !== 'owner' && actor.role !== 'manager')) {
          throw new Error('Solo dueño o gerente pueden emitir tarjetas')
        }
        const target = throwSupaError(await supabase.from('staff')
          .select('id,name,username,role,active').eq('id', id).eq('business_id', bid).maybeSingle())
        if (!target) throw new Error('Usuario no encontrado')
        if (!target.active) throw new Error('Usuario inactivo')
        if (target.role !== 'owner' && target.role !== 'manager') {
          throw new Error('Solo dueño o gerente pueden tener tarjeta')
        }
        const { generateToken, hashToken } = await import('@terminal-x/services/managerAuthToken')
        const token = generateToken()
        const hash  = await hashToken(token)
        const now   = new Date().toISOString()
        throwSupaError(await supabase.from('staff')
          .update({ manager_auth_hash: hash, manager_auth_rotated_at: now, updated_at: now })
          .eq('id', id).eq('business_id', bid))
        await logActivity({ event_type: 'manager_card_rotated', severity: 'warn',
          target_type: 'user', target_id: id, target_name: `${target.name} (@${target.username})`,
          reason: 'Tarjeta de autorización emitida/rotada' })
        return { ok: true, token, rotatedAt: now,
                 user: { id: target.id, name: target.name, username: target.username, role: target.role } }
      }, 'web.users.generateAuthCard'),

      revokeAuthCard: (id) => tryWrite(async () => {
        const actor = await resolveActorRole()
        if (!actor || (actor.role !== 'owner' && actor.role !== 'manager')) {
          throw new Error('Solo dueño o gerente pueden revocar tarjetas')
        }
        const target = throwSupaError(await supabase.from('staff')
          .select('id,name,username').eq('id', id).eq('business_id', bid).maybeSingle())
        const now = new Date().toISOString()
        throwSupaError(await supabase.from('staff')
          .update({ manager_auth_hash: null, manager_auth_rotated_at: now, updated_at: now })
          .eq('id', id).eq('business_id', bid))
        await logActivity({ event_type: 'manager_card_revoked', severity: 'warn',
          target_type: 'user', target_id: id,
          target_name: target ? `${target.name} (@${target.username})` : `#${id}`,
          reason: 'Tarjeta de autorización revocada' })
        return { ok: true, rotatedAt: now }
      }, 'web.users.revokeAuthCard'),

      /**
       * Verify a scanned token. Hits the server endpoint so the hash never
       * leaves the server. Falls back to a client-side hash-then-select if the
       * endpoint is unavailable (e.g. preview deploys) — the fallback is
       * semantically identical; just higher blast radius if the anon key leaks.
       */
      verifyAuthToken: (token) => tryOr(async () => {
        const raw = String(token || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
        if (raw.length < 8) return null
        // Prefer server endpoint — pass JWT for auth.
        try {
          const { data: { session } } = await supabase.auth.getSession()
          const jwt = session?.access_token
          if (jwt) {
            const r = await fetch('/api/staff-verify-auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt },
              body: JSON.stringify({ token: raw, businessId: bid }),
            })
            if (r.ok) {
              const j = await r.json()
              return j?.match || null
            }
          }
        } catch {}
        // Fallback — client-side hash + select. Same correctness, weaker isolation.
        const { hashToken } = await import('@terminal-x/services/managerAuthToken')
        const hash = await hashToken(raw)
        const { data } = await supabase.from('staff')
          .select('id,name,username,role,supabase_id,manager_auth_rotated_at')
          .eq('business_id', bid).eq('active', true).eq('manager_auth_hash', hash)
          .in('role', ['owner','manager']).limit(1).maybeSingle()
        return data ? { id: data.id, name: data.name, username: data.username, role: data.role,
                        supabase_id: data.supabase_id, rotatedAt: data.manager_auth_rotated_at } : null
      }, null),
    },

    // ── Categorias ───────────────────────────────────────────────────────────

    categorias: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('categorias_servicio').select('*').eq('business_id', bid).order('orden').order('nombre'))
      }, []),

      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('categorias_servicio').insert({
          supabase_id: crypto.randomUUID(),
          nombre: data.nombre, orden: data.orden || 0, business_id: bid,
        }).select('id').single())
        return { id: row.id }
      }, 'web.categorias.create'),

      update: (data) => tryWrite(async () => {
        const { id, ...rest } = data
        const allowed = ['nombre', 'orden']
        const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
        throwSupaError(await supabase.from('categorias_servicio').update(patch).eq('id', id).eq('business_id', bid))
      }, 'web.categorias.update'),

      delete: (id) => tryWrite(async () => {
        const actualId = typeof id === 'object' ? id.id : id
        // Check if any services reference this category
        const { count } = await supabase.from('services').select('id', { count: 'exact', head: true })
          .eq('business_id', bid).eq('categoria_id', actualId)
        if (count > 0) throw new Error('Categoria tiene servicios asociados')
        throwSupaError(await supabase.from('categorias_servicio').delete().eq('id', actualId).eq('business_id', bid))
      }, 'web.categorias.delete'),
    },

    // ── Services ─────────────────────────────────────────────────────────────

    services: {
      all: () => tryOr(async () => {
        return throwSupaError(
          await supabase.from('services').select('*').eq('business_id', bid).eq('active', true)
            .order('category').order('sort_order').order('id')
        )
      }, []),

      // v2.16.3 — Top sellers ranked by ticket_items.quantity over the last
      // p_days (default 30) for non-voided tickets. Backed by the
      // services_top_sellers Postgres RPC (joins on dual-key service_id /
      // service_supabase_id, filters status NOT IN voided/anulado/nula).
      // Returns full service rows in the same shape as services.all() so the
      // UI can render them through the same MenuItemCard.
      topSellers: ({ days = 30, limit = 8 } = {}) => tryOr(async () => {
        const since = new Date(Date.now() - days * 86400000).toISOString()
        const { data, error } = await supabase.rpc('services_top_sellers', {
          p_business_id: bid,
          p_since:       since,
          p_limit:       limit,
        })
        if (error) throw error
        return data || []
      }, []),

      allAdmin: () => tryOr(async () => {
        return throwSupaError(
          await supabase.from('services').select('*').eq('business_id', bid)
            .order('category').order('sort_order').order('id')
        )
      }, []),

      create: (data) => tryWrite(async () => {
        await requireOwnerOrManager('services:create')
        const row = throwSupaError(await supabase.from('services').insert({
          supabase_id: crypto.randomUUID(),
          name: data.name, name_en: data.name_en || null,
          category: data.category || 'Lavado', categoria_id: data.categoria_id || null,
          price: data.price, cost: data.cost || 0, aplica_itbis: data.aplica_itbis ?? 1,
          is_wash: data.is_wash ?? 1,
          no_commission: !!(data.no_commission),
          commission_washer: data.commission_washer ?? true,
          commission_seller: data.commission_seller ?? true,
          commission_cashier: data.commission_cashier ?? true,
          active: true, sort_order: data.sort_order || 0,
          is_menu_item: !!data.is_menu_item,
          course: data.course || null,
          station: data.station || null,
          printer_route: data.printer_route || null,
          happy_hour_price: data.happy_hour_price ?? null,
          happy_hour_start: data.happy_hour_start || null,
          happy_hour_end:   data.happy_hour_end   || null,
          business_id: bid,
        }).select('id').single())
        return { id: row.id }
      }, 'web.services.create'),

      update: (data) => tryWrite(async () => {
        await requireOwnerOrManager('services:update')
        const { id, ...rest } = data
        const allowed = ['name', 'name_en', 'category', 'categoria_id', 'price', 'cost', 'aplica_itbis', 'is_wash', 'no_commission', 'commission_washer', 'commission_seller', 'commission_cashier', 'active', 'sort_order', 'is_menu_item', 'course', 'station', 'printer_route', 'happy_hour_price', 'happy_hour_start', 'happy_hour_end', 'in_stock']
        const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
        // Coerce booleans for Supabase bool columns
        for (const k of ['no_commission', 'commission_washer', 'commission_seller', 'commission_cashier', 'active', 'is_wash', 'aplica_itbis']) {
          if (k in patch) patch[k] = !!patch[k]
        }
        // Auto-derive no_commission when all 3 role flags are off
        if ('commission_washer' in patch || 'commission_seller' in patch || 'commission_cashier' in patch) {
          patch.no_commission = !(patch.commission_washer || patch.commission_seller || patch.commission_cashier)
        }
        const priorRow = 'price' in patch
          ? (await supabase.from('services').select('name, price').eq('id', id).eq('business_id', bid).maybeSingle())?.data
          : null
        throwSupaError(await supabase.from('services').update(patch).eq('id', id).eq('business_id', bid))
        if (priorRow && Number(priorRow.price) !== Number(patch.price)) {
          await logActivity({ event_type: 'service_price_changed', severity: 'warn',
            target_type: 'service', target_id: id, target_name: priorRow.name,
            old_value: priorRow.price, new_value: patch.price,
            amount: Number(patch.price) - Number(priorRow.price) })
        }
      }, 'web.services.update'),

      // v2.16.3 — 86-list (sold-out plates). Polymorphic key (numeric id OR
      // supabase_id UUID). Logs activity under service_set_oos /
      // service_back_in_stock so the owner sees it in the Actividad feed.
      setInStock: (key, inStock) => tryWrite(async () => {
        await requireOwnerOrManager('services:set-in-stock')
        const next = inStock ? true : false
        const isUuid = typeof key === 'string' && /^[0-9a-f]{8}-/i.test(key)
        const sel = supabase.from('services').select('id, supabase_id, name, in_stock')
          .eq('business_id', bid)
        const { data: row, error: selErr } = isUuid
          ? await sel.eq('supabase_id', key).maybeSingle()
          : await sel.eq('id', Number(key)).maybeSingle()
        if (selErr) throw selErr
        if (!row) return { ok: false, error: 'not_found' }
        const prev = row.in_stock === false ? false : true
        if (prev === next) return { ok: true, unchanged: true, id: row.id, supabase_id: row.supabase_id, in_stock: next }
        throwSupaError(await supabase.from('services')
          .update({ in_stock: next, updated_at: new Date().toISOString() })
          .eq('id', row.id).eq('business_id', bid))
        await logActivity({
          event_type: next ? 'service_back_in_stock' : 'service_set_oos',
          severity: 'info',
          target_type: 'service', target_id: row.id, target_name: row.name,
          old_value: prev ? 1 : 0, new_value: next ? 1 : 0,
        })
        return { ok: true, id: row.id, supabase_id: row.supabase_id, in_stock: next }
      }),

      // v2.17.8 — Pre-flight ref count for hard-delete UI. Returns the number
      // of ticket_items still referencing this service (matches both legacy
      // integer service_id and the supabase_id UUID dual-key columns).
      refCount: (id) => tryOr(async () => {
        const svc = (await supabase.from('services').select('id, supabase_id').eq('id', id).eq('business_id', bid).maybeSingle())?.data
        if (!svc) return { count: 0 }
        let total = 0
        const a = await supabase.from('ticket_items').select('id', { count: 'exact', head: true }).eq('business_id', bid).eq('service_id', svc.id)
        if (typeof a.count === 'number') total += a.count
        if (svc.supabase_id) {
          const b = await supabase.from('ticket_items').select('id', { count: 'exact', head: true }).eq('business_id', bid).eq('service_supabase_id', svc.supabase_id)
          if (typeof b.count === 'number') total += b.count
        }
        return { count: total }
      }, { count: 0 }),

      delete: ({ id }) => tryWrite(async () => {
        await requireOwnerOrManager('services:delete')
        // Hard-delete when possible. FK from ticket_items keeps historical
        // sales intact — on 23503 we fall back to soft-delete.
        const svc = (await supabase.from('services').select('name, price').eq('id', id).eq('business_id', bid).maybeSingle())?.data
        const del = await supabase.from('services').delete().eq('id', id).eq('business_id', bid)
        if (del.error) {
          const fkBlocked = del.error.code === '23503' || /foreign key|referenced/i.test(del.error.message || '')
          if (!fkBlocked) throw new Error(del.error.message || 'Error al eliminar servicio')
          throwSupaError(await supabase.from('services').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
          await logActivity({ event_type: 'service_deleted', severity: 'warn',
            target_type: 'service', target_id: id,
            target_name: svc?.name || `#${id}`, amount: svc?.price, metadata: { soft: true, reason: 'has_history' } })
          return { softDeleted: true }
        }
        await logActivity({ event_type: 'service_deleted', severity: 'warn',
          target_type: 'service', target_id: id,
          target_name: svc?.name || `#${id}`, amount: svc?.price, metadata: { hard: true } })
        return { deleted: true }
      }),
    },

    // ── Washers ──────────────────────────────────────────────────────────────

    washers: {
      all: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('empleados').select('id, supabase_id, nombre, comision_pct, phone, cedula, start_date, active').eq('business_id', bid).in('tipo', ['lavador', 'hybrid']).eq('active', true).neq('role', 'owner').order('nombre'))
        return (rows || []).map(r => ({ ...r, name: r.nombre, commission_pct: r.comision_pct }))
      }, []),

      allAdmin: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('empleados').select('id, supabase_id, nombre, comision_pct, phone, cedula, start_date, active').eq('business_id', bid).in('tipo', ['lavador', 'hybrid']).order('nombre'))
        return (rows || []).map(r => ({ ...r, name: r.nombre, commission_pct: r.comision_pct }))
      }, []),

      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('empleados').insert({
          supabase_id: crypto.randomUUID(),
          nombre: data.name ?? data.nombre, phone: data.phone || null, cedula: data.cedula || null,
          comision_pct: data.commission_pct ?? data.comision_pct ?? 20,
          start_date: data.start_date || null,
          tipo: 'lavador', role: 'none',
          active: true, business_id: bid,
        }).select('id').single())
        return { id: row.id }
      }, 'web.washers.create'),

      update: (data) => tryWrite(async () => {
        const { id, ...rest } = data
        const patch = {}
        if ('name' in rest)            patch.nombre = rest.name
        if ('nombre' in rest)          patch.nombre = rest.nombre
        if ('phone' in rest)           patch.phone = rest.phone
        if ('cedula' in rest)          patch.cedula = rest.cedula
        if ('commission_pct' in rest)  patch.comision_pct = rest.commission_pct
        if ('comision_pct' in rest)    patch.comision_pct = rest.comision_pct
        if ('start_date' in rest)      patch.start_date = rest.start_date
        if ('active' in rest)          patch.active = !!rest.active
        throwSupaError(await supabase.from('empleados').update(patch).eq('id', id).eq('business_id', bid))
      }, 'web.washers.update'),
    },

    // ── Sellers ──────────────────────────────────────────────────────────────

    sellers: {
      all: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('empleados').select('id, supabase_id, nombre, comision_pct, phone, active').eq('business_id', bid).in('tipo', ['vendedor', 'hybrid']).eq('active', true).neq('role', 'owner').order('nombre'))
        return (rows || []).map(r => ({ ...r, name: r.nombre, commission_pct: r.comision_pct }))
      }, []),

      allAdmin: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('empleados').select('id, supabase_id, nombre, comision_pct, phone, active').eq('business_id', bid).in('tipo', ['vendedor', 'hybrid']).order('nombre'))
        return (rows || []).map(r => ({ ...r, name: r.nombre, commission_pct: r.comision_pct }))
      }, []),

      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('empleados').insert({
          supabase_id: crypto.randomUUID(),
          nombre: data.name ?? data.nombre,
          comision_pct: data.commission_pct ?? data.comision_pct ?? 5,
          phone: data.phone || null, tipo: 'vendedor', role: 'none',
          active: true, business_id: bid,
        }).select('id').single())
        return { id: row.id }
      }, 'web.sellers.create'),

      update: (data) => tryWrite(async () => {
        const { id, ...rest } = data
        const patch = {}
        if ('name' in rest)           patch.nombre = rest.name
        if ('nombre' in rest)         patch.nombre = rest.nombre
        if ('commission_pct' in rest) patch.comision_pct = rest.commission_pct
        if ('comision_pct' in rest)   patch.comision_pct = rest.comision_pct
        if ('phone' in rest)          patch.phone = rest.phone
        if ('active' in rest)         patch.active = !!rest.active
        throwSupaError(await supabase.from('empleados').update(patch).eq('id', id).eq('business_id', bid))
      }, 'web.sellers.update'),
    },

    // ── Empleados (payroll) ────────────────────────────────────────────────

    empleados: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('empleados').select('*').eq('business_id', bid).eq('active', true).order('nombre'))
      }, []),

      allAdmin: () => tryOr(async () => {
        return throwSupaError(await supabase.from('empleados').select('*').eq('business_id', bid).order('nombre'))
      }, []),

      create: (data) => tryWrite(async () => {
        await requireOwnerOrManager('empleados:create')
        const empSid = crypto.randomUUID()
        const row = throwSupaError(await supabase.from('empleados').insert({
          supabase_id: empSid,
          nombre: data.nombre, tipo: data.tipo, role: data.role || 'none',
          ref_id: data.ref_id || null, comision_pct: data.comision_pct || 0,
          salary: data.salary || 0, start_date: data.start_date,
          cedula: data.cedula || null, phone: data.phone || null,
          puesto: data.puesto || null, email: data.email || null,
          bank_account: data.bank_account || null, tss_id: data.tss_id || null,
          active: true, business_id: bid,
        }).select('id').single())
        // Log initial salary for salaryAtDate(). Guard against duplicate
        // insert when desktop already pushed one for the same empleado (same
        // initial_salary row created twice → 4 "historiales" bug).
        const sal = data.salary || 0
        if (sal > 0) {
          const { data: existing } = await supabase.from('salary_changes')
            .select('id').eq('business_id', bid).eq('empleado_supabase_id', empSid)
            .eq('reason', 'initial_salary').limit(1).maybeSingle()
          if (!existing) {
            const { error: scErr } = await supabase.from('salary_changes').insert({
              supabase_id: crypto.randomUUID(),
              empleado_supabase_id: empSid,
              old_salary: 0, new_salary: sal,
              effective_date: data.start_date || new Date().toISOString().slice(0, 10),
              reason: 'initial_salary', business_id: bid,
            })
            if (scErr) console.error('[salary_changes initial insert]', scErr.message || scErr)
          }
        }
        return { id: row.id }
      }, 'web.empleados.create'),

      update: (data) => tryWrite(async () => {
        await requireOwnerOrManager('empleados:update')
        const { id, salary_change_reason, changed_by, ...rest } = data
        const allowed = ['nombre','tipo','role','ref_id','salary','comision_pct','start_date','cedula','phone','puesto','email','bank_account','tss_id','active']
        const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
        // Coerce boolean — UI may send 0/1
        if ('active' in patch) patch.active = !!patch.active
        // Auto-log salary change: fetch current, compare, insert salary_changes row.
        // Use empleado_supabase_id (uuid) — salary_changes.empleado_id is legacy bigint.
        if (patch.salary != null) {
          const { data: current } = await supabase.from('empleados').select('salary, supabase_id').eq('id', id).eq('business_id', bid).single()
          const oldSalary = Number(current?.salary || 0)
          const newSalary = Number(patch.salary || 0)
          if (current && oldSalary !== newSalary) {
            const { error: scErr } = await supabase.from('salary_changes').insert({
              supabase_id: crypto.randomUUID(),
              empleado_supabase_id: current.supabase_id,
              old_salary: oldSalary, new_salary: newSalary,
              effective_date: new Date().toISOString().slice(0, 10),
              reason: salary_change_reason || null,
              business_id: bid,
            })
            if (scErr) console.error('[salary_changes auto-log]', scErr.message || scErr)
          }
        }
        throwSupaError(await supabase.from('empleados').update(patch).eq('id', id).eq('business_id', bid))
      }, 'web.empleados.update'),

      delete: (id) => tryWrite(async () => {
        await requireOwnerOrManager('empleados:delete')
        throwSupaError(await supabase.from('empleados').update({ active: false }).eq('id', id).eq('business_id', bid))
      }, 'web.empleados.delete'),

      // Mirror of electron hard-delete: try to remove outright, fall back to
      // soft-delete if FKs (payroll_runs / salary_changes / commissions) block
      // the delete. Returns { deleted: true } or { softDeleted: true, reason }.
      hardDelete: (id) => tryWrite(async () => {
        const snap = await supabase.from('empleados').select('nombre, supabase_id').eq('id', id).eq('business_id', bid).maybeSingle()
        const name = snap?.data?.nombre || `#${id}`
        const empSid = snap?.data?.supabase_id
        if (empSid) {
          try { await supabase.from('salary_changes').delete().eq('business_id', bid).eq('empleado_supabase_id', empSid) }
          catch (err) { try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'web.empleados.salary_changes_delete', extra: { empSid, business_id: bid } }) } catch {} }
        }
        const { error } = await supabase.from('empleados').delete().eq('id', id).eq('business_id', bid)
        if (!error) {
          await logActivity({ event_type: 'empleado_deleted', severity: 'warn', target_type: 'empleado', target_id: id, target_name: name })
          return { deleted: true }
        }
        try { throwSupaError(await supabase.from('empleados').update({ active: false }).eq('id', id).eq('business_id', bid)) }
        catch (err) { try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'error', category: 'web.empleados.soft_delete_fallback', extra: { empleado_id: id, business_id: bid, original_error: error?.message } }) } catch {} }
        await logActivity({ event_type: 'empleado_deactivated', severity: 'warn', target_type: 'empleado', target_id: id, target_name: name, reason: error.message })
        return { softDeleted: true, reason: error.message }
      }, 'web.empleados.hardDelete'),
    },

    // ── Payroll runs (paycheck history) ─────────────────────────────────────
    payrollRuns: {
      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('payroll_runs').insert(
          buildPayrollRunRow(data, bid)
        ).select('id').single())
        // Auto-mark underlying commissions as paid
        if ((Number(data.commissions) || 0) > 0) {
          try { await markCommissionsPaidForEmpleado(supabase, bid, data.empleado_id, data.period_start, data.period_end) } catch (e) { console.error('[payrollRuns.create] markCommissionsPaid failed:', e.message) }
        }
        return { id: row.id }
      }, 'web.payrollRuns.create'),
      bulkCreate: (runs) => tryWrite(async () => {
        if (!Array.isArray(runs) || runs.length === 0) return { created: 0, ids: [] }
        const rows = runs.map(r => buildPayrollRunRow(r, bid))
        const inserted = throwSupaError(await supabase.from('payroll_runs').insert(rows).select('id'))
        // Fire-and-forget mark-paid for each employee's commissions in its period
        for (const r of runs) {
          if ((Number(r.commissions) || 0) > 0) {
            try { await markCommissionsPaidForEmpleado(supabase, bid, r.empleado_id, r.period_start, r.period_end) } catch (e) { console.error('[payrollRuns.bulkCreate] markCommissionsPaid failed for empleado', r.empleado_id, ':', e.message) }
          }
        }
        const totalNet = runs.reduce((s, r) => s + Number(r?.net || 0), 0)
        const period = runs[0] ? `${runs[0].period_start || ''} → ${runs[0].period_end || ''}` : ''
        await logActivity({ event_type: 'payroll_paid', severity: 'critical',
          target_type: 'payroll_run', target_id: inserted?.[0]?.id || null,
          target_name: `Nómina ${period}`.trim(),
          amount: totalNet,
          metadata: { run_count: (inserted || []).length, run_ids: (inserted || []).map(x => x.id), period_start: runs[0]?.period_start, period_end: runs[0]?.period_end } })
        return { created: (inserted || []).length, ids: (inserted || []).map(x => x.id) }
      }, 'web.payrollRuns.bulkCreate'),
      byEmpleado: (empleadoId, limit = 100) => tryOr(async () => {
        return throwSupaError(
          await supabase.from('payroll_runs').select('*')
            .eq('business_id', bid).eq('empleado_id', empleadoId)
            .order('paid_at', { ascending: false }).limit(limit)
        )
      }, []),
      byPeriod: (from, to) => tryOr(async () => {
        let q = supabase.from('payroll_runs')
          .select('*')
          .eq('business_id', bid)
          .order('paid_at', { ascending: false })
        if (from) q = q.gte('paid_at', from)
        if (to)   q = q.lte('paid_at', to + ' 23:59:59')
        const rows = throwSupaError(await q) || []
        await attachRel(supabase, rows, { fkCol: 'empleado_supabase_id', targetTable: 'empleados', selectCols: 'nombre, tipo', asKey: 'empleados', businessId: bid })
        return rows.map(r => ({
          ...r,
          empleado_nombre: r.empleados?.nombre || null,
          empleado_tipo:   r.empleados?.tipo || null,
        }))
      }, []),
      remove: (id) => tryWrite(async () => {
        throwSupaError(await supabase.from('payroll_runs').delete().eq('id', id).eq('business_id', bid))
      }, 'web.payrollRuns.remove'),
    },

    // ── Payroll settings (per-business config) ──────────────────────────────
    payrollSettings: {
      get: () => tryOr(async () => {
        const { data } = await supabase.from('payroll_settings').select('*').eq('business_id', bid).maybeSingle()
        if (!data) return null
        // Supabase returns isr_brackets already parsed (jsonb). Leave as-is.
        return data
      }, null),
      update: (data) => tryWrite(async () => {
        const allowed = [
          'pay_cycle',
          'sfs_employee_rate','afp_employee_rate',
          'sfs_employer_rate','afp_employer_rate','infotep_employer_rate',
          'sfs_monthly_cap','afp_monthly_cap',
          'isr_enabled','isr_brackets',
          'navidad_enabled','vacation_days','daily_divisor',
        ]
        const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
        // Coerce booleans — UI sends 0/1, schema is BOOLEAN
        if ('isr_enabled' in patch)     patch.isr_enabled     = !!patch.isr_enabled
        if ('navidad_enabled' in patch) patch.navidad_enabled = !!patch.navidad_enabled
        // Upsert: one row per business (UNIQUE constraint on business_id)
        throwSupaError(await supabase.from('payroll_settings')
          .upsert({ ...patch, business_id: bid, updated_at: new Date().toISOString() }, { onConflict: 'business_id' }))
      }, 'web.payrollSettings.update'),
    },

    // ── Adelantos de nomina (salary advances) ──────────────────────────────
    adelantos: {
      create: (data) => tryWrite(async () => {
        const sid = crypto.randomUUID()
        const { data: emp } = await supabase.from('empleados').select('supabase_id, nombre').eq('id', data.empleado_id).eq('business_id', bid).maybeSingle()
        const row = throwSupaError(await supabase.from('adelantos').insert({
          supabase_id: sid,
          empleado_id: data.empleado_id,
          empleado_supabase_id: emp?.supabase_id || null,
          amount: Number(data.amount),
          date: data.date || new Date().toISOString().slice(0, 10),
          notes: data.notes || null,
          status: 'pendiente',
          approved_by: data.approved_by || null,
          business_id: bid,
        }).select('id').single())
        await logActivity({ event_type: 'adelanto_created', severity: 'warn',
          target_type: 'adelanto', target_id: row.id,
          target_name: `Adelanto #${row.id}`,
          amount: Number(data.amount) })
        return { id: row.id, supabase_id: sid }
      }, 'web.adelantos.create'),
      list: (params = {}) => tryOr(async () => {
        let q = supabase.from('adelantos').select('*').eq('business_id', bid)
        if (params.empleado_id) q = q.eq('empleado_id', params.empleado_id)
        if (params.status)      q = q.eq('status', params.status)
        if (params.dateFrom)    q = q.gte('date', params.dateFrom)
        if (params.dateTo)      q = q.lte('date', params.dateTo)
        q = q.order('created_at', { ascending: false })
        const rows = throwSupaError(await q) || []
        await attachRel(supabase, rows, { fkCol: 'empleado_supabase_id', targetTable: 'empleados', selectCols: 'nombre, tipo', asKey: 'empleados', businessId: bid })
        return rows.map(r => ({
          ...r,
          empleado_nombre: r.empleados?.nombre || null,
          empleado_tipo: r.empleados?.tipo || null,
        }))
      }, []),
      byEmpleado: (id) => tryOr(async () => {
        return throwSupaError(await supabase.from('adelantos').select('*')
          .eq('business_id', bid).eq('empleado_id', id).eq('status', 'pendiente')
          .order('date', { ascending: true }))
      }, []),
      pendingTotal: (id) => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('adelantos').select('amount')
          .eq('business_id', bid).eq('empleado_id', id).eq('status', 'pendiente'))
        return (rows || []).reduce((s, r) => s + Number(r.amount || 0), 0)
      }, 0),
      deduct: (id, payrollRunId) => tryWrite(async () => {
        throwSupaError(await supabase.from('adelantos').update({
          status: 'deducido',
          deducted_from_payroll_id: payrollRunId,
          deducted_at: new Date().toISOString(),
        }).eq('id', id).eq('business_id', bid))
      }, 'web.adelantos.deduct'),
      cancel: (id) => tryWrite(async () => {
        const { data: row } = await supabase.from('adelantos').select('amount').eq('id', id).eq('business_id', bid).maybeSingle()
        throwSupaError(await supabase.from('adelantos').update({ status: 'cancelado' })
          .eq('id', id).eq('business_id', bid).eq('status', 'pendiente'))
        if (row) {
          await logActivity({ event_type: 'adelanto_cancelled', severity: 'warn',
            target_type: 'adelanto', target_id: id,
            target_name: `Adelanto #${id}`,
            amount: row.amount })
        }
      }, 'web.adelantos.cancel'),
      summary: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('adelantos').select('empleado_id, empleado_supabase_id, amount')
          .eq('business_id', bid).eq('status', 'pendiente')) || []
        await attachRel(supabase, rows, { fkCol: 'empleado_supabase_id', targetTable: 'empleados', selectCols: 'id, nombre, tipo', asKey: 'empleados', businessId: bid })
        const map = {}
        for (const r of rows) {
          const eid = r.empleado_id
          if (!map[eid]) map[eid] = { id: eid, nombre: r.empleados?.nombre || '', tipo: r.empleados?.tipo || '', pending_total: 0, pending_count: 0 }
          map[eid].pending_total += Number(r.amount || 0)
          map[eid].pending_count++
        }
        return Object.values(map).sort((a, b) => b.pending_total - a.pending_total)
      }, []),
    },

    // ── Salary changes (audit log) ──────────────────────────────────────────
    // All queries join on empleado_supabase_id, not the legacy bigint empleado_id column.
    salaryChanges: {
      byEmpleado: (empleadoId) => tryOr(async () => {
        // Look up the empleado's supabase_id from its PK id (the UI passes id)
        const { data: emp } = await supabase.from('empleados').select('supabase_id').eq('id', empleadoId).eq('business_id', bid).maybeSingle()
        if (!emp?.supabase_id) return []
        return throwSupaError(
          await supabase.from('salary_changes').select('*')
            .eq('business_id', bid).eq('empleado_supabase_id', emp.supabase_id)
            .order('effective_date', { ascending: false }).order('id', { ascending: false })
        )
      }, []),
      atDate: (empleadoId, date) => tryOr(async () => {
        const { data: emp } = await supabase.from('empleados').select('salary, supabase_id').eq('id', empleadoId).eq('business_id', bid).maybeSingle()
        if (!emp?.supabase_id) return Number(emp?.salary || 0)
        const { data: row } = await supabase.from('salary_changes').select('new_salary')
          .eq('business_id', bid).eq('empleado_supabase_id', emp.supabase_id)
          .lte('effective_date', date)
          .order('effective_date', { ascending: false }).order('id', { ascending: false })
          .limit(1).maybeSingle()
        if (row) return Number(row.new_salary)
        return Number(emp?.salary || 0)
      }, 0),
      create: (data) => tryWrite(async () => {
        await requireOwnerOrManager('salary-changes:create')
        // The UI (NominaEmpleados.handleSaveSalaryChange) passes:
        //   { empleado_id, new_salary, effective_date, reason, changed_by }
        // We resolve empleado_id → empleado_supabase_id, insert the row, and
        // also update empleados.salary if this is the latest effective_date
        // (keeps Dashboard + commission calcs in sync without a second click).
        const { data: emp } = await supabase.from('empleados').select('id, salary, supabase_id').eq('id', data.empleado_id).eq('business_id', bid).maybeSingle()
        if (!emp?.supabase_id) throw new Error('Empleado no encontrado')
        // old_salary = whatever was in effect strictly before this date
        const { data: prev } = await supabase.from('salary_changes').select('new_salary')
          .eq('business_id', bid).eq('empleado_supabase_id', emp.supabase_id)
          .lt('effective_date', data.effective_date)
          .order('effective_date', { ascending: false }).order('id', { ascending: false })
          .limit(1).maybeSingle()
        const oldSalary = prev ? Number(prev.new_salary) : 0
        const newSalary = Number(data.new_salary) || 0
        const sid = crypto.randomUUID()
        const inserted = throwSupaError(await supabase.from('salary_changes').insert({
          supabase_id: sid,
          empleado_supabase_id: emp.supabase_id,
          old_salary: oldSalary, new_salary: newSalary,
          effective_date: data.effective_date,
          reason: data.reason || null,
          business_id: bid,
        }).select('id').single())
        // If this is now the most-recent row, sync empleados.salary
        const { data: latest } = await supabase.from('salary_changes').select('new_salary, effective_date, id')
          .eq('business_id', bid).eq('empleado_supabase_id', emp.supabase_id)
          .order('effective_date', { ascending: false }).order('id', { ascending: false })
          .limit(1).maybeSingle()
        if (latest && Number(latest.new_salary) !== Number(emp.salary || 0)) {
          await supabase.from('empleados').update({ salary: Number(latest.new_salary) })
            .eq('id', emp.id).eq('business_id', bid)
        }
        return { id: inserted.id, supabase_id: sid }
      }, 'web.salaryChanges.create'),
      remove: (id) => tryWrite(async () => {
        await requireOwnerOrManager('salary-changes:delete')
        // Look up empleado_supabase_id before deleting so we can re-sync
        // empleados.salary to whatever becomes the new latest row.
        const { data: row } = await supabase.from('salary_changes').select('empleado_supabase_id').eq('id', id).eq('business_id', bid).maybeSingle()
        if (!row?.empleado_supabase_id) throw new Error('No se encontró el cambio de salario (id ' + id + ')')
        throwSupaError(await supabase.from('salary_changes').delete().eq('id', id).eq('business_id', bid))
        const { data: latest } = await supabase.from('salary_changes').select('new_salary')
          .eq('business_id', bid).eq('empleado_supabase_id', row.empleado_supabase_id)
          .order('effective_date', { ascending: false }).order('id', { ascending: false })
          .limit(1).maybeSingle()
        const newSal = latest ? Number(latest.new_salary) : 0
        await supabase.from('empleados').update({ salary: newSal })
          .eq('supabase_id', row.empleado_supabase_id).eq('business_id', bid)
      }),
    },

    // ── Clients ──────────────────────────────────────────────────────────────

    clients: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('clients').select('*').eq('business_id', bid).eq('active', true).order('name'))
      }, []),

      byId: (id) => tryOr(async () => {
        const { data } = await supabase.from('clients').select('*').eq('id', id).eq('business_id', bid).single()
        return data || null
      }, null),

      create: (data) => tryWrite(async () => {
        // v2.16.10 2026-04-30 — DO NOT REVERT (FIX-LEDGER §2.13). Quick-add
        // client returned only {id} — caller mapped client.supabase_id=null,
        // first credit ticket landed orphaned, loyaltyAward early-returned.
        // Now returns full id+supabase_id for downstream linkage.
        const sid = data.supabase_id || crypto.randomUUID()
        const row = throwSupaError(await supabase.from('clients').insert({
          supabase_id: sid,
          name: data.name, rnc: data.rnc || null, phone: data.phone || null,
          email: data.email || null, address: data.address || null,
          credit_limit: data.credit_limit || 0, balance: 0, business_id: bid,
          loyalty_points: 0,
          notes: data.notes || null,
          allergies: data.allergies || null,
          preferred_stylist_supabase_id: data.preferred_stylist_supabase_id || null,
        }).select('id, supabase_id').single())
        return row
      }, 'web.clients.create'),

      update: (data) => tryWrite(async () => {
        const { id, ...rest } = data
        const allowed = ['name', 'rnc', 'phone', 'email', 'address', 'credit_limit', 'balance', 'visits', 'total_spent', 'active', 'notes', 'loyalty_points', 'birthday_treat_available', 'allergies', 'preferred_stylist_supabase_id']
        const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
        if ('active' in patch) patch.active = !!patch.active
        throwSupaError(await supabase.from('clients').update(patch).eq('id', id).eq('business_id', bid))
      }, 'web.clients.update'),

      // v2.4 — Salon: atomic loyalty point mutation. Positive = earn, negative = redeem.
      addLoyaltyPoints: ({ id, delta }) => tryWrite(async () => {
        const { data: cl } = await supabase.from('clients').select('loyalty_points').eq('id', id).eq('business_id', bid).single()
        const next = Math.max(0, Number(cl?.loyalty_points || 0) + Number(delta || 0))
        throwSupaError(await supabase.from('clients').update({ loyalty_points: next }).eq('id', id).eq('business_id', bid))
        return next
      }, 'web.clients.addLoyaltyPoints'),

      updateBalance: ({ id, delta }) => tryWrite(async () => {
        const { data: cl } = await supabase.from('clients').select('balance').eq('id', id).eq('business_id', bid).single()
        if (cl) {
          const newBal = Math.max(0, (cl.balance || 0) + delta)
          throwSupaError(await supabase.from('clients').update({ balance: newBal }).eq('id', id).eq('business_id', bid))
        }
      }, 'web.clients.updateBalance'),

      // v2.7.1 — ledger-backed loyalty (calls SECURITY DEFINER RPCs)
      loyaltyAward: async ({ clientSupabaseId, ticketSupabaseId, points, notes }) => {
        if (!clientSupabaseId || !points) return 0
        try {
          const { data, error } = await supabase.rpc('loyalty_award', {
            p_business_id:        bid,
            p_client_supabase_id: clientSupabaseId,
            p_ticket_supabase_id: ticketSupabaseId || null,
            p_points:             Number(points) || 0,
            p_notes:              notes || null,
          })
          if (error) return 0
          return Number(data) || 0
        } catch { return 0 }
      },
      loyaltyRedeem: async ({ clientSupabaseId, ticketSupabaseId, points, notes }) => {
        if (!clientSupabaseId || !points) return { ok: false, reason: 'invalid_amount' }
        try {
          const { data, error } = await supabase.rpc('loyalty_redeem', {
            p_business_id:        bid,
            p_client_supabase_id: clientSupabaseId,
            p_ticket_supabase_id: ticketSupabaseId || null,
            p_points:             Number(points) || 0,
            p_notes:              notes || null,
          })
          if (error) return { ok: false, reason: error.message || 'rpc_error' }
          const bal = Number(data)
          if (bal < 0) return { ok: false, reason: 'insufficient' }
          return { ok: true, balance: bal }
        } catch (e) { return { ok: false, reason: e?.message || 'error' } }
      },
      loyaltyAdjust: async ({ clientSupabaseId, delta, notes }) => {
        if (!clientSupabaseId) return 0
        try {
          const { data, error } = await supabase.rpc('loyalty_adjust', {
            p_business_id:        bid,
            p_client_supabase_id: clientSupabaseId,
            p_delta:              Number(delta) || 0,
            p_notes:              notes || null,
          })
          if (error) return 0
          return Number(data) || 0
        } catch { return 0 }
      },
      loyaltyHistory: ({ clientSupabaseId, limit = 100 } = {}) => tryOr(async () => {
        if (!clientSupabaseId) return []
        const { data } = await supabase.from('loyalty_transactions')
          .select('id, supabase_id, ticket_supabase_id, event_type, points, balance_after, notes, created_at')
          .eq('business_id', bid)
          .eq('client_supabase_id', clientSupabaseId)
          .order('created_at', { ascending: false })
          .limit(Math.max(1, Math.min(500, Number(limit) || 100)))
        return data || []
      }, []),

      openTickets: (clientId) => tryOr(async () => {
        // v2.16.10 — clientId is a Supabase UUID. The legacy `.or()` clause
        // referenced tickets.client_id which does NOT exist on Supabase
        // (audit 2026-04-30). Filter on client_supabase_id only.
        const { data: tickets } = await supabase.from('tickets')
          .select('*')
          .eq('business_id', bid)
          .eq('client_supabase_id', clientId)
          .eq('tipo_venta', 'credito').eq('status', 'pendiente')
          .order('created_at', { ascending: true })
        if (!tickets?.length) return []
        const tSids  = [...new Set(tickets.map(t => t.supabase_id).filter(Boolean))]
        const itemsMap = {}
        if (tSids.length)  { const { data: ir } = await supabase.from('ticket_items').select('ticket_supabase_id, name, price, is_wash').in('ticket_supabase_id', tSids); for (const i of (ir || [])) { if (!itemsMap[i.ticket_supabase_id]) itemsMap[i.ticket_supabase_id] = []; itemsMap[i.ticket_supabase_id].push(i) } }
        return tickets.map(t => ({
          ...t,
          items: (itemsMap[t.supabase_id] || []).filter(i => i.name != null),
        }))
      }, []),
    },

    credits: {
      collect: (data) => tryWrite(async () => {
        // Mirrors desktop collectCredit(): mark tickets paid, insert credit_payment,
        // decrease client balance. No RPC — done step-by-step.
        // Idempotency: caller can pass a precomputed supabase_id. If a row with
        // that supabase_id already exists for this business, we skip steps 1-2
        // (they ran on a prior attempt) and return the existing row.
        const { clientId, ticketIds, amount, paymentMethod, ncf, notes, cajeroId, clientRnc, clientName, supabase_id: callerSid } = data
        const sid = callerSid || crypto.randomUUID()

        if (callerSid) {
          const { data: existing } = await supabase.from('credit_payments')
            .select('id, supabase_id').eq('business_id', bid).eq('supabase_id', callerSid).maybeSingle()
          if (existing) return { id: existing.id, supabase_id: existing.supabase_id, idempotent: true }
        }

        // v2.16.10 2026-04-30 — DO NOT REVERT (FIX-LEDGER §2.18). Partial credit
        // payment used to flip ALL ticket_ids to cobrado regardless of the
        // payment amount. A RD$500 abono on RD$3000 of debt closed everything.
        // Now: only flip cobrado if the cumulative paid (existing credit_payments
        // applied to that ticket + this new amount) covers ticket.total. Else
        // leave pendiente, just decrement balance.
        const idsArray = ticketIds || []
        // Pull totals + prior partial amounts for these tickets
        const { data: targetTickets } = await supabase.from('tickets')
          .select('id, supabase_id, total, rev').in('id', idsArray).eq('business_id', bid)
        const ticketsMap = new Map((targetTickets || []).map(t => [t.id, t]))
        const { data: priorPays } = await supabase.from('credit_payments')
          .select('amount, ticket_ids').eq('business_id', bid).contains('ticket_ids', idsArray.length ? [idsArray[0]] : [])
        // Build prior-paid sums per ticket
        const priorByTicket = {}
        for (const p of (priorPays || [])) {
          const tids = Array.isArray(p.ticket_ids) ? p.ticket_ids : []
          if (tids.length === 0) continue
          const share = Number(p.amount || 0) / tids.length
          for (const t of tids) priorByTicket[t] = (priorByTicket[t] || 0) + share
        }
        // Allocate this amount across the requested tickets in oldest-first order
        let remaining = Number(amount) || 0
        for (const tid of idsArray) {
          const t = ticketsMap.get(tid)
          if (!t) continue
          const total = Number(t.total) || 0
          const priorPaid = priorByTicket[tid] || 0
          const stillOwed = Math.max(0, total - priorPaid)
          const applied = Math.min(remaining, stillOwed)
          remaining -= applied
          const newPaidTotal = priorPaid + applied
          const fullyPaid = newPaidTotal + 0.01 >= total // 1-cent tolerance
          const nextRev = Number(t.rev || 0) + 1
          const patch = { rev: nextRev, payment_method: fullyPaid ? paymentMethod : undefined }
          if (fullyPaid) patch.status = 'cobrado'
          // v2.17.5 — stamp buyer name/RNC onto the ticket if the credit cobro
          // captured them (cashier typed an RNC for E31 or the saved client has
          // one). Prior tickets row may have NULLs from the original sale; this
          // backfills at cobro time so the reprinted receipt carries the buyer.
          if (clientName) patch.client_name = clientName
          if (clientRnc)  patch.client_rnc  = clientRnc
          // Strip undefined keys so Supabase doesn't NULL them
          for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k]
          await supabase.from('tickets').update(patch).eq('id', tid).eq('business_id', bid)
        }

        // 2. Decrease client balance
        const { data: cl } = await supabase.from('clients').select('balance, supabase_id').eq('id', clientId).eq('business_id', bid).single()
        if (cl) {
          await supabase.from('clients').update({ balance: Math.max(0, (cl.balance || 0) - amount) })
            .eq('id', clientId).eq('business_id', bid)
        }

        // 3. Insert credit_payment record (upsert on supabase_id so retries are safe)
        const row = throwSupaError(await supabase.from('credit_payments').upsert({
          supabase_id: sid,
          client_id: clientId,
          client_supabase_id: cl?.supabase_id || null,
          ticket_ids: ticketIds,
          amount,
          payment_method: paymentMethod,
          ncf: ncf || null,
          notes: notes || null,
          cajero_id: cajeroId || null,
          business_id: bid,
        }, { onConflict: 'supabase_id' }).select('id').single())

        return { id: row.id, supabase_id: sid }
      }, 'web.credits.collect'),
    },

    // ── Tickets ──────────────────────────────────────────────────────────────

    tickets: {
      all: (params = {}) => tryOr(async () => {
        const dateFrom = params.dateFrom ?? params.from
        const dateTo   = params.dateTo   ?? params.to
        const { status, limit = 5000 } = params
        const safeLimit = Math.min(limit || 5000, 50000)
        let q = supabase.from('tickets').select('*').eq('business_id', bid)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        if (status)   q = q.eq('status', status)
        q = q.order('created_at', { ascending: false }).limit(safeLimit)
        const rows = throwSupaError(await q)
        if (!rows?.length) return []

        // Fetch items — by ticket_supabase_id only
        const tSids  = [...new Set(rows.map(r => r.supabase_id).filter(Boolean))]
        const itemsMap = {}
        if (tSids.length)  { const { data: ir } = await supabase.from('ticket_items').select('ticket_supabase_id, name, price, cost, is_wash, is_deposit, quantity, sku, inventory_item_id, inventory_item_supabase_id').eq('business_id', bid).in('ticket_supabase_id', tSids); for (const i of (ir || [])) { if (!itemsMap[i.ticket_supabase_id]) itemsMap[i.ticket_supabase_id] = []; itemsMap[i.ticket_supabase_id].push(i) } }

        // Fetch client names — supabase_id only. Defense-in-depth: redundant
        // .eq('business_id', bid) so a future RLS migration that drops the
        // legacy my_business_ids() policies cannot silently expose other
        // tenants' clients matched by colliding supabase_ids.
        const clientSids = [...new Set(rows.map(r => r.client_supabase_id).filter(Boolean))]
        let clientMap = {}
        if (clientSids.length) { const { data: cls } = await supabase.from('clients').select('supabase_id, name, rnc').eq('business_id', bid).in('supabase_id', clientSids); for (const c of (cls || [])) clientMap[c.supabase_id] = c }

        // Fetch cajero names — supabase_id only
        const cajeroSids = [...new Set(rows.map(r => r.cajero_supabase_id).filter(Boolean))]
        let cajeroMap = {}
        if (cajeroSids.length) { const { data: ur } = await supabase.from('staff').select('supabase_id, name').eq('business_id', bid).in('supabase_id', cajeroSids); for (const u of (ur || [])) cajeroMap[u.supabase_id] = u }

        return rows.map(r => {
          const items = (itemsMap[r.supabase_id] || []).filter(i => i.name != null)
          const cKey = r.client_supabase_id
          const cajKey = r.cajero_supabase_id
          return {
            ...r,
            items,
            service_names: items.map(i => i.name).join(' + ') || null,
            client_name: clientMap[cKey]?.name || null,
            client_rnc:  clientMap[cKey]?.rnc  || null,
            cajero_name: cajeroMap[cajKey]?.name || null,
          }
        })
      }, []),

      byId: (id) => tryOr(async () => {
        const { data: ticket } = await supabase.from('tickets')
          .select('*')
          .eq('id', id).eq('business_id', bid).single()
        if (!ticket) return null

        // Fetch items — by ticket_supabase_id only
        let items = []
        if (ticket.supabase_id) {
          const { data: sidItems } = await supabase.from('ticket_items')
            .select('*').eq('ticket_supabase_id', ticket.supabase_id)
          items = (sidItems || []).filter(i => i.name != null)
        }

        // Fetch client name
        let client_name = null, client_rnc = null
        const cid = ticket.client_supabase_id
        if (cid) {
          const r = await supabase.from('clients').select('name, rnc').eq('supabase_id', cid).maybeSingle()
          const cl = r.data
          if (cl) { client_name = cl.name; client_rnc = cl.rnc }
        }

        // Fetch cajero name
        let cajero_name = null
        const cajId = ticket.cajero_supabase_id
        if (cajId) {
          const r = await supabase.from('staff').select('name').eq('supabase_id', cajId).maybeSingle()
          const cj = r.data
          if (cj) cajero_name = cj.name
        }

        let ecf_result = {}
        try { ecf_result = typeof ticket.ecf_result === 'string' ? JSON.parse(ticket.ecf_result) : (ticket.ecf_result || {}) } catch {}

        // Resolve washer_ids (empleados.supabase_id UUIDs) to washer_names
        let washer_ids = []
        try { washer_ids = typeof ticket.washer_ids === 'string' ? JSON.parse(ticket.washer_ids) : (ticket.washer_ids || []) } catch {}
        let washer_names = []
        if (washer_ids.length) {
          const { data: wr } = await supabase.from('empleados').select('supabase_id, nombre').in('supabase_id', washer_ids)
          washer_names = (wr || []).map(w => w.nombre)
        }

        return {
          ...ticket,
          client_name,
          client_rnc,
          cajero_name,
          items,
          ecf_result,
          washer_ids,
          washer_names,
        }
      }, null),

      create: async (data) => {
        // v2.16.27 — DUPLICATE-PREVENTION. Pre-mint supabase_id at the top so
        // any retry path (offline-queue replay, double-click, etc.) re-uses
        // the SAME id. Combined with the idempotency check in
        // syncPendingTickets, this guarantees one logical sale = one ticket
        // row regardless of network flakiness or post-insert side-effect
        // failures. Root cause: the prior outer catch enqueued the payload
        // even when the real ticket already inserted but a downstream
        // side-effect (ticket_items / queue / balance) threw. The 60s sync
        // timer then replayed the queued payload and minted a fresh
        // supabase_id every cycle, producing T-0017…T-0021 duplicates.
        if (!data.supabase_id) {
          try { data.supabase_id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(36).slice(2)}` } catch {}
        }
        // v2.16.28 (B2) — was wrapped in tryOr which swallowed every
        // throw and returned null. RLS denial, FK violation, NOT NULL
        // violation, CHECK constraint failure: all caught silently → POS
        // saw "success" → CobrarModal showed the factura → cashier took
        // money for a row that never landed in DB. THE root reason
        // beverage_subtotal v2.16.27 took half a day to surface. Now the
        // inner business logic runs raw; only NETWORK errors fall through
        // to the offline-queue. Real DB errors throw to the modal which
        // surfaces them in red (success-after-DB-lands fix from v2.16.27).
        try {
          return await (async () => {
            // v2.16.10 — Go-Live gate (web mirror). Read go_live_date from
            // app_settings; if empty/future, mark the ticket is_test=true and
            // skip commission writes + credit grant. Cloud sync push filters
            // is_test rows on desktop. Web reads can still see them per-device.
            let _liveWeb = false
            try {
              const { data: gl } = await supabase.from('app_settings')
                .select('value').eq('business_id', bid).eq('key', 'go_live_date').maybeSingle()
              const v = gl?.value
              if (v) {
                const today = new Date(); today.setHours(0,0,0,0)
                const d = new Date(`${v}T00:00:00`)
                if (!Number.isNaN(d.getTime())) _liveWeb = d.getTime() <= today.getTime()
              }
            } catch {}

            // Resolve per-business ITBIS rate once (app_settings is keyed by
            // business_id; value is the percentage as a string, default '18').
            // Callers may also pass `data.itbis_rate` to skip the lookup.
            let itbisFactor
            if (data.itbis_rate != null && Number.isFinite(Number(data.itbis_rate))) {
              itbisFactor = Number(data.itbis_rate) / 100
            } else {
              try {
                const { data: row } = await supabase.from('app_settings')
                  .select('value').eq('business_id', bid).eq('key', 'itbis_pct').maybeSingle()
                const pct = Number(row?.value)
                itbisFactor = (Number.isFinite(pct) && pct >= 0 ? pct : 18) / 100
              } catch { itbisFactor = 0.18 }
            }

            // v2.16.31 follow-up — auto-charge Servicio 10% (Ley 16-92) on
            // restaurant + food_truck verticals. ITBIS-exempt (DR fiscal
            // norm). Caller can opt out per-business by flipping
            // app_settings.receipt_show_servicio_ley='0' — that flag is
            // bidirectional (toggles BOTH render AND charge). Caller can
            // also override by passing data.ley explicitly (>0) which we
            // never clobber. Restaurant POS already passes
            // servicio_amount/servicio_pct via the dedicated mesa flow; for
            // that path we let the existing amount win and skip auto-compute.
            const incomingLey = Number(data.ley)
            const hasExplicitLey = Number.isFinite(incomingLey) && incomingLey > 0
            const hasServicioAmount = Number(data.servicio_amount) > 0
            if (!hasExplicitLey && !hasServicioAmount) {
              try {
                const { data: bizRow } = await supabase.from('businesses')
                  .select('settings').eq('id', bid).maybeSingle()
                const bizSettings = bizRow?.settings || {}
                const bizType = String(bizSettings.business_type || '').toLowerCase()
                if (bizType === 'restaurant' || bizType === 'food_truck') {
                  const { data: leyFlag } = await supabase.from('app_settings')
                    .select('value').eq('business_id', bid).eq('key', 'receipt_show_servicio_ley').maybeSingle()
                  const flagVal = leyFlag?.value
                  const optedOut = (flagVal === '0' || flagVal === 0 || flagVal === false || flagVal === 'false')
                  if (!optedOut) {
                    // ITBIS-exempt 10% over subtotal ex-ITBIS. Caller's
                    // data.subtotal here is GROSS (ITBIS-inclusive, DR retail
                    // convention) so we strip ITBIS using the resolved factor.
                    const grossSub = Number(data.subtotal) || 0
                    const subEx = grossSub > 0 ? grossSub / (1 + itbisFactor) : 0
                    const computed = Math.round(subEx * 0.10 * 100) / 100
                    if (computed > 0) {
                      data.ley = computed
                      // ley is NOT subject to ITBIS — total = subtotal+itbis+ley.
                      const newTotal = Math.round(((Number(data.total) || 0) + computed) * 100) / 100
                      data.total = newTotal
                    }
                  }
                }
              } catch (e) { console.error('[web.js] ley auto-compute failed:', e.message) }
            }

            // ── Server-side price validation (#21) ────────────────────────
            // Validate item prices against real DB values before proceeding.
            // Prevents client-side price manipulation via DevTools.
            const itemsToValidate = (data.items || []).filter(i => i.service_id || i.inventory_item_id)
            if (itemsToValidate.length > 0) {
              const { data: validation, error: valErr } = await supabase.rpc('validate_ticket_prices', {
                p_business_id: bid,
                p_items: itemsToValidate.map(i => ({
                  service_id: i.service_id || null,
                  inventory_item_id: i.inventory_item_id || null,
                  name: i.name,
                  price: i.price,
                  quantity: i.quantity || 1,
                })),
              })
              if (valErr) console.error('[web.js] price validation RPC error:', valErr.message)
              if (validation && !validation.valid) {
                const errMsg = (validation.errors || []).map(e => e.error).join('; ')
                throw new Error('Price validation failed: ' + errMsg)
              }
            }

            // Generate doc_number
            // Atomic doc_number: find max existing, not count (avoids gaps from voids)
            const { data: lastDoc } = await supabase.from('tickets')
              .select('doc_number')
              .eq('business_id', bid)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            let nextNum = 1
            if (lastDoc?.doc_number) {
              const m = lastDoc.doc_number.match(/T-(\d+)/)
              if (m) nextNum = parseInt(m[1], 10) + 1
            }
            const docNum = `T-${String(nextNum).padStart(4, '0')}`

            const status = data.status || (data.tipo_venta === 'credito' || data.payment_method === 'credit' ? 'pendiente' : 'cobrado')

            // Resolve incoming empleado refs to canonical supabase_id BEFORE
            // the ticket insert. POS sends empleados.id (PK); the FK columns
            // need empleados.supabase_id. Look up by either and emit canonical.
            async function resolveEmpleadoSidsRaw(refs) {
              if (!refs?.length) return []
              const list = refs.filter(Boolean)
              if (!list.length) return []
              const { data: rows } = await supabase.from('empleados')
                .select('id, supabase_id')
                .or(`id.in.(${list.join(',')}),supabase_id.in.(${list.join(',')})`)
                .eq('business_id', bid)
              const map = new Map()
              for (const r of (rows || [])) {
                map.set(r.id, r.supabase_id)
                map.set(r.supabase_id, r.supabase_id)
              }
              return list.map(ref => map.get(ref)).filter(Boolean)
            }
            const washerSidsResolved = await resolveEmpleadoSidsRaw(data.washer_ids || data.washer_empleado_supabase_ids || [])
            const sellerRefRaw = data.seller_supabase_id || data.seller_id || null
            const sellerSidResolved = sellerRefRaw ? (await resolveEmpleadoSidsRaw([sellerRefRaw]))[0] || null : null
            // v2.16.10 2026-04-30 — DO NOT REVERT (FIX-LEDGER §2.12). POS sends
            // cajero_id as numeric (or 'web' string for web sessions). Without
            // this resolution every web ticket lands with cajero_supabase_id=NULL,
            // breaking cajero_commissions + cuadre-by-cashier reports.
            const cajeroRefRaw = data.cajero_supabase_id || data.cajero_id || null
            const cajeroSidResolved = cajeroRefRaw && cajeroRefRaw !== 'web'
              ? (await resolveEmpleadoSidsRaw([cajeroRefRaw]))[0] || null : null

            // Insert ticket — re-use the pre-minted supabase_id so retries
            // (offline-queue replay, double-submit) collide on the UNIQUE
            // (business_id, supabase_id) and never produce duplicate rows.
            //
            // v2.16.27 — Use Prefer:return=minimal (no ?select=*). The
            // representation read-back was throwing PGRST116/HTTP 400 on
            // some payload variations even though the row landed
            // successfully — kicking the offline-queue replay on every
            // credit+oferta sale and cluttering the console with red.
            // Insert minimally, then fetch the row by supabase_id (a
            // separate, decoupled SELECT that fails clean if RLS denies).
            const ticketSid = data.supabase_id
            throwSupaError(await supabase.from('tickets').insert({
              supabase_id:     ticketSid,
              business_id:     bid,
              doc_number:      docNum,
              client_supabase_id: data.client_supabase_id || null,
              client_name:        data.client_name || null,
              client_rnc:         data.client_rnc || null,
              // v2.16.10 — schema-drift sweep. Supabase migration 2026-04-30
              // added these. Previously the code wrote them but PostgREST
              // silently dropped the keys.
              appointment_supabase_id: data.appointment_supabase_id || null,
              mesa_supabase_id:    data.mesa_supabase_id || null,
              servicio_pct:        data.servicio_pct != null ? Number(data.servicio_pct) : null,
              servicio_amount:     data.servicio_amount != null ? Number(data.servicio_amount) : null,
              washer_empleado_supabase_ids: washerSidsResolved,
              seller_empleado_supabase_id: sellerSidResolved,
              cajero_supabase_id: cajeroSidResolved,
              subtotal:        data.subtotal || 0,
              descuento:       data.descuento || 0,
              // v2.16.10 2026-04-30 — DO NOT REVERT (FIX-LEDGER §2.12).
              // Audit confirmed POS sent these but PostgREST silently dropped
              // them because columns either didn't exist or weren't in payload.
              // Persist now: ncf (eNCF stamp), descuento_reason (manager-auth
              // discount audit), mac_jti (anti-replay), notes (cashier comments).
              ncf:             data.ncf || null,
              ncf_type:        data.ncf_type || data.comprobante_type || null,
              descuento_reason: data.descuento_reason || null,
              mac_jti:         data.mac_jti || null,
              itbis:           data.itbis || 0,
              ley:             data.ley || 0,
              total:           data.total || 0,
              payment_method:  data.payment_method || 'cash',
              comprobante_type:data.comprobante_type || 'B02',
              ecf_result:      data.ecf_result || {},
              tipo_venta:      data.tipo_venta || 'contado',
              status,
              vehicle_plate:   data.vehicle_plate || null,
              // POS sends free-form cashier notes as `comentario`; schema column is `notes`.
              notes:           data.notes || data.comentario || null,
              mode:            data.mode || null,
              // v2.16.27 — NOT NULL column. The legacy `Number(x || 0) || null`
              // pattern coerced a real 0 (e.g. retail / Ranoza with no beverage
              // line) into null and tripped 23502. Use Number directly + explicit
              // 0 fallback. THIS is the bug that was returning HTTP 400 on every
              // credit+oferta sale (DB rejected, offline-queue replay then
              // produced a duplicate via syncPendingTickets which sets a default).
              beverage_subtotal: Number(data.beverage_subtotal) || 0,
              order_source:    data.order_source || 'pos',
              // v2.10.4 — restaurant split-bill persistence. JSONB column, so
              // pass the array as-is (no stringify). NULL = single-method
              // ticket. See supabase/migrations/20260420100000_*.sql.
              payment_parts:   (Array.isArray(data.payment_parts) && data.payment_parts.length) ? data.payment_parts : null,
              split_bill:      (data.split === true || (Array.isArray(data.payment_parts) && data.payment_parts.length > 1)) || false,
              is_test:         !_liveWeb,
            }, { returning: 'minimal' }))

            // v2.16.27 — Decoupled read-back. Fetch the just-inserted row
            // by (business_id, supabase_id) so downstream side-effects
            // (queue, balance, items, commissions) keep getting the int
            // ticket.id they need — but a SELECT-RLS denial here just
            // returns null instead of cluttering the console with 400.
            const { data: ticket } = await supabase.from('tickets')
              .select('id, doc_number')
              .eq('business_id', bid)
              .eq('supabase_id', ticketSid)
              .maybeSingle()

            // Insert ticket items — try with business_id first, fall back without
            // Snapshot each item's cost at sale time for historical profit accuracy.
            // Look up current service costs once, then fall back to explicit item.cost.
            const items = data.items || []
            let svcCostById = new Map()
            if (items.length && ticket?.id) {
              const svcIds = items.map(i => i.service_id).filter(Boolean)
              if (svcIds.length) {
                const { data: svcRows } = await supabase.from('services').select('id, cost, aplica_itbis').in('id', svcIds)
                svcCostById = new Map((svcRows || []).map(r => [r.id, r.cost || 0]))
                var svcItbisById = new Map((svcRows || []).map(r => [r.id, r.aplica_itbis ?? 1]))
              }
              const itemRows = items.map(i => ({
                supabase_id:        crypto.randomUUID(),
                ticket_supabase_id: ticketSid,
                service_supabase_id: i.service_supabase_id || null,
                inventory_item_supabase_id: i.inventory_item_supabase_id || null,
                // v2.16.1 patch (#2) — per-line stylist credit (commission split)
                empleado_supabase_id: i.empleado_supabase_id || null,
                // v2.16.10 2026-04-30 — DO NOT REVERT (FIX-LEDGER §2.12).
                // Bundle promo attribution. Without this, on-void reversal can
                // leak inventory because oferta-grouped lines aren't unwound
                // as a unit.
                oferta_supabase_id: i.oferta_supabase_id || null,
                course:             i.course || null,
                guest_number:       i.guest_number || null,
                preparation_notes:  i.preparation_notes || null,
                name:               i.name,
                price:              i.price,
                cost:               i.cost != null ? Number(i.cost) : (i.service_id ? (svcCostById.get(i.service_id) || 0) : 0),
                itbis: (() => {
                  const aplica = i.aplica_itbis !== undefined ? i.aplica_itbis : (i.service_id ? (svcItbisById.get(i.service_id) ?? 1) : 1)
                  if (aplica === 0) return 0
                  // DR retail convention: `i.price` is GROSS (price tag includes ITBIS).
                  // Extract embedded ITBIS: gross - gross/(1+factor). Storing `price * factor`
                  // would over-count by ~18% (e.g. RD$829.20 gross → RD$126.49 ITBIS, not RD$149.26).
                  return parseFloat((Number(i.price) - Number(i.price) / (1 + itbisFactor)).toFixed(2))
                })(),
                is_wash:            i.is_wash ?? true,
                quantity:           i.quantity || 1,
                sku:                i.sku || null,
                weight:             i.weight != null ? Number(i.weight) : null,
                unit:               i.unit || null,
                price_per_unit:     i.price_per_unit != null ? Number(i.price_per_unit) : null,
              }))
              // Try with business_id (some Supabase schemas have it)
              const { error: err1 } = await supabase.from('ticket_items').insert(
                itemRows.map(r => ({ ...r, business_id: bid }))
              )
              if (err1) {
                // Retry without business_id
                const { error: err2 } = await supabase.from('ticket_items').insert(itemRows)
                if (err2) console.error('[ticket_items insert]', err2.message)
              }

              // v2.16.28 (P1) — DOUBLE-DEDUCT FIX. The DB has a Postgres
              // trigger `trg_ticket_items_decrement_inventory` that fires
              // on every ticket_items INSERT and decrements inventory ONLY
              // when the parent ticket's status='cobrado'. For cash sales
              // (status='cobrado' at insert), the trigger handles the
              // deduct + oversell record perfectly. The JS loop below was
              // the SECOND deduct, producing the -2 per qty=1 sale Mike
              // saw on Bacardi (3 → 1 instead of 3 → 2).
              //
              // Credit sales (status='pendiente') are NOT touched by the
              // trigger — for those the JS loop below is the ONLY deduct
              // path and we keep firing it. When the credit gets paid
              // later, status flips to 'cobrado' via UPDATE which doesn't
              // re-fire the INSERT trigger, so no second deduct.
              if (status !== 'cobrado') {
                // Credit-sale path. The server INSERT trigger only fires for
                // status='cobrado', so we deduct here. MUST be atomic — the
                // old SELECT-then-UPDATE had a 30-300ms race window that
                // dual-terminal Ranoza would exploit (lost-update on last
                // bottle, no oversell row created). RPC FOR-UPDATE-locks each
                // row, deducts in one statement, and inserts inventory_oversells
                // when stock can't cover the request.
                const rpcItems = items
                  .filter(it => it.inventory_item_supabase_id)
                  .map(it => ({
                    item_supabase_id: it.inventory_item_supabase_id,
                    qty:              it.quantity || 1,
                    name:             it.name || null,
                  }))
                if (rpcItems.length) {
                  try {
                    await supabase.rpc('deduct_inventory_atomic', {
                      p_business_id:        bid,
                      p_ticket_supabase_id: ticketSid,
                      p_hwid:               'web',
                      p_items:              rpcItems,
                    })
                  } catch (e) { console.error('[web.js] deduct_inventory_atomic failed:', e.message) }
                }
              }
            }

            // Commission calculations — service prices are ITBIS-inclusive; strip
            // using the same itbisFactor resolved above so per-business rate changes
            // (e.g. 16% or 0% for exempt tiendas) flow into commission base.
            const bevSub = data.beverage_subtotal || 0
            const gross2base = 1 + itbisFactor
            const commBase = parseFloat(((data.subtotal - bevSub) / gross2base).toFixed(2))
            const bevBase  = bevSub > 0 ? parseFloat((bevSub / gross2base).toFixed(2)) : 0

            // Resolve incoming empleado refs to canonical supabase_id.
            // POS sends `washer_ids` / `seller_supabase_id` / `cajero_supabase_id`
            // populated from washers.all / sellers.all / users.all — these may be
            // either empleados.id (Supabase PK) OR empleados.supabase_id (sync key).
            // Look up by EITHER and emit the canonical supabase_id for the FK.
            async function resolveEmpleadoSid(refs) {
              if (!refs?.length) return []
              const { data: rows } = await supabase.from('empleados')
                .select('id, supabase_id, comision_pct')
                .or(`id.in.(${refs.join(',')}),supabase_id.in.(${refs.join(',')})`)
                .eq('business_id', bid)
              return (rows || []).map(r => ({ supabase_id: r.supabase_id, comision_pct: r.comision_pct || 0 }))
            }

            // Washer commissions — only on wash/service items (NOT beverages/snacks).
            if (_liveWeb && ticket?.id && commBase > 0 && Array.isArray(data.washer_ids) && data.washer_ids.length) {
              try {
                const empRows = await resolveEmpleadoSid(data.washer_ids)
                for (const e of empRows) {
                  if (e.comision_pct <= 0) continue
                  const amt = parseFloat((commBase * e.comision_pct / 100).toFixed(2))
                  await supabase.from('washer_commissions').insert({
                    supabase_id: crypto.randomUUID(), business_id: bid, empleado_supabase_id: e.supabase_id, ticket_supabase_id: ticketSid,
                    base_amount: commBase, commission_pct: e.comision_pct, commission_amount: amt, paid: false,
                  })
                }
              } catch (e) { console.error('[web.js] washer commission insert failed:', e.message) }
            }

            // Seller commission — only on wash/service items (NOT beverages/snacks).
            const sellerRef = data.seller_supabase_id || data.seller_id || null
            if (_liveWeb && ticket?.id && commBase > 0 && sellerRef) {
              try {
                const [seller] = await resolveEmpleadoSid([sellerRef])
                if (seller && seller.comision_pct > 0) {
                  const amt = parseFloat((commBase * seller.comision_pct / 100).toFixed(2))
                  await supabase.from('seller_commissions').insert({
                    supabase_id: crypto.randomUUID(), business_id: bid, empleado_supabase_id: seller.supabase_id, ticket_supabase_id: ticketSid,
                    base_amount: commBase, commission_pct: seller.comision_pct, commission_amount: amt, paid: false,
                  })
                }
              } catch (e) { console.error('[web.js] seller commission insert failed:', e.message) }
            }

            // v2.16.1 patch (#2) — per-line stylist commission credits.
            // When CobrarModal stamped `empleado_supabase_id` on individual
            // items, those lines bypass the ticket-level seller/washer
            // roll-up and credit the picker directly. We do NOT subtract them
            // from commBase here (web roll-up uses subtotal-bevSub, which is
            // independent of per-line empleado), so for full accuracy salon
            // tenants should rely on per-line picks only when no ticket-level
            // washer/seller is supplied. Same trade-off as the carwash split.
            try {
              const itemsWithEmp = (data.items || []).filter(i => i?.empleado_supabase_id)
              if (_liveWeb && ticket?.id && itemsWithEmp.length) {
                const grossByEmp = new Map()
                for (const i of itemsWithEmp) {
                  const line = (Number(i.price) || 0) * (Number(i.quantity) || 1)
                  grossByEmp.set(i.empleado_supabase_id, (grossByEmp.get(i.empleado_supabase_id) || 0) + line)
                }
                const sids = [...grossByEmp.keys()]
                const { data: empRows } = await supabase.from('empleados')
                  .select('supabase_id, comision_pct, tipo').in('supabase_id', sids).eq('business_id', bid)
                for (const emp of (empRows || [])) {
                  const pct = Number(emp.comision_pct || 0)
                  if (pct <= 0) continue
                  const grossSum = grossByEmp.get(emp.supabase_id) || 0
                  const baseStripped = parseFloat((grossSum / (1 + itbisFactor)).toFixed(2))
                  const amt = parseFloat((baseStripped * pct / 100).toFixed(2))
                  const tbl = emp.tipo === 'vendedor' ? 'seller_commissions' : 'washer_commissions'
                  await supabase.from(tbl).insert({
                    supabase_id: crypto.randomUUID(), business_id: bid,
                    empleado_supabase_id: emp.supabase_id, ticket_supabase_id: ticketSid,
                    base_amount: baseStripped, commission_pct: pct, commission_amount: amt, paid: false,
                  })
                }
              }
            } catch (e) { console.error('[web.js] per-line commission insert failed:', e.message) }

            // Cajero commission — on beverages/snacks ONLY.
            const cajeroRef = data.cajero_supabase_id || data.cajero_id || null
            if (_liveWeb && ticket?.id && bevBase > 0 && cajeroRef) {
              try {
                const [cajero] = await resolveEmpleadoSid([cajeroRef])
                if (cajero && cajero.comision_pct > 0) {
                  const amt = parseFloat((bevBase * cajero.comision_pct / 100).toFixed(2))
                  await supabase.from('cajero_commissions').insert({
                    supabase_id: crypto.randomUUID(), business_id: bid, empleado_supabase_id: cajero.supabase_id, ticket_supabase_id: ticketSid,
                    base_amount: bevBase, commission_pct: cajero.comision_pct, commission_amount: amt, paid: false,
                  })
                }
              } catch (e) { console.error('[web.js] cajero commission insert failed:', e.message) }
            }

            // Auto-add to queue ONLY for pendiente tickets (Encolar path).
            let queueError = null
            if (ticket?.id && status === 'pendiente') {
              const washerRefs = Array.isArray(data.washer_ids) ? data.washer_ids : []
              let firstEmpSid = null
              if (washerRefs.length) {
                const empRows = await resolveEmpleadoSid([washerRefs[0]])
                firstEmpSid = empRows[0]?.supabase_id || null
              }
              const { error: queueErr } = await supabase.from('queue').insert({
                supabase_id: crypto.randomUUID(),
                business_id: bid,
                ticket_supabase_id: ticketSid,
                status:      'waiting',
                empleado_supabase_id: firstEmpSid,
              })
              if (queueErr) queueError = queueErr.message
            }

            // Update client balance for credit sales (by supabase_id)
            if (_liveWeb && status === 'pendiente' && data.client_supabase_id) {
              try {
                const { data: cl } = await supabase.from('clients').select('balance').eq('supabase_id', data.client_supabase_id).eq('business_id', bid).single()
                if (cl) await supabase.from('clients').update({ balance: (cl.balance || 0) + (data.total || 0) }).eq('supabase_id', data.client_supabase_id).eq('business_id', bid)
              } catch (e) { console.error('[web.js] client balance increment failed:', e.message) }
            }

            const desc = Number(data.descuento || 0)
            const subt = Number(data.subtotal || 0)
            const pct  = subt > 0 ? (desc / subt) * 100 : 0
            if (desc > 500 || pct > 15) {
              await logActivity({ event_type: 'discount_applied',
                severity: desc > 2000 || pct > 30 ? 'warn' : 'info',
                target_type: 'ticket', target_id: ticket.id, target_name: docNum || `#${ticket.id}`,
                amount: desc,
                metadata: { subtotal: subt, total: data.total, pct: Math.round(pct * 10) / 10, payment_method: data.payment_method } })
            }
            return { id: ticket.id, supabase_id: ticketSid, docNumber: docNum, ncf: null, queueError }
          })()
        } catch (err) {
          // v2.16.28 (B2) — ONLY enqueue offline on actual network failure.
          // Database errors (RLS, FK, NOT NULL, CHECK) must throw all the
          // way to the cobrar modal so the cashier sees the real problem
          // and the row doesn't lie about being "saved offline" when it
          // was actually rejected by the schema.
          const msg = err?.message || ''
          const isNetwork = (typeof navigator !== 'undefined' && navigator.onLine === false)
            || /Failed to fetch|NetworkError|TypeError: fetch|ERR_INTERNET_DISCONNECTED/i.test(msg)
          if (isNetwork) {
            const offlineId = await enqueueTicket(data)
            return { id: `offline-${offlineId}`, docNumber: 'OFFLINE', ncf: null, offline: true, offlineReason: msg || String(err) }
          }
          // Real DB / validation error — throw to caller (POS handlePaymentConfirm
          // re-throws, CobrarModal catches and renders red error state).
          throw err
        }
      },

      markPaid: (data) => tryWrite(async () => {
        const updates = { status: 'cobrado' }
        if (data.paymentMethod || data.payment_method) updates.payment_method = data.paymentMethod || data.payment_method
        if (data.ncf) updates.ncf = data.ncf
        if (data.ecfResult || data.ecf_result) updates.ecf_result = data.ecfResult || data.ecf_result
        if (data.tipoVenta || data.tipo_venta) updates.tipo_venta = data.tipoVenta || data.tipo_venta
        if (data.client_supabase_id) updates.client_supabase_id = data.client_supabase_id
        if (data.comentario != null || data.notes != null) updates.notes = data.comentario ?? data.notes
        if (data.descuento != null) updates.descuento = Number(data.descuento)

        const ticketId = data.id || data.ticket_id
        // v2.10.3 — bump rev so Supabase trg_tickets_rev_guard accepts the status change.
        const { data: curMp } = await supabase.from('tickets').select('rev').eq('id', ticketId).eq('business_id', bid).maybeSingle()
        updates.rev = Number(curMp?.rev || 0) + 1
        throwSupaError(await supabase.from('tickets').update(updates).eq('id', ticketId).eq('business_id', bid))

        // Update queue status to done — match by ticket's supabase_id
        const { data: t } = await supabase.from('tickets').select('supabase_id').eq('id', ticketId).maybeSingle()
        if (t?.supabase_id) {
          await supabase.from('queue').update({ status: 'done', completed_at: new Date().toISOString() })
            .eq('ticket_supabase_id', t.supabase_id).eq('business_id', bid)
        }

        return { id: ticketId }
      }, 'web.tickets.markPaid'),

      void: (data) => tryWrite(async () => {
        const { id, reason, voidBy } = typeof data === 'object' ? data : { id: data }
        // v2.16.31 — also pull ecf_result so the NCF-decrement-on-void path
        // can fall back when the top-level `ncf` column is null. Legacy
        // tickets store the assigned NCF inside ecf_result.eNCF (set by
        // CobrarModal isLegacy branch); only certified e-CF tickets that
        // round-tripped to DGII end up with a non-null tickets.ncf column.
        const priorRow = (await supabase.from('tickets').select('supabase_id, doc_number, total, descuento, payment_method, tipo_venta, client_supabase_id, ncf, ecf_result, rev').eq('id', id).eq('business_id', bid).maybeSingle())?.data
        // v2.10.3 — bump rev so Supabase trg_tickets_rev_guard accepts the status change.
        throwSupaError(await supabase.from('tickets').update({
          status: 'nula',
          void_reason: reason || '',
          void_by: voidBy || null,
          void_at: new Date().toISOString(),
          rev: Number(priorRow?.rev || 0) + 1,
        }).eq('id', id).eq('business_id', bid))
        if (priorRow) {
          await logActivity({ event_type: 'ticket_voided', severity: 'critical',
            target_type: 'ticket', target_id: id, target_name: priorRow.doc_number || `#${id}`,
            amount: priorRow.total, reason: reason || null,
            metadata: { payment_method: priorRow.payment_method, tipo_venta: priorRow.tipo_venta, ncf: priorRow.ncf } })

          // v2.13.0 — NCF counter reclaim + ANECF auto-enqueue (E-C6).
          // Legacy (B01/B02) only: decrement if last-issued so next ticket reuses.
          // e-CF (E3x): enqueue ANECF so DGII is notified. Both paths best-effort;
          // void has already succeeded above.
          // v2.16.31 — fall back to ecf_result.eNCF when the top-level
          // tickets.ncf column is null (legacy/local stub path leaves
          // tickets.ncf NULL and writes the NCF to ecf_result.eNCF only).
          // Without this fallback, every legacy void silently skipped the
          // decrement and the sequence stayed inflated.
          let priorNcf = priorRow.ncf
          if (!priorNcf) {
            try {
              const er = priorRow.ecf_result
              const erObj = typeof er === 'string' ? JSON.parse(er) : er
              priorNcf = erObj?.eNCF || null
            } catch { priorNcf = null }
          }
          if (priorNcf) {
            try {
              const m = String(priorNcf).trim().match(/^([A-Z]\d{2})(\d+)$/)
              if (m) {
                const prefix = m[1]
                const num = parseInt(m[2], 10)
                const isEcf = prefix.startsWith('E')
                if (!isEcf && Number.isFinite(num) && num > 0) {
                  // Legacy: decrement if it matches current_number for this prefix.
                  // v2.16.31 — `active` is BOOLEAN in live schema (per
                  // SCHEMA-SNAPSHOT.md). The `.eq('active', 1)` previously
                  // worked because PostgREST coerces 1→true on a boolean
                  // column, but make it explicit + match the by-type lookup
                  // pattern used elsewhere (the `prefix` column historically
                  // had stray values like 'E320' from sync corruption — see
                  // electron/database.js:8100-8104; type is the canonical
                  // 3-char prefix, so match by that).
                  const { data: seq } = await supabase.from('ncf_sequences')
                    .select('type, current_number').eq('business_id', bid).eq('type', prefix).eq('active', true).maybeSingle()
                  if (seq && Number(seq.current_number) === num) {
                    await supabase.from('ncf_sequences').update({ current_number: num - 1 })
                      .eq('business_id', bid).eq('type', seq.type)
                    // 2026-05-18 fix (cobro cascade): release the NCF from the
                    // voided ticket so the next allocation can reuse the number
                    // without hitting uq_tickets_biz_ncf. Audit trail is preserved
                    // via the ticket_voided activity_log row above (which captures
                    // the original NCF in metadata) — the row itself stays as
                    // status='nula' for sales-history visibility, just without
                    // the NCF claim that conflicts on the next allocation.
                    await supabase.from('tickets')
                      .update({ ncf: null, ncf_type: null })
                      .eq('id', id).eq('business_id', bid)
                  }
                } else if (isEcf) {
                  // e-CF: insert (idempotent) into anecf_queue; UNIQUE(business_id,ncf).
                  // v2.16.31 — use the resolved priorNcf (top-level ncf or
                  // ecf_result.eNCF fallback) so this path also fires for
                  // tickets where only ecf_result captured the NCF.
                  const tipoEcf = prefix.substring(1, 3)
                  await supabase.from('anecf_queue').insert({
                    business_id: bid,
                    ticket_id: id,
                    ticket_supabase_id: priorRow.supabase_id || null,
                    ncf: priorNcf,
                    tipo_ecf: tipoEcf,
                    rango_desde: priorNcf,
                    rango_hasta: priorNcf,
                    environment: 'certecf',
                    supabase_id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : undefined,
                  })
                  await logActivity({ event_type: 'ncf_auto_anecf', severity: 'warn',
                    target_type: 'ticket', target_id: id, target_name: priorNcf,
                    metadata: { ncf: priorNcf, tipo_ecf: tipoEcf, ticket_supabase_id: priorRow.supabase_id || null } })
                }
              }
            } catch (e) { try { console.warn('[web.js] ncf/anecf post-void skip:', e.message) } catch {} }
          }

          // Reverse credit-ticket balance (net of descuento, clamped at 0)
          if (priorRow.tipo_venta === 'credito' && priorRow.client_supabase_id) {
            // ticket.total is already NET (POS sends net); do not subtract descuento again.
            const net = Math.max(0, Number(priorRow.total || 0))
            if (net > 0) {
              const { data: cl } = await supabase.from('clients').select('balance').eq('supabase_id', priorRow.client_supabase_id).eq('business_id', bid).single()
              if (cl) await supabase.from('clients').update({ balance: Math.max(0, (cl.balance || 0) - net) })
                .eq('supabase_id', priorRow.client_supabase_id).eq('business_id', bid)
            }
          }

          // Reverse commissions tied to this ticket — they're unearned on void
          if (priorRow.supabase_id) {
            const tSid = priorRow.supabase_id
            await supabase.from('washer_commissions').delete().eq('business_id', bid).eq('ticket_supabase_id', tSid)
            await supabase.from('seller_commissions').delete().eq('business_id', bid).eq('ticket_supabase_id', tSid)
            await supabase.from('cajero_commissions').delete().eq('business_id', bid).eq('ticket_supabase_id', tSid)
          }
        }

        // Reverse inventory stock for product items (by supabase_id).
        // RPT-H4: fair reversal — if a shortage was recorded at sale-time
        // (requested > available), restore only actual_qty (what was deducted),
        // not the requested qty. Prevents phantom stock on void.
        try {
          const tSid = priorRow?.supabase_id
          if (tSid) {
            const { data: items } = await supabase.from('ticket_items')
              .select('inventory_item_supabase_id, quantity')
              .eq('ticket_supabase_id', tSid)
              .not('inventory_item_supabase_id', 'is', null)
            for (const item of (items || [])) {
              const qty = item.quantity || 1
              const invSid = item.inventory_item_supabase_id
              // Check for shortage rows on this (ticket, item); if any, use actual_qty sum.
              let fulfilled = qty
              try {
                const { data: shortages } = await supabase.from('inventory_oversells')
                  .select('requested_qty, actual_qty')
                  .eq('ticket_supabase_id', tSid)
                  .eq('item_supabase_id', invSid)
                  .eq('business_id', bid)
                if (shortages && shortages.length) {
                  const totReq = shortages.reduce((s, r) => s + Number(r.requested_qty || 0), 0)
                  const totAct = shortages.reduce((s, r) => s + Number(r.actual_qty || 0), 0)
                  if (totReq > 0) fulfilled = totAct
                }
              } catch { /* no shortages table access → fall back to qty */ }
              const { data: inv } = await supabase.from('inventory_items').select('quantity').eq('supabase_id', invSid).eq('business_id', bid).single()
              if (inv) await supabase.from('inventory_items').update({ quantity: (inv.quantity || 0) + fulfilled }).eq('supabase_id', invSid).eq('business_id', bid)
              // RPT-H4: mark shortage rows as voided so Quiebres reflects resolution.
              try {
                await supabase.from('inventory_oversells').update({
                  resolved_at: new Date().toISOString(),
                  resolution_type: 'voided',
                  resolution_notes: `Void ticket ${tSid}`
                }).eq('ticket_supabase_id', tSid).eq('item_supabase_id', invSid).eq('business_id', bid).is('resolved_at', null)
              } catch { /* best-effort */ }
            }
          }
        } catch (e) { console.error('[web.js] void stock reversal failed:', e.message) }
        // v2.16.31 — Inventory refresh broadcast: ProductGrid/POS-side
        // displays should re-fetch since stock returned. Only fire that
        // event; do NOT broadcast tx:tickets-refresh from the void path.
        //
        // Why no tickets-refresh dispatch on void: DailyReport's handleVoid
        // already does an optimistic setTransactions that flips the affected
        // row's estado to 'nula' in place. If we ALSO dispatched a refresh,
        // the listener-triggered byDateRange round-trip races against the
        // optimistic update — observed live: list briefly empties and
        // re-populates, sometimes with the loading spinner masking the row
        // long enough that the user sees a blank list and loses confidence
        // ("ventas disappeared after anular"). Cobrar from POS still
        // dispatches tx:tickets-refresh because that's a different tab
        // pattern (cross-tab propagation, no in-tab optimistic update to
        // race against). Keep this dispatch removed.
        try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('tx:inventory-refresh')) } catch {}
      }, 'web.tickets.void'),

      // C2/v2.16.4 — `getActiveByMesa` superseded by the open_status-based
      // implementation defined further down (open_status='open' filter +
      // nested ticket_items + ticket_item_modificadores). Legacy block removed
      // here to keep a single source of truth.

      // v2.16.3 — Restaurante H3 "Mover": move an open ticket from its current
      // mesa to a free target mesa. Both the ticket row AND mesa rows are
      // updated atomically (best-effort sequence — RLS scopes by business_id
      // so cross-tenant leakage is impossible). Manager-gated at the UI layer.
      //
      // Inputs:
      //   ticketSupabaseId  string  open ticket UUID
      //   newMesaId         number  target mesa.id (libre/sucia/reservada)
      //
      // Side-effects:
      //   - tickets.{mesa_id, mesa_supabase_id} → new mesa
      //   - mesas[old].status='sucia', clears guests/seated_at/waiter
      //   - mesas[new].status='ocupada', copies guests/waiter/seated_at
      //   - activity_log row: restaurant_mesa_transfer (info)
      transferToMesa: (ticketSupabaseId, newMesaId) => tryWrite(async () => {
        if (!ticketSupabaseId || !newMesaId) throw new Error('Faltan parámetros')

        // v2.16.10 — schema-drift fix: tickets.mesa_id does NOT exist on Supabase
        // (only mesa_supabase_id). Prior code selected mesa_id → always NULL →
        // same-mesa guard fell open, old mesa never freed. Audit 2026-04-30.
        const { data: ticket } = await supabase.from('tickets')
          .select('id, supabase_id, mesa_supabase_id, guests, waiter_empleado_supabase_id, doc_number, status, created_at')
          .eq('business_id', bid).eq('supabase_id', ticketSupabaseId).maybeSingle()
        if (!ticket) throw new Error('Ticket no encontrado')
        if (['cobrado','nula','anulado','voided'].includes(ticket.status)) throw new Error('Ticket ya cerrado')

        const { data: newMesa } = await supabase.from('mesas')
          .select('id, supabase_id, name, status').eq('id', newMesaId).eq('business_id', bid).maybeSingle()
        if (!newMesa) throw new Error('Mesa destino no existe')
        if (ticket.mesa_supabase_id === newMesa.supabase_id) throw new Error('La mesa destino es la misma')
        if (!['libre','sucia','reservada'].includes(newMesa.status)) {
          throw new Error('Mesa destino no está disponible')
        }

        const { data: oldMesa } = ticket.mesa_supabase_id ? await supabase.from('mesas')
          .select('id, supabase_id, name, guests_count, waiter_empleado_supabase_id, seated_at')
          .eq('supabase_id', ticket.mesa_supabase_id).eq('business_id', bid).maybeSingle() : { data: null }

        // Rebump rev for tickets.rev_guard trigger (matches markPaid pattern).
        const { data: cur } = await supabase.from('tickets').select('rev').eq('id', ticket.id).maybeSingle()
        const nextRev = Number(cur?.rev || 0) + 1

        // 1. Move the ticket
        throwSupaError(await supabase.from('tickets').update({
          mesa_supabase_id: newMesa.supabase_id,
          rev: nextRev,
        }).eq('id', ticket.id).eq('business_id', bid))

        // 2. Free the old mesa (status='sucia' to force a wipe-down before reseat)
        if (oldMesa?.id) {
          throwSupaError(await supabase.from('mesas').update({
            status: 'sucia',
            guests_count: null,
            waiter_empleado_supabase_id: null,
            seated_at: null,
            bill_requested_at: null,
          }).eq('id', oldMesa.id).eq('business_id', bid))
        }

        // 3. Seat the new mesa with the carried-over context
        const seatedAt = oldMesa?.seated_at || ticket.created_at || new Date().toISOString()
        throwSupaError(await supabase.from('mesas').update({
          status: 'ocupada',
          guests_count: oldMesa?.guests_count ?? ticket.guests ?? null,
          waiter_empleado_supabase_id: oldMesa?.waiter_empleado_supabase_id ?? ticket.waiter_empleado_supabase_id ?? null,
          seated_at: seatedAt,
          bill_requested_at: null,
        }).eq('id', newMesa.id).eq('business_id', bid))

        await logActivity({
          event_type: 'restaurant_mesa_transfer',
          severity: 'info',
          target_type: 'ticket',
          target_id: ticket.id,
          target_name: ticket.doc_number || `#${ticket.id}`,
          metadata: {
            from_mesa_id: oldMesa?.id ?? null,
            from_mesa_name: oldMesa?.name ?? null,
            to_mesa_id: newMesa.id,
            to_mesa_name: newMesa.name,
          },
        })
        return { ok: true, ticket_id: ticket.id, new_mesa_id: newMesa.id }
      }, 'web.tickets.transferToMesa'),

      // ── Mesas add-on: running-tab support ─────────────────────────────────
      // byMesa: load the latest active ticket for a mesa (by supabase_id)
      // plus all its ticket_items so the POS can re-hydrate them into the
      // cart for an "add another beer" flow.
      //
      // 2026-05-17 FIX: original query filtered on open_status='open' which
      // is only set by restaurant-style open tabs (mesa "abrir" → status
      // 'open' → close on cobrar). Carwash tickets created via Encolar
      // have open_status='closed' even though they sit in cola with a
      // mesa tag. Result: the mesa showed RED (occupied — because the
      // queue.active poll matched the cola row) but clicking it returned
      // "no hay ticket abierto" because byMesa filtered out the only row.
      //
      // New criterion mirrors the occupied poll: find the latest ticket
      // on this mesa whose status is still in-flight (not cobrado/voided
      // /cancelled/merged). This matches whatever the user sees as
      // "occupied" on the mesa circle.
      byMesa: (mesaSupabaseId) => tryOr(async () => {
        if (!mesaSupabaseId) return null
        const { data: ticket, error: tErr } = await supabase.from('tickets')
          .select('*')
          .eq('business_id', bid)
          .eq('mesa_supabase_id', mesaSupabaseId)
          .not('status', 'in', '("cobrado","voided","cancelled","merged","anulado","nula")')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (tErr) throw new Error(tErr.message)
        if (!ticket?.supabase_id) return null
        const { data: rows, error: iErr } = await supabase.from('ticket_items')
          .select('id, supabase_id, name, price, quantity, preparation_notes, weight, service_supabase_id, inventory_item_supabase_id, is_wash, itbis, cost')
          .eq('business_id', bid)
          .eq('ticket_supabase_id', ticket.supabase_id)
          .order('id', { ascending: true })
        if (iErr) throw new Error(iErr.message)
        const items = (rows || []).filter(i => i?.name != null).map(i => ({
          ...i,
          qty: i.quantity,
          _cartKey: i.supabase_id || `tk-${i.id}`,
          _wasExisting: true,
        }))
        return { ...ticket, items }
      }, null),

      // appendItems: insert NEW ticket_items rows onto an already-open ticket
      // (mesa running tab). Recomputes subtotal/itbis/total from existing +
      // new items using gross→net extraction (Hard Rule #19). Throws loudly
      // if the ticket has been closed/voided between load and save (race
      // against another cashier). Activity-logs ticket_append_items.
      //
      // KNOWN GAPS (documented for follow-up):
      // 1. Commissions: new items do NOT write washer/seller/cajero rows.
      //    Mesa addon's primary use is beverages (cajero would apply) but
      //    the edit-mode UI has no empleado picker yet. Until added, the
      //    worker assigned at original Encolar gets credit for the FIRST
      //    set of items only — additions are uncommissioned. Track in
      //    FUTUREX as `mesas-addon: per-append empleado picker`.
      // 2. journal_entries posting (Hard Rule #20) is not wired here
      //    because packages/services/journal.js only exists on the
      //    feat/journal-entries-spine branch. When the spine merges to
      //    main, this needs the same `_jePost` call pattern as
      //    tickets.create.
      appendItems: ({ ticketSupabaseId, items }) => tryWrite(async () => {
        if (!ticketSupabaseId) throw new Error('Falta ticket_supabase_id')
        if (!Array.isArray(items) || items.length === 0) throw new Error('No hay items para agregar')

        // Pre-check: ticket must still be open. Loud throw on race.
        const { data: cur, error: cErr } = await supabase.from('tickets')
          .select('id, supabase_id, open_status, status, doc_number, mesa_supabase_id')
          .eq('business_id', bid)
          .eq('supabase_id', ticketSupabaseId)
          .maybeSingle()
        if (cErr) throw new Error(cErr.message)
        if (!cur) throw new Error('Ticket no encontrado')
        // 2026-05-17 — drop open_status='open' gate (it rejected carwash
        // tickets that are in cola with mesa tags; matches byMesa fix
        // above). Only block on terminal statuses.
        if (['cobrado','done','cancelled','voided','nula','anulado','merged'].includes(String(cur.status || '').toLowerCase())) {
          throw new Error('Ticket ya cerrado')
        }

        // Per-business ITBIS factor — loud on fetch error, but a missing
        // app_settings row is legitimate (default 18% applies).
        let itbisFactor = 0.18
        const { data: pctRow, error: pErr } = await supabase.from('app_settings')
          .select('value').eq('business_id', bid).eq('key', 'itbis_pct').maybeSingle()
        if (pErr) throw new Error('itbis_pct lookup: ' + pErr.message)
        const pctNum = Number(pctRow?.value)
        if (Number.isFinite(pctNum) && pctNum >= 0) itbisFactor = pctNum / 100

        // Look up aplica_itbis/cost for service items (mirrors tickets.create).
        const svcIds = items.map(i => i.service_id).filter(Boolean)
        let svcItbisById = new Map()
        let svcCostById  = new Map()
        if (svcIds.length) {
          const { data: svcRows, error: sErr } = await supabase.from('services')
            .select('id, cost, aplica_itbis').in('id', svcIds).eq('business_id', bid)
          if (sErr) throw new Error('services lookup: ' + sErr.message)
          svcItbisById = new Map((svcRows || []).map(r => [r.id, r.aplica_itbis ?? 1]))
          svcCostById  = new Map((svcRows || []).map(r => [r.id, r.cost || 0]))
        }

        // Build new ticket_items rows. supabase_id required for sync.
        const newRows = items.map(i => {
          const price = Number(i.price) || 0
          const aplica = i.aplica_itbis !== undefined ? i.aplica_itbis : (i.service_id ? (svcItbisById.get(i.service_id) ?? 1) : 1)
          const itbis = aplica === 0 ? 0 : parseFloat((price - price / (1 + itbisFactor)).toFixed(2))
          return {
            supabase_id:        crypto.randomUUID(),
            ticket_supabase_id: ticketSupabaseId,
            business_id:        bid,
            service_supabase_id: i.service_supabase_id || null,
            inventory_item_supabase_id: i.inventory_item_supabase_id || null,
            preparation_notes:  i.preparation_notes || null,
            name:               i.name,
            price,
            cost:               i.cost != null ? Number(i.cost) : (i.service_id ? (svcCostById.get(i.service_id) || 0) : 0),
            itbis,
            is_wash:            i.is_wash ?? true,
            quantity:           i.quantity || i.qty || 1,
            weight:             i.weight != null ? Number(i.weight) : null,
          }
        })

        const ins = await supabase.from('ticket_items').insert(newRows)
        if (ins.error) throw new Error('ticket_items insert: ' + ins.error.message)

        // Recompute totals from ALL items (existing + new).
        const { data: allItems, error: aErr } = await supabase.from('ticket_items')
          .select('price, quantity, itbis')
          .eq('business_id', bid)
          .eq('ticket_supabase_id', ticketSupabaseId)
        if (aErr) throw new Error('recompute fetch: ' + aErr.message)
        let subtotal = 0, itbis = 0
        for (const r of (allItems || [])) {
          const line = (Number(r.price) || 0) * (Number(r.quantity) || 1)
          subtotal += line
          itbis    += (Number(r.itbis) || 0) * (Number(r.quantity) || 1)
        }
        subtotal = parseFloat(subtotal.toFixed(2))
        itbis    = parseFloat(itbis.toFixed(2))
        const total = subtotal // gross convention — ITBIS embedded in price

        const upd = await supabase.from('tickets').update({
          subtotal, itbis, total, updated_at: new Date().toISOString(),
        }).eq('business_id', bid).eq('supabase_id', ticketSupabaseId)
        if (upd.error) throw new Error('tickets update: ' + upd.error.message)

        const addedTotal = newRows.reduce((s, r) => s + r.price * r.quantity, 0)
        await logActivity({
          event_type: 'ticket_append_items',
          severity: 'info',
          target_type: 'ticket',
          target_id: cur.id,
          target_name: cur.doc_number || `#${cur.id}`,
          amount: parseFloat(addedTotal.toFixed(2)),
          metadata: {
            ticket_supabase_id: ticketSupabaseId,
            mesa_supabase_id: cur.mesa_supabase_id,
            added_count: newRows.length,
            added_total: parseFloat(addedTotal.toFixed(2)),
            new_total: total,
          },
        })

        return { ok: true, ticket_supabase_id: ticketSupabaseId, added: newRows.length, subtotal, itbis, total }
      }, 'web.tickets.appendItems'),

      // v2.16.3 — Restaurante H3 "Juntar": merge two open tickets onto a single
      // target mesa. Source ticket items move to target, source guests count
      // adds to target, source mesa frees to 'sucia', source ticket marked
      // 'merged' (a benign status filtered out of every report). Manager-gated.
      //
      // Inputs:
      //   targetTicketSupabaseId  string  ticket that survives
      //   sourceTicketSupabaseId  string  ticket whose items get absorbed
      merge: (targetTicketSupabaseId, sourceTicketSupabaseId) => tryWrite(async () => {
        if (!targetTicketSupabaseId || !sourceTicketSupabaseId) throw new Error('Faltan parámetros')
        if (targetTicketSupabaseId === sourceTicketSupabaseId) throw new Error('No se puede juntar consigo mismo')

        const { data: target } = await supabase.from('tickets')
          .select('id, supabase_id, mesa_supabase_id, guests, doc_number, status, rev')
          .eq('business_id', bid).eq('supabase_id', targetTicketSupabaseId).maybeSingle()
        if (!target) throw new Error('Ticket destino no encontrado')
        if (['cobrado','nula','anulado','voided','merged'].includes(target.status)) throw new Error('Ticket destino ya cerrado')

        const { data: source } = await supabase.from('tickets')
          .select('id, supabase_id, mesa_supabase_id, guests, doc_number, status, rev')
          .eq('business_id', bid).eq('supabase_id', sourceTicketSupabaseId).maybeSingle()
        if (!source) throw new Error('Ticket origen no encontrado')
        if (['cobrado','nula','anulado','voided','merged'].includes(source.status)) throw new Error('Ticket origen ya cerrado')

        // 1. Move items from source → target by ticket_supabase_id (FK is
        //    nullable on ticket_id; the supabase_id pair is the canonical join).
        throwSupaError(await supabase.from('ticket_items')
          .update({ ticket_supabase_id: target.supabase_id, ticket_id: target.id })
          .eq('ticket_supabase_id', source.supabase_id))

        // 2. Sum guests onto target.
        const totalGuests = Number(target.guests || 0) + Number(source.guests || 0)
        const tNextRev = Number(target.rev || 0) + 1
        throwSupaError(await supabase.from('tickets').update({
          guests: totalGuests || null, rev: tNextRev,
        }).eq('id', target.id).eq('business_id', bid))

        // 3. Mark source as merged so cuadre/reports skip it.
        const sNextRev = Number(source.rev || 0) + 1
        throwSupaError(await supabase.from('tickets').update({
          status: 'merged',
          notes: `Combinado con ${target.doc_number || target.id}`,
          rev: sNextRev,
        }).eq('id', source.id).eq('business_id', bid))

        // 4. Free the source mesa to 'sucia'. Lookup by supabase_id (mesa_id
        //    column on tickets does not exist — schema-drift fix v2.16.10).
        if (source.mesa_supabase_id) {
          throwSupaError(await supabase.from('mesas').update({
            status: 'sucia',
            guests_count: null,
            waiter_empleado_supabase_id: null,
            seated_at: null,
            bill_requested_at: null,
          }).eq('supabase_id', source.mesa_supabase_id).eq('business_id', bid))
        }

        // 5. Update target mesa guests count (best-effort).
        if (target.mesa_supabase_id && totalGuests) {
          await supabase.from('mesas').update({ guests_count: totalGuests })
            .eq('supabase_id', target.mesa_supabase_id).eq('business_id', bid)
        }

        await logActivity({
          event_type: 'restaurant_mesa_merge',
          severity: 'info',
          target_type: 'ticket',
          target_id: target.id,
          target_name: target.doc_number || `#${target.id}`,
          metadata: {
            target_ticket_id: target.id,
            source_ticket_id: source.id,
            source_doc_number: source.doc_number,
            target_mesa_supabase_id: target.mesa_supabase_id,
            source_mesa_supabase_id: source.mesa_supabase_id,
            total_guests: totalGuests,
          },
        })
        return { ok: true, target_ticket_id: target.id, source_ticket_id: source.id }
      }, 'web.tickets.merge'),

      // ── v2.16.4 — Restaurant open-ticket lifecycle ───────────────────────
      // Persist tickets at mesa-seat time so a refresh / power loss mid-dinner
      // doesn't drop in-flight items + KDS rows. The `open_status` column
      // ('open' | 'closed') is orthogonal to financial `status`.
      //
      // 2026-05-09 — generalized to openForFulfillment so food_truck (and
      // any future fire-then-pay vertical) can reuse the lifecycle. The
      // legacy openForMesa stays as a thin wrapper so RestaurantPOS and the
      // restaurant smoke harness keep working unchanged.
      openForFulfillment: (data = {}) => tryWrite(async () => {
        const ticketSid = data.supabase_id || crypto.randomUUID()
        const { data: lastDoc } = await supabase.from('tickets')
          .select('doc_number').eq('business_id', bid)
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        let nextNum = 1
        if (lastDoc?.doc_number) {
          const m = String(lastDoc.doc_number).match(/T-(\d+)/)
          if (m) nextNum = parseInt(m[1], 10) + 1
        }
        const docNum = `T-${String(nextNum).padStart(4, '0')}`
        const fulfillment = data.fulfillment_type
          || (data.mesa_supabase_id ? 'dine_in' : 'take_out')
        const mode = data.mode || (data.mesa_supabase_id ? 'mesa' : 'take_out')
        const row = throwSupaError(await supabase.from('tickets').insert({
          supabase_id:      ticketSid,
          business_id:      bid,
          doc_number:       docNum,
          mesa_supabase_id: data.mesa_supabase_id || null,
          food_truck_location_supabase_id: data.food_truck_location_supabase_id || null,
          fulfillment_type: fulfillment,
          mode:             mode,
          subtotal: 0, descuento: 0, itbis: 0, ley: 0, total: 0,
          payment_method:   'pending',
          status:           'pendiente',
          open_status:      'open',
          tipo_venta:       'contado',
          order_source:     data.order_source || 'pos',
          notes:            data.notes || null,
        }).select().single())
        return { id: row?.id || null, supabase_id: ticketSid, doc_number: docNum }
      }, 'web.tickets.openForFulfillment'),

      // Thin wrapper retained for restaurant compatibility — same signature.
      openForMesa: function (data = {}) {
        return this.openForFulfillment({
          ...data,
          fulfillment_type: 'dine_in',
          mode: 'mesa',
        })
      },

      // Pendientes — every open ticket for the active business, plus item
      // count + running subtotal so the Pendientes UI can render a card
      // without a second round-trip per row. Keeps RLS happy because it
      // filters on business_id (anon JWT path) + open_status (existing
      // index idx_tickets_open_by_mesa covers the partial scan).
      listOpen: ({ source = null } = {}) => tryOr(async () => {
        let q = supabase.from('tickets')
          .select('id, supabase_id, doc_number, mesa_supabase_id, food_truck_location_supabase_id, order_source, notes, fulfillment_type, mode, subtotal, total, created_at, updated_at, ticket_items!ticket_items_ticket_supabase_id_fkey(name, price, quantity, preparation_notes)')
          .eq('business_id', bid)
          .eq('open_status', 'open')
          .neq('status', 'nula')
          .order('created_at', { ascending: false })
          .limit(100)
        if (source) q = q.eq('order_source', source)
        const rows = throwSupaError(await q)
        return (rows || []).map(t => {
          const items = Array.isArray(t.ticket_items) ? t.ticket_items : []
          const item_count   = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0)
          const items_total  = items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0)
          const running_total = Number(t.total) > 0 ? Number(t.total) : items_total
          const items_brief = items.map(i => ({
            name: i.name || '—',
            quantity: Number(i.quantity) || 1,
            preparation_notes: i.preparation_notes || null,
          }))
          const { ticket_items, ...rest } = t
          return { ...rest, item_count, running_total, items: items_brief }
        })
      }, []),

      addItem: (data = {}) => tryWrite(async () => {
        const itemSid = crypto.randomUUID()
        const safeQty = Math.max(1, parseInt(data.qty || data.quantity || 1, 10))
        const row = throwSupaError(await supabase.from('ticket_items').insert({
          supabase_id:        itemSid,
          ticket_supabase_id: data.ticket_supabase_id,
          service_supabase_id: data.service_supabase_id || null,
          name:               data.name || '',
          price:              Number(data.price) || 0,
          cost: 0, itbis: 0, is_wash: true,
          quantity:           safeQty,
          course:             data.course || null,
          guest_number:       data.guest_number || null,
          preparation_notes:  data.preparation_notes || null,
          empleado_supabase_id: data.empleado_supabase_id || null,
          business_id:        bid,
        }).select().single())
        if (Array.isArray(data.modifiers) && data.modifiers.length) {
          const modRows = data.modifiers.map(m => ({
            supabase_id:               crypto.randomUUID(),
            ticket_item_supabase_id:   itemSid,
            modificador_supabase_id:   m.modificador_supabase_id || null,
            name_snapshot:             m.name || m.name_snapshot || '',
            price_delta_snapshot:      Number(m.price_delta || m.price_delta_snapshot || 0),
            business_id:               bid,
          }))
          try { await supabase.from('ticket_item_modificadores').insert(modRows) }
          catch (e) { console.error('[web.js] addItem modifier snapshot failed:', e.message) }
        }
        if (data.ticket_supabase_id) {
          await supabase.from('tickets').update({ updated_at: new Date().toISOString() })
            .eq('supabase_id', data.ticket_supabase_id).eq('business_id', bid)
        }
        return { id: row?.id || null, supabase_id: itemSid }
      }, 'web.tickets.addItem'),

      // 2026-05-09 — Recompute ticket totals after addItem on open tickets.
      // openForFulfillment seeds subtotal/itbis/total = 0; without this an
      // open ticket shows RD$0 in Pendientes / KDS / Cobrar. Used by
      // FoodTruckPOS sendToKitchen.
      updateTotals: (data = {}) => tryWrite(async () => {
        if (!data.ticket_supabase_id) throw new Error('ticket_supabase_id required')
        const patch = {
          subtotal: Number(data.subtotal) || 0,
          itbis:    Number(data.itbis)    || 0,
          total:    Number(data.total)    || 0,
          updated_at: new Date().toISOString(),
        }
        if (data.descuento != null) patch.descuento = Number(data.descuento) || 0
        if (data.ley       != null) patch.ley       = Number(data.ley)       || 0
        return throwSupaError(
          await supabase.from('tickets').update(patch)
            .eq('supabase_id', data.ticket_supabase_id).eq('business_id', bid)
            .select('supabase_id, subtotal, itbis, total').single()
        )
      }),

      // v2.16.25 — Manager-gated mid-wash price edit on a queued ticket.
      // Updates ticket_items.price for the given line + bumps the parent
      // ticket's totals (subtotal/itbis/total). Used by Queue.jsx:617.
      // DO NOT REVERT (FIX-LEDGER §2.14).
      updateItemPrice: (data = {}) => tryWrite(async () => {
        const itemSid = data.ticket_item_supabase_id
        const itemId = data.ticket_item_id
        const newPrice = Math.max(0, Number(data.price) || 0)
        if (!itemSid && !itemId) throw new Error('updateItemPrice: id required')
        const sel = supabase.from('ticket_items').select('id, supabase_id, ticket_supabase_id, ticket_id, price, quantity').eq('business_id', bid)
        const { data: row, error: e1 } = await (itemSid
          ? sel.eq('supabase_id', itemSid).maybeSingle()
          : sel.eq('id', itemId).maybeSingle())
        if (e1 || !row) throw new Error(e1?.message || 'item not found')
        // Update item price
        await supabase.from('ticket_items').update({ price: newPrice }).eq('id', row.id).eq('business_id', bid)
        // Recompute ticket totals
        const tSid = row.ticket_supabase_id
        // v2.16.29 (C1) — `ticket_items` has NO `aplica_itbis` column (verified
        // 2026-05-01 against information_schema). Pre-fix code read
        // `it.aplica_itbis` which was always undefined → `!== 0` truthy →
        // ITBIS got applied to EVERY line, double-taxing exempt items on
        // every Queue-side price edit. Derive taxable from the stored
        // `itbis` value: if the row's saved itbis is non-zero, the source
        // service/inventory item's aplica_itbis was 1 at sale time. If the
        // saved itbis is zero AND price is non-zero, the line was exempt.
        // For zero-price lines (like oferta discount markers) default to
        // taxable=false so the recompute leaves them alone.
        const { data: items } = await supabase.from('ticket_items')
          .select('price, quantity, itbis, supabase_id').eq('ticket_supabase_id', tSid).eq('business_id', bid)
        const itbisFrac = (Number((data.itbisRate ?? 18))) / 100
        let subtotal = 0, itbis = 0
        for (const it of (items || [])) {
          const lineGross = Number(it.price || 0) * Number(it.quantity || 1)
          subtotal += lineGross
          // The line being EDITED has the new price but the OLD itbis still
          // saved (we didn't update itbis on the row above). The taxable
          // determination still holds because aplica_itbis is a property of
          // the source item, not the price.
          const oldItbis = Number(it.itbis || 0)
          const oldPrice = Number(it.price || 0)
          const wasTaxable = oldItbis > 0 || oldPrice === 0
            ? oldItbis > 0
            : false
          if (wasTaxable) itbis += lineGross * itbisFrac / (1 + itbisFrac)
        }
        const total = parseFloat(subtotal.toFixed(2))
        const itbisRounded = parseFloat(itbis.toFixed(2))
        const { data: cur } = await supabase.from('tickets').select('rev').eq('supabase_id', tSid).single()
        await supabase.from('tickets').update({
          subtotal: total, itbis: itbisRounded, total,
          rev: Number(cur?.rev || 0) + 1,
        }).eq('supabase_id', tSid).eq('business_id', bid)
        await logActivity({
          event_type: 'ticket_item_price_changed', severity: 'warn',
          target_type: 'ticket_item', target_id: row.id,
          old_value: String(row.price), new_value: String(newPrice),
          reason: data.reason || 'Manager-authorized price edit',
          metadata: { ticket_supabase_id: tSid, mac_jti: data.mac_jti || null },
        })
        return { id: row.id, supabase_id: row.supabase_id, price: newPrice }
      }, 'web.tickets.updateItemPrice'),

      updateItemQty: (data = {}) => tryWrite(async () => {
        const safeQty = Math.max(0, parseInt(data.qty || 0, 10))
        if (safeQty === 0) {
          if (data.ticket_item_id) {
            throwSupaError(await supabase.from('ticket_items').delete()
              .eq('id', data.ticket_item_id).eq('business_id', bid))
          } else if (data.ticket_item_supabase_id) {
            throwSupaError(await supabase.from('ticket_items').delete()
              .eq('supabase_id', data.ticket_item_supabase_id).eq('business_id', bid))
          }
          return { id: data.ticket_item_id, qty: 0 }
        }
        if (data.ticket_item_id) {
          throwSupaError(await supabase.from('ticket_items').update({ quantity: safeQty })
            .eq('id', data.ticket_item_id).eq('business_id', bid))
        } else if (data.ticket_item_supabase_id) {
          throwSupaError(await supabase.from('ticket_items').update({ quantity: safeQty })
            .eq('supabase_id', data.ticket_item_supabase_id).eq('business_id', bid))
        }
        return { id: data.ticket_item_id, qty: safeQty }
      }, 'web.tickets.updateItemQty'),

      removeItem: (data = {}) => tryWrite(async () => {
        if (data.ticket_item_supabase_id) {
          try {
            await supabase.from('ticket_item_modificadores').delete()
              .eq('ticket_item_supabase_id', data.ticket_item_supabase_id).eq('business_id', bid)
          } catch {}
        }
        if (data.ticket_item_id) {
          throwSupaError(await supabase.from('ticket_items').delete()
            .eq('id', data.ticket_item_id).eq('business_id', bid))
        } else if (data.ticket_item_supabase_id) {
          throwSupaError(await supabase.from('ticket_items').delete()
            .eq('supabase_id', data.ticket_item_supabase_id).eq('business_id', bid))
        }
        return { removed: true }
      }, 'web.tickets.removeItem'),

      getActiveByMesa: (mesaId) => tryOr(async () => {
        if (!mesaId) return null
        let mesaSid = null
        if (typeof mesaId === 'string' && mesaId.length >= 32 && mesaId.includes('-')) {
          mesaSid = mesaId
        } else {
          const { data: m } = await supabase.from('mesas').select('supabase_id')
            .eq('id', mesaId).eq('business_id', bid).maybeSingle()
          mesaSid = m?.supabase_id || null
        }
        let q = supabase.from('tickets').select(`
          *,
          ticket_items!ticket_items_ticket_supabase_id_fkey(*, ticket_item_modificadores(*))
        `)
          .eq('business_id', bid)
          .eq('open_status', 'open')
          .order('created_at', { ascending: false })
          .limit(1)
        if (mesaSid) q = q.eq('mesa_supabase_id', mesaSid)
        else return null  // v2.16.10 — no mesa_id column on tickets; fail closed if mesa lookup didn't resolve a supabase_id.
        const { data: rows } = await q
        const ticket = rows && rows[0]
        if (!ticket) return null
        ticket.items = (ticket.ticket_items || []).map(it => ({
          ...it,
          qty: it.quantity,
          modifiers: (it.ticket_item_modificadores || []).map(m => ({
            modificador_id: m.modificador_id,
            modificador_supabase_id: m.modificador_supabase_id,
            name: m.name_snapshot,
            price_delta: Number(m.price_delta_snapshot || 0),
          })),
        }))
        delete ticket.ticket_items
        return ticket
      }, null),

      closeWithPayment: async (ticketRef, payload = {}) => {
        const _ticketId  = (ticketRef && typeof ticketRef === 'object') ? ticketRef.ticket_id : ticketRef
        const _ticketSid = (ticketRef && typeof ticketRef === 'object') ? ticketRef.ticket_supabase_id : null
        const data = (ticketRef && typeof ticketRef === 'object' && ticketRef.payload) ? ticketRef.payload : payload
        try {
          return await tryOr(async () => {
            let q = supabase.from('tickets').select('*').eq('business_id', bid).limit(1)
            if (_ticketSid) q = q.eq('supabase_id', _ticketSid)
            else if (_ticketId) q = q.eq('id', _ticketId)
            else throw new Error('closeWithPayment: missing ticket reference')
            const { data: rows } = await q
            const row = rows && rows[0]
            if (!row) throw new Error('closeWithPayment: ticket not found')

            const status = data.status || (data.tipo_venta === 'credito' || data.payment_method === 'credit' ? 'pendiente' : 'cobrado')
            const updates = {
              open_status:      'closed',
              status,
              subtotal:         Number(data.subtotal || 0),
              descuento:        Number(data.descuento || 0),
              itbis:            Number(data.itbis || 0),
              ley:              Number(data.ley || 0),
              total:            Number(data.total || 0),
              payment_method:   data.payment_method || 'cash',
              comprobante_type: data.comprobante_type || row.comprobante_type || 'B02',
              ncf:              data.ncf || row.ncf || null,
              ecf_result:       data.ecf_result || data.ecf || row.ecf_result || {},
              tipo_venta:       data.tipo_venta || 'contado',
              tip_amount:       Number(data.tip_amount || 0),
              fulfillment_type: data.fulfillment_type || row.fulfillment_type || 'dine_in',
              mode:             data.mode || row.mode || 'mesa',
              notes:            data.comentario ?? data.notes ?? row.notes ?? null,
              order_source:     data.order_source || row.order_source || 'pos',
              payment_parts:    (Array.isArray(data.payment_parts) && data.payment_parts.length) ? data.payment_parts : null,
              split_bill:       (data.split === true || (Array.isArray(data.payment_parts) && data.payment_parts.length > 1)) || false,
              rev:              Number(row.rev || 0) + 1,
              paid_at:          status === 'cobrado' ? new Date().toISOString() : null,
            }
            if (data.client_supabase_id) updates.client_supabase_id = data.client_supabase_id
            if (data.cajero_supabase_id) updates.cajero_supabase_id = data.cajero_supabase_id
            if (data.seller_empleado_supabase_id) updates.seller_empleado_supabase_id = data.seller_empleado_supabase_id
            if (Array.isArray(data.washer_empleado_supabase_ids)) updates.washer_empleado_supabase_ids = data.washer_empleado_supabase_ids

            throwSupaError(await supabase.from('tickets').update(updates)
              .eq('id', row.id).eq('business_id', bid))

            // v2.16.3 — Restaurante recetas: decrement ingredient inventory.
            // Wrapped — failures emit `recipe_inventory_skip` audit row but
            // never fail the close (cashier already swiped the card).
            try {
              const { data: tItems } = await supabase.from('ticket_items')
                .select('service_supabase_id,quantity,name')
                .eq('ticket_supabase_id', row.supabase_id)
                .eq('business_id', bid)
              const lines = (tItems || []).filter(x => x.service_supabase_id)
              if (lines.length) {
                const svcSids = [...new Set(lines.map(l => l.service_supabase_id))]
                const { data: rcps } = await supabase.from('service_recipe_items')
                  .select('service_supabase_id,inventory_item_supabase_id,qty_per_unit')
                  .eq('business_id', bid).in('service_supabase_id', svcSids)
                const rcpBySvc = {}
                for (const r of (rcps || [])) {
                  if (!rcpBySvc[r.service_supabase_id]) rcpBySvc[r.service_supabase_id] = []
                  rcpBySvc[r.service_supabase_id].push(r)
                }
                const invSids = [...new Set((rcps || []).map(r => r.inventory_item_supabase_id).filter(Boolean))]
                if (invSids.length) {
                  const { data: invs } = await supabase.from('inventory_items')
                    .select('id,supabase_id,name,quantity').eq('business_id', bid).in('supabase_id', invSids)
                  const invBySid = Object.fromEntries((invs || []).map(i => [i.supabase_id, i]))
                  for (const line of lines) {
                    const lineQty = Number(line.quantity || 1)
                    for (const r of (rcpBySvc[line.service_supabase_id] || [])) {
                      const inv = invBySid[r.inventory_item_supabase_id]
                      if (!inv) continue
                      const delta = -(Number(r.qty_per_unit || 0) * lineQty)
                      if (!delta) continue
                      try {
                        await supabase.from('inventory_items')
                          .update({ quantity: Math.max(0, Number(inv.quantity || 0) + delta) })
                          .eq('supabase_id', r.inventory_item_supabase_id).eq('business_id', bid)
                        invBySid[r.inventory_item_supabase_id] = { ...inv, quantity: Math.max(0, Number(inv.quantity || 0) + delta) }
                      } catch (e) {
                        await logActivity({ event_type: 'recipe_inventory_skip', severity: 'warn',
                          target_type: 'inventory_item', target_id: inv?.id || null,
                          target_name: inv?.name || `Receta ${line.service_supabase_id.substring(0, 8)}`,
                          reason: e?.message || 'recipe deduction failed',
                          metadata: { ticket_id: row.id, ticket_supabase_id: row.supabase_id,
                                      service_supabase_id: line.service_supabase_id,
                                      line_qty: lineQty, qty_per_unit: r.qty_per_unit } })
                      }
                    }
                  }
                }
              }
            } catch (e) {
              try {
                await logActivity({ event_type: 'recipe_inventory_skip', severity: 'warn',
                  target_type: 'ticket', target_id: row.id, target_name: row.doc_number || `#${row.id}`,
                  reason: e?.message || 'recipe deduction batch failed',
                  metadata: { ticket_supabase_id: row.supabase_id } })
              } catch (err2) {
                try { (typeof window !== 'undefined') && window.__txReportError?.(err2, { severity: 'warn', category: 'web.recipe_inventory_skip.activity_log', extra: { ticket_id: row?.id, ticket_supabase_id: row?.supabase_id } }) } catch {}
              }
            }

            const desc = Number(data.descuento || 0)
            const subt = Number(data.subtotal || 0)
            const pct  = subt > 0 ? (desc / subt) * 100 : 0
            if (desc > 500 || pct > 15) {
              await logActivity({ event_type: 'discount_applied',
                severity: desc > 2000 || pct > 30 ? 'warn' : 'info',
                target_type: 'ticket', target_id: row.id, target_name: row.doc_number || `#${row.id}`,
                amount: desc,
                metadata: { subtotal: subt, total: data.total, pct: Math.round(pct * 10) / 10, payment_method: data.payment_method, source: 'closeWithPayment' } })
            }
            return { id: row.id, supabase_id: row.supabase_id, docNumber: row.doc_number, ncf: updates.ncf }
          })
        } catch (err) {
          console.error('[web.js] closeWithPayment failed:', err?.message || err)
          throw err
        }
      },

      byDateRange: (params) => tryOr(async () => {
        const dateFrom = params?.dateFrom ?? params?.from
        const dateTo   = params?.dateTo   ?? params?.to
        // Filter by real sale date (paid_at) when available, else insert time.
        // Guards against imported historical rows whose created_at = import time.
        // v2.16.31 — RETURN nula rows so DailyReport's "Anuladas" tab can
        // populate. Previously v2.14.22 dropped them at the data layer to
        // protect summary totals — but DailyReport's totals already filter
        // estado!='nula' explicitly (see active = baseFiltered.filter(...)
        // and the cxc/total/count reducers in the totals useMemo). Stripping
        // them at the SQL layer hid them from the UI's "Anuladas" tab too,
        // making voided tickets invisible everywhere AND making it look
        // like the screen "didn't refresh" after a void (the row vanished
        // entirely instead of moving to the Anuladas tab).
        //
        // For RemoteDashboard / CSV exports that consume this same query,
        // those callers also filter status downstream. If a future caller
        // is added that needs nula-stripped rows, do the filter there, not
        // here.
        let q = supabase.from('tickets').select('*').eq('business_id', bid)
        if (dateFrom) q = q.or(`paid_at.gte.${dateFrom},and(paid_at.is.null,created_at.gte.${dateFrom})`)
        if (dateTo)   q = q.or(`paid_at.lte.${dateTo},and(paid_at.is.null,created_at.lte.${dateTo})`)
        q = q.order('paid_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(500)
        const rows = throwSupaError(await q)
        if (!rows?.length) return []

        // Fetch items — by ticket_supabase_id only
        const tSids  = [...new Set(rows.map(r => r.supabase_id).filter(Boolean))]
        const itemsMap = {}
        if (tSids.length)  { const { data: ir } = await supabase.from('ticket_items').select('ticket_supabase_id, name, price, cost, is_wash, is_deposit, quantity, sku, inventory_item_id, inventory_item_supabase_id').eq('business_id', bid).in('ticket_supabase_id', tSids); for (const i of (ir || [])) { if (!itemsMap[i.ticket_supabase_id]) itemsMap[i.ticket_supabase_id] = []; itemsMap[i.ticket_supabase_id].push(i) } }

        // Fetch client names — supabase_id only. Defense-in-depth business_id filter.
        const clientSids = [...new Set(rows.map(r => r.client_supabase_id).filter(Boolean))]
        let clientMap = {}
        if (clientSids.length) { const { data: cls } = await supabase.from('clients').select('supabase_id, name, rnc').eq('business_id', bid).in('supabase_id', clientSids); for (const c of (cls || [])) clientMap[c.supabase_id] = c }

        // Fetch cajero names — supabase_id only
        const cajeroSids = [...new Set(rows.map(r => r.cajero_supabase_id).filter(Boolean))]
        let cajeroMap = {}
        if (cajeroSids.length) { const { data: ur } = await supabase.from('staff').select('supabase_id, name').eq('business_id', bid).in('supabase_id', cajeroSids); for (const u of (ur || [])) cajeroMap[u.supabase_id] = u }

        // Fetch washer names — empleados.supabase_id only
        const allWasherIds = new Set()
        for (const r of rows) {
          let wids = []
          try { wids = typeof r.washer_ids === 'string' ? JSON.parse(r.washer_ids) : (r.washer_ids || []) } catch {}
          for (const w of wids) if (w) allWasherIds.add(w)
        }
        const washerMap = {}
        if (allWasherIds.size) {
          const { data: wr } = await supabase.from('empleados').select('supabase_id, nombre').in('supabase_id', [...allWasherIds])
          for (const w of (wr || [])) washerMap[w.supabase_id] = w.nombre
        }

        return rows.map(r => {
          const items = (itemsMap[r.supabase_id] || []).filter(i => i.name != null)
          const cKey = r.client_supabase_id
          const cajKey = r.cajero_supabase_id
          let wids = []
          try { wids = typeof r.washer_ids === 'string' ? JSON.parse(r.washer_ids) : (r.washer_ids || []) } catch {}
          return {
            ...r,
            items,
            service_names: items.map(i => i.name).join(' + ') || null,
            client_name: clientMap[cKey]?.name || null,
            client_rnc:  clientMap[cKey]?.rnc  || null,
            cajero_name: cajeroMap[cajKey]?.name || null,
            washer_names: wids.map(w => washerMap[w]).filter(Boolean),
          }
        })
      }, []),

      // v2.16.3 — anular cargo no-show. Emite Nota de Crédito Electrónica E34
      // referenciando la E32 original (consumidor final). Patrón DGII NCFModificado
      // / CodigoModificacion=1 (anulación total). Implementación compartida en
      // packages/services/voidNoShowFee.js — el mismo orquestador corre en desktop
      // (data/electron.js) y web. El renderer (Appointments.jsx) llama esto desde
      // el botón "Anular cargo no-show" del AppointmentModal.
      voidNoShowFee: (args) => voidNoShowFeeOrchestrator(args || {}, api),
    },

    // ── Reports namespace (alias surface) ──────────────────────────────────
    // v2.14.36 — BottleDepositReport calls api.reports.tickets({from, to}). On
    // web the call was missing entirely so tryOr returned [] and the report
    // silently showed empty. Inline mirror of tickets.byDateRange logic
    // (selects only the columns BottleDepositReport needs). Accepts both the
    // legacy {from,to} and canonical {dateFrom,dateTo} shapes.
    reports: {
      tickets: ({ from, to, dateFrom, dateTo } = {}) => tryOr(async () => {
        const f = dateFrom || from
        const t = dateTo   || to
        let q = supabase.from('tickets').select('*').eq('business_id', bid).neq('status', 'nula')
        if (f) q = q.or(`paid_at.gte.${f},and(paid_at.is.null,created_at.gte.${f})`)
        if (t) q = q.or(`paid_at.lte.${t},and(paid_at.is.null,created_at.lte.${t})`)
        q = q.order('paid_at', { ascending: false, nullsFirst: false }).limit(2000)
        const rows = throwSupaError(await q) || []
        if (!rows.length) return []
        const tSids = [...new Set(rows.map(r => r.supabase_id).filter(Boolean))]
        const itemsMap = {}
        if (tSids.length) {
          // v2.16.31 — `aplica_itbis` is NOT a column on ticket_items
          // (verified 2026-05-01 against information_schema). The earlier
          // sweep that removed it from the main byDateRange SELECT missed
          // this BottleDepositReport variant because the column list was
          // slightly different (no is_wash). PostgREST 400's on unknown
          // columns. Removed.
          const { data: ir } = await supabase.from('ticket_items')
            .select('ticket_supabase_id, name, price, cost, is_deposit, quantity, sku, inventory_item_id, inventory_item_supabase_id')
            .in('ticket_supabase_id', tSids)
          for (const i of (ir || [])) {
            if (!itemsMap[i.ticket_supabase_id]) itemsMap[i.ticket_supabase_id] = []
            itemsMap[i.ticket_supabase_id].push(i)
          }
        }
        return rows.map(r => ({ ...r, items: itemsMap[r.supabase_id] || [] }))
      }, []),
    },

    // ── Queue ────────────────────────────────────────────────────────────────

    queue: {
      active: () => tryOr(async () => {
        const { data: rows, error: qErr } = await supabase.from('queue')
          .select('*')
          .eq('business_id', bid).not('status', 'in', '("done","cancelled")')
          .order('created_at', { ascending: true })
        if (qErr) throw new Error(qErr.message)
        if (!rows?.length) return []

        // Resolve tickets — by ticket_supabase_id only
        const tSids  = [...new Set(rows.map(q => q.ticket_supabase_id).filter(Boolean))]
        const ticketMap = {}
        if (tSids.length)  { const { data: tr } = await supabase.from('tickets').select('id, supabase_id, doc_number, total, vehicle_plate, created_at, client_supabase_id, mesa_supabase_id').in('supabase_id', tSids); for (const t of (tr || [])) ticketMap[t.supabase_id] = t }

        // Mesa-name lookup (Mesas add-on badge on Queue cards).
        const mSids = [...new Set(Object.values(ticketMap).map(t => t.mesa_supabase_id).filter(Boolean))]
        const mesaMap = {}
        if (mSids.length) {
          const { data: mr } = await supabase.from('mesas').select('supabase_id, name').in('supabase_id', mSids)
          for (const m of (mr || [])) mesaMap[m.supabase_id] = m.name
        }

        // Resolve washers — empleados.supabase_id (washer_supabase_id holds the lavador's supabase_id)
        const wSids  = [...new Set(rows.map(q => q.washer_supabase_id).filter(Boolean))]
        const washerMap = {}
        if (wSids.length)  { const { data: wr } = await supabase.from('empleados').select('supabase_id, nombre').in('supabase_id', wSids); for (const w of (wr || [])) washerMap[w.supabase_id] = w.nombre }

        // Resolve clients (name + phone for WhatsApp "listo" notification)
        const allTickets = Object.values(ticketMap)
        const cSids  = [...new Set(allTickets.map(t => t.client_supabase_id).filter(Boolean))]
        const clientMap = {}
        if (cSids.length)  { const { data: cls } = await supabase.from('clients').select('supabase_id, name, phone').in('supabase_id', cSids); for (const c of (cls || [])) clientMap[c.supabase_id] = c }

        // Resolve ticket items
        const itemsMap = {}
        if (tSids.length)  { const { data: items } = await supabase.from('ticket_items').select('ticket_supabase_id, name').in('ticket_supabase_id', tSids); for (const i of (items || [])) { if (!itemsMap[i.ticket_supabase_id]) itemsMap[i.ticket_supabase_id] = []; itemsMap[i.ticket_supabase_id].push(i.name) } }

        return rows.map(q => {
          const tKey = q.ticket_supabase_id
          const wKey = q.washer_supabase_id
          const t = ticketMap[tKey] || {}
          const cKey = t.client_supabase_id
          return {
            ...q,
            // 2026-05-17 — queue.ticket_id is NULL on web-created queue rows
            // (web inserts only set ticket_supabase_id). Without this override,
            // Queue.jsx mapRow gets ticketId=null → cobrar passes id=null to
            // markPaid → `if (ticketId)` short-circuits → ticket NEVER gets
            // status='cobrado' even though the cobrar modal shows success.
            // Backfill from the joined tickets.id (UUID) so markPaid can
            // .eq('id', ticketId) and actually match a row.
            ticket_id:      t.id || q.ticket_id || null,
            doc_number:     t.doc_number    || null,
            total:          t.total          || 0,
            vehicle_plate:  t.vehicle_plate  || null,
            ticket_created: t.created_at     || null,
            client_name:    clientMap[cKey]?.name || null,
            client_phone:   clientMap[cKey]?.phone || null,
            services:       (itemsMap[tKey] || []).join(' + '),
            washer_name:    washerMap[wKey]   || null,
            mesa_supabase_id: t.mesa_supabase_id || null,
            mesa_name:        t.mesa_supabase_id ? (mesaMap[t.mesa_supabase_id] || null) : null,
          }
        })
      }, []),

      updateStatus: (data) => tryWrite(async () => {
        const { id, status, washerId } = data
        const now = new Date().toISOString()
        const patch = { status }
        // v2.16.10 2026-04-30 — DO NOT REVERT (FIX-LEDGER §2.16). The Queue UI
        // passes `washer.id` which on web is the integer empleados.id, not the
        // UUID supabase_id. Writing it directly into a UUID column threw 22P02
        // and the reassign silently failed. Resolve to UUID first.
        if (washerId) {
          let resolvedSid = null
          if (typeof washerId === 'string' && washerId.length === 36) {
            resolvedSid = washerId
          } else {
            const { data: emp } = await supabase.from('empleados')
              .select('supabase_id').eq('id', washerId).eq('business_id', bid).maybeSingle()
            resolvedSid = emp?.supabase_id || null
          }
          if (resolvedSid) patch.washer_supabase_id = resolvedSid
        }
        if (status === 'in_progress') {
          patch.assigned_at = now
        } else if (status === 'done') {
          patch.completed_at = now
        }
        throwSupaError(await supabase.from('queue').update(patch).eq('id', id).eq('business_id', bid))
      }, 'web.queue.updateStatus'),

      delete: (data) => tryWrite(async () => {
        const { id, deletedBy } = data
        const now = new Date().toISOString()
        const row = await supabase.from('queue').select('ticket_supabase_id').eq('id', id).single()
        if (row.error) throw new Error(row.error.message)
        const tSid = row.data?.ticket_supabase_id || null

        // Reverse credit-ticket balance + commissions BEFORE marking anulado,
        // so deleted credit tickets don't leave ghost debt on clients.
        if (tSid) {
          const { data: t } = await supabase.from('tickets')
            .select('total, descuento, tipo_venta, client_supabase_id')
            .eq('supabase_id', tSid).eq('business_id', bid).maybeSingle()
          if (t?.tipo_venta === 'credito' && t?.client_supabase_id) {
            // ticket.total is already NET (POS sends net); do not re-subtract descuento.
            const net = Math.max(0, Number(t.total || 0))
            if (net > 0) {
              const { data: cl } = await supabase.from('clients').select('balance').eq('supabase_id', t.client_supabase_id).eq('business_id', bid).single()
              if (cl) await supabase.from('clients').update({ balance: Math.max(0, (cl.balance || 0) - net) })
                .eq('supabase_id', t.client_supabase_id).eq('business_id', bid)
            }
          }
          await supabase.from('washer_commissions').delete().eq('business_id', bid).eq('ticket_supabase_id', tSid)
          await supabase.from('seller_commissions').delete().eq('business_id', bid).eq('ticket_supabase_id', tSid)
          await supabase.from('cajero_commissions').delete().eq('business_id', bid).eq('ticket_supabase_id', tSid)
        }

        await supabase.from('queue').update({ status: 'cancelled', completed_at: now }).eq('id', id)
        if (tSid) {
          // v2.10.3 — bump rev so Supabase trg_tickets_rev_guard accepts the status change.
          const { data: curQ } = await supabase.from('tickets').select('rev').eq('supabase_id', tSid).eq('business_id', bid).maybeSingle()
          await supabase.from('tickets').update({ status: 'anulado', rev: Number(curQ?.rev || 0) + 1 }).eq('supabase_id', tSid)
        }
        await supabase.from('queue_deletions').insert({ supabase_id: crypto.randomUUID(), queue_id: id, ticket_supabase_id: tSid, deleted_by: deletedBy || 'unknown', deleted_at: now, reason: 'manual', business_id: bid })
        return { id }
      }, 'web.queue.delete'),
    },

    // ── Commissions ──────────────────────────────────────────────────────────

    commissions: {
      // v2.16.25 — DO NOT REVERT (FIX-LEDGER §2.15). Multi-washer cobrar from
      // queue needs to know per-washer commission breakdown for the conduce
      // print + factura "Comisión" line. Pulls from all 3 commission tables
      // (washer/seller/cajero) keyed on ticket.
      byTicket: ({ ticketId, ticket_supabase_id } = {}) => tryOr(async () => {
        let tSid = ticket_supabase_id || null
        if (!tSid && ticketId) {
          const { data: t } = await supabase.from('tickets').select('supabase_id').eq('id', ticketId).eq('business_id', bid).maybeSingle()
          tSid = t?.supabase_id || null
        }
        if (!tSid) return []
        const cols = 'empleado_supabase_id, base_amount, commission_pct, commission_amount, paid, created_at'
        const [w, s, c] = await Promise.all([
          supabase.from('washer_commissions').select(cols).eq('business_id', bid).eq('ticket_supabase_id', tSid),
          supabase.from('seller_commissions').select(cols).eq('business_id', bid).eq('ticket_supabase_id', tSid),
          supabase.from('cajero_commissions').select(cols).eq('business_id', bid).eq('ticket_supabase_id', tSid),
        ])
        const out = []
        for (const r of (w.data || [])) out.push({ ...r, kind: 'washer' })
        for (const r of (s.data || [])) out.push({ ...r, kind: 'seller' })
        for (const r of (c.data || [])) out.push({ ...r, kind: 'cajero' })
        // Hydrate empleado names
        const sids = [...new Set(out.map(r => r.empleado_supabase_id).filter(Boolean))]
        if (sids.length) {
          const { data: emps } = await supabase.from('empleados').select('supabase_id, nombre').in('supabase_id', sids).eq('business_id', bid)
          const map = new Map((emps || []).map(e => [e.supabase_id, e.nombre]))
          for (const r of out) r.name = map.get(r.empleado_supabase_id) || '—'
        }
        return out
      }, []),

      byWasher: (params) => tryOr(async () => {
        const washerId = params.washerId
        const dateFrom = params.from || params.dateFrom
        const dateTo   = params.to   || params.dateTo
        // washerId is the lavador's empleados.supabase_id (UUID)
        let q = supabase.from('washer_commissions').select('*').eq('business_id', bid)
          .eq('empleado_supabase_id', washerId)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        q = q.order('created_at', { ascending: false }).limit(2000)
        const rows = throwSupaError(await q)
        if (!rows?.length) return []

        // Fetch ticket details via ticket_supabase_id
        const tSids = [...new Set(rows.map(r => r.ticket_supabase_id).filter(Boolean))]
        const ticketMap = {}
        if (tSids.length) { const { data: tr } = await supabase.from('tickets').select('id, supabase_id, doc_number, created_at, vehicle_plate, status').in('supabase_id', tSids); for (const t of (tr || [])) ticketMap[t.supabase_id] = t }

        // Fetch wash-only items via ticket_supabase_id
        const itemsMap = {}
        if (tSids.length) { const { data: ir } = await supabase.from('ticket_items').select('ticket_supabase_id, name').in('ticket_supabase_id', tSids).eq('is_wash', true); for (const i of (ir || [])) { if (!itemsMap[i.ticket_supabase_id]) itemsMap[i.ticket_supabase_id] = []; itemsMap[i.ticket_supabase_id].push(i.name) } }

        // Fetch empleado info (lavador)
        let empRow = null
        if (washerId) {
          const { data: e } = await supabase.from('empleados').select('nombre, comision_pct').eq('supabase_id', washerId).maybeSingle()
          empRow = e
        }

        return rows.map(r => {
          const tKey = r.ticket_supabase_id
          const t = ticketMap[tKey] || {}
          return {
            ...r,
            doc_number:     t.doc_number   || null,
            ticket_date:    t.created_at    || r.created_at,
            vehicle_plate:  t.vehicle_plate || null,
            washer_name:    empRow?.nombre  || '—',
            commission_pct: empRow?.comision_pct || r.commission_pct || 0,
            services:       (itemsMap[tKey] || []).join(' + '),
          }
        })
      }, []),

      byPeriod: (params) => tryOr(async () => {
        const dateFrom = params.from || params.dateFrom
        const dateTo   = params.to   || params.dateTo
        const { data: rows, error } = await supabase.from('washer_commissions')
          .select('empleado_supabase_id, ticket_supabase_id, base_amount, commission_pct, commission_amount, created_at, paid')
          .eq('business_id', bid)
        if (error) throw new Error(error.message)
        if (!rows?.length) return []

        // v2.14.24 — include BOTH paid and unpaid in the result so
        // liquidación views can show total_acumulado. total_commission
        // stays as unpaid-only for "pagar ahora" flows.
        const from = dateFrom || '2000-01-01'
        const to   = dateTo   || '2099-12-31'
        const filtered = rows.filter(r => r.created_at >= from && r.created_at <= to)
        if (!filtered.length) return []

        const empSids = [...new Set(filtered.map(r => r.empleado_supabase_id).filter(Boolean))]
        const empMap = {}
        if (empSids.length) {
          const { data: er } = await supabase.from('empleados').select('supabase_id, nombre, comision_pct').in('supabase_id', empSids)
          for (const e of (er || [])) empMap[e.supabase_id] = e
        }

        const map = {}
        for (const r of filtered) {
          const wid = r.empleado_supabase_id
          const e = empMap[wid] || {}
          if (!map[wid]) map[wid] = {
            // 2026-04-30 — NominaEmpleados.jsx build() looks for
            // `empleado_supabase_id` to bucket commissions per worker.
            // Without this, the entire web liquidación / per-employee
            // commission column reads as 0 because the field-name match
            // fails (desktop SQL aliased it; web ESM port omitted it).
            empleado_supabase_id: wid,
            washer_id: wid, washer_name: e.nombre || '—',
            commission_pct: e.comision_pct || r.commission_pct || 0,
            ticket_count: 0, ticket_count_paid: 0, ticket_count_total: 0,
            total_base: 0, total_commission: 0, total_paid: 0, total_acumulado: 0,
          }
          map[wid].ticket_count_total++
          map[wid].total_acumulado += r.commission_amount || 0
          if (r.paid) {
            map[wid].ticket_count_paid++
            map[wid].total_paid += r.commission_amount || 0
          } else {
            map[wid].ticket_count++
            map[wid].total_base       += r.base_amount || 0
            map[wid].total_commission += r.commission_amount || 0
          }
        }
        return Object.values(map).sort((a, b) => b.total_acumulado - a.total_acumulado)
      }, []),

      markPaid: (ids) => tryWrite(async () => {
        const now = new Date().toISOString()
        throwSupaError(await supabase.from('washer_commissions')
          .update({ paid: true, paid_at: now }).in('id', ids).eq('business_id', bid))
      }, 'web.commissions.markPaid'),

      // Mark all unpaid commissions within a period for a set of empleados as paid.
      // Used by NominaPagos bulk save to prevent re-running the same period
      // from double-counting commissions already included in a payroll run.
      markPaidByPeriod: ({ empleado_supabase_ids, from, to }) => tryWrite(async () => {
        if (!empleado_supabase_ids?.length) return { updated: 0 }
        const now = new Date().toISOString()
        const { data } = await supabase.from('washer_commissions')
          .update({ paid: true, paid_at: now })
          .eq('business_id', bid)
          .eq('paid', false)
          .in('empleado_supabase_id', empleado_supabase_ids)
          .gte('created_at', from)
          .lte('created_at', to + ' 23:59:59')
          .select('id')
        return { updated: (data || []).length }
      }, 'web.commissions.markPaidByPeriod'),

      // v2.14 — manual commission entry (no ticket FK).
      create: (data) => tryWrite(async () => {
        if (!data.empleado_supabase_id || !data.manual_reason) throw new Error('empleado_supabase_id + manual_reason required')
        const sid = crypto.randomUUID()
        const payload = {
          supabase_id: sid,
          business_id: bid,
          empleado_supabase_id: data.empleado_supabase_id,
          ticket_supabase_id: null,
          base_amount: Number(data.base_amount || 0),
          commission_pct: Number(data.commission_pct || 0),
          commission_amount: Number(data.commission_amount || 0),
          paid: false,
          manual_reason: data.manual_reason,
        }
        if (data.created_at) payload.created_at = data.created_at
        const row = throwSupaError(await supabase.from('washer_commissions').insert(payload).select('id').single())
        return { id: row.id, supabase_id: sid }
      }, 'web.commissions.create'),
    },

    // ── Seller Commissions ──────────────────────────────────────────────────

    sellerCommissions: {
      bySeller: (params) => tryOr(async () => {
        const sellerId = params.sellerId
        const dateFrom = params.from || params.dateFrom
        const dateTo   = params.to   || params.dateTo
        // sellerId is the vendedor's empleados.supabase_id (UUID)
        let q = supabase.from('seller_commissions').select('*').eq('business_id', bid)
          .eq('empleado_supabase_id', sellerId)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        q = q.order('created_at', { ascending: false }).limit(2000)
        const rows = throwSupaError(await q)
        if (!rows?.length) return []
        const tSids = [...new Set(rows.map(r => r.ticket_supabase_id).filter(Boolean))]
        const tMap = {}
        if (tSids.length) { const { data: tr } = await supabase.from('tickets').select('id, supabase_id, doc_number, created_at, vehicle_plate').in('supabase_id', tSids); for (const t of (tr || [])) tMap[t.supabase_id] = t }
        let empRow = null
        if (sellerId) {
          const { data: e } = await supabase.from('empleados').select('nombre, comision_pct').eq('supabase_id', sellerId).maybeSingle()
          empRow = e
        }
        return rows.map(r => {
          const t = tMap[r.ticket_supabase_id] || {}
          return { ...r, doc_number: t.doc_number || null, ticket_date: t.created_at || r.created_at, vehicle_plate: t.vehicle_plate || null, seller_name: empRow?.nombre || '—', commission_pct: empRow?.comision_pct || r.commission_pct || 0 }
        })
      }, []),

      byPeriod: (params) => tryOr(async () => {
        const dateFrom = params.from || params.dateFrom
        const dateTo   = params.to   || params.dateTo
        const { data: rows, error } = await supabase.from('seller_commissions')
          .select('empleado_supabase_id, base_amount, commission_pct, commission_amount, created_at, paid')
          .eq('business_id', bid)
        if (error) throw new Error(error.message)
        if (!rows?.length) return []
        const from = dateFrom || '2000-01-01', to = dateTo || '2099-12-31'
        const filtered = rows.filter(r => r.created_at >= from && r.created_at <= to)
        if (!filtered.length) return []
        const empSids = [...new Set(filtered.map(r => r.empleado_supabase_id).filter(Boolean))]
        const sMap = {}
        if (empSids.length) {
          const { data: er } = await supabase.from('empleados').select('supabase_id, nombre, comision_pct').in('supabase_id', empSids)
          for (const e of (er || [])) sMap[e.supabase_id] = e
        }
        // v2.14.24 — total_acumulado (paid + unpaid) for liquidación
        const map = {}
        for (const r of filtered) {
          const sid = r.empleado_supabase_id
          const s = sMap[sid] || {}
          if (!map[sid]) map[sid] = {
            // 2026-04-30 — same fix as washer byPeriod above.
            empleado_supabase_id: sid,
            seller_id: sid, seller_name: s.nombre || '—',
            commission_pct: s.comision_pct || r.commission_pct || 0,
            ticket_count: 0, ticket_count_paid: 0, ticket_count_total: 0,
            total_base: 0, total_commission: 0, total_paid: 0, total_acumulado: 0,
          }
          map[sid].ticket_count_total++
          map[sid].total_acumulado += r.commission_amount || 0
          if (r.paid) { map[sid].ticket_count_paid++; map[sid].total_paid += r.commission_amount || 0 }
          else { map[sid].ticket_count++; map[sid].total_base += r.base_amount || 0; map[sid].total_commission += r.commission_amount || 0 }
        }
        return Object.values(map).sort((a, b) => b.total_acumulado - a.total_acumulado)
      }, []),

      markPaid: (ids) => tryWrite(async () => {
        const now = new Date().toISOString()
        throwSupaError(await supabase.from('seller_commissions')
          .update({ paid: true, paid_at: now }).in('id', ids).eq('business_id', bid))
      }, 'web.sellerCommissions.markPaid'),

      markPaidByPeriod: ({ empleado_supabase_ids, from, to }) => tryWrite(async () => {
        if (!empleado_supabase_ids?.length) return { updated: 0 }
        const now = new Date().toISOString()
        const { data } = await supabase.from('seller_commissions')
          .update({ paid: true, paid_at: now })
          .eq('business_id', bid).eq('paid', false)
          .in('empleado_supabase_id', empleado_supabase_ids)
          .gte('created_at', from).lte('created_at', to + ' 23:59:59')
          .select('id')
        return { updated: (data || []).length }
      }, 'web.sellerCommissions.markPaidByPeriod'),

      create: (data) => tryWrite(async () => {
        const sid = crypto.randomUUID()
        let empSid = data.empleado_supabase_id || null
        if (!empSid && data.seller_supabase_id) {
          const { data: emp } = await supabase.from('empleados').select('supabase_id').eq('supabase_id', data.seller_supabase_id).eq('business_id', bid).maybeSingle()
          empSid = emp?.supabase_id || data.seller_supabase_id
        }
        // FIX-H9 idempotency — if a (ticket_supabase_id, empleado_supabase_id)
        // pair already exists, return the existing row instead of inserting a
        // duplicate. Prevents the "vendedor cobra comisión doble" bug from a
        // double-clicked Emitir or a retried offline-queue replay.
        if (data.ticket_supabase_id && empSid) {
          const { data: existing } = await supabase.from('seller_commissions')
            .select('id, supabase_id')
            .eq('business_id', bid)
            .eq('ticket_supabase_id', data.ticket_supabase_id)
            .eq('empleado_supabase_id', empSid)
            .maybeSingle()
          if (existing?.id) return { id: existing.id, supabase_id: existing.supabase_id, deduped: true }
        }
        const payload = {
          supabase_id: sid,
          business_id: bid,
          empleado_supabase_id: empSid,
          ticket_supabase_id: data.ticket_supabase_id || null,
          base_amount: Number(data.base_amount || 0),
          commission_pct: Number(data.commission_pct || 0),
          commission_amount: Number(data.commission_amount || 0),
          paid: false,
        }
        if (data.manual_reason) payload.manual_reason = data.manual_reason
        if (data.created_at)    payload.created_at    = data.created_at
        const row = throwSupaError(await supabase.from('seller_commissions').insert(payload).select('id').single())
        return { id: row.id, supabase_id: sid }
      }, 'web.sellerCommissions.create'),
    },

    // ── Cajero Commissions ──────────────────────────────────────────────────

    cajeroCommissions: {
      byCajero: (params) => tryOr(async () => {
        const cajeroId = params.cajeroId
        const dateFrom = params.from || params.dateFrom
        const dateTo   = params.to   || params.dateTo
        // cajeroId is the cajero's empleados.supabase_id (UUID)
        let q = supabase.from('cajero_commissions').select('*').eq('business_id', bid)
          .eq('empleado_supabase_id', cajeroId)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        q = q.order('created_at', { ascending: false }).limit(2000)
        const rows = throwSupaError(await q)
        if (!rows?.length) return []
        const tSids = [...new Set(rows.map(r => r.ticket_supabase_id).filter(Boolean))]
        const tMap = {}
        if (tSids.length) { const { data: tr } = await supabase.from('tickets').select('id, supabase_id, doc_number, created_at, vehicle_plate').in('supabase_id', tSids); for (const t of (tr || [])) tMap[t.supabase_id] = t }
        let empRow = null
        if (cajeroId) {
          const { data: e } = await supabase.from('empleados').select('nombre, comision_pct').eq('supabase_id', cajeroId).maybeSingle()
          empRow = e
        }
        return rows.map(r => {
          const t = tMap[r.ticket_supabase_id] || {}
          return { ...r, doc_number: t.doc_number || null, ticket_date: t.created_at || r.created_at, vehicle_plate: t.vehicle_plate || null, cajero_name: empRow?.nombre || '—', commission_pct: empRow?.comision_pct || r.commission_pct || 0 }
        })
      }, []),

      byPeriod: (params) => tryOr(async () => {
        const dateFrom = params.from || params.dateFrom
        const dateTo   = params.to   || params.dateTo
        const { data: rows, error } = await supabase.from('cajero_commissions')
          .select('empleado_supabase_id, base_amount, commission_pct, commission_amount, created_at')
          .eq('business_id', bid)
        if (error) throw new Error(error.message)
        if (!rows?.length) return []
        const from = dateFrom || '2000-01-01', to = dateTo || '2099-12-31'
        const filtered = rows.filter(r => r.created_at >= from && r.created_at <= to)
        if (!filtered.length) return []
        const empSids = [...new Set(filtered.map(r => r.empleado_supabase_id).filter(Boolean))]
        const cMap = {}
        if (empSids.length) {
          const { data: er } = await supabase.from('empleados').select('supabase_id, nombre, comision_pct').in('supabase_id', empSids)
          for (const e of (er || [])) cMap[e.supabase_id] = e
        }
        const map = {}
        for (const r of filtered) {
          const cid = r.empleado_supabase_id
          const u = cMap[cid] || {}
          if (!map[cid]) map[cid] = { empleado_supabase_id: cid, cajero_id: cid, cajero_name: u.nombre || '—', commission_pct: u.comision_pct || r.commission_pct || 0, ticket_count: 0, total_base: 0, total_commission: 0 }
          map[cid].ticket_count++; map[cid].total_base += r.base_amount || 0; map[cid].total_commission += r.commission_amount || 0
        }
        return Object.values(map).sort((a, b) => b.total_commission - a.total_commission)
      }, []),

      markPaid: (ids) => tryWrite(async () => {
        const now = new Date().toISOString()
        throwSupaError(await supabase.from('cajero_commissions')
          .update({ paid: true, paid_at: now }).in('id', ids).eq('business_id', bid))
      }, 'web.cajeroCommissions.markPaid'),

      markPaidByPeriod: ({ empleado_supabase_ids, from, to }) => tryWrite(async () => {
        if (!empleado_supabase_ids?.length) return { updated: 0 }
        const now = new Date().toISOString()
        const { data } = await supabase.from('cajero_commissions')
          .update({ paid: true, paid_at: now })
          .eq('business_id', bid).eq('paid', false)
          .in('empleado_supabase_id', empleado_supabase_ids)
          .gte('created_at', from).lte('created_at', to + ' 23:59:59')
          .select('id')
        return { updated: (data || []).length }
      }, 'web.cajeroCommissions.markPaidByPeriod'),

      create: (data) => tryWrite(async () => {
        const sid = crypto.randomUUID()
        const empSid = data.empleado_supabase_id || data.cajero_supabase_id || null
        // FIX-H9 idempotency — same dedupe pattern as sellerCommissions.
        if (data.ticket_supabase_id && empSid) {
          const { data: existing } = await supabase.from('cajero_commissions')
            .select('id, supabase_id')
            .eq('business_id', bid)
            .eq('ticket_supabase_id', data.ticket_supabase_id)
            .eq('empleado_supabase_id', empSid)
            .maybeSingle()
          if (existing?.id) return { id: existing.id, supabase_id: existing.supabase_id, deduped: true }
        }
        const payload = {
          supabase_id: sid,
          business_id: bid,
          empleado_supabase_id: empSid,
          ticket_supabase_id: data.ticket_supabase_id || null,
          base_amount: Number(data.base_amount || 0),
          commission_pct: Number(data.commission_pct || 0),
          commission_amount: Number(data.commission_amount || 0),
          paid: false,
        }
        if (data.manual_reason) payload.manual_reason = data.manual_reason
        if (data.created_at)    payload.created_at    = data.created_at
        const row = throwSupaError(await supabase.from('cajero_commissions').insert(payload).select('id').single())
        return { id: row.id, supabase_id: sid }
      }, 'web.cajeroCommissions.create'),
    },

    // ── Cuadre de Caja ───────────────────────────────────────────────────────

    cuadre: {
      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('cuadre_caja').insert({
          ...data,
          supabase_id: crypto.randomUUID(),
          business_id: bid,
          denominaciones: typeof data.denominaciones === 'string' ? data.denominaciones : JSON.stringify(data.denominaciones || {}),
        }).select('id').single())
        const diff = Number(data.diferencia || 0)
        if (Math.abs(diff) > 50) {
          await logActivity({ event_type: 'cuadre_discrepancy',
            severity: Math.abs(diff) >= 500 ? 'critical' : 'warn',
            target_type: 'cuadre_caja', target_id: row?.id || null,
            target_name: `Cuadre ${data.date || ''}`.trim(),
            amount: diff,
            old_value: String(data.efectivo_sistema || 0),
            new_value: String(data.efectivo_conteo || 0),
            reason: data.comentario || (diff > 0 ? 'Sobrante' : 'Faltante'),
            metadata: { cierre_total: data.cierre_total, total_cobrado: data.total_cobrado } })
        }
        return row
      }, 'web.cuadre.create'),

      history: () => tryOr(async () => {
        const { data } = await supabase.from('cuadre_caja')
          .select('*')
          .eq('business_id', bid)
          .order('closed_at', { ascending: false }).limit(20)
        const rows = data || []
        await attachRel(supabase, rows, { fkCol: 'cajero_supabase_id', targetTable: 'staff', selectCols: 'name', asKey: 'staff', businessId: bid })
        return rows.map(r => ({
          ...r,
          cajero_name: r.staff?.name || null,
          staff: undefined,
        }))
      }, []),

      list: (filters = {}) => tryOr(async () => {
        const dateFrom = filters.dateFrom ?? filters.from
        const dateTo   = filters.dateTo   ?? filters.to
        const { limit = 100 } = filters
        let q = supabase.from('cuadre_caja')
          .select('*')
          .eq('business_id', bid)
        if (dateFrom) q = q.gte('date', dateFrom)
        if (dateTo)   q = q.lte('date', dateTo)
        q = q.order('closed_at', { ascending: false }).limit(limit)
        const rows = throwSupaError(await q) || []
        await attachRel(supabase, rows, { fkCol: 'cajero_supabase_id', targetTable: 'staff', selectCols: 'name', asKey: 'staff', businessId: bid })
        return rows.map(r => ({
          ...r,
          cajero_name: r.staff?.name || null,
          staff: undefined,
        }))
      }, []),

      daily: (date) => tryOr(async () => {
        // Direct query — the old RPC `cuadre_daily_summary` was never created on Supabase.
        // Fetch today's paid tickets and aggregate by payment_method in JS.
        // v2.10.4 — also pull payment_parts (JSONB). Restaurant split bills
        // credit each part to its own bucket instead of lumping the ticket
        // total under the single payment_method.
        const d = date || new Date().toISOString().slice(0, 10)
        const { data: rows } = await supabase.from('tickets')
          .select('total, payment_method, payment_parts')
          .eq('business_id', bid)
          .eq('status', 'cobrado')
          .gte('created_at', `${d}T00:00:00`)
          .lte('created_at', `${d}T23:59:59`)
        if (!rows) return { efectivo: 0, tarjeta: 0, transferencia: 0, cheque: 0, credito: 0, pedidos_ya: 0, totalVendido: 0, totalCobrado: 0, count: 0 }
        // payment_method may come from desktop (Spanish: efectivo/tarjeta/...) OR
        // from web (English: cash/card/transfer/check/credit). Normalize both.
        // 2026-05-18 Fix F — `pedidos_ya` channel was missing from the alias map
        // AND from the result bucket initializer, so every PY sale landed in
        // result.pedidos_ya which the cashier never saw → till looked over by
        // the PY amount every shift. PY sales are non-cash receivables (paid
        // by aggregator, not at the till) so they're counted in totalVendido
        // but NOT in totalCobrado (mirrors credito behavior).
        const PM_ALIAS = {
          cash: 'efectivo', efectivo: 'efectivo',
          card: 'tarjeta',  tarjeta: 'tarjeta',
          transfer: 'transferencia', transferencia: 'transferencia',
          check: 'cheque',  cheque: 'cheque',
          credit: 'credito', credito: 'credito',
          pedidos_ya: 'pedidos_ya', py: 'pedidos_ya', 'pedidos-ya': 'pedidos_ya',
        }
        const result = { efectivo: 0, tarjeta: 0, transferencia: 0, cheque: 0, credito: 0, pedidos_ya: 0 }
        let totalVendido = 0, totalCobrado = 0
        for (const r of rows) {
          const tot = Number(r.total || 0)
          totalVendido += tot
          // JSONB returns already-parsed arrays, but older desktop clients
          // that wrote via raw SQL might hand back a string — handle both.
          let parts = null
          if (r.payment_parts) {
            try {
              const parsed = typeof r.payment_parts === 'string' ? JSON.parse(r.payment_parts) : r.payment_parts
              if (Array.isArray(parsed) && parsed.length) parts = parsed
            } catch { parts = null }
          }
          if (parts) {
            for (const p of parts) {
              const pm = PM_ALIAS[p?.method] || p?.method || 'efectivo'
              const amt = Number(p?.amount || 0)
              result[pm] = (result[pm] || 0) + amt
              // Non-cash channels (credito + pedidos_ya) settle outside the till.
              if (pm !== 'credito' && pm !== 'pedidos_ya') totalCobrado += amt
            }
          } else {
            const raw = r.payment_method || 'efectivo'
            const pm = PM_ALIAS[raw] || raw
            result[pm] = (result[pm] || 0) + tot
            if (pm !== 'credito' && pm !== 'pedidos_ya') totalCobrado += tot
          }
        }
        // v2.6 — Licoreria bottle-deposit reconciliation. Two extra scans:
        //   (1) ticket_items.is_deposit = TRUE on paid tickets → depositos_cobrados
        //   (2) tickets.total < 0 with [deposit_return] marker → depositos_devueltos
        let depositos_cobrados = 0, depositos_devueltos = 0
        try {
          const { data: depRows } = await supabase.from('ticket_items')
            .select('price, quantity, tickets!inner(status, created_at, total, business_id)')
            .eq('is_deposit', true)
            .eq('tickets.business_id', bid)
            .eq('tickets.status', 'cobrado')
            .gte('tickets.created_at', `${d}T00:00:00`)
            .lte('tickets.created_at', `${d}T23:59:59`)
          for (const r of (depRows || [])) {
            if (Number(r?.tickets?.total || 0) < 0) continue
            depositos_cobrados += Number(r.price || 0) * Number(r.quantity || 1)
          }
          const { data: refRows } = await supabase.from('tickets')
            .select('total, notes')
            .eq('business_id', bid)
            .eq('status', 'cobrado')
            .lt('total', 0)
            .like('notes', '%[deposit_return]%')
            .gte('created_at', `${d}T00:00:00`)
            .lte('created_at', `${d}T23:59:59`)
          for (const r of (refRows || [])) depositos_devueltos += Math.abs(Number(r.total || 0))
        } catch { /* non-fatal: licoreria-only feature */ }
        return {
          ...result, totalVendido, totalCobrado, count: rows.length,
          depositos_cobrados, depositos_devueltos,
          depositos_neto: depositos_cobrados - depositos_devueltos,
        }
      }, { efectivo: 0, tarjeta: 0, transferencia: 0, cheque: 0, credito: 0, totalVendido: 0, totalCobrado: 0, count: 0, depositos_cobrados: 0, depositos_devueltos: 0, depositos_neto: 0 }),

      // v2.6.2 — Apertura de Turno.
      // Resolves the open shift row for a given staff/empleado id. Web uses
      // empleado supabase_id (the canonical FK); we accept either user_id
      // (numeric staff id) or cajero_supabase_id (string).
      getOpen: ({ user_id, cajero_id, cajero_supabase_id } = {}) => tryOr(async () => {
        const today = new Date().toISOString().slice(0, 10)
        let q = supabase.from('cuadre_caja')
          .select('*')
          .eq('business_id', bid)
          .eq('date', today)
          .eq('status', 'abierto')
          .order('id', { ascending: false })
          .limit(1)
        if (cajero_supabase_id) q = q.eq('cajero_supabase_id', cajero_supabase_id)
        else if (cajero_id || user_id) q = q.eq('cajero_id', cajero_id || user_id)
        else return null
        const { data } = await q
        return (data && data[0]) || null
      }, null),

      openShift: ({ user_id, cajero_id, cajero_supabase_id, opening_cash, opened_at } = {}) => tryWrite(async () => {
        const when = opened_at || new Date().toISOString()
        const today = when.slice(0, 10)
        const fondo = Number(opening_cash || 0)
        // Idempotent: if one is already open, return it.
        const existing = await (async () => {
          try {
            let q = supabase.from('cuadre_caja')
              .select('id, supabase_id')
              .eq('business_id', bid)
              .eq('date', today)
              .eq('status', 'abierto')
              .order('id', { ascending: false })
              .limit(1)
            if (cajero_supabase_id) q = q.eq('cajero_supabase_id', cajero_supabase_id)
            else if (cajero_id || user_id) q = q.eq('cajero_id', cajero_id || user_id)
            const { data } = await q
            return data && data[0]
          } catch { return null }
        })()
        if (existing?.id) return { id: existing.id, supabase_id: existing.supabase_id, existed: true }
        const sid = crypto.randomUUID()
        const row = throwSupaError(await supabase.from('cuadre_caja').insert({
          business_id: bid,
          cajero_id: cajero_id || user_id || null,
          cajero_supabase_id: cajero_supabase_id || null,
          date: today,
          fondo,
          opening_cash: fondo,
          opened_at: when,
          status: 'abierto',
          supabase_id: sid,
          denominaciones: '{}',
        }).select('id').single())
        try {
          await logActivity({ event_type: 'shift_opened', severity: 'info',
            target_type: 'cuadre_caja', target_id: row?.id || null,
            target_name: `Turno ${today}`,
            amount: fondo, reason: 'Apertura de turno',
            metadata: { opening_cash: fondo, opened_at: when } })
        } catch (err) {
          try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'warn', category: 'web.cuadre.shift_opened.activity_log', extra: { cuadre_id: row?.id, fondo, today } }) } catch {}
        }
        return { id: row?.id || null, supabase_id: sid, existed: false }
      }),
    },

    // ── NCF ──────────────────────────────────────────────────────────────────

    ncf: {
      sequences: () => tryOr(async () => {
        return throwSupaError(await supabase.from('ncf_sequences').select('*').eq('business_id', bid).order('type'))
      }, []),

      next: (type) => tryWrite(async () => {
        // Atomic NCF increment via RPC. MUST use tryWrite — wrapping in tryOr
        // swallows transient RPC errors (RLS, JWT path, schema-cache miss) as
        // null, which lets CobrarModal fall through to its in-memory fallback
        // and mint duplicate NCFs across two terminals. Surface the error so
        // the cashier sees "NCF allocator unavailable, retry" instead.
        const result = throwSupaError(await supabase.rpc('atomic_next_ncf', {
          business_uuid: bid,
          ncf_type: type,
        }))
        return result // returns formatted NCF string like "E3100000001"
      }),

      // Pre-submit rollback: an eNCF was reserved via .next() but the e-CF
      // submission failed before reaching DGII. If still the last issued
      // sequence number, decrement so we don't burn a fiscal range.
      rollback: (ncf) => tryOr(async () => {
        if (!ncf || typeof ncf !== 'string') return { decremented: false, reason: 'invalid-ncf' }
        const m = ncf.trim().match(/^([A-Z]\d{2})(\d+)$/)
        if (!m) return { decremented: false, reason: 'bad-format' }
        const prefix = m[1]
        const num = parseInt(m[2], 10)
        if (!Number.isFinite(num) || num <= 0) return { decremented: false, reason: 'bad-number' }
        const { data: seq } = await supabase.from('ncf_sequences')
          .select('type, current_number').eq('business_id', bid).eq('prefix', prefix).eq('active', true).maybeSingle()
        if (!seq) return { decremented: false, reason: 'no-sequence' }
        if (Number(seq.current_number) !== num) {
          return { decremented: false, reason: 'not-last', current: Number(seq.current_number) }
        }
        throwSupaError(await supabase.from('ncf_sequences')
          .update({ current_number: num - 1 })
          .eq('business_id', bid).eq('type', seq.type))
        return { decremented: true, prefix, number: num }
      }, { decremented: false, reason: 'error' }),

      updateSequence: (data) => tryWrite(async () => {
        const { type, ...rest } = data
        if ('enabled' in rest) rest.enabled = !!rest.enabled
        if ('active'  in rest) rest.active  = !!rest.active
        // v2.16.27 — Coerce form values that PostgREST rejects:
        //   - `valid_until` is a DATE column; empty string '' is invalid →
        //     coerce to null.
        //   - `current_number` and `limit_number` are integers; the form
        //     emits strings ("500") that PostgREST does accept but Number()
        //     keeps the contract clean.
        //   - The legacy `end_number` field name (this file used to write
        //     it on insert) is NOT a column — schema uses `limit_number`.
        //     PostgREST silently dropped it, harmless but worth removing.
        if ('valid_until' in rest) rest.valid_until = rest.valid_until ? rest.valid_until : null
        if ('current_number' in rest) rest.current_number = Number(rest.current_number) || 0
        if ('limit_number' in rest) rest.limit_number = Number(rest.limit_number) || 500
        // v2.16.27 — UPSERT. Original UPDATE-only path matched 0 rows on
        // fresh clients and silently succeeded, leaving the user wondering
        // why every receipt printed B0200000001. Now: read existing, INSERT
        // if missing, UPDATE if present.
        const { data: existing } = await supabase.from('ncf_sequences')
          .select('id').eq('business_id', bid).eq('type', type).maybeSingle()
        if (existing) {
          throwSupaError(await supabase.from('ncf_sequences').update(rest).eq('business_id', bid).eq('type', type))
        } else {
          const insertRow = {
            supabase_id:    (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `web-${Date.now()}`,
            business_id:    bid,
            type,
            prefix:         rest.prefix ?? type,
            current_number: rest.current_number ?? 0,
            limit_number:   rest.limit_number ?? 500,
            valid_until:    rest.valid_until ?? null,
            enabled:        rest.enabled ?? false,
            active:         rest.active  ?? true,
            ...rest,
          }
          throwSupaError(await supabase.from('ncf_sequences').insert(insertRow))
        }
      }, 'web.ncf.updateSequence'),
    },

    // ── Caja Chica ───────────────────────────────────────────────────────────

    cajaChica: {
      all: () => tryOr(async () => {
        const { data } = await supabase.from('caja_chica')
          .select('*')
          .eq('business_id', bid)
          .order('created_at', { ascending: false }).limit(100)
        const rows = data || []
        await attachRel(supabase, rows, { fkCol: 'approved_by_supabase_id', targetTable: 'staff', selectCols: 'name', asKey: 'staff', businessId: bid })
        return rows.map(r => ({
          ...r,
          approved_name: r.staff?.name || null,
          staff: undefined,
        }))
      }, []),

      create: (data) => tryWrite(async () => {
        throwSupaError(await supabase.from('caja_chica').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }))
        await logActivity({ event_type: 'caja_chica_withdrawal',
          severity: Number(data.amount) >= 2000 ? 'warn' : 'info',
          target_type: 'caja_chica',
          target_name: data.description || data.category || 'Retiro',
          amount: data.amount, reason: data.category || null,
          metadata: { type: data.type, recibo: data.recibo || null, status: data.status } })
      }, 'web.cajaChica.create'),

      updateStatus: (data) => tryWrite(async () => {
        const { id, status, approvedBy } = data
        // v2.16.10 2026-04-30 — DO NOT REVERT (FIX-LEDGER §2.20). The .all() join
        // reads approved_by_supabase_id (line 4379). Without resolving the
        // numeric to a UUID + writing both columns, the approver name never
        // resolves on the web caja-chica list after approval.
        let approvedSid = null
        if (approvedBy) {
          if (typeof approvedBy === 'string' && approvedBy.length === 36) {
            approvedSid = approvedBy
          } else {
            const { data: emp } = await supabase.from('staff').select('supabase_id').eq('id', approvedBy).eq('business_id', bid).maybeSingle()
            approvedSid = emp?.supabase_id || null
          }
        }
        throwSupaError(await supabase.from('caja_chica').update({
          status,
          approved_by: approvedBy || null,
          approved_by_supabase_id: approvedSid,
        }).eq('id', id).eq('business_id', bid))
      }, 'web.cajaChica.updateStatus'),
    },

    // ── Notas de Credito ─────────────────────────────────────────────────────

    notas: {
      all: () => tryOr(async () => {
        const { data } = await supabase.from('notas_credito')
          .select('*')
          .eq('business_id', bid)
          .order('created_at', { ascending: false }).limit(100)
        const rows = data || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name', asKey: 'clients', businessId: bid })
        return rows.map(r => ({
          ...r,
          client_name: r.clients?.name || null,
          clients: undefined,
        }))
      }, []),

      create: (data) => tryWrite(async () => {
        // Whitelist real notas_credito columns. Returns.jsx passes
        // denormalized fields (client_name, client_rnc, mac_jti) for
        // logging/UX which the table doesn't have — Postgres 400's
        // ('Could not find the X column') so the nota never lands.
        // Drop them silently here; the auth/log metadata captures them.
        const sid = (data.supabase_id) || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined)
        const row = {
          supabase_id: sid,
          business_id: bid,
          ncf:                          data.ncf ?? null,
          client_id:                    data.client_id ?? null,
          client_supabase_id:           data.client_supabase_id ?? null,
          original_ticket_id:           data.original_ticket_id ?? null,
          original_ticket_supabase_id:  data.original_ticket_supabase_id ?? null,
          motivo:                       data.motivo ?? null,
          amount:                       data.amount ?? 0,
          itbis_revertido:              data.itbis_revertido ?? 0,
          forma_devolucion:             data.forma_devolucion ?? null,
          comentario:                   data.comentario ?? null,
          cajero_id:                    data.cajero_id ?? null,
          cajero_supabase_id:           data.cajero_supabase_id ?? null,
        }
        throwSupaError(await supabase.from('notas_credito').insert(row))
        // v2.16.31 follow-up — resolve + log the original ticket's NCF so the
        // audit trail captures it even though the table itself has no
        // dedicated column. Recovered later by reprint paths via
        // notas_credito.original_ticket_supabase_id → tickets.ncf.
        let originalNcfResolved = data.original_ncf || null
        if (!originalNcfResolved && data.original_ticket_supabase_id) {
          try {
            const { data: t } = await supabase.from('tickets')
              .select('ncf')
              .eq('business_id', bid)
              .eq('supabase_id', data.original_ticket_supabase_id)
              .maybeSingle()
            originalNcfResolved = t?.ncf || null
          } catch {}
        }
        await logActivity({ event_type: 'nota_credito_created', severity: 'critical',
          target_type: 'nota_credito', target_name: data.ncf || 'NC',
          amount: data.amount, reason: data.motivo || null,
          metadata: { original_ticket_id: data.original_ticket_id || null, original_ticket_supabase_id: data.original_ticket_supabase_id || null, original_ncf: originalNcfResolved, itbis_revertido: data.itbis_revertido, forma_devolucion: data.forma_devolucion, client_name: data.client_name || null, client_rnc: data.client_rnc || null, mac_jti: data.mac_jti || null } })
        return { ok: true, supabase_id: sid, original_ncf: originalNcfResolved }
      }),
    },

    // ── DGII ─────────────────────────────────────────────────────────────────

    dgii: {
      get606: (params) => tryOr(async () => {
        const dateFrom = params?.dateFrom ?? params?.from
        const dateTo   = params?.dateTo   ?? params?.to
        let q = supabase.from('tickets')
          .select('id, ncf, comprobante_type, created_at, subtotal, itbis, ley, total, status, client_supabase_id')
          .eq('business_id', bid)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        q = q.order('created_at', { ascending: false })
        const rows = throwSupaError(await q) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name, rnc', asKey: 'clients', businessId: bid })
        return rows.map(r => ({
          id: r.id, ncf: r.ncf, tipo: r.comprobante_type,
          fecha: r.created_at, subtotal: r.subtotal, itbis: r.itbis,
          ley: r.ley, total: r.total, estado: r.status,
          client_name: r.clients?.name || null,
          client_rnc: r.clients?.rnc || null,
          clients: undefined,
        }))
      }, []),

      get607: (params) => tryOr(async () => {
        const dateFrom = params?.dateFrom ?? params?.from
        const dateTo   = params?.dateTo   ?? params?.to
        let q = supabase.from('compras_607').select('*').eq('business_id', bid)
        if (dateFrom) q = q.gte('fecha_ncf', dateFrom)
        if (dateTo)   q = q.lte('fecha_ncf', dateTo)
        q = q.order('fecha_ncf', { ascending: false })
        return throwSupaError(await q)
      }, []),

      addCompra: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('compras_607').insert({
          supabase_id:      crypto.randomUUID(),
          rnc_proveedor:    data.rnc_proveedor    || '',
          nombre_proveedor: data.nombre_proveedor || '',
          tipo_ncf:         data.tipo_ncf         || 'B01',
          ncf:              data.ncf              || '',
          ncf_modificado:   data.ncf_modificado   || '',
          fecha_ncf:        data.fecha_ncf        || new Date().toISOString().slice(0, 10),
          fecha_pago:       data.fecha_pago       || '',
          monto_servicios:  Number(data.monto_servicios)  || 0,
          monto_bienes:     Number(data.monto_bienes)     || 0,
          total:            Number(data.total)            || 0,
          itbis_facturado:  Number(data.itbis_facturado)  || 0,
          itbis_retenido:   Number(data.itbis_retenido)   || 0,
          retencion_renta:  Number(data.retencion_renta)  || 0,
          forma_pago:       data.forma_pago       || 'efectivo',
          notas:            data.notas            || '',
          business_id: bid,
        }).select('id').single())
        return { id: row.id }
      }, 'web.dgii.addCompra'),

      deleteCompra: ({ id }) => tryWrite(async () => {
        throwSupaError(await supabase.from('compras_607').delete().eq('id', id).eq('business_id', bid))
      }, 'web.dgii.deleteCompra'),
    },

    // ── RNC Lookup ───────────────────────────────────────────────────────────

    rnc: {
      lookup: async (rnc) => {
        const clean = rnc.replace(/[\s-]/g, '')

        // 1. Try rnc_cache table (previously looked-up entries)
        try {
          const { data: cached } = await supabase.from('rnc_cache')
            .select('rnc, nombre, estado')
            .eq('business_id', bid)
            .eq('rnc', clean)
            .maybeSingle()
          if (cached?.nombre) return { rnc: cached.rnc, name: cached.nombre, status: cached.estado }
        } catch { /* table may not exist */ }

        // 2. Try rnc_contribuyentes table (full DGII directory if synced)
        try {
          const { data: local } = await supabase.from('rnc_contribuyentes')
            .select('rnc, nombre, estado')
            .eq('rnc', clean)
            .maybeSingle()
          if (local?.nombre) return { rnc: local.rnc, name: local.nombre, status: local.estado }
        } catch { /* table may not exist */ }

        // 3. Fallback: megaplus.com.do via Vercel API proxy
        try {
          const resp = await fetch('/api/rnc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rnc: clean }),
          })
          if (resp.ok) {
            const result = await resp.json()
            // Cache the result for next time
            supabase.from('rnc_cache').upsert({
              business_id: bid, rnc: clean,
              nombre: result.name || '',
              estado: result.status || 'ACTIVO',
              source: 'api',
            }, { onConflict: 'business_id,rnc' }).then(() => {})
            return result
          }
        } catch { /* API proxy unavailable */ }

        return null
      },

      sync: () => tryOr(async () => {
        // Edge functions not deployed yet — RNC bulk sync is a desktop-only
        // feature (downloads 900K rows from DGII directly). Web users get
        // on-demand RNC lookup via lookup() above instead.
        return { ok: false, error: 'RNC bulk sync only available on desktop. Use lookup on demand.' }
      }, { ok: false }),

      status: () => tryOr(async () => {
        // Direct count from rnc_cache (per-business cached lookups). Avoids the
        // un-deployed `rnc-status` edge function which was causing CSP/CORS
        // errors on terminalxpos.com.
        const { count } = await supabase.from('rnc_cache')
          .select('*', { count: 'exact', head: true }).eq('business_id', bid)
        const { data: lastRow } = await supabase.from('rnc_cache')
          .select('synced_at').eq('business_id', bid)
          .order('synced_at', { ascending: false }).limit(1).maybeSingle()
        return { count: count || 0, lastSync: lastRow?.synced_at || null }
      }, { count: 0, lastSync: null }),

      // No real event emitter in web — consumers should poll or use Supabase Realtime
      onSyncProgress: () => { /* no-op in web context */ },
    },

    // ── Backup / DB export ───────────────────────────────────────────────────

    db: {
      exportAll: () => tryOr(async () => {
        const tables = ['tickets', 'ticket_items', 'clients', 'credit_payments', 'queue',
          'cuadre_caja', 'caja_chica', 'notas_credito', 'washer_commissions', 'ncf_sequences', 'app_settings']
        const snap = { exported_at: new Date().toISOString(), version: '1.0.0-web', tables: {} }
        for (const t of tables) {
          try {
            const { data } = await supabase.from(t).select('*').eq('business_id', bid)
            snap.tables[t] = data || []
          } catch {
            snap.tables[t] = []
          }
        }
        return snap
      }, {}),

      exportSince: (since) => tryOr(async () => {
        const [tickets, clients, payments] = await Promise.all([
          supabase.from('tickets').select('*').eq('business_id', bid).gt('created_at', since),
          supabase.from('clients').select('*').eq('business_id', bid).gt('created_at', since),
          supabase.from('credit_payments').select('*').eq('business_id', bid).gt('created_at', since),
        ])
        return {
          tickets:  tickets.data  || [],
          clients:  clients.data  || [],
          payments: payments.data || [],
        }
      }, { tickets: [], clients: [], payments: [] }),
    },

    // ── PDF receipts ─────────────────────────────────────────────────────────

    pdf: {
      save: (payload) => tryOr(async () => {
        // In web context, trigger a browser download
        const { buffer, filename } = payload || {}
        if (!buffer) return { ok: false, error: 'No buffer provided' }
        const blob = new Blob(
          [buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)],
          { type: 'application/pdf' }
        )
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename || 'receipt.pdf'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        return { ok: true }
      }),
    },

    // ── Local backup ─────────────────────────────────────────────────────────

    backup: {
      local: () => Promise.resolve({ ok: true, message: 'Supabase IS the backup in web mode' }),
    },

    // ── Printer ──────────────────────────────────────────────────────────────

    print: () => Promise.resolve({ ok: false, error: 'Use printWeb service for browser printing' }),

    // ── File save ────────────────────────────────────────────────────────────

    saveFile: (payload) => tryOr(async () => {
      const { data, filename, mimeType } = payload || {}
      if (!data) return { ok: false, error: 'No data provided' }
      const blob = new Blob(
        [typeof data === 'string' ? data : new Uint8Array(data)],
        { type: mimeType || 'application/octet-stream' }
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename || 'file'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      return { ok: true }
    }),

    // ── License ──────────────────────────────────────────────────────────────

    license: {
      hwid: () => Promise.resolve('web-client'),
      isMaster: () => Promise.resolve(false),
    },

    // ── App version ──────────────────────────────────────────────────────────

    version: () => Promise.resolve('0.0.0-web'),

    // ── App / production gate ──────────────────────────────────────────────
    // Web mirror of electron/database.js {isProductionLive, testDataCount,
    // goLiveCommit}. Until 2026-05-02 this namespace was missing on web —
    // Sistema.jsx's "Activar producción" button optional-chained against
    // undefined so the cutover silently no-op'd, and the customer's test
    // tickets stayed in DGII reports + commissions forever.
    //
    // What goLiveCommit does (test data only — never touches masters):
    //   - tickets.is_test = true → DELETE
    //   - ticket_items / ticket_item_modificadores / ticket_payments tied
    //     to those tickets → DELETE
    //   - washer_commissions / seller_commissions / cajero_commissions
    //     tied to those tickets → DELETE
    //   - notas_credito with original_ticket_supabase_id pointing at a
    //     wiped ticket → DELETE
    //   - anecf_queue rows for wiped tickets → DELETE
    //   - inventory_oversells for wiped tickets → DELETE
    //   - ncf_sequences.current_number reset to 0 (so the first real sale
    //     starts at #1, matching DGII paper book expectations)
    //   - app_settings.go_live_committed_at = now
    //
    // What it explicitly does NOT touch (preserves all configuration):
    //   - inventory_items (product master + stock — owner ran a real conteo)
    //   - clients (customer master)
    //   - staff / empleados / users
    //   - services (catalog)
    //   - app_settings (Mi Empresa + preferences)
    //   - businesses (RNC, address, cert)
    //   - licenses
    //   - inventory_counts (audit history; owner can delete manually)
    //   - activity_log (audit history)
    app: {
      isProductionLive: () => tryOr(async () => {
        const { data } = await supabase.from('app_settings')
          .select('value').eq('business_id', bid).eq('key', 'go_live_date').maybeSingle()
        const v = data?.value
        if (!v) return false
        const today = new Date(); today.setHours(0,0,0,0)
        const d = new Date(`${v}T00:00:00`)
        if (Number.isNaN(d.getTime())) return false
        return d.getTime() <= today.getTime()
      }, false),

      testDataCount: () => tryOr(async () => {
        const { count: tickets } = await supabase.from('tickets')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', bid).eq('is_test', true)
        return { tickets: tickets || 0 }
      }, { tickets: 0 }),

      goLiveCommit: () => tryWrite(async () => {
        // 1) Find all is_test ticket supabase_ids for this business.
        const { data: testTickets } = await supabase.from('tickets')
          .select('id, supabase_id').eq('business_id', bid).eq('is_test', true)
        const tIds  = (testTickets || []).map(t => t.id).filter(Boolean)
        const tSids = (testTickets || []).map(t => t.supabase_id).filter(Boolean)

        if (tSids.length) {
          // 2) Delete child rows by ticket_supabase_id (uuid-only path —
          //    integer ticket_id may be null on web-created rows).
          // Verified 2026-05-02 against pg_catalog FK references to tickets:
          //   ticket_items, ecf_queue, queue, washer/seller/cajero_commissions
          // ticket_item_modificadores keys on ticket_item_supabase_id (cascades
          // via FK on ticket_items). ticket_payments table doesn't exist on
          // Supabase — payment splits live in tickets.payment_parts JSON.
          const childTablesBySid = [
            'ticket_items',
            'washer_commissions',
            'seller_commissions',
            'cajero_commissions',
            'inventory_oversells',
            'ecf_queue',
            'queue',
          ]
          for (const t of childTablesBySid) {
            try {
              await supabase.from(t).delete()
                .eq('business_id', bid).in('ticket_supabase_id', tSids)
            } catch (e) { console.error(`[goLiveCommit] ${t} cleanup failed:`, e?.message) }
          }
          // 3) Notas de crédito tied to wiped tickets (Devolución test).
          try {
            await supabase.from('notas_credito').delete()
              .eq('business_id', bid).in('original_ticket_supabase_id', tSids)
          } catch (e) { console.error('[goLiveCommit] notas_credito cleanup failed:', e?.message) }
          // 4) ANECF queue rows for wiped tickets.
          try {
            await supabase.from('anecf_queue').delete()
              .eq('business_id', bid).in('ticket_supabase_id', tSids)
          } catch (e) { console.error('[goLiveCommit] anecf_queue cleanup failed:', e?.message) }
          // 5) Finally delete the tickets themselves.
          throwSupaError(await supabase.from('tickets').delete()
            .eq('business_id', bid).in('supabase_id', tSids))
        }

        // 6) Reset NCF sequences so the first real sale is #1. Per-business
        //    only; never touches other tenants. NCF reclaim during void had
        //    decremented some already, but if Mike voided then re-cobrar'd,
        //    current_number could be > 0. Reset all active types.
        try {
          await supabase.from('ncf_sequences').update({
            current_number: 0,
            updated_at: new Date().toISOString(),
          }).eq('business_id', bid)
        } catch (e) { console.error('[goLiveCommit] ncf reset failed:', e?.message) }

        // 7) Stamp commit time.
        try {
          const stamp = new Date().toISOString()
          await supabase.from('app_settings').upsert({
            business_id: bid,
            key: 'go_live_committed_at',
            value: stamp,
            updated_at: stamp,
          }, { onConflict: 'business_id,key' })
        } catch (e) { console.error('[goLiveCommit] stamp failed:', e?.message) }

        // 8) Audit trail — single critical row so the owner can see when
        //    the cutover ran + what was wiped.
        await logActivity({
          event_type: 'go_live_committed',
          severity: 'critical',
          target_type: 'business', target_id: bid,
          reason: 'Producción activada — datos de prueba eliminados',
          metadata: {
            tickets_wiped: tSids.length,
            ticket_ids: tIds,
          },
        })

        return { ok: true, ticketsWiped: tSids.length }
      }),
    },

    // ── WhatsApp (direct UltraMsg API) ──────────────────────────────────────
    // Reads instance + token from app_settings (synced from desktop).
    // Long-term: move to a server-side proxy to avoid token exposure in browser.

    whatsapp: {
      send: ({ to, body }) => tryOr(async () => {
        const { data: rows } = await supabase.from('app_settings').select('key,value')
          .eq('business_id', bid).in('key', ['whatsapp_instance', 'whatsapp_token'])
        const cfg = Object.fromEntries((rows || []).map(r => [r.key, r.value]))
        if (!cfg.whatsapp_instance || !cfg.whatsapp_token) throw new Error('WhatsApp no configurado')
        const r = await fetch(`https://api.ultramsg.com/${cfg.whatsapp_instance}/messages/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${encodeURIComponent(cfg.whatsapp_token)}&to=${encodeURIComponent(to)}&body=${encodeURIComponent(body)}`,
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok || j?.error) throw new Error(j?.error || `UltraMsg HTTP ${r.status}`)
        return j
      }),

      sendDocument: ({ to, base64, filename, caption }) => tryOr(async () => {
        const { data: rows } = await supabase.from('app_settings').select('key,value')
          .eq('business_id', bid).in('key', ['whatsapp_instance', 'whatsapp_token'])
        const cfg = Object.fromEntries((rows || []).map(r => [r.key, r.value]))
        if (!cfg.whatsapp_instance || !cfg.whatsapp_token) throw new Error('WhatsApp no configurado')
        const r = await fetch(`https://api.ultramsg.com/${cfg.whatsapp_instance}/messages/document`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: [
            `token=${encodeURIComponent(cfg.whatsapp_token)}`,
            `to=${encodeURIComponent(to)}`,
            `filename=${encodeURIComponent(filename || 'recibo.pdf')}`,
            `document=data:application/pdf;base64,${base64}`,
            caption ? `caption=${encodeURIComponent(caption)}` : '',
          ].filter(Boolean).join('&'),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok || j?.error) throw new Error(j?.error || `UltraMsg HTTP ${r.status}`)
        return j
      }),
    },

    // ── Env config ───────────────────────────────────────────────────────────

    env: {
      get: (key) => {
        try {
          // Vite exposes env vars via import.meta.env.VITE_*
          const val = import.meta.env?.['VITE_' + key] || import.meta.env?.[key] || ''
          return Promise.resolve(val)
        } catch {
          return Promise.resolve('')
        }
      },
    },

    // ── Safe storage (localStorage fallback) ─────────────────────────────────

    safe: {
      get: (key) => {
        try {
          return Promise.resolve(localStorage.getItem('tx_safe_' + key) || '')
        } catch {
          return Promise.resolve('')
        }
      },
      set: (key, val) => {
        try {
          localStorage.setItem('tx_safe_' + key, val)
        } catch { /* quota exceeded or private browsing */ }
        return Promise.resolve()
      },
    },

    // ── e-CF offline queue ───────────────────────────────────────────────────

    ecf: {
      queueCount: () => tryOr(async () => {
        const { count } = await supabase.from('ecf_queue')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', bid)
          .gt('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
        return count || 0
      }, 0),
    },

    // ── DGII e-CF signing proxy ─────────────────────────────────────────────
    // Mirrors window.electronAPI.dgii_ecf so ecf.js works transparently on web.
    // Signs e-CFs server-side via /api/ecf-sign (private key never leaves server).

    dgii_ecf: {
      certInfo: () => tryOr(async () => {
        const { data } = await supabase.from('businesses').select('settings').eq('id', bid).single()
        const s = data?.settings || {}
        return {
          installed: !!(s.ecf_private_key_pem && s.ecf_certificate_pem),
          subject: s.ecf_cert_subject || null,
          expiry: s.ecf_cert_expiry || null,
          expired: s.ecf_cert_expired || false,
          environment: s.dgii_environment || 'certecf',
        }
      }, { installed: false }),

      submit: (invoiceData) => tryWrite(async () => {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('No hay sesión activa')
        const body = { ...invoiceData, business_id: bid }
        // FIX-H4 — offline-resilient submit. If we fail to reach the network
        // we enqueue into the IndexedDB-backed offline queue with
        // IndicadorEnvioDiferido=1 metadata and surface a soft-success so
        // the renderer continues with a deferred-pending status. The queue
        // replays on `online` event + every 5 min while the tab is open.
        try {
          const res = await fetch('/api/ecf-sign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify(body),
          })
          const result = await res.json()
          if (!result.ok) throw new Error(result.error || 'Error firmando e-CF')
          return result.data
        } catch (netErr) {
          // Network failure (TypeError from fetch, AbortError from timeout,
          // or "Failed to fetch") is queued for 72h deferred resubmission.
          // Server-side rejections (4xx/5xx with JSON body) still throw.
          const isNetworkErr = (netErr instanceof TypeError)
            || netErr?.name === 'AbortError'
            || /failed to fetch|networkerror|load failed/i.test(String(netErr?.message || ''))
          if (isNetworkErr) {
            try {
              const { enqueue } = await import('@terminal-x/services/offline-ecf-queue')
              await enqueue({
                invoicePayload: body,
                eNCF: invoiceData.eNCF || null,
                ticketId: invoiceData.ticket?.id || null,
                accessToken: session.access_token,
              })
              try { window.dispatchEvent(new CustomEvent('tx:ecf-queue-enqueued', { detail: { eNCF: invoiceData.eNCF } })) } catch {}
              return {
                eNCF: invoiceData.eNCF,
                status: 'EN_PROCESO',
                trackId: `offline-${Date.now()}`,
                submittedAt: new Date().toISOString(),
                qrLink: null,
                _offlineQueued: true,
              }
            } catch (qErr) {
              throw new Error('Sin conexión y no se pudo guardar para reenvío diferido: ' + (qErr?.message || ''))
            }
          }
          throw netErr
        }
      }),

      authTest: () => tryOr(async () => {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('No hay sesión activa')
        const res = await fetch('/api/ecf-sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ business_id: bid, test: true }),
        })
        const result = await res.json()
        return { ok: result.ok, message: result.error || 'Conexión exitosa' }
      }),

      // FIX-C7 — real DGII status check via /api/ecf-sign?action=status.
      // Returns { codigo, estado, mensajes } so the renderer can decide whether
      // to mark the ticket ACEPTADO / RECHAZADO and stop polling.
      checkStatus: (trackId) => tryOr(async () => {
        if (!trackId) return { codigo: 0, estado: 'NO_ENCONTRADO', mensajes: ['Missing trackId'] }
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('No hay sesión activa')
        const res = await fetch('/api/ecf-sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ action: 'status', business_id: bid, trackId }),
        })
        const result = await res.json()
        if (!result.ok) return { codigo: 3, estado: 'EN_PROCESO', mensajes: [result.error || 'Error'] }
        return result.data
      }, { codigo: 3, estado: 'EN_PROCESO', mensajes: [] }),

      // FIX-C7 — bulk reconciler. Pulls every ticket whose ecf_result is
      // EN_PROCESO (or ACEPTADO_CONDICIONAL with no final verdict yet) within
      // the last 14 days, polls DGII per trackId, and patches the ticket row.
      // Idempotent — safe to run on a 5-min timer from InvoiceDashboard.
      // Returns { checked, updated, stillPending }.
      reconcileEnProceso: () => tryOr(async () => {
        const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString()
        const { data: rows } = await supabase
          .from('tickets')
          .select('id, supabase_id, ecf_result, comprobante_type, ncf')
          .eq('business_id', bid)
          .gte('created_at', cutoff)
          .not('ecf_result', 'is', null)
          .neq('status', 'anulado')
          .limit(50)
        const candidates = (rows || []).filter(r => {
          let ecf = r.ecf_result
          if (typeof ecf === 'string') { try { ecf = JSON.parse(ecf) } catch { ecf = null } }
          if (!ecf || !ecf.trackId) return false
          const st = String(ecf.status || '').toUpperCase()
          return st === 'EN_PROCESO' || st === '' || st === 'PENDIENTE'
        })
        let updated = 0, stillPending = 0
        for (const row of candidates) {
          let ecf = row.ecf_result
          if (typeof ecf === 'string') { try { ecf = JSON.parse(ecf) } catch { ecf = {} } }
          // Inline status call — `api` self-reference isn't available inside
          // the factory return literal, so we hit the proxy directly.
          let verdict = null
          try {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session?.access_token) { stillPending++; continue }
            const res = await fetch('/api/ecf-sign', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
              body: JSON.stringify({ action: 'status', business_id: bid, trackId: ecf.trackId }),
            })
            const r = await res.json()
            verdict = r.ok ? r.data : null
          } catch (err) {
            // Most failures here ARE network — but auth/RLS/JSON.parse can
            // masquerade as "network" if we silently swallow. Report at warn
            // so we can spot non-network failure patterns in admin Errores.
            try { window.__txReportError?.(err, { severity: 'warn', category: 'ecf.reconcile_en_proceso', extra: { trackId: ecf?.trackId || null, ticket_id: row?.id || null } }) } catch {}
          }
          if (!verdict) { stillPending++; continue }
          const finalCodes = [1, 2, 4]
          if (finalCodes.includes(Number(verdict.codigo))) {
            const newEcf = { ...ecf, status: verdict.estado, dgiiCodigo: verdict.codigo, reconciledAt: new Date().toISOString() }
            try {
              await supabase.from('tickets').update({ ecf_result: newEcf }).eq('id', row.id).eq('business_id', bid)
              updated++
            } catch (e) { console.warn('[reconcileEnProceso] update failed:', e?.message) }
          } else {
            stillPending++
          }
        }
        return { checked: candidates.length, updated, stillPending }
      }, { checked: 0, updated: 0, stillPending: 0 }),

      // Web-only .p12 installer — uploads the cert to /api/dgii-cert-upload,
      // which parses + stores PEMs in businesses.settings. After this returns
      // ok, certInfo() will report installed: true and submit() works.
      uploadCert: async ({ file, passphrase }) => {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return { ok: false, error: 'No hay sesión activa' }
        const fd = new FormData()
        fd.append('cert', file)
        fd.append('passphrase', passphrase || '')
        fd.append('business_id', bid)
        try {
          const res = await fetch('/api/dgii-cert-upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}` },
            body: fd,
          })
          return await res.json()
        } catch (err) {
          return { ok: false, error: err.message || 'Error de red' }
        }
      },

      // 2026-04-30 — public-ish sandbox demo. Anyone signed in can hit
      // /api/ecf-sign?action=sandbox-try to see what a real e-CF emission
      // response looks like — uses the configured SANDBOX_BUSINESS_ID's
      // cert if installed, otherwise returns a synthetic-but-realistic
      // response clearly marked _demo: true. Rate-limited 10/user/hour.
      sandboxTry: async ({ amount } = {}) => {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return { ok: false, error: 'No hay sesión activa' }
        try {
          const res = await fetch('/api/ecf-sign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ business_id: bid, action: 'sandbox-try', amount: amount ?? 1000 }),
          })
          return await res.json()
        } catch (err) {
          return { ok: false, error: err.message || 'Error de red' }
        }
      },

      // Pre-validate a .p12 + passphrase pair WITHOUT persisting PEMs. UI
      // calls this on passphrase blur so a wrong password produces instant
      // red feedback instead of waiting for the full install. Returns the
      // same shape as uploadCert (subject, expiry, expired) when ok.
      validateCert: async ({ file, passphrase }) => {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return { ok: false, error: 'No hay sesión activa' }
        const fd = new FormData()
        fd.append('cert', file)
        fd.append('passphrase', passphrase || '')
        fd.append('business_id', bid)
        fd.append('validate_only', '1')
        try {
          const res = await fetch('/api/dgii-cert-upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}` },
            body: fd,
          })
          return await res.json()
        } catch (err) {
          return { ok: false, error: err.message || 'Error de red' }
        }
      },

      // Flip env between 'certecf' (Pruebas) and 'ecf' (Producción) — owner only.
      setEnvironment: (env) => tryWrite(async () => {
        if (env !== 'certecf' && env !== 'ecf') throw new Error('Entorno inválido')
        const { data } = await supabase.from('businesses').select('settings').eq('id', bid).single()
        let s = data?.settings
        for (let i = 0; i < 3 && typeof s === 'string'; i++) { try { s = JSON.parse(s) } catch { s = {} } }
        if (!s || typeof s !== 'object') s = {}
        s.dgii_environment = env
        const { error } = await supabase.from('businesses').update({ settings: s }).eq('id', bid)
        if (error) throw error
        // v2.16.28 (B7) — Post-write verify. A 0-row UPDATE (RLS denial,
        // wrong bid in JWT, etc.) returns no `error` from PostgREST but
        // also no row-changed signal. Without this read-back, an admin
        // could click "Producción" and have it silently no-op — the next
        // e-CF would go to Pruebas and DGII would reject. Read the row
        // back and assert the env actually persisted.
        const { data: verify } = await supabase.from('businesses').select('settings').eq('id', bid).single()
        let vs = verify?.settings
        for (let i = 0; i < 3 && typeof vs === 'string'; i++) { try { vs = JSON.parse(vs) } catch { vs = {} } }
        const persisted = (vs && typeof vs === 'object') ? vs.dgii_environment : null
        if (persisted !== env) throw new Error(`DGII env did not persist (wanted ${env}, got ${persisted ?? 'null'}). Check RLS / business_id.`)
        return { ok: true, environment: env }
      }),

      // Persist the fiscal mode picked in CobrarModal so the next ticket
      // defaults to the same family. Accepts 'b_series' | 'ecf' | 'legacy'.
      // Treats anything not 'ecf' as legacy at read time, so 'b_series' and
      // 'legacy' are interchangeable here — we standardize on 'b_series' to
      // match signup/provision.
      setFiscalMode: (mode) => tryWrite(async () => {
        const norm = (mode === 'ecf') ? 'ecf' : 'b_series'
        const { data } = await supabase.from('businesses').select('settings').eq('id', bid).single()
        let s = data?.settings
        for (let i = 0; i < 3 && typeof s === 'string'; i++) { try { s = JSON.parse(s) } catch { s = {} } }
        if (!s || typeof s !== 'object') s = {}
        s.facturacion_mode = norm
        const { error } = await supabase.from('businesses').update({ settings: s }).eq('id', bid)
        if (error) throw error
        return { ok: true, mode: norm }
      }),
    },

    // ── Auto-updater ─────────────────────────────────────────────────────────

    updater: {
      install:  () => Promise.resolve(), // web auto-updates via service worker
      onStatus: () => () => {},          // returns unsubscribe function (no-op)
    },

    // ── Restaurant Mode — Mesas (floor plan) ─────────────────────────────────

    mesas: {
      // v2.16.3 — list now reads the mesas_with_active_total VIEW so each row
      // surfaces its open ticket's running total in `active_ticket_total` for
      // RestaurantPOS idle-card RD$ amounts. The view inherits mesas RLS so
      // anon clients still only see their own business. Falls back to the
      // raw mesas table if the view is missing (older Supabase project).
      list: () => tryOr(async () => {
        const viewRes = await supabase.from('mesas_with_active_total').select('*')
          .eq('business_id', bid).eq('active', true)
          .order('sort_order').order('name')
        if (!viewRes.error) return viewRes.data || []
        // Graceful fallback — view not yet deployed on this Supabase project.
        return throwSupaError(
          await supabase.from('mesas').select('*').eq('business_id', bid).eq('active', true)
            .order('sort_order').order('name')
        )
      }, []),

      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('mesas').insert({
          supabase_id: crypto.randomUUID(),
          name: data.name, zone: data.zone || null,
          capacity: data.capacity != null ? data.capacity : 4,
          status: data.status || 'libre',
          sort_order: data.sort_order || 0,
          active: true,
          business_id: bid,
        }).select('*').single())
        return row
      }, 'web.restaurant.mesas.create'),

      update: (id, data) => tryWrite(async () => {
        const allowed = ['name','zone','capacity','status','waiter_empleado_supabase_id','guests_count','seated_at','sort_order','active','bill_requested_at']
        const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
        if ('active' in patch) patch.active = !!patch.active
        if (!Object.keys(patch).length) {
          return (await supabase.from('mesas').select('*').eq('id', id).eq('business_id', bid).maybeSingle())?.data || null
        }
        return throwSupaError(
          await supabase.from('mesas').update(patch).eq('id', id).eq('business_id', bid).select('*').single()
        )
      }, 'web.restaurant.mesas.update'),

      setStatus: (id, status, opts = {}) => tryWrite(async () => {
        // Fetch seated_at so we stamp only on first transition into 'ocupada'
        const { data: cur } = await supabase.from('mesas')
          .select('seated_at,waiter_empleado_supabase_id,guests_count')
          .eq('id', id).eq('business_id', bid).maybeSingle()
        const patch = { status }
        if (opts.waiter_empleado_supabase_id !== undefined) patch.waiter_empleado_supabase_id = opts.waiter_empleado_supabase_id
        if (opts.guests_count                !== undefined) patch.guests_count                = opts.guests_count
        if (opts.seated_at                   !== undefined) patch.seated_at                   = opts.seated_at
        if (opts.bill_requested_at           !== undefined) patch.bill_requested_at           = opts.bill_requested_at
        if (status === 'ocupada' && !(cur && cur.seated_at)) patch.seated_at = new Date().toISOString()
        // v2.16.3 — auto-clear bill_requested_at on any non-acuenta transition
        // (cobrar→sucia / sucia→libre / etc.) so the amber-card UI doesn't
        // linger. Caller can still explicitly set bill_requested_at via opts
        // to override (e.g., the requestBill() path stamps NOW()).
        if (status !== 'acuenta' && !('bill_requested_at' in patch)) {
          patch.bill_requested_at = null
        }
        return throwSupaError(
          await supabase.from('mesas').update(patch).eq('id', id).eq('business_id', bid).select('*').single()
        )
      }, 'web.restaurant.mesas.setStatus'),

      delete: (id) => tryWrite(async () => {
        // Soft-delete — match services.delete() semantics (LWW-friendly + safe).
        throwSupaError(await supabase.from('mesas').update({ active: false })
          .eq('id', id).eq('business_id', bid))
        return { deleted: true }
      }, 'web.restaurant.mesas.delete'),

      // v2.16.3 — "Pedir cuenta": flip mesa into the amber 'acuenta' state and
      // stamp bill_requested_at = NOW() so the floor-plan card and any
      // future kitchen-display can highlight tables awaiting payment. The
      // existing post-cobro cleanup (mesaSetStatus → 'sucia') auto-clears
      // bill_requested_at via the null-on-transition rule above.
      requestBill: (id) => tryOr(async () => {
        return throwSupaError(
          await supabase.from('mesas')
            .update({ status: 'acuenta', bill_requested_at: new Date().toISOString() })
            .eq('id', id).eq('business_id', bid).select('*').single()
        )
      }),
    },

    // ── Restaurant Mode — Reservas (front-of-house) ──────────────────────────
    // v2.16.3 H4. Distinct from the dealership `vehicleReservations` namespace
    // (which lives elsewhere in this file). Reservation lifecycle:
    //   pendiente → confirmada → sentada    (happy path)
    //              ↘ cancelada  ↘ no_show   (degenerate paths)
    // Manager auth not required — front-of-house can self-manage. activity_log
    // emits info-severity rows for each transition.

    restaurantReservations: {
      list: ({ date, status, dateFrom, dateTo } = {}) => tryOr(async () => {
        let q = supabase.from('restaurant_reservations').select('*').eq('business_id', bid)
        if (date)     q = q.eq('fecha', date)
        if (dateFrom) q = q.gte('fecha', dateFrom)
        if (dateTo)   q = q.lte('fecha', dateTo)
        if (status && status !== 'all') q = q.eq('status', status)
        q = q.order('fecha', { ascending: true }).order('hora', { ascending: true })
        return throwSupaError(await q) || []
      }, []),

      create: (data) => tryWrite(async () => {
        const sid = crypto.randomUUID()
        // v2.16.26 — DO NOT REVERT (FIX-LEDGER §Batch6). Deposit fields persist
        // now that columns landed in Batch 5.
        const row = throwSupaError(await supabase.from('restaurant_reservations').insert({
          supabase_id:      sid,
          business_id:      bid,
          mesa_id:          data.mesa_id || null,
          mesa_supabase_id: data.mesa_supabase_id || null,
          fecha:            data.fecha,
          hora:             data.hora,
          duration_min:     Number(data.duration_min || 90),
          nombre:           String(data.nombre || '').trim(),
          telefono:         data.telefono ? String(data.telefono).trim() : null,
          guests:           Math.max(1, Number(data.guests || 2)),
          notas:            data.notas || null,
          status:           data.status || 'pendiente',
          deposit_amount:   data.deposit_amount != null ? Number(data.deposit_amount) : null,
          deposit_status:   data.deposit_status || null,
          deposit_ticket_supabase_id: data.deposit_ticket_supabase_id || null,
        }).select('*').single())
        await logActivity({
          event_type: 'reservation_created', severity: 'info',
          target_type: 'reservation', target_id: row.id, target_name: row.nombre,
          metadata: { fecha: row.fecha, hora: row.hora, guests: row.guests, mesa_id: row.mesa_id },
        })
        return row
      }, 'web.restaurant.reservations.create'),

      update: (id, data) => tryWrite(async () => {
        const allowed = ['mesa_id','mesa_supabase_id','fecha','hora','duration_min','nombre','telefono','guests','notas','status','whatsapp_sent_at','cancelled_reason','seated_ticket_supabase_id','deposit_amount','deposit_status','deposit_ticket_supabase_id']
        const patch = Object.fromEntries(Object.entries(data || {}).filter(([k]) => allowed.includes(k)))
        if (!Object.keys(patch).length) {
          return (await supabase.from('restaurant_reservations').select('*').eq('id', id).eq('business_id', bid).maybeSingle())?.data || null
        }
        return throwSupaError(
          await supabase.from('restaurant_reservations').update(patch).eq('id', id).eq('business_id', bid).select('*').single()
        )
      }, 'web.restaurant.reservations.update'),

      confirm: (id) => tryWrite(async () => {
        const row = throwSupaError(
          await supabase.from('restaurant_reservations').update({ status: 'confirmada' })
            .eq('id', id).eq('business_id', bid).select('*').single()
        )
        await logActivity({
          event_type: 'reservation_confirmed', severity: 'info',
          target_type: 'reservation', target_id: row.id, target_name: row.nombre,
          metadata: { fecha: row.fecha, hora: row.hora, guests: row.guests },
        })
        return row
      }, 'web.restaurant.reservations.confirm'),

      cancel: (id, reason) => tryWrite(async () => {
        const row = throwSupaError(
          await supabase.from('restaurant_reservations').update({
            status: 'cancelada',
            cancelled_reason: reason || null,
          }).eq('id', id).eq('business_id', bid).select('*').single()
        )
        await logActivity({
          event_type: 'reservation_cancelled', severity: 'warn',
          target_type: 'reservation', target_id: row.id, target_name: row.nombre,
          reason: reason || null,
          metadata: { fecha: row.fecha, hora: row.hora },
        })
        return row
      }, 'web.restaurant.reservations.cancel'),

      markNoShow: (id) => tryWrite(async () => {
        const row = throwSupaError(
          await supabase.from('restaurant_reservations').update({ status: 'no_show' })
            .eq('id', id).eq('business_id', bid).select('*').single()
        )
        await logActivity({
          event_type: 'reservation_no_show', severity: 'warn',
          target_type: 'reservation', target_id: row.id, target_name: row.nombre,
          metadata: { fecha: row.fecha, hora: row.hora, guests: row.guests },
        })
        return row
      }, 'web.restaurant.reservations.markNoShow'),

      // Mark as 'sentada' and (best-effort) flip the assigned mesa to 'ocupada'.
      // Caller is expected to follow-up by opening the POS for the new mesa.
      seat: (id, mesaId) => tryWrite(async () => {
        let mesaSid = null
        if (mesaId) {
          const { data: m } = await supabase.from('mesas').select('id, supabase_id, name')
            .eq('id', mesaId).eq('business_id', bid).maybeSingle()
          if (!m) throw new Error('Mesa no encontrada')
          mesaSid = m.supabase_id
          // Flip the mesa to ocupada with the reservation's guest count.
          const { data: res } = await supabase.from('restaurant_reservations')
            .select('guests, nombre').eq('id', id).eq('business_id', bid).maybeSingle()
          await supabase.from('mesas').update({
            status: 'ocupada',
            guests_count: res?.guests || null,
            seated_at: new Date().toISOString(),
            bill_requested_at: null,
          }).eq('id', mesaId).eq('business_id', bid)
        }
        const patch = { status: 'sentada' }
        if (mesaId)  patch.mesa_id = mesaId
        if (mesaSid) patch.mesa_supabase_id = mesaSid
        const row = throwSupaError(
          await supabase.from('restaurant_reservations').update(patch)
            .eq('id', id).eq('business_id', bid).select('*').single()
        )
        await logActivity({
          event_type: 'reservation_seated', severity: 'info',
          target_type: 'reservation', target_id: row.id, target_name: row.nombre,
          metadata: { fecha: row.fecha, hora: row.hora, mesa_id: mesaId },
        })
        return row
      }, 'web.restaurant.reservations.seat'),

      stampWhatsapp: (id) => tryWrite(async () => {
        return throwSupaError(
          await supabase.from('restaurant_reservations')
            .update({ whatsapp_sent_at: new Date().toISOString() })
            .eq('id', id).eq('business_id', bid).select('*').single()
        )
      }, 'web.restaurant.reservations.stampWhatsapp'),
    },

    // ── Restaurant Mode — Modificadores (menu add-ons) ───────────────────────

    modificadores: {
      list: () => tryOr(async () => {
        return throwSupaError(
          await supabase.from('modificadores').select('*').eq('business_id', bid).eq('active', true)
            .order('group_name').order('sort_order').order('name')
        )
      }, []),

      listAll: () => tryOr(async () => {
        return throwSupaError(
          await supabase.from('modificadores').select('*').eq('business_id', bid)
            .order('group_name').order('sort_order').order('name')
        )
      }, []),

      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('modificadores').insert({
          supabase_id: crypto.randomUUID(),
          name: data.name, group_name: data.group_name || null,
          price_delta: Number(data.price_delta || 0),
          min_select: data.min_select != null ? data.min_select : 0,
          max_select: data.max_select != null ? data.max_select : 1,
          default_selected: !!data.default_selected,
          sort_order: data.sort_order || 0,
          active: true,
          business_id: bid,
        }).select('*').single())
        return row
      }, 'web.restaurant.modificadores.create'),

      update: (id, data) => tryWrite(async () => {
        const allowed = ['name','group_name','price_delta','min_select','max_select','default_selected','sort_order','active']
        const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
        if ('default_selected' in patch) patch.default_selected = !!patch.default_selected
        if ('active' in patch)           patch.active           = !!patch.active
        if ('price_delta' in patch)      patch.price_delta      = Number(patch.price_delta || 0)
        if (!Object.keys(patch).length) {
          return (await supabase.from('modificadores').select('*').eq('id', id).eq('business_id', bid).maybeSingle())?.data || null
        }
        return throwSupaError(
          await supabase.from('modificadores').update(patch).eq('id', id).eq('business_id', bid).select('*').single()
        )
      }, 'web.restaurant.modificadores.update'),

      delete: (id) => tryWrite(async () => {
        throwSupaError(await supabase.from('modificadores').update({ active: false })
          .eq('id', id).eq('business_id', bid))
        return { deleted: true }
      }, 'web.restaurant.modificadores.delete'),

      listForService: (serviceSupabaseId) => tryOr(async () => {
        // Two-step — service_modificadores stores supabase_id FKs, no SQL join
        // is possible via the JS client. Empty ids short-circuits to [].
        const { data: links } = await supabase.from('service_modificadores')
          .select('modificador_supabase_id,is_required')
          .eq('business_id', bid).eq('service_supabase_id', serviceSupabaseId)
        const ids = (links || []).map(l => l.modificador_supabase_id).filter(Boolean)
        if (ids.length === 0) return []
        const { data: mods } = await supabase.from('modificadores').select('*')
          .eq('business_id', bid).eq('active', true).in('supabase_id', ids)
          .order('group_name').order('sort_order').order('name')
        const reqMap = Object.fromEntries((links || []).map(l => [l.modificador_supabase_id, !!l.is_required]))
        return (mods || []).map(m => ({ ...m, is_required: !!reqMap[m.supabase_id] }))
      }, []),

      attachToService: (serviceSupabaseId, modificadorSupabaseId, isRequired = 0) => tryWrite(async () => {
        throwSupaError(await supabase.from('service_modificadores').insert({
          supabase_id: crypto.randomUUID(),
          service_supabase_id: serviceSupabaseId,
          modificador_supabase_id: modificadorSupabaseId,
          is_required: !!isRequired,
          business_id: bid,
        }))
      }, 'web.restaurant.service_mods.attachToService'),

      detachFromService: (serviceSupabaseId, modificadorSupabaseId) => tryWrite(async () => {
        throwSupaError(await supabase.from('service_modificadores').delete()
          .eq('business_id', bid)
          .eq('service_supabase_id', serviceSupabaseId)
          .eq('modificador_supabase_id', modificadorSupabaseId))
      }, 'web.restaurant.service_mods.detachFromService'),
    },

    // ── Restaurant Mode — Service recipes (Bill-of-Materials, v2.16.3) ─────
    // Polymorphic listForService: accepts either a numeric id (services.id)
    // or a UUID supabase_id. service_recipe_items only stores supabase_id, so
    // numeric path resolves via a quick services lookup. Returns rows joined
    // with inventory_items (name + unit + sku) for the MenuBuilder UI.
    recipeItems: {
      listForService: (serviceKey) => tryOr(async () => {
        if (serviceKey == null || serviceKey === '') return []
        const _UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        let svcSid = null
        if (typeof serviceKey === 'string' && _UUID_RX.test(serviceKey)) {
          svcSid = serviceKey
        } else {
          const { data: svcRow } = await supabase.from('services')
            .select('supabase_id').eq('id', Number(serviceKey)).eq('business_id', bid).maybeSingle()
          svcSid = svcRow?.supabase_id || null
        }
        if (!svcSid) return []
        const { data: rows } = await supabase.from('service_recipe_items')
          .select('id,supabase_id,business_id,service_supabase_id,inventory_item_supabase_id,qty_per_unit,created_at,updated_at')
          .eq('business_id', bid).eq('service_supabase_id', svcSid)
        const list = rows || []
        if (!list.length) return []
        const invSids = [...new Set(list.map(r => r.inventory_item_supabase_id).filter(Boolean))]
        const { data: invs } = await supabase.from('inventory_items')
          .select('id,supabase_id,name,sku,unit,quantity').eq('business_id', bid).in('supabase_id', invSids)
        const invBySid = Object.fromEntries((invs || []).map(i => [i.supabase_id, i]))
        return list.map(r => {
          const inv = invBySid[r.inventory_item_supabase_id] || null
          return {
            ...r,
            inventory_item_id:        inv?.id || null,
            inventory_item_name:      inv?.name || null,
            inventory_item_sku:       inv?.sku || null,
            inventory_item_unit:      inv?.unit || null,
            inventory_item_quantity:  inv?.quantity || 0,
          }
        }).sort((a, b) => (a.inventory_item_name || '').localeCompare(b.inventory_item_name || ''))
      }, []),

      add: ({ service_supabase_id, inventory_item_supabase_id, qty_per_unit } = {}) => tryWrite(async () => {
        if (!service_supabase_id || !inventory_item_supabase_id) {
          throw new Error('recipeItems.add: service_supabase_id + inventory_item_supabase_id required')
        }
        const sid = crypto.randomUUID()
        const row = throwSupaError(await supabase.from('service_recipe_items').insert({
          supabase_id: sid,
          business_id: bid,
          service_supabase_id,
          inventory_item_supabase_id,
          qty_per_unit: Number(qty_per_unit) || 0,
        }).select('id,supabase_id').single())
        return { id: row.id, supabase_id: row.supabase_id }
      }, 'web.restaurant.recipes.add'),

      update: (id, qty_per_unit) => tryWrite(async () => {
        throwSupaError(await supabase.from('service_recipe_items')
          .update({ qty_per_unit: Number(qty_per_unit) || 0 })
          .eq('id', id).eq('business_id', bid))
      }, 'web.restaurant.recipes.update'),

      remove: (id) => tryOr(async () => {
        throwSupaError(await supabase.from('service_recipe_items')
          .delete().eq('id', id).eq('business_id', bid))
        return { deleted: true }
      }),
    },

    // ── Ofertas (product bundles, v2.16.x) ───────────────────────────────────
    // Mirrors desktop ofertas helpers. Components can reference EITHER a
    // service (services.in_stock=0 ⇒ out of stock) OR an inventory_item
    // (quantity / qty floored). oferta_available = floor(min(per-component)).
    ofertas: {
      list: ({ activeOnly = false } = {}) => tryOr(async () => {
        let q = supabase.from('ofertas').select('*').eq('business_id', bid)
        if (activeOnly) q = q.eq('active', true)
        const ofertas = throwSupaError(await q.order('active', { ascending: false }).order('name'))
        if (!ofertas.length) return []
        const sids = ofertas.map(o => o.supabase_id).filter(Boolean)
        const items = sids.length ? throwSupaError(
          await supabase.from('oferta_items').select('*')
            .eq('business_id', bid).in('oferta_supabase_id', sids)
        ) : []
        // Pre-fetch component details.
        const svcSids = [...new Set(items.map(i => i.service_supabase_id).filter(Boolean))]
        const invSids = [...new Set(items.map(i => i.inventory_item_supabase_id).filter(Boolean))]
        const svcMap = {}
        if (svcSids.length) {
          const { data: svcs } = await supabase.from('services')
            .select('id,supabase_id,name,price,cost,in_stock,aplica_itbis').eq('business_id', bid).in('supabase_id', svcSids)
          for (const s of (svcs || [])) svcMap[s.supabase_id] = s
        }
        const invMap = {}
        if (invSids.length) {
          const { data: invs } = await supabase.from('inventory_items')
            .select('id,supabase_id,name,sku,unit,quantity,price,cost,aplica_itbis').eq('business_id', bid).in('supabase_id', invSids)
          for (const i of (invs || [])) invMap[i.supabase_id] = i
        }
        const itemsByOferta = {}
        for (const it of items) {
          const arr = itemsByOferta[it.oferta_supabase_id] || (itemsByOferta[it.oferta_supabase_id] = [])
          arr.push(it)
        }
        const compAvail = (it) => {
          const need = Number(it.qty || 1) || 1
          if (need <= 0) return Infinity
          if (it.service_supabase_id) {
            const s = svcMap[it.service_supabase_id]
            if (!s) return 0
            if (s.in_stock === false || s.in_stock === 0) return 0
            return Infinity
          }
          if (it.inventory_item_supabase_id) {
            const i = invMap[it.inventory_item_supabase_id]
            if (!i) return 0
            return Math.floor(Number(i.quantity || 0) / need)
          }
          return 0
        }
        return ofertas.map(o => {
          const its = itemsByOferta[o.supabase_id] || []
          let min = Infinity
          for (const it of its) { const a = compAvail(it); if (a < min) min = a }
          const avail = its.length === 0 ? 0 : (Number.isFinite(min) ? Math.floor(min) : 0)
          // Hydrate component details so POS can render savings + addOfertaToCart
          // can iterate o.items. Without this, list() returns ofertas with no
          // items array → POS throws "Oferta sin componentes" on tile click.
          const enriched = its.map(it => {
            if (it.service_supabase_id) {
              const s = svcMap[it.service_supabase_id] || {}
              return {
                ...it,
                service_id: s.id || null,
                name: s.name || '',
                base_price: Number(s.price || 0),
                cost: Number(s.cost || 0),
                aplica_itbis: s.aplica_itbis ?? 1,
                available_units: (s.in_stock === false || s.in_stock === 0) ? 0 : Infinity,
              }
            }
            const i = invMap[it.inventory_item_supabase_id] || {}
            return {
              ...it,
              inventory_item_id: i.id || null,
              sku: i.sku || '',
              name: i.name || '',
              base_price: Number(i.price || 0),
              cost: Number(i.cost || 0),
              aplica_itbis: i.aplica_itbis ?? 1,
              available_units: Number(i.quantity || 0),
            }
          })
          return { ...o, items: enriched, components_count: its.length, oferta_available: avail }
        })
      }, []),

      get: (supabase_id) => tryOr(async () => {
        if (!supabase_id) return null
        const { data: o } = await supabase.from('ofertas').select('*')
          .eq('business_id', bid).eq('supabase_id', supabase_id).maybeSingle()
        if (!o) return null
        const items = throwSupaError(
          await supabase.from('oferta_items').select('*')
            .eq('business_id', bid).eq('oferta_supabase_id', supabase_id).order('id')
        ) || []
        const svcSids = [...new Set(items.map(i => i.service_supabase_id).filter(Boolean))]
        const invSids = [...new Set(items.map(i => i.inventory_item_supabase_id).filter(Boolean))]
        const svcMap = {}, invMap = {}
        if (svcSids.length) {
          const { data: svcs } = await supabase.from('services')
            .select('supabase_id,name,price,in_stock').eq('business_id', bid).in('supabase_id', svcSids)
          for (const s of (svcs || [])) svcMap[s.supabase_id] = s
        }
        if (invSids.length) {
          const { data: invs } = await supabase.from('inventory_items')
            .select('supabase_id,name,sku,unit,quantity,price').eq('business_id', bid).in('supabase_id', invSids)
          for (const i of (invs || [])) invMap[i.supabase_id] = i
        }
        let min = Infinity
        const enriched = items.map(it => {
          const need = Number(it.qty || 1) || 1
          let kind = null, name = null, price = null, qty_avail = null, unit = null, available_units = null
          if (it.service_supabase_id) {
            const s = svcMap[it.service_supabase_id]
            kind = 'service'; name = s?.name || null; price = s?.price != null ? Number(s.price) : null
            qty_avail = (s && (s.in_stock === false || s.in_stock === 0)) ? 0 : null
            available_units = (s && (s.in_stock === false || s.in_stock === 0)) ? 0 : null
          } else if (it.inventory_item_supabase_id) {
            const i = invMap[it.inventory_item_supabase_id]
            kind = 'inventory_item'; name = i?.name || null; price = i?.price != null ? Number(i.price) : null
            qty_avail = i?.quantity != null ? Number(i.quantity) : 0
            unit = i?.unit || null
            available_units = i ? Math.floor(Number(i.quantity || 0) / need) : 0
          }
          const compA = available_units == null ? Infinity : available_units
          if (compA < min) min = compA
          return {
            ...it,
            component_kind: kind,
            component_name: name,
            component_price: price,
            component_quantity: qty_avail,
            component_unit: unit,
            available_units,
          }
        })
        const avail = items.length === 0 ? 0 : (Number.isFinite(min) ? Math.floor(min) : 0)
        return { ...o, items: enriched, oferta_available: avail }
      }, null),

      upsert: (data = {}) => tryWrite(async () => {
        if (!data.name || data.price == null) {
          throw new Error('ofertas.upsert: name + price required')
        }
        const items = Array.isArray(data.items) ? data.items : []
        const sid = data.supabase_id || crypto.randomUUID()
        const { data: existing } = await supabase.from('ofertas').select('supabase_id')
          .eq('business_id', bid).eq('supabase_id', sid).maybeSingle()
        const isNew = !existing

        const payload = {
          supabase_id: sid,
          business_id: bid,
          name: data.name,
          description: data.description || null,
          price: Number(data.price) || 0,
          active: data.active === false || data.active === 0 ? false : true,
          starts_at: data.starts_at || null,
          ends_at: data.ends_at || null,
          updated_at: new Date().toISOString(),
        }
        if (isNew) {
          throwSupaError(await supabase.from('ofertas').insert(payload).select('supabase_id').single())
        } else {
          throwSupaError(await supabase.from('ofertas').update(payload)
            .eq('business_id', bid).eq('supabase_id', sid))
        }

        // Replace components
        throwSupaError(await supabase.from('oferta_items').delete()
          .eq('business_id', bid).eq('oferta_supabase_id', sid))
        const rows = []
        for (const it of items) {
          const svc = it.service_supabase_id || null
          const inv = it.inventory_item_supabase_id || null
          if (!svc && !inv) continue
          rows.push({
            supabase_id: it.supabase_id || crypto.randomUUID(),
            business_id: bid,
            oferta_supabase_id: sid,
            service_supabase_id: svc ? svc : null,
            inventory_item_supabase_id: svc ? null : inv,
            qty: Number(it.qty) || 1,
          })
        }
        if (rows.length) {
          throwSupaError(await supabase.from('oferta_items').insert(rows))
        }

        try {
          await supabase.from('activity_log').insert({
            supabase_id: crypto.randomUUID(),
            business_id: bid,
            event_type: isNew ? 'oferta_create' : 'oferta_update',
            severity: 'info',
            target_type: 'oferta',
            target_id: sid,
            target_name: data.name,
            amount: Number(data.price) || 0,
            metadata: { components: items.length },
          })
        } catch (err) {
          try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'warn', category: 'web.ofertas.save.activity_log', extra: { oferta_supabase_id: sid, isNew, name: data?.name } }) } catch {}
        }

        return { supabase_id: sid }
      }),

      delete: (supabase_id) => tryOr(async () => {
        if (!supabase_id) return { deleted: false }
        throwSupaError(await supabase.from('oferta_items').delete()
          .eq('business_id', bid).eq('oferta_supabase_id', supabase_id))
        const { data: o } = await supabase.from('ofertas').select('name')
          .eq('business_id', bid).eq('supabase_id', supabase_id).maybeSingle()
        throwSupaError(await supabase.from('ofertas').delete()
          .eq('business_id', bid).eq('supabase_id', supabase_id))
        try {
          await supabase.from('activity_log').insert({
            supabase_id: crypto.randomUUID(),
            business_id: bid,
            event_type: 'oferta_delete',
            severity: 'info',
            target_type: 'oferta',
            target_id: supabase_id,
            target_name: o?.name || null,
          })
        } catch (err) {
          try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'warn', category: 'web.ofertas.delete.activity_log', extra: { oferta_supabase_id: supabase_id, name: o?.name || null } }) } catch {}
        }
        return { deleted: true }
      }),
    },

    // ── Restaurant Mode — KDS (kitchen display) ──────────────────────────────

    kds: {
      listActive: () => tryOr(async () => {
        return throwSupaError(
          await supabase.from('kds_events').select('*')
            .eq('business_id', bid).in('status', ['fired','in_progress','ready'])
            .order('fired_at', { ascending: false })
        )
      }, []),

      fire: (data) => tryWrite(async () => {
        // Resolve ticket_item_supabase_id the same way desktop does, so the
        // FK stays intact even when the caller only hands us the integer id.
        let tiSid = data.ticket_item_supabase_id || null
        if (!tiSid && data.ticket_item_id) {
          const { data: ti } = await supabase.from('ticket_items').select('supabase_id')
            .eq('id', data.ticket_item_id).eq('business_id', bid).maybeSingle()
          tiSid = ti?.supabase_id || null
        }
        if (!tiSid) throw new Error('kds.fire: ticket_item_supabase_id required (NOT NULL FK)')
        const firedAt = new Date().toISOString()
        const row = throwSupaError(await supabase.from('kds_events').insert({
          supabase_id: crypto.randomUUID(),
          ticket_item_supabase_id: tiSid,
          mesa_supabase_id: data.mesa_supabase_id || null,
          station: data.station || null,
          status: 'fired',
          fired_at: firedAt,
          business_id: bid,
        }).select('*').single())
        // Stamp ticket_items.kds_fired_at so KDS aging + recall stay coherent.
        try {
          await supabase.from('ticket_items').update({ kds_fired_at: firedAt })
            .eq('supabase_id', tiSid).eq('business_id', bid).is('kds_fired_at', null)
        } catch (e) { console.warn('[web.js] kds.fire stamp kds_fired_at failed', e?.message) }
        return row
      }),

      setStatus: (id, status) => tryOr(async () => {
        const patch = { status }
        const now = new Date().toISOString()
        if (status === 'in_progress') patch.started_at = now
        if (status === 'ready')       patch.ready_at   = now
        if (status === 'bumped')      patch.bumped_at  = now
        return throwSupaError(
          await supabase.from('kds_events').update(patch).eq('id', id).eq('business_id', bid).select('*').single()
        )
      }),

      // v2.16.25 — DO NOT REVERT (FIX-LEDGER §Batch5). Recall fired-to-kitchen
      // item: cancels the kds_events row + clears ticket_items.kds_fired_at so
      // the line can be voided cleanly. Required ManagerAuthGate at UI; this
      // RPC stays auth-agnostic.
      cancel: ({ ticket_item_supabase_id, station, reason } = {}) => tryOr(async () => {
        if (!ticket_item_supabase_id) throw new Error('ticket_item_supabase_id required')
        const sel = supabase.from('kds_events').select('id').eq('business_id', bid)
          .eq('ticket_item_supabase_id', ticket_item_supabase_id)
          .in('status', ['fired','in_progress','ready'])
        const q = station ? sel.eq('station', station) : sel
        const { data: rows } = await q
        const ids = (rows || []).map(r => r.id)
        if (ids.length) {
          await supabase.from('kds_events').update({
            status: 'cancelled', cancelled_at: new Date().toISOString(),
          }).in('id', ids).eq('business_id', bid)
        }
        await supabase.from('ticket_items').update({ kds_fired_at: null })
          .eq('supabase_id', ticket_item_supabase_id).eq('business_id', bid)
        await logActivity({
          event_type: 'kds_item_recalled', severity: 'warn',
          target_type: 'ticket_item', target_id: ticket_item_supabase_id,
          reason: reason || 'Manager-authorized recall',
          metadata: { kds_events_cancelled: ids.length, station: station || null },
        })
        return { ok: true, cancelled: ids.length }
      }),
    },

    // ── Restaurant Mode — Ticket-item modifier snapshots ─────────────────────

    restaurant: {
      itemModificadores: {
        list: (ticketItemSupabaseId) => tryOr(async () => {
          return throwSupaError(
            await supabase.from('ticket_item_modificadores').select('*')
              .eq('business_id', bid).eq('ticket_item_supabase_id', ticketItemSupabaseId)
              .order('id')
          )
        }, []),

        snapshot: (ticketItemSupabaseId, _ticketItemId, selections) => tryOr(async () => {
          if (!Array.isArray(selections) || selections.length === 0) return
          const rows = selections.map(s => ({
            supabase_id: crypto.randomUUID(),
            ticket_item_supabase_id: ticketItemSupabaseId,
            modificador_supabase_id: s.modificador_supabase_id || null,
            name_snapshot: s.name_snapshot,
            price_delta_snapshot: Number(s.price_delta_snapshot || 0),
            business_id: bid,
          }))
          throwSupaError(await supabase.from('ticket_item_modificadores').insert(rows))
        }),
      },
    },

    // ── Restaurant Mode — Realtime subscriptions ─────────────────────────────

    subscribeMesas: (callback) => {
      const channel = supabase.channel('mesa-changes')
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'mesas',
          filter: `business_id=eq.${bid}`,
        }, (payload) => callback(payload))
        .subscribe()
      return () => supabase.removeChannel(channel)
    },

    subscribeKdsEvents: (callback) => {
      const channel = supabase.channel('kds-changes')
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'kds_events',
          filter: `business_id=eq.${bid}`,
        }, (payload) => callback(payload))
        .subscribe()
      return () => supabase.removeChannel(channel)
    },

    // ── Vehicles ──────────────────────────────────────────────────────────────

    vehicles: {
      list: () => tryOr(async () => {
        // Embedded `clients(name)` join requires a discoverable FK between
        // vehicles.client_id and clients.id, which doesn't exist on Supabase
        // (FK refs business_id only). Fetch separately + merge instead.
        const rows = throwSupaError(await supabase.from('vehicles').select('*').eq('business_id', bid).order('created_at', { ascending: false }))
        const sids = [...new Set((rows || []).map(r => r.client_supabase_id).filter(Boolean))]
        let cmap = {}
        if (sids.length) { const { data: cs } = await supabase.from('clients').select('supabase_id, name').eq('business_id', bid).in('supabase_id', sids); for (const c of (cs || [])) cmap[c.supabase_id] = c }
        return (rows || []).map(r => ({ ...r, clients: cmap[r.client_supabase_id] ? { name: cmap[r.client_supabase_id].name } : null }))
      }, []),
      getById: (id) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('vehicles').select('*').eq('id', id).eq('business_id', bid).single())
        if (row?.client_supabase_id) {
          const { data: c } = await supabase.from('clients').select('name').eq('supabase_id', row.client_supabase_id).maybeSingle()
          if (c) row.clients = { name: c.name }
        }
        return row
      }),
      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('vehicles').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id').single())
        return row
      }),
      update: (id, data) => tryWrite(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('vehicles').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      delete: (id) => tryWrite(async () => { throwSupaError(await supabase.from('vehicles').update({ active: false }).eq('id', id).eq('business_id', bid)) }),
      byClient: (clientId) => tryOr(async () => throwSupaError(await supabase.from('vehicles').select('*').eq('business_id', bid).eq('client_id', clientId).eq('active', true).order('created_at', { ascending: false })), []),
    },

    // ── Service Bays ────────────────────────────────────────────────────────

    serviceBays: {
      list: () => tryOr(async () => throwSupaError(await supabase.from('service_bays').select('*').eq('business_id', bid).eq('active', true).order('name')), []),
      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('service_bays').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id').single())
        return row
      }),
      update: (id, data) => tryWrite(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('service_bays').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      setStatus: (id, status, workOrderId) => tryWrite(async () => { throwSupaError(await supabase.from('service_bays').update({ status, current_work_order_id: workOrderId || null, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)) }),
      delete: (id) => tryWrite(async () => { throwSupaError(await supabase.from('service_bays').update({ active: false }).eq('id', id).eq('business_id', bid)) }),
    },

    // ── Work Orders ─────────────────────────────────────────────────────────

    workOrders: {
      list: (params) => tryOr(async () => {
        let q = supabase.from('work_orders').select('*').eq('business_id', bid)
        if (params?.status) q = q.eq('status', params.status)
        const rows = throwSupaError(await q.order('created_at', { ascending: false })) || []
        await attachRel(supabase, rows, { fkCol: 'vehicle_supabase_id', targetTable: 'vehicles', selectCols: 'plate,make,model,odometer_km', asKey: 'vehicles', businessId: bid })
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name', asKey: 'clients', businessId: bid })
        await attachRel(supabase, rows, { fkCol: 'technician_empleado_supabase_id', targetTable: 'empleados', selectCols: 'nombre', asKey: 'empleados', businessId: bid })
        // work_order_items: fetch by work_order_supabase_id
        const woSids = [...new Set(rows.map(r => r.supabase_id).filter(Boolean))]
        let itemsByWo = {}
        if (woSids.length) {
          const { data: items } = await supabase.from('work_order_items').select('*').eq('business_id', bid).in('work_order_supabase_id', woSids)
          for (const it of (items || [])) {
            const k = it.work_order_supabase_id
            ;(itemsByWo[k] = itemsByWo[k] || []).push(it)
          }
        }
        return rows.map(r => ({
          ...r,
          plate: r.vehicles?.plate || null,
          make: r.vehicles?.make || null,
          model: r.vehicles?.model || null,
          client_name: r.clients?.name || null,
          technician_name: r.empleados?.nombre || null,
          work_order_items: itemsByWo[r.supabase_id] || [],
          items: (itemsByWo[r.supabase_id] || []).map(it => ({ ...it, qty: it.quantity })),
        }))
      }, []),
      getById: (id) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('work_orders').select('*').eq('id', id).eq('business_id', bid).single())
        if (!row) return null
        await attachRel(supabase, [row], { fkCol: 'vehicle_supabase_id', targetTable: 'vehicles', selectCols: 'plate,make,model,vin,year,color,odometer_km', asKey: 'vehicles', businessId: bid })
        await attachRel(supabase, [row], { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name,phone,rnc', asKey: 'clients', businessId: bid })
        const { data: items } = await supabase.from('work_order_items').select('*').eq('business_id', bid).eq('work_order_supabase_id', row.supabase_id || '__none__')
        row.work_order_items = items || []
        return row
      }),
      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('work_orders').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }).select('id').single())
        return row
      }),
      update: (id, data) => tryWrite(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('work_orders').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      updateStatus: ({ id, status }) => tryWrite(async () => {
        const patch = { status, updated_at: new Date().toISOString() }
        if (status === 'completed' || status === 'closed' || status === 'facturado') patch.completed_date = new Date().toISOString()
        throwSupaError(await supabase.from('work_orders').update(patch).eq('id', id).eq('business_id', bid))
      }),
      setStatus: (id, status) => tryWrite(async () => {
        const patch = { status, updated_at: new Date().toISOString() }
        if (status === 'completed' || status === 'closed') patch.completed_date = new Date().toISOString()
        throwSupaError(await supabase.from('work_orders').update(patch).eq('id', id).eq('business_id', bid))
      }),
      addItem: ({ work_order_id, type, name, qty, quantity, unit_price, description, warranty_months, inventory_item_id }) => tryWrite(async () => {
        const q = Number(quantity ?? qty ?? 1)
        const p = Number(unit_price) || 0
        const { data: parent } = await supabase.from('work_orders').select('supabase_id').eq('id', work_order_id).eq('business_id', bid).single()
        let invSid = null
        if (inventory_item_id) {
          const { data: inv } = await supabase.from('inventory_items').select('supabase_id').eq('id', inventory_item_id).eq('business_id', bid).single()
          invSid = inv?.supabase_id || null
        }
        const row = throwSupaError(await supabase.from('work_order_items').insert({
          supabase_id: crypto.randomUUID(), business_id: bid,
          work_order_id, work_order_supabase_id: parent?.supabase_id || null,
          type: type || 'labor', name, description: description || null,
          quantity: q, unit_price: p, total: q * p, warranty_months: Number(warranty_months) || 0,
          inventory_item_id: inventory_item_id || null, inventory_item_supabase_id: invSid,
        }).select('id').single())
        await recalcWorkOrderTotalsWeb(supabase, bid, work_order_id)
        return row
      }),
      updateItem: ({ item_id, ...rest }) => tryWrite(async () => {
        const patch = { ...rest, updated_at: new Date().toISOString() }
        if (rest.quantity !== undefined || rest.unit_price !== undefined) {
          const { data: cur } = await supabase.from('work_order_items').select('quantity,unit_price,work_order_id').eq('id', item_id).eq('business_id', bid).single()
          const q = rest.quantity !== undefined ? Number(rest.quantity) : Number(cur.quantity)
          const p = rest.unit_price !== undefined ? Number(rest.unit_price) : Number(cur.unit_price)
          patch.total = q * p
          throwSupaError(await supabase.from('work_order_items').update(patch).eq('id', item_id).eq('business_id', bid))
          await recalcWorkOrderTotalsWeb(supabase, bid, cur.work_order_id)
          return { id: item_id }
        }
        throwSupaError(await supabase.from('work_order_items').update(patch).eq('id', item_id).eq('business_id', bid))
        return { id: item_id }
      }),
      deleteItem: ({ item_id }) => tryWrite(async () => {
        const { data: cur } = await supabase.from('work_order_items').select('work_order_id').eq('id', item_id).eq('business_id', bid).single()
        throwSupaError(await supabase.from('work_order_items').delete().eq('id', item_id).eq('business_id', bid))
        if (cur?.work_order_id) await recalcWorkOrderTotalsWeb(supabase, bid, cur.work_order_id)
      }),
      saveInspection: ({ id, inspection }) => tryWrite(async () => {
        throwSupaError(await supabase.from('work_orders').update({ inspection_json: inspection || {}, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
      }),
      generateApprovalToken: ({ id }) => tryWrite(async () => {
        const token = (crypto.randomUUID().replace(/-/g,'') + crypto.randomUUID().replace(/-/g,'').slice(0,16))
        const { data: wo } = await supabase.from('work_orders').select('supabase_id').eq('id', id).eq('business_id', bid).single()
        throwSupaError(await supabase.from('work_orders').update({ customer_approval_token: token, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        return { token, work_order_supabase_id: wo?.supabase_id || null }
      }),
      approveEstimate: ({ id, signature_url }) => tryWrite(async () => {
        throwSupaError(await supabase.from('work_orders').update({ status: 'aprobado', estimate_approved_at: new Date().toISOString(), customer_signature_url: signature_url || null, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
      }),
      setPartsOrder: ({ id, expected_parts_arrival }) => tryWrite(async () => {
        throwSupaError(await supabase.from('work_orders').update({ status: 'awaiting_parts', expected_parts_arrival: expected_parts_arrival || null, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
      }),
      close: ({ id, odometer_out_km }) => tryWrite(async () => {
        const patch = { status: 'closed', completed_date: new Date().toISOString(), updated_at: new Date().toISOString() }
        if (odometer_out_km != null) patch.odometer_out_km = Number(odometer_out_km)
        throwSupaError(await supabase.from('work_orders').update(patch).eq('id', id).eq('business_id', bid))
        if (odometer_out_km != null) {
          const { data: wo } = await supabase.from('work_orders').select('vehicle_id').eq('id', id).eq('business_id', bid).single()
          if (wo?.vehicle_id) {
            const km = Number(odometer_out_km)
            const next = new Date(Date.now() + 1000*60*60*24*180).toISOString()
            await supabase.from('vehicles').update({
              odometer_km: km, last_service_km: km, last_service_at: new Date().toISOString(),
              next_service_km: km + 5000, next_service_at: next, updated_at: new Date().toISOString(),
            }).eq('id', wo.vehicle_id).eq('business_id', bid)
          }
        }
      }),
      delete: (id) => tryWrite(async () => { throwSupaError(await supabase.from('work_orders').delete().eq('id', id).eq('business_id', bid)) }),
    },

    // ── Work Order Items ────────────────────────────────────────────────────

    workOrderItems: {
      byOrder: (workOrderId) => tryOr(async () => throwSupaError(await supabase.from('work_order_items').select('*').eq('business_id', bid).eq('work_order_id', workOrderId).order('created_at')), []),
      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('work_order_items').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }).select('id').single())
        return row
      }),
      update: (id, data) => tryWrite(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('work_order_items').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      delete: (id) => tryWrite(async () => { throwSupaError(await supabase.from('work_order_items').delete().eq('id', id).eq('business_id', bid)) }),
    },

    // ── Dealership: Vehicle Inventory (units for sale) ──────────────────────

    vehicleInventory: {
      list: (params) => tryOr(async () => {
        let q = supabase.from('vehicle_inventory').select('*').eq('business_id', bid).eq('active', true)
        if (params?.status) q = q.eq('status', params.status)
        return throwSupaError(await q.order('listing_date', { ascending: false }))
      }, []),
      getById: (id) => tryOr(async () => throwSupaError(await supabase.from('vehicle_inventory').select('*').eq('id', id).eq('business_id', bid).single())),
      create: (data) => withDealershipQ('vehicleInventory_create', data, () => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('vehicle_inventory').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id, supabase_id').single())
        return row
      })),
      update: (id, data) => withDealershipQ('vehicleInventory_update', { id, data }, () => tryWrite(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('vehicle_inventory').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } })),
      setStatus: (id, status) => withDealershipQ('vehicleInventory_setStatus', { id, status }, () => tryWrite(async () => {
        const patch = { status, updated_at: new Date().toISOString() }
        if (status === 'sold') patch.sold_date = new Date().toISOString()
        throwSupaError(await supabase.from('vehicle_inventory').update(patch).eq('id', id).eq('business_id', bid))
      })),
      delete: (id) => withDealershipQ('vehicleInventory_delete', { id }, () => tryWrite(async () => { throwSupaError(await supabase.from('vehicle_inventory').update({ active: false }).eq('id', id).eq('business_id', bid)) })),
      uploadPhoto: (vehicleId, file) => tryWrite(async () => {
        if (!vehicleId || !file) return null
        const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase()
        const path = `${bid}/${vehicleId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error } = await supabase.storage.from('vehicle-photos').upload(path, file, { contentType: file.type, upsert: false })
        if (error) throw error
        const { data: pub } = supabase.storage.from('vehicle-photos').getPublicUrl(path)
        const url = pub?.publicUrl
        if (!url) throw new Error('No public URL')
        const cur = throwSupaError(await supabase.from('vehicle_inventory').select('photo_urls').eq('id', vehicleId).eq('business_id', bid).single())
        const next = Array.isArray(cur?.photo_urls) ? [...cur.photo_urls, url] : [url]
        throwSupaError(await supabase.from('vehicle_inventory').update({ photo_urls: next, updated_at: new Date().toISOString() }).eq('id', vehicleId).eq('business_id', bid))
        return url
      }),
      removePhoto: (vehicleId, url) => tryWrite(async () => {
        const cur = throwSupaError(await supabase.from('vehicle_inventory').select('photo_urls').eq('id', vehicleId).eq('business_id', bid).single())
        const next = Array.isArray(cur?.photo_urls) ? cur.photo_urls.filter(u => u !== url) : []
        throwSupaError(await supabase.from('vehicle_inventory').update({ photo_urls: next, updated_at: new Date().toISOString() }).eq('id', vehicleId).eq('business_id', bid))
        try {
          const m = url.match(/vehicle-photos\/(.+)$/)
          if (m) await supabase.storage.from('vehicle-photos').remove([m[1]])
        } catch (err) {
          try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'warn', category: 'web.vehicle.removePhoto.storage_orphan', extra: { vehicleId, url } }) } catch {}
        }
      }),
      bulkImport: (rows) => tryWrite(async () => {
        if (!Array.isArray(rows) || rows.length === 0) return { inserted: 0 }
        const payload = rows.map(r => ({ ...r, supabase_id: crypto.randomUUID(), business_id: bid, active: true }))
        throwSupaError(await supabase.from('vehicle_inventory').insert(payload))
        return { inserted: payload.length }
      }),
    },

    // ── Dealership: Vehicle Documents (title, registration, insurance) ──────

    vehicleDocuments: {
      byVehicle: (vehicleSupabaseId) => tryOr(async () => {
        if (!vehicleSupabaseId) return []
        return throwSupaError(await supabase.from('vehicle_documents').select('*').eq('business_id', bid).eq('active', true).eq('vehicle_inventory_supabase_id', vehicleSupabaseId).order('uploaded_at', { ascending: false }))
      }, []),
      expiringSoon: (days = 30) => tryOr(async () => {
        const cutoff = new Date(Date.now() + days * 86400000).toISOString()
        return throwSupaError(await supabase.from('vehicle_documents').select('*').eq('business_id', bid).eq('active', true).not('expires_at', 'is', null).lte('expires_at', cutoff).order('expires_at'))
      }, []),
      upload: ({ vehicleSupabaseId, file, docType, expiresAt, notes }) => tryWrite(async () => {
        if (!vehicleSupabaseId || !file) return null
        const ext = (file.name?.split('.').pop() || 'pdf').toLowerCase()
        const path = `${bid}/${vehicleSupabaseId}/${docType}-${Date.now()}.${ext}`
        const { error } = await supabase.storage.from('vehicle-documents').upload(path, file, { contentType: file.type, upsert: false })
        if (error) throw error
        const { data: signed } = await supabase.storage.from('vehicle-documents').createSignedUrl(path, 60 * 60 * 24 * 365)
        const file_url = signed?.signedUrl || path
        const row = throwSupaError(await supabase.from('vehicle_documents').insert({
          supabase_id: crypto.randomUUID(),
          business_id: bid,
          vehicle_inventory_supabase_id: vehicleSupabaseId,
          doc_type: docType,
          file_url,
          file_name: file.name || null,
          expires_at: expiresAt || null,
          notes: notes || null,
          active: true,
        }).select('id, supabase_id').single())
        return row
      }),
      delete: (id) => tryWrite(async () => { throwSupaError(await supabase.from('vehicle_documents').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)) }),
    },

    // ── v2.16.0 Taller Mecánico hardening ───────────────────────────────────

    aseguradoras: {
      list: () => tryOr(async () => throwSupaError(await supabase.from('aseguradoras').select('*').eq('business_id', bid).eq('active', true).order('nombre')), []),
      byId: (id) => tryOr(async () => throwSupaError(await supabase.from('aseguradoras').select('*').eq('id', id).eq('business_id', bid).single())),
      bySupabaseId: (sid) => tryOr(async () => throwSupaError(await supabase.from('aseguradoras').select('*').eq('supabase_id', sid).eq('business_id', bid).single())),
      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('aseguradoras').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true, ecf_mode: data?.ecf_mode === 'monthly_batch' ? 'monthly_batch' : 'per_wo' }).select('id, supabase_id').single())
        return row
      }),
      update: (id, data) => tryWrite(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('aseguradoras').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      delete: (id) => tryWrite(async () => { throwSupaError(await supabase.from('aseguradoras').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)) }),
    },

    suppliers: {
      list: () => tryOr(async () => throwSupaError(await supabase.from('suppliers').select('*').eq('business_id', bid).eq('active', true).order('nombre')), []),
      byId: (id) => tryOr(async () => throwSupaError(await supabase.from('suppliers').select('*').eq('id', id).eq('business_id', bid).single())),
      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('suppliers').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id, supabase_id').single())
        return row
      }),
      update: (id, data) => tryWrite(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('suppliers').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      delete: (id) => tryWrite(async () => { throwSupaError(await supabase.from('suppliers').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)) }),
    },

    partsOrders: {
      listByWO: (wo_supabase_id) => tryOr(async () => {
        if (!wo_supabase_id) return []
        return throwSupaError(await supabase.from('parts_orders').select('*, suppliers(nombre)').eq('business_id', bid).eq('work_order_supabase_id', wo_supabase_id).order('created_at', { ascending: false }))
      }, []),
      listAwaiting: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('parts_orders').select('*, suppliers(nombre)').eq('business_id', bid).in('status', ['pendiente','en_camino']).order('expected_at', { ascending: true })) || []
        return rows
      }, []),
      findByBarcode: (barcode) => tryOr(async () => {
        if (!barcode) return null
        return throwSupaError(await supabase.from('parts_orders').select('*').eq('business_id', bid).eq('received_barcode', barcode).in('status', ['pendiente','en_camino']).order('created_at', { ascending: false }).limit(1).maybeSingle())
      }),
      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('parts_orders').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, status: data?.status || 'pendiente' }).select('id, supabase_id').single())
        return row
      }),
      update: (id, data) => tryWrite(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('parts_orders').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      markReceived: (id, received_barcode) => tryWrite(async () => {
        const patch = { status: 'recibido', received_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        if (received_barcode) patch.received_barcode = received_barcode
        throwSupaError(await supabase.from('parts_orders').update(patch).eq('id', id).eq('business_id', bid))
        return { id }
      }),
      delete: (id) => tryWrite(async () => { throwSupaError(await supabase.from('parts_orders').update({ status: 'cancelado', updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)) }),
    },

    workOrderPhotos: {
      listByWO: (wo_supabase_id) => tryOr(async () => {
        if (!wo_supabase_id) return []
        return throwSupaError(await supabase.from('work_order_photos').select('*').eq('business_id', bid).eq('work_order_supabase_id', wo_supabase_id).order('created_at'))
      }, []),
      listByVehicle: (veh_supabase_id) => tryOr(async () => {
        if (!veh_supabase_id) return []
        return throwSupaError(await supabase.from('work_order_photos').select('*').eq('business_id', bid).eq('vehicle_supabase_id', veh_supabase_id).order('created_at', { ascending: false }))
      }, []),
      upload: ({ work_order_supabase_id, vehicle_supabase_id, phase, file, taken_by_empleado_supabase_id, caption }) => tryWrite(async () => {
        if (!file) throw new Error('workOrderPhotos.upload: file is required')
        if (phase !== 'antes' && phase !== 'despues') throw new Error(`workOrderPhotos.upload: invalid phase "${phase}" (expected antes|despues)`)
        const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase()
        const stem = work_order_supabase_id || vehicle_supabase_id || 'misc'
        const storage_path = `${bid}/${stem}/${phase}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error } = await supabase.storage.from('mechanic-photos').upload(storage_path, file, { contentType: file.type, upsert: false })
        if (error) throw error
        const row = throwSupaError(await supabase.from('work_order_photos').insert({
          supabase_id: crypto.randomUUID(),
          business_id: bid,
          work_order_supabase_id: work_order_supabase_id || null,
          vehicle_supabase_id: vehicle_supabase_id || null,
          phase,
          storage_path,
          taken_by_empleado_supabase_id: taken_by_empleado_supabase_id || null,
          caption: caption || null,
        }).select('id, supabase_id').single())
        const { data: signed } = await supabase.storage.from('mechanic-photos').createSignedUrl(storage_path, 60 * 60 * 24 * 7)
        return { ...row, signed_url: signed?.signedUrl || null, storage_path }
      }),
      signedUrl: (storage_path) => tryOr(async () => {
        if (!storage_path) return null
        const { data } = await supabase.storage.from('mechanic-photos').createSignedUrl(storage_path, 60 * 60 * 24 * 7)
        return data?.signedUrl || null
      }),
      delete: (id) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('work_order_photos').select('storage_path').eq('id', id).eq('business_id', bid).single())
        if (row?.storage_path) {
          // Storage cleanup is best-effort; log failures but don't block the row delete.
          try { await supabase.storage.from('mechanic-photos').remove([row.storage_path]) }
          catch (e) { console.warn('[mechanic-photos] storage.remove failed', row.storage_path, e?.message || e) }
        }
        throwSupaError(await supabase.from('work_order_photos').delete().eq('id', id).eq('business_id', bid))
      }),
    },

    insuranceBatches: {
      listByPeriod: (params = {}) => tryOr(async () => {
        let q = supabase.from('insurance_batches').select('*, aseguradoras(nombre)').eq('business_id', bid)
        if (params?.aseguradora_supabase_id) q = q.eq('aseguradora_supabase_id', params.aseguradora_supabase_id)
        if (params?.period_month)            q = q.eq('period_month', params.period_month)
        return throwSupaError(await q.order('period_month', { ascending: false }))
      }, []),
      byId: (id) => tryOr(async () => throwSupaError(await supabase.from('insurance_batches').select('*, aseguradoras(*)').eq('id', id).eq('business_id', bid).single())),
      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('insurance_batches').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, status: data?.status || 'borrador' }).select('id, supabase_id').single())
        try {
          await logActivity({
            event_type: 'insurance_batch_emitted', severity: 'info',
            target_type: 'insurance_batch', target_id: row?.id,
            metadata: { aseguradora_supabase_id: data?.aseguradora_supabase_id, period_month: data?.period_month },
          })
        } catch (e) { console.warn('[insuranceBatches.create] activity log failed', e?.message || e) }
        return row
      }),
      update: (id, data) => tryWrite(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('insurance_batches').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      workOrdersFor: (aseguradora_supabase_id, period_month) => tryOr(async () => {
        if (!aseguradora_supabase_id || !period_month) return []
        const month = String(period_month).slice(0, 7)
        const rows = throwSupaError(await supabase.from('work_orders').select('*').eq('business_id', bid).eq('aseguradora_supabase_id', aseguradora_supabase_id).in('status', ['facturado','closed','listo']).order('completed_date', { ascending: true })) || []
        return rows.filter(r => String(r.completed_date || r.finished_at || r.updated_at || '').slice(0, 7) === month)
      }, []),
      uploadPdf: (id, file) => tryWrite(async () => {
        if (!id || !file) throw new Error('insuranceBatches.uploadPdf: id and file required')
        const path = `${bid}/insurance-batches/${id}-${Date.now()}.pdf`
        const { error } = await supabase.storage.from('mechanic-photos').upload(path, file, { contentType: 'application/pdf', upsert: true })
        if (error) throw error
        throwSupaError(await supabase.from('insurance_batches').update({ pdf_storage_path: path, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        return path
      }),
    },

    mechanic: {
      productivityForPeriod: ({ period_start, period_end }) => tryOr(async () => {
        if (!period_start || !period_end) return []
        const wos = throwSupaError(await supabase.from('work_orders').select('id, technician_empleado_supabase_id, started_at, finished_at, completed_date, labor_total, total').eq('business_id', bid).gte('completed_date', period_start).lte('completed_date', period_end)) || []
        const emps = throwSupaError(await supabase.from('empleados').select('id, supabase_id, nombre, comision_pct').eq('business_id', bid).eq('active', true)) || []
        const byEmp = new Map(emps.map(e => [e.supabase_id, { ...e, wo_count: 0, hours_total: 0, labor_total: 0, revenue_total: 0 }]))
        for (const w of wos) {
          const sid = w.technician_empleado_supabase_id; if (!sid || !byEmp.has(sid)) continue
          const acc = byEmp.get(sid)
          acc.wo_count += 1
          if (w.started_at && w.finished_at) acc.hours_total += (new Date(w.finished_at) - new Date(w.started_at)) / 3600000
          acc.labor_total   += Number(w.labor_total) || 0
          acc.revenue_total += Number(w.total) || 0
        }
        return [...byEmp.values()].sort((a, b) => b.hours_total - a.hours_total)
      }, []),
      serviceRemindersDue: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('vehicles').select('*, clients(name, phone)').eq('business_id', bid).eq('active', true)) || []
        const now = Date.now()
        return rows.filter(v => {
          const kmDue = v.next_service_km != null && v.odometer_km != null && Number(v.odometer_km) >= Number(v.next_service_km) - 500
          const dateDue = v.next_service_at && (new Date(v.next_service_at).getTime() - now) <= 7 * 86400000
          return kmDue || dateDue
        })
      }, []),
    },

    // FIX-H5 — frozen mechanic commissions for productivity report + payout.
    mechanicCommissions: {
      byPeriod: ({ period_start, period_end }) => tryOr(async () => {
        if (!period_start || !period_end) return []
        const rows = throwSupaError(await supabase.from('mechanic_commissions').select('*')
          .eq('business_id', bid)
          .gte('created_at', period_start)
          .lte('created_at', period_end + 'T23:59:59')
          .order('created_at', { ascending: false })) || []
        // Resolve technician names client-side (avoid embed FK assumption).
        const techIds = [...new Set(rows.map(r => r.technician_empleado_supabase_id).filter(Boolean))]
        if (techIds.length) {
          const { data: emps } = await supabase.from('empleados').select('supabase_id, nombre').in('supabase_id', techIds)
          const map = new Map((emps || []).map(e => [e.supabase_id, e.nombre]))
          for (const r of rows) r.technician_name = map.get(r.technician_empleado_supabase_id) || null
        }
        return rows
      }, []),
      markPaid: (id, paid_by_supabase_id) => tryWrite(async () => {
        throwSupaError(await supabase.from('mechanic_commissions').update({
          paid: true,
          paid_at: new Date().toISOString(),
          paid_by_supabase_id: paid_by_supabase_id || null,
          updated_at: new Date().toISOString(),
        }).eq('id', id).eq('business_id', bid))
        return { id }
      }),
    },

    // ── Dealership: Sales Deals ─────────────────────────────────────────────

    salesDeals: {
      list: (params) => tryOr(async () => {
        let q = supabase.from('sales_deals').select('*').eq('business_id', bid).eq('active', true)
        if (params?.status) q = q.eq('status', params.status)
        const rows = throwSupaError(await q.order('created_at', { ascending: false })) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name,phone', asKey: 'clients', businessId: bid })
        return rows
      }, []),
      getById: (id) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('sales_deals').select('*').eq('id', id).eq('business_id', bid).single())
        if (!row) return null
        await attachRel(supabase, [row], { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name,phone,rnc', asKey: 'clients', businessId: bid })
        return row
      }),
      create: (data) => withDealershipQ('salesDeals_create', data, () => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('sales_deals').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id, supabase_id').single())
        if (data?.status === 'closed') {
          await logActivity({
            event_type: 'deal_closed', severity: 'info',
            target_type: 'sales_deal', target_id: row?.id, target_name: data?.notes || null,
            amount: Number(data?.sale_price) || 0,
            metadata: { commission_amount: Number(data?.commission_amount) || 0, financed: Number(data?.financed_amount) || 0, salesperson_supabase_id: data?.salesperson_supabase_id || null },
          })
        }
        return row
      })),
      update: (id, data) => withDealershipQ('salesDeals_update', { id, data }, () => tryWrite(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('sales_deals').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } })),
      close: (id, ticketInfo) => withDealershipQ('salesDeals_close', { id, ticketInfo }, () => tryWrite(async () => {
        const patch = { status: 'closed', closed_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        if (ticketInfo?.ticket_id) patch.ticket_id = ticketInfo.ticket_id
        if (ticketInfo?.ticket_supabase_id) patch.ticket_supabase_id = ticketInfo.ticket_supabase_id
        throwSupaError(await supabase.from('sales_deals').update(patch).eq('id', id).eq('business_id', bid))
      })),
      markCommissionPaid: (id) => tryWrite(async () => {
        const cur = throwSupaError(await supabase.from('sales_deals').select('commission_amount, salesperson_supabase_id').eq('id', id).eq('business_id', bid).single())
        throwSupaError(await supabase.from('sales_deals').update({ commission_paid: true, commission_paid_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        await logActivity({
          event_type: 'deal_commission_paid', severity: 'info',
          target_type: 'sales_deal', target_id: id,
          amount: Number(cur?.commission_amount) || 0,
          metadata: { salesperson_supabase_id: cur?.salesperson_supabase_id || null },
        })
      }),
      commissionsForPeriod: ({ from, to, salespersonSupabaseId }) => tryOr(async () => {
        let q = supabase.from('sales_deals').select('id, supabase_id, salesperson_id, salesperson_supabase_id, commission_amount, commission_paid, closed_at, sale_price').eq('business_id', bid).eq('active', true).eq('status', 'closed').not('commission_amount', 'is', null)
        if (from) q = q.gte('closed_at', from)
        if (to) q = q.lte('closed_at', to)
        if (salespersonSupabaseId) q = q.eq('salesperson_supabase_id', salespersonSupabaseId)
        return throwSupaError(await q.order('closed_at', { ascending: false }))
      }, []),
      delete: (id) => tryWrite(async () => { throwSupaError(await supabase.from('sales_deals').update({ active: false }).eq('id', id).eq('business_id', bid)) }),
    },

    // ── Dealership: Vehicle Titulo (INTRANT matricula / traspaso) ───────────
    // v2.16.2 — concesionario compliance C4. UI lives at /matriculas. Reads
    // are tryOr (fallback []) so an offline matriculas screen still renders
    // the empty state instead of throwing; writes are tryWrite so save buttons
    // surface a real error.

    vehicleTitulo: {
      list: () => tryOr(async () => {
        return throwSupaError(await supabase.from('vehicle_titulo').select('*').eq('business_id', bid).eq('active', true).order('created_at', { ascending: false }))
      }, []),
      byDeal: (dealSupabaseId) => tryOr(async () => {
        if (!dealSupabaseId) return null
        return throwSupaError(await supabase.from('vehicle_titulo').select('*').eq('business_id', bid).eq('active', true).eq('sales_deal_supabase_id', dealSupabaseId).order('created_at', { ascending: false }).limit(1).maybeSingle())
      }),
      upsert: (data) => withDealershipQ('vehicleTitulo_upsert', data, () => tryWrite(async () => {
        const sid = data?.supabase_id || crypto.randomUUID()
        // Upsert by supabase_id when present, else by sales_deal_supabase_id.
        let existing = null
        if (data?.id) {
          existing = throwSupaError(await supabase.from('vehicle_titulo').select('id, supabase_id').eq('id', data.id).eq('business_id', bid).maybeSingle())
        } else if (data?.sales_deal_supabase_id) {
          existing = throwSupaError(await supabase.from('vehicle_titulo').select('id, supabase_id').eq('business_id', bid).eq('sales_deal_supabase_id', data.sales_deal_supabase_id).eq('active', true).maybeSingle())
        }
        const { id: _id, supabase_id: _sid, business_id: _bid, ...rest } = data || {}
        if (existing?.id) {
          throwSupaError(await supabase.from('vehicle_titulo').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('business_id', bid))
          return { id: existing.id, supabase_id: existing.supabase_id }
        }
        const row = throwSupaError(await supabase.from('vehicle_titulo').insert({
          ...rest,
          supabase_id: sid,
          business_id: bid,
          active: true,
          intrant_status: rest.intrant_status || 'pendiente',
        }).select('id, supabase_id').single())
        return row
      })),
      delete: (id) => withDealershipQ('vehicleTitulo_delete', { id }, () => tryWrite(async () => {
        throwSupaError(await supabase.from('vehicle_titulo').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
      })),
    },

    // ── Dealership: Vehicle Reservations (deposit + expiry) ─────────────────
    // v2.16.4 Sprint 2A H2. Real DR concesionario: cliente paga RD$5K-50K para
    // reservar la unidad por X dias; si vence se libera. UI lives at
    // /reservations. Mirrors the SQLite side-effects so a web-only client
    // also sees vehicle_inventory.status flip in real time.
    vehicleReservation: {
      list: () => tryOr(async () => {
        return throwSupaError(await supabase.from('vehicle_reservations').select('*').eq('business_id', bid).eq('active', true).order('expires_at', { ascending: true }))
      }, []),
      active: ({ vehicle_inventory_supabase_id } = {}) => tryOr(async () => {
        let q = supabase.from('vehicle_reservations').select('*').eq('business_id', bid).eq('active', true).eq('status', 'active')
        if (vehicle_inventory_supabase_id) q = q.eq('vehicle_inventory_supabase_id', vehicle_inventory_supabase_id)
        return throwSupaError(await q.order('expires_at', { ascending: true }))
      }, []),
      upsert: (data) => withDealershipQ('vehicleReservation_upsert', data, () => tryWrite(async () => {
        const sid = data?.supabase_id || crypto.randomUUID()
        const { id: _id, supabase_id: _sid, business_id: _bid, ...rest } = data || {}
        let row
        if (data?.id) {
          throwSupaError(await supabase.from('vehicle_reservations').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', data.id).eq('business_id', bid))
          row = throwSupaError(await supabase.from('vehicle_reservations').select('*').eq('id', data.id).eq('business_id', bid).single())
        } else {
          row = throwSupaError(await supabase.from('vehicle_reservations').insert({
            ...rest,
            supabase_id: sid,
            business_id: bid,
            active: true,
            status: rest.status || 'active',
          }).select('*').single())
        }
        if (row?.status === 'active' && row?.vehicle_inventory_supabase_id) {
          // v2.16.29 (C2) — surface the failure. The empty `catch {}` swallowed
          // every error including RLS denial, leaving the reservation row
          // landed but `vehicle_inventory.status` still 'available' →
          // double-reservation possible. Now: write returns the affected
          // row (.select), and if 0 rows changed (vehicle wasn't actually
          // available, or RLS denied), throw so the parent reservation
          // INSERT can roll back. The caller (UI) will see a real error
          // instead of a phantom-success reservation.
          const { data: flipped, error: flipErr } = await supabase.from('vehicle_inventory')
            .update({ status: 'reserved', updated_at: new Date().toISOString() })
            .eq('business_id', bid).eq('supabase_id', row.vehicle_inventory_supabase_id).eq('status', 'available')
            .select('id, status')
          if (flipErr) {
            // Roll back the just-created reservation so we don't leave the
            // pair in an inconsistent state.
            await supabase.from('vehicle_reservations').update({ status: 'released', active: false, released_reason: 'vehicle_status_flip_failed', released_at: new Date().toISOString() })
              .eq('id', row.id).eq('business_id', bid).then(() => {}, () => {})
            throw new Error(`No se pudo reservar la unidad: ${flipErr.message}`)
          }
          if (!flipped || flipped.length === 0) {
            // Race: another register reserved it first OR the unit isn't
            // available anymore. Roll back so the user sees "ya no disponible".
            await supabase.from('vehicle_reservations').update({ status: 'released', active: false, released_reason: 'vehicle_unavailable', released_at: new Date().toISOString() })
              .eq('id', row.id).eq('business_id', bid).then(() => {}, () => {})
            throw new Error('La unidad ya no está disponible (otra caja la reservó o cambió de estado).')
          }
        }
        return row
      })),
      release: ({ id, reason } = {}) => withDealershipQ('vehicleReservation_release', { id, reason }, () => tryWrite(async () => {
        const cur = throwSupaError(await supabase.from('vehicle_reservations').select('vehicle_inventory_supabase_id').eq('id', id).eq('business_id', bid).maybeSingle())
        throwSupaError(await supabase.from('vehicle_reservations').update({
          status: 'released', released_at: new Date().toISOString(), released_reason: reason || null, updated_at: new Date().toISOString(),
        }).eq('id', id).eq('business_id', bid))
        const veh = cur?.vehicle_inventory_supabase_id
        if (veh) {
          const { count } = await supabase.from('vehicle_reservations').select('id', { count: 'exact', head: true })
            .eq('business_id', bid).eq('active', true).eq('status', 'active').eq('vehicle_inventory_supabase_id', veh)
          if ((count || 0) === 0) {
            // v2.16.29 (C2 follow-on) — log the failure so it's visible in the
            // console + activity log if it ever happens, instead of swallowing.
            const { error: relErr } = await supabase.from('vehicle_inventory').update({ status: 'available', updated_at: new Date().toISOString() })
              .eq('business_id', bid).eq('supabase_id', veh).eq('status', 'reserved')
            if (relErr) console.error('[vehicleReservation_release] inventory flip failed:', relErr.message, '— vehicle stuck in "reserved" state for', veh)
          }
        }
        return { id }
      })),
      convert: ({ id, deal_supabase_id } = {}) => withDealershipQ('vehicleReservation_convert', { id, deal_supabase_id }, () => tryWrite(async () => {
        const cur = throwSupaError(await supabase.from('vehicle_reservations').select('vehicle_inventory_supabase_id').eq('id', id).eq('business_id', bid).maybeSingle())
        throwSupaError(await supabase.from('vehicle_reservations').update({
          status: 'converted', converted_deal_supabase_id: deal_supabase_id || null, updated_at: new Date().toISOString(),
        }).eq('id', id).eq('business_id', bid))
        if (cur?.vehicle_inventory_supabase_id) {
          // v2.16.29 (C2 follow-on) — log the failure. Deal is already closed,
          // so we don't throw, but inventory marker MUST eventually become
          // 'sold'. If flip fails, the row reads as still-reserved/available
          // and a duplicate sale becomes possible.
          const { error: convErr } = await supabase.from('vehicle_inventory').update({ status: 'sold', sold_date: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('business_id', bid).eq('supabase_id', cur.vehicle_inventory_supabase_id)
          if (convErr) console.error('[vehicleReservation_convert] inventory flip to "sold" failed:', convErr.message, '— vehicle', cur.vehicle_inventory_supabase_id, 'must be marked sold manually')
        }
        return { id }
      })),
      expire: () => tryWrite(async () => {
        const nowIso = new Date().toISOString()
        const due = throwSupaError(await supabase.from('vehicle_reservations').select('id, vehicle_inventory_supabase_id')
          .eq('business_id', bid).eq('active', true).eq('status', 'active').lte('expires_at', nowIso)) || []
        if (!due.length) return { expired: 0 }
        throwSupaError(await supabase.from('vehicle_reservations').update({
          status: 'expired', released_at: nowIso, released_reason: 'auto_expired', updated_at: nowIso,
        }).in('id', due.map(d => d.id)).eq('business_id', bid))
        const seen = new Set()
        for (const d of due) {
          const veh = d.vehicle_inventory_supabase_id
          if (!veh || seen.has(veh)) continue
          seen.add(veh)
          const { count } = await supabase.from('vehicle_reservations').select('id', { count: 'exact', head: true })
            .eq('business_id', bid).eq('active', true).eq('status', 'active').eq('vehicle_inventory_supabase_id', veh)
          if ((count || 0) === 0) {
            // v2.16.29 (C2 follow-on) — log instead of swallow. Expire is a
            // batch cleanup; partial success is acceptable but we want
            // visibility into the failure mode.
            const { error: expErr } = await supabase.from('vehicle_inventory').update({ status: 'available', updated_at: new Date().toISOString() })
              .eq('business_id', bid).eq('supabase_id', veh).eq('status', 'reserved')
            if (expErr) console.error('[vehicleReservation_expire] inventory flip failed:', expErr.message, '— vehicle stuck in "reserved":', veh)
          }
        }
        return { expired: due.length }
      }),
    },

    // ── Dealership: Post-sale Warranties (v2.16.4 Sprint 2B H3) ─────────────
    // Garantia 30/60/90d / 1yr por unidad vendida. Claims viven como JSONB
    // array. Auto-expire por job (web invoca via expire()).
    vehicleWarranty: {
      list: () => tryOr(async () => {
        return throwSupaError(await supabase.from('vehicle_warranties').select('*').eq('business_id', bid).eq('active', true).order('expires_at', { ascending: true }))
      }, []),
      byDeal: (sales_deal_supabase_id) => tryOr(async () => {
        if (!sales_deal_supabase_id) return []
        return throwSupaError(await supabase.from('vehicle_warranties').select('*').eq('business_id', bid).eq('active', true).eq('sales_deal_supabase_id', sales_deal_supabase_id).order('created_at', { ascending: false }))
      }, []),
      expiringSoon: ({ days } = {}) => tryOr(async () => {
        const d = Math.max(1, Number(days) || 30)
        const nowIso = new Date().toISOString()
        const cutoff = new Date(Date.now() + d * 86400000).toISOString()
        return throwSupaError(await supabase.from('vehicle_warranties').select('*').eq('business_id', bid).eq('active', true).eq('status', 'active').gt('expires_at', nowIso).lte('expires_at', cutoff).order('expires_at', { ascending: true }))
      }, []),
      upsert: (data) => withDealershipQ('vehicleWarranty_upsert', data, () => tryWrite(async () => {
        const sid = data?.supabase_id || crypto.randomUUID()
        const { id: _id, supabase_id: _sid, business_id: _bid, ...rest } = data || {}
        if (data?.id) {
          throwSupaError(await supabase.from('vehicle_warranties').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', data.id).eq('business_id', bid))
          return throwSupaError(await supabase.from('vehicle_warranties').select('*').eq('id', data.id).eq('business_id', bid).single())
        }
        if (!rest.sales_deal_supabase_id) throw new Error('sales_deal_supabase_id requerido')
        if (!rest.expires_at) throw new Error('expires_at requerido')
        return throwSupaError(await supabase.from('vehicle_warranties').insert({
          ...rest,
          supabase_id: sid,
          business_id: bid,
          active: true,
          status: rest.status || 'active',
          kind: rest.kind || 'general',
          starts_at: rest.starts_at || new Date().toISOString(),
          claims: Array.isArray(rest.claims) ? rest.claims : [],
        }).select('*').single())
      })),
      addClaim: ({ id, claim } = {}) => withDealershipQ('vehicleWarranty_addClaim', { id, claim }, () => tryWrite(async () => {
        const cur = throwSupaError(await supabase.from('vehicle_warranties').select('claims, status').eq('id', id).eq('business_id', bid).maybeSingle())
        const prev = Array.isArray(cur?.claims) ? cur.claims.slice() : []
        prev.push({
          date:        claim?.date || new Date().toISOString(),
          description: String(claim?.description || '').slice(0, 1000),
          status:      ['open','in_progress','resolved','rejected'].includes(claim?.status) ? claim.status : 'open',
          cost:        Number(claim?.cost) || 0,
        })
        const newStatus = cur?.status === 'active' ? 'claimed' : (cur?.status || 'claimed')
        throwSupaError(await supabase.from('vehicle_warranties').update({
          claims: prev, status: newStatus, updated_at: new Date().toISOString(),
        }).eq('id', id).eq('business_id', bid))
        return throwSupaError(await supabase.from('vehicle_warranties').select('*').eq('id', id).eq('business_id', bid).single())
      })),
      void: ({ id, reason } = {}) => withDealershipQ('vehicleWarranty_void', { id, reason }, () => tryWrite(async () => {
        const cur = throwSupaError(await supabase.from('vehicle_warranties').select('notes').eq('id', id).eq('business_id', bid).maybeSingle())
        const notes = reason ? `${cur?.notes ? cur.notes + '\n' : ''}[ANULADA] ${reason}` : cur?.notes
        throwSupaError(await supabase.from('vehicle_warranties').update({
          status: 'voided', notes, updated_at: new Date().toISOString(),
        }).eq('id', id).eq('business_id', bid))
        return { id }
      })),
      expire: () => tryWrite(async () => {
        const nowIso = new Date().toISOString()
        const due = throwSupaError(await supabase.from('vehicle_warranties').select('id')
          .eq('business_id', bid).eq('active', true).in('status', ['active','claimed']).lte('expires_at', nowIso)) || []
        if (!due.length) return { expired: 0 }
        throwSupaError(await supabase.from('vehicle_warranties').update({
          status: 'expired', updated_at: nowIso,
        }).in('id', due.map(d => d.id)).eq('business_id', bid))
        return { expired: due.length }
      }),
    },

    // ── Dealership: Bank Pre-approvals (v2.16.4 Sprint 2C H5) ───────────────
    // Manual workflow — vendedor llama el banco y registra la oferta. Cuando
    // el cliente cierra el deal, la pre-aprobacion 'pre_aprobada' se marca
    // 'utilizada' por el DealBuilder.
    bankPreapproval: {
      list: ({ status, since } = {}) => tryOr(async () => {
        let q = supabase.from('bank_preapprovals').select('*').eq('business_id', bid).eq('active', true)
        if (status) q = q.eq('status', status)
        if (since)  q = q.gte('created_at', since)
        return throwSupaError(await q.order('created_at', { ascending: false }))
      }, []),
      activeByClient: (client_supabase_id) => tryOr(async () => {
        if (!client_supabase_id) return []
        const nowIso = new Date().toISOString()
        return throwSupaError(await supabase.from('bank_preapprovals').select('*')
          .eq('business_id', bid).eq('active', true).eq('client_supabase_id', client_supabase_id)
          .eq('status', 'pre_aprobada').or(`expires_at.is.null,expires_at.gt.${nowIso}`)
          .order('decision_at', { ascending: false }))
      }, []),
      upsert: (data) => withDealershipQ('bankPreapproval_upsert', data, () => tryWrite(async () => {
        const sid = data?.supabase_id || crypto.randomUUID()
        const { id: _id, supabase_id: _sid, business_id: _bid, ...rest } = data || {}
        if (data?.id) {
          throwSupaError(await supabase.from('bank_preapprovals').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', data.id).eq('business_id', bid))
          return throwSupaError(await supabase.from('bank_preapprovals').select('*').eq('id', data.id).eq('business_id', bid).single())
        }
        if (!rest.bank) throw new Error('bank requerido')
        return throwSupaError(await supabase.from('bank_preapprovals').insert({
          ...rest,
          supabase_id: sid,
          business_id: bid,
          active: true,
          status: rest.status || 'solicitada',
          requested_amount: Number(rest.requested_amount) || 0,
        }).select('*').single())
      })),
      setStatus: ({ id, status, decision_letter_url, notes } = {}) => withDealershipQ('bankPreapproval_setStatus', { id, status, decision_letter_url, notes }, () => tryWrite(async () => {
        const allowed = ['solicitada','en_revision','pre_aprobada','rechazada','expirada','utilizada']
        if (!allowed.includes(status)) throw new Error(`status invalido: ${status}`)
        const cur = throwSupaError(await supabase.from('bank_preapprovals').select('notes, decision_at, decision_letter_url').eq('id', id).eq('business_id', bid).maybeSingle())
        const decisionAt = (status === 'pre_aprobada' || status === 'rechazada') ? new Date().toISOString() : cur?.decision_at
        const url = decision_letter_url !== undefined ? decision_letter_url : cur?.decision_letter_url
        const mergedNotes = notes ? `${cur?.notes ? cur.notes + '\n' : ''}${notes}` : cur?.notes
        throwSupaError(await supabase.from('bank_preapprovals').update({
          status, decision_at: decisionAt, decision_letter_url: url, notes: mergedNotes, updated_at: new Date().toISOString(),
        }).eq('id', id).eq('business_id', bid))
        return throwSupaError(await supabase.from('bank_preapprovals').select('*').eq('id', id).eq('business_id', bid).single())
      })),
      expire: () => tryWrite(async () => {
        const nowIso = new Date().toISOString()
        const due = throwSupaError(await supabase.from('bank_preapprovals').select('id')
          .eq('business_id', bid).eq('active', true).in('status', ['solicitada','en_revision','pre_aprobada']).not('expires_at', 'is', null).lte('expires_at', nowIso)) || []
        if (!due.length) return { expired: 0 }
        throwSupaError(await supabase.from('bank_preapprovals').update({
          status: 'expirada', updated_at: nowIso,
        }).in('id', due.map(d => d.id)).eq('business_id', bid))
        return { expired: due.length }
      }),
    },

    // ── Dealership: Test Drives ─────────────────────────────────────────────

    testDrives: {
      list: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('test_drives').select('*').eq('business_id', bid).eq('active', true).order('scheduled_at', { ascending: false })) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name,phone', asKey: 'clients', businessId: bid })
        return rows
      }, []),
      create: (data) => withDealershipQ('testDrives_create', data, () => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('test_drives').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id').single())
        return row
      })),
      update: (id, data) => withDealershipQ('testDrives_update', { id, data }, () => tryWrite(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('test_drives').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } })),
      complete: (id, notes) => withDealershipQ('testDrives_complete', { id, notes }, () => tryWrite(async () => { throwSupaError(await supabase.from('test_drives').update({ completed_at: new Date().toISOString(), notes, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)) })),
      setOutcome: (id, opts) => withDealershipQ('testDrives_setOutcome', { id, opts }, () => tryWrite(async () => {
        const { outcome, outcomeNotes, dealSupabaseId } = opts || {}
        const patch = { outcome, outcome_notes: outcomeNotes || null, updated_at: new Date().toISOString() }
        if (dealSupabaseId) patch.deal_supabase_id = dealSupabaseId
        if (outcome && !patch.completed_at) patch.completed_at = new Date().toISOString()
        throwSupaError(await supabase.from('test_drives').update(patch).eq('id', id).eq('business_id', bid))
      })),
      delete: (id) => tryWrite(async () => { throwSupaError(await supabase.from('test_drives').update({ active: false }).eq('id', id).eq('business_id', bid)) }),
    },

    // ── Dealership: Leads / Sales Pipeline ──────────────────────────────────

    leads: {
      list: (params) => tryOr(async () => {
        let q = supabase.from('leads').select('*').eq('business_id', bid).eq('active', true)
        if (params?.stage) q = q.eq('stage', params.stage)
        return throwSupaError(await q.order('updated_at', { ascending: false }))
      }, []),
      create: (data) => withDealershipQ('leads_create', data, () => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('leads').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id').single())
        return row
      })),
      update: (id, data) => withDealershipQ('leads_update', { id, data }, () => tryWrite(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('leads').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } })),
      setStage: (id, stage, extra) => withDealershipQ('leads_setStage', { id, stage, extra }, () => tryWrite(async () => {
        const cur = throwSupaError(await supabase.from('leads').select('stage, name').eq('id', id).eq('business_id', bid).single())
        throwSupaError(await supabase.from('leads').update({ stage, ...(extra || {}), updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        if (cur && cur.stage !== stage) {
          await logActivity({
            event_type: 'pipeline_stage_change', severity: 'info',
            target_type: 'lead', target_id: id, target_name: cur.name || null,
            old_value: cur.stage, new_value: stage,
          })
        }
      })),
      logContact: (id, opts) => withDealershipQ('leads_logContact', { id, opts }, () => tryWrite(async () => {
        const { nextFollowupAt, notes } = opts || {}
        const cur = throwSupaError(await supabase.from('leads').select('name').eq('id', id).eq('business_id', bid).single())
        const patch = { last_contacted_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        if (nextFollowupAt) patch.next_followup_at = nextFollowupAt
        if (notes !== undefined) patch.notes = notes
        throwSupaError(await supabase.from('leads').update(patch).eq('id', id).eq('business_id', bid))
        await logActivity({
          event_type: 'pipeline_followup_logged', severity: 'info',
          target_type: 'lead', target_id: id, target_name: cur?.name || null,
          metadata: { next_followup_at: nextFollowupAt || null },
        })
      })),
      overdue: () => tryOr(async () => {
        return throwSupaError(await supabase.from('leads').select('*').eq('business_id', bid).eq('active', true).not('next_followup_at', 'is', null).lte('next_followup_at', new Date().toISOString()).not('stage', 'in', '(closed,lost)').order('next_followup_at'))
      }, []),
      delete: (id) => tryWrite(async () => { throwSupaError(await supabase.from('leads').update({ active: false }).eq('id', id).eq('business_id', bid)) }),
    },

    // ── Appointments ────────────────────────────────────────────────────────

    appointments: {
      list: (params) => tryOr(async () => {
        let q = supabase.from('appointments').select('*').eq('business_id', bid)
        if (params?.date) q = q.eq('date', params.date)
        if (params?.empleadoId) q = q.eq('empleado_id', params.empleadoId)
        if (params?.status) q = q.eq('status', params.status)
        const rows = throwSupaError(await q.order('date').order('start_time')) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name,phone', asKey: 'clients', businessId: bid })
        await attachRel(supabase, rows, { fkCol: 'empleado_supabase_id', targetTable: 'empleados', selectCols: 'nombre,tipo', asKey: 'empleados', businessId: bid })
        return rows
      }, []),
      byDate: (date) => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('appointments').select('*').eq('business_id', bid).eq('date', date).order('start_time')) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name,phone', asKey: 'clients', businessId: bid })
        await attachRel(supabase, rows, { fkCol: 'empleado_supabase_id', targetTable: 'empleados', selectCols: 'nombre,tipo', asKey: 'empleados', businessId: bid })
        return rows
      }, []),
      byEmpleado: (empleadoId) => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('appointments').select('*').eq('business_id', bid).eq('empleado_id', empleadoId).order('date', { ascending: false }).limit(50)) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name,phone', asKey: 'clients', businessId: bid })
        return rows
      }, []),
      create: (data) => tryWrite(async () => {
        const sid = crypto.randomUUID()
        // v2.16.1 patch (#9) — fail closed if no stylist resolves. Caller may
        // pass empleado_supabase_id (canonical) OR empleado_id (legacy local
        // int from desktop pull). Resolve to canonical UUID before insert; if
        // neither yields a row, throw — silently inserting an unassigned cita
        // breaks the realtime/reminder/public-slot calc downstream.
        let empSupaId = data?.empleado_supabase_id || null
        if (!empSupaId && data?.empleado_id) {
          const refStr = String(data.empleado_id)
          const looksUuid = /^[0-9a-f-]{36}$/i.test(refStr)
          const { data: emp } = looksUuid
            ? await supabase.from('empleados').select('supabase_id').eq('supabase_id', refStr).eq('business_id', bid).maybeSingle()
            : await supabase.from('empleados').select('supabase_id').eq('id', refStr).eq('business_id', bid).maybeSingle()
          empSupaId = emp?.supabase_id || null
        }
        if (!empSupaId) throw new Error('appointments.create: empleado_supabase_id required (no empleado_id or empleado_supabase_id resolved)')
        const payload = {
          ...data,
          supabase_id: sid,
          empleado_supabase_id: empSupaId,
          business_id: bid,
          is_walk_in: data?.is_walk_in === true || data?.is_walk_in === 1 ? true : false,
          deposit_dop: Number(data?.deposit_dop) || 0,
          deposit_status: data?.deposit_status || 'none',
          public_booking_token: data?.public_booking_token || null,
          client_membership_supabase_id: data?.client_membership_supabase_id || null,
        }
        const row = throwSupaError(await supabase.from('appointments').insert(payload).select('id,supabase_id,date,start_time,is_walk_in').single())
        // Auto-schedule 24h + 2h reminders for non-walk-in citas (skip if too soon)
        try {
          if (!payload.is_walk_in && row?.supabase_id) {
            await api.appointmentReminders.scheduleForAppointment({
              supabase_id: row.supabase_id, date: row.date, start_time: row.start_time,
            })
          }
        } catch (e) { console.warn('[appointments.create] reminder schedule failed:', e?.message || e) }
        return row
      }),
      update: (id, data) => tryWrite(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('appointments').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      setStatus: (id, status) => tryWrite(async () => { throwSupaError(await supabase.from('appointments').update({ status, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)) }),
      delete: (id) => tryWrite(async () => { throwSupaError(await supabase.from('appointments').delete().eq('id', id).eq('business_id', bid)) }),

      // v2.16.1 — mark a salon appointment as no-show. Bumps the client's
      // no_show_count + stamps last_no_show_at. If a deposit was held, returns
      // a `shouldChargeFee` payload so the cobro path can emit an E32 (XML is
      // built downstream — this layer only signals intent).
      markNoShow: (supabase_id) => tryWrite(async () => {
        const appt = throwSupaError(await supabase.from('appointments')
          .select('id,supabase_id,client_supabase_id,deposit_status,deposit_dop,no_show_fee_charged')
          .eq('supabase_id', supabase_id).eq('business_id', bid).maybeSingle())
        if (!appt) return { ok: false, error: 'not_found' }
        // 1. Status flip
        throwSupaError(await supabase.from('appointments')
          .update({ status: 'no_show', updated_at: new Date().toISOString() })
          .eq('supabase_id', supabase_id).eq('business_id', bid))
        // 2. Bump client counter
        let feeAmount = 0
        if (appt.client_supabase_id) {
          // v2.16.2 (item #4) — compare-and-swap. Two parallel no-show flips
          // for the same client previously both read the same `no_show_count`
          // and both wrote `+1`, losing one increment. Now we constrain on the
          // pre-image and retry up to 3 times on miss.
          for (let attempt = 0; attempt < 3; attempt++) {
            const { data: c } = await supabase.from('clients').select('id,no_show_count')
              .eq('supabase_id', appt.client_supabase_id).eq('business_id', bid).maybeSingle()
            if (!c) break
            const prev = Number(c.no_show_count) || 0
            const { data: updated } = await supabase.from('clients').update({
              no_show_count: prev + 1,
              last_no_show_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }).eq('id', c.id).eq('business_id', bid).eq('no_show_count', c.no_show_count)
              .select('id').maybeSingle()
            if (updated) break
          }
        }
        // 3. Decide fee payload (caller owns the e-CF flow)
        const shouldChargeFee = appt.deposit_status === 'held' && !appt.no_show_fee_charged
        if (shouldChargeFee) {
          const { data: feeRow } = await supabase.from('app_settings').select('value')
            .eq('business_id', bid).eq('key', 'salon_no_show_fee_dop').maybeSingle()
          feeAmount = Number(feeRow?.value) || Number(appt.deposit_dop) || 500
        }
        return {
          ok: true,
          shouldChargeFee,
          fee_amount: feeAmount,
          client_supabase_id: appt.client_supabase_id || null,
          appointment_supabase_id: supabase_id,
        }
      }),

      // v2.16.1 — public booking surface (no auth). Resolves business by slug,
      // returns services/stylists/available slots for `date`. Honours the
      // salon_public_booking_enabled flag — returns null when disabled.
      // v2.16.2 (Fix 3) — accept service_supabase_id so slot grid honours
      // real service.duration_min. Backwards-compat: callers without the 3rd
      // arg fall back to 30-min slot logic.
      publicBookingInfo: (slug, date, service_supabase_id) => tryOr(async () => {
        if (!slug || !date) return null
        // 1. Find business via app_settings.salon_public_booking_slug
        const { data: slugRow } = await supabase.from('app_settings')
          .select('business_id').eq('key', 'salon_public_booking_slug').eq('value', slug).maybeSingle()
        if (!slugRow?.business_id) return null
        const targetBid = slugRow.business_id
        // 2. Enabled?
        const { data: enabledRow } = await supabase.from('app_settings')
          .select('value').eq('business_id', targetBid).eq('key', 'salon_public_booking_enabled').maybeSingle()
        if (enabledRow?.value !== 'true') return null
        // 3. Business name
        const { data: biz } = await supabase.from('businesses').select('id,name,logo_url').eq('id', targetBid).maybeSingle()
        // 4. Services + stylists (active only)
        const [{ data: services }, { data: stylists }] = await Promise.all([
          supabase.from('services').select('supabase_id,name,price,duration_min').eq('business_id', targetBid).eq('active', true).order('name'),
          supabase.from('empleados').select('supabase_id,nombre,foto_url,tipo').eq('business_id', targetBid).eq('active', true).in('tipo', ['estilista','barbero','servicio']),
        ])
        // 5. Available slots — derive from stylist_schedules ∩ free time on `date`
        const dow = (new Date(date + 'T12:00:00')).getDay()
        const { data: schedules } = await supabase.from('stylist_schedules')
          .select('empleado_supabase_id,start_time,end_time,day_of_week,active')
          .eq('business_id', targetBid).eq('active', true).eq('day_of_week', dow)
        const { data: existing } = await supabase.from('appointments')
          .select('empleado_supabase_id,start_time,end_time')
          .eq('business_id', targetBid).eq('date', date).neq('status', 'cancelled').neq('status', 'no_show')
        const busyByEmp = {}
        for (const a of (existing || [])) {
          if (!a.empleado_supabase_id) continue
          ;(busyByEmp[a.empleado_supabase_id] = busyByEmp[a.empleado_supabase_id] || []).push([a.start_time, a.end_time || a.start_time])
        }
        // v2.16.2 (Fix 3) — slot grid in 15-min steps; required block = picked
        // service's duration_min (fallback 30). True overlap on [m, m+req] vs
        // each busy window. Reservar 60min a las 10:00 ahora bloquea 10:15,
        // 10:30, 10:45 — antes dejaba 10:30 libre y se doble-bookeaba.
        const stepMins = 15
        const picked = (services || []).find(s => s.supabase_id === service_supabase_id)
        const reqMins = Math.max(15, Number(picked?.duration_min) || 30)
        const toMin = (hhmm) => { const [h, m] = String(hhmm || '00:00').split(':').map(Number); return (h | 0) * 60 + (m | 0) }
        const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
        const slots = []
        for (const s of (schedules || [])) {
          const sm = toMin(s.start_time), em = toMin(s.end_time)
          const busy = busyByEmp[s.empleado_supabase_id] || []
          for (let m = sm; m + reqMins <= em; m += stepMins) {
            const blocked = busy.some(([bs, be]) => {
              const bsm = toMin(bs), bem = toMin(be)
              return m < bem && (m + reqMins) > bsm
            })
            if (!blocked) slots.push({ empleado_supabase_id: s.empleado_supabase_id, time: fromMin(m) })
          }
        }
        return {
          business_name: biz?.name || '',
          business_logo: biz?.logo_url || null,
          business_id: targetBid,
          services: (services || []).map(s => ({ supabase_id: s.supabase_id, name: s.name, price: Number(s.price) || 0, duration_min: Number(s.duration_min) || 30 })),
          stylists: (stylists || []).map(e => ({ supabase_id: e.supabase_id, name: e.nombre, photo: e.foto_url || null })),
          available_slots: slots,
        }
      }, null),
    },

    // ── Stylist Schedules ───────────────────────────────────────────────────

    stylistSchedules: {
      list: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('stylist_schedules').select('*').eq('business_id', bid).eq('active', true).order('empleado_id').order('day_of_week')) || []
        await attachRel(supabase, rows, { fkCol: 'empleado_supabase_id', targetTable: 'empleados', selectCols: 'nombre,tipo', asKey: 'empleados', businessId: bid })
        return rows
      }, []),
      byEmpleado: (empleadoId) => tryOr(async () => throwSupaError(await supabase.from('stylist_schedules').select('*').eq('business_id', bid).eq('empleado_id', empleadoId).eq('active', true).order('day_of_week')), []),
      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('stylist_schedules').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id').single())
        return row
      }),
      update: (id, data) => tryWrite(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('stylist_schedules').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      delete: (id) => tryWrite(async () => { throwSupaError(await supabase.from('stylist_schedules').update({ active: false }).eq('id', id).eq('business_id', bid)) }),
    },

    // ── Loans ───────────────────────────────────────────────────────────────

    loans: {
      list: (params) => tryOr(async () => {
        let q = supabase.from('loans').select('*').eq('business_id', bid)
        if (params?.status) q = q.eq('status', params.status)
        if (params?.clientId) q = q.eq('client_id', params.clientId)
        const rows = throwSupaError(await q.order('created_at', { ascending: false })) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name,phone,rnc', asKey: 'clients', businessId: bid })
        return rows
      }, []),
      getById: (id) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('loans').select('*').eq('id', id).eq('business_id', bid).single())
        if (!row) return null
        await attachRel(supabase, [row], { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name,phone,rnc', asKey: 'clients', businessId: bid })
        return row
      }),
      byClient: (clientId) => tryOr(async () => throwSupaError(await supabase.from('loans').select('*').eq('business_id', bid).eq('client_id', clientId).order('created_at', { ascending: false })), []),
      create: (data) => (async () => {
        // H6 — atomic loan + schedule via create_loan_with_schedule RPC.
        // Postgres function runs in an implicit transaction: if the schedule
        // INSERT loop fails, the loan row rolls back too (no orphans).
        // H10 — wraps online path in tryWriteOrQueue so a network drop
        // queues the RPC for replay on reconnect (idempotent via supabase_id).
        const method = data.method || 'french'
        const mora_rate_daily = data.mora_rate_daily ?? 0.005
        const loanSid = data.supabase_id || crypto.randomUUID()
        // Build amortization schedule client-side
        const P = Number(data.principal) || 0
        const n = Number(data.term_months) || 0
        const r = (Number(data.interest_rate) || 0) / 100
        const startDate = data.disbursed_at ? new Date(data.disbursed_at) : new Date()
        const dueOf = (i) => { const d = new Date(startDate); d.setMonth(d.getMonth() + i); return d.toISOString().slice(0, 10) }
        const rows = []
        if (method === 'flat') {
          const pe = P / n, ie = P * r
          for (let i = 1; i <= n; i++) rows.push({ installment_no: i, due_date: dueOf(i), principal_due: pe, interest_due: ie, total_due: pe + ie })
        } else if (method === 'balloon') {
          const ie = P * r
          for (let i = 1; i < n; i++) rows.push({ installment_no: i, due_date: dueOf(i), principal_due: 0, interest_due: ie, total_due: ie })
          rows.push({ installment_no: n, due_date: dueOf(n), principal_due: P, interest_due: ie, total_due: P + ie })
        } else {
          const M = r === 0 ? P / n : P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
          let bal = P
          for (let i = 1; i <= n; i++) {
            const ii = r === 0 ? 0 : bal * r
            const pp = Math.min(bal, M - ii)
            bal = Math.max(0, bal - pp)
            rows.push({ installment_no: i, due_date: dueOf(i), principal_due: Math.round(pp * 100) / 100, interest_due: Math.round(ii * 100) / 100, total_due: Math.round((pp + ii) * 100) / 100 })
          }
        }
        const scheduleArray = rows.map((sr, i) => ({
          installment_no: sr.installment_no ?? i + 1,
          due_date:       sr.due_date,
          principal_due:  sr.principal_due,
          interest_due:   sr.interest_due,
          total_due:      sr.total_due,
          paid_amount:    0,
          status:         'pending',
        }))
        const loanPayload = {
          supabase_id:         loanSid,
          client_supabase_id:  data.client_supabase_id || null,
          principal:           data.principal,
          term_months:         data.term_months,
          interest_rate:       data.interest_rate,
          monthly_payment:     data.monthly_payment ?? 0,
          status:              data.status || 'active',
          disbursed_at:        data.disbursed_at || null,
          next_due_date:       data.next_due_date || null,
          total_paid:          data.total_paid ?? 0,
          total_interest:      data.total_interest ?? 0,
          amortization_method: data.amortization_method || method,
          renewal_count:       data.renewal_count ?? 0,
          notes:               data.notes || null,
        }
        // H10 — RPC payload carries supabase_id on p_loan so a queue replay
        // is idempotent. We hand the *whole* RPC arg shape to the queue so
        // dispatchRow can call supabase.rpc(rpc_name, payload) verbatim.
        const rpcPayload = {
          supabase_id:   loanSid,           // for idempotency contract
          p_business_id: bid,
          p_loan:        loanPayload,
          p_schedule:    scheduleArray,
        }
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false
        if (offline) {
          await enqueueLendingWrite({
            table: 'loans', op: 'rpc',
            rpc_name: 'create_loan_with_schedule',
            payload: rpcPayload, business_id: bid,
          })
          return { id: null, supabase_id: loanSid, queued: true, offline: true }
        }
        let inserted = null
        const { data: rpcRet, error: rpcErr } = await supabase.rpc('create_loan_with_schedule', {
          p_business_id: bid,
          p_loan:        loanPayload,
          p_schedule:    scheduleArray,
        })
        if (rpcErr && isLendingNetworkError(rpcErr)) {
          await enqueueLendingWrite({
            table: 'loans', op: 'rpc',
            rpc_name: 'create_loan_with_schedule',
            payload: rpcPayload, business_id: bid,
          })
          return { id: null, supabase_id: loanSid, queued: true, error_was: rpcErr.message }
        }
        if (rpcErr) {
          const msg = String(rpcErr?.message || '')
          const missing = rpcErr?.code === '42883' || /create_loan_with_schedule.*does not exist/i.test(msg) || /Could not find the function/i.test(msg)
          if (!missing) throw rpcErr
          // Fallback: legacy two-step insert (non-atomic). Remove once RPC migration applied everywhere.
          console.warn('[loans] create_loan_with_schedule RPC missing, falling back to non-atomic two-step insert. Apply migration 20260426100002.')
          inserted = throwSupaError(await supabase.from('loans').insert({
            ...data, method, mora_rate_daily,
            supabase_id: loanSid, business_id: bid,
          }).select('id,supabase_id').single())
          if (rows.length) {
            const payload = rows.map(sr => ({ ...sr, supabase_id: crypto.randomUUID(), business_id: bid, loan_supabase_id: inserted.supabase_id }))
            try { throwSupaError(await supabase.from('loan_schedule').insert(payload)) } catch (e) { console.warn('[loans] schedule insert failed:', e?.message) }
          }
        } else {
          // Re-fetch row to preserve the caller-expected return shape ({ id, supabase_id, ... }).
          inserted = throwSupaError(await supabase.from('loans').select('*').eq('business_id', bid).eq('supabase_id', rpcRet || loanSid).maybeSingle())
            || { id: null, supabase_id: rpcRet || loanSid }
        }
        await logActivity({ event_type: 'loan_created', severity: 'warn', target_type: 'loan', target_id: inserted?.id, amount: Number(data.principal), metadata: { term_months: data.term_months, interest_rate: data.interest_rate, method } })
        return inserted
      })().catch(err => { console.error('[web.js loans.create]', err.message || err); throw err }),
      update: (id, data) => {
        const { id: _, supabase_id: __, business_id: ___, ...rest } = data
        return tryWriteOrQueue(
          { table: 'loans', op: 'update', payload: { id, supabase_id: data.supabase_id, ...rest }, business_id: bid },
          async () => { throwSupaError(await supabase.from('loans').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } },
        )
      },
      setStatus: (id, status) => tryWrite(async () => { throwSupaError(await supabase.from('loans').update({ status, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)) }),
    },

    // ── Loan Payments ───────────────────────────────────────────────────────

    loanPayments: {
      byLoan: (loanId) => tryOr(async () => throwSupaError(await supabase.from('loan_payments').select('*').eq('business_id', bid).eq('loan_id', loanId).order('payment_date', { ascending: false })), []),
      create: (data) => {
        // H10 — pre-generate supabase_id so re-flush is idempotent.
        const paymentSid = data.supabase_id || crypto.randomUUID()
        const payload = { ...data, supabase_id: paymentSid, business_id: bid }
        return tryWriteOrQueue(
          { table: 'loan_payments', op: 'insert', payload, business_id: bid },
          async () => {
            const row = throwSupaError(await supabase.from('loan_payments').insert(payload).select('id').single())
            if (data.loan_id) {
              const { data: loan } = await supabase.from('loans').select('total_paid').eq('id', data.loan_id).eq('business_id', bid).single()
              if (loan) await supabase.from('loans').update({ total_paid: (loan.total_paid || 0) + Number(data.amount), updated_at: new Date().toISOString() }).eq('id', data.loan_id).eq('business_id', bid)
            }
            return row
          },
        )
      },
      update: (id, data) => tryWrite(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('loan_payments').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
    },

    // ── Pawn Items ──────────────────────────────────────────────────────────

    pawnItems: {
      list: (params) => tryOr(async () => {
        let q = supabase.from('pawn_items').select('*').eq('business_id', bid)
        if (params?.status) q = q.eq('status', params.status)
        const rows = throwSupaError(await q.order('created_at', { ascending: false })) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name', asKey: 'clients', businessId: bid })
        await attachRel(supabase, rows, { fkCol: 'loan_supabase_id', targetTable: 'loans', selectCols: 'principal,status', asKey: 'loans', businessId: bid })
        return rows
      }, []),
      getById: (id) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('pawn_items').select('*').eq('id', id).eq('business_id', bid).single())
        if (!row) return null
        await attachRel(supabase, [row], { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name', asKey: 'clients', businessId: bid })
        await attachRel(supabase, [row], { fkCol: 'loan_supabase_id', targetTable: 'loans', selectCols: 'principal,status', asKey: 'loans', businessId: bid })
        return row
      }),
      create: (data) => {
        // H10 — papeleta + supabase_id pre-generated so offline create still
        // hands a real ticket_code back to the UI for printing.
        const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        const d = new Date()
        const yymmdd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
        let tail = ''; for (let i = 0; i < 4; i++) tail += ALPHA[Math.floor(Math.random() * ALPHA.length)]
        const ticket_code = data.ticket_code || `P${yymmdd}${tail}`
        const pawnSid = data.supabase_id || crypto.randomUUID()
        const payload = { ...data, ticket_code, supabase_id: pawnSid, business_id: bid }
        return tryWriteOrQueue(
          { table: 'pawn_items', op: 'insert', payload, business_id: bid },
          async () => throwSupaError(await supabase.from('pawn_items').insert(payload).select('id,ticket_code,supabase_id').single()),
        ).then(r => r?.queued ? { id: null, ticket_code, supabase_id: pawnSid, queued: true } : r)
      },
      update: (id, data) => {
        const { id: _, supabase_id: __, business_id: ___, ...rest } = data
        return tryWriteOrQueue(
          { table: 'pawn_items', op: 'update', payload: { id, supabase_id: data.supabase_id, ...rest }, business_id: bid },
          async () => { throwSupaError(await supabase.from('pawn_items').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } },
        )
      },
      setStatus: (id, status) => tryWrite(async () => {
        const patch = { status, updated_at: new Date().toISOString() }
        if (status === 'redeemed')  patch.redemption_date = new Date().toISOString()
        throwSupaError(await supabase.from('pawn_items').update(patch).eq('id', id).eq('business_id', bid))
        if (status === 'forfeited') await logActivity({ event_type: 'pawn_forfeited', severity: 'critical', target_type: 'pawn_item', target_id: id })
      }),
      byCode: (code) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('pawn_items').select('*').eq('business_id', bid).eq('ticket_code', code).maybeSingle())
        if (!row) return null
        await attachRel(supabase, [row], { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name,phone', asKey: 'clients', businessId: bid })
        return row
      }),
    },

    // ── Pawn Documents (fotos / dpi / matricula / firma / contrato / otro) ──
    pawnDocuments: {
      byPawn: (pawnSupabaseId) => tryOr(async () => {
        if (!pawnSupabaseId) return []
        return throwSupaError(await supabase.from('pawn_documents').select('*').eq('business_id', bid).eq('pawn_supabase_id', pawnSupabaseId).order('uploaded_at', { ascending: false }))
      }, []),
      // H10 — Storage uploads CANNOT be batched into the JSON queue
      // (binary blobs + signed-URL semantics + bucket policy). Instead,
      // we keep a dedicated `photos` IDB store with the File blob and
      // replay it via flushPendingPhotos() on reconnect. UI surfaces
      // toast: "Subir fotos requiere conexión. La prenda se guardó,
      // las fotos se subirán cuando vuelva el wifi."
      uploadPhoto: ({ pawnSupabaseId, file }) => tryWrite(async () => {
        if (!pawnSupabaseId || !file) return null
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false
        if (offline) {
          await enqueuePendingPhoto({ pawnSupabaseId, file, bucket: 'pawn-photos', business_id: bid, docType: 'foto', isPrivate: false })
          return { queued: true, queued_kind: 'photo', error: 'offline_storage' }
        }
        try {
          const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase()
          const path = `${bid}/${pawnSupabaseId}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`
          const { error } = await supabase.storage.from('pawn-photos').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
          if (error) throw error
          const { data: pub } = supabase.storage.from('pawn-photos').getPublicUrl(path)
          const file_url = pub?.publicUrl
          if (!file_url) throw new Error('No public URL')
          const row = throwSupaError(await supabase.from('pawn_documents').insert({
            supabase_id: crypto.randomUUID(),
            business_id: bid,
            pawn_supabase_id: pawnSupabaseId,
            doc_type: 'foto',
            file_url,
            mime_type: file.type || 'image/jpeg',
          }).select('id, supabase_id, file_url').single())
          return row
        } catch (err) {
          if (isLendingNetworkError(err)) {
            await enqueuePendingPhoto({ pawnSupabaseId, file, bucket: 'pawn-photos', business_id: bid, docType: 'foto', isPrivate: false })
            return { queued: true, queued_kind: 'photo', error: 'offline_storage', error_was: err.message }
          }
          throw err
        }
      }),
      uploadPrivate: ({ pawnSupabaseId, file, docType }) => tryWrite(async () => {
        if (!pawnSupabaseId || !file || !docType) return null
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false
        if (offline) {
          await enqueuePendingPhoto({ pawnSupabaseId, file, bucket: 'pawn-documents', business_id: bid, docType, isPrivate: true })
          return { queued: true, queued_kind: 'photo', error: 'offline_storage' }
        }
        try {
          const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase()
          const path = `${bid}/${pawnSupabaseId}/${docType}-${Date.now()}.${ext}`
          const { error } = await supabase.storage.from('pawn-documents').upload(path, file, { contentType: file.type, upsert: false })
          if (error) throw error
          const { data: signed } = await supabase.storage.from('pawn-documents').createSignedUrl(path, 60 * 60 * 24 * 365)
          const file_url = signed?.signedUrl || path
          const row = throwSupaError(await supabase.from('pawn_documents').insert({
            supabase_id: crypto.randomUUID(),
            business_id: bid,
            pawn_supabase_id: pawnSupabaseId,
            doc_type: docType,
            file_url,
            mime_type: file.type || null,
          }).select('id, supabase_id, file_url').single())
          return row
        } catch (err) {
          if (isLendingNetworkError(err)) {
            await enqueuePendingPhoto({ pawnSupabaseId, file, bucket: 'pawn-documents', business_id: bid, docType, isPrivate: true })
            return { queued: true, queued_kind: 'photo', error: 'offline_storage', error_was: err.message }
          }
          throw err
        }
      }),
      saveSignature: ({ pawnSupabaseId, dataUrl }) => {
        if (!pawnSupabaseId || !dataUrl) return Promise.resolve(null)
        // Signature is base64 dataURL stored as a regular pawn_documents row,
        // no storage bucket — cleanly queueable like any other insert.
        const sigSid = crypto.randomUUID()
        const payload = {
          supabase_id: sigSid,
          business_id: bid,
          pawn_supabase_id: pawnSupabaseId,
          doc_type: 'firma',
          file_url: dataUrl,
          mime_type: 'image/png',
        }
        return tryWriteOrQueue(
          { table: 'pawn_documents', op: 'insert', payload, business_id: bid },
          async () => throwSupaError(await supabase.from('pawn_documents').insert(payload).select('id, supabase_id').single()),
        )
      },
      delete: (id) => tryWrite(async () => { throwSupaError(await supabase.from('pawn_documents').delete().eq('id', id).eq('business_id', bid)) }),
    },

    // ── Pawn Listings (publicar prenda decomisada para venta) ────────────────
    pawnListings: {
      byPawn: (pawnSupabaseId) => tryOr(async () => {
        if (!pawnSupabaseId) return []
        return throwSupaError(await supabase.from('pawn_listings').select('*').eq('business_id', bid).eq('pawn_supabase_id', pawnSupabaseId).order('created_at', { ascending: false }))
      }, []),
      publish: ({ pawnSupabaseId, list_price, slug, list_price_override, override_reason }) => {
        const sid = crypto.randomUUID()
        const payload = {
          supabase_id: sid,
          business_id: bid,
          pawn_supabase_id: pawnSupabaseId,
          list_price: Number(list_price) || 0,
          slug,
          status: 'published',
          published_at: new Date().toISOString(),
          // C8 — track manual overrides of the legal 70% avalúo de remate.
          list_price_override: !!list_price_override,
          override_reason: override_reason || null,
        }
        return tryWriteOrQueue(
          { table: 'pawn_listings', op: 'insert', payload, business_id: bid },
          async () => throwSupaError(await supabase.from('pawn_listings').insert(payload).select('id, supabase_id, slug, status').single()),
        )
      },
      unpublish: (id) => tryWriteOrQueue(
        { table: 'pawn_listings', op: 'update', payload: { id, status: 'removed' }, business_id: bid },
        async () => { throwSupaError(await supabase.from('pawn_listings').update({ status: 'removed', updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } },
      ),
    },

    // ── Loan schedule (amortization rows) ────────────────────────────────────
    loanSchedule: {
      list: ({ loan_id }) => tryOr(async () => throwSupaError(
        await supabase.from('loan_schedule').select('*').eq('business_id', bid).eq('loan_id', loan_id).order('installment_no', { ascending: true })
      ), []),
      bulkCreate: (rows) => tryWrite(async () => {
        if (!Array.isArray(rows) || !rows.length) return { count: 0 }
        const payload = rows.map(r => ({ ...r, supabase_id: r.supabase_id || crypto.randomUUID(), business_id: bid }))
        throwSupaError(await supabase.from('loan_schedule').insert(payload))
        return { count: payload.length }
      }),
      markPaid: ({ id, paid_amount }) => tryWrite(async () => {
        throwSupaError(await supabase.from('loan_schedule').update({ paid_amount, paid_at: new Date().toISOString(), status: 'paid', updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
      }),
    },

    // ── Collections (overdue + CRM log + mora) ──────────────────────────────
    collections: {
      overdue: () => tryOr(async () => {
        const today = new Date().toISOString().slice(0, 10)
        const rows = throwSupaError(await supabase.from('loans')
          .select('*')
          .eq('business_id', bid)
          .eq('status', 'active')
          .lt('next_due_date', today)
          .order('next_due_date', { ascending: true })) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name,phone,rnc', asKey: 'clients', businessId: bid })
        return rows.map(r => ({
          ...r,
          client_name:  r.clients?.name  || null,
          client_phone: r.clients?.phone || null,
        }))
      }, []),
      // Web mora computation — same formula as desktop `loansComputeMora`.
      computeMora: () => tryOr(async () => {
        const today = new Date()
        const todayYmd = today.toISOString().slice(0, 10)
        const rows = throwSupaError(await supabase.from('loans')
          .select('id,principal,total_paid,mora_rate_daily,next_due_date')
          .eq('business_id', bid).eq('status', 'active')
          .lt('next_due_date', todayYmd))
        for (const l of rows || []) {
          const days = Math.max(0, Math.floor((today - new Date(l.next_due_date)) / 86400000))
          const outstanding = Math.max(0, Number(l.principal || 0) - Number(l.total_paid || 0))
          const mora = Math.round(outstanding * Number(l.mora_rate_daily || 0) * days * 100) / 100
          await supabase.from('loans').update({ days_late: days, mora_amount: mora, updated_at: new Date().toISOString() }).eq('id', l.id).eq('business_id', bid)
        }
        return (rows || []).length
      }, 0),
      logCreate: (data) => {
        const sid = data.supabase_id || crypto.randomUUID()
        const payload = { ...data, supabase_id: sid, business_id: bid }
        return tryWriteOrQueue(
          { table: 'collections_log', op: 'insert', payload, business_id: bid },
          async () => throwSupaError(await supabase.from('collections_log').insert(payload).select('id').single()),
        )
      },
      logList: ({ client_id, loan_id } = {}) => tryOr(async () => {
        let q = supabase.from('collections_log').select('*').eq('business_id', bid)
        if (client_id) q = q.eq('client_id', client_id)
        if (loan_id)   q = q.eq('loan_id', loan_id)
        const rows = throwSupaError(await q.order('contacted_at', { ascending: false }).limit(500)) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name', asKey: 'clients', businessId: bid })
        return rows.map(r => ({ ...r, client_name: r.clients?.name || null }))
      }, []),
      // v2.16.2 — structured attempts (collections_attempts). Mirrors INSERT
      // into legacy collections_log for one release transition.
      attemptCreate: ({ loan_supabase_id, loan_id, client_id, outcome, notes, next_followup_at, whatsapp_sent }) => {
        const attemptSid = crypto.randomUUID()
        const mirrorSid  = crypto.randomUUID()
        const attemptPayload = {
          supabase_id: attemptSid,
          business_id: bid,
          loan_supabase_id: loan_supabase_id || null,
          outcome,
          notes: notes || null,
          next_followup_at: next_followup_at || null,
          whatsapp_sent: !!whatsapp_sent,
        }
        const mirrorPayload = {
          supabase_id: mirrorSid,
          business_id: bid,
          client_id: client_id || null,
          loan_id: loan_id || null,
          channel: whatsapp_sent ? 'whatsapp' : 'call',
          outcome,
          notes: notes || null,
          next_contact_date: next_followup_at ? new Date(next_followup_at).toISOString().slice(0, 10) : null,
        }
        return tryWriteOrQueue(
          { table: 'collections_attempts', op: 'insert', payload: attemptPayload, business_id: bid },
          async () => {
            const row = throwSupaError(await supabase.from('collections_attempts').insert(attemptPayload).select('id, supabase_id').single())
            // Best-effort legacy mirror — also queue if it network-fails.
            try {
              await supabase.from('collections_log').insert(mirrorPayload)
            } catch (e) {
              if (isLendingNetworkError(e)) {
                try { await enqueueLendingWrite({ table: 'collections_log', op: 'insert', payload: mirrorPayload, business_id: bid }) } catch {}
              }
            }
            return row
          },
        )
      },
      attemptsByLoan: (loanSupabaseId) => tryOr(async () => {
        if (!loanSupabaseId) return []
        return throwSupaError(await supabase.from('collections_attempts')
          .select('*')
          .eq('business_id', bid)
          .eq('loan_supabase_id', loanSupabaseId)
          .order('attempt_at', { ascending: false })) || []
      }, []),
      lastAttempts: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('collections_attempts')
          .select('loan_supabase_id, outcome, attempt_at, next_followup_at')
          .eq('business_id', bid)
          .order('attempt_at', { ascending: false })
          .limit(1000)) || []
        const map = {}
        for (const r of rows) {
          if (!r.loan_supabase_id) continue
          if (!map[r.loan_supabase_id]) map[r.loan_supabase_id] = r
        }
        return map
      }, {}),
    },

    // ── Memberships (carwash monthly subscriptions) ─────────────────────────
    memberships: {
      list: (params = {}) => tryOr(async () => {
        let q = supabase.from('memberships')
          .select('*')
          .eq('business_id', bid)
        if (params.status)     q = q.eq('status', params.status)
        if (params.client_id)  q = q.eq('client_id', params.client_id)
        const rows = throwSupaError(await q.order('created_at', { ascending: false })) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name', asKey: 'clients', businessId: bid })
        await attachRel(supabase, rows, { fkCol: 'vehicle_supabase_id', targetTable: 'vehicles', selectCols: 'plate,make,model', asKey: 'vehicles', businessId: bid })
        return rows.map(r => ({
          ...r,
          client_name: r.clients?.name || null,
          vehicle_plate: r.vehicles?.plate || null,
          vehicle_make:  r.vehicles?.make  || null,
          vehicle_model: r.vehicles?.model || null,
        }))
      }, []),
      activeForClient: (clientSupabaseId) => tryOr(async () => {
        const today = new Date().toISOString().slice(0, 10)
        const rows = throwSupaError(await supabase.from('memberships')
          .select('*')
          .eq('business_id', bid)
          .eq('status', 'active')
          .eq('client_supabase_id', clientSupabaseId)
          .or(`end_date.is.null,end_date.gte.${today}`)
          .order('created_at', { ascending: false }))
        return rows || []
      }, []),
      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('memberships').insert({
          supabase_id: crypto.randomUUID(),
          business_id: bid,
          client_supabase_id: data.client_supabase_id || null,
          vehicle_supabase_id: data.vehicle_supabase_id || null,
          plan_name: data.plan_name,
          plan_price: Number(data.plan_price) || 0,
          wash_quota_per_month: Number(data.wash_quota_per_month) || 0,
          start_date: data.start_date || new Date().toISOString().slice(0, 10),
          end_date: data.end_date || null,
          status: data.status || 'active',
          notes: data.notes || null,
        }).select('id,supabase_id').single())
        return row
      }),
      update: (data) => tryWrite(async () => {
        const { id, ...rest } = data
        throwSupaError(await supabase.from('memberships').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        return { id }
      }),
      consume: ({ id }) => tryWrite(async () => {
        const { data: m } = await supabase.from('memberships').select('washes_used_this_period,wash_quota_per_month').eq('id', id).eq('business_id', bid).single()
        if (!m) return { ok: false, error: 'not_found' }
        if (m.washes_used_this_period >= m.wash_quota_per_month) return { ok: false, error: 'quota_exceeded', remaining: 0 }
        const newUsed = m.washes_used_this_period + 1
        throwSupaError(await supabase.from('memberships').update({ washes_used_this_period: newUsed, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        return { ok: true, remaining: m.wash_quota_per_month - newUsed }
      }),
      delete: ({ id }) => tryWrite(async () => {
        throwSupaError(await supabase.from('memberships').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        return true
      }),

      // v2.16.7 — Authoritative rolling-period advance via Supabase RPC.
      // Replaces the desktop-only `_membershipCurrentPeriod` SPOF so any
      // device (web tablet, second register, owner's phone) can advance
      // the period and every other device sees the same truth on next read.
      // The RPC is idempotent: it no-ops when period_end >= today.
      advancePeriod: (membership_supabase_id) => tryOr(async () => {
        if (!membership_supabase_id) return null
        const { data, error } = await supabase.rpc('carwash_memberships_advance_period', { membership_id: membership_supabase_id })
        if (error) throw error
        return data
      }),
    },

    // ── Wash Combos (punch-card N-wash bundles) ─────────────────────────────
    washCombos: {
      list: (params = {}) => tryOr(async () => {
        let q = supabase.from('wash_combos')
          .select('*')
          .eq('business_id', bid)
        if (params.status)    q = q.eq('status', params.status)
        if (params.client_id) q = q.eq('client_id', params.client_id)
        const rows = throwSupaError(await q.order('purchased_at', { ascending: false })) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name', asKey: 'clients', businessId: bid })
        await attachRel(supabase, rows, { fkCol: 'vehicle_supabase_id', targetTable: 'vehicles', selectCols: 'plate', asKey: 'vehicles', businessId: bid })
        return rows.map(r => ({ ...r, client_name: r.clients?.name, vehicle_plate: r.vehicles?.plate }))
      }, []),
      activeForClient: (clientSupabaseId) => tryOr(async () => {
        const today = new Date().toISOString().slice(0, 10)
        const rows = throwSupaError(await supabase.from('wash_combos')
          .select('*')
          .eq('business_id', bid).eq('status', 'active')
          .eq('client_supabase_id', clientSupabaseId)
          .or(`expires_at.is.null,expires_at.gte.${today}`)
          .order('purchased_at', { ascending: true }))
        return (rows || []).filter(r => r.used_washes < r.total_washes)
      }, []),
      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('wash_combos').insert({
          supabase_id: crypto.randomUUID(),
          business_id: bid,
          client_supabase_id: data.client_supabase_id || null,
          vehicle_supabase_id: data.vehicle_supabase_id || null,
          combo_name: data.combo_name,
          total_washes: Number(data.total_washes) || 0,
          purchase_price: Number(data.purchase_price) || 0,
          expires_at: data.expires_at || null,
          status: 'active',
          notes: data.notes || null,
        }).select('id,supabase_id').single())
        return row
      }),
      consume: ({ id }) => tryWrite(async () => {
        const { data: c } = await supabase.from('wash_combos').select('used_washes,total_washes').eq('id', id).eq('business_id', bid).single()
        if (!c) return { ok: false, error: 'not_found' }
        if (c.used_washes >= c.total_washes) return { ok: false, error: 'combo_exhausted' }
        const newUsed = c.used_washes + 1
        const newStatus = newUsed >= c.total_washes ? 'exhausted' : 'active'
        throwSupaError(await supabase.from('wash_combos').update({ used_washes: newUsed, status: newStatus, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        return { ok: true, remaining: c.total_washes - newUsed }
      }),
      delete: ({ id }) => tryWrite(async () => {
        throwSupaError(await supabase.from('wash_combos').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        return true
      }),
    },

    // ── Salon Memberships (templates — extends `memberships` additively) ─────
    // Carwash uses the same table with total_sessions IS NULL; salon rows have
    // total_sessions IS NOT NULL AND active_template = true. Filtering on both
    // guarantees vertical isolation.
    salonMemberships: {
      list: () => tryOr(async () => {
        // v2.16.2 (item #15) — prefer explicit vertical='salon'. Fallback to
        // the legacy heuristic for rows that haven't been backfilled yet.
        const rows = throwSupaError(await supabase.from('memberships')
          .select('*').eq('business_id', bid)
          .eq('active_template', true)
          .or('vertical.eq.salon,and(vertical.is.null,total_sessions.not.is.null)')
          .order('created_at', { ascending: false })) || []
        await attachRel(supabase, rows, { fkCol: 'service_supabase_id', targetTable: 'services', selectCols: 'name', asKey: 'services', businessId: bid })
        return rows.map(r => ({ ...r, service_name: r.services?.name || null }))
      }, []),
      create: ({ nombre, service_supabase_id, total_sessions, price_dop, validity_days }) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('memberships').insert({
          supabase_id: crypto.randomUUID(),
          business_id: bid,
          nombre: String(nombre || '').trim(),
          plan_name: String(nombre || '').trim(), // legacy column — keep populated for sync parity
          service_supabase_id: service_supabase_id || null,
          total_sessions: Number(total_sessions) || 0,
          price_dop: Number(price_dop) || 0,
          plan_price: Number(price_dop) || 0, // legacy mirror
          validity_days: Number(validity_days) || 365,
          active_template: true,
          status: 'active',
          vertical: 'salon', // v2.16.2 (item #15)
        }).select('id,supabase_id').single())
        return row
      }),
      update: (supabase_id, patch) => tryWrite(async () => {
        const allowed = ['nombre','service_supabase_id','total_sessions','price_dop','validity_days','active_template']
        const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)))
        if (clean.nombre != null) clean.plan_name = clean.nombre
        if (clean.price_dop != null) clean.plan_price = clean.price_dop
        clean.updated_at = new Date().toISOString()
        throwSupaError(await supabase.from('memberships').update(clean).eq('supabase_id', supabase_id).eq('business_id', bid))
        return { supabase_id }
      }),
      archive: (supabase_id) => tryWrite(async () => {
        throwSupaError(await supabase.from('memberships')
          .update({ active_template: false, updated_at: new Date().toISOString() })
          .eq('supabase_id', supabase_id).eq('business_id', bid))
        return { supabase_id }
      }),
    },

    // ── Per-client membership balances ──────────────────────────────────────
    clientMemberships: {
      byClient: (client_supabase_id) => tryOr(async () => {
        if (!client_supabase_id) return []
        const today = new Date().toISOString()
        const rows = throwSupaError(await supabase.from('client_memberships')
          .select('*').eq('business_id', bid)
          .eq('client_supabase_id', client_supabase_id)
          .gte('expires_at', today)
          .gt('sessions_remaining', 0)
          .order('expires_at', { ascending: true })) || []
        await attachRel(supabase, rows, { fkCol: 'membership_supabase_id', targetTable: 'memberships', selectCols: 'nombre,total_sessions,service_supabase_id', asKey: 'membership', businessId: bid })
        return rows.map(r => ({
          ...r,
          membership_nombre: r.membership?.nombre || null,
          membership_total_sessions: r.membership?.total_sessions || null,
          service_supabase_id: r.membership?.service_supabase_id || null,
        }))
      }, []),
      purchase: ({ client_supabase_id, membership_supabase_id, ticket_supabase_id }) => tryWrite(async () => {
        if (!client_supabase_id || !membership_supabase_id) throw new Error('client_supabase_id + membership_supabase_id required')
        const tpl = throwSupaError(await supabase.from('memberships')
          .select('total_sessions,validity_days,price_dop')
          .eq('supabase_id', membership_supabase_id).eq('business_id', bid).maybeSingle())
        if (!tpl) throw new Error('membership template not found')
        const validity = Number(tpl.validity_days) || 365
        const expires = new Date(Date.now() + validity * 24 * 60 * 60 * 1000).toISOString()
        const row = throwSupaError(await supabase.from('client_memberships').insert({
          supabase_id: crypto.randomUUID(),
          business_id: bid,
          client_supabase_id,
          membership_supabase_id,
          sessions_remaining: Number(tpl.total_sessions) || 0,
          expires_at: expires,
          ticket_supabase_id: ticket_supabase_id || null,
        }).select('*').single())
        return row
      }),
      consume: ({ client_membership_supabase_id, ticket_supabase_id, appointment_supabase_id }) => tryWrite(async () => {
        if (!client_membership_supabase_id || !ticket_supabase_id) throw new Error('client_membership_supabase_id + ticket_supabase_id required')
        // v2.16.1 patch (#8) — compare-and-swap; retry up to 3 times. Two
        // concurrent consumes used to both decrement from remaining=1 → 0
        // and both insert audit rows (second redemption free).
        let cm = null
        let updated = null
        for (let attempt = 0; attempt < 3; attempt++) {
          cm = throwSupaError(await supabase.from('client_memberships')
            .select('id,sessions_remaining,expires_at')
            .eq('supabase_id', client_membership_supabase_id).eq('business_id', bid).maybeSingle())
          if (!cm) return { ok: false, error: 'not_found' }
          if (Number(cm.sessions_remaining) <= 0) return { ok: false, error: 'no_sessions_remaining' }
          if (cm.expires_at && new Date(cm.expires_at) < new Date()) return { ok: false, error: 'expired' }
          const rows = throwSupaError(await supabase.from('client_memberships')
            .update({ sessions_remaining: cm.sessions_remaining - 1, updated_at: new Date().toISOString() })
            .eq('id', cm.id).eq('business_id', bid)
            .eq('sessions_remaining', cm.sessions_remaining)
            .select('id,sessions_remaining'))
          if (Array.isArray(rows) && rows.length > 0) { updated = rows[0]; break }
        }
        if (!updated) return { ok: false, error: 'concurrent_consume' }
        // Audit row
        const redemption = throwSupaError(await supabase.from('membership_redemptions').insert({
          supabase_id: crypto.randomUUID(),
          business_id: bid,
          client_membership_supabase_id,
          ticket_supabase_id,
          appointment_supabase_id: appointment_supabase_id || null,
        }).select('*').single())
        return { ok: true, remaining: updated.sessions_remaining, redemption }
      }),
      // v2.16.26 — DO NOT REVERT (FIX-LEDGER §Batch6). Cancel a client_membership.
      // Soft cancellation: sets sessions_remaining=0 + cancelled_at + cancelled_reason
      // + activity log entry. Optional refund_amount logs the cash returned.
      cancel: ({ client_membership_supabase_id, reason, refund_amount } = {}) => tryWrite(async () => {
        if (!client_membership_supabase_id) throw new Error('client_membership_supabase_id required')
        const { data: cm } = await supabase.from('client_memberships')
          .select('id, supabase_id, client_supabase_id, sessions_remaining, membership_supabase_id')
          .eq('supabase_id', client_membership_supabase_id).eq('business_id', bid).maybeSingle()
        if (!cm) return { ok: false, error: 'not_found' }
        const cancelledAt = new Date().toISOString()
        await supabase.from('client_memberships').update({
          sessions_remaining: 0,
          cancelled_at: cancelledAt,
          cancelled_reason: reason || null,
          updated_at: cancelledAt,
        }).eq('id', cm.id).eq('business_id', bid)
        await logActivity({
          event_type: 'membership_cancelled', severity: 'warn',
          target_type: 'client_membership', target_id: cm.id,
          amount: refund_amount != null ? -Math.abs(Number(refund_amount)) : null,
          reason: reason || 'Membership cancelled',
          metadata: {
            client_supabase_id: cm.client_supabase_id,
            membership_supabase_id: cm.membership_supabase_id,
            sessions_remaining_before: cm.sessions_remaining,
            refund_amount: refund_amount || 0,
          },
        })
        return { ok: true, refund_amount: refund_amount || 0 }
      }),

      // v2.16.26 — Issue a refund for a paid membership without cancelling it.
      // Logs to activity_log; caller is responsible for the cash/transfer flow.
      refund: ({ client_membership_supabase_id, amount, reason } = {}) => tryWrite(async () => {
        if (!client_membership_supabase_id) throw new Error('client_membership_supabase_id required')
        if (!amount || amount <= 0) throw new Error('positive amount required')
        const { data: cm } = await supabase.from('client_memberships')
          .select('id, client_supabase_id, membership_supabase_id, ticket_supabase_id')
          .eq('supabase_id', client_membership_supabase_id).eq('business_id', bid).maybeSingle()
        if (!cm) return { ok: false, error: 'not_found' }
        await logActivity({
          event_type: 'membership_refunded', severity: 'warn',
          target_type: 'client_membership', target_id: cm.id,
          amount: -Math.abs(Number(amount)),
          reason: reason || 'Membership refund',
          metadata: {
            client_supabase_id: cm.client_supabase_id,
            membership_supabase_id: cm.membership_supabase_id,
            original_ticket_supabase_id: cm.ticket_supabase_id,
          },
        })
        return { ok: true, amount }
      }),

      expiringSoon: (days = 14) => tryOr(async () => {
        const now = new Date()
        const horizon = new Date(now.getTime() + Number(days) * 24 * 60 * 60 * 1000).toISOString()
        const rows = throwSupaError(await supabase.from('client_memberships')
          .select('*').eq('business_id', bid)
          .gt('sessions_remaining', 0)
          .gte('expires_at', now.toISOString())
          .lte('expires_at', horizon)
          .order('expires_at', { ascending: true })) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name,phone', asKey: 'clients', businessId: bid })
        return rows
      }, []),
    },

    // ── Appointment reminders queue (24h / 2h / manual / confirm) ──────────
    appointmentReminders: {
      schedule: (appointment_supabase_id, fire_at, kind) => tryWrite(async () => {
        if (!appointment_supabase_id || !fire_at || !kind) throw new Error('appointment_supabase_id + fire_at + kind required')
        const row = throwSupaError(await supabase.from('appointment_reminders').insert({
          supabase_id: crypto.randomUUID(),
          business_id: bid,
          appointment_supabase_id,
          fire_at: typeof fire_at === 'string' ? fire_at : new Date(fire_at).toISOString(),
          kind,
          status: 'pending',
        }).select('*').single())
        return row
      }),
      pendingDue: (now) => tryOr(async () => {
        const cutoff = now ? (typeof now === 'string' ? now : new Date(now).toISOString()) : new Date().toISOString()
        const rows = throwSupaError(await supabase.from('appointment_reminders')
          .select('*').eq('business_id', bid).eq('status', 'pending')
          .lte('fire_at', cutoff)
          .order('fire_at', { ascending: true }).limit(25)) || []
        return rows
      }, []),
      recent: ({ days = 30 } = {}) => tryOr(async () => {
        const since = new Date(Date.now() - Math.max(1, Number(days) || 30) * 86400000).toISOString()
        const rows = throwSupaError(await supabase.from('appointment_reminders')
          .select('*').eq('business_id', bid)
          .gte('fire_at', since)
          .order('fire_at', { ascending: false }).limit(500)) || []
        return rows
      }, []),
      markSent: (id, ultramsg_message_id) => tryWrite(async () => {
        throwSupaError(await supabase.from('appointment_reminders')
          .update({ status: 'sent', ultramsg_message_id: ultramsg_message_id || null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', id).eq('business_id', bid))
        return { id, ok: true }
      }),
      markFailed: (id, error) => tryWrite(async () => {
        throwSupaError(await supabase.from('appointment_reminders')
          .update({ status: 'failed', error: String(error || '').slice(0, 500), updated_at: new Date().toISOString() })
          .eq('id', id).eq('business_id', bid))
        return { id, ok: true }
      }),
      // Helper invoked by appointments.create — schedules 24h + 2h rows. Skips
      // any whose fire_at is already < now+2h (e.g. same-day citas), so we
      // never enqueue a reminder that should have fired in the past.
      scheduleForAppointment: (appt) => tryOr(async () => {
        if (!appt?.supabase_id || !appt.date || !appt.start_time) return { scheduled: 0 }
        // v2.16.1 patch (#5) — pin DR TZ (-04:00, no DST). Without it Vercel
        // (UTC) computed reminders 4h early.
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
            const r = throwSupaError(await supabase.from('appointment_reminders').insert({
              supabase_id: crypto.randomUUID(),
              business_id: bid,
              appointment_supabase_id: appt.supabase_id,
              fire_at: new Date(w.fireMs).toISOString(),
              kind: w.kind,
              status: 'pending',
            }).select('id').single())
            if (r) out.push(r.id)
          } catch (e) {
            // v2.16.2 (item #11) — aggregate per-window errors so callers can
            // detect partial failure. Mirrors electron/database.js shape.
            console.warn('[reminders.scheduleForAppointment]', w.kind, e?.message || e)
            errors.push({ kind: w.kind, error: String(e?.message || e).slice(0, 300) })
          }
        }
        return { scheduled: out.length, ids: out, errors }
      }, { scheduled: 0, errors: [] }),
    },

    // ── Carniceria vertical (v2.16.3 web parity) ────────────────────────────
    // Mirrors electron/preload.js > carniceria.* exactly so RetailPOS + the
    // dedicated screens (FreshnessAlerts, RecurringOrders, Scales, Resumen)
    // work identically on terminalxpos.com/pos.
    carniceria: {
      cortes: {
        list: () => tryOr(async () => {
          // Tenant-scoped + global rows (business_id IS NULL) so seed templates show.
          const rows = throwSupaError(await supabase.from('carniceria_corte_categories')
            .select('*').or(`business_id.eq.${bid},business_id.is.null`).eq('active', true)
            .order('sort_order', { ascending: true }).order('especie', { ascending: true }).order('nombre', { ascending: true })) || []
          return rows.map(r => ({
            ...r,
            nutrition: r.nutrition_json ? (typeof r.nutrition_json === 'string' ? safeParseJSON(r.nutrition_json) : r.nutrition_json) : null,
          }))
        }, []),
        create: (data) => tryWrite(async () => {
          const row = throwSupaError(await supabase.from('carniceria_corte_categories').insert({
            supabase_id: crypto.randomUUID(),
            business_id: bid,
            nombre: String(data?.nombre || '').trim(),
            nombre_dr_popular: data?.nombre_dr_popular || null,
            tooltip_traduccion: data?.tooltip_traduccion || null,
            especie: data?.especie || 'otros',
            photo_url: data?.photo_url || null,
            nutrition_json: data?.nutrition_json
              ? (typeof data.nutrition_json === 'string' ? data.nutrition_json : JSON.stringify(data.nutrition_json))
              : null,
            sort_order: Number(data?.sort_order) || 0,
            active: true,
          }).select('id,supabase_id').single())
          return row
        }),
        update: (data) => tryWrite(async () => {
          if (!data?.id) throw new Error('id required')
          const allowed = ['nombre','nombre_dr_popular','tooltip_traduccion','especie','photo_url','nutrition_json','sort_order','active']
          const patch = {}
          for (const k of allowed) {
            if (k in data) {
              patch[k] = (k === 'nutrition_json' && data[k] && typeof data[k] !== 'string')
                ? JSON.stringify(data[k]) : data[k]
            }
          }
          if (!Object.keys(patch).length) return null
          patch.updated_at = new Date().toISOString()
          throwSupaError(await supabase.from('carniceria_corte_categories').update(patch).eq('id', data.id).eq('business_id', bid))
          return throwSupaError(await supabase.from('carniceria_corte_categories').select('*').eq('id', data.id).maybeSingle())
        }),
        remove: (id) => tryWrite(async () => {
          if (!id) throw new Error('id required')
          throwSupaError(await supabase.from('carniceria_corte_categories')
            .update({ active: false, updated_at: new Date().toISOString() })
            .eq('id', id).eq('business_id', bid))
          return { id, ok: true }
        }),
      },
      freshness: {
        list: () => tryOr(async () => {
          const rows = throwSupaError(await supabase.from('inventory_freshness_log')
            .select('*').eq('business_id', bid).gt('qty_remaining', 0)
            .order('expires_at', { ascending: true })) || []
          await attachRel(supabase, rows, { fkCol: 'inventory_item_supabase_id', targetTable: 'inventory_items', selectCols: 'name', asKey: '_item', businessId: bid })
          return rows.map(r => ({ ...r, item_name: r._item?.name || null }))
        }, []),
        create: (data) => tryWrite(async () => {
          const qty = Number(data?.qty_received) || 0
          const row = throwSupaError(await supabase.from('inventory_freshness_log').insert({
            supabase_id: crypto.randomUUID(),
            business_id: bid,
            inventory_item_supabase_id: data?.inventory_item_supabase_id || null,
            batch_lote: data?.batch_lote || null,
            received_at: data?.received_at || new Date().toISOString().slice(0,10),
            expires_at: data?.expires_at || null,
            qty_received: qty,
            qty_remaining: qty,
            unit: data?.unit || 'lb',
            auto_discount_applied: false,
          }).select('id,supabase_id').single())
          return row
        }),
        applyDiscount: ({ id, pct = 50 } = {}) => tryWrite(async () => {
          if (!id) throw new Error('id required')
          // 1. Fetch the freshness row.
          const f = throwSupaError(await supabase.from('inventory_freshness_log')
            .select('*').eq('id', id).eq('business_id', bid).maybeSingle())
          if (!f) throw new Error('freshness row not found')
          // 2. Mark batch as auto-discounted.
          throwSupaError(await supabase.from('inventory_freshness_log')
            .update({ auto_discount_applied: true, updated_at: new Date().toISOString() })
            .eq('id', id).eq('business_id', bid))
          // 3. Create promotion + promotion_items rows.
          const promoSid = crypto.randomUUID()
          throwSupaError(await supabase.from('promotions').insert({
            supabase_id: promoSid, business_id: bid,
            name: `Vence pronto -${pct}%`, tipo: 'auto_50_vence',
            discount_pct: Number(pct) || 50,
            start_date: new Date().toISOString().slice(0,10),
            end_date: f.expires_at,
            banner_text: `Lote ${f.batch_lote || ''} -${pct}% por vencimiento`,
            active: true,
          }))
          if (f.inventory_item_supabase_id) {
            throwSupaError(await supabase.from('promotion_items').insert({
              supabase_id: crypto.randomUUID(),
              promotion_supabase_id: promoSid,
              item_type: 'inventory_item',
              item_supabase_id: f.inventory_item_supabase_id,
            }))
          }
          return { ok: true, promotion_supabase_id: promoSid }
        }),
      },
      discards: {
        list: ({ since } = {}) => tryOr(async () => {
          let q = supabase.from('inventory_discards').select('*').eq('business_id', bid)
          if (since) q = q.gte('created_at', since)
          const rows = throwSupaError(await q.order('created_at', { ascending: false })) || []
          return rows
        }, []),
        create: (data) => tryWrite(async () => {
          const qty = Number(data?.qty) || 0
          const row = throwSupaError(await supabase.from('inventory_discards').insert({
            supabase_id: crypto.randomUUID(),
            business_id: bid,
            inventory_item_supabase_id: data?.inventory_item_supabase_id || null,
            freshness_log_supabase_id: data?.freshness_log_supabase_id || null,
            qty,
            unit: data?.unit || 'lb',
            motivo: data?.motivo || '',
            photo_url: data?.photo_url || null,
            empleado_supabase_id: data?.empleado_supabase_id || null,
          }).select('id,supabase_id').single())
          // Decrement freshness log qty_remaining if linked. Compare-and-clamp;
          // if the read fails or the row is gone, skip silently — the discard
          // itself succeeded and the remaining-qty drift is corrected by sync.
          if (data?.freshness_log_supabase_id && qty > 0) {
            try {
              const f = throwSupaError(await supabase.from('inventory_freshness_log')
                .select('id,qty_remaining').eq('supabase_id', data.freshness_log_supabase_id).eq('business_id', bid).maybeSingle())
              if (f) {
                const newQty = Math.max(0, Number(f.qty_remaining || 0) - qty)
                throwSupaError(await supabase.from('inventory_freshness_log')
                  .update({ qty_remaining: newQty, updated_at: new Date().toISOString() })
                  .eq('id', f.id).eq('business_id', bid))
              }
            } catch (e) { console.warn('[carniceria.discards.create] freshness decrement', e?.message || e) }
          }
          return row
        }),
      },
      recurring: {
        list: () => tryOr(async () => {
          const rows = throwSupaError(await supabase.from('recurring_orders')
            .select('*').eq('business_id', bid).eq('active', true)
            .order('dia_semana', { ascending: true }).order('nombre', { ascending: true })) || []
          return rows.map(r => ({
            ...r,
            items: r.items_json ? (typeof r.items_json === 'string' ? safeParseJSON(r.items_json) : r.items_json) : [],
          }))
        }, []),
        create: (data) => tryWrite(async () => {
          const row = throwSupaError(await supabase.from('recurring_orders').insert({
            supabase_id: crypto.randomUUID(),
            business_id: bid,
            client_supabase_id: data?.client_supabase_id || null,
            nombre: data?.nombre || '',
            dia_semana: data?.dia_semana ?? null,
            items_json: typeof data?.items_json === 'string' ? data.items_json : JSON.stringify(data?.items_json || []),
            total_estimado: data?.total_estimado != null ? Number(data.total_estimado) : null,
            whatsapp_confirmar: !!data?.whatsapp_confirmar,
            active: true,
          }).select('id,supabase_id').single())
          return row
        }),
        update: (data) => tryWrite(async () => {
          if (!data?.id) throw new Error('id required')
          const allowed = ['client_supabase_id','nombre','dia_semana','items_json','total_estimado','whatsapp_confirmar','active']
          const patch = {}
          for (const k of allowed) {
            if (k in data) {
              patch[k] = (k === 'items_json' && typeof data[k] !== 'string') ? JSON.stringify(data[k]) : data[k]
              if (k === 'whatsapp_confirmar' || k === 'active') patch[k] = !!data[k]
            }
          }
          if (!Object.keys(patch).length) return null
          patch.updated_at = new Date().toISOString()
          throwSupaError(await supabase.from('recurring_orders').update(patch).eq('id', data.id).eq('business_id', bid))
          return throwSupaError(await supabase.from('recurring_orders').select('*').eq('id', data.id).maybeSingle())
        }),
        remove: (id) => tryWrite(async () => {
          if (!id) throw new Error('id required')
          throwSupaError(await supabase.from('recurring_orders')
            .update({ active: false, updated_at: new Date().toISOString() })
            .eq('id', id).eq('business_id', bid))
          return { id, ok: true }
        }),
        markSent: ({ id } = {}) => tryWrite(async () => {
          if (!id) throw new Error('id required')
          throwSupaError(await supabase.from('recurring_orders')
            .update({ last_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', id).eq('business_id', bid))
          return { id, ok: true }
        }),
      },
      scales: {
        list: () => tryOr(async () => {
          const rows = throwSupaError(await supabase.from('carniceria_scales')
            .select('*').eq('business_id', bid).eq('active', true)
            .order('active_default', { ascending: false }).order('nombre', { ascending: true })) || []
          return rows
        }, []),
        create: (data) => tryWrite(async () => {
          const row = throwSupaError(await supabase.from('carniceria_scales').insert({
            supabase_id: crypto.randomUUID(),
            business_id: bid,
            nombre: data?.nombre || '',
            tipo: data?.tipo || 'plataforma',
            device_path: data?.device_path || null,
            protocol: data?.protocol || 'generic',
            baud_rate: Number(data?.baud_rate) || 9600,
            capacidad_max_lb: data?.capacidad_max_lb != null ? Number(data.capacidad_max_lb) : null,
            tare_default: Number(data?.tare_default) || 0,
            active_default: !!data?.active_default,
            active: true,
          }).select('id,supabase_id').single())
          return row
        }),
        update: (data) => tryWrite(async () => {
          if (!data?.id) throw new Error('id required')
          const allowed = ['nombre','tipo','device_path','protocol','baud_rate','capacidad_max_lb','tare_default','active_default','active']
          const patch = {}
          for (const k of allowed) {
            if (k in data) {
              patch[k] = (k === 'active_default' || k === 'active') ? !!data[k] : data[k]
            }
          }
          if (!Object.keys(patch).length) return null
          patch.updated_at = new Date().toISOString()
          throwSupaError(await supabase.from('carniceria_scales').update(patch).eq('id', data.id).eq('business_id', bid))
          return throwSupaError(await supabase.from('carniceria_scales').select('*').eq('id', data.id).maybeSingle())
        }),
        remove: (id) => tryWrite(async () => {
          if (!id) throw new Error('id required')
          throwSupaError(await supabase.from('carniceria_scales')
            .update({ active: false, updated_at: new Date().toISOString() })
            .eq('id', id).eq('business_id', bid))
          return { id, ok: true }
        }),
        setActiveDefault: (id) => tryWrite(async () => {
          if (!id) throw new Error('id required')
          // Two-step: clear all flags for this business, then set the chosen one.
          // Not atomic across rows, but sync layer reconciles via updated_at.
          throwSupaError(await supabase.from('carniceria_scales')
            .update({ active_default: false, updated_at: new Date().toISOString() })
            .eq('business_id', bid))
          throwSupaError(await supabase.from('carniceria_scales')
            .update({ active_default: true, updated_at: new Date().toISOString() })
            .eq('id', id).eq('business_id', bid))
          return { id, ok: true }
        }),
      },
      resumen: {
        // Mirrors electron/database.js > carniceriaResumenGet — same shape.
        get: () => tryOr(async () => {
          const todayStart = new Date(); todayStart.setHours(0,0,0,0)
          const sinceIso = todayStart.toISOString()
          // Pull tickets + items for today (non-voided) in one shot, then aggregate in JS.
          // Embedded join works here: ticket_items.ticket_id has a real FK to tickets.id on Supabase.
          const items = throwSupaError(await supabase.from('ticket_items')
            .select('name, price, quantity, weight, unit, cost, ticket:tickets!inner(id, status, created_at, total, client_id, business_id)')
            .eq('ticket.business_id', bid)
            .gte('ticket.created_at', sinceIso)
            .neq('ticket.status', 'voided')) || []
          // ventas_por_corte (top 5)
          const byName = {}
          for (const ti of items) {
            const k = ti.name || '—'
            const v = (Number(ti.price) || 0) * (Number(ti.quantity) || 1)
            byName[k] = (byName[k] || 0) + v
          }
          const ventas_por_corte = Object.entries(byName)
            .sort((a,b) => b[1] - a[1]).slice(0,5)
            .map(([label, value]) => ({ label, value }))
          // top_mayoreo (top 5 client totals)
          const tickets = throwSupaError(await supabase.from('tickets')
            .select('id, client_id, total, status, created_at, client:clients(name)')
            .eq('business_id', bid).gte('created_at', sinceIso).neq('status', 'voided')
            .not('client_id', 'is', null)) || []
          const byClient = {}
          for (const t of tickets) {
            const k = t.client?.name || `#${t.client_id}`
            byClient[k] = (byClient[k] || 0) + (Number(t.total) || 0)
          }
          const top_mayoreo = Object.entries(byClient)
            .sort((a,b) => b[1] - a[1]).slice(0,5)
            .map(([client_name, total]) => ({ client_name, total }))
          // lb_vendidas
          let lb_vendidas = 0
          for (const ti of items) {
            const u = String(ti.unit || '').toLowerCase()
            if (u === 'lb') lb_vendidas += Number(ti.weight) || 0
          }
          // margen_por_corte (top 5 by margin %)
          const marginAcc = {}
          for (const ti of items) {
            const k = ti.name || '—'
            const price = Number(ti.price) || 0
            const cost  = Number(ti.cost)  || 0
            if (!marginAcc[k]) marginAcc[k] = { p: 0, c: 0 }
            marginAcc[k].p += price; marginAcc[k].c += cost
          }
          const margen_por_corte = Object.entries(marginAcc)
            .map(([name, { p, c }]) => ({ name, margin_pct: p > 0 ? ((p - c) * 100) / p : 0 }))
            .sort((a,b) => b.margin_pct - a.margin_pct).slice(0,5)
          // mermas (kg + % of inventory)
          const discards = throwSupaError(await supabase.from('inventory_discards')
            .select('qty').eq('business_id', bid).gte('created_at', sinceIso)) || []
          const dQty = discards.reduce((s, r) => s + (Number(r.qty) || 0), 0)
          const inv = throwSupaError(await supabase.from('inventory_items')
            .select('quantity').eq('business_id', bid).eq('active', true)) || []
          const sQty = inv.reduce((s, r) => s + (Number(r.quantity) || 0), 0)
          const mermas = {
            kg: dQty * 0.453592,
            pct: sQty > 0 ? (dQty / sQty) * 100 : 0,
          }
          // Also expose rolled-up scalars the audit asked for.
          const ventas_hoy = tickets.reduce((s, t) => s + (Number(t.total) || 0), 0)
          const margen_pct = margen_por_corte.length
            ? margen_por_corte.reduce((s, r) => s + r.margin_pct, 0) / margen_por_corte.length : 0
          return {
            ventas_hoy, top_clientes_mayoreo: top_mayoreo, lb_vendidas, margen_pct,
            mermas, ventas_por_corte, top_mayoreo, margen_por_corte, biz: bid,
          }
        }, { ventas_hoy: 0, top_clientes_mayoreo: [], lb_vendidas: 0, margen_pct: 0, mermas: { kg: 0, pct: 0 }, ventas_por_corte: [], top_mayoreo: [], margen_por_corte: [], biz: bid }),
      },
    },

    // ── Generic offline write queue (H10) — debug + UI badge surface ────────
    lendingQueue: {
      peek:        () => _peekLendingQueue(),
      peekPhotos:  () => _peekPendingPhotos(),
      counts:      () => _getLendingQueueCounts(),
      flush:       () => _flushLendingQueue(supabase),
      flushPhotos: () => _flushPendingPhotos(supabase),
    },

    // ── Loan contracts (PDF — H10 carve-out: ONLINE ONLY) ────────────────────
    // PDF generation produces a Blob via pdf-lib; storage upload requires
    // a live signed URL; the contract row itself references the storage
    // path. Queueing the blob would explode IDB on real-world contract
    // packets (multi-MB) and we have no way to "patch" the contract URL
    // post-hoc once the upload finally succeeds. Caller MUST surface
    // toast: "Generar contrato requiere conexión" and refuse to proceed.
    // DO NOT add an offline path here without re-architecting the PDF
    // pipeline to defer rendering until reconnect.

    // ── Loan renewals (M2 — mirrored on desktop preload as `loanRenewals.*`) ─
    loanRenewals: {
      list: ({ businessId: _bizArg } = {}) => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('loan_renewals')
          .select('*').eq('business_id', bid)
          .order('renewed_at', { ascending: false })) || []
        return rows
      }, []),
      create: (data) => {
        const sid = crypto.randomUUID()
        const payload = {
          supabase_id: sid,
          business_id: bid,
          loan_supabase_id: data?.loan_supabase_id || null,
          renewal_count: Number(data?.renewal_count) || 0,
          interest_paid: data?.interest_paid != null ? Number(data.interest_paid) : null,
          new_due_date: data?.new_due_date || null,
          previous_due_date: data?.previous_due_date || null,
          renewed_at: data?.renewed_at || new Date().toISOString(),
          notes: data?.notes || null,
        }
        return tryWriteOrQueue(
          { table: 'loan_renewals', op: 'insert', payload, business_id: bid },
          async () => throwSupaError(await supabase.from('loan_renewals').insert(payload).select('id,supabase_id').single()),
        )
      },
    },

    // ── Service vertical: recurring billing ─────────────────────────────────
    subscriptions: {
      list: (params = {}) => tryOr(async () => {
        let q = supabase.from('subscriptions')
          .select('*')
          .eq('business_id', bid)
        if (params.status)    q = q.eq('status', params.status)
        if (params.clientId)  q = q.eq('client_id', params.clientId)
        if (params.dueWithinDays != null) {
          const d = new Date(); d.setDate(d.getDate() + Number(params.dueWithinDays))
          q = q.lte('next_billing_date', d.toISOString().slice(0, 10))
        }
        const rows = throwSupaError(await q.order('next_billing_date', { ascending: true })) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name', asKey: 'clients', businessId: bid })
        await attachRel(supabase, rows, { fkCol: 'service_supabase_id', targetTable: 'services', selectCols: 'name', asKey: 'services', businessId: bid })
        return rows.map(r => ({ ...r, client_name: r.clients?.name || null, service_name: r.services?.name || null }))
      }, []),
      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('subscriptions').insert({
          supabase_id: crypto.randomUUID(),
          business_id: bid,
          client_supabase_id:  data.client_supabase_id  || null,
          service_supabase_id: data.service_supabase_id || null,
          plan_name:        data.plan_name || null,
          interval_days:    Number(data.interval_days) || 30,
          amount:           Number(data.amount) || 0,
          start_date:       data.start_date || new Date().toISOString().slice(0, 10),
          next_billing_date:data.start_date || new Date().toISOString().slice(0, 10),
          status:          'active',
          notes:            data.notes || null,
        }).select('id,supabase_id').single())
        return row
      }),
      update: (data) => tryWrite(async () => {
        const { id, ...rest } = data
        throwSupaError(await supabase.from('subscriptions').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        return { id }
      }),
      markBilled: (id) => tryWrite(async () => {
        const { data: s } = await supabase.from('subscriptions').select('next_billing_date,interval_days').eq('id', id).eq('business_id', bid).single()
        if (!s) return null
        const next = new Date(s.next_billing_date + 'T12:00:00'); next.setDate(next.getDate() + (Number(s.interval_days) || 30))
        throwSupaError(await supabase.from('subscriptions').update({
          last_billed_at: new Date().toISOString(),
          next_billing_date: next.toISOString().slice(0, 10),
          updated_at: new Date().toISOString(),
        }).eq('id', id).eq('business_id', bid))
        return { id }
      }),
      delete: (id) => tryWrite(async () => {
        throwSupaError(await supabase.from('subscriptions').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        return true
      }),
    },

    // ── Service vertical: prepaid session packages ──────────────────────────
    servicePackages: {
      list: (params = {}) => tryOr(async () => {
        let q = supabase.from('service_packages')
          .select('*')
          .eq('business_id', bid)
        if (params.status)    q = q.eq('status', params.status)
        if (params.clientId)  q = q.eq('client_id', params.clientId)
        const rows = throwSupaError(await q.order('purchased_at', { ascending: false })) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name', asKey: 'clients', businessId: bid })
        await attachRel(supabase, rows, { fkCol: 'service_supabase_id', targetTable: 'services', selectCols: 'name', asKey: 'services', businessId: bid })
        return rows.map(r => ({ ...r, client_name: r.clients?.name || null, service_name: r.services?.name || null }))
      }, []),
      activeForClient: (clientSupabaseId) => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('service_packages')
          .select('*')
          .eq('business_id', bid).eq('status', 'active')
          .eq('client_supabase_id', clientSupabaseId)
          .order('purchased_at', { ascending: true })) || []
        await attachRel(supabase, rows, { fkCol: 'service_supabase_id', targetTable: 'services', selectCols: 'name', asKey: 'services', businessId: bid })
        return rows.filter(r => r.used_sessions < r.total_sessions)
          .map(r => ({ ...r, service_name: r.services?.name || null }))
      }, []),
      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('service_packages').insert({
          supabase_id: crypto.randomUUID(),
          business_id: bid,
          client_supabase_id:  data.client_supabase_id  || null,
          service_supabase_id: data.service_supabase_id || null,
          package_name:   data.package_name,
          total_sessions: Number(data.total_sessions) || 0,
          used_sessions:  0,
          purchase_price: Number(data.purchase_price) || 0,
          expires_at:     data.expires_at || null,
          status:        'active',
          notes:          data.notes || null,
        }).select('id,supabase_id').single())
        return row
      }),
      update: (data) => tryWrite(async () => {
        const { id, ...rest } = data
        throwSupaError(await supabase.from('service_packages').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        return { id }
      }),
      consume: ({ id }) => tryWrite(async () => {
        const { data: sp } = await supabase.from('service_packages').select('used_sessions,total_sessions,status').eq('id', id).eq('business_id', bid).single()
        if (!sp) return { ok: false, error: 'not_found' }
        if (sp.status !== 'active') return { ok: false, error: 'inactive' }
        if (sp.used_sessions >= sp.total_sessions) return { ok: false, error: 'exhausted', remaining: 0 }
        const newUsed = sp.used_sessions + 1
        const remaining = sp.total_sessions - newUsed
        throwSupaError(await supabase.from('service_packages').update({
          used_sessions: newUsed,
          status: remaining <= 0 ? 'exhausted' : 'active',
          updated_at: new Date().toISOString(),
        }).eq('id', id).eq('business_id', bid))
        return { ok: true, remaining }
      }),
      delete: (id) => tryWrite(async () => {
        throwSupaError(await supabase.from('service_packages').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        return true
      }),
    },

    // ── Service vertical: project / job tracker ────────────────────────────
    projects: {
      list: (params = {}) => tryOr(async () => {
        let q = supabase.from('projects').select('*').eq('business_id', bid)
        if (params.status)    q = q.eq('status', params.status)
        if (params.clientId)  q = q.eq('client_id', params.clientId)
        const rows = throwSupaError(await q.order('created_at', { ascending: false })) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name', asKey: 'clients', businessId: bid })
        return rows.map(r => ({ ...r, client_name: r.clients?.name || null }))
      }, []),
      byId: (id) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('projects').select('*').eq('business_id', bid).eq('id', id).maybeSingle())
        if (!row) return null
        await attachRel(supabase, [row], { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name', asKey: 'clients', businessId: bid })
        return { ...row, client_name: row.clients?.name || null }
      }, null),
      create: (data) => tryWrite(async () => {
        const row = throwSupaError(await supabase.from('projects').insert({
          supabase_id: crypto.randomUUID(),
          business_id: bid,
          client_supabase_id: data.client_supabase_id || null,
          name:        data.name,
          description: data.description || null,
          status:      data.status || 'draft',
        }).select('id,supabase_id').single())
        return row
      }),
      update: (data) => tryWrite(async () => {
        const { id, ...rest } = data
        if (rest.status === 'closed' && !rest.closed_at) rest.closed_at = new Date().toISOString()
        throwSupaError(await supabase.from('projects').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        return { id }
      }),
    },

    // ── Service vertical: client-specific rate overrides ───────────────────
    clientRates: {
      list: (params = {}) => tryOr(async () => {
        let q = supabase.from('client_service_rates').select('*').eq('business_id', bid)
        if (params.clientId) q = q.eq('client_id', params.clientId)
        const rows = throwSupaError(await q) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name', asKey: 'clients', businessId: bid })
        await attachRel(supabase, rows, { fkCol: 'service_supabase_id', targetTable: 'services', selectCols: 'name, price', asKey: 'services', businessId: bid })
        return rows.map(r => ({
          ...r,
          client_name:  r.clients?.name || null,
          service_name: r.services?.name || null,
          base_price:   r.services?.price ?? null,
        }))
      }, []),
      get: ({ clientSupabaseId, serviceSupabaseId }) => tryOr(async () => {
        if (!clientSupabaseId || !serviceSupabaseId) return null
        const row = throwSupaError(await supabase.from('client_service_rates')
          .select('custom_price')
          .eq('business_id', bid)
          .eq('client_supabase_id', clientSupabaseId)
          .eq('service_supabase_id', serviceSupabaseId)
          .maybeSingle())
        return row
      }, null),
      set: (data) => tryWrite(async () => {
        // Upsert on natural key (business_id, client_supabase_id, service_supabase_id)
        const existing = await supabase.from('client_service_rates')
          .select('id').eq('business_id', bid)
          .eq('client_supabase_id',  data.client_supabase_id)
          .eq('service_supabase_id', data.service_supabase_id).maybeSingle()
        if (existing.data?.id) {
          throwSupaError(await supabase.from('client_service_rates').update({
            custom_price: Number(data.custom_price) || 0,
            notes:        data.notes || null,
            updated_at:   new Date().toISOString(),
          }).eq('id', existing.data.id).eq('business_id', bid))
          return { id: existing.data.id }
        }
        const row = throwSupaError(await supabase.from('client_service_rates').insert({
          supabase_id: crypto.randomUUID(),
          business_id: bid,
          client_supabase_id:  data.client_supabase_id,
          service_supabase_id: data.service_supabase_id,
          custom_price: Number(data.custom_price) || 0,
          notes:        data.notes || null,
        }).select('id,supabase_id').single())
        return row
      }),
      delete: ({ id }) => tryWrite(async () => {
        throwSupaError(await supabase.from('client_service_rates').delete().eq('id', id).eq('business_id', bid))
        return true
      }),
    },

    // ── v2.5 — Per-client inventory item prices ─────────────────────────────
    // Mirrors clientRates but scoped to inventory. The POS path calls .list
    // with { clientId }; the admin UI also passes { clientSupabaseId } for
    // web-only callers. Either shape resolves — the join in attachRel fills
    // item/client names so the UI can render without a second round-trip.
    clientItemPrices: {
      list: (params = {}) => tryOr(async () => {
        let q = supabase.from('client_item_prices').select('*').eq('business_id', bid)
        if (params.clientSupabaseId) q = q.eq('client_supabase_id', params.clientSupabaseId)
        else if (params.clientId)    q = q.eq('client_supabase_id', params.clientId)
        const rows = throwSupaError(await q.order('created_at', { ascending: false })) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id',         targetTable: 'clients',          selectCols: 'name',              asKey: 'clients',         businessId: bid })
        await attachRel(supabase, rows, { fkCol: 'inventory_item_supabase_id', targetTable: 'inventory_items',  selectCols: 'name, sku, price',  asKey: 'inventory_items', businessId: bid })
        return rows.map(r => ({
          ...r,
          client_name: r.clients?.name || null,
          item_name:   r.inventory_items?.name || null,
          sku:         r.inventory_items?.sku  || null,
          base_price:  r.inventory_items?.price ?? null,
        }))
      }, []),
      get: ({ clientSupabaseId, itemSupabaseId }) => tryOr(async () => {
        if (!clientSupabaseId || !itemSupabaseId) return null
        const row = throwSupaError(await supabase.from('client_item_prices')
          .select('custom_price,notes,supabase_id')
          .eq('business_id', bid)
          .eq('client_supabase_id', clientSupabaseId)
          .eq('inventory_item_supabase_id', itemSupabaseId)
          .maybeSingle())
        return row
      }, null),
      set: (data) => tryWrite(async () => {
        const price = Number(data.custom_price)
        if (!Number.isFinite(price) || price <= 0) return null
        const existing = await supabase.from('client_item_prices')
          .select('id').eq('business_id', bid)
          .eq('client_supabase_id',         data.client_supabase_id)
          .eq('inventory_item_supabase_id', data.inventory_item_supabase_id).maybeSingle()
        if (existing.data?.id) {
          throwSupaError(await supabase.from('client_item_prices').update({
            custom_price: price,
            notes:        data.notes || null,
            updated_at:   new Date().toISOString(),
          }).eq('id', existing.data.id).eq('business_id', bid))
          return { id: existing.data.id }
        }
        const row = throwSupaError(await supabase.from('client_item_prices').insert({
          supabase_id:                 crypto.randomUUID(),
          business_id:                 bid,
          client_supabase_id:          data.client_supabase_id,
          inventory_item_supabase_id:  data.inventory_item_supabase_id,
          custom_price:                price,
          notes:                       data.notes || null,
        }).select('id,supabase_id').single())
        return row
      }),
      delete: ({ id }) => tryWrite(async () => {
        throwSupaError(await supabase.from('client_item_prices').delete().eq('id', id).eq('business_id', bid))
        return true
      }),
      bulkImport: (rows) => tryWrite(async () => {
        const out = { ok: 0, skip: 0, errors: [] }
        if (!Array.isArray(rows)) return out
        // Resolve all rnc/sku keys up-front (two round-trips). Map is cheap.
        const rncs = [...new Set(rows.map(r => String(r.client_rnc || r.client || '').trim()).filter(Boolean))]
        const skus = [...new Set(rows.map(r => String(r.sku || r.barcode || '').trim()).filter(Boolean))]
        const clientsQ = rncs.length
          ? throwSupaError(await supabase.from('clients').select('supabase_id,rnc').eq('business_id', bid).in('rnc', rncs)) || []
          : []
        const itemsQ = skus.length
          ? throwSupaError(await supabase.from('inventory_items').select('supabase_id,sku,barcode').eq('business_id', bid).or(`sku.in.(${skus.map(s => `"${s}"`).join(',')}),barcode.in.(${skus.map(s => `"${s}"`).join(',')})`)) || []
          : []
        const byRnc = new Map(clientsQ.map(c => [c.rnc, c.supabase_id]))
        const bySku = new Map()
        for (const it of itemsQ) { if (it.sku) bySku.set(it.sku, it.supabase_id); if (it.barcode) bySku.set(it.barcode, it.supabase_id) }
        for (const r of rows) {
          try {
            const rnc = String(r.client_rnc || r.client || '').trim()
            const sku = String(r.sku || r.barcode || '').trim()
            const csid = byRnc.get(rnc)
            const iisid = bySku.get(sku)
            const price = Number(r.custom_price)
            if (!csid || !iisid || !Number.isFinite(price) || price <= 0) { out.skip++; continue }
            await (async () => {
              const existing = await supabase.from('client_item_prices').select('id')
                .eq('business_id', bid).eq('client_supabase_id', csid)
                .eq('inventory_item_supabase_id', iisid).maybeSingle()
              if (existing.data?.id) {
                throwSupaError(await supabase.from('client_item_prices').update({
                  custom_price: price, notes: r.notes || null, updated_at: new Date().toISOString(),
                }).eq('id', existing.data.id).eq('business_id', bid))
              } else {
                throwSupaError(await supabase.from('client_item_prices').insert({
                  supabase_id: crypto.randomUUID(), business_id: bid,
                  client_supabase_id: csid, inventory_item_supabase_id: iisid,
                  custom_price: price, notes: r.notes || null,
                }))
              }
            })()
            out.ok++
          } catch (e) { out.errors.push({ row: r, err: String(e && e.message || e) }) }
        }
        return out
      }),
    },

    // ── Carwash metrics (queue wait + top washers + vehicle history) ────────
    carwash: {
      queueWaitMetrics: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('queue')
          .select('created_at, tickets(doc_number)')
          .eq('business_id', bid).eq('status', 'waiting'))
        if (!rows?.length) return { avgWaitMin: 0, longestWaitMin: 0, longestTicketNo: null, count: 0 }
        const now = Date.now()
        let total = 0, longest = { ms: 0, docNo: null }
        for (const r of rows) {
          const ms = Math.max(0, now - new Date(r.created_at).getTime())
          total += ms
          if (ms > longest.ms) longest = { ms, docNo: r.tickets?.doc_number || null }
        }
        return {
          avgWaitMin: Math.round((total / rows.length) / 60000),
          longestWaitMin: Math.round(longest.ms / 60000),
          longestTicketNo: longest.docNo,
          count: rows.length,
        }
      }, { avgWaitMin: 0, longestWaitMin: 0, longestTicketNo: null, count: 0 }),
      topWashers: (limit = 3) => tryOr(async () => {
        const ps = new Date(); ps.setDate(1); ps.setHours(0,0,0,0)
        const rows = throwSupaError(await supabase.from('washer_commissions')
          .select('ticket_id,commission_amount,empleado_supabase_id')
          .eq('business_id', bid)
          .gte('created_at', ps.toISOString())) || []
        await attachRel(supabase, rows, { fkCol: 'empleado_supabase_id', targetTable: 'empleados', selectCols: 'nombre', asKey: 'empleados', businessId: bid })
        const map = new Map()
        for (const r of rows) {
          const k = r.empleado_supabase_id
          if (!k) continue
          if (!map.has(k)) map.set(k, { name: r.empleados?.nombre || '—', ticket_ids: new Set(), total_commission: 0 })
          const agg = map.get(k)
          if (r.ticket_id) agg.ticket_ids.add(r.ticket_id)
          agg.total_commission += Number(r.commission_amount) || 0
        }
        return [...map.values()]
          .map(v => ({ name: v.name, ticket_count: v.ticket_ids.size, total_commission: v.total_commission }))
          .sort((a, b) => b.ticket_count - a.ticket_count || b.total_commission - a.total_commission)
          .slice(0, Number(limit) || 3)
      }, []),
      ticketsByClient: (clientId, limit = 10) => tryOr(async () => {
        // clientId may be numeric bigint id or supabase_id UUID — dual-key.
        const rows = throwSupaError(await supabase.from('tickets')
          .select('id, supabase_id, doc_number, total, status, created_at, vehicle_plate, client_id, client_supabase_id')
          .eq('business_id', bid)
          .or(`client_id.eq.${clientId},client_supabase_id.eq.${clientId}`)
          .order('created_at', { ascending: false })
          .limit(Math.min(Number(limit) || 10, 50)))
        if (!rows?.length) return []
        const tIds = [...new Set(rows.map(r => r.id).filter(Boolean))]
        const tSupIds = [...new Set(rows.map(r => r.supabase_id || r.id).filter(Boolean))]
        const itemsMap = {}
        if (tIds.length || tSupIds.length) {
          const orParts = []
          if (tIds.length) orParts.push(`ticket_id.in.(${tIds.join(',')})`)
          if (tSupIds.length) orParts.push(`ticket_supabase_id.in.(${tSupIds.map(v => `"${v}"`).join(',')})`)
          const { data: items } = await supabase.from('ticket_items').select('ticket_id,ticket_supabase_id,name').or(orParts.join(','))
          for (const i of (items || [])) {
            const key = i.ticket_id || i.ticket_supabase_id
            ;(itemsMap[key] ||= []).push(i.name)
          }
        }
        return rows.map(r => ({
          ...r,
          services: ((itemsMap[r.id] || itemsMap[r.supabase_id] || [])).join(' + '),
          washer_name: null,
        }))
      }, []),
    },

    // ── v2.17 — Food Truck: favorite stops + waste log ───────────────────────
    foodTruckLocations: {
      list: ({ activeOnly } = {}) => tryOr(async () => {
        let q = supabase.from('food_truck_locations').select('*').eq('business_id', bid)
        if (activeOnly) q = q.eq('active', true)
        q = q.order('name', { ascending: true })
        return throwSupaError(await q) || []
      }, []),

      create: (data) => tryWrite(async () => {
        if (!data?.name || !String(data.name).trim()) throw new Error('Nombre requerido')
        const sid = crypto.randomUUID()
        return throwSupaError(await supabase.from('food_truck_locations').insert({
          supabase_id: sid,
          business_id: bid,
          name:        String(data.name).trim(),
          lat:         data.lat != null ? Number(data.lat) : null,
          lng:         data.lng != null ? Number(data.lng) : null,
          notes:       data.notes || null,
          active:      data.active === false ? false : true,
        }).select('*').single())
      }),

      update: (id, patch) => tryWrite(async () => {
        const allowed = ['name','lat','lng','notes','active']
        const body = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)))
        if (!Object.keys(body).length) {
          return (await supabase.from('food_truck_locations').select('*').eq('id', id).eq('business_id', bid).maybeSingle())?.data || null
        }
        return throwSupaError(
          await supabase.from('food_truck_locations').update(body).eq('id', id).eq('business_id', bid).select('*').single()
        )
      }),

      delete: (id) => tryWrite(async () => {
        await supabase.from('food_truck_locations').delete().eq('id', id).eq('business_id', bid)
        return { ok: true }
      }),
    },

    wasteLog: {
      list: ({ dateFrom, dateTo, limit = 200 } = {}) => tryOr(async () => {
        let q = supabase.from('waste_log').select('*').eq('business_id', bid)
        if (dateFrom) q = q.gte('occurred_at', dateFrom)
        if (dateTo)   q = q.lte('occurred_at', dateTo)
        q = q.order('occurred_at', { ascending: false }).limit(Math.max(1, Math.min(1000, Number(limit) || 200)))
        return throwSupaError(await q) || []
      }, []),

      create: (data) => tryWrite(async () => {
        if (data?.qty == null || !Number.isFinite(Number(data.qty))) throw new Error('Cantidad requerida')
        if (!data?.reason || !String(data.reason).trim()) throw new Error('Motivo requerido')
        const sid = crypto.randomUUID()
        const row = throwSupaError(await supabase.from('waste_log').insert({
          supabase_id:                sid,
          business_id:                bid,
          inventory_item_supabase_id: data.inventory_item_supabase_id || null,
          qty:                        Number(data.qty),
          unit:                       data.unit || null,
          reason:                     String(data.reason).trim(),
          photo_url:                  data.photo_url || null,
          occurred_at:                data.occurred_at || new Date().toISOString(),
          cuadre_supabase_id:         data.cuadre_supabase_id || null,
          created_by:                 data.created_by || null,
        }).select('*').single())
        await logActivity({
          event_type: 'food_truck_waste_logged', severity: 'warn',
          target_type: 'waste_log', target_id: row.id, target_name: data.item_name || null,
          amount: Number(data.qty), reason: row.reason,
          metadata: { unit: row.unit, inventory_item_supabase_id: row.inventory_item_supabase_id },
        })
        return row
      }),

      delete: (id) => tryWrite(async () => {
        await supabase.from('waste_log').delete().eq('id', id).eq('business_id', bid)
        return { ok: true }
      }),
    },

    // ── Realtime subscriptions (Supabase Realtime) ───────────────────────────

    realtime: {
      subscribeQueue: (callback) => {
        const channel = supabase.channel('queue-changes')
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'queue',
            filter: `business_id=eq.${bid}`,
          }, (payload) => callback(payload))
          .subscribe()
        return () => supabase.removeChannel(channel)
      },

      subscribeTickets: (callback) => {
        const channel = supabase.channel('ticket-changes')
          .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'tickets',
            filter: `business_id=eq.${bid}`,
          }, (payload) => callback(payload))
          .subscribe()
        return () => supabase.removeChannel(channel)
      },

      subscribeInventory: (callback) => {
        const channel = supabase.channel('inventory-changes-' + bid)
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'inventory_items',
            filter: `business_id=eq.${bid}`,
          }, (payload) => callback(payload))
          .subscribe()
        return () => supabase.removeChannel(channel)
      },

      unsubscribeAll: () => {
        supabase.removeAllChannels()
      },
    },

    // ── Dashboard ────────────────────────────────────────────────────────────
    // Auth-bound replacement for the legacy services/supabase.js
    // fetchDashboardData (which read business_id + creds from localStorage).
    dashboard: {
      fetch: ({ since } = {}) => tryOr(async () => {
        const now       = new Date()
        const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
        const weekStart = new Date(now); weekStart.setDate(now.getDate() - 6); weekStart.setHours(0, 0, 0, 0)

        // If caller supplies a go-live cutoff newer than the 7d floor, clamp
        // up so imported historical rows stay hidden.
        const weekIso = weekStart.toISOString()
        const fromIso = since && since > weekIso ? since : weekIso

        const { data: rows } = await supabase
          .from('tickets')
          .select('total, itbis, payment_method, doc_number, client_name, ncf, ncf_type, status, paid_at, created_at, services_json, cajero_name')
          .eq('business_id', bid)
          .eq('status', 'cobrado')
          .gte('paid_at', fromIso)
          .order('paid_at', { ascending: false })

        const todayStr  = now.toDateString()
        const yesterStr = yesterday.toDateString()

        let todayRevenue = 0, todayCount = 0
        let yesterRevenue = 0, yesterCount = 0
        let weekRevenue = 0
        const payMap = {}

        for (const r of (rows || [])) {
          const d  = new Date(r.paid_at || r.created_at)
          const ds = d.toDateString()
          const amt = Number(r.total) || 0
          weekRevenue += amt
          const pm = r.payment_method || 'efectivo'
          payMap[pm] = (payMap[pm] || 0) + amt
          if (ds === todayStr)  { todayRevenue  += amt; todayCount++  }
          if (ds === yesterStr) { yesterRevenue += amt; yesterCount++ }
        }

        const recentTickets = (rows || []).slice(0, 15).map(r => ({
          doc_number:     r.doc_number,
          client_name:    r.client_name,
          total:          Number(r.total) || 0,
          ncf:            r.ncf,
          ncf_type:       r.ncf_type,
          payment_method: r.payment_method,
          cajero:         r.cajero_name || null,
          paid_at:        r.paid_at || r.created_at,
          services:       Array.isArray(r.services_json) ? r.services_json.map(s => s.name).join(', ') : '—',
        }))

        // RemoteDashboard expects an array of { method, total } — the desktop
        // path returns one too. Transform the accumulator map into that shape
        // and sort desc by total so the heaviest payment type renders first.
        const paymentBreakdown = Object.entries(payMap)
          .map(([method, total]) => ({ method, total }))
          .sort((a, b) => b.total - a.total)

        return {
          today:     { revenue: todayRevenue,  count: todayCount  },
          yesterday: { revenue: yesterRevenue, count: yesterCount },
          week:      { revenue: weekRevenue, count: (rows || []).length },
          recentTickets,
          paymentBreakdown,
        }
      }, null),
    },
  }

  // ── Contabilidad (firm-side accounting suite, Phase 1) ────────────────────
  // Mounted lazily so the import only runs in tenants where the file is used.
  // The createContabilidadAPI factory captures `supabase` + `businessId` once
  // and returns a flat method bag matching the future IPC surface.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./contabilidad.js')
    if (mod && typeof mod.createContabilidadAPI === 'function') {
      api.contabilidad = mod.createContabilidadAPI(supabase, businessId)
    }
  } catch {
    // ESM-only build path: dynamic import unavailable here. Fall back to the
    // promise-shaped ESM import so the namespace becomes available a tick
    // later — Bandeja/Cartera read it lazily on first call.
    import('./contabilidad.js').then((mod) => {
      if (mod && typeof mod.createContabilidadAPI === 'function') {
        api.contabilidad = mod.createContabilidadAPI(supabase, businessId)
      }
    }).catch(() => {})
  }

  return api
}

// ── Printer API (qz-tray integration for web) ────────────────────────────────

export function createWebPrinterAPI() {
  // Check if qz-tray is available (loaded via <script> tag or npm)
  function getQz() {
    return typeof qz !== 'undefined' ? qz : null
  }

  return {
    // print method for web — opens an HTML print preview with the browser's
    // native print dialog (shows "Microsoft Print to PDF" + any other printers).
    // Falls back gracefully when qz-tray isn't running.
    print: async ({ data, printerName }) => {
      // If data is an ESC/POS binary string, strip control chars and render as text
      const text = typeof data === 'string'
        ? data.replace(/[\x00-\x1F\x7F]/g, '').replace(/\n/g, '<br>')
        : 'Test print'
      const w = window.open('', '_blank', 'width=400,height=600')
      if (!w) return { success: false, error: 'Popup blocked' }
      w.document.write(`<!DOCTYPE html><html><head><title>Terminal X — Print</title>
        <style>body{font-family:'Courier New',monospace;font-size:12px;padding:20px;max-width:80mm;margin:0 auto;white-space:pre-wrap;}</style>
        </head><body>${text}</body></html>`)
      w.document.close()
      w.focus()
      w.print()
      return { success: true }
    },

    listPrinters: async () => {
      const q = getQz()
      if (!q) return []
      try {
        if (!q.websocket.isActive()) {
          await q.websocket.connect()
        }
        return await q.printers.find()
      } catch {
        return []
      }
    },

    openDrawer: async () => {
      const q = getQz()
      if (!q) return
      try {
        if (!q.websocket.isActive()) {
          await q.websocket.connect()
        }
        const printer = await q.printers.getDefault()
        if (!printer) return
        const config = q.configs.create(printer)
        // ESC/POS drawer kick: ESC p 0 25 250
        const drawerKick = [0x1B, 0x70, 0x00, 0x19, 0xFA]
        await q.print(config, [{ type: 'raw', format: 'hex', data: drawerKick.map(b => b.toString(16).padStart(2, '0')).join('') }])
      } catch { /* qz not connected or no printer */ }
    },

    testDrawerVariants: async (printerName) => {
      const q = getQz()
      if (!q) return
      try {
        if (!q.websocket.isActive()) {
          await q.websocket.connect()
        }
        const config = q.configs.create(printerName)
        // Try multiple drawer kick variants
        const variants = [
          [0x1B, 0x70, 0x00, 0x19, 0xFA],
          [0x1B, 0x70, 0x01, 0x19, 0xFA],
          [0x10, 0x14, 0x01, 0x00, 0x05],
        ]
        for (const v of variants) {
          await q.print(config, [{ type: 'raw', format: 'hex', data: v.map(b => b.toString(16).padStart(2, '0')).join('') }])
        }
      } catch { /* qz not connected or no printer */ }
    },

    // Extra helper for web: send raw ESC/POS buffer via qz-tray
    printRaw: async (printerName, buffer) => {
      const q = getQz()
      if (!q) return { ok: false, error: 'qz-tray not available' }
      try {
        if (!q.websocket.isActive()) {
          await q.websocket.connect()
        }
        const config = q.configs.create(printerName)
        const hex = Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('')
        await q.print(config, [{ type: 'raw', format: 'hex', data: hex }])
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err.message || 'Print failed' }
      }
    },
  }
}
