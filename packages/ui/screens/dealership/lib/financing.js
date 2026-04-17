/**
 * financing.js — Vehicle finance math.
 *
 * Standard amortization: M = P * r / (1 - (1+r)^-n)
 *   P = financed amount
 *   r = monthly APR (annual / 12 / 100)
 *   n = term in months
 * Returns 0 if inputs invalid.
 */

export function computeMonthlyPayment(financedAmount, aprAnnualPct, termMonths) {
  const P = Number(financedAmount) || 0
  const apr = Number(aprAnnualPct) || 0
  const n = Math.max(0, Math.floor(Number(termMonths) || 0))
  if (P <= 0 || n === 0) return 0
  if (apr === 0) return +(P / n).toFixed(2)
  const r = apr / 12 / 100
  const M = (P * r) / (1 - Math.pow(1 + r, -n))
  return +M.toFixed(2)
}

export function computeDeal({ salePrice, tradeInValue = 0, downPayment = 0, aprAnnualPct = 0, termMonths = 0 }) {
  const sp = Number(salePrice) || 0
  const tiv = Number(tradeInValue) || 0
  const dp = Number(downPayment) || 0
  const financed = Math.max(0, sp - tiv - dp)
  const monthly = computeMonthlyPayment(financed, aprAnnualPct, termMonths)
  const totalOfPayments = +(monthly * termMonths).toFixed(2)
  const totalInterest = +(totalOfPayments - financed).toFixed(2)
  return { financed, monthly, totalOfPayments, totalInterest }
}
