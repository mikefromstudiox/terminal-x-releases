// dgii-ecf-xml-parser.js — Parse a DGII e-CF XML file into normalized
// comprobante row fields.
//
// Spec: DGII e-CF XSD (ECF-X.X.xsd). The schema is stable across types
// E31/E32/E33/E34/E43/E47 — same root <ECF> with <Encabezado>, <Totales>,
// <DetallesItems>, <FechaHoraFirma>, optionally <Anulado>.
//
// Returns: { ok, encabezado, totales, items, raw }

import { DOMParser } from '@xmldom/xmldom'

function txt(el, tag) {
  if (!el) return null
  const node = el.getElementsByTagName(tag)[0]
  return node ? (node.textContent || '').trim() : null
}
function num(s) {
  if (s == null || s === '') return 0
  const n = Number(String(s).replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}
function ddmmToIso(s) {
  if (!s) return null
  // DGII fechas come as dd-mm-yyyy or dd/mm/yyyy
  const m = String(s).match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
  // ISO already
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}

export function parseEcfXml(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') return { ok: false, error: 'empty input' }
  let doc
  try {
    doc = new DOMParser({
      errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} },
    }).parseFromString(xmlText, 'text/xml')
  } catch (e) { return { ok: false, error: `parse error: ${e?.message || e}` } }

  const root = doc.getElementsByTagName('ECF')[0] || doc.getElementsByTagName('RFCE')[0]
  if (!root) return { ok: false, error: 'no <ECF> or <RFCE> root element found' }

  const enc = root.getElementsByTagName('Encabezado')[0]
  const ident = enc?.getElementsByTagName('IdDoc')[0]
  const emi = enc?.getElementsByTagName('Emisor')[0]
  const comp = enc?.getElementsByTagName('Comprador')[0]
  const totales = root.getElementsByTagName('Totales')[0]
  const detItems = root.getElementsByTagName('DetallesItems')[0]

  const ncf = txt(ident, 'eNCF')
  const ecfType = ncf ? ncf.slice(0, 3) : null

  const ncfModificado = txt(ident, 'eNCFModificado')
  const fechaEmision = ddmmToIso(txt(ident, 'FechaEmision'))
  const fechaVencimiento = ddmmToIso(txt(ident, 'FechaVencimientoSecuencia'))

  const emisorRnc = txt(emi, 'RNCEmisor')
  const emisorRazonSocial = txt(emi, 'RazonSocialEmisor')
  const compradorRnc = txt(comp, 'RNCComprador') || txt(comp, 'IdentificadorExtranjero')
  const compradorRazonSocial = txt(comp, 'RazonSocialComprador')

  // Totales — DGII uses MontoTotal, MontoGravadoTotal, MontoExento, etc.
  const montoTotal = num(txt(totales, 'MontoTotal'))
  const itbis18 = num(txt(totales, 'TotalITBIS')) || num(txt(totales, 'TotalITBIS1'))
  const montoGravadoTotal = num(txt(totales, 'MontoGravadoTotal')) || num(txt(totales, 'MontoGravadoI1'))
  const montoExento = num(txt(totales, 'MontoExento'))
  const montoTotalDescuento = num(txt(totales, 'MontoTotalDescuento'))
  const totalISRRetencion = num(txt(totales, 'TotalISRRetencion'))
  const totalITBISRetencion = num(txt(totales, 'TotalITBISRetencion'))
  const propinaLegal = num(txt(totales, 'MontoPropinaLegal'))

  // Items
  const items = []
  if (detItems) {
    const itemNodes = detItems.getElementsByTagName('Item')
    for (let i = 0; i < itemNodes.length; i++) {
      const it = itemNodes[i]
      items.push({
        numero: num(txt(it, 'NumeroLinea')),
        descripcion: txt(it, 'NombreItem') || '',
        cantidad: num(txt(it, 'CantidadItem')),
        precio_unitario: num(txt(it, 'PrecioUnitarioItem')),
        monto_item: num(txt(it, 'MontoItem')),
        itbis_pct: num(txt(it, 'TasaITBIS')) || (itbis18 > 0 ? 18 : 0),
      })
    }
  }

  return {
    ok: true,
    encabezado: {
      ncf,
      ecf_type: ecfType,
      ncf_modificado: ncfModificado,
      fecha_emision: fechaEmision,
      fecha_vencimiento: fechaVencimiento,
      emisor_rnc: emisorRnc,
      emisor_razon_social: emisorRazonSocial,
      comprador_rnc: compradorRnc,
      comprador_razon_social: compradorRazonSocial,
    },
    totales: {
      monto_total: montoTotal,
      monto_gravado_total: montoGravadoTotal,
      monto_exento: montoExento,
      itbis_facturado: itbis18,
      itbis_retenido: totalITBISRetencion,
      isr_retenido: totalISRRetencion,
      monto_total_descuento: montoTotalDescuento,
      propina_legal: propinaLegal,
      // ITBIS rate inference: 18% by default, 16% if MontoGravadoI2 is present, 0% if all in MontoExento
      itbis_rate: itbis18 > 0
        ? (Math.abs(itbis18 / Math.max(montoGravadoTotal, 0.01) - 0.16) < 0.01 ? 16 : 18)
        : (montoExento > 0 ? -1 : 0),
    },
    items,
  }
}

/**
 * Flatten an e-CF parse result into a row suitable for accounting_comprobantes
 * insert (kind='compra' for received, 'venta' for emitted).
 */
export function ecfXmlToComprobanteRow(parsed, { kind = 'compra', accounting_client_id, accounting_client_supabase_id, period_year, period_month } = {}) {
  if (!parsed?.ok) return null
  const e = parsed.encabezado
  const t = parsed.totales
  // For COMPRA (received): rnc_contraparte = emisor (the supplier).
  // For VENTA (emitted):   rnc_contraparte = comprador (the customer).
  const rncContraparte = kind === 'compra' ? e.emisor_rnc : e.comprador_rnc
  const razonSocial    = kind === 'compra' ? e.emisor_razon_social : e.comprador_razon_social
  return {
    kind,
    accounting_client_id: accounting_client_id ?? null,
    accounting_client_supabase_id: accounting_client_supabase_id ?? null,
    period_year: period_year ?? (e.fecha_emision ? Number(e.fecha_emision.slice(0, 4)) : new Date().getFullYear()),
    period_month: period_month ?? (e.fecha_emision ? Number(e.fecha_emision.slice(5, 7)) : new Date().getMonth() + 1),
    ncf: e.ncf,
    ncf_modificado: e.ncf_modificado,
    fecha_comprobante: e.fecha_emision,
    rnc_contraparte: rncContraparte,
    razon_social: razonSocial,
    tipo_id: 'rnc',
    itbis_rate: t.itbis_rate,
    monto_facturado: t.monto_gravado_total || (t.monto_total - t.itbis_facturado),
    itbis_facturado: t.itbis_facturado,
    itbis_retenido: t.itbis_retenido,
    isr_retenido: t.isr_retenido,
    propina_legal: t.propina_legal,
    monto_total: t.monto_total,
    source: 'xml',
  }
}

export default { parseEcfXml, ecfXmlToComprobanteRow }
