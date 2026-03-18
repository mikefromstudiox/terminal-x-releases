/**
 * e-CF Service — ef2.do API integration stub
 *
 * Under Dominican Republic Ley 32-23, all fiscal comprobantes must be
 * electronic (e-CF) effective May 15, 2026. Paper B01/B02 sequences
 * are replaced by E31/E32 electronic sequences.
 *
 * This module stubs the ef2.do API which handles:
 *   - XML invoice generation per DGII e-CF schema v1.0
 *   - PKCS#7 digital signature with the business certificate
 *   - Real-time DGII submission and acknowledgement
 *   - QR code generation for receipt verification
 *   - Validation and status tracking
 *
 * Replace the stub bodies below with real HTTP calls to ef2.do
 * once API credentials are configured in Settings → e-CF.
 *
 * ef2.do docs: https://ef2.do/docs/api
 */

// ── e-CF type definitions (replaces B01/B02) ──────────────────────────────────
export const ECF_TYPES = {
  E31: {
    code: 'E31',
    name_es: 'Factura de Crédito Fiscal',
    name_en: 'Tax Credit Invoice',
    desc_es: 'Para ventas a empresas con RNC. Requiere RNC del comprador.',
    desc_en: 'For B2B sales to companies with RNC. Buyer RNC required.',
    sub_es: 'Crédito Fiscal',
    sub_en: 'Tax Credit',
    replaces: 'B01',
    requiresRnc: true,
    defaultEnabled: true,
  },
  E32: {
    code: 'E32',
    name_es: 'Factura Consumidor Final',
    name_en: 'Consumer Final Invoice',
    desc_es: 'Ventas al consumidor. Sin FechaVencimientoSecuencia. Datos comprador requeridos si >RD$250K.',
    desc_en: 'Consumer sales. No sequence expiry date. Buyer data required if >RD$250K.',
    sub_es: 'Consumidor Final',
    sub_en: 'Consumer',
    replaces: 'B02',
    noVencimiento: true,
    requiresFechaLimitePago: true,
    requiresCompradorAbove250k: true,
    defaultEnabled: true,
  },
  E33: {
    code: 'E33',
    name_es: 'Nota de Débito',
    name_en: 'Debit Note',
    desc_es: 'Requiere InformacionReferencia con el eNCF original.',
    desc_en: 'Requires InformacionReferencia with original eNCF.',
    sub_es: 'Nota de Débito',
    sub_en: 'Debit Note',
    requiresReferencia: true,
    defaultEnabled: false,
  },
  E34: {
    code: 'E34',
    name_es: 'Nota de Crédito',
    name_en: 'Credit Note',
    desc_es: 'Requiere InformacionReferencia con el eNCF original.',
    desc_en: 'Requires InformacionReferencia with original eNCF.',
    sub_es: 'Nota de Crédito',
    sub_en: 'Credit Note',
    requiresReferencia: true,
    defaultEnabled: true,
  },
  E41: {
    code: 'E41',
    name_es: 'Comprobante de Compra',
    name_en: 'Purchase Receipt',
    desc_es: 'Incluye retención de ITBIS e ISR para compras a proveedores.',
    desc_en: 'Includes ITBIS and ISR retention fields for supplier purchases.',
    sub_es: 'Comprobante Compra',
    sub_en: 'Purchase',
    hasRetenciones: true,
    defaultEnabled: false,
  },
  E43: {
    code: 'E43',
    name_es: 'Gastos Menores',
    name_en: 'Minor Expenses',
    desc_es: 'Sin sección Comprador. Solo MontoExento y MontoTotal.',
    desc_en: 'No Comprador section. Only MontoExento and MontoTotal fields.',
    sub_es: 'Gastos Menores',
    sub_en: 'Minor Expenses',
    noComprador: true,
    defaultEnabled: false,
  },
  E44: {
    code: 'E44',
    name_es: 'Regímenes Especiales',
    name_en: 'Special Regimes',
    desc_es: 'Para operaciones bajo regímenes especiales de la DGII.',
    desc_en: 'For operations under DGII special regimes.',
    sub_es: 'Reg. Especiales',
    sub_en: 'Special Regimes',
    defaultEnabled: false,
  },
  E45: {
    code: 'E45',
    name_es: 'Gubernamental',
    name_en: 'Government',
    desc_es: 'Sin campo IndicadorMontoGravado. Para ventas al gobierno.',
    desc_en: 'No IndicadorMontoGravado field. For government entity sales.',
    sub_es: 'Gubernamental',
    sub_en: 'Government',
    noIndicadorMontoGravado: true,
    defaultEnabled: false,
  },
  E46: {
    code: 'E46',
    name_es: 'Exportaciones',
    name_en: 'Exports',
    desc_es: 'ITBIS al 0% para exportaciones de bienes y servicios.',
    desc_en: 'ITBIS at 0% for exports of goods and services.',
    sub_es: 'Exportaciones',
    sub_en: 'Exports',
    itbisZero: true,
    defaultEnabled: false,
  },
  E47: {
    code: 'E47',
    name_es: 'Pagos al Exterior',
    name_en: 'Payments Abroad',
    desc_es: 'Para pagos a proveedores o servicios en el exterior.',
    desc_en: 'For payments to foreign suppliers or services.',
    sub_es: 'Pagos Exterior',
    sub_en: 'Foreign Payments',
    defaultEnabled: false,
  },
}

