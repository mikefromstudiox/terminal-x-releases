/**
 * tss.js — Dominican Republic TSS (Tesorería de la Seguridad Social) calculator.
 *
 * Cotizations:
 *   - SFS (Seguro Familiar de Salud): 3.04% employee + 7.09% employer
 *   - AFP (Administradora de Fondos de Pensiones): 2.87% employee + 7.10% employer
 *   - INFOTEP: 1.00% employer-only (no cap)
 *
 * Cotization caps (2026):
 *   - SFS monthly cap: RD$232,230  (10× salario mínimo nacional)
 *   - AFP monthly cap: RD$464,460  (20× salario mínimo nacional)
 * Each fund is capped SEPARATELY, so a high earner's SFS base can be lower
 * than their AFP base. INFOTEP has NO cap and applies to full gross.
 *
 * All calculators accept an optional `settings` object with keys sourced
 * from the payroll_settings DB row. When settings are omitted, the 2026
 * defaults defined below are used.
 */

// ── 2026 defaults (editable via payroll_settings) ─────────────────────────────
export const SFS_MONTHLY_CAP      = 232230
export const AFP_MONTHLY_CAP      = 464460
export const SFS_EMPLOYEE_RATE    = 0.0304
export const AFP_EMPLOYEE_RATE    = 0.0287
export const SFS_EMPLOYER_RATE    = 0.0709
export const AFP_EMPLOYER_RATE    = 0.0710
export const INFOTEP_EMPLOYER_RATE = 0.01

// Back-compat: some callers may want the total employee/employer TSS rate.
export const TSS_EMPLOYEE_RATE_TOTAL = SFS_EMPLOYEE_RATE + AFP_EMPLOYEE_RATE
export const TSS_EMPLOYER_RATE_TOTAL = SFS_EMPLOYER_RATE + AFP_EMPLOYER_RATE

function round2(n) { return parseFloat(Number(n || 0).toFixed(2)) }

/**
 * Employee-side TSS withholding.
 * Applies SFS and AFP caps independently: Math.min(gross, cap) × rate.
 */
export function calcTSSEmployee(gross, settings = {}) {
  const g         = Number(gross || 0)
  const sfsCap    = Number(settings.sfs_monthly_cap ?? SFS_MONTHLY_CAP)
  const afpCap    = Number(settings.afp_monthly_cap ?? AFP_MONTHLY_CAP)
  const sfsRate   = Number(settings.sfs_employee_rate ?? SFS_EMPLOYEE_RATE)
  const afpRate   = Number(settings.afp_employee_rate ?? AFP_EMPLOYEE_RATE)
  const sfs = Math.min(g, sfsCap) * sfsRate
  const afp = Math.min(g, afpCap) * afpRate
  return { sfs: round2(sfs), afp: round2(afp), total: round2(sfs + afp) }
}

/**
 * Employer-side TSS liability (NOT withheld from the employee's paycheck).
 * Same caps apply.
 */
export function calcTSSEmployer(gross, settings = {}) {
  const g         = Number(gross || 0)
  const sfsCap    = Number(settings.sfs_monthly_cap ?? SFS_MONTHLY_CAP)
  const afpCap    = Number(settings.afp_monthly_cap ?? AFP_MONTHLY_CAP)
  const sfsRate   = Number(settings.sfs_employer_rate ?? SFS_EMPLOYER_RATE)
  const afpRate   = Number(settings.afp_employer_rate ?? AFP_EMPLOYER_RATE)
  const sfs = Math.min(g, sfsCap) * sfsRate
  const afp = Math.min(g, afpCap) * afpRate
  return { sfs: round2(sfs), afp: round2(afp), total: round2(sfs + afp) }
}

/**
 * INFOTEP: 1% on full gross, employer-paid, NO cap.
 */
export function calcINFOTEPEmployer(gross, rate) {
  const r = Number(rate ?? INFOTEP_EMPLOYER_RATE)
  return round2(Number(gross || 0) * r)
}

/**
 * Convenience wrapper: returns the full employer load (TSS + INFOTEP).
 * Used by the Pagos view and the TSS report.
 */
export function calcEmployerLoad(gross, settings = {}) {
  const tss     = calcTSSEmployer(gross, settings)
  const infotep = calcINFOTEPEmployer(gross, settings.infotep_employer_rate)
  return {
    sfs:          tss.sfs,
    afp:          tss.afp,
    tssTotal:     tss.total,
    infotep,
    totalEmployer: round2(tss.total + infotep),
  }
}
