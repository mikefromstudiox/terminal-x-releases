/**
 * isr.js — Dominican Republic progressive income tax (ISR) calculator.
 *
 * Official DGII brackets. Rename the constant and update values when
 * DGII publishes new thresholds.
 *
 * Annualization formula (per DGII guidance for payroll withholding):
 *   - Monthly payroll:    annualGross = monthlyGross × 12
 *   - Quincenal payroll:  annualGross = quincenalGross × 24
 * Apply marginal brackets to annualGross, then divide the annual tax by
 * the same number of periods to get the per-paycheck withholding.
 */

export const DR_ISR_BRACKETS_2026 = [
  // [min, max, rate] — each bracket is marginal (only the exceso is taxed at rate)
  [0,       416220,  0],
  [416220,  624329,  0.15],
  [624329,  867123,  0.20],
  [867123,  Infinity, 0.25],
]

const PERIODS_PER_YEAR = {
  mensual:    12,
  quincenal:  24,
  semanal:    52,
}

/**
 * Normalize bracket input so callers can pass either the canonical
 * array-of-arrays or an array of objects from a DB row.
 */
function normalizeBrackets(brackets) {
  if (!Array.isArray(brackets) || brackets.length === 0) return DR_ISR_BRACKETS_2026
  if (Array.isArray(brackets[0])) return brackets.map(([min, max, rate]) => [
    Number(min), Number(max) === 0 ? Infinity : Number(max), Number(rate),
  ])
  return brackets.map(b => [Number(b.min), Number(b.max ?? Infinity), Number(b.rate)])
}

/**
 * Return a human label for the current bracket (1ra / 2da / 3ra / 4ta escala).
 */
function bracketLabel(annualGross, brackets) {
  const labels = ['1ra escala (exento)', '2da escala (15%)', '3ra escala (20%)', '4ta escala (25%)']
  for (let i = 0; i < brackets.length; i++) {
    const [min, max] = brackets[i]
    if (annualGross >= min && annualGross <= max) return labels[i] || `escala ${i + 1}`
  }
  return '1ra escala (exento)'
}

/**
 * calcISR — compute income-tax withholding for a single paycheck.
 *
 * @param {number} paycheckGross  Gross amount of this paycheck (base + commissions + bonuses)
 * @param {string} cycle          'mensual' | 'quincenal' | 'semanal'
 * @param {Array}  brackets       Optional — defaults to DR 2026 brackets
 * @returns {{annualGross, annualTax, periodTax, bracket}}
 */
export function calcISR(paycheckGross, cycle = 'mensual', brackets = DR_ISR_BRACKETS_2026) {
  const gross = Number(paycheckGross || 0)
  if (gross <= 0) {
    return { annualGross: 0, annualTax: 0, periodTax: 0, bracket: '1ra escala (exento)' }
  }
  const periodsPerYear = PERIODS_PER_YEAR[cycle] || 12
  const annualGross = gross * periodsPerYear
  const brks = normalizeBrackets(brackets)

  let annualTax = 0
  for (const [min, max, rate] of brks) {
    if (annualGross <= min) break
    const taxable = Math.min(annualGross, max) - min
    if (taxable > 0) annualTax += taxable * rate
  }

  return {
    annualGross: parseFloat(annualGross.toFixed(2)),
    annualTax:   parseFloat(annualTax.toFixed(2)),
    periodTax:   parseFloat((annualTax / periodsPerYear).toFixed(2)),
    bracket:     bracketLabel(annualGross, brks),
  }
}
