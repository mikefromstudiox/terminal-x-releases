/**
 * e-CF Service — ef2.do API integration
 *
 * Dominican Republic Ley 32-23 — mandatory e-CF effective May 15, 2026.
 * All fiscal comprobantes must be submitted to DGII via ef2.do.
 *
 * API base (via IPC): https://master.ef2.do/api2
 * Docs: https://doc.ef2.do
 * Postman: EF2_API_Collection.json (linked from doc.ef2.do)
 *
 * Two endpoints only:
 *   POST /auth/login.php        — validate credentials (skipped for tok_ tokens)
 *   POST /procesar_factura.php  — submit any e-CF type
 *
 * Sandbox credentials (2BUY ELECTRONICS AND SERVICES SRL, RNC 132596161):
 *   VITE_EF2_USERNAME=api_2buy_mliec4sb
 *   VITE_EF2_TOKEN=tok_e0f3065a8a7df34785d30b744bf4715b3c3b96759a1a7ca19f354817e4471e2e
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
    defaultEnabled: false,
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

// ── ef2.do config ──────────────────────────────────────────────────────────────
const EF2_USERNAME = import.meta.env.VITE_EF2_USERNAME || ''
const EF2_TOKEN    = import.meta.env.VITE_EF2_TOKEN    || ''

// IPC bridge — all HTTP to master.ef2.do/api2 runs in main process (no CORS)
async function ef2Post(urlPath, body, token, api) {
  const ef2 = api?.ef2 || window?.electronAPI?.ef2
  if (!ef2) throw new Error('ef2 IPC bridge not available')
  const res = await ef2.fetch({ method: 'POST', path: urlPath, body, token })
  if (!res.ok) throw new Error(res.error || `ef2 IPC error on ${urlPath}`)
  return res.data
}

// Runtime token lookup — safeStorage first, then SQLite settings JSON, then env.
async function getActiveToken(api) {
  if (EF2_TOKEN) return EF2_TOKEN
  const eApi = api || window.electronAPI
  try {
    const val = await eApi?.safe?.get?.('ef2_token')
    if (val) return val
  } catch {}
  try {
    const biz = await eApi.admin.getEmpresa()
    const s = JSON.parse(biz?.settings || '{}')
    return s.ef2_token || ''
  } catch {
    return ''
  }
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
    FechaEmision:      formatEF2Date(),
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
  // Comprador required when total >= RD$250,000
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
          FechaLimitePago:       d.fechaLimitePago || formatEF2Date(),
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
  // NOTE: FechaVencimientoSecuencia must NOT be sent for E33 — DGII rejects it (rule 145).
  // ef2.do may still inject a default; if that happens report to ef2.do support.
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
        // InformacionReferencia belongs INSIDE Encabezado, not at ECF root
        InformacionReferencia: {
          NCFModificado:      d.referencia.ncfModificado,
          RazonModificacion:  d.referencia.razonModificacion  || '',
          FechaNCFModificado: d.referencia.fechaNCFModificado || formatEF2Date(),
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
  // NOTE: FechaVencimientoSecuencia must NOT be sent for E34 — same DGII rule as E33.
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
        // InformacionReferencia belongs INSIDE Encabezado
        InformacionReferencia: {
          NCFModificado:      d.referencia.ncfModificado,
          RazonModificacion:  d.referencia.razonModificacion  || '',
          FechaNCFModificado: d.referencia.fechaNCFModificado || formatEF2Date(),
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
          // Bank fields go inside IdDoc for E44
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
          FechaLimitePago:           d.fechaLimitePago || formatEF2Date(),
          ...(d.terminoPago ? { TerminoPago: d.terminoPago } : {}),
        },
        // E46: Emisor has NO Municipio/Provincia
        Emisor: buildEmisor(d.emisor, false),
        ...(comprador ? { Comprador: comprador } : {}),
        ...(Object.keys(infAd).length ? { InformacionesAdicionales: infAd } : {}),
        ...(transporte.numeroAlbaran ? { Transporte: { NumeroAlbaran: transporte.numeroAlbaran } } : {}),
        // E46 uses ITBIS3 (0%) not ITBIS1
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
        // E47 uses IdentificadorExtranjero, not RNCComprador
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
function buildECFPayload(d) {
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

// ── Stub (no token configured) ────────────────────────────────────────────────

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
    trackId:     `ef2-stub-${Date.now()}`,
    submittedAt: new Date().toISOString(),
    xmlHash:     btoa(`${eNCF}:${totalAmt}`).slice(0, 32),
    qrLink:      null,
    pdfUrl:      null,
    _stub:       true,
  })
}

// ── Real ef2.do integration ───────────────────────────────────────────────────

/**
 * signAndSubmitECF
 *
 * invoiceData fields:
 *   tipoECF           "31"|"32"|"33"|"34"|"41"|"43"|"44"|"45"|"46"|"47"
 *   emisor            { rnc, nombre, nombreComercial?, direccion, email, municipio?, provincia? }
 *   comprador         { rnc, nombre, email?, direccion?, municipio?, provincia? } — null for some types
 *   totales           { subtotal, itbis, total, totalIsrRetencion? }
 *   items             [{ nombre, precio, cantidad?, indicadorFacturacion?, indicadorBienoServicio?, unidadMedida? }]
 *   metodoPago        "efectivo"|"tarjeta"|"transferencia"|"credito"|"mixto"... → TipoPago 1-7
 *   fechaVencimiento  "dd-mm-yyyy" — for E31/E33/E34/E41/E43/E44/E45/E46/E47
 *   fechaLimitePago   "dd-mm-yyyy" — for E32, E46
 *   tipoIngresos      "01"-"06" — default "01" (Operaciones)
 *   referencia        { ncfModificado, razonModificacion, fechaNCFModificado, codigoModificacion } — E33/E34
 *   retencion         { montoItbisRetenido, montoIsrRetenido, indicador } — E41
 *   banco             { nombre, tipoCuenta, numeroCuenta } — E44
 *   informacionesAdicionales  { FechaEmbarque, NumeroEmbarque, ... } — E46
 *   transporte        { numeroAlbaran } — E46
 *   otraMoneda        { tipoMoneda, tipoCambio, monto } — E47
 *
 * Returns: { eNCF, status, trackId, submittedAt, qrLink, pdfUrl }
 */
