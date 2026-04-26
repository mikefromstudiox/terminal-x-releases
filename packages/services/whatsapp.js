// WhatsApp deep-link helpers — carnicería v2.16.3.
// No Twilio dependency. Generates wa.me URLs the cashier opens with one tap.

function digitsOnly(p) { return String(p || '').replace(/\D+/g, '') }

// Normalize to international format (DR default). Adds 1 (US/DR) if 10 digits,
// keeps as-is otherwise. Returns empty string for invalid input.
export function normalizePhone(raw, defaultCountry = '1') {
  const d = digitsOnly(raw)
  if (!d) return ''
  if (d.length === 10) return defaultCountry + d
  return d
}

export function waLink(phone, message) {
  const p = normalizePhone(phone)
  if (!p) return ''
  return `https://wa.me/${p}?text=${encodeURIComponent(message)}`
}

// ── Mayoreo recurring order confirmation ────────────────────────────────────
export function mayoreoConfirm({ client, order, businessName }) {
  const items = (order?.items_json && Array.isArray(order.items_json) ? order.items_json : [])
    .map(i => `• ${i.qty} ${i.unit || 'lb'} ${i.name}`).join('\n')
  const total = order?.total_estimado ? `\n*Total estimado:* RD$${Number(order.total_estimado).toLocaleString('es-DO', { minimumFractionDigits: 2 })}` : ''
  const msg = `Hola ${client?.name || ''}, le saluda ${businessName || 'la carnicería'}.\n\n¿Confirmamos su pedido de hoy?\n\n${items}${total}\n\nResponda *SÍ* para preparar.`
  return waLink(client?.phone, msg)
}

// ── Fiado (credit) Friday reminder ──────────────────────────────────────────
export function fiadoReminder({ client, balance, businessName }) {
  const amt = Number(balance || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })
  const msg = `Hola ${client?.name || ''}, le saluda ${businessName || 'la carnicería'}. Le recordamos su saldo pendiente de *RD$${amt}*. Le esperamos en la tienda. ¡Gracias por su preferencia!`
  return waLink(client?.phone, msg)
}

// ── Friday 9am inbox builder ────────────────────────────────────────────────
// Returns the list of clients to contact today (does NOT auto-send).
// db is better-sqlite3 (or compatible). Cron tick fires from main process and
// posts to a local "Recordatorios" inbox the cashier opens manually.
export function buildFiadoFridayInbox({ db, business_id, businessName }) {
  if (!db || !business_id) return []
  const rows = db.prepare(`
    SELECT id, supabase_id, name, phone, balance, credit_limit
    FROM clients
    WHERE balance > 0 AND active = 1
    ORDER BY balance DESC
  `).all()
  return rows
    .filter(r => digitsOnly(r.phone))
    .map(r => ({
      client: r,
      balance: r.balance,
      link: fiadoReminder({ client: r, balance: r.balance, businessName }),
    }))
}

// True if today is Friday in local time and hour >= 9.
export function isFridayMorning(date = new Date()) {
  return date.getDay() === 5 && date.getHours() >= 9
}

// ── H8 — Horario laboral DR (8am-8pm, no domingos) ─────────────────────────
// DR labor practice + ley protección de datos: don't contact clients on
// Sundays nor outside 8am-8pm America/Santo_Domingo time.
export const WA_HORARIO = { startHour: 8, endHour: 20, allowSundays: false }

export function isWithinWAHorario(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santo_Domingo',
    weekday: 'short', hour: 'numeric', hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const wd = parts.find(p => p.type === 'weekday')?.value
  const hourRaw = parts.find(p => p.type === 'hour')?.value
  let hour = Number(hourRaw)
  // Intl returns 24 for midnight in en-US hour12:false; normalize to 0
  if (hour === 24) hour = 0
  if (!WA_HORARIO.allowSundays && wd === 'Sun') return { ok: false, reason: 'domingo' }
  if (hour < WA_HORARIO.startHour) return { ok: false, reason: `antes de ${WA_HORARIO.startHour}am` }
  if (hour >= WA_HORARIO.endHour)  return { ok: false, reason: `después de ${WA_HORARIO.endHour}pm` }
  return { ok: true }
}

// Validate + open wa.me with horario guard. Returns:
//   { ok: true }
//   { ok: false, reason: 'phone_invalid' }
//   { ok: false, reason: 'horario', detail: 'domingo' | 'antes de 8am' | 'después de 20pm' }
// Pass `force: true` to bypass horario after user confirmation.
export function openWhatsApp({ phone, message, force = false }) {
  const digits = String(phone || '').replace(/\D/g, '')
  // DR mobile = 1 + (809|829|849) + 7 digits. Accept missing country code too.
  const m = digits.match(/^(?:1)?(809|829|849)(\d{7})$/)
  if (!m) return { ok: false, reason: 'phone_invalid' }
  const e164 = `1${m[1]}${m[2]}`
  const horario = isWithinWAHorario()
  if (!horario.ok && !force) return { ok: false, reason: 'horario', detail: horario.reason }
  if (typeof window !== 'undefined' && window.open) {
    window.open(`https://wa.me/${e164}?text=${encodeURIComponent(message || '')}`, '_blank', 'noopener,noreferrer')
  }
  return { ok: true }
}
