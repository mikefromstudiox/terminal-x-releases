// =============================================================================
// DepositReturnModal — Devolución de envases (Licoreria vertical, v2.6+)
//
// Customer returns N empty bottles of product X. Cashier selects:
//   • Product  (only products with bottle_deposit > 0 are offered)
//   • Qty      (1..999)
//   • Payout method:
//       - Efectivo   → creates a refund TICKET with total = -qty*deposit,
//                      payment_method='efectivo', notes='[deposit_return] …'
//                      Cash drawer opens on confirm.
//       - Credito    → decrements client.balance by qty*deposit (= store
//                      credit). Also writes a zero-total marker ticket for
//                      the audit trail.
//
// Activity_log: writes `deposit_refund` event with severity=info, metadata
// includes qty, amount, method, client_name. (info because envases are
// routine — cuadre picks up variance independently.)
//
// No version bump, licoreria-only caller, no release artifacts.
// =============================================================================
import { useEffect, useMemo, useState } from 'react'
import { X, Wine, Loader2, CircleDollarSign, UserRound, Search } from 'lucide-react'
import { useAPI, usePrinterAPI } from '../context/DataContext'
import { useLang } from '../i18n'
import { useAuth } from '../context/AuthContext'

const fmt = n => 'RD$' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Hard caps — deposit refunds are walk-up cash transactions, not invoices.
// Anything above these is almost certainly a typo or fraud attempt and
// should require a manager override path that does not exist yet.
const MAX_QTY_PER_RETURN  = 999
const MAX_DEPOSIT_PER_UNIT = 100      // RD$ — DR market: highest jaba ~RD$50
const MAX_REFUND_TOTAL     = 25000    // RD$ — anything bigger = supplier credit, not cash

// Round to centavo with banker-safe arithmetic (no floating-point drift).
const round2 = n => Math.round((Number(n) || 0) * 100) / 100

// Strip control chars / brackets from free text that lands in ticket notes
// so a malicious or sloppy client.name can't break the [deposit_return]
// audit marker or inject newlines into receipts.
const safeNote = s => String(s || '').replace(/[\r\n\t\[\]\x00-\x1F]/g, ' ').trim().slice(0, 80)

