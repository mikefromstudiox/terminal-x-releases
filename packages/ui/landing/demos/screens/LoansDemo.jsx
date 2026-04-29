// LoansDemo — faithful copy of packages/ui/screens/lending/Loans.jsx render.
// Header + 4 KPI tiles + tab filter + search + table with status badges.
// Detail modal stub on row click (renders amortization schedule placeholder).

import { useState, useMemo } from 'react'
import {
  Landmark, Plus, Search, DollarSign, Users, Clock, TrendingUp,
  AlertTriangle, RefreshCw, Eye, X, Calendar, Banknote, Receipt, Phone, MessageCircle,
} from 'lucide-react'

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtDate(d) { if (!d) return '—'; const dt = d instanceof Date ? d : new Date(d); return dt.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) }
function todayISO() { return new Date().toISOString().slice(0, 10) }

const TABS = [
  { id: 'active',     label: 'Activos' },
  { id: 'paid',       label: 'Pagados' },
  { id: 'defaulted',  label: 'En mora' },
  { id: 'all',        label: 'Todos' },
]

const STATUS = {
  active:    { label: 'Activo',     pill: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  paid:      { label: 'Pagado',     pill: 'bg-slate-100 text-slate-600 border-slate-200' },
  defaulted: { label: 'En mora',    pill: 'bg-red-100 text-red-700 border-red-200' },
  pending:   { label: 'Pendiente',  pill: 'bg-amber-100 text-amber-700 border-amber-200' },
}

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.active
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${s.pill}`}>{s.label}</span>
}

function SummaryCard({ icon: Icon, label, value, accent = 'slate' }) {
  const colors = {
    emerald: 'text-emerald-700 bg-emerald-50',
    slate:   'text-slate-700 bg-slate-50',
    red:     'text-red-700 bg-red-50',
  }
  return (
    <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 flex items-start gap-3">
      <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${colors[accent]}`}><Icon size={16} /></div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <p className="text-[18px] font-extrabold text-slate-800 tabular-nums truncate">{value}</p>
      </div>
    </div>
  )
}

const SEED = [
  { id: 1042, client_name: 'Maria Sanchez',      principal: 12000,  term_months: 12, interest_rate: 12, monthly_payment: 1101, total_repayment: 13212, total_paid: 3712,  disbursed_at: '2026-01-15', next_due_date: '2026-05-15', status: 'active' },
  { id: 1043, client_name: 'Roberto Castillo',    principal: 45000,  term_months: 24, interest_rate: 10, monthly_payment: 2076, total_repayment: 49824, total_paid: 21824, disbursed_at: '2025-09-08', next_due_date: '2026-05-08', status: 'active' },
  { id: 1044, client_name: 'Pedro Vasquez',       principal: 85000,  term_months: 36, interest_rate: 8,  monthly_payment: 2664, total_repayment: 95904, total_paid: 0,     disbursed_at: '2026-04-20', next_due_date: '2026-04-20', status: 'defaulted' },
  { id: 1045, client_name: 'Ana Reyes',           principal: 8500,   term_months: 6,  interest_rate: 12, monthly_payment: 1466, total_repayment: 8796,  total_paid: 4296,  disbursed_at: '2026-03-22', next_due_date: '2026-05-22', status: 'active' },
  { id: 1046, client_name: 'Empresa Logistics',   principal: 125000, term_months: 18, interest_rate: 9,  monthly_payment: 7457, total_repayment: 134226, total_paid: 39226, disbursed_at: '2025-11-12', next_due_date: '2026-05-12', status: 'active' },
  { id: 1041, client_name: 'Lucia Almonte',       principal: 6000,   term_months: 6,  interest_rate: 10, monthly_payment: 1041, total_repayment: 6246,  total_paid: 6246,  disbursed_at: '2025-10-05', next_due_date: null,         status: 'paid' },
  { id: 1040, client_name: 'Carmen Diaz',         principal: 3500,   term_months: 4,  interest_rate: 12, monthly_payment: 904,  total_repayment: 3616,  total_paid: 3616,  disbursed_at: '2025-08-12', next_due_date: null,         status: 'paid' },
]

