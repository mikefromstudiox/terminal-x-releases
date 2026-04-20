/**
 * offline-queue.js — IndexedDB-based offline queue for the Terminal X web/PWA.
 *
 * Stores tickets and e-CF submissions that failed due to network issues,
 * then syncs them automatically when connectivity is restored.
 */

import { openDB } from 'idb'

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const DB_NAME    = 'terminal-x-offline'
const DB_VERSION = 1

let dbPromise = null

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('pending_tickets')) {
          const tickets = db.createObjectStore('pending_tickets', { keyPath: 'id', autoIncrement: true })
          tickets.createIndex('status', 'status')
        }
        if (!db.objectStoreNames.contains('pending_ecf')) {
          const ecf = db.createObjectStore('pending_ecf', { keyPath: 'id', autoIncrement: true })
          ecf.createIndex('status', 'status')
        }
      },
    })
  }
  return dbPromise
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now() {
  return new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export async function enqueueTicket(ticketData) {
  const db = await getDB()
  return db.add('pending_tickets', {
    payload:   ticketData,
    status:    'pending',
    attempts:  0,
    createdAt: now(),
    lastError: null,
  })
}

export async function getPendingTickets() {
  const db = await getDB()
  const all = await db.getAll('pending_tickets')
  return all.filter(t => t.status === 'pending')
}

export async function markTicketSynced(id) {
  const db = await getDB()
  return db.delete('pending_tickets', id)
}

// ---------------------------------------------------------------------------
// e-CF
// ---------------------------------------------------------------------------

export async function enqueueECF(payload) {
  const db = await getDB()
  return db.add('pending_ecf', {
    payload,
    status:    'pending',
    attempts:  0,
    createdAt: now(),
    lastError: null,
  })
}

export async function getPendingECFs() {
  const db = await getDB()
  const all = await db.getAll('pending_ecf')
  return all.filter(e => e.status === 'pending' && e.attempts < 5)
}

export async function markECFSent(id) {
  const db = await getDB()
  return db.delete('pending_ecf', id)
}

export async function markECFFailed(id, error) {
  const db = await getDB()
  const item = await db.get('pending_ecf', id)
  if (!item) return
  item.attempts += 1
  item.lastError = typeof error === 'string' ? error : (error?.message || String(error))
  if (item.attempts >= 5) item.status = 'failed'
  return db.put('pending_ecf', item)
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

export async function getQueueCounts() {
  const db = await getDB()
  const tickets = (await db.getAll('pending_tickets')).filter(t => t.status === 'pending').length
  const ecf     = (await db.getAll('pending_ecf')).filter(e => e.status === 'pending' && e.attempts < 5).length
  return { tickets, ecf }
}

// ---------------------------------------------------------------------------
// Sync — Tickets
// ---------------------------------------------------------------------------

export async function syncPendingTickets(supabase, businessId) {
  try {
    if (!navigator.onLine || !supabase || !businessId) return

    const pending = await getPendingTickets()
    for (const item of pending) {
      try {
        const data = item.payload

        // Generate doc_number
        const { count } = await supabase.from('tickets')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
        const docNum = `T-${String((count || 0) + 1).padStart(4, '0')}`

        const status = data.tipo_venta === 'credito' || data.payment_method === 'credit' ? 'pendiente' : 'cobrado'

        const { data: ticket, error: ticketErr } = await supabase.from('tickets').insert({
          business_id:                  businessId,
          supabase_id:                  data.supabase_id || crypto.randomUUID(),
          doc_number:                   docNum,
          client_supabase_id:           data.client_supabase_id || null,
          washer_empleado_supabase_ids: data.washer_empleado_supabase_ids || data.washer_ids || [],
          seller_empleado_supabase_id:  data.seller_empleado_supabase_id || data.seller_supabase_id || null,
          cajero_supabase_id:           data.cajero_supabase_id || null,
          subtotal:         data.subtotal || 0,
          descuento:        data.descuento || 0,
          itbis:            data.itbis || 0,
          ley:              data.ley || 0,
          total:            data.total || 0,
          payment_method:   data.payment_method || 'cash',
          comprobante_type: data.comprobante_type || 'B02',
          ecf_result:       data.ecf_result || {},
          tipo_venta:       data.tipo_venta || 'contado',
          status,
          vehicle_plate:    data.vehicle_plate || null,
          notes:            data.notes || null,
        }).select().single()

        if (ticketErr) throw ticketErr

        // Insert items
        const items = data.items || []
        if (items.length && ticket?.id) {
          await supabase.from('ticket_items').insert(
            items.map(i => ({
              business_id: businessId,
              ticket_id:   ticket.id,
              service_id:  i.service_id || null,
              name:        i.name,
              price:       i.price,
              itbis:       i.itbis || 0,
              is_wash:     i.is_wash ?? true,
            }))
          )
        }

        // Add to queue
        if (ticket?.id) {
          const firstWasher = Array.isArray(data.washer_ids) && data.washer_ids[0] ? data.washer_ids[0] : null
          // v2.1: queue.washer_id (legacy INT FK to washers) replaced by
          // empleado_supabase_id (UUID FK to empleados.supabase_id, tipo='lavador'/'hybrid').
          // ticket.id here is the Supabase UUID returned by the tickets insert above,
          // so it goes into ticket_supabase_id. business_id is the Supabase business UUID.
          await supabase.from('queue').insert({
            business_id:           businessId,
            ticket_supabase_id:    ticket.id,
            status:                'waiting',
            empleado_supabase_id:  firstWasher,
          })
        }

        // Update client balance for credit
        if (status === 'pendiente' && data.client_id) {
          await supabase.rpc('increment_client_balance', { cid: data.client_id, delta: data.total }).catch(() => {})
        }

        await markTicketSynced(item.id)
      } catch {
        // Individual ticket failed — leave in queue for next cycle
      }
    }
  } catch {
    // Never throw from sync
  }
}

// ---------------------------------------------------------------------------
// Sync — e-CF
// ---------------------------------------------------------------------------

export async function syncPendingECFs(supabase, businessId) {
  try {
    if (!navigator.onLine || !supabase || !businessId) return

    const pending = await getPendingECFs()
    for (const item of pending) {
      try {
        const { data, error } = await supabase.functions.invoke('submit-ecf', {
          body: { ...item.payload, business_id: businessId },
        })
        if (error) throw error
        await markECFSent(item.id)
      } catch (err) {
        await markECFFailed(item.id, err)
      }
    }
  } catch {
    // Never throw from sync
  }
}

// ---------------------------------------------------------------------------
// Auto-sync runner
// ---------------------------------------------------------------------------

let syncInterval = null
let _onOnlineHandler = null

/**
 * Globally cancel any in-flight offline-sync interval + online listener.
 * Called by AuthContext.logout() to guarantee no closure keeps a reference
 * to the (about-to-be-torn-down) Supabase client. Safe to call multiple
 * times / before startOfflineSync was ever invoked.
 */
export function stopOfflineSync() {
  try {
    if (_onOnlineHandler) window.removeEventListener('online', _onOnlineHandler)
  } catch {}
  _onOnlineHandler = null
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null }
}

export function startOfflineSync(supabase, businessId) {
  if (!supabase || !businessId) return

  // Defensive: wipe any prior interval/listener from a previous session so a
  // logout→re-login cycle never ends up with two closures (old client + new).
  stopOfflineSync()

  // Run once immediately if online
  if (navigator.onLine) {
    syncPendingTickets(supabase, businessId)
    syncPendingECFs(supabase, businessId)
  }

  // Listen for online events
  const onOnline = () => {
    syncPendingTickets(supabase, businessId)
    syncPendingECFs(supabase, businessId)
  }
  _onOnlineHandler = onOnline
  window.addEventListener('online', onOnline)

  // Poll every 60s when online
  syncInterval = setInterval(() => {
    if (navigator.onLine) {
      syncPendingTickets(supabase, businessId)
      syncPendingECFs(supabase, businessId)
    }
  }, 60_000)

  // Return cleanup function (used by React useEffect cleanup too)
  return stopOfflineSync
}
