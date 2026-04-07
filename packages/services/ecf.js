/**
 * e-CF Service — DGII Direct Integration
 *
 * Dominican Republic Ley 32-23 — mandatory e-CF effective May 15, 2026.
 * All fiscal comprobantes submitted directly to DGII (no intermediary).
 *
 * Desktop: XML built + signed + submitted in main process via IPC dgii:submit
 * Web: (future) via Supabase Edge Function dgii-submit
 */

// ── e-CF type definitions ──────────────────────────────────────────────────────
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
    desc_es: 'Sin FechaVencimientoSecuencia. Usa FechaLimitePago. Comprador requerido si total >RD$250K.',
    desc_en: 'No sequence expiry. Uses FechaLimitePago. Buyer required if total >RD$250K.',
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
    desc_es: 'InformacionReferencia (NCFModificado) dentro de Encabezado.',
    desc_en: 'InformacionReferencia (NCFModificado) inside Encabezado.',
    sub_es: 'Nota de Débito',
    sub_en: 'Debit Note',
    requiresReferencia: true,
    defaultEnabled: true,
  },
  E34: {
    code: 'E34',
    name_es: 'Nota de Crédito',
    name_en: 'Credit Note',
    desc_es: 'InformacionReferencia dentro de Encabezado. Tiene IndicadorNotaCredito.',
    desc_en: 'InformacionReferencia inside Encabezado. Has IndicadorNotaCredito field.',
    sub_es: 'Nota de Crédito',
    sub_en: 'Credit Note',
    requiresReferencia: true,
    defaultEnabled: true,
  },
  E41: {
    code: 'E41',
    name_es: 'Comprobante de Compra',
    name_en: 'Purchase Receipt',
    desc_es: 'Bloque Retencion en items. TotalITBISRetenido + TotalISRRetencion en Totales.',
    desc_en: 'Retencion block in items. TotalITBISRetenido + TotalISRRetencion in Totales.',
    sub_es: 'Comprobante Compra',
    sub_en: 'Purchase',
    hasRetenciones: true,
    defaultEnabled: false,
  },
  E43: {
    code: 'E43',
    name_es: 'Gastos Menores',
    name_en: 'Minor Expenses',
    desc_es: 'Sin Comprador ni items. Solo MontoExento y MontoTotal.',
    desc_en: 'No Comprador or items. Only MontoExento and MontoTotal.',
    sub_es: 'Gastos Menores',
    sub_en: 'Minor Expenses',
    noComprador: true,
    defaultEnabled: false,
  },
  E44: {
    code: 'E44',
    name_es: 'Regímenes Especiales',
    name_en: 'Special Regimes',
    desc_es: 'Sin IndicadorMontoGravado. Campos bancarios en IdDoc (TipoCuentaPago, NumeroCuentaPago, BancoPago).',
    desc_en: 'No IndicadorMontoGravado. Bank fields in IdDoc (TipoCuentaPago, NumeroCuentaPago, BancoPago).',
    sub_es: 'Reg. Especiales',
    sub_en: 'Special Regimes',
    noIndicadorMontoGravado: true,
    defaultEnabled: false,
  },
  E45: {
    code: 'E45',
    name_es: 'Gubernamental',
    name_en: 'Government',
    desc_es: 'Para ventas al gobierno. Incluye IndicadorMontoGravado y ValorPagar.',
    desc_en: 'For government entity sales. Includes IndicadorMontoGravado and ValorPagar.',
    sub_es: 'Gubernamental',
    sub_en: 'Government',
    defaultEnabled: false,
  },
  E46: {
    code: 'E46',
    name_es: 'Exportaciones',
    name_en: 'Exports',
    desc_es: 'ITBIS al 0% (I3). Sin Municipio/Provincia en Emisor. Tiene InformacionesAdicionales y Transporte.',
    desc_en: 'ITBIS at 0% (I3). No Municipio/Provincia in Emisor. Has InformacionesAdicionales and Transporte.',
    sub_es: 'Exportaciones',
    sub_en: 'Exports',
    itbisZero: true,
    defaultEnabled: false,
  },
  E47: {
    code: 'E47',
    name_es: 'Pagos al Exterior',
    name_en: 'Payments Abroad',
    desc_es: 'IdentificadorExtranjero en vez de RNCComprador. Bloque OtraMoneda.',
    desc_en: 'IdentificadorExtranjero instead of RNCComprador. OtraMoneda block.',
    sub_es: 'Pagos Exterior',
    sub_en: 'Foreign Payments',
    defaultEnabled: false,
  },
}

