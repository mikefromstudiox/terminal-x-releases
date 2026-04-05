/**
 * sync.js — Live data sync between desktop (SQLite) and Supabase.
 *
 * Architecture:
 *   - SQLite is source of truth on desktop
 *   - After every CRUD operation, the affected row is pushed to Supabase
 *   - Full sync runs on app start and periodically (15 min)
 *   - All operations are fire-and-forget: never block the POS flow
 *
 * Tables synced: services, clients, washers, sellers, staff (users),
 *                tickets + ticket_items, ncf_sequences, inventory_items
 *
 * NOT synced (desktop-only): queue (ephemeral), cuadre_caja (periodic via backup),
 *                            rnc_contribuyentes (900K rows — web uses rnc_cache)
 */

import { getSupabaseClient, getBusinessId } from './supabase'
import { isElectron } from '@terminal-x/data/electron'

// ── Helpers ────────────────────────────────────────────────────────────────────

function sb() { return getSupabaseClient() }
function bid() { return getBusinessId() }

let _hasAuth = null

async function checkAuth() {
  try {
    const client = sb()
    if (!client) return false
    const { data } = await client.auth.getSession()
    return !!data?.session?.access_token
  } catch { return false }
}

function canSync() {
  // Only sync from desktop → Supabase. Web version writes directly.
  if (!isElectron()) return false
  if (!sb() || !bid() || !navigator.onLine) return false
  return _hasAuth === true
}

/** Upsert a row, mapping SQLite integer IDs to a local_id column for lookups. */
async function upsertRow(table, localId, data) {
  if (!canSync()) return
  try {
    const row = { ...data, business_id: bid(), local_id: localId }
    // Try to find existing row by local_id
    const { data: existing } = await sb()
      .from(table)
      .select('id')
      .eq('business_id', bid())
      .eq('local_id', localId)
      .maybeSingle()

    if (existing) {
      await sb().from(table).update(row).eq('id', existing.id)
    } else {
      await sb().from(table).insert(row)
    }
  } catch {
    // fire-and-forget
  }
}

/** Delete by local_id */
async function deleteRow(table, localId) {
  if (!canSync()) return
  try {
    await sb().from(table).delete()
      .eq('business_id', bid())
      .eq('local_id', localId)
  } catch {}
}

// ── Per-entity sync functions ─────────────────────────────────────────────────
// Called from screens/components after successful IPC CRUD operations.

export function syncService(svc) {
  if (!svc?.id) return
  upsertRow('services', svc.id, {
    name:         svc.name || '',
    name_en:      svc.name_en || null,
    category:     svc.category || 'Lavado',
    price:        svc.price || 0,
    aplica_itbis: svc.aplica_itbis ?? true,
    is_wash:      svc.is_wash ?? true,
    active:       svc.active ?? true,
    sort_order:   svc.sort_order ?? 0,
  })
}

export function syncClient(client) {
  if (!client?.id) return
  upsertRow('clients', client.id, {
    name:         client.name || '',
    rnc:          client.rnc || null,
    phone:        client.phone || null,
    email:        client.email || null,
    address:      client.address || null,
    credit_limit: client.credit_limit || 0,
    balance:      client.balance || 0,
    visits:       client.visits || 0,
    total_spent:  client.total_spent || 0,
    notes:        client.notes || null,
    active:       client.active ?? true,
  })
}

export function syncWasher(w) {
  if (!w?.id) return
  upsertRow('washers', w.id, {
    name:           w.name || '',
    phone:          w.phone || null,
    cedula:         w.cedula || null,
    commission_pct: w.commission_pct ?? 20,
    start_date:     w.start_date || null,
    active:         w.active ?? true,
  })
}

export function syncSeller(s) {
  if (!s?.id) return
  upsertRow('sellers', s.id, {
    name:           s.name || '',
    phone:          s.phone || null,
    commission_pct: s.commission_pct ?? 5,
    active:         s.active ?? true,
  })
}

export function syncUser(u) {
  if (!u?.id) return
  upsertRow('staff', u.id, {
    name:         u.name || '',
    username:     u.username || '',
    role:         u.role || 'cashier',
    discount_pct: u.discount_pct || 0,
    active:       u.active ?? true,
    pin_hash:     u.pin_hash || null,
  })
}

export function syncNCFSequence(seq) {
  if (!seq?.id) return
  upsertRow('ncf_sequences', seq.id, {
    type:           seq.type || '',
    prefix:         seq.prefix || '',
    current_number: seq.current_number || 0,
    limit_number:   seq.limit_number || 500,
    valid_until:    seq.valid_until || null,
    active:         seq.active ?? true,
    enabled:        seq.enabled ?? false,
  })
}

export function syncInventoryItem(item) {
  if (!item?.id) return
  upsertRow('inventory_items', item.id, {
    sku:          item.sku || null,
    name:         item.name || '',
    category:     item.category || '',
    quantity:     item.quantity || 0,
    min_quantity: item.min_quantity || 5,
    price:        item.price || 0,
    cost:         item.cost || 0,
    active:       item.active ?? true,
  })
}

