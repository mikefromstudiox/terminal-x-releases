/**
 * electron/sync.js — Bidirectional sync: SQLite <-> Supabase
 *
 * Runs in the Electron main process. Pushes local data to Supabase
 * AND pulls remote changes back into SQLite.
 * Uses the Supabase REST API directly (no SDK import — avoids ESM/CJS issues).
 *
 * Architecture: Every synced row carries a `supabase_id` (UUID) assigned at
 * creation time in SQLite. Foreign keys are stored as `*_supabase_id` columns.
 * The Supabase unique constraint is on (business_id, supabase_id).
 *
 * Conflict resolution:
 *   - LWW (last-write-wins) for entity tables: services, clients, washers, etc.
 *   - FWW (first-write-wins) for financial tables: tickets, commissions, etc.
 *   - Ticket status/void_reason can still be pulled (selective status sync).
 *
 * mesas.status race (v1.9.25):
 *   Two waiters flipping the same table (libre → ocupada) at the same instant
 *   would both upsert under plain LWW and the later push would silently
 *   clobber the earlier. mesas now carries a monotonic `rev` integer that is
 *   incremented locally on every `mesaSetStatus()` call. It is included in
 *   the push payload; a BEFORE UPDATE trigger on Supabase (see migration
 *   20260419100000_restaurant_sync_hardening.sql) rejects the write with a
 *   23514 check-constraint error when the incoming rev is not strictly
 *   greater than the stored rev AND status changed. The HTTP push layer
 *   surfaces this as a non-fatal per-row error so the loser's local state
 *   stays intact until the next pull heals it.
 *
 * Usage in main.js:
 *   const sync = require('./sync')
 *   sync.init(db, { supabaseUrl, supabaseKey })
 *   sync.startAutoSync(5 * 60 * 1000)
 */

const https = require('https')
const crypto = require('crypto')
const { isBusinessSetting, isDeviceLocalCloudMirror } = require('./settingsWhitelist')

// Route all sync log output through electron-log so it lands in
// %APPDATA%/terminal-x/logs/main.log where support can actually see it.
// Fall back to console if electron-log isn't available (e.g. tests).
let _log
try {
  _log = require('electron-log').scope('sync')
} catch {
  _log = { info: console.log, warn: console.warn, error: console.error }
}
const log = {
  info:  (...a) => _log.info(...a),
  warn:  (...a) => _log.warn(...a),
  error: (...a) => _log.error(...a),
}

function safeParseJson(s) { try { return JSON.parse(s) } catch { return null } }

// -- State --------------------------------------------------------------------
let _db = null
let _url = ''
let _key = ''
// Per-license user JWT (minted from license_key + machine_id by the
// `mint-license-jwt` Edge Function). When set, every Authorization: Bearer
// header swaps from the project anon key to this short-lived JWT so RLS can
// scope queries by `auth.jwt() ->> 'business_id'`. The `apikey` header always
// stays on the anon key — that's the project identifier, not user auth.
// Wired from main.js via `setUserJwt(token)`. Cleared with `setUserJwt(null)`.
let _userJwt = null
// Refresh hook: main.js installs an async () => Promise<void> here that
// re-mints + calls setUserJwt(). The push/pull cycle calls it whenever the
// current JWT is within REFRESH_SKEW_S of `exp` so an active sync never
// fails mid-flight from a 401.
let _refreshUserJwt = null
const REFRESH_SKEW_S = 300

function _authHeaders(extra) {
  const h = {
    apikey: _key,
    Authorization: 'Bearer ' + (_userJwt || _key),
  }
  return extra ? Object.assign(h, extra) : h
}

function _jwtIsExpiringSoon(jwt) {
  if (!jwt || typeof jwt !== 'string') return false
  const parts = jwt.split('.')
  if (parts.length < 2) return false
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'))
    if (!payload || typeof payload.exp !== 'number') return false
    return payload.exp < (Date.now() / 1000) + REFRESH_SKEW_S
  } catch {
    return false
  }
}

// Shared sync-error reporter: routes to admin Errores via the main-process
// reporter installed in main.js (`global.__txMainReport`). Optional-chained
// because in unit tests / detached scripts the reporter isn't installed.
// Source must be a stable namespaced string (e.g. 'sync.pull.tickets') so
// dedup in main.js works correctly across ticks.
function _reportSyncError(err, source) {
  try { global.__txMainReport?.(err instanceof Error ? err : new Error(String(err)), source) } catch {}
}

let _jwtHookMissingWarned = false
async function _maybeRefreshJwt() {
  if (!_userJwt) return
  if (typeof _refreshUserJwt !== 'function') {
    if (!_jwtHookMissingWarned && _jwtIsExpiringSoon(_userJwt)) {
      _jwtHookMissingWarned = true
      try { log.error('[sync] JWT is set but setJwtRefreshHook() was never installed — sync will start failing with 401 once the token expires. Wire sync.setJwtRefreshHook() in main.js.') } catch {}
      _reportSyncError(new Error('setJwtRefreshHook not installed before JWT expiry'), 'sync.jwt.refresh_hook_missing')
    }
    return
  }
  if (!_jwtIsExpiringSoon(_userJwt)) return
  try { await _refreshUserJwt() } catch (e) {
    try { log.warn('[sync] JWT refresh failed:', e.message) } catch {}
    // High-severity: a JWT refresh failure means the next push/pull will 401
    // and silently stall sync until restart. Surface to admin Errores so the
    // outage shows up before customers report missing reports.
    _reportSyncError(e, 'sync.jwt.refresh_failed')
  }
}

function setUserJwt(token) {
  _userJwt = token || null
}

function setJwtRefreshHook(fn) {
  _refreshUserJwt = (typeof fn === 'function') ? fn : null
}
let _businessId = null
let _intervalId = null
let _jitterTimeoutId = null
let _syncing = false
let _pendingSync = false
let _status = { state: 'idle', lastSync: null, tables: {}, error: null }
let _errorLogSink = null
function setErrorLogSink(fn) { _errorLogSink = typeof fn === 'function' ? fn : null }
let _realtimeClient = null
let _realtimeChannel = null
let _realtimeDebounce = null

// -- Table definitions in dependency order ------------------------------------
// Phase 1: no FK deps -> Phase 2: depend on phase 1 -> Phase 3: depend on phase 2
// Rows without a supabase_id are skipped (pre-migration data).

