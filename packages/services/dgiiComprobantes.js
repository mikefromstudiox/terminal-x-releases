// dgiiComprobantes.js — DGII 606/607/608/609 TXT generators built from
// accounting_comprobantes rows. Used by both per-firm Comprobantes screen and
// the contadora's Portfolio batch generator.
//
// Spec:
//   606 (Compras)   — DGII Norma General 06-23 layout
//   607 (Ventas)    — same family
//   608 (Anulados)  — short layout, motivo codes 1-10
//   609 (Pagos exterior) — 27% retención ISR
//
// All amounts pipe-delimited, fixed 2 decimal places, header line at top.

function fmtMoney(n) {
  return Number(n || 0).toFixed(2)
}
function pad(n, w) { return String(n).padStart(w, '0') }
function ymd(iso) { return iso ? String(iso).replace(/-/g, '') : '' }

export function gen606(rows, rncEmisor, year, month) {
  const rnc = (rncEmisor || '').replace(/\D/g, '')
  const period = `${year}${pad(month, 2)}`
  const lines = rows.map(r => [
    (r.rnc_contraparte || '').replace(/\D/g, ''),
    r.tipo_id === 'cedula' ? '2' : '1',
    String(r.tipo_bienes_servicios || 1).padStart(2, '0'),
    r.ncf || '',
    r.ncf_modificado || '',
    ymd(r.fecha_comprobante),
    ymd(r.fecha_pago),
    fmtMoney(r.monto_facturado),
    fmtMoney(r.itbis_facturado),
    fmtMoney(r.itbis_retenido),
    fmtMoney(r.itbis_proporcionalidad || 0),
    fmtMoney(r.itbis_llevado_al_costo || 0),
    fmtMoney(r.isr_retenido),
    fmtMoney(r.impuesto_selectivo),
    fmtMoney(r.otros_impuestos),
    fmtMoney(r.propina_legal),
    fmtMoney(r.monto_total || ((+r.monto_facturado || 0) + (+r.itbis_facturado || 0))),
  ].join('|'))
  return [`606|${rnc}|${period}|${rows.length}`, ...lines].join('\n') + '\n'
}

export function gen607(rows, rncEmisor, year, month) {
  const rnc = (rncEmisor || '').replace(/\D/g, '')
  const period = `${year}${pad(month, 2)}`
  const lines = rows.map(r => [
    (r.rnc_contraparte || '').replace(/\D/g, ''),
    r.tipo_id === 'cedula' ? '2' : '1',
    r.ncf || '',
    r.ncf_modificado || '',
    ymd(r.fecha_comprobante),
    fmtMoney(r.monto_facturado),
    fmtMoney(r.itbis_facturado),
    fmtMoney(r.itbis_retenido),
    fmtMoney(r.isr_retenido),
    fmtMoney(r.impuesto_selectivo),
    fmtMoney(r.otros_impuestos),
    fmtMoney(r.propina_legal),
    r.forma_pago || '01',
    fmtMoney(r.monto_total || ((+r.monto_facturado || 0) + (+r.itbis_facturado || 0))),
  ].join('|'))
  return [`607|${rnc}|${period}|${rows.length}`, ...lines].join('\n') + '\n'
}

export function gen608(rows, rncEmisor, year, month) {
  const rnc = (rncEmisor || '').replace(/\D/g, '')
  const period = `${year}${pad(month, 2)}`
  const lines = rows.map(r => [
    r.ncf || '',
    ymd(r.fecha_comprobante),
    r.motivo_anulacion || '01',
  ].join('|'))
  return [`608|${rnc}|${period}|${rows.length}`, ...lines].join('\n') + '\n'
}

// 609 — Pagos al exterior (servicios prestados desde el exterior).
// Each row should have: rnc/cedula contraparte (typically blank — exterior),
// pais, tipo_renta, monto_facturado, isr_retenido (27%).
export function gen609(rows, rncEmisor, year, month) {
  const rnc = (rncEmisor || '').replace(/\D/g, '')
  const period = `${year}${pad(month, 2)}`
  const lines = rows.map(r => [
    r.razon_social || '',
    r.pais_codigo || '999',                  // ISO numeric, 999 = otro
    r.tipo_renta || '01',                    // tipo de renta (servicios profesionales = 01, dividendos = 02, intereses = 03...)
    ymd(r.fecha_comprobante),
    ymd(r.fecha_pago),
    fmtMoney(r.monto_facturado),
    fmtMoney(r.isr_retenido),
  ].join('|'))
  return [`609|${rnc}|${period}|${rows.length}`, ...lines].join('\n') + '\n'
}

