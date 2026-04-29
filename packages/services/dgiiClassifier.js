// dgiiClassifier.js — Auto-classifier for Norma 07-18 Tipo de Bienes y Servicios.
//
// DGII formato 606 column 3 = "Tipo de Bienes y Servicios" (codes 1-11).
// Each compra/gasto must be classified. Doing this manually for 100+ invoices
// per month per client kills the contadora's productivity.
//
// This classifier uses keyword + pattern heuristics over the supplier's razón
// social, NCF type, monto, and any free-text concepto/descripción. Confidence
// is reported so the UI can flag low-confidence rows for manual review.
//
// Categories (Norma 07-18 art. 6):
//   1  Gastos de Personal
//   2  Gastos por Trabajos, Suministros y Servicios
//   3  Arrendamientos
//   4  Gastos de Activos Fijos
//   5  Gastos de Representación
//   6  Gastos Financieros
//   7  Gastos de Seguros
//   8  Gastos por Regalías y Otros Intangibles
//   9  Gastos de Impuestos y Tasas
//   10 Gastos de Importación
//   11 Otros Gastos

const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// Keyword → category. Order matters — first match wins. Each entry is a
// regex evaluated against normalized text.
const RULES = [
  // 7 — Seguros (very specific, check first)
  { cat: 7, patterns: [/\b(seguro|aseguradora|seguros|poliza|polizas|asegurad)/, /\b(humano|mapfre|universal|banreservas seguros|atlantica)\b/] },

  // 6 — Gastos Financieros
  { cat: 6, patterns: [/\b(banco|interes|intereses|comision bancaria|prestamo|financiamiento|tarjeta de credito)/, /\b(bhd|popular|banreservas|scotiabank|bdi|bonanza|caribe|banco)\b/] },

  // 9 — Impuestos y Tasas
  { cat: 9, patterns: [/\b(dgii|impuesto|impuestos|tasa|tasas|alcaldia|ayuntamiento|registro civil|aduanas)/] },

  // 10 — Importación
  { cat: 10, patterns: [/\b(importacion|aduana|aduanas|naviera|despacho aduanero|maritima|cargo|naviero)/] },

  // 3 — Arrendamientos
  { cat: 3, patterns: [/\b(alquiler|arrendamiento|renta de|local comercial|inmueble|leasing)/] },

  // 4 — Activos Fijos
  { cat: 4, patterns: [/\b(equipo|mobiliario|maquinaria|vehiculo|computadora|laptop|impresora|servidor|aire acondicionado|generador)/, /\b(autocentro|automoviles|ferreteria industrial|maquinarias)/] },

  // 8 — Regalías / Intangibles / Software
  { cat: 8, patterns: [/\b(software|licencia|saas|suscripcion|hosting|dominio|adobe|microsoft|google workspace|zoom|slack|cloud)/, /\b(regalia|royalty|patente|marca registrada)/] },

  // 5 — Representación (comidas, eventos)
  { cat: 5, patterns: [/\b(restaurante|cafeteria|cafe|hotel|catering|evento|recepcion|gastos de representacion)/, /\b(starbucks|adrian tropical|conde de penalba|el conuco|el meson|peperoni|vesuvio)/] },

  // 1 — Personal (servicios de RR.HH., uniformes, capacitación)
  { cat: 1, patterns: [/\b(uniforme|capacitacion|entrenamiento|reclutamiento|recursos humanos|nomina|salario|honorarios empleado|prestacion social)/] },

  // 2 — Servicios / suministros (BIG bucket — comes second-to-last)
  { cat: 2, patterns: [/\b(servicio|servicios|suministro|suministros|mantenimiento|reparacion|limpieza|seguridad|consultoria|asesoria|honorarios|contabilidad|legal|abogado|publicidad|marketing|diseño|software como servicio)/, /\b(claro|altice|edesur|edenorte|edeeste|aaa|caasd|tricom|wind telecom|orange|viva|edeeste)/] },
]

/**
 * Classify a comprobante.
 * @param {{razon_social?:string, ncf?:string, ecf_type?:string, monto_facturado?:number, notes?:string, descripcion?:string}} row
 * @returns {{ tipo_bienes_servicios:number, confidence:number, reason:string }}
 */
export function classifyComprobante(row = {}) {
  const text = norm([row.razon_social, row.descripcion, row.notes].filter(Boolean).join(' '))
  if (!text) return { tipo_bienes_servicios: 11, confidence: 0.1, reason: 'sin descripción' }
  for (const rule of RULES) {
    for (const re of rule.patterns) {
      if (re.test(text)) {
        return {
          tipo_bienes_servicios: rule.cat,
          confidence: 0.85,
          reason: `match: ${re.source.slice(0, 40)}...`,
        }
      }
    }
  }
  // Default to "Otros gastos" with low confidence so the UI flags it for review.
  return { tipo_bienes_servicios: 11, confidence: 0.3, reason: 'sin coincidencia de patrón' }
}

/**
 * Classify a batch — returns rows with tipo_bienes_servicios + classification_*
 * fields populated. Existing manual classifications are preserved.
 */
export function classifyBatch(rows = []) {
  return rows.map(r => {
    if (r.tipo_bienes_servicios && r.classification_source !== 'pending') return r
    const { tipo_bienes_servicios, confidence, reason } = classifyComprobante(r)
    return {
      ...r,
      tipo_bienes_servicios,
      classification_source: r.classification_source === 'manual' ? 'manual' : 'rule',
      classification_confidence: confidence,
      classification_reason: reason,
    }
  })
}

export const CATEGORY_LABELS = {
  1:  'Gastos de Personal',
  2:  'Trabajos, Suministros y Servicios',
  3:  'Arrendamientos',
  4:  'Activos Fijos',
  5:  'Representación',
  6:  'Financieros',
  7:  'Seguros',
  8:  'Regalías e Intangibles',
  9:  'Impuestos y Tasas',
  10: 'Importación',
  11: 'Otros Gastos',
}

export default { classifyComprobante, classifyBatch, CATEGORY_LABELS }
