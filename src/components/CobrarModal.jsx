import { useState, useEffect, useRef } from 'react'
import { X, Search, Banknote, CreditCard, ArrowRightLeft, Landmark, CheckCircle2, AlertTriangle, Loader2, QrCode, User } from 'lucide-react'
import { useLang } from '../i18n'
import { signAndSubmitECF, getQRCode, ECF_TYPES, validateRNC, EF2_CONFIGURED } from '../services/ecf'
import { hasIPC } from '../hooks/useDB'

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtRD(n) {
  return `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const ITBIS_RATE = 0.18
const LEY_RATE   = 0.10

const PAYMENT_METHODS = [
  { id: 'efectivo',      icon: Banknote,       es: 'Efectivo',      en: 'Cash'     },
  { id: 'tarjeta',       icon: CreditCard,     es: 'Tarjeta',       en: 'Card'     },
  { id: 'transferencia', icon: ArrowRightLeft, es: 'Transferencia', en: 'Transfer' },
  { id: 'cheque',        icon: Landmark,       es: 'Cheque',        en: 'Check'    },
]

const QUICK = [200, 500, 1000, 2000]

const L = (es, en) => ({ es, en })
const LABELS = {
  title:       L('Cobrar Ticket',               'Collect Payment'),
  summary:     L('Resumen de Orden',            'Order Summary'),
  comp:        L('Comprobante Electrónico',      'Electronic Receipt'),
  tipo:        L('Tipo de Factura',             'Invoice Type'),
  contado:     L('Al Contado',                  'Immediate'),
  credito:     L('A Crédito',                   'On Account'),
  formaPago:   L('Forma de Pago',               'Payment Method'),
  recibido:    L('Recibido',                    'Amount Received'),
  devuelta:    L('Devuelta',                    'Change'),
  falta:       L('Falta',                       'Remaining'),
  exacto:      L('Exacto',                      'Exact'),
  comment:     L('Comentario (opcional)',        'Comment (optional)'),
  cancel:      L('Cancelar',                    'Cancel'),
  charge:      L('Cobrar',                      'Charge'),
  subtotal:    L('Subtotal',                    'Subtotal'),
  itbis:       L('ITBIS 18%',                   'ITBIS 18%'),
  ley:         L('Ley 10%',                     'Service Charge 10%'),
  total:       L('Total',                       'Total'),
  rnc:         L('RNC',                         'RNC'),
  nombre:      L('Nombre Empresa',              'Company Name'),
  buscar:      L('Buscar',                      'Lookup'),
  creditNote:  L('Este ticket será registrado como crédito en la cuenta del cliente.',
                  'This ticket will be posted to the client\'s credit account.'),
  enterAmount: L('Ingresa el monto recibido',   'Enter amount received'),
}

function tl(key, lang) { return LABELS[key]?.[lang] ?? key }

// ── Submission steps shown during loading ─────────────────────────────────────
const STEPS_ES = ['Generando XML…', 'Firmando digitalmente…', 'Enviando a DGII…']
const STEPS_EN = ['Generating XML…', 'Signing digitally…',    'Sending to DGII…']

// ── Small components ──────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{children}</p>
}

function ClientInfoBar({ client, ticketTotal, lang }) {
  const balance  = client.balance || 0
  const limit    = client.credit_limit || 0
  const newBal   = balance + ticketTotal
  const available = Math.max(0, limit - balance)
  const pct      = limit > 0 ? Math.min(100, (newBal / limit) * 100) : 0
  const exceeds  = limit > 0 && newBal > limit
  const barColor = pct < 70 ? 'bg-green-500' : pct < 90 ? 'bg-amber-400' : 'bg-red-500'

  return (
    <div className="mt-2 border border-slate-200 rounded-xl p-3 bg-white">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[13px] font-bold text-slate-800 truncate">{client.name}</p>
        {client.rnc && <p className="text-[10px] text-slate-400 shrink-0">{client.rnc}</p>}
      </div>

      {limit > 0 ? (
        <>
          <div className="grid grid-cols-3 gap-1 text-center mb-2.5">
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                {lang === 'es' ? 'Adeudado' : 'Owed'}
              </p>
              <p className="text-[12px] font-bold text-red-500">
                RD$ {balance.toLocaleString('en-US', { minimumFractionDigits: 0 })}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                {lang === 'es' ? 'Límite' : 'Limit'}
              </p>
              <p className="text-[12px] font-semibold text-slate-600">
                RD$ {limit.toLocaleString('en-US', { minimumFractionDigits: 0 })}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                {lang === 'es' ? 'Disponible' : 'Available'}
              </p>
              <p className="text-[12px] font-bold text-green-600">
                RD$ {available.toLocaleString('en-US', { minimumFractionDigits: 0 })}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-1.5">
            <div
              className={`h-full rounded-full transition-all duration-300 ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Over-limit warning */}
          {exceeds && (
            <div className="flex items-center gap-1.5 text-red-600">
              <AlertTriangle size={11} className="shrink-0" />
              <p className="text-[10px] font-bold">
                {lang === 'es'
                  ? `Este ticket excede el límite por RD$ ${(newBal - limit).toLocaleString('en-US', { minimumFractionDigits: 0 })}`
                  : `Exceeds limit by RD$ ${(newBal - limit).toLocaleString('en-US', { minimumFractionDigits: 0 })}`}
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="text-[11px] text-slate-400">
          {lang === 'es' ? 'Sin límite de crédito configurado' : 'No credit limit set'}
        </p>
      )}
    </div>
  )
}

function ToggleBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2.5 px-3 rounded-xl border text-[13px] font-semibold transition-all text-center ${
        active
          ? 'bg-slate-800 border-slate-800 text-white'
          : 'border-slate-200 text-slate-600 hover:border-slate-400 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  )
}

// ── Success / receipt view ────────────────────────────────────────────────────
function SuccessView({ ticket, ecfResult, qrUrl, total, ncfType, onClose, lang, pdfUrl }) {
  const ecfType = ECF_TYPES[ncfType]
  const fmtISO  = s => new Date(s).toLocaleString('es-DO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 py-6 gap-5 overflow-y-auto">
      {/* Green check */}
      <div className="w-14 h-14 bg-green-50 border-2 border-green-200 rounded-full flex items-center justify-center">
        <CheckCircle2 size={28} className="text-green-500" />
      </div>

      {/* Main info */}
      <div className="text-center">
        <p className="text-[13px] font-semibold text-slate-500 mb-1">
          {lang === 'es' ? 'e-CF enviado a DGII' : 'e-CF submitted to DGII'}
        </p>
        <p className="text-[26px] font-bold text-slate-800 font-mono tracking-wide">{ecfResult.eNCF}</p>
        <div className="flex items-center justify-center gap-2 mt-2">
          <span className="text-[11px] font-bold bg-green-50 text-green-700 border border-green-200 rounded-full px-3 py-0.5">
            {ecfResult.status}
          </span>
          <span className="text-[11px] text-slate-400">{ecfType?.name_es ?? ncfType}</span>
        </div>
      </div>

      {/* Details grid */}
      <div className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 grid grid-cols-2 gap-y-2.5 gap-x-4 text-[12px]">
        <div>
          <p className="text-slate-400">{lang === 'es' ? 'Ticket' : 'Ticket'}</p>
          <p className="font-bold text-sky-600">{ticket.ticketNo}</p>
        </div>
        <div>
          <p className="text-slate-400">Total</p>
          <p className="font-bold text-slate-800">{fmtRD(total)}</p>
        </div>
        <div>
          <p className="text-slate-400">{lang === 'es' ? 'Enviado' : 'Submitted'}</p>
          <p className="font-semibold text-slate-700">{fmtISO(ecfResult.submittedAt)}</p>
        </div>
        <div>
          <p className="text-slate-400">{lang === 'es' ? 'Ref. ef2.do' : 'ef2.do Ref.'}</p>
          <p className="font-mono text-[11px] text-slate-600">{ecfResult.trackId}</p>
        </div>
      </div>

      {/* QR code */}
      <div className="flex flex-col items-center gap-2">
        {qrUrl ? (
          <img
            src={qrUrl}
            alt="QR verificación DGII"
            width={128}
            height={128}
            className="rounded-xl border border-slate-200 shadow-sm"
          />
        ) : (
          <div className="w-32 h-32 bg-slate-100 rounded-xl flex items-center justify-center">
            <QrCode size={32} className="text-slate-300 animate-pulse" />
          </div>
        )}
        <p className="text-[10px] text-slate-400 text-center">
          {lang === 'es' ? 'Escanea para verificar en DGII' : 'Scan to verify on DGII portal'}
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-3 w-full">
        {pdfUrl && (
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-sky-200 text-sky-600 rounded-xl text-[13px] font-semibold hover:bg-sky-50 transition-colors"
          >
            {lang === 'es' ? 'Ver PDF' : 'View PDF'}
          </a>
        )}
        <button
          onClick={onClose}
          className={`${pdfUrl ? 'flex-[2]' : 'flex-1'} py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-[13px] font-bold transition-colors`}
        >
          {lang === 'es' ? 'Cerrar' : 'Close'}
        </button>
      </div>
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export default function CobrarModal({ ticket, onConfirm, onClose }) {
  const { lang } = useLang()

  // Totals
  const subtotal = ticket.services.reduce((s, svc) => s + svc.price, 0)
  const itbis    = subtotal * ITBIS_RATE
  const ley      = subtotal * LEY_RATE
  const total    = subtotal + itbis + ley

  // Enabled e-CF types (loaded from NCF sequences)
  const [enabledEcfTypes, setEnabledEcfTypes] = useState(null) // null = loading, [] after load

  // Form state
  const [ncfType,    setNcfType]    = useState('E32')
  const [rnc,        setRnc]        = useState('')
  const [rncName,    setRncName]    = useState('')
  const [tipo,       setTipo]       = useState('contado')
  const [formaPago,  setFormaPago]  = useState(null)
  const [recibido,   setRecibido]   = useState('')
  const [comentario, setComentario] = useState('')

  // e-CF submission state
  const [ecfState,   setEcfState]   = useState('idle')   // 'idle'|'submitting'|'success'|'error'
  const [submitStep, setSubmitStep] = useState(0)
  const [ecfResult,  setEcfResult]  = useState(null)
  const [qrUrl,      setQrUrl]      = useState(null)
  const [ecfError,   setEcfError]   = useState('')

  // ── Business settings (emisor data for ef2.do) ──────────────────────────────
  const [bizSettings, setBizSettings] = useState(null)
  const [ncfSeqs,     setNcfSeqs]     = useState([])

  // ── Client search ───────────────────────────────────────────────────────────
  const [allClients,    setAllClients]    = useState([])
  const [clientQuery,   setClientQuery]   = useState('')
  const [selectedClient, setSelectedClient] = useState(null)
  const [showClientDrop, setShowClientDrop] = useState(false)
  const clientRef = useRef(null)

  useEffect(() => {
    if (!hasIPC()) return
    window.electronAPI.clients.all().then(list => setAllClients(list || [])).catch(() => {})
    window.electronAPI.settings.get().then(s => setBizSettings(s || {})).catch(() => setBizSettings({}))
  }, [])

  useEffect(() => {
    if (!hasIPC()) {
      setEnabledEcfTypes(Object.values(ECF_TYPES).filter(e => e.defaultEnabled))
      return
    }
    window.electronAPI.ncf.sequences()
      .then(rows => {
        setNcfSeqs(rows || [])
        const enabled = (rows || []).filter(r => r.enabled === 1)
        if (enabled.length === 0) {
          setEnabledEcfTypes(Object.values(ECF_TYPES).filter(e => e.defaultEnabled))
        } else {
          setEnabledEcfTypes(
            enabled
              .map(r => ECF_TYPES[r.type])
              .filter(Boolean)
          )
        }
      })
      .catch(() => {
        setEnabledEcfTypes(Object.values(ECF_TYPES).filter(e => e.defaultEnabled))
      })
  }, [])

  // Set ncfType to first enabled type once sequences load
  useEffect(() => {
    if (enabledEcfTypes && enabledEcfTypes.length > 0) {
      setNcfType(prev => {
        // Only update if current type is not in enabled list
        const isCurrentEnabled = enabledEcfTypes.some(e => e.code === prev)
        return isCurrentEnabled ? prev : enabledEcfTypes[0].code
      })
    }
  }, [enabledEcfTypes])

  useEffect(() => {
    const handler = e => { if (clientRef.current && !clientRef.current.contains(e.target)) setShowClientDrop(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const clientResults = clientQuery.trim().length < 1 ? [] : allClients.filter(c => {
    const q = clientQuery.toLowerCase()
    return c.name?.toLowerCase().includes(q) || c.rnc?.toLowerCase().includes(q)
  }).slice(0, 8)

  function selectClient(c) {
    setSelectedClient(c)
    setClientQuery(c.name)
    setShowClientDrop(false)
    // Auto-fill RNC fields if E31
    if (c.rnc) { setRnc(c.rnc); setRncName(c.name) }
    // Auto-switch to A Crédito if client has a credit balance
    if (c.balance > 0 || c.credit_limit > 0) setTipo('credito')
  }

  function clearClient() {
    setSelectedClient(null)
    setClientQuery('')
    setRnc(''); setRncName('')
  }

  const recibidoNum  = parseFloat(recibido.replace(/,/g, '')) || 0
  const devuelta     = recibidoNum - total
  const showEfectivo = tipo === 'contado' && formaPago === 'efectivo'

  const canSubmit =
    (tipo === 'credito' || formaPago !== null) &&
    (tipo !== 'contado' || formaPago !== 'efectivo' || recibidoNum >= total) &&
    (!ECF_TYPES[ncfType]?.requiresRnc || validateRNC(rnc))

  function lookupRnc() {
    if (validateRNC(rnc)) setRncName(rncName || 'Empresa S.R.L.')
  }

  async function handleConfirm() {
    if (!canSubmit) return

    setEcfState('submitting')
    setSubmitStep(0)
    setEcfError('')

    const t1 = setTimeout(() => setSubmitStep(1), 400)
    const t2 = setTimeout(() => setSubmitStep(2), 850)

    try {
      const tipoNum = ncfType.replace('E', '') // 'E31' → '31'
      const seq     = ncfSeqs.find(s => s.type === ncfType)

      // Convert valid_until yyyy-mm-dd → dd-mm-yyyy for ef2.do
      let fechaVencimiento = null
      if (seq?.valid_until && !ECF_TYPES[ncfType]?.noVencimiento) {
        const [y, m, d] = seq.valid_until.split('-')
        fechaVencimiento = `${d}-${m}-${y}`
      }

      const invoiceData = {
        // ef2.do format
        tipoECF: tipoNum,
        emisor: {
          rnc:       bizSettings?.biz_rnc     || '',
          nombre:    bizSettings?.biz_name    || 'Terminal X',
          direccion: bizSettings?.biz_address || 'Santo Domingo',
          email:     bizSettings?.biz_email   || '',
        },
        comprador: ECF_TYPES[ncfType]?.requiresRnc && validateRNC(rnc) ? {
          rnc:       rnc.replace(/[-\s]/g, ''),
          nombre:    rncName || rnc,
          email:     selectedClient?.email   || '',
          direccion: selectedClient?.address || 'Santo Domingo',
        } : null,
        totales: { subtotal, itbis, total },
        items: ticket.services.map(s => ({ nombre: s.name, precio: s.price })),
        fechaVencimiento,
        // Legacy fields (used by stub fallback)
        ncfType, rnc, rncName, tipo,
        formaPago:  tipo === 'credito' ? 'credit' : formaPago,
        ticket:     { id: ticket.id, ticketNo: ticket.ticketNo, vehicle: ticket.vehicle, services: ticket.services },
        comentario,
        paidAt:     new Date(),
      }

      const result = await signAndSubmitECF(invoiceData)
      clearTimeout(t1); clearTimeout(t2)
      setEcfResult(result)
      setEcfState('success')

      // Use qrLink from ef2.do directly; fall back to stub QR generation
      if (result.qrLink) {
        setQrUrl(result.qrLink)
      } else {
        getQRCode(result.eNCF)
          .then(({ qrUrl: url }) => setQrUrl(url))
          .catch(() => { /* QR optional */ })
      }

    } catch (err) {
      clearTimeout(t1); clearTimeout(t2)
      setEcfError(err?.message || 'Error al conectar con ef2.do')
      setEcfState('error')
    }
  }

  function handleSuccessClose() {
    onConfirm({
      ticketId:  ticket.id,
      ticketNo:  ticket.ticketNo,
      clientId:  selectedClient?.id || null,
      ncfType, rnc, rncName, tipo,
      formaPago: tipo === 'credito' ? 'credit' : formaPago,
      recibido:  recibidoNum,
      devuelta:  showEfectivo ? devuelta : null,
      comentario, total,
      paidAt:    new Date(),
      ecf:       ecfResult,
    })
  }

  const isSubmitting = ecfState === 'submitting'
  const STEPS = lang === 'es' ? STEPS_ES : STEPS_EN

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-6"
      onMouseDown={e => { if (e.target === e.currentTarget && !isSubmitting && ecfState !== 'success') onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[660px] flex flex-col max-h-[93vh]">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-800">{tl('title', lang)}</h3>
            </div>
            <p className="text-[12px] text-slate-400 mt-0.5">
              {ticket.ticketNo} &middot; {ticket.vehicle}
            </p>
          </div>
          <button
            onClick={() => { if (!isSubmitting && ecfState !== 'success') onClose() }}
            disabled={isSubmitting}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X size={17} />
          </button>
        </div>

        {/* ── Success view ─────────────────────────────────────────────────── */}
        {ecfState === 'success' && ecfResult ? (
          <SuccessView
            ticket={ticket}
            ecfResult={ecfResult}
            qrUrl={qrUrl}
            total={total}
            ncfType={ncfType}
            onClose={handleSuccessClose}
            lang={lang}
            pdfUrl={ecfResult?.pdfUrl || null}
          />
        ) : (

          <>
            {/* ── Body (payment form) ────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 relative">

              {/* ── Submitting overlay ─────────────────────────────────── */}
              {isSubmitting && (
                <div className="absolute inset-0 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center gap-5 z-10 rounded-b-2xl">
                  <Loader2 size={36} className="text-sky-500 animate-spin" />
                  <div className="text-center space-y-1">
                    <p className="text-[14px] font-bold text-slate-800">
                      {lang === 'es' ? 'Procesando e-CF…' : 'Processing e-CF…'}
                    </p>
                    <p className="text-[12px] text-slate-400">{STEPS[submitStep]}</p>
                  </div>
                  {/* Step dots */}
                  <div className="flex gap-2">
                    {STEPS.map((_, i) => (
                      <span key={i} className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                        i <= submitStep ? 'bg-sky-500' : 'bg-slate-200'
                      }`} />
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 max-w-[240px] text-center">
                    {lang === 'es'
                      ? 'Enviando a DGII vía ef2.do. No cierres esta ventana.'
                      : 'Submitting to DGII via ef2.do. Do not close this window.'}
                  </p>
                </div>
              )}

              {/* Error banner */}
              {ecfState === 'error' && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <AlertTriangle size={15} className="text-red-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-[12px] font-bold text-red-700 mb-0.5">
                      {lang === 'es' ? 'Error al enviar e-CF' : 'e-CF submission error'}
                    </p>
                    <p className="text-[11px] text-red-600">{ecfError}</p>
                    <button
                      onClick={handleConfirm}
                      className="mt-2 text-[11px] font-bold text-red-700 underline"
                    >
                      {lang === 'es' ? 'Reintentar' : 'Retry'}
                    </button>
                  </div>
                </div>
              )}

              {/* Order summary */}
              <div className="bg-slate-50 rounded-xl p-4">
                <SectionLabel>{tl('summary', lang)}</SectionLabel>
                <div className="space-y-1.5 mb-3">
                  {ticket.services.map((svc, i) => (
                    <div key={i} className="flex justify-between">
                      <span className="text-[13px] text-slate-700">{svc.name}</span>
                      <span className="text-[13px] text-slate-600 font-medium tabular-nums">{fmtRD(svc.price)}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-slate-200 pt-3 space-y-1.5">
                  <div className="flex justify-between text-[12px] text-slate-500">
                    <span>{tl('subtotal', lang)}</span>
                    <span className="tabular-nums">{fmtRD(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-[12px] text-slate-500">
                    <span>{tl('itbis', lang)}</span>
                    <span className="tabular-nums">{fmtRD(itbis)}</span>
                  </div>
                  <div className="flex justify-between text-[12px] text-slate-500">
                    <span>{tl('ley', lang)}</span>
                    <span className="tabular-nums">{fmtRD(ley)}</span>
                  </div>
                  <div className="flex justify-between text-[15px] font-bold text-slate-800 border-t border-slate-200 pt-2 mt-1">
                    <span>{tl('total', lang)}</span>
                    <span className="tabular-nums">{fmtRD(total)}</span>
                  </div>
                </div>
              </div>

              {/* ── Two-column: Comprobante (left) | Tipo + Cliente (right) ── */}
              <div className="grid grid-cols-2 gap-5 items-start">

                {/* LEFT — Comprobante Electrónico */}
                <div>
                  <SectionLabel>{tl('comp', lang)}</SectionLabel>
                  {enabledEcfTypes === null ? (
                    <div className="flex items-center gap-2 h-10">
                      <Loader2 size={13} className="animate-spin text-slate-400" />
                      <span className="text-[12px] text-slate-400">
                        {lang === 'es' ? 'Cargando…' : 'Loading…'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {enabledEcfTypes.map(ecf => (
                        <ToggleBtn key={ecf.code} active={ncfType === ecf.code} onClick={() => setNcfType(ecf.code)}>
                          {ecf.code}
                          <span className="block text-[10px] font-normal opacity-60 mt-0.5">
                            {lang === 'es' ? ecf.sub_es : ecf.sub_en}
                          </span>
                        </ToggleBtn>
                      ))}
                    </div>
                  )}

                  {/* RNC fields — only when selected type requires RNC */}
                  {ECF_TYPES[ncfType]?.requiresRnc && (
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={rnc}
                          onChange={e => { setRnc(e.target.value); setRncName('') }}
                          onKeyDown={e => e.key === 'Enter' && lookupRnc()}
                          placeholder={tl('rnc', lang)}
                          maxLength={11}
                          className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:border-sky-400 placeholder:text-slate-400"
                        />
                        <button
                          onClick={lookupRnc}
                          className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-sky-50 hover:text-sky-600 text-slate-500 rounded-lg transition-colors shrink-0"
                        >
                          <Search size={13} />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={rncName}
                        onChange={e => setRncName(e.target.value)}
                        placeholder={tl('nombre', lang)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:border-sky-400 placeholder:text-slate-400"
                      />
                    </div>
                  )}
                </div>

                {/* RIGHT — Tipo de Factura + Cliente */}
                <div className="flex flex-col gap-3">
                  {/* Tipo */}
                  <div>
                    <SectionLabel>{tl('tipo', lang)}</SectionLabel>
                    <div className="flex gap-2">
                      <ToggleBtn active={tipo === 'contado'} onClick={() => setTipo('contado')}>
                        {tl('contado', lang)}
                      </ToggleBtn>
                      <ToggleBtn active={tipo === 'credito'} onClick={() => setTipo('credito')}>
                        {tl('credito', lang)}
                      </ToggleBtn>
                    </div>
                  </div>

                  {/* Client search */}
                  <div ref={clientRef} className="relative">
                    <SectionLabel>{lang === 'es' ? 'Cliente' : 'Client'}</SectionLabel>
                    <div className="relative">
                      <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      <input
                        type="text"
                        value={clientQuery}
                        onChange={e => { setClientQuery(e.target.value); setShowClientDrop(true); if (!e.target.value) clearClient() }}
                        onFocus={() => { if (clientQuery) setShowClientDrop(true) }}
                        placeholder={lang === 'es' ? 'Buscar por nombre o RNC…' : 'Search by name or RNC…'}
                        className="w-full pl-8 pr-7 py-2 border border-slate-200 rounded-xl text-[12px] bg-white focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/20 placeholder:text-slate-300"
                      />
                      {selectedClient && (
                        <button
                          onClick={clearClient}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>

                    {/* Dropdown results */}
                    {showClientDrop && clientResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-20 overflow-hidden">
                        {clientResults.map(c => (
                          <button
                            key={c.id}
                            onMouseDown={() => selectClient(c)}
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left"
                          >
                            <div className="w-6 h-6 rounded-full bg-[#f0f6ff] text-[#0C447C] flex items-center justify-center text-[10px] font-black shrink-0">
                              {c.name[0]?.toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-semibold text-slate-800 truncate">{c.name}</p>
                              {c.rnc && <p className="text-[10px] text-slate-400">{c.rnc}</p>}
                            </div>
                            {(c.balance > 0 || c.credit_limit > 0) && (
                              <span className="text-[9px] font-bold bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full shrink-0">
                                {lang === 'es' ? 'Crédito' : 'Credit'}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Client info bar or Al Portador */}
                    {selectedClient ? (
                      <ClientInfoBar client={selectedClient} ticketTotal={total} lang={lang} />
                    ) : (
                      <p className="mt-2 text-[11px] text-slate-400 italic px-1">
                        {lang === 'es' ? 'Al Portador' : 'Walk-in Client'}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Forma de pago */}
              {tipo === 'credito' ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <p className="text-[12px] text-amber-700 font-medium">{tl('creditNote', lang)}</p>
                </div>
              ) : (
                <div>
                  <SectionLabel>{tl('formaPago', lang)}</SectionLabel>
                  <div className="grid grid-cols-4 gap-2">
                    {PAYMENT_METHODS.map(({ id, icon: Icon, es, en }) => (
                      <button
                        key={id}
                        onClick={() => setFormaPago(id)}
                        className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-[12px] font-semibold transition-all ${
                          formaPago === id
                            ? 'bg-sky-500 border-sky-500 text-white shadow-md shadow-sky-500/20'
                            : 'border-slate-200 text-slate-600 hover:border-sky-300 hover:bg-sky-50/50'
                        }`}
                      >
                        <Icon size={18} strokeWidth={1.75} />
                        {lang === 'es' ? es : en}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Efectivo extras */}
              {showEfectivo && (
                <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                  <div>
                    <SectionLabel>{lang === 'es' ? 'Monto rápido' : 'Quick amount'}</SectionLabel>
                    <div className="flex gap-2 flex-wrap">
                      {QUICK.map(amt => (
                        <button
                          key={amt}
                          onClick={() => setRecibido(String(amt))}
                          className={`px-3 py-1.5 rounded-lg border text-[12px] font-semibold transition-all ${
                            recibidoNum === amt
                              ? 'bg-slate-800 border-slate-800 text-white'
                              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-400'
                          }`}
                        >
                          {fmtRD(amt)}
                        </button>
                      ))}
                      <button
                        onClick={() => setRecibido(total.toFixed(2))}
                        className={`px-3 py-1.5 rounded-lg border text-[12px] font-semibold transition-all ${
                          Math.abs(recibidoNum - total) < 0.01
                            ? 'bg-sky-500 border-sky-500 text-white'
                            : 'bg-white border-sky-200 text-sky-600 hover:border-sky-400'
                        }`}
                      >
                        {tl('exacto', lang)} · {fmtRD(total)}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                        {tl('recibido', lang)}
                      </label>
                      <div className="flex items-center bg-white border border-slate-200 rounded-xl px-3 py-2.5 focus-within:border-sky-400 focus-within:ring-1 focus-within:ring-sky-400/30">
                        <span className="text-slate-400 text-[12px] mr-2">RD$</span>
                        <input
                          type="number"
                          value={recibido}
                          onChange={e => setRecibido(e.target.value)}
                          min={0}
                          step="0.01"
                          className="flex-1 text-[14px] font-semibold text-slate-800 focus:outline-none bg-transparent"
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                        {devuelta < 0 ? tl('falta', lang) : tl('devuelta', lang)}
                      </label>
                      <div className={`px-3 py-2.5 rounded-xl border text-[14px] font-bold tabular-nums ${
                        recibido === ''
                          ? 'bg-slate-50 border-slate-200 text-slate-400'
                          : devuelta < 0
                            ? 'bg-red-50 border-red-200 text-red-600'
                            : 'bg-green-50 border-green-200 text-green-600'
                      }`}>
                        {recibido === '' ? '—' : `RD$ ${Math.abs(devuelta).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </div>
                    </div>
                  </div>

                  {recibidoNum > 0 && devuelta < 0 && (
                    <p className="text-[11px] text-red-500 font-medium">
                      {tl('enterAmount', lang)} — {lang === 'es' ? 'monto insuficiente' : 'insufficient amount'}
                    </p>
                  )}
                </div>
              )}

              {/* Comentario */}
              <div>
                <SectionLabel>{tl('comment', lang)}</SectionLabel>
                <textarea
                  value={comentario}
                  onChange={e => setComentario(e.target.value)}
                  rows={2}
                  placeholder={lang === 'es' ? 'Notas opcionales sobre este pago…' : 'Optional notes about this payment…'}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-[13px] text-slate-700 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30 resize-none placeholder:text-slate-400"
                />
              </div>
            </div>

            {/* ── Footer ────────────────────────────────────────────────── */}
            <div className="flex gap-3 px-6 py-4 border-t border-slate-100 shrink-0">
              <button
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 py-3 border border-slate-200 text-slate-600 rounded-xl text-[13px] font-semibold hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {tl('cancel', lang)}
              </button>
              <button
                onClick={handleConfirm}
                disabled={!canSubmit || isSubmitting}
                className="flex-[2] py-3 bg-green-500 hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-[13px] font-bold transition-all active:scale-[0.98] shadow-md shadow-green-500/20"
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    {lang === 'es' ? 'Procesando…' : 'Processing…'}
                  </span>
                ) : (
                  `${tl('charge', lang)} · ${fmtRD(total)}`
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