const SYNC_TABLES = [
  // Phase 1 — root entities
  {
    name: 'services',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      name_en: r.name_en,
      category: r.category,
      price: r.price,
      cost: r.cost,
      aplica_itbis: r.aplica_itbis,
      active: r.active,
      is_wash: r.is_wash,
      no_commission: !!(r.no_commission || 0),
      commission_washer: !!(r.commission_washer ?? 1),
      commission_seller: !!(r.commission_seller ?? 1),
      commission_cashier: !!(r.commission_cashier ?? 1),
      sort_order: r.sort_order,
      printer_route: r.printer_route,
      is_menu_item: !!(r.is_menu_item || 0),
      course: r.course,
      station: r.station,
      happy_hour_price: r.happy_hour_price != null ? r.happy_hour_price : null,
      happy_hour_start: r.happy_hour_start || null,
      happy_hour_end:   r.happy_hour_end   || null,
      // v2.16.3 — 86-list (sold-out plates). 1=available, 0=agotado.
      in_stock: r.in_stock == null ? 1 : (r.in_stock ? 1 : 0),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // v2.1: washers + sellers sync entries removed — consolidated into `empleados`.
  // All lavador/vendedor cross-device movement now rides the empleados entry
  // further down in this array.
  {
    name: 'clients',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      rnc: r.rnc,
      phone: r.phone,
      email: r.email,
      address: r.address,
      credit_limit: r.credit_limit,
      balance: r.balance,
      visits: r.visits,
      total_spent: r.total_spent,
      notes: r.notes,
      active: r.active,
      // v2.4 — Salon: loyalty + stylist preference + allergies
      loyalty_points: r.loyalty_points ?? 0,
      loyalty_tier: r.loyalty_tier || 'bronze',
      loyalty_lifetime_earned: r.loyalty_lifetime_earned ?? 0,
      birthday_treat_available: !!r.birthday_treat_available,
      allergies: r.allergies || null,
      preferred_stylist_supabase_id: r.preferred_stylist_supabase_id || null,
      // H8 — DR ley protección de datos
      wa_opt_out: !!r.wa_opt_out,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'inventory_items',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      sku: r.sku,
      barcode: r.barcode,
      category: r.category,
      price: r.price,
      price_pedidos_ya: r.price_pedidos_ya != null ? r.price_pedidos_ya : null,
      cost: r.cost,
      // v2.3 multi-POS — when multi_pos_enabled='1', cloud quantity is
      // authoritative (mutated only by deduct_inventory_atomic RPC and admin
      // restock paths). LWW-pushing local quantity from desktop here would
      // overwrite the RPC's truth on every sync tick — exactly the bug we're
      // closing for dual-desktop. Spread conditionally so the field is
      // omitted (not set to undefined → null) when multi_pos is on.
      ...(_mpEnabled() ? {} : { quantity: r.quantity }),
      min_quantity: r.min_quantity,
      aplica_itbis: r.aplica_itbis,
      sold_by_weight: !!(r.sold_by_weight || 0),
      unit: r.unit || null,
      price_per_unit: r.price_per_unit != null ? r.price_per_unit : null,
      bottle_deposit: r.bottle_deposit != null ? r.bottle_deposit : null,
      tare_default: r.tare_default != null ? r.tare_default : null,
      // v2.16.3 carnicería hardening
      prepacked: !!(r.prepacked || 0),
      corte_category_supabase_id: r.corte_category_supabase_id || null,
      expires_at: r.expires_at || null,
      received_at: r.received_at || null,
      // v2.16.1 patch — salon upsell tile flags
      salon_upsell: !!(r.salon_upsell || 0),
      salon_upsell_order: r.salon_upsell_order != null ? r.salon_upsell_order : null,
      active: r.active,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'ncf_sequences',
    // v1.9.25 — natural key so local rebuild heals supabase_id collisions on
    // (business_id, type) — one live sequence per NCF type per business.
    naturalKey: 'type',
    cols: r => ({
      supabase_id: r.supabase_id,
      type: r.type,
      prefix: r.prefix,
      current_number: r.current_number,
      limit_number: r.limit_number,
      valid_until: r.valid_until,
      active: r.active,
      enabled: r.enabled,
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'empleados',
    cols: r => ({
      supabase_id: r.supabase_id,
      nombre: r.nombre,
      cedula: r.cedula,
      phone: r.phone,
      tipo: r.tipo,
      salary: r.salary,
      start_date: r.start_date,
      active: r.active,
      ref_id: r.ref_id,
      puesto: r.puesto,
      email: r.email,
      bank_account: r.bank_account,
      tss_id: r.tss_id,
      role: r.role || 'none',
      comision_pct: r.comision_pct != null ? r.comision_pct : 0,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'categorias_servicio',
    cols: r => ({
      supabase_id: r.supabase_id,
      nombre: r.nombre,
      orden: r.orden,
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'mesas',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      zone: r.zone,
      capacity: r.capacity,
      status: r.status,
      // v1.9.25 — monotonic revision counter. See top-of-file "mesas.status race".
      rev: r.rev != null ? Number(r.rev) : 0,
      waiter_empleado_supabase_id: r.waiter_empleado_supabase_id,
      guests_count: r.guests_count,
      seated_at: r.seated_at,
      // v2.16.3 — "Pedir cuenta" timestamp (NULL = no pending bill).
      bill_requested_at: r.bill_requested_at || null,
      sort_order: r.sort_order,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'modificadores',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      group_name: r.group_name,
      price_delta: r.price_delta,
      min_select: r.min_select,
      max_select: r.max_select,
      default_selected: !!(r.default_selected || 0),
      sort_order: r.sort_order,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },

  // Phase 1 (cont.) — multi-vertical root entities
  {
    name: 'vehicles',
    cols: r => ({
      supabase_id: r.supabase_id,
      vin: r.vin,
      plate: r.plate,
      make: r.make,
      model: r.model,
      year: r.year,
      color: r.color,
      mileage: r.mileage,
      odometer_km: r.odometer_km,
      last_service_km: r.last_service_km,
      last_service_at: r.last_service_at,
      next_service_km: r.next_service_km,
      next_service_at: r.next_service_at,
      client_supabase_id: r.client_supabase_id || null,
      notes: r.notes,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'service_bays',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      status: r.status,
      current_work_order_supabase_id: r.current_work_order_supabase_id || null,
      capacity: r.capacity,
      bay_type: r.bay_type,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'stylist_schedules',
    cols: r => ({
      supabase_id: r.supabase_id,
      empleado_supabase_id: r.empleado_supabase_id,
      day_of_week: r.day_of_week,
      start_time: r.start_time,
      end_time: r.end_time,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },

  // Concesionario v2 / v2.5 — dealership push
  {
    name: 'vehicle_inventory',
    cols: r => ({
      supabase_id: r.supabase_id,
      stock_number: r.stock_number,
      vin: r.vin,
      make: r.make,
      model: r.model,
      year: r.year,
      color: r.color,
      mileage: r.mileage || 0,
      condition: r.condition || 'used',
      acquisition_cost: r.acquisition_cost || 0,
      listing_price: r.listing_price || 0,
      status: r.status || 'available',
      title_status: r.title_status || 'clean',
      photo_urls: (() => {
        if (Array.isArray(r.photo_urls)) return r.photo_urls
        if (typeof r.photo_urls === 'string' && r.photo_urls.trim()) {
          try { return JSON.parse(r.photo_urls) } catch { return [] }
        }
        return []
      })(),
      featured: !!(r.featured || 0),
      notes: r.notes,
      listing_date: r.listing_date,
      sold_date: r.sold_date,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'sales_deals',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id || null,
      vehicle_inventory_supabase_id: r.vehicle_inventory_supabase_id || null,
      salesperson_supabase_id: r.salesperson_supabase_id || null,
      sale_price: r.sale_price || 0,
      trade_in_supabase_id: r.trade_in_supabase_id || null,
      trade_in_value: r.trade_in_value || 0,
      down_payment: r.down_payment || 0,
      financed_amount: r.financed_amount || 0,
      term_months: r.term_months || 0,
      apr: r.apr || 0,
      monthly_payment: r.monthly_payment || 0,
      commission_pct: r.commission_pct,
      commission_amount: r.commission_amount,
      commission_paid: !!(r.commission_paid || 0),
      commission_paid_at: r.commission_paid_at || null,
      ticket_supabase_id: r.ticket_supabase_id || null,
      status: r.status || 'open',
      notes: r.notes,
      closed_at: r.closed_at,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'leads',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      source: r.source || 'walk_in',
      budget: r.budget,
      notes: r.notes,
      stage: r.stage || 'lead',
      next_followup_at: r.next_followup_at,
      last_contacted_at: r.last_contacted_at,
      interested_vehicle_supabase_id: r.interested_vehicle_supabase_id || null,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'test_drives',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id || null,
      vehicle_inventory_supabase_id: r.vehicle_inventory_supabase_id || null,
      staff_supabase_id: r.staff_supabase_id || null,
      scheduled_at: r.scheduled_at,
      completed_at: r.completed_at,
      license_number: r.license_number,
      signed_waiver_url: r.signed_waiver_url,
      notes: r.notes,
      outcome: r.outcome,
      outcome_notes: r.outcome_notes,
      deal_supabase_id: r.deal_supabase_id || null,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'vehicle_documents',
    cols: r => ({
      supabase_id: r.supabase_id,
      vehicle_inventory_supabase_id: r.vehicle_inventory_supabase_id,
      doc_type: r.doc_type,
      file_url: r.file_url,
      file_name: r.file_name,
      expires_at: r.expires_at,
      notes: r.notes,
      active: !!(r.active ?? 1),
      uploaded_at: r.uploaded_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // v2.16.2 — concesionario INTRANT matricula/traspaso tracker. Push mirrors the
  // sales_deals shape; pull side is registered in the LWW table list further down.
  {
    name: 'vehicle_titulo',
    cols: r => ({
      supabase_id: r.supabase_id,
      sales_deal_supabase_id: r.sales_deal_supabase_id || null,
      vehicle_inventory_supabase_id: r.vehicle_inventory_supabase_id || null,
      intrant_status: r.intrant_status || 'pendiente',
      placa: r.placa || null,
      matricula_url: r.matricula_url || null,
      traspaso_initiated_at: r.traspaso_initiated_at || null,
      traspaso_completed_at: r.traspaso_completed_at || null,
      notes: r.notes || null,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // v2.16.4 — concesionario reservation tracker (Sprint 2A H2). Push mirror.
  {
    name: 'vehicle_reservations',
    cols: r => ({
      supabase_id: r.supabase_id,
      vehicle_inventory_supabase_id: r.vehicle_inventory_supabase_id || null,
      client_supabase_id: r.client_supabase_id || null,
      salesperson_supabase_id: r.salesperson_supabase_id || null,
      deposit_amount: Number(r.deposit_amount) || 0,
      deposit_method: r.deposit_method || null,
      expires_at: r.expires_at,
      released_at: r.released_at || null,
      released_reason: r.released_reason || null,
      converted_deal_supabase_id: r.converted_deal_supabase_id || null,
      status: r.status || 'active',
      notes: r.notes || null,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // v2.16.4 — concesionario bank pre-approvals (Sprint 2C H5). Push mirror.
  {
    name: 'bank_preapprovals',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id || null,
      lead_supabase_id: r.lead_supabase_id || null,
      vehicle_inventory_supabase_id: r.vehicle_inventory_supabase_id || null,
      salesperson_supabase_id: r.salesperson_supabase_id || null,
      bank: r.bank,
      bank_contact: r.bank_contact || null,
      requested_amount: Number(r.requested_amount) || 0,
      term_months: r.term_months != null ? Number(r.term_months) : null,
      rate_offered: r.rate_offered != null ? Number(r.rate_offered) : null,
      monthly_quota_offered: r.monthly_quota_offered != null ? Number(r.monthly_quota_offered) : null,
      status: r.status || 'solicitada',
      expires_at: r.expires_at || null,
      decision_at: r.decision_at || null,
      decision_letter_url: r.decision_letter_url || null,
      notes: r.notes || null,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // v2.16.4 — concesionario post-sale warranties (Sprint 2B H3). Push mirror.
  // claims is parsed from local TEXT JSON to a real array on the wire so
  // Supabase JSONB stores it as an array (not a stringified array).
  {
    name: 'vehicle_warranties',
    cols: r => {
      let claims = []
      try { claims = typeof r.claims === 'string' ? JSON.parse(r.claims || '[]') : (Array.isArray(r.claims) ? r.claims : []) }
      catch { claims = [] }
      return {
        supabase_id: r.supabase_id,
        sales_deal_supabase_id: r.sales_deal_supabase_id,
        vehicle_inventory_supabase_id: r.vehicle_inventory_supabase_id || null,
        client_supabase_id: r.client_supabase_id || null,
        kind: r.kind || 'general',
        starts_at: r.starts_at,
        expires_at: r.expires_at,
        terms: r.terms || null,
        claims,
        status: r.status || 'active',
        notes: r.notes || null,
        active: !!(r.active ?? 1),
        created_at: r.created_at || new Date().toISOString(),
        updated_at: r.updated_at || null,
      }
    },
  },

  {
    name: 'users',
    supabaseTable: 'staff', // users is a VIEW on staff — can't INSERT with ON CONFLICT on views
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      username: r.username,
      pin_hash: r.pin_hash || null,
      // Sprint 10 (v2.10.5) — PIN algo + salt travel with pin_hash so a row
      // rehashed to bcrypt on one device immediately authenticates on the
      // other. Lockout state also syncs — a brute-force attempt on the web
      // PWA will propagate the same lock to desktop, closing the cross-
      // device bypass vector.
      // Auto-detect from hash format when the column is NULL — prevents
      // pushing a bcrypt hash tagged as 'sha256' (which would poison the
      // cloud row and block login cross-device). sha256 hashes are 64-char
      // lowercase hex; bcrypt is 60-char starting with '$2'.
      pin_hash_algo: r.pin_hash_algo
        || (typeof r.pin_hash === 'string' && r.pin_hash.startsWith('$2') && r.pin_hash.length === 60 ? 'bcrypt'
            : typeof r.pin_hash === 'string' && /^[0-9a-f]{64}$/.test(r.pin_hash) ? 'sha256'
            : 'bcrypt'),
      pin_salt: r.pin_salt || null,
      pin_failed_attempts: r.pin_failed_attempts ?? 0,
      pin_locked_until: r.pin_locked_until || null,
      role: r.role,
      discount_pct: r.discount_pct,
      commission_pct: r.commission_pct,
      cedula: r.cedula,
      start_date: r.start_date,
      employee_id: r.employee_id != null ? r.employee_id : null,
      active: r.active,
      // v2.6 — Manager Authorization Card columns (null-safe both directions).
      manager_auth_hash:       r.manager_auth_hash ?? null,
      manager_auth_rotated_at: r.manager_auth_rotated_at ?? null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },

  {
    name: 'activity_log',
    cols: r => ({
      supabase_id: r.supabase_id,
      event_type: r.event_type,
      severity: r.severity || 'info',
      actor_supabase_id: r.actor_supabase_id || null,
      actor_name: r.actor_name || null,
      actor_role: r.actor_role || null,
      target_type: r.target_type || null,
      target_id: r.target_id || null,
      target_name: r.target_name || null,
      amount: r.amount != null ? Number(r.amount) : null,
      old_value: r.old_value || null,
      new_value: r.new_value || null,
      reason: r.reason || null,
      metadata: r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || r.created_at || new Date().toISOString(),
    }),
  },

  // v2.17.x — journal_entries push (Phase 3 wire-forward).
  // Append-only ledger. Resolution: ignore-duplicates (APPEND_ONLY_TABLES).
  // FK columns are TEXT supabase_ids — no resolution needed at push time
  // because the helpers in packages/services/journal.js stamp the real UUIDs.
  {
    name: 'journal_entries',
    cols: r => ({
      supabase_id:    r.supabase_id,
      location_id:    r.location_id || null,
      tx_group_id:    r.tx_group_id,
      posted_at:      r.posted_at || new Date().toISOString(),
      effective_date: r.effective_date,
      vertical:       r.vertical || null,
      source_table:   r.source_table,
      source_id:      r.source_id || null,
      source_line_id: r.source_line_id || null,
      account:        r.account,
      category:       r.category || null,
      employee_id:    r.employee_id || null,
      client_id:      r.client_id || null,
      debit:          Number(r.debit || 0),
      credit:         Number(r.credit || 0),
      currency:       r.currency || 'DOP',
      description:    r.description || null,
      metadata:       r.metadata ? (typeof r.metadata === 'string' ? (safeParseJson(r.metadata) || {}) : r.metadata) : {},
      reversal_of_id: r.reversal_of_id || null,
      created_by:     r.created_by || null,
      created_at:     r.created_at || new Date().toISOString(),
      updated_at:     r.updated_at || r.created_at || new Date().toISOString(),
    }),
  },

  // Phase 2 — depend on phase 1 entities
  {
    name: 'service_modificadores',
    cols: r => ({
      supabase_id: r.supabase_id,
      service_supabase_id: r.service_supabase_id,
      modificador_supabase_id: r.modificador_supabase_id,
      is_required: !!(r.is_required || 0),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // v2.16.3 — Restaurante: recetas (Bill-of-Materials per service)
  {
    name: 'service_recipe_items',
    cols: r => ({
      supabase_id: r.supabase_id,
      service_supabase_id: r.service_supabase_id,
      inventory_item_supabase_id: r.inventory_item_supabase_id,
      qty_per_unit: Number(r.qty_per_unit) || 0,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // v2.16.x — Ofertas (product bundles)
  {
    name: 'ofertas',
    cols: r => ({
      supabase_id: r.supabase_id,
      business_id: r.business_id,
      name: r.name,
      description: r.description ?? null,
      price: Number(r.price) || 0,
      active: r.active ? true : false,
      starts_at: r.starts_at ?? null,
      ends_at: r.ends_at ?? null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'oferta_items',
    cols: r => ({
      supabase_id: r.supabase_id,
      business_id: r.business_id,
      oferta_supabase_id: r.oferta_supabase_id,
      service_supabase_id: r.service_supabase_id ?? null,
      inventory_item_supabase_id: r.inventory_item_supabase_id ?? null,
      qty: Number(r.qty) || 1,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'tickets',
    // v2.16.10 — Go-Live gate. Skip TEST-mode tickets entirely; they're wiped
    // locally on goLiveCommit() before reaching production.
    rowFilter: r => !r.is_test,
    cols: r => {
      // Build services_json from ticket_items for Remote Dashboard compatibility
      let services_json = null
      try {
        const items = _db.rawPrepare('SELECT name, price, quantity FROM ticket_items WHERE ticket_id = ?').all(r.id)
        if (items.length) services_json = items.map(i => ({ name: i.name, price: i.price, qty: i.quantity || 1 }))
      } catch (e) { try { log.warn('[sync] tickets enrich services_json:', e?.message); _reportSyncError && _reportSyncError(e, 'sync.push.tickets.services_json') } catch {} }
      // Resolve cajero name for dashboard display
      let cajero_name = null
      try {
        if (r.cajero_id) {
          const u = _db.rawPrepare('SELECT name FROM users WHERE id = ?').get(r.cajero_id)
          if (u) cajero_name = u.name
        }
      } catch (e) { try { log.warn('[sync] tickets enrich cajero_name:', e?.message); _reportSyncError && _reportSyncError(e, 'sync.push.tickets.cajero_name') } catch {} }
      // Resolve client name + rnc. Prefer the stored snapshot on the ticket
      // row (set at cobro from either selectedClient or typed RNC); fall back
      // to the joined clients row when the cashier picked a saved client and
      // the ticket pre-dates v2.17.5 client_name/client_rnc persistence.
      let client_name = r.client_name || null
      let client_rnc  = r.client_rnc  || null
      try {
        if ((!client_name || !client_rnc) && r.client_id) {
          const c = _db.rawPrepare('SELECT name, rnc FROM clients WHERE id = ?').get(r.client_id)
          if (c) {
            if (!client_name) client_name = c.name
            if (!client_rnc)  client_rnc  = c.rnc
          }
        }
      } catch (e) { try { log.warn('[sync] tickets enrich client_name/rnc:', e?.message); _reportSyncError && _reportSyncError(e, 'sync.push.tickets.client_name') } catch {} }
      return {
        supabase_id: r.supabase_id,
        doc_number: r.doc_number,
        client_supabase_id: r.client_supabase_id || null,
        client_name: client_name,
        client_rnc: client_rnc,
        // v2.1: legacy washer_ids (INT array as JSON) replaced by JSON array of empleado UUIDs.
        // seller_supabase_id keeps its name on the wire but now resolves against empleados (tipo='vendedor').
        washer_empleado_supabase_ids: r.washer_empleado_supabase_ids || '[]',
        seller_empleado_supabase_id: r.seller_empleado_supabase_id || null,
        cajero_supabase_id: r.cajero_supabase_id || null,
        cajero_name: cajero_name,
        services_json: services_json,
        subtotal: r.subtotal,
        descuento: r.descuento,
        itbis: r.itbis,
        ley: r.ley,
        total: r.total,
        beverage_subtotal: r.beverage_subtotal || 0,
        payment_method: r.payment_method,
        comprobante_type: r.comprobante_type,
        ncf: r.ncf,
        ecf_result: r.ecf_result,
        tipo_venta: r.tipo_venta,
        status: r.status,
        void_reason: r.void_reason,
        // v2.14.23 — resolve void_by INT → users.supabase_id UUID. Supabase's
        // tickets.void_by column is typed UUID; pushing a raw INT like '4'
        // gets rejected with PGRST 22P02 "invalid input syntax for type uuid".
        // That rejection silently nuked the entire tickets update-pass — every
        // post-void desktop change stayed local forever. Discovered in audit
        // 2026-04-24 (D-i).
        void_by: r.void_by
          ? (_db.rawPrepare('SELECT supabase_id FROM users WHERE id=?').get(r.void_by)?.supabase_id || null)
          : null,
        void_at: r.void_at || null,
        vehicle_plate: r.vehicle_plate,
        vehicle_color: r.vehicle_color,
        vehicle_make: r.vehicle_make,
        notes: r.notes,
        tip_amount: r.tip_amount,
        fulfillment_type: r.fulfillment_type,
        mesa_supabase_id: r.mesa_supabase_id,
        mode: r.mode || null,
        converted_from_mesa_supabase_id: r.converted_from_mesa_supabase_id || null,
        converted_from_ticket_supabase_id: r.converted_from_ticket_supabase_id || null,
        payment_parts: r.payment_parts
          ? (typeof r.payment_parts === 'string' ? JSON.parse(r.payment_parts) : r.payment_parts)
          : null,
        split_bill: !!(r.split_bill || 0),
        paid_at: r.status === 'cobrado' ? (r.created_at || new Date().toISOString()) : null,
        // v2.3.28 — push the StarSISA migration audit fields + commission_exclude
        // flag so the web admin + RemoteDashboard see the same dedupe state.
        legacy_source: r.legacy_source || null,
        legacy_code: r.legacy_code || null,
        commission_exclude: r.commission_exclude || 0,
        order_source: r.order_source || 'pos',
        // v2.10.3 — optimistic concurrency counter. Supabase trg_tickets_rev_guard
        // rejects status changes unless NEW.rev > OLD.rev. Every status-changing
        // UPDATE in electron/database.js bumps rev=COALESCE(rev,0)+1.
        rev: r.rev || 0,
        // v2.16.4 — Restaurant open-ticket lifecycle. 'open' = mesa seated,
        // items being added; 'closed' = paid or never opened. Sync is FWW so
        // a desktop-opened ticket pushed to the cloud stays 'open' until the
        // close-with-payment write flips it to 'closed'.
        open_status: r.open_status || 'closed',
        // v2.16.10 2026-04-30 — DO NOT REVERT (FIX-LEDGER §3.5). Audit confirmed
        // these 9 columns exist on Supabase tickets but desktop push descriptor
        // didn't include them. Every desktop ticket pushed to cloud was missing
        // 10% Servicio (Ley 16-92), multi-currency context, salón appointment
        // linkage, project linkage, device attribution, and the is_test flag.
        servicio_pct: r.servicio_pct != null ? Number(r.servicio_pct) : null,
        servicio_amount: r.servicio_amount != null ? Number(r.servicio_amount) : null,
        currency: r.currency || null,
        fx_rate: r.fx_rate != null ? Number(r.fx_rate) : null,
        appointment_supabase_id: r.appointment_supabase_id || null,
        project_id: r.project_id || null,
        project_supabase_id: r.project_supabase_id || null,
        origin_hwid: r.origin_hwid || null,
        origin_device_label: r.origin_device_label || null,
        is_test: !!(r.is_test || 0),
        descuento_reason: r.descuento_reason || null,
        mac_jti: r.mac_jti || null,
        // v2.17 — Food Truck: per-ticket location stamp. Nullable; only set
        // by FoodTruckPOS, ignored elsewhere.
        food_truck_location_supabase_id: r.food_truck_location_supabase_id || null,
        created_at: r.created_at || new Date().toISOString(),
        updated_at: r.updated_at || null,
      }
    },
  },

  // Phase 2 (cont.) — multi-vertical dependent entities
  {
    name: 'work_orders',
    cols: r => ({
      supabase_id: r.supabase_id,
      vehicle_supabase_id: r.vehicle_supabase_id || null,
      client_supabase_id: r.client_supabase_id || null,
      technician_empleado_supabase_id: r.technician_empleado_supabase_id || null,
      bay_supabase_id: r.bay_supabase_id || null,
      status: r.status,
      estimated_total: r.estimated_total,
      actual_total: r.actual_total,
      labor_total: r.labor_total,
      parts_total: r.parts_total,
      itbis: r.itbis,
      total: r.total,
      inspection_json: typeof r.inspection_json === 'string' ? safeParseJson(r.inspection_json) : (r.inspection_json || null),
      estimate_approved_at: r.estimate_approved_at,
      customer_signature_url: r.customer_signature_url,
      customer_approval_token: r.customer_approval_token,
      expected_parts_arrival: r.expected_parts_arrival,
      odometer_in_km: r.odometer_in_km,
      odometer_out_km: r.odometer_out_km,
      promised_date: r.promised_date,
      completed_date: r.completed_date,
      notes: r.notes,
      // v2.16.0 mecánica hardening
      aseguradora_supabase_id: r.aseguradora_supabase_id || null,
      poliza_no: r.poliza_no || null,
      reclamo_no: r.reclamo_no || null,
      aseguradora_status: r.aseguradora_status || null,
      started_at: r.started_at || null,
      finished_at: r.finished_at || null,
      ready_at: r.ready_at || null,
      delivery_required: !!(r.delivery_required || 0),
      delivery_fee: r.delivery_fee != null ? r.delivery_fee : 0,
      validity_until: r.validity_until || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'appointments',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id || null,
      empleado_supabase_id: r.empleado_supabase_id || null,
      date: r.date,
      start_time: r.start_time,
      end_time: r.end_time,
      status: r.status,
      services: r.services,
      notes: r.notes,
      // v2.16.1 — salon hardening
      is_walk_in: !!(r.is_walk_in || 0),
      deposit_dop: r.deposit_dop ?? 0,
      deposit_status: r.deposit_status || 'none',
      no_show_fee_charged: !!(r.no_show_fee_charged || 0),
      public_booking_token: r.public_booking_token || null,
      client_membership_supabase_id: r.client_membership_supabase_id || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'loans',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id || null,
      principal: r.principal,
      term_months: r.term_months,
      interest_rate: r.interest_rate,
      monthly_payment: r.monthly_payment,
      status: r.status,
      disbursed_at: r.disbursed_at,
      next_due_date: r.next_due_date,
      total_paid: r.total_paid,
      total_interest: r.total_interest,
      method: r.method || 'french',
      mora_rate_daily: r.mora_rate_daily ?? 0.005,
      days_late: r.days_late ?? 0,
      mora_amount: r.mora_amount ?? 0,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },

  // Phase 3 — depend on tickets and other phase 1/2 entities
  {
    name: 'ticket_items',
    // v2.16.10 — Go-Live gate. Drop items whose parent ticket is is_test=1.
    rowFilter: r => {
      try {
        if (!r.ticket_id) return true
        const t = _db.rawPrepare('SELECT is_test FROM tickets WHERE id=?').get(r.ticket_id)
        return !(t && t.is_test)
      } catch (e) {
        try { log.warn('[sync] ticket_items rowFilter parent lookup:', e?.message); _reportSyncError && _reportSyncError(e, 'sync.push.ticket_items.parent_lookup') } catch {}
        return true
      }
    },
    cols: r => ({
      supabase_id: r.supabase_id,
      ticket_supabase_id: r.ticket_supabase_id,
      service_supabase_id: r.service_supabase_id || null,
      name: r.name,
      price: r.price,
      cost: r.cost || 0,
      itbis: r.itbis,
      is_wash: r.is_wash,
      quantity: r.quantity || 1,
      sku: r.sku || null,
      weight: r.weight != null ? r.weight : null,
      unit: r.unit || null,
      price_per_unit: r.price_per_unit != null ? r.price_per_unit : null,
      inventory_item_supabase_id: r.inventory_item_supabase_id || null,
      empleado_supabase_id: r.empleado_supabase_id || null,  // v2.16.1 patch — per-line stylist credit
      is_deposit:    r.is_deposit ? true : false,   // v2.6 — licoreria envase line
      course:        r.course || null,
      kds_fired_at:  r.kds_fired_at || null,
      guest_number:  r.guest_number != null ? r.guest_number : null,
      preparation_notes: r.preparation_notes || null, // v2.16.3 carnicería
      oferta_supabase_id: r.oferta_supabase_id ?? null, // v2.16.x — bundle tag
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'ticket_item_modificadores',
    cols: r => ({
      supabase_id: r.supabase_id,
      ticket_item_supabase_id: r.ticket_item_supabase_id,
      modificador_supabase_id: r.modificador_supabase_id,
      name_snapshot: r.name_snapshot,
      price_delta_snapshot: r.price_delta_snapshot,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'kds_events',
    cols: r => ({
      supabase_id: r.supabase_id,
      ticket_item_supabase_id: r.ticket_item_supabase_id,
      mesa_supabase_id: r.mesa_supabase_id,
      station: r.station,
      status: r.status,
      fired_at: r.fired_at,
      started_at: r.started_at,
      ready_at: r.ready_at,
      bumped_at: r.bumped_at,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // v2.16.3 H4 — Restaurant front-of-house reservations.
  {
    name: 'restaurant_reservations',
    cols: r => ({
      supabase_id: r.supabase_id,
      mesa_supabase_id: r.mesa_supabase_id || null,
      fecha: r.fecha,
      hora: r.hora,
      duration_min: r.duration_min,
      nombre: r.nombre,
      telefono: r.telefono,
      guests: r.guests,
      notas: r.notas,
      status: r.status,
      whatsapp_sent_at: r.whatsapp_sent_at,
      cancelled_reason: r.cancelled_reason,
      seated_ticket_supabase_id: r.seated_ticket_supabase_id,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'queue',
    cols: r => ({
      supabase_id: r.supabase_id,
      ticket_supabase_id: r.ticket_supabase_id,
      status: r.status,
      // v2.1: washer_supabase_id column dropped — pushes empleado_supabase_id instead.
      empleado_supabase_id: r.empleado_supabase_id || null,
      assigned_at: r.assigned_at,
      completed_at: r.completed_at,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'washer_commissions',
    cols: r => ({
      supabase_id: r.supabase_id,
      // v2.1: washer_supabase_id replaced by empleado_supabase_id (lavador/hybrid).
      empleado_supabase_id: r.empleado_supabase_id,
      ticket_supabase_id: r.ticket_supabase_id,
      base_amount: r.base_amount,
      commission_pct: r.commission_pct,
      commission_amount: r.commission_amount,
      paid: r.paid === 1,
      paid_at: r.paid_at,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
      manual_reason: r.manual_reason || null,  // v2.14
    }),
  },
  {
    name: 'seller_commissions',
    cols: r => ({
      supabase_id: r.supabase_id,
      // v2.1: seller_supabase_id replaced by empleado_supabase_id (vendedor/hybrid).
      empleado_supabase_id: r.empleado_supabase_id,
      ticket_supabase_id: r.ticket_supabase_id,
      base_amount: r.base_amount,
      commission_pct: r.commission_pct,
      commission_amount: r.commission_amount,
      paid: r.paid === 1,
      paid_at: r.paid_at,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
      manual_reason: r.manual_reason || null,  // v2.14
    }),
  },
  {
    name: 'cajero_commissions',
    cols: r => ({
      supabase_id: r.supabase_id,
      cajero_supabase_id: r.cajero_supabase_id,
      empleado_supabase_id: r.empleado_supabase_id,
      ticket_supabase_id: r.ticket_supabase_id,
      base_amount: r.base_amount,
      commission_pct: r.commission_pct,
      commission_amount: r.commission_amount,
      paid: r.paid === 1,
      paid_at: r.paid_at,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
      manual_reason: r.manual_reason || null,  // v2.14
    }),
  },
  {
    name: 'mechanic_commissions',
    cols: r => ({
      supabase_id: r.supabase_id,
      work_order_supabase_id: r.work_order_supabase_id,
      technician_empleado_supabase_id: r.technician_empleado_supabase_id,
      ticket_supabase_id: r.ticket_supabase_id || null,
      base_amount: r.base_amount,
      commission_pct: r.commission_pct,
      calc_amount: r.calc_amount,
      paid: r.paid === 1,
      paid_at: r.paid_at || null,
      paid_by_supabase_id: r.paid_by_supabase_id || null,
      manual_reason: r.manual_reason || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'credit_payments',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id,
      ticket_ids: r.ticket_ids,
      amount: r.amount,
      payment_method: r.payment_method,
      ncf: r.ncf,
      notes: r.notes,
      cajero_supabase_id: r.cajero_supabase_id || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'cuadre_caja',
    cols: r => ({
      supabase_id: r.supabase_id,
      cajero_supabase_id: r.cajero_supabase_id,
      date: r.date,
      fondo: r.fondo,
      efectivo_conteo: r.efectivo_conteo,
      efectivo_sistema: r.efectivo_sistema,
      tarjeta: r.tarjeta,
      transferencia: r.transferencia,
      cheque: r.cheque,
      creditos: r.creditos,
      salidas: r.salidas,
      total_vendido: r.total_vendido,
      total_cobrado: r.total_cobrado,
      cierre_total: r.cierre_total,
      diferencia: r.diferencia,
      comentario: r.comentario,
      denominaciones: r.denominaciones,
      closed_at: r.closed_at,
      // v2.16.10 2026-04-30 — DO NOT REVERT (FIX-LEDGER §3.7). Cloud now has
      // shift lifecycle columns (migration 1.6). Pushing them lets multi-device
      // cashiers see each other's open shifts.
      status: r.status || 'cerrado',
      opened_at: r.opened_at || null,
      opening_cash: r.opening_cash != null ? Number(r.opening_cash) : null,
      // v2.17 — Food Truck shift breadcrumbs (location + GPS + free-text).
      // All four columns are nullable so non-foodtruck cuadres are unaffected.
      start_location_supabase_id: r.start_location_supabase_id || null,
      start_lat:                  r.start_lat != null ? Number(r.start_lat) : null,
      start_lng:                  r.start_lng != null ? Number(r.start_lng) : null,
      start_notes:                r.start_notes || null,
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'caja_chica',
    cols: r => ({
      supabase_id: r.supabase_id,
      description: r.description,
      category: r.category,
      type: r.type,
      amount: r.amount,
      recibo: r.recibo,
      status: r.status,
      approved_by_supabase_id: r.approved_by_supabase_id || null,
      cajero_supabase_id: r.cajero_supabase_id || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'notas_credito',
    cols: r => ({
      supabase_id: r.supabase_id,
      ncf: r.ncf,
      client_supabase_id: r.client_supabase_id || null,
      original_ticket_supabase_id: r.ticket_supabase_id,
      motivo: r.motivo,
      amount: r.amount,
      itbis_revertido: r.itbis_revertido,
      forma_devolucion: r.forma_devolucion,
      comentario: r.comentario,
      cajero_supabase_id: r.cajero_supabase_id || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'inventory_transactions',
    cols: r => ({
      supabase_id: r.supabase_id,
      item_supabase_id: r.item_supabase_id,
      type: r.type,
      delta: r.delta,
      notes: r.notes,
      user_supabase_id: r.user_supabase_id || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // RPT-H4: desktop-originated shortage ledger. Sale-time inserts (qty >
  // available) push up so the Oversells report on any device sees them.
  {
    name: 'inventory_oversells',
    cols: r => ({
      supabase_id: r.supabase_id,
      ticket_supabase_id: r.ticket_supabase_id,
      item_supabase_id: r.item_supabase_id,
      item_name: r.item_name,
      requested_qty: r.requested_qty,
      actual_qty: r.actual_qty,
      detected_at: r.detected_at || new Date().toISOString(),
      resolved_at: r.resolved_at || null,
      resolved_by_name: r.resolved_by || null,
      resolution_notes: r.resolution_notes || null,
      resolution_type: r.resolution_type || null,
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'compras_607',
    cols: r => ({
      supabase_id: r.supabase_id,
      rnc_proveedor: r.rnc_proveedor,
      nombre_proveedor: r.nombre_proveedor,
      ncf: r.ncf,
      ncf_modificado: r.ncf_modificado,
      fecha_ncf: r.fecha_ncf,
      total: r.total,
      itbis_facturado: r.itbis_facturado,
      itbis_retenido: r.itbis_retenido,
      retencion_renta: r.retencion_renta,
      forma_pago: r.forma_pago,
      tipo_ncf: r.tipo_ncf,
      fecha_pago: r.fecha_pago,
      monto_servicios: r.monto_servicios,
      monto_bienes: r.monto_bienes,
      notas: r.notas,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },

  // Phase 4 — payroll + adelantos + e-CF submissions + audit logs (depend on empleados/tickets)
  {
    name: 'adelantos',
    cols: r => ({
      supabase_id: r.supabase_id,
      empleado_supabase_id: r.empleado_supabase_id,
      amount: r.amount,
      date: r.date,
      notes: r.notes,
      status: r.status,
      deducted_at: r.deducted_at,
      approved_by: r.approved_by,
      approved_by_supabase_id: r.approved_by_supabase_id || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'payroll_runs',
    cols: r => ({
      supabase_id: r.supabase_id,
      empleado_supabase_id: r.empleado_supabase_id,
      period_start: r.period_start,
      period_end: r.period_end,
      base: r.base,
      commissions: r.commissions,
      bonuses: r.bonuses,
      sfs_employee: r.sfs_employee,
      afp_employee: r.afp_employee,
      isr: r.isr,
      other_deductions: r.other_deductions,
      deductions: r.deductions,
      sfs_employer: r.sfs_employer,
      afp_employer: r.afp_employer,
      infotep_employer: r.infotep_employer,
      net: r.net,
      notes: r.notes,
      paid_at: r.paid_at,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'salary_changes',
    cols: r => ({
      supabase_id: r.supabase_id,
      empleado_supabase_id: r.empleado_supabase_id,
      old_salary: r.old_salary,
      new_salary: r.new_salary,
      effective_date: r.effective_date,
      reason: r.reason,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'ecf_submissions',
    // 2026-04-30 — push the numeric dgii_status + dgii_message + confirmed_at
    // so the cloud parent-acceptance gate (web/api/ecf-sign.js) and any
    // contadora dashboard can see the same DGII verdict the desktop has.
    // The legacy text `status` column is kept in sync for backward compat.
    cols: r => ({
      supabase_id: r.supabase_id,
      ticket_supabase_id: r.ticket_supabase_id,
      encf: r.encf,
      tipo_ecf: r.tipo_ecf,
      track_id: r.track_id,
      status: typeof r.dgii_status === 'number' ? String(r.dgii_status) : (r.status || null),
      dgii_status: typeof r.dgii_status === 'number' ? r.dgii_status : null,
      dgii_message: r.dgii_message || null,
      confirmed_at: r.confirmed_at || null,
      security_code: r.security_code || null,
      signature_date: r.signature_date || null,
      xml_hash: r.xml_hash || null,
      environment: r.environment,
      submitted_at: r.submitted_at || new Date().toISOString(),
      created_at: r.submitted_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // v2.10.5 — ecf_queue cloud mirror (Recovery RTO HIGH fix). This is the
  // PRE-submission queue: offline-signed e-CFs awaiting DGII. Without the
  // mirror, a PC death mid-queue orphans fiscal obligations — the client
  // already handed paper to the customer, but DGII never saw the e-CF.
  // Pushed every 5 min + on every sale/void via the normal sync pipeline;
  // pulled on a fresh install so processDgiiQueue() resumes submission.
  // Dedup via UNIQUE (business_id, encf) on Supabase + partial index locally.
  {
    name: 'ecf_queue',
    naturalKey: 'encf',
    cols: r => ({
      supabase_id: r.supabase_id,
      ticket_supabase_id: r.ticket_supabase_id || null,
      encf: r.encf || null,
      tipo_ecf: r.tipo_ecf || null,
      xml_signed: r.xml_signed || null,
      // Supabase body_json is JSONB — send the parsed object so it stores as
      // structured data. supabaseUpsert stringifies the full payload on the
      // wire anyway; this just keeps the DB shape correct.
      body_json: (() => {
        if (!r.body_json) return {}
        if (typeof r.body_json === 'object') return r.body_json
        try {
          const parsed = JSON.parse(r.body_json)
          // Unwrap prior double-stringify: an earlier pull→push cycle wrapped
          // failed parses as `{ raw: "{...}" }`. Next parse will succeed but
          // reveal that shape, and we want the ORIGINAL structure back.
          if (parsed && typeof parsed === 'object' && 'raw' in parsed && Object.keys(parsed).length === 1) {
            try { return JSON.parse(parsed.raw) } catch { return parsed }
          }
          return parsed
        } catch { return { raw: r.body_json } }
      })(),
      url_path: r.url_path || '',
      token: r.token || '',
      environment: r.environment || 'certecf',
      status: r.status || 'pending',
      track_id: r.track_id || null,
      attempts: r.attempts || 0,
      last_error: r.last_error || null,
      submitted_at: r.submitted_at || null,
      last_tried: r.last_tried || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || new Date().toISOString(),
    }),
  },
  {
    name: 'queue_deletions',
    cols: r => {
      // Resolve local INTEGER FKs to UUIDs for Supabase
      let queue_sid = null
      let ticket_sid = null
      try {
        if (r.queue_id) {
          const row = _db.rawPrepare('SELECT supabase_id FROM queue WHERE id = ?').get(r.queue_id)
          queue_sid = row?.supabase_id || null
        }
      } catch (e) { try { log.warn('[sync] queue_deletions resolve queue_sid:', e?.message); _reportSyncError && _reportSyncError(e, 'sync.push.queue_deletions.queue_sid') } catch {} }
      try {
        if (r.ticket_id) {
          const row = _db.rawPrepare('SELECT supabase_id FROM tickets WHERE id = ?').get(r.ticket_id)
          ticket_sid = row?.supabase_id || null
        }
      } catch (e) { try { log.warn('[sync] queue_deletions resolve ticket_sid:', e?.message); _reportSyncError && _reportSyncError(e, 'sync.push.queue_deletions.ticket_sid') } catch {} }
      return {
        supabase_id: r.supabase_id,
        queue_id: queue_sid,
        ticket_id: ticket_sid,
        deleted_by: r.deleted_by,
        deleted_at: r.deleted_at,
        reason: r.reason,
        created_at: r.deleted_at || new Date().toISOString(),
        updated_at: r.updated_at || null,
      }
    },
  },
  // v2.4 — Carwash memberships + wash_combos (resolve vehicle + client FKs on push)
  {
    name: 'memberships',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id,
      vehicle_supabase_id: r.vehicle_supabase_id,
      plan_name: r.plan_name,
      plan_price: r.plan_price,
      wash_quota_per_month: r.wash_quota_per_month,
      washes_used_this_period: r.washes_used_this_period,
      period_start: r.period_start,
      period_end: r.period_end,
      start_date: r.start_date,
      end_date: r.end_date,
      status: r.status,
      notes: r.notes,
      // v2.16.1 — salon catalog (templates) extension. Nullable for carwash rows.
      nombre: r.nombre || null,
      service_supabase_id: r.service_supabase_id || null,
      total_sessions: r.total_sessions ?? null,
      price_dop: r.price_dop ?? null,
      validity_days: r.validity_days ?? null,
      active_template: r.active_template == null ? null : !!r.active_template,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // v2.16.1 — Salon: per-client membership balance ledger
  {
    name: 'client_memberships',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id,
      membership_supabase_id: r.membership_supabase_id,
      sessions_remaining: r.sessions_remaining,
      purchased_at: r.purchased_at || new Date().toISOString(),
      expires_at: r.expires_at,
      ticket_supabase_id: r.ticket_supabase_id || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // v2.16.1 — Salon: membership redemption audit trail
  {
    name: 'membership_redemptions',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_membership_supabase_id: r.client_membership_supabase_id,
      ticket_supabase_id: r.ticket_supabase_id,
      appointment_supabase_id: r.appointment_supabase_id || null,
      redeemed_at: r.redeemed_at || new Date().toISOString(),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // v2.16.1 — Salon: appointment reminders queue (24h/2h/manual/confirm)
  {
    name: 'appointment_reminders',
    cols: r => ({
      supabase_id: r.supabase_id,
      appointment_supabase_id: r.appointment_supabase_id,
      fire_at: r.fire_at,
      kind: r.kind,
      status: r.status || 'pending',
      ultramsg_message_id: r.ultramsg_message_id || null,
      error: r.error || null,
      sent_at: r.sent_at || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'wash_combos',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id,
      vehicle_supabase_id: r.vehicle_supabase_id,
      combo_name: r.combo_name,
      total_washes: r.total_washes,
      used_washes: r.used_washes,
      purchase_price: r.purchase_price,
      purchased_at: r.purchased_at,
      expires_at: r.expires_at,
      status: r.status,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // v2.6 — Service vertical
  {
    name: 'subscriptions',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id || null,
      service_supabase_id: r.service_supabase_id || null,
      plan_name: r.plan_name,
      interval_days: r.interval_days,
      amount: r.amount,
      start_date: r.start_date,
      next_billing_date: r.next_billing_date,
      last_billed_at: r.last_billed_at,
      status: r.status,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'service_packages',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id || null,
      service_supabase_id: r.service_supabase_id || null,
      package_name: r.package_name,
      total_sessions: r.total_sessions,
      used_sessions: r.used_sessions,
      purchase_price: r.purchase_price,
      purchased_at: r.purchased_at,
      expires_at: r.expires_at,
      status: r.status,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'projects',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id || null,
      name: r.name,
      description: r.description,
      status: r.status,
      total_billed: r.total_billed,
      closed_at: r.closed_at,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'client_service_rates',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id,
      service_supabase_id: r.service_supabase_id,
      custom_price: r.custom_price,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'client_item_prices',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id,
      inventory_item_supabase_id: r.inventory_item_supabase_id,
      custom_price: r.custom_price,
      notes: r.notes || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    // v2.11 — loyalty ledger. Points bump on clients.loyalty_points is
    // already handled by the clients push, but the per-ticket transaction
    // audit trail lives here and must round-trip so desktop sees redeem +
    // adjust events made from the web UI (and vice versa).
    name: 'loyalty_transactions',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id,
      ticket_supabase_id: r.ticket_supabase_id || null,
      event_type: r.event_type,
      points: r.points,
      balance_after: r.balance_after,
      notes: r.notes || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // Prestamos — phase 2 push shapers
  {
    name: 'loan_payments',
    cols: r => ({
      supabase_id: r.supabase_id,
      loan_supabase_id: r.loan_supabase_id,
      amount: r.amount,
      principal_portion: r.principal_portion || 0,
      interest_portion: r.interest_portion || 0,
      late_fee: r.late_fee || 0,
      payment_date: r.payment_date,
      due_date: r.due_date || null,
      status: r.status || 'on_time',
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'pawn_items',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id || null,
      loan_supabase_id: r.loan_supabase_id || null,
      description: r.description,
      estimated_value: r.estimated_value || 0,
      storage_location: r.storage_location,
      status: r.status || 'held',
      redeem_deadline: r.redeem_deadline,
      ticket_code: r.ticket_code || null,
      redemption_date: r.redemption_date || null,
      // C9 — papeleta legal: firmas cliente + prestamista
      signature_dataurl: r.signature_dataurl || null,
      prestamista_signature_dataurl: r.prestamista_signature_dataurl || null,
      default_alert_days: r.default_alert_days ?? 3,
      valoracion_notes: r.valoracion_notes || null,
      offered_pct: r.offered_pct ?? 60,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'loan_schedule',
    cols: r => ({
      supabase_id: r.supabase_id,
      loan_supabase_id: r.loan_supabase_id,
      installment_no: r.installment_no,
      due_date: r.due_date,
      principal_due: r.principal_due || 0,
      interest_due: r.interest_due || 0,
      total_due: r.total_due || 0,
      paid_amount: r.paid_amount || 0,
      paid_at: r.paid_at || null,
      status: r.status || 'pending',
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'collections_log',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id || null,
      loan_supabase_id: r.loan_supabase_id || null,
      channel: r.channel,
      outcome: r.outcome,
      notes: r.notes,
      contacted_at: r.contacted_at || new Date().toISOString(),
      next_contact_date: r.next_contact_date || null,
      created_by_staff_id: r.created_by_staff_id || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },

  // v2.5 — Conteo Fisico (physical inventory count + variance/theft report)
  {
    name: 'inventory_counts',
    cols: r => ({
      supabase_id: r.supabase_id,
      title: r.title || 'Conteo Fisico',
      started_at: r.started_at || new Date().toISOString(),
      completed_at: r.completed_at || null,
      counted_by_name: r.counted_by_name || null,
      status: r.status || 'abierto',
      notes: r.notes || null,
      total_expected_value: Number(r.total_expected_value) || 0,
      total_counted_value:  Number(r.total_counted_value)  || 0,
      total_variance_value: Number(r.total_variance_value) || 0,
      signature_dataurl: r.signature_dataurl || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'inventory_count_items',
    // NOTE: variance_qty / variance_cost / variance_price are GENERATED columns
    // on Supabase — NEVER include them in the push payload (PostgREST rejects
    // writes to generated cols with 428C9).
    cols: r => ({
      supabase_id: r.supabase_id,
      count_supabase_id: r.count_supabase_id,
      inventory_item_supabase_id: r.inventory_item_supabase_id,
      sku: r.sku || null,
      name: r.name,
      category: r.category || null,
      expected_qty: Number(r.expected_qty) || 0,
      counted_qty: (r.counted_qty === null || r.counted_qty === undefined) ? null : Number(r.counted_qty),
      unit_cost:  Number(r.unit_cost)  || 0,
      unit_price: Number(r.unit_price) || 0,
      notes: r.notes || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },

  // v2.3 — app_settings (business-level keys — whitelist-driven).
  // v2.10.5 — device-local cloud-mirror keys (printer, kiosk, drawer pulse,
  //   print_*, etc.) also push, tagged with device_hwid. Recovery on the same
  //   HWID pulls the row back; different HWIDs are ignored by pullAppSettings.
  // Pure device-only keys (hwid, sync internals, caches) are filtered out.
  // See electron/settingsWhitelist.js for the full classification.
  {
    name: 'app_settings',
    naturalKey: 'key',
    rowFilter: (r) => isBusinessSetting(r.key) || isDeviceLocalCloudMirror(r.key),
    cols: r => ({
      supabase_id: r.supabase_id,
      key: r.key,
      value: r.value,
      is_device_local: !!r.is_device_local,
      device_hwid: r.device_hwid || null,
      updated_at: r.updated_at || new Date().toISOString(),
    }),
  },

  // ── v2.16.3 — Carnicería hardening (LWW catalog + FWW operational logs) ──
  {
    name: 'carniceria_corte_categories',
    cols: r => ({
      supabase_id: r.supabase_id,
      nombre: r.nombre,
      nombre_dr_popular: r.nombre_dr_popular || null,
      tooltip_traduccion: r.tooltip_traduccion || null,
      especie: r.especie,
      photo_url: r.photo_url || null,
      nutrition_json: r.nutrition_json || null,
      sort_order: r.sort_order || 0,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'inventory_freshness_log',
    cols: r => ({
      supabase_id: r.supabase_id,
      inventory_item_supabase_id: r.inventory_item_supabase_id,
      batch_lote: r.batch_lote || null,
      received_at: r.received_at,
      expires_at: r.expires_at,
      qty_received: r.qty_received,
      qty_remaining: r.qty_remaining,
      unit: r.unit || 'lb',
      auto_discount_applied: !!(r.auto_discount_applied || 0),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'inventory_discards',
    cols: r => ({
      supabase_id: r.supabase_id,
      inventory_item_supabase_id: r.inventory_item_supabase_id,
      freshness_log_supabase_id: r.freshness_log_supabase_id || null,
      qty: r.qty,
      unit: r.unit || 'lb',
      motivo: r.motivo,
      photo_url: r.photo_url || null,
      empleado_supabase_id: r.empleado_supabase_id || null,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'recurring_orders',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_supabase_id: r.client_supabase_id,
      nombre: r.nombre,
      dia_semana: r.dia_semana,
      items_json: typeof r.items_json === 'string' ? r.items_json : JSON.stringify(r.items_json || []),
      total_estimado: r.total_estimado != null ? r.total_estimado : null,
      whatsapp_confirmar: !!(r.whatsapp_confirmar ?? 1),
      last_sent_at: r.last_sent_at || null,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'carniceria_scales',
    cols: r => ({
      supabase_id: r.supabase_id,
      nombre: r.nombre,
      tipo: r.tipo,
      device_path: r.device_path || null,
      protocol: r.protocol || 'generic',
      baud_rate: r.baud_rate || 9600,
      capacidad_max_lb: r.capacidad_max_lb != null ? r.capacidad_max_lb : null,
      tare_default: r.tare_default || 0,
      active_default: !!(r.active_default || 0),
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'promotions',
    cols: r => ({
      supabase_id: r.supabase_id,
      name: r.name,
      tipo: r.tipo,
      discount_pct: r.discount_pct != null ? r.discount_pct : null,
      discount_fixed: r.discount_fixed != null ? r.discount_fixed : null,
      min_purchase: r.min_purchase != null ? r.min_purchase : null,
      start_date: r.start_date || null,
      end_date: r.end_date || null,
      season_key: r.season_key || null,
      banner_text: r.banner_text || null,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'promotion_items',
    cols: r => ({
      supabase_id: r.supabase_id,
      // business_id is required by RLS on Supabase. The local SQLite schema
      // for promotion_items doesn't carry business_id (we look it up via the
      // parent promotion at sync time when missing).
      business_id: r.business_id || null,
      promotion_supabase_id: r.promotion_supabase_id,
      item_type: r.item_type,
      item_supabase_id: r.item_supabase_id,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },

  // v2.16.0 — Taller Mecánico hardening
  {
    name: 'aseguradoras',
    cols: r => ({
      supabase_id: r.supabase_id,
      nombre: r.nombre,
      rnc: r.rnc,
      contacto_telefono: r.contacto_telefono,
      contacto_email: r.contacto_email,
      ecf_mode: r.ecf_mode || 'per_wo',
      notas: r.notas,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'suppliers',
    cols: r => ({
      supabase_id: r.supabase_id,
      nombre: r.nombre,
      rnc: r.rnc,
      telefono: r.telefono,
      contacto: r.contacto,
      notas: r.notas,
      active: !!(r.active ?? 1),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'parts_orders',
    cols: r => ({
      supabase_id: r.supabase_id,
      work_order_supabase_id: r.work_order_supabase_id || null,
      supplier_supabase_id: r.supplier_supabase_id || null,
      part_name: r.part_name,
      part_sku: r.part_sku,
      quantity: r.quantity,
      unit_cost_estimate: r.unit_cost_estimate,
      expected_at: r.expected_at,
      received_at: r.received_at,
      received_barcode: r.received_barcode,
      status: r.status || 'pendiente',
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'work_order_photos',
    cols: r => ({
      supabase_id: r.supabase_id,
      work_order_supabase_id: r.work_order_supabase_id || null,
      vehicle_supabase_id: r.vehicle_supabase_id || null,
      phase: r.phase,
      storage_path: r.storage_path,
      taken_by_empleado_supabase_id: r.taken_by_empleado_supabase_id || null,
      caption: r.caption,
      created_at: r.created_at || new Date().toISOString(),
    }),
  },
  {
    name: 'insurance_batches',
    cols: r => ({
      supabase_id: r.supabase_id,
      aseguradora_supabase_id: r.aseguradora_supabase_id,
      period_month: r.period_month,
      ecf_supabase_id: r.ecf_supabase_id || null,
      ecf_ncf: r.ecf_ncf || null,
      total_amount: r.total_amount,
      itbis_amount: r.itbis_amount,
      pdf_storage_path: r.pdf_storage_path,
      work_order_count: r.work_order_count,
      status: r.status || 'borrador',
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  // ── Phase 1B — Contabilidad firm-side suite ──────────────────────────────
  // The 7 accounting_* tables share a single business_id-scoped tenant
  // (the firm). FK columns to accounting_clients use the BIGINT
  // accounting_client_id directly — Phase 1A schema does not yet carry
  // accounting_client_supabase_id, so cross-device firms with multiple
  // desktops should treat one device as source-of-truth until Phase 2
  // introduces a UUID FK companion column. Single-device firms sync cleanly.
  {
    name: 'accounting_clients',
    cols: r => ({
      supabase_id: r.supabase_id,
      client_business_supabase_id: r.client_business_supabase_id || null,
      nombre_comercial: r.nombre_comercial,
      rnc: r.rnc,
      cedula: r.cedula,
      tipo_persona: r.tipo_persona,
      regimen: r.regimen,
      fecha_cierre_mes: r.fecha_cierre_mes,
      fecha_cierre_dia: r.fecha_cierre_dia,
      honorarios_mensuales: r.honorarios_mensuales,
      currency: r.currency,
      assigned_to_user_id: r.assigned_to_user_id,
      status: r.status,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_inbox',
    cols: r => ({
      supabase_id: r.supabase_id,
      accounting_client_id: r.accounting_client_id,
      accounting_client_supabase_id: r.accounting_client_supabase_id || null,
      source: r.source,
      original_filename: r.original_filename,
      mime: r.mime,
      size: r.size,
      r2_key: r.r2_key,
      ocr_status: r.ocr_status,
      ocr_text: r.ocr_text,
      classified_type: r.classified_type,
      classification_confidence: r.classification_confidence,
      status: r.status,
      posted_journal_entry_id: r.posted_journal_entry_id,
      posted_at: r.posted_at,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_obligations_calendar',
    cols: r => ({
      supabase_id: r.supabase_id,
      accounting_client_id: r.accounting_client_id,
      accounting_client_supabase_id: r.accounting_client_supabase_id || null,
      form_type: r.form_type,
      period_year: r.period_year,
      period_month: r.period_month,
      due_date: r.due_date,
      status: r.status,
      filed_at: r.filed_at,
      filed_by_user_id: r.filed_by_user_id,
      dgii_constancia_no: r.dgii_constancia_no,
      attachment_supabase_id: r.attachment_supabase_id,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_documents',
    cols: r => ({
      supabase_id: r.supabase_id,
      accounting_client_id: r.accounting_client_id,
      accounting_client_supabase_id: r.accounting_client_supabase_id || null,
      category: r.category,
      period_year: r.period_year,
      period_month: r.period_month,
      filename: r.filename,
      r2_key: r.r2_key,
      mime: r.mime,
      size: r.size,
      uploaded_by_user_id: r.uploaded_by_user_id,
      expires_at: r.expires_at,
      tags: r.tags,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_billing_plans',
    cols: r => ({
      supabase_id: r.supabase_id,
      accounting_client_id: r.accounting_client_id,
      accounting_client_supabase_id: r.accounting_client_supabase_id || null,
      monthly_amount: r.monthly_amount,
      currency: r.currency,
      bill_day: r.bill_day,
      ecf_type: r.ecf_type,
      late_fee_pct: r.late_fee_pct,
      late_fee_after_days: r.late_fee_after_days,
      active: r.active,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_billing_invoices',
    cols: r => ({
      supabase_id: r.supabase_id,
      accounting_client_id: r.accounting_client_id,
      accounting_client_supabase_id: r.accounting_client_supabase_id || null,
      ticket_supabase_id: r.ticket_supabase_id,
      period_year: r.period_year,
      period_month: r.period_month,
      amount: r.amount,
      currency: r.currency,
      status: r.status,
      ecf_track_id: r.ecf_track_id,
      ecf_status: r.ecf_status,
      paid_at: r.paid_at,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_csv_mappings',
    cols: r => ({
      supabase_id: r.supabase_id,
      accounting_client_id: r.accounting_client_id,
      accounting_client_supabase_id: r.accounting_client_supabase_id || null,
      doc_type: r.doc_type,
      name: r.name,
      mapping_json: r.mapping_json,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },

  // ── Phase 2 Slice 1 — Contabilidad full firm-side (PUSH) ─────────────────
  {
    name: 'accounting_chart_of_accounts',
    cols: r => ({
      supabase_id: r.supabase_id,
      accounting_client_id: r.accounting_client_id,
      accounting_client_supabase_id: r.accounting_client_supabase_id || null,
      code: r.code,
      parent_id: r.parent_id,
      parent_supabase_id: r.parent_supabase_id || null,
      name: r.name,
      type: r.type,
      is_postable: r.is_postable,
      currency: r.currency,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_journal_entries',
    cols: r => ({
      supabase_id: r.supabase_id,
      accounting_client_id: r.accounting_client_id,
      accounting_client_supabase_id: r.accounting_client_supabase_id || null,
      fecha: r.fecha,
      description: r.description,
      type: r.type,
      reference_doc_supabase_id: r.reference_doc_supabase_id,
      status: r.status,
      posted_by_user_id: r.posted_by_user_id,
      period_year: r.period_year,
      period_month: r.period_month,
      totals_debit: r.totals_debit,
      totals_credit: r.totals_credit,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_journal_lines',
    cols: r => ({
      supabase_id: r.supabase_id,
      journal_entry_id: r.journal_entry_id,
      journal_entry_supabase_id: r.journal_entry_supabase_id || null,
      account_id: r.account_id,
      account_supabase_id: r.account_supabase_id || null,
      debit: r.debit,
      credit: r.credit,
      currency: r.currency,
      exchange_rate: r.exchange_rate,
      memo: r.memo,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_coa_auto_post_rules',
    cols: r => ({
      supabase_id: r.supabase_id,
      accounting_client_id: r.accounting_client_id,
      accounting_client_supabase_id: r.accounting_client_supabase_id || null,
      event: r.event,
      condition_json: r.condition_json,
      debit_account_id: r.debit_account_id,
      debit_account_supabase_id: r.debit_account_supabase_id || null,
      credit_account_id: r.credit_account_id,
      credit_account_supabase_id: r.credit_account_supabase_id || null,
      priority: r.priority,
      active: r.active,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_bank_accounts',
    cols: r => ({
      supabase_id: r.supabase_id,
      accounting_client_id: r.accounting_client_id,
      accounting_client_supabase_id: r.accounting_client_supabase_id || null,
      banco: r.banco,
      account_no_last4: r.account_no_last4,
      account_type: r.account_type,
      currency: r.currency,
      opening_balance: r.opening_balance,
      active: r.active,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_bank_statement_lines',
    cols: r => ({
      supabase_id: r.supabase_id,
      bank_account_id: r.bank_account_id,
      bank_account_supabase_id: r.bank_account_supabase_id || null,
      fecha: r.fecha,
      descripcion: r.descripcion,
      referencia: r.referencia,
      debit: r.debit,
      credit: r.credit,
      balance: r.balance,
      matched_journal_line_id: r.matched_journal_line_id,
      matched_journal_line_supabase_id: r.matched_journal_line_supabase_id || null,
      match_status: r.match_status,
      raw_row: r.raw_row,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_fixed_assets',
    cols: r => ({
      supabase_id: r.supabase_id,
      accounting_client_id: r.accounting_client_id,
      accounting_client_supabase_id: r.accounting_client_supabase_id || null,
      name: r.name,
      categoria: r.categoria,
      fecha_adquisicion: r.fecha_adquisicion,
      costo: r.costo,
      vida_util_meses: r.vida_util_meses,
      valor_residual: r.valor_residual,
      depreciacion_acumulada: r.depreciacion_acumulada,
      status: r.status,
      sold_at: r.sold_at,
      sold_amount: r.sold_amount,
      notes: r.notes,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_retentions_emitidas',
    cols: r => ({
      supabase_id: r.supabase_id,
      accounting_client_id: r.accounting_client_id,
      accounting_client_supabase_id: r.accounting_client_supabase_id || null,
      fecha: r.fecha,
      beneficiario_rnc: r.beneficiario_rnc,
      beneficiario_nombre: r.beneficiario_nombre,
      tipo: r.tipo,
      base: r.base,
      tasa: r.tasa,
      retencion: r.retencion,
      ncf_emitido: r.ncf_emitido,
      comprobante_url: r.comprobante_url,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_retentions_recibidas',
    cols: r => ({
      supabase_id: r.supabase_id,
      accounting_client_id: r.accounting_client_id,
      accounting_client_supabase_id: r.accounting_client_supabase_id || null,
      fecha: r.fecha,
      retenedor_rnc: r.retenedor_rnc,
      retenedor_nombre: r.retenedor_nombre,
      tipo: r.tipo,
      base: r.base,
      tasa: r.tasa,
      retencion: r.retencion,
      comprobante_url: r.comprobante_url,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_payroll_periods',
    cols: r => ({
      supabase_id: r.supabase_id,
      accounting_client_id: r.accounting_client_id,
      accounting_client_supabase_id: r.accounting_client_supabase_id || null,
      year: r.year,
      month: r.month,
      status: r.status,
      totals_json: r.totals_json,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_payroll_lines',
    cols: r => ({
      supabase_id: r.supabase_id,
      payroll_period_id: r.payroll_period_id,
      payroll_period_supabase_id: r.payroll_period_supabase_id || null,
      employee_name: r.employee_name,
      employee_cedula: r.employee_cedula,
      employee_nss: r.employee_nss,
      salario_base: r.salario_base,
      dependientes: r.dependientes,
      afp: r.afp,
      ars: r.ars,
      sfs: r.sfs,
      riesgos_laborales: r.riesgos_laborales,
      isr: r.isr,
      otras_deducciones: r.otras_deducciones,
      neto: r.neto,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_tss_filings',
    cols: r => ({
      supabase_id: r.supabase_id,
      accounting_client_id: r.accounting_client_id,
      accounting_client_supabase_id: r.accounting_client_supabase_id || null,
      year: r.year,
      month: r.month,
      filename: r.filename,
      file_supabase_id: r.file_supabase_id,
      status: r.status,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_tasks',
    cols: r => ({
      supabase_id: r.supabase_id,
      accounting_client_id: r.accounting_client_id,
      accounting_client_supabase_id: r.accounting_client_supabase_id || null,
      title: r.title,
      description: r.description,
      assigned_to_user_id: r.assigned_to_user_id,
      status: r.status,
      priority: r.priority,
      due_date: r.due_date,
      parent_obligation_supabase_id: r.parent_obligation_supabase_id,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
  {
    name: 'accounting_foreign_payments',
    cols: r => ({
      supabase_id: r.supabase_id,
      accounting_client_id: r.accounting_client_id,
      accounting_client_supabase_id: r.accounting_client_supabase_id || null,
      fecha: r.fecha,
      beneficiario_id: r.beneficiario_id,
      beneficiario_pais: r.beneficiario_pais,
      beneficiario_nombre: r.beneficiario_nombre,
      tipo_renta: r.tipo_renta,
      moneda: r.moneda,
      monto_moneda_pago: r.monto_moneda_pago,
      tasa_cambio: r.tasa_cambio,
      monto_local: r.monto_local,
      isr_retenido: r.isr_retenido,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || null,
    }),
  },
]

// -- Init ---------------------------------------------------------------------
function init(db, { supabaseUrl, supabaseKey }) {
  _db = db
  _url = (supabaseUrl || '').replace(/\/$/, '')
  _key = supabaseKey || ''

  if (!_url || !_key) {
    log.info('[sync] No Supabase credentials — cloud sync disabled')
    return
  }

  // Create sync_log table
  try {
    _db.rawExec(`CREATE TABLE IF NOT EXISTS sync_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name     TEXT NOT NULL UNIQUE,
      last_synced_id INTEGER NOT NULL DEFAULT 0,
      row_count      INTEGER NOT NULL DEFAULT 0,
      error          TEXT,
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
  } catch (e) {
    // table already exists or db not ready
    try { _db.rawPrepare('SELECT 1 FROM sync_log LIMIT 1').get() } catch { /* ignore */ }
  }

  // Add last_synced_at column for update tracking (v1.9)
  try { _db.rawExec("ALTER TABLE sync_log ADD COLUMN last_synced_at TEXT") } catch { /* already exists */ }

  // Add last_pull_at column for bidirectional sync pull cursor (v1.9)
  try { _db.rawExec("ALTER TABLE sync_log ADD COLUMN last_pull_at TEXT") } catch { /* already exists */ }

  // One-time reset: when migrating from local_id to supabase_id sync, reset all cursors
  // so every row is re-synced with its new supabase_id
  try {
    const stmt = _db.rawPrepare("SELECT value FROM app_settings WHERE key = 'sync_v3_supabase_id'")
    const marker = stmt ? stmt.get() : null
    if (!marker) {
      _db.rawExec("DROP TABLE IF EXISTS sync_log")
      _db.rawExec(`CREATE TABLE sync_log (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name     TEXT NOT NULL UNIQUE,
        last_synced_id INTEGER NOT NULL DEFAULT 0,
        row_count      INTEGER NOT NULL DEFAULT 0,
        error          TEXT,
        updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
        last_synced_at TEXT,
        last_pull_at   TEXT
      )`)
      const ins = _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('sync_v3_supabase_id','1')")
      if (ins) ins.run()
      log.info('[sync] Dropped and recreated sync_log for supabase_id migration')
    }
  } catch (e) {
    log.error('[sync] sync_v2_reset error:', e.message)
  }

  // v1.9 — one-time re-sync of tickets to backfill services_json, cajero_name, client_name, paid_at
  try {
    const marker = _db.rawPrepare("SELECT value FROM app_settings WHERE key = 'sync_v4_ticket_resync'")?.get()
    if (!marker) {
      _db.rawPrepare("DELETE FROM sync_log WHERE table_name = 'tickets'").run()
      _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('sync_v4_ticket_resync','1')").run()
      log.info('[sync] Reset tickets cursor for services_json/cajero backfill')
    }
  } catch (e) { log.error('[sync] v4 ticket resync marker:', e.message) }

  // v2.13.9 — one-time local dedupe of commission tables. StarSISA imports
  // created duplicate (empleado, amount, month) rows with distinct
  // supabase_ids. Cloud-side dedupe was applied separately; this mirrors
  // the dedupe locally on first boot after upgrade so Liquidaciones shows
  // the correct (non-doubled) totals immediately, without waiting for a
  // reconcile cycle.
  try {
    const marker = _db.rawPrepare("SELECT value FROM app_settings WHERE key = 'dedupe_commissions_v1'")?.get()
    if (!marker) {
      let totalDeleted = 0
      for (const table of ['washer_commissions', 'seller_commissions', 'cajero_commissions']) {
        try {
          // Keep the oldest (lowest id) row per logical tuple. Aggregate
          // rollups have ticket_supabase_id=null and ticket_id=null, so the
          // PARTITION key uses (empleado_supabase_id, base_amount,
          // commission_pct, commission_amount, created_at).
          const res = _db.rawPrepare(
            `DELETE FROM ${table}
              WHERE id IN (
                SELECT id FROM (
                  SELECT id,
                         ROW_NUMBER() OVER (
                           PARTITION BY empleado_supabase_id, base_amount, commission_pct, commission_amount, created_at
                           ORDER BY id
                         ) AS rn
                    FROM ${table}
                ) WHERE rn > 1
              )`
          ).run()
          if (res?.changes) totalDeleted += res.changes
        } catch (e) { log.warn(`[sync] dedupe ${table}:`, e.message) }
      }
      _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('dedupe_commissions_v1','1')").run()
      log.info(`[sync] v2.13.9 commission dedupe: deleted ${totalDeleted} duplicate row(s)`)
    }
  } catch (e) { log.error('[sync] dedupe commissions marker:', e.message) }

  // v2.13.12 — nuclear option for commission aggregate rollups. Two previous
  // dedupe attempts (v1 by exact timestamp, v2 by month+amount) both left
  // stragglers because SQLite timestamps from different import passes don't
  // match byte-for-byte. Just delete ALL aggregate rollups locally and reset
  // the pull cursor so the next sync cycle re-hydrates from cloud (which
  // we've already verified is correct at 12 rows per empleado). Non-aggregate
  // per-ticket commissions (ticket_supabase_id IS NOT NULL) stay untouched.
  try {
    const marker = _db.rawPrepare("SELECT value FROM app_settings WHERE key = 'reset_rollup_commissions_v1'")?.get()
    if (!marker) {
      let totalDeleted = 0
      for (const table of ['washer_commissions', 'seller_commissions', 'cajero_commissions']) {
        try {
          let hasTicketId = false
          try { hasTicketId = _db.rawPrepare(`PRAGMA table_info(${table})`).all().some(r => r.name === 'ticket_id') } catch {}
          const where = hasTicketId
            ? 'ticket_supabase_id IS NULL AND ticket_id IS NULL'
            : 'ticket_supabase_id IS NULL'
          const res = _db.rawPrepare(`DELETE FROM ${table} WHERE ${where}`).run()
          if (res?.changes) totalDeleted += res.changes
          // Reset pull cursor so the next sync re-pulls the canonical cloud rows.
          _db.rawPrepare("DELETE FROM sync_log WHERE table_name = ?").run(table)
        } catch (e) { log.warn(`[sync] reset-rollups ${table}:`, e.message) }
      }
      _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('reset_rollup_commissions_v1','1')").run()
      log.info(`[sync] v2.13.12 commission rollup reset: deleted ${totalDeleted} row(s) + reset cursors`)
    }
  } catch (e) { log.error('[sync] reset rollup commissions marker:', e.message) }

  // v2.13.11 — stricter one-month-per-row commission dedupe + reconcile with
  // cloud. v2.13.9's dedupe keyed on exact created_at which missed rows
  // whose timestamps differed by even a millisecond. Reconcile's age guard
  // also skipped future-stamped StarSISA aggregates. This pass:
  //   1. collapses all aggregate-rollup commissions (ticket_supabase_id
  //      IS NULL AND ticket_id IS NULL) to one row per (empleado, month,
  //      commission_amount) — the natural granularity of the import.
  //   2. re-runs on every install bump until the marker ticks to v2, so
  //      earlier failures self-heal.
  try {
    const marker = _db.rawPrepare("SELECT value FROM app_settings WHERE key = 'dedupe_commissions_v2'")?.get()
    if (!marker) {
      let totalDeleted = 0
      for (const table of ['washer_commissions', 'seller_commissions', 'cajero_commissions']) {
        try {
          // Has a `ticket_id` column? Some legacy tables drop it.
          let hasTicketId = false
          try { hasTicketId = _db.rawPrepare(`PRAGMA table_info(${table})`).all().some(r => r.name === 'ticket_id') } catch {}
          const nullTicketClause = hasTicketId
            ? 'ticket_supabase_id IS NULL AND ticket_id IS NULL'
            : 'ticket_supabase_id IS NULL'
          const res = _db.rawPrepare(
            `DELETE FROM ${table}
              WHERE ${nullTicketClause}
                AND id NOT IN (
                  SELECT MIN(id) FROM ${table}
                   WHERE ${nullTicketClause}
                   GROUP BY empleado_supabase_id, commission_amount, substr(created_at, 1, 7)
                )`
          ).run()
          if (res?.changes) totalDeleted += res.changes
        } catch (e) { log.warn(`[sync] dedupe-v2 ${table}:`, e.message) }
      }
      _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('dedupe_commissions_v2','1')").run()
      log.info(`[sync] v2.13.11 commission dedupe-v2: deleted ${totalDeleted} duplicate row(s)`)
    }
  } catch (e) { log.error('[sync] dedupe commissions v2 marker:', e.message) }

  // v2.14.20 — continuous (every-boot) dedupe. Marker-gated passes above fixed
  // one-time historical drift but did not stop NEW duplicates from creeping
  // back via the sync push/pull cycle (owner reported re-doubling after
  // v2.13.12). Runs cheap on every boot:
  //   • Per-ticket commissions (ticket_supabase_id NOT NULL): collapse by
  //     (empleado, ticket_supabase_id) — there can only ever be ONE row per
  //     (worker, ticket). If two exist, keep the oldest id.
  //   • Aggregate rollups (ticket_supabase_id NULL): collapse by
  //     (empleado, base_amount, commission_amount, yyyy-mm).
  try {
    let totalDeleted = 0
    for (const table of ['washer_commissions', 'seller_commissions', 'cajero_commissions']) {
      try {
        // v2.16.12 — guard the dedupe queries against a legacy schema where
        // empleado_supabase_id was never ALTERed in (e.g. cajero_commissions
        // on Studio X's pre-v2.1 install). Without this gate the dedupe
        // throws "no such column: empleado_supabase_id" on every sync tick
        // and clutters the log. Skipping the table is safe — push/pull
        // continue normally.
        if (!_tableHasColumn(table, 'empleado_supabase_id')) {
          if (!_skipColLogged.has(`${table}.empleado_supabase_id_dedupe`)) {
            _skipColLogged.add(`${table}.empleado_supabase_id_dedupe`)
            log.warn(`[sync] continuous-dedupe ${table}: column empleado_supabase_id missing — skipping (legacy schema)`)
          }
          continue
        }

        // Per-ticket dedupe
        const r1 = _db.rawPrepare(
          `DELETE FROM ${table}
            WHERE ticket_supabase_id IS NOT NULL
              AND id NOT IN (
                SELECT MIN(id) FROM ${table}
                 WHERE ticket_supabase_id IS NOT NULL
                 GROUP BY empleado_supabase_id, ticket_supabase_id
              )`
        ).run()
        if (r1?.changes) totalDeleted += r1.changes

        // Aggregate-rollup dedupe (no ticket FK)
        let hasTicketId = false
        try { hasTicketId = _db.rawPrepare(`PRAGMA table_info(${table})`).all().some(r => r.name === 'ticket_id') } catch {}
        const nullTicketClause = hasTicketId
          ? 'ticket_supabase_id IS NULL AND ticket_id IS NULL'
          : 'ticket_supabase_id IS NULL'
        const r2 = _db.rawPrepare(
          `DELETE FROM ${table}
            WHERE ${nullTicketClause}
              AND id NOT IN (
                SELECT MIN(id) FROM ${table}
                 WHERE ${nullTicketClause}
                 GROUP BY empleado_supabase_id, base_amount, commission_amount, substr(created_at, 1, 7)
              )`
        ).run()
        if (r2?.changes) totalDeleted += r2.changes
      } catch (e) { log.warn(`[sync] continuous-dedupe ${table}:`, e.message) }
    }
    if (totalDeleted) log.info(`[sync] v2.14.20 continuous commission dedupe: deleted ${totalDeleted} row(s)`)
  } catch (e) { log.error('[sync] continuous commission dedupe:', e.message) }

  // Write diagnostic file
  try {
    const fs = require('fs')
    const path = require('path')
    const { app } = require('electron')
    const logPath = path.join(app.getPath('userData'), 'sync-diag.json')
    const stmt2 = _db.rawPrepare("SELECT COUNT(*) as n FROM sync_log")
    const logCount = stmt2 ? stmt2.get()?.n : -1
    const stmt3 = _db.rawPrepare("SELECT table_name, last_synced_id FROM sync_log")
    const logRows = stmt3 ? stmt3.all() : []
    fs.writeFileSync(logPath, JSON.stringify({ init: true, url: !!_url, key: !!_key, sync_log_count: logCount, sync_log: logRows, ts: new Date().toISOString() }))
  } catch (e) { log.error('[sync] diag write error:', e.message) }

  log.info('[sync] Initialized — cloud backup enabled, url:', _url?.substring(0, 30), 'key:', _key ? 'SET' : 'EMPTY')

  // v1.9.11 — one-time reset of pull cursors so every PULL_TABLES entry
  // re-fetches from scratch on first boot of 1.9.11. Fixes the case where
  // a stale cursor was silently skipping backfilled rows on Supabase.
  try {
    const marker = _db.rawPrepare("SELECT value FROM app_settings WHERE key='pull_reset_version'").get()
    if (!marker || marker.value !== '1.9.11') {
      _db.rawPrepare("UPDATE sync_log SET last_pull_at = NULL").run()
      _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('pull_reset_version','1.9.11')").run()
      log.info('[sync] v1.9.11 pull cursors reset — next pull re-fetches everything')
    }
  } catch (e) { log.error('[sync] pull cursor reset failed:', e.message) }
}

// -- Supabase REST upsert -----------------------------------------------------
const SYNC_TIMEOUT_MS = 30_000

// PG17 server-side MERGE … RETURNING upsert path (FIX-PG17-5).
// Toggled by app_settings.sync_use_merge_v17 ('1' / 'true' = ON, anything
// else = legacy PostgREST upsert). Default: OFF. Cached for 5s so flipping
// the flag takes effect on the next sync cycle without a restart.
const SYNC_USE_MERGE_V17_KEY = 'sync_use_merge_v17'
// v2.16.10 2026-04-30 — DO NOT REVERT (FIX-LEDGER §3.6). Audit verified each
// of these tables has NO Supabase UPDATE policy. Pushing with merge-duplicates
// triggers an UPDATE branch that gets RLS-rejected (42501) → silent re-queue
// loop → 'Liquidación shows 0' recurrence. Append-only push uses
// resolution=ignore-duplicates which skips conflicts cleanly.
const APPEND_ONLY_TABLES = new Set([
  'activity_log',
  'washer_commissions',
  'seller_commissions',
  'cajero_commissions',
  'credit_payments',
  'payroll_runs',
  'salary_changes',
  'loyalty_transactions',
  'anecf_queue',
  'ecf_cert_history',
  'ecf_submissions',
  'membership_redemptions',
  'inventory_discards',
  'inventory_freshness_log',
  'loan_payments',
  'loan_renewals',
  'queue_deletions',
  'collections_attempts',
  // v2.17.x — journal_entries spine (Phase 3). Append-only by design;
  // reversals are NEW rows linked via reversal_of_id. Anon has no UPDATE/DELETE.
  'journal_entries',
])
// `users` is a VIEW on `staff` — MERGE on the view requires INSTEAD OF
// triggers; not worth the complexity. Stay on legacy PostgREST path.
const MERGE_INELIGIBLE = new Set(['users'])
let _mergeFlagCache = null
let _mergeFlagCacheAt = 0
let _mergeFirstUseLogged = false

function _mergeFlagEnabled() {
  if (_mergeFlagCacheAt && (Date.now() - _mergeFlagCacheAt < 5000)) return _mergeFlagCache
  let v = false
  try {
    const row = _db.rawPrepare(
      "SELECT value FROM app_settings WHERE key = ? AND (device_hwid IS NULL OR device_hwid = '') LIMIT 1"
    ).get(SYNC_USE_MERGE_V17_KEY)
    const raw = (row?.value ?? '').toString().toLowerCase()
    v = (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on')
  } catch {}
  _mergeFlagCache = v
  _mergeFlagCacheAt = Date.now()
  return v
}

async function _logMergeFirstUse(table) {
  if (_mergeFirstUseLogged) return
  _mergeFirstUseLogged = true
  try {
    const bizId = await resolveBusinessId()
    if (!bizId) return
    // Best-effort safety log: route through the legacy POST so it lands even
    // if the MERGE path itself has any latent bug.
    const supabase_id = require('crypto').randomUUID()
    const body = JSON.stringify([{
      supabase_id,
      business_id: bizId,
      event_type: 'sync_merge_v17_enabled',
      severity: 'info',
      target_type: 'system',
      metadata: { table, ts: new Date().toISOString() },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }])
    await new Promise((resolve) => {
      const reqUrl = new URL(`${_url}/rest/v1/activity_log?on_conflict=business_id,supabase_id`)
      const req = https.request({
        hostname: reqUrl.hostname,
        path: reqUrl.pathname + reqUrl.search,
        method: 'POST',
        headers: _authHeaders({
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates,return=minimal',
          'Content-Length': Buffer.byteLength(body),
        }),
      }, res => { res.on('data', () => {}); res.on('end', resolve) })
      req.on('error', () => resolve())
      req.setTimeout(5000, () => { try { req.destroy() } catch {}; resolve() })
      req.write(body); req.end()
    })
  } catch (e) { log.warn('[sync] merge first-use log failed:', e.message) }
}

async function pgMergeUpsert(table, cleanedRows) {
  // Server-side MERGE … RETURNING via the sync_merge_upsert RPC.
  // Caller is responsible for shape-cleaning rows (see supabaseUpsert).
  if (!cleanedRows.length) return { ok: true, count: 0, inserted: 0, updated: 0 }
  const bizId = await resolveBusinessId()
  if (!bizId) throw new Error('pgMergeUpsert: no business_id resolved')

  // Strip business_id from rows — RPC binds it from the parameter to prevent
  // cross-tenant writes. JS layer never sets it on individual rows anyway.
  const safeRows = cleanedRows.map(r => {
    if (!('business_id' in r)) return r
    const { business_id, ...rest } = r
    return rest
  })

  const payload = JSON.stringify({
    p_table: table,
    p_rows: safeRows,
    p_business_id: bizId,
    p_append_only: APPEND_ONLY_TABLES.has(table),
  })

  return await new Promise((resolve, reject) => {
    const reqUrl = new URL(`${_url}/rest/v1/rpc/sync_merge_upsert`)
    const req = https.request({
      hostname: reqUrl.hostname,
      path: reqUrl.pathname,
      method: 'POST',
      headers: _authHeaders({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      }),
    }, response => {
      let data = ''
      response.on('data', chunk => { data += chunk.toString() })
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          let parsed = null; try { parsed = JSON.parse(data) } catch {}
          resolve({
            ok: true,
            count: parsed?.count ?? safeRows.length,
            inserted: parsed?.inserted ?? 0,
            updated: parsed?.updated ?? 0,
          })
        } else {
          reject(new Error(`MERGE ${table} ${response.statusCode}: ${data}`))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(SYNC_TIMEOUT_MS, () => {
      req.destroy(new Error(`MERGE ${table} timed out after ${SYNC_TIMEOUT_MS / 1000}s`))
    })
    req.write(payload); req.end()
  })
}

async function supabaseUpsert(table, rows) {
  if (!rows.length) return { ok: true, count: 0 }

  // Coalesce null/undefined timestamps so Supabase NOT NULL columns accept them.
  // Also drop any remaining undefined fields (they'd break upsert merge).
  const nowIso = new Date().toISOString()
  const cleaned = rows.map(r => {
    const out = {}
    for (const [k, v] of Object.entries(r)) {
      if (v === undefined) continue
      if ((k === 'updated_at' || k === 'created_at') && v == null) { out[k] = nowIso; continue }
      out[k] = v
    }
    if (!out.updated_at) out.updated_at = nowIso
    return out
  })

  // PG17 MERGE path — feature-flagged, table-allowlisted via RPC.
  // Falls through to legacy PostgREST on any error so a bad row never wedges
  // sync. Per-row 23505/409 retry semantics are preserved by the legacy path.
  if (_mergeFlagEnabled() && !MERGE_INELIGIBLE.has(table)) {
    try {
      const result = await pgMergeUpsert(table, cleaned)
      _logMergeFirstUse(table)  // fire-and-forget on first success
      return result
    } catch (e) {
      log.warn(`[sync] MERGE path failed for ${table}, falling back to legacy: ${e.message}`)
      // fall through to legacy below
    }
  }

  // Supabase has real UNIQUE (business_id, supabase_id) constraints on every
  // sync table (created 2026-04-11 — previously these were partial indexes
  // which PostgREST can't use as on_conflict targets). Clean upsert works.
  //
  // activity_log has a trigger that rejects UPDATE/DELETE ("append-only").
  // If we send resolution=merge-duplicates and a row's supabase_id already
  // exists in Supabase, PostgREST issues an UPDATE → 400. Swap to
  // ignore-duplicates for the append-only tables so conflicts become no-ops
  // instead of aborts.
  const resolution = APPEND_ONLY_TABLES.has(table) ? 'ignore-duplicates' : 'merge-duplicates'
  const doPost = (payload) => new Promise((resolve, reject) => {
    const reqUrl = new URL(`${_url}/rest/v1/${table}?on_conflict=business_id,supabase_id`)
    const body = JSON.stringify(payload)
    const request = https.request({
      hostname: reqUrl.hostname,
      path: reqUrl.pathname + reqUrl.search,
      method: 'POST',
      headers: _authHeaders({
        'Content-Type': 'application/json',
        'Prefer': `resolution=${resolution},return=minimal`,
        'Content-Length': Buffer.byteLength(body),
      }),
    }, (response) => {
      let data = ''
      response.on('data', chunk => { data += chunk.toString() })
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve({ ok: true, count: payload.length })
        } else {
          reject(new Error(`Supabase ${response.statusCode}: ${data}`))
        }
      })
    })
    request.on('error', reject)
    request.setTimeout(SYNC_TIMEOUT_MS, () => { request.destroy(new Error(`Supabase ${table} timed out after ${SYNC_TIMEOUT_MS / 1000}s`)) })
    request.write(body)
    request.end()
  })

  try {
    return await doPost(cleaned)
  } catch (e) {
    // 409 = unique constraint violation (e.g. natural key conflict on entity tables).
    // Retry individual rows so one bad row doesn't block the whole batch.
    if (e.message?.includes('409') && cleaned.length > 1) {
      let ok = 0
      for (const row of cleaned) {
        try { await doPost([row]); ok++ } catch (e2) {
          // 409/23505 = natural key duplicate — row exists under different supabase_id, skip
          if (e2.message?.includes('23505') || e2.message?.includes('409')) {
            log.warn(`[sync] ${table}: skipped duplicate natural key for ${row.supabase_id}`)
          } else {
            log.error(`[sync] ${table}: row ${row.supabase_id} failed:`, e2.message)
          }
        }
      }
      return { ok: true, count: ok }
    }
    throw e
  }
}

// -- Resolve business_id ------------------------------------------------------
async function resolveBusinessId() {
  if (_businessId) return _businessId
  // Try local settings first
  try {
    const row = _db.rawPrepare("SELECT value FROM app_settings WHERE key = 'supabase_business_id'").get()
    if (row?.value) {
      _businessId = row.value
      return _businessId
    }
  } catch {}
  // Fallback: look up from HWID in Supabase licenses table
  try {
    if (_url && _key) {
      const fs = require('fs')
      const path = require('path')
      const { app } = require('electron')
      let hwid = null
      try {
        const hwidPath = path.join(app.getPath('userData'), 'hwid.json')
        const hwidData = JSON.parse(fs.readFileSync(hwidPath, 'utf8'))
        hwid = hwidData.id || hwidData.hwid
      } catch {}
      if (hwid) {
        const reqUrl = new URL(`${_url}/rest/v1/licenses?select=business_id&hardware_id=eq.${encodeURIComponent(hwid)}&status=eq.active&limit=1`)
        const result = await new Promise((resolve, reject) => {
          https.get({
            hostname: reqUrl.hostname,
            path: reqUrl.pathname + reqUrl.search,
            headers: _authHeaders(),
          }, res => {
            let data = ''
            res.on('data', chunk => { data += chunk.toString() })
            res.on('end', () => { try { resolve(JSON.parse(data)) } catch { reject(new Error('parse')) } })
          }).on('error', reject)
        })
        if (result?.[0]?.business_id) {
          _businessId = result[0].business_id
          try { _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('supabase_business_id',?)").run(_businessId) } catch {}
          log.info('[sync] Resolved business_id from HWID:', _businessId)
          return _businessId
        }
      }
    }
  } catch (e) { log.warn('[sync] Business ID lookup failed:', e.message) }
  return null
}

// -- Get last synced ID for a table -------------------------------------------
function getLastSyncedId(tableName) {
  try {
    const row = _db.rawPrepare('SELECT last_synced_id FROM sync_log WHERE table_name = ?').get(tableName)
    return row?.last_synced_id || 0
  } catch { return 0 }
}

function getLastSyncedAt(tableName) {
  try {
    const row = _db.rawPrepare('SELECT last_synced_at FROM sync_log WHERE table_name = ?').get(tableName)
    return row?.last_synced_at || null
  } catch { return null }
}

// -- Update sync log ----------------------------------------------------------
function updateSyncLog(tableName, lastId, rowCount, error) {
  // v2.3.9 — mirror sync errors into the main error.log so they're visible to
  // users / support without having to query sync_log. Silent sync failures
  // cost us hours on the activity_log RLS bug.
  if (error && _errorLogSink) {
    try { _errorLogSink(`sync-push:${tableName}`, new Error(String(error).slice(0, 500)), [{ lastId, rowCount }]) }
    catch (e) { try { log.error('[sync] errorLogSink failed:', e?.message) } catch {} }
  }
  try {
    // v2.0.2 — use ISO 8601 UTC format so last_synced_at is lexicographically
    // comparable to updated_at (which the v2 triggers also write in ISO).
    // Previously datetime('now') produced SQL-space format ('YYYY-MM-DD HH:MM:SS')
    // while updated_at was ISO ('YYYY-MM-DDTHH:MM:SS.fffZ'). String compare ranked
    // every pulled row's updated_at ABOVE last_synced_at (T > space), causing
    // Pass 2 to re-push every pulled row on every cycle — the sync loop.
    _db.rawPrepare(`INSERT INTO sync_log (table_name, last_synced_id, row_count, error, updated_at, last_synced_at)
      VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(table_name) DO UPDATE SET
        last_synced_id = excluded.last_synced_id,
        row_count = excluded.row_count,
        error = excluded.error,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `).run(tableName, lastId, rowCount, error)
  } catch (e) { log.error('[sync] updateSyncLog failed:', e.message) }
}

// -- Supabase REST fetch (GET) ------------------------------------------------
function supabaseFetch(table, queryParams) {
  return new Promise((resolve, reject) => {
    const reqUrl = new URL(`${_url}/rest/v1/${table}`)
    for (const [k, v] of Object.entries(queryParams)) reqUrl.searchParams.set(k, v)
    const request = https.get({
      hostname: reqUrl.hostname,
      path: reqUrl.pathname + reqUrl.search,
      headers: _authHeaders(),
    }, (response) => {
      let data = ''
      response.on('data', chunk => { data += chunk.toString() })
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          try { resolve(JSON.parse(data)) } catch { resolve([]) }
        } else {
          reject(new Error(`Supabase GET ${table} ${response.statusCode}: ${data.substring(0, 200)}`))
        }
      })
    })
    request.on('error', reject)
    setTimeout(() => request.destroy(new Error(`Supabase GET ${table} timed out`)), SYNC_TIMEOUT_MS)
  })
}

// -- Pull cursor helpers ------------------------------------------------------
function getLastPullAt(tableName) {
  try {
    const row = _db.rawPrepare('SELECT last_pull_at FROM sync_log WHERE table_name = ?').get(tableName)
    return row?.last_pull_at || null
  } catch { return null }
}

function updatePullLog(tableName, lastPullAt) {
  try {
    // Match updateSyncLog's ISO 8601 format so sync_log.updated_at stays
    // lexicographically comparable across push and pull paths. datetime('now')
    // would write SQL space format and re-introduce the v2.0.2 comparison bug.
    _db.rawPrepare(`INSERT INTO sync_log (table_name, last_synced_id, row_count, error, updated_at, last_pull_at)
      VALUES (?, 0, 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)
      ON CONFLICT(table_name) DO UPDATE SET last_pull_at = excluded.last_pull_at, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    `).run(tableName, lastPullAt)
  } catch (e) { log.error('[sync] updatePullLog failed:', e.message) }
}

// -- JSON columns that need stringify when inserting into SQLite ---------------
// v2.1: washer_ids → washer_empleado_supabase_ids (JSON array of empleado UUIDs).
// v2.10.4: payment_parts is JSONB on Supabase, TEXT (JSON string) on SQLite.
// Pull path must stringify the inbound array before binding to SQLite.
// v2.10.5: `body_json` is JSONB on Supabase, TEXT on SQLite — pull must
// stringify before binding or better-sqlite3 rejects the row.
const JSON_COLUMNS = new Set(['ecf_result', 'washer_empleado_supabase_ids', 'ticket_ids', 'denominaciones', 'services_json', 'metadata', 'services', 'payment_parts', 'body_json', 'claims'])

function sqliteValue(col, val) {
  if (val == null) return null
  if (JSON_COLUMNS.has(col) && typeof val === 'object') return JSON.stringify(val)
  // better-sqlite3 rejects JS booleans — Supabase returns active:true/false, SQLite uses 0/1
  if (typeof val === 'boolean') return val ? 1 : 0
  // Any leftover object (e.g. jsonb column we don't expect) — stringify so the bind works
  if (typeof val === 'object') return JSON.stringify(val)
  return val
}

// -- Pull table definitions (Supabase -> SQLite) ------------------------------
// strategy: 'lww' = last-write-wins (entities), 'fww' = first-write-wins (financial)
const PULL_TABLES = [
  // Phase 1 — root entities (LWW)
  // NOTE: `created_at` only included for tables whose local SQLite schema actually has
  // that column. db/schema.sql: services/sellers/inventory_items/empleados/categorias_servicio
  // never declared created_at, so including it in the pull causes "no such column" failures.
  { name: 'services', strategy: 'lww', naturalKey: 'name', cols: ['name','name_en','category','price','cost','aplica_itbis','active','is_wash','no_commission','commission_washer','commission_seller','commission_cashier','sort_order','printer_route','is_menu_item','course','station','happy_hour_price','happy_hour_start','happy_hour_end','updated_at'] },
  // v2.1: washers + sellers PULL entries removed — consolidated into `empleados`
  // (tipo='lavador'/'vendedor'). Their data is now part of the empleados pull below.
  { name: 'clients', strategy: 'lww', naturalKey: 'name', cols: ['name','rnc','phone','email','address','credit_limit','balance','visits','total_spent','notes','active','loyalty_points','loyalty_tier','loyalty_lifetime_earned','birthday_treat_available','allergies','no_show_count','last_no_show_at','wa_opt_out','created_at','updated_at'],
    fkCols: { preferred_stylist_supabase_id: 'empleados' } },
  { name: 'inventory_items', strategy: 'lww', naturalKey: 'name', cols: ['name','sku','barcode','category','price','price_pedidos_ya','cost','quantity','min_quantity','aplica_itbis','sold_by_weight','unit','price_per_unit','bottle_deposit','tare_default','prepacked','corte_category_supabase_id','received_at','expires_at','salon_upsell','salon_upsell_order','active','updated_at'] },
  { name: 'mesas', strategy: 'lww', naturalKey: 'name', cols: ['name','zone','capacity','status','rev','guests_count','seated_at','bill_requested_at','sort_order','active','created_at','updated_at'],
    fkCols: { waiter_empleado_supabase_id: 'empleados' } },
  { name: 'modificadores', strategy: 'lww', naturalKey: 'name', cols: ['name','group_name','price_delta','min_select','max_select','default_selected','sort_order','active','created_at','updated_at'] },
  { name: 'service_modificadores', strategy: 'lww', cols: ['is_required','created_at','updated_at'],
    fkCols: { service_supabase_id: 'services', modificador_supabase_id: 'modificadores' } },
  // v2.16.3 — Restaurante recetas (Bill-of-Materials per service)
  { name: 'service_recipe_items', strategy: 'lww', cols: ['qty_per_unit','created_at','updated_at'],
    fkCols: { service_supabase_id: 'services', inventory_item_supabase_id: 'inventory_items' } },
  // v2.16.x — Ofertas (product bundles)
  { name: 'ofertas', strategy: 'lww',
    cols: ['name','description','price','active','starts_at','ends_at','created_at','updated_at'] },
  // v2.17.10 (2026-05-18) — oferta_supabase_id was missing from both cols AND
  // fkCols, so pullUpsertRow built an INSERT that excluded the column entirely.
  // Local schema (electron/database.js:1995) has `oferta_supabase_id TEXT NOT NULL`,
  // so every single row failed with "NOT NULL constraint failed". Bug surfaced
  // on Ranoza's first desktop install — 44 of 44 oferta_items rejected, combos
  // invisible in the POS. Treating it as an FK in fkCols matches the pattern
  // used by every other parent reference (e.g. waiter_empleado_supabase_id on
  // mesas, client_membership_supabase_id on club_redemptions).
  { name: 'oferta_items', strategy: 'lww', cols: ['qty','created_at','updated_at'],
    fkCols: { oferta_supabase_id: 'ofertas', service_supabase_id: 'services', inventory_item_supabase_id: 'inventory_items' } },
  { name: 'ncf_sequences', strategy: 'lww', cols: ['type','prefix','current_number','limit_number','valid_until','active','enabled','updated_at'] },
  { name: 'empleados', strategy: 'lww', naturalKey: 'nombre', cols: ['nombre','cedula','phone','tipo','salary','start_date','active','ref_id','puesto','email','bank_account','tss_id','role','comision_pct','updated_at'] },
  { name: 'categorias_servicio', strategy: 'lww', naturalKey: 'nombre', cols: ['nombre','orden','updated_at'] },
  // `users` is a VIEW on `staff` in Supabase — PostgREST can't upsert into a
  // view without INSTEAD OF triggers. Route push to the base `staff` table.
  // Without this, every PIN/username/role change on desktop was silently lost.
  { name: 'users', supabaseTable: 'staff', strategy: 'lww', naturalKey: 'username', cols: ['name','username','pin_hash','pin_hash_algo','pin_salt','pin_failed_attempts','pin_locked_until','role','discount_pct','commission_pct','cedula','start_date','employee_id','active','manager_auth_hash','manager_auth_rotated_at','created_at','updated_at'] },

  // Phase 1 (cont.) — multi-vertical root entities
  { name: 'vehicles', strategy: 'lww', naturalKey: 'vin', cols: ['vin','plate','make','model','year','color','mileage','odometer_km','last_service_km','last_service_at','next_service_km','next_service_at','notes','active','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients' } },
  { name: 'service_bays', strategy: 'lww', naturalKey: 'name', cols: ['name','status','current_work_order_supabase_id','capacity','bay_type','active','created_at','updated_at'] },
  { name: 'stylist_schedules', strategy: 'lww', cols: ['day_of_week','start_time','end_time','active','created_at','updated_at'],
    fkCols: { empleado_supabase_id: 'empleados' } },

  // Concesionario v2 / v2.5 — dealership tables
  { name: 'vehicle_inventory', strategy: 'lww',
    cols: ['stock_number','vin','make','model','year','color','mileage','condition','acquisition_cost','listing_price','status','title_status','photo_urls','featured','notes','listing_date','sold_date','active','created_at','updated_at'] },
  { name: 'sales_deals', strategy: 'lww',
    cols: ['sale_price','trade_in_value','down_payment','financed_amount','term_months','apr','monthly_payment','commission_pct','commission_amount','commission_paid','commission_paid_at','status','notes','closed_at','active','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', vehicle_inventory_supabase_id: 'vehicle_inventory', salesperson_supabase_id: 'empleados', trade_in_supabase_id: 'vehicle_inventory', ticket_supabase_id: 'tickets' } },
  { name: 'leads', strategy: 'lww',
    cols: ['name','phone','email','source','budget','notes','stage','next_followup_at','last_contacted_at','interested_vehicle_supabase_id','active','created_at','updated_at'] },
  { name: 'test_drives', strategy: 'lww',
    cols: ['scheduled_at','completed_at','license_number','signed_waiver_url','notes','outcome','outcome_notes','deal_supabase_id','active','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', vehicle_inventory_supabase_id: 'vehicle_inventory', staff_supabase_id: 'empleados' } },
  { name: 'vehicle_documents', strategy: 'lww',
    cols: ['vehicle_inventory_supabase_id','doc_type','file_url','file_name','expires_at','notes','active','uploaded_at','updated_at'] },
  // v2.16.2 — concesionario INTRANT matricula/traspaso tracker
  { name: 'vehicle_titulo', strategy: 'lww',
    cols: ['intrant_status','placa','matricula_url','traspaso_initiated_at','traspaso_completed_at','notes','active','created_at','updated_at'],
    fkCols: { sales_deal_supabase_id: 'sales_deals', vehicle_inventory_supabase_id: 'vehicle_inventory' } },
  // v2.16.4 — concesionario reservation tracker (Sprint 2A H2)
  { name: 'vehicle_reservations', strategy: 'lww',
    cols: ['deposit_amount','deposit_method','expires_at','released_at','released_reason','status','notes','active','created_at','updated_at'],
    fkCols: { vehicle_inventory_supabase_id: 'vehicle_inventory', client_supabase_id: 'clients', salesperson_supabase_id: 'empleados', converted_deal_supabase_id: 'sales_deals' } },
  // v2.16.4 — concesionario post-sale warranties (Sprint 2B H3)
  { name: 'vehicle_warranties', strategy: 'lww',
    cols: ['kind','starts_at','expires_at','terms','claims','status','notes','active','created_at','updated_at'],
    fkCols: { sales_deal_supabase_id: 'sales_deals', vehicle_inventory_supabase_id: 'vehicle_inventory', client_supabase_id: 'clients' } },
  // v2.16.4 — concesionario bank pre-approvals (Sprint 2C H5)
  { name: 'bank_preapprovals', strategy: 'lww',
    cols: ['bank','bank_contact','requested_amount','term_months','rate_offered','monthly_quota_offered','status','expires_at','decision_at','decision_letter_url','notes','active','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', vehicle_inventory_supabase_id: 'vehicle_inventory', salesperson_supabase_id: 'empleados' } },

  // NOTE on `'users'` refTable in fkCols below (cajero_supabase_id / user_supabase_id /
  // approved_by_supabase_id): on Supabase, `users` is a VIEW over the `staff` base table
  // (re-created post-v2.1 schema consolidation so PostgREST FK resolution keeps working).
  // On the desktop SQLite, the physical table is `users` (no `staff` table exists locally),
  // and the local resolver below does `SELECT id FROM ${refTable} WHERE supabase_id = ?`,
  // so the value MUST stay as `'users'` — switching to `'staff'` would silently break local
  // FK integer backfill on every desktop install. If a future migration drops the Supabase
  // `users` view permanently AND adds a local `staff` table, change all six entries below
  // to `'staff'` in lockstep with that migration.

  // Phase 2 — tickets + dependents
  { name: 'tickets', strategy: 'fww',
    // v2.1: washer_ids legacy INT-array column dropped → washer_empleado_supabase_ids JSON of UUIDs.
    // seller_supabase_id is still the column name on the wire, but it now points at empleados.supabase_id
    // (tipo='vendedor'/'hybrid'); explicitly resolved against empleados below.
    cols: ['doc_number','client_name','client_rnc','subtotal','descuento','itbis','ley','total','beverage_subtotal','payment_method','comprobante_type','ncf','ecf_result','tipo_venta','status','void_reason','void_by','void_at','vehicle_plate','vehicle_color','vehicle_make','notes','washer_empleado_supabase_ids','tip_amount','fulfillment_type','mesa_supabase_id','mode','converted_from_mesa_supabase_id','converted_from_ticket_supabase_id','payment_parts','split_bill','order_source','rev','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', seller_empleado_supabase_id: 'empleados', cajero_supabase_id: 'users' },
    // v2.10.3 — `rev` rides statusSync so both sides of a status flip stay in lockstep.
    statusSync: ['status', 'void_reason', 'void_by', 'void_at', 'rev', 'updated_at'] },
  { name: 'ticket_items', strategy: 'fww',
    cols: ['name','price','cost','itbis','is_wash','quantity','sku','weight','unit','price_per_unit','is_deposit','course','kds_fired_at','guest_number','preparation_notes','empleado_supabase_id','oferta_supabase_id','created_at','updated_at'],
    fkCols: { ticket_supabase_id: 'tickets', service_supabase_id: 'services', inventory_item_supabase_id: 'inventory_items', empleado_supabase_id: 'empleados' } },
  { name: 'queue', strategy: 'lww',
    cols: ['status','assigned_at','completed_at','created_at','updated_at'],
    // v2.1: washer_supabase_id column dropped → empleado_supabase_id (lavador/hybrid).
    fkCols: { ticket_supabase_id: 'tickets', empleado_supabase_id: 'empleados' } },
  { name: 'ticket_item_modificadores', strategy: 'fww',
    cols: ['name_snapshot','price_delta_snapshot','created_at','updated_at'],
    fkCols: { ticket_item_supabase_id: 'ticket_items', modificador_supabase_id: 'modificadores' } },
  // v1.9.25 — kds_events flipped FWW → LWW so station/status/bumped_at
  // propagate across multi-device KDS (expo bumping a ticket must reach the
  // line station in real time). `updated_at` exists on both SQLite + Supabase.
  { name: 'kds_events', strategy: 'lww',
    cols: ['station','status','fired_at','started_at','ready_at','bumped_at','created_at','updated_at'],
    fkCols: { ticket_item_supabase_id: 'ticket_items', mesa_supabase_id: 'mesas' } },
  // v2.16.3 H4 — Restaurant front-of-house reservations. LWW so a hostess
  // tablet edit (e.g. confirmada → sentada) cleanly overwrites a
  // background-synced peer that happens to push first. mesa_supabase_id is
  // the only FK we resolve locally — mesa_id is a denorm convenience that
  // gets back-filled by the FK resolver.
  { name: 'restaurant_reservations', strategy: 'lww',
    cols: ['fecha','hora','duration_min','nombre','telefono','guests','notas','status','whatsapp_sent_at','cancelled_reason','seated_ticket_supabase_id','created_at','updated_at'],
    fkCols: { mesa_supabase_id: 'mesas' } },

  // Phase 2 (cont.) — multi-vertical dependent entities
  { name: 'work_orders', strategy: 'lww',
    cols: ['status','estimated_total','actual_total','labor_total','parts_total','itbis','total','inspection_json','estimate_approved_at','customer_signature_url','customer_approval_token','expected_parts_arrival','odometer_in_km','odometer_out_km','promised_date','completed_date','notes','poliza_no','reclamo_no','aseguradora_status','started_at','finished_at','ready_at','delivery_required','delivery_fee','validity_until','created_at','updated_at'],
    fkCols: { vehicle_supabase_id: 'vehicles', client_supabase_id: 'clients', technician_empleado_supabase_id: 'empleados', bay_supabase_id: 'service_bays', aseguradora_supabase_id: 'aseguradoras' } },
  { name: 'appointments', strategy: 'lww',
    cols: ['date','start_time','end_time','status','services','notes',
           'is_walk_in','deposit_dop','deposit_status','no_show_fee_charged','public_booking_token',
           'client_membership_supabase_id','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', empleado_supabase_id: 'empleados' } },
  { name: 'loans', strategy: 'lww',
    cols: ['principal','term_months','interest_rate','monthly_payment','status','disbursed_at','next_due_date','total_paid','total_interest','method','mora_rate_daily','days_late','mora_amount','amortization_method','renewal_count','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients' } },

  // Phase 3 — financial (LWW on paid flag)
  // v2.13.13: commissions were previously FWW (first-write-wins) to freeze
  // historical amounts. But that blocked propagation of the `paid` flag
  // when owners mark commissions paid on one device — the other devices
  // never saw the update. Switched to LWW so `paid`/`paid_at` changes flow.
  // Amounts are write-once in practice (set at ticket cobrar + never edited),
  // so LWW doesn't open a real race window on those columns.
  { name: 'washer_commissions', strategy: 'lww',
    cols: ['base_amount','commission_pct','commission_amount','paid','paid_at','created_at','updated_at'],
    // v2.1: washer_supabase_id (→ washers) replaced by empleado_supabase_id (→ empleados, tipo='lavador').
    fkCols: { empleado_supabase_id: 'empleados', ticket_supabase_id: 'tickets' } },
  { name: 'seller_commissions', strategy: 'lww',
    cols: ['base_amount','commission_pct','commission_amount','paid','paid_at','created_at','updated_at'],
    fkCols: { empleado_supabase_id: 'empleados', ticket_supabase_id: 'tickets' } },
  { name: 'cajero_commissions', strategy: 'lww',
    cols: ['base_amount','commission_pct','commission_amount','paid','paid_at','created_at','updated_at'],
    fkCols: { cajero_supabase_id: 'users', ticket_supabase_id: 'tickets' } },
  { name: 'mechanic_commissions', strategy: 'lww',
    cols: ['base_amount','commission_pct','calc_amount','paid','paid_at','manual_reason','created_at','updated_at'],
    fkCols: { work_order_supabase_id: 'work_orders', technician_empleado_supabase_id: 'empleados', ticket_supabase_id: 'tickets' } },
  { name: 'credit_payments', strategy: 'fww',
    cols: ['ticket_ids','amount','payment_method','ncf','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', cajero_supabase_id: 'users' } },
  { name: 'cuadre_caja', strategy: 'fww',
    cols: ['date','fondo','efectivo_conteo','efectivo_sistema','tarjeta','transferencia','cheque','creditos','salidas','total_vendido','total_cobrado','cierre_total','diferencia','comentario','denominaciones','closed_at','updated_at'],
    fkCols: { cajero_supabase_id: 'users' } },
  { name: 'caja_chica', strategy: 'fww',
    cols: ['description','category','type','amount','recibo','status','created_at','updated_at'],
    fkCols: { approved_by_supabase_id: 'users', cajero_supabase_id: 'users' } },
  { name: 'notas_credito', strategy: 'fww',
    cols: ['ncf','motivo','amount','itbis_revertido','forma_devolucion','comentario','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', original_ticket_supabase_id: 'tickets', cajero_supabase_id: 'users' } },
  { name: 'inventory_transactions', strategy: 'fww',
    cols: ['type','delta','notes','created_at','updated_at'],
    fkCols: { item_supabase_id: 'inventory_items', user_supabase_id: 'users' } },
  { name: 'inventory_oversells', strategy: 'lww',
    cols: ['item_name','requested_qty','actual_qty','detected_at','resolved_at','resolution_notes','resolution_type','updated_at'],
    fkCols: { item_supabase_id: 'inventory_items', ticket_supabase_id: 'tickets' } },
  { name: 'compras_607', strategy: 'fww',
    cols: ['rnc_proveedor','nombre_proveedor','ncf','ncf_modificado','fecha_ncf','total','itbis_facturado','itbis_retenido','retencion_renta','forma_pago','tipo_ncf','fecha_pago','monto_servicios','monto_bienes','notas','created_at','updated_at'] },

  // Phase 3 (cont.) — multi-vertical child entities
  { name: 'work_order_items', strategy: 'fww',
    cols: ['type','name','description','quantity','unit_price','total','warranty_months','created_at','updated_at'],
    fkCols: { work_order_supabase_id: 'work_orders', inventory_item_supabase_id: 'inventory_items' } },
  { name: 'loan_payments', strategy: 'fww',
    cols: ['amount','principal_portion','interest_portion','late_fee','payment_date','due_date','status','notes','created_at','updated_at'],
    fkCols: { loan_supabase_id: 'loans' } },
  { name: 'pawn_items', strategy: 'lww',
    cols: ['description','estimated_value','storage_location','status','redeem_deadline','ticket_code','redemption_date','default_alert_days','valoracion_notes','offered_pct','signature_dataurl','prestamista_signature_dataurl','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', loan_supabase_id: 'loans' } },
  { name: 'loan_schedule', strategy: 'fww',
    cols: ['installment_no','due_date','principal_due','interest_due','total_due','paid_amount','paid_at','status','created_at','updated_at'],
    fkCols: { loan_supabase_id: 'loans' } },
  { name: 'collections_log', strategy: 'fww',
    cols: ['channel','outcome','notes','contacted_at','next_contact_date','created_by_staff_id','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', loan_supabase_id: 'loans' } },

  // v2.16.2 — Prestamos hardening: contracts, renewals, pawn docs/listings, collections attempts
  { name: 'loan_contracts', strategy: 'lww',
    cols: ['pdf_url','signature_dataurl','dpi_photo_url','signed_at','apr_monthly','apr_annual_equiv','clauses_version','created_at','updated_at'],
    fkCols: { loan_supabase_id: 'loans' } },
  { name: 'loan_renewals', strategy: 'fww',
    cols: ['renewal_count','interest_paid','new_due_date','previous_due_date','renewed_at','notes','created_at','updated_at'],
    fkCols: { loan_supabase_id: 'loans' } },
  { name: 'pawn_documents', strategy: 'lww',
    cols: ['doc_type','file_url','mime_type','notes','created_at','updated_at'],
    fkCols: { pawn_supabase_id: 'pawn_items' } },
  { name: 'pawn_listings', strategy: 'lww',
    cols: ['list_price','published_at','slug','status','sold_ticket_supabase_id','notes','list_price_override','override_reason','created_at','updated_at'],
    fkCols: { pawn_supabase_id: 'pawn_items' } },
  { name: 'collections_attempts', strategy: 'fww',
    cols: ['attempt_at','outcome','notes','next_followup_at','whatsapp_sent','created_at','updated_at'],
    fkCols: { loan_supabase_id: 'loans' } },

  // v2.16.x — Servicios vertical: project tracker (minimal)
  { name: 'service_projects', strategy: 'lww',
    cols: ['project_name','description','status','billing_type','estimated_hours','hourly_rate','fixed_price','total_billed','total_paid','started_at','due_date','completed_at','assigned_empleado_supabase_id','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients' } },

  // Phase 4 — payroll audit trail + adelantos (FWW — financial records, never overwritten)
  // Note: ecf_submissions is push-only (desktop-authored per-device, no pull) — column name
  // mismatch between SQLite `dgii_status INTEGER` and Supabase `status TEXT` makes pulling unsafe.
  // Note: queue_deletions is push-only (append-only log, desktop-authored).
  { name: 'adelantos', strategy: 'lww',
    cols: ['amount','date','notes','status','deducted_at','approved_by','created_at','updated_at'],
    fkCols: { empleado_supabase_id: 'empleados' } },
  { name: 'payroll_runs', strategy: 'fww',
    cols: ['period_start','period_end','base','commissions','bonuses','sfs_employee','afp_employee','isr','other_deductions','deductions','sfs_employer','afp_employer','infotep_employer','net','notes','paid_at','created_at','updated_at'],
    fkCols: { empleado_supabase_id: 'empleados' } },
  { name: 'salary_changes', strategy: 'fww',
    cols: ['old_salary','new_salary','effective_date','reason','created_at','updated_at'],
    fkCols: { empleado_supabase_id: 'empleados' } },

  // Activity log — FWW (append-only audit feed)
  { name: 'activity_log', strategy: 'fww',
    cols: ['event_type','severity','actor_supabase_id','actor_name','actor_role','target_type','target_id','target_name','amount','old_value','new_value','reason','metadata','created_at','updated_at'],
    fkCols: { actor_supabase_id: 'users' } },

  // v2.17.x — journal_entries pull (Phase 3 spine). FWW — append-only,
  // reversals are new rows. No SQLite FKs declared (source_id/employee_id/
  // client_id reference cross-vertical entities by supabase_id text).
  { name: 'journal_entries', strategy: 'fww',
    cols: ['location_id','tx_group_id','posted_at','effective_date','vertical',
           'source_table','source_id','source_line_id','account','category',
           'employee_id','client_id','debit','credit','currency','description',
           'metadata','reversal_of_id','reversed_by_id','created_by',
           'created_at','updated_at'] },

  // e-CF certificate rotation history — FWW (append-only audit trail).
  // Pushed to Supabase.ecf_cert_history. business_id stamped at push time.
  { name: 'ecf_cert_history', strategy: 'fww',
    cols: ['cert_serial','subject_cn','subject_rnc','issued_at','expires_at','installed_at','installed_by_user_id','installed_by_name','installed_from','rotation_reason','sha256_fingerprint','prev_serial','prev_expires_at','created_at','updated_at'] },

  // v2.4 — Carwash memberships + wash_combos (LWW — desktop is edit-heavy source of truth)
  { name: 'memberships', strategy: 'lww',
    cols: ['plan_name','plan_price','wash_quota_per_month','washes_used_this_period',
           'period_start','period_end','start_date','end_date','status','notes',
           // v2.16.1 — salon catalog extension
           'nombre','total_sessions','price_dop','validity_days','active_template',
           'created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', vehicle_supabase_id: 'vehicles', service_supabase_id: 'services' } },
  // v2.16.1 — Salon hardening
  { name: 'client_memberships', strategy: 'lww',
    cols: ['sessions_remaining','purchased_at','expires_at','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', membership_supabase_id: 'memberships', ticket_supabase_id: 'tickets' } },
  { name: 'membership_redemptions', strategy: 'fww',
    cols: ['redeemed_at','created_at','updated_at'],
    fkCols: { client_membership_supabase_id: 'client_memberships', ticket_supabase_id: 'tickets', appointment_supabase_id: 'appointments' } },
  { name: 'appointment_reminders', strategy: 'lww',
    cols: ['fire_at','kind','status','ultramsg_message_id','error','sent_at','created_at','updated_at'],
    fkCols: { appointment_supabase_id: 'appointments' } },
  { name: 'wash_combos', strategy: 'lww',
    cols: ['combo_name','total_washes','used_washes','purchase_price','purchased_at',
           'expires_at','status','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', vehicle_supabase_id: 'vehicles' } },

  // v2.6 — Service vertical
  { name: 'subscriptions', strategy: 'lww',
    cols: ['plan_name','interval_days','amount','start_date','next_billing_date','last_billed_at',
           'status','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', service_supabase_id: 'services' } },
  { name: 'service_packages', strategy: 'lww',
    cols: ['package_name','total_sessions','used_sessions','purchase_price','purchased_at',
           'expires_at','status','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', service_supabase_id: 'services' } },
  { name: 'projects', strategy: 'lww',
    cols: ['name','description','status','total_billed','closed_at','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients' } },
  { name: 'client_service_rates', strategy: 'lww',
    cols: ['custom_price','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', service_supabase_id: 'services' } },
  { name: 'client_item_prices', strategy: 'lww',
    cols: ['custom_price','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', inventory_item_supabase_id: 'inventory_items' } },
  // v2.11 — loyalty ledger. FWW because each transaction is append-only
  // (earn/redeem/adjust) — once written it should not be edited by another
  // device. The derived clients.loyalty_points / loyalty_tier columns sync
  // via the normal clients pull and are the source of truth for balance.
  { name: 'loyalty_transactions', strategy: 'fww',
    cols: ['event_type','points','balance_after','notes','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients', ticket_supabase_id: 'tickets' } },

  // v2.5 — Conteo Fisico pull. LWW: UI edits on one device must propagate to
  // the other until completion. Status transitions (abierto → completado /
  // cancelado) flow through the same updated_at check.
  { name: 'inventory_counts', strategy: 'lww',
    cols: ['title','started_at','completed_at','counted_by_name','status','notes',
           'total_expected_value','total_counted_value','total_variance_value',
           'created_at','updated_at'] },
  // inventory_count_items: variance_* are generated columns on Supabase — do
  // NOT list them here (pull would try to write them into SQLite which has no
  // such column and the row would be dropped on the "no such column" error).
  { name: 'inventory_count_items', strategy: 'lww',
    cols: ['sku','name','category','expected_qty','counted_qty','unit_cost','unit_price','notes','created_at','updated_at'],
    fkCols: { count_supabase_id: 'inventory_counts', inventory_item_supabase_id: 'inventory_items' } },

  // v2.10.5 — ecf_queue pull (Recovery RTO HIGH fix). On a fresh install
  // we WANT to pull the pending queue so processDgiiQueue() can resume
  // submission. LWW on status transitions (pending → submitted/failed).
  // Natural key `encf` heals supabase_id drift after a wipe-and-reinstall.
  { name: 'ecf_queue', strategy: 'lww', naturalKey: 'encf',
    cols: ['url_path','body_json','token','xml_signed','encf','tipo_ecf','environment',
           'status','track_id','attempts','last_tried','submitted_at','last_error',
           'ticket_supabase_id','created_at','updated_at'] },

  // v2.3 — app_settings pull (whitelist-guarded, handled by pullAppSettings()).
  // cols/strategy are informational only — the pull path short-circuits at the
  // top of pullTable() for this name.
  { name: 'app_settings', strategy: 'lww', naturalKey: 'key',
    cols: ['key','value','updated_at'] },

  // v2.16.0 — Taller Mecánico hardening
  { name: 'aseguradoras', strategy: 'lww', naturalKey: 'nombre',
    cols: ['nombre','rnc','contacto_telefono','contacto_email','ecf_mode','notas','active','created_at','updated_at'] },
  { name: 'suppliers', strategy: 'lww', naturalKey: 'nombre',
    cols: ['nombre','rnc','telefono','contacto','notas','active','created_at','updated_at'] },
  { name: 'parts_orders', strategy: 'lww',
    cols: ['part_name','part_sku','quantity','unit_cost_estimate','expected_at','received_at','received_barcode','status','notes','created_at','updated_at'],
    fkCols: { work_order_supabase_id: 'work_orders', supplier_supabase_id: 'suppliers' } },
  { name: 'work_order_photos', strategy: 'fww',
    cols: ['phase','storage_path','caption','created_at'],
    fkCols: { work_order_supabase_id: 'work_orders', vehicle_supabase_id: 'vehicles', taken_by_empleado_supabase_id: 'empleados' } },
  { name: 'insurance_batches', strategy: 'lww',
    cols: ['period_month','ecf_supabase_id','ecf_ncf','total_amount','itbis_amount','pdf_storage_path','work_order_count','status','notes','created_at','updated_at'],
    fkCols: { aseguradora_supabase_id: 'aseguradoras' } },

  // ── v2.16.3 — Carnicería hardening (PULL definitions) ────────────────────
  { name: 'carniceria_corte_categories', strategy: 'lww', naturalKey: 'nombre',
    cols: ['nombre','nombre_dr_popular','tooltip_traduccion','especie','photo_url','nutrition_json','sort_order','active','created_at','updated_at'] },
  { name: 'inventory_freshness_log', strategy: 'fww',
    cols: ['batch_lote','received_at','expires_at','qty_received','qty_remaining','unit','auto_discount_applied','created_at','updated_at'],
    fkCols: { inventory_item_supabase_id: 'inventory_items' } },
  { name: 'inventory_discards', strategy: 'fww',
    cols: ['qty','unit','motivo','photo_url','created_at','updated_at'],
    fkCols: { inventory_item_supabase_id: 'inventory_items', freshness_log_supabase_id: 'inventory_freshness_log', empleado_supabase_id: 'empleados' } },
  { name: 'recurring_orders', strategy: 'lww', naturalKey: 'nombre',
    cols: ['nombre','dia_semana','items_json','total_estimado','whatsapp_confirmar','last_sent_at','active','created_at','updated_at'],
    fkCols: { client_supabase_id: 'clients' } },
  { name: 'carniceria_scales', strategy: 'lww', naturalKey: 'nombre',
    cols: ['nombre','tipo','device_path','protocol','baud_rate','capacidad_max_lb','tare_default','active_default','active','created_at','updated_at'] },
  { name: 'promotions', strategy: 'lww', naturalKey: 'name',
    cols: ['name','tipo','discount_pct','discount_fixed','min_purchase','start_date','end_date','season_key','banner_text','active','created_at','updated_at'] },
  { name: 'promotion_items', strategy: 'lww',
    cols: ['item_type','item_supabase_id','created_at','updated_at'],
    fkCols: { promotion_supabase_id: 'promotions' } },
  // ── Phase 1B — Contabilidad firm-side suite ──────────────────────────────
  // BIGINT accounting_client_id is the in-schema FK; no UUID FK companion
  // exists yet (Phase 2). Cross-device firms with multi-desktop topology
  // should pin one device as source-of-truth until then.
  { name: 'accounting_clients', strategy: 'lww', naturalKey: 'nombre_comercial',
    cols: ['client_business_supabase_id','nombre_comercial','rnc','cedula','tipo_persona','regimen','fecha_cierre_mes','fecha_cierre_dia','honorarios_mensuales','currency','assigned_to_user_id','status','notes','created_at','updated_at'] },
  { name: 'accounting_inbox', strategy: 'lww',
    cols: ['accounting_client_id','accounting_client_supabase_id','source','original_filename','mime','size','r2_key','ocr_status','ocr_text','classified_type','classification_confidence','status','posted_journal_entry_id','posted_at','notes','created_at','updated_at'] },
  { name: 'accounting_obligations_calendar', strategy: 'lww',
    cols: ['accounting_client_id','accounting_client_supabase_id','form_type','period_year','period_month','due_date','status','filed_at','filed_by_user_id','dgii_constancia_no','attachment_supabase_id','notes','created_at','updated_at'] },
  { name: 'accounting_documents', strategy: 'lww',
    cols: ['accounting_client_id','accounting_client_supabase_id','category','period_year','period_month','filename','r2_key','mime','size','uploaded_by_user_id','expires_at','tags','notes','created_at','updated_at'] },
  { name: 'accounting_billing_plans', strategy: 'lww',
    cols: ['accounting_client_id','accounting_client_supabase_id','monthly_amount','currency','bill_day','ecf_type','late_fee_pct','late_fee_after_days','active','notes','created_at','updated_at'] },
  { name: 'accounting_billing_invoices', strategy: 'lww',
    cols: ['accounting_client_id','accounting_client_supabase_id','ticket_supabase_id','period_year','period_month','amount','currency','status','ecf_track_id','ecf_status','paid_at','created_at','updated_at'] },
  { name: 'accounting_csv_mappings', strategy: 'lww',
    cols: ['accounting_client_id','accounting_client_supabase_id','doc_type','name','mapping_json','created_at','updated_at'] },

  // ── Phase 2 Slice 1 — Contabilidad full firm-side (PULL) ────────────────
  { name: 'accounting_chart_of_accounts', strategy: 'lww',
    cols: ['accounting_client_id','accounting_client_supabase_id','code','parent_id','parent_supabase_id','name','type','is_postable','currency','notes','created_at','updated_at'] },
  { name: 'accounting_journal_entries', strategy: 'lww',
    cols: ['accounting_client_id','accounting_client_supabase_id','fecha','description','type','reference_doc_supabase_id','status','posted_by_user_id','period_year','period_month','totals_debit','totals_credit','created_at','updated_at'] },
  { name: 'accounting_journal_lines', strategy: 'lww',
    cols: ['journal_entry_id','journal_entry_supabase_id','account_id','account_supabase_id','debit','credit','currency','exchange_rate','memo','created_at','updated_at'] },
  { name: 'accounting_coa_auto_post_rules', strategy: 'lww',
    cols: ['accounting_client_id','accounting_client_supabase_id','event','condition_json','debit_account_id','debit_account_supabase_id','credit_account_id','credit_account_supabase_id','priority','active','created_at','updated_at'] },
  { name: 'accounting_bank_accounts', strategy: 'lww',
    cols: ['accounting_client_id','accounting_client_supabase_id','banco','account_no_last4','account_type','currency','opening_balance','active','created_at','updated_at'] },
  { name: 'accounting_bank_statement_lines', strategy: 'lww',
    cols: ['bank_account_id','bank_account_supabase_id','fecha','descripcion','referencia','debit','credit','balance','matched_journal_line_id','matched_journal_line_supabase_id','match_status','raw_row','created_at','updated_at'] },
  { name: 'accounting_fixed_assets', strategy: 'lww',
    cols: ['accounting_client_id','accounting_client_supabase_id','name','categoria','fecha_adquisicion','costo','vida_util_meses','valor_residual','depreciacion_acumulada','status','sold_at','sold_amount','notes','created_at','updated_at'] },
  { name: 'accounting_retentions_emitidas', strategy: 'lww',
    cols: ['accounting_client_id','accounting_client_supabase_id','fecha','beneficiario_rnc','beneficiario_nombre','tipo','base','tasa','retencion','ncf_emitido','comprobante_url','created_at','updated_at'] },
  { name: 'accounting_retentions_recibidas', strategy: 'lww',
    cols: ['accounting_client_id','accounting_client_supabase_id','fecha','retenedor_rnc','retenedor_nombre','tipo','base','tasa','retencion','comprobante_url','created_at','updated_at'] },
  { name: 'accounting_payroll_periods', strategy: 'lww',
    cols: ['accounting_client_id','accounting_client_supabase_id','year','month','status','totals_json','created_at','updated_at'] },
  { name: 'accounting_payroll_lines', strategy: 'lww',
    cols: ['payroll_period_id','payroll_period_supabase_id','employee_name','employee_cedula','employee_nss','salario_base','dependientes','afp','ars','sfs','riesgos_laborales','isr','otras_deducciones','neto','created_at','updated_at'] },
  { name: 'accounting_tss_filings', strategy: 'lww',
    cols: ['accounting_client_id','accounting_client_supabase_id','year','month','filename','file_supabase_id','status','created_at','updated_at'] },
  { name: 'accounting_tasks', strategy: 'lww',
    cols: ['accounting_client_id','accounting_client_supabase_id','title','description','assigned_to_user_id','status','priority','due_date','parent_obligation_supabase_id','created_at','updated_at'] },
  { name: 'accounting_foreign_payments', strategy: 'lww',
    cols: ['accounting_client_id','accounting_client_supabase_id','fecha','beneficiario_id','beneficiario_pais','beneficiario_nombre','tipo_renta','moneda','monto_moneda_pago','tasa_cambio','monto_local','isr_retenido','created_at','updated_at'] },
]

// -- Pull upsert: Supabase row -> SQLite row ----------------------------------
// Cache pragma_table_info lookups so we don't hit SQLite on every row.
const _tableColCache = new Map()
// v2.16.12 — once-per-process tracker for missing-column log lines so we
// don't spam the log with the same warning on every pull tick.
const _skipColLogged = new Set()
function _tableHasColumn(tableName, colName) {
  const key = `${tableName}.${colName}`
  if (_tableColCache.has(key)) return _tableColCache.get(key)
  let has = false
  try {
    const rows = _db.rawPrepare(`PRAGMA table_info(${tableName})`).all()
    has = rows.some(r => r.name === colName)
  } catch {}
  _tableColCache.set(key, has)
  return has
}

function pullUpsertRow(tableName, row, strategy, cols, fkCols, statusSync, naturalKey) {
  if (!row.supabase_id) return

  // 1. Try match by supabase_id (primary identity)
  // Note: not all tables have `active` — use COALESCE via a safe query
  let existing
  try {
    existing = _db.rawPrepare(`SELECT id, updated_at, supabase_id, active FROM ${tableName} WHERE supabase_id = ?`).get(row.supabase_id)
  } catch {
    // Table lacks `active` column — query without it
    existing = _db.rawPrepare(`SELECT id, updated_at, supabase_id FROM ${tableName} WHERE supabase_id = ?`).get(row.supabase_id)
  }

  // 2. If no match and table has a natural key, try match by natural key.
  //    This handles DB rebuilds where the local supabase_id was lost/regenerated.
  //    "Healing": adopt the server's supabase_id so future syncs match correctly.
  //    SAFETY: only heal if EXACTLY ONE local row matches — multiple matches means
  //    the name is ambiguous (e.g. two clients named "Juan"), so skip healing to
  //    avoid overwriting the wrong record. The row will INSERT as a new local entry.
  if (!existing && naturalKey && row[naturalKey]) {
    try {
      let matches
      try {
        matches = _db.rawPrepare(
          `SELECT id, updated_at, supabase_id, active FROM ${tableName} WHERE ${naturalKey} = ?`
        ).all(row[naturalKey])
      } catch {
        matches = _db.rawPrepare(
          `SELECT id, updated_at, supabase_id FROM ${tableName} WHERE ${naturalKey} = ?`
        ).all(row[naturalKey])
      }
      // Security: never heal onto an INACTIVE local row (e.g. deleted user whose
      // username got reused — healing would adopt the dead row's supabase_id and
      // then subsequent pulls would clobber the new row's credentials with the
      // old user's data). Active rows only. Remote must also be active.
      const remoteActive = row.active == null ? true : !!row.active
      const activeMatches = matches.filter(m => m.active == null || m.active === 1)
      if (remoteActive && activeMatches.length === 1) {
        const byName = activeMatches[0]
        _db.rawPrepare(`UPDATE ${tableName} SET supabase_id = ? WHERE id = ?`).run(row.supabase_id, byName.id)
        log.info(`[sync-pull] ${tableName}: healed supabase_id for "${row[naturalKey]}" (${byName.supabase_id} → ${row.supabase_id})`)
        existing = byName
        existing.supabase_id = row.supabase_id
      } else if (matches.length > 1) {
        log.warn(`[sync-pull] ${tableName}: skipped naturalKey heal for "${row[naturalKey]}" — ${matches.length} local matches (${activeMatches.length} active, remote active=${remoteActive})`)
      }
    } catch {} // naturalKey column may not exist — skip gracefully
  }

  if (existing) {
    // Row exists locally
    if (strategy === 'fww') {
      // First-write-wins: only sync status updates for tickets
      if (statusSync && tableName === 'tickets') {
        const localRow = _db.rawPrepare('SELECT status FROM tickets WHERE id = ?').get(existing.id)
        if (localRow?.status !== row.status && row.status) {
          const updates = statusSync.filter(c => row[c] != null).map(c => `${c} = ?`)
          if (updates.length) {
            const vals = statusSync.filter(c => row[c] != null).map(c => sqliteValue(c, row[c]))
            _db.rawPrepare(`UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`).run(...vals, existing.id)
          }
        }
      }
      // FWW: don't overwrite existing records beyond status
      return
    }

    // LWW: only update if remote is newer.
    // CRITICAL — compare as numeric ms, NEVER as strings. SQLite historically
    // stored `'YYYY-MM-DD HH:MM:SS'` (space separator) while Supabase returns
    // `'YYYY-MM-DDTHH:MM:SS.µµµ+00:00'` (T separator). String compare treats
    // ' ' (0x20) < 'T' (0x54) so remote ALWAYS sorted higher regardless of
    // actual wall-clock time, causing every pull to clobber every local edit.
    // v2.0 migration rewrites existing SQLite rows to ISO-8601 so the two
    // shapes become identical, but this guard defends against any stray row
    // that slipped through (old migration flag set + some table missed).
    if (existing.updated_at && row.updated_at) {
      const localRaw  = String(existing.updated_at)
      const remoteRaw = String(row.updated_at)
      // Normalize the SQLite "YYYY-MM-DD HH:MM:SS" shape to ISO before Date.parse
      // so Date.parse doesn't silently NaN on some Electron/Chromium builds.
      const localIso  = localRaw.includes('T')  ? localRaw  : localRaw.replace(' ', 'T') + (localRaw.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(localRaw) ? '' : 'Z')
      const remoteIso = remoteRaw.includes('T') ? remoteRaw : remoteRaw.replace(' ', 'T') + (remoteRaw.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(remoteRaw) ? '' : 'Z')
      const localMs  = Date.parse(localIso)
      const remoteMs = Date.parse(remoteIso)
      if (Number.isFinite(localMs) && Number.isFinite(remoteMs) && remoteMs <= localMs) return
    }

    // Guard: if locally soft-deleted (active=0) and remote says active, local delete wins.
    // Desktop is authoritative for deletions — pull must never resurrect deleted rows.
    if (existing.active === 0 && (row.active === true || row.active === 1)) return

    // Build UPDATE
    const setClauses = []
    const setVals = []
    // v2.16.12 — guard against silent NULL drops on synced columns. Skip cols
    // whose local schema doesn't have the column (drop quietly), but include
    // null/undefined cloud values when the column DOES exist locally — this
    // keeps the row consistent (e.g. cleared notes propagate). The exception
    // is `undefined`, which means PostgREST didn't return the field at all
    // (column added cloud-side but not in select=*); we leave local untouched
    // in that case to avoid clobbering with NULL.
    for (const col of cols) {
      if (row[col] === undefined) continue
      if (!_tableHasColumn(tableName, col)) {
        // Local schema lacks this column — log once and skip. Caller can add
        // an ALTER TABLE migration. Without this guard the entire UPDATE
        // throws "no such column" and the whole row fails to update,
        // leaving every other column stale (this was the v2.16.8 silent-
        // skip pattern that surfaced as the pin_salt bug).
        if (!_skipColLogged.has(`${tableName}.${col}`)) {
          _skipColLogged.add(`${tableName}.${col}`)
          log.warn(`[sync-pull] ${tableName}: column "${col}" missing in local SQLite — skipped (add ALTER TABLE migration)`)
        }
        continue
      }
      setClauses.push(`${col} = ?`)
      setVals.push(sqliteValue(col, row[col]))
    }
    // Resolve FK columns
    if (fkCols) {
      for (const [fkCol, refTable] of Object.entries(fkCols)) {
        if (row[fkCol]) {
          setClauses.push(`${fkCol} = ?`)
          setVals.push(row[fkCol])
          // Also resolve to local integer ID — but only if the local table
          // actually has a *_id column. v2.1 commission tables dropped the
          // INT FK in favour of *_supabase_id only, so blindly adding e.g.
          // `empleado_id = ?` here used to throw `no such column: empleado_id`
          // and silently abort the whole pull for every commission row.
          const localCol = fkCol.replace('_supabase_id', '_id')
          if (_tableHasColumn(tableName, localCol)) {
            try {
              const refRow = _db.rawPrepare(`SELECT id FROM ${refTable} WHERE supabase_id = ?`).get(row[fkCol])
              if (refRow) {
                setClauses.push(`${localCol} = ?`)
                setVals.push(refRow.id)
              }
            } catch { /* ref table may not have the row yet */ }
          }
        }
      }
    }
    if (setClauses.length) {
      setVals.push(existing.id)
      _db.rawPrepare(`UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = ?`).run(...setVals)
    }
  } else {
    // Row doesn't exist locally — INSERT
    const insertCols = ['supabase_id']
    const insertVals = [row.supabase_id]

    for (const col of cols) {
      if (row[col] === undefined) continue
      if (!_tableHasColumn(tableName, col)) {
        if (!_skipColLogged.has(`${tableName}.${col}`)) {
          _skipColLogged.add(`${tableName}.${col}`)
          log.warn(`[sync-pull] ${tableName}: column "${col}" missing in local SQLite — skipped on INSERT`)
        }
        continue
      }
      insertCols.push(col)
      insertVals.push(sqliteValue(col, row[col]))
    }
    // Resolve FK columns
    if (fkCols) {
      for (const [fkCol, refTable] of Object.entries(fkCols)) {
        if (row[fkCol]) {
          insertCols.push(fkCol)
          insertVals.push(row[fkCol])
          const localCol = fkCol.replace('_supabase_id', '_id')
          if (_tableHasColumn(tableName, localCol)) {
            try {
              const refRow = _db.rawPrepare(`SELECT id FROM ${refTable} WHERE supabase_id = ?`).get(row[fkCol])
              if (refRow) {
                insertCols.push(localCol)
                insertVals.push(refRow.id)
              }
            } catch { /* ref table may not have the row yet */ }
          }
        }
      }
    }

    const placeholders = insertCols.map(() => '?').join(',')
    try {
      _db.rawPrepare(`INSERT INTO ${tableName} (${insertCols.join(',')}) VALUES (${placeholders})`).run(...insertVals)
    } catch (e) {
      // Unique constraint violation = row already exists (race condition) — skip
      if (!e.message?.includes('UNIQUE constraint')) throw e
    }
  }
}

// -- Pull a single table from Supabase ----------------------------------------
async function pullTable(tableConfig) {
  const { name, supabaseTable, strategy, cols, fkCols, statusSync } = tableConfig
  const bizId = await resolveBusinessId()
  if (!bizId) throw new Error('No business_id')

  // Special-case: app_settings is keyed by TEXT `key` and we only accept
  // whitelisted business-level keys on pull. Device keys (printer, print_*)
  // on this device MUST NEVER be clobbered by cloud state.
  if (name === 'app_settings') {
    return await pullAppSettings(bizId)
  }

  const lastPull = getLastPullAt(name)
  const FETCH_SIZE = 500
  let totalPulled = 0
  let latestUpdatedAt = lastPull

  // Paginated pull
  let offset = 0
  while (true) {
    const params = {
      'business_id': `eq.${bizId}`,
      'order': 'updated_at.asc',
      'limit': String(FETCH_SIZE),
      'offset': String(offset),
      'supabase_id': 'not.is.null',
    }
    // `gte` (not `gt`) so the row at exactly lastPull gets re-fetched on the next
    // pass. Otherwise rows whose updated_at equals the stored cursor are orphaned
    // forever — hit this on 2026-04-11 when an INSERT failure advanced the cursor
    // past a row that never made it into local SQLite.
    if (lastPull) params['updated_at'] = `gte.${lastPull}`

    let rows
    try {
      // CRITICAL v2.13.17: respect supabaseTable override. Push path already did
      // this (line 2309) but pull did not — meant pulls for `users` hit the
      // `users` VIEW instead of the `staff` base table. If the VIEW omitted
      // columns (e.g. pin_hash_algo), updates to those columns never reached
      // desktops. Root cause of the 2026-04-22 PIN lockout incident.
      const fetchTable = supabaseTable || name
      rows = await supabaseFetch(fetchTable, params)
    } catch (e) {
      log.error(`[sync-pull] ${name}: fetch failed:`, e.message)
      _reportSyncError(e, `sync.pull.${name}.fetch_failed`)
      break
    }

    if (!rows.length) break

    // Upsert each row into SQLite. Only advance the cursor for rows that
    // actually succeeded — if an INSERT/UPDATE fails, we need the next pull
    // to try this row again, not skip it. (Fixed 2026-04-11 after asdadad
    // got stranded when v1.9.12's `no such column` error advanced the cursor
    // past a row that never made it into local SQLite.)
    for (const row of rows) {
      let ok = false
      try {
        pullUpsertRow(name, row, strategy, cols, fkCols, statusSync, tableConfig.naturalKey)
        ok = true
      } catch (e) {
        log.error(`[sync-pull] ${name}: upsert failed for ${row.supabase_id}:`, e.message)
        _reportSyncError(e, `sync.pull.${name}.upsert_failed:supabase_id=${row.supabase_id}`)
      }
      if (ok && row.updated_at) {
        if (!latestUpdatedAt) {
          latestUpdatedAt = row.updated_at
        } else {
          const rMs = Date.parse(String(row.updated_at).includes('T') ? row.updated_at : String(row.updated_at).replace(' ', 'T') + 'Z')
          const lMs = Date.parse(String(latestUpdatedAt).includes('T') ? latestUpdatedAt : String(latestUpdatedAt).replace(' ', 'T') + 'Z')
          if (Number.isFinite(rMs) && Number.isFinite(lMs) && rMs > lMs) latestUpdatedAt = row.updated_at
          else if (!Number.isFinite(lMs)) latestUpdatedAt = row.updated_at
        }
      }
    }

    totalPulled += rows.length
    offset += FETCH_SIZE
    if (rows.length < FETCH_SIZE) break
  }

  // Update pull cursor.
  // v2.14.25 — CRITICAL cursor-trap fix: previously we stored the raw
  // max(updated_at) of fetched rows, combined with `gte` in the next pull's
  // WHERE clause. That re-fetches the boundary row on every tick, and since
  // tickets run statusSync (overwriting local status/rev/updated_at on
  // every pull), any local mutation on that exact row gets silently
  // clobbered within 5 min. This is the bug behind "Cobrar-from-Cola runs,
  // factura prints, but local reverts to pendiente." Fix: advance the
  // cursor by 1ms past the newest row so `gte` still catches same-instant
  // ties but doesn't re-fetch the same boundary row forever.
  if (latestUpdatedAt) {
    try {
      const iso = String(latestUpdatedAt).includes('T')
        ? latestUpdatedAt
        : String(latestUpdatedAt).replace(' ', 'T') + 'Z'
      const ms = Date.parse(iso)
      const advanced = Number.isFinite(ms)
        ? new Date(ms + 1).toISOString()
        : latestUpdatedAt
      updatePullLog(name, advanced)
    } catch (e) {
      try { log.warn(`[sync-pull] ${name} cursor advance fallback:`, e?.message); _reportSyncError && _reportSyncError(e, `sync.pull.${name}.cursor_advance`) } catch {}
      updatePullLog(name, latestUpdatedAt)
    }
  }

  // v2.16.12 — log every pull attempt, including 0-row pulls. Previously
  // we logged only on totalPulled > 0, which made "pulled 0 silently" and
  // "skipped table entirely" indistinguishable in main.log — that's the
  // observability gap that hid the v2.16.8 anon-RLS-empty-result bug for
  // hours during the Studio X validation session.
  log.info(`[sync-pull] ${name}: pulled ${totalPulled} rows`)
  return totalPulled
}

// -- app_settings pull (whitelist-guarded, keyed by TEXT) --------------------
// Pulls:
//   1. Business-level rows (device_hwid IS NULL)                → always.
//   2. Device-local-mirror rows whose device_hwid = MY hwid       → recovery.
// Ignores device-local rows written by OTHER devices so device A's printer
// never lands on device B. This is the safe half of the RTO recovery design.
//
// Defense in depth: (1) whitelist check drops any rogue cloud row whose key
// isn't classified as business or device-mirror. (2) device-hwid filter
// ensures cross-device isolation. (3) web writer in packages/data/web.js
// refuses device-local cloud-mirror writes entirely (browsers have no stable
// HWID; they fall back to localStorage).
async function pullAppSettings(bizId) {
  const lastPull = getLastPullAt('app_settings')
  const FETCH_SIZE = 500
  let totalPulled = 0
  let latestUpdatedAt = lastPull
  let offset = 0

  // Resolve my HWID once — rows tagged with other HWIDs are skipped.
  let myHwid = null
  try { myHwid = _db.rawPrepare("SELECT value FROM app_settings WHERE key='hwid'").get()?.value || null }
  catch { myHwid = null }

  const upsert = _db.rawPrepare(`
    INSERT INTO app_settings(key, value, business_id, supabase_id, is_device_local, device_hwid, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value           = excluded.value,
      business_id     = excluded.business_id,
      supabase_id     = COALESCE(app_settings.supabase_id, excluded.supabase_id),
      is_device_local = excluded.is_device_local,
      device_hwid     = excluded.device_hwid,
      updated_at      = excluded.updated_at
    WHERE excluded.updated_at >= COALESCE(app_settings.updated_at, '')
  `)

  while (true) {
    const params = {
      'business_id': `eq.${bizId}`,
      'order': 'updated_at.asc',
      'limit': String(FETCH_SIZE),
      'offset': String(offset),
      'supabase_id': 'not.is.null',
    }
    if (lastPull) params['updated_at'] = `gte.${lastPull}`

    let rows
    try { rows = await supabaseFetch('app_settings', params) }
    catch (e) { log.error('[sync-pull] app_settings: fetch failed:', e.message); _reportSyncError(e, 'sync.pull.app_settings.fetch_failed'); break }
    if (!rows.length) break

    let skippedForeignDevice = 0
    for (const row of rows) {
      if (!row.supabase_id || !row.key) continue

      const rowIsDeviceLocal = row.is_device_local === true || row.is_device_local === 1
      const rowHwid = row.device_hwid || null

      // Classification gate
      if (rowIsDeviceLocal) {
        if (!isDeviceLocalCloudMirror(row.key)) continue // unknown device key — skip
        // Cross-device isolation: only apply rows tagged with MY hwid.
        if (!myHwid || rowHwid !== myHwid) { skippedForeignDevice++; continue }
      } else {
        if (!isBusinessSetting(row.key)) continue // rogue device key in a business slot — skip
      }

      try {
        upsert.run(
          row.key,
          row.value ?? '',
          row.business_id || bizId,
          row.supabase_id,
          rowIsDeviceLocal ? 1 : 0,
          rowIsDeviceLocal ? rowHwid : null,
          row.updated_at || new Date().toISOString()
        )
      } catch (e) {
        log.error('[sync-pull] app_settings: upsert failed for', row.key, ':', e.message)
      }
      if (row.updated_at) latestUpdatedAt = row.updated_at
    }

    totalPulled += rows.length
    if (skippedForeignDevice > 0) {
      log.info(`[sync-pull] app_settings: skipped ${skippedForeignDevice} rows from other devices`)
    }
    offset += FETCH_SIZE
    if (rows.length < FETCH_SIZE) break
  }

  // v2.14.25 — advance cursor by 1ms past max(updated_at) to prevent the
  // boundary-row re-fetch loop (see tickets cursor fix above for rationale).
  if (latestUpdatedAt) {
    try {
      const iso = String(latestUpdatedAt).includes('T')
        ? latestUpdatedAt
        : String(latestUpdatedAt).replace(' ', 'T') + 'Z'
      const ms = Date.parse(iso)
      updatePullLog('app_settings', Number.isFinite(ms) ? new Date(ms + 1).toISOString() : latestUpdatedAt)
    } catch (e) {
      try { log.warn('[sync-pull] app_settings cursor advance fallback:', e?.message); _reportSyncError && _reportSyncError(e, 'sync.pull.app_settings.cursor_advance') } catch {}
      updatePullLog('app_settings', latestUpdatedAt)
    }
  }
  log.info(`[sync-pull] app_settings: pulled ${totalPulled} rows (myHwid=${myHwid ? 'set' : 'unset'})`)
  return totalPulled
}

// -- Multi-biz orphan guard ---------------------------------------------------
// If the resolved business_id ever changes (license re-keyed to a different
// account, hardware moved, manual SUPABASE_BUSINESS_ID swap), the existing
// local rows belong to the OLD tenant and would now be invisible from the new
// tenant's pull cursor. Instead of silently mixing two tenants' data — or
// destroying it with a DELETE — we copy each synced table into a dated
// archive_<table>_<yyyymmdd> table on first pull under the new biz_id, then
// truncate the live table so the next pull rebuilds clean. This is destructive
// but recoverable: archives stay forever, support can restore on demand.
function archiveAndResetForBizSwap(newBizId) {
  try {
    const stamp = new Date().toISOString().slice(0,10).replace(/-/g,'')
    const lastBizRow = _db.rawPrepare("SELECT value FROM app_settings WHERE key='last_pulled_business_id'").get()
    const lastBiz = lastBizRow?.value || null
    if (!lastBiz) {
      // First pull ever — just record the biz_id, nothing to archive.
      _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('last_pulled_business_id',?)").run(String(newBizId))
      return
    }
    if (String(lastBiz) === String(newBizId)) return // same tenant — nothing to do

    log.warn(`[sync-pull] business_id changed: ${lastBiz} → ${newBizId} — archiving local data for safety`)
    const archivedTables = []
    for (const pt of PULL_TABLES) {
      const t = pt.name
      try {
        // Skip if local table has zero rows (no data to archive).
        const cnt = _db.rawPrepare(`SELECT COUNT(*) AS n FROM ${t}`).get()?.n || 0
        if (cnt === 0) continue
        const archive = `archived_${t}_${stamp}`
        // CTAS: copy all rows into a dated snapshot. Idempotent — if the same
        // dated archive already exists from a same-day re-trigger, we append.
        _db.rawPrepare(`CREATE TABLE IF NOT EXISTS ${archive} AS SELECT * FROM ${t} WHERE 0`).run()
        _db.rawPrepare(`INSERT INTO ${archive} SELECT * FROM ${t}`).run()
        _db.rawPrepare(`DELETE FROM ${t}`).run()
        // Reset pull cursor so the new tenant's rows pull from the beginning.
        try { _db.rawPrepare(`DELETE FROM sync_log WHERE table_name=?`).run(t) } catch {}
        archivedTables.push(`${archive}(${cnt})`)
      } catch (e) {
        log.error(`[sync-pull] archive ${t} failed:`, e.message)
      }
    }
    _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('business_id_changed_at',?)").run(new Date().toISOString())
    _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('last_pulled_business_id',?)").run(String(newBizId))
    log.warn(`[sync-pull] biz-swap archive complete:`, archivedTables.join(', '))
  } catch (e) {
    log.error('[sync-pull] archiveAndResetForBizSwap failed:', e.message)
  }
}

// -- Pull all tables ----------------------------------------------------------
async function pullNow() {
  if (!_url || !_key) return { pulled: 0 }
  await _maybeRefreshJwt()
  const bizId = await resolveBusinessId()
  if (!bizId) return { pulled: 0 }
  // v2.1: guard against pulling a different tenant's data on top of an existing
  // local DB — archive into archived_<table>_<yyyymmdd> instead of merging.
  archiveAndResetForBizSwap(bizId)

  const { BrowserWindow } = require('electron')
  const sendProgress = (payload) => {
    try {
      const w = BrowserWindow.getAllWindows()[0]
      if (w) w.webContents.send('sync:pull-progress', payload)
    } catch {}
  }

  // F16 — Total includes every PULL_TABLES entry + the business meta pull at the end.
  const totalSteps = PULL_TABLES.length + 1
  let step = 0
  let totalPulled = 0

  sendProgress({ stage: 'starting', done: 0, total: totalSteps, table: null })

  for (const pt of PULL_TABLES) {
    step += 1
    sendProgress({ stage: 'pulling', done: step - 1, total: totalSteps, table: pt.name })
    try {
      const count = await pullTable(pt)
      totalPulled += count
    } catch (e) {
      log.error(`[sync-pull] ${pt.name}:`, e.message)
      _reportSyncError(e, `sync.pullNow.${pt.name}`)
    }
    sendProgress({ stage: 'pulling', done: step, total: totalSteps, table: pt.name })
  }

  // F15 — pull business meta (name/rnc/logo/settings) so ciudad/whatsapp/etc.
  // propagate across devices. Counts as one step for UI progress.
  step += 1
  sendProgress({ stage: 'pulling', done: step - 1, total: totalSteps, table: 'businesses' })
  try {
    await pullBusinessMeta(bizId)
  } catch (e) {
    log.error('[sync-pull] businesses:', e.message)
    _reportSyncError(e, 'sync.pullNow.businesses')
  }
  sendProgress({ stage: 'pulling', done: step, total: totalSteps, table: 'businesses' })

  // Reconcile deletes: owner-deletable tables. If a row was deleted in
  // Supabase (from web or another device), mirror the delete locally.
  try { await reconcileDeletes() } catch (e) { log.warn('[sync-pull] reconcile failed:', e.message); _reportSyncError(e, 'sync.pullNow.reconcileDeletes') }

  log.info(`[sync-pull] Manual pull complete — ${totalPulled} rows`)

  // Notify renderer
  sendProgress({ stage: 'done', done: totalSteps, total: totalSteps, table: null })
  try {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) w.webContents.send('sync:pull-complete', { pulled: totalPulled })
  } catch {}

  return { pulled: totalPulled, tables: totalSteps }
}

// -- Sync a single table (PUSH) -----------------------------------------------
async function syncTable(tableConfig) {
  const { name, cols, rowFilter } = tableConfig
  const pushTable = tableConfig.supabaseTable || name // VIEW override (e.g. users → staff)
  const bizId = await resolveBusinessId()
  if (!bizId) throw new Error('No business_id')

  const FETCH_SIZE = 500
  // app_settings has no `id INTEGER` column — it's keyed by TEXT `key`.
  // Use rowid as the cursor surrogate so pagination still works.
  const isKeyedTable = (name === 'app_settings')
  const idExpr = isKeyedTable ? 'rowid AS id' : 'id'
  let cursor = getLastSyncedId(name)
  let totalSynced = 0

  // Pagination loop — keep fetching until no more rows
  while (true) {
    let rows
    try {
      rows = _db.rawPrepare(`SELECT *, ${idExpr} FROM ${name} WHERE ${isKeyedTable ? 'rowid' : 'id'} > ? ORDER BY ${isKeyedTable ? 'rowid' : 'id'} LIMIT ?`).all(cursor, FETCH_SIZE)
    } catch (e) {
      throw new Error(`SQLite read ${name}: ${e.message}`)
    }

    if (!rows.length) break

    // Apply rowFilter (business-setting whitelist, etc.) BEFORE supabase_id
    // stamping so we don't generate UUIDs on rows we'd immediately discard.
    let filtered = rowFilter ? rows.filter(rowFilter) : rows

    // Stamp supabase_id on rows that lack it (e.g. app_settings rows created
    // before the v2.3 backfill). Persist locally so the next push is a no-op.
    if (filtered.length && (name === 'app_settings')) {
      const stampStmt = _db.rawPrepare('UPDATE app_settings SET supabase_id = ? WHERE key = ?')
      for (const r of filtered) {
        if (!r.supabase_id) {
          const uuid = crypto.randomUUID()
          try { stampStmt.run(uuid, r.key); r.supabase_id = uuid } catch {}
        }
      }
    }

    // Map rows to Supabase format, skip rows without supabase_id (pre-migration)
    let mapped = filtered.map(r => ({ business_id: bizId, ...cols(r) })).filter(r => r.supabase_id)

    // FIX-HIGH-5 (v2.16.7): app_settings push-side LWW guard. The server-side
    // BEFORE UPDATE trigger used to unconditionally `NEW.updated_at := NOW()`,
    // which let a stale device-B push (e.g. dgii_environment=certecf, ts=09:00)
    // overwrite a fresh device-A flip (dgii_environment=prod, ts=10:00) because
    // the trigger bumped updated_at to NOW() and the merge-duplicates upsert
    // accepted the value. We fixed the trigger to enforce LWW server-side, but
    // we ALSO drop stale rows here so we don't burn a network round-trip and
    // don't depend on the server raising an error mid-batch (which would abort
    // the whole batch under PostgREST). Defense in depth.
    if (mapped.length && name === 'app_settings') {
      try {
        // Fetch remote updated_at for the keys we're about to push, in chunks.
        const keys = mapped.map(r => r.key).filter(Boolean)
        const remoteByKey = new Map()
        const CHUNK = 100
        for (let i = 0; i < keys.length; i += CHUNK) {
          const slice = keys.slice(i, i + CHUNK)
          const remote = await supabaseFetch('app_settings', {
            'business_id': `eq.${bizId}`,
            'key': `in.(${slice.map(k => `"${String(k).replace(/"/g, '\\"')}"`).join(',')})`,
            'select': 'key,updated_at,device_hwid',
            'limit': String(slice.length),
          })
          for (const r of remote || []) {
            // Key by (key, device_hwid) so the device-local mirror partition
            // doesn't collide with the business-level row (same key, distinct hwid).
            const partitionKey = `${r.key} ${r.device_hwid || ''}`
            remoteByKey.set(partitionKey, r.updated_at || null)
          }
        }
        const before = mapped.length
        mapped = mapped.filter(r => {
          const partitionKey = `${r.key} ${r.device_hwid || ''}`
          const remoteTs = remoteByKey.get(partitionKey)
          if (!remoteTs) return true // remote has no row yet — push wins
          // Compare ISO strings lexicographically (ISO-8601 is comparable as text).
          // Local updated_at may be 'YYYY-MM-DD HH:MM:SS' — normalize to ISO.
          const local = String(r.updated_at || '').includes('T')
            ? r.updated_at
            : String(r.updated_at || '').replace(' ', 'T') + 'Z'
          const localMs = Date.parse(local) || 0
          const remoteMs = Date.parse(remoteTs) || 0
          return localMs >= remoteMs
        })
        const dropped = before - mapped.length
        if (dropped > 0) log.info(`[sync] app_settings: LWW dropped ${dropped} stale rows (remote newer)`)
      } catch (e) {
        log.warn(`[sync] app_settings: LWW pre-check failed (${e.message}) — proceeding without`)
      }
    }

    // Batch upsert (500 at a time)
    if (mapped.length) {
      for (let i = 0; i < mapped.length; i += FETCH_SIZE) {
        const batch = mapped.slice(i, i + FETCH_SIZE)
        await supabaseUpsert(pushTable, batch)
        totalSynced += batch.length
      }
    }

    cursor = rows[rows.length - 1].id
    updateSyncLog(name, cursor, totalSynced, null)

    // If we got fewer rows than the fetch size, we're done
    if (rows.length < FETCH_SIZE) break
  }

  // Pass 2 — re-sync rows that were UPDATED since last sync
  // This catches balance changes, status updates, stock adjustments, etc.
  // Guard against re-pushing rows we just PULLED: `pullUpsertRow` stamps
  // remote updated_at locally, so those rows qualify for pass-2 until the
  // next push cursor advances. Comparing to max(last_synced_at, last_pull_at)
  // filters them out. Only locally-edited rows have updated_at > both cursors.
  const lastSyncedAt = getLastSyncedAt(name)
  const lastPullAt = getLastPullAt(name)
  const passTwoCursor = [lastSyncedAt, lastPullAt].filter(Boolean).sort().pop()
  if (passTwoCursor) {
    try {
      const orderCol = isKeyedTable ? 'rowid' : 'id'
      const updatedRows = _db.rawPrepare(
        `SELECT * FROM ${name} WHERE updated_at > ? AND supabase_id IS NOT NULL ORDER BY ${orderCol} LIMIT 2000`
      ).all(passTwoCursor)
      const passTwoFiltered = rowFilter ? updatedRows.filter(rowFilter) : updatedRows
      if (passTwoFiltered.length) {
        const mapped = passTwoFiltered.map(r => ({ business_id: bizId, ...cols(r) })).filter(r => r.supabase_id)
        if (mapped.length) {
          for (let i = 0; i < mapped.length; i += FETCH_SIZE) {
            const batch = mapped.slice(i, i + FETCH_SIZE)
            await supabaseUpsert(pushTable, batch)
            totalSynced += batch.length
          }
          log.info(`[sync] ${name}: re-synced ${mapped.length} updated rows`)
        }
      }
    } catch (e) {
      // updated_at column may not exist on all tables — skip gracefully
      if (!e.message?.includes('no such column')) {
        log.error(`[sync] ${name} update-pass:`, e.message)
      }
    }
  }

  _status.tables[name] = { synced: true, rows: totalSynced, lastId: cursor }
  return totalSynced
}

// -- Push business meta (name, rnc, phone, address, logo) --------------------
// Runs as part of every sync cycle. Logo is uploaded to Supabase Storage only
// if its SHA-256 hash has changed since last push (idempotent, offline-safe).
async function pushBusinessMeta(bizId) {
  try {
    const emp = _db.rawPrepare('SELECT name, rnc, phone, address, email, logo, settings, mora_rate_daily FROM businesses LIMIT 1').get()
    if (!emp) return 0

    // Compute logo hash (if present)
    let logoHash = null
    if (emp.logo && Buffer.isBuffer(emp.logo) && emp.logo.length > 0) {
      logoHash = crypto.createHash('sha256').update(emp.logo).digest('hex')
    }

    const lastHashRow = _db.rawPrepare("SELECT value FROM app_settings WHERE key = 'logo_synced_hash'").get()
    const lastLogoUrlRow = _db.rawPrepare("SELECT value FROM app_settings WHERE key = 'logo_synced_url'").get()
    const lastHash = lastHashRow?.value || null
    let logoUrl = lastLogoUrlRow?.value || null

    // Upload logo to Supabase Storage if changed
    if (logoHash && logoHash !== lastHash) {
      try {
        // Detect MIME from magic bytes (simple check)
        let ext = 'png', mime = 'image/png'
        const b = emp.logo
        if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) { ext = 'jpg'; mime = 'image/jpeg' }
        else if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) { ext = 'gif'; mime = 'image/gif' }
        else if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45) { ext = 'webp'; mime = 'image/webp' }

        const objectPath = `${bizId}/logo.${ext}`
        logoUrl = await uploadToStorage('business-logos', objectPath, b, mime)

        // Persist hash + URL locally so we don't re-upload
        _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES('logo_synced_hash', ?)").run(logoHash)
        _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES('logo_synced_url', ?)").run(logoUrl)
        log.info('[sync] Logo uploaded to Storage:', logoUrl)
      } catch (e) {
        // Storage RLS blocks anon key — warn once, not every cycle
        if (e.message?.includes('403') || e.message?.includes('Unauthorized')) {
          log.warn('[sync] Logo upload skipped (storage RLS — needs service role key)')
        } else {
          log.error('[sync] Logo upload failed:', e.message)
        }
      }
    }

    // Build update payload (only non-empty values)
    const updates = {}
    if (emp.name)    updates.name    = emp.name
    if (emp.rnc)     updates.rnc     = emp.rnc
    if (emp.phone)   updates.phone   = emp.phone
    if (emp.address) updates.address = emp.address
    if (emp.email)   updates.email   = emp.email
    if (emp.mora_rate_daily != null) updates.mora_rate_daily = Number(emp.mora_rate_daily)
    if (logoUrl)     updates.logo_url = logoUrl
    // Push the settings JSON (ciudad / biz_city / biz_type / whatsapp_* / fiscal cert
    // fields) so user edits in Mi Empresa actually survive a desktop wipe + re-pull.
    if (emp.settings) {
      try { updates.settings = typeof emp.settings === 'string' ? JSON.parse(emp.settings) : emp.settings } catch {}
    }
    if (!Object.keys(updates).length) return 0

    // ISO-8601 UTC — same shape the v2 SQLite migration produces, so LWW compares cleanly
    updates.updated_at = new Date().toISOString()

    // F12 — Prefer the server-side JSONB merge RPC when we're touching `settings`,
    // so concurrent writers (desktop-A's biz_city edit vs desktop-B's WhatsApp
    // edit vs validate.js's cert-status patch) stack additively instead of
    // clobbering one another. Falls back to the legacy full-PATCH path if the
    // RPC isn't available (older Supabase rev pre-v2 migration).
    if (updates.settings && typeof updates.settings === 'object') {
      const patchObj = updates.settings
      // Attempt merge RPC first
      try {
        const rpcBody = JSON.stringify({ p_business_id: bizId, p_patch: patchObj })
        const rpcOk = await new Promise((resolve) => {
          const reqUrl = new URL(`${_url}/rest/v1/rpc/merge_business_settings`)
          const req = https.request({
            hostname: reqUrl.hostname, path: reqUrl.pathname + reqUrl.search, method: 'POST',
            headers: _authHeaders({
              'Content-Type': 'application/json', 'Prefer': 'return=minimal',
              'Content-Length': Buffer.byteLength(rpcBody),
            }),
          }, (r) => {
            let data = ''
            r.on('data', c => data += c.toString())
            r.on('end', () => resolve(r.statusCode >= 200 && r.statusCode < 300))
          })
          req.on('error', () => resolve(false))
          req.setTimeout(SYNC_TIMEOUT_MS, () => { try { req.destroy() } catch {}; resolve(false) })
          req.write(rpcBody)
          req.end()
        })
        if (rpcOk) {
          // Merge RPC handled settings — drop it from the PATCH so we don't full-replace.
          delete updates.settings
          if (!Object.keys(updates).filter(k => k !== 'updated_at').length) return 1
        }
      } catch { /* fall through to legacy PATCH */ }
    }

    // PATCH businesses row
    const body = JSON.stringify(updates)
    await new Promise((resolve, reject) => {
      const reqUrl = new URL(`${_url}/rest/v1/businesses?id=eq.${encodeURIComponent(bizId)}`)
      const req = https.request({
        hostname: reqUrl.hostname, path: reqUrl.pathname + reqUrl.search, method: 'PATCH',
        headers: _authHeaders({ 'Content-Type': 'application/json', 'Prefer': 'return=minimal', 'Content-Length': Buffer.byteLength(body) }),
      }, (r) => {
        let data = ''
        r.on('data', c => data += c.toString())
        r.on('end', () => r.statusCode >= 200 && r.statusCode < 300 ? resolve() : reject(new Error(`businesses PATCH ${r.statusCode}: ${data}`)))
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })
    return 1
  } catch (e) {
    log.error('[sync] pushBusinessMeta failed:', e.message)
    return 0
  }
}

// -- Pull business meta (F15) -------------------------------------------------
// Counterpart to pushBusinessMeta. Fetches `name, rnc, phone, address, email,
// logo_url, settings, plan` from Supabase and writes them to the local
// `businesses` row via db.empresaSave (same flat+JSON.stringify(settings)
// shape LicenseContext uses). This is the only path by which Device B ever
// sees Device A's ciudad / whatsapp / logo edits.
async function pullBusinessMeta(bizId) {
  if (!_url || !_key || !bizId) return 0
  try {
    const params = new URLSearchParams({
      'id': `eq.${bizId}`,
      'select': 'name,rnc,phone,address,email,logo_url,settings,plan,mora_rate_daily,updated_at',
    })
    const rows = await new Promise((resolve, reject) => {
      const reqUrl = new URL(`${_url}/rest/v1/businesses?${params.toString()}`)
      https.get({
        hostname: reqUrl.hostname, path: reqUrl.pathname + reqUrl.search,
        headers: _authHeaders(),
      }, (r) => {
        let data = ''
        r.on('data', c => data += c.toString())
        r.on('end', () => {
          if (r.statusCode >= 200 && r.statusCode < 300) {
            try { resolve(JSON.parse(data)) } catch { resolve([]) }
          } else reject(new Error(`businesses GET ${r.statusCode}: ${data.substring(0, 200)}`))
        })
      }).on('error', reject).setTimeout?.(SYNC_TIMEOUT_MS, function () { try { this.destroy() } catch {} })
    }).catch(e => { log.warn('[sync] pullBusinessMeta fetch:', e.message); return [] })

    const biz = Array.isArray(rows) && rows[0] ? rows[0] : null
    if (!biz) return 0

    // Logo pull runs BEFORE the LWW gate because it has its own idempotency
    // marker (logo_synced_url in app_settings). If local biz.updated_at is
    // newer than cloud — which is the common case after any local save —
    // the LWW block below returns early, and if we left the logo download
    // inside that gate it would never fire. A fresh install or biz that
    // uploaded its logo via the web panel would never get a printable logo.
    if (biz.logo_url && typeof biz.logo_url === 'string' && /^https?:\/\//.test(biz.logo_url)) {
      try {
        const marker = _db.rawPrepare("SELECT value FROM app_settings WHERE key='logo_synced_url'").get()?.value
        if (marker !== biz.logo_url) {
          const buf = await new Promise((resolve, reject) => {
            const reqUrl = new URL(biz.logo_url)
            const doGet = (url) => https.get({ hostname: url.hostname, path: url.pathname + url.search }, (r) => {
              if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
                return doGet(new URL(r.headers.location, url))
              }
              if (r.statusCode < 200 || r.statusCode >= 300) return reject(new Error(`logo fetch ${r.statusCode}`))
              const chunks = []
              r.on('data', c => chunks.push(c))
              r.on('end', () => resolve(Buffer.concat(chunks)))
              r.on('error', reject)
            }).on('error', reject).setTimeout?.(SYNC_TIMEOUT_MS, function () { try { this.destroy() } catch {} })
            doGet(reqUrl)
          }).catch(e => { log.warn('[sync] logo fetch:', e.message); return null })
          if (buf && buf.length > 0 && buf.length < 5 * 1024 * 1024) {
            try {
              const dbMod = require('./database')
              if (dbMod && typeof dbMod.empresaSave === 'function') {
                dbMod.empresaSave({ logo: buf })
                _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value,updated_at) VALUES('logo_synced_url',?,datetime('now'))").run(biz.logo_url)
                log.info(`[sync-pull] logo downloaded (${buf.length} bytes) and saved to local BLOB`)
              }
            } catch (e) { log.warn('[sync] logo save:', e.message) }
          }
        }
      } catch (e) {
        log.warn('[sync] logo sync failed:', e.message)
      }
    }

    // LWW check against local businesses.updated_at — only apply if remote is newer.
    try {
      const local = _db.rawPrepare('SELECT updated_at FROM businesses WHERE id=1').get()
      if (local?.updated_at && biz.updated_at) {
        const localRaw = String(local.updated_at)
        const remoteRaw = String(biz.updated_at)
        const localIso  = localRaw.includes('T')  ? localRaw  : localRaw.replace(' ', 'T') + (localRaw.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(localRaw) ? '' : 'Z')
        const remoteIso = remoteRaw.includes('T') ? remoteRaw : remoteRaw.replace(' ', 'T') + (remoteRaw.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(remoteRaw) ? '' : 'Z')
        const lMs = Date.parse(localIso)
        const rMs = Date.parse(remoteIso)
        if (Number.isFinite(lMs) && Number.isFinite(rMs) && rMs <= lMs) return 0
      }
    } catch {}

    // Build the same flat+settings payload shape empresaSave expects.
    // Settings JSONB → stringify for SQLite TEXT column (empresaSave will accept either).
    const payload = {}
    if (biz.name)    payload.name    = biz.name
    if (biz.rnc)     payload.rnc     = biz.rnc
    if (biz.phone)   payload.phone   = biz.phone
    if (biz.address) payload.address = biz.address
    if (biz.email)   payload.email   = biz.email
    if (biz.plan)    payload.plan    = biz.plan
    if (biz.mora_rate_daily != null) payload.mora_rate_daily = Number(biz.mora_rate_daily)

    if (biz.settings) {
      let settingsObj = biz.settings
      if (typeof settingsObj === 'string') {
        try { settingsObj = JSON.parse(settingsObj) } catch { settingsObj = null }
      }
      if (settingsObj && typeof settingsObj === 'object' && !Array.isArray(settingsObj)) {
        // Merge with existing local settings so we don't drop keys that
        // haven't made the round-trip yet (e.g. device-local PEM cache).
        try {
          const localRow = _db.rawPrepare('SELECT settings FROM businesses WHERE id=1').get()
          let localObj = {}
          if (localRow?.settings) {
            try { localObj = typeof localRow.settings === 'string' ? JSON.parse(localRow.settings) : localRow.settings } catch {}
          }
          payload.settings = JSON.stringify({ ...localObj, ...settingsObj })
        } catch {
          payload.settings = JSON.stringify(settingsObj)
        }
      }
    }

    if (!Object.keys(payload).length) return 0

    // Delegate to the DB layer (which handles INSERT-if-missing, allowed-list filter, etc.)
    try {
      const dbMod = require('./database')
      if (dbMod && typeof dbMod.empresaSave === 'function') dbMod.empresaSave(payload)
    } catch (e) {
      log.warn('[sync] pullBusinessMeta empresaSave:', e.message)
    }
    log.info('[sync-pull] businesses: meta refreshed from Supabase')
    return 1
  } catch (e) {
    log.error('[sync] pullBusinessMeta failed:', e.message)
    return 0
  }
}

// -- Upload binary to Supabase Storage ----------------------------------------
function uploadToStorage(bucket, objectPath, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const reqUrl = new URL(`${_url}/storage/v1/object/${bucket}/${encodeURI(objectPath)}`)
    const req = https.request({
      hostname: reqUrl.hostname, path: reqUrl.pathname, method: 'POST',
      headers: _authHeaders({ 'Content-Type': contentType || 'application/octet-stream', 'x-upsert': 'true', 'Content-Length': buffer.length }),
    }, (r) => {
      let data = ''
      r.on('data', c => data += c.toString())
      r.on('end', () => {
        if (r.statusCode >= 200 && r.statusCode < 300) {
          // Return public URL (cache-bust with timestamp so client refreshes)
          resolve(`${_url}/storage/v1/object/public/${bucket}/${encodeURI(objectPath)}?v=${Date.now()}`)
        } else {
          reject(new Error(`Storage ${r.statusCode}: ${data}`))
        }
      })
    })
    req.on('error', reject)
    req.write(buffer)
    req.end()
  })
}

// -- Full sync cycle ----------------------------------------------------------
async function syncNow() {
  // v2.16.26 — DO NOT REVERT (FIX-LEDGER §Batch6). The push and pull phases
  // are serialized inside this function (push for-loop at line ~4334, then
  // pull for-loop at ~4346). The `_syncing` flag is the per-process mutex
  // that prevents concurrent invocations from interleaving push/pull rounds
  // and corrupting state. If a concurrent caller arrives while we're busy,
  // it sets `_pendingSync=true` and returns; the current run picks that up
  // in the finally section (line ~4422) and re-dispatches once. This pattern
  // covers the race the audit flagged on 2026-04-30. Multi-device coordination
  // is server-side via the sync_upsert_counter_row CAS RPC (Batch 5).
  if (_syncing) {
    _pendingSync = true
    return _status
  }
  if (!_url || !_key) {
    log.error('[sync] No URL or key — url:', !!_url, 'key:', !!_key)
    return _status
  }
  await _maybeRefreshJwt()
  let bizId
  try { bizId = await resolveBusinessId() } catch (e) { log.error('[sync] resolveBusinessId failed:', e.message); _reportSyncError(e, 'sync.syncNow.resolveBusinessId') }
  if (!bizId) {
    _status.state = 'no_business_id'
    log.error('[sync] No business_id found')
    return _status
  }
  log.info('[sync] Starting sync for business:', bizId)

  _syncing = true
  _pendingSync = false
  _status.state = 'syncing'
  _status.error = null
  let totalRows = 0

  try {
    // Phase 0 — push business meta (name, logo, etc.) before anything else
    try { await pushBusinessMeta(bizId) } catch (e) { log.error('[sync] pushBusinessMeta:', e.message); _reportSyncError(e, 'sync.push.businesses_meta') }

    // Phase 0.5 — flush tombstones (local hard-deletes → Supabase DELETE).
    // Without this, a desktop-side delete gets resurrected on the next pull.
    try { await flushTombstones(bizId) } catch (e) { log.error('[sync] flushTombstones:', e.message); _reportSyncError(e, 'sync.push.tombstones') }

    for (const table of SYNC_TABLES) {
      try {
        const count = await syncTable(table)
        totalRows += count
      } catch (e) {
        log.error(`[sync] ${table.name}:`, e.message)
        updateSyncLog(table.name, getLastSyncedId(table.name), 0, e.message)
        _status.tables[table.name] = { synced: false, error: e.message }
        _reportSyncError(e, `sync.push.${table.name}`)
      }
    }
    // ── Pull phase: Supabase → SQLite ────────────────────────────────────
    let totalPulled = 0
    for (const pt of PULL_TABLES) {
      try {
        const count = await pullTable(pt)
        totalPulled += count
      } catch (e) {
        log.error(`[sync-pull] ${pt.name}:`, e.message)
        _reportSyncError(e, `sync.pull.${pt.name}`)
      }
    }
    // F15 — also pull business meta so multi-device edits propagate
    try { await pullBusinessMeta(bizId) } catch (e) { log.error('[sync-pull] businesses:', e.message); _reportSyncError(e, 'sync.pull.businesses_meta') }
    if (totalPulled > 0) log.info(`[sync] Pull complete — ${totalPulled} rows pulled`)

    // Mirror cloud-side deletes to local. Without this, rows removed on the
    // server (e.g. a dedupe of StarSISA import duplicates) stay resident on
    // every desktop forever because LWW pull only touches rows with matching
    // supabase_ids. Only runs for tables in RECONCILE_TABLES and respects
    // the 10-min age guard so freshly-created local rows aren't wiped.
    try { await reconcileDeletes() } catch (e) { log.warn('[sync] reconcileDeletes failed:', e.message); _reportSyncError(e, 'sync.syncNow.reconcileDeletes') }

    // ── Anti-resurrection: advance last_synced_at to NOW (post-pull) ───
    // Without this, last_synced_at is set during the push phase (BEFORE
    // pull). Pulled rows get their Supabase updated_at written locally.
    // If that timestamp >= the push-time last_synced_at, Pass 2's
    // `WHERE updated_at > lastSyncedAt` matches them and re-pushes stale
    // desktop data over the newer Supabase state — the resurrection bug.
    // By advancing the cursor to post-pull time, pulled rows' timestamps
    // are guaranteed older than lastSyncedAt, so they won't re-push.
    for (const table of SYNC_TABLES) {
      try {
        // v2.0.2 — ISO 8601 UTC so cursor is lexicographically comparable to
        // updated_at (both formats must match or every pulled row "looks newer").
        _db.rawPrepare(`UPDATE sync_log SET last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE table_name = ?`).run(table.name)
      } catch (e) { log.error(`[sync] post-pull cursor advance ${table.name}:`, e.message) }
    }

    // v2.3 — multi-POS: drain pending inventory deducts (oversell detect)
    // and refill NCF/doc blocks whenever they dip below threshold. Both are
    // no-ops when multi_pos_enabled=0.
    try { await processPendingDeducts() } catch (e) { log.warn('[multipos] processPendingDeducts:', e.message); _reportSyncError(e, 'sync.multipos.processPendingDeducts') }
    try { await ensureBlocks()          } catch (e) { log.warn('[multipos] ensureBlocks:', e.message); _reportSyncError(e, 'sync.multipos.ensureBlocks') }

    // FIX-HIGH-8 — drain activity_log fallback queue (audit rows whose
    // canonical INSERT failed). Runs every cycle so transient SQLite
    // failures heal silently; rows that can't be saved after 5 attempts
    // are marked 'dead' and emit a critical `activity_log_dropped` row so
    // the owner sees the compliance gap in the audit feed.
    try {
      if (typeof _db.activityLogDrainFallback === 'function') {
        const r = _db.activityLogDrainFallback()
        if (r && (r.drained || r.dead)) {
          log.info(`[sync] activity_log fallback: drained=${r.drained} dead=${r.dead} remaining=${r.remaining}`)
        }
      }
    } catch (e) { log.warn('[sync] activityLogDrainFallback:', e.message); _reportSyncError(e, 'sync.activityLogDrainFallback') }

    _status.state = 'idle'
    _status.lastSync = new Date().toISOString()
    _status.totalRows = totalRows
    _status.totalPulled = totalPulled
    log.info(`[sync] Complete — ${totalRows} rows pushed, ${totalPulled} rows pulled`)
  } catch (e) {
    _status.state = 'error'
    _status.error = e.message
    log.error('[sync] Fatal:', e.message)
    // Fatal sync error = entire cycle failed (push + pull). High severity:
    // operator needs to know before the next 5-min tick masks it.
    _reportSyncError(e, 'sync.syncNow.fatal')
  } finally {
    _syncing = false
  }

  // Notify renderer
  try {
    const { BrowserWindow } = require('electron')
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send('sync:status-update', _status)
  } catch {}

  // Re-run if a sync was requested while we were busy
  if (_pendingSync) {
    _pendingSync = false
    return syncNow()
  }

  return _status
}

// -- Auto sync interval -------------------------------------------------------
// Phase C scaling fix (2026-04-29): replace setInterval with a self-rescheduling
// setTimeout that adds ±10% jitter per cycle. Without jitter, every desktop in
// the fleet wakes near the minute boundary (because intervalMs is a round
// number and machines sync clocks via NTP) and Supavisor's transaction pool
// queues spike. Jittering each tick by up to ±10% breaks the convoy and keeps
// aggregate RPS smooth even at 1000+ desktops.
function startAutoSync(intervalMs = 30 * 60 * 1000) {
  if (_intervalId) clearInterval(_intervalId)
  if (_jitterTimeoutId) { clearTimeout(_jitterTimeoutId); _jitterTimeoutId = null }
  // First sync after 5 seconds (let DB + window settle, then pull cloud
  // settings so Preferencias/Sistema/Admin screens see the current printer,
  // staff, etc. on first render instead of the 60s-old local snapshot).
  setTimeout(() => syncNow().catch(e => _reportSyncError(e, 'sync.startAutoSync.first_run')), 5 * 1000)
  function scheduleNext() {
    // ±10% jitter per cycle, computed fresh each time. min 60s floor.
    const jitter = (Math.random() * 0.2 - 0.1) * intervalMs
    const next = Math.max(60_000, intervalMs + jitter)
    _jitterTimeoutId = setTimeout(() => {
      // syncNow() has its own try/catch that reports fatals. The outer .catch
      // here is only for synchronous throws that escape the function entry.
      syncNow().catch(e => _reportSyncError(e, 'sync.startAutoSync.tick'))
      scheduleNext()
    }, next)
  }
  scheduleNext()
  log.info(`[sync] Auto-sync every ~${Math.round(intervalMs / 60000)} min (±10% jitter)`)
  // Kick off realtime listener so web writes land on desktop within seconds
  // instead of waiting up to intervalMs. Fires in the background; failures
  // degrade gracefully to the polling interval.
  startRealtime().catch(e => log.warn('[sync] realtime start failed:', e.message))
  // v2.3 — block refill scheduler. No-op if multi_pos_enabled=0.
  try { startMultiPosRefill() } catch (e) { log.warn('[multipos] startMultiPosRefill:', e.message) }
}

function stopAutoSync() {
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null }
  if (_jitterTimeoutId) { clearTimeout(_jitterTimeoutId); _jitterTimeoutId = null }
  stopRealtime()
}

// -- Realtime (Supabase WebSocket) --------------------------------------------
// Listens for INSERT/UPDATE/DELETE on this business's rows across every synced
// table and kicks a debounced pullNow() so local SQLite catches up immediately.
async function startRealtime() {
  if (!_url || !_key || _realtimeChannel) return
  const bizId = await resolveBusinessId().catch(() => null)
  if (!bizId) { log.warn('[sync] realtime skipped — no business_id'); return }

  let createClient
  try { ({ createClient } = require('@supabase/supabase-js')) }
  catch (e) { log.warn('[sync] realtime unavailable — @supabase/supabase-js not installed'); return }

  _realtimeClient = createClient(_url, _key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 5 } },
  })

  const onChange = (payload) => {
    const tbl = payload?.table || '?'
    if (_realtimeDebounce) clearTimeout(_realtimeDebounce)
    _realtimeDebounce = setTimeout(() => {
      log.info(`[sync] realtime → pullNow() (triggered by ${tbl})`)
      pullNow().catch(e => log.error('[sync] realtime pull failed:', e.message))
    }, 1500)
  }

  // Subscribe to the base tables only — Supabase realtime does not broadcast
  // from views, so we listen on `staff` (the real table underneath the
  // `users` view) and rely on the pull's view-backed SELECT to upsert locally.
  const tables = [
    // v2.1: washers + sellers tables dropped — empleados covers both verticals.
    'services','clients','inventory_items','ncf_sequences',
    'empleados','categorias_servicio','staff','tickets','ticket_items','queue',
    'washer_commissions','seller_commissions','cajero_commissions',
    'credit_payments','cuadre_caja','caja_chica','notas_credito',
    'inventory_transactions','compras_607','adelantos','payroll_runs','salary_changes',
    'activity_log',
    'vehicles','service_bays','work_orders','work_order_items','appointments',
    'stylist_schedules','loans','loan_payments','pawn_items',
    'memberships','wash_combos',
    // v2.16.1 — salon hardening
    'client_memberships','membership_redemptions','appointment_reminders',
    'subscriptions','service_packages','projects','client_service_rates','client_item_prices',
    'inventory_counts','inventory_count_items',
    // v2.16.0 — mecánica
    'aseguradoras','suppliers','parts_orders','work_order_photos','insurance_batches',
    // v2.16.7 — close realtime gap with SYNC_TABLES so cross-device propagation
    // doesn't wait the full 30-min poll for these entities.
    'mesas','modificadores','service_modificadores','service_recipe_items',
    'ofertas','oferta_items',
    'ticket_item_modificadores','kds_events','restaurant_reservations',
    'mechanic_commissions','inventory_oversells',
    'ecf_submissions','ecf_queue','queue_deletions',
    'loyalty_transactions','loan_schedule','collections_log',
    'carniceria_corte_categories','inventory_freshness_log','inventory_discards',
    'recurring_orders','carniceria_scales','promotions','promotion_items',
    // Concesionario
    'vehicle_inventory','sales_deals','leads','test_drives',
    'vehicle_documents','vehicle_titulo','vehicle_reservations',
    'bank_preapprovals','vehicle_warranties',
    // Phase 1B — Contabilidad firm-side suite
    'accounting_clients','accounting_inbox','accounting_obligations_calendar',
    'accounting_documents','accounting_billing_plans','accounting_billing_invoices',
    'accounting_csv_mappings',
    // Phase 2 Slice 1 — Contabilidad full firm-side
    'accounting_chart_of_accounts','accounting_journal_entries','accounting_journal_lines',
    'accounting_coa_auto_post_rules','accounting_bank_accounts','accounting_bank_statement_lines',
    'accounting_fixed_assets','accounting_retentions_emitidas','accounting_retentions_recibidas',
    'accounting_payroll_periods','accounting_payroll_lines','accounting_tss_filings',
    'accounting_tasks','accounting_foreign_payments',
  ]

  _realtimeChannel = _realtimeClient.channel(`tx-sync-${bizId}`)
  for (const t of tables) {
    _realtimeChannel.on('postgres_changes', {
      event: '*', schema: 'public', table: t, filter: `business_id=eq.${bizId}`,
    }, onChange)
  }

  _realtimeChannel.subscribe(status => {
    log.info('[sync] realtime status:', status)
  })
}

function stopRealtime() {
  if (_realtimeDebounce) { clearTimeout(_realtimeDebounce); _realtimeDebounce = null }
  if (_realtimeChannel && _realtimeClient) {
    try { _realtimeClient.removeChannel(_realtimeChannel) } catch {}
  }
  _realtimeChannel = null
  _realtimeClient = null
}

function getStatus() {
  return { ..._status }
}

// Hard-delete a single row in Supabase by supabase_id. Used by mutation IPCs
// where the owner explicitly erases a record (salary_changes, adelantos, etc.)
// and we do NOT want the next upsert to resurrect the row.
async function supabaseDelete(table, supabaseId, businessId) {
  if (!_url || !_key || !table || !supabaseId) return { ok: false, error: 'missing args' }
  const bizId = businessId || await resolveBusinessId().catch(() => null)
  if (!bizId) return { ok: false, error: 'no business_id' }
  const reqUrl = new URL(`${_url}/rest/v1/${table}?business_id=eq.${bizId}&supabase_id=eq.${supabaseId}`)
  return new Promise((resolve) => {
    const request = https.request({
      hostname: reqUrl.hostname,
      path: reqUrl.pathname + reqUrl.search,
      method: 'DELETE',
      headers: _authHeaders({
        'Prefer': 'return=minimal',
      }),
    }, (response) => {
      response.on('data', () => {})
      response.on('end', () => {
        const ok = response.statusCode >= 200 && response.statusCode < 300
        if (!ok) log.warn(`[sync] supabaseDelete ${table} ${supabaseId}: HTTP ${response.statusCode}`)
        resolve({ ok, status: response.statusCode })
      })
    })
    request.on('error', (err) => { log.warn(`[sync] supabaseDelete ${table}: ${err.message}`); resolve({ ok: false, error: err.message }) })
    request.end()
  })
}

// Pull-time reconciliation for owner-deletable tables: fetch every supabase_id
// from Supabase and hard-delete any local rows whose supabase_id is not in the
// remote set. Ensures a delete performed in web or another desktop propagates
// to this desktop on next pull.
// v2.14.22 — Added tickets, clients, queue, queue_deletions. Prior audit
// (2026-04-24) found the comment below was stale: `clients` was referenced
// as included but never actually listed, and the entire "append-only" dodge
// on tickets was wrong — owner-initiated ticket deletes (wipes, admin purges)
// were being re-pushed by desktop on every sync tick. ticket_items rides
// on ON DELETE CASCADE from tickets(id), so deleting the ticket locally
// takes ticket_items with it — no need to reconcile ticket_items directly.
// queue also cascades from tickets but we reconcile it for web-only purges.
const RECONCILE_TABLES = [
  'salary_changes', 'adelantos', 'caja_chica', 'notas_credito',
  'services', 'empleados', 'categorias_servicio', 'client_item_prices',
  'client_service_rates', 'service_modificadores', 'service_recipe_items', 'ofertas', 'oferta_items', 'payroll_runs',
  'inventory_counts', 'inventory_count_items',
  'compras_607', 'ecf_queue', 'work_order_items',
  // v2.14.22 — the bucket that was silently out. When Supabase loses a
  // ticket/client/queue row (owner wipe, void hard-delete, web-side purge),
  // the next pull's reconcile is what takes the local row out. Without this
  // the desktop's stale row gets re-pushed on the following tick and the
  // "wiped" rows reappear in 606/607 + Remote Dashboard + Clients.
  'tickets', 'clients', 'queue', 'queue_deletions',
  // v2.16.1 — salon hardening: reconcile so cloud-side deletes propagate
  'memberships', 'client_memberships', 'membership_redemptions', 'appointment_reminders',
  // Commission tables: reconcile so a cloud-side dedupe (e.g. wiping
  // duplicate StarSISA import aggregates) propagates to desktop. The
  // 10-min age guard in reconcileDeletes protects commissions created
  // mid-cycle that haven't pushed yet.
  'washer_commissions', 'seller_commissions', 'cajero_commissions',
  // v2.16.0 — Taller Mecánico hardening: durable entities + supplies workflow
  'aseguradoras', 'suppliers', 'parts_orders', 'insurance_batches',
  // v2.16.x FIX-H5 — frozen mechanic comisión rows
  'mechanic_commissions',
  // v2.16.1 — Préstamos hardening: contracts, renewals, collections, pawn docs/listings
  'collections_attempts', 'loan_contracts', 'loan_renewals', 'pawn_documents', 'pawn_listings',
  // v2.16.x — Servicios vertical
  'service_projects',
]

// Flush locally-recorded deletes to Supabase. Called at the top of each sync
// cycle so a delete reaches the cloud before anything else tries to re-sync
// the deleted row. Rows are removed from the tombstone table on success; on
// error we bump an attempts counter and try again next cycle.
async function flushTombstones(businessId) {
  if (!_db || !_url || !_key) return
  if (typeof _db.tombstonesPending !== 'function') return
  const rows = _db.tombstonesPending(200) || []
  if (!rows.length) return
  let ok = 0, failed = 0
  for (const r of rows) {
    try {
      const resp = await supabaseDelete(r.table_name, r.supabase_id, r.business_id || businessId)
      if (resp?.ok || resp?.status === 404) {
        _db.tombstoneMarkSent(r.id)
        ok++
      } else {
        _db.tombstoneMarkFailed(r.id, `HTTP ${resp?.status || '?'}`)
        failed++
      }
    } catch (e) {
      _db.tombstoneMarkFailed(r.id, e.message)
      failed++
    }
  }
  if (ok || failed) log.info(`[sync] flushTombstones: ${ok} sent, ${failed} failed`)
}

async function reconcileDeletes() {
  if (!_db || !_url || !_key) return
  const bizId = await resolveBusinessId().catch(() => null)
  if (!bizId) return
  // v2.16.10 — RLS data-loss guard. The 2026-04-26 RLS migration made anon
  // GETs return [] silently for every public table. Reconcile interpreted
  // empty cloud as "all local rows must be deleted" and wiped empleados,
  // services, etc. across the install base. v2.16.9 minted a license-scoped
  // JWT into _userJwt; if for any reason that JWT isn't present (validate
  // hasn't run yet, expired, network failure) sync would fall back to anon
  // → reconcile would wipe again. Skip reconcile entirely without a JWT.
  if (!_userJwt) {
    log.warn('[sync] reconcileDeletes skipped — no _userJwt (anon GETs would return [] under RLS, would wipe local)')
    return
  }
  // Safety: only delete rows created >10 min ago so we don't wipe
  // freshly-created local rows whose push hasn't landed yet. Sync runs every
  // 5 min; anything older than 10 min has had at least one push attempt.
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  for (const table of RECONCILE_TABLES) {
    try {
      // Skip if table doesn't exist locally (older DBs)
      const has = _db.rawPrepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
      if (!has) continue
      // v2.14.22 — supabaseFetch expects an object. Previously a template
      // string was passed; Object.entries on a string yields [index, char]
      // pairs, producing ?0=s&1=e&... → PGRST100 on every reconcile call
      // → cloud-side deletes never propagated. Verified against main.log:
      // every RECONCILE_TABLES entry failed "unexpected s expecting
      // operator". That's why wiped tickets/clients kept reappearing.
      const remote = await supabaseFetch(table, {
        select: 'supabase_id',
        business_id: `eq.${bizId}`,
        limit: '20000',
      })
      if (!Array.isArray(remote)) continue
      const remoteSet = new Set(remote.map(r => r.supabase_id).filter(Boolean))

      // 2026-04-30 — DATA-LOSS HARD GUARD. The 04-26 RLS migration plus the
      // license-scoped _userJwt path made some master tables return [] from
      // SELECT under RLS while INSERT still succeeded via a permissive
      // _ins_auth policy. Reconcile then deleted every local row "to match"
      // the empty cloud and Mike re-imported all week to no avail. Even a
      // single empty SELECT can drop hundreds of rows of master data.
      //
      // Refuse to reconcile-delete if cloud claims 0 but local has anything
      // older than the cutoff. Same shape as "table never had data" — let
      // bootstrap pull populate it instead. This only blocks DELETE; PUSH /
      // PULL UPSERT continue normally.
      if (remoteSet.size === 0) {
        const localCnt = _db.rawPrepare(`SELECT count(*) AS n FROM ${table}`).get()?.n || 0
        if (localCnt > 0) {
          log.warn(`[sync] reconcile ${table}: cloud SELECT returned 0 but local has ${localCnt} row(s) — REFUSING to delete (likely RLS/JWT scope issue, not real cloud emptiness)`)
          continue
        }
      }
      // Some pre-v2.1 tables (commission tables) don't have a `business_id`
      // column locally — legacy schema was single-tenant. Build the WHERE
      // clause from whichever columns actually exist so the query succeeds.
      const hasBizCol  = _tableHasColumn(table, 'business_id')
      const hasCreated = _tableHasColumn(table, 'created_at')
      const whereParts = ['supabase_id IS NOT NULL']
      const whereVals  = []
      if (hasBizCol)  { whereParts.push('business_id = ?'); whereVals.push(bizId) }
      if (hasCreated) {
        // v2.13.10: age guard protects rows created in the last 10 min from
        // being wiped before their push lands. BUT legacy imports can stamp
        // created_at with future dates (StarSISA end-of-month aggregates
        // dated 2026-04-30 while today is 2026-04-21). Those would otherwise
        // be excluded as "too new" and reconcile would skip them forever.
        // Accept a row as reconcilable if it's NULL, > 10 min old, OR > 1 day
        // in the future (any future stamp that's clearly an import artifact).
        const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        whereParts.push('(created_at IS NULL OR created_at < ? OR created_at > ?)')
        whereVals.push(cutoff)
        whereVals.push(future)
      }
      const localRows = _db.rawPrepare(`SELECT id, supabase_id FROM ${table} WHERE ${whereParts.join(' AND ')}`).all(...whereVals)
      const toDelete = localRows.filter(r => !remoteSet.has(r.supabase_id))
      if (toDelete.length === 0) continue
      const stmt = _db.rawPrepare(`DELETE FROM ${table} WHERE id = ?`)
      for (const r of toDelete) { try { stmt.run(r.id) } catch (e) { log.warn(`[sync] reconcile delete ${table} id=${r.id}: ${e.message}`) } }
      log.info(`[sync] reconcile ${table}: deleted ${toDelete.length} local row(s) not present in Supabase`)
    } catch (e) {
      log.warn(`[sync] reconcile ${table} failed: ${e.message}`)
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Multi-POS — Block refill + oversell-aware deduct (v2.3)
// See docs/MULTI-POS-ARCHITECTURE.md §1–§3 and migration
// 20260418000000_multipos_blocks.sql. All of this is gated by
// app_settings.multi_pos_enabled; when OFF the functions return silently so
// single-POS installs carry no network overhead.
// ═══════════════════════════════════════════════════════════════════════════════

const MULTIPOS = {
  NCF_REFILL_THRESHOLD:  100,
  NCF_BLOCK_SIZE:        500,
  DOC_REFILL_THRESHOLD:  50,
  DOC_BLOCK_SIZE:        200,
  REFILL_INTERVAL_MS:    10 * 60 * 1000,
  // Every NCF/e-CF type we may need a block for. Only allocated on demand if
  // the type is "enabled" (i.e. has a row in ncf_sequences with enabled=1)
  // or is a directly-requested e-CF type.
  KNOWN_NCF_TYPES: ['B01','B02','B14','B15','E31','E32','E33','E34','E41','E43','E44','E47'],
}

let _multiposInterval = null

function _mpEnabled() {
  try { return (_db.rawPrepare("SELECT value FROM app_settings WHERE key='multi_pos_enabled'").get()?.value || '0') === '1' }
  catch { return false }
}

function _mpHwid() {
  try {
    const row = _db.rawPrepare("SELECT value FROM app_settings WHERE key='hwid'").get()
    if (row?.value) return row.value
  } catch {}
  try {
    const { app } = require('electron')
    const fs = require('fs')
    const path = require('path')
    const hwidPath = path.join(app.getPath('userData'), 'hwid.json')
    const j = JSON.parse(fs.readFileSync(hwidPath, 'utf8'))
    const hwid = j.id || j.hwid
    if (hwid) {
      try { _db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('hwid',?)").run(hwid) } catch {}
      return hwid
    }
  } catch {}
  return null
}

function _enabledNcfTypes() {
  try {
    const rows = _db.rawPrepare("SELECT type FROM ncf_sequences WHERE active=1 AND (enabled=1 OR enabled IS NULL)").all()
    const set = new Set(rows.map(r => r.type).filter(Boolean))
    // Always include the common e-CF types so clients never hit "no block"
    // mid-sale for a type the cashier just opted into in the POS dropdown.
    for (const t of ['E31','E32','B01','B02']) set.add(t)
    return [...set]
  } catch { return ['B01','B02','E31','E32'] }
}

// POST to Supabase RPC and parse JSON. Returns null on failure (caller retries
// on next tick — never throws into the ticket path).
function _rpcPost(fnName, payload) {
  return new Promise((resolve) => {
    if (!_url || !_key) return resolve(null)
    const body = JSON.stringify(payload)
    const reqUrl = new URL(`${_url}/rest/v1/rpc/${fnName}`)
    const req = https.request({
      hostname: reqUrl.hostname,
      path: reqUrl.pathname + reqUrl.search,
      method: 'POST',
      headers: _authHeaders({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      }),
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk.toString() })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data || 'null')) } catch { resolve(null) }
        } else {
          log.warn(`[multipos] rpc ${fnName} HTTP ${res.statusCode}: ${String(data).slice(0,200)}`)
          resolve(null)
        }
      })
    })
    req.on('error', (e) => { log.warn(`[multipos] rpc ${fnName} err: ${e.message}`); resolve(null) })
    req.setTimeout(20_000, () => { req.destroy(new Error('rpc timeout')); resolve(null) })
    req.write(body)
    req.end()
  })
}

async function _allocateNcfBlock(bizId, hwid, ncfType, size) {
  const row = await _rpcPost('allocate_ncf_block', {
    p_business_id: bizId,
    p_hwid:        hwid,
    p_ncf_type:    ncfType,
    p_size:        size,
  })
  if (!row) return null
  // RPC may return a single row object or an array — normalise.
  const r = Array.isArray(row) ? row[0] : row
  if (!r) return null
  try {
    const db = require('./database')
    db.ncfBlockInsert({
      supabase_id:    r.supabase_id || r.id,
      business_id:    r.business_id || bizId,
      hwid:           r.hwid || hwid,
      ncf_type:       r.ncf_type || ncfType,
      prefix:         r.prefix || ncfType,
      range_start:    Number(r.range_start),
      range_end:      Number(r.range_end),
      next_available: Number(r.next_available),
      size:           Number(r.size || (r.range_end - r.range_start + 1)),
      allocated_at:   r.allocated_at,
      exhausted_at:   r.exhausted_at,
      last_used_at:   r.last_used_at,
    })
    return r
  } catch (e) { log.warn('[multipos] ncfBlockInsert failed:', e.message); return null }
}

async function _allocateDocBlock(bizId, hwid, size) {
  const row = await _rpcPost('allocate_doc_number_block', {
    p_business_id: bizId,
    p_hwid:        hwid,
    p_scope:       'ticket',
    p_size:        size,
  })
  if (!row) return null
  const r = Array.isArray(row) ? row[0] : row
  if (!r) return null
  try {
    const db = require('./database')
    db.docNumberBlockInsert({
      supabase_id:    r.supabase_id || r.id,
      business_id:    r.business_id || bizId,
      hwid:           r.hwid || hwid,
      scope:          r.scope || 'ticket',
      range_start:    Number(r.range_start),
      range_end:      Number(r.range_end),
      next_available: Number(r.next_available),
      size:           Number(r.size || (r.range_end - r.range_start + 1)),
      allocated_at:   r.allocated_at,
      exhausted_at:   r.exhausted_at,
    })
    return r
  } catch (e) { log.warn('[multipos] docNumberBlockInsert failed:', e.message); return null }
}

async function ensureBlocks() {
  if (!_mpEnabled()) return { ok: true, skipped: true }
  if (!_url || !_key) return { ok: false, reason: 'no_supabase' }
  const bizId = await resolveBusinessId()
  if (!bizId) return { ok: false, reason: 'no_business_id' }
  const hwid  = _mpHwid()
  if (!hwid)  return { ok: false, reason: 'no_hwid' }

  const db = require('./database')
  const ncfSize = Number(_db.rawPrepare("SELECT value FROM app_settings WHERE key='ncf_block_size'").get()?.value) || MULTIPOS.NCF_BLOCK_SIZE
  const docSize = Number(_db.rawPrepare("SELECT value FROM app_settings WHERE key='doc_block_size'").get()?.value) || MULTIPOS.DOC_BLOCK_SIZE

  let allocated = 0
  for (const t of _enabledNcfTypes()) {
    const remaining = db.ncfBlockAvailableCount({ businessId: bizId, hwid, ncfType: t })
    if (remaining < MULTIPOS.NCF_REFILL_THRESHOLD) {
      const r = await _allocateNcfBlock(bizId, hwid, t, ncfSize)
      if (r) allocated++
    }
  }
  const docRemaining = db.docNumberBlockAvailableCount({ businessId: bizId, hwid, scope: 'ticket' })
  if (docRemaining < MULTIPOS.DOC_REFILL_THRESHOLD) {
    const r = await _allocateDocBlock(bizId, hwid, docSize)
    if (r) allocated++
  }
  return { ok: true, allocated }
}

async function processPendingDeducts() {
  if (!_mpEnabled()) return { ok: true, skipped: true }
  if (!_url || !_key) return { ok: false, reason: 'no_supabase' }
  const bizId = await resolveBusinessId()
  if (!bizId) return { ok: false, reason: 'no_business_id' }
  const db = require('./database')
  const hwid = _mpHwid()

  const queue = db.pendingDeductList()
  if (!queue.length) return { ok: true, processed: 0 }

  let processed = 0
  for (const row of queue) {
    let items = []
    try { items = JSON.parse(row.items_json || '[]') } catch {}
    if (!items.length) { db.pendingDeductMarkPushed(row.id); continue }
    const result = await _rpcPost('deduct_inventory_atomic', {
      p_business_id: bizId,
      p_ticket_sid:  row.ticket_supabase_id,
      p_hwid:        hwid,
      p_items:       items,
    })
    if (result === null) {
      db.pendingDeductMarkFailed(row.id, 'rpc_null')
      // Don't break — try the rest, Supabase may have rejected one payload.
      continue
    }
    const rows = Array.isArray(result) ? result : (result?.rows || [])
    for (const r of rows) {
      if (r && r.oversold === true) {
        const item = items.find(i => i.item_supabase_id === r.item_supabase_id)
        db.oversellRecord({
          businessId:        bizId,
          ticketSupabaseId:  row.ticket_supabase_id,
          itemSupabaseId:    r.item_supabase_id,
          itemName:          item?.name || null,
          requested:         Number(r.requested || item?.qty || 0),
          actual:            Number(r.actual || 0),
        })
      }
    }
    db.pendingDeductMarkPushed(row.id)
    processed++
  }
  return { ok: true, processed }
}

async function resolveOversellRemote({ supabase_id, resolution_type, notes, resolved_by }) {
  if (!_url || !_key) return { ok: false, reason: 'no_supabase' }
  const result = await _rpcPost('resolve_oversell', {
    p_supabase_id:      supabase_id,
    p_resolution_type:  resolution_type || null,
    p_notes:            notes || null,
    p_resolved_by:      resolved_by || null,
  })
  // Regardless of remote outcome, stamp locally so the UI badge clears
  // immediately — next pull will merge FWW.
  try { require('./database').oversellResolveLocal({ supabase_id, resolution_type, notes, resolved_by }) } catch {}
  return { ok: result !== null, remote: result }
}

function startMultiPosRefill() {
  if (_multiposInterval) clearInterval(_multiposInterval)
  // Fire once ~30s after boot so ensureBlocks() runs after the first syncNow
  // has had a chance to resolve business_id, then every 10 min.
  setTimeout(() => {
    ensureBlocks().catch(e => log.warn('[multipos] ensureBlocks:', e.message))
    processPendingDeducts().catch(e => log.warn('[multipos] processPendingDeducts:', e.message))
  }, 30_000)
  _multiposInterval = setInterval(() => {
    ensureBlocks().catch(e => log.warn('[multipos] ensureBlocks:', e.message))
    processPendingDeducts().catch(e => log.warn('[multipos] processPendingDeducts:', e.message))
  }, MULTIPOS.REFILL_INTERVAL_MS)
}

function stopMultiPosRefill() {
  if (_multiposInterval) { clearInterval(_multiposInterval); _multiposInterval = null }
}

function blocksStatus() {
  const db = require('./database')
  const bizId = _businessId
  const hwid  = _mpHwid()
  const out = {
    enabled: _mpEnabled(),
    businessId: bizId,
    hwid,
    ncf: {},
    doc_number: 0,
  }
  if (!bizId || !hwid) return out
  for (const t of _enabledNcfTypes()) {
    out.ncf[t] = db.ncfBlockAvailableCount({ businessId: bizId, hwid, ncfType: t })
  }
  out.doc_number = db.docNumberBlockAvailableCount({ businessId: bizId, hwid, scope: 'ticket' })
  return out
}

module.exports = {
  init, startAutoSync, stopAutoSync, syncNow, pullNow, getStatus,
  supabaseDelete, reconcileDeletes, setErrorLogSink,
  // Per-license JWT (wired from main.js after license validation).
  setUserJwt, setJwtRefreshHook,
  // Multi-POS
  ensureBlocks, processPendingDeducts, resolveOversellRemote,
  startMultiPosRefill, stopMultiPosRefill, blocksStatus,
}
