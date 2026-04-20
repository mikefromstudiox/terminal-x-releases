import { useState, useMemo, useRef, useEffect } from 'react'
import {
  FileMinus, Search, Plus, Printer, Lock,
  CheckCircle2, ExternalLink, RotateCcw, AlertCircle,
  Tag, Scissors, X, ChevronDown, RefreshCw,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAPI } from '../context/DataContext'
import { useLang } from '../i18n'
import { signAndSubmitECF } from '@terminal-x/services/ecf'
import ManagerAuthGate from '../components/ManagerAuthGate'
import { needsGate } from '@terminal-x/services/managerGateRules'

// ── Constants ────────────────────────────────────────────────────────────────
// Fallback rate only — actual rate pulled from app_settings.itbis_pct at runtime.
const DEFAULT_ITBIS_RATE = 18
const LEY_RATE           = 0.10

const MOTIVOS = ['Devolución', 'Descuento', 'Error']
const FORMAS  = ['Efectivo', 'Crédito en cuenta', 'Transferencia']

const MOTIVO_META = {
  'Devolución': { icon: RotateCcw, badge: 'bg-blue-100 text-blue-700',   tab: 'devoluciones' },
  'Descuento':  { icon: Tag,       badge: 'bg-violet-100 text-violet-700', tab: 'descuentos'  },
  'Error':      { icon: Scissors,  badge: 'bg-red-100 text-red-700',       tab: 'errores'     },
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) {
  return 'RD$' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── COLS ──────────────────────────────────────────────────────────────────────
const COLS = [
  { key: 'ncf',      label: '# Nota',           cls: 'w-36'            },
  { key: 'client',   label: 'Cliente',           cls: 'flex-1 min-w-0'  },
  { key: 'factOrig', label: 'Factura original',  cls: 'w-36'            },
  { key: 'fecha',    label: 'Fecha',             cls: 'w-28'            },
  { key: 'monto',    label: 'Monto',             cls: 'w-32 text-right' },
  { key: 'itbis',    label: 'ITBIS rev.',        cls: 'w-28 text-right' },
  { key: 'motivo',   label: 'Motivo',            cls: 'w-28'            },
  { key: 'estado',   label: 'Estado',            cls: 'w-24'            },
]

const TABS = [
  { key: 'todas',       label: 'Todas',       fn: () => true                          },
  { key: 'devoluciones',label: 'Devoluciones',fn: n => n.motivo === 'Devolución'      },
  { key: 'descuentos',  label: 'Descuentos',  fn: n => n.motivo === 'Descuento'       },
  { key: 'errores',     label: 'Errores',     fn: n => n.motivo === 'Error'           },
]

// ── Sub-components ────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, color = 'slate', icon: Icon }) {
  const ring = { slate: 'border-slate-100 bg-white dark:border-white/10 dark:bg-white/5', red: 'border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10', blue: 'border-blue-200 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/10', violet: 'border-violet-200 bg-violet-50 dark:border-violet-500/30 dark:bg-violet-500/10' }
  const val  = { slate: 'text-slate-800 dark:text-white', red: 'text-red-600', blue: 'text-blue-700', violet: 'text-violet-700' }
  return (
    <div className={`rounded-2xl border p-4 flex-1 ${ring[color]}`}>
      <div className="flex items-start justify-between mb-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">{label}</p>
        {Icon && <Icon size={14} className={val[color]} />}
      </div>
      <p className={`text-2xl font-bold tabular-nums ${val[color]}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 dark:text-white/40 mt-0.5">{sub}</p>}
    </div>
  )
}

function MotivoBadge({ motivo }) {
  const m   = MOTIVO_META[motivo] || {}
  const Icon = m.icon ?? Tag
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${m.badge}`}>
      <Icon size={10} />
      {motivo}
    </span>
  )
}