// IR-17 — Otras Retenciones (Mensual). DGII Norma 02-2011 / Instructivo IR-17.
// Cabecera: IR17|<RNC retenedor>|<YYYYMM>|<count>
// Detalle por línea:
//   1  Tipo ID            (1=RNC, 2=Cédula)
//   2  RNC/Cédula beneficiario
//   3  Tipo de renta      (01=alquileres, 02=honorarios servicios,
//                          03=dividendos, 04=intereses, 05=premios/loterías,
//                          06=remesas exterior, 07=transferencia bienes muebles,
//                          08=otras rentas)
//   4  Fecha del pago     (YYYYMMDD)
//   5  Monto base         (decimal 2)
//   6  Tasa retenida (%)  (decimal 2)
//   7  Monto retenido     (decimal 2)
//   8  NCF emitido        (si aplica — opcional)
const _IR17_TIPO_RENTA_MAP = {
  alquiler:           '01',
  alquileres:         '01',
  honorarios:         '02',
  servicios:          '02',
  servicios_no_dom:   '02',
  dividendos:         '03',
  intereses:          '04',
  premios:            '05',
  loterias:           '05',
  remesas:            '06',
  remesas_exterior:   '06',
  bienes_muebles:     '07',
  transferencia_bm:   '07',
  otros:              '08',
}
function _ir17TipoRenta(tipo) {
  if (!tipo) return '08'
  const k = String(tipo).toLowerCase().trim()
  if (_IR17_TIPO_RENTA_MAP[k]) return _IR17_TIPO_RENTA_MAP[k]
  if (/^\d{2}$/.test(k)) return k          // ya viene como código DGII
  return '08'
}

export function genIR17(rows, rncRetenedor, year, month) {
  const rnc = (rncRetenedor || '').replace(/\D/g, '')
  const period = `${year}${pad(month, 2)}`
  const list = (rows || []).filter(r => Number(r.retencion) > 0)
  const lines = list.map(r => {
    const idClean = String(r.beneficiario_rnc || r.beneficiario_cedula || '').replace(/\D/g, '')
    const tipoId = idClean.length === 11 ? '2' : '1'
    return [
      tipoId,
      idClean,
      _ir17TipoRenta(r.tipo),
      ymd(r.fecha),
      fmtMoney(r.base),
      fmtMoney(r.tasa),
      fmtMoney(r.retencion),
      r.ncf_emitido || '',
    ].join('|')
  })
  return [`IR17|${rnc}|${period}|${list.length}`, ...lines].join('\n') + '\n'
}

// IR-13 — Resumen Anual de Retenciones. Agrega las retenciones del año por
// beneficiario + tipo. Cabecera: IR13|<RNC retenedor>|<YYYY>|<count>
// Detalle por línea:
//   1  Tipo ID            (1=RNC, 2=Cédula)
//   2  RNC/Cédula beneficiario
//   3  Nombre beneficiario (uppercase, max 75)
//   4  Tipo retención     (mismos códigos IR-17)
//   5  Total base anual   (decimal 2)
//   6  Total retenido anual (decimal 2)
export function genIR13(rows, rncRetenedor, year) {
  const rnc = (rncRetenedor || '').replace(/\D/g, '')
  const list = (rows || []).filter(r => Number(r.retencion) > 0)
  // Agrupar por (idBeneficiario + tipoRenta).
  const groups = new Map()
  for (const r of list) {
    const idClean = String(r.beneficiario_rnc || r.beneficiario_cedula || '').replace(/\D/g, '')
    const tipo = _ir17TipoRenta(r.tipo)
    const key = `${idClean}|${tipo}`
    const cur = groups.get(key) || {
      idClean,
      tipo,
      tipoId: idClean.length === 11 ? '2' : '1',
      nombre: '',
      base: 0,
      retencion: 0,
    }
    cur.base      += Number(r.base) || 0
    cur.retencion += Number(r.retencion) || 0
    if (!cur.nombre && r.beneficiario_nombre) cur.nombre = String(r.beneficiario_nombre).toUpperCase().slice(0, 75)
    groups.set(key, cur)
  }
  const lines = Array.from(groups.values()).map(g => [
    g.tipoId,
    g.idClean,
    g.nombre,
    g.tipo,
    fmtMoney(g.base),
    fmtMoney(g.retencion),
  ].join('|'))
  return [`IR13|${rnc}|${year}|${groups.size}`, ...lines].join('\n') + '\n'
}

