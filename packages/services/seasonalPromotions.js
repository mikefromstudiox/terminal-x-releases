// DR seasonal promotions calendar — carnicería v2.16.3.
//
// Generic engine: maps the current date to active "seasons" (DR holidays).
// `seedSeasonalPromos(business_id)` inserts a default promotions row per season
// once per business. `activeSeasons(date)` lists what's hot today so the POS
// header can render a crimson banner without hitting the network.
//
// Date math is local-time. Easter uses the Anonymous Gregorian computus
// (Meeus/Jones/Butcher) — no DST quirks because Holy Week is reckoned by date,
// not by hour.

const SEASON_KEYS = ['ano_nuevo', 'dia_madres', 'dia_padres', 'semana_santa', 'navidad']

// ── Date helpers ────────────────────────────────────────────────────────────

function toDate(d) { return d instanceof Date ? new Date(d) : new Date(d) }
function ymd(d) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0')
  return `${y}-${m}-${day}`
}
function inRange(date, start, end) {
  const t = +new Date(date.getFullYear(), date.getMonth(), date.getDate())
  return t >= +start && t <= +end
}

// Meeus/Jones/Butcher computus — returns Easter Sunday for given year.
function easterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

// Last Sunday of a given month (last-Sun-of-May / last-Sun-of-July).
function lastSundayOfMonth(year, monthIdx /* 0-based */) {
  const d = new Date(year, monthIdx + 1, 0) // last day of month
  const dow = d.getDay()
  d.setDate(d.getDate() - dow)
  return d
}

function shift(d, days) { const x = new Date(d); x.setDate(x.getDate() + days); return x }

// ── Season window resolver ──────────────────────────────────────────────────

export function seasonWindow(seasonKey, year) {
  switch (seasonKey) {
    case 'ano_nuevo':    return { start: new Date(year-1, 11, 26), end: new Date(year, 0, 2) }
    case 'navidad':      return { start: new Date(year, 11, 15),    end: new Date(year, 11, 24) }
    case 'dia_madres': {
      const center = lastSundayOfMonth(year, 4) // May
      return { start: shift(center, -3), end: shift(center, 3) }
    }
    case 'dia_padres': {
      const center = lastSundayOfMonth(year, 6) // July (DR celebrates last Sun of July)
      return { start: shift(center, -3), end: shift(center, 3) }
    }
    case 'semana_santa': {
      const easter = easterSunday(year)
      // Holy Week = Palm Sunday (-7) through Easter Sunday.
      return { start: shift(easter, -7), end: easter }
    }
    default: return null
  }
}

export function activeSeasons(date = new Date()) {
  const d = toDate(date)
  const year = d.getFullYear()
  const out = []
  for (const key of SEASON_KEYS) {
    // For ano_nuevo we may straddle year boundary — also test next year.
    const candidates = key === 'ano_nuevo'
      ? [seasonWindow(key, year), seasonWindow(key, year + 1)]
      : [seasonWindow(key, year)]
    for (const w of candidates) {
      if (w && inRange(d, w.start, w.end)) { out.push({ key, ...w }); break }
    }
  }
  return out
}

// ── Default banner copy (ES) ────────────────────────────────────────────────

export const SEASON_LABELS = {
  ano_nuevo:    { es: '🎆 Año Nuevo — 10% en cortes premium',         banner: 'Especial Año Nuevo' },
  navidad:      { es: '🎄 Navidad — pernil y costilla con descuento', banner: 'Especial Navidad' },
  dia_madres:   { es: '💐 Día de las Madres — combo familiar',        banner: 'Especial Día de las Madres' },
  dia_padres:   { es: '🥩 Día de los Padres — parrilla mixta',        banner: 'Especial Día de los Padres' },
  semana_santa: { es: '🐟 Semana Santa — pescado y mariscos',         banner: 'Especial Semana Santa' },
}

// ── Seeder — idempotent ─────────────────────────────────────────────────────
// Caller passes (db, business_id). Inserts one promotions row per season key
// if it doesn't already exist for that business. db must expose .prepare/.run
// in better-sqlite3 style or .insert() in a Supabase client wrapper.

export function seedSeasonalPromos({ db, business_id, year = new Date().getFullYear() }) {
  if (!db || !business_id) return { inserted: 0 }
  let inserted = 0
  for (const key of SEASON_KEYS) {
    const w = seasonWindow(key, year)
    if (!w) continue
    const exists = db.prepare(
      'SELECT 1 FROM promotions WHERE business_id = ? AND season_key = ? AND start_date = ?'
    ).get(business_id, key, ymd(w.start))
    if (exists) continue
    db.prepare(`
      INSERT INTO promotions
        (business_id, name, tipo, discount_pct, start_date, end_date, season_key, banner_text, active, created_at, updated_at)
      VALUES (?, ?, 'pct', 10, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `).run(
      business_id,
      SEASON_LABELS[key].banner,
      ymd(w.start), ymd(w.end),
      key,
      SEASON_LABELS[key].es
    )
    inserted++
  }
  return { inserted }
}

export const __test = { easterSunday, lastSundayOfMonth, ymd }
