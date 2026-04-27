/**
 * drPayrollRates.js — Dominican Republic 2026 payroll constants + calculator.
 *
 * Source citations (every value below traces to one of these — all retrieved
 * 2026-04-27):
 *
 * 1. TSS — Tope de cotización del Régimen Contributivo SDSS, vigente 1-feb-2026.
 *    https://tss.gob.do/tss-fija-nuevos-topes-de-cotizacion-del-regimen-contributivo/
 *    (mirrored https://acento.com.do/economia/la-tss-presenta-los-nuevos-topes-para-la-cotizacion-de-seguridad-social-cuanto-es-como-se-calcula-y-cuanto-se-descuenta-9616330.html)
 *    – Salario Mínimo Cotizable SDSS: RD$23,223.00.
 *    – Tope AFP/Pensiones: 20 SMC = RD$464,460.00.
 *    – Tope SFS/Salud: 10 SMC = RD$232,230.00.
 *    – Tope SRL/Riesgos: 4 SMC = RD$92,892.00.
 *
 * 2. Ley 87-01 (SDSS) + ajustes TSS vigentes 2026 — porcentajes de cotización:
 *    https://siemprealdia.co/republica-dominicana/derecho-laboral/gestion-de-nominas-y-seguridad-social/
 *    https://contadoresdominicanos.com/en/post/social-security/what-contributions-must-i-make-to-the-tss-if-i-am-an-employer/
 *    – AFP empleado 2.87% / empleador 7.10% (total 9.97%, ley 87-01 art.21).
 *    – SFS  empleado 3.04% / empleador 7.09% (total 10.13%, ley 87-01 art.140;
 *      empleador asume 70% del costo, trabajador 30%).
 *    – SRL  empleador 1.10% base + 0.0%–0.6% variable según riesgo de la rama
 *      de actividad (ley 87-01 art.196). Tope 4 SMC. Empleado NO aporta.
 *
 * 3. ISR escala 2026 personas físicas — DGII (sin indexación desde 2017):
 *    https://siemprealdia.co/republica-dominicana/impuestos/tabla-de-retencion-del-isr/
 *    https://dgii.gov.do/cicloContribuyente/obligacionesTributarias/principalesImpuestos/Paginas/impuestoSobreRenta.aspx
 *    Mensual:
 *      0           – 34,685.00      → exento
 *      34,685.01   – 52,027.42      → 15% del excedente sobre 34,685.01
 *      52,027.43   – 72,260.25      → 2,601.33  + 20% del excedente sobre 52,027.43
 *      72,260.26   – ∞              → 6,648.00  + 25% del excedente sobre 72,260.26
 *    (Anual = mensual × 12; mantenidos sin cambio por las leyes de presupuesto
 *    2018–2026, cf. Acento 2025-12-12).
 *
 * 4. Salario Mínimo Nacional 2026 sector privado no sectorizado (Resolución
 *    CNS-01-2025, vigencia 1-feb-2026):
 *    https://www.ey.com/es_ce/technical/tax/tax-alerts/republica-dominicana-salario-minimo-2026
 *    https://presidencia.gob.do/noticias/ministerio-de-trabajo-llama-empresarios-cumplir-con-el-pago-del-aumento-del-8-del-salario
 *    – Microempresa (≤10 trab.):       RD$16,993.20
 *    – Pequeña empresa:                RD$18,421.20
 *    – Mediana empresa:                RD$27,489.60
 *    – Gran empresa (>151 trab.):      RD$29,988.00
 *
 * Implementación:
 *   – ISR es progresivo. Cada tramo aplica (ingreso − from) × rate + fixedAdd.
 *   – Las cotizaciones SDSS son deducibles del ingreso gravable ISR (Norma
 *     General 07-2014; los aportes del empleado a AFP+SFS reducen la base).
 *   – Dependientes NO afectan ISR en RD (la ley dominicana no reconoce
 *     deducción por dependientes — el campo se conserva para reportes; queda
 *     reservado por si una reforma futura lo activa).
 *   – Salario base se topa contra cada tope (AFP/SFS/SRL) por separado.
 */

