// Anticipos ISR (PJ) — Dominican Republic.
//
// Código Tributario, Art. 314 (Ley 11-92 + reformas Ley 253-12 / Norma General
// 07-2014): toda persona jurídica con régimen ordinario está obligada a pagar
// 12 anticipos mensuales del Impuesto Sobre la Renta. La cuota se calcula
// usando el MAYOR de dos métodos basados en la declaración IR-2 del año fiscal
// anterior:
//
//   Método 1 — Tasa Efectiva de Tributación (TET):
//     anticipo_anual = ingresos_brutos_previos × 1.5%
//     anticipo_mensual = anticipo_anual / 12
//
//   Método 2 — ISR pagado del año anterior:
//     anticipo_anual = ISR_liquidado_año_anterior
//     anticipo_mensual = anticipo_anual / 12
//
// Regla práctica DGII: el contribuyente paga el MAYOR de los dos. Si el año
// anterior cerró en pérdida fiscal o no presentó IR-2 (primer año, sin
// operaciones, etc.), el anticipo es CERO — no hay obligación de pago aunque
// la obligación de presentación pueda subsistir.
//
// Los anticipos pagados son crédito fiscal contra el ISR del próximo IR-2.
//
// Esta función es pura (sin side-effects), tolerante a entradas no-numéricas
// y siempre devuelve montos no-negativos redondeados a 2 decimales.

const TASA_TET = 0.015 // 1.5% — Art. 314 lit. a)
const MESES = 12

function toNumber(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}
function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100 }

/**
 * Calcula el anticipo mensual de ISR para una Persona Jurídica.
 *
 * @param {object} args
 * @param {number} args.ingresosBrutosPrevios - Línea "Ingresos brutos" del IR-2 del año anterior (RD$).
 * @param {number} args.isrPrevioPagado - ISR liquidado del año anterior (RD$).
 * @param {boolean} args.hadLossPreviousYear - true si el año anterior cerró con pérdida fiscal.
 * @returns {{ method1: number, method2: number, anticipoMensual: number, methodChosen: 'method1'|'method2'|'none', anticipoAnual: number }}
 */
export function calcAnticipoMensual({
  ingresosBrutosPrevios = 0,
  isrPrevioPagado = 0,
  hadLossPreviousYear = false,
} = {}) {
  if (hadLossPreviousYear) {
    return { method1: 0, method2: 0, anticipoMensual: 0, methodChosen: 'none', anticipoAnual: 0 }
  }
  const ingresos = toNumber(ingresosBrutosPrevios)
  const isr = toNumber(isrPrevioPagado)

  const method1Anual = ingresos * TASA_TET
  const method2Anual = isr

  const method1 = round2(method1Anual / MESES)
  const method2 = round2(method2Anual / MESES)

  // Si ambos son cero (sin operaciones / primer año) no hay anticipo.
  if (method1 === 0 && method2 === 0) {
    return { method1: 0, method2: 0, anticipoMensual: 0, methodChosen: 'none', anticipoAnual: 0 }
  }
  const useM1 = method1 >= method2
  const anticipoMensual = useM1 ? method1 : method2
  const anticipoAnual = round2(anticipoMensual * MESES)
  return {
    method1,
    method2,
    anticipoMensual,
    methodChosen: useM1 ? 'method1' : 'method2',
    anticipoAnual,
  }
}

/**
 * Genera el calendario de 12 cuotas con vencimiento día 15 de cada mes
 * (mes posterior al período declarado). Coincide con la plantilla ANT-IR2 del
 * Calendario de Obligaciones (`packages/config/contabilidadCalendar.js`).
 *
 * @param {object} args
 * @param {number} args.year - Año fiscal del anticipo (los pagos comienzan en febrero).
 * @param {number} args.anticipoMensual - Cuota mensual ya calculada.
 * @returns {Array<{ period_month: number, due_date: string, amount: number }>}
 */
export function generateAnticipoSchedule({ year, anticipoMensual }) {
  const monto = round2(toNumber(anticipoMensual))
  const out = []
  for (let m = 1; m <= 12; m++) {
    let dueY = year, dueM = m + 1
    if (dueM > 12) { dueM = 1; dueY = year + 1 }
    out.push({
      period_month: m,
      due_date: `${dueY}-${String(dueM).padStart(2, '0')}-15`,
      amount: monto,
    })
  }
  return out
}

export const _internal = { TASA_TET, MESES, round2, toNumber }
