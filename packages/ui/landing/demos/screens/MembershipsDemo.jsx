// MembershipsDemo — faithful copy of salon/Memberships.jsx (also fits carwash).
// Active members table + plan tier cards + new-member button. Auto-bill toggle.

import { useState } from 'react'
import { Crown, Plus, Search, X, Calendar, CreditCard, RefreshCw, AlertTriangle, MessageCircle } from 'lucide-react'

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}` }
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) }

const TIERS = [
  { id: 'basic',   label: 'Básico',  price: 1500, color: 'bg-slate-200 text-slate-700',  perks: ['4 lavados express/mes', 'Membresía digital', '5% descuento productos'] },
  { id: 'premium', label: 'Premium', price: 3500, color: 'bg-amber-200 text-amber-900',  perks: ['8 lavados completos/mes', '1 encerado/mes', '10% descuento productos', 'Cita prioritaria'] },
  { id: 'vip',     label: 'VIP',     price: 7500, color: 'bg-[#b3001e] text-white',      perks: ['Lavados ilimitados', '2 detallados/mes', '15% descuento productos', 'Recogida y entrega'] },
]

const SEED_MEMBERS = [
  { id: 1, client: 'Roberto Castillo',     phone: '809-555-1010', tier: 'vip',     start: '2026-01-15', next_billing: '2026-05-15', status: 'active',    auto_bill: true,  card_last4: '4242' },
  { id: 2, client: 'Lucia Almonte',         phone: '829-555-2020', tier: 'premium', start: '2026-02-20', next_billing: '2026-05-20', status: 'active',    auto_bill: true,  card_last4: '8821' },
  { id: 3, client: 'Empresa Logistics',     phone: '809-555-3030', tier: 'vip',     start: '2025-08-12', next_billing: '2026-05-12', status: 'active',    auto_bill: false, card_last4: null },
  { id: 4, client: 'Maria Sanchez',         phone: '829-555-4040', tier: 'basic',   start: '2026-03-05', next_billing: '2026-05-05', status: 'active',    auto_bill: true,  card_last4: '1102' },
  { id: 5, client: 'Carmen Diaz',           phone: '849-555-5050', tier: 'premium', start: '2026-01-22', next_billing: '2026-04-22', status: 'past_due', auto_bill: true,  card_last4: '7733' },
  { id: 6, client: 'Pedro Vasquez',         phone: '809-555-6060', tier: 'basic',   start: '2025-11-08', next_billing: '2026-05-08', status: 'active',    auto_bill: true,  card_last4: '5500' },
  { id: 7, client: 'Sra. Mendez',           phone: '849-555-7070', tier: 'premium', start: '2025-12-15', next_billing: '2026-05-15', status: 'active',    auto_bill: false, card_last4: null },
  { id: 8, client: 'Hotel Atlantico',       phone: '809-555-8080', tier: 'vip',     start: '2025-06-01', next_billing: '2026-05-01', status: 'cancelled', auto_bill: false, card_last4: null },
]

const STATUS_STYLE = {
  active:    'bg-emerald-100 text-emerald-700',
  past_due:  'bg-red-100 text-red-700',
  cancelled: 'bg-slate-200 text-slate-600',
}
const STATUS_LABEL = { active: 'Al día', past_due: 'Atrasado', cancelled: 'Cancelado' }

export default function MembershipsDemo() {
  const [members]           = useState(SEED_MEMBERS)
  const [search, setSearch] = useState('')
  const [tierFilter, setTier] = useState('all')
  const [editing, setEditing] = useState(null)

  const filtered = members.filter(m => {
    if (tierFilter !== 'all' && m.tier !== tierFilter) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return m.client.toLowerCase().includes(q) || m.phone.includes(q)
  })

  const counts = TIERS.reduce((acc, t) => ({ ...acc, [t.id]: members.filter(m => m.tier === t.id && m.status === 'active').length }), {})
  const mrr = members.filter(m => m.status === 'active').reduce((s, m) => s + (TIERS.find(t => t.id === m.tier)?.price || 0), 0)

  return (
    <div className="p-6 max-w-6xl mx-auto h-full overflow-y-auto bg-white">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3"><Crown size={26} className="text-[#b3001e]" /> Membresías</h1>
          <p className="text-sm text-slate-500 mt-1">{members.filter(m => m.status === 'active').length} activos · MRR {fmtRD(mrr)}</p>
        </div>
        <button onClick={() => setEditing({})} className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#b3001e] text-white rounded-lg text-sm font-bold hover:bg-[#8c0017]"><Plus size={14} /> Nuevo miembro</button>
      </div>

      {/* Tier cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {TIERS.map(t => (
          <div key={t.id} className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className={`text-[10px] font-bold uppercase tracking-[2px] px-2 py-0.5 rounded ${t.color}`}>{t.label}</span>
              <Crown size={16} className="text-[#b3001e]" />
            </div>
            <p className="text-[28px] font-extrabold text-slate-900 tabular-nums">{fmtRD(t.price)}<span className="text-[12px] font-semibold text-slate-400">/mes</span></p>
            <ul className="mt-3 space-y-1">
              {t.perks.map((p, i) => (
                <li key={i} className="text-[12px] text-slate-600 flex gap-1.5"><span className="text-[#b3001e]">✓</span> {p}</li>
              ))}
            </ul>
            <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between">
              <p className="text-[10px] text-slate-400 uppercase tracking-wider">Activos</p>
              <p className="text-[18px] font-bold text-slate-800 tabular-nums">{counts[t.id] || 0}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters + search */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-sky-400 w-64">
          <Search size={13} className="text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar miembro..." className="flex-1 text-[12px] bg-transparent outline-none" />
        </div>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
          {[{ id: 'all', label: 'Todos' }, ...TIERS.map(t => ({ id: t.id, label: t.label }))].map(f => (
            <button key={f.id} onClick={() => setTier(f.id)} className={`px-3 py-1.5 font-medium transition ${tierFilter === f.id ? 'bg-black text-white' : 'text-slate-500 hover:bg-slate-50'}`}>{f.label}</button>
          ))}
        </div>
      </div>

      {/* Members table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
              <th className="text-left px-4 py-2.5 font-bold">Plan</th>
              <th className="text-left px-4 py-2.5 font-bold">Inicio</th>
              <th className="text-left px-4 py-2.5 font-bold">Próx. cobro</th>
              <th className="text-center px-4 py-2.5 font-bold">Auto-bill</th>
              <th className="text-left px-4 py-2.5 font-bold">Tarjeta</th>
              <th className="text-right px-4 py-2.5 font-bold">Estado</th>
              <th className="text-right px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(m => {
              const tier = TIERS.find(t => t.id === m.tier)
              return (
                <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-4 py-3"><p className="font-semibold text-slate-800">{m.client}</p><p className="text-[10px] text-slate-400">{m.phone}</p></td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${tier.color}`}>{tier.label}</span><p className="text-[10px] text-slate-500 mt-1">{fmtRD(tier.price)}/mes</p></td>
                  <td className="px-4 py-3 text-slate-600">{fmtDate(m.start)}</td>
                  <td className="px-4 py-3 text-slate-600">{fmtDate(m.next_billing)}</td>
                  <td className="px-4 py-3 text-center">
                    <div className={`w-8 h-4 rounded-full inline-block relative ${m.auto_bill ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${m.auto_bill ? 'right-0.5' : 'left-0.5'}`} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 font-mono">{m.card_last4 ? `··· ${m.card_last4}` : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${STATUS_STYLE[m.status]} inline-flex items-center gap-1`}>
                      {m.status === 'past_due' && <AlertTriangle size={9} />} {STATUS_LABEL[m.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing(m)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"><RefreshCw size={13} /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-slate-800">{editing.id ? 'Gestionar membresía' : 'Nueva membresía'}</h3>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-3">
              <label className="block"><span className="text-xs font-semibold text-slate-500">Cliente</span><input defaultValue={editing.client} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" /></label>
              <label className="block"><span className="text-xs font-semibold text-slate-500">Plan</span>
                <select defaultValue={editing.tier} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">{TIERS.map(t => <option key={t.id} value={t.id}>{t.label} · {fmtRD(t.price)}/mes</option>)}</select>
              </label>
              <label className="flex items-center gap-2 text-sm pt-2"><input type="checkbox" defaultChecked={editing.auto_bill} className="accent-[#b3001e]" /> Cobro automático con tarjeta</label>
              <div className="flex gap-2 pt-2">
                <button className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm font-semibold hover:bg-slate-50"><MessageCircle size={13} /> WhatsApp</button>
                <button className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm font-semibold hover:bg-slate-50"><CreditCard size={13} /> Cobrar ahora</button>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50">Cancelar</button>
              <button onClick={() => setEditing(null)} className="px-4 py-2 bg-[#b3001e] text-white rounded-lg text-sm font-bold hover:bg-[#8c0017]">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