// ─── IT-1 Monthly ITBIS calculator (Norma 06-23 casillas) ────────────────
// Builds the monthly IT-1 declaration figures from accounting_comprobantes.
// Returns the casilla-by-casilla numbers a contadora copies into the DGII
// DET / Oficina Virtual interactive form. Not a TXT — an interactive form.
export function buildIt1Summary({ ventas = [], compras = [], anulados = [] } = {}) {
  const sum = (arr, field) => arr.reduce((a, r) => a + Number(r[field] || 0), 0)

  // VENTAS (output — contribuyente cobra)
  const totalVentas             = sum(ventas, 'monto_facturado')
  const itbisFacturado          = sum(ventas, 'itbis_facturado')
  const itbisRetenidoVentas     = sum(ventas, 'itbis_retenido') // retenciones que le hicieron a esta empresa al cobrar
  const propinaLegalVentas      = sum(ventas, 'propina_legal')

  // COMPRAS (input — contribuyente paga)
  const totalCompras            = sum(compras, 'monto_facturado')
  const itbisPagadoCompras      = sum(compras, 'itbis_facturado')         // ITBIS adelantado al comprar
  const itbisRetenidoCompras    = sum(compras, 'itbis_retenido')          // que esta empresa retuvo a sus proveedores
  const itbisProporcionalidad   = sum(compras, 'itbis_proporcionalidad')  // mixto (creditable parcial)
  const itbisLlevadoAlCosto     = sum(compras, 'itbis_llevado_al_costo')  // no deducible (no creditable)

  // ANULADOS reduce the ITBIS facturado base
  const itbisAnulados           = sum(anulados, 'itbis_facturado')

  // Cálculo del ITBIS a pagar / saldo a favor:
  const itbisDebito  = itbisFacturado - itbisAnulados   // ITBIS débito fiscal del mes
  const itbisCredito = itbisPagadoCompras - itbisLlevadoAlCosto + (itbisProporcionalidad * 0.5) // simplificado
  const itbisAPagar  = Math.max(0, itbisDebito - itbisCredito - itbisRetenidoVentas)
  const saldoFavor   = Math.max(0, (itbisCredito + itbisRetenidoVentas) - itbisDebito)

  return {
    casillas: {
      // I-1 Operaciones (Norma 06-23 columnas)
      'C1_TotalVentas':              round2(totalVentas),
      'C2_TotalCompras':             round2(totalCompras),
      // II ITBIS DEBITO
      'C3_ITBISFacturado':           round2(itbisFacturado),
      'C4_ITBISAnulados':            round2(itbisAnulados),
      'C5_ITBISDebitoFiscal':        round2(itbisDebito),
      // III ITBIS CREDITO
      'C6_ITBISPagadoCompras':       round2(itbisPagadoCompras),
      'C7_ITBISLlevadoAlCosto':      round2(itbisLlevadoAlCosto),
      'C8_ITBISProporcionalidad':    round2(itbisProporcionalidad),
      'C9_ITBISCreditoFiscal':       round2(itbisCredito),
      // IV RETENCIONES
      'C10_ITBISRetenidoVentas':     round2(itbisRetenidoVentas),
      'C11_ITBISRetenidoCompras':    round2(itbisRetenidoCompras),
      // V RESULTADO
      'C12_ITBISAPagar':             round2(itbisAPagar),
      'C13_SaldoAFavor':             round2(saldoFavor),
      // EXTRAS
      'PropinaLegalCobrada':         round2(propinaLegalVentas),
    },
    counts: { ventas: ventas.length, compras: compras.length, anulados: anulados.length },
  }
}

function round2(n) { return Math.round(Number(n || 0) * 100) / 100 }

export function filenameFor(formType, rnc, year, month) {
  const cleanRnc = String(rnc || '').replace(/\D/g, '')
  const ft = String(formType).toUpperCase()
  // IR-13 es anual: sin mes en el nombre.
  if (ft === 'IR13') return `DGII_FIR13_${cleanRnc}_${year}.txt`
  // IR-17 mensual: prefijo FIR para distinguir de F606/F607/F608/F609.
  if (ft === 'IR17') return `DGII_FIR17_${cleanRnc}_${year}${pad(month, 2)}.txt`
  const period = `${year}${pad(month, 2)}`
  return `DGII_F${formType}_${cleanRnc}_${period}.txt`
}

export default { gen606, gen607, gen608, gen609, genIR17, genIR13, filenameFor }
