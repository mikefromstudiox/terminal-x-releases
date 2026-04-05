/**
 * payPeriod.js — Quincenal/mensual period helpers for Dominican payroll.
 *
 * "Quincenal" in DR = two fixed periods per month:
 *   - Q1: days 1 → 15
 *   - Q2: days 16 → end-of-month
 *
 * "Mensual" = full calendar month (1 → end-of-month).
 */

const MONTH_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function iso(d) {
  return d.toISOString().slice(0, 10)
}
function lastDayOfMonth(year, month /* 0-based */) {
  return new Date(year, month + 1, 0).getDate()
}

/**
 * Return the quincena containing the given date.
 *   - If day ≤ 15 → Q1 (1 → 15)
 *   - Else        → Q2 (16 → end-of-month)
 */
export function currentQuincena(date = new Date()) {
  const y = date.getFullYear()
  const m = date.getMonth()
  const d = date.getDate()
  const half = d <= 15 ? 1 : 2
  const start = new Date(y, m, half === 1 ? 1 : 16)
  const end   = new Date(y, m, half === 1 ? 15 : lastDayOfMonth(y, m))
  return {
    cycle: 'quincenal',
    half,
    start: iso(start),
    end:   iso(end),
    label: `${half === 1 ? '1-15' : `16-${lastDayOfMonth(y, m)}`} ${MONTH_ES[m]} ${y}`,
  }
}

/**
 * Return the full calendar month containing the given date.
 */
export function currentMonth(date = new Date()) {
  const y = date.getFullYear()
  const m = date.getMonth()
  const start = new Date(y, m, 1)
  const end   = new Date(y, m, lastDayOfMonth(y, m))
  return {
    cycle: 'mensual',
    start: iso(start),
    end:   iso(end),
    label: `${MONTH_ES[m]} ${y}`,
  }
}

/**
 * Return the previous period for the given cycle (handy for "last paycheck" defaults).
 */
export function previousQuincena(date = new Date()) {
  const cur = currentQuincena(date)
  const [y, m, d] = cur.start.split('-').map(Number)
  // Go back one day from cur.start, then find that day's quincena
  const prev = new Date(y, m - 1, d - 1)
  return currentQuincena(prev)
}

export function previousMonth(date = new Date()) {
  const prev = new Date(date.getFullYear(), date.getMonth() - 1, 1)
  return currentMonth(prev)
}

/**
 * Dispatch by cycle string.
 */
export function currentPeriod(cycle = 'quincenal', date = new Date()) {
  return cycle === 'mensual' ? currentMonth(date) : currentQuincena(date)
}

export function previousPeriod(cycle = 'quincenal', date = new Date()) {
  return cycle === 'mensual' ? previousMonth(date) : previousQuincena(date)
}

/**
 * Compute the next pay date (the end of the current period + 1 day, or the 15th / end-of-month).
 */
export function nextPayDate(cycle = 'quincenal', fromDate = new Date()) {
  const period = currentPeriod(cycle, fromDate)
  const [y, m, d] = period.end.split('-').map(Number)
  const next = new Date(y, m - 1, d)
  return iso(next)
}

/**
 * Given a pay cycle, return how many periods per year (used by ISR annualization).
 */
export function periodsPerYear(cycle = 'quincenal') {
  return cycle === 'mensual' ? 12 : cycle === 'semanal' ? 52 : 24
}

/**
 * Prorate a monthly salary to a period amount.
 *   - mensual:   fullSalary
 *   - quincenal: fullSalary / 2
 *   - semanal:   fullSalary / 4 (approx)
 */
export function prorateSalary(monthlySalary, cycle = 'quincenal') {
  const s = Number(monthlySalary || 0)
  if (cycle === 'mensual')   return parseFloat(s.toFixed(2))
  if (cycle === 'semanal')   return parseFloat((s / 4).toFixed(2))
  return parseFloat((s / 2).toFixed(2))  // quincenal default
}
