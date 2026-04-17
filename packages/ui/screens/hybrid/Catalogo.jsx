import { useState, lazy, Suspense } from 'react'
import { Utensils, Package } from 'lucide-react'

// Combined menu + inventory editor for the hybrid vertical. One screen, two
// panes: "Menú" for dine-in plates (with modifiers / courses / KDS station)
// and "Productos" for retail SKUs (barcode / stock / price / cost).
// Each pane is lazy-loaded so the bundle penalty stays minimal until the
// cashier actually switches tabs.
const MenuBuilder = lazy(() => import('../restaurant/MenuBuilder'))
const Inventory   = lazy(() => import('../Inventory'))

export default function Catalogo() {
  const [tab, setTab] = useState('menu') // 'menu' | 'inventory'
  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-black">
      <div className="shrink-0 bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-3 md:px-6 pt-3 md:pt-4 pb-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">Catálogo</h2>
            <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">
              Menú de mesa y productos de tienda en un solo lugar.
            </p>
          </div>
          <div className="inline-flex rounded-lg bg-slate-100 dark:bg-white/10 p-0.5">
            <button
              onClick={() => setTab('menu')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                tab === 'menu' ? 'bg-[#b3001e] text-white' : 'text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <Utensils size={12} /> Menú
            </button>
            <button
              onClick={() => setTab('inventory')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                tab === 'inventory' ? 'bg-[#b3001e] text-white' : 'text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <Package size={12} /> Productos
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <Suspense fallback={<div className="p-6 text-xs text-slate-500 dark:text-white/40">Cargando…</div>}>
          {tab === 'menu' ? <MenuBuilder /> : <Inventory />}
        </Suspense>
      </div>
    </div>
  )
}