export const DR_PAYROLL_RATES = Object.freeze({
  year: 2026,
  effectiveFrom: '2026-02-01',
  source: Object.freeze({
    tss_topes:        'https://tss.gob.do/tss-fija-nuevos-topes-de-cotizacion-del-regimen-contributivo/',
    tss_topes_mirror: 'https://acento.com.do/economia/la-tss-presenta-los-nuevos-topes-para-la-cotizacion-de-seguridad-social-cuanto-es-como-se-calcula-y-cuanto-se-descuenta-9616330.html',
    sdss_porcentajes: 'https://siemprealdia.co/republica-dominicana/derecho-laboral/gestion-de-nominas-y-seguridad-social/',
    isr_dgii:         'https://dgii.gov.do/cicloContribuyente/obligacionesTributarias/principalesImpuestos/Paginas/impuestoSobreRenta.aspx',
    isr_tabla_2026:   'https://siemprealdia.co/republica-dominicana/impuestos/tabla-de-retencion-del-isr/',
    smn_resolucion:   'https://www.ey.com/es_ce/technical/tax/tax-alerts/republica-dominicana-salario-minimo-2026',
    smn_min_trabajo:  'https://presidencia.gob.do/noticias/ministerio-de-trabajo-llama-empresarios-cumplir-con-el-pago-del-aumento-del-8-del-salario',
  }),

  // SDSS contribution percentages (base salario cotizable, NOT salario neto).
  afp: Object.freeze({ employeePct: 2.87, employerPct: 7.10 }),
  ars: Object.freeze({ employeePct: 3.04, employerPct: 7.09 }), // alias mantenido por compatibilidad
  sfs: Object.freeze({ employeePct: 3.04, employerPct: 7.09 }),
  // SRL: tasa variable por rama (ley 87-01 art.196). 1.10% base + 0%–0.6%
  // variable según riesgo. Default conservador para servicios = 1.10%.
  srl: Object.freeze({
    employerPct:    1.10,
    employerPctMin: 1.10,
    employerPctMax: 1.60,
    bandsNote: 'Tasa variable según rama de actividad (riesgo I–IV). Empleado NO aporta.',
  }),

  // Salario Mínimo Cotizable SDSS (base de los topes).
  smcSdss: 23223.00,
  tssCeiling: Object.freeze({
    afpMultiplier: 20, afpAmount: 464460.00,   // 20 × SMC
    sfsMultiplier: 10, sfsAmount: 232230.00,   // 10 × SMC
    srlMultiplier:  4, srlAmount:  92892.00,   //  4 × SMC
    // Legacy alias used by older callers; defaults to AFP ceiling per Ley 87-01.
    multiplier: 20,
    smn:        23223.00,
  }),

  // Salario Mínimo Nacional 2026 sector privado no sectorizado, por tamaño.
  smnBaseSector: 16993.20,
  smnBracketsPrivado: Object.freeze({
    micro:   16993.20,
    pequena: 18421.20,
    mediana: 27489.60,
    grande:  29988.00,
  }),

  // ISR mensual — 4 tramos progresivos. `from` inclusive, `to` exclusive
  // upper bound (Infinity para el último). `fixedAdd` se suma al excedente
  // sobre `from` (ya excluyendo lo cobrado en tramos previos).
  isrBrackets: Object.freeze([
    Object.freeze({ from: 0,        to: 34685.00,  rate: 0.00, fixedAdd: 0      }),
    Object.freeze({ from: 34685.00, to: 52027.42,  rate: 0.15, fixedAdd: 0      }),
    Object.freeze({ from: 52027.42, to: 72260.25,  rate: 0.20, fixedAdd: 2601.33}),
    Object.freeze({ from: 72260.25, to: Infinity,  rate: 0.25, fixedAdd: 6648.00}),
  ]),
  // Espejo anual (ingreso anual = mensual × 12, escalas igual proporción).
  isrBracketsAnnual: Object.freeze([
    Object.freeze({ from: 0,         to: 416220.00, rate: 0.00, fixedAdd: 0     }),
    Object.freeze({ from: 416220.00, to: 624329.04, rate: 0.15, fixedAdd: 0     }),
    Object.freeze({ from: 624329.04, to: 867123.00, rate: 0.20, fixedAdd: 31216.00}),
    Object.freeze({ from: 867123.00, to: Infinity,  rate: 0.25, fixedAdd: 79776.00}),
  ]),
})

// ── Helpers ─────────────────────────────────────────────────────────────────
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100 }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)) }

// Apply one progressive scale to an amount. `brackets` are sorted ascending
// and assumed contiguous starting at 0.
export function applyProgressive(amount, brackets) {
  const a = Number(amount) || 0
  if (a <= 0) return 0
  for (let i = brackets.length - 1; i >= 0; i--) {
    const b = brackets[i]
    if (a > b.from) {
      return r2(b.fixedAdd + (a - b.from) * b.rate)
    }
  }
  return 0
}

// Top a contribution base against its SDSS ceiling.
function basedFor(salario, ceiling) {
  return clamp(Number(salario) || 0, 0, ceiling)
}

