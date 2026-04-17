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
