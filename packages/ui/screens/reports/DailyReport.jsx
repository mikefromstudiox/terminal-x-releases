import { useState, useMemo, useEffect } from 'react'
import {
  Search, X, Eye, Printer, AlertTriangle, CheckCircle2,
  ChevronDown, ReceiptText, TrendingUp, CircleDollarSign,
  Clock, Ban, Download,
} from 'lucide-react'
import { useLang } from '../../i18n'
import { useAPI } from '../../context/DataContext'
import { useAuth } from '../../context/AuthContext'
import ManagerAuthGate from '../../components/ManagerAuthGate'
import { useBusinessType } from '../../hooks/useBusinessType.jsx'
import { hasVehicles, isServiceBased } from '@terminal-x/config/businessTypes'
import { exportDailyReport } from '@terminal-x/services/csv'
import { printDailyReport } from '@terminal-x/services/report-html'
import { printClientReceipt, printWasherConduce } from '@terminal-x/services/printer'

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtRD(n) {
  return `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function parseSqliteUtc(v) {
  // SQLite datetime('now') writes UTC as 'YYYY-MM-DD HH:MM:SS' without timezone.
  // new Date(str) treats it as LOCAL. Normalise to ISO-Z so display is correct.
  if (!v) return new Date(NaN)
  if (v instanceof Date) return v
  if (typeof v === 'string' && !v.endsWith('Z') && !/[+-]\d\d:?\d\d$/.test(v)) {
    return new Date(v.replace(' ', 'T') + 'Z')
  }
  return new Date(v)
}
function fmtDate(d) {
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtTime(d) {
  return d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
}
function payLabel(pm, lang) {
  const m = { cash: { es: 'Efectivo', en: 'Cash' }, card: { es: 'Tarjeta', en: 'Card' }, transfer: { es: 'Transferencia', en: 'Transfer' }, credit: { es: 'Crédito', en: 'Credit' } }
  return m[pm]?.[lang] ?? pm
}
// v2.11.2 — normalize payment_parts into a clean array of {method, amount}.
// Accepts the JSONB/TEXT stored shape which may use `method`/`type` and
// `amount`/`monto` keys depending on where it was written.
function normalizeParts(raw) {
  if (!raw) return null
  let arr = raw
  if (typeof raw === 'string') { try { arr = JSON.parse(raw) } catch (_aetherErr) {
    try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'dailyreport.fmtrd' }) } catch {} return null } }
  if (!Array.isArray(arr) || arr.length === 0) return null
  const out = arr.map(p => ({
    method: String(p?.method ?? p?.type ?? p?.payment_method ?? 'cash').toLowerCase(),
    amount: Number(p?.amount ?? p?.monto ?? p?.value ?? 0) || 0,
  })).filter(p => p.amount > 0)
  return out.length ? out : null
}
function partsSummaryText(parts, lang) {
  if (!parts) return ''
  return parts.map(p => `${payLabel(p.method, lang)} ${fmtRD(p.amount)}`).join(' + ')
}

// ── DB → UI transform ─────────────────────────────────────────────────────────
function dbToTxn(t) {
  return {
    id:         t.id,
    ticketNo:   t.doc_number || `T-${String(t.id).padStart(4, '0')}`,
    client:     t.client_name || 'Walk-in',
    vehicle:    t.vehicle_plate || '—',
    services:   t.service_names
                  ? t.service_names.split(' + ').map(n => ({ name: n, price: 0, cost: 0 }))
                  : (t.items || []).map(i => ({ name: i.name || i.service_name || '—', price: i.price || 0, cost: i.cost || 0 })),
    items:      t.items || [],
    cashier:    t.cajero_name || '—',
    date:       parseSqliteUtc(t.created_at),
    subtotal:   t.subtotal || 0,
    itbis:      t.itbis || 0,
    ley:        t.ley || 0,
    total:      t.total || 0,
    payMethod:  t.payment_method || 'cash',
    paymentParts: normalizeParts(t.payment_parts),
    orderSource: t.order_source || 'pos',
    estado:     t.status === 'nula' ? 'nula' : 'normal',
    ncfType:    t.comprobante_type || 'B02',
    ncf:        t.ncf || null,
    voidReason: t.void_reason,
    voidedBy:   t.void_by,
    voidedAt:   t.void_at ? parseSqliteUtc(t.void_at) : null,
    washerNames: t.washer_names || [],
    mode:       t.mode || null,    // hybrid vertical: 'mesa' | 'directa' | 'takeout' | null
    mesa_id:    t.mesa_id || null,
    notes:      t.notes || t.comentario || null,
    comentario: t.comentario || t.notes || null,
    descuento:  t.descuento || 0,
    descuentoReason: t.descuento_reason || null,
  }
}

// ── Date range helpers ────────────────────────────────────────────────────────
function getDateRange(pill) {
  const now     = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)

  if (pill === 'hoy') {
    return { from: todayStr, to: tomorrowStr }
  }
  if (pill === 'ayer') {
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
    return { from: yesterday.toISOString().slice(0, 10), to: todayStr }
  }
  if (pill === 'semana') {
    const mon = new Date(now)
    const day = mon.getDay()
    mon.setDate(mon.getDate() - (day === 0 ? 6 : day - 1))
    return { from: mon.toISOString().slice(0, 10), to: tomorrowStr }
  }
  if (pill === 'mes') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: first.toISOString().slice(0, 10), to: tomorrowStr }
  }
  return { from: todayStr, to: tomorrowStr }
}

const DATE_PILLS = [
  { id: 'hoy',    es: 'Hoy',          en: 'Today'      },
  { id: 'ayer',   es: 'Ayer',         en: 'Yesterday'  },
  { id: 'semana', es: 'Esta semana',  en: 'This week'  },
  { id: 'mes',    es: 'Este mes',     en: 'This month' },
]

// Perfectly aligned column definitions — used for BOTH header and rows
const COLS = [
  { key: 'ticket',   es: '#',               en: '#',             cls: 'w-[80px] shrink-0'                       },
  { key: 'client',   es: 'Cliente', esVehicle: 'Cliente / Vehículo', en: 'Client', enVehicle: 'Client / Vehicle', cls: 'flex-1 min-w-0' },
  { key: 'services', es: 'Servicio(s)',      en: 'Service(s)',    esProduct: 'Producto(s)', enProduct: 'Product(s)', cls: 'w-[160px] shrink-0' },
  { key: 'cashier',  es: 'Cajero',          en: 'Cashier',       cls: 'w-[90px] shrink-0'                       },
  { key: 'date',     es: 'Fecha / Hora',    en: 'Date / Time',   cls: 'w-[120px] shrink-0'                      },
  { key: 'subtotal', es: 'Subtotal',        en: 'Subtotal',      cls: 'w-[96px] shrink-0 text-right'            },
  { key: 'itbis',    es: 'ITBIS',           en: 'ITBIS',         cls: 'w-[84px] shrink-0 text-right'            },
  { key: 'total',    es: 'Total',           en: 'Total',         cls: 'w-[104px] shrink-0 text-right'           },
  { key: 'estado',   es: 'Estado',          en: 'Status',        cls: 'w-[108px] shrink-0'                      },
]

// ── Mixto badge (split-payment indicator) ─────────────────────────────────────
// v2.11.2 — surfaces payment_parts on the Ventas row. Native `title` attribute
// gives a free cross-platform tooltip listing every part. Silent on tickets
// without parts so single-method rows render identically to before.
function MixtoBadge({ parts, lang }) {
  if (!parts || parts.length < 2) return null
  const tip = partsSummaryText(parts, lang)
  return (
    <span
      title={tip}
      className="inline-flex items-center text-[10px] font-bold bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2 py-0.5 cursor-help"
    >
      {lang === 'es' ? 'Mixto' : 'Split'}
    </span>
  )
}

// ── Estado badge ──────────────────────────────────────────────────────────────
function EstadoBadge({ t, lang }) {
  if (t.estado === 'nula')
    return <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-0.5"><Ban size={9} />{lang === 'es' ? 'Anulada' : 'Voided'}</span>
  if (t.payMethod === 'credit')
    return <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">CxC</span>
  return <span className="text-[10px] font-bold bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5">{lang === 'es' ? 'Pagado' : 'Paid'}</span>
}

// ── Metric card ───────────────────────────────────────────────────────────────
function MetricCard({ icon: Icon, label, value, sub, accent }) {
  const colors = {
    sky:    'bg-sky-50 text-sky-600 border-sky-100',
    green:  'bg-green-50 text-green-600 border-green-100',
    violet: 'bg-violet-50 text-violet-600 border-violet-100',
    amber:  'bg-amber-50 text-amber-600 border-amber-100',
    red:    'bg-red-50 text-red-600 border-red-100',
  }
  return (
    <div className="flex-1 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl px-4 py-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${colors[accent]}`}>
        <Icon size={16} />
      </div>
      <div>
        <p className="text-[10px] font-semibold text-slate-400 dark:text-white/40 uppercase tracking-wide">{label}</p>
        <p className="text-[15px] font-bold text-slate-800 dark:text-white leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-slate-400 dark:text-white/40">{sub}</p>}
      </div>
    </div>
  )
}

