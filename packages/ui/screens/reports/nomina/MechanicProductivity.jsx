import { useState, useEffect, useMemo } from 'react'
import { Wrench, Loader2, Download } from 'lucide-react'
import { useAPI } from '../../../context/DataContext'
import { useLang } from '../../../i18n'

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function startOfMonthISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export default function MechanicProductivity({ onExportToNomina }) {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [from, setFrom] = useState(startOfMonthISO())
  const [to, setTo] = useState(todayISO())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  async function refresh() {
    setLoading(true)
    const r = await api.mechanic?.productivityForPeriod?.({ period_start: from, period_end: to }).catch(() => [])
    setRows(r || [])
    setLoading(false)
  }
  useEffect(() => { refresh() }, [from, to]) // eslint-disable-line

  const totals = useMemo(() => ({
    hours: rows.reduce((s, r) => s + (Number(r.hours_total) || 0), 0),
    labor: rows.reduce((s, r) => s + (Number(r.labor_total) || 0), 0),
    revenue: rows.reduce((s, r) => s + (Number(r.revenue_total) || 0), 0),
    commission: rows.reduce((s, r) => s + ((Number(r.labor_total) || 0) * (Number(r.commission_pct || 0) / 100)), 0),
  }), [rows])

  function exportCsv() {
    const headers = ['Mecánico','WO','Horas','Comision %','Comision RD$','Mano de obra','Ingreso']
    const lines = [headers.join(',')]
    for (const r of rows) {
      const com = (Number(r.labor_total) || 0) * (Number(r.commission_pct || 0) / 100)
      lines.push([r.nombre, r.wo_count, (r.hours_total || 0).toFixed(2), r.commission_pct || 0, com.toFixed(2), (r.labor_total || 0).toFixed(2), (r.revenue_total || 0).toFixed(2)].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `mecanica-productividad-${from}-a-${to}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4">
      <div className="flex items-end gap-3 mb-4 flex-wrap">
        <div>
          <label className="block text-xs font-bold uppercase mb-1 dark:text-white">{L('Desde','From')}</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="p-2 border border-black dark:border-white/30 dark:bg-white/5 dark:text-white"/>
        </div>
        <div>
          <label className="block text-xs font-bold uppercase mb-1 dark:text-white">{L('Hasta','To')}</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="p-2 border border-black dark:border-white/30 dark:bg-white/5 dark:text-white"/>
        </div>
        <button onClick={exportCsv} className="ml-auto px-3 py-2 border border-black dark:border-white dark:text-white flex items-center gap-2"><Download size={14}/>CSV</button>
        {onExportToNomina && (
          <button onClick={() => onExportToNomina(rows)} className="px-3 py-2 bg-[#b3001e] text-white font-bold hover:bg-black flex items-center gap-2">
            <Wrench size={14}/>{L('Exportar a Nómina','Export to Payroll')}
          </button>
        )}
      </div>

      {loading ? <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto"/></div> : (
        <div className="border border-black dark:border-white/20 bg-white dark:bg-white/5">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs uppercase tracking-wide bg-black text-white">
            <div className="col-span-3">{L('Mecánico','Mechanic')}</div>
            <div className="col-span-1 text-right">WO</div>
            <div className="col-span-2 text-right">{L('Horas WO','WO Hours')}</div>
            <div className="col-span-1 text-right">% Com.</div>
            <div className="col-span-2 text-right">{L('Comisión calc.','Commission')}</div>
            <div className="col-span-2 text-right">{L('Mano de obra','Labor')}</div>
            <div className="col-span-1 text-right">{L('Ingreso','Revenue')}</div>
          </div>
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-black/50 dark:text-white/50">{L('Sin actividad en el periodo.','No activity in this period.')}</p>
          ) : rows.map(r => {
            const com = (Number(r.labor_total) || 0) * (Number(r.commission_pct || 0) / 100)
            return (
              <div key={r.empleado_id} className="grid grid-cols-12 gap-2 px-4 py-3 text-sm border-t border-black/10 dark:border-white/10 dark:text-white">
                <div className="col-span-3 font-semibold">{r.nombre}</div>
                <div className="col-span-1 text-right">{r.wo_count}</div>
                <div className="col-span-2 text-right">{(Number(r.hours_total) || 0).toFixed(1)}</div>
                <div className="col-span-1 text-right">{r.commission_pct || 0}%</div>
                <div className="col-span-2 text-right font-bold">{fmtRD(com)}</div>
                <div className="col-span-2 text-right">{fmtRD(r.labor_total)}</div>
                <div className="col-span-1 text-right">{fmtRD(r.revenue_total)}</div>
              </div>
            )
          })}
          {rows.length > 0 && (
            <div className="grid grid-cols-12 gap-2 px-4 py-3 text-sm border-t-2 border-black dark:border-white bg-black/5 dark:bg-white/10 dark:text-white font-bold">
              <div className="col-span-3">{L('Totales','Totals')}</div>
              <div className="col-span-1 text-right">{rows.length}</div>
              <div className="col-span-2 text-right">{totals.hours.toFixed(1)}</div>
              <div className="col-span-1"></div>
              <div className="col-span-2 text-right">{fmtRD(totals.commission)}</div>
              <div className="col-span-2 text-right">{fmtRD(totals.labor)}</div>
              <div className="col-span-1 text-right">{fmtRD(totals.revenue)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
