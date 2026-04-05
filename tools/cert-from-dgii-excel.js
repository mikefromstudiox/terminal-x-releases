/**
 * cert-from-dgii-excel.js — PERSONAL REFERENCE (Studio X Tech RNC 133410321)
 *
 * Generates DGII-compliant XMLs directly from DGII's reference Excel (Step 2),
 * signs them, and submits via CerteCF API. Reads DGII's exact test data row-by-row
 * so the output mirrors what DGII itself expects.
 *
 * Use this when a client gets stuck on edge cases and you want to prove the
 * workflow against DGII's ground-truth Excel instead of generated templates.
 *
 * Paths below are HARDCODED to Michael's certification run — update CERT_PATH,
 * CERT_PASS, and EXCEL_PATH before running for a different RNC.
 *
 * For the reusable client-facing workflow, use tools/ecf-gen.js + ecf-submit.js.
 *
 * Usage: node tools/cert-from-dgii-excel.js
 */

const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')
const forge = require('node-forge')
const { Signature } = require('dgii-ecf')

const CERT_PATH = 'C:/Users/City/Downloads/20260323-2007011-PKY933N6B.p12'
const CERT_PASS = 'Monocotonia123'
const EXCEL_PATH = 'C:/Users/City/Downloads/133410321-23032026180108.xlsx'
const OUTPUT_DIR = path.join(__dirname, '../test-xmls/step2-dgii')

// ── Load certificate ────────────────────────────────────────────────────────

const raw = fs.readFileSync(CERT_PATH)
const p12Der = forge.util.decode64(raw.toString('base64'))
const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(p12Der), false, CERT_PASS)
const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
const cert = certBags[forge.pki.oids.certBag][0].cert
const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
const key = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0].key
const privateKeyPem = forge.pki.privateKeyToPem(key)
const certificatePem = forge.pki.certificateToPem(cert)
const signer = new Signature(privateKeyPem, certificatePem)

// ── Helpers ─────────────────────────────────────────────────────────────────

function v(row, field) {
  const val = row[field]
  if (val === undefined || val === null || val === '' || val === '#e') return null
  return String(val)
}

// DGII wants EXACT values from the Excel — pass through raw strings, never reformat
function num(row, field) {
  const val = v(row, field)
  if (!val) return null
  return String(val)
}
function numPrice(row, field) { return num(row, field) }
function numQty(row, field) { return num(row, field) }

function xml(tag, value) {
  if (value === null || value === undefined || value === '') return ''
  return `<${tag}>${escXml(String(value))}</${tag}>`
}

function escXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// ── Build ECF XML from a row ────────────────────────────────────────────────