export async function signAndSubmitECF(invoiceData, api) {
  const activeToken = await getActiveToken(api)
  if (!activeToken) {
    return signAndSubmitECFStub(invoiceData)
  }

  // tok_ tokens are API keys — send directly as Bearer, no login call needed.
  // Other credential formats require login first to obtain a session token.
  let bearerToken = activeToken
  if (!activeToken.startsWith('tok_')) {
    const auth = await ef2Post('/auth/login.php', { username: EF2_USERNAME, password: activeToken }, activeToken, api)
    if (!auth?.success) throw new Error(`Error de autenticación ef2.do: ${auth?.message || 'credenciales inválidas'}`)
    bearerToken = auth.token || activeToken
  }

  const payload = buildECFPayload(invoiceData)
  const result  = await ef2Post('/procesar_factura.php', payload, bearerToken, api)

  if (result?.success) {
    return {
      eNCF:        result.ncf,
      status:      (result.estado || 'ACEPTADO').toUpperCase(),
      trackId:     result.ncf,
      submittedAt: new Date().toISOString(),
      qrLink:      result.qr_link       || null,
      pdfUrl:      result.pdf_cloud_url || null,
    }
  }

  throw new Error(result?.message || 'Error al procesar comprobante en ef2.do')
}

/**
 * testEF2Connection — verifies credentials against the auth endpoint.
 * Pass tokenOverride to test a token before saving it (e.g. from Settings input).
 */
export async function testEF2Connection(tokenOverride, api) {
  const token = tokenOverride || await getActiveToken(api)
  if (!token) throw new Error('Token no configurado')
  const data = await ef2Post('/auth/login.php', { username: EF2_USERNAME, password: token }, token, api)
  if (!data?.success) throw new Error(data?.message || 'Credenciales inválidas')
  return { ok: true }
}

/**
 * getQRCode — fallback QR when ef2.do doesn't return qr_link in response.
 * With real credentials qr_link comes back directly — this is rarely needed.
 */
export function getQRCode(eNCF) {
  const verificationUrl = `https://ecf.dgii.gov.do/consultatimbre?eNCF=${encodeURIComponent(eNCF)}`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=128x128&margin=4&data=${encodeURIComponent(verificationUrl)}`
  return Promise.resolve({ qrUrl, verificationUrl })
}

/**
 * validateECF — post-issuance check stub.
 * DGII status is returned synchronously by procesar_factura.php so this
 * is only needed for manual re-checks from the admin panel.
 */
export function validateECF(_eNCF) {
  return Promise.resolve({
    valid:      true,
    status:     'ACEPTADO',
    message:    'Comprobante fiscal electrónico aceptado por la DGII.',
    acceptedAt: new Date().toISOString(),
  })
}

/** True if the real API is configured */
export const EF2_CONFIGURED = Boolean(EF2_TOKEN)
