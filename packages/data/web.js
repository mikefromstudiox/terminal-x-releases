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
import { isBusinessSetting, isDeviceSetting, DEVICE_SETTING_KEYS } from '@terminal-x/services/settingsWhitelist'

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

async function tryOr(fn, fallback) {
  try {
    const result = await fn()
    // Supabase returns null for empty results — coerce to fallback
    if (result === null && fallback !== undefined) return fallback
    return result
  } catch (err) {
    console.error('[web.js]', err.message || err)
    if (fallback !== undefined) return fallback
    throw err
  }
}

/** For write operations: log and re-throw so callers see failures. */
async function tryWrite(fn) {
  try {
    return await fn()
  } catch (err) {
    console.error('[web.js WRITE]', err.message || err)
    throw err
  }
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
async function hashPin(pin) {
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
  const key = (typeof idOrSid === 'string' && idOrSid.includes('-')) ? 'supabase_id' : 'id'
  const val = key === 'id' ? Number(idOrSid) : idOrSid
  const { data: header } = await supabase.from('inventory_counts')
    .select('*').eq('business_id', bid).eq(key, val).maybeSingle()
  if (!header) return null
  const { data: items = [] } = await supabase.from('inventory_count_items')
    .select('*').eq('business_id', bid).eq('count_supabase_id', header.supabase_id)
    .order('category').order('name')
  return { ...header, items: items || [] }
}

async function refreshCountTotals(supabase, bid, countSid) {
  // Fetch raw row values and compute rollups in JS so the same math runs on web
  // and desktop. Supabase has generated cols but they're per-row — we still
  // need the SUM here to feed the header totals. Small dataset (≤ thousands of
  // items) keeps this fast.
  const { data = [] } = await supabase.from('inventory_count_items')
    .select('expected_qty, counted_qty, unit_cost')
    .eq('business_id', bid).eq('count_supabase_id', countSid)
  const totals = (data || []).reduce((acc, r) => {
    const exp = Number(r.expected_qty) || 0
    const cnt = (r.counted_qty === null || r.counted_qty === undefined) ? exp : Number(r.counted_qty)
    const cost = Number(r.unit_cost) || 0
    acc.total_expected_value += exp * cost
    acc.total_counted_value  += cnt * cost
    acc.total_variance_value += (cnt - exp) * cost
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

  // Shorthand: select from a table scoped to this business
  function from(table) {
    return supabase.from(table).select('*').eq('business_id', bid)
  }

  // ── Activity log (owner audit feed) helper ───────────────────────────────
  // Web mutations write log rows directly to Supabase; the module-level actor
  // is set via api.activity.setActor(...) from AuthContext on login.
  let _webActor = null
  async function logActivity(evt) {
    if (!evt || !evt.event_type) return
    try {
      const actor = _webActor || {}
      const nowIso = new Date().toISOString()
      await supabase.from('activity_log').insert({
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
      })
    } catch (e) { console.error('[activity_log web] failed:', e?.message || e) }
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
    if (!canActOn(actor.role, target.role)) return denyAndLog(op, 'No tienes permiso para editar este usuario', ctx)
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

  return {

    // ── Activity log ─────────────────────────────────────────────────────────
    activity: {
      setActor: (user) => { _webActor = user ? { id: user.id, name: user.name, role: user.role } : null },
      record: (evt) => logActivity(evt),
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
        const { data } = await supabase.from('businesses').select('id,name,rnc,address,phone,email,logo_url,settings').eq('id', bid).single()
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

      saveEmpresa: (data) => tryOr(async () => {
        const allowed = ['name', 'rnc', 'address', 'phone', 'email', 'logo', 'logo_url', 'settings']
        const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
        // Map `logo` → `logo_url` (Supabase column name differs from desktop)
        if ('logo' in patch) { patch.logo_url = patch.logo; delete patch.logo }
        if (!Object.keys(patch).length) return null
        throwSupaError(await supabase.from('businesses').update(patch).eq('id', bid))
      }),

      getUsuarios: () => tryOr(async () => {
        return throwSupaError(await supabase.from('staff').select('id,name,username,role,discount_pct,active').eq('business_id', bid).order('id'))
      }, []),

      saveUsuario: (data) => tryOr(async () => {
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
      }),

      deleteUsuario: ({ id }) => tryOr(async () => {
        throwSupaError(await supabase.from('staff').update({ active: false }).eq('id', id).eq('business_id', bid))
      }),

      getLavadores: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('empleados').select('id, supabase_id, nombre, comision_pct, active, cedula, phone, start_date').eq('business_id', bid).in('tipo', ['lavador', 'hybrid']).eq('active', true).order('nombre'))
        return (rows || []).map(r => ({ ...r, name: r.nombre, commission_pct: r.comision_pct }))
      }, []),

      saveLavador: (data) => tryOr(async () => {
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
      }),

      deleteLavador: ({ id }) => tryOr(async () => {
        throwSupaError(await supabase.from('empleados').update({ active: false }).eq('id', id).eq('business_id', bid))
      }),

      getVendedores: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('empleados').select('id, supabase_id, nombre, comision_pct, active, cedula, phone, start_date').eq('business_id', bid).in('tipo', ['vendedor', 'hybrid']).eq('active', true).order('nombre'))
        return (rows || []).map(r => ({ ...r, name: r.nombre, commission_pct: r.comision_pct }))
      }, []),

      saveVendedor: (data) => tryOr(async () => {
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
      }),

      deleteVendedor: ({ id }) => tryOr(async () => {
        throwSupaError(await supabase.from('empleados').update({ active: false }).eq('id', id).eq('business_id', bid))
      }),

      getServicios: () => tryOr(async () => {
        return throwSupaError(await supabase.from('services').select('*').eq('business_id', bid).order('category').order('sort_order').order('id'))
      }, []),

      saveServicio: (data) => tryOr(async () => {
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
      }),

      deleteServicio: ({ id }) => tryOr(async () => {
        throwSupaError(await supabase.from('services').update({ active: false }).eq('id', id).eq('business_id', bid))
      }),

      getCategorias: () => tryOr(async () => {
        return throwSupaError(await supabase.from('categorias_servicio').select('*').eq('business_id', bid).order('orden').order('nombre'))
      }, []),

      getSecuenciasNcf: () => tryOr(async () => {
        return throwSupaError(await supabase.from('ncf_sequences').select('*').eq('business_id', bid).order('type'))
      }, []),

      saveSecuenciaNcf: (data) => tryOr(async () => {
        if (data.type) {
          throwSupaError(await supabase.from('ncf_sequences').upsert({ ...data, business_id: bid }, { onConflict: 'business_id,type' }))
        }
      }),

      getConfiguracion: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('configuracion').select('clave,valor').eq('business_id', bid))
        return Object.fromEntries((rows || []).map(r => [r.clave, r.valor]))
      }, {}),

      saveConfiguracion: (data) => tryOr(async () => {
        const entries = Object.entries(data)
        for (const [clave, valor] of entries) {
          throwSupaError(await supabase.from('configuracion').upsert(
            { business_id: bid, clave, valor: String(valor) },
            { onConflict: 'business_id,clave' }
          ))
        }
      }),
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
      update: (obj) => tryOr(async () => {
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
      }),
    },

    // ── Inventory ────────────────────────────────────────────────────────────

    inventory: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('inventory_items').select('*').eq('business_id', bid).eq('active', true).order('name'))
      }, []),

      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('inventory_items').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }).select('id').single())
        return row.id
      }),

      update: (data) => tryOr(async () => {
        const { id, ...rest } = data
        // Normalize price_pedidos_ya: blank string → null so Supabase stores NULL
        if ('price_pedidos_ya' in rest) {
          rest.price_pedidos_ya = (rest.price_pedidos_ya === '' || rest.price_pedidos_ya == null)
            ? null : Number(rest.price_pedidos_ya)
        }
        rest.updated_at = new Date().toISOString()
        throwSupaError(await supabase.from('inventory_items').update(rest).eq('id', id).eq('business_id', bid))
      }),

      bulkUpdate: (ids, patch) => tryOr(async () => {
        if (!Array.isArray(ids) || !ids.length || !patch || !Object.keys(patch).length) return 0
        const clean = { ...patch }
        if ('price_pedidos_ya' in clean) {
          clean.price_pedidos_ya = (clean.price_pedidos_ya === '' || clean.price_pedidos_ya == null)
            ? null : Number(clean.price_pedidos_ya)
        }
        clean.updated_at = new Date().toISOString()
        throwSupaError(await supabase.from('inventory_items').update(clean).in('id', ids).eq('business_id', bid))
        return ids.length
      }, 0),

      delete: (data) => tryOr(async () => {
        const id = typeof data === 'object' ? data.id : data
        throwSupaError(await supabase.from('inventory_items').update({ active: false }).eq('id', id).eq('business_id', bid))
      }),

      adjust: ({ id, delta, notes, userId }) => tryOr(async () => {
        // Direct UPDATE + INSERT instead of a non-existent RPC.
        // Fetch current qty, compute new, update, log the transaction.
        const current = throwSupaError(await supabase.from('inventory_items').select('quantity, supabase_id, name').eq('id', id).eq('business_id', bid).single())
        const newQty = Math.max(0, (current.quantity || 0) + delta)
        throwSupaError(await supabase.from('inventory_items').update({ quantity: newQty }).eq('id', id).eq('business_id', bid))
        await logActivity({ event_type: 'inventory_adjusted', severity: 'info',
          target_type: 'inventory_item', target_id: id, target_name: current?.name || `#${id}`,
          amount: delta,
          old_value: current?.quantity != null ? String(current.quantity) : null,
          new_value: String(newQty),
          reason: notes || null })
        // Log the adjustment in inventory_transactions (non-blocking — stock already updated)
        try {
          await supabase.from('inventory_transactions').insert({
            supabase_id: crypto.randomUUID(),
            item_id: id,
            item_supabase_id: current.supabase_id || null,
            type: delta > 0 ? 'adjustment_in' : 'adjustment_out',
            delta,
            notes: notes || null,
            user_id: userId || null,
            business_id: bid,
          })
        } catch {}
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
    },

    // ── Conteo Fisico (v2.5) ────────────────────────────────────────────────
    // Mirrors the Electron inventoryCount namespace. Supabase has GENERATED
    // variance_* columns — never send them in inserts/updates; always read them
    // back from SELECT so the UI renders the same numbers on web and desktop.
    inventoryCount: {
      start: ({ title, counted_by_name, notes } = {}) => tryOr(async () => {
        const sid = crypto.randomUUID()
        const nowIso = new Date().toISOString()
        const headerTitle = (title && String(title).trim()) ||
          `Conteo Fisico ${new Date().toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })}`
        // Snapshot active inventory once — atomically stamps expected_qty,
        // unit_cost and unit_price so sales during the count don't poison the
        // baseline. Variance gets computed against this snapshot on Supabase.
        const items = throwSupaError(await supabase.from('inventory_items')
          .select('supabase_id, sku, name, category, quantity, cost, price')
          .eq('business_id', bid).eq('active', true)
          .order('category').order('name')) || []
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
      }),

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
      }, []),

      get: (idOrSid) => tryOr(async () => fetchCount(supabase, bid, idOrSid)),

      saveItem: ({ count_supabase_id, inventory_item_supabase_id, counted_qty, notes }) => tryOr(async () => {
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
      }),

      complete: ({ id, apply_to_inventory = true } = {}) => tryOr(async () => {
        if (!id) throw new Error('missing_id')
        const header = throwSupaError(await supabase.from('inventory_counts').select('*').eq('business_id', bid)
          .eq(typeof id === 'string' && id.includes('-') ? 'supabase_id' : 'id', typeof id === 'string' && id.includes('-') ? id : Number(id))
          .single())
        if (!header) throw new Error('count_not_found')
        if (header.status !== 'abierto') throw new Error('count_not_open')
        const countSid = header.supabase_id
        const nowIso = new Date().toISOString()

        // Fetch counted rows to apply + build metadata snapshot in one pass.
        const counted = throwSupaError(await supabase.from('inventory_count_items')
          .select('inventory_item_supabase_id, sku, name, category, expected_qty, counted_qty, unit_cost, unit_price, variance_qty, variance_cost')
          .eq('business_id', bid).eq('count_supabase_id', countSid)
          .not('counted_qty', 'is', null)) || []

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
      }),

      cancel: (id) => tryOr(async () => {
        const nowIso = new Date().toISOString()
        const key = (typeof id === 'string' && id.includes('-')) ? 'supabase_id' : 'id'
        const val = key === 'id' ? Number(id) : id
        throwSupaError(await supabase.from('inventory_counts').update({
          status: 'cancelado', completed_at: nowIso, updated_at: nowIso,
        }).eq('business_id', bid).eq(key, val).eq('status', 'abierto'))
        return true
      }),

      delete: (id) => tryOr(async () => {
        const header = throwSupaError(await supabase.from('inventory_counts').select('supabase_id').eq('business_id', bid)
          .eq(typeof id === 'string' && id.includes('-') ? 'supabase_id' : 'id', typeof id === 'string' && id.includes('-') ? id : Number(id))
          .maybeSingle())
        if (!header) return false
        // Delete items first — no ON DELETE CASCADE on Supabase to avoid
        // accidentally wiping historical counts on header edits.
        throwSupaError(await supabase.from('inventory_count_items').delete()
          .eq('business_id', bid).eq('count_supabase_id', header.supabase_id))
        throwSupaError(await supabase.from('inventory_counts').delete()
          .eq('business_id', bid).eq('supabase_id', header.supabase_id))
        return true
      }),
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

        for (const r of rows) {
          if (r.pin_locked_until && r.pin_locked_until > nowIso) continue
          const algo = r.pin_hash_algo || 'sha256'
          const hit = algo === 'bcrypt'
            ? bcryptComparePinWeb(pinStr, r.pin_salt, r.pin_hash)
            : r.pin_hash === legacyHash
          if (hit) { matched = r; break }
          tried.push(r.id)
        }

        if (matched) {
          const patch = {
            pin_failed_attempts: 0,
            pin_locked_until: null,
            updated_at: nowIso,
          }
          if ((matched.pin_hash_algo || 'sha256') !== 'bcrypt') {
            const newSalt = generatePinSaltWeb()
            patch.pin_hash      = bcryptHashPinWeb(pinStr, newSalt)
            patch.pin_salt      = newSalt
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
            } catch {}
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

      create: (data) => tryOr(async () => {
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
      }),

      update: (data) => tryOr(async () => {
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
      }),

      delete: ({ id }) => tryOr(async () => {
        await guardUserMutation('users:delete', { id })
        // Soft-delete only — hard-delete resurrects after the next desktop
        // sync push (desktop still has the row locally and upserts it back).
        const snap = await supabase.from('staff').select('name, username').eq('id', id).eq('business_id', bid).maybeSingle()
        const name = snap?.data ? `${snap.data.name} (@${snap.data.username})` : `#${id}`
        throwSupaError(await supabase.from('staff').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        await logActivity({ event_type: 'user_deleted', severity: 'warn', target_type: 'user', target_id: id, target_name: name })
        return { deleted: true }
      }),

      deleteHard: ({ id }) => tryOr(async () => {
        await guardUserMutation('users:delete-hard', { id })
        const snap = await supabase.from('staff').select('name, username').eq('id', id).eq('business_id', bid).maybeSingle()
        const name = snap?.data ? `${snap.data.name} (@${snap.data.username})` : `#${id}`
        throwSupaError(await supabase.from('staff').delete().eq('id', id).eq('business_id', bid))
        await logActivity({ event_type: 'user_hard_deleted', severity: 'critical', target_type: 'user', target_id: id, target_name: name, reason: 'force delete from Admin → Usuarios' })
        return { deleted: true, hard: true }
      }),
    },

    // ── Staff / Manager Authorization Card (v2.6) ────────────────────────────
    // Generate / revoke write the hash directly via the staff table — RLS
    // already scopes to business_id, and we re-guard role client-side. Verify
    // MUST go through the server endpoint because anon JWT can read the table
    // but we don't want the hash travelling over the wire.
    staff: {
      generateAuthCard: (id) => tryOr(async () => {
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
      }),

      revokeAuthCard: (id) => tryOr(async () => {
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
      }),

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

      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('categorias_servicio').insert({
          supabase_id: crypto.randomUUID(),
          nombre: data.nombre, orden: data.orden || 0, business_id: bid,
        }).select('id').single())
        return { id: row.id }
      }),

      update: (data) => tryOr(async () => {
        const { id, ...rest } = data
        const allowed = ['nombre', 'orden']
        const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
        throwSupaError(await supabase.from('categorias_servicio').update(patch).eq('id', id).eq('business_id', bid))
      }),

      delete: (id) => tryOr(async () => {
        const actualId = typeof id === 'object' ? id.id : id
        // Check if any services reference this category
        const { count } = await supabase.from('services').select('id', { count: 'exact', head: true })
          .eq('business_id', bid).eq('categoria_id', actualId)
        if (count > 0) throw new Error('Categoria tiene servicios asociados')
        throwSupaError(await supabase.from('categorias_servicio').delete().eq('id', actualId).eq('business_id', bid))
      }),
    },

    // ── Services ─────────────────────────────────────────────────────────────

    services: {
      all: () => tryOr(async () => {
        return throwSupaError(
          await supabase.from('services').select('*').eq('business_id', bid).eq('active', true)
            .order('category').order('sort_order').order('id')
        )
      }, []),

      allAdmin: () => tryOr(async () => {
        return throwSupaError(
          await supabase.from('services').select('*').eq('business_id', bid)
            .order('category').order('sort_order').order('id')
        )
      }, []),

      create: (data) => tryOr(async () => {
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
      }),

      update: (data) => tryOr(async () => {
        await requireOwnerOrManager('services:update')
        const { id, ...rest } = data
        const allowed = ['name', 'name_en', 'category', 'categoria_id', 'price', 'cost', 'aplica_itbis', 'is_wash', 'no_commission', 'commission_washer', 'commission_seller', 'commission_cashier', 'active', 'sort_order', 'is_menu_item', 'course', 'station', 'printer_route', 'happy_hour_price', 'happy_hour_start', 'happy_hour_end']
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
      }),

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
        const rows = throwSupaError(await supabase.from('empleados').select('id, supabase_id, nombre, comision_pct, phone, cedula, start_date, active').eq('business_id', bid).in('tipo', ['lavador', 'hybrid']).eq('active', true).order('nombre'))
        return (rows || []).map(r => ({ ...r, name: r.nombre, commission_pct: r.comision_pct }))
      }, []),

      allAdmin: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('empleados').select('id, supabase_id, nombre, comision_pct, phone, cedula, start_date, active').eq('business_id', bid).in('tipo', ['lavador', 'hybrid']).order('nombre'))
        return (rows || []).map(r => ({ ...r, name: r.nombre, commission_pct: r.comision_pct }))
      }, []),

      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('empleados').insert({
          supabase_id: crypto.randomUUID(),
          nombre: data.name ?? data.nombre, phone: data.phone || null, cedula: data.cedula || null,
          comision_pct: data.commission_pct ?? data.comision_pct ?? 20,
          start_date: data.start_date || null,
          tipo: 'lavador', role: 'none',
          active: true, business_id: bid,
        }).select('id').single())
        return { id: row.id }
      }),

      update: (data) => tryOr(async () => {
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
      }),
    },

    // ── Sellers ──────────────────────────────────────────────────────────────

    sellers: {
      all: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('empleados').select('id, supabase_id, nombre, comision_pct, phone, active').eq('business_id', bid).in('tipo', ['vendedor', 'hybrid']).eq('active', true).order('nombre'))
        return (rows || []).map(r => ({ ...r, name: r.nombre, commission_pct: r.comision_pct }))
      }, []),

      allAdmin: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('empleados').select('id, supabase_id, nombre, comision_pct, phone, active').eq('business_id', bid).in('tipo', ['vendedor', 'hybrid']).order('nombre'))
        return (rows || []).map(r => ({ ...r, name: r.nombre, commission_pct: r.comision_pct }))
      }, []),

      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('empleados').insert({
          supabase_id: crypto.randomUUID(),
          nombre: data.name ?? data.nombre,
          comision_pct: data.commission_pct ?? data.comision_pct ?? 5,
          phone: data.phone || null, tipo: 'vendedor', role: 'none',
          active: true, business_id: bid,
        }).select('id').single())
        return { id: row.id }
      }),

      update: (data) => tryOr(async () => {
        const { id, ...rest } = data
        const patch = {}
        if ('name' in rest)           patch.nombre = rest.name
        if ('nombre' in rest)         patch.nombre = rest.nombre
        if ('commission_pct' in rest) patch.comision_pct = rest.commission_pct
        if ('comision_pct' in rest)   patch.comision_pct = rest.comision_pct
        if ('phone' in rest)          patch.phone = rest.phone
        if ('active' in rest)         patch.active = !!rest.active
        throwSupaError(await supabase.from('empleados').update(patch).eq('id', id).eq('business_id', bid))
      }),
    },

    // ── Empleados (payroll) ────────────────────────────────────────────────

    empleados: {
      all: () => tryOr(async () => {
        return throwSupaError(await supabase.from('empleados').select('*').eq('business_id', bid).eq('active', true).order('nombre'))
      }, []),

      allAdmin: () => tryOr(async () => {
        return throwSupaError(await supabase.from('empleados').select('*').eq('business_id', bid).order('nombre'))
      }, []),

      create: (data) => tryOr(async () => {
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
      }),

      update: (data) => tryOr(async () => {
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
      }),

      delete: (id) => tryOr(async () => {
        await requireOwnerOrManager('empleados:delete')
        throwSupaError(await supabase.from('empleados').update({ active: false }).eq('id', id).eq('business_id', bid))
      }),

      // Mirror of electron hard-delete: try to remove outright, fall back to
      // soft-delete if FKs (payroll_runs / salary_changes / commissions) block
      // the delete. Returns { deleted: true } or { softDeleted: true, reason }.
      hardDelete: (id) => tryOr(async () => {
        const snap = await supabase.from('empleados').select('nombre, supabase_id').eq('id', id).eq('business_id', bid).maybeSingle()
        const name = snap?.data?.nombre || `#${id}`
        const empSid = snap?.data?.supabase_id
        if (empSid) {
          try { await supabase.from('salary_changes').delete().eq('business_id', bid).eq('empleado_supabase_id', empSid) } catch {}
        }
        const { error } = await supabase.from('empleados').delete().eq('id', id).eq('business_id', bid)
        if (!error) {
          await logActivity({ event_type: 'empleado_deleted', severity: 'warn', target_type: 'empleado', target_id: id, target_name: name })
          return { deleted: true }
        }
        try { throwSupaError(await supabase.from('empleados').update({ active: false }).eq('id', id).eq('business_id', bid)) } catch {}
        await logActivity({ event_type: 'empleado_deactivated', severity: 'warn', target_type: 'empleado', target_id: id, target_name: name, reason: error.message })
        return { softDeleted: true, reason: error.message }
      }),
    },

    // ── Payroll runs (paycheck history) ─────────────────────────────────────
    payrollRuns: {
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('payroll_runs').insert(
          buildPayrollRunRow(data, bid)
        ).select('id').single())
        // Auto-mark underlying commissions as paid
        if ((Number(data.commissions) || 0) > 0) {
          try { await markCommissionsPaidForEmpleado(supabase, bid, data.empleado_id, data.period_start, data.period_end) } catch (e) { console.error('[payrollRuns.create] markCommissionsPaid failed:', e.message) }
        }
        return { id: row.id }
      }),
      bulkCreate: (runs) => tryOr(async () => {
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
      }, { created: 0, ids: [] }),
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
      remove: (id) => tryOr(async () => {
        throwSupaError(await supabase.from('payroll_runs').delete().eq('id', id).eq('business_id', bid))
      }),
    },

    // ── Payroll settings (per-business config) ──────────────────────────────
    payrollSettings: {
      get: () => tryOr(async () => {
        const { data } = await supabase.from('payroll_settings').select('*').eq('business_id', bid).maybeSingle()
        if (!data) return null
        // Supabase returns isr_brackets already parsed (jsonb). Leave as-is.
        return data
      }, null),
      update: (data) => tryOr(async () => {
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
      }),
    },

    // ── Adelantos de nomina (salary advances) ──────────────────────────────
    adelantos: {
      create: (data) => tryOr(async () => {
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
      }),
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
      deduct: (id, payrollRunId) => tryOr(async () => {
        throwSupaError(await supabase.from('adelantos').update({
          status: 'deducido',
          deducted_from_payroll_id: payrollRunId,
          deducted_at: new Date().toISOString(),
        }).eq('id', id).eq('business_id', bid))
      }),
      cancel: (id) => tryOr(async () => {
        const { data: row } = await supabase.from('adelantos').select('amount').eq('id', id).eq('business_id', bid).maybeSingle()
        throwSupaError(await supabase.from('adelantos').update({ status: 'cancelado' })
          .eq('id', id).eq('business_id', bid).eq('status', 'pendiente'))
        if (row) {
          await logActivity({ event_type: 'adelanto_cancelled', severity: 'warn',
            target_type: 'adelanto', target_id: id,
            target_name: `Adelanto #${id}`,
            amount: row.amount })
        }
      }),
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
      create: (data) => tryOr(async () => {
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
      }),
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

      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('clients').insert({
          supabase_id: crypto.randomUUID(),
          name: data.name, rnc: data.rnc || null, phone: data.phone || null,
          email: data.email || null, address: data.address || null,
          credit_limit: data.credit_limit || 0, balance: 0, business_id: bid,
          loyalty_points: 0,
          allergies: data.allergies || null,
          preferred_stylist_supabase_id: data.preferred_stylist_supabase_id || null,
        }).select('id').single())
        return row
      }),

      update: (data) => tryOr(async () => {
        const { id, ...rest } = data
        const allowed = ['name', 'rnc', 'phone', 'email', 'address', 'credit_limit', 'balance', 'visits', 'total_spent', 'active', 'notes', 'loyalty_points', 'allergies', 'preferred_stylist_supabase_id']
        const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => allowed.includes(k)))
        if ('active' in patch) patch.active = !!patch.active
        throwSupaError(await supabase.from('clients').update(patch).eq('id', id).eq('business_id', bid))
      }),

      // v2.4 — Salon: atomic loyalty point mutation. Positive = earn, negative = redeem.
      addLoyaltyPoints: ({ id, delta }) => tryOr(async () => {
        const { data: cl } = await supabase.from('clients').select('loyalty_points').eq('id', id).eq('business_id', bid).single()
        const next = Math.max(0, Number(cl?.loyalty_points || 0) + Number(delta || 0))
        throwSupaError(await supabase.from('clients').update({ loyalty_points: next }).eq('id', id).eq('business_id', bid))
        return next
      }, 0),

      updateBalance: ({ id, delta }) => tryOr(async () => {
        const { data: cl } = await supabase.from('clients').select('balance').eq('id', id).eq('business_id', bid).single()
        if (cl) {
          const newBal = Math.max(0, (cl.balance || 0) + delta)
          throwSupaError(await supabase.from('clients').update({ balance: newBal }).eq('id', id).eq('business_id', bid))
        }
      }),

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
        // clientId is a Supabase row UUID — match either the row id or supabase_id
        // to remain backward compatible with both call sites.
        const { data: tickets } = await supabase.from('tickets')
          .select('*')
          .eq('business_id', bid)
          .or(`client_supabase_id.eq.${clientId},client_id.eq.${clientId}`)
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
      collect: (data) => tryOr(async () => {
        // Mirrors desktop collectCredit(): mark tickets paid, insert credit_payment,
        // decrease client balance. No RPC — done step-by-step.
        // Idempotency: caller can pass a precomputed supabase_id. If a row with
        // that supabase_id already exists for this business, we skip steps 1-2
        // (they ran on a prior attempt) and return the existing row.
        const { clientId, ticketIds, amount, paymentMethod, ncf, notes, cajeroId, supabase_id: callerSid } = data
        const sid = callerSid || crypto.randomUUID()

        if (callerSid) {
          const { data: existing } = await supabase.from('credit_payments')
            .select('id, supabase_id').eq('business_id', bid).eq('supabase_id', callerSid).maybeSingle()
          if (existing) return { id: existing.id, supabase_id: existing.supabase_id, idempotent: true }
        }

        // 1. Mark each ticket as 'cobrado' with the payment method.
        // v2.10.3 — bump rev so Supabase trg_tickets_rev_guard accepts the status change.
        for (const tid of (ticketIds || [])) {
          const { data: cur } = await supabase.from('tickets').select('rev').eq('id', tid).eq('business_id', bid).maybeSingle()
          const nextRev = Number(cur?.rev || 0) + 1
          await supabase.from('tickets').update({ status: 'cobrado', payment_method: paymentMethod, rev: nextRev })
            .eq('id', tid).eq('business_id', bid)
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
      }),
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
        if (tSids.length)  { const { data: ir } = await supabase.from('ticket_items').select('ticket_supabase_id, name, price, cost, is_wash, quantity, sku').in('ticket_supabase_id', tSids); for (const i of (ir || [])) { if (!itemsMap[i.ticket_supabase_id]) itemsMap[i.ticket_supabase_id] = []; itemsMap[i.ticket_supabase_id].push(i) } }

        // Fetch client names — supabase_id only
        const clientSids = [...new Set(rows.map(r => r.client_supabase_id).filter(Boolean))]
        let clientMap = {}
        if (clientSids.length) { const { data: cls } = await supabase.from('clients').select('supabase_id, name, rnc').in('supabase_id', clientSids); for (const c of (cls || [])) clientMap[c.supabase_id] = c }

        // Fetch cajero names — supabase_id only
        const cajeroSids = [...new Set(rows.map(r => r.cajero_supabase_id).filter(Boolean))]
        let cajeroMap = {}
        if (cajeroSids.length) { const { data: ur } = await supabase.from('staff').select('supabase_id, name').in('supabase_id', cajeroSids); for (const u of (ur || [])) cajeroMap[u.supabase_id] = u }

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
        try {
          return await tryOr(async () => {
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
              if (m) nextNum = parseInt(m[1]) + 1
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

            // Insert ticket
            const ticketSid = crypto.randomUUID()
            const ticket = throwSupaError(await supabase.from('tickets').insert({
              supabase_id:     ticketSid,
              business_id:     bid,
              doc_number:      docNum,
              client_supabase_id: data.client_supabase_id || null,
              washer_empleado_supabase_ids: washerSidsResolved,
              seller_empleado_supabase_id: sellerSidResolved,
              cajero_supabase_id: data.cajero_supabase_id || null,
              subtotal:        data.subtotal || 0,
              descuento:       data.descuento || 0,
              itbis:           data.itbis || 0,
              ley:             data.ley || 0,
              total:           data.total || 0,
              payment_method:  data.payment_method || 'cash',
              comprobante_type:data.comprobante_type || 'B02',
              ecf_result:      data.ecf_result || {},
              tipo_venta:      data.tipo_venta || 'contado',
              status,
              vehicle_plate:   data.vehicle_plate || null,
              notes:           data.notes || null,
              order_source:    data.order_source || 'pos',
              // v2.10.4 — restaurant split-bill persistence. JSONB column, so
              // pass the array as-is (no stringify). NULL = single-method
              // ticket. See supabase/migrations/20260420100000_*.sql.
              payment_parts:   (Array.isArray(data.payment_parts) && data.payment_parts.length) ? data.payment_parts : null,
              split_bill:      (data.split === true || (Array.isArray(data.payment_parts) && data.payment_parts.length > 1)) || false,
            }).select().single())

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
                name:               i.name,
                price:              i.price,
                cost:               i.cost != null ? Number(i.cost) : (i.service_id ? (svcCostById.get(i.service_id) || 0) : 0),
                itbis: (() => {
                  const aplica = i.aplica_itbis !== undefined ? i.aplica_itbis : (i.service_id ? (svcItbisById.get(i.service_id) ?? 1) : 1)
                  return aplica !== 0 ? parseFloat((i.price * itbisFactor).toFixed(2)) : 0
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

              // Auto-deduct inventory stock for product items (by supabase_id).
              // RPT-H4: when requested > available, record a shortage row in
              // inventory_oversells so void-time reversal restores only what was
              // actually deducted (fulfilled), never phantom stock.
              for (const item of items) {
                const invSid = item.inventory_item_supabase_id
                if (invSid) {
                  const qty = item.quantity || 1
                  try {
                    const { data: inv } = await supabase.from('inventory_items').select('quantity, name').eq('supabase_id', invSid).eq('business_id', bid).single()
                    if (inv) {
                      const available = Math.max(0, Number(inv.quantity || 0))
                      await supabase.from('inventory_items').update({ quantity: Math.max(0, available - qty) }).eq('supabase_id', invSid).eq('business_id', bid)
                      if (qty > available) {
                        try {
                          await supabase.from('inventory_oversells').insert({
                            supabase_id:        crypto.randomUUID(),
                            business_id:        bid,
                            ticket_supabase_id: ticketSid,
                            item_supabase_id:   invSid,
                            item_name:          inv.name || item.name || null,
                            requested_qty:      qty,
                            actual_qty:         available,
                          })
                        } catch (e2) { console.error('[web.js] oversell insert failed:', e2.message) }
                      }
                    }
                  } catch (e) { console.error('[web.js] stock deduction failed:', e.message) }
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
            if (ticket?.id && commBase > 0 && Array.isArray(data.washer_ids) && data.washer_ids.length) {
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
            if (ticket?.id && commBase > 0 && sellerRef) {
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

            // Cajero commission — on beverages/snacks ONLY.
            const cajeroRef = data.cajero_supabase_id || data.cajero_id || null
            if (ticket?.id && bevBase > 0 && cajeroRef) {
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
            if (status === 'pendiente' && data.client_supabase_id) {
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
            return { id: ticket.id, docNumber: docNum, ncf: null, queueError }
          })
        } catch (err) {
          // Supabase unreachable — save to offline queue
          const offlineId = await enqueueTicket(data)
          return { id: `offline-${offlineId}`, docNumber: 'OFFLINE', ncf: null, offline: true, offlineReason: err?.message || String(err) }
        }
      },

      markPaid: (data) => tryOr(async () => {
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
      }),

      void: (data) => tryOr(async () => {
        const { id, reason, voidBy } = typeof data === 'object' ? data : { id: data }
        const priorRow = (await supabase.from('tickets').select('supabase_id, doc_number, total, descuento, payment_method, tipo_venta, client_supabase_id, ncf, rev').eq('id', id).eq('business_id', bid).maybeSingle())?.data
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
            }
          }
        } catch (e) { console.error('[web.js] void stock reversal failed:', e.message) }
      }),

      byDateRange: (params) => tryOr(async () => {
        const dateFrom = params?.dateFrom ?? params?.from
        const dateTo   = params?.dateTo   ?? params?.to
        let q = supabase.from('tickets').select('*').eq('business_id', bid)
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo)
        q = q.order('created_at', { ascending: false }).limit(500)
        const rows = throwSupaError(await q)
        if (!rows?.length) return []

        // Fetch items — by ticket_supabase_id only
        const tSids  = [...new Set(rows.map(r => r.supabase_id).filter(Boolean))]
        const itemsMap = {}
        if (tSids.length)  { const { data: ir } = await supabase.from('ticket_items').select('ticket_supabase_id, name, price, cost, is_wash, quantity, sku').in('ticket_supabase_id', tSids); for (const i of (ir || [])) { if (!itemsMap[i.ticket_supabase_id]) itemsMap[i.ticket_supabase_id] = []; itemsMap[i.ticket_supabase_id].push(i) } }

        // Fetch client names — supabase_id only
        const clientSids = [...new Set(rows.map(r => r.client_supabase_id).filter(Boolean))]
        let clientMap = {}
        if (clientSids.length) { const { data: cls } = await supabase.from('clients').select('supabase_id, name, rnc').in('supabase_id', clientSids); for (const c of (cls || [])) clientMap[c.supabase_id] = c }

        // Fetch cajero names — supabase_id only
        const cajeroSids = [...new Set(rows.map(r => r.cajero_supabase_id).filter(Boolean))]
        let cajeroMap = {}
        if (cajeroSids.length) { const { data: ur } = await supabase.from('staff').select('supabase_id, name').in('supabase_id', cajeroSids); for (const u of (ur || [])) cajeroMap[u.supabase_id] = u }

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
        if (tSids.length)  { const { data: tr } = await supabase.from('tickets').select('id, supabase_id, doc_number, total, vehicle_plate, created_at, client_supabase_id').in('supabase_id', tSids); for (const t of (tr || [])) ticketMap[t.supabase_id] = t }

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
            doc_number:     t.doc_number    || null,
            total:          t.total          || 0,
            vehicle_plate:  t.vehicle_plate  || null,
            ticket_created: t.created_at     || null,
            client_name:    clientMap[cKey]?.name || null,
            client_phone:   clientMap[cKey]?.phone || null,
            services:       (itemsMap[tKey] || []).join(' + '),
            washer_name:    washerMap[wKey]   || null,
          }
        })
      }, []),

      updateStatus: (data) => tryOr(async () => {
        const { id, status, washerId } = data
        const now = new Date().toISOString()
        const patch = { status }
        // washerId is the lavador's empleados.supabase_id (UUID). Save it
        // regardless of status so a later listo→ready transition keeps the assignee.
        if (washerId) patch.washer_supabase_id = washerId
        if (status === 'in_progress') {
          patch.assigned_at = now
        } else if (status === 'done') {
          patch.completed_at = now
        }
        throwSupaError(await supabase.from('queue').update(patch).eq('id', id).eq('business_id', bid))
      }),

      delete: (data) => tryOr(async () => {
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
      }),
    },

    // ── Commissions ──────────────────────────────────────────────────────────

    commissions: {
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

        // Filter by date range + only unpaid (so re-running payroll doesn't double-pay).
        const from = dateFrom || '2000-01-01'
        const to   = dateTo   || '2099-12-31'
        const filtered = rows.filter(r => !r.paid && r.created_at >= from && r.created_at <= to)
        if (!filtered.length) return []

        // Fetch empleado names via empleado_supabase_id
        const empSids = [...new Set(filtered.map(r => r.empleado_supabase_id).filter(Boolean))]
        const empMap = {}
        if (empSids.length) {
          const { data: er } = await supabase.from('empleados').select('supabase_id, nombre, comision_pct').in('supabase_id', empSids)
          for (const e of (er || [])) empMap[e.supabase_id] = e
        }

        // Group by empleado
        const map = {}
        for (const r of filtered) {
          const wid = r.empleado_supabase_id
          const e = empMap[wid] || {}
          if (!map[wid]) map[wid] = { washer_id: wid, washer_name: e.nombre || '—', commission_pct: e.comision_pct || r.commission_pct || 0, ticket_count: 0, total_base: 0, total_commission: 0 }
          map[wid].ticket_count++
          map[wid].total_base       += r.base_amount || 0
          map[wid].total_commission += r.commission_amount || 0
        }
        return Object.values(map).sort((a, b) => b.total_commission - a.total_commission)
      }, []),

      markPaid: (ids) => tryOr(async () => {
        const now = new Date().toISOString()
        throwSupaError(await supabase.from('washer_commissions')
          .update({ paid: true, paid_at: now }).in('id', ids).eq('business_id', bid))
      }),

      // Mark all unpaid commissions within a period for a set of empleados as paid.
      // Used by NominaPagos bulk save to prevent re-running the same period
      // from double-counting commissions already included in a payroll run.
      markPaidByPeriod: ({ empleado_supabase_ids, from, to }) => tryOr(async () => {
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
      }, { updated: 0 }),
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
          .select('empleado_supabase_id, base_amount, commission_pct, commission_amount, created_at')
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
        const map = {}
        for (const r of filtered) {
          const sid = r.empleado_supabase_id
          const s = sMap[sid] || {}
          if (!map[sid]) map[sid] = { seller_id: sid, seller_name: s.nombre || '—', commission_pct: s.comision_pct || r.commission_pct || 0, ticket_count: 0, total_base: 0, total_commission: 0 }
          map[sid].ticket_count++; map[sid].total_base += r.base_amount || 0; map[sid].total_commission += r.commission_amount || 0
        }
        return Object.values(map).sort((a, b) => b.total_commission - a.total_commission)
      }, []),

      markPaid: (ids) => tryOr(async () => {
        const now = new Date().toISOString()
        throwSupaError(await supabase.from('seller_commissions')
          .update({ paid: true, paid_at: now }).in('id', ids).eq('business_id', bid))
      }),

      markPaidByPeriod: ({ empleado_supabase_ids, from, to }) => tryOr(async () => {
        if (!empleado_supabase_ids?.length) return { updated: 0 }
        const now = new Date().toISOString()
        const { data } = await supabase.from('seller_commissions')
          .update({ paid: true, paid_at: now })
          .eq('business_id', bid).eq('paid', false)
          .in('empleado_supabase_id', empleado_supabase_ids)
          .gte('created_at', from).lte('created_at', to + ' 23:59:59')
          .select('id')
        return { updated: (data || []).length }
      }, { updated: 0 }),

      create: (data) => tryOr(async () => {
        const sid = crypto.randomUUID()
        // Resolve empleado_supabase_id: prefer caller-provided, else look up by seller_supabase_id
        let empSid = data.empleado_supabase_id || null
        if (!empSid && data.seller_supabase_id) {
          const { data: emp } = await supabase.from('empleados').select('supabase_id').eq('supabase_id', data.seller_supabase_id).eq('business_id', bid).maybeSingle()
          empSid = emp?.supabase_id || data.seller_supabase_id
        }
        const row = throwSupaError(await supabase.from('seller_commissions').insert({
          supabase_id: sid,
          business_id: bid,
          empleado_supabase_id: empSid,
          ticket_supabase_id: data.ticket_supabase_id || null,
          base_amount: Number(data.base_amount || 0),
          commission_pct: Number(data.commission_pct || 0),
          commission_amount: Number(data.commission_amount || 0),
          paid: false,
        }).select('id').single())
        return { id: row.id, supabase_id: sid }
      }),
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
          if (!map[cid]) map[cid] = { cajero_id: cid, cajero_name: u.nombre || '—', commission_pct: u.comision_pct || r.commission_pct || 0, ticket_count: 0, total_base: 0, total_commission: 0 }
          map[cid].ticket_count++; map[cid].total_base += r.base_amount || 0; map[cid].total_commission += r.commission_amount || 0
        }
        return Object.values(map).sort((a, b) => b.total_commission - a.total_commission)
      }, []),

      markPaid: (ids) => tryOr(async () => {
        const now = new Date().toISOString()
        throwSupaError(await supabase.from('cajero_commissions')
          .update({ paid: true, paid_at: now }).in('id', ids).eq('business_id', bid))
      }),

      markPaidByPeriod: ({ empleado_supabase_ids, from, to }) => tryOr(async () => {
        if (!empleado_supabase_ids?.length) return { updated: 0 }
        const now = new Date().toISOString()
        const { data } = await supabase.from('cajero_commissions')
          .update({ paid: true, paid_at: now })
          .eq('business_id', bid).eq('paid', false)
          .in('empleado_supabase_id', empleado_supabase_ids)
          .gte('created_at', from).lte('created_at', to + ' 23:59:59')
          .select('id')
        return { updated: (data || []).length }
      }, { updated: 0 }),

      create: (data) => tryOr(async () => {
        const sid = crypto.randomUUID()
        // Resolve empleado_supabase_id: prefer caller-provided, else fall back to cajero_supabase_id
        const empSid = data.empleado_supabase_id || data.cajero_supabase_id || null
        const row = throwSupaError(await supabase.from('cajero_commissions').insert({
          supabase_id: sid,
          business_id: bid,
          empleado_supabase_id: empSid,
          ticket_supabase_id: data.ticket_supabase_id || null,
          base_amount: Number(data.base_amount || 0),
          commission_pct: Number(data.commission_pct || 0),
          commission_amount: Number(data.commission_amount || 0),
          paid: false,
        }).select('id').single())
        return { id: row.id, supabase_id: sid }
      }),
    },

    // ── Cuadre de Caja ───────────────────────────────────────────────────────

    cuadre: {
      create: (data) => tryOr(async () => {
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
      }),

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
        if (!rows) return { efectivo: 0, tarjeta: 0, transferencia: 0, cheque: 0, credito: 0, totalVendido: 0, totalCobrado: 0, count: 0 }
        // payment_method may come from desktop (Spanish: efectivo/tarjeta/...) OR
        // from web (English: cash/card/transfer/check/credit). Normalize both.
        const PM_ALIAS = {
          cash: 'efectivo', efectivo: 'efectivo',
          card: 'tarjeta',  tarjeta: 'tarjeta',
          transfer: 'transferencia', transferencia: 'transferencia',
          check: 'cheque',  cheque: 'cheque',
          credit: 'credito', credito: 'credito',
        }
        const result = { efectivo: 0, tarjeta: 0, transferencia: 0, cheque: 0, credito: 0 }
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
              if (pm !== 'credito') totalCobrado += amt
            }
          } else {
            const raw = r.payment_method || 'efectivo'
            const pm = PM_ALIAS[raw] || raw
            result[pm] = (result[pm] || 0) + tot
            if (pm !== 'credito') totalCobrado += tot
          }
        }
        return { ...result, totalVendido, totalCobrado, count: rows.length }
      }, { efectivo: 0, tarjeta: 0, transferencia: 0, cheque: 0, credito: 0, totalVendido: 0, totalCobrado: 0, count: 0 }),
    },

    // ── NCF ──────────────────────────────────────────────────────────────────

    ncf: {
      sequences: () => tryOr(async () => {
        return throwSupaError(await supabase.from('ncf_sequences').select('*').eq('business_id', bid).order('type'))
      }, []),

      next: (type) => tryOr(async () => {
        // Atomic NCF increment via RPC to prevent race conditions
        const result = throwSupaError(await supabase.rpc('atomic_next_ncf', {
          p_business_id: bid,
          p_type: type,
        }))
        return result // returns formatted NCF string like "E3100000001"
      }, null),

      updateSequence: (data) => tryOr(async () => {
        const { type, ...rest } = data
        if ('enabled' in rest) rest.enabled = !!rest.enabled
        if ('active'  in rest) rest.active  = !!rest.active
        throwSupaError(await supabase.from('ncf_sequences').update(rest).eq('business_id', bid).eq('type', type))
      }),
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

      create: (data) => tryOr(async () => {
        throwSupaError(await supabase.from('caja_chica').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }))
        await logActivity({ event_type: 'caja_chica_withdrawal',
          severity: Number(data.amount) >= 2000 ? 'warn' : 'info',
          target_type: 'caja_chica',
          target_name: data.description || data.category || 'Retiro',
          amount: data.amount, reason: data.category || null,
          metadata: { type: data.type, recibo: data.recibo || null, status: data.status } })
      }),

      updateStatus: (data) => tryOr(async () => {
        const { id, status, approvedBy } = data
        throwSupaError(await supabase.from('caja_chica').update({ status, approved_by: approvedBy }).eq('id', id).eq('business_id', bid))
      }),
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

      create: (data) => tryOr(async () => {
        throwSupaError(await supabase.from('notas_credito').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }))
        await logActivity({ event_type: 'nota_credito_created', severity: 'critical',
          target_type: 'nota_credito', target_name: data.ncf || 'NC',
          amount: data.amount, reason: data.motivo || null,
          metadata: { original_ticket_id: data.original_ticket_id || null, itbis_revertido: data.itbis_revertido, forma_devolucion: data.forma_devolucion } })
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

      addCompra: (data) => tryOr(async () => {
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
      }),

      deleteCompra: ({ id }) => tryOr(async () => {
        throwSupaError(await supabase.from('compras_607').delete().eq('id', id).eq('business_id', bid))
      }),
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
          .select('updated_at').eq('business_id', bid)
          .order('updated_at', { ascending: false }).limit(1).maybeSingle()
        return { count: count || 0, lastSync: lastRow?.updated_at || null }
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
        if (!r.ok) throw new Error(`UltraMsg ${r.status}`)
        return r.json()
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
        if (!r.ok) throw new Error(`UltraMsg ${r.status}`)
        return r.json()
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
        const res = await fetch('/api/ecf-sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ ...invoiceData, business_id: bid }),
        })
        const result = await res.json()
        if (!result.ok) throw new Error(result.error || 'Error firmando e-CF')
        return result.data
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

      checkStatus: (trackId) => tryOr(async () => {
        return { codigo: 3, estado: 'EN_PROCESO', mensajes: ['Status check not available on web'] }
      }),

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
        return { ok: true, environment: env }
      }),
    },

    // ── Auto-updater ─────────────────────────────────────────────────────────

    updater: {
      install:  () => Promise.resolve(), // web auto-updates via service worker
      onStatus: () => () => {},          // returns unsubscribe function (no-op)
    },

    // ── Restaurant Mode — Mesas (floor plan) ─────────────────────────────────

    mesas: {
      list: () => tryOr(async () => {
        return throwSupaError(
          await supabase.from('mesas').select('*').eq('business_id', bid).eq('active', true)
            .order('sort_order').order('name')
        )
      }, []),

      create: (data) => tryOr(async () => {
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
      }),

      update: (id, data) => tryOr(async () => {
        const allowed = ['name','zone','capacity','status','waiter_empleado_supabase_id','guests_count','seated_at','sort_order','active']
        const patch = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)))
        if ('active' in patch) patch.active = !!patch.active
        if (!Object.keys(patch).length) {
          return (await supabase.from('mesas').select('*').eq('id', id).eq('business_id', bid).maybeSingle())?.data || null
        }
        return throwSupaError(
          await supabase.from('mesas').update(patch).eq('id', id).eq('business_id', bid).select('*').single()
        )
      }),

      setStatus: (id, status, opts = {}) => tryOr(async () => {
        // Fetch seated_at so we stamp only on first transition into 'ocupada'
        const { data: cur } = await supabase.from('mesas')
          .select('seated_at,waiter_empleado_supabase_id,guests_count')
          .eq('id', id).eq('business_id', bid).maybeSingle()
        const patch = { status }
        if (opts.waiter_empleado_supabase_id !== undefined) patch.waiter_empleado_supabase_id = opts.waiter_empleado_supabase_id
        if (opts.guests_count                !== undefined) patch.guests_count                = opts.guests_count
        if (status === 'ocupada' && !(cur && cur.seated_at)) patch.seated_at = new Date().toISOString()
        return throwSupaError(
          await supabase.from('mesas').update(patch).eq('id', id).eq('business_id', bid).select('*').single()
        )
      }),

      delete: (id) => tryOr(async () => {
        // Soft-delete — match services.delete() semantics (LWW-friendly + safe).
        throwSupaError(await supabase.from('mesas').update({ active: false })
          .eq('id', id).eq('business_id', bid))
        return { deleted: true }
      }),
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

      create: (data) => tryOr(async () => {
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
      }),

      update: (id, data) => tryOr(async () => {
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
      }),

      delete: (id) => tryOr(async () => {
        throwSupaError(await supabase.from('modificadores').update({ active: false })
          .eq('id', id).eq('business_id', bid))
        return { deleted: true }
      }),

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

      attachToService: (serviceSupabaseId, modificadorSupabaseId, isRequired = 0) => tryOr(async () => {
        throwSupaError(await supabase.from('service_modificadores').insert({
          supabase_id: crypto.randomUUID(),
          service_supabase_id: serviceSupabaseId,
          modificador_supabase_id: modificadorSupabaseId,
          is_required: !!isRequired,
          business_id: bid,
        }))
      }),

      detachFromService: (serviceSupabaseId, modificadorSupabaseId) => tryOr(async () => {
        throwSupaError(await supabase.from('service_modificadores').delete()
          .eq('business_id', bid)
          .eq('service_supabase_id', serviceSupabaseId)
          .eq('modificador_supabase_id', modificadorSupabaseId))
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

      fire: (data) => tryOr(async () => {
        // Resolve ticket_item_supabase_id the same way desktop does, so the
        // FK stays intact even when the caller only hands us the integer id.
        let tiSid = data.ticket_item_supabase_id || null
        if (!tiSid && data.ticket_item_id) {
          const { data: ti } = await supabase.from('ticket_items').select('supabase_id')
            .eq('id', data.ticket_item_id).eq('business_id', bid).maybeSingle()
          tiSid = ti?.supabase_id || null
        }
        const row = throwSupaError(await supabase.from('kds_events').insert({
          supabase_id: crypto.randomUUID(),
          ticket_item_supabase_id: tiSid,
          mesa_supabase_id: data.mesa_supabase_id || null,
          station: data.station || null,
          status: 'fired',
          fired_at: new Date().toISOString(),
          business_id: bid,
        }).select('*').single())
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
        if (sids.length) { const { data: cs } = await supabase.from('clients').select('supabase_id, name').in('supabase_id', sids); for (const c of (cs || [])) cmap[c.supabase_id] = c }
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
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('vehicles').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('vehicles').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      delete: (id) => tryOr(async () => { throwSupaError(await supabase.from('vehicles').update({ active: false }).eq('id', id).eq('business_id', bid)) }),
      byClient: (clientId) => tryOr(async () => throwSupaError(await supabase.from('vehicles').select('*').eq('business_id', bid).eq('client_id', clientId).eq('active', true).order('created_at', { ascending: false })), []),
    },

    // ── Service Bays ────────────────────────────────────────────────────────

    serviceBays: {
      list: () => tryOr(async () => throwSupaError(await supabase.from('service_bays').select('*').eq('business_id', bid).eq('active', true).order('name')), []),
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('service_bays').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('service_bays').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      setStatus: (id, status, workOrderId) => tryOr(async () => { throwSupaError(await supabase.from('service_bays').update({ status, current_work_order_id: workOrderId || null, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)) }),
      delete: (id) => tryOr(async () => { throwSupaError(await supabase.from('service_bays').update({ active: false }).eq('id', id).eq('business_id', bid)) }),
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
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('work_orders').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }).select('id').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('work_orders').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      updateStatus: ({ id, status }) => tryWrite(async () => {
        const patch = { status, updated_at: new Date().toISOString() }
        if (status === 'completed' || status === 'closed' || status === 'facturado') patch.completed_date = new Date().toISOString()
        throwSupaError(await supabase.from('work_orders').update(patch).eq('id', id).eq('business_id', bid))
      }),
      setStatus: (id, status) => tryOr(async () => {
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
      delete: (id) => tryOr(async () => { throwSupaError(await supabase.from('work_orders').delete().eq('id', id).eq('business_id', bid)) }),
    },

    // ── Work Order Items ────────────────────────────────────────────────────

    workOrderItems: {
      byOrder: (workOrderId) => tryOr(async () => throwSupaError(await supabase.from('work_order_items').select('*').eq('business_id', bid).eq('work_order_id', workOrderId).order('created_at')), []),
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('work_order_items').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }).select('id').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('work_order_items').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      delete: (id) => tryOr(async () => { throwSupaError(await supabase.from('work_order_items').delete().eq('id', id).eq('business_id', bid)) }),
    },

    // ── Dealership: Vehicle Inventory (units for sale) ──────────────────────

    vehicleInventory: {
      list: (params) => tryOr(async () => {
        let q = supabase.from('vehicle_inventory').select('*').eq('business_id', bid).eq('active', true)
        if (params?.status) q = q.eq('status', params.status)
        return throwSupaError(await q.order('listing_date', { ascending: false }))
      }, []),
      getById: (id) => tryOr(async () => throwSupaError(await supabase.from('vehicle_inventory').select('*').eq('id', id).eq('business_id', bid).single())),
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('vehicle_inventory').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id, supabase_id').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('vehicle_inventory').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      setStatus: (id, status) => tryOr(async () => {
        const patch = { status, updated_at: new Date().toISOString() }
        if (status === 'sold') patch.sold_date = new Date().toISOString()
        throwSupaError(await supabase.from('vehicle_inventory').update(patch).eq('id', id).eq('business_id', bid))
      }),
      delete: (id) => tryOr(async () => { throwSupaError(await supabase.from('vehicle_inventory').update({ active: false }).eq('id', id).eq('business_id', bid)) }),
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
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('sales_deals').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id, supabase_id').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('sales_deals').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      close: (id, ticketInfo) => tryOr(async () => {
        const patch = { status: 'closed', closed_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        if (ticketInfo?.ticket_id) patch.ticket_id = ticketInfo.ticket_id
        if (ticketInfo?.ticket_supabase_id) patch.ticket_supabase_id = ticketInfo.ticket_supabase_id
        throwSupaError(await supabase.from('sales_deals').update(patch).eq('id', id).eq('business_id', bid))
      }),
      delete: (id) => tryOr(async () => { throwSupaError(await supabase.from('sales_deals').update({ active: false }).eq('id', id).eq('business_id', bid)) }),
    },

    // ── Dealership: Test Drives ─────────────────────────────────────────────

    testDrives: {
      list: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('test_drives').select('*').eq('business_id', bid).eq('active', true).order('scheduled_at', { ascending: false })) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name,phone', asKey: 'clients', businessId: bid })
        return rows
      }, []),
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('test_drives').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('test_drives').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      complete: (id, notes) => tryOr(async () => { throwSupaError(await supabase.from('test_drives').update({ completed_at: new Date().toISOString(), notes, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)) }),
      delete: (id) => tryOr(async () => { throwSupaError(await supabase.from('test_drives').update({ active: false }).eq('id', id).eq('business_id', bid)) }),
    },

    // ── Dealership: Leads / Sales Pipeline ──────────────────────────────────

    leads: {
      list: (params) => tryOr(async () => {
        let q = supabase.from('leads').select('*').eq('business_id', bid).eq('active', true)
        if (params?.stage) q = q.eq('stage', params.stage)
        return throwSupaError(await q.order('updated_at', { ascending: false }))
      }, []),
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('leads').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('leads').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      setStage: (id, stage, extra) => tryOr(async () => { throwSupaError(await supabase.from('leads').update({ stage, ...(extra || {}), updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)) }),
      delete: (id) => tryOr(async () => { throwSupaError(await supabase.from('leads').update({ active: false }).eq('id', id).eq('business_id', bid)) }),
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
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('appointments').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }).select('id').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('appointments').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      setStatus: (id, status) => tryOr(async () => { throwSupaError(await supabase.from('appointments').update({ status, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)) }),
      delete: (id) => tryOr(async () => { throwSupaError(await supabase.from('appointments').delete().eq('id', id).eq('business_id', bid)) }),
    },

    // ── Stylist Schedules ───────────────────────────────────────────────────

    stylistSchedules: {
      list: () => tryOr(async () => {
        const rows = throwSupaError(await supabase.from('stylist_schedules').select('*').eq('business_id', bid).eq('active', true).order('empleado_id').order('day_of_week')) || []
        await attachRel(supabase, rows, { fkCol: 'empleado_supabase_id', targetTable: 'empleados', selectCols: 'nombre,tipo', asKey: 'empleados', businessId: bid })
        return rows
      }, []),
      byEmpleado: (empleadoId) => tryOr(async () => throwSupaError(await supabase.from('stylist_schedules').select('*').eq('business_id', bid).eq('empleado_id', empleadoId).eq('active', true).order('day_of_week')), []),
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('stylist_schedules').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid, active: true }).select('id').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('stylist_schedules').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      delete: (id) => tryOr(async () => { throwSupaError(await supabase.from('stylist_schedules').update({ active: false }).eq('id', id).eq('business_id', bid)) }),
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
      create: (data) => tryOr(async () => {
        const method = data.method || 'french'
        const mora_rate_daily = data.mora_rate_daily ?? 0.005
        const loanSid = crypto.randomUUID()
        const inserted = throwSupaError(await supabase.from('loans').insert({
          ...data, method, mora_rate_daily,
          supabase_id: loanSid, business_id: bid,
        }).select('id,supabase_id').single())
        // Build + insert amortization schedule
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
        if (rows.length) {
          const payload = rows.map(sr => ({ ...sr, supabase_id: crypto.randomUUID(), business_id: bid, loan_supabase_id: inserted.supabase_id }))
          try { throwSupaError(await supabase.from('loan_schedule').insert(payload)) } catch (e) { console.warn('[loans] schedule insert failed:', e?.message) }
        }
        await logActivity({ event_type: 'loan_created', severity: 'warn', target_type: 'loan', target_id: inserted.id, amount: Number(data.principal), metadata: { term_months: data.term_months, interest_rate: data.interest_rate, method } })
        return inserted
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('loans').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      setStatus: (id, status) => tryOr(async () => { throwSupaError(await supabase.from('loans').update({ status, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)) }),
    },

    // ── Loan Payments ───────────────────────────────────────────────────────

    loanPayments: {
      byLoan: (loanId) => tryOr(async () => throwSupaError(await supabase.from('loan_payments').select('*').eq('business_id', bid).eq('loan_id', loanId).order('payment_date', { ascending: false })), []),
      create: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('loan_payments').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }).select('id').single())
        if (data.loan_id) {
          const { data: loan } = await supabase.from('loans').select('total_paid').eq('id', data.loan_id).eq('business_id', bid).single()
          if (loan) await supabase.from('loans').update({ total_paid: (loan.total_paid || 0) + Number(data.amount), updated_at: new Date().toISOString() }).eq('id', data.loan_id).eq('business_id', bid)
        }
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('loan_payments').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
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
      create: (data) => tryOr(async () => {
        // Web-side papeleta ticket code — same PYYMMDDxxxx format as desktop
        const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        const d = new Date()
        const yymmdd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
        let tail = ''; for (let i = 0; i < 4; i++) tail += ALPHA[Math.floor(Math.random() * ALPHA.length)]
        const ticket_code = data.ticket_code || `P${yymmdd}${tail}`
        const row = throwSupaError(await supabase.from('pawn_items').insert({ ...data, ticket_code, supabase_id: crypto.randomUUID(), business_id: bid }).select('id,ticket_code').single())
        return row
      }),
      update: (id, data) => tryOr(async () => { const { id: _, supabase_id: __, business_id: ___, ...rest } = data; throwSupaError(await supabase.from('pawn_items').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid)); return { id } }),
      setStatus: (id, status) => tryOr(async () => {
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

    // ── Loan schedule (amortization rows) ────────────────────────────────────
    loanSchedule: {
      list: ({ loan_id }) => tryOr(async () => throwSupaError(
        await supabase.from('loan_schedule').select('*').eq('business_id', bid).eq('loan_id', loan_id).order('installment_no', { ascending: true })
      ), []),
      bulkCreate: (rows) => tryOr(async () => {
        if (!Array.isArray(rows) || !rows.length) return { count: 0 }
        const payload = rows.map(r => ({ ...r, supabase_id: r.supabase_id || crypto.randomUUID(), business_id: bid }))
        throwSupaError(await supabase.from('loan_schedule').insert(payload))
        return { count: payload.length }
      }),
      markPaid: ({ id, paid_amount }) => tryOr(async () => {
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
      logCreate: (data) => tryOr(async () => {
        const row = throwSupaError(await supabase.from('collections_log').insert({ ...data, supabase_id: crypto.randomUUID(), business_id: bid }).select('id').single())
        return row
      }),
      logList: ({ client_id, loan_id } = {}) => tryOr(async () => {
        let q = supabase.from('collections_log').select('*').eq('business_id', bid)
        if (client_id) q = q.eq('client_id', client_id)
        if (loan_id)   q = q.eq('loan_id', loan_id)
        const rows = throwSupaError(await q.order('contacted_at', { ascending: false }).limit(500)) || []
        await attachRel(supabase, rows, { fkCol: 'client_supabase_id', targetTable: 'clients', selectCols: 'name', asKey: 'clients', businessId: bid })
        return rows.map(r => ({ ...r, client_name: r.clients?.name || null }))
      }, []),
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
      create: (data) => tryOr(async () => {
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
      update: (data) => tryOr(async () => {
        const { id, ...rest } = data
        throwSupaError(await supabase.from('memberships').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        return { id }
      }),
      consume: ({ id }) => tryOr(async () => {
        const { data: m } = await supabase.from('memberships').select('washes_used_this_period,wash_quota_per_month').eq('id', id).eq('business_id', bid).single()
        if (!m) return { ok: false, error: 'not_found' }
        if (m.washes_used_this_period >= m.wash_quota_per_month) return { ok: false, error: 'quota_exceeded', remaining: 0 }
        const newUsed = m.washes_used_this_period + 1
        throwSupaError(await supabase.from('memberships').update({ washes_used_this_period: newUsed, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        return { ok: true, remaining: m.wash_quota_per_month - newUsed }
      }),
      delete: ({ id }) => tryOr(async () => {
        throwSupaError(await supabase.from('memberships').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        return true
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
      create: (data) => tryOr(async () => {
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
      consume: ({ id }) => tryOr(async () => {
        const { data: c } = await supabase.from('wash_combos').select('used_washes,total_washes').eq('id', id).eq('business_id', bid).single()
        if (!c) return { ok: false, error: 'not_found' }
        if (c.used_washes >= c.total_washes) return { ok: false, error: 'combo_exhausted' }
        const newUsed = c.used_washes + 1
        const newStatus = newUsed >= c.total_washes ? 'exhausted' : 'active'
        throwSupaError(await supabase.from('wash_combos').update({ used_washes: newUsed, status: newStatus, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        return { ok: true, remaining: c.total_washes - newUsed }
      }),
      delete: ({ id }) => tryOr(async () => {
        throwSupaError(await supabase.from('wash_combos').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', bid))
        return true
      }),
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
          .select('id, doc_number, total, status, created_at, vehicle_plate, client_id, client_supabase_id')
          .eq('business_id', bid)
          .or(`client_id.eq.${clientId},client_supabase_id.eq.${clientId}`)
          .order('created_at', { ascending: false })
          .limit(Math.min(Number(limit) || 10, 50)))
        if (!rows?.length) return []
        const tSids = [...new Set(rows.map(r => r.id).filter(Boolean))]
        const itemsMap = {}
        if (tSids.length) {
          const { data: items } = await supabase.from('ticket_items').select('ticket_id,name').in('ticket_id', tSids)
          for (const i of (items || [])) { (itemsMap[i.ticket_id] ||= []).push(i.name) }
        }
        return rows.map(r => ({
          ...r,
          services: (itemsMap[r.id] || []).join(' + '),
          washer_name: null, // washer info omitted for web (expensive join); desktop populates it
        }))
      }, []),
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
