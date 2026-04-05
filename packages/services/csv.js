// Professional CSV export utility with business letterhead
// All exports include company header, formatted numbers, and clean layout

function escapeCSV(val) {
  if (val == null) return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
  return s
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function todayFormatted() {
  return new Date().toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' })
}

function buildHeader(biz, reportTitle, period) {
  return [
    [biz?.name || 'Empresa'],
    [biz?.rnc ? `RNC: ${biz.rnc}` : ''],
    [biz?.address || ''],
    [[biz?.phone, biz?.email].filter(Boolean).join(' | ')],
    [],
    [reportTitle],
    [period ? `Periodo: ${period}` : `Fecha: ${todayFormatted()}`],
    [],
  ]
}

function buildSeparator(cols) {
  return [Array(cols).fill('')]
}

function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(escapeCSV).join(',')).join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Commission Detail (individual worker) ──────────────────────────────────
export function exportCommissionDetail(biz, tickets, personName, pct, period) {
  const totalBase = tickets.reduce((s, t) => s + t.commBase, 0)
  const totalComm = tickets.reduce((s, t) => s + t.commission, 0)

  const rows = [
    ...buildHeader(biz, 'REPORTE DE COMISIONES — DETALLE INDIVIDUAL', period),
    ['Empleado:', personName],
    ['Comision:', `${pct}%`],
    ['Total Tickets:', String(tickets.length)],
    ['Total Base:', `RD$ ${fmtMoney(totalBase)}`],
    ['Total Comision:', `RD$ ${fmtMoney(totalComm)}`],
    [],
    ['No.', '#Ticket', 'Fecha', 'Vehiculo', 'Servicio', 'Base (s/ITBIS)', 'Comision %', 'Comision RD$', 'Estado'],
    ...tickets.map((t, i) => [
      i + 1, t.ticketNo,
      t.date instanceof Date ? t.date.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '',
      t.vehicle, t.mainService?.name || '—',
      fmtMoney(t.commBase), `${t.pct}%`, fmtMoney(t.commission), t.estado,
    ]),
    [],
    ['', '', '', '', 'TOTALES', fmtMoney(totalBase), '', fmtMoney(totalComm), ''],
    [],
    [`Generado: ${todayFormatted()}`],
  ]
  downloadCSV(rows, `comisiones-${personName.toLowerCase().replace(/\s+/g, '-')}-${period.toLowerCase().replace(/\s+/g, '-')}.csv`)
}

// ── Commission Summary (all workers) ───────────────────────────────────────
export function exportCommissionSummary(biz, summaries, groupLabel, period) {
  const totalBase = summaries.reduce((s, w) => s + (w.total_base || 0), 0)
  const totalComm = summaries.reduce((s, w) => s + (w.total_commission || 0), 0)
  const totalTickets = summaries.reduce((s, w) => s + (w.ticket_count || 0), 0)

  const rows = [
    ...buildHeader(biz, `REPORTE DE COMISIONES — ${groupLabel.toUpperCase()}`, period),
    ['Total Empleados:', String(summaries.length)],
    ['Total Tickets:', String(totalTickets)],
    ['Total Base:', `RD$ ${fmtMoney(totalBase)}`],
    ['Total Comisiones:', `RD$ ${fmtMoney(totalComm)}`],
    [],
    ['No.', 'Nombre', 'Comision %', 'Tickets', 'Base (s/ITBIS)', 'Comision RD$'],
    ...summaries.map((w, i) => [
      i + 1, w.washer_name || w.seller_name || w.cajero_name,
      `${w.commission_pct}%`, w.ticket_count,
      fmtMoney(w.total_base || 0), fmtMoney(w.total_commission || 0),
    ]),
    [],
    ['', 'TOTALES', '', totalTickets, fmtMoney(totalBase), fmtMoney(totalComm)],
    [],
    [`Generado: ${todayFormatted()}`],
  ]
  downloadCSV(rows, `comisiones-${groupLabel.toLowerCase().replace(/\s+/g, '-')}-${period.toLowerCase().replace(/\s+/g, '-')}.csv`)
}

