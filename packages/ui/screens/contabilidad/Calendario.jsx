// Calendario — DGII obligations next 30 days (Phase 1).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Calendar, Check, Loader2 } from 'lucide-react'
import { useAPI } from '../../context/DataContext'

const STATUS_PILL = {
  pendiente:   'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/30',
  en_revision: 'bg-black text-white border-black dark:bg-white dark:text-black',
  firmado:     'bg-black text-white border-black dark:bg-white dark:text-black',
  radicado:    'bg-[#b3001e] text-white border-[#b3001e]',
  pagado:      'bg-[#b3001e] text-white border-[#b3001e]',
  vencido:     'bg-[#b3001e] text-white border-[#b3001e]',
}

function fmtDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

export default function Calendario() {
  const api = useAPI()
  const [rows, setRows] = useState([])
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [busyId, setBusyId] = useState(null)

  const range = useMemo(() => {
    const today = new Date()
    const end = new Date(); end.setDate(end.getDate() + 30)
    const iso = (d) => d.toISOString().slice(0, 10)
    return { from: iso(today), to: iso(end) }
  }, [])

  const reload = useCallback(async () => {
    if (!api?.contabilidad) return
    const [o, c] = await Promise.all([
      api.contabilidad.obligationsList({
        dateFrom: range.from,
        dateTo: range.to,
        accountingClientId: clientId ? Number(clientId) : undefined,
      }),
      api.contabilidad.clientList(),
    ])
    setRows(o || [])
    setClients(c || [])
  }, [api, range.from, range.to, clientId])

  useEffect(() => { reload() }, [reload])

  async function markFiled(o) {
    const constancia = window.prompt('No. de constancia DGII (opcional)')
    setBusyId(o.id)
    try {
      await api.contabilidad.obligationsMarkFiled(o.id, {
        status: 'radicado',
        dgii_constancia_no: constancia || null,
      })
      await reload()
    } finally {
      setBusyId(null)
    }
  }

  const clientName = (id) => clients.find(c => c.id === id)?.nombre_comercial || '—'

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-black text-black dark:text-white inline-flex items-center gap-2">
          <Calendar size={22} className="text-[#b3001e]" /> Calendario DGII
        </h1>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)}
          className="px-3 py-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-black dark:text-white text-sm">
          <option value="">Todos los clientes</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.nombre_comercial}</option>)}
        </select>
      </div>

      <p className="text-xs text-black/50 dark:text-white/50 mb-3">Próximos 30 días — {fmtDate(range.from)} → {fmtDate(range.to)}</p>

      <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black text-white">
            <tr className="text-left">
              <th className="px-4 py-2 font-bold">Vence</th>
              <th className="px-4 py-2 font-bold">Cliente</th>
              <th className="px-4 py-2 font-bold">Forma</th>
              <th className="px-4 py-2 font-bold">Período</th>
              <th className="px-4 py-2 font-bold">Estado</th>
              <th className="px-4 py-2 font-bold text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan="6" className="px-4 py-10 text-center text-black/40 dark:text-white/40">Sin obligaciones en este rango</td></tr>
            )}
            {rows.map(o => (
              <tr key={o.id} className="border-b border-black/5 dark:border-white/10 hover:bg-[#b3001e]/5">
                <td className="px-4 py-2 font-bold text-black dark:text-white">{fmtDate(o.due_date)}</td>
                <td className="px-4 py-2 text-black/70 dark:text-white/70">{clientName(o.accounting_client_id)}</td>
                <td className="px-4 py-2 font-mono text-black dark:text-white">{o.form_type}</td>
                <td className="px-4 py-2 text-black/70 dark:text-white/70">
                  {o.period_month ? `${String(o.period_month).padStart(2,'0')}/${o.period_year}` : `${o.period_year}`}
                </td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${STATUS_PILL[o.status] || ''}`}>{o.status}</span>
                </td>
                <td className="px-4 py-2 text-right">
                  {o.status === 'pendiente' && (
                    <button onClick={() => markFiled(o)} disabled={busyId === o.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#b3001e] text-white text-xs font-bold disabled:opacity-50 hover:bg-[#c8002a]">
                      {busyId === o.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Radicar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