// ── Invoice Detail Popover ────────────────────────────────────────────────────
function InvoicePopover({ ticket, onClose }) {
  if (!ticket) return null
  return (
    <div className="absolute z-30 top-8 left-0 w-72 bg-white dark:bg-white/5 rounded-xl shadow-2xl border border-slate-100 dark:border-white/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-slate-800 dark:text-white">{ticket.doc_number}</p>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-white/10"><X size={14} className="text-slate-400 dark:text-white/40" /></button>
      </div>
      <p className="text-xs text-slate-500 dark:text-white/60 mb-1">NCF: <span className="font-medium text-slate-700 dark:text-white">{ticket.ncf || '—'}</span></p>
      <p className="text-xs text-slate-500 dark:text-white/60 mb-1">Cliente: <span className="font-medium text-slate-700 dark:text-white">{ticket.client_name || 'Consumidor Final'}</span></p>
      <p className="text-xs text-slate-500 dark:text-white/60 mb-2">RNC: <span className="font-medium text-slate-700 dark:text-white">{ticket.client_rnc || '—'}</span></p>
      <div className="border-t border-slate-100 dark:border-white/10 mt-2 pt-2 flex justify-between">
        <span className="text-xs text-slate-500 dark:text-white/60">Total factura</span>
        <span className="text-sm font-bold text-slate-800 dark:text-white">{fmt(ticket.total)}</span>
      </div>
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ msg }) {
  return (
    <div
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-sm px-5 py-3 rounded-full shadow-lg flex items-center gap-2"
      style={{ animation: 'fadeOut 2.8s forwards' }}
    >
      <CheckCircle2 size={15} className="text-emerald-400" />
      {msg}
      <style>{`@keyframes fadeOut{0%,70%{opacity:1}100%{opacity:0}}`}</style>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function CreditNotes() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const isCashier = user?.role === 'cashier'

  const [notes,    setNotes]    = useState([])
  const [tickets,  setTickets]  = useState([])   // for invoice lookup
  const [loading,  setLoading]  = useState(true)
  const [tab,      setTab]      = useState('todas')
  const [search,   setSearch]   = useState('')
  const [selected, setSelected] = useState(null)
  const [showPin,  setShowPin]  = useState(false)
  const [toast,    setToast]    = useState(null)
  const [popover,  setPopover]  = useState(null)  // ticket id

  // Form state
  const [clientName,  setClientName]  = useState('')
  const [clientRNC,   setClientRNC]   = useState('')
  const [factNo,      setFactNo]      = useState('')
  const [motivo,      setMotivo]      = useState('Devolución')
  const [monto,       setMonto]       = useState('')
  const [forma,       setForma]       = useState('Efectivo')
  const [comentario,  setComentario]  = useState('')
  const [factLookup,  setFactLookup]  = useState(null)   // matched ticket object
  const [factLoading, setFactLoading] = useState(false)
  const [submitting,  setSubmitting]  = useState(false)
  const pendingEmit                   = useRef(null)
  const pendingMacJti                 = useRef(null)

  // ── ITBIS rate — from app_settings.itbis_pct, default 18. ──────────────────
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

  // ── Load data from DB ──────────────────────────────────────────────────────
  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [notasData, ticketsData] = await Promise.all([
        api.notas.all(),
        api.tickets.byDateRange({ from: '2020-01-01', to: '2099-12-31' }),
      ])
      setNotes(notasData || [])
      setTickets(ticketsData || [])
    } catch (e) {
      console.error('CreditNotes load error:', e)
    } finally {
      setLoading(false)
    }
  }

  // ── Map DB nota to display shape ───────────────────────────────────────────
  function mapNota(n) {
    return {
      id:         n.id,
      ncf:        n.ncf || '—',
      factOrig:   n.original_ticket_id ? `T-${String(n.original_ticket_id).padStart(4,'0')}` : '—',
      ticketId:   n.original_ticket_id,
      client:     n.client_name || 'Cliente',
      rnc:        n.client_rnc  || '',
      motivo:     n.motivo      || 'Devolución',
      monto:      n.amount      || 0,
      fecha:      n.created_at  || new Date().toISOString(),
      estado:     'emitida',
      itbisRev:   n.itbis_revertido || 0,
      forma:      n.forma_devolucion || 'Efectivo',
      comentario: n.comentario || '',
    }
  }

  const displayNotes = useMemo(() => notes.map(mapNota), [notes])

  // ── Derived metrics ─────────────────────────────────────────────────────────
  const totalDevuelto = displayNotes.reduce((s, n) => s + n.monto, 0)
  const totalDevol    = displayNotes.filter(n => n.motivo === 'Devolución').reduce((s, n) => s + n.monto, 0)
  const totalOther    = displayNotes.filter(n => n.motivo !== 'Devolución').reduce((s, n) => s + n.monto, 0)

  // ── Filter ──────────────────────────────────────────────────────────────────
  const tabFn    = TABS.find(t => t.key === tab)?.fn ?? (() => true)
  const tabCounts = useMemo(() => {
    const o = {}
    TABS.forEach(t => { o[t.key] = displayNotes.filter(t.fn).length })
    return o
  }, [displayNotes])

  const q = search.trim().toLowerCase()
  const visible = displayNotes
    .filter(tabFn)
    .filter(n => !q || n.client.toLowerCase().includes(q) || n.ncf.toLowerCase().includes(q) || n.factOrig.toLowerCase().includes(q))

  // ── Fact lookup (search tickets array) ───────────────────────────────────────
  async function handleFactBlur() {
    const key = factNo.trim().toUpperCase()
    if (!key) { setFactLookup(null); return }
    setFactLoading(true)
    // Search loaded tickets by doc_number
    const match = tickets.find(t => t.doc_number?.toUpperCase() === key)
    if (match) {
      setFactLookup(match)
      setClientName(match.client_name || '')
      setClientRNC(match.client_rnc || '')
    } else {
      setFactLookup(null)
    }
    setFactLoading(false)
  }

  // ── Derived form calc ────────────────────────────────────────────────────────
  const montoNum  = parseFloat(monto) || 0
  const itbisRev  = parseFloat((montoNum * itbisFactor / (1 + itbisFactor + LEY_RATE)).toFixed(2))
  const formValid = clientName.trim() && montoNum > 0

  // ── Emit ──────────────────────────────────────────────────────────────────────
  function tryEmit() {
    if (!formValid) return
    // v2.6 — Credit notes are always gated (even for managers, per audit rules).
    if (needsGate(user, 'credit_note')) {
      pendingEmit.current = doEmit
      setShowPin(true)
    } else {
      doEmit()
    }
  }

  async function doEmit() {
    setSubmitting(true)
    try {
      const biz      = await api.admin.getEmpresa()
      const settings = biz?.settings ? JSON.parse(biz.settings) : {}
      const isECF    = settings.facturacion_mode === 'ecf'

      let assignedNCF = null

      if (isECF) {
        const subtotal  = parseFloat((montoNum / (1 + itbisFactor + LEY_RATE)).toFixed(2))
        const ecfResult = await signAndSubmitECF({
          tipoECF:    '34',
          emisor: {
            rnc:             biz.rnc     || '',
            nombre:          biz.name    || '',
            nombreComercial: biz.name    || '',
            direccion:       biz.address || 'Santo Domingo',
            email:           biz.email   || '',
          },
          comprador:  clientRNC.trim()
            ? { rnc: clientRNC.trim(), nombre: clientName }
            : null,
          totales:    { subtotal, itbis: itbisRev, total: montoNum },
          items:      [{ nombre: `Nota Crédito - ${motivo}`, precio: subtotal, cantidad: 1 }],
          metodoPago: forma === 'Efectivo' ? 'efectivo' : forma === 'Transferencia' ? 'transferencia' : 'nota_credito',
          referencia: {
            ncfModificado:      factLookup?.ncf || factNo || '',
            razonModificacion:  comentario.trim() || motivo,
            codigoModificacion: motivo === 'Devolución' ? '1' : motivo === 'Descuento' ? '2' : '3',
          },
        })
        assignedNCF = ecfResult.eNCF
      } else {
        assignedNCF = await api.ncf.next('B04')
      }

      const data = {
        ncf:                assignedNCF,
        client_id:          factLookup?.client_id || null,
        original_ticket_id: factLookup?.id || null,
        motivo,
        amount:             montoNum,
        itbis_revertido:    itbisRev,
        forma_devolucion:   forma,
        comentario:         comentario.trim(),
        cajero_id:          user?.id || null,
        mac_jti:            pendingMacJti.current || null,
      }
      await api.notas.create(data)
      pendingMacJti.current = null
      const fresh = await api.notas.all()
      setNotes(fresh || [])
      setClientName(''); setClientRNC(''); setFactNo(''); setMonto(''); setComentario('')
      setFactLookup(null)
      showToast(L('Nota de crédito emitida', 'Credit note issued'))
    } catch (e) {
      console.error('notaCreate error:', e)
      showToast(e.message || L('Error al emitir nota', 'Error issuing note'))
    } finally {
      setSubmitting(false)
    }
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  // ── Popover ticket lookup ────────────────────────────────────────────────────
  function getPopoverTicket(ticketId) {
    return tickets.find(t => t.id === ticketId) || null
  }

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-black overflow-hidden">
      {showPin && (
        <ManagerAuthGate
          action="credit_note"
          actionLabel={L(`Nota de crédito · RD$ ${montoNum.toFixed(2)}`, `Credit note · RD$ ${montoNum.toFixed(2)}`)}
          context={{ amount: montoNum, motivo, reason: comentario, original_ticket_id: factLookup?.id || null }}
          onApprove={({ mac_jti } = {}) => { pendingMacJti.current = mac_jti || null; setShowPin(false); const fn = pendingEmit.current; pendingEmit.current = null; fn?.() }}
          onCancel={() => { setShowPin(false); pendingEmit.current = null; pendingMacJti.current = null }}
        />
      )}
      {toast && <Toast msg={toast} />}

      {/* ── Header ── */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-3 py-3 md:px-6 md:py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <FileMinus size={20} className="text-slate-500 dark:text-white/60" />
          <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">{L('Notas de Crédito', 'Credit Notes')}</h1>
          <span className="text-xs text-slate-400 dark:text-white/40 ml-1">Secuencia B04</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadAll}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 px-3 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {L('Actualizar', 'Refresh')}
          </button>
          <button
            onClick={() => document.getElementById('nc-form')?.scrollIntoView({ behavior: 'smooth' })}
            className="flex items-center gap-2 px-4 py-2 bg-black hover:bg-slate-800 dark:bg-white dark:text-black dark:hover:bg-white/90 text-white rounded-xl text-sm font-medium transition-colors"
          >
            <Plus size={14} />
            {L('Nueva nota', 'New note')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-4 p-4">

        {/* ── Summary bar ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
          <MetricCard label={L('Total notas emitidas', 'Total notes issued')} value={displayNotes.length} sub={L('en todos los períodos', 'all periods')} icon={FileMinus} />
          <MetricCard label={L('Total devuelto', 'Total returned')} value={fmt(totalDevuelto)} sub={L('suma de todas las notas', 'sum of all notes')} color="red" icon={AlertCircle} />
          <MetricCard label={L('Por devolución', 'Returns')} value={fmt(totalDevol)} sub={`${displayNotes.filter(n=>n.motivo==='Devolución').length} notas`} color="blue" icon={RotateCcw} />
          <MetricCard label={L('Por error / descuento', 'Error / discount')} value={fmt(totalOther)} sub={`${displayNotes.filter(n=>n.motivo!=='Devolución').length} notas`} color="violet" icon={Tag} />
        </div>

        {/* ── Filter bar ── */}
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 shadow-sm flex flex-col overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center gap-2 px-3 md:px-4 pt-3 border-b border-slate-100 dark:border-white/10">
            <div className="flex gap-0.5 overflow-x-auto scrollbar-none">
              {TABS.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center gap-1 px-2.5 md:px-3 py-2 text-[11px] md:text-sm font-medium rounded-t border-b-2 -mb-px transition shrink-0 ${
                    tab === t.key ? 'text-blue-600 border-blue-500' : 'text-slate-500 dark:text-white/60 border-transparent hover:text-slate-700 dark:hover:text-white'
                  }`}
                >
                  {t.label}
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/60'}`}>
                    {tabCounts[t.key]}
                  </span>
                </button>
              ))}
            </div>
            <div className="md:ml-auto pb-2">
              <div className="flex items-center gap-2 px-3 py-2 min-h-[44px] md:min-h-0 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg focus-within:ring-2 focus-within:ring-blue-400 w-full md:w-48">
                <Search size={13} className="text-slate-400 dark:text-white/40 shrink-0" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={L('Cliente o # nota…', 'Client or note #…')}
                  className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-700 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40"
                />
              </div>
            </div>
          </div>

          {/* Table header — desktop only */}
          <div className="hidden md:flex items-center px-4 py-2 bg-slate-50 dark:bg-white/5 border-b border-slate-100 dark:border-white/10">
            {COLS.map(c => (
              <span key={c.key} className={`text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40 ${c.cls}`}>
                {c.label}
              </span>
            ))}
            <span className="w-10" />
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-50 dark:divide-white/5">
            {loading && (
              <div className="py-12 text-center text-sm text-slate-400 dark:text-white/40">{L('Cargando…', 'Loading…')}</div>
            )}
            {!loading && visible.length === 0 && (
              <div className="py-12 text-center text-sm text-slate-400 dark:text-white/40">{L('No hay notas en esta categoría.', 'No notes in this category.')}</div>
            )}
            {!loading && visible.map(n => (
              <div
                key={n.id}
                onClick={() => setSelected(s => s?.id === n.id ? null : n)}
                className={`cursor-pointer transition ${
                  selected?.id === n.id ? 'bg-blue-50 dark:bg-blue-500/10 border-l-2 border-blue-500' : 'hover:bg-slate-50 dark:hover:bg-white/5'
                }`}
              >
                {/* Mobile card */}
                <div className="md:hidden px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-mono text-slate-700 dark:text-white">{n.ncf}</span>
                    <MotivoBadge motivo={n.motivo} />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate flex-1">{n.client}</p>
                    <span className="text-[13px] font-bold text-red-600 shrink-0">-{fmt(n.monto)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 dark:text-white/40">
                    <span>{fmtDate(n.fecha)}</span>
                    <span>ITBIS: -{fmt(n.itbisRev)}</span>
                  </div>
                </div>
                {/* Desktop row */}
                <div className="hidden md:flex items-center px-4 h-12">
                {/* NCF */}
                <span className={`${COLS[0].cls} text-xs font-mono text-slate-700 dark:text-white`}>{n.ncf}</span>

                {/* Cliente */}
                <div className={`${COLS[1].cls} min-w-0 overflow-hidden pr-3`}>
                  <p className="text-sm text-slate-800 dark:text-white truncate">{n.client}</p>
                  {n.rnc && <p className="text-[10px] text-slate-400 dark:text-white/40 truncate">{n.rnc}</p>}
                </div>

                {/* Factura original */}
                <div className={`${COLS[2].cls} relative`}>
                  <button
                    onClick={e => { e.stopPropagation(); setPopover(v => v === n.ticketId ? null : n.ticketId) }}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                  >
                    {n.factOrig}
                    {n.ticketId && <ExternalLink size={10} />}
                  </button>
                  {popover === n.ticketId && n.ticketId && (
                    <InvoicePopover ticket={getPopoverTicket(n.ticketId)} onClose={() => setPopover(null)} />
                  )}
                </div>

                {/* Fecha */}
                <span className={`${COLS[3].cls} text-xs text-slate-500 dark:text-white/60`}>{fmtDate(n.fecha)}</span>

                {/* Monto */}
                <span className={`${COLS[4].cls} text-sm font-semibold tabular-nums text-red-600`}>
                  − {fmt(n.monto)}
                </span>

                {/* ITBIS rev */}
                <span className={`${COLS[5].cls} text-xs tabular-nums text-slate-500 dark:text-white/60`}>
                  − {fmt(n.itbisRev)}
                </span>

                {/* Motivo */}
                <div className={`${COLS[6].cls}`}>
                  <MotivoBadge motivo={n.motivo} />
                </div>

                {/* Estado */}
                <div className={`${COLS[7].cls}`}>
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                    <CheckCircle2 size={12} />
                    {n.estado}
                  </span>
                </div>

                {/* Chevron */}
                <div className="w-10 flex justify-end">
                  <ChevronDown size={14} className={`text-slate-300 dark:text-white/30 transition ${selected?.id === n.id ? 'rotate-180' : ''}`} />
                </div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="border-t border-slate-100 dark:border-white/10 px-4 py-2 flex justify-between items-center bg-slate-50 dark:bg-white/5">
            <span className="text-xs text-slate-400 dark:text-white/40">{visible.length} nota{visible.length !== 1 ? 's' : ''}</span>
            <span className="text-sm font-bold text-red-600 tabular-nums">
              − {fmt(visible.reduce((s, n) => s + n.monto, 0))}
            </span>
          </div>
        </div>

        {/* ── Bottom action bar (row selected) ── */}
        {selected && (
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 shadow-sm px-4 py-3 flex items-center gap-3">
            <span className="text-sm text-slate-600 dark:text-white/60">
              Nota <span className="font-mono font-semibold">{selected.ncf}</span> — {selected.client}
            </span>
            <div className="flex-1" />
            <button className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-sm text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">
              <Printer size={15} />
              {L('Imprimir nota', 'Print note')}
            </button>
          </div>
        )}

        {/* ── Entry form ── */}
        <div id="nc-form" className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 shadow-sm p-5 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-white/40">{L('Nueva nota de crédito', 'New credit note')}</p>
            {isCashier && (
              <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                <Lock size={12} />
                {L('Requiere PIN de gerente', 'Manager PIN required')}
              </span>
            )}
          </div>

          {/* Row 1 — Client + Invoice lookup */}
          <div className="flex gap-3 mb-3 flex-wrap">
            {/* RNC */}
            <div className="w-44">
              <label className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1 block">RNC {L('cliente', 'client')}</label>
              <input
                value={clientRNC}
                onChange={e => setClientRNC(e.target.value)}
                placeholder="000-00000-0"
                className="w-full border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {/* Client name */}
            <div className="flex-1 min-w-[180px]">
              <label className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1 block">{L('Nombre / empresa', 'Name / company')}</label>
              <input
                value={clientName}
                onChange={e => setClientName(e.target.value)}
                placeholder={L('Nombre del cliente…', 'Client name…')}
                className="w-full border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {/* Factura original */}
            <div className="w-48">
              <label className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1 block">{L('Factura original', 'Original invoice')}</label>
              <div className="relative">
                <input
                  value={factNo}
                  onChange={e => { setFactNo(e.target.value); setFactLookup(null) }}
                  onBlur={handleFactBlur}
                  placeholder="T-0081"
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:text-white ${
                    factLookup ? 'border-emerald-300 bg-emerald-50/40 dark:bg-emerald-500/10' : 'border-slate-200 dark:border-white/10 dark:bg-white/5'
                  }`}
                />
                {factLoading && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 animate-pulse">{L('buscando…', 'searching…')}</span>
                )}
              </div>
              {factLookup && (
                <p className="text-[10px] text-emerald-600 mt-0.5 truncate">✓ {factLookup.client_name || 'Consumidor Final'} · {fmt(factLookup.total)}</p>
              )}
              {factNo && !factLookup && !factLoading && (
                <p className="text-[10px] text-slate-400 mt-0.5">{L('Factura no encontrada', 'Invoice not found')}</p>
              )}
            </div>
          </div>

          {/* Loaded invoice details */}
          {factLookup && (
            <div className="mb-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 p-3 flex gap-6 flex-wrap">
              <div>
                <p className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider">NCF {L('original', 'original')}</p>
                <p className="text-xs font-mono font-medium text-slate-700 dark:text-white">{factLookup.ncf || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider">{L('Estado', 'Status')}</p>
                <p className="text-xs text-slate-700 dark:text-white">{factLookup.status || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider">Subtotal</p>
                <p className="text-xs font-medium text-slate-700 dark:text-white">{fmt(factLookup.subtotal)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider">{L('Total facturado', 'Total billed')}</p>
                <p className="text-sm font-bold text-slate-800 dark:text-white">{fmt(factLookup.total)}</p>
              </div>
            </div>
          )}

          {/* Row 2 — Motivo + Monto + Forma */}
          <div className="flex gap-3 mb-3 flex-wrap items-end">
            {/* Motivo */}
            <div>
              <label className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1 block">{L('Motivo', 'Reason')}</label>
              <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden text-sm">
                {MOTIVOS.map(m => {
                  const meta = MOTIVO_META[m]
                  const Icon = meta.icon
                  return (
                    <button
                      key={m}
                      onClick={() => setMotivo(m)}
                      className={`flex items-center gap-1.5 px-3 py-2 font-medium transition ${
                        motivo === m ? `${meta.badge} border-0` : 'text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'
                      }`}
                    >
                      <Icon size={12} />
                      {m}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Monto */}
            <div className="w-36">
              <label className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1 block">{L('Monto a devolver', 'Amount to refund')}</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 dark:text-white/40">RD$</span>
                <input
                  type="number"
                  min="0"
                  value={monto}
                  onChange={e => setMonto(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>

            {/* Forma devolución */}
            <div className="w-48">
              <label className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1 block">{L('Forma de devolución', 'Refund method')}</label>
              <div className="relative">
                <select
                  value={forma}
                  onChange={e => setForma(e.target.value)}
                  className="w-full appearance-none border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white pr-8"
                >
                  {FORMAS.map(f => <option key={f}>{f}</option>)}
                </select>
                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Comentario */}
            <div className="flex-1 min-w-[180px]">
              <label className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1 block">{L('Comentario (opcional)', 'Comment (optional)')}</label>
              <input
                value={comentario}
                onChange={e => setComentario(e.target.value)}
                placeholder={L('Observaciones…', 'Notes…')}
                className="w-full border border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {/* Emit button */}
            <button
              onClick={tryEmit}
              disabled={!formValid || submitting}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap self-end"
            >
              {isCashier && <Lock size={13} />}
              {submitting ? L('Emitiendo…', 'Issuing…') : L('Emitir nota de crédito', 'Issue credit note')}
            </button>
          </div>

          {/* Live calc strip */}
          <div className={`rounded-xl border px-4 py-3 flex items-center gap-6 flex-wrap text-sm transition ${
            montoNum > 0 ? 'bg-red-50 border-red-200 dark:bg-red-500/10 dark:border-red-500/30' : 'bg-slate-50 border-slate-100 dark:bg-white/5 dark:border-white/10'
          }`}>
            {/* Factura original total */}
            <div>
              <p className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider mb-0.5">{L('Factura original', 'Original invoice')}</p>
              <p className="font-semibold text-slate-700 dark:text-white tabular-nums">
                {factLookup ? fmt(factLookup.total) : <span className="text-slate-300 dark:text-white/30">—</span>}
              </p>
            </div>
            <span className="text-slate-300 dark:text-white/30 text-lg">→</span>
            {/* Monto nota */}
            <div>
              <p className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider mb-0.5">{L('Monto nota', 'Note amount')}</p>
              <p className={`font-bold tabular-nums ${montoNum > 0 ? 'text-red-600' : 'text-slate-300 dark:text-white/30'}`}>
                {montoNum > 0 ? `− ${fmt(montoNum)}` : '—'}
              </p>
            </div>
            <span className="text-slate-300 dark:text-white/30 text-lg">→</span>
            {/* ITBIS a revertir */}
            <div>
              <p className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider mb-0.5">{L('ITBIS a revertir', 'ITBIS reversal')}</p>
              <p className={`font-semibold tabular-nums ${montoNum > 0 ? 'text-red-500' : 'text-slate-300 dark:text-white/30'}`}>
                {montoNum > 0 ? `− ${fmt(itbisRev)}` : '—'}
              </p>
            </div>
            <span className="text-slate-300 dark:text-white/30 text-lg">→</span>
            {/* Forma */}
            {montoNum > 0 && (
              <>
                <div>
                  <p className="text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wider mb-0.5">{L('Vía', 'Via')}</p>
                  <p className="font-medium text-slate-700 dark:text-white">{forma}</p>
                </div>
              </>
            )}
            {/* Warning if over invoice total */}
            {factLookup && montoNum > factLookup.total && (
              <span className="ml-auto flex items-center gap-1 text-xs text-red-500 bg-red-100 px-3 py-1 rounded-full">
                <AlertCircle size={12} />
                {L('Monto excede factura original', 'Amount exceeds original invoice')}
              </span>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
