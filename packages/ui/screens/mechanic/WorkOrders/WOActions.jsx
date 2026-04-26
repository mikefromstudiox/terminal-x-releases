/**
 * WOActions.jsx — header bar + status tabs + summary stats for WorkOrders.
 *
 * Pure presentational. All state lives in the orchestrator; this component
 * just renders and fires callbacks. Visual layout is byte-identical to the
 * pre-refactor inline JSX.
 */

import { Wrench, Plus, Search } from 'lucide-react'
import { STATUSES } from '../wo/constants'

export default function WOActions({
  lang,
  search, onSearch,
  filter, onFilter,
  counts,
  onNew,
}) {
  const L = (es, en) => lang === 'es' ? es : en

  const FILTERS = [
    { id: 'all', label: L('Todos', 'All'), count: counts.all },
    ...STATUSES.map(s => ({ id: s.id, label: L(s.label_es, s.label_en), count: counts[s.id] || 0 })),
  ]

  return (
    <>
      {/* Header */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between px-3 md:px-6 pt-3 md:pt-4 pb-2 md:pb-3 gap-2 md:gap-0">
          <div className="flex items-center gap-3">
            <Wrench size={20} className="text-slate-500 dark:text-white/60" />
            <div>
              <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">
                {L('Ordenes de Trabajo', 'Work Orders')}
              </h1>
              <p className="text-xs text-slate-400 dark:text-white/40 mt-0.5 hidden md:block">
                {L('Gestiona estimaciones, trabajos en progreso y facturacion', 'Manage estimates, work in progress and invoicing')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl focus-within:border-sky-400 w-full md:w-64 flex-1 md:flex-none">
              <Search size={14} className="text-slate-400 dark:text-white/40 shrink-0" />
              <input type="text" value={search} onChange={e => onSearch(e.target.value)}
                placeholder={L('Buscar placa, cliente...', 'Search plate, client...')}
                className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-700 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40" />
            </div>
            <button onClick={onNew}
              className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors shrink-0">
              <Plus size={15} /> {L('Nueva Orden', 'New Order')}
            </button>
          </div>
        </div>

        {/* Status tabs */}
        <div className="flex px-3 md:px-6 gap-1 overflow-x-auto">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => onFilter(f.id)}
              className={`flex items-center gap-1.5 px-2.5 md:px-3.5 py-2.5 text-[12px] md:text-[13px] font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                filter === f.id
                  ? 'border-sky-500 text-sky-600'
                  : 'border-transparent text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white'
              }`}>
              {f.label}
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center ${
                filter === f.id ? 'bg-sky-100 dark:bg-sky-500/20 text-sky-600' : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/60'
              }`}>{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div className="px-3 md:px-6 py-3 grid grid-cols-2 md:grid-cols-5 gap-3 shrink-0">
        {STATUSES.map(s => (
          <div key={s.id} className={`rounded-xl border px-3 py-2.5 ${s.border} ${s.bg}`}>
            <p className={`text-[10px] font-bold uppercase tracking-wider ${s.text} opacity-70`}>{L(s.label_es, s.label_en)}</p>
            <p className={`text-[18px] font-bold ${s.text}`}>{counts[s.id] || 0}</p>
          </div>
        ))}
      </div>
    </>
  )
}