// ── Monthly Report ─────────────────────────────────────────────────────────
export function exportMonthlyReport(biz, data, label) {
  const { metrics, topClients, topServices, cxc } = data

  const rows = [
    ...buildHeader(biz, 'REPORTE MENSUAL DE VENTAS', label),
    ['RESUMEN FINANCIERO'],
    ['Concepto', 'Monto RD$'],
    ['Total Facturado', fmtMoney(metrics.facturado)],
    ['Total Cobrado', fmtMoney(metrics.cobrado)],
    ['Pendiente por Cobrar', fmtMoney(metrics.pendiente)],
    ['Cantidad de Tickets', metrics.carros],
    [],
    ['TOP 5 CLIENTES POR FACTURACION'],
    ['Posicion', 'Cliente', 'Tickets', 'Total RD$'],
    ...topClients.map((c, i) => [i + 1, c.name, c.tickets, fmtMoney(c.total)]),
    [],
    ['SERVICIOS MAS SOLICITADOS'],
    ['Servicio', 'Cantidad', 'Total RD$'],
    ...topServices.map(s => [s.name, s.count, fmtMoney(s.total)]),
    [],
    ['CUENTAS POR COBRAR (CXC)'],
    ['Cliente', 'Facturado RD$', 'Cobrado RD$', 'Pendiente RD$'],
    ...cxc.map(c => [c.client, fmtMoney(c.facturado), fmtMoney(c.cobrado), fmtMoney(c.pendiente)]),
    [],
    [`Generado: ${todayFormatted()}`],
  ]
  downloadCSV(rows, `reporte-mensual-${label.replace(/\s+/g, '-').toLowerCase()}.csv`)
}

// ── Liquidacion ────────────────────────────────────────────────────────────
export function exportLiquidacion(biz, emp, liq, tipo) {
  const tipoLabel = tipo === 'desahucio' ? 'Desahucio (Art. 87)' : 'Renuncia Voluntaria (Art. 85)'
  const isComm = liq.isCommissionBased

  const rows = [
    ...buildHeader(biz, 'LIQUIDACION DE PRESTACIONES LABORALES', null),
    ['DATOS DEL EMPLEADO'],
    ['Nombre:', emp.nombre],
    ['Cedula:', emp.cedula || '—'],
    ['Tipo:', emp.tipo],
    ['Fecha de Ingreso:', emp.start_date],
    ['Antiguedad:', liq.antiguedad],
    isComm ? ['Base de Calculo:', `Promedio mensual de comisiones: RD$ ${fmtMoney(liq.monthlyBase)}`] : ['Salario Mensual:', `RD$ ${fmtMoney(emp.salary)}`],
    ['Salario Diario (÷23.83):', `RD$ ${fmtMoney(liq.monthlyBase / 23.83)}`],
    ['Tipo de Terminacion:', tipoLabel],
    [],
    ['DESGLOSE DE PRESTACIONES'],
    ['Concepto', 'Dias', 'Monto RD$'],
    ['Vacaciones', liq.vacaciones.days?.toFixed(1) || '', fmtMoney(liq.vacaciones.amount)],
    ['Salario de Navidad', '', fmtMoney(liq.navidad.amount)],
    ...(tipo === 'desahucio' ? [
      ['Preaviso (Art. 76)', liq.preaviso.days || '', fmtMoney(liq.preaviso.amount)],
      ['Cesantia (Art. 80)', liq.cesantia.days || '', fmtMoney(liq.cesantia.amount)],
    ] : [
      ['Preaviso', '—', 'No aplica'],
      ['Cesantia', '—', 'No aplica'],
    ]),
    [],
    ['', 'TOTAL A PAGAR', `RD$ ${fmtMoney(liq.total)}`],
    [],
    ['NOTA: Calculo basado en la Ley 16-92 (Codigo de Trabajo de la Republica Dominicana)'],
    isComm ? ['Base: promedio mensual de comisiones devengadas durante la relacion laboral'] : [],
    [],
    [`Generado: ${todayFormatted()}`],
    [],
    ['_________________________', '', '_________________________'],
    ['Firma del Empleador', '', 'Firma del Empleado'],
  ]
  downloadCSV(rows, `liquidacion-${emp.nombre.toLowerCase().replace(/\s+/g, '-')}.csv`)
}

