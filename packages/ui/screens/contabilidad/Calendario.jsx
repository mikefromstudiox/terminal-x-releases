// Calendario — DGII obligations next 30 days (Phase 1).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Calendar, Check, Loader2, MessageCircle, Calculator, X } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { contabilidadVencimiento } from '@terminal-x/services/whatsapp-business-stub.js'
import { calcAnticipoMensual, generateAnticipoSchedule } from '@terminal-x/services/anticiposIsr.js'

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
function fmtMoney(n) {
  return `RD$ ${Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Calcula la cuota mensual de anticipo ISR para un cliente PJ ordinario.
// Devuelve null si no aplica (no es PJ, sin datos base, pérdida, etc.).
function anticipoFor(client) {
  if (!client) return null
  if (client.tipo_persona !== 'pj' || client.regimen !== 'ordinario') return null
  const r = calcAnticipoMensual({
    ingresosBrutosPrevios: Number(client.anticipo_ingresos_brutos_previos || 0),
    isrPrevioPagado: Number(client.anticipo_isr_previo || 0),
    hadLossPreviousYear: !!client.anticipo_had_loss,
  })
  return r
}

export default function Calendario() {
  const api = useAPI()
  const [rows, setRows] = useState([])
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [calcOpen, setCalcOpen] = useState(false)

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

  const clientById = useMemo(() => {
    const m = new Map()
    clients.forEach(c => m.set(c.id, c))
    return m
  }, [clients])
  const clientName = (id) => clientById.get(id)?.nombre_comercial || '—'
  const clientPhone = (id) => {
    const c = clientById.get(id)
    return (c?.notes || '').match(/8\d{9}/)?.[0] || ''
  }
  function whatsappRemind(o) {
    const c = clientById.get(o.accounting_client_id)
    const due = new Date(o.due_date + 'T23:59:59')
    const days = Math.max(0, Math.ceil((due - new Date()) / 86400000))
    const { url } = contabilidadVencimiento({
      phone: clientPhone(o.accounting_client_id),
      cliente: c?.nombre_comercial || '',
      formato: o.form_type,
      dias: days,
    })
    window.open(url, '_blank', 'noopener')
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-black text-black dark:text-white inline-flex items-center gap-2">
          <Calendar size={22} className="text-[#b3001e]" /> Calendario DGII
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setCalcOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-[#b3001e]/30 bg-[#b3001e]/5 text-[#b3001e] text-sm font-bold hover:bg-[#b3001e] hover:text-white">
            <Calculator size={14}/> Anticipos ISR
          </button>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}
            className="px-3 py-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-black dark:text-white text-sm">
            <option value="">Todos los clientes</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.nombre_comercial}</option>)}
          </select>
        </div>
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
              <th className="px-4 py-2 font-bold">Monto</th>
              <th className="px-4 py-2 font-bold">Estado</th>
              <th className="px-4 py-2 font-bold text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan="7" className="px-4 py-10 text-center text-black/40 dark:text-white/40">Sin obligaciones en este rango</td></tr>
            )}
            {rows.map(o => {
              const isAntIr2 = o.form_type === 'ANT-IR2'
              const ant = isAntIr2 ? anticipoFor(clientById.get(o.accounting_client_id)) : null
              return (
                <tr key={o.id} className="border-b border-black/5 dark:border-white/10 hover:bg-[#b3001e]/5">
                  <td className="px-4 py-2 font-bold text-black dark:text-white">{fmtDate(o.due_date)}</td>
                  <td className="px-4 py-2 text-black/70 dark:text-white/70">{clientName(o.accounting_client_id)}</td>
                  <td className="px-4 py-2 font-mono text-black dark:text-white">{o.form_type}</td>
                  <td className="px-4 py-2 text-black/70 dark:text-white/70">
                    {o.period_month ? `${String(o.period_month).padStart(2,'0')}/${o.period_year}` : `${o.period_year}`}
                  </td>
                  <td className="px-4 py-2 text-black dark:text-white">
                    {isAntIr2 ? (
                      ant && ant.anticipoMensual > 0
                        ? <span className="font-bold text-[#b3001e]" title={`Método ${ant.methodChosen === 'method1' ? '1 (1.5% TET)' : '2 (ISR año previo)'} — Art. 314 CT`}>{fmtMoney(ant.anticipoMensual)}</span>
                        : <span className="text-black/40 dark:text-white/40 text-xs">Configurar IR-2 base</span>
                    ) : <span className="text-black/30 dark:text-white/30">—</span>}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${STATUS_PILL[o.status] || ''}`}>{o.status}</span>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap space-x-2">
                    {(o.status === 'pendiente' || o.status === 'en_revision' || o.status === 'firmado') && (
                      <button onClick={() => whatsappRemind(o)} title="Recordar al cliente por WhatsApp"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-black/10 dark:border-white/10 text-black/70 dark:text-white/70 text-xs hover:border-[#b3001e] hover:text-[#b3001e]">
                        <MessageCircle size={12}/>
                      </button>
                    )}
                    {o.status === 'pendiente' && (
                      <button onClick={() => markFiled(o)} disabled={busyId === o.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#b3001e] text-white text-xs font-bold disabled:opacity-50 hover:bg-[#c8002a]">
                        {busyId === o.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Radicar
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {calcOpen && (
        <AnticiposIsrModal
          clients={clients.filter(c => c.tipo_persona === 'pj' && c.regimen === 'ordinario')}
          onClose={() => setCalcOpen(false)}
        />
      )}
    </div>
  )
}

// ─── Anticipos ISR (PJ) calculator ──────────────────────────────────────────
function AnticiposIsrModal({ clients, onClose }) {
  const currentYear = new Date().getFullYear()
  const [clientId, setClientId] = useState(clients[0]?.id || '')
  const selected = clients.find(c => c.id === Number(clientId))
  const [ingresos, setIngresos] = useState(selected?.anticipo_ingresos_brutos_previos || 0)
  const [isrPrev, setIsrPrev] = useState(selected?.anticipo_isr_previo || 0)
  const [hadLoss, setHadLoss] = useState(!!selected?.anticipo_had_loss)
  const [year, setYear] = useState(currentYear)

  // Resync inputs when client changes.
  useEffect(() => {
    setIngresos(selected?.anticipo_ingresos_brutos_previos || 0)
    setIsrPrev(selected?.anticipo_isr_previo || 0)
    setHadLoss(!!selected?.anticipo_had_loss)
  }, [clientId, selected?.anticipo_ingresos_brutos_previos, selected?.anticipo_isr_previo, selected?.anticipo_had_loss])

  const result = useMemo(() => calcAnticipoMensual({
    ingresosBrutosPrevios: Number(ingresos),
    isrPrevioPagado: Number(isrPrev),
    hadLossPreviousYear: hadLoss,
  }), [ingresos, isrPrev, hadLoss])

  const schedule = useMemo(() => generateAnticipoSchedule({
    year, anticipoMensual: result.anticipoMensual,
  }), [year, result.anticipoMensual])

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl rounded-2xl bg-white dark:bg-black border border-black/10 dark:border-white/10 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black text-black dark:text-white inline-flex items-center gap-2">
            <Calculator size={18} className="text-[#b3001e]"/> Anticipos ISR — Persona Jurídica
          </h2>
          <button onClick={onClose} className="text-black/50 dark:text-white/50 hover:text-[#b3001e]"><X size={18}/></button>
        </div>

        <p className="text-xs text-black/50 dark:text-white/50 mb-4">
          Art. 314 Código Tributario — 12 cuotas mensuales. Se paga el MAYOR entre 1.5% de los ingresos brutos del año anterior y el 100% del ISR liquidado, dividido entre 12.
        </p>

        {clients.length === 0 ? (
          <div className="text-sm text-black/60 dark:text-white/60 py-6 text-center">
            No hay clientes Persona Jurídica con régimen Ordinario.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">Cliente</label>
                <select value={clientId} onChange={(e) => setClientId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm">
                  {clients.map(c => <option key={c.id} value={c.id}>{c.nombre_comercial}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">Año del anticipo</label>
                <input type="number" min="2000" max="2100" value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">Ingresos brutos año anterior (RD$)</label>
                <input type="number" min="0" step="0.01" value={ingresos} disabled={hadLoss}
                  onChange={(e) => setIngresos(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm disabled:opacity-50" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">ISR liquidado año anterior (RD$)</label>
                <input type="number" min="0" step="0.01" value={isrPrev} disabled={hadLoss}
                  onChange={(e) => setIsrPrev(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm disabled:opacity-50" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">Pérdida fiscal</label>
                <select value={hadLoss ? '1' : '0'} onChange={(e) => setHadLoss(e.target.value === '1')}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white text-sm">
                  <option value="0">No</option>
                  <option value="1">Sí — anticipo = 0</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <ResultCard label="Método 1 (1.5% TET)" value={fmtMoney(result.method1)} active={result.methodChosen === 'method1'} />
              <ResultCard label="Método 2 (ISR ÷ 12)"  value={fmtMoney(result.method2)} active={result.methodChosen === 'method2'} />
              <ResultCard label="Cuota mensual"        value={fmtMoney(result.anticipoMensual)} highlight />
              <ResultCard label="Total anual"          value={fmtMoney(result.anticipoAnual)} />
            </div>

            <div className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-black text-white">
                  <tr className="text-left">
                    <th className="px-3 py-1.5 font-bold">Período</th>
                    <th className="px-3 py-1.5 font-bold">Vence</th>
                    <th className="px-3 py-1.5 font-bold text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map(s => (
                    <tr key={s.period_month} className="border-b border-black/5 dark:border-white/10">
                      <td className="px-3 py-1.5 font-mono text-black dark:text-white">{String(s.period_month).padStart(2,'0')}/{year}</td>
                      <td className="px-3 py-1.5 text-black/70 dark:text-white/70">{fmtDate(s.due_date)}</td>
                      <td className="px-3 py-1.5 text-right font-bold text-black dark:text-white">{fmtMoney(s.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex justify-end mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-black/15 dark:border-white/15 text-sm">Cerrar</button>
        </div>
      </div>
    </div>
  )
}

function ResultCard({ label, value, active = false, highlight = false }) {
  const cls = highlight
    ? 'border-[#b3001e] bg-[#b3001e] text-white'
    : active
      ? 'border-[#b3001e] bg-[#b3001e]/10 text-[#b3001e]'
      : 'border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-black dark:text-white'
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className={`text-[9px] font-bold uppercase tracking-wider mb-1 ${highlight ? 'text-white/80' : 'opacity-60'}`}>{label}</div>
      <div className="text-lg font-black">{value}</div>
    </div>
  )
}
