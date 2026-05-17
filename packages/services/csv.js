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
    ['GANANCIAS Y GASTOS'],
    ['Concepto', 'Monto RD$'],
    ...(metrics.hasAnyCost ? [['Ganancia Bruta (precio - costo)', fmtMoney(metrics.profit || 0)]] : []),
    ...(metrics.pyFee > 0 ? [[`Comision Pedidos Ya (15% de ${fmtMoney(metrics.pyRevenue)})`, `-${fmtMoney(metrics.pyFee)}`]] : []),
    ...(metrics.cardFee > 0 ? [[`Comision Tarjeta (5% de ${fmtMoney(metrics.cardRevenue)})`, `-${fmtMoney(metrics.cardFee)}`]] : []),
    ...(metrics.hasAnyCost ? [['Ganancia Neta', fmtMoney(metrics.profitNet || 0)]] : []),
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

// ── Estado de Resultados (P&L, Phase 5 spine) ─────────────────────────────
// `data` shape produced by EstadoResultadosReport.buildView:
//   { rows: [{ label, group, cur, prev, delta }], totals: { ingresos, gastos, utilidad, margen, … } }
export function exportEstadoResultados(biz, data, label) {
  const rows = [
    ...buildHeader(biz, 'ESTADO DE RESULTADOS', label),
    ['Concepto', 'Mes Actual RD$', 'Mes Anterior RD$', 'Variacion %'],
    ['INGRESOS'],
    ...data.rows.filter(r => r.group === 'ingresos').map(r => [
      r.label, fmtMoney(r.cur), fmtMoney(r.prev), r.delta != null ? `${r.delta.toFixed(1)}%` : '—',
    ]),
    ['Total Ingresos', fmtMoney(data.totals.ingresos), fmtMoney(data.totals.ingresosPrev), data.totals.ingresosDelta != null ? `${data.totals.ingresosDelta.toFixed(1)}%` : '—'],
    [],
    ['COSTOS Y GASTOS'],
    ...data.rows.filter(r => r.group === 'gastos').map(r => [
      r.label, fmtMoney(r.cur), fmtMoney(r.prev), r.delta != null ? `${r.delta.toFixed(1)}%` : '—',
    ]),
    ['Total Gastos', fmtMoney(data.totals.gastos), fmtMoney(data.totals.gastosPrev), data.totals.gastosDelta != null ? `${data.totals.gastosDelta.toFixed(1)}%` : '—'],
    [],
    ['UTILIDAD DEL MES', fmtMoney(data.totals.utilidad), fmtMoney(data.totals.utilidadPrev)],
    ['Margen Neto', `${(data.totals.margen || 0).toFixed(1)}%`, `${(data.totals.margenPrev || 0).toFixed(1)}%`],
    [],
    ['INFORMATIVO'],
    ['ITBIS Cobrado', fmtMoney(data.totals.itbisCobrado), fmtMoney(data.totals.itbisCobradoPrev)],
    ['ITBIS Pagado',  fmtMoney(data.totals.itbisPagado),  fmtMoney(data.totals.itbisPagadoPrev)],
    [],
    [`Generado: ${todayFormatted()}`],
  ]
  downloadCSV(rows, `estado-resultados-${label.replace(/\s+/g, '-').toLowerCase()}.csv`)
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
    ...(summary.hasAnyCost ? [['Ganancia Bruta', `RD$ ${fmtMoney(summary.profit || 0)}`]] : []),
    ...(summary.pyFee > 0 ? [[`Comision Pedidos Ya (15% de RD$ ${fmtMoney(summary.pyRevenue)})`, `-RD$ ${fmtMoney(summary.pyFee)}`]] : []),
    ...(summary.cardFee > 0 ? [[`Comision Tarjeta (5% de RD$ ${fmtMoney(summary.cardRevenue)})`, `-RD$ ${fmtMoney(summary.cardFee)}`]] : []),
    ...(summary.hasAnyCost ? [['Ganancia Neta', `RD$ ${fmtMoney(summary.profitNet || 0)}`]] : []),
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

// ═════════════════════════════════════════════════════════════════════════════
// NÓMINA REPORTS (v1.5)
// ═════════════════════════════════════════════════════════════════════════════

// ── TSS + INFOTEP report ──────────────────────────────────────────────────────
export function exportTSSReport(biz, rows, period) {
  const totals = rows.reduce((a, r) => {
    a.base += Number(r.base || 0)
    a.sfsEmp += Number(r.sfs_employee || 0)
    a.afpEmp += Number(r.afp_employee || 0)
    a.sfsEmpr += Number(r.sfs_employer || 0)
    a.afpEmpr += Number(r.afp_employer || 0)
    a.infotep += Number(r.infotep_employer || 0)
    return a
  }, { base: 0, sfsEmp: 0, afpEmp: 0, sfsEmpr: 0, afpEmpr: 0, infotep: 0 })

  const csv = [
    ...buildHeader(biz, 'REPORTE TSS + INFOTEP', period),
    ['No.', 'Empleado', 'Cedula', 'TSS-ID', 'Base', 'SFS Emp 3.04%', 'AFP Emp 2.87%', 'SFS Empr 7.09%', 'AFP Empr 7.10%', 'INFOTEP 1%'],
    ...rows.map((r, i) => [
      i + 1, r.empleado_nombre || '', r.cedula || '', r.tss_id || '',
      fmtMoney(r.base), fmtMoney(r.sfs_employee), fmtMoney(r.afp_employee),
      fmtMoney(r.sfs_employer), fmtMoney(r.afp_employer), fmtMoney(r.infotep_employer),
    ]),
    [],
    ['', 'TOTALES', '', '',
      fmtMoney(totals.base), fmtMoney(totals.sfsEmp), fmtMoney(totals.afpEmp),
      fmtMoney(totals.sfsEmpr), fmtMoney(totals.afpEmpr), fmtMoney(totals.infotep)],
    [],
    ['Total empleado retenido:',   fmtMoney(totals.sfsEmp + totals.afpEmp)],
    ['Total empleador (TSS+INFOTEP):', fmtMoney(totals.sfsEmpr + totals.afpEmpr + totals.infotep)],
    ['GRAN TOTAL:',                fmtMoney(totals.sfsEmp + totals.afpEmp + totals.sfsEmpr + totals.afpEmpr + totals.infotep)],
    [],
    [`Generado: ${todayFormatted()}`],
  ]
  downloadCSV(csv, `tss-infotep-${period.toLowerCase().replace(/\s+/g, '-')}.csv`)
}

// ── ISR report ────────────────────────────────────────────────────────────────
export function exportISRReport(biz, rows, period) {
  const totalIsr = rows.reduce((s, r) => s + Number(r.isr || 0), 0)
  const csv = [
    ...buildHeader(biz, 'REPORTE ISR (IMPUESTO SOBRE LA RENTA)', period),
    ['No.', 'Empleado', 'Cedula', 'Base del periodo', 'Salario anual proyectado', 'ISR retenido'],
    ...rows.map((r, i) => {
      const periodGross = Number(r.base || 0) + Number(r.commissions || 0) + Number(r.bonuses || 0)
      const annual = periodGross * (r.cycle === 'quincenal' ? 24 : 12)
      return [i + 1, r.empleado_nombre || '', r.cedula || '', fmtMoney(periodGross), fmtMoney(annual), fmtMoney(r.isr)]
    }),
    [],
    ['', 'TOTAL ISR RETENIDO', '', '', '', fmtMoney(totalIsr)],
    [],
    [`Generado: ${todayFormatted()}`],
  ]
  downloadCSV(csv, `isr-${period.toLowerCase().replace(/\s+/g, '-')}.csv`)
}

// ── Nómina completa (QuickBooks/Alegra compatible) ────────────────────────────
export function exportNominaPeriod(biz, rows, period) {
  const csv = [
    ...buildHeader(biz, 'NOMINA COMPLETA', period),
    ['No.', 'Empleado', 'Cedula', 'Puesto', 'Tipo', 'Periodo', 'Base', 'Comisiones', 'Bonos', 'SFS Emp', 'AFP Emp', 'ISR', 'Otros desc.', 'Total desc.', 'Neto'],
    ...rows.map((r, i) => [
      i + 1, r.empleado_nombre || '', r.cedula || '', r.puesto || '', r.empleado_tipo || '',
      `${r.period_start} - ${r.period_end}`,
      fmtMoney(r.base), fmtMoney(r.commissions), fmtMoney(r.bonuses),
      fmtMoney(r.sfs_employee), fmtMoney(r.afp_employee), fmtMoney(r.isr),
      fmtMoney(r.other_deductions), fmtMoney(r.deductions), fmtMoney(r.net),
    ]),
    [],
    [`Total empleados: ${rows.length}`],
    [`Total neto pagado: ${fmtMoney(rows.reduce((s, r) => s + Number(r.net || 0), 0))}`],
    [`Generado: ${todayFormatted()}`],
  ]
  downloadCSV(csv, `nomina-${period.toLowerCase().replace(/\s+/g, '-')}.csv`)
}

// ── Conteo Fisico — Variance report CSV (v2.5) ──────────────────────────────
// Excel ES convention: semicolon delimiter + BOM. downloadCSV() already writes
// the BOM; we swap commas to semicolons in the serialization by using a local
// builder so number-decimals (e.g. 12,50) don't collide with the delimiter.
export function exportInventoryCount(biz, count) {
  const items = (count?.items || []).map(it => {
    const exp = Number(it.expected_qty) || 0
    const sold = Number(it.sold_during_count) || 0
    const adj = exp - sold
    const cnt = (it.counted_qty === null || it.counted_qty === undefined) ? adj : Number(it.counted_qty)
    const dq  = cnt - adj
    return {
      sku: it.sku || '',
      name: it.name || '',
      category: it.category || '',
      expected_start: exp,
      sold_during: sold,
      expected_adj: adj,
      counted: (it.counted_qty === null || it.counted_qty === undefined) ? '' : cnt,
      variance_qty: dq,
      unit_cost: Number(it.unit_cost) || 0,
      unit_price: Number(it.unit_price) || 0,
      variance_cost: dq * (Number(it.unit_cost) || 0),
      variance_price: dq * (Number(it.unit_price) || 0),
    }
  }).sort((a, b) => Math.abs(b.variance_cost) - Math.abs(a.variance_cost))

  const totalExpCost = items.reduce((s, r) => s + r.expected_adj * r.unit_cost, 0)
  const totalCntCost = items.reduce((s, r) => s + (Number(r.counted) || r.expected_adj) * r.unit_cost, 0)
  const totalVarCost = totalCntCost - totalExpCost

  const rows = [
    ...buildHeader(biz, 'REPORTE DE VARIANZA — CONTEO FISICO', count?.title || ''),
    [`Estado: ${count?.status || '—'}`],
    [`Iniciado: ${count?.started_at || ''}`],
    [`Completado: ${count?.completed_at || '—'}`],
    [`Contado por: ${count?.counted_by_name || '—'}`],
    [],
    ['SKU', 'Producto', 'Categoria', 'Inicio conteo', 'Vendidos en conteo', 'Esperado (ajustado)', 'Contado', 'Dif. unidades', 'Costo unit.', 'Precio unit.', 'Perdida RD$ (costo)', 'Perdida RD$ (precio)'],
    ...items.map(r => [
      r.sku, r.name, r.category,
      fmtMoney(r.expected_start), fmtMoney(r.sold_during), fmtMoney(r.expected_adj),
      r.counted === '' ? '' : fmtMoney(r.counted),
      fmtMoney(r.variance_qty),
      fmtMoney(r.unit_cost), fmtMoney(r.unit_price),
      fmtMoney(r.variance_cost), fmtMoney(r.variance_price),
    ]),
    [],
    [`Total esperado (costo): ${fmtMoney(totalExpCost)}`],
    [`Total contado (costo): ${fmtMoney(totalCntCost)}`],
    [`Varianza total (costo): ${fmtMoney(totalVarCost)}`],
    [`Items con variacion: ${items.filter(x => x.variance_qty !== 0).length}`],
    [`Generado: ${todayFormatted()}`],
  ]

  // Use ; as the field delimiter (ES Excel convention) so fmtMoney values
  // like 1,234.56 don't collide with comma-delimited CSV. BOM preserved.
  const esc = (v) => {
    if (v == null) return ''
    const s = String(v)
    if (s.includes(';') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const csv = rows.map(r => r.map(esc).join(';')).join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `conteo-varianza-${(count?.title || 'conteo').replace(/[^\w\-]+/g, '_').slice(0, 40)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
