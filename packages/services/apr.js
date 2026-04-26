/**
 * apr.js — Annual percentage rate helpers for prestamos
 *
 * Converts a monthly interest rate (decimal, e.g. 0.045 for 4.5%) into:
 *   - Effective annual rate  (compound):  (1 + r)^12 - 1
 *   - Simple annual rate     (legal):     r * 12
 *   - Display string:        "4.50% mensual (equivalente 69.59% anual)"
 *
 * All inputs are decimals. Null / undefined / NaN / 0 → graceful fallback.
 */

const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n)

/** Effective annual rate from monthly rate: (1 + r)^12 - 1 */
export function effectiveAnnualRate(monthlyRate) {
  if (!isFiniteNum(monthlyRate)) return 0
  return Math.pow(1 + monthlyRate, 12) - 1
}

/** Simple annual rate (×12) — for legal-fallback display if needed */
export function simpleAnnualRate(monthlyRate) {
  if (!isFiniteNum(monthlyRate)) return 0
  return monthlyRate * 12
}

const fmtPct = (decimal, locale) =>
  new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(decimal * 100)

/**
 * Display string. Example: formatAPR(0.045) → "4.50% mensual (equivalente 69.59% anual)"
 * Handles 0 / null / undefined → "0.00% mensual".
 */
export function formatAPR(monthlyRate, locale = 'es-DO') {
  if (!isFiniteNum(monthlyRate) || monthlyRate === 0) return '0.00% mensual'
  const monthly = fmtPct(monthlyRate, locale)
  const annual  = fmtPct(effectiveAnnualRate(monthlyRate), locale)
  return `${monthly}% mensual (equivalente ${annual}% anual)`
}
