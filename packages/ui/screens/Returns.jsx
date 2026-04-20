/**
 * Returns.jsx — Dedicated devoluciones (returns) flow (v2.7.1)
 *
 * Step 1: Search an existing ticket by doc_number / NCF.
 * Step 2: Select line items to return (qty per line).
 * Step 3: Pick refund method (efectivo / tarjeta / nota_credito).
 * Step 4: ManagerAuthGate approval (action="return").
 * Step 5: Write nota de crédito (reuses notas.create), reverse inventory for
 *         each returned SKU line, and append an activity_log row
 *         `return_processed` so the owner's audit feed sees it.
 *
 * Plan-gate: reuses the `credit_notes` feature key — a return IS a credit note
 * with inventory reversal. Gating via PlanGate is applied at the route level
 * in App.jsx / web/main.jsx.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftCircle, Search, X, CheckCircle2, AlertTriangle,
  Minus, Plus, Package, RotateCcw, Wallet, CreditCard, FileMinus,
} from 'lucide-react'
import { useAPI } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../i18n'
import ManagerAuthGate from '../components/ManagerAuthGate'

// ── Helpers ───────────────────────────────────────────────────────────────────
const DEFAULT_ITBIS_RATE = 18
const LEY_RATE           = 0.10

const REFUND_METHODS = [
  { key: 'efectivo',     es: 'Efectivo',        en: 'Cash',         icon: Wallet,     forma: 'Efectivo'          },
  { key: 'tarjeta',      es: 'Tarjeta',         en: 'Card',         icon: CreditCard, forma: 'Transferencia'     },
  { key: 'nota_credito', es: 'Nota de crédito', en: 'Credit note',  icon: FileMinus,  forma: 'Crédito en cuenta' },
]

function fmt(n) {
  return 'RD$' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function Returns() {
  const api       = useAPI()
  const { user }  = useAuth()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [query,      setQuery]      = useState('')
  const [loadingT,   setLoadingT]   = useState(false)
  const [ticket,     setTicket]     = useState(null)   // { id, doc_number, items: [...], ... }
  const [err,        setErr]        = useState('')
  const [returnQty,  setReturnQty]  = useState({})     // { [item.id]: qty }
  const [refundKey,  setRefundKey]  = useState('efectivo')
  const [comentario, setComentario] = useState('')
  const [showGate,   setShowGate]   = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [toast,      setToast]      = useState(null)
  const searchRef                   = useRef(null)

  // ── ITBIS rate for refund split ──────────────────────────────────────────────
  const [itbisRate, setItbisRate] = useState(DEFAULT_ITBIS_RATE)
  useEffect(() => {
    api?.settings?.get?.()
      .then(s => {
        const pct = Number(s?.itbis_pct)
        if (Number.isFinite(pct) && pct >= 0) setItbisRate(pct)
      })
      .catch(() => {})
  }, [api])
  const itbisFactor = Number(itbisRate) / 100

  useEffect(() => { searchRef.current?.focus() }, [])

  // ── Lookup ticket by doc_number / NCF ───────────────────────────────────────
  async function runSearch(e) {
    e?.preventDefault?.()
    const key = query.trim().toUpperCase()
    if (!key) return
    setLoadingT(true); setErr(''); setTicket(null); setReturnQty({})
    try {
      // Pull a wide date range via byDateRange then match either doc_number or NCF.
      // Falls back to a full load — web `tickets.all` caps at 500 which is fine
      // for a point-of-return workflow.
      const all = await api.tickets.byDateRange({ from: '2020-01-01', to: '2099-12-31' })
      const match = (all || []).find(t =>
        String(t.doc_number || '').toUpperCase() === key ||
        String(t.ncf || '').toUpperCase()         === key,
      )
      if (!match) { setErr(L('Factura no encontrada', 'Invoice not found')); return }
      if (match.status === 'void' || match.status === 'voided' || match.status === 'cancelled') {
        setErr(L('Factura anulada — no se puede devolver', 'Voided invoice — cannot return'))
        return
      }
      // Hydrate items via tickets.byId (both desktop + web implementations
      // populate .items with line detail including inventory_item_id/sku).
      const hydrated = await api.tickets.byId(match.id)
      if (!hydrated || !Array.isArray(hydrated.items) || !hydrated.items.length) {
        setErr(L('Factura sin items para devolver', 'Invoice has no returnable items'))
        return
      }
      setTicket(hydrated)
    } catch (ex) {
      console.error('[Returns] lookup error', ex)
      setErr(ex?.message || L('Error al buscar', 'Lookup error'))
    } finally { setLoadingT(false) }
  }

  // ── Return quantity helpers ──────────────────────────────────────────────────
  function setLineQty(itemId, qty, max) {
    const clamped = Math.max(0, Math.min(Number(max) || 0, Number(qty) || 0))
    setReturnQty(prev => ({ ...prev, [itemId]: clamped }))
  }
  function bumpLineQty(itemId, delta, max) {
    setLineQty(itemId, (returnQty[itemId] || 0) + delta, max)
  }
  function selectAll() {
    if (!ticket) return
    const next = {}
    for (const i of ticket.items) next[i.id] = Number(i.quantity || 1)
    setReturnQty(next)
  }
  function clearSelection() { setReturnQty({}) }

  // ── Derived refund amount ────────────────────────────────────────────────────
  const refundSummary = useMemo(() => {
    if (!ticket) return { lines: [], total: 0, itbis: 0, subtotal: 0 }
    const lines = (ticket.items || [])
      .map(i => {
        const rq = Number(returnQty[i.id] || 0)
        if (rq <= 0) return null
        const unit = Number(i.price || 0)
        const extended = unit * rq
        return { item: i, qty: rq, extended }
      })
      .filter(Boolean)
    const total = lines.reduce((s, l) => s + l.extended, 0)
    // Split total into ITBIS + subtotal using the same formula CreditNotes uses.
    const itbis = Number((total * itbisFactor / (1 + itbisFactor + LEY_RATE)).toFixed(2))
    const subtotal = Number((total - itbis).toFixed(2))
    return { lines, total, itbis, subtotal }
  }, [ticket, returnQty, itbisFactor])

  const canSubmit = !submitting && refundSummary.lines.length > 0 && refundSummary.total > 0

  // ── Submit return ────────────────────────────────────────────────────────────
  async function tryProcess() {
    if (!canSubmit) return
    setShowGate(true)
  }

  async function processReturn(approval) {
    setSubmitting(true)
    setShowGate(false)
    try {
      const refund = REFUND_METHODS.find(r => r.key === refundKey) || REFUND_METHODS[0]

      // 1. Pull empresa settings to decide ECF vs B04 sequence.
      const biz      = await api.admin.getEmpresa()
      const settings = (typeof biz?.settings === 'string') ? (() => { try { return JSON.parse(biz.settings) } catch { return {} } })() : (biz?.settings || {})
      const isECF    = settings.facturacion_mode === 'ecf'

      // 2. Issue NCF — for returns we prefer a simple B04 sequence. If the
      //    business is ECF-live, fire off the E34 e-CF through the existing
      //    CreditNotes path later; for now the nota stores the local sequence.
      let assignedNCF = null
      try {
        if (isECF) {
          // Delegate to the signAndSubmitECF helper by calling api.ncf.next('B04')
          // fallback if the ECF chain is unavailable in this context. Keeping
          // the return flow synchronous with a plain B04 keeps cashiers moving;
          // the business can void/reissue via CreditNotes if needed.
          assignedNCF = await api.ncf.next('B04')
        } else {
          assignedNCF = await api.ncf.next('B04')
        }
      } catch {
        assignedNCF = null
      }

      // 3. Persist nota de crédito row — motivo=Devolución.
      const notaData = {
        ncf:                assignedNCF,
        client_id:          ticket.client_id          || null,
        client_supabase_id: ticket.client_supabase_id || null,
        client_name:        ticket.client_name        || null,
        client_rnc:         ticket.client_rnc         || null,
        original_ticket_id:           ticket.id                          || null,
        original_ticket_supabase_id:  ticket.supabase_id                 || null,
        motivo:             'Devolución',
        amount:             refundSummary.total,
        itbis_revertido:    refundSummary.itbis,
        forma_devolucion:   refund.forma,
        comentario:         comentario.trim()
                               || L(`Devolución de ${refundSummary.lines.length} línea(s)`,
                                    `Return of ${refundSummary.lines.length} line(s)`),
        cajero_id:          (user?.id && user.id !== 'web') ? user.id : null,
        mac_jti:            approval?.mac_jti || null,
      }
      await api.notas.create(notaData)

      // 4. Reverse inventory for each returned SKU line. Services (no
      //    inventory_item_id) are skipped — nothing to restock.
      for (const line of refundSummary.lines) {
        const invId = line.item.inventory_item_id
        if (!invId) continue
        try {
          await api.inventory.adjust({
            id:     invId,
            delta:  Number(line.qty || 0),
            notes:  L(`Devolución ${ticket.doc_number || ''}`, `Return ${ticket.doc_number || ''}`).trim(),
            userId: (user?.id && user.id !== 'web') ? user.id : null,
          })
        } catch (ex) {
          console.error('[Returns] inventory.adjust failed', ex)
        }
      }

      // 5. Audit log — return_processed, severity=critical so it surfaces in
      //    RemoteDashboard's activity feed.
      try {
        await api.activity.record({
          event_type: 'return_processed',
          severity:   'critical',
          target_type: 'ticket',
          target_id:   ticket.id != null ? String(ticket.id) : null,
          target_name: ticket.doc_number || ticket.ncf || null,
          amount:      refundSummary.total,
          reason:      comentario.trim() || 'Devolución procesada',
          metadata: {
            refund_method: refund.forma,
            ncf:           assignedNCF,
            lines:         refundSummary.lines.map(l => ({
              item_id: l.item.inventory_item_id || null,
              sku:     l.item.sku || null,
              name:    l.item.name,
              qty:     l.qty,
              unit:    l.item.price,
              extended: l.extended,
            })),
            approved_by:      approval?.staff_name || null,
            approved_by_role: approval?.role       || null,
            approval_method:  approval?.method     || null,
          },
        })
      } catch {}

      setToast(L('Devolución procesada ✓', 'Return processed ✓'))
      // Reset state
      setTicket(null); setQuery(''); setReturnQty({}); setComentario(''); setRefundKey('efectivo')
      setTimeout(() => setToast(null), 3500)
      searchRef.current?.focus()
    } catch (ex) {
      console.error('[Returns] process error', ex)
      setErr(ex?.message || L('Error al procesar devolución', 'Process error'))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-black overflow-hidden">
      {showGate && (
        <ManagerAuthGate
          action="return"
          actionLabel={L(
            `Devolución · ${fmt(refundSummary.total)}`,
            `Return · ${fmt(refundSummary.total)}`,
          )}
          context={{
            amount:       refundSummary.total,
            target_type:  'ticket',
            target_id:    ticket?.id != null ? String(ticket.id) : null,
            target_name:  ticket?.doc_number || null,
            refund_method: refundKey,
            lines:        refundSummary.lines.length,
          }}
          onApprove={(approval) => processReturn(approval)}
          onCancel={() => setShowGate(false)}
        />
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-[#b3001e] text-white text-sm px-5 py-3 rounded-full shadow-lg flex items-center gap-2">
          <CheckCircle2 size={15} /> {toast}
        </div>
      )}

      {/* ── Header ── */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-4 py-3 md:px-6 md:py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <ArrowLeftCircle size={22} className="text-[#b3001e]" />
          <h1 className="text-[16px] font-bold text-slate-800 dark:text-white">
            {L('Devoluciones', 'Returns')}
          </h1>
          <span className="text-[11px] text-slate-400 dark:text-white/40 ml-1 hidden md:inline">
            {L('Buscar factura → seleccionar líneas → procesar', 'Find invoice → select lines → process')}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-4 p-4">
        {/* ── Search bar ── */}
        <form onSubmit={runSearch} className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 p-4 flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl focus-within:ring-2 focus-within:ring-[#b3001e]/40">
            <Search size={15} className="text-slate-400 dark:text-white/40 shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setErr('') }}
              placeholder={L('Buscar por # factura o NCF…', 'Search by invoice # or NCF…')}
              className="flex-1 bg-transparent outline-none text-[14px] text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40"
            />
            {query && (
              <button type="button" onClick={() => { setQuery(''); setTicket(null); setErr('') }}
                className="text-slate-400 hover:text-[#b3001e]">
                <X size={14} />
              </button>
            )}
          </div>
          <button type="submit" disabled={loadingT || !query.trim()}
            className="px-5 py-2.5 text-[13px] font-bold rounded-xl bg-[#b3001e] text-white hover:bg-[#8f0018] disabled:opacity-40">
            {loadingT ? L('Buscando…', 'Searching…') : L('Buscar', 'Search')}
          </button>
        </form>

        {err && !ticket && (
          <div className="rounded-xl border border-[#b3001e]/30 bg-[#b3001e]/5 px-4 py-3 flex items-center gap-2 text-[13px] text-[#b3001e]">
            <AlertTriangle size={14} /> {err}
          </div>
        )}

        {/* ── Ticket + line picker ── */}
        {ticket && (
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 shadow-sm">
            {/* Ticket header */}
            <div className="px-4 py-3 border-b border-slate-100 dark:border-white/10 flex flex-wrap items-center gap-3 justify-between">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/40">{L('Factura', 'Invoice')}</p>
                  <p className="text-[14px] font-mono font-bold text-slate-800 dark:text-white">{ticket.doc_number || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/40">NCF</p>
                  <p className="text-[12px] font-mono text-slate-700 dark:text-white/80">{ticket.ncf || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/40">{L('Cliente', 'Client')}</p>
                  <p className="text-[13px] text-slate-700 dark:text-white">{ticket.client_name || L('Consumidor Final', 'Final Consumer')}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/40">{L('Total', 'Total')}</p>
                  <p className="text-[14px] font-bold text-slate-800 dark:text-white tabular-nums">{fmt(ticket.total)}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={selectAll} className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10">
                  {L('Seleccionar todo', 'Select all')}
                </button>
                <button onClick={clearSelection} className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10">
                  {L('Limpiar', 'Clear')}
                </button>
              </div>
            </div>

            {/* Lines */}
            <div className="divide-y divide-slate-100 dark:divide-white/5">
              {ticket.items.map(line => {
                const max = Number(line.quantity || 1)
                const rq  = Number(returnQty[line.id] || 0)
                const isInventory = !!line.inventory_item_id
                return (
                  <div key={line.id} className={`px-4 py-3 flex items-center gap-3 transition ${rq > 0 ? 'bg-[#b3001e]/5 dark:bg-[#b3001e]/10' : ''}`}>
                    <Package size={16} className={isInventory ? 'text-[#b3001e] shrink-0' : 'text-slate-300 dark:text-white/20 shrink-0'} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">{line.name}</p>
                      <p className="text-[11px] text-slate-500 dark:text-white/50 tabular-nums">
                        {fmt(line.price)} × {max}
                        {line.sku && <span className="ml-2 font-mono text-[10px] text-slate-400 dark:text-white/40">{line.sku}</span>}
                        {!isInventory && <span className="ml-2 text-[10px] text-slate-400 dark:text-white/40">· {L('servicio', 'service')}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-0 rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 bg-white dark:bg-black shrink-0">
                      <button onClick={() => bumpLineQty(line.id, -1, max)} disabled={rq <= 0}
                        className="w-8 h-8 flex items-center justify-center text-[#b3001e] hover:bg-[#b3001e] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#b3001e]">
                        <Minus size={13} />
                      </button>
                      <input
                        type="number" min="0" max={max}
                        value={rq}
                        onChange={e => setLineQty(line.id, e.target.value, max)}
                        className="w-12 text-center text-[13px] font-bold tabular-nums bg-transparent border-x border-slate-200 dark:border-white/10 py-1.5 focus:outline-none text-slate-800 dark:text-white"
                      />
                      <button onClick={() => bumpLineQty(line.id, +1, max)} disabled={rq >= max}
                        className="w-8 h-8 flex items-center justify-center text-[#b3001e] hover:bg-[#b3001e] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#b3001e]">
                        <Plus size={13} />
                      </button>
                    </div>
                    <div className="w-24 text-right text-[13px] font-bold tabular-nums text-[#b3001e]">
                      {rq > 0 ? `− ${fmt(line.price * rq)}` : <span className="text-slate-300 dark:text-white/20 font-normal">—</span>}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Summary + refund method + action */}
            <div className="px-4 py-4 border-t border-slate-100 dark:border-white/10 bg-slate-50 dark:bg-black/40 flex flex-wrap items-end gap-4">
              {/* Refund method */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-1">{L('Método de reembolso', 'Refund method')}</p>
                <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
                  {REFUND_METHODS.map(r => {
                    const Icon = r.icon
                    const on = refundKey === r.key
                    return (
                      <button key={r.key} onClick={() => setRefundKey(r.key)}
                        className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold transition ${on ? 'bg-[#b3001e] text-white' : 'bg-white dark:bg-transparent text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/10'}`}>
                        <Icon size={13} /> {L(r.es, r.en)}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Comentario */}
              <div className="flex-1 min-w-[220px]">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/40 mb-1">{L('Comentario', 'Comment')}</p>
                <input
                  value={comentario}
                  onChange={e => setComentario(e.target.value)}
                  placeholder={L('Motivo / observaciones…', 'Reason / notes…')}
                  className="w-full border border-slate-200 dark:border-white/10 dark:bg-white/5 rounded-lg px-3 py-2 text-[13px] text-slate-700 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                />
              </div>

              {/* Totals */}
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/40">{L('A devolver', 'Refund')}</p>
                <p className="text-[22px] font-black tabular-nums text-[#b3001e] leading-none">
                  {refundSummary.total > 0 ? `− ${fmt(refundSummary.total)}` : fmt(0)}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-white/50 tabular-nums mt-0.5">
                  {L('ITBIS rev.', 'ITBIS rev.')} − {fmt(refundSummary.itbis)}
                </p>
              </div>

              <button onClick={tryProcess} disabled={!canSubmit}
                className="px-5 py-2.5 text-[13px] font-black rounded-xl bg-[#b3001e] text-white hover:bg-[#8f0018] disabled:opacity-40 flex items-center gap-2">
                <RotateCcw size={14} />
                {submitting ? L('Procesando…', 'Processing…') : L('Procesar devolución', 'Process return')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
