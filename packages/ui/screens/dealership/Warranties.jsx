/**
 * Warranties.jsx — Concesionario post-sale warranty tracker.
 *
 * DR concesionario reality: cada venta lleva garantia 30/60/90d o 1 año.
 * Cliente regresa con reclamo (motor, transmision, electrico). Dealer registra
 * el reclamo en la garantia de esa venta para historial. Cuando vence la
 * fecha, el job nocturno flipea a 'expired'.
 *
 * v2.16.4 Sprint 2B H3.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  X, Loader2, ShieldCheck, AlertTriangle, Plus, Eye, Ban, MessageCircle,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import DateTimeModal from '../../components/DateTimeModal'
import { sendWarrantyExpiringSoon } from '../../../services/whatsapp-dealership.js'

const STATUS_META = {
  active:  { es: 'Activa',   en: 'Active',   cls: 'bg-emerald-600 text-white' },
  claimed: { es: 'Reclamada', en: 'Claimed', cls: 'bg-amber-500 text-white' },
  expired: { es: 'Vencida',  en: 'Expired',  cls: 'bg-slate-500 text-white' },
  voided:  { es: 'Anulada',  en: 'Voided',   cls: 'bg-[#b3001e] text-white' },
}

const KIND_LABELS = {
  general:     { es: 'General',      en: 'General' },
  motor:       { es: 'Motor',        en: 'Engine' },
  transmision: { es: 'Transmision',  en: 'Transmission' },
  electrico:   { es: 'Electrico',    en: 'Electrical' },
  extendida:   { es: 'Extendida',    en: 'Extended' },
}

const CLAIM_STATUS = {
  open:        { es: 'Abierto',     en: 'Open',         cls: 'bg-amber-100 text-amber-900' },
  in_progress: { es: 'En proceso',  en: 'In progress',  cls: 'bg-sky-100 text-sky-900' },
  resolved:    { es: 'Resuelto',    en: 'Resolved',     cls: 'bg-emerald-100 text-emerald-900' },
  rejected:    { es: 'Rechazado',   en: 'Rejected',     cls: 'bg-red-100 text-red-900' },
}

const FILTER_TABS = [
  { v: 'active',   es: 'Activas',         en: 'Active' },
  { v: 'soon',     es: 'Por vencer (30d)', en: 'Expiring (30d)' },
  { v: 'claimed',  es: 'Reclamadas',      en: 'Claimed' },
  { v: 'closed',   es: 'Vencidas/Anuladas', en: 'Expired/Voided' },
]

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtD(s) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}
function daysUntil(iso) {
  if (!iso) return Infinity
  return (new Date(iso).getTime() - Date.now()) / 86400000
}

// ── Detail modal: claims list + add-claim form ─────────────────────────────

function DetailModal({ row, deal, vehicle, client, lang, onClose, onAddClaim }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [showForm, setShowForm] = useState(false)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('open')
  const [cost, setCost] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submitClaim(e) {
    e.preventDefault()
    setErr('')
    if (!description.trim()) { setErr(L('Descripcion requerida.', 'Description required.')); return }
    setBusy(true)
    try {
      await onAddClaim({
        date:        new Date(date).toISOString(),
        description: description.trim(),
        status,
        cost:        Number(cost) || 0,
      })
      setShowForm(false); setDescription(''); setCost(0); setStatus('open'); setDate(new Date().toISOString().slice(0, 10))
    } catch (ex) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(ex, { severity: 'error', category: 'warranties.fmtrd' }) } catch {}
      setErr(ex?.message || 'Error')
    } finally { setBusy(false) }
  }

  const claims = Array.isArray(row.claims) ? row.claims : []

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-black max-w-2xl w-full max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-black">
          <h2 className="text-xl font-bold flex items-center gap-2"><ShieldCheck size={20} />{L('Detalle de Garantia', 'Warranty Detail')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-black hover:text-white"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2 border border-black/20 p-3 bg-black/5">
            <div><div className="text-[10px] uppercase opacity-60">{L('Cliente', 'Client')}</div><div className="font-semibold">{client?.name || '—'}</div></div>
            <div><div className="text-[10px] uppercase opacity-60">{L('Vehiculo', 'Vehicle')}</div><div className="font-semibold">{vehicle ? `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() : '—'}</div></div>
            <div><div className="text-[10px] uppercase opacity-60">{L('Tipo', 'Kind')}</div><div className="capitalize">{(KIND_LABELS[row.kind] || { es: row.kind, en: row.kind })[lang === 'es' ? 'es' : 'en']}</div></div>
            <div><div className="text-[10px] uppercase opacity-60">{L('Estado', 'Status')}</div>
              <span className={`inline-block px-2 py-0.5 text-xs font-semibold ${(STATUS_META[row.status] || STATUS_META.active).cls}`}>
                {(STATUS_META[row.status] || STATUS_META.active)[lang === 'es' ? 'es' : 'en']}
              </span>
            </div>
            <div><div className="text-[10px] uppercase opacity-60">{L('Inicio', 'Starts')}</div><div>{fmtD(row.starts_at)}</div></div>
            <div><div className="text-[10px] uppercase opacity-60">{L('Vence', 'Expires')}</div><div>{fmtD(row.expires_at)}</div></div>
            {row.terms && (
              <div className="col-span-2"><div className="text-[10px] uppercase opacity-60">{L('Terminos', 'Terms')}</div><div className="text-xs whitespace-pre-line">{row.terms}</div></div>
            )}
            {deal?.id && (
              <div className="col-span-2"><div className="text-[10px] uppercase opacity-60">{L('Trato', 'Deal')}</div><div className="text-xs">#{deal.id} · {fmtRD(deal.sale_price)} · {fmtD(deal.closed_at)}</div></div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold">{L('Reclamos', 'Claims')} ({claims.length})</h3>
              {row.status !== 'voided' && row.status !== 'expired' && (
                <button onClick={() => setShowForm(s => !s)} className="px-3 py-1 bg-black text-white text-xs inline-flex items-center gap-1">
                  <Plus size={12} />{L('Registrar reclamo', 'Register claim')}
                </button>
              )}
            </div>
            {showForm && (
              <form onSubmit={submitClaim} className="border border-black p-3 space-y-2 mb-3 bg-black/5">
                {err && <div className="bg-[#b3001e] text-white px-2 py-1 text-xs">{err}</div>}
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs font-semibold">{L('Fecha', 'Date')}</span>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5 text-xs" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold">{L('Estado', 'Status')}</span>
                    <select value={status} onChange={e => setStatus(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5 text-xs">
                      {Object.entries(CLAIM_STATUS).map(([v, m]) => <option key={v} value={v}>{lang === 'es' ? m.es : m.en}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className="text-xs font-semibold">{L('Descripcion', 'Description')}*</span>
                  <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="mt-1 w-full border border-black px-2 py-1.5 text-xs" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold">{L('Costo (opcional)', 'Cost (optional)')} RD$</span>
                  <input type="number" step="0.01" min="0" value={cost} onChange={e => setCost(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5 text-xs" />
                </label>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setShowForm(false)} className="px-3 py-1 border border-black text-xs">{L('Cancelar', 'Cancel')}</button>
                  <button type="submit" disabled={busy} className="px-3 py-1 bg-[#b3001e] text-white text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1">
                    {busy && <Loader2 size={12} className="animate-spin" />}{L('Guardar', 'Save')}
                  </button>
                </div>
              </form>
            )}

            {claims.length === 0 ? (
              <p className="text-xs text-black/50 italic">{L('Sin reclamos registrados.', 'No claims registered.')}</p>
            ) : (
              <ul className="divide-y divide-black/10 border border-black/20">
                {claims.slice().reverse().map((c, i) => {
                  const cs = CLAIM_STATUS[c.status] || CLAIM_STATUS.open
                  return (
                    <li key={i} className="p-2 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold">{fmtD(c.date)}</span>
                        <span className={`px-2 py-0.5 ${cs.cls}`}>{lang === 'es' ? cs.es : cs.en}</span>
                      </div>
                      <div className="text-black/80 whitespace-pre-line">{c.description}</div>
                      {Number(c.cost) > 0 && <div className="mt-1 text-[10px] text-black/60">{L('Costo:', 'Cost:')} {fmtRD(c.cost)}</div>}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Void modal ─────────────────────────────────────────────────────────────

function VoidModal({ row, lang, onConfirm, onClose }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-black max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-black">
          <h2 className="text-lg font-bold">{L('Anular Garantia', 'Void Warranty')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-black hover:text-white"><X size={18} /></button>
        </div>
        <form
          onSubmit={async e => {
            e.preventDefault()
            setBusy(true)
            try { await onConfirm(reason.trim() || null); onClose() } catch (_aetherErr) {
              try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'warranties.voidmodal' }) } catch {} setBusy(false) }
          }}
          className="p-5 space-y-3 text-sm"
        >
          <p className="text-xs text-black/70">
            {L('La garantia quedara anulada y no se podran registrar mas reclamos.', 'The warranty will be voided and no more claims can be registered.')}
          </p>
          <label className="block">
            <span className="text-xs font-semibold">{L('Motivo (opcional)', 'Reason (optional)')}</span>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-black">{L('Cancelar', 'Cancel')}</button>
            <button type="submit" disabled={busy} className="px-4 py-2 bg-[#b3001e] text-white font-bold disabled:opacity-50 inline-flex items-center gap-2">
              {busy && <Loader2 size={14} className="animate-spin" />}
              {L('Anular', 'Void')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main screen ────────────────────────────────────────────────────────────

export default function Warranties() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [rows, setRows] = useState([])
  const [deals, setDeals] = useState([])
  const [units, setUnits] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('active')
  const [detailRow, setDetailRow] = useState(null)
  const [voidRow, setVoidRow] = useState(null)

  async function load() {
    setLoading(true)
    const settled = await Promise.allSettled([
      api.vehicleWarranty?.list?.() ?? Promise.resolve([]),
      api.salesDeals?.list?.() ?? Promise.resolve([]),
      api.vehicleInventory?.list?.() ?? Promise.resolve([]),
      api.clients?.list?.() ?? api.clients?.all?.() ?? Promise.resolve([]),
    ])
    const [w, d, u, c] = settled
    setRows(w.status === 'fulfilled' ? (w.value || []) : [])
    setDeals(d.status === 'fulfilled' ? (d.value || []) : [])
    setUnits(u.status === 'fulfilled' ? (u.value || []) : [])
    setClients(c.status === 'fulfilled' ? (c.value || []) : [])
    setLoading(false)
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  function dealOf(r) { return deals.find(d => d.supabase_id === r.sales_deal_supabase_id) }
  function vehicleOf(r) { return units.find(u => u.supabase_id === r.vehicle_inventory_supabase_id) }
  function clientOf(r) {
    return clients.find(x => x.supabase_id === r.client_supabase_id) || clients.find(x => x.id === r.client_id)
  }

  const filtered = useMemo(() => {
    const list = rows || []
    switch (filter) {
      case 'active':  return list.filter(r => r.status === 'active')
      case 'soon':    return list.filter(r => r.status === 'active' && daysUntil(r.expires_at) <= 30)
      case 'claimed': return list.filter(r => r.status === 'claimed')
      case 'closed': {
        const cutoff = Date.now() - 60 * 86400000
        return list.filter(r => (r.status === 'expired' || r.status === 'voided')
          && (r.updated_at ? new Date(r.updated_at).getTime() >= cutoff : true))
      }
      default: return list
    }
  }, [rows, filter])

  const expiringMonthCount = useMemo(() => {
    return (rows || []).filter(r => r.status === 'active' && daysUntil(r.expires_at) <= 30).length
  }, [rows])

  async function handleAddClaim(claim) {
    if (!detailRow?.id) return
    const updated = await api.vehicleWarranty.addClaim({ id: detailRow.id, claim })
    if (updated) setDetailRow(updated)
    await load()
  }
  async function handleVoid(reason) {
    if (!voidRow?.id) return
    await api.vehicleWarranty.void({ id: voidRow.id, reason })
    await load()
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <ShieldCheck size={32} />
            {L('Garantias', 'Warranties')}
            {expiringMonthCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#b3001e] text-white text-xs font-semibold">
                <AlertTriangle size={12} />
                {L(`${expiringMonthCount} vencen este mes`, `${expiringMonthCount} expiring this month`)}
              </span>
            )}
          </h1>
          <p className="text-sm text-black/70 mt-1">
            {L('Garantias post-venta y reclamos por unidad vendida.', 'Post-sale warranties and per-unit claim history.')}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {FILTER_TABS.map(t => (
          <button
            key={t.v}
            onClick={() => setFilter(t.v)}
            className={`px-3 py-1.5 text-xs border border-black ${filter === t.v ? 'bg-black text-white' : 'bg-white text-black hover:bg-black/5'}`}
          >
            {lang === 'es' ? t.es : t.en}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto" /></div>
      ) : filtered.length === 0 ? (
        <div className="border border-black p-12 text-center text-sm text-black/60">
          {L('Sin garantias activas.', 'No active warranties.')}
        </div>
      ) : (
        <div className="border border-black overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black text-white">
              <tr>
                <th className="text-left px-3 py-2">{L('Cliente', 'Client')}</th>
                <th className="text-left px-3 py-2">{L('Vehiculo', 'Vehicle')}</th>
                <th className="text-left px-3 py-2">{L('Tipo', 'Kind')}</th>
                <th className="text-left px-3 py-2">{L('Inicio', 'Starts')}</th>
                <th className="text-left px-3 py-2">{L('Vence', 'Expires')}</th>
                <th className="text-left px-3 py-2">{L('Estado', 'Status')}</th>
                <th className="text-right px-3 py-2">{L('Reclamos', 'Claims')}</th>
                <th className="text-right px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const meta = STATUS_META[r.status] || STATUS_META.active
                const veh = vehicleOf(r)
                const cli = clientOf(r)
                const days = daysUntil(r.expires_at)
                const dueSoon = (r.status === 'active' || r.status === 'claimed') && days <= 30
                const claimsLen = Array.isArray(r.claims) ? r.claims.length : 0
                const kindLabel = (KIND_LABELS[r.kind] || { es: r.kind, en: r.kind })[lang === 'es' ? 'es' : 'en']
                return (
                  <tr key={r.id} className="border-t border-black/10 hover:bg-black/5">
                    <td className="px-3 py-2 font-semibold">{cli?.name || '—'}</td>
                    <td className="px-3 py-2">{veh ? `${veh.year || ''} ${veh.make || ''} ${veh.model || ''}`.trim() : '—'}</td>
                    <td className="px-3 py-2 capitalize">{kindLabel}</td>
                    <td className="px-3 py-2">{fmtD(r.starts_at)}</td>
                    <td className={`px-3 py-2 ${dueSoon ? 'text-[#b3001e] font-semibold' : ''}`}>
                      {fmtD(r.expires_at)}
                      {dueSoon && <div className="text-[10px]">{days < 0 ? L('Vencida', 'Overdue') : L(`${Math.ceil(days)}d`, `${Math.ceil(days)}d`)}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 text-xs font-semibold ${meta.cls}`}>
                        {lang === 'es' ? meta.es : meta.en}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{claimsLen}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {filter === 'soon' && cli?.phone && (
                        <button
                          onClick={() => {
                            const ok = sendWarrantyExpiringSoon(r, cli, veh)
                            if (!ok) alert(L('Cliente sin telefono valido.', 'Client has no valid phone.'))
                          }}
                          title={L('Avisar vencimiento por WhatsApp', 'Notify expiry on WhatsApp')}
                          className="p-1 mr-1 border border-emerald-600 text-emerald-700 hover:bg-emerald-600 hover:text-white inline-flex items-center"
                        >
                          <MessageCircle size={12}/>
                        </button>
                      )}
                      <button onClick={() => setDetailRow(r)} title={L('Ver detalle', 'View detail')} className="p-1 hover:bg-black hover:text-white mr-1"><Eye size={14} /></button>
                      {r.status !== 'voided' && r.status !== 'expired' && (
                        <button onClick={() => setVoidRow(r)} title={L('Anular', 'Void')} className="p-1 hover:bg-[#b3001e] hover:text-white"><Ban size={14} /></button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {detailRow && (
        <DetailModal
          row={detailRow}
          deal={dealOf(detailRow)}
          vehicle={vehicleOf(detailRow)}
          client={clientOf(detailRow)}
          lang={lang}
          onClose={() => setDetailRow(null)}
          onAddClaim={handleAddClaim}
        />
      )}
      {voidRow && (
        <VoidModal
          row={voidRow}
          lang={lang}
          onConfirm={handleVoid}
          onClose={() => setVoidRow(null)}
        />
      )}
      {/* DateTimeModal kept available for future per-row expiry edit if needed */}
      <DateTimeModal open={false} onCancel={() => {}} onConfirm={() => {}} />
    </div>
  )
}
