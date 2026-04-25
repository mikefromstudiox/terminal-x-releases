import { useState, useMemo } from 'react'
import {
  Search, Barcode, Plus, Minus, Trash2, ShoppingCart, UserRound,
  Wine, Pill, ShoppingBasket, ShoppingCart as Cart, Hammer, BookOpen, Shirt, Coins, Package
} from 'lucide-react'
import { catalogFor, fmtRD, t, VERTICAL_LABEL, CLIENTS } from '../demoMockData'
import { DemoCobrarModal } from '../DemoChrome'

const ICON_BY_VERT = {
  licoreria: Wine, farmacia: Pill, colmado: ShoppingBasket, supermercado: Cart,
  ferreteria: Hammer, papeleria: BookOpen, boutique: Shirt, pawn: Coins, tienda: Package,
}

export default function TiendaDemo({ vertical, lang, onCobrar }) {
  const Icon = ICON_BY_VERT[vertical] || Package
  const { categories, products } = catalogFor(vertical)
  const [activeCat, setActiveCat] = useState(categories[0])
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState([])
  const [client, setClient] = useState(null)
  const [cobrarOpen, setCobrarOpen] = useState(false)

  const filtered = useMemo(() => {
    return products.filter(p => {
      if (activeCat && p.cat !== activeCat) return false
      if (search) {
        const q = search.toLowerCase()
        return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
      }
      return true
    })
  }, [products, activeCat, search])

  function addToCart(p) {
    setCart(c => {
      const idx = c.findIndex(x => x.sku === p.sku)
      if (idx >= 0) {
        const copy = [...c]
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 }
        return copy
      }
      return [...c, { ...p, qty: 1 }]
    })
  }

  function changeQty(sku, delta) {
    setCart(c =>
      c.map(it => it.sku === sku ? { ...it, qty: Math.max(0, it.qty + delta) } : it).filter(it => it.qty > 0)
    )
  }

  function removeItem(sku) { setCart(c => c.filter(i => i.sku !== sku)) }

  const total = useMemo(() => cart.reduce((s, i) => s + i.price * i.qty, 0), [cart])
  const subtotal = total / 1.18
  const itbis = total - subtotal

  function handleCobrar() {
    if (!cart.length) return
    setCobrarOpen(true)
  }

  function closeCobrar() {
    setCobrarOpen(false)
    setCart([])
    setClient(null)
    onCobrar?.()
  }

  return (
    <div className="bg-slate-50 dark:bg-black min-h-[calc(100vh-44px)] flex flex-col lg:flex-row">
      {/* MAIN — products grid */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="bg-white dark:bg-white/5 border-b border-black/5 dark:border-white/10 px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
          <div className="w-10 h-10 rounded-xl bg-[#b3001e]/10 flex items-center justify-center">
            <Icon size={20} className="text-[#b3001e]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-black text-black dark:text-white truncate">
              {VERTICAL_LABEL[vertical]?.[lang] || 'Tienda'}
            </h2>
            <p className="text-[11px] font-bold text-black/50 dark:text-white/50">
              {t(lang, 'Cajero: Demo', 'Cashier: Demo')} · {t(lang, 'Turno abierto', 'Shift open')}
            </p>
          </div>
          <div className="flex-1" />
          <div className="relative w-full sm:w-auto sm:min-w-[280px] order-3 sm:order-none mt-2 sm:mt-0">
            <Barcode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40 dark:text-white/40" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t(lang, 'Escanea o busca SKU…', 'Scan or search SKU…')}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-100 dark:bg-white/10 text-sm text-black dark:text-white placeholder-black/40 dark:placeholder-white/40 outline-none focus:ring-2 focus:ring-[#b3001e]"
            />
          </div>
        </div>

        {/* Category tabs */}
        <div className="bg-white dark:bg-white/5 border-b border-black/5 dark:border-white/10 px-4 sm:px-6 py-2 flex gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveCat(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide whitespace-nowrap transition-colors ${
              !activeCat ? 'bg-[#b3001e] text-white' : 'bg-slate-100 dark:bg-white/10 text-black dark:text-white hover:bg-slate-200 dark:hover:bg-white/20'
            }`}
          >
            {t(lang, 'Todos', 'All')} <span className="opacity-60 ml-1">{products.length}</span>
          </button>
          {categories.map(c => {
            const count = products.filter(p => p.cat === c).length
            return (
              <button
                key={c}
                onClick={() => setActiveCat(c)}
                className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide whitespace-nowrap transition-colors ${
                  activeCat === c ? 'bg-[#b3001e] text-white' : 'bg-slate-100 dark:bg-white/10 text-black dark:text-white hover:bg-slate-200 dark:hover:bg-white/20'
                }`}
              >
                {c} <span className="opacity-60 ml-1">{count}</span>
              </button>
            )
          })}
        </div>

        {/* Products grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map(p => (
              <button
                key={p.sku}
                onClick={() => addToCart(p)}
                className="group text-left bg-white dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 hover:border-[#b3001e] hover:shadow-lg hover:-translate-y-0.5 border border-black/10 dark:border-white/10 rounded-xl p-3 transition-all"
              >
                <div className="aspect-square rounded-lg bg-gradient-to-br from-slate-100 to-slate-50 dark:from-white/10 dark:to-white/5 mb-2 flex items-center justify-center">
                  <Icon size={32} className="text-black/30 dark:text-white/30 group-hover:text-[#b3001e] transition-colors" />
                </div>
                <p className="text-[10px] font-mono text-black/40 dark:text-white/40 tabular-nums">{p.sku}</p>
                <p className="text-xs font-black text-black dark:text-white leading-tight line-clamp-2 min-h-[2rem]">{p.name}</p>
                <p className="mt-1.5 text-sm font-black text-[#b3001e] tabular-nums">{fmtRD(p.price)}</p>
              </button>
            ))}
          </div>
          {!filtered.length && (
            <div className="text-center py-16 text-black/40 dark:text-white/40 text-sm">
              {t(lang, 'Sin resultados.', 'No results.')}
            </div>
          )}
        </div>
      </div>

      {/* CART — right panel */}
      <div className="w-full lg:w-96 bg-white dark:bg-white/5 border-t lg:border-t-0 lg:border-l border-black/5 dark:border-white/10 flex flex-col">
        <div className="px-5 py-4 border-b border-black/5 dark:border-white/10 flex items-center justify-between">
          <h3 className="text-sm font-black uppercase tracking-wide text-black dark:text-white flex items-center gap-2">
            <ShoppingCart size={16} className="text-[#b3001e]" />
            {t(lang, 'Carrito', 'Cart')}
            <span className="px-1.5 py-0.5 rounded-full bg-[#b3001e] text-white text-[10px] tabular-nums">{cart.length}</span>
          </h3>
          {cart.length > 0 && (
            <button onClick={() => setCart([])} className="text-[11px] font-bold text-black/50 dark:text-white/50 hover:text-[#b3001e]">
              {t(lang, 'Vaciar', 'Clear')}
            </button>
          )}
        </div>

        {/* Client selector */}
        <div className="px-5 py-3 border-b border-black/5 dark:border-white/10">
          <button
            onClick={() => {
              const c = CLIENTS[Math.floor(Math.random() * CLIENTS.length)]
              setClient(client?.id === c.id ? CLIENTS[(CLIENTS.indexOf(c) + 1) % CLIENTS.length] : c)
            }}
            className="w-full flex items-center gap-2 text-left p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-[#b3001e]/10 flex items-center justify-center flex-shrink-0">
              <UserRound size={15} className="text-[#b3001e]" />
            </div>
            <div className="flex-1 min-w-0">
              {client ? (
                <>
                  <p className="text-xs font-black text-black dark:text-white truncate">{client.name}</p>
                  <p className="text-[10px] font-mono text-black/50 dark:text-white/50 tabular-nums">RNC {client.rnc}</p>
                </>
              ) : (
                <p className="text-xs font-bold text-black/50 dark:text-white/50">{t(lang, 'Consumidor final · toca para asignar', 'Walk-in · tap to assign')}</p>
              )}
            </div>
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 max-h-[40vh] lg:max-h-none">
          {cart.length === 0 && (
            <div className="text-center py-12 text-black/40 dark:text-white/40 text-xs">
              {t(lang, 'Toca un producto para agregar.', 'Tap a product to add.')}
            </div>
          )}
          {cart.map(it => (
            <div key={it.sku} className="bg-slate-50 dark:bg-white/5 rounded-lg p-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black text-black dark:text-white truncate">{it.name}</p>
                <p className="text-[11px] tabular-nums text-black/60 dark:text-white/60 font-semibold">{fmtRD(it.price)}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => changeQty(it.sku, -1)} className="w-7 h-7 rounded-md bg-white dark:bg-white/10 hover:bg-[#b3001e] hover:text-white flex items-center justify-center text-black dark:text-white transition-colors">
                  <Minus size={13} />
                </button>
                <span className="w-6 text-center text-xs font-black text-black dark:text-white tabular-nums">{it.qty}</span>
                <button onClick={() => changeQty(it.sku, 1)} className="w-7 h-7 rounded-md bg-white dark:bg-white/10 hover:bg-[#b3001e] hover:text-white flex items-center justify-center text-black dark:text-white transition-colors">
                  <Plus size={13} />
                </button>
              </div>
              <button onClick={() => removeItem(it.sku)} className="w-7 h-7 rounded-md text-black/40 dark:text-white/40 hover:bg-[#b3001e]/10 hover:text-[#b3001e] flex items-center justify-center transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        {/* Totals + Cobrar */}
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
            onClick={handleCobrar}
            className="mt-2 w-full py-4 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] disabled:opacity-30 disabled:cursor-not-allowed text-white font-black text-base uppercase tracking-wider transition-all hover:shadow-lg hover:shadow-[#b3001e]/30"
          >
            {t(lang, 'Cobrar', 'Charge')}
          </button>
        </div>
      </div>

      <DemoCobrarModal
        open={cobrarOpen}
        onClose={closeCobrar}
        total={total}
        lang={lang}
        vertical={vertical}
        items={cart}
      />
    </div>
  )
}
