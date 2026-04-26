// Scale service abstraction — carniceria vertical.
//
// Drivers:
//   - mock:      manual weight entry (keypad in WeightModal). Default.
//   - webserial: Web Serial API — hooks CAS PD-II / Datalogic-style ASCII lines
//                ("ST,GS,+00.750 lb\r\n") common in DR meat markets.
//
// Real hardware integration is intentionally stubbed behind a driver interface
// so swapping in a production driver never touches the UI.

const DRIVERS = {
  mock: {
    connect: async () => ({ connected: true, driver: 'mock' }),
    disconnect: async () => {},
    read: async () => ({ weight: null, unit: 'lb', stable: false }),
    subscribe: (_cb) => () => {},
  },

  webserial: {
    connect: async () => {
      if (typeof navigator === 'undefined' || !navigator.serial) {
        throw new Error('Web Serial no disponible. Usa Chrome/Edge y servido por HTTPS.')
      }
      const port = await navigator.serial.requestPort()
      await port.open({ baudRate: 9600 })
      return { connected: true, driver: 'webserial', port }
    },
    disconnect: async (ctx) => { try { await ctx?.port?.close?.() } catch {} },
    // NOTE: full parser lives in a future commit. Current stub returns nulls so
    // the WeightModal falls back to keypad entry with zero user-visible impact.
    read: async () => ({ weight: null, unit: 'lb', stable: false }),
    subscribe: (_cb) => () => {},
  },
}

export function createScaleService({ driver = 'mock' } = {}) {
  const d = DRIVERS[driver] || DRIVERS.mock
  let ctx = null

  return {
    driver,
    isConnected: () => !!ctx?.connected,
    connect:    async () => { ctx = await d.connect(); return ctx },
    disconnect: async () => { await d.disconnect(ctx); ctx = null },
    read:       async () => d.read(ctx),
    subscribe:  (cb) => d.subscribe(cb),
  }
}

// Parse a weight string (e.g. "0.75", "0,75") to a clamped positive number.
// Returns null for invalid input so UI can show the user a validation hint.
export function parseWeight(raw) {
  if (raw == null) return null
  const s = String(raw).trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n) || n <= 0) return null
  // Round to 3 decimals (grams-level precision) to avoid FP artifacts.
  return Math.round(n * 1000) / 1000
}

// Apply tare subtraction and clamp to zero.
export function applyTare(gross, tare) {
  const g = Number(gross) || 0
  const t = Number(tare)  || 0
  const n = g - t
  return n > 0 ? Math.round(n * 1000) / 1000 : 0
}

// ── Multi-scale registry (v2.16.3 carniceria hardening) ─────────────────────
// One ScaleRegistry per renderer process. Backed by carniceria_scales table
// via the API bridge; in-memory list mirrors DB rows with one marked active.
// Hot-swap: setActive(id) emits 'change' so POS header / WeightModal can react
// without a restart. Driver instance is created lazily per scale row.

const _listeners = new Set()
let _scales = []           // [{ id, supabase_id, nombre, tipo, protocol, baud_rate, ... }]
let _activeId = null
let _activeService = null  // createScaleService instance for current scale

function emit(event) { for (const cb of _listeners) { try { cb(event) } catch {} } }

export const ScaleRegistry = {
  list()      { return _scales.slice() },
  getActive() { return _scales.find(s => s.id === _activeId) || null },
  getActiveService() { return _activeService },
  subscribe(cb) { _listeners.add(cb); return () => _listeners.delete(cb) },

  // Replace the in-memory roster; pick the row flagged active_default if no
  // explicit active id is set. Used by Settings + boot sync.
  hydrate(rows) {
    _scales = Array.isArray(rows) ? rows.slice() : []
    if (_activeId && !_scales.find(s => s.id === _activeId)) _activeId = null
    if (!_activeId) {
      const def = _scales.find(s => s.active_default) || _scales[0]
      _activeId = def?.id ?? null
    }
    _activeService = null
    emit({ type: 'hydrate', activeId: _activeId, scales: _scales })
  },

  async setActive(id) {
    const next = _scales.find(s => s.id === id)
    if (!next) throw new Error('Scale not found')
    if (_activeService) { try { await _activeService.disconnect() } catch {} _activeService = null }
    _activeId = id
    emit({ type: 'active-change', activeId: _activeId, scale: next })
  },

  async ensureConnected() {
    const cur = ScaleRegistry.getActive()
    if (!cur) return null
    if (!_activeService) {
      _activeService = createScaleService({ driver: cur.protocol === 'mock' ? 'mock' : 'webserial' })
    }
    if (!_activeService.isConnected()) {
      try { await _activeService.connect() } catch (e) { emit({ type: 'connect-error', error: e?.message }); return null }
    }
    return _activeService
  },
}

// Convenience facade used by WeightModal — always operates on the active scale.
export async function readActiveWeight() {
  const svc = await ScaleRegistry.ensureConnected()
  if (!svc) return { weight: null, unit: 'lb', stable: false }
  return svc.read()
}