// ── Daily Sales Report ─────────────────────────────────────────────────────
export function exportDailyReport(biz, transactions, summary, period) {
  const payMethods = {}
  transactions.filter(t => t.estado !== 'nula').forEach(t => {
    const m = t.payMethod || 'cash'
    payMethods[m] = (payMethods[m] || 0) + t.total
  })
  const pmLabels = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', credit: 'Credito' }

  const rows = [
    ...buildHeader(biz, 'REPORTE DIARIO DE VENTAS', period),
    ['RESUMEN DEL DIA'],
    ['Concepto', 'Valor'],
    ['Total Tickets', summary.count],
    ['Total Facturado', `RD$ ${fmtMoney(summary.total)}`],
    ['ITBIS Recaudado', `RD$ ${fmtMoney(summary.itbis)}`],
    ['Cuentas por Cobrar', `RD$ ${fmtMoney(summary.cxc)}`],
    ['Facturas Anuladas', summary.nulas],
    [],
    ['DESGLOSE POR FORMA DE PAGO'],
    ['Metodo', 'Monto RD$'],
    ...Object.entries(payMethods).map(([k, v]) => [pmLabels[k] || k, fmtMoney(v)]),
    [],
    ['DETALLE DE TRANSACCIONES'],
    ['No.', '#Ticket', 'Hora', 'Cliente', 'Vehiculo', 'Servicio(s)', 'Subtotal', 'ITBIS', 'Total', 'Pago', 'NCF', 'Estado'],
    ...transactions.map((t, i) => [
      i + 1, t.ticketNo,
      t.date instanceof Date ? t.date.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }) : '',
      t.client, t.vehicle,
      (t.services || []).map(s => s.name).join(' + ') || '—',
      fmtMoney(t.subtotal), fmtMoney(t.itbis), fmtMoney(t.total),
      pmLabels[t.payMethod] || t.payMethod, t.ncf || '—',
      t.estado === 'nula' ? 'ANULADA' : 'OK',
    ]),
    [],
    ['', '', '', '', '', 'TOTALES', fmtMoney(summary.total - summary.cxc), fmtMoney(summary.itbis), fmtMoney(summary.total), '', '', ''],
    [],
    [`Generado: ${todayFormatted()}`],
  ]
  downloadCSV(rows, `reporte-diario-${period.replace(/\s+/g, '-').toLowerCase()}.csv`)
}

// ── Salesperson Commission Detail ──────────────────────────────────────────
export function exportSellerDetail(biz, tickets, sellerName, pct, period) {
  const totalBase = tickets.reduce((s, t) => s + (t.commBase || 0), 0)
  const totalComm = tickets.reduce((s, t) => s + (t.commission || 0), 0)

  const rows = [
    ...buildHeader(biz, 'REPORTE DE COMISIONES — VENDEDOR', period),
    ['Vendedor:', sellerName],
    ['Comision:', `${pct}%`],
    ['Total Tickets:', String(tickets.length)],
    ['Total Facturado:', `RD$ ${fmtMoney(totalBase)}`],
    ['Total Comision:', `RD$ ${fmtMoney(totalComm)}`],
    [],
    ['No.', '#Ticket', 'Fecha', 'Cliente', 'Subtotal RD$', 'Comision %', 'Comision RD$', 'Estado'],
    ...tickets.map((t, i) => [
      i + 1, t.doc_number || t.ticketNo || '',
      t.date instanceof Date ? t.date.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : (t.ticket_date || ''),
      t.client_name || '—',
      fmtMoney(t.commBase), `${t.pct}%`, fmtMoney(t.commission), t.status || t.estado || '',
    ]),
    [],
    ['', '', '', 'TOTALES', fmtMoney(totalBase), '', fmtMoney(totalComm), ''],
    [],
    [`Generado: ${todayFormatted()}`],
  ]
  downloadCSV(rows, `comisiones-vendedor-${sellerName.toLowerCase().replace(/\s+/g, '-')}-${period.toLowerCase().replace(/\s+/g, '-')}.csv`)
}

// ── Salesperson Commission Summary ─────────────────────────────────────────
export function exportSellerSummary(biz, summaries, period) {
  const totalBilled = summaries.reduce((s, g) => s + (g.totalBilled || 0), 0)
  const totalComm = summaries.reduce((s, g) => s + (g.commission || 0), 0)
  const totalTickets = summaries.reduce((s, g) => s + (g.ticketCount || 0), 0)

  const rows = [
    ...buildHeader(biz, 'REPORTE DE COMISIONES — TODOS LOS VENDEDORES', period),
    ['Total Vendedores:', String(summaries.length)],
    ['Total Tickets:', String(totalTickets)],
    ['Total Facturado:', `RD$ ${fmtMoney(totalBilled)}`],
    ['Total Comisiones:', `RD$ ${fmtMoney(totalComm)}`],
    [],
    ['No.', 'Vendedor', 'Comision %', 'Tickets', 'Facturado RD$', 'Comision RD$'],
    ...summaries.map((g, i) => [
      i + 1, g.name, `${g.commissionPct}%`, g.ticketCount,
      fmtMoney(g.totalBilled), fmtMoney(g.commission),
    ]),
    [],
    ['', 'TOTALES', '', totalTickets, fmtMoney(totalBilled), fmtMoney(totalComm)],
    [],
    [`Generado: ${todayFormatted()}`],
  ]
  downloadCSV(rows, `comisiones-vendedores-${period.toLowerCase().replace(/\s+/g, '-')}.csv`)
}
