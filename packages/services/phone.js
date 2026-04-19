// Phone number formatting helpers for receipts and display.
//
// businesses.phone is stored normalized for the WhatsApp / UltraMsg API
// ("+18098282971"). Receipts want the human-readable DR format
// ("809-870-0712"). This module is the single source of truth.

// Strip to digits, drop the leading country code "1" if present on an 11-digit
// string, then format as XXX-XXX-XXXX. Returns the raw input if it doesn't
// look like a DR number.
export function formatPhoneForReceipt(raw) {
  const digits = String(raw || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')
  if (digits.length !== 10) return String(raw || '').trim()
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}

// Normalize to the WhatsApp API format: digits only, with "1" prefix for DR.
export function normalizeWaPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '')
  if (d.length === 10 && (d[0] === '8' || d[0] === '9')) return '1' + d
  if (d.length === 11 && d[0] === '1') return d
  return d
}
