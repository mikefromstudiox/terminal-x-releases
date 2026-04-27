// Honorarios — billing plans + invoices + cobranza tabs (Phase 1).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Banknote, Plus, MessageCircle, Loader2 } from 'lucide-react'
import { useAPI } from '../../context/DataContext'

const TABS = [
  { id: 'plans',    label: 'Planes' },
  { id: 'invoices', label: 'Facturas' },
  { id: 'cobranza', label: 'Cobranza' },
]

export default function Honorarios() {
  const api = useAPI()
  const [tab, setTab] = useState('plans')
  const [plans, setPlans] = useState([])
  const [invoices, setInvoices] = useState([])
  const [clients, setClients] = useState([])
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)

  const reload = useCallback(async () => {
    if (!api?.contabilidad) return
    const [p, i, c] = await Promise.all([
      api.contabilidad.billingPlanList(),
      api.contabilidad.billingInvoiceList(),
      api.contabilidad.clientList(),
    ])
    setPlans(p || [])
    setInvoices(i || [])
    setClients(c || [])
  }, [api])

  useEffect(() => { reload() }, [reload])

  const clientName = (id) => clients.find(c => c.id === id)?.nombre_comercial || '—'

  // ── Cobranza aging buckets ────────────────────────────────────────────────
  const aging = useMemo(() => {
    const today = new Date()
    const buckets = { '0-30': [], '31-60': [], '61-90': [], '90+': [] }
    for (const inv of invoices) {
      if (inv.status === 'paid' || inv.status === 'void') continue
      const issued = new Date(inv.created_at || today)
      const days = Math.floor((today - issued) / 86400000)
      const bk = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+'
      buckets[bk].push({ ...inv, days })
    }
    return buckets
  }, [invoices])

  async function emitFromPlan(plan) {
    setBusy(true)
    try {
      const today = new Date()
      await api.contabilidad.billingInvoiceCreate({
        accounting_client_id: plan.accounting_client_id,
        period_year: today.getFullYear(),
        period_month: today.getMonth() + 1,
        amount: plan.monthly_amount,
        currency: plan.currency,
        status: 'issued',
      })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function markPaid(inv) {
    await api.contabilidad.billingInvoiceMarkPaid(inv.id)
    await reload()
  }

  function whatsappReminder(inv) {
    const c = clients.find(x => x.id === inv.accounting_client_id)
    const tel = (c?.notes || '').match(/8\d{9}/)?.[0]
    const msg = encodeURIComponent(`Buen día ${c?.nombre_comercial || ''}. Le recordamos su factura por honorarios de RD$${Number(inv.amount || 0).toFixed(2)} pendiente. Gracias.`)
    window.open(`https://wa.me/${tel ? '1' + tel : ''}?text=${msg}`, '_blank', 'noopener')
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-black text-black dark:text-white inline-flex items-center gap-2">
          <Banknote size={22} className="text-[#b3001e]" /> Honorarios
        </h1>
        <button onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#b3001e] hover:bg-[#c8002a] text-white text-sm font-bold">
          <Plus size={16} /> Nuevo plan
        </button>
      </div>

      <div className="flex gap-1 mb-5 border-b border-black/10 dark:border-white/10">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px ${tab === t.id ? 'border-[#b3001e] text-[#b3001e]' : 'border-transparent text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'plans' && (
        <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black text-white"><tr className="text-left">
              <th className="px-4 py-2 font-bold">Cliente</th>
              <th className="px-4 py-2 font-bold">Monto</th>
              <th className="px-4 py-2 font-bold">Día</th>
              <th className="px-4 py-2 font-bold">e-CF</th>
              <th className="px-4 py-2 font-bold">Activo</th>
              <th className="px-4 py-2 font-bold text-right">Acciones</th>
            </tr></thead>
            <tbody>
              {plans.length === 0 && <tr><td colSpan="6" className="px-4 py-10 text-center text-black/40 dark:text-white/40">Sin planes activos</td></tr>}
              {plans.map(p => (
                <tr key={p.id} className="border-b border-black/5 dark:border-white/10">
                  <td className="px-4 py-2 font-bold text-black dark:text-white">{clientName(p.accounting_client_id)}</td>
                  <td className="px-4 py-2 text-black dark:text-white">RD$ {Number(p.monthly_amount || 0).toFixed(2)}</td>
                  <td className="px-4 py-2 text-black/70 dark:text-white/70">{p.bill_day}</td>
                  <td className="px-4 py-2 font-mono text-black dark:text-white uppercase">{p.ecf_type}</td>
                  <td className="px-4 py-2">{p.active ? '✓' : '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => emitFromPlan(p)} disabled={busy}
                      className="px-2.5 py-1 rounded-lg bg-[#b3001e] text-white text-xs font-bold hover:bg-[#c8002a] disabled:opacity-50">
                      Emitir e-CF {p.ecf_type?.toUpperCase()}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'invoices' && (
        <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black text-white"><tr className="text-left">
              <th className="px-4 py-2 font-bold">Cliente</th>
              <th className="px-4 py-2 font-bold">Período</th>
              <th className="px-4 py-2 font-bold">Monto</th>
              <th className="px-4 py-2 font-bold">Estado</th>
              <th className="px-4 py-2 font-bold text-right">Acciones</th>
            </tr></thead>
            <tbody>
              {invoices.length === 0 && <tr><td colSpan="5" className="px-4 py-10 text-center text-black/40 dark:text-white/40">Sin facturas</td></tr>}
              {invoices.map(inv => (
                <tr key={inv.id} className="border-b border-black/5 dark:border-white/10">
                  <td className="px-4 py-2 font-bold text-black dark:text-white">{clientName(inv.accounting_client_id)}</td>
                  <td className="px-4 py-2 text-black/70 dark:text-white/70">{String(inv.period_month).padStart(2,'0')}/{inv.period_year}</td>
                  <td className="px-4 py-2 text-black dark:text-white">RD$ {Number(inv.amount || 0).toFixed(2)}</td>
                  <td className="px-4 py-2"><span className="px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/30">{inv.status}</span></td>
                  <td className="px-4 py-2 text-right space-x-2">
                    {inv.status !== 'paid' && (
                      <button onClick={() => markPaid(inv)}
                        className="px-2.5 py-1 rounded-lg bg-black text-white text-xs hover:bg-[#b3001e] dark:bg-white dark:text-black dark:hover:bg-[#b3001e] dark:hover:text-white">
                        Marcar pagada
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'cobranza' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(aging).map(([range, list]) => (
            <div key={range} className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 p-4">
              <h3 className="font-black text-black dark:text-white mb-2">{range} días</h3>
              <p className="text-2xl font-black text-[#b3001e] mb-3">RD$ {list.reduce((s,i)=>s+Number(i.amount||0),0).toFixed(2)}</p>
              <ul className="space-y-1 text-xs">
                {list.length === 0 && <li className="text-black/40 dark:text-white/40">— vacío —</li>}
                {list.map(inv => (
                  <li key={inv.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-black/80 dark:text-white/80">{clientName(inv.accounting_client_id)}</span>
                    <button onClick={() => whatsappReminder(inv)} className="text-[#b3001e] hover:text-[#c8002a] shrink-0"><MessageCircle size={14} /></button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <PlanModal
          clients={clients}
          onClose={() => setCreating(false)}
          onSave={async (input) => {
            await api.contabilidad.billingPlanCreate(input)
            setCreating(false)
            await reload()
          }}
        />
      )}
    </div>
  )
}

function PlanModal({ clients, onClose, onSave }) {
  const [form, setForm] = useState({
    accounting_client_id: clients[0]?.id || null,
    monthly_amount: 0, currency: 'DOP', bill_day: 1, ecf_type: 'e32',
    late_fee_pct: 0, late_fee_after_days: 0, active: true, notes: '',
  })
  const [busy, setBusy] = useState(false)
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }
  async function submit() {
    setBusy(true)
    try { await onSave(form) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-black border border-black/10 dark:border-white/10 p-6">
        <h2 className="text-lg font-black text-black dark:text-white mb-4">Nuevo plan</h2>
        <div className="space-y-3 text-sm">
          <select value={form.accounting_client_id || ''} onChange={(e) => set('accounting_client_id', Number(e.target.value))}
            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white">
            {clients.map(c => <option key={c.id} value={c.id}>{c.nombre_comercial}</option>)}
          </select>
          <input type="number" step="0.01" placeholder="Monto mensual"
            value={form.monthly_amount} onChange={(e) => set('monthly_amount', Number(e.target.value))}
            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white" />
          <input type="number" min="1" max="28" placeholder="Día de facturación"
            value={form.bill_day} onChange={(e) => set('bill_day', Number(e.target.value))}
            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white" />
          <select value={form.ecf_type} onChange={(e) => set('ecf_type', e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white">
            <option value="e32">E32 - Consumo</option>
            <option value="e31">E31 - Crédito fiscal</option>
          </select>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-black/15 dark:border-white/15 text-sm">Cancelar</button>
          <button disabled={busy || !form.accounting_client_id} onClick={submit}
            className="px-4 py-2 rounded-lg bg-[#b3001e] text-white text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1">
            {busy && <Loader2 size={12} className="animate-spin" />} Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
