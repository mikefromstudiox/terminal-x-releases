import { useState, useEffect, useMemo } from 'react'
import { Package, Search, ChevronUp, ChevronDown, Loader2, Calendar } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function todayStr() { return new Date().toISOString().slice(0, 10) }
function monthAgoStr() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

export default function ProductsReport() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [from, setFrom] = useState(monthAgoStr())
  const [to, setTo] = useState(todayStr())
  const [loading, setLoading] = useState(true)
  const [tickets, setTickets] = useState([])
  const [shortages, setShortages] = useState([])
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('revenue')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [tData, sData] = await Promise.all([
          api.tickets.byDateRange({ dateFrom: from + 'T00:00:00', dateTo: to + 'T23:59:59' }),
          api.inventory?.oversells?.list?.({ from: from + 'T00:00:00', to: to + 'T23:59:59' }) || Promise.resolve([]),
        ])
        if (!cancelled) {
          setTickets(tData || [])
          setShortages(Array.isArray(sData) ? sData : [])
        }
      } catch {}
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [from, to, api])

  // v2.11.2 — Shortage index. Keyed by every identifier we might match against
  // the product aggregation (item_supabase_id, inventory_item_id, sku, name).
  const shortageIndex = useMemo(() => {
    const idx = {}
    for (const r of shortages) {
      const short = Math.max(0, (Number(r.requested_qty) || 0) - (Number(r.actual_qty) || 0))
      const events = 1
      const keys = [
        r.item_supabase_id,
        r.inventory_item_id != null ? String(r.inventory_item_id) : null,
        r.sku,
        r.item_name,
      ].filter(Boolean)
      for (const k of keys) {
        if (!idx[k]) idx[k] = { short: 0, events: 0 }
        idx[k].short  += short
        idx[k].events += events
      }
    }
    return idx
  }, [shortages])

  // Aggregate by product
  // DR convention: when a line aplica_itbis, the 18% belongs to DGII — not the
  // owner. "Margen %" is computed on the NET (ex-ITBIS) price so the number
  // reflects what the owner actually keeps, matching Inventario and STARSISA.
  // We also track whether the bulk of a product's revenue came from taxed
  // lines so the tooltip can be honest about which formula was applied.
  const products = useMemo(() => {
    const map = {}
    for (const t of tickets) {
      if (t.status === 'nula') continue
      const items = t.items || t.ticket_items || []
      for (const item of items) {
        const key = item.inventory_item_id || item.sku || item.name
        if (!key) continue
        if (!map[key]) {
          map[key] = {
            name: item.name,
            sku: item.sku || '',
            unitsSold: 0,
            revenue: 0,
            revenueNet: 0,
            cost: 0,
            profit: 0,
            profitNet: 0,
            transactions: 0,
            taxedRevenue: 0,
          }
        }
        const qty = item.quantity || 1
        const lineTotal = (item.price || 0) * qty
        const lineCost = (item.cost || 0) * qty
        const aplica = item.aplica_itbis === 1 || item.aplica_itbis === true
        const lineNet = aplica ? lineTotal / 1.18 : lineTotal
        map[key].unitsSold += qty
        map[key].revenue += lineTotal
        map[key].revenueNet += lineNet
        map[key].cost += lineCost
        map[key].profit += lineTotal - lineCost
        map[key].profitNet += lineNet - lineCost
        map[key].transactions++
        if (aplica) map[key].taxedRevenue += lineTotal
      }
    }
    // Derive margin % on net revenue (owner-keep basis).
    for (const p of Object.values(map)) {
      p.marginPct = p.revenueNet > 0 ? ((p.revenueNet - p.cost) / p.revenueNet) * 100 : 0
      p.mostlyTaxed = p.revenue > 0 && (p.taxedRevenue / p.revenue) >= 0.5
    }
    return Object.values(map)
  }, [tickets])

  // Attach shortage counts to each product after aggregation so the column
  // reflects true quiebres even when the product was sold from stock fine
  // on some tickets and short on others.
  const productsWithShortages = useMemo(() => {
    return products.map(p => {
      const hit = shortageIndex[p.sku] || shortageIndex[p.name] || null
      return { ...p, shortageQty: hit?.short || 0, shortageEvents: hit?.events || 0 }
    })
  }, [products, shortageIndex])

  // Filter + sort
  const filtered = useMemo(() => {
    let list = productsWithShortages
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
    }
    list.sort((a, b) => {
      const av = a[sortBy] || 0, bv = b[sortBy] || 0
      return sortDir === 'desc' ? bv - av : av - bv
    })
    return list
  }, [products, search, sortBy, sortDir])

  // Totals
  const totals = useMemo(() => {
    const revenueNet = products.reduce((s, p) => s + (p.revenueNet || 0), 0)
    const cost = products.reduce((s, p) => s + p.cost, 0)
    return {
      units: products.reduce((s, p) => s + p.unitsSold, 0),
      revenue: products.reduce((s, p) => s + p.revenue, 0),
      revenueNet,
      cost,
      profit: products.reduce((s, p) => s + p.profit, 0),
      marginPct: revenueNet > 0 ? ((revenueNet - cost) / revenueNet) * 100 : 0,
    }
  }, [products])

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(col); setSortDir('desc') }
  }

  const SortIcon = ({ col }) => {
    if (sortBy !== col) return null
    return sortDir === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Controls */}
      <div className="px-4 md:px-6 py-3 flex flex-wrap items-center gap-3 border-b border-slate-200 dark:border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-slate-400" />
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="text-xs border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5 bg-white dark:bg-white/5 text-slate-700 dark:text-white" />
          <span className="text-xs text-slate-400">—</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="text-xs border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5 bg-white dark:bg-white/5 text-slate-700 dark:text-white" />
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg flex-1 max-w-xs">
          <Search size={13} className="text-slate-400 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={L('Buscar producto...', 'Search product...')}
            className="flex-1 min-w-0 bg-transparent outline-none text-xs text-slate-700 dark:text-white placeholder:text-slate-400" />
        </div>
      </div>

      {/* Summary stats */}
      <div className="px-4 md:px-6 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
        {[
          { label: L('Productos vendidos', 'Products sold'), value: products.length },
          { label: L('Unidades vendidas', 'Units sold'), value: totals.units },
          { label: L('Ingresos', 'Revenue'), value: fmtRD(totals.revenue) },
          { label: L('Ganancia', 'Profit'), value: fmtRD(totals.profit), color: totals.profit > 0 ? 'text-emerald-600 dark:text-emerald-400' : '' },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2">
            <p className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider">{s.label}</p>
            <p className={`text-[16px] font-bold text-slate-800 dark:text-white ${s.color || ''}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-4 md:px-6 pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={20} className="animate-spin text-slate-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
            <Package size={36} strokeWidth={1} />
            <p className="text-sm">{L('No hay ventas de productos en este periodo', 'No product sales in this period')}</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-black z-10">
              <tr className="border-b border-slate-200 dark:border-white/10">
                <th className="text-left px-3 py-2 font-semibold text-slate-500 dark:text-white/40">{L('Producto', 'Product')}</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-500 dark:text-white/40">SKU</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-500 dark:text-white/40 cursor-pointer select-none" onClick={() => toggleSort('unitsSold')}>
                  <span className="inline-flex items-center gap-1">{L('Uds.', 'Qty')} <SortIcon col="unitsSold" /></span>
                </th>
                <th className="text-right px-3 py-2 font-semibold text-slate-500 dark:text-white/40 cursor-pointer select-none" onClick={() => toggleSort('revenue')}>
                  <span className="inline-flex items-center gap-1">{L('Ingresos', 'Revenue')} <SortIcon col="revenue" /></span>
                </th>
                <th className="text-right px-3 py-2 font-semibold text-slate-500 dark:text-white/40 cursor-pointer select-none" onClick={() => toggleSort('cost')}>
                  <span className="inline-flex items-center gap-1">{L('Costo', 'Cost')} <SortIcon col="cost" /></span>
                </th>
                <th className="text-right px-3 py-2 font-semibold text-slate-500 dark:text-white/40 cursor-pointer select-none" onClick={() => toggleSort('profit')}>
                  <span className="inline-flex items-center gap-1">{L('Ganancia', 'Profit')} <SortIcon col="profit" /></span>
                </th>
                <th className="text-right px-3 py-2 font-semibold text-slate-500 dark:text-white/40 cursor-pointer select-none" onClick={() => toggleSort('marginPct')}
                  title={L('Margen neto calculado sobre el precio sin ITBIS cuando aplica', 'Net margin computed on the ex-ITBIS price when applicable')}>
                  <span className="inline-flex items-center gap-1">{L('Margen %', 'Margin %')} <SortIcon col="marginPct" /></span>
                </th>
                <th className="text-right px-3 py-2 font-semibold text-slate-500 dark:text-white/40">{L('Ventas', 'Sales')}</th>
                <th className="text-right px-3 py-2 font-semibold text-red-500 dark:text-red-400 cursor-pointer select-none" onClick={() => toggleSort('shortageQty')}
                  title={L('Unidades vendidas sin stock suficiente (quiebres de inventario)', 'Units sold exceeding available stock (inventory shortages)')}>
                  <span className="inline-flex items-center gap-1">{L('Quiebres', 'Short')} <SortIcon col="shortageQty" /></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5">
                  <td className="px-3 py-2 font-medium text-slate-800 dark:text-white">{p.name}</td>
                  <td className="px-3 py-2 text-slate-400 dark:text-white/40 font-mono">{p.sku || '—'}</td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-white tabular-nums">{p.unitsSold}</td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-white tabular-nums">{fmtRD(p.revenue)}</td>
                  <td className="px-3 py-2 text-right text-slate-500 dark:text-white/60 tabular-nums">{fmtRD(p.cost)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${p.profit > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{fmtRD(p.profit)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${p.marginPct > 0 ? 'text-emerald-600 dark:text-emerald-400' : p.marginPct < 0 ? 'text-red-500 dark:text-red-400' : 'text-slate-400 dark:text-white/30'}`}
                    title={p.mostlyTaxed
                      ? L('Margen neto (precio sin ITBIS − costo) ÷ precio sin ITBIS', 'Net margin (ex-ITBIS price − cost) ÷ ex-ITBIS price')
                      : L('Margen (precio − costo) ÷ precio', 'Margin (price − cost) ÷ price')}>
                    {p.revenueNet > 0 ? `${Math.round(p.marginPct)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500 dark:text-white/60">{p.transactions}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.shortageQty > 0 ? (
                      <span className="font-semibold text-red-500 dark:text-red-400" title={`${p.shortageEvents} ${L('eventos', 'events')}`}>
                        {Number.isInteger(p.shortageQty) ? p.shortageQty : p.shortageQty.toFixed(2)}
                      </span>
                    ) : <span className="text-slate-300 dark:text-white/20">—</span>}
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="border-t-2 border-slate-300 dark:border-white/20 bg-slate-50 dark:bg-white/5 font-bold">
                <td className="px-3 py-2 text-slate-800 dark:text-white">TOTAL</td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 text-right text-slate-800 dark:text-white tabular-nums">{totals.units}</td>
                <td className="px-3 py-2 text-right text-slate-800 dark:text-white tabular-nums">{fmtRD(totals.revenue)}</td>
                <td className="px-3 py-2 text-right text-slate-500 dark:text-white/60 tabular-nums">{fmtRD(totals.cost)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${totals.profit > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{fmtRD(totals.profit)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${totals.marginPct > 0 ? 'text-emerald-600 dark:text-emerald-400' : totals.marginPct < 0 ? 'text-red-500' : 'text-slate-400 dark:text-white/30'}`}>
                  {totals.revenueNet > 0 ? `${Math.round(totals.marginPct)}%` : '—'}
                </td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 text-right tabular-nums text-red-500 dark:text-red-400">
                  {(() => {
                    const t = filtered.reduce((s, p) => s + (p.shortageQty || 0), 0)
                    return t > 0 ? (Number.isInteger(t) ? t : t.toFixed(2)) : '—'
                  })()}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