function buildECFFromRow(row) {
  const tipo = v(row, 'TipoeCF')
  const encf = v(row, 'ENCF')

  let body = '<Encabezado>'

  // Version
  body += xml('Version', v(row, 'Version') || '1.0')

  // IdDoc
  body += '<IdDoc>'
  body += xml('TipoeCF', tipo)
  body += xml('eNCF', encf)
  if (v(row, 'FechaVencimientoSecuencia')) body += xml('FechaVencimientoSecuencia', v(row, 'FechaVencimientoSecuencia'))
  if (v(row, 'IndicadorNotaCredito')) body += xml('IndicadorNotaCredito', v(row, 'IndicadorNotaCredito'))
  if (v(row, 'IndicadorEnvioDiferido')) body += xml('IndicadorEnvioDiferido', v(row, 'IndicadorEnvioDiferido'))
  if (v(row, 'IndicadorMontoGravado')) body += xml('IndicadorMontoGravado', v(row, 'IndicadorMontoGravado'))
  if (v(row, 'TipoIngresos')) body += xml('TipoIngresos', v(row, 'TipoIngresos'))
  if (v(row, 'TipoPago')) body += xml('TipoPago', v(row, 'TipoPago'))
  if (v(row, 'FechaLimitePago')) body += xml('FechaLimitePago', v(row, 'FechaLimitePago'))
  if (v(row, 'TerminoPago')) body += xml('TerminoPago', v(row, 'TerminoPago'))

  // TablaFormasPago
  let hasFormas = false
  let formasXml = ''
  for (let i = 1; i <= 7; i++) {
    const forma = v(row, `FormaPago[${i}]`)
    const monto = num(row, `MontoPago[${i}]`)
    if (forma && monto) {
      formasXml += '<FormaDePago>'
      formasXml += xml('FormaPago', forma)
      formasXml += xml('MontoPago', monto)
      formasXml += '</FormaDePago>'
      hasFormas = true
    }
  }
  if (hasFormas) body += `<TablaFormasPago>${formasXml}</TablaFormasPago>`

  if (v(row, 'TipoCuentaPago')) body += xml('TipoCuentaPago', v(row, 'TipoCuentaPago'))
  if (v(row, 'NumeroCuentaPago')) body += xml('NumeroCuentaPago', v(row, 'NumeroCuentaPago'))
  if (v(row, 'BancoPago')) body += xml('BancoPago', v(row, 'BancoPago'))
  if (v(row, 'FechaDesde')) body += xml('FechaDesde', v(row, 'FechaDesde'))
  if (v(row, 'FechaHasta')) body += xml('FechaHasta', v(row, 'FechaHasta'))
  if (v(row, 'TotalPaginas')) body += xml('TotalPaginas', v(row, 'TotalPaginas'))
  body += '</IdDoc>'

  // Emisor (XSD order: RNCEmisor, RazonSocial, NombreComercial, Sucursal, Direccion, Municipio, Provincia, TablaTelefonoEmisor, Correo...)
  body += '<Emisor>'
  body += xml('RNCEmisor', v(row, 'RNCEmisor'))
  body += xml('RazonSocialEmisor', v(row, 'RazonSocialEmisor'))
  if (v(row, 'NombreComercial')) body += xml('NombreComercial', v(row, 'NombreComercial'))
  if (v(row, 'Sucursal')) body += xml('Sucursal', v(row, 'Sucursal'))
  body += xml('DireccionEmisor', v(row, 'DireccionEmisor'))
  if (v(row, 'Municipio')) body += xml('Municipio', v(row, 'Municipio'))
  if (v(row, 'Provincia')) body += xml('Provincia', v(row, 'Provincia'))
  // TelefonoEmisor must be wrapped in TablaTelefonoEmisor
  let hasTel = false
  let telXml = ''
  for (let i = 1; i <= 3; i++) {
    if (v(row, `TelefonoEmisor[${i}]`)) { telXml += xml('TelefonoEmisor', v(row, `TelefonoEmisor[${i}]`)); hasTel = true }
  }
  if (hasTel) body += `<TablaTelefonoEmisor>${telXml}</TablaTelefonoEmisor>`
  if (v(row, 'CorreoEmisor')) body += xml('CorreoEmisor', v(row, 'CorreoEmisor'))
  if (v(row, 'WebSite')) body += xml('WebSite', v(row, 'WebSite'))
  if (v(row, 'ActividadEconomica')) body += xml('ActividadEconomica', v(row, 'ActividadEconomica'))
  if (v(row, 'CodigoVendedor')) body += xml('CodigoVendedor', v(row, 'CodigoVendedor'))
  if (v(row, 'NumeroFacturaInterna')) body += xml('NumeroFacturaInterna', v(row, 'NumeroFacturaInterna'))
  if (v(row, 'NumeroPedidoInterno')) body += xml('NumeroPedidoInterno', v(row, 'NumeroPedidoInterno'))
  if (v(row, 'ZonaVenta')) body += xml('ZonaVenta', v(row, 'ZonaVenta'))
  if (v(row, 'RutaVenta')) body += xml('RutaVenta', v(row, 'RutaVenta'))
  if (v(row, 'InformacionAdicionalEmisor')) body += xml('InformacionAdicionalEmisor', v(row, 'InformacionAdicionalEmisor'))
  body += xml('FechaEmision', v(row, 'FechaEmision'))
  body += '</Emisor>'

  // Comprador
  const rncComp = v(row, 'RNCComprador')
  const idExtr = v(row, 'IdentificadorExtranjero')
  if (rncComp || idExtr) {
    body += '<Comprador>'
    if (rncComp) body += xml('RNCComprador', rncComp)
    if (idExtr) body += xml('IdentificadorExtranjero', idExtr)
    if (v(row, 'RazonSocialComprador')) body += xml('RazonSocialComprador', v(row, 'RazonSocialComprador'))
    if (v(row, 'ContactoComprador')) body += xml('ContactoComprador', v(row, 'ContactoComprador'))
    if (v(row, 'CorreoComprador')) body += xml('CorreoComprador', v(row, 'CorreoComprador'))
    if (v(row, 'DireccionComprador')) body += xml('DireccionComprador', v(row, 'DireccionComprador'))
    if (v(row, 'MunicipioComprador')) body += xml('MunicipioComprador', v(row, 'MunicipioComprador'))
    if (v(row, 'ProvinciaComprador')) body += xml('ProvinciaComprador', v(row, 'ProvinciaComprador'))
    if (v(row, 'PaisComprador')) body += xml('PaisComprador', v(row, 'PaisComprador'))
    if (v(row, 'FechaEntrega')) body += xml('FechaEntrega', v(row, 'FechaEntrega'))
    if (v(row, 'ContactoEntrega')) body += xml('ContactoEntrega', v(row, 'ContactoEntrega'))
    if (v(row, 'DireccionEntrega')) body += xml('DireccionEntrega', v(row, 'DireccionEntrega'))
    if (v(row, 'TelefonoAdicional')) body += xml('TelefonoAdicional', v(row, 'TelefonoAdicional'))
    if (v(row, 'FechaOrdenCompra')) body += xml('FechaOrdenCompra', v(row, 'FechaOrdenCompra'))
    if (v(row, 'NumeroOrdenCompra')) body += xml('NumeroOrdenCompra', v(row, 'NumeroOrdenCompra'))
    if (v(row, 'CodigoInternoComprador')) body += xml('CodigoInternoComprador', v(row, 'CodigoInternoComprador'))
    if (v(row, 'ResponsablePago')) body += xml('ResponsablePago', v(row, 'ResponsablePago'))
    if (v(row, 'InformacionAdicionalComprador')) body += xml('InformacionAdicionalComprador', v(row, 'InformacionAdicionalComprador'))
    body += '</Comprador>'
  }

  // InformacionesAdicionales (inside Encabezado, BEFORE Transporte per XSD)
  const hasInfoAd = v(row, 'FechaEmbarque') || num(row, 'PesoBruto')
  if (hasInfoAd) {
    body += '<InformacionesAdicionales>'
    if (v(row, 'FechaEmbarque')) body += xml('FechaEmbarque', v(row, 'FechaEmbarque'))
    if (v(row, 'NumeroEmbarque')) body += xml('NumeroEmbarque', v(row, 'NumeroEmbarque'))
    if (v(row, 'NumeroContenedor ')) body += xml('NumeroContenedor', v(row, 'NumeroContenedor '))
    if (v(row, 'NumeroReferencia')) body += xml('NumeroReferencia', v(row, 'NumeroReferencia'))
    if (num(row, 'PesoBruto')) body += xml('PesoBruto', num(row, 'PesoBruto'))
    if (num(row, 'PesoNeto')) body += xml('PesoNeto', num(row, 'PesoNeto'))
    if (v(row, 'UnidadPesoBruto')) body += xml('UnidadPesoBruto', v(row, 'UnidadPesoBruto'))
    if (v(row, 'UnidadPesoNeto')) body += xml('UnidadPesoNeto', v(row, 'UnidadPesoNeto'))
    if (num(row, 'CantidadBulto')) body += xml('CantidadBulto', num(row, 'CantidadBulto'))
    if (v(row, 'UnidadBulto')) body += xml('UnidadBulto', v(row, 'UnidadBulto'))
    if (num(row, 'VolumenBulto')) body += xml('VolumenBulto', num(row, 'VolumenBulto'))
    if (v(row, 'UnidadVolumen')) body += xml('UnidadVolumen', v(row, 'UnidadVolumen'))
    body += '</InformacionesAdicionales>'
  }

  // Transporte (inside Encabezado, AFTER InformacionesAdicionales)
  // XSD: Conductor, DocumentoTransporte, Ficha, Placa, RutaTransporte, ZonaTransporte, NumeroAlbaran ONLY
  // PesoBruto etc go in InformacionesAdicionales
  if (v(row, 'Conductor') || v(row, 'NumeroAlbaran')) {
    body += '<Transporte>'
    if (v(row, 'Conductor')) body += xml('Conductor', v(row, 'Conductor'))
    if (v(row, 'DocumentoTransporte')) body += xml('DocumentoTransporte', v(row, 'DocumentoTransporte'))
    if (v(row, 'Ficha')) body += xml('Ficha', v(row, 'Ficha'))
    if (v(row, 'Placa')) body += xml('Placa', v(row, 'Placa'))
    if (v(row, 'RutaTransporte')) body += xml('RutaTransporte', v(row, 'RutaTransporte'))
    if (v(row, 'ZonaTransporte')) body += xml('ZonaTransporte', v(row, 'ZonaTransporte'))
    if (v(row, 'NumeroAlbaran')) body += xml('NumeroAlbaran', v(row, 'NumeroAlbaran'))
    body += '</Transporte>'
  }

  // Totales (XSD order: MontoGravado*, MontoExento, ITBIS*, TotalITBIS*, MontoTotal, MontoNoFact, MontoPeriodo, SaldoAnterior, MontoAvance, ValorPagar, THEN TotalITBISRetenido, TotalISRRetencion)
  body += '<Totales>'
  if (num(row, 'MontoGravadoTotal')) body += xml('MontoGravadoTotal', num(row, 'MontoGravadoTotal'))
  if (num(row, 'MontoGravadoI1')) body += xml('MontoGravadoI1', num(row, 'MontoGravadoI1'))
  if (num(row, 'MontoGravadoI2')) body += xml('MontoGravadoI2', num(row, 'MontoGravadoI2'))
  if (num(row, 'MontoGravadoI3')) body += xml('MontoGravadoI3', num(row, 'MontoGravadoI3'))
  if (num(row, 'MontoExento')) body += xml('MontoExento', num(row, 'MontoExento'))
  if (v(row, 'ITBIS1')) body += xml('ITBIS1', v(row, 'ITBIS1'))
  if (v(row, 'ITBIS2')) body += xml('ITBIS2', v(row, 'ITBIS2'))
  if (v(row, 'ITBIS3')) body += xml('ITBIS3', v(row, 'ITBIS3'))
  if (num(row, 'TotalITBIS')) body += xml('TotalITBIS', num(row, 'TotalITBIS'))
  if (num(row, 'TotalITBIS1')) body += xml('TotalITBIS1', num(row, 'TotalITBIS1'))
  if (num(row, 'TotalITBIS2')) body += xml('TotalITBIS2', num(row, 'TotalITBIS2'))
  if (num(row, 'TotalITBIS3')) body += xml('TotalITBIS3', num(row, 'TotalITBIS3'))
  if (num(row, 'MontoTotal')) body += xml('MontoTotal', num(row, 'MontoTotal'))
  if (num(row, 'MontoNoFacturable')) body += xml('MontoNoFacturable', num(row, 'MontoNoFacturable'))
  if (num(row, 'MontoPeriodo')) body += xml('MontoPeriodo', num(row, 'MontoPeriodo'))
  if (num(row, 'ValorPagar')) body += xml('ValorPagar', num(row, 'ValorPagar'))
  if (num(row, 'TotalITBISRetenido')) body += xml('TotalITBISRetenido', num(row, 'TotalITBISRetenido'))
  if (num(row, 'TotalISRRetencion')) body += xml('TotalISRRetencion', num(row, 'TotalISRRetencion'))
  body += '</Totales>'

  // OtraMoneda (E47)
  if (v(row, 'TipoMoneda')) {
    body += '<OtraMoneda>'
    body += xml('TipoMoneda', v(row, 'TipoMoneda'))
    if (num(row, 'TipoCambio')) body += xml('TipoCambio', num(row, 'TipoCambio'))
    if (num(row, 'MontoGravadoTotalOtraMoneda')) body += xml('MontoGravadoTotalOtraMoneda', num(row, 'MontoGravadoTotalOtraMoneda'))
    if (num(row, 'MontoExentoOtraMoneda')) body += xml('MontoExentoOtraMoneda', num(row, 'MontoExentoOtraMoneda'))
    if (num(row, 'TotalITBISOtraMoneda')) body += xml('TotalITBISOtraMoneda', num(row, 'TotalITBISOtraMoneda'))
    if (num(row, 'MontoTotalOtraMoneda')) body += xml('MontoTotalOtraMoneda', num(row, 'MontoTotalOtraMoneda'))
    body += '</OtraMoneda>'
  }

  body += '</Encabezado>'

  // DetallesItems
  let hasItems = false
  let itemsXml = ''
  for (let i = 1; i <= 20; i++) {
    if (!v(row, `NumeroLinea[${i}]`)) break
    hasItems = true
    itemsXml += '<Item>'
    // Item XSD order: NumeroLinea, TablaCodigosItem, IndicadorFacturacion, Retencion, NombreItem,
    // IndicadorBienoServicio, DescripcionItem, CantidadItem, UnidadMedida, ..., FechaElaboracion,
    // FechaVencimientoItem, ..., PrecioUnitarioItem, DescuentoMonto, TablaSubDescuento, ..., OtraMonedaDetalle, MontoItem
    itemsXml += xml('NumeroLinea', v(row, `NumeroLinea[${i}]`))

    // TablaCodigosItem
    if (v(row, `TipoCodigo[${i}][1]`)) {
      itemsXml += '<TablaCodigosItem><CodigosItem>'
      itemsXml += xml('TipoCodigo', v(row, `TipoCodigo[${i}][1]`))
      itemsXml += xml('CodigoItem', v(row, `CodigoItem[${i}][1]`))
      itemsXml += '</CodigosItem></TablaCodigosItem>'
    }

    if (v(row, `IndicadorFacturacion[${i}]`)) itemsXml += xml('IndicadorFacturacion', v(row, `IndicadorFacturacion[${i}]`))

    // Retencion (E41) — comes BEFORE NombreItem per XSD
    if (v(row, `IndicadorAgenteRetencionoPercepcion[${i}]`)) {
      itemsXml += '<Retencion>'
      itemsXml += xml('IndicadorAgenteRetencionoPercepcion', v(row, `IndicadorAgenteRetencionoPercepcion[${i}]`))
      if (num(row, `MontoITBISRetenido[${i}]`)) itemsXml += xml('MontoITBISRetenido', num(row, `MontoITBISRetenido[${i}]`))
      if (num(row, `MontoISRRetenido[${i}]`)) itemsXml += xml('MontoISRRetenido', num(row, `MontoISRRetenido[${i}]`))
      itemsXml += '</Retencion>'
    }

    itemsXml += xml('NombreItem', v(row, `NombreItem[${i}]`))
    if (v(row, `IndicadorBienoServicio[${i}]`)) itemsXml += xml('IndicadorBienoServicio', v(row, `IndicadorBienoServicio[${i}]`))
    if (v(row, `DescripcionItem[${i}]`)) itemsXml += xml('DescripcionItem', v(row, `DescripcionItem[${i}]`))
    itemsXml += xml('CantidadItem', numQty(row, `CantidadItem[${i}]`))
    if (v(row, `UnidadMedida[${i}]`)) itemsXml += xml('UnidadMedida', v(row, `UnidadMedida[${i}]`))
    if (v(row, `FechaElaboracion[${i}]`)) itemsXml += xml('FechaElaboracion', v(row, `FechaElaboracion[${i}]`))
    if (v(row, `FechaVencimientoItem[${i}]`)) itemsXml += xml('FechaVencimientoItem', v(row, `FechaVencimientoItem[${i}]`))
    itemsXml += xml('PrecioUnitarioItem', numPrice(row, `PrecioUnitarioItem[${i}]`))

    // DescuentoMonto + TablaSubDescuento
    if (num(row, `DescuentoMonto[${i}]`)) itemsXml += xml('DescuentoMonto', num(row, `DescuentoMonto[${i}]`))
    if (v(row, `TipoSubDescuento[${i}][1]`)) {
      itemsXml += '<TablaSubDescuento><SubDescuento>'
      itemsXml += xml('TipoSubDescuento', v(row, `TipoSubDescuento[${i}][1]`))
      if (v(row, `SubDescuentoPorcentaje[${i}][1]`)) itemsXml += xml('SubDescuentoPorcentaje', num(row, `SubDescuentoPorcentaje[${i}][1]`))
      itemsXml += xml('MontoSubDescuento', num(row, `MontoSubDescuento[${i}][1]`))
      itemsXml += '</SubDescuento></TablaSubDescuento>'
    }

    // OtraMonedaDetalle
    if (num(row, `PrecioOtraMoneda[${i}]`)) {
      itemsXml += '<OtraMonedaDetalle>'
      itemsXml += xml('PrecioOtraMoneda', num(row, `PrecioOtraMoneda[${i}]`))
      itemsXml += xml('MontoItemOtraMoneda', num(row, `MontoItemOtraMoneda[${i}]`))
      itemsXml += '</OtraMonedaDetalle>'
    }

    itemsXml += xml('MontoItem', num(row, `MontoItem[${i}]`))
    itemsXml += '</Item>'
  }
  if (hasItems) body = body + `<DetallesItems>${itemsXml}</DetallesItems>`

  // InformacionReferencia (E33/E34) — goes at ECF ROOT level, AFTER DetallesItems per XSD
  // XSD order: NCFModificado, RNCOtroContribuyente, FechaNCFModificado, CodigoModificacion, RazonModificacion
  if (v(row, 'NCFModificado')) {
    body += '<InformacionReferencia>'
    body += xml('NCFModificado', v(row, 'NCFModificado'))
    if (v(row, 'RNCOtroContribuyente')) body += xml('RNCOtroContribuyente', v(row, 'RNCOtroContribuyente'))
    body += xml('FechaNCFModificado', v(row, 'FechaNCFModificado'))
    body += xml('CodigoModificacion', v(row, 'CodigoModificacion'))
    if (v(row, 'RazonModificacion')) body += xml('RazonModificacion', v(row, 'RazonModificacion'))
    body += '</InformacionReferencia>'
  }

  // FechaHoraFirma — REQUIRED, goes right before Signature at ECF root
  // Will be filled in at sign time with actual signature timestamp
  body += '<FechaHoraFirma>__FECHA_HORA_FIRMA__</FechaHoraFirma>'

  return `<?xml version="1.0" encoding="UTF-8"?><ECF>${body}</ECF>`
}

