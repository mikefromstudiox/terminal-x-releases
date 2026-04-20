/**
 * inventoryLock.js — multi-device ticket collision detection (Pro MAX).
 *
 * Two cashiers on two POS devices selling the last bottle of Brugal is a data
 * race: both see qty=1 in their local cache, both submit, one overstocks
 * negative. This service short-circuits that race by reserving inventory on
 * ADD-TO-CART (not on cobrar) via a short-TTL `ticket_locks` row.
 *
 * Flow
 * ────
 *   addToCart(item)      → acquireLock(bid, itemSid, deviceId, qty)
 *   removeFromCart       → releaseLock(bid, itemSid, deviceId)
 *   cobrarModal success  → releaseAll(bid, deviceId)
 *   mount                → sweepExpired(deviceId) [housekeeping]
 *   realtime INSERT/DEL  → subscribeLocks(bid, deviceId, onChange)
 *
 * Each tab gets its own deviceId (sessionStorage). Locks TTL = 90s (DB default
 * expires_at = now()+90s). A tab that closes without releasing leaves rows
 * that silently expire — the activeLocksQty() query filters `expires_at > now()`.
 *
 * The service is SAFE to call from any plan — if the caller is not Pro MAX
 * the POS simply doesn't invoke these helpers (see usePlan hasFeature check).
 * If Supabase is down we return { ok: true, skipped: true } so the cashier is
 * never blocked; locking is a best-effort safety net, not a hard gate.
 */

import { getSupabaseClient, getBusinessId } from './supabase.js'

// ── Device ID (stable per tab) ──────────────────────────────────────────────
const DEVICE_ID_KEY = 'tx_device_id'

export function getDeviceId() {
  try {
    const existing = sessionStorage.getItem(DEVICE_ID_KEY)
    if (existing) return existing
    const fresh = (crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
    sessionStorage.setItem(DEVICE_ID_KEY, fresh)
    return fresh
  } catch {
    // private browsing / SSR — fall back to an in-memory id (still unique per load)
    if (!globalThis.__txDeviceIdMem) {
      globalThis.__txDeviceIdMem = (crypto?.randomUUID?.() || `dev-${Date.now()}`)
    }
    return globalThis.__txDeviceIdMem
  }
}

// ── Core helpers ────────────────────────────────────────────────────────────

/**
 * Insert a lock row for (business, inventory_item, device). expires_at is
 * populated by the DB default (+90s). If a row already exists for this
 * (business, item, device) triple, upsert the qty.
 */
export async function acquireLock(businessId, itemSupabaseId, deviceId, qty = 1) {
  const sb = getSupabaseClient()
  if (!sb || !businessId || !itemSupabaseId || !deviceId) return { ok: false, skipped: true }
  try {
    // Upsert on (business_id, inventory_item_supabase_id, device_id) so
    // repeated addToCart clicks don't pile up rows — they just refresh qty
    // + expires_at.
    const now = new Date()
    const expires = new Date(now.getTime() + 90_000)
    const { error } = await sb.from('ticket_locks').upsert(
      {
        business_id:                  businessId,
        inventory_item_supabase_id:   itemSupabaseId,
        device_id:                    deviceId,
        qty:                          Number(qty) || 1,
        locked_at:                    now.toISOString(),
        expires_at:                   expires.toISOString(),
      },
      { onConflict: 'business_id,inventory_item_supabase_id,device_id' }
    )
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || 'lock_failed' }
  }
}

/**
 * Release the lock for a specific item on this device. Called on cart removal.
 */
export async function releaseLock(businessId, itemSupabaseId, deviceId) {
  const sb = getSupabaseClient()
  if (!sb || !businessId || !itemSupabaseId || !deviceId) return { ok: false, skipped: true }
  try {
    const { error } = await sb.from('ticket_locks')
      .delete()
      .eq('business_id', businessId)
      .eq('inventory_item_supabase_id', itemSupabaseId)
      .eq('device_id', deviceId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || 'release_failed' }
  }
}

/**
 * Release ALL locks for this device. Called on successful cobro + on cart clear.
 */
export async function releaseAll(businessId, deviceId) {
  const sb = getSupabaseClient()
  if (!sb || !businessId || !deviceId) return { ok: false, skipped: true }
  try {
    const { error } = await sb.from('ticket_locks')
      .delete()
      .eq('business_id', businessId)
      .eq('device_id', deviceId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || 'release_all_failed' }
  }
}

/**
 * Sum qty of non-expired locks for (business, item) EXCLUDING this device.
 * This is the number of units already reserved by OTHER POS terminals.
 */
export async function activeLocksQty(businessId, itemSupabaseId, excludeDeviceId) {
  const sb = getSupabaseClient()
  if (!sb || !businessId || !itemSupabaseId) return 0
  try {
    const nowIso = new Date().toISOString()
    let q = sb.from('ticket_locks').select('qty,device_id,expires_at')
      .eq('business_id', businessId)
      .eq('inventory_item_supabase_id', itemSupabaseId)
      .gt('expires_at', nowIso)
    if (excludeDeviceId) q = q.neq('device_id', excludeDeviceId)
    const { data, error } = await q
    if (error) return 0
    let sum = 0
    for (const r of (data || [])) sum += Number(r.qty || 0)
    return sum
  } catch { return 0 }
}

/**
 * Housekeeping — delete expired locks that THIS device left behind on a prior
 * session (tab close without releaseAll). Safe to call on mount.
 */
export async function sweepExpired(deviceId) {
  const sb = getSupabaseClient()
  if (!sb || !deviceId) return { ok: false, skipped: true }
  try {
    const nowIso = new Date().toISOString()
    const { error } = await sb.from('ticket_locks')
      .delete()
      .eq('device_id', deviceId)
      .lt('expires_at', nowIso)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || 'sweep_failed' }
  }
}

/**
 * Subscribe to ticket_locks INSERT/DELETE on this business. Callback fires
 * for rows created/removed by OTHER devices. Returns an unsubscribe fn.
 */
export function subscribeLocks(businessId, deviceId, onChange) {
  const sb = getSupabaseClient()
  if (!sb || !businessId) return () => {}
  try {
    const channel = sb.channel(`ticket_locks:${businessId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'ticket_locks', filter: `business_id=eq.${businessId}` },
        (payload) => {
          const row = payload.new || payload.old
          if (!row || row.device_id === deviceId) return  // ignore our own
          try { onChange?.(payload.eventType || payload.event, row) } catch {}
        })
      .subscribe()
    return () => { try { sb.removeChannel(channel) } catch {} }
  } catch { return () => {} }
}

// ── Tiny check helper for the POS ──────────────────────────────────────────
/**
 * Given a product, the cashier's desired qty, and other-device locks, returns
 * { ok, available, otherLocked }. If ok=false the UI shows the collision warning.
 */
export async function checkAvailability(product, desiredQty = 1) {
  const businessId = getBusinessId()
  const deviceId   = getDeviceId()
  const itemSid    = product?.supabase_id
  const stock      = Number(product?.quantity ?? Infinity)
  if (!businessId || !itemSid) return { ok: true, available: stock, otherLocked: 0 }
  const otherLocked = await activeLocksQty(businessId, itemSid, deviceId)
  const available   = Math.max(0, stock - otherLocked)
  return { ok: desiredQty <= available, available, otherLocked }
}

export const inventoryLock = {
  getDeviceId,
  acquireLock,
  releaseLock,
  releaseAll,
  activeLocksQty,
  sweepExpired,
  subscribeLocks,
  checkAvailability,
}

export default inventoryLock