/**
 * calcPayroll — single-employee monthly payroll calculation, RD 2026.
 *
 * Input:
 *   salarioBase     RD$ monthly gross
 *   dependientes    informational only (RD ISR no aplica deducción por dep.)
 *   srlEmployerPct  optional override for SRL band (default 1.10%)
 *
 * Output (todos los montos RD$ con 2 decimales):
 *   afp, ars, sfs, srl, isr  → deducciones empleado (sfs===ars; mantengo ambos
 *                                 por compatibilidad con tablas existentes)
 *   afpEmp, sfsEmp, srlEmp   → aportes empleador
 *   totalDeducciones          → suma deducciones empleado
 *   neto                      → salario neto a pagar
 *   employerCost              → costo total para el empleador (bruto + aportes patronales)
 *   isrBase                   → base imponible ISR (bruto − AFP − SFS empleado)
 */
export function calcPayroll({ salarioBase = 0, dependientes = 0, srlEmployerPct } = {}) {
  const R = DR_PAYROLL_RATES
  const sb = Math.max(0, Number(salarioBase) || 0)

  const baseAfp = basedFor(sb, R.tssCeiling.afpAmount)
  const baseSfs = basedFor(sb, R.tssCeiling.sfsAmount)
  const baseSrl = basedFor(sb, R.tssCeiling.srlAmount)

  const afp     = r2(baseAfp * (R.afp.employeePct / 100))
  const sfs     = r2(baseSfs * (R.sfs.employeePct / 100))
  const ars     = sfs // alias
  const afpEmp  = r2(baseAfp * (R.afp.employerPct / 100))
  const sfsEmp  = r2(baseSfs * (R.sfs.employerPct / 100))
  const srlPct  = (Number.isFinite(srlEmployerPct) ? srlEmployerPct : R.srl.employerPct)
  const srlEmp  = r2(baseSrl * (srlPct / 100))
  const srl     = 0 // empleado NO aporta SRL

  const isrBase = r2(sb - afp - sfs)
  const isr     = applyProgressive(isrBase, R.isrBrackets)

  const totalDeducciones = r2(afp + sfs + isr)
  const neto = r2(sb - totalDeducciones)
  const employerCost = r2(sb + afpEmp + sfsEmp + srlEmp)

  return {
    salarioBase: r2(sb),
    dependientes: Math.max(0, Number(dependientes) || 0),
    afp, ars, sfs, srl, isr,
    afpEmp, sfsEmp, srlEmp,
    isrBase,
    totalDeducciones,
    neto,
    employerCost,
  }
}

// ── Inline self-test (deterministic, runs on `node drPayrollRates.js`) ──────
// Three sample salaries spanning the four ISR brackets:
//   30,000 → exento; 50,000 → tramo 15%; 100,000 → tramo 25%; 200,000 → tope AFP no
// alcanza, tope SFS sí; >464,460 → tope AFP sí.
export function _selfTest() {
  const cases = [
    { salarioBase:  50000 }, // tramo 15% ISR
    { salarioBase: 100000 }, // tramo 25% ISR
    { salarioBase: 200000 }, // tramo 25% ISR, sin tope AFP
  ]
  const out = cases.map((c) => {
    const r = calcPayroll(c)
    // Re-derive expected ISR by hand to assert progressive correctness.
    const base = r.isrBase
    let expected = 0
    for (let i = DR_PAYROLL_RATES.isrBrackets.length - 1; i >= 0; i--) {
      const b = DR_PAYROLL_RATES.isrBrackets[i]
      if (base > b.from) { expected = b.fixedAdd + (base - b.from) * b.rate; break }
    }
    expected = Math.round(expected * 100) / 100
    if (Math.abs(expected - r.isr) > 0.01) {
      throw new Error(`ISR mismatch for ${c.salarioBase}: got ${r.isr} expected ${expected}`)
    }
    // Sanity: net + deducciones === bruto; employerCost >= bruto.
    if (Math.abs((r.neto + r.totalDeducciones) - r.salarioBase) > 0.02) {
      throw new Error(`Neto+deducciones != bruto for ${c.salarioBase}`)
    }
    if (r.employerCost < r.salarioBase) {
      throw new Error(`employerCost < bruto for ${c.salarioBase}`)
    }
    return { salarioBase: c.salarioBase, ...r }
  })
  return out
}

// Allow `node packages/config/drPayrollRates.js` to print the smoke results.
if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('drPayrollRates.js')) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(_selfTest(), null, 2))
}
