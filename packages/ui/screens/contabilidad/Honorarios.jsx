// Honorarios — billing plans + invoices + cobranza tabs (Phase 1).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Banknote, Plus, MessageCircle, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import { useAPI } from '../../context/DataContext'

const TABS = [
  { id: 'plans',    label: 'Planes' },
  { id: 'invoices', label: 'Facturas' },
  { id: 'cobranza', label: 'Cobranza' },
]

// Pure projection helper (mirrors data/electron.js + data/contabilidad.js).
// Formula: late_fee = monthly_amount * (late_fee_pct / 100) when ageDays > late_fee_after_days.
function projectLateFee(inv, plan) {
  if (!inv || !plan) return { amount: 0, applies: false, ageDays: 0 }
  if (inv.status === 'paid' || inv.status === 'void') return { amount: 0, applies: false, ageDays: 0 }
  const pct  = Number(plan.late_fee_pct || 0)
  const days = Number(plan.late_fee_after_days || 0)
  if (pct <= 0 || days <= 0 || !inv.created_at) return { amount: 0, applies: false, ageDays: 0 }
  const issued = new Date(inv.created_at).getTime()
  const ageDays = Math.floor((Date.now() - issued) / 86400000)
  if (ageDays <= days) return { amount: 0, applies: false, ageDays }
  const base = Number(inv.amount || plan.monthly_amount || 0)
  return { amount: Math.round(base * (pct / 100) * 100) / 100, applies: true, ageDays }
}

const fmt = (n) => `RD$ ${Number(n || 0).toFixed(2)}`

