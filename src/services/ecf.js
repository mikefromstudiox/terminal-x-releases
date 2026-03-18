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

// ── ef2.do config ─────────────────────────────────────────────────────────────
// BASE_URL is not used directly — all HTTP calls go through the main-process
// IPC bridge (window.electronAPI.ef2.fetch) to avoid Chromium CORS enforcement.
const EF2_USERNAME = import.meta.env.VITE_EF2_USERNAME || ''
const EF2_TOKEN    = import.meta.env.VITE_EF2_TOKEN    || ''

// IPC bridge to main process — no CORS, runs in Node.js
async function ef2Post(urlPath, body, token) {
  const api = window?.electronAPI?.ef2
  if (!api) throw new Error('ef2 IPC bridge not available')
  const res = await api.fetch({ method: 'POST', path: urlPath, body, token })
  if (!res.ok) throw new Error(res.error || `ef2 IPC error on ${urlPath}`)
  return res.data
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Date format required by ef2.do — dd-mm-yyyy
export function formatEF2Date(date = new Date()) {
  return [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    date.getFullYear(),
  ].join('-')
}

// RNC validation — 9 digits (empresa) or 11 digits (cédula)
export function validateRNC(rnc) {
  const clean = String(rnc || '').replace(/[-\s]/g, '')
  return /^\d{9}$|^\d{11}$/.test(clean)
}

// ── Stub helpers (used when EF2_TOKEN is not set) ─────────────────────────────
function simulateDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function generateENCF(ncfType, ticketId) {
  const seq = String((ticketId * 7919 + 10_000_000) % 90_000_000 + 10_000_000).slice(0, 8)
  return `${ncfType}${seq}`
}

async function signAndSubmitECFStub(invoiceData) {
  console.log('[e-CF STUB] signAndSubmitECF →', invoiceData.ticket?.ticketNo, invoiceData.ncfType ?? `E${invoiceData.tipoECF}`, invoiceData.totales?.total ?? invoiceData.total)
  await simulateDelay(1200)

  const ncfType = invoiceData.ncfType ?? `E${invoiceData.tipoECF}`
  const ticketId = invoiceData.ticket?.id ?? Date.now()
  const eNCF = generateENCF(ncfType, ticketId)
  const totalAmt = invoiceData.totales?.total ?? invoiceData.total ?? 0

  return {
    eNCF,
    status:      'ACEPTADO',
    trackId:     `ef2-stub-${Date.now()}`,
    submittedAt: new Date().toISOString(),
    xmlHash:     btoa(`${eNCF}:${totalAmt}`).slice(0, 32),
    qrLink:      null,
    pdfUrl:      null,
    _stub:       true,
  }
}

// ── Real ef2.do integration ───────────────────────────────────────────────────

/**
 * signAndSubmitECF
 *
 * If VITE_EF2_TOKEN is set, calls the real ef2.do API.
 * Otherwise falls back to the stub (app works without e-CF configured).
 *
 * Accepts EITHER:
 *   - New format: { tipoECF, emisor, comprador, totales, items, fechaVencimiento }
 *   - Legacy stub format: { ncfType, subtotal, itbis, total, ticket, ... }
 *
 * Returns: { eNCF, status, trackId, submittedAt, qrLink, pdfUrl }
 */
export async function signAndSubmitECF(invoiceData) {
  if (!EF2_TOKEN) {
    return signAndSubmitECFStub(invoiceData)
  }

  const {
    tipoECF,           // "31", "32", etc.
    emisor,            // { rnc, nombre, direccion, email }
    comprador,         // { rnc, nombre, email, direccion } — null for E32
    totales,           // { subtotal, itbis, total }
    items,             // [{ nombre, precio }]
    fechaVencimiento,  // "dd-mm-yyyy" or null
  } = invoiceData

  // Step 1 — Authenticate (via main-process IPC — no CORS)
  const auth = await ef2Post('/auth/login.php', { username: EF2_USERNAME, password: EF2_TOKEN })
  if (!auth?.success) throw new Error(`Error de autenticación ef2.do: ${auth?.message || 'credenciales inválidas'}`)

  // Step 2 — Build e-CF payload
  const isE31 = tipoECF === '31'
  const ecfType = ECF_TYPES[`E${tipoECF}`]

  const factura = {
    ECF: {
      Encabezado: {
        Version: '1.0',
        IdDoc: {
          TipoeCF: tipoECF,
          // E32 does NOT use FechaVencimientoSecuencia per DGII spec
          ...(fechaVencimiento && !ecfType?.noVencimiento
            ? { FechaVencimientoSecuencia: fechaVencimiento }
            : {}),
          IndicadorMontoGravado: '0',
          TipoIngresos:          '01',
          TipoPago:              '1',
        },
        Emisor: {
          RNCEmisor:         emisor.rnc        || '',
          RazonSocialEmisor: emisor.nombre     || '',
          NombreComercial:   emisor.nombre     || '',
          DireccionEmisor:   emisor.direccion  || 'Santo Domingo',
          Municipio:         '010100',
          Provincia:         '010000',
          CorreoEmisor:      emisor.email      || '',
          FechaEmision:      formatEF2Date(),
        },
        // Comprador block — required for E31, optional for E32 above RD$250K
        ...(comprador?.rnc ? {
          Comprador: {
            RNCComprador:        comprador.rnc,
            RazonSocialComprador: comprador.nombre     || comprador.rnc,
            CorreoComprador:     comprador.email       || '',
            DireccionComprador:  comprador.direccion   || 'Santo Domingo',
            MunicipioComprador:  '010100',
            ProvinciaComprador:  '010000',
          },
        } : {}),
        Totales: {
          MontoGravadoTotal: totales.subtotal.toFixed(2),
          MontoGravadoI1:    totales.subtotal.toFixed(2),
          ITBIS1:            '18',
          TotalITBIS:        totales.itbis.toFixed(2),
          TotalITBIS1:       totales.itbis.toFixed(2),
          MontoTotal:        totales.total.toFixed(2),
        },
      },
      DetallesItems: {
        Item: items.map((item, idx) => ({
          NumeroLinea:            String(idx + 1),
          IndicadorFacturacion:   '1',
          NombreItem:             item.nombre,
          IndicadorBienoServicio: '2',
          CantidadItem:           '1',
          UnidadMedida:           '43',
          PrecioUnitarioItem:     item.precio.toFixed(2),
          MontoItem:              item.precio.toFixed(2),
        })),
      },
    },
  }

  // Step 3 — Submit to ef2.do (via main-process IPC — no CORS)
  const result = await ef2Post('/procesar_factura.php', factura, EF2_TOKEN)

  // Step 4 — Parse response
  if (result?.success) {
    return {
      eNCF:        result.ncf,
      status:      result.estado        || 'ACEPTADO',
      trackId:     result.ncf,
      submittedAt: new Date().toISOString(),
      qrLink:      result.qr_link       || null,
      pdfUrl:      result.pdf_cloud_url || null,
    }
  } else {
    throw new Error(result?.message || 'Error al procesar comprobante en ef2.do')
  }
}

/**
 * testEF2Connection — calls auth endpoint to verify credentials.
 * Used by the Admin panel test button.
 */
export async function testEF2Connection() {
  if (!EF2_TOKEN) {
    throw new Error('Token no configurado — agrega VITE_EF2_TOKEN a .env')
  }
  const data = await ef2Post('/auth/login.php', { username: EF2_USERNAME, password: EF2_TOKEN })
  if (!data?.success) throw new Error(data?.message || 'Credenciales inválidas')
  return { ok: true }
}

/**
 * getQRCode — fallback QR generation used when ef2.do doesn't return qr_link.
 * With real API the QR comes directly in the response so this is rarely used.
 */
export async function getQRCode(eNCF) {
  console.log('[e-CF] getQRCode →', eNCF)
  await simulateDelay(400)
  const verificationUrl = `https://ecf.dgii.gov.do/testecf/consultatimbre?eNCF=${encodeURIComponent(eNCF)}`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=128x128&margin=4&data=${encodeURIComponent(verificationUrl)}`
  return { qrUrl, verificationUrl }
}

/**
 * validateECF — post-issuance verification stub.
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
}

/** True if the real API is configured (token present in env) */
export const EF2_CONFIGURED = Boolean(EF2_TOKEN)
