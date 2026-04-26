// Centavo-safe money math for RD$.
//
// JavaScript floats can't represent decimal cents exactly:
//   0.1 + 0.2 === 0.30000000000000004
//   (1.005).toFixed(2) === '1.00'  (NOT '1.01')
//
// Every computation here rounds to integer centavos first, then converts back
// to RD$. Use these helpers for ANY licorería arithmetic that lands on a
// ticket, refund, deposit, or DGII XML payload.
//
// Caller contract: inputs may be Number | string | null | undefined; non-finite
// values coerce to 0 silently — these are display/persistence helpers, not
// validators. Validate at boundaries (form inputs, API responses) before
// calling these.

const CENT = 100

const toCents = n => {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  // Two-step rounding: trim float drift to 8 decimals first, then round.
  // Without this, `1.005 * 100` is `100.49999999999999` and rounds DOWN to
  // 100, yielding RD$1.00 instead of the expected RD$1.01.
  return Math.round(Number((v * CENT).toFixed(8)))
}

export function round2(n) {
  return toCents(n) / CENT
}

export function add(a, b) {
  return (toCents(a) + toCents(b)) / CENT
}

export function sub(a, b) {
  return (toCents(a) - toCents(b)) / CENT
}

// Multiply RD$ by a unit count (qty, fixed multiplier). Both operands round
// to cents first to preserve associativity across long ticket aggregations.
export function mul(amount, factor) {
  const cents = toCents(amount)
  const f     = Number(factor)
  if (!Number.isFinite(f)) return 0
  return Math.round(cents * f) / CENT
}

// Sum a list of {price, qty} lines without intermediate float drift.
// Returns RD$ (number, ≤ 2 decimals).
export function sumLines(lines) {
  if (!Array.isArray(lines)) return 0
  let cents = 0
  for (const l of lines) {
    if (!l) continue
    const p = toCents(l.price)
    const q = Number(l.qty || 1)
    if (!Number.isFinite(q)) continue
    cents += Math.round(p * q)
  }
  return cents / CENT
}

// Apply a percent discount (0–100). Returns the discount amount in RD$,
// rounded to centavo. Pass 18 for ITBIS, 8 for mayoreo, etc.
export function pctOf(amount, pct) {
  const p = Number(pct)
  if (!Number.isFinite(p)) return 0
  return Math.round(toCents(amount) * (p / 100)) / CENT
}

// Hard cap helpers — clamp to [0, max] and round to centavo. Used by the
// deposit-refund path to enforce subtype limits.
export function clamp(amount, max) {
  const cents = Math.max(0, Math.min(toCents(max), toCents(amount)))
  return cents / CENT
}

// Format for receipts / UI. Always 2 decimals, DR locale.
export function fmtRD(n) {
  return 'RD$' + round2(n).toLocaleString('es-DO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
