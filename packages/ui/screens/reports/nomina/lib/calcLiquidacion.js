/**
 * calcLiquidacion.js — Dominican labor-code (Ley 16-92) severance calculator.
 *
 * Extracted from the original PayrollReport.jsx. Pure functions, no UI.
 *
 *   - Art. 177-180: Vacaciones (paid vacation)
 *   - Art. 219:     Salario de Navidad (Christmas bonus, prorated)
 *   - Art. 76:      Preaviso (notice pay, desahucio only)
 *   - Art. 80:      Cesantía (severance pay, desahucio only)
 *
 * DAILY_DIVISOR = 23.83 — legal number of working days per month.
 */

export const DAILY_DIVISOR = 23.83

export function calcAntiguedad(startDate) {
  if (!startDate) return { years: 0, months: 0, days: 0, totalMonths: 0 }
  const start = new Date(startDate + 'T00:00:00')
  const now = new Date()
  let years = now.getFullYear() - start.getFullYear()
  let months = now.getMonth() - start.getMonth()
  let days = now.getDate() - start.getDate()
  if (days < 0) {
    months--
    const prev = new Date(now.getFullYear(), now.getMonth(), 0)
    days += prev.getDate()
  }
  if (months < 0) { years--; months += 12 }
  return {
    years,
    months,
    days,
    totalMonths: years * 12 + months + days / 30,
  }
}

export function calcVacaciones(monthlySalary, startDate) {
  const ant = calcAntiguedad(startDate)
  const dailyRate = monthlySalary / DAILY_DIVISOR
  // Art. 177: 14 days after 1st year, 18 days after 5 years
  let days = 0
  if (ant.years >= 5) days = 18
  else if (ant.years >= 1) days = 14
  else days = parseFloat(((14 / 12) * ant.totalMonths).toFixed(2))  // prorrata
  return { days, amount: parseFloat((days * dailyRate).toFixed(2)) }
}

export function calcSalarioNavidad(monthlySalary, startDate) {
  // Art. 219: 1/12 of annual salary, prorated by months worked in the current calendar year
  const start = new Date(startDate + 'T00:00:00')
  const now = new Date()
  const jan1 = new Date(now.getFullYear(), 0, 1)
  const effectiveStart = start > jan1 ? start : jan1
  const monthsWorked = (now.getMonth() - effectiveStart.getMonth()) + 1 + (now.getFullYear() - effectiveStart.getFullYear()) * 12
  const clamped = Math.max(0, Math.min(12, monthsWorked))
  return { amount: parseFloat(((monthlySalary * clamped) / 12).toFixed(2)) }
}

export function calcPreaviso(monthlySalary, totalMonths) {
  // Art. 76: 7 days (3-6mo), 14 days (6-12mo), 28 days (12mo+)
  const dailyRate = monthlySalary / DAILY_DIVISOR
  let days = 0
  if (totalMonths >= 12)    days = 28
  else if (totalMonths >= 6) days = 14
  else if (totalMonths >= 3) days = 7
  return { days, amount: parseFloat((days * dailyRate).toFixed(2)) }
}

export function calcCesantia(monthlySalary, totalMonths) {
  // Art. 80: 6/13/21 days per year rules
  const dailyRate = monthlySalary / DAILY_DIVISOR
  const fullYears = Math.floor(totalMonths / 12)
  const remainingMonths = totalMonths - fullYears * 12
  let days = 0
  if (totalMonths >= 3 && totalMonths < 6) days = 6
  else if (totalMonths >= 6 && totalMonths < 12) days = 13
  else if (fullYears >= 1 && fullYears < 5) {
    days = fullYears * 21
  } else if (fullYears >= 5) {
    days = 5 * 21 + (fullYears - 5) * 23
  }
  // Partial-year prorate at 15 days/year
  if (remainingMonths >= 3) {
    days += parseFloat(((15 / 12) * remainingMonths).toFixed(2))
  }
  return { days: parseFloat(days.toFixed(2)), amount: parseFloat((days * dailyRate).toFixed(2)) }
}

export function calcLiquidacion(emp, tipo, commissionTotal) {
  const startDate = emp.start_date
  if (!startDate) return null

  const ant = calcAntiguedad(startDate)

  // Commission-based workers: use average monthly commissions as base
  // when the employee has no fixed salary.
  let monthlySalary = emp.salary || 0
  let isCommissionBased = false
  const commissionTipos = ['lavador', 'vendedor', 'cajero']
  if (commissionTipos.includes(emp.tipo) && commissionTotal > 0 && ant.totalMonths > 0 && !emp.salary) {
    monthlySalary = parseFloat((commissionTotal / ant.totalMonths).toFixed(2))
    isCommissionBased = true
  }

  if (!monthlySalary) return null

  const vacaciones = calcVacaciones(monthlySalary, startDate)
  const navidad = calcSalarioNavidad(monthlySalary, startDate)
  const preaviso = tipo === 'desahucio' ? calcPreaviso(monthlySalary, ant.totalMonths) : { days: 0, amount: 0 }
  const cesantia = tipo === 'desahucio' ? calcCesantia(monthlySalary, ant.totalMonths) : { days: 0, amount: 0 }
  const total = vacaciones.amount + navidad.amount + preaviso.amount + cesantia.amount

  return {
    antiguedad: ant,
    monthlySalary,
    dailyRate: parseFloat((monthlySalary / DAILY_DIVISOR).toFixed(2)),
    vacaciones,
    navidad,
    preaviso,
    cesantia,
    total: parseFloat(total.toFixed(2)),
    isCommissionBased,
    commissionTotal: isCommissionBased ? commissionTotal : null,
  }
}
