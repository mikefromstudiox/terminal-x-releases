import { useState, useEffect, useMemo } from 'react'
import { Wine, Calendar, Loader2, TrendingUp, Undo2 } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// 30-day rolling window — deep enough for monthly reconciliation yet cheap to query.
function defaultRange() {
  const to = new Date()
  const from = new Date(); from.setDate(from.getDate() - 30)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

// ── Bottle-deposit report (licorería only) ────────────────────────────────────
// Aggregates every ticket_item whose SKU is the synthetic 'DEP' marker that
// RetailPOS emits for bottle deposits. Collapsed into a daily timeline plus a
// grand total. Read-only — reconciliation of returned bottles will land in
// Phase 2 when we wire up the store-credit ledger.
export default function BottleDepositReport() {
  const api = useAPI()
  const { lang } = useLang()
  const [range, setRange] = useState(defaultRange)
  const [rows, setRows]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const tickets = await api?.reports?.tickets?.({ from: range.from, to: range.to }) || []
        // v2.6 — deposit detection priority: explicit `is_deposit` flag
        // (canonical, persisted on ticket_items) → legacy `bottle_deposit_line`
        // runtime flag → synthetic 'DEP' / 'DEP-RET' SKU marker. Any row tied
        // to a negative-total ticket with the [deposit_return] marker is
        // accounted as a REFUND (kind='refund') so the report subtracts it
        // from gross deposits and surfaces the net liability.
        const out = []
        for (const t of tickets) {
          const notes = String(t.notes || '')
          const ticketTotal = Number(t.total || 0)
          const isRefundTicket = ticketTotal < 0 && notes.includes('[deposit_return]')
          for (const it of (t.items || t.services || [])) {
            const sku = String(it.sku || '').toUpperCase()
            const isDeposit = it.is_deposit === true || it.is_deposit === 1 ||
                              it.bottle_deposit_line === true ||
                              sku === 'DEP' || sku === 'DEP-RET'
            if (!isDeposit) continue
            const qty   = Number(it.quantity || it.qty || 1)
            const price = Math.abs(Number(it.price || 0))
            out.push({
              date:     (t.created_at || t.date || '').slice(0, 10),
              ticket:   t.doc_number || t.docNumber || t.id,
              product:  it.name || '',
              qty,
              price,
              total:    price * qty,
              kind:     isRefundTicket ? 'refund' : 'collect',
            })
          }
        }
        if (!cancelled) setRows(out)
      } catch (_aetherErr) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'bottledepositreport.fmtrd' }) } catch {}
        if (!cancelled) setRows([])
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [api, range.from, range.to])

  const { collected, refunded, netLiability, byDay, bottleCount, bottleReturned } = useMemo(() => {
    let collected = 0, refunded = 0, bottleCount = 0, bottleReturned = 0
    const by = new Map()
    for (const r of rows) {
      if (r.kind === 'refund') {
        refunded += r.total
        bottleReturned += r.qty
        by.set(r.date, (by.get(r.date) || 0) - r.total)
      } else {
        collected += r.total
        bottleCount += r.qty
        by.set(r.date, (by.get(r.date) || 0) + r.total)
      }
    }
    const byDay = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    return { collected, refunded, netLiability: collected - refunded, byDay, bottleCount, bottleReturned }
  }, [rows])

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-4 md:px-6 py-3 border-b border-slate-200 dark:border-white/10 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-slate-400" />
          <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
            className="border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1 text-sm bg-white dark:bg-white/5 dark:text-white" />
          <span className="text-slate-400 text-xs">→</span>
          <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
            className="border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1 text-sm bg-white dark:bg-white/5 dark:text-white" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50 dark:bg-black space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 p-4">
            <div className="flex items-center gap-2">
              <Wine size={14} className="text-[#b3001e]" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/40">
                {lang === 'es' ? 'Cobrados' : 'Collected'}
              </p>
            </div>
            <p className="mt-2 text-2xl font-black text-[#b3001e]">{fmtRD(collected)}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{bottleCount} {lang === 'es' ? 'envases' : 'bottles'}</p>
          </div>
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 p-4">
            <div className="flex items-center gap-2">
              <Undo2 size={14} className="text-emerald-600" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/40">
                {lang === 'es' ? 'Devueltos' : 'Refunded'}
              </p>
            </div>
            <p className="mt-2 text-2xl font-black text-emerald-600">{fmtRD(refunded)}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{bottleReturned} {lang === 'es' ? 'envases' : 'bottles'}</p>
          </div>
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 p-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className={netLiability >= 0 ? 'text-amber-600' : 'text-slate-400'} />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/40">
                {lang === 'es' ? 'Pasivo neto' : 'Net liability'}
              </p>
            </div>
            <p className={`mt-2 text-2xl font-black ${netLiability >= 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{fmtRD(netLiability)}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{lang === 'es' ? 'a devolver' : 'owed to customers'}</p>
          </div>
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 p-4">
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-slate-400" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/40">
                {lang === 'es' ? 'Días activos' : 'Active days'}
              </p>
            </div>
            <p className="mt-2 text-2xl font-black text-slate-800 dark:text-white">{byDay.length}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-slate-400" />
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 p-10 text-center">
            <Wine size={28} strokeWidth={1.3} className="mx-auto text-slate-300 dark:text-white/20" />
            <p className="mt-3 text-sm text-slate-500 dark:text-white/50">
              {lang === 'es' ? 'Sin depósitos en este período.' : 'No deposits in this period.'}
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-black/30 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/60">
                <tr>
                  <th className="px-4 py-2 text-left">Fecha</th>
                  <th className="px-4 py-2 text-left">Ticket</th>
                  <th className="px-4 py-2 text-left">Producto</th>
                  <th className="px-4 py-2 text-right">Cant.</th>
                  <th className="px-4 py-2 text-right">Depósito</th>
                  <th className="px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isRef = r.kind === 'refund'
                  return (
                    <tr key={i} className={`border-t border-slate-100 dark:border-white/5 ${isRef ? 'bg-emerald-50/40 dark:bg-emerald-500/5' : ''} text-slate-700 dark:text-white/80`}>
                      <td className="px-4 py-2">{r.date}</td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {isRef && <span className="mr-1 text-emerald-600 font-bold">↩</span>}
                        {r.ticket}
                      </td>
                      <td className="px-4 py-2">{r.product}</td>
                      <td className="px-4 py-2 text-right">{r.qty}</td>
                      <td className="px-4 py-2 text-right">{fmtRD(r.price)}</td>
                      <td className={`px-4 py-2 text-right font-semibold ${isRef ? 'text-emerald-600' : 'text-[#b3001e]'}`}>
                        {isRef ? '−' : ''}{fmtRD(r.total)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