export default function Honorarios() {
  const api = useAPI()
  const [tab, setTab] = useState('plans')
  const [plans, setPlans] = useState([])
  const [invoices, setInvoices] = useState([])
  const [clients, setClients] = useState([])
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingPlan, setEditingPlan] = useState(null)
  const [recomputeNonce, setRecomputeNonce] = useState(0)
  const [recomputeMsg, setRecomputeMsg] = useState('')

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
  const planFor = useCallback((clientId) => plans.find(p => p.accounting_client_id === clientId && (p.active === 1 || p.active === true)) || null, [plans])

  // ── Projected mora map (recomputes when nonce bumped) ──────────────────────
  const projectedMap = useMemo(() => {
    const m = new Map()
    for (const inv of invoices) {
      const plan = planFor(inv.accounting_client_id)
      m.set(inv.id, projectLateFee(inv, plan))
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, plans, recomputeNonce])

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

  async function savePlanEdit(patch) {
    if (!editingPlan) return
    await api.contabilidad.billingPlanUpdate(editingPlan.id, patch)
    setEditingPlan(null)
    await reload()
  }

  function recomputeProjections() {
    setRecomputeNonce(n => n + 1)
    const overdue = invoices.filter(inv => {
      if (inv.status === 'paid' || inv.status === 'void') return false
      const plan = planFor(inv.accounting_client_id)
      return projectLateFee(inv, plan).applies
    }).length
    setRecomputeMsg(`${overdue} factura${overdue === 1 ? '' : 's'} con mora proyectada actualizada${overdue === 1 ? '' : 's'}.`)
    setTimeout(() => setRecomputeMsg(''), 4000)
  }

  function whatsappReminder(inv) {
    const c = clients.find(x => x.id === inv.accounting_client_id)
    const tel = (c?.notes || '').match(/8\d{9}/)?.[0]
    const proj = projectedMap.get(inv.id)
    const moraStr = proj?.applies ? ` (incluye recargo por mora ${fmt(proj.amount)})` : ''
    const total = Number(inv.amount || 0) + (proj?.applies ? proj.amount : 0)
    const msg = encodeURIComponent(`Buen día ${c?.nombre_comercial || ''}. Le recordamos su factura por honorarios de ${fmt(total)}${moraStr} pendiente. Gracias.`)
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
              <th className="px-4 py-2 font-bold">Mora</th>
              <th className="px-4 py-2 font-bold">e-CF</th>
              <th className="px-4 py-2 font-bold">Activo</th>
              <th className="px-4 py-2 font-bold text-right">Acciones</th>
            </tr></thead>
            <tbody>
              {plans.length === 0 && <tr><td colSpan="7" className="px-4 py-10 text-center text-black/40 dark:text-white/40">Sin planes activos</td></tr>}
              {plans.map(p => (
                <tr key={p.id} className="border-b border-black/5 dark:border-white/10">
                  <td className="px-4 py-2 font-bold text-black dark:text-white">{clientName(p.accounting_client_id)}</td>
                  <td className="px-4 py-2 text-black dark:text-white">{fmt(p.monthly_amount)}</td>
                  <td className="px-4 py-2 text-black/70 dark:text-white/70">{p.bill_day}</td>
                  <td className="px-4 py-2 text-black/70 dark:text-white/70">
                    {Number(p.late_fee_pct || 0) > 0 && Number(p.late_fee_after_days || 0) > 0
                      ? <span>{Number(p.late_fee_pct).toFixed(2)}% tras {p.late_fee_after_days}d</span>
                      : <span className="text-black/30 dark:text-white/30">—</span>}
                  </td>
                  <td className="px-4 py-2 font-mono text-black dark:text-white uppercase">{p.ecf_type}</td>
                  <td className="px-4 py-2">{p.active ? '✓' : '—'}</td>
                  <td className="px-4 py-2 text-right space-x-2">
                    <button onClick={() => setEditingPlan(p)}
                      className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 text-xs font-bold text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/10">
                      Editar
                    </button>
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
          <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-black/10 dark:border-white/10">
            <div className="text-xs text-black/60 dark:text-white/60">
              {recomputeMsg || 'La mora se calcula al marcar pagada. Use "Reaplicar mora" para refrescar la proyección de facturas vencidas.'}
            </div>
            <button onClick={recomputeProjections}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 text-xs font-bold text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/10">
              <RefreshCw size={12} /> Reaplicar mora a facturas vencidas
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-black text-white"><tr className="text-left">
              <th className="px-4 py-2 font-bold">Cliente</th>
              <th className="px-4 py-2 font-bold">Período</th>
              <th className="px-4 py-2 font-bold">Monto</th>
              <th className="px-4 py-2 font-bold">Mora</th>
              <th className="px-4 py-2 font-bold">Total</th>
              <th className="px-4 py-2 font-bold">Estado</th>
              <th className="px-4 py-2 font-bold text-right">Acciones</th>
            </tr></thead>
            <tbody>
              {invoices.length === 0 && <tr><td colSpan="7" className="px-4 py-10 text-center text-black/40 dark:text-white/40">Sin facturas</td></tr>}
              {invoices.map(inv => {
                const isPaid = inv.status === 'paid'
                const persistedFee = Number(inv.late_fee_amount || 0)
                const paidLate = inv.paid_late === 1 || inv.paid_late === true
                const proj = projectedMap.get(inv.id) || { amount: 0, applies: false }
                const feeShown = isPaid ? persistedFee : proj.amount
                const total = Number(inv.amount || 0) + (isPaid ? persistedFee : (proj.applies ? proj.amount : 0))
                return (
                  <tr key={inv.id} className="border-b border-black/5 dark:border-white/10">
                    <td className="px-4 py-2 font-bold text-black dark:text-white">{clientName(inv.accounting_client_id)}</td>
                    <td className="px-4 py-2 text-black/70 dark:text-white/70">{String(inv.period_month).padStart(2,'0')}/{inv.period_year}</td>
                    <td className="px-4 py-2 text-black dark:text-white">{fmt(inv.amount)}</td>
                    <td className="px-4 py-2">
                      {feeShown > 0
                        ? <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${isPaid ? 'bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-300' : 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/30'}`}>
                            <AlertTriangle size={10} /> {fmt(feeShown)} {isPaid ? '' : '(proy.)'}
                          </span>
                        : <span className="text-black/30 dark:text-white/30">—</span>}
                    </td>
                    <td className="px-4 py-2 text-black dark:text-white">
                      {feeShown > 0
                        ? <span title={`${fmt(inv.amount)} + ${fmt(feeShown)} mora`}>{fmt(total)}</span>
                        : fmt(total)}
                    </td>
                    <td className="px-4 py-2">
                      <span className="px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/30">{inv.status}</span>
                      {paidLate && <span className="ml-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-300">Pagó c/mora</span>}
                    </td>
                    <td className="px-4 py-2 text-right space-x-2">
                      {!isPaid && (
                        <button onClick={() => markPaid(inv)}
                          className="px-2.5 py-1 rounded-lg bg-black text-white text-xs hover:bg-[#b3001e] dark:bg-white dark:text-black dark:hover:bg-[#b3001e] dark:hover:text-white">
                          Marcar pagada
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'cobranza' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(aging).map(([range, list]) => {
            const subtotal = list.reduce((s,i)=>s+Number(i.amount||0),0)
            const moraTotal = list.reduce((s,i)=>{
              const p = projectedMap.get(i.id)
              return s + (p?.applies ? p.amount : 0)
            }, 0)
            return (
              <div key={range} className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 p-4">
                <h3 className="font-black text-black dark:text-white mb-2">{range} días</h3>
                <p className="text-2xl font-black text-[#b3001e] mb-1">{fmt(subtotal + moraTotal)}</p>
                {moraTotal > 0 && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-300 mb-2">incluye {fmt(moraTotal)} de mora proyectada</p>
                )}
                <ul className="space-y-1 text-xs">
                  {list.length === 0 && <li className="text-black/40 dark:text-white/40">— vacío —</li>}
                  {list.map(inv => {
                    const proj = projectedMap.get(inv.id)
                    return (
                      <li key={inv.id} className="flex items-center justify-between gap-2">
                        <span className="truncate text-black/80 dark:text-white/80">
                          {clientName(inv.accounting_client_id)}
                          {proj?.applies && <span className="ml-1 text-amber-600 dark:text-amber-300">+{fmt(proj.amount)}</span>}
                        </span>
                        <button onClick={() => whatsappReminder(inv)} className="text-[#b3001e] hover:text-[#c8002a] shrink-0"><MessageCircle size={14} /></button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
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

      {editingPlan && (
        <PlanModal
          clients={clients}
          initial={editingPlan}
          editing
          onClose={() => setEditingPlan(null)}
          onSave={savePlanEdit}
        />
      )}
    </div>
  )
}

function PlanModal({ clients, onClose, onSave, initial = null, editing = false }) {
  const [form, setForm] = useState({
    accounting_client_id: initial?.accounting_client_id ?? clients[0]?.id ?? null,
    monthly_amount: initial?.monthly_amount ?? 0,
    currency: initial?.currency ?? 'DOP',
    bill_day: initial?.bill_day ?? 1,
    ecf_type: initial?.ecf_type ?? 'e32',
    late_fee_pct: initial?.late_fee_pct ?? 0,
    late_fee_after_days: initial?.late_fee_after_days ?? 0,
    active: initial ? (initial.active === 1 || initial.active === true) : true,
    notes: initial?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }
  async function submit() {
    setBusy(true)
    try {
      if (editing) {
        await onSave({
          monthly_amount: Number(form.monthly_amount) || 0,
          bill_day: Number(form.bill_day) || 1,
          ecf_type: form.ecf_type,
          late_fee_pct: Number(form.late_fee_pct) || 0,
          late_fee_after_days: Number(form.late_fee_after_days) || 0,
          active: form.active ? 1 : 0,
          notes: form.notes || null,
        })
      } else {
        await onSave(form)
      }
    } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-black border border-black/10 dark:border-white/10 p-6">
        <h2 className="text-lg font-black text-black dark:text-white mb-4">{editing ? 'Editar plan' : 'Nuevo plan'}</h2>
        <div className="space-y-3 text-sm">
          <select value={form.accounting_client_id || ''} onChange={(e) => set('accounting_client_id', Number(e.target.value))}
            disabled={editing}
            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white disabled:opacity-60">
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
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-black/60 dark:text-white/60 uppercase">% Mora</label>
              <input type="number" step="0.01" min="0" max="100" placeholder="ej: 5.00"
                value={form.late_fee_pct} onChange={(e) => set('late_fee_pct', Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-black/60 dark:text-white/60 uppercase">Tras (días)</label>
              <input type="number" min="0" placeholder="ej: 30"
                value={form.late_fee_after_days} onChange={(e) => set('late_fee_after_days', Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white" />
            </div>
          </div>
          {editing && (
            <label className="inline-flex items-center gap-2 text-sm text-black dark:text-white">
              <input type="checkbox" checked={!!form.active} onChange={(e) => set('active', e.target.checked)} />
              Plan activo
            </label>
          )}
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