export default function LoansDemo() {
  const [loans, setLoans]   = useState(SEED)
  const [tab, setTab]       = useState('active')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState(null)

  const metrics = useMemo(() => {
    const active = loans.filter(l => l.status === 'active')
    const totalCartera = active.reduce((s, l) => s + (l.total_repayment - l.total_paid), 0)
    const overdue = loans.filter(l => l.status === 'defaulted').length
    const cobradoMes = loans.reduce((s, l) => s + (l.total_paid * 0.15), 0)
    return { totalCartera, activeCount: active.length, overdueCount: overdue, cobradoMes }
  }, [loans])

  const filtered = useMemo(() => {
    let list = loans
    if (tab !== 'all') list = list.filter(l => l.status === tab)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(l => l.client_name.toLowerCase().includes(q) || String(l.id).includes(q))
    }
    return list
  }, [loans, tab, search])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 h-full overflow-hidden">
      <div className="bg-white border-b border-slate-200 px-3 py-3 md:px-6 md:py-4 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <Landmark size={20} className="text-slate-500" />
          <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800">Préstamos</h1>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-black hover:bg-slate-800 text-white rounded-xl text-sm font-medium">
          <Plus size={15} /> Nuevo Préstamo
        </button>
      </div>

      <div className="px-3 md:px-6 py-3 md:py-4 grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
        <SummaryCard icon={DollarSign} label="Total Cartera"      value={fmtRD(metrics.totalCartera)} accent="emerald" />
        <SummaryCard icon={Users}      label="Préstamos Activos"  value={String(metrics.activeCount)} accent="emerald" />
        <SummaryCard icon={Clock}      label="Pagos Pendientes"   value={String(metrics.overdueCount)} accent={metrics.overdueCount > 0 ? 'red' : 'slate'} />
        <SummaryCard icon={TrendingUp} label="Cobrado Este Mes"   value={fmtRD(metrics.cobradoMes)} accent="slate" />
      </div>

      <div className="px-3 md:px-6 shrink-0">
        <div className="flex gap-1 overflow-x-auto pb-2">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors border whitespace-nowrap ${
                tab === t.id ? 'bg-black text-white border-black' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}>
              {t.label}
              {t.id !== 'all' && <span className="ml-1.5 text-[10px] opacity-60">{loans.filter(l => l.status === t.id).length}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 md:px-6 pb-3 shrink-0">
        <div className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-emerald-400 max-w-sm">
          <Search size={14} className="text-slate-400 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por cliente o # préstamo..."
            className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-700 placeholder:text-slate-400" />
        </div>
      </div>

      <div className="flex-1 overflow-auto px-3 md:px-6 pb-6">
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2.5 text-left">#</th>
                  <th className="px-4 py-2.5 text-left">Cliente</th>
                  <th className="px-4 py-2.5 text-right">Capital</th>
                  <th className="px-4 py-2.5 text-center">Plazo</th>
                  <th className="px-4 py-2.5 text-center">Tasa</th>
                  <th className="px-4 py-2.5 text-right">Cuota</th>
                  <th className="px-4 py-2.5 text-left">Desembolsado</th>
                  <th className="px-4 py-2.5 text-left">Próx. Pago</th>
                  <th className="px-4 py-2.5 text-right">Balance</th>
                  <th className="px-4 py-2.5 text-center">Estado</th>
                  <th className="px-4 py-2.5 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(loan => {
                  const balance = loan.total_repayment - loan.total_paid
                  const isOverdue = loan.status === 'active' && loan.next_due_date && loan.next_due_date < todayISO()
                  return (
                    <tr key={loan.id} onClick={() => setDetail(loan)}
                      className="border-t border-slate-100 hover:bg-slate-50/50 cursor-pointer">
                      <td className="px-4 py-2.5 text-slate-500 tabular-nums">{loan.id}</td>
                      <td className="px-4 py-2.5"><p className="font-semibold text-slate-800">{loan.client_name}</p></td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-800 tabular-nums">{fmtRD(loan.principal)}</td>
                      <td className="px-4 py-2.5 text-center text-slate-600">{loan.term_months}m</td>
                      <td className="px-4 py-2.5 text-center text-slate-600">{loan.interest_rate}%</td>
                      <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">{fmtRD(loan.monthly_payment)}</td>
                      <td className="px-4 py-2.5 text-slate-600 tabular-nums">{fmtDate(loan.disbursed_at)}</td>
                      <td className={`px-4 py-2.5 tabular-nums ${isOverdue ? 'text-[#b3001e] font-semibold' : 'text-slate-600'}`}>
                        {fmtDate(loan.next_due_date)}
                        {isOverdue && <AlertTriangle size={10} className="inline ml-1" />}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-slate-800 tabular-nums">{fmtRD(balance)}</td>
                      <td className="px-4 py-2.5 text-center"><StatusBadge status={loan.status} /></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          {loan.status === 'active' && <button onClick={e => { e.stopPropagation() }} title="Renovar" className="p-1.5 text-slate-400 hover:text-[#b3001e] rounded-lg hover:bg-[#b3001e]/10"><RefreshCw size={14} /></button>}
                          <button onClick={e => { e.stopPropagation(); setDetail(loan) }} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50"><Eye size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Préstamo #{detail.id}</p>
                <h3 className="text-[18px] font-extrabold text-slate-900 mt-1">{detail.client_name}</h3>
                <p className="text-[12px] text-slate-600 mt-0.5">{fmtRD(detail.principal)} · {detail.term_months}m @ {detail.interest_rate}%</p>
              </div>
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-4">
              <div className="bg-slate-50 rounded-xl p-3"><p className="text-[10px] uppercase text-slate-400 tracking-wider">Cuota</p><p className="font-bold text-slate-800 tabular-nums">{fmtRD(detail.monthly_payment)}</p></div>
              <div className="bg-slate-50 rounded-xl p-3"><p className="text-[10px] uppercase text-slate-400 tracking-wider">Pagado</p><p className="font-bold text-emerald-700 tabular-nums">{fmtRD(detail.total_paid)}</p></div>
              <div className="bg-slate-50 rounded-xl p-3"><p className="text-[10px] uppercase text-slate-400 tracking-wider">Balance</p><p className="font-bold text-[#b3001e] tabular-nums">{fmtRD(detail.total_repayment - detail.total_paid)}</p></div>
              <div className="bg-slate-50 rounded-xl p-3"><p className="text-[10px] uppercase text-slate-400 tracking-wider">Próx. pago</p><p className="font-bold text-slate-800 inline-flex items-center gap-1"><Calendar size={11} /> {fmtDate(detail.next_due_date)}</p></div>
            </div>

            <div className="px-6 pb-4">
              <h4 className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-2">Tabla de amortización</h4>
              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400 sticky top-0">
                    <tr><th className="text-left px-3 py-2">#</th><th className="text-left px-3 py-2">Fecha</th><th className="text-right px-3 py-2">Cuota</th><th className="text-right px-3 py-2">Capital</th><th className="text-right px-3 py-2">Interés</th><th className="text-center px-3 py-2">Estado</th></tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: detail.term_months }).map((_, i) => {
                      const paid = i < Math.floor((detail.total_paid / detail.monthly_payment))
                      const interest = parseFloat((detail.principal * detail.interest_rate / 100 / 12 * (1 - i / detail.term_months)).toFixed(2))
                      const capital = parseFloat((detail.monthly_payment - interest).toFixed(2))
                      return (
                        <tr key={i} className={`border-t border-slate-100 ${paid ? 'bg-emerald-50/40' : ''}`}>
                          <td className="px-3 py-1.5 text-slate-500">{i + 1}</td>
                          <td className="px-3 py-1.5 text-slate-700">{fmtDate(new Date(new Date(detail.disbursed_at).getTime() + (i + 1) * 30 * 86400000))}</td>
                          <td className="px-3 py-1.5 text-right font-bold text-slate-800 tabular-nums">{fmtRD(detail.monthly_payment)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{fmtRD(capital)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{fmtRD(interest)}</td>
                          <td className="px-3 py-1.5 text-center"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${paid ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{paid ? 'Pagado' : 'Pendiente'}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-slate-200 flex gap-2 flex-wrap">
              <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"><Phone size={13} /> Llamar</button>
              <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border border-slate-200 text-emerald-700 hover:bg-emerald-50"><MessageCircle size={13} /> WhatsApp</button>
              <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"><Receipt size={13} /> Imprimir contrato</button>
              <button className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-bold bg-[#b3001e] hover:bg-[#8c0017] text-white"><Banknote size={13} /> Registrar pago</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
