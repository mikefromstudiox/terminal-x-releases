// PawnItemsDemo — faithful copy of PawnItems.jsx render. Card grid with item
// thumbnail, appraisal/loan, status (active/vencido/recuperado/subastado),
// detail modal. State is local; filter pill bar at top.

import { useState, useMemo } from 'react'
import { Package, Plus, Search, Eye, X, Calendar, DollarSign, Camera, AlertTriangle, FileText } from 'lucide-react'

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}` }
function fmtDate(d) { if (!d) return '—'; const dt = d instanceof Date ? d : new Date(d); return dt.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) }

const STATUS = {
  active:     { label: 'En custodia',   pill: 'bg-sky-100 text-sky-700 border-sky-200',           ring: 'ring-sky-200' },
  vencido:    { label: 'Vencido',       pill: 'bg-red-100 text-red-700 border-red-200',           ring: 'ring-red-200' },
  recuperado: { label: 'Recuperado',    pill: 'bg-emerald-100 text-emerald-700 border-emerald-200', ring: 'ring-emerald-200' },
  subastado:  { label: 'Subastado',     pill: 'bg-zinc-100 text-zinc-600 border-zinc-200',        ring: 'ring-zinc-200' },
}

const CATEGORIES = [
  { id: 'all',         label: 'Todos',         icon: Package },
  { id: 'oro',         label: 'Oro / Joyas',   icon: Package },
  { id: 'electronica', label: 'Electrónica',   icon: Package },
  { id: 'herramientas', label: 'Herramientas', icon: Package },
  { id: 'otros',       label: 'Otros',         icon: Package },
]

const SEED = [
  { id: 1,  category: 'oro',         item: 'Cadena oro 18k 12g',           desc: 'Cadena cubana con dije, 12.4g netos', appraisal: 18000,  loan: 12000, dueDate: '2026-05-15', status: 'active' },
  { id: 2,  category: 'oro',         item: 'Anillo brillantes 1.2ct',     desc: 'Solitario 18k, certificado GIA',     appraisal: 65000,  loan: 45000, dueDate: '2026-05-08', status: 'active' },
  { id: 3,  category: 'electronica', item: 'Reloj Rolex Submariner',       desc: 'Modelo 116610LN, completo c/papeles', appraisal: 120000, loan: 85000, dueDate: '2026-04-20', status: 'vencido' },
  { id: 4,  category: 'electronica', item: 'iPhone 14 Pro 256GB',          desc: 'Sin caja, batería 92%',                appraisal: 25000,  loan: 0,     dueDate: null,         status: 'recuperado' },
  { id: 5,  category: 'electronica', item: 'MacBook Pro M3 14"',           desc: '16GB / 512GB · Space Black',           appraisal: 45000,  loan: 32000, dueDate: '2026-06-12', status: 'active' },
  { id: 6,  category: 'herramientas', item: 'Equipo herramientas DeWalt', desc: 'Combo 5 piezas + cargador',            appraisal: 18500,  loan: 12000, dueDate: '2026-05-22', status: 'active' },
  { id: 7,  category: 'oro',         item: 'Pulsera oro 14k 10g',          desc: 'Pulsera tejido cuban link',           appraisal: 11000,  loan: 7500,  dueDate: '2026-05-30', status: 'active' },
  { id: 8,  category: 'electronica', item: 'PS5 + 2 controles',            desc: 'Sin garantía, 3 juegos incluidos',     appraisal: 12000,  loan: 8000,  dueDate: '2026-03-15', status: 'subastado' },
  { id: 9,  category: 'oro',         item: 'Dije diamante 0.5ct',           desc: 'Engaste 14k oro blanco',              appraisal: 22000,  loan: 14000, dueDate: '2026-06-01', status: 'active' },
]

export default function PawnItemsDemo() {
  const [items]            = useState(SEED)
  const [cat, setCat]      = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return items
      .filter(it => cat === 'all' || it.category === cat)
      .filter(it => statusFilter === 'all' || it.status === statusFilter)
      .filter(it => !q || it.item.toLowerCase().includes(q) || it.desc.toLowerCase().includes(q))
  }, [items, cat, statusFilter, search])

  const counts = useMemo(() => ({
    all:        items.length,
    active:     items.filter(i => i.status === 'active').length,
    vencido:    items.filter(i => i.status === 'vencido').length,
    recuperado: items.filter(i => i.status === 'recuperado').length,
    subastado:  items.filter(i => i.status === 'subastado').length,
  }), [items])

  const totalAppraisal = filtered.reduce((s, i) => s + i.appraisal, 0)
  const totalLoaned    = filtered.reduce((s, i) => s + i.loan, 0)

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-3 md:px-6 py-3 md:py-4 flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-3">
          <Package size={20} className="text-slate-500" />
          <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800">Artículos en garantía</h1>
          <span className="text-[12px] text-slate-500">· {items.length} en custodia</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus-within:border-sky-400 w-56">
            <Search size={13} className="text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar artículo..."
              className="flex-1 text-[12px] bg-transparent outline-none" />
          </div>
          <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold bg-black hover:bg-slate-800 text-white"><Plus size={13} /> Recibir prenda</button>
        </div>
      </div>

      <div className="px-3 md:px-6 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
        <div className="bg-white rounded-2xl border border-slate-200 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total avalúo</p><p className="text-[18px] font-extrabold text-slate-800 tabular-nums">{fmtRD(totalAppraisal)}</p></div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total prestado</p><p className="text-[18px] font-extrabold text-emerald-700 tabular-nums">{fmtRD(totalLoaned)}</p></div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Vencidos</p><p className="text-[18px] font-extrabold text-red-700 tabular-nums">{counts.vencido}</p></div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Cobertura</p><p className="text-[18px] font-extrabold text-slate-800 tabular-nums">{Math.round((totalLoaned / Math.max(1, totalAppraisal)) * 100)}%</p></div>
      </div>

      <div className="px-3 md:px-6 shrink-0">
        <div className="flex gap-1 overflow-x-auto pb-2">
          {CATEGORIES.map(c => (
            <button key={c.id} onClick={() => setCat(c.id)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors border whitespace-nowrap ${
                cat === c.id ? 'bg-black text-white border-black' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}>{c.label}</button>
          ))}
          <span className="w-px bg-slate-200 mx-1" />
          {[
            { id: 'all',     label: 'Todos',      n: counts.all },
            { id: 'active',  label: 'Activos',    n: counts.active },
            { id: 'vencido', label: 'Vencidos',   n: counts.vencido },
            { id: 'recuperado', label: 'Recuperados', n: counts.recuperado },
          ].map(s => (
            <button key={s.id} onClick={() => setStatusFilter(s.id)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors border whitespace-nowrap ${
                statusFilter === s.id ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}>
              {s.label}
              <span className="ml-1.5 text-[10px] opacity-70">{s.n}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-3 md:px-6 pb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(it => {
            const s = STATUS[it.status]
            return (
              <button key={it.id} onClick={() => setDetail(it)}
                className={`text-left bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-lg hover:ring-2 ${s.ring} transition-all`}>
                <div className="aspect-video bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                  <Package size={36} className="text-slate-300" />
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="text-[14px] font-bold text-slate-900 leading-tight truncate">{it.item}</h3>
                    <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${s.pill}`}>{s.label}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 line-clamp-2 mb-3">{it.desc}</p>
                  <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-100">
                    <div><p className="text-[9px] uppercase tracking-wider text-slate-400">Avalúo</p><p className="text-[13px] font-bold text-slate-800 tabular-nums">{fmtRD(it.appraisal)}</p></div>
                    <div><p className="text-[9px] uppercase tracking-wider text-slate-400">Préstamo</p><p className="text-[13px] font-bold text-[#b3001e] tabular-nums">{fmtRD(it.loan)}</p></div>
                  </div>
                  {it.dueDate && (
                    <p className={`text-[10px] mt-2 inline-flex items-center gap-1 ${it.status === 'vencido' ? 'text-red-600 font-bold' : 'text-slate-500'}`}>
                      <Calendar size={10} /> Vence {fmtDate(it.dueDate)}
                      {it.status === 'vencido' && <AlertTriangle size={10} className="ml-0.5" />}
                    </p>
                  )}
                </div>
              </button>
            )
          })}
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
            <Package size={32} className="text-slate-300 mx-auto mb-3" />
            <p className="text-[13px] text-slate-500 font-medium">Sin artículos en este filtro</p>
          </div>
        )}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="aspect-[2/1] bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center relative">
              <Package size={64} className="text-slate-300" />
              <button onClick={() => setDetail(null)} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white shadow text-slate-600 hover:text-slate-900 flex items-center justify-center"><X size={16} /></button>
              <button className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 bg-white shadow text-slate-700 px-3 py-1.5 rounded-lg text-[11px] font-semibold"><Camera size={12} /> Agregar foto</button>
            </div>
            <div className="p-6">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Artículo #{detail.id}</p>
                  <h3 className="text-[20px] font-extrabold text-slate-900 mt-1">{detail.item}</h3>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${STATUS[detail.status].pill}`}>{STATUS[detail.status].label}</span>
              </div>
              <p className="text-[13px] text-slate-600 mb-4">{detail.desc}</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                <div className="bg-slate-50 rounded-xl p-3"><p className="text-[10px] uppercase text-slate-400 tracking-wider">Avalúo</p><p className="font-bold text-slate-800 tabular-nums">{fmtRD(detail.appraisal)}</p></div>
                <div className="bg-slate-50 rounded-xl p-3"><p className="text-[10px] uppercase text-slate-400 tracking-wider">Prestado</p><p className="font-bold text-[#b3001e] tabular-nums">{fmtRD(detail.loan)}</p></div>
                <div className="bg-slate-50 rounded-xl p-3"><p className="text-[10px] uppercase text-slate-400 tracking-wider">Cobertura</p><p className="font-bold text-slate-800 tabular-nums">{Math.round((detail.loan / detail.appraisal) * 100)}%</p></div>
                {detail.dueDate && <div className="bg-slate-50 rounded-xl p-3 col-span-2 md:col-span-3"><p className="text-[10px] uppercase text-slate-400 tracking-wider">Fecha de vencimiento</p><p className="font-bold text-slate-800 inline-flex items-center gap-1"><Calendar size={11} /> {fmtDate(detail.dueDate)}</p></div>}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"><FileText size={13} /> Imprimir contrato</button>
                <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"><Eye size={13} /> Ver historial</button>
                <button className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white"><DollarSign size={13} /> Recibir pago</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
