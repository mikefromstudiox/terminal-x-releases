// Restaurant — happy-hour pricing helper.
//
// Returns the effective unit price for a menu item at the given clock time.
// When a service has non-null `happy_hour_price` AND the current time falls
// within [happy_hour_start, happy_hour_end] (HH:MM 24h), the discounted price
// applies. Handles overnight windows (e.g. 22:00 → 02:00) and the global kill
// switch via the `enabled` arg (tied to app_settings.restaurant_happy_hour_enabled).
//
// Keep this pure + side-effect free so RestaurantPOS can memoize on [now].

function parseHHMM(s) {
  if (!s || typeof s !== 'string') return null
  const m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null
  return h * 60 + mi
}

export function isInHappyHourWindow(startStr, endStr, now = new Date()) {
  const s = parseHHMM(startStr)
  const e = parseHHMM(endStr)
  if (s == null || e == null) return false
  const cur = now.getHours() * 60 + now.getMinutes()
  if (s === e) return false
  if (s < e) return cur >= s && cur < e         // same-day window
  return cur >= s || cur < e                    // overnight window (wraps midnight)
}

export function effectivePrice(svc, { enabled = true, now = new Date() } = {}) {
  const base = Number(svc?.price || 0)
  if (!enabled) return base
  const hh = svc?.happy_hour_price
  if (hh == null || hh === '' || !Number.isFinite(Number(hh))) return base
  if (!isInHappyHourWindow(svc?.happy_hour_start, svc?.happy_hour_end, now)) return base
  return Number(hh)
}

export function isHappyHourActive(svc, { enabled = true, now = new Date() } = {}) {
  if (!enabled) return false
  if (svc?.happy_hour_price == null || svc?.happy_hour_price === '') return false
  return isInHappyHourWindow(svc?.happy_hour_start, svc?.happy_hour_end, now)
}