// Business type presets — determines which e-CF types are enabled by default
export const BUSINESS_TYPES = {
  carwash:       { es: 'Car Wash',          en: 'Car Wash',          enabled: ['E31','E32'] },
  restaurante:   { es: 'Restaurante',       en: 'Restaurant',        enabled: ['E31','E32','E43'] },
  tienda:        { es: 'Tienda / Retail',   en: 'Retail Store',      enabled: ['E31','E32'] },
  servicios:     { es: 'Servicios Generales',en: 'General Services', enabled: ['E31','E32','E34'] },
  importador:    { es: 'Importador',        en: 'Importer',          enabled: ['E31','E32','E41','E34'] },
  exportador:    { es: 'Exportador',        en: 'Exporter',          enabled: ['E31','E32','E46','E34'] },
  gubernamental: { es: 'Gubernamental',     en: 'Government',        enabled: ['E45','E34'] },
  otro:          { es: 'Otro',              en: 'Other',             enabled: ['E31','E32'] },
}

// ── Internal helpers ──────────────────────────────────────────────────────────
function simulateDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Deterministic-looking eNCF sequence from ticket data
function generateENCF(ncfType, ticketId) {
  const seq = String((ticketId * 7919 + 10_000_000) % 90_000_000 + 10_000_000).slice(0, 8)
  return `${ncfType}${seq}`
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * signAndSubmitECF
 *
 * Builds the e-CF XML, signs it with the stored business certificate,
 * and submits to DGII via ef2.do. Returns the accepted eNCF and tracking info.
 *
 * Real implementation: POST https://api.ef2.do/v1/ecf/submit
 *
 * @param {object} invoiceData
 * @param {string}  invoiceData.ncfType      'E31' | 'E32'
 * @param {string}  invoiceData.rnc          Client RNC (required for E31)
 * @param {string}  invoiceData.rncName      Client company name
 * @param {string}  invoiceData.tipo         'contado' | 'credito'
 * @param {string}  invoiceData.formaPago    'cash' | 'card' | 'transfer' | 'cheque' | 'credit'
 * @param {number}  invoiceData.subtotal
 * @param {number}  invoiceData.itbis
 * @param {number}  invoiceData.ley
 * @param {number}  invoiceData.total
 * @param {object}  invoiceData.ticket       { id, ticketNo, vehicle, services[] }
 * @param {Date}    invoiceData.paidAt
 *
 * @returns {Promise<{eNCF, status, trackId, submittedAt, xmlHash}>}
 */
export async function signAndSubmitECF(invoiceData) {
  console.log('[e-CF] signAndSubmitECF →', invoiceData.ticket?.ticketNo, invoiceData.ncfType, invoiceData.total)

  // Stub: simulate ef2.do signing + DGII round-trip (~1.2 s)
  await simulateDelay(1200)

  const eNCF = generateENCF(invoiceData.ncfType, invoiceData.ticket?.id ?? Date.now())

  // Stub response — mirrors ef2.do response schema
  return {
    eNCF,
    status:      'ACEPTADO',
    trackId:     `ef2-${Date.now()}`,
    submittedAt: new Date().toISOString(),
    xmlHash:     btoa(`${eNCF}:${invoiceData.total}`).slice(0, 32),
  }

  /* Real implementation:
  const response = await fetch('https://api.ef2.do/v1/ecf/submit', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${EF2_API_KEY}` },
    body: JSON.stringify({
      ncf_type:    invoiceData.ncfType,
      rnc_emisor:  BUSINESS_RNC,          // from Settings
      rnc_receptor: invoiceData.rnc,
      fecha:       invoiceData.paidAt.toISOString(),
      subtotal:    invoiceData.subtotal,
      itbis:       invoiceData.itbis,
      total:       invoiceData.total,
      items:       invoiceData.ticket.services.map(s => ({ descripcion: s.name, valor: s.price })),
      forma_pago:  invoiceData.formaPago,
    }),
  })
  if (!response.ok) throw new Error(`ef2.do error: ${response.status}`)
  return response.json()
  */
}

/**
 * getQRCode
 *
 * Fetches the DGII verification QR code for the given e-NCF.
 * The QR encodes the official DGII verification URL so anyone can
 * scan and confirm the receipt is legitimate.
 *
 * Real implementation: GET https://api.ef2.do/v1/ecf/qr/{eNCF}
 *
 * @param   {string} eNCF  e.g. 'E3212345678'
 * @returns {Promise<{qrUrl, verificationUrl}>}
 */
export async function getQRCode(eNCF) {
  console.log('[e-CF] getQRCode →', eNCF)

  await simulateDelay(400)

  // DGII's official verification portal (test environment)
  const verificationUrl = `https://ecf.dgii.gov.do/testecf/consultatimbre?eNCF=${encodeURIComponent(eNCF)}`

  // Stub: use qrserver.com to generate a real scannable QR for demo.
  // Real implementation: ef2.do returns the QR as base64 in its response,
  // no separate call needed — the QR is in signAndSubmitECF's result.
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=128x128&margin=4&data=${encodeURIComponent(verificationUrl)}`

  return { qrUrl, verificationUrl }
}

/**
 * validateECF
 *
 * Queries DGII (via ef2.do) to confirm the e-CF was accepted and
 * retrieve its current status. Use this for post-issuance verification
 * or when a customer disputes a receipt.
 *
 * Real implementation: GET https://api.ef2.do/v1/ecf/validate/{eNCF}
 *
 * @param   {string} eNCF
 * @returns {Promise<{valid, status, message, acceptedAt}>}
 */
export async function validateECF(eNCF) {
  console.log('[e-CF] validateECF →', eNCF)

  await simulateDelay(800)

  return {
    valid:      true,
    status:     'ACEPTADO',
    message:    'Comprobante fiscal electrónico aceptado por la DGII.',
    acceptedAt: new Date().toISOString(),
  }

  /* Real implementation:
  const response = await fetch(`https://api.ef2.do/v1/ecf/validate/${eNCF}`, {
    headers: { 'Authorization': `Bearer ${EF2_API_KEY}` },
  })
  return response.json()
  */
}