/**
 * Sync a complete ticket with items.
 * Called after tickets.markPaid() in POS.
 */
export async function syncTicketFull(ticketData, result) {
  if (!canSync() || !result) return
  try {
    const bizId = bid()

    // Upsert ticket
    const ticketRow = {
      business_id:     bizId,
      local_id:        result.id || null,
      doc_number:      result.docNumber || result.doc_number || '',
      subtotal:        ticketData.subtotal || 0,
      descuento:       ticketData.descuento || 0,
      itbis:           ticketData.itbis || 0,
      ley:             ticketData.ley || 0,
      total:           ticketData.total || 0,
      payment_method:  ticketData.payment_method || ticketData.formaPago || 'cash',
      comprobante_type:ticketData.comprobante_type || ticketData.ncfType || 'B02',
      ncf:             result.ncf || ticketData.ncf || null,
      ecf_result:      ticketData.ecf || result.ecf_result || {},
      tipo_venta:      ticketData.tipo_venta || ticketData.tipo || 'contado',
      status:          'cobrado',
      vehicle_plate:   ticketData.vehicle_plate || ticketData.vehiclePlate || null,
      notes:           ticketData.notes || ticketData.comment || null,
    }

    // Find client UUID if client was synced
    if (ticketData.client_id || ticketData.clientId) {
      const localClientId = ticketData.client_id || ticketData.clientId
      const { data: cl } = await sb().from('clients')
        .select('id')
        .eq('business_id', bizId)
        .eq('local_id', localClientId)
        .maybeSingle()
      if (cl) ticketRow.client_id = cl.id
    }

    const { data: inserted } = await sb().from('tickets')
      .upsert(ticketRow, { onConflict: 'business_id,doc_number' })
      .select('id')
      .single()

    if (!inserted) return

    // Sync ticket items
    const items = ticketData.items || ticketData.services || []
    if (items.length) {
      // Delete existing items for this ticket (upsert pattern)
      await sb().from('ticket_items').delete().eq('ticket_id', inserted.id)

      const itemRows = items.map(item => ({
        business_id: bizId,
        ticket_id:   inserted.id,
        name:        item.name || '',
        price:       item.price || 0,
        itbis:       item.itbis || 0,
        is_wash:     item.is_wash ?? true,
      }))
      await sb().from('ticket_items').insert(itemRows)
    }
  } catch {
    // fire-and-forget
  }
}

// ── Full sync (all tables) ──────────────────────────────────────────────────

/**
 * Pulls all data from SQLite and pushes to Supabase.
 * Runs on app start and every 15 minutes.
 * Non-blocking, never throws.
 */
export async function fullSync(api) {
  if (!canSync() || !api) return

  try {
    // Sync business info
    const empresa = await api.admin?.getEmpresa?.()
    if (empresa) {
      const bizId = bid()
      await sb().from('businesses').update({
        name:    empresa.name || '',
        rnc:     empresa.rnc || '',
        address: empresa.address || '',
        phone:   empresa.phone || '',
        email:   empresa.email || '',
      }).eq('id', bizId)
    }

    // Sync services
    const services = await api.services?.allAdmin?.() || await api.services?.all?.() || []
    for (const svc of services) syncService(svc)

    // Sync clients
    const clients = await api.clients?.all?.() || []
    for (const c of clients) syncClient(c)

    // Sync washers
    const washers = await api.washers?.allAdmin?.() || await api.washers?.all?.() || []
    for (const w of washers) syncWasher(w)

    // Sync sellers
    const sellers = await api.sellers?.allAdmin?.() || await api.sellers?.all?.() || []
    for (const s of sellers) syncSeller(s)

    // Sync users/staff
    const users = await api.users?.all?.() || []
    for (const u of users) syncUser(u)

    // Sync NCF sequences
    const seqs = await api.ncf?.sequences?.() || []
    for (const seq of seqs) syncNCFSequence(seq)

    // Sync inventory
    const items = await api.inventory?.all?.() || []
    for (const item of items) syncInventoryItem(item)

    localStorage.setItem('tx_last_sync', new Date().toISOString())
  } catch {
    // never block
  }
}

// ── Sync scheduler ──────────────────────────────────────────────────────────

let _syncInterval = null
const SYNC_INTERVAL = 15 * 60 * 1000  // 15 minutes

export async function startSyncScheduler(api) {
  if (_syncInterval) return
  // Check if we have a valid Supabase auth session before syncing
  _hasAuth = await checkAuth()
  if (!_hasAuth) return  // No auth session — skip sync silently
  // Run immediately on start
  fullSync(api)
  // Then every 15 minutes
  _syncInterval = setInterval(() => fullSync(api), SYNC_INTERVAL)
}

export function stopSyncScheduler() {
  if (_syncInterval) {
    clearInterval(_syncInterval)
    _syncInterval = null
  }
}