// Business type presets — which e-CF types are enabled by default
export const BUSINESS_TYPES = {
  carwash:       { es: 'Car Wash',            en: 'Car Wash',          enabled: ['E31','E32'] },
  restaurante:   { es: 'Restaurante',         en: 'Restaurant',        enabled: ['E31','E32','E43'] },
  tienda:        { es: 'Tienda / Retail',     en: 'Retail Store',      enabled: ['E31','E32'] },
  servicios:     { es: 'Servicios Generales', en: 'General Services',  enabled: ['E31','E32','E34'] },
  importador:    { es: 'Importador',          en: 'Importer',          enabled: ['E31','E32','E41','E34'] },
  exportador:    { es: 'Exportador',          en: 'Exporter',          enabled: ['E31','E32','E46','E34'] },
  gubernamental: { es: 'Gubernamental',       en: 'Government',        enabled: ['E45','E34'] },
  otro:          { es: 'Otro',               en: 'Other',             enabled: ['E31','E32'] },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Date format required by DGII — dd-mm-yyyy
export function formatDGIIDate(date = new Date()) {
  return [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    date.getFullYear(),
  ].join('-')
}

// Legacy alias
export const formatEF2Date = formatDGIIDate

// RNC validation — 9 digits (empresa) or 11 digits (cédula)
export function validateRNC(rnc) {
  const clean = String(rnc || '').replace(/[-\s]/g, '')
  return /^\d{9}$|^\d{11}$/.test(clean)
}

// Map payment method string to DGII TipoPago code
// 1=Efectivo, 2=Cheque/Transferencia/Depósito, 3=Tarjeta, 4=Crédito, 5=Permuta, 6=Nota de Crédito, 7=Mixto
function mapTipoPago(metodoPago) {
  const map = {
    efectivo: '1', cash: '1',
    cheque: '2', transferencia: '2', deposito: '2',
    tarjeta: '3',
    credito: '4', credito_cliente: '4',
    permuta: '5',
    nota_credito: '6',
    mixto: '7',
  }
  return map[(metodoPago || '').toLowerCase()] || '1'
}

// ── Reusable block builders ───────────────────────────────────────────────────

function buildEmisor(emisor, includeGeo = true) {
  return {
    RNCEmisor:         emisor.rnc              || '',
    RazonSocialEmisor: emisor.nombre           || '',
    NombreComercial:   emisor.nombreComercial  || emisor.nombre || '',
    DireccionEmisor:   emisor.direccion        || 'Santo Domingo',
    ...(includeGeo ? { Municipio: emisor.municipio || '010100', Provincia: emisor.provincia || '010000' } : {}),
    CorreoEmisor:      emisor.email            || '',
    FechaEmision:      formatDGIIDate(),
  }
}

function buildComprador(comprador) {
  if (!comprador?.rnc) return null
  return {
    RNCComprador:         comprador.rnc,
    RazonSocialComprador: comprador.nombre     || comprador.rnc,
    CorreoComprador:      comprador.email      || '',
    DireccionComprador:   comprador.direccion  || 'Santo Domingo',
    MunicipioComprador:   comprador.municipio  || '010100',
    ProvinciaComprador:   comprador.provincia  || '010000',
  }
}

// IndicadorFacturacion: '1'=18% ITBIS, '2'=16% ITBIS, '3'=0% export, '4'=exento
// IndicadorBienoServicio: '1'=bien, '2'=servicio, '3'=bien y servicio, '4'=otros
function buildItems(items) {
  return {
    Item: items.map((item, idx) => ({
      NumeroLinea:            String(idx + 1),
      IndicadorFacturacion:   item.indicadorFacturacion   || '1',
      NombreItem:             item.nombre,
      IndicadorBienoServicio: item.indicadorBienoServicio || '2',
      CantidadItem:           String(item.cantidad        || 1),
      UnidadMedida:           item.unidadMedida           || '43',
      PrecioUnitarioItem:     Number(item.precio).toFixed(2),
      MontoItem:              (Number(item.precio) * Number(item.cantidad || 1)).toFixed(2),
    })),
  }
}

// Standard 18% ITBIS totals
function buildTotales18(t) {
  return {
    MontoGravadoTotal: Number(t.subtotal).toFixed(2),
    MontoGravadoI1:    Number(t.subtotal).toFixed(2),
    ITBIS1:            '18',
    TotalITBIS:        Number(t.itbis).toFixed(2),
    TotalITBIS1:       Number(t.itbis).toFixed(2),
    MontoTotal:        Number(t.total).toFixed(2),
  }
}

// ── Payload builders per e-CF type ────────────────────────────────────────────

function buildE31(d) {
  const comprador = buildComprador(d.comprador)
  if (!comprador) throw new Error('E31 requiere RNC del comprador')
  return {
    ECF: {
      Encabezado: {
        Version: '1.0',
        IdDoc: {
          TipoeCF:                   '31',
          FechaVencimientoSecuencia: d.fechaVencimiento || '31-12-2028',
          IndicadorMontoGravado:     '0',
          TipoIngresos:              d.tipoIngresos || '01',
          TipoPago:                  mapTipoPago(d.metodoPago),
        },
        Emisor:    buildEmisor(d.emisor),
        Comprador: comprador,
        Totales:   buildTotales18(d.totales),
      },
      DetallesItems: buildItems(d.items),
    },
  }
}

function buildE32(d) {
  const comprador = buildComprador(d.comprador)
  const above250k = Number(d.totales?.total) >= 250000
  return {
    ECF: {
      Encabezado: {
        Version: '1.0',
        IdDoc: {
          TipoeCF:              '32',
          IndicadorMontoGravado: '0',
          TipoIngresos:          d.tipoIngresos || '01',
          TipoPago:              mapTipoPago(d.metodoPago),
          FechaLimitePago:       d.fechaLimitePago || formatDGIIDate(),
        },
        Emisor: buildEmisor(d.emisor),
        ...(above250k && comprador ? { Comprador: comprador } : {}),
        Totales: buildTotales18(d.totales),
      },
      DetallesItems: buildItems(d.items),
    },
  }
}

function buildE33(d) {
  if (!d.referencia?.ncfModificado) throw new Error('E33 requiere referencia.ncfModificado')
  return {
    ECF: {
      Encabezado: {
        Version: '1.0',
        IdDoc: {
          TipoeCF:      '33',
          TipoIngresos: d.tipoIngresos || '01',
          TipoPago:     mapTipoPago(d.metodoPago),
        },
        Emisor: buildEmisor(d.emisor),
        ...(buildComprador(d.comprador) ? { Comprador: buildComprador(d.comprador) } : {}),
        InformacionReferencia: {
          NCFModificado:      d.referencia.ncfModificado,
          RazonModificacion:  d.referencia.razonModificacion  || '',
          FechaNCFModificado: d.referencia.fechaNCFModificado || formatDGIIDate(),
          CodigoModificacion: d.referencia.codigoModificacion || '3',
        },
        Totales: buildTotales18(d.totales),
      },
      DetallesItems: buildItems(d.items || []),
    },
  }
}

function buildE34(d) {
  if (!d.referencia?.ncfModificado) throw new Error('E34 requiere referencia.ncfModificado')
  return {
    ECF: {
      Encabezado: {
        Version: '1.0',
        IdDoc: {
          TipoeCF:               '34',
          IndicadorNotaCredito:  '0',
          IndicadorMontoGravado: '0',
          TipoIngresos:          d.tipoIngresos || '01',
          TipoPago:              mapTipoPago(d.metodoPago),
        },
        Emisor: buildEmisor(d.emisor),
        ...(buildComprador(d.comprador) ? { Comprador: buildComprador(d.comprador) } : {}),
        InformacionReferencia: {
          NCFModificado:      d.referencia.ncfModificado,
          RazonModificacion:  d.referencia.razonModificacion  || '',
          FechaNCFModificado: d.referencia.fechaNCFModificado || formatDGIIDate(),
          CodigoModificacion: d.referencia.codigoModificacion || '3',
        },
        Totales: buildTotales18(d.totales),
      },
      DetallesItems: buildItems(d.items || []),
    },
  }
}

function buildE41(d) {
  const ret = d.retencion || {}
  return {
    ECF: {
      Encabezado: {
        Version: '1.0',
        IdDoc: {
          TipoeCF:                   '41',
          FechaVencimientoSecuencia: d.fechaVencimiento || '31-12-2028',
          IndicadorMontoGravado:     '0',
          TipoPago:                  mapTipoPago(d.metodoPago),
        },
        Totales: {
          TotalITBISRetenido: Number(ret.montoItbisRetenido || 0).toFixed(2),
          TotalISRRetencion:  Number(ret.montoIsrRetenido  || 0).toFixed(2),
          MontoTotal:         Number(d.totales.total).toFixed(2),
        },
      },
      DetallesItems: {
        Item: [{
          Retencion: {
            IndicadorAgenteRetencionoPercepcion: ret.indicador || '1',
            MontoITBISRetenido: Number(ret.montoItbisRetenido || 0).toFixed(2),
            MontoISRRetenido:   Number(ret.montoIsrRetenido  || 0).toFixed(2),
          },
        }],
      },
    },
  }
}

function buildE43(d) {
  return {
    ECF: {
      Encabezado: {
        Version: '1.0',
        IdDoc: {
          TipoeCF:                   '43',
          FechaVencimientoSecuencia: d.fechaVencimiento || '31-12-2028',
          TipoPago:                  mapTipoPago(d.metodoPago),
        },
        Totales: {
          MontoExento: Number(d.totales.total).toFixed(2),
          MontoTotal:  Number(d.totales.total).toFixed(2),
        },
      },
    },
  }
}

function buildE44(d) {
  const banco = d.banco || {}
  return {
    ECF: {
      Encabezado: {
        Version: '1.0',
        IdDoc: {
          TipoeCF:                   '44',
          FechaVencimientoSecuencia: d.fechaVencimiento || '31-12-2028',
          TipoIngresos:              d.tipoIngresos || '01',
          TipoPago:                  mapTipoPago(d.metodoPago),
          ...(banco.tipoCuenta    ? { TipoCuentaPago:   banco.tipoCuenta    } : {}),
          ...(banco.numeroCuenta  ? { NumeroCuentaPago: banco.numeroCuenta  } : {}),
          ...(banco.nombre        ? { BancoPago:        banco.nombre        } : {}),
        },
        Emisor: buildEmisor(d.emisor),
        ...(buildComprador(d.comprador) ? { Comprador: buildComprador(d.comprador) } : {}),
        Totales: {
          MontoExento: Number(d.totales.subtotal ?? d.totales.total).toFixed(2),
          MontoTotal:  Number(d.totales.total).toFixed(2),
          ValorPagar:  Number(d.totales.total).toFixed(2),
        },
      },
      DetallesItems: buildItems(d.items || []),
    },
  }
}

function buildE45(d) {
  const comprador = buildComprador(d.comprador)
  if (!comprador) throw new Error('E45 requiere RNC del comprador (entidad gubernamental)')
  return {
    ECF: {
      Encabezado: {
        Version: '1.0',
        IdDoc: {
          TipoeCF:                   '45',
          FechaVencimientoSecuencia: d.fechaVencimiento || '31-12-2028',
          IndicadorMontoGravado:     '0',
          TipoIngresos:              d.tipoIngresos || '01',
          TipoPago:                  mapTipoPago(d.metodoPago),
        },
        Emisor:    buildEmisor(d.emisor),
        Comprador: comprador,
        Totales: {
          ...buildTotales18(d.totales),
          ValorPagar: Number(d.totales.total).toFixed(2),
        },
      },
      DetallesItems: buildItems(d.items),
    },
  }
}

function buildE46(d) {
  const comprador  = buildComprador(d.comprador)
  const infAd      = d.informacionesAdicionales || {}
  const transporte = d.transporte || {}
  return {
    ECF: {
      Encabezado: {
        Version: '1.0',
        IdDoc: {
          TipoeCF:                   '46',
          FechaVencimientoSecuencia: d.fechaVencimiento || '31-12-2028',
          TipoIngresos:              d.tipoIngresos || '01',
          TipoPago:                  mapTipoPago(d.metodoPago),
          FechaLimitePago:           d.fechaLimitePago || formatDGIIDate(),
          ...(d.terminoPago ? { TerminoPago: d.terminoPago } : {}),
        },
        Emisor: buildEmisor(d.emisor, false),
        ...(comprador ? { Comprador: comprador } : {}),
        ...(Object.keys(infAd).length ? { InformacionesAdicionales: infAd } : {}),
        ...(transporte.numeroAlbaran ? { Transporte: { NumeroAlbaran: transporte.numeroAlbaran } } : {}),
        Totales: {
          MontoGravadoTotal: Number(d.totales.subtotal).toFixed(2),
          MontoGravadoI3:    Number(d.totales.subtotal).toFixed(2),
          ITBIS3:            '0',
          TotalITBIS:        '0.00',
          TotalITBIS3:       '0.00',
          MontoTotal:        Number(d.totales.total).toFixed(2),
        },
      },
      DetallesItems: buildItems(d.items),
    },
  }
}

function buildE47(d) {
  const extranjero = d.comprador || {}
  const otraMoneda = d.otraMoneda || {}
  return {
    ECF: {
      Encabezado: {
        Version: '1.0',
        IdDoc: {
          TipoeCF:                   '47',
          FechaVencimientoSecuencia: d.fechaVencimiento || '31-12-2028',
        },
        Comprador: {
          IdentificadorExtranjero: extranjero.identificadorExtranjero || extranjero.rnc || '',
          RazonSocialComprador:    extranjero.nombre || '',
        },
        Totales: {
          MontoExento:  Number(d.totales.total).toFixed(2),
          MontoTotal:   Number(d.totales.total).toFixed(2),
          ...(d.totales.totalIsrRetencion
            ? { TotalISRRetencion: Number(d.totales.totalIsrRetencion).toFixed(2) }
            : {}),
        },
        ...(otraMoneda.tipoMoneda ? {
          OtraMoneda: {
            TipoMoneda:            otraMoneda.tipoMoneda,
            TipoCambio:            String(otraMoneda.tipoCambio || '1.0000'),
            MontoExentoOtraMoneda: Number(otraMoneda.monto || 0).toFixed(2),
          },
        } : {}),
      },
    },
  }
}

// Route to the correct payload builder
export function buildECFPayload(d) {
  switch (String(d.tipoECF)) {
    case '31': return buildE31(d)
    case '32': return buildE32(d)
    case '33': return buildE33(d)
    case '34': return buildE34(d)
    case '41': return buildE41(d)
    case '43': return buildE43(d)
    case '44': return buildE44(d)
    case '45': return buildE45(d)
    case '46': return buildE46(d)
    case '47': return buildE47(d)
    default: throw new Error(`Tipo e-CF no soportado: ${d.tipoECF}`)
  }
}

// ── Stub (no certificate configured) ──────────────────────────────────────────

function generateENCF(ncfType, ticketId) {
  const seq = String((ticketId * 7919 + 10_000_000) % 90_000_000 + 10_000_000).slice(0, 8)
  return `${ncfType}${seq}`
}

function signAndSubmitECFStub(invoiceData) {
  const ncfType = invoiceData.ncfType ?? `E${invoiceData.tipoECF}`
  const ticketId = invoiceData.ticket?.id ?? Date.now()
  const eNCF = generateENCF(ncfType, ticketId)
  const totalAmt = invoiceData.totales?.total ?? invoiceData.total ?? 0

  return Promise.resolve({
    eNCF,
    status:      'ACEPTADO',
    trackId:     `stub-${Date.now()}`,
    submittedAt: new Date().toISOString(),
    xmlHash:     btoa(`${eNCF}:${totalAmt}`).slice(0, 32),
    qrLink:      null,
    pdfUrl:      null,
    _stub:       true,
  })
}

// ── Check if DGII direct is configured ───────────────────────────────────────

async function isDGIIConfigured(api) {
  const eApi = api?.dgii_ecf || window?.electronAPI?.dgii_ecf
  if (!eApi) return false
  try {
    const info = await eApi.certInfo()
    return info?.installed === true
  } catch {
    return false
  }
}

// ── DGII Direct submission ───────────────────────────────────────────────────

/**
 * signAndSubmitECF — submits an e-CF directly to DGII.
 *
 * On desktop: builds JSON payload, sends to main process via IPC dgii:submit
 * which handles XML generation, signing, authentication, and submission.
 *
 * On web (future): will send to Supabase Edge Function.
 *
 * Returns: { eNCF, status, trackId, submittedAt, qrLink, securityCode, signatureDate }
 */
export async function signAndSubmitECF(invoiceData, api) {
  // Check if DGII direct is available
  const dgiiApi = api?.dgii_ecf || window?.electronAPI?.dgii_ecf
  if (!dgiiApi) {
    return signAndSubmitECFStub(invoiceData)
  }

  // Check if certificate is installed
  let certInfo
  try {
    certInfo = await dgiiApi.certInfo()
  } catch {}

  if (!certInfo?.installed) {
    return signAndSubmitECFStub(invoiceData)
  }

  // Build the payload JSON
  const payload = buildECFPayload(invoiceData)

  // Send to main process for XML build + sign + submit
  const result = await dgiiApi.submit({
    payload,
    eNCF: invoiceData.eNCF,
    tipoECF: String(invoiceData.tipoECF),
    emisor: invoiceData.emisor,
    comprador: invoiceData.comprador,
    totales: invoiceData.totales,
    montoTotal: invoiceData.totales?.total,
    tipoIngresos: invoiceData.tipoIngresos || '01',
    tipoPago: mapTipoPago(invoiceData.metodoPago),
    fechaEmision: formatDGIIDate(),
    ticketId: invoiceData.ticket?.id,
  })

  return {
    eNCF:          result.eNCF,
    status:        result.status,
    trackId:       result.trackId,
    submittedAt:   result.submittedAt,
    securityCode:  result.securityCode,
    signatureDate: result.signatureDate,
    qrLink:        result.qrLink,
    dgiiCodigo:    result.dgiiCodigo,
    pdfUrl:        null,
  }
}

/**
 * testDGIIConnection — tests DGII authentication (seed dance).
 */
export async function testDGIIConnection(api) {
  const dgiiApi = api?.dgii_ecf || window?.electronAPI?.dgii_ecf
  if (!dgiiApi) throw new Error('DGII API no disponible')
  return dgiiApi.authTest()
}

/**
 * getQRCode — builds the DGII QR verification URL.
 * For direct DGII: the full consultatimbre URL with all parameters.
 * Returns both the verification URL (for QR) and a QR image URL.
 */
export function getQRCode(eNCF, ecfResult) {
  // If we have a full qrLink from DGII submission, use it
  if (ecfResult?.qrLink) {
    const verificationUrl = ecfResult.qrLink
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=128x128&margin=4&data=${encodeURIComponent(verificationUrl)}`
    return Promise.resolve({ qrUrl, verificationUrl })
  }

  // Fallback — basic URL
  const verificationUrl = `https://ecf.dgii.gov.do/ecf/ConsultaTimbre?ENCF=${encodeURIComponent(eNCF)}`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=128x128&margin=4&data=${encodeURIComponent(verificationUrl)}`
  return Promise.resolve({ qrUrl, verificationUrl })
}

/**
 * validateECF — checks the status of a submitted e-CF via DGII.
 */
export async function validateECF(trackId, api) {
  const dgiiApi = api?.dgii_ecf || window?.electronAPI?.dgii_ecf
  if (!dgiiApi) {
    return { valid: true, status: 'ACEPTADO', message: 'Verificación no disponible sin certificado.' }
  }
  try {
    const result = await dgiiApi.checkStatus(trackId)
    return {
      valid:      result.codigo === 1 || result.codigo === 4,
      status:     result.estado,
      message:    result.mensajes?.join('; ') || result.estado,
      acceptedAt: new Date().toISOString(),
    }
  } catch (err) {
    return { valid: false, status: 'ERROR', message: err.message }
  }
}

/** True if DGII direct is ready (cert installed) — checked async */
export const DGII_CONFIGURED = isDGIIConfigured()

/** @deprecated Use DGII_CONFIGURED */
export const EF2_CONFIGURED = false
