// Single source of truth for user-input formatters + their derived max lengths.
//
// RULE: never hardcode `maxLength={N}` next to a formatter. Always import the
// matching *_MAX_LENGTH constant from this file. The constants are derived from
// the formatters themselves at module load, so they physically cannot drift out
// of sync with the real format (see the v2.13.14 TXL-XXXX-XXXX-XXXX incident).

// ─── License key: TXL-XXXX-XXXX-XXXX ─────────────────────────────────────────
export function formatLicenseKey(raw) {
  let clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (clean.length >= 12 && !clean.startsWith('TXL')) clean = 'TXL' + clean
  clean = clean.slice(0, 15) // 3 prefix + 12 chars
  const parts = []
  if (clean.length > 0)  parts.push(clean.slice(0, 3))
  if (clean.length > 3)  parts.push(clean.slice(3, 7))
  if (clean.length > 7)  parts.push(clean.slice(7, 11))
  if (clean.length > 11) parts.push(clean.slice(11, 15))
  return parts.join('-')
}

// ─── RNC (9 digits) = XXX-XXXXX-X ────────────────────────────────────────────
export function formatRnc(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 9)
  if (digits.length <= 3) return digits
  if (digits.length <= 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 8)}-${digits.slice(8)}`
}

// ─── Cédula (11 digits) = XXX-XXXXXXX-X ──────────────────────────────────────
export function formatCedula(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3)  return digits
  if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}`
}

// ─── RNC or Cédula (auto by length) ──────────────────────────────────────────
export function formatRncCedula(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 9) {
    if (digits.length <= 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`
    return `${digits.slice(0, 3)}-${digits.slice(3, 8)}-${digits.slice(8)}`
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}`
}

// ─── Phone: 809-555-0123 (10 digits) ─────────────────────────────────────────
export function formatPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}

// ─── Derived max lengths (computed from formatters — cannot drift) ───────────
// Pattern: feed the formatter more chars than any real input, then measure output.
const _PROBE = '9'.repeat(64)
export const LICENSE_KEY_MAX_LENGTH = formatLicenseKey('X'.repeat(64)).length // 18
export const RNC_MAX_LENGTH         = formatRnc(_PROBE).length                // 11
export const CEDULA_MAX_LENGTH      = formatCedula(_PROBE).length             // 13
export const RNC_CEDULA_MAX_LENGTH  = formatRncCedula(_PROBE).length          // 13
export const PHONE_MAX_LENGTH       = formatPhone(_PROBE).length              // 12
export const VIN_MAX_LENGTH         = 17 // VIN spec fixed by ISO 3779 — not format-bound