// ── Top Washers card (carwash only) ───────────────────────────────────────────
// Shows the top 3 lavadores this month by ticket count + commission, pulled from
// either the desktop IPC (api.carwash.topWashers) or the web Supabase aggregator.
function TopWashersCard({ lang }) {
  const api = useAPI()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    api?.carwash?.topWashers?.(3)
      .then(r => { if (!cancelled) setRows(r || []) })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  if (loading) return null
  if (!rows.length) return null
  return (
    <div className="shrink-0 mx-3 md:mx-6 mt-2 mb-1 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wide">
          {lang === 'es' ? 'Top Lavadores del Mes' : 'Top Washers This Month'}
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {rows.map((w, i) => (
          <div key={(w.name || '') + i} className="flex items-center gap-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold ${
              i === 0 ? 'bg-amber-100 text-amber-700 border border-amber-200' :
              i === 1 ? 'bg-slate-100 text-slate-700 border border-slate-200' :
                        'bg-orange-100 text-orange-700 border border-orange-200'
            }`}>#{i + 1}</div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-slate-800 dark:text-white truncate">{w.name || '—'}</p>
              <p className="text-[11px] text-slate-500 dark:text-white/60">
                {w.ticket_count || 0} {lang === 'es' ? 'lavados' : 'washes'} · {fmtRD(w.total_commission || 0)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Detail modal ──────────────────────────────────────────────────────────────
function DetailModal({ ticket: t, onClose, onReprint, lang }) {
  const api = useAPI()
  const { businessType } = useBusinessType()
  const showVehicle  = hasVehicles(businessType)
  const isServiceBiz = isServiceBased(businessType)
  const itemsLabel   = isServiceBiz
    ? (lang === 'es' ? 'servicios' : 'services')
    : (lang === 'es' ? 'productos' : 'products')
  const [services, setServices] = useState(t.services)
  const [washerNames, setWasherNames] = useState(t.washerNames || [])
  const [sellerNames, setSellerNames] = useState(t.sellerNames || [])
  const [loadingItems, setLoadingItems] = useState(false)
  // Show "Lavador(es)" for car wash; "Vendedor(es)" everywhere else.
  const workerLabel = businessType === 'carwash'
    ? (lang === 'es' ? 'Lavador(es)' : 'Washer(s)')
    : (lang === 'es' ? 'Vendedor(es)' : 'Salesperson(s)')
  const workerNames = businessType === 'carwash' ? washerNames : (sellerNames.length ? sellerNames : washerNames)

  useEffect(() => {
    if (services.length > 0 && washerNames.length > 0) return
    setLoadingItems(true)
    api.tickets.byId(t.id)
      .then(full => {
        if (full?.items?.length) {
          setServices(full.items.map(item => ({
            name:  item.service_name || item.name || '—',
            price: item.price || item.subtotal || 0,
          })))
        }
        if (full?.washer_names?.length) setWasherNames(full.washer_names)
        if (full?.seller_names?.length) setSellerNames(full.seller_names)
        else if (full?.seller_name) setSellerNames([full.seller_name])
      })
      .catch(() => setServices([{ name: lang === 'es' ? `Error al cargar ${itemsLabel}` : `Error loading ${itemsLabel}`, price: 0 }]))
      .finally(() => setLoadingItems(false))
  }, [t.id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white dark:bg-black rounded-none md:rounded-2xl shadow-2xl w-full h-full md:w-[480px] md:h-auto md:max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/10">
          <div>
            <h3 className="text-[15px] font-bold text-slate-800 dark:text-white">
              {lang === 'es' ? 'Detalle de Factura' : 'Invoice Detail'} · <span className="text-sky-600">{t.ticketNo}</span>
            </h3>
            {t.ncf && <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">NCF: {t.ncf}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-4 space-y-4">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
            <div><span className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Fecha' : 'Date'}:</span> <span className="font-medium text-slate-700 dark:text-white">{fmtDate(t.date)} {fmtTime(t.date)}</span></div>
            <div><span className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Cajero' : 'Cashier'}:</span> <span className="font-medium text-slate-700 dark:text-white">{t.cashier}</span></div>
            {showVehicle && (
              <div><span className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Vehículo' : 'Vehicle'}:</span> <span className="font-medium text-slate-700 dark:text-white">{t.vehicle}</span></div>
            )}
            <div><span className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Comprobante' : 'Receipt'}:</span> <span className="font-medium text-slate-700 dark:text-white">{t.ncfType} · {t.ncfType === 'B01' ? (lang === 'es' ? 'Crédito Fiscal' : 'Tax Credit') : (lang === 'es' ? 'Consumidor Final' : 'Consumer')}</span></div>
            <div className="col-span-2"><span className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Cliente' : 'Client'}:</span> <span className="font-medium text-slate-700 dark:text-white">{t.client}</span></div>
            {workerNames.length > 0 && (
              <div className="col-span-2"><span className="text-slate-400 dark:text-white/40">{workerLabel}:</span> <span className="font-medium text-slate-700 dark:text-white">{workerNames.join(', ')}</span></div>
            )}
          </div>

          {/* Services */}
          <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
            {loadingItems ? (
              <div className="flex items-center justify-center h-16 text-slate-400 dark:text-white/40 text-[12px] gap-2">
                <div className="w-3 h-3 border-2 border-slate-300 border-t-sky-500 rounded-full animate-spin" />
                {lang === 'es' ? `Cargando ${itemsLabel}…` : `Loading ${itemsLabel}…`}
              </div>
            ) : services.length === 0 ? (
              <div className="px-4 py-3 text-[12px] text-slate-400 dark:text-white/40">
                {lang === 'es' ? `Sin ${itemsLabel} registrados` : `No ${itemsLabel} recorded`}
              </div>
            ) : (
              services.map((s, i) => (
                <div key={i} className="flex justify-between px-4 py-2.5 border-b border-slate-100 dark:border-white/10 last:border-0 text-[12px]">
                  <span className="text-slate-700 dark:text-white">{s.name}</span>
                  <span className="font-semibold text-slate-800 dark:text-white">{fmtRD(s.price)}</span>
                </div>
              ))
            )}
          </div>

          {/* Totals */}
          <div className="space-y-1 text-[12px]">
            <div className="flex justify-between text-slate-500 dark:text-white/60">
              <span>{lang === 'es' ? 'Subtotal' : 'Subtotal'}</span>
              <span>{fmtRD(t.subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-500 dark:text-white/60">
              {/* Derive rate from the ticket's stored figures so historic tickets
                  computed at a different rate still display accurately. */}
              <span>ITBIS {t.subtotal > 0 ? Math.round((t.itbis / t.subtotal) * 100) : 18}%</span>
              <span>{fmtRD(t.itbis)}</span>
            </div>
            {t.ley > 0 && (
              <div className="flex justify-between text-slate-500 dark:text-white/60">
                <span>{lang === 'es' ? 'Ley 10%' : 'Service Charge 10%'}</span>
                <span>{fmtRD(t.ley)}</span>
              </div>
            )}
            {t.descuento > 0 && (
              <>
                <div className="flex justify-between text-rose-600 dark:text-rose-400">
                  <span>{lang === 'es' ? 'Descuento' : 'Discount'}</span>
                  <span>−{fmtRD(t.descuento)}</span>
                </div>
                {t.descuentoReason && (
                  <div className="flex justify-between text-[11px] text-rose-500/80 dark:text-rose-400/70 -mt-0.5">
                    <span className="italic">{lang === 'es' ? 'Razón' : 'Reason'}: {t.descuentoReason}</span>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-between font-bold text-slate-800 dark:text-white text-[14px] pt-1 border-t border-slate-200 dark:border-white/10">
              <span>Total</span>
              <span>{fmtRD(t.total)}</span>
            </div>
          </div>

          {/* Payment */}
          <div className="flex items-center gap-2 text-[12px] flex-wrap">
            <span className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Método de pago' : 'Payment method'}:</span>
            {t.paymentParts && t.paymentParts.length > 1 ? (
              <span className="font-semibold text-slate-700 dark:text-white">
                {t.paymentParts.map((p, i) => (
                  <span key={i}>
                    {i > 0 && <span className="text-slate-400 dark:text-white/40"> + </span>}
                    {payLabel(p.method, lang)} <span className="text-slate-500 dark:text-white/60">{fmtRD(p.amount)}</span>
                  </span>
                ))}
              </span>
            ) : (
              <span className="font-semibold text-slate-700 dark:text-white">{payLabel(t.payMethod, lang)}</span>
            )}
            <MixtoBadge parts={t.paymentParts} lang={lang} />
            <EstadoBadge t={t} lang={lang} />
          </div>

          {/* Comentario / Notes */}
          {(t.comentario || t.notes) && (
            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl px-3 py-2">
              <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-0.5">
                {lang === 'es' ? 'Comentario' : 'Notes'}
              </p>
              <p className="text-[12px] text-slate-700 dark:text-white whitespace-pre-wrap">{t.comentario || t.notes}</p>
            </div>
          )}

          {/* Void info */}
          {t.estado === 'nula' && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 space-y-1 text-[12px]">
              <p className="font-bold text-red-700">{lang === 'es' ? 'Factura Anulada' : 'Voided Invoice'}</p>
              <p className="text-red-600"><span className="font-medium">{lang === 'es' ? 'Motivo' : 'Reason'}:</span> {t.voidReason}</p>
              <p className="text-red-500">{lang === 'es' ? 'Anulado por' : 'Voided by'}: {t.voidedBy} · {fmtDate(t.voidedAt)} {fmtTime(t.voidedAt)}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-4 border-t border-slate-200 dark:border-white/10 flex justify-end gap-3">
          {t.estado !== 'nula' && (
            <>
              <button
                onClick={() => onReprint?.('factura')}
                className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
              >
                <Printer size={14} />
                {lang === 'es' ? 'Reimprimir Factura' : 'Reprint Invoice'}
              </button>
              <button
                onClick={() => onReprint?.('conduce')}
                className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
              >
                <Printer size={14} />
                {lang === 'es' ? 'Reimprimir Conduce' : 'Reprint Conduce'}
              </button>
            </>
          )}
          <button onClick={onClose} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-[12px] font-semibold transition-colors">
            {lang === 'es' ? 'Cerrar' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Anular modal ──────────────────────────────────────────────────────────────
function AnularModal({ ticket: t, onConfirm, onClose, lang, currentUser }) {
  const [reason,    setReason]    = useState('')
  const [error,     setError]     = useState('')
  const [gateOpen,  setGateOpen]  = useState(false)

  function handleConfirm() {
    setError('')
    if (!reason.trim()) {
      setError(lang === 'es' ? 'El motivo es requerido.' : 'Reason is required.')
      return
    }
    setGateOpen(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white dark:bg-black rounded-none md:rounded-2xl shadow-2xl w-full md:w-[420px] h-full md:h-auto flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-red-50 rounded-xl flex items-center justify-center">
              <Ban size={15} className="text-red-500" />
            </div>
            <div>
              <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">{lang === 'es' ? 'Anular Factura' : 'Void Invoice'}</h3>
              <p className="text-[11px] text-red-500 font-medium">{t.ticketNo} · {fmtRD(t.total)}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10"><X size={15} /></button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Warning */}
          <div className="flex gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-3 text-[12px] text-amber-800">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-500" />
            <p>{lang === 'es'
              ? 'Esta acción es irreversible. La factura se marcará como anulada y no aparecerá en futuros reportes DGII, pero permanecerá en el historial.'
              : 'This action cannot be undone. The invoice will be voided and excluded from future DGII reports, but will remain in history.'
            }</p>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 mb-1.5">
              {lang === 'es' ? 'Motivo de anulación' : 'Void reason'} <span className="text-red-400">*</span>
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder={lang === 'es' ? 'Describe el motivo de la anulación...' : 'Describe the reason for voiding...'}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white focus:outline-none focus:border-sky-400 resize-none placeholder:text-slate-400"
            />
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-white/60 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2">
            {lang === 'es'
              ? 'Al confirmar, se pedirá la tarjeta de autorización del gerente.'
              : "On confirm, you'll be asked for the manager's authorization card."}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-1.5 text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              <AlertTriangle size={12} className="shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors">
            {lang === 'es' ? 'Cancelar' : 'Cancel'}
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 text-white rounded-xl text-[13px] font-bold transition-colors"
          >
            {lang === 'es' ? 'Confirmar Anulación' : 'Confirm Void'}
          </button>
        </div>
      </div>

      {gateOpen && (
        <ManagerAuthGate
          action="void"
          actionLabel={lang === 'es' ? `Anular factura ${t.ticketNo} · ${fmtRD(t.total)}` : `Void invoice ${t.ticketNo} · ${fmtRD(t.total)}`}
          context={{ target_id: t.id, target_name: t.ticketNo, amount: t.total, reason }}
          onApprove={({ staff_name, mac_jti }) => {
            setGateOpen(false)
            onConfirm({ ticketId: t.id, reason: reason.trim(),
              voidedBy: staff_name || 'Manager', voidedAt: new Date(), mac_jti })
          }}
          onCancel={() => setGateOpen(false)}
        />
      )}
    </div>
  )
}

// ── Main Sales / Facturas screen ──────────────────────────────────────────────
const TAB_FILTERS = [
  { id: 'todas',   es: 'Todas',      en: 'All',          fn: () => true                                            },
  { id: 'normal',  es: 'Normales',   en: 'Normal',       fn: t => t.estado === 'normal'                           },
  { id: 'cxc',     es: 'CxC',        en: 'Credit A/R',   fn: t => t.payMethod === 'credit' && t.estado === 'normal'},
  { id: 'nulas',   es: 'Nulas',      en: 'Voided',       fn: t => t.estado === 'nula'                             },
  { id: 'contado', es: 'Al Contado', en: 'Cash / Card',  fn: t => t.payMethod !== 'credit' && t.estado === 'normal'},
  { id: 'credito', es: 'A Crédito',  en: 'On Account',   fn: t => t.payMethod === 'credit'                        },
]

export default function DailyReport() {
  const api = useAPI()
  const { lang }   = useLang()
  const { user: currentUser } = useAuth()
  const { businessType, isHybrid } = useBusinessType()
  const showVehicle    = hasVehicles(businessType)
  const isServiceBiz   = isServiceBased(businessType)

  const [transactions, setTransactions] = useState([])
  const [loading,      setLoading]      = useState(false)

  const [tab,          setTab]          = useState('todas')
  const [datePill,     setDatePill]     = useState('mes')
  const [cashier,      setCashier]      = useState('all')
  // Hybrid only — split Ventas by originating mode. Persist in the component
  // only; resets every mount. 'todas' = no filter.
  const [modeFilter,   setModeFilter]   = useState('todas') // todas | mesa | directa
  const [search,       setSearch]       = useState('')
  const [selectedId,   setSelectedId]   = useState(null)
  const [detailModal,  setDetailModal]  = useState(null)
  const [anularModal,  setAnularModal]  = useState(null)
  const [toast,        setToast]        = useState(null)
  const [biz,          setBiz]          = useState({})
  const [reprintMenu,  setReprintMenu]  = useState(false)

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // v2.14.20 — reprint factura or conduce from Ventas. Builds a ticketData
  // shape compatible with services/printer.js; items are already on the
  // row (dbToTxn hydrates t.items from the tickets.byDateRange query).
  // kind: 'factura' | 'conduce'. For conduce with 2+ washers, prints one
  // per washer so each worker gets their own slip.
  async function reprintTicket(t, kind) {
    try {
      // v2.14.24 — byDateRange returns service_names (GROUP_CONCAT), not
      // an items[] array with prices. Reprint used to fall back to those
      // name-only entries with price=0 → every reprint printed "Carro
      // Basico RD$0.00". Fetch the full ticket by id so we get real line
      // items with real prices. Identified in print audit 2026-04-24.
      let fullItems = null
      try {
        const full = await api.tickets.byId(t.id)
        if (full?.items?.length) fullItems = full.items
      } catch (_aetherErr) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'dailyreport.dailyreport' }) } catch {}}
      // v2.14.34 — preserve `is_wash` and DO NOT map to a hard `c: false` on
      // reprint. Live print path leaves `c` undefined on pending.items so
      // buildWasherConduce's `s.c !== false` filter includes everything.
      // Prior reprint mapping set c=false whenever is_wash was 0 OR NULL on
      // legacy rows → entire conduce printed "(Sin servicios de lavado)".
      // Now we propagate is_wash so the per-washer scaling can still tell
      // wash from non-wash, but leave c undefined to match live behavior.
      const services = fullItems
        ? fullItems.map(i => ({ name: i.name, price: Number(i.price) || 0, qty: Number(i.quantity || 1), itbis: Number(i.itbis) || 0, is_wash: i.is_wash }))
        : (t.items && t.items.length)
          ? t.items.map(i => ({ name: i.name, price: Number(i.price) || 0, qty: Number(i.quantity || 1), itbis: Number(i.itbis) || 0, is_wash: i.is_wash }))
          : (t.services || []).map(s => ({ name: s.name, price: Number(s.price) || 0, qty: 1, itbis: 0 }))
      const ticketData = {
        ncf:          t.ncf || '',
        ncfType:      t.ncfType || 'B02',
        cajero:       t.cashier || '',
        lavador:      (t.washerNames && t.washerNames.length ? t.washerNames.join(', ') : '') || '-',
        docNo:        t.ticketNo || '',
        paidAt:       t.date || new Date(),
        client:       t.client && t.client !== 'Walk-in' ? { name: t.client } : null,
        client_name:  t.client === 'Walk-in' ? '' : (t.client || ''),
        vehiclePlate: t.vehicle === '—' ? '' : (t.vehicle || ''),
        tipo:         t.payMethod === 'credit' ? 'credito' : 'contado',
        formaPago:    t.payMethod || 'cash',
        services,
        subtotal:     Number(t.subtotal) || 0,
        descuento:    Number(t.descuento) || 0,
        itbis:        Number(t.itbis) || 0,
        ley:          Number(t.ley) || 0,
        total:        Number(t.total) || 0,
        biz,
      }
      if (kind === 'conduce') {
        // v2.14.34 — fetch washer_commissions for this ticket to derive each
        // washer's SHARE of the wash work. Scale wash service prices on the
        // reprinted conduce so each washer's slip shows only their portion
        // (RD$300 each on a 50/50 RD$600 service, not RD$600 on every conduce).
        // Falls back to even split when commissions aren't recorded.
        let commWashers = []
        try {
          const commRows = await api.commissions?.byTicket?.({ ticketId: t.id })
          if (Array.isArray(commRows) && commRows.length) {
            commWashers = commRows.map(r => ({ name: r.nombre || r.name || '-', commAmount: Number(r.commission_amount) || 0 }))
          }
        } catch (_aetherErr) {
          try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'dailyreport.flash' }) } catch {}}
        const washers = commWashers.length
          ? commWashers
          : ((t.washerNames && t.washerNames.length)
              ? t.washerNames.map(n => ({ name: n, commAmount: 0 }))
              : [{ name: ticketData.lavador || '-', commAmount: 0 }])
        const totalComm = washers.reduce((s, w) => s + (Number(w.commAmount) || 0), 0)
        for (const w of washers) {
          const myShare = totalComm > 0
            ? ((Number(w.commAmount) || 0) / totalComm)
            : (1 / washers.length)
          const scaledServices = (ticketData.services || []).map(s => {
            const isWash = (s.is_wash ?? (s.c !== false ? 1 : 0)) !== 0
            if (!isWash) return s
            return {
              ...s,
              price: parseFloat((Number(s.price || 0) * myShare).toFixed(2)),
              itbis: s.itbis != null ? parseFloat((Number(s.itbis || 0) * myShare).toFixed(2)) : s.itbis,
            }
          })
          await printWasherConduce({ ...ticketData, services: scaledServices, lavador: w.name || '-', commAmount: w.commAmount })
        }
        flash(lang === 'es' ? 'Conduce reimpreso ✓' : 'Conduce reprinted ✓')
      } else {
        await printClientReceipt(ticketData)
        flash(lang === 'es' ? 'Factura reimpresa ✓' : 'Invoice reprinted ✓')
      }
    } catch (e) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'dailyreport.if' }) } catch {}
      flash(lang === 'es' ? 'Error al reimprimir' : 'Reprint error')
    }
  }

  useEffect(() => {
    api.admin?.getEmpresa?.().then(e => {
      if (e) setBiz({
        name: e.name || e.nombre,
        rnc: e.rnc,
        address: e.address || e.direccion,
        phone: e.phone || e.telefono,
        email: e.email,
        logo: e.logo,
        // v2.14.34 — pass full settings JSON so receipt header can read
        // dual-keyed address (s.biz_address || s.direccion) and ciudad on reprint.
        settings: e.settings,
      })
    }).catch(() => {})
  }, [])

  // Load tickets from DB whenever datePill changes
  useEffect(() => {
    let cancelled = false
    let isInitial = true
    const reload = () => {
      // v2.16.32 — Only show spinner on initial load for this datePill.
      // Listener-triggered reloads (tx:tickets-refresh) must NOT flash the
      // spinner: when reload is invoked while transactions has data and the
      // fetch returns [] (auth glitch, network hiccup), the spinner masked
      // the list and setTransactions([]) wiped it — Mike repro'd ≥3 times.
      if (isInitial) setLoading(true)
      setSelectedId(null)
      const range = getDateRange(datePill)
      api.tickets.byDateRange(range)
        .then(rows => {
          if (cancelled) return
          // Defensive: if a refresh fetch returns empty but we already had
          // data on screen, keep what we have rather than blanking. Initial
          // load (transactions still []) accepts the empty result so the
          // empty-state copy can render.
          if (!isInitial && Array.isArray(rows) && rows.length === 0) {
            // eslint-disable-next-line no-console
            console.error('[DailyReport] refresh returned [] — keeping current state')
            return
          }
          setTransactions((rows || []).map(dbToTxn))
        })
        .catch((e) => {
          if (cancelled) return
          if (!isInitial) {
            // eslint-disable-next-line no-console
            console.error('[DailyReport] refresh threw — keeping current state', e?.message)
            return
          }
          setTransactions([])
        })
        .finally(() => {
          if (cancelled) return
          if (isInitial) setLoading(false)
          isInitial = false
        })
    }
    setCashier('all')
    reload()
    // v2.16.31 — Refresh after voids / cobros so the list never goes stale.
    // Mike reported on 2026-05-01: after voiding T-0028, Ventas screen showed
    // ZERO tickets even though 4 cobrado tickets remained in DB. Manual
    // refresh recovered. Listener sources:
    //   - web.js api.tickets.void → dispatches tx:tickets-refresh
    //   - POS.jsx handlePaymentConfirm → dispatches tx:tickets-refresh
    //     (added in same patch so a successful Cobrar shows up immediately
    //      if the cashier is on the Reports tab in another window).
    const onRefresh = () => { if (!cancelled) reload() }
    if (typeof window !== 'undefined') window.addEventListener('tx:tickets-refresh', onRefresh)
    return () => {
      cancelled = true
      if (typeof window !== 'undefined') window.removeEventListener('tx:tickets-refresh', onRefresh)
    }
  }, [datePill])

  // Unique cashier names from loaded data
  const cashierOptions = useMemo(() => {
    const names = [...new Set(transactions.map(t => t.cashier).filter(c => c && c !== '—'))]
    return names.sort()
  }, [transactions])

  // Base set: cashier filtered (date already filtered at DB level).
  // Hybrid also applies the Mesa/Directa segment filter so every downstream
  // metric (summary, tab counts, CSV export) respects the segmentation.
  const baseFiltered = useMemo(() =>
    transactions.filter(t => {
      if (cashier !== 'all' && t.cashier !== cashier) return false
      if (isHybrid && modeFilter !== 'todas') {
        // "directa" matches either explicit 'directa' tagging OR legacy rows
        // with no mesa and no mode — those are retail-style entries.
        if (modeFilter === 'mesa' && t.mode !== 'mesa' && !t.mesa_id) return false
        if (modeFilter === 'directa' && (t.mode === 'mesa' || t.mesa_id)) return false
      }
      return true
    })
  , [transactions, cashier, modeFilter, isHybrid])

  // Summary metrics (base, not tab/search filtered)
  const summary = useMemo(() => {
    const active = baseFiltered.filter(t => t.estado !== 'nula')
    // Net profit: sum of (price - cost) across all line items on non-void tickets.
    // Only tickets with at least one item that has a non-zero cost contribute.
    let itemCostTotal = 0
    let itemRevenueTotal = 0
    let hasAnyCost = false
    for (const t of active) {
      for (const it of (t.items || [])) {
        const price = Number(it.price) || 0
        const cost  = Number(it.cost)  || 0
        itemRevenueTotal += price
        itemCostTotal    += cost
        if (cost > 0) hasAnyCost = true
      }
    }
    // Channel/processor fees
    let pyFee = 0, cardFee = 0, pyRevenue = 0, cardRevenue = 0
    for (const t of active) {
      const total = Number(t.total) || 0
      if (t.orderSource === 'pedidos_ya') { pyRevenue += total; pyFee += total * 0.15 }
      let cardPortion = 0
      if (Array.isArray(t.paymentParts) && t.paymentParts.length) {
        for (const p of t.paymentParts) {
          if (p.method.includes('card') || p.method.includes('tarjeta')) cardPortion += p.amount
        }
      } else {
        const pm = String(t.payMethod || '').toLowerCase()
        if (pm.includes('card') || pm.includes('tarjeta')) cardPortion = total
      }
      cardRevenue += cardPortion
      cardFee     += cardPortion * 0.05
    }
    const grossProfit = hasAnyCost ? itemRevenueTotal - itemCostTotal : null
    return {
      count:    active.length,
      total:    active.reduce((s, t) => s + t.total,  0),
      itbis:    active.reduce((s, t) => s + t.itbis,  0),
      cxc:      baseFiltered.filter(t => t.payMethod === 'credit' && t.estado !== 'nula').reduce((s, t) => s + t.total, 0),
      nulas:    baseFiltered.filter(t => t.estado === 'nula').length,
      profit:   grossProfit,
      profitNet: grossProfit != null ? grossProfit - pyFee - cardFee : null,
      pyFee, cardFee, pyRevenue, cardRevenue,
      hasAnyCost,
    }
  }, [baseFiltered])

  // Visible rows: base + tab + search
  const visible = useMemo(() => {
    const tabFn = TAB_FILTERS.find(f => f.id === tab)?.fn ?? (() => true)
    const q     = search.toLowerCase().trim()
    return baseFiltered
      .filter(tabFn)
      .filter(t => !q || t.client.toLowerCase().includes(q) || t.ticketNo.toLowerCase().includes(q) || t.vehicle.toLowerCase().includes(q))
  }, [baseFiltered, tab, search])

  const selectedTicket = transactions.find(t => t.id === selectedId) ?? null

  // Tab counts (from base, not search)
  const tabCounts = useMemo(() => {
    const res = {}
    TAB_FILTERS.forEach(f => { res[f.id] = baseFiltered.filter(f.fn).length })
    return res
  }, [baseFiltered])

  async function handleVoid({ ticketId, reason, voidedBy, voidedAt, mac_jti }) {
    try {
      await api.tickets.void({ id: ticketId, reason, voidById: currentUser?.id, mac_jti })
      // v2.16.32 — Optimistic in-place mutation ONLY. Do NOT refetch.
      // Earlier versions tried a post-void byDateRange refetch (or a
      // tx:tickets-refresh broadcast that triggered the same path) to
      // reconcile state with DB. Both observably wiped the list under
      // edge conditions Mike reproduced ≥3 times — even with empty-array
      // safety checks the list still went blank. The optimistic update
      // already produces correct UI (the row flips to estado='nula' and
      // moves to the Anuladas tab via baseFiltered). Reconciliation
      // happens naturally on the next datePill change or page navigation.
      setTransactions(ts => ts.map(t =>
        t.id === ticketId
          ? { ...t, estado: 'nula', voidReason: reason, voidedBy, voidedAt }
          : t
      ))
      setAnularModal(null)
      setSelectedId(null)
      // Defense-in-depth against browser autofill: ManagerAuthGate's password
      // input triggers Chrome to autofill the saved login email into nearby
      // text inputs. Even with autoComplete=off + ignore attrs, some browsers
      // do it anyway. If the search field was filled, the row filter would
      // hide every ticket. Reset it once the void completes so the user
      // never sees a blank list.
      setSearch('')
      flash(lang === 'es' ? 'Factura anulada correctamente.' : 'Invoice voided successfully.')
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'dailyreport.handlevoid' }) } catch {}
      flash(lang === 'es' ? 'Error al anular la factura.' : 'Error voiding the invoice.')
    }
  }

  // Services placeholder for row display — "—" when no items loaded yet
  function getRowService(t) {
    if (t.services.length > 0) return { name: t.services[0].name, extra: t.services.length - 1 }
    return { name: '—', extra: 0 }
  }

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-black overflow-hidden">

      {/* ── Filter header ──────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10">

        {/* Row 1: title + cashier + search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between px-3 md:px-6 pt-3 md:pt-4 pb-2 md:pb-3 gap-2 md:gap-4">
          <div>
            <h2 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">{lang === 'es' ? 'Ventas / Facturas' : 'Sales / Invoices'}</h2>
            <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5 hidden md:block">{lang === 'es' ? 'Historial completo de transacciones' : 'Complete transaction history'}</p>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            {/* Cashier dropdown */}
            <div className="relative flex-1 md:flex-none">
              <select
                value={cashier}
                onChange={e => setCashier(e.target.value)}
                className="appearance-none w-full md:w-auto pl-3 pr-8 py-2 min-h-[44px] md:min-h-0 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] text-slate-700 dark:text-white focus:outline-none focus:border-sky-400 cursor-pointer"
              >
                <option value="all">{lang === 'es' ? 'Todos los cajeros' : 'All cashiers'}</option>
                {cashierOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
            {/* Search */}
            <div className="flex items-center gap-2 px-3 py-2 min-h-[44px] md:min-h-0 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl focus-within:border-sky-400 flex-1 md:flex-none w-full md:w-56">
              <Search size={13} className="text-slate-400 dark:text-white/40 shrink-0" />
              <input
                type="text"
                name="dailyreport-search"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={lang === 'es' ? 'Buscar cliente o # factura...' : 'Search client or invoice #...'}
                className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-slate-700 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40"
              />
            </div>
          </div>
        </div>

        {/* Row 2: type tabs + date pills */}
        <div className="flex flex-col md:flex-row md:items-center justify-between px-3 md:px-6 pb-0 gap-1 md:gap-0">
          {/* Type tabs */}
          <div className="flex gap-0.5 flex-wrap">
            {TAB_FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => setTab(f.id)}
                className={`flex items-center gap-1.5 md:gap-2 px-2.5 md:px-3.5 py-2.5 text-[11px] md:text-[12px] font-medium border-b-2 -mb-px transition-colors shrink-0 ${
                  tab === f.id ? 'border-slate-800 text-slate-800 dark:border-white dark:text-white' : 'border-transparent text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white'
                }`}
              >
                {lang === 'es' ? f.es : f.en}
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center ${
                  tab === f.id ? 'bg-slate-200 dark:bg-white/20 text-slate-800 dark:text-white' : 'bg-slate-100 dark:bg-white/10 text-slate-400 dark:text-white/40'
                }`}>
                  {tabCounts[f.id] ?? 0}
                </span>
              </button>
            ))}
          </div>

          {/* Date pills + mode chips (hybrid) + export */}
          <div className="flex items-center gap-1.5 pb-2.5 overflow-x-auto scrollbar-none">
            {isHybrid && (
              <div className="inline-flex rounded-lg bg-slate-100 dark:bg-white/10 p-0.5 mr-1 shrink-0">
                {[
                  { id: 'todas',   es: 'Todas',   en: 'All'      },
                  { id: 'mesa',    es: 'Mesa',    en: 'Dine-in'  },
                  { id: 'directa', es: 'Directa', en: 'Retail'   },
                ].map(m => (
                  <button
                    key={m.id}
                    onClick={() => setModeFilter(m.id)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors ${
                      modeFilter === m.id
                        ? 'bg-[#b3001e] text-white'
                        : 'text-slate-500 dark:text-white/60 hover:text-slate-800 dark:hover:text-white'
                    }`}
                  >
                    {lang === 'es' ? m.es : m.en}
                  </button>
                ))}
              </div>
            )}
            {DATE_PILLS.map(p => (
              <button
                key={p.id}
                onClick={() => setDatePill(p.id)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors shrink-0 ${
                  datePill === p.id
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/20'
                }`}
              >
                {lang === 'es' ? p.es : p.en}
              </button>
            ))}
            <button
              onClick={() => {
                const pill = DATE_PILLS.find(p => p.id === datePill)
                const label = pill ? (lang === 'es' ? pill.es : pill.en) : datePill
                exportDailyReport(biz, baseFiltered, summary, label)
              }}
              disabled={baseFiltered.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/20 transition-colors shrink-0 disabled:opacity-40"
            >
              <Download size={12} />
              CSV
            </button>
            <button
              onClick={() => {
                const pill = DATE_PILLS.find(p => p.id === datePill)
                const label = pill ? (lang === 'es' ? pill.es : pill.en) : datePill
                printDailyReport(biz, baseFiltered, summary, label)
              }}
              disabled={baseFiltered.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/20 transition-colors shrink-0 disabled:opacity-40"
            >
              <Printer size={12} />
              Imprimir
            </button>
          </div>
        </div>
      </div>

      {/* ── Top washers (carwash only) ─────────────────────────────────────── */}
      {businessType === 'carwash' && <TopWashersCard lang={lang} />}

      {/* ── Summary bar ────────────────────────────────────────────────────── */}
      <div className="shrink-0 grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3 px-3 md:px-6 py-2 md:py-3">
        <MetricCard icon={ReceiptText}      label={lang === 'es' ? 'Total Facturas'      : 'Total Invoices'}   value={summary.count}            accent="sky"    />
        <MetricCard icon={TrendingUp}       label={lang === 'es' ? 'Total Facturado'     : 'Total Billed'}     value={fmtRD(summary.total)}     accent="green"  />
        {summary.hasAnyCost && (
          <MetricCard icon={CircleDollarSign} label={lang === 'es' ? 'Ganancia Neta' : 'Net Profit'} value={fmtRD(summary.profitNet || 0)} sub={(summary.pyFee > 0 || summary.cardFee > 0) ? `−${fmtRD(summary.pyFee + summary.cardFee)} comisiones` : (summary.total > 0 ? `${Math.round(((summary.profitNet || 0) / summary.total) * 100)}% margen` : null)} accent="green" />
        )}
        <MetricCard icon={CircleDollarSign} label="ITBIS Generado"                                             value={fmtRD(summary.itbis)}     accent="violet" />
        <MetricCard icon={Clock}            label={lang === 'es' ? 'CxC Pendiente'       : 'Pending A/R'}      value={fmtRD(summary.cxc)}       accent="amber"  />
        <MetricCard icon={Ban}              label={lang === 'es' ? 'Facturas Nulas'      : 'Voided Invoices'}  value={summary.nulas}            accent="red"    />
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-white dark:bg-white/5 mx-2 md:mx-6 mb-3 rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">

        {/* Rows */}
        <div className="flex-1 overflow-y-auto overflow-x-auto">
          {/* Column headers — sticky inside scroll so they share the same width as rows */}
          <div className="hidden md:flex items-center h-9 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-5 sticky top-0 z-10">
            {COLS.map(col => {
              const label = col.key === 'client'
                ? (lang === 'es' ? (showVehicle ? col.esVehicle : col.es) : (showVehicle ? col.enVehicle : col.en))
                : col.key === 'services'
                  ? (lang === 'es' ? (isServiceBiz ? col.es : col.esProduct) : (isServiceBiz ? col.en : col.enProduct))
                  : (lang === 'es' ? col.es : col.en)
              return (
                <div key={col.key} className={`${col.cls} text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider pr-4`}>
                  {label}
                </div>
              )
            })}
          </div>
          {loading ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-300 gap-3">
              <div className="w-6 h-6 border-2 border-slate-200 border-t-sky-500 rounded-full animate-spin" />
              <p className="text-[13px]">{lang === 'es' ? 'Cargando transacciones…' : 'Loading transactions…'}</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-300 gap-2">
              <ReceiptText size={28} />
              <p className="text-[13px]">{lang === 'es' ? 'Sin resultados para este filtro' : 'No results for this filter'}</p>
            </div>
          ) : (
            visible.map(t => {
              const isSelected = t.id === selectedId
              const isNula     = t.estado === 'nula'
              const isCxC      = t.payMethod === 'credit' && !isNula
              const { name: mainName, extra } = getRowService(t)

              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}
                  className={`w-full text-left transition-colors border-b border-slate-100 ${
                    isSelected ? 'bg-sky-50 dark:bg-sky-900/20 border-l-2 border-l-sky-500'
                    : isNula   ? 'bg-red-50/60 hover:bg-red-50 border-l-2 border-l-transparent'
                    : isCxC    ? 'bg-amber-50/50 hover:bg-amber-50 border-l-2 border-l-transparent'
                    :            'bg-white dark:bg-transparent hover:bg-slate-50 dark:hover:bg-white/5 border-l-2 border-l-transparent'
                  }`}
                >
                  {/* Mobile card layout */}
                  <div className="md:hidden px-3 py-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className={`text-[13px] font-bold ${isNula ? 'text-red-400 line-through' : 'text-sky-600'}`}>{t.ticketNo}</span>
                      <span className={`text-[13px] font-bold ${isNula ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-white'}`}>{fmtRD(t.total)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className={`text-[12px] font-semibold truncate flex-1 ${isNula ? 'text-slate-400' : 'text-slate-800 dark:text-white'}`}>{t.client}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <MixtoBadge parts={t.paymentParts} lang={lang} />
                        <EstadoBadge t={t} lang={lang} />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-400 dark:text-white/40">
                      {showVehicle && <span>{t.vehicle}</span>}
                      <span>{fmtDate(t.date)} {fmtTime(t.date)}</span>
                    </div>
                  </div>

                  {/* Desktop row layout */}
                  <div className="hidden md:flex items-center h-14 px-5">
                    {/* # */}
                    <div className="w-[80px] shrink-0 pr-4">
                      <span className={`text-[13px] font-bold ${isNula ? 'text-red-400 line-through' : 'text-sky-600'}`}>{t.ticketNo}</span>
                    </div>

                    {/* Client / Vehicle */}
                    <div className="flex-1 min-w-[120px] pr-4">
                      <p className={`text-[12px] font-semibold truncate ${isNula ? 'text-slate-400' : 'text-slate-800 dark:text-white'}`}>{t.client || '—'}</p>
                      {showVehicle && t.vehicle && t.vehicle !== '—' && <p className="text-[11px] text-slate-400 dark:text-white/40 truncate">{t.vehicle}</p>}
                    </div>

                    {/* Service(s) */}
                    <div className="w-[160px] shrink-0 pr-4 flex items-center gap-1.5 min-w-0">
                      <span className={`text-[12px] truncate ${isNula ? 'text-slate-400' : 'text-slate-700 dark:text-white'}`}>{mainName}</span>
                      {extra > 0 && (
                        <span className="shrink-0 text-[10px] font-bold bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/60 px-1.5 py-0.5 rounded-full">+{extra}</span>
                      )}
                    </div>

                    {/* Cashier */}
                    <div className="w-[90px] shrink-0 pr-4">
                      <span className={`text-[12px] ${isNula ? 'text-slate-400' : 'text-slate-600 dark:text-white/60'}`}>{t.cashier}</span>
                    </div>

                    {/* Date / Time */}
                    <div className="w-[120px] shrink-0 pr-4">
                      <p className={`text-[11px] ${isNula ? 'text-slate-400' : 'text-slate-700 dark:text-white'}`}>{fmtDate(t.date)}</p>
                      <p className="text-[10px] text-slate-400 dark:text-white/40">{fmtTime(t.date)}</p>
                    </div>

                    {/* Subtotal */}
                    <div className="w-[96px] shrink-0 pr-4 text-right">
                      <span className={`text-[12px] ${isNula ? 'text-slate-400 line-through' : 'text-slate-600 dark:text-white/60'}`}>{fmtRD(t.subtotal)}</span>
                    </div>

                    {/* ITBIS */}
                    <div className="w-[84px] shrink-0 pr-4 text-right">
                      <span className={`text-[12px] ${isNula ? 'text-slate-400 line-through' : 'text-slate-500 dark:text-white/60'}`}>{fmtRD(t.itbis)}</span>
                    </div>

                    {/* Total */}
                    <div className="w-[104px] shrink-0 pr-4 text-right">
                      <span className={`text-[13px] font-bold ${isNula ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-white'}`}>{fmtRD(t.total)}</span>
                    </div>

                    {/* Estado */}
                    <div className="w-[108px] shrink-0 flex items-center gap-1">
                      <EstadoBadge t={t} lang={lang} />
                      <MixtoBadge parts={t.paymentParts} lang={lang} />
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* ── Row count footer ── */}
        <div className="shrink-0 border-t border-slate-100 dark:border-white/10 px-5 py-2 flex items-center justify-between bg-slate-50/50 dark:bg-white/5">
          <span className="text-[11px] text-slate-400 dark:text-white/40">
            {visible.length} {lang === 'es' ? 'registros' : 'records'}
            {search && ` · ${lang === 'es' ? 'filtrado por' : 'filtered by'} "${search}"`}
          </span>
          <span className="text-[11px] font-semibold text-slate-600 dark:text-white/60">
            {lang === 'es' ? 'Total visible' : 'Visible total'}: {fmtRD(visible.filter(t => t.estado !== 'nula').reduce((s, t) => s + t.total, 0))}
          </span>
        </div>
      </div>

      {/* ── Bottom action bar (when row selected) ─────────────────────────── */}
      {selectedTicket && (
        <div className="shrink-0 bg-white dark:bg-white/5 border-t border-slate-200 dark:border-white/10 px-6 py-3 flex items-center gap-4">
          <button onClick={() => setSelectedId(null)} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
            <X size={15} />
          </button>
          <div className="flex-1 min-w-0">
            <span className="text-[13px] font-bold text-sky-600">{selectedTicket.ticketNo}</span>
            {showVehicle && selectedTicket.vehicle && selectedTicket.vehicle !== '—' && (
              <span className="text-[13px] text-slate-500 dark:text-white/60 ml-2">{selectedTicket.vehicle}</span>
            )}
            <span className="text-[13px] font-semibold text-slate-800 dark:text-white ml-3">{fmtRD(selectedTicket.total)}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setDetailModal(selectedTicket)}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
            >
              <Eye size={13} />
              {lang === 'es' ? 'Ver Detalle' : 'View Detail'}
            </button>
            <div className="relative">
              <button
                onClick={() => setReprintMenu(v => !v)}
                className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
              >
                <Printer size={13} />
                {lang === 'es' ? 'Reimprimir' : 'Reprint'}
                <ChevronDown size={12} className={`transition-transform ${reprintMenu ? 'rotate-180' : ''}`} />
              </button>
              {reprintMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setReprintMenu(false)} />
                  <div className="absolute bottom-full right-0 mb-1 bg-white dark:bg-black border border-slate-200 dark:border-white/10 rounded-xl shadow-lg z-40 overflow-hidden min-w-[180px]">
                    <button
                      onClick={() => { setReprintMenu(false); reprintTicket(selectedTicket, 'factura') }}
                      className="w-full text-left px-4 py-2.5 text-[12px] font-semibold text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
                    >
                      {lang === 'es' ? 'Reimprimir Factura' : 'Reprint Invoice'}
                    </button>
                    <button
                      onClick={() => { setReprintMenu(false); reprintTicket(selectedTicket, 'conduce') }}
                      className="w-full text-left px-4 py-2.5 text-[12px] font-semibold text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/10 transition-colors border-t border-slate-100 dark:border-white/10"
                    >
                      {lang === 'es' ? 'Reimprimir Conduce' : 'Reprint Conduce'}
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={() => selectedTicket.estado !== 'nula' && setAnularModal(selectedTicket)}
              disabled={selectedTicket.estado === 'nula'}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                selectedTicket.estado === 'nula'
                  ? 'bg-slate-50 dark:bg-white/5 text-slate-300 cursor-not-allowed border border-slate-100 dark:border-white/10'
                  : 'bg-red-50 hover:bg-red-100 border border-red-200 text-red-600'
              }`}
            >
              <Ban size={13} />
              {lang === 'es' ? 'Anular Factura' : 'Void Invoice'}
            </button>
          </div>
        </div>
      )}

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 right-6 flex items-center gap-2.5 bg-slate-800 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-xl z-50">
          <CheckCircle2 size={15} className="text-green-400 shrink-0" />
          {toast}
        </div>
      )}

      {/* ── Detail modal ────────────────────────────────────────────────────── */}
      {detailModal && (
        <DetailModal
          ticket={detailModal}
          onClose={() => setDetailModal(null)}
          onReprint={(kind) => reprintTicket(detailModal, kind)}
          lang={lang}
        />
      )}

      {/* ── Anular modal ─────────────────────────────────────────────────────── */}
      {anularModal && (
        <AnularModal
          ticket={anularModal}
          onConfirm={handleVoid}
          onClose={() => setAnularModal(null)}
          lang={lang}
          currentUser={currentUser}
        />
      )}
    </div>
  )
}
