import { useState, useMemo } from 'react'
import {
  Droplets, Wrench, Scissors, Plus, Minus, Trash2, ShoppingCart,
  UserRound, Car, Clock, Play, CheckCircle2, ArrowRight
} from 'lucide-react'
import { servicesFor, fmtRD, t, VERTICAL_LABEL, QUEUE_SAMPLE, CLIENTS } from '../demoMockData'
import { DemoCobrarModal } from '../DemoChrome'

const ICON = { carwash: Droplets, mecanica: Wrench, salon: Scissors }

const STATUS_STYLES = {
  proceso:   { dot: 'bg-blue-500',  pill: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30' },
  pendiente: { dot: 'bg-amber-500', pill: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' },
  listo:     { dot: 'bg-emerald-500', pill: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
}

export default function CarwashDemo({ vertical, lang, onCobrar }) {
  const Icon = ICON[vertical] || Droplets
  const { categories, services } = servicesFor(vertical)
  const [activeCat, setActiveCat] = useState(categories[0])
  const [cart, setCart] = useState([])
  const [cobrarOpen, setCobrarOpen] = useState(false)
  const [queue, setQueue] = useState(QUEUE_SAMPLE)

  const filtered = useMemo(
    () => services.filter(s => !activeCat || s.cat === activeCat),
    [services, activeCat]
  )

  function addToCart(s) {
    setCart(c => {
      const idx = c.findIndex(x => x.id === s.id)
      if (idx >= 0) {
        const copy = [...c]
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 }
        return copy
      }
      return [...c, { ...s, qty: 1 }]
    })
  }
  function changeQty(id, d) {
    setCart(c => c.map(it => it.id === id ? { ...it, qty: Math.max(0, it.qty + d) } : it).filter(it => it.qty > 0))
  }

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0)
  const subtotal = total / 1.18
  const itbis = total - subtotal

  function advance(id) {
    setQueue(q =>
      q.map(t => {
        if (t.id !== id) return t
        if (t.status === 'pendiente') return { ...t, status: 'proceso', worker: 'Luis M.' }
        if (t.status === 'proceso')   return { ...t, status: 'listo', eta: 0 }
        return t
      })
    )
  }

  return (
    <div className="bg-slate-50 dark:bg-black min-h-[calc(100vh-44px)] flex flex-col xl:flex-row">
      {/* MAIN: Queue + Services side by side */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="bg-white dark:bg-white/5 border-b border-black/5 dark:border-white/10 px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#b3001e]/10 flex items-center justify-center">
            <Icon size={20} className="text-[#b3001e]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-black text-black dark:text-white truncate">
              {VERTICAL_LABEL[vertical]?.[lang]}
            </h2>
            <p className="text-[11px] font-bold text-black/50 dark:text-white/50">
              {t(lang, 'Cajero: Demo', 'Cashier: Demo')} · {queue.filter(q => q.status === 'proceso').length} {t(lang, 'en proceso', 'in progress')}
            </p>
          </div>
        </div>

        {/* Queue board */}
        <div className="px-4 sm:px-6 py-4 border-b border-black/5 dark:border-white/10">
          <h3 className="text-[11px] font-extrabold tracking-[2px] uppercase text-black/50 dark:text-white/50 mb-3">
            {t(lang, 'Cola en vivo', 'Live queue')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {queue.map(q => {
              const style = STATUS_STYLES[q.status]
              return (
                <div key={q.id} className="bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-3 hover:border-[#b3001e]/40 transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="text-xs font-black text-black dark:text-white">{q.id}</p>
                      <p className="text-[11px] font-bold text-black/60 dark:text-white/60 truncate">{q.client}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-wide ${style.pill}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                      {q.status === 'proceso' ? t(lang, 'En proceso', 'In progress') : q.status === 'listo' ? t(lang, 'Listo', 'Ready') : t(lang, 'Pendiente', 'Pending')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-black/60 dark:text-white/60 font-semibold mb-2">
                    <Car size={12} />
                    <span className="font-mono">{q.plate}</span>
                  </div>
                  <p className="text-[12px] text-black dark:text-white font-bold mb-2 truncate">{q.service}</p>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-black/50 dark:text-white/50 font-bold">{q.worker}</span>
                    {q.status !== 'listo' ? (
                      <button onClick={() => advance(q.id)} className="inline-flex items-center gap-1 text-[#b3001e] font-black hover:underline">
                        {q.status === 'pendiente' ? <><Play size={11} /> {t(lang, 'Iniciar', 'Start')}</> : <><CheckCircle2 size={11} /> {t(lang, 'Listo', 'Ready')}</>}
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-black">
                        <Clock size={11} /> {t(lang, 'Entregar', 'Deliver')}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Services picker */}
        <div className="bg-white dark:bg-white/5 border-b border-black/5 dark:border-white/10 px-4 sm:px-6 py-2 flex gap-2 overflow-x-auto">
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setActiveCat(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide whitespace-nowrap transition-colors ${
                activeCat === c ? 'bg-[#b3001e] text-white' : 'bg-slate-100 dark:bg-white/10 text-black dark:text-white hover:bg-slate-200 dark:hover:bg-white/20'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {filtered.map(s => (
              <button
                key={s.id}
                onClick={() => addToCart(s)}
                className="text-left bg-white dark:bg-white/5 hover:border-[#b3001e] hover:shadow-lg hover:-translate-y-0.5 border border-black/10 dark:border-white/10 rounded-xl p-3 transition-all"
              >
                <p className="text-xs font-black text-black dark:text-white leading-tight line-clamp-2 min-h-[2rem]">{s.name}</p>
                <p className="mt-1.5 text-sm font-black text-[#b3001e] tabular-nums">{fmtRD(s.price)}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* CART */}
      <div className="w-full xl:w-96 bg-white dark:bg-white/5 border-t xl:border-t-0 xl:border-l border-black/5 dark:border-white/10 flex flex-col">
        <div className="px-5 py-4 border-b border-black/5 dark:border-white/10 flex items-center justify-between">
          <h3 className="text-sm font-black uppercase tracking-wide text-black dark:text-white flex items-center gap-2">
            <ShoppingCart size={16} className="text-[#b3001e]" />
            {t(lang, 'Ticket', 'Ticket')}
            <span className="px-1.5 py-0.5 rounded-full bg-[#b3001e] text-white text-[10px] tabular-nums">{cart.length}</span>
          </h3>
          {cart.length > 0 && (
            <button onClick={() => setCart([])} className="text-[11px] font-bold text-black/50 dark:text-white/50 hover:text-[#b3001e]">
              {t(lang, 'Vaciar', 'Clear')}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 max-h-[40vh] xl:max-h-none">
          {cart.length === 0 && (
            <div className="text-center py-12 text-black/40 dark:text-white/40 text-xs">
              {t(lang, 'Toca un servicio para agregar.', 'Tap a service to add.')}
            </div>
          )}
          {cart.map(it => (
            <div key={it.id} className="bg-slate-50 dark:bg-white/5 rounded-lg p-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black text-black dark:text-white truncate">{it.name}</p>
                <p className="text-[11px] tabular-nums text-black/60 dark:text-white/60 font-semibold">{fmtRD(it.price)}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => changeQty(it.id, -1)} className="w-7 h-7 rounded-md bg-white dark:bg-white/10 hover:bg-[#b3001e] hover:text-white flex items-center justify-center text-black dark:text-white"><Minus size={13} /></button>
                <span className="w-6 text-center text-xs font-black text-black dark:text-white tabular-nums">{it.qty}</span>
                <button onClick={() => changeQty(it.id, 1)} className="w-7 h-7 rounded-md bg-white dark:bg-white/10 hover:bg-[#b3001e] hover:text-white flex items-center justify-center text-black dark:text-white"><Plus size={13} /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-black/5 dark:border-white/10 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-black/60 dark:text-white/60 font-semibold">Subtotal</span>
            <span className="text-black dark:text-white font-bold tabular-nums">{fmtRD(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-black/60 dark:text-white/60 font-semibold">ITBIS 18%</span>
            <span className="text-black dark:text-white font-bold tabular-nums">{fmtRD(itbis)}</span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-black/10 dark:border-white/10">
            <span className="text-sm font-black text-black dark:text-white">Total</span>
            <span className="text-xl font-black text-[#b3001e] tabular-nums">{fmtRD(total)}</span>
          </div>
          <button
            disabled={!cart.length}
            onClick={() => setCobrarOpen(true)}
            className="mt-2 w-full py-4 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] disabled:opacity-30 disabled:cursor-not-allowed text-white font-black text-base uppercase tracking-wider transition-all hover:shadow-lg hover:shadow-[#b3001e]/30"
          >
            {t(lang, 'Cobrar', 'Charge')}
          </button>
        </div>
      </div>

      <DemoCobrarModal
        open={cobrarOpen}
        onClose={() => { setCobrarOpen(false); setCart([]); onCobrar?.() }}
        total={total}
        lang={lang}
        vertical={vertical}
        items={cart}
      />
    </div>
  )
}
