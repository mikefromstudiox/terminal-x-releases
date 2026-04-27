// Pro MAX feature — auto-send via WhatsApp Business API requires Meta WABA approval + setup.
// Until WABA is live, every helper here returns a wa.me deep-link the contable opens
// in the browser to send via WhatsApp Web/desktop. Stays Spanish (es-DO).

export async function sendAutomatic() { return { sent: false, reason: 'waba_not_configured' } }
export function isWabaConfigured() { return false }

// ── Helpers ────────────────────────────────────────────────────────────────
function digits(s) { return String(s || '').replace(/\D+/g, '') }
function fmtRD(n)  { return Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

/**
 * Build a wa.me deep-link.
 * @param {string} phone   raw phone (digits only kept). DR mobile starts with +1809…
 *                         If empty, returns a generic wa.me/?text= link the user can paste a number into.
 * @param {string} text    message body (will be URL-encoded).
 */
export function buildWaLink(phone, text) {
  const ph = digits(phone)
  const t  = encodeURIComponent(String(text || ''))
  return ph ? `https://wa.me/${ph}?text=${t}` : `https://wa.me/?text=${t}`
}

// ── Contabilidad templates ─────────────────────────────────────────────────
// All templates return `{ url, text }` so the caller can either window.open(url)
// or copy `text` to clipboard.

export function contabilidadVencimiento({ phone, cliente, formato, dias } = {}) {
  const text = `Hola ${cliente || ''}, te recuerdo que tu ${formato || 'declaración'} vence en ${dias != null ? dias : '?'} días. Si necesitas ayuda, escríbeme.`
  return { url: buildWaLink(phone, text), text }
}

export function contabilidadHonorarioPendiente({ phone, cliente, periodo, monto } = {}) {
  const text = `Hola ${cliente || ''}, tu honorario de ${periodo || 'este período'} por RD$${fmtRD(monto)} está pendiente. Te paso el link de pago.`
  return { url: buildWaLink(phone, text), text }
}

export function contabilidadEstadosListos({ phone, cliente, periodo } = {}) {
  const text = `Hola ${cliente || ''}, tus estados financieros de ${periodo || 'este período'} están listos. Te los envío en PDF.`
  return { url: buildWaLink(phone, text), text }
}

export function contabilidadReporteEjecutivo({ phone, cliente, periodo } = {}) {
  const text = `Hola ${cliente || ''}, te comparto el reporte ejecutivo de ${periodo || 'este período'}.`
  return { url: buildWaLink(phone, text), text }
}

export const contabilidadTemplates = {
  vencimiento:        contabilidadVencimiento,
  honorarioPendiente: contabilidadHonorarioPendiente,
  estadosListos:      contabilidadEstadosListos,
  reporteEjecutivo:   contabilidadReporteEjecutivo,
}