// ── Build RFCE XML from a row ───────────────────────────────────────────────

function buildRFCEFromRow(row) {
  let body = '<Encabezado>'
  body += xml('Version', '1.0')

  // IdDoc
  body += '<IdDoc>'
  body += xml('TipoeCF', '32')
  body += xml('eNCF', v(row, 'ENCF'))
  if (v(row, 'TipoIngresos')) body += xml('TipoIngresos', v(row, 'TipoIngresos'))
  if (v(row, 'TipoPago')) body += xml('TipoPago', v(row, 'TipoPago'))
  let hasFormas = false
  let formasXml = ''
  for (let i = 1; i <= 7; i++) {
    const forma = v(row, `FormaPago[${i}]`)
    const monto = num(row, `MontoPago[${i}]`)
    if (forma && monto) {
      formasXml += '<FormaDePago>'
      formasXml += xml('FormaPago', forma)
      formasXml += xml('MontoPago', monto)
      formasXml += '</FormaDePago>'
      hasFormas = true
    }
  }
  if (hasFormas) body += `<TablaFormasPago>${formasXml}</TablaFormasPago>`
  body += '</IdDoc>'

  // Emisor
  body += '<Emisor>'
  body += xml('RNCEmisor', v(row, 'RNCEmisor'))
  body += xml('RazonSocialEmisor', v(row, 'RazonSocialEmisor'))
  body += xml('FechaEmision', v(row, 'FechaEmision'))
  body += '</Emisor>'

  // Comprador (optional)
  if (v(row, 'RNCComprador')) {
    body += '<Comprador>'
    body += xml('RNCComprador', v(row, 'RNCComprador'))
    if (v(row, 'RazonSocialComprador')) body += xml('RazonSocialComprador', v(row, 'RazonSocialComprador'))
    body += '</Comprador>'
  }

  // Totales
  body += '<Totales>'
  if (num(row, 'MontoGravadoTotal')) body += xml('MontoGravadoTotal', num(row, 'MontoGravadoTotal'))
  if (num(row, 'MontoGravadoI1')) body += xml('MontoGravadoI1', num(row, 'MontoGravadoI1'))
  if (num(row, 'MontoGravadoI2')) body += xml('MontoGravadoI2', num(row, 'MontoGravadoI2'))
  if (num(row, 'MontoGravadoI3')) body += xml('MontoGravadoI3', num(row, 'MontoGravadoI3'))
  if (num(row, 'MontoExento')) body += xml('MontoExento', num(row, 'MontoExento'))
  if (num(row, 'TotalITBIS')) body += xml('TotalITBIS', num(row, 'TotalITBIS'))
  if (num(row, 'TotalITBIS1')) body += xml('TotalITBIS1', num(row, 'TotalITBIS1'))
  if (num(row, 'TotalITBIS2')) body += xml('TotalITBIS2', num(row, 'TotalITBIS2'))
  if (num(row, 'TotalITBIS3')) body += xml('TotalITBIS3', num(row, 'TotalITBIS3'))
  body += xml('MontoTotal', num(row, 'MontoTotal'))
  if (num(row, 'MontoNoFacturable')) body += xml('MontoNoFacturable', num(row, 'MontoNoFacturable'))
  if (num(row, 'MontoPeriodo')) body += xml('MontoPeriodo', num(row, 'MontoPeriodo'))
  body += '</Totales>'

  // CodigoSeguridadeCF — filled after signing with first 6 chars of SHA256(SignatureValue)
  body += '<CodigoSeguridadeCF>__CODIGO_SEGURIDAD__</CodigoSeguridadeCF>'

  body += '</Encabezado>'
  return `<?xml version="1.0" encoding="UTF-8"?><RFCE>${body}</RFCE>`
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const wb = XLSX.readFile(EXCEL_PATH, { raw: false })
  const ecfData = XLSX.utils.sheet_to_json(wb.Sheets['ECF'], { raw: false })
  const rfceData = XLSX.utils.sheet_to_json(wb.Sheets['RFCE'], { raw: false })

  console.log(`Processing ${ecfData.length} ECF rows and ${rfceData.length} RFCE rows...\n`)

  const manifest = []

  // Generate and sign ECFs
  for (const row of ecfData) {
    const encf = v(row, 'ENCF')
    const tipo = v(row, 'TipoeCF')
    const rnc = v(row, 'RNCEmisor')

    try {
      let xmlStr = buildECFFromRow(row)
      // Fill in FechaHoraFirma with current timestamp (dd-mm-yyyy hh:mm:ss)
      const now = new Date()
      const fechaFirma = [
        String(now.getDate()).padStart(2,'0'), String(now.getMonth()+1).padStart(2,'0'), now.getFullYear()
      ].join('-') + ' ' + [
        String(now.getHours()).padStart(2,'0'), String(now.getMinutes()).padStart(2,'0'), String(now.getSeconds()).padStart(2,'0')
      ].join(':')
      xmlStr = xmlStr.replace('__FECHA_HORA_FIRMA__', fechaFirma)
      const signedXml = signer.signXml(xmlStr, 'ECF')
      const fileName = `${rnc}${encf}.xml`
      fs.writeFileSync(path.join(OUTPUT_DIR, fileName), signedXml, 'utf8')
      manifest.push({ fileName, encf, tipo, status: 'signed' })
      console.log(`  OK  ${fileName} (E${tipo})`)
    } catch (err) {
      manifest.push({ fileName: `${rnc}${encf}.xml`, encf, tipo, status: 'error', error: err.message })
      console.log(`  ERR ${rnc}${encf}.xml (E${tipo}): ${err.message}`)
    }
  }

  // Generate and sign RFCEs — security code comes from the MATCHING E32 XML's signature
  const cryptoMod = require('crypto')
  const ecfSecurityCodes = {}
  // Extract security codes from all signed E32 XMLs
  // CodigoSeguridadeCF = first 6 chars of raw base64 SignatureValue (NOT SHA256 hash)
  for (const m of manifest) {
    if (m.tipo === '32' && m.status === 'signed') {
      const ecfXml = fs.readFileSync(path.join(OUTPUT_DIR, m.fileName), 'utf8')
      const sigMatch = ecfXml.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)
      if (sigMatch) {
        ecfSecurityCodes[m.encf] = sigMatch[1].replace(/\s/g, '').substring(0, 6)
      }
    }
  }

  for (const row of rfceData) {
    const encf = v(row, 'ENCF')
    const rnc = v(row, 'RNCEmisor')

    try {
      let xmlStr = buildRFCEFromRow(row)
      // Use security code from the matching signed E32 XML
      const code = ecfSecurityCodes[encf] || '000000'
      xmlStr = xmlStr.replace('__CODIGO_SEGURIDAD__', code)
      let signedXml = signer.signXml(xmlStr, 'RFCE')
      const fileName = `RFCE_${rnc}${encf}.xml`
      fs.writeFileSync(path.join(OUTPUT_DIR, fileName), signedXml, 'utf8')
      manifest.push({ fileName, encf, tipo: 'RFCE', status: 'signed' })
      console.log(`  OK  ${fileName} (RFCE)`)
    } catch (err) {
      manifest.push({ fileName: `RFCE_${rnc}${encf}.xml`, encf, tipo: 'RFCE', status: 'error', error: err.message })
      console.log(`  ERR RFCE_${rnc}${encf}.xml: ${err.message}`)
    }
  }

  // Save manifest
  fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))

  const ok = manifest.filter(m => m.status === 'signed').length
  const err = manifest.filter(m => m.status === 'error').length
  console.log(`\nDone: ${ok} signed, ${err} errors. Output: ${OUTPUT_DIR}`)
}

main()
