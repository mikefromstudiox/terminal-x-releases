/**
 * dgii-reports.js — DGII monthly report TXT generators.
 *
 * Produces pipe-delimited text files per DGII's Formato 606 (compras) and
 * 607 (ventas) specs so the client's accountant can upload directly to
 * DGII → Oficina Virtual → Envío de archivos without re-keying.
 *
 * Historical note on naming: Terminal X's codebase accidentally swapped the
 * table/IPC labels — `compras_607` actually holds PURCHASES (DGII 606), and
 * the `dgii:606` IPC pulls SALES (DGII 607). This module uses the OFFICIAL
 * DGII naming in its exports (Formato606 = purchases, Formato607 = sales).
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

// DGII fields are strict about formatting. Numbers with 2 decimals, no
// thousand separators. Empty optional fields are bare (no placeholder).
function num(n) {
  return Number(n || 0).toFixed(2)
}

// DGII date format: YYYYMMDD (no dashes)
function dgiiDate(d) {
  if (!d) return ''
  const dt = (d instanceof Date) ? d : new Date(
    typeof d === 'string' && !d.includes('T') ? d.replace(' ', 'T') + 'Z' : d
  )
  if (isNaN(dt.getTime())) return ''
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const day = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// Strip RNC/cédula to digits only (DGII rejects dashes + spaces)
function cleanId(v) {
  return String(v || '').replace(/\D/g, '')
}

// Clean an NCF — StarSISA-imported synthesized "B02-LEGACY-..." values are NOT
// valid DGII comprobantes and must be excluded from exports.
function validNcf(ncf) {
  if (!ncf) return ''
  const s = String(ncf).trim().toUpperCase()
  if (s.includes('LEGACY')) return ''
  // DGII format: prefix (B or E) + 2-3 digit type + digits. Loose check.
  if (!/^[BE]\d{2,3}\d+$/.test(s.replace(/\s+/g, ''))) return ''
  return s
}

// Determine id type: 1=RNC (9 digits), 2=Cédula (11 digits), 3=Pasaporte.
// DGII: tipo 1 for suppliers/clients with RNC, tipo 2 for natural persons.
function idType(id) {
  const d = cleanId(id)
  if (d.length === 9) return '1'      // RNC
  if (d.length === 11) return '2'     // Cédula
  return ''                            // No ID → omit (Consumidor Final walk-in)
}

function periodString(year, month) {
  return `${year}${String(month).padStart(2, '0')}`
}

// ── Formato 606 — PURCHASES (proveedor invoices client paid) ────────────────
// Input: rows from compras_607 table. Spec (DGII circular R0110 2023):
//   RNC/Cédula | Tipo_ID | Bienes_Servicios | NCF | NCF_Modificado |
//   Fecha_Comprobante | Fecha_Pago | Monto_Servicios | Monto_Bienes | Total |
//   ITBIS_Facturado | ITBIS_Retenido | ITBIS_Sujeto_Proporcionalidad |
//   ITBIS_Llevado_Costo | ITBIS_Adelantar | ITBIS_Percibido | Tipo_Retencion |
//   Monto_Retencion_Renta | ISR_Percibido | Impuesto_Selectivo |
//   Otros_Impuestos | Monto_Propina_Legal | Forma_Pago
//
// "Bienes_Servicios" = '09' for services, '06' for goods. If both present,
// use '09' (services dominant for our carwash).
export function generateFormato606Txt(compras, rncEmisor, year, month) {
  const period = periodString(year, month)
  const rows = (compras || []).filter(c => validNcf(c.ncf))

  const header = `606|${cleanId(rncEmisor)}|${period}|${rows.length}`
  const bodyLines = rows.map(c => {
    const bs = (Number(c.monto_servicios) || 0) >= (Number(c.monto_bienes) || 0) ? '09' : '06'
    return [
      cleanId(c.rnc_proveedor),      // RNC/Cédula proveedor
      idType(c.rnc_proveedor),        // Tipo_ID
      bs,                              // Bienes/Servicios
      c.ncf || '',                     // NCF
      c.ncf_modificado || '',          // NCF_Modificado
      dgiiDate(c.fecha_ncf),           // Fecha_Comprobante
      dgiiDate(c.fecha_pago),          // Fecha_Pago
      num(c.monto_servicios),          // Monto_Servicios
      num(c.monto_bienes),             // Monto_Bienes
      num(c.total),                    // Total
      num(c.itbis_facturado),          // ITBIS_Facturado
      num(c.itbis_retenido),           // ITBIS_Retenido
      '0.00',                          // ITBIS_Sujeto_Proporcionalidad
      '0.00',                          // ITBIS_Llevado_Costo
      '0.00',                          // ITBIS_Adelantar
      '0.00',                          // ITBIS_Percibido
      '',                              // Tipo_Retencion_ISR
      num(c.retencion_renta),          // Monto_Retencion_Renta
      '0.00',                          // ISR_Percibido
      '0.00',                          // Impuesto_Selectivo
      '0.00',                          // Otros_Impuestos
      '0.00',                          // Monto_Propina_Legal
      (c.forma_pago || '01').toString().slice(0, 2), // Forma_Pago (01-08)
    ].join('|')
  })

  return [header, ...bodyLines].join('\n') + '\n'
}

// ── Formato 607 — SALES (invoices we issued to clients) ─────────────────────
// Input: rows from tickets table. Spec:
//   RNC/Cédula_Cliente | Tipo_ID | NCF | NCF_Modificado | Tipo_Ingreso |
//   Fecha_Comprobante | Fecha_Retencion | Monto_Facturado | ITBIS_Facturado |
//   ITBIS_Retenido | ITBIS_Percibido | Retencion_Renta | ISR_Percibido |
//   Impuesto_Selectivo | Otros_Impuestos | Propina_Legal | Efectivo |
//   Cheque_Tx | Tarjeta | Credito | Bonos | Permuta | Otras_Formas
//
// Tipo_Ingreso: '01' = Ingresos por operaciones (default for carwash/retail).
// Forma de pago columns: split the Total across one bucket based on payment_method.
export function generateFormato607Txt(tickets, rncEmisor, year, month) {
  const period = periodString(year, month)
  const rows = (tickets || []).filter(t => {
    if (t.status === 'nula' || t.status === 'anulado') return false
    return !!validNcf(t.ncf)
  })

  const header = `607|${cleanId(rncEmisor)}|${period}|${rows.length}`
  const bodyLines = rows.map(t => {
    const ncf = validNcf(t.ncf)
    const total = Number(t.total) || 0
    const pm = String(t.payment_method || 'cash').toLowerCase()
    // Split total into the 7 payment-method columns
    let efectivo = '0.00', cheque = '0.00', tarjeta = '0.00', credito = '0.00',
        bonos = '0.00', permuta = '0.00', otras = '0.00'
    if (t.tipo_venta === 'credito')            credito  = num(total)
    else if (pm === 'cash' || pm === 'efectivo') efectivo = num(total)
    else if (pm === 'card' || pm === 'tarjeta')  tarjeta  = num(total)
    else if (pm === 'transfer' || pm === 'transferencia' || pm === 'check' || pm === 'cheque') cheque = num(total)
    else                                          otras    = num(total)

    return [
      cleanId(t.client_rnc || t.rnc),            // RNC/Cédula cliente
      idType(t.client_rnc || t.rnc),              // Tipo_ID
      ncf,                                         // NCF
      t.ncf_modificado || '',                      // NCF_Modificado
      '01',                                        // Tipo_Ingreso (01 = Operaciones)
      dgiiDate(t.created_at || t.fecha),           // Fecha_Comprobante
      '',                                          // Fecha_Retencion
      num(total),                                  // Monto_Facturado (total bruto)
      num(t.itbis),                                // ITBIS_Facturado
      '0.00',                                      // ITBIS_Retenido
      '0.00',                                      // ITBIS_Percibido
      '0.00',                                      // Retencion_Renta
      '0.00',                                      // ISR_Percibido
      num(t.ley),                                  // Impuesto_Selectivo (or 0 for carwash)
      '0.00',                                      // Otros_Impuestos
      '0.00',                                      // Propina_Legal
      efectivo, cheque, tarjeta, credito, bonos, permuta, otras,
    ].join('|')
  })

  return [header, ...bodyLines].join('\n') + '\n'
}

// ── Convenience: trigger browser download with the TXT content ──────────────
export function downloadTxt(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// ── Filename helpers per DGII convention ────────────────────────────────────
// DGII expects: DGII_F606_<RNC>_<YYYYMM>.txt / DGII_F607_<RNC>_<YYYYMM>.txt
export function filename606(rncEmisor, year, month) {
  return `DGII_F606_${cleanId(rncEmisor)}_${periodString(year, month)}.txt`
}
export function filename607(rncEmisor, year, month) {
  return `DGII_F607_${cleanId(rncEmisor)}_${periodString(year, month)}.txt`
}
