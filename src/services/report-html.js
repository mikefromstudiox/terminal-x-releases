/**
 * report-html.js — Professional HTML report generator
 *
 * Opens a styled HTML page in a new browser window with:
 * - Business logo + letterhead
 * - Formatted tables with alternating row colors
 * - Print button (Ctrl+P)
 * - Auto-fits A4/Letter paper
 */

function fmtMoney(n) {
  return 'RD$ ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function todayFormatted() {
  return new Date().toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtDateShort(d) {
  if (!d) return '—'
  const dt = d instanceof Date ? d : new Date(d)
  return dt.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtTime(d) {
  if (!d) return ''
  const dt = d instanceof Date ? d : new Date(d)
  return dt.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
}

const STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #1a1a1a; background: #f5f5f5; }
  .page { max-width: 800px; margin: 20px auto; background: #fff; box-shadow: 0 2px 20px rgba(0,0,0,0.08); border-radius: 8px; overflow: hidden; }
  @media print {
    body { background: #fff; }
    .page { box-shadow: none; margin: 0; max-width: 100%; border-radius: 0; }
    .no-print { display: none !important; }
    @page { margin: 15mm 10mm; }
  }
  .header { background: #000; color: #fff; padding: 28px 40px; display: flex; align-items: center; gap: 24px; }
  .header-logo { width: 64px; height: 64px; object-fit: contain; border-radius: 8px; flex-shrink: 0; }
  .header-info h1 { font-size: 20px; font-weight: 800; letter-spacing: 1px; }
  .header-info p { font-size: 12px; color: rgba(255,255,255,0.6); margin-top: 2px; }
  .report-title { padding: 24px 40px 0; }
  .report-title h2 { font-size: 16px; font-weight: 700; color: #1a1a1a; text-transform: uppercase; letter-spacing: 0.5px; }
  .report-title .period { font-size: 13px; color: #666; margin-top: 4px; }
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; padding: 20px 40px; }
  .summary-card { background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 14px 16px; }
  .summary-card .label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #888; }
  .summary-card .value { font-size: 18px; font-weight: 700; color: #1a1a1a; margin-top: 4px; }
  .section { padding: 8px 40px 20px; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #f0f0f0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead th { background: #f8f9fa; padding: 10px 12px; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #666; border-bottom: 2px solid #e9ecef; }
  thead th.right { text-align: right; }
  thead th.center { text-align: center; }
  tbody td { padding: 9px 12px; border-bottom: 1px solid #f0f0f0; color: #333; }
  tbody tr:nth-child(even) { background: #fafbfc; }
  tbody td.right { text-align: right; font-variant-numeric: tabular-nums; }
  tbody td.center { text-align: center; }
  tbody td.bold { font-weight: 700; }
  tbody td.money { font-weight: 600; color: #1a1a1a; }
  tbody td.void { color: #dc3545; font-weight: 600; }
  tfoot td { padding: 12px; font-weight: 700; border-top: 2px solid #1a1a1a; background: #f8f9fa; }
  tfoot td.right { text-align: right; }
  .footer { padding: 20px 40px; border-top: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; }
  .footer .timestamp { font-size: 11px; color: #999; }
  .footer .brand { font-size: 11px; color: #bbb; }
  .print-bar { padding: 16px 40px; display: flex; gap: 10px; }
  .btn { padding: 10px 24px; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .btn-primary { background: #b3001e; color: #fff; }
  .btn-primary:hover { background: #8c0017; }
  .btn-secondary { background: #f0f0f0; color: #333; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; padding: 40px 40px 20px; }
  .sig-line { border-top: 1px solid #333; padding-top: 6px; text-align: center; font-size: 11px; color: #666; }
  .note { padding: 0 40px 16px; font-size: 11px; color: #888; font-style: italic; }
`

function buildLetterhead(biz, logoDataUrl) {
  const logoHtml = logoDataUrl
    ? `<img src="${logoDataUrl}" class="header-logo" alt="Logo" />`
    : ''
  return `
    <div class="header">
      ${logoHtml}
      <div class="header-info">
        <h1>${biz?.name || 'Terminal X POS'}</h1>
        ${biz?.rnc ? `<p>RNC: ${biz.rnc}</p>` : ''}
        ${biz?.address ? `<p>${biz.address}</p>` : ''}
        <p>${[biz?.phone, biz?.email].filter(Boolean).join(' | ')}</p>
      </div>
    </div>
  `
}

function buildFooterHtml() {
  return `
    <div class="footer">
      <span class="timestamp">Generado: ${todayFormatted()}</span>
      <span class="brand">Terminal X POS</span>
    </div>
  `
}

function openReport(html) {
  const w = window.open('', '_blank', 'width=860,height=900')
  if (!w) { alert('Habilite ventanas emergentes para ver el reporte.'); return }
  w.document.write(html)
  w.document.close()
}

async function getLogoDataUrl(biz) {
  if (!biz?.logo) return null
  try {
    const resp = await fetch(biz.logo)
    const blob = await resp.blob()
    return new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch { return null }
}

// ── Daily Sales Report ─────────────────────────────────────────────────────
export async function printDailyReport(biz, transactions, summary, period) {
  const logo = await getLogoDataUrl(biz)
  const pmLabels = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', credit: 'Credito' }
  const pmTotals = {}
  transactions.filter(t => t.estado !== 'nula').forEach(t => {
    const m = t.payMethod || 'cash'
    pmTotals[m] = (pmTotals[m] || 0) + t.total
  })

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reporte Diario — ${period}</title><style>${STYLES}</style></head><body>
    <div class="page">
      ${buildLetterhead(biz, logo)}
      <div class="print-bar no-print">
        <button class="btn btn-primary" onclick="window.print()">Imprimir / Guardar PDF</button>
        <button class="btn btn-secondary" onclick="window.close()">Cerrar</button>
      </div>
      <div class="report-title"><h2>Reporte Diario de Ventas</h2><div class="period">Periodo: ${period}</div></div>
      <div class="summary-grid">
        <div class="summary-card"><div class="label">Total Facturas</div><div class="value">${summary.count}</div></div>
        <div class="summary-card"><div class="label">Total Facturado</div><div class="value">${fmtMoney(summary.total)}</div></div>
        <div class="summary-card"><div class="label">ITBIS Recaudado</div><div class="value">${fmtMoney(summary.itbis)}</div></div>
        <div class="summary-card"><div class="label">Cuentas por Cobrar</div><div class="value">${fmtMoney(summary.cxc)}</div></div>
        <div class="summary-card"><div class="label">Anuladas</div><div class="value">${summary.nulas}</div></div>
      </div>
      <div class="section">
        <div class="section-title">Desglose por Forma de Pago</div>
        <table><thead><tr><th>Metodo</th><th class="right">Monto</th></tr></thead><tbody>
          ${Object.entries(pmTotals).map(([k, v]) => `<tr><td>${pmLabels[k] || k}</td><td class="right money">${fmtMoney(v)}</td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="section">
        <div class="section-title">Detalle de Transacciones</div>
        <table><thead><tr>
          <th>#</th><th>Ticket</th><th>Hora</th><th>Cliente</th><th>Vehiculo</th><th>Servicio(s)</th>
          <th class="right">Subtotal</th><th class="right">ITBIS</th><th class="right">Total</th><th>Pago</th><th>NCF</th><th>Estado</th>
        </tr></thead><tbody>
          ${transactions.map((t, i) => `<tr>
            <td>${i + 1}</td><td class="bold">${t.ticketNo}</td>
            <td>${t.date instanceof Date ? fmtTime(t.date) : ''}</td>
            <td>${t.client}</td><td>${t.vehicle}</td>
            <td>${(t.services || []).map(s => s.name).join(', ') || '—'}</td>
            <td class="right money">${fmtMoney(t.subtotal)}</td>
            <td class="right">${fmtMoney(t.itbis)}</td>
            <td class="right money">${fmtMoney(t.total)}</td>
            <td>${pmLabels[t.payMethod] || t.payMethod}</td>
            <td>${t.ncf || '—'}</td>
            <td${t.estado === 'nula' ? ' class="void"' : ''}>${t.estado === 'nula' ? 'ANULADA' : 'OK'}</td>
          </tr>`).join('')}
        </tbody><tfoot><tr>
          <td colspan="6">TOTALES (${summary.count} tickets)</td>
          <td class="right">${fmtMoney(summary.total - summary.itbis)}</td>
          <td class="right">${fmtMoney(summary.itbis)}</td>
          <td class="right">${fmtMoney(summary.total)}</td>
          <td colspan="3"></td>
        </tr></tfoot></table>
      </div>
      ${buildFooterHtml()}
    </div>
  </body></html>`
  openReport(html)
}

// ── Commission Detail (individual worker) ──────────────────────────────────
export async function printCommissionDetail(biz, tickets, personName, pct, period) {
  const logo = await getLogoDataUrl(biz)
  const totalBase = tickets.reduce((s, t) => s + t.commBase, 0)
  const totalComm = tickets.reduce((s, t) => s + t.commission, 0)

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Comisiones — ${personName}</title><style>${STYLES}</style></head><body>
    <div class="page">
      ${buildLetterhead(biz, logo)}
      <div class="print-bar no-print">
        <button class="btn btn-primary" onclick="window.print()">Imprimir / Guardar PDF</button>
        <button class="btn btn-secondary" onclick="window.close()">Cerrar</button>
      </div>
      <div class="report-title"><h2>Reporte de Comisiones — Detalle Individual</h2><div class="period">Periodo: ${period}</div></div>
      <div class="summary-grid">
        <div class="summary-card"><div class="label">Empleado</div><div class="value">${personName}</div></div>
        <div class="summary-card"><div class="label">Comision</div><div class="value">${pct}%</div></div>
        <div class="summary-card"><div class="label">Tickets</div><div class="value">${tickets.length}</div></div>
        <div class="summary-card"><div class="label">Total Comision</div><div class="value">${fmtMoney(totalComm)}</div></div>
      </div>
      <div class="section">
        <div class="section-title">Detalle por Ticket</div>
        <table><thead><tr>
          <th>#</th><th>Ticket</th><th>Fecha</th><th>Vehiculo</th><th>Servicio</th>
          <th class="right">Base</th><th class="center">%</th><th class="right">Comision</th><th>Estado</th>
        </tr></thead><tbody>
          ${tickets.map((t, i) => `<tr>
            <td>${i + 1}</td><td class="bold">${t.ticketNo}</td>
            <td>${fmtDateShort(t.date)}</td><td>${t.vehicle}</td>
            <td>${t.mainService?.name || '—'}</td>
            <td class="right money">${fmtMoney(t.commBase)}</td>
            <td class="center">${t.pct}%</td>
            <td class="right money">${fmtMoney(t.commission)}</td>
            <td>${t.estado}</td>
          </tr>`).join('')}
        </tbody><tfoot><tr>
          <td colspan="5">TOTALES (${tickets.length} tickets)</td>
          <td class="right">${fmtMoney(totalBase)}</td><td></td>
          <td class="right">${fmtMoney(totalComm)}</td><td></td>
        </tr></tfoot></table>
      </div>
      ${buildFooterHtml()}
    </div>
  </body></html>`
  openReport(html)
}

// ── Commission Summary (all workers) ───────────────────────────────────────
export async function printCommissionSummary(biz, summaries, groupLabel, period) {
  const logo = await getLogoDataUrl(biz)
  const totalBase = summaries.reduce((s, w) => s + (w.total_base || w.totalBilled || 0), 0)
  const totalComm = summaries.reduce((s, w) => s + (w.total_commission || w.commission || 0), 0)
  const totalTickets = summaries.reduce((s, w) => s + (w.ticket_count || w.ticketCount || 0), 0)

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Comisiones — ${groupLabel}</title><style>${STYLES}</style></head><body>
    <div class="page">
      ${buildLetterhead(biz, logo)}
      <div class="print-bar no-print">
        <button class="btn btn-primary" onclick="window.print()">Imprimir / Guardar PDF</button>
        <button class="btn btn-secondary" onclick="window.close()">Cerrar</button>
      </div>
      <div class="report-title"><h2>Reporte de Comisiones — ${groupLabel}</h2><div class="period">Periodo: ${period}</div></div>
      <div class="summary-grid">
        <div class="summary-card"><div class="label">Empleados</div><div class="value">${summaries.length}</div></div>
        <div class="summary-card"><div class="label">Total Tickets</div><div class="value">${totalTickets}</div></div>
        <div class="summary-card"><div class="label">Total Base</div><div class="value">${fmtMoney(totalBase)}</div></div>
        <div class="summary-card"><div class="label">Total Comisiones</div><div class="value">${fmtMoney(totalComm)}</div></div>
      </div>
      <div class="section">
        <table><thead><tr>
          <th>#</th><th>Nombre</th><th class="center">%</th><th class="right">Tickets</th>
          <th class="right">Base</th><th class="right">Comision</th>
        </tr></thead><tbody>
          ${summaries.map((w, i) => `<tr>
            <td>${i + 1}</td><td class="bold">${w.washer_name || w.seller_name || w.cajero_name || w.name}</td>
            <td class="center">${w.commission_pct || w.commissionPct || 0}%</td>
            <td class="right">${w.ticket_count || w.ticketCount || 0}</td>
            <td class="right money">${fmtMoney(w.total_base || w.totalBilled || 0)}</td>
            <td class="right money">${fmtMoney(w.total_commission || w.commission || 0)}</td>
          </tr>`).join('')}
        </tbody><tfoot><tr>
          <td colspan="3">TOTALES</td>
          <td class="right">${totalTickets}</td>
          <td class="right">${fmtMoney(totalBase)}</td>
          <td class="right">${fmtMoney(totalComm)}</td>
        </tr></tfoot></table>
      </div>
      ${buildFooterHtml()}
    </div>
  </body></html>`
  openReport(html)
}

// ── Monthly Report ─────────────────────────────────────────────────────────
export async function printMonthlyReport(biz, data, label) {
  const logo = await getLogoDataUrl(biz)
  const { metrics, topClients, topServices, cxc } = data

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reporte Mensual — ${label}</title><style>${STYLES}</style></head><body>
    <div class="page">
      ${buildLetterhead(biz, logo)}
      <div class="print-bar no-print">
        <button class="btn btn-primary" onclick="window.print()">Imprimir / Guardar PDF</button>
        <button class="btn btn-secondary" onclick="window.close()">Cerrar</button>
      </div>
      <div class="report-title"><h2>Reporte Mensual de Ventas</h2><div class="period">${label}</div></div>
      <div class="summary-grid">
        <div class="summary-card"><div class="label">Total Facturado</div><div class="value">${fmtMoney(metrics.facturado)}</div></div>
        <div class="summary-card"><div class="label">Total Cobrado</div><div class="value">${fmtMoney(metrics.cobrado)}</div></div>
        <div class="summary-card"><div class="label">Pendiente</div><div class="value">${fmtMoney(metrics.pendiente)}</div></div>
        <div class="summary-card"><div class="label">Tickets</div><div class="value">${metrics.carros}</div></div>
      </div>
      <div class="section">
        <div class="section-title">Top 5 Clientes</div>
        <table><thead><tr><th>#</th><th>Cliente</th><th class="right">Tickets</th><th class="right">Total</th></tr></thead><tbody>
          ${topClients.map((c, i) => `<tr><td>${i + 1}</td><td class="bold">${c.name}</td><td class="right">${c.tickets}</td><td class="right money">${fmtMoney(c.total)}</td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="section">
        <div class="section-title">Servicios Mas Solicitados</div>
        <table><thead><tr><th>Servicio</th><th class="right">Cantidad</th><th class="right">Total</th></tr></thead><tbody>
          ${topServices.map(s => `<tr><td>${s.name}</td><td class="right">${s.count}</td><td class="right money">${fmtMoney(s.total)}</td></tr>`).join('')}
        </tbody></table>
      </div>
      ${cxc.length > 0 ? `<div class="section">
        <div class="section-title">Cuentas por Cobrar</div>
        <table><thead><tr><th>Cliente</th><th class="right">Facturado</th><th class="right">Cobrado</th><th class="right">Pendiente</th></tr></thead><tbody>
          ${cxc.map(c => `<tr><td>${c.client}</td><td class="right money">${fmtMoney(c.facturado)}</td><td class="right">${fmtMoney(c.cobrado)}</td><td class="right money">${fmtMoney(c.pendiente)}</td></tr>`).join('')}
        </tbody></table>
      </div>` : ''}
      ${buildFooterHtml()}
    </div>
  </body></html>`
  openReport(html)
}

// ── Liquidacion ────────────────────────────────────────────────────────────
export async function printLiquidacion(biz, emp, liq, tipo) {
  const logo = await getLogoDataUrl(biz)
  const tipoLabel = tipo === 'desahucio' ? 'Desahucio (Art. 87)' : 'Renuncia Voluntaria (Art. 85)'
  const isComm = liq.isCommissionBased
  const dailyRate = (liq.monthlyBase || emp.salary || 0) / 23.83

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Liquidacion — ${emp.nombre}</title><style>${STYLES}</style></head><body>
    <div class="page">
      ${buildLetterhead(biz, logo)}
      <div class="print-bar no-print">
        <button class="btn btn-primary" onclick="window.print()">Imprimir / Guardar PDF</button>
        <button class="btn btn-secondary" onclick="window.close()">Cerrar</button>
      </div>
      <div class="report-title"><h2>Liquidacion de Prestaciones Laborales</h2><div class="period">${tipoLabel}</div></div>
      <div class="section">
        <div class="section-title">Datos del Empleado</div>
        <table><tbody>
          <tr><td class="bold" style="width:200px">Nombre</td><td>${emp.nombre}</td></tr>
          <tr><td class="bold">Cedula</td><td>${emp.cedula || '—'}</td></tr>
          <tr><td class="bold">Cargo</td><td>${emp.tipo}</td></tr>
          <tr><td class="bold">Fecha de Ingreso</td><td>${emp.start_date}</td></tr>
          <tr><td class="bold">Antiguedad</td><td>${liq.antiguedad}</td></tr>
          <tr><td class="bold">${isComm ? 'Ingreso Mensual (Promedio Comisiones)' : 'Salario Mensual'}</td><td>${fmtMoney(liq.monthlyBase || emp.salary)}</td></tr>
          <tr><td class="bold">Salario Diario (÷23.83)</td><td>${fmtMoney(dailyRate)}</td></tr>
        </tbody></table>
      </div>
      <div class="section">
        <div class="section-title">Desglose de Prestaciones</div>
        <table><thead><tr><th>Concepto</th><th class="right">Dias</th><th class="right">Monto</th></tr></thead><tbody>
          <tr><td>Vacaciones</td><td class="right">${liq.vacaciones.days?.toFixed(1) || '—'}</td><td class="right money">${fmtMoney(liq.vacaciones.amount)}</td></tr>
          <tr><td>Salario de Navidad</td><td class="right">—</td><td class="right money">${fmtMoney(liq.navidad.amount)}</td></tr>
          ${tipo === 'desahucio' ? `
          <tr><td>Preaviso (Art. 76)</td><td class="right">${liq.preaviso.days || '—'}</td><td class="right money">${fmtMoney(liq.preaviso.amount)}</td></tr>
          <tr><td>Cesantia (Art. 80)</td><td class="right">${liq.cesantia.days || '—'}</td><td class="right money">${fmtMoney(liq.cesantia.amount)}</td></tr>
          ` : `
          <tr><td>Preaviso</td><td class="right">—</td><td class="right">No aplica</td></tr>
          <tr><td>Cesantia</td><td class="right">—</td><td class="right">No aplica</td></tr>
          `}
        </tbody><tfoot><tr>
          <td colspan="2">TOTAL A PAGAR</td>
          <td class="right">${fmtMoney(liq.total)}</td>
        </tr></tfoot></table>
      </div>
      ${isComm ? '<div class="note">Base de calculo: promedio mensual de comisiones devengadas durante la relacion laboral.</div>' : ''}
      <div class="note">Calculo basado en la Ley 16-92 (Codigo de Trabajo de la Republica Dominicana)</div>
      <div class="signatures">
        <div class="sig-line">Firma del Empleador</div>
        <div class="sig-line">Firma del Empleado</div>
      </div>
      ${buildFooterHtml()}
    </div>
  </body></html>`
  openReport(html)
}
