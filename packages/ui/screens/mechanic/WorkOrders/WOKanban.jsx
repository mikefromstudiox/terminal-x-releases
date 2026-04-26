/**
 * WOKanban.jsx — cards grid for the WorkOrders screen.
 *
 * Pure presentational. Receives the already-filtered list of orders and
 * renders the loading state, empty state, or the responsive card grid.
 * Visual layout is byte-identical to the pre-refactor inline JSX.
 */

import { Loader2, ClipboardList } from 'lucide-react'
import { STATUS_MAP, fmtWO } from '../wo/constants'

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(s) {
  if (!s) return '---'
  return new Date(s).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}

function WOCard({ order, lang, onClick }) {
  const L = (es, en) => lang === 'es' ? es : en
  const st = STATUS_MAP[order.status] || STATUS_MAP.estimado
  const total = (order.items || []).reduce((s, i) => s + (Number(i.qty) * Number(i.unit_price)), 0)

  return (
    <button onClick={() => onClick(order)}
      className="w-full text-left bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 hover:shadow-md dark:hover:border-white/20 transition-all group">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-bold text-sky-600 dark:text-sky-400">{fmtWO(order.order_number || order.id)}</span>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${st.bg} ${st.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
          {L(st.label_es, st.label_en)}
        </span>
      </div>
      <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">
        {order.plate || '---'} {order.make ? `- ${order.make} ${order.model || ''}` : ''}
      </p>
      <p className="text-[12px] text-slate-500 dark:text-white/50 truncate mt-0.5">
        {order.client_name || L('Sin cliente', 'No client')}
      </p>
      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-2 min-w-0">
          {order.technician_name && (
            <div className="flex items-center gap-1 min-w-0">
              <div className="w-5 h-5 bg-slate-100 dark:bg-white/10 rounded-full flex items-center justify-center text-[9px] font-bold text-slate-600 dark:text-white/60 shrink-0">
                {order.technician_name[0]}
              </div>
              <span className="text-[11px] text-slate-500 dark:text-white/50 truncate">{order.technician_name}</span>
            </div>
          )}
          {order.bay_name && (
            <span className="text-[10px] font-medium text-slate-400 dark:text-white/30 bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 rounded shrink-0">
              {order.bay_name}
            </span>
          )}
        </div>
        <span className="text-[13px] font-bold text-slate-700 dark:text-white shrink-0">{fmtRD(total)}</span>
      </div>
      <p className="text-[11px] text-slate-400 dark:text-white/30 mt-2">{fmtDate(order.created_at)}</p>
    </button>
  )
}

export default function WOKanban({ lang, loading, orders, onCardClick }) {
  const L = (es, en) => lang === 'es' ? es : en

  return (
    <div className="flex-1 overflow-y-auto px-3 md:px-6 pb-6">
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/40 text-sm gap-2">
          <Loader2 size={16} className="animate-spin" /> {L('Cargando...', 'Loading...')}
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-300 dark:text-white/30 gap-2">
          <ClipboardList size={32} />
          <p className="text-sm">{L('No hay ordenes de trabajo', 'No work orders')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {orders.map(order => (
            <WOCard key={order.id} order={order} lang={lang} onClick={onCardClick} />
          ))}
        </div>
      )}
    </div>
  )
}
