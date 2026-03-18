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
  E32: {
    code:    'E32',
    name_es: 'Consumidor Final Electrónico',
    name_en: 'Electronic Consumer Final',
    sub_es:  'Consumidor Final',
    sub_en:  'Consumer',
    replaces: 'B02',
  },
  E31: {
    code:    'E31',
    name_es: 'Crédito Fiscal Electrónico',
    name_en: 'Electronic Tax Credit',
    sub_es:  'Crédito Fiscal',
    sub_en:  'Tax Credit',
    replaces: 'B01',
  },
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