export default function DepositReturnModal({ open, onClose, onDone }) {
  const api        = useAPI()
  const printerApi = usePrinterAPI()
  const { lang }   = useLang()
  const { user }   = useAuth()
  const L = (es, en) => lang === 'es' ? es : en

  const [products, setProducts] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [query,    setQuery]    = useState('')
  const [picked,   setPicked]   = useState(null)  // inventory row
  const [qty,      setQty]      = useState(1)
  const [method,   setMethod]   = useState('efectivo') // efectivo | credito
  const [clients,  setClients]  = useState([])
  const [clientId, setClientId] = useState(null)  // required when method=credito
  const [clientQ,  setClientQ]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState(null)

  // Reset on open
  useEffect(() => {
    if (!open) return
    setPicked(null); setQty(1); setMethod('efectivo')
    setClientId(null); setClientQ(''); setError(null); setQuery('')
    setLoading(true)
    ;(async () => {
      try {
        // Pull only inventory with a positive bottle_deposit. `api.inventory.all`
        // is the cross-platform read used by the Inventory screen.
        const all = await (api?.inventory?.all?.() || Promise.resolve([]))
        setProducts((all || []).filter(p => Number(p.bottle_deposit || 0) > 0))
      } catch { setProducts([]) }
      try { setClients(await (api?.clients?.all?.() || [])) } catch { setClients([]) }
      setLoading(false)
    })()
  }, [open, api])

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return products
    return products.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku  || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q)
    )
  }, [products, query])

  const filteredClients = useMemo(() => {
    const q = clientQ.trim().toLowerCase()
    if (!q) return clients.slice(0, 20)
    return clients.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.rnc || '').toLowerCase().includes(q)
    ).slice(0, 20)
  }, [clients, clientQ])

  const unitDeposit = round2(Math.min(MAX_DEPOSIT_PER_UNIT, Number(picked?.bottle_deposit || 0)))
  const safeQty     = Math.min(MAX_QTY_PER_RETURN, Math.max(1, Number(qty) || 0))
  const totalRefund = round2(Math.min(MAX_REFUND_TOTAL, unitDeposit * safeQty))
  const overCap     = unitDeposit * safeQty > MAX_REFUND_TOTAL
  const canSubmit   = !!picked && safeQty > 0 && totalRefund > 0 && !overCap &&
                      (method === 'efectivo' || (method === 'credito' && clientId))

  async function submit() {
    if (!canSubmit || saving) return
    setSaving(true); setError(null)
    const q = safeQty
    const amount = round2(unitDeposit * q)
    const client = method === 'credito' ? clients.find(c => c.id === clientId) : null
    const noteMarker = `[deposit_return] envase=${safeNote(picked.sku || picked.name)} qty=${q} method=${method}${client ? ` client=${safeNote(client.name)}` : ''}`

    try {
      // 1) Credit payout → decrement client balance (store credit) FIRST so
      //    we never book a refund line we can't honor. If this throws, the
      //    refund ticket is never created and cashier sees an error.
      if (method === 'credito' && client?.id) {
        try {
          await api.clients.updateBalance({ id: client.id, delta: -amount })
        } catch (balErr) {
          console.error('[DepositReturn] balance update failed', balErr)
          throw new Error(L(
            'No se pudo actualizar el balance del cliente. Devolución cancelada.',
            'Could not update client balance. Refund cancelled.'
          ))
        }
      }

      // 2) Persist refund ticket (negative total → cuadre picks it up).
      //    items = single synthetic line with is_deposit=true so analytics
      //    can later re-aggregate by product even without a receipt DB join.
      try {
        await api.tickets.create({
          date: new Date().toISOString(),
          total: -amount,
          subtotal: -amount,
          itbis: 0,
          discount: 0,
          payment_method: method === 'credito' ? 'credito' : 'efectivo',
          status: 'cobrado',
          client_id: client?.id || null,
          client_supabase_id: client?.supabase_id || null,
          notes: noteMarker,
          items: [{
            service_id: null,
            inventory_item_id: null,
            sku: 'DEP-RET',
            name: `${L('Devolución envase','Bottle return')} — ${picked.name}`,
            price: -unitDeposit,
            cost: 0,
            qty: q,
            aplica_itbis: 0,
            is_wash: 0,
            is_deposit: true,
            bottle_deposit_line: true,
          }],
        })
      } catch (tkErr) {
        // Reverse the balance debit if the refund ticket failed to persist.
        if (method === 'credito' && client?.id) {
          try { await api.clients.updateBalance({ id: client.id, delta: +amount }) } catch (revErr) {
            try { window.__txReportError?.(revErr, { severity: 'critical', category: 'deposit_refund.balance_reversal_failed', extra: { clientId: client?.id, clientSupabaseId: client?.supabase_id, amount, method } }) } catch {}
            console.error('[DepositReturn] CRITICAL: balance debited but ticket failed AND reversal failed', revErr)
            try { window.alert(L(
              `URGENTE: Balance del cliente ${client?.name || ''} ajustado en RD$${amount} pero la devolución no quedó registrada. Ajusta manualmente.`,
              `URGENT: Client ${client?.name || ''} balance adjusted by RD$${amount} but refund ticket failed. Adjust manually.`
            )) } catch {}
          }
        }
        throw tkErr
      }

      // 3) Cash drawer kick (cash refunds only).
      if (method === 'efectivo') {
        try { printerApi?.openDrawer?.() } catch {}
      }

      // 4) Audit log — append-only; failures never block refund.
      try {
        await (api?.activity?.record?.({
          event_type:  'deposit_refund',
          severity:    'info',
          target_type: 'inventory_item',
          target_id:   picked.id,
          target_name: picked.name,
          amount:      amount,
          reason:      method === 'efectivo' ? L('Reembolso en efectivo','Cash refund')
                                             : L('Crédito a cuenta del cliente','Store credit to client'),
          metadata: {
            qty: q,
            unit_deposit: unitDeposit,
            method,
            sku:  picked.sku || null,
            client_id:          client?.id || null,
            client_supabase_id: client?.supabase_id || null,
            client_name:        client?.name || null,
            cashier_id:         user?.id || null,
            cashier_name:       user?.name || null,
          },
        }) || Promise.resolve())
      } catch (err) {
        try { window.__txReportError?.(err, { severity: 'warn', category: 'deposit_refund.activity.record', extra: { itemId: picked?.id, amount, method } }) } catch {}
      }

      setSaving(false)
      onDone?.({ qty: q, amount, method, client })
      onClose?.()
    } catch (e) {
      setSaving(false)
      setError(e?.message || L('No se pudo registrar la devolución','Could not record return'))
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={() => !saving && onClose?.()}>
      <div className="bg-white dark:bg-black w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden"
           onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-white/10 bg-[#b3001e] text-white">
          <div className="flex items-center gap-2">
            <Wine size={18} />
            <h2 className="text-sm font-bold uppercase tracking-[0.12em]">
              {L('Devolución de envases', 'Bottle deposit return')}
            </h2>
          </div>
          <button onClick={() => !saving && onClose?.()} className="hover:bg-white/10 rounded p-1">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Product picker */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/50 mb-1 block">
              {L('Producto', 'Product')}
            </label>
            <div className="flex items-center gap-2 px-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl focus-within:ring-2 focus-within:ring-[#b3001e]/30">
              <Search size={14} className="text-slate-400" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={L('Buscar producto con depósito…', 'Search product with deposit…')}
                className="flex-1 bg-transparent py-2.5 text-sm text-slate-800 dark:text-white outline-none"
              />
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={18} className="animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="mt-2 max-h-40 overflow-y-auto border border-slate-200 dark:border-white/10 rounded-xl divide-y divide-slate-100 dark:divide-white/5">
                {filteredProducts.length === 0 && (
                  <p className="p-3 text-center text-sm text-slate-400">
                    {L('Sin productos con depósito', 'No products with deposit')}
                  </p>
                )}
                {filteredProducts.map(p => (
                  <button key={p.id} onClick={() => setPicked(p)}
                    className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-[#b3001e]/5 transition-colors ${picked?.id === p.id ? 'bg-[#b3001e]/10' : ''}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{p.name}</p>
                      {p.sku && <p className="text-[10px] text-slate-400 font-mono">{p.sku}</p>}
                    </div>
                    <span className="text-sm font-bold text-[#b3001e] tabular-nums">{fmt(p.bottle_deposit)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Qty */}
          {picked && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/50 mb-1 block">
                  {L('Cantidad devuelta', 'Quantity returned')}
                </label>
                <input type="number" min="1" max={MAX_QTY_PER_RETURN} value={qty}
                  onChange={e => setQty(Math.min(MAX_QTY_PER_RETURN, Math.max(1, Number(e.target.value) || 1)))}
                  className="w-full border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-lg font-bold tabular-nums bg-white dark:bg-white/5 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30" />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/50 mb-1 block">
                  {L('Total a devolver', 'Refund total')}
                </label>
                <div className="w-full border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-lg font-black tabular-nums bg-slate-50 dark:bg-white/5 text-[#b3001e]">
                  {fmt(totalRefund)}
                </div>
              </div>
            </div>
          )}

          {/* Payout */}
          {picked && (
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/50 mb-1 block">
                {L('Forma de pago', 'Payout method')}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setMethod('efectivo')}
                  className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                    method === 'efectivo'
                      ? 'bg-[#b3001e] border-[#b3001e] text-white'
                      : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/80 hover:border-[#b3001e]'
                  }`}>
                  <CircleDollarSign size={16} />
                  {L('Efectivo', 'Cash')}
                </button>
                <button onClick={() => setMethod('credito')}
                  className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                    method === 'credito'
                      ? 'bg-[#b3001e] border-[#b3001e] text-white'
                      : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/80 hover:border-[#b3001e]'
                  }`}>
                  <UserRound size={16} />
                  {L('Crédito a cuenta', 'Store credit')}
                </button>
              </div>
            </div>
          )}

          {/* Client picker — only for credit */}
          {picked && method === 'credito' && (
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/50 mb-1 block">
                {L('Cliente', 'Client')} <span className="text-[#b3001e]">*</span>
              </label>
              <div className="flex items-center gap-2 px-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl">
                <Search size={14} className="text-slate-400" />
                <input
                  value={clientQ}
                  onChange={e => setClientQ(e.target.value)}
                  placeholder={L('Buscar cliente…', 'Search client…')}
                  className="flex-1 bg-transparent py-2 text-sm text-slate-800 dark:text-white outline-none"
                />
              </div>
              <div className="mt-2 max-h-32 overflow-y-auto border border-slate-200 dark:border-white/10 rounded-xl divide-y divide-slate-100 dark:divide-white/5">
                {filteredClients.length === 0 && (
                  <p className="p-3 text-center text-sm text-slate-400">{L('Sin clientes', 'No clients')}</p>
                )}
                {filteredClients.map(c => (
                  <button key={c.id} onClick={() => setClientId(c.id)}
                    className={`w-full text-left px-3 py-2 hover:bg-[#b3001e]/5 transition-colors ${clientId === c.id ? 'bg-[#b3001e]/10' : ''}`}>
                    <p className="text-sm font-semibold text-slate-800 dark:text-white">{c.name}</p>
                    {c.phone && <p className="text-[10px] text-slate-400">{c.phone}</p>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {overCap && (
            <div className="text-xs text-[#b3001e] bg-[#b3001e]/10 border border-[#b3001e]/20 rounded-lg px-3 py-2">
              {L(
                `Monto excede el tope de ${fmt(MAX_REFUND_TOTAL)}. Procese como crédito a proveedor.`,
                `Amount exceeds ${fmt(MAX_REFUND_TOTAL)} cap. Process as supplier credit instead.`
              )}
            </div>
          )}
          {error && (
            <div className="text-sm text-[#b3001e] bg-[#b3001e]/10 border border-[#b3001e]/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <button onClick={() => !saving && onClose?.()}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10">
            {L('Cancelar', 'Cancel')}
          </button>
          <button onClick={submit} disabled={!canSubmit || saving}
            className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-[#b3001e] hover:bg-[#8a0017] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {L('Confirmar devolución', 'Confirm return')}
          </button>
        </div>
      </div>
    </div>
  )
}
