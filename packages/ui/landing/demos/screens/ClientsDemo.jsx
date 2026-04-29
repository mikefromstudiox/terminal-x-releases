// ClientsDemo — faithful copy of packages/ui/screens/Clients.jsx render.
// Two-column: searchable list + detail panel. ClientCard layout with avatar
// initials, credit-progress bar, visits/spend, status badges. API stripped.

import { useState, useMemo } from 'react'
import {
  Search, Plus, ChevronRight, AlertTriangle, Phone, Mail, MapPin,
  CreditCard, Calendar, ReceiptText, MessageCircle, Edit2, Trash2, X, ShoppingBag, Star,
} from 'lucide-react'

function fmtRD(n) { return `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function initials(name) { return (name || '?').split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() }
function fmtDate(s) { if (!s) return '—'; return new Date(s).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) }

function clientStatus(c) {
  if (!c.creditLimit) return 'normal'
  if (c.balance > c.creditLimit) return 'overlimit'
  if (c.balance > 0) return 'owing'
  return 'normal'
}

const TIER_STYLE = {
  platinum: { label: 'Platinum', color: 'bg-[#b3001e] text-white' },
  gold:     { label: 'Gold',     color: 'bg-amber-400 text-black' },
  silver:   { label: 'Silver',   color: 'bg-slate-300 text-slate-800' },
  bronze:   { label: 'Bronze',   color: 'bg-slate-200 text-slate-700' },
}

function ClientCard({ client, selected, onClick }) {
  const status = clientStatus(client)
  const pct = client.creditLimit > 0 ? Math.min((client.balance / client.creditLimit) * 100, 100) : 0
  return (
    <button onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b border-slate-100 hover:bg-slate-50 transition-colors ${
        selected ? 'bg-sky-50 border-l-2 border-l-sky-500' : 'border-l-2 border-l-transparent'
      }`}>
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${
          status === 'overlimit' ? 'bg-red-100 text-red-600'
          : status === 'owing'  ? 'bg-amber-50 text-amber-700'
          : 'bg-slate-100 text-slate-600'
        }`}>{initials(client.name)}</div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-bold text-slate-800 truncate">{client.name}</p>
            {status === 'overlimit' && (
              <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                <AlertTriangle size={9} /> Limite excedido
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">{client.rnc ? `RNC ${client.rnc} · ` : ''}{client.phone}</p>

          {client.creditLimit > 0 && (
            <div className="mt-2">
              <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                <span>{fmtRD(client.balance)}</span>
                <span>Limite: {fmtRD(client.creditLimit)}</span>
              </div>
              <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${status === 'overlimit' ? 'bg-red-500' : pct > 70 ? 'bg-amber-400' : 'bg-green-400'}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          <p className="text-[10px] text-slate-400 mt-1.5">
            {client.totalVisits} visitas · {fmtRD(client.totalSpent)} gastados
            {client.lastService ? ` · Ultimo: ${fmtDate(client.lastService)}` : ''}
          </p>
        </div>

        <ChevronRight size={14} className={`shrink-0 mt-2 ${selected ? 'text-sky-500' : 'text-slate-300'}`} />
      </div>
    </button>
  )
}

function DetailPanel({ client, onClose }) {
  if (!client) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-300 p-8">
        <ShoppingBag size={36} className="mb-3" />
        <p className="text-[14px] font-semibold">Selecciona un cliente</p>
        <p className="text-[12px] mt-1 text-slate-400">Elige uno de la lista para ver su perfil completo, historial de servicios, balance y opciones.</p>
      </div>
    )
  }
  const tier = TIER_STYLE[client.tier] || TIER_STYLE.bronze
  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      <div className="shrink-0 border-b border-slate-200 px-6 py-4 flex items-start gap-4">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-600 text-[16px] font-bold flex items-center justify-center shrink-0">{initials(client.name)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[18px] font-extrabold text-slate-900 truncate">{client.name}</h3>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${tier.color}`}>{tier.label}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-500">
            {client.rnc && <span className="font-mono">RNC {client.rnc}</span>}
            <span className="inline-flex items-center gap-1"><Phone size={11} /> {client.phone}</span>
            {client.email && <span className="inline-flex items-center gap-1"><Mail size={11} /> {client.email}</span>}
          </div>
          {client.address && <p className="text-[11px] text-slate-400 mt-1 inline-flex items-center gap-1"><MapPin size={11} /> {client.address}</p>}
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1.5"><X size={16} /></button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-4">
        {[
          { label: 'Visitas',          value: client.totalVisits, icon: Calendar },
          { label: 'Gastado total',    value: fmtRD(client.totalSpent), icon: ReceiptText },
          { label: 'Promedio ticket',  value: fmtRD(client.totalSpent / Math.max(1, client.totalVisits)), icon: Star },
          { label: 'Saldo CxC',        value: fmtRD(client.balance), icon: CreditCard },
        ].map((s, i) => (
          <div key={i} className="bg-slate-50 border border-slate-100 rounded-xl p-3">
            <div className="flex items-center gap-1.5 mb-1"><s.icon size={11} className="text-slate-400" /><span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{s.label}</span></div>
            <p className="text-[16px] font-extrabold text-slate-800 tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <h4 className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-3">Historial reciente</h4>
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="text-left px-3 py-2 font-bold">Fecha</th>
                <th className="text-left px-3 py-2 font-bold">Ticket</th>
                <th className="text-left px-3 py-2 font-bold">Servicio</th>
                <th className="text-right px-3 py-2 font-bold">Monto</th>
                <th className="text-left px-3 py-2 font-bold">Pago</th>
              </tr>
            </thead>
            <tbody>
              {(client.history || []).map((h, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-600">{fmtDate(h.date)}</td>
                  <td className="px-3 py-2 font-mono font-bold text-sky-600 text-[11px]">{h.ticketNo}</td>
                  <td className="px-3 py-2 text-slate-700">{h.service}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-800 tabular-nums">{fmtRD(h.amount)}</td>
                  <td className="px-3 py-2"><span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600">{h.method}</span></td>
                </tr>
              ))}
              {(!client.history || client.history.length === 0) && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Sin historial registrado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-200 px-6 py-3 flex items-center gap-2">
        <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"><Edit2 size={13} /> Editar</button>
        <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"><MessageCircle size={13} /> WhatsApp</button>
        <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-[#b3001e] text-white hover:bg-[#8c0017]"><CreditCard size={13} /> Cobrar saldo</button>
        <div className="ml-auto">
          <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-red-600 hover:bg-red-50"><Trash2 size={13} /> Eliminar</button>
        </div>
      </div>
    </div>
  )
}

export default function ClientsDemo({ clients: CLIENTS_SEED }) {
  const [search, setSearch]       = useState('')
  const [filter, setFilter]       = useState('all')
  const [selectedId, setSelectedId] = useState(CLIENTS_SEED[0]?.id || null)

  const counts = {
    all:       CLIENTS_SEED.length,
    owing:     CLIENTS_SEED.filter(c => clientStatus(c) === 'owing').length,
    overlimit: CLIENTS_SEED.filter(c => clientStatus(c) === 'overlimit').length,
    new:       CLIENTS_SEED.filter(c => c.totalVisits <= 3).length,
  }

  const visible = useMemo(() => {
    const q = search.toLowerCase().trim()
    return CLIENTS_SEED
      .filter(c => filter === 'all'
        || (filter === 'owing' && clientStatus(c) === 'owing')
        || (filter === 'overlimit' && clientStatus(c) === 'overlimit')
        || (filter === 'new' && c.totalVisits <= 3))
      .filter(c => !q || c.name.toLowerCase().includes(q) || (c.rnc || '').includes(q) || (c.phone || '').includes(q))
  }, [search, filter, CLIENTS_SEED])

  const selected = CLIENTS_SEED.find(c => c.id === selectedId) || null

  return (
    <div className="h-full flex bg-white">
      {/* Left list */}
      <div className="w-[360px] shrink-0 border-r border-slate-200 flex flex-col bg-white">
        <div className="shrink-0 border-b border-slate-200 px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[16px] font-bold text-slate-800">Clientes</h2>
            <button className="inline-flex items-center gap-1.5 bg-[#b3001e] hover:bg-[#8c0017] text-white text-[12px] font-bold px-3 py-1.5 rounded-lg"><Plus size={13} /> Nuevo</button>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus-within:border-sky-400">
            <Search size={13} className="text-slate-400 shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar nombre, RNC o telefono..."
              className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-slate-700 placeholder:text-slate-400" />
          </div>
        </div>
        <div className="shrink-0 flex border-b border-slate-200 px-2 overflow-x-auto">
          {[
            { id: 'all',       label: 'Todos',     count: counts.all },
            { id: 'owing',     label: 'Con deuda', count: counts.owing },
            { id: 'overlimit', label: 'Excedido',  count: counts.overlimit },
            { id: 'new',       label: 'Nuevos',    count: counts.new },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium border-b-2 -mb-px transition-colors shrink-0 ${
                filter === f.id ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}>
              {f.label}
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center ${
                filter === f.id ? 'bg-slate-200 text-slate-800' : 'bg-slate-100 text-slate-400'
              }`}>{f.count}</span>
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {visible.map(c => (
            <ClientCard key={c.id} client={c} selected={c.id === selectedId} onClick={() => setSelectedId(c.id)} />
          ))}
          {visible.length === 0 && <p className="text-[12px] text-slate-400 text-center py-8">Sin resultados</p>}
        </div>
      </div>

      <DetailPanel client={selected} onClose={() => setSelectedId(null)} />
    </div>
  )
}
