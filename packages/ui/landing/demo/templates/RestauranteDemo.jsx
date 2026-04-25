import { useState } from 'react'
import { UtensilsCrossed, Users, ChefHat, Clock, ShoppingCart, Plus, Minus, Trash2 } from 'lucide-react'
import { RESTAURANT_TABLES, RESTAURANT_MENU, KDS_ORDERS, fmtRD, t, VERTICAL_LABEL } from '../demoMockData'
import { DemoCobrarModal } from '../DemoChrome'

const TABLE_STYLES = {
  libre:    { bg: 'bg-white dark:bg-white/5',       border: 'border-black/10 dark:border-white/10',     text: 'text-black/50 dark:text-white/50',  label_es: 'Libre',    label_en: 'Free' },
  ocupada:  { bg: 'bg-[#b3001e] text-white',         border: 'border-[#b3001e]',                          text: 'text-white',                          label_es: 'Ocupada',  label_en: 'Occupied' },
  cuenta:   { bg: 'bg-amber-500 text-black',         border: 'border-amber-500',                          text: 'text-black',                          label_es: 'A cuenta', label_en: 'Bill' },
}

export default function RestauranteDemo({ vertical, lang, onCobrar }) {
  const [tables, setTables] = useState(RESTAURANT_TABLES)
  const [activeTable, setActiveTable] = useState(null)
  const [cart, setCart] = useState([])
  const [cobrarOpen, setCobrarOpen] = useState(false)

  function pickTable(t) {
    setActiveTable(t)
    if (t.state === 'libre') {
      setTables(prev => prev.map(p => p.id === t.id ? { ...p, state: 'ocupada', cover: 2 } : p))
    }
    setCart([])
  }
  function addItem(m) {
    setCart(c => {
      const idx = c.findIndex(x => x.id === m.id)
      if (idx >= 0) {
        const copy = [...c]; copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 }; return copy
      }
      return [...c, { ...m, qty: 1 }]
    })
  }
  function changeQty(id, d) {
    setCart(c => c.map(it => it.id === id ? { ...it, qty: Math.max(0, it.qty + d) } : it).filter(it => it.qty > 0))
  }
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0)
  const subtotal = total / 1.18
  const itbis = total - subtotal

  return (
    <div className="bg-slate-50 dark:bg-black min-h-[calc(100vh-44px)] flex flex-col xl:flex-row">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="bg-white dark:bg-white/5 border-b border-black/5 dark:border-white/10 px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#b3001e]/10 flex items-center justify-center">
            <UtensilsCrossed size={20} className="text-[#b3001e]" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black text-black dark:text-white">{VERTICAL_LABEL[vertical]?.[lang]}</h2>
            <p className="text-[11px] font-bold text-black/50 dark:text-white/50">
              {tables.filter(t => t.state !== 'libre').length}/{tables.length} {t(lang, 'mesas activas', 'tables active')}
            </p>
          </div>
        </div>

        {/* Tables grid */}
        <div className="px-4 sm:px-6 py-4 border-b border-black/5 dark:border-white/10">
          <h3 className="text-[11px] font-extrabold tracking-[2px] uppercase text-black/50 dark:text-white/50 mb-3">
            {t(lang, 'Salón', 'Floor')}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {tables.map(tb => {
              const s = TABLE_STYLES[tb.state]
              const active = activeTable?.id === tb.id
              return (
                <button
                  key={tb.id}
                  onClick={() => pickTable(tb)}
                  className={`relative aspect-square rounded-xl border-2 ${s.border} ${s.bg} transition-all hover:scale-[1.03] ${active ? 'ring-4 ring-[#b3001e]/40' : ''}`}
                >
                  <div className="flex flex-col items-center justify-center h-full p-2">
                    <p className={`text-base font-black ${s.text}`}>{tb.label}</p>
                    {tb.state !== 'libre' && (
                      <>
                        <p className={`text-[10px] font-bold ${s.text} mt-1 inline-flex items-center gap-1`}>
                          <Users size={10} /> {tb.cover}
                        </p>
                        <p className={`mt-1 text-xs font-black tabular-nums ${s.text}`}>{fmtRD(tb.total)}</p>
                      </>
                    )}
                    <p className={`mt-1 text-[9px] font-black uppercase tracking-wide ${s.text}`}>
                      {lang === 'en' ? s.label_en : s.label_es}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Menu */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <h3 className="text-[11px] font-extrabold tracking-[2px] uppercase text-black/50 dark:text-white/50 mb-3">
            {t(lang, 'Menú', 'Menu')} {activeTable && `· ${activeTable.label}`}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {RESTAURANT_MENU.map(m => (
              <button
                key={m.id}
                onClick={() => activeTable ? addItem(m) : alert(t(lang, 'Selecciona una mesa primero.', 'Select a table first.'))}
                className="text-left bg-white dark:bg-white/5 hover:border-[#b3001e] hover:shadow-lg hover:-translate-y-0.5 border border-black/10 dark:border-white/10 rounded-xl p-3 transition-all"
              >
                <p className="text-[10px] font-extrabold tracking-wider uppercase text-[#b3001e]">{m.cat}</p>
                <p className="text-xs font-black text-black dark:text-white leading-tight line-clamp-2 min-h-[2rem] mt-0.5">{m.name}</p>
                <p className="mt-1.5 text-sm font-black text-black dark:text-white tabular-nums">{fmtRD(m.price)}</p>
              </button>
            ))}
          </div>

          {/* KDS Preview */}
          <div className="mt-8">
            <h3 className="text-[11px] font-extrabold tracking-[2px] uppercase text-black/50 dark:text-white/50 mb-3 flex items-center gap-2">
              <ChefHat size={13} className="text-[#b3001e]" /> {t(lang, 'KDS · Cocina', 'KDS · Kitchen')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {KDS_ORDERS.map(o => (
                <div key={o.id} className="bg-black text-white rounded-xl p-4 border border-white/10">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-black">{o.table}</p>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400">
                      <Clock size={11} /> {o.age}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {o.items.map((it, i) => (
                      <li key={i} className="text-xs text-white/80 font-semibold">• {it}</li>
                    ))}
                  </ul>
                  <div className="mt-3 inline-flex px-2 py-0.5 rounded-full bg-[#b3001e]/20 border border-[#b3001e]/40 text-[10px] font-black uppercase tracking-wider text-[#b3001e]">
                    {o.status}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* TICKET PANEL */}
      <div className="w-full xl:w-96 bg-white dark:bg-white/5 border-t xl:border-t-0 xl:border-l border-black/5 dark:border-white/10 flex flex-col">
        <div className="px-5 py-4 border-b border-black/5 dark:border-white/10">
          <h3 className="text-sm font-black uppercase tracking-wide text-black dark:text-white flex items-center gap-2">
            <ShoppingCart size={16} className="text-[#b3001e]" />
            {activeTable ? activeTable.label : t(lang, 'Sin mesa', 'No table')}
          </h3>
          <p className="text-[11px] text-black/50 dark:text-white/50 font-semibold mt-1">
            {cart.length} {t(lang, 'productos', 'items')}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 max-h-[40vh] xl:max-h-none">
          {cart.length === 0 && (
            <div className="text-center py-12 text-black/40 dark:text-white/40 text-xs">
              {activeTable ? t(lang, 'Toca un platillo.', 'Tap a dish.') : t(lang, 'Selecciona una mesa.', 'Pick a table.')}
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
            className="mt-2 w-full py-4 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] disabled:opacity-30 text-white font-black text-base uppercase tracking-wider transition-all hover:shadow-lg hover:shadow-[#b3001e]/30"
          >
            {t(lang, 'Cobrar Mesa', 'Charge Table')}
          </button>
        </div>
      </div>

      <DemoCobrarModal
        open={cobrarOpen}
        onClose={() => { setCobrarOpen(false); setCart([]); setActiveTable(null); onCobrar?.() }}
        total={total}
        lang={lang}
        vertical={vertical}
      />
    </div>
  )
}
