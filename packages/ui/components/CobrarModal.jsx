import { useState, useEffect, useRef, useMemo } from 'react'
import { X, Search, Banknote, CreditCard, ArrowRightLeft, Landmark, CheckCircle2, AlertTriangle, Loader2, QrCode, User, MessageSquare } from 'lucide-react'
import { useLang } from '../i18n'
import { useAPI } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import ManagerAuthGate from './ManagerAuthGate'
import { needsGate, isBigDiscount } from '@terminal-x/services/managerGateRules'
import { signAndSubmitECF, getQRCode, ECF_TYPES, validateRNC } from '@terminal-x/services/ecf'
const buildReceiptPDFBase64 = (...args) => import('@terminal-x/services/pdf').then(m => m.buildReceiptPDFBase64(...args))
import { useRNC } from '../hooks/useRNC'
import { usePlan } from '../hooks/usePlan'
import { useBusinessType } from '../hooks/useBusinessType.jsx'
import { Gift } from 'lucide-react'

// Salon cross-sell heuristic — if the cart contains a haircut or color service
// the stylist is taught to upsell a matching retail product (shampoo after a
// color treatment, pomade after a cut, etc.). Keywords are case-insensitive.
const SALON_UPSELL_TRIGGERS = [
  { match: /\b(tinte|color|coloraci[oó]n|highlights?|mecha|balayage)\b/i,
    es: 'Recomienda shampoo protector de color.',
    en: 'Recommend a color-safe shampoo.' },
  { match: /\b(alisado|queratina|keratina|keratin|brazilian)\b/i,
    es: 'Recomienda mascarilla nutritiva.',
    en: 'Recommend a nourishing mask.' },
  { match: /\b(corte|haircut|trim|barba|barber|shave|afeitado)\b/i,
    es: 'Recomienda pomada o cera para el cabello.',
    en: 'Recommend pomade or styling wax.' },
  { match: /\b(manicure|pedicure|u[ñn]as|nail)\b/i,
    es: 'Recomienda aceite de cutícula o top coat.',
    en: 'Recommend cuticle oil or top coat.' },
]
function salonUpsellSuggestion(ticket, lang) {
  const joined = (ticket?.services || []).map(s => s?.name || '').join(' ')
  for (const t of SALON_UPSELL_TRIGGERS) if (t.match.test(joined)) return lang === 'es' ? t.es : t.en
  return null
}
// 1 loyalty point per RD$100 spent, rounded down — simple, salon-standard.
function loyaltyPointsFor(amount) { return Math.max(0, Math.floor(Number(amount || 0) / 100)) }

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtRD(n) {
  return `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Legacy fallback rate — the actual rate is pulled from app_settings.itbis_pct
// on mount and threaded through state. 0.18 remains the sensible default for
// DR while settings load (defaultItbisRate = 18).
const DEFAULT_ITBIS_RATE = 18
const LEY_RATE = 0.10

const PAYMENT_METHODS = [
  { id: 'efectivo',      icon: Banknote,       es: 'Efectivo',      en: 'Cash'     },
  { id: 'tarjeta',       icon: CreditCard,     es: 'Tarjeta',       en: 'Card'     },
  { id: 'transferencia', icon: ArrowRightLeft, es: 'Transferencia', en: 'Transfer' },
  { id: 'cheque',        icon: Landmark,       es: 'Cheque',        en: 'Check'    },
]

const QUICK = [200, 500, 1000, 2000]

// B01/B02 legacy types (pre-May 2026 NCF system)
const LEGACY_TYPES = [
  { code: 'SIN', sub_es: 'Sin Comprobante', sub_en: 'No Receipt',     requiresRnc: false },
  { code: 'B02', sub_es: 'Consumidor Final', sub_en: 'Final Consumer', requiresRnc: false },
  { code: 'B01', sub_es: 'Crédito Fiscal',   sub_en: 'Tax Credit',     requiresRnc: true  },
]

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
  // `itbis` label rendered inline with dynamic rate — see below.
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeWaPhone(raw = '') {
  const digits = raw.replace(/\D/g, '')
  // DR / US: 10-digit numbers starting with 8 or 9 → prepend country code 1
  if (digits.length === 10 && (digits[0] === '8' || digits[0] === '9')) return '1' + digits
  if (digits.length === 11 && digits[0] === '1') return digits
  return digits // return as-is for other formats
}

function buildReceiptMsg({ bizName, ticket, services, total, ncf, lang }) {
  const date = new Date().toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const lines = [
    `*${bizName}*`,
    lang === 'es' ? `Recibo de Pago` : `Payment Receipt`,
    ``,
    `Ticket: #${ticket.ticketNo}`,
    lang === 'es' ? `Fecha: ${date}` : `Date: ${date}`,
    ncf ? `NCF: ${ncf}` : '',
    ``,
    lang === 'es' ? `Servicios:` : `Services:`,
    ...services.map(s => `• ${(s.qty || 1) > 1 ? s.qty + 'x ' : ''}${s.name} - RD$ ${(s.price * (s.qty || 1)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`),
    ``,
    `*Total: RD$ ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}*`,
    ``,
    lang === 'es' ? `Gracias por su preferencia.` : `Thank you for your business.`,
  ].filter(l => l !== undefined)
  return lines.join('\n')
}

// ── Submission steps shown during loading ─────────────────────────────────────
const STEPS_ES = ['Generando XML…', 'Firmando digitalmente…', 'Enviando a DGII…']
const STEPS_EN = ['Generating XML…', 'Signing digitally…',    'Sending to DGII…']

// ── Small components ──────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-2">{children}</p>
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
    <div className="mt-2 border border-slate-200 dark:border-white/10 rounded-xl p-3 bg-white dark:bg-white/5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[13px] font-bold text-slate-800 dark:text-white truncate">{client.name}</p>
        {client.rnc && <p className="text-[10px] text-slate-400 dark:text-white/40 shrink-0">{client.rnc}</p>}
      </div>

      {limit > 0 ? (
        <>
          <div className="grid grid-cols-3 gap-1 text-center mb-2.5">
            <div>
              <p className="text-[9px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-0.5">
                {lang === 'es' ? 'Adeudado' : 'Owed'}
              </p>
              <p className="text-[12px] font-bold text-red-500">
                RD$ {balance.toLocaleString('en-US', { minimumFractionDigits: 0 })}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-0.5">
                {lang === 'es' ? 'Límite' : 'Limit'}
              </p>
              <p className="text-[12px] font-semibold text-slate-600 dark:text-white/60">
                RD$ {limit.toLocaleString('en-US', { minimumFractionDigits: 0 })}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-0.5">
                {lang === 'es' ? 'Disponible' : 'Available'}
              </p>
              <p className="text-[12px] font-bold text-green-600">
                RD$ {available.toLocaleString('en-US', { minimumFractionDigits: 0 })}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden mb-1.5">
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
        <p className="text-[11px] text-slate-400 dark:text-white/40">
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
      className={`flex-1 py-3 md:py-2.5 px-3 rounded-xl border text-[13px] font-semibold transition-all text-center min-h-[48px] md:min-h-0 ${
        active
          ? 'bg-slate-800 dark:bg-white/10 border-slate-800 dark:border-white/20 text-white'
          : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  )
}

// ── Success / receipt view ────────────────────────────────────────────────────
function SuccessView({ ticket, ecfResult, qrUrl, total, ncfType, onClose, lang, pdfUrl, client, bizName, subtotal, itbis, ley, formaPago, bizSettings }) {
  const api = useAPI()
  const { hasFeature } = usePlan()
  const canWhatsApp = hasFeature('whatsapp_receipts')
  const isLegacy = ecfResult?._legacy
  const isSin    = isLegacy && !ecfResult?.eNCF
  const ecfType  = ECF_TYPES[ncfType]
  const legacyType = LEGACY_TYPES.find(t => t.code === ncfType)
  const fmtISO   = s => new Date(s).toLocaleString('es-DO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  const [waState, setWaState] = useState('idle') // idle | sending | sent | error
  const [waPhone, setWaPhone] = useState(client?.phone || '')
  const [showWaInput, setShowWaInput] = useState(false)

  async function sendWhatsApp() {
    const phone = waPhone.trim()
    if (!phone) { setShowWaInput(true); return }
    const to = normalizeWaPhone(phone)
    setWaState('sending')
    try {
      const bName = bizSettings?.biz_name || bizName || 'Terminal X'
      const bRnc  = bizSettings?.biz_rnc  || ''
      const ncf   = ecfResult?.eNCF || null
      const svcs  = ticket?.services || []
      const docNo = ticket?.ticketNo || ticket?.docNumber || ''

      // Build formatted text receipt
      const lines = [
        `*${bName}*`,
        bRnc ? `RNC: ${bRnc}` : '',
        ``,
        `📋 ${lang === 'es' ? 'Recibo de Pago' : 'Payment Receipt'}`,
        `Ticket: #${docNo}`,
        `${lang === 'es' ? 'Fecha' : 'Date'}: ${new Date().toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' })}`,
        ncf ? `NCF: ${ncf}` : '',
        client?.name ? `${lang === 'es' ? 'Cliente' : 'Client'}: ${client.name}` : '',
        ``,
        `${lang === 'es' ? 'Servicios' : 'Services'}:`,
        ...svcs.map(s => `• ${s.name} — RD$ ${Number(s.price).toLocaleString('en-US', { minimumFractionDigits: 2 })}`),
        ``,
        subtotal ? `Subtotal: RD$ ${Number(subtotal).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '',
        itbis ? `ITBIS ${bizSettings?.itbis_pct || 18}%: RD$ ${Number(itbis).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '',
        ley ? `Ley 10%: RD$ ${Number(ley).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '',
        `*Total: RD$ ${Number(total).toLocaleString('en-US', { minimumFractionDigits: 2 })}*`,
        ``,
        `${lang === 'es' ? 'Forma de pago' : 'Payment'}: ${formaPago || 'Efectivo'}`,
        ncf?.startsWith('E') ? `🔗 https://ecf.dgii.gov.do/consultatimbre?eNCF=${encodeURIComponent(ncf)}` : '',
        ``,
        `${lang === 'es' ? 'Gracias por su preferencia.' : 'Thank you for your business.'}`,
        `_Powered by Terminal X_`,
      ].filter(l => l !== '').join('\n')

      // Try PDF first, fall back to text
      try {
        const pdfData = {
          ncf: ncf || '', ncfType: ncfType || 'E32', cajero: '', docNo,
          paidAt: new Date(), client: client || null, services: svcs,
          subtotal: subtotal || 0, itbis: itbis || 0, ley: ley || 0,
          descuento: 0, total: total || 0, formaPago: formaPago || 'Efectivo',
          biz: { name: bName, address: bizSettings?.biz_address || '', phone: bizSettings?.biz_phone || '', rnc: bRnc, settings: { ciudad: bizSettings?.ciudad || bizSettings?.biz_city || '' } },
          signatureDate: ecfResult?.signatureDate || null,
          securityCode:  ecfResult?.securityCode || null,
          qrLink:        ecfResult?.qrLink || null,
        }
        const { base64, filename } = await buildReceiptPDFBase64(pdfData)
        await api.whatsapp.sendDocument({ to, base64, filename, caption: `${bName} - Recibo #${docNo}` })
      } catch {
        // PDF failed (free plan) — send text instead
        await api.whatsapp.send({ to, body: lines })
      }
      setWaState('sent')
    } catch (err) {
      setWaState('error')
      const msg = err?.message || err?.error || (lang === 'es' ? 'Error al enviar WhatsApp' : 'WhatsApp send failed')
      try { alert(msg) } catch {}
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-4 md:px-8 md:py-6 gap-4 md:gap-5 overflow-y-auto">
      {/* Green check */}
      <div className="w-14 h-14 bg-green-50 dark:bg-green-500/10 border-2 border-green-200 dark:border-green-500/30 rounded-full flex items-center justify-center">
        <CheckCircle2 size={28} className="text-green-500" />
      </div>

      {/* Main info */}
      <div className="text-center">
        <p className="text-[13px] font-semibold text-slate-500 dark:text-white/60 mb-1">
          {isSin
            ? (lang === 'es' ? 'Cobrado — sin comprobante' : 'Charged — no receipt')
            : isLegacy
              ? (lang === 'es' ? 'Cobrado — NCF local' : 'Charged — local NCF')
              : (lang === 'es' ? 'e-CF enviado a DGII' : 'e-CF submitted to DGII')}
        </p>
        {isSin ? (
          <p className="text-[22px] font-bold text-slate-400 dark:text-white/40 italic">
            {lang === 'es' ? 'Sin Comprobante' : 'No Receipt'}
          </p>
        ) : (
          <p className="text-[26px] font-bold text-slate-800 dark:text-white font-mono tracking-wide">{ecfResult?.eNCF}</p>
        )}
        <div className="flex items-center justify-center gap-2 mt-2">
          <span className="text-[11px] font-bold bg-green-50 text-green-700 border border-green-200 rounded-full px-3 py-0.5">
            {isSin ? (lang === 'es' ? 'COBRADO' : 'CHARGED') : (ecfResult?.status ?? 'OK')}
          </span>
          {!isSin && (
            <span className="text-[11px] text-slate-400 dark:text-white/40">
              {legacyType ? (lang === 'es' ? legacyType.sub_es : legacyType.sub_en)
                           : (ecfType?.name_es ?? ncfType)}
            </span>
          )}
        </div>
      </div>

      {/* Details grid */}
      <div className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-4 grid grid-cols-2 gap-y-2.5 gap-x-4 text-[12px]">
        <div>
          <p className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Ticket' : 'Ticket'}</p>
          <p className="font-bold text-sky-600">{ticket.ticketNo}</p>
        </div>
        <div>
          <p className="text-slate-400 dark:text-white/40">Total</p>
          <p className="font-bold text-slate-800 dark:text-white">{fmtRD(total)}</p>
        </div>
        {!isSin && ecfResult?.submittedAt && (
          <div>
            <p className="text-slate-400 dark:text-white/40">{lang === 'es' ? 'Registrado' : 'Recorded'}</p>
            <p className="font-semibold text-slate-700 dark:text-white">{fmtISO(ecfResult.submittedAt)}</p>
          </div>
        )}
        {!isSin && ecfResult?.trackId && (
          <div>
            <p className="text-slate-400 dark:text-white/40">{isLegacy ? (lang === 'es' ? 'Ref. Local' : 'Local Ref.') : (lang === 'es' ? 'Ref. DGII' : 'DGII Ref.')}</p>
            <p className="font-mono text-[11px] text-slate-600 dark:text-white/60">{ecfResult.trackId}</p>
          </div>
        )}
      </div>

      {/* QR code — only for e-CF */}
      {!isLegacy && (
        <div className="flex flex-col items-center gap-2">
          {qrUrl ? (
            <img
              src={qrUrl}
              alt="QR verificación DGII"
              width={128}
              height={128}
              className="rounded-xl border border-slate-200 dark:border-white/10 shadow-sm"
              style={{
                // Win11 high-DPI shrinks the QR below scanner resolution. Bump
                // it 1.2x only when both conditions match so non-Windows /
                // low-DPI displays render at their native crisp size.
                transform: (typeof window !== 'undefined'
                  && window.devicePixelRatio > 1.25
                  && typeof navigator !== 'undefined'
                  && navigator.userAgent.includes('Windows NT 10'))
                  ? 'scale(1.2)'
                  : 'scale(1)',
                transformOrigin: 'center center',
              }}
            />
          ) : (
            <div className="w-32 h-32 bg-slate-100 dark:bg-white/10 rounded-xl flex items-center justify-center">
              <QrCode size={32} className="text-slate-300 dark:text-white/40 animate-pulse" />
            </div>
          )}
          <p className="text-[10px] text-slate-400 dark:text-white/40 text-center">
            {lang === 'es' ? 'Escanea para verificar en DGII' : 'Scan to verify on DGII portal'}
          </p>
        </div>
      )}

      {/* WhatsApp phone input — shown when no client phone or user clicks WA button (Pro MAX only) */}
      {canWhatsApp && (showWaInput || (!client?.phone && waState === 'idle')) && waState !== 'sent' && (
        <div className="flex gap-2 w-full">
          <input
            type="tel"
            inputMode="numeric"
            value={waPhone}
            onChange={e => setWaPhone(e.target.value)}
            placeholder={lang === 'es' ? 'Numero WhatsApp (ej. 8091234567)' : 'WhatsApp number (e.g. 8091234567)'}
            className="flex-1 px-3 py-2 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-[#25D366] placeholder:text-slate-400 dark:placeholder:text-white/40"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 w-full flex-wrap">
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
        {canWhatsApp && (
        <button
          onClick={() => { if (waPhone.trim()) sendWhatsApp(); else setShowWaInput(true) }}
          disabled={waState === 'sending' || waState === 'sent'}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold border transition-colors disabled:opacity-60 ${
            waState === 'sent'
              ? 'bg-green-50 border-green-200 text-green-700'
              : waState === 'error'
              ? 'bg-red-50 border-red-200 text-red-600'
              : 'border-[#25D366]/40 text-[#25D366] hover:bg-[#25D366]/10'
          }`}
        >
          {waState === 'sending' ? <Loader2 size={13} className="animate-spin" />
           : waState === 'sent'  ? <CheckCircle2 size={13} />
           : <MessageSquare size={13} />}
          {waState === 'sent'
            ? (lang === 'es' ? 'Enviado' : 'Sent')
            : waState === 'error'
            ? (lang === 'es' ? 'Error WA' : 'WA Error')
            : 'WhatsApp'}
        </button>
        )}
        <button
          onClick={onClose}
          className="flex-[2] py-2.5 bg-slate-800 dark:bg-white/10 hover:bg-slate-700 dark:hover:bg-white/20 text-white rounded-xl text-[13px] font-bold transition-colors"
        >
          {lang === 'es' ? 'Cerrar' : 'Close'}
        </button>
      </div>
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export default function CobrarModal({ ticket, onConfirm, onClose }) {
  const api = useAPI()
  const { lang } = useLang()
  const { businessType } = useBusinessType()
  const isSalon = businessType === 'salon'
  const upsellTip = useMemo(() => isSalon ? salonUpsellSuggestion(ticket, lang) : null, [isSalon, ticket, lang])

  // Fire-and-forget loyalty accrual — gated to salon vertical. Runs AFTER the
  // confirm callback fires so it never blocks the success view. Silently swallows
  // errors (salon loyalty is additive, not transactional).
  async function awardLoyaltyPoints(clientId, totalAmount) {
    if (!isSalon || !clientId || !totalAmount) return
    const pts = loyaltyPointsFor(totalAmount)
    if (pts <= 0) return
    try { await api?.clients?.addLoyaltyPoints?.({ id: clientId, delta: pts }) } catch {}
  }

  // ITBIS rate — loaded from app_settings.itbis_pct on mount (see useEffect
  // below). Stays a numeric percentage (e.g. 18). Totals are memoised against
  // both ticket services and the live rate so display refreshes on settings
  // change without a manual reload.
  const [itbisRate, setItbisRate] = useState(DEFAULT_ITBIS_RATE)
  const itbisFactor = Number(itbisRate) / 100
  const [descuentoInput, setDescuentoInput] = useState('')

  // Totals — prices already include ITBIS, extract it for display.
  // Descuento = RD$ flat amount subtracted from gross; proportionally
  // reduces subtotal + itbis so e-CF totals stay internally consistent.
  const totalGross = ticket.services.reduce((s, svc) => s + svc.price * (svc.qty || 1), 0)
  const descuento = Math.min(Math.max(0, parseFloat(descuentoInput) || 0), totalGross)
  const total    = parseFloat((totalGross - descuento).toFixed(2))
  const subtotal = parseFloat((total / (1 + itbisFactor)).toFixed(2))
  const itbis    = parseFloat((total - subtotal).toFixed(2))
  const ley      = 0

  // Fiscal mode — derived from bizSettings once loaded
  // Enabled e-CF types (loaded from NCF sequences)
  const [enabledEcfTypes, setEnabledEcfTypes] = useState(null) // null = loading, [] after load

  const { lookup: rncLookup } = useRNC()

  // Form state
  const [ncfType,    setNcfType]    = useState('B02') // updated once bizSettings loads
  const [rnc,        setRnc]        = useState('')
  const [rncName,    setRncName]    = useState('')
  const [tipo,       setTipo]       = useState('contado')
  const [formaPago,  setFormaPago]  = useState(null)
  const [recibido,   setRecibido]   = useState('')
  const [comentario, setComentario] = useState('')
  const [descuentoReason, setDescuentoReason] = useState('')
  const [descuentoError,  setDescuentoError]  = useState('')
  // v2.6 — Manager Authorization Gate (big-discount path).
  const { user: currentUser } = useAuth()
  const [gateOpen, setGateOpen] = useState(false)
  // e-CF referencia fields (E33/E34 — credit/debit notes)
  const [refNCF,    setRefNCF]    = useState('')  // NCFModificado — original e-CF being modified
  const [refRazon,  setRefRazon]  = useState('')  // RazonModificacion — reason
  const [refFecha,  setRefFecha]  = useState('')  // FechaNCFModificado — original date
  const [refCodigo, setRefCodigo] = useState('3') // CodigoModificacion — default '3' (error adjustment)

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
  const [selectedClient, setSelectedClient] = useState(ticket?.client || null)
  const [showClientDrop, setShowClientDrop] = useState(false)
  const clientRef = useRef(null)
  const confirmedRef = useRef(false)
  // v2.6 — latches approval for the current attempt so re-entry skips the gate.
  const _gateApprovedRef = useRef(false)

  // ── Carwash memberships / combos ─────────────────────────────────────────
  // When a client is selected, check if they have an active monthly membership
  // with remaining quota this period, or a wash-combo punch-card with washes
  // left. The cashier can tap "Usar membresía" to consume one — this records
  // the usage. Billing adjustment (zero-out, discount, etc.) stays a manual
  // owner decision so we don't silently break e-CF totals.
  const [activeMembership, setActiveMembership] = useState(null)
  const [activeCombo,      setActiveCombo]      = useState(null)
  const [consumingBenefit, setConsumingBenefit] = useState(false)
  const [benefitUsed,      setBenefitUsed]      = useState(null)

  useEffect(() => {
    const cid = selectedClient?.id
    if (!cid) { setActiveMembership(null); setActiveCombo(null); return }
    let cancelled = false
    // Resolve the client's supabase_id for web (activeForClient on web expects UUID).
    const cUuid = selectedClient?.supabase_id || null
    const lookupArg = (typeof window !== 'undefined' && window.electronAPI) ? cid : (cUuid || cid)
    ;(async () => {
      try {
        const [mems, combos] = await Promise.all([
          api?.memberships?.activeForClient?.(lookupArg) ?? [],
          api?.washCombos?.activeForClient?.(lookupArg)   ?? [],
        ])
        if (cancelled) return
        const mem = (mems || []).find(m => (m.washes_used_this_period || 0) < (m.wash_quota_per_month || 0))
        setActiveMembership(mem || null)
        const cb = (combos || []).find(c => (c.used_washes || 0) < (c.total_washes || 0))
        setActiveCombo(cb || null)
      } catch {
        if (!cancelled) { setActiveMembership(null); setActiveCombo(null) }
      }
    })()
    return () => { cancelled = true }
  }, [selectedClient?.id])

  async function consumeMembership() {
    if (!activeMembership || consumingBenefit) return
    setConsumingBenefit(true)
    try {
      const r = await api?.memberships?.consume?.(activeMembership.id)
      if (r?.ok) {
        setBenefitUsed({ kind: 'membership', remaining: r.remaining })
        setActiveMembership(m => m ? { ...m, washes_used_this_period: (m.washes_used_this_period || 0) + 1 } : m)
      }
    } finally { setConsumingBenefit(false) }
  }
  async function consumeCombo() {
    if (!activeCombo || consumingBenefit) return
    setConsumingBenefit(true)
    try {
      const r = await api?.washCombos?.consume?.(activeCombo.id)
      if (r?.ok) {
        setBenefitUsed({ kind: 'combo', remaining: r.remaining })
        setActiveCombo(c => c ? { ...c, used_washes: (c.used_washes || 0) + 1 } : c)
      }
    } finally { setConsumingBenefit(false) }
  }

  useEffect(() => {
    api?.clients?.all?.().then(list => setAllClients(list || [])).catch(() => setAllClients([]))
    api.settings.get().then(s => {
      const cfg = s || {}
      setBizSettings(cfg)
      // Pick up the business's ITBIS rate (string in app_settings).
      const pct = Number(cfg.itbis_pct)
      if (Number.isFinite(pct) && pct >= 0) setItbisRate(pct)
      // Set sensible ncfType default based on fiscal mode
      const mode = cfg.fiscal_mode || 'ecf'
      setNcfType(mode === 'legacy' ? 'B02' : 'E32')
    }).catch(() => setBizSettings({}))
  }, [])

  useEffect(() => {
    api?.ncf?.sequences?.()
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

  const clientResults = useMemo(() => {
    if (clientQuery.trim().length < 1) return []
    const q = clientQuery.toLowerCase()
    return allClients.filter(c =>
      c.name?.toLowerCase().includes(q) || c.rnc?.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [clientQuery, allClients])

  function selectClient(c) {
    setSelectedClient(c)
    setClientQuery(c.name)
    setShowClientDrop(false)
    // Auto-fill RNC fields if E31
    if (c.rnc) { setRnc(c.rnc); setRncName(c.name) }
  }

  function clearClient() {
    setSelectedClient(null)
    setClientQuery('')
    setRnc(''); setRncName('')
  }

  const isLegacy     = (bizSettings?.fiscal_mode || 'ecf') === 'legacy'
  const currentType  = isLegacy
    ? LEGACY_TYPES.find(t => t.code === ncfType)
    : ECF_TYPES[ncfType]

  const recibidoNum  = parseFloat(recibido.replace(/,/g, '')) || 0
  const devuelta     = recibidoNum - total
  const showEfectivo = tipo === 'contado' && formaPago === 'efectivo'

  const canSubmit =
    (tipo === 'credito' || formaPago !== null) &&
    (tipo !== 'contado' || formaPago !== 'efectivo' || recibidoNum >= total) &&
    (!currentType?.requiresRnc || validateRNC(rnc)) &&
    (!currentType?.requiresReferencia || (refNCF.trim().length >= 11 && refRazon.trim().length > 0))

  async function lookupRnc() {
    const clean = rnc.replace(/[-\s]/g, '')
    if (clean.length < 9) { setRncName('Min 9 digitos'); return }
    setRncName('Buscando...')
    try {
      const res = await rncLookup(clean)
      if (res?.nombre) setRncName(res.nombre)
      else if (res?.name) setRncName(res.name)
      else setRncName('No encontrado')
    } catch {
      setRncName('No encontrado')
    }
  }

  async function handleConfirm() {
    if (!canSubmit) return
    if (confirmedRef.current) return
    if (ecfState === 'submitting' || ecfState === 'success') return
    // v2.3.21 — require a reason when descuento > 0. Keeps manual overrides
    // auditable (reason lands in notes + activity_log metadata).
    if (descuento > 0 && !descuentoReason.trim()) {
      setDescuentoError(lang === 'es' ? 'Razón del descuento obligatoria' : 'Discount reason required')
      return
    }
    // v2.6 — Manager Authorization Gate for "big" discounts. Opens the modal;
    // the gate's onApprove re-enters handleConfirm via the _gateApproved ref.
    if (!_gateApprovedRef.current && descuento > 0 &&
        isBigDiscount({ descuento, subtotal: totalGross, userDiscountPct: currentUser?.discount_pct || 0 }) &&
        needsGate(currentUser, 'discount_big', bizSettings)) {
      setGateOpen(true)
      return
    }

    // ── Legacy B01/B02 mode: use DB sequence, skip ECF ──────────────────────
    if (isLegacy) {
      const isSin = ncfType === 'SIN'
      let eNCF = null
      if (!isSin) {
        try {
          // Use real DGII-assigned sequence from DB (increments current_number)
          eNCF = await api?.ncf?.next?.(ncfType) || null
        } catch { /* fallback below */ }
        if (!eNCF) {
          // Fallback: generate from current seq in memory
          const seq = ncfSeqs.find(s => s.type === ncfType)
          const next = (seq?.current_number || 0) + 1
          const prefix = seq?.prefix || ncfType
          eNCF = `${prefix}${String(next).padStart(8, '0')}`
        }
      }
      const legacyResult = {
        eNCF:        isSin ? null : eNCF,
        status:      isSin ? 'SIN' : 'LOCAL',
        trackId:     `local-${Date.now()}`,
        submittedAt: new Date().toISOString(),
        qrLink:      null,
        pdfUrl:      null,
        _legacy:     true,
      }
      setEcfResult(legacyResult)
      setEcfState('success')
      if (!confirmedRef.current) {
        confirmedRef.current = true
        onConfirm({
          ticketId:  ticket.id,
          ticketNo:  ticket.ticketNo,
          clientId:  selectedClient?.id || null,
          ncfType, rnc, rncName, tipo,
          formaPago: tipo === 'credito' ? 'credit' : formaPago,
          recibido:  recibidoNum,
          devuelta:  showEfectivo ? devuelta : null,
          comentario, total, descuento, descuentoReason: descuentoReason.trim() || null, subtotal, itbis,
          paidAt:    new Date(),
          ecf:       legacyResult,
        })
        awardLoyaltyPoints(selectedClient?.id, total)
      }
      return
    }

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
        items: ticket.services.map(s => ({
          nombre: s.name,
          precio: s.price,
          cantidad: s.qty || 1,
          indicadorBienoServicio: s.inventory_item_id ? '1' : '2',
          unidadMedida: s.inventory_item_id ? '43' : '43',
        })),
        fechaVencimiento,
        referencia: currentType?.requiresReferencia ? {
          ncfModificado: refNCF.trim(),
          razonModificacion: refRazon.trim(),
          fechaNCFModificado: refFecha || undefined,
          codigoModificacion: refCodigo,
        } : undefined,
        // Legacy fields (used by stub fallback)
        ncfType, rnc, rncName, tipo,
        formaPago:  tipo === 'credito' ? 'credit' : formaPago,
        ticket:     { id: ticket.id, ticketNo: ticket.ticketNo, vehicle: ticket.vehicle, services: ticket.services },
        comentario,
        paidAt:     new Date(),
      }

      // Pass `api` so the web build routes through the Supabase-backed proxy
      // (api.dgii_ecf → /api/ecf-sign). Without it, web users silently fall
      // back to the local stub and emit fake e-CFs.
      const result = await signAndSubmitECF(invoiceData, api)
      clearTimeout(t1); clearTimeout(t2)
      setEcfResult(result)
      setEcfState('success')
      if (!confirmedRef.current) {
        confirmedRef.current = true
        onConfirm({
          ticketId:  ticket.id,
          ticketNo:  ticket.ticketNo,
          clientId:  selectedClient?.id || null,
          ncfType, rnc, rncName, tipo,
          formaPago: tipo === 'credito' ? 'credit' : formaPago,
          recibido:  recibidoNum,
          devuelta:  showEfectivo ? devuelta : null,
          comentario, total, descuento, descuentoReason: descuentoReason.trim() || null, subtotal, itbis,
          paidAt:    new Date(),
          ecf:       result,
        })
        awardLoyaltyPoints(selectedClient?.id, total)
      }

      // Use qrLink from DGII directly; fall back to QR generation
      getQRCode(result.eNCF, result)
        .then(({ qrUrl: url }) => setQrUrl(url))
        .catch(() => { /* QR optional */ })

    } catch (err) {
      clearTimeout(t1); clearTimeout(t2)
      setEcfError(err?.message || 'Error al enviar e-CF a DGII')
      setEcfState('error')
    }
  }

  function handleSuccessClose() {
    // Ticket already created immediately after ECF success — just close
    onClose()
  }

  const isSubmitting = ecfState === 'submitting'
  const STEPS = lang === 'es' ? STEPS_ES : STEPS_EN

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-0 md:p-6"
      onMouseDown={e => { if (e.target === e.currentTarget && !isSubmitting) ecfState === 'success' ? handleSuccessClose() : onClose() }}
    >
      <div className="bg-white dark:bg-zinc-900 shadow-2xl w-full h-full md:w-auto md:h-auto md:max-w-[660px] md:rounded-2xl flex flex-col md:max-h-[93vh]">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-3 md:px-6 md:py-4 border-b border-slate-100 dark:border-white/10 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-800 dark:text-white">{tl('title', lang)}</h3>
            </div>
            <p className="text-[12px] text-slate-400 dark:text-white/40 mt-0.5">
              {ticket.ticketNo} &middot; {ticket.vehicle}
            </p>
          </div>
          <button
            onClick={() => { if (!isSubmitting) ecfState === 'success' ? handleSuccessClose() : onClose() }}
            disabled={isSubmitting}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X size={18} />
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
            client={selectedClient}
            bizName={bizSettings?.biz_name || 'Terminal X'}
            subtotal={subtotal}
            itbis={itbis}
            ley={ley}
            formaPago={formaPago}
            bizSettings={bizSettings}
          />
        ) : (

          <>
            {/* ── Body (payment form) ────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5 space-y-4 md:space-y-5 relative">

              {/* ── Submitting overlay ─────────────────────────────────── */}
              {isSubmitting && (
                <div className="absolute inset-0 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm flex flex-col items-center justify-center gap-5 z-10 rounded-b-2xl">
                  <Loader2 size={36} className="text-sky-500 animate-spin" />
                  <div className="text-center space-y-1">
                    <p className="text-[14px] font-bold text-slate-800 dark:text-white">
                      {lang === 'es' ? 'Procesando e-CF…' : 'Processing e-CF…'}
                    </p>
                    <p className="text-[12px] text-slate-400 dark:text-white/40">{STEPS[submitStep]}</p>
                  </div>
                  {/* Step dots */}
                  <div className="flex gap-2">
                    {STEPS.map((_, i) => (
                      <span key={i} className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                        i <= submitStep ? 'bg-sky-500' : 'bg-slate-200 dark:bg-white/10'
                      }`} />
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-white/40 max-w-[240px] text-center">
                    {lang === 'es'
                      ? 'Enviando a DGII. No cierres esta ventana.'
                      : 'Submitting to DGII. Do not close this window.'}
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
              <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-4">
                <SectionLabel>{tl('summary', lang)}</SectionLabel>
                <div className="space-y-1.5 mb-3">
                  {ticket.services.map((svc, i) => (
                    <div key={i} className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] text-slate-700 dark:text-white">
                          {(svc.qty || 1) > 1 && svc.weight == null ? `${svc.qty}x ` : ''}{svc.name}
                        </span>
                        {svc.weight != null && svc.unit && svc.price_per_unit != null && (
                          <p className="text-[10px] text-slate-400 tabular-nums">{Number(svc.weight).toFixed(3)} {svc.unit} × {fmtRD(svc.price_per_unit)}/{svc.unit}</p>
                        )}
                      </div>
                      <span className="text-[13px] text-slate-600 dark:text-white/60 font-medium tabular-nums">{fmtRD(svc.price * (svc.qty || 1))}</span>
                    </div>
                  ))}
                </div>
                {/* Salon cross-sell tip — surfaced when the cart hits a cut/color/treatment keyword */}
                {upsellTip && (
                  <div className="mb-3 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-[#b3001e]/5 border border-[#b3001e]/20 text-[12px] text-[#b3001e] dark:text-[#ff6b7e]">
                    <Gift size={13} className="mt-0.5 shrink-0" />
                    <span className="font-semibold leading-snug">{upsellTip}</span>
                  </div>
                )}
                {/* Salon loyalty preview — points this ticket will earn */}
                {isSalon && selectedClient?.id && loyaltyPointsFor(total) > 0 && (
                  <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[11px] text-slate-600 dark:text-white/70">
                    <Gift size={12} className="text-[#b3001e]" />
                    <span>
                      {lang === 'es'
                        ? `Ganará ${loyaltyPointsFor(total)} pts de lealtad`
                        : `Will earn ${loyaltyPointsFor(total)} loyalty pts`}
                    </span>
                  </div>
                )}
                <div className="border-t border-slate-200 dark:border-white/10 pt-3 space-y-1.5">
                  <div className="flex justify-between text-[12px] text-slate-500 dark:text-white/60">
                    <span>{tl('subtotal', lang)}</span>
                    <span className="tabular-nums">{fmtRD(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-[12px] text-slate-500 dark:text-white/60">
                    <span>{`ITBIS ${itbisRate}%`}</span>
                    <span className="tabular-nums">{fmtRD(itbis)}</span>
                  </div>
                  {ley > 0 && (
                  <div className="flex justify-between text-[12px] text-slate-500 dark:text-white/60">
                    <span>{tl('ley', lang)}</span>
                    <span className="tabular-nums">{fmtRD(ley)}</span>
                  </div>
                  )}
                  <div className="flex justify-between text-[15px] font-bold text-slate-800 dark:text-white border-t border-slate-200 dark:border-white/10 pt-2 mt-1">
                    <span>{tl('total', lang)}</span>
                    <span className="tabular-nums">{fmtRD(total)}</span>
                  </div>
                </div>
              </div>

              {/* ── Two-column: Comprobante (left) | Tipo + Cliente (right) ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 items-start">

                {/* LEFT — Comprobante */}
                <div>
                  <SectionLabel>
                    {isLegacy
                      ? (lang === 'es' ? 'Comprobante NCF' : 'NCF Receipt')
                      : tl('comp', lang)}
                  </SectionLabel>

                  {/* Legacy B01/B02/SIN buttons */}
                  {isLegacy ? (
                    <div className="flex flex-wrap gap-2">
                      {LEGACY_TYPES.map(lt => (
                        <ToggleBtn key={lt.code} active={ncfType === lt.code} onClick={() => setNcfType(lt.code)}>
                          {lt.code}
                          <span className="block text-[10px] font-normal opacity-60 mt-0.5">
                            {lang === 'es' ? lt.sub_es : lt.sub_en}
                          </span>
                        </ToggleBtn>
                      ))}
                    </div>
                  ) : enabledEcfTypes === null ? (
                    <div className="flex items-center gap-2 h-10">
                      <Loader2 size={13} className="animate-spin text-slate-400 dark:text-white/40" />
                      <span className="text-[12px] text-slate-400 dark:text-white/40">
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

                  {/* RNC fields — when selected type requires RNC */}
                  {currentType?.requiresRnc && (
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={rnc}
                          onChange={e => { setRnc(e.target.value); setRncName('') }}
                          onKeyDown={e => e.key === 'Enter' && lookupRnc()}
                          placeholder={tl('rnc', lang)}
                          maxLength={11}
                          className="flex-1 min-w-0 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] dark:text-white focus:outline-none focus:border-sky-400 placeholder:text-slate-400 dark:placeholder:text-white/40"
                        />
                        <button
                          onClick={lookupRnc}
                          className="w-8 h-8 flex items-center justify-center bg-slate-100 dark:bg-white/10 hover:bg-sky-50 dark:hover:bg-sky-500/10 hover:text-sky-600 text-slate-500 dark:text-white/60 rounded-lg transition-colors shrink-0"
                        >
                          <Search size={13} />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={rncName}
                        onChange={e => setRncName(e.target.value)}
                        placeholder={tl('nombre', lang)}
                        className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] dark:text-white focus:outline-none focus:border-sky-400 placeholder:text-slate-400 dark:placeholder:text-white/40"
                      />
                    </div>
                  )}

                  {/* Reference fields — E33/E34 (credit/debit notes) */}
                  {currentType?.requiresReferencia && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wider">
                        {lang === 'es' ? 'Documento Original' : 'Original Document'}
                      </p>
                      <input
                        type="text"
                        value={refNCF}
                        onChange={e => setRefNCF(e.target.value)}
                        placeholder={lang === 'es' ? 'e-NCF original (ej: E310000000001)' : 'Original e-NCF (e.g. E310000000001)'}
                        className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] dark:text-white focus:outline-none focus:border-sky-400 placeholder:text-slate-400 dark:placeholder:text-white/40"
                      />
                      <input
                        type="text"
                        value={refRazon}
                        onChange={e => setRefRazon(e.target.value)}
                        placeholder={lang === 'es' ? 'Razon de modificacion' : 'Modification reason'}
                        className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] dark:text-white focus:outline-none focus:border-sky-400 placeholder:text-slate-400 dark:placeholder:text-white/40"
                      />
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={refFecha}
                          onChange={e => setRefFecha(e.target.value)}
                          className="flex-1 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] dark:text-white focus:outline-none focus:border-sky-400"
                        />
                        <select
                          value={refCodigo}
                          onChange={e => setRefCodigo(e.target.value)}
                          className="flex-1 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] dark:text-white focus:outline-none focus:border-sky-400"
                        >
                          <option value="1">{lang === 'es' ? '1 — Cambio de cantidad' : '1 — Qty change'}</option>
                          <option value="2">{lang === 'es' ? '2 — Cambio de precio' : '2 — Price change'}</option>
                          <option value="3">{lang === 'es' ? '3 — Ajuste por error' : '3 — Error adjustment'}</option>
                          <option value="4">{lang === 'es' ? '4 — Reversion total' : '4 — Full reversal'}</option>
                        </select>
                      </div>
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
                      <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/40 pointer-events-none z-10" />
                      <input
                        type="text"
                        value={clientQuery}
                        onChange={e => { setClientQuery(e.target.value); setShowClientDrop(true); if (!e.target.value) clearClient() }}
                        onFocus={() => { if (clientQuery) setShowClientDrop(true) }}
                        placeholder={lang === 'es' ? 'Buscar por nombre o RNC…' : 'Search by name or RNC…'}
                        style={{ paddingLeft: '2.25rem', paddingRight: '1.75rem' }}
                        className="w-full py-2 border border-slate-200 dark:border-white/10 rounded-xl text-[12px] bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/20 placeholder:text-slate-300 dark:placeholder:text-white/40"
                      />
                      {selectedClient && (
                        <button
                          onClick={clearClient}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 dark:text-white/40 hover:text-slate-500 dark:hover:text-white"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>

                    {/* Dropdown results */}
                    {showClientDrop && clientResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-white/10 rounded-xl shadow-xl z-20 overflow-hidden">
                        {clientResults.map(c => (
                          <button
                            key={c.id}
                            onMouseDown={() => selectClient(c)}
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors text-left"
                          >
                            <div className="w-6 h-6 rounded-full bg-[#f0f6ff] text-[#0C447C] flex items-center justify-center text-[10px] font-black shrink-0">
                              {c.name[0]?.toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-semibold text-slate-800 dark:text-white truncate">{c.name}</p>
                              {c.rnc && <p className="text-[10px] text-slate-400 dark:text-white/40">{c.rnc}</p>}
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
                      <p className="mt-2 text-[11px] text-slate-400 dark:text-white/40 italic px-1">
                        {lang === 'es' ? 'Al Portador' : 'Walk-in Client'}
                      </p>
                    )}

                    {/* Carwash benefit chips — active membership / wash combo */}
                    {selectedClient && (activeMembership || activeCombo || benefitUsed) && (
                      <div className="mt-2 flex flex-wrap gap-2 px-1">
                        {activeMembership && (
                          <button
                            type="button"
                            onClick={consumeMembership}
                            disabled={consumingBenefit || benefitUsed?.kind === 'membership'}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                              benefitUsed?.kind === 'membership'
                                ? 'bg-green-100 dark:bg-green-500/20 border-green-300 dark:border-green-500/40 text-green-700 dark:text-green-400'
                                : 'bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/30 text-sky-700 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-500/20'
                            }`}
                            title={activeMembership.plan_name}
                          >
                            {benefitUsed?.kind === 'membership'
                              ? `✓ ${lang === 'es' ? 'Membresía usada' : 'Membership used'} · ${benefitUsed.remaining} ${lang === 'es' ? 'restantes' : 'left'}`
                              : `${lang === 'es' ? 'Usar membresía' : 'Use membership'} · ${(activeMembership.wash_quota_per_month || 0) - (activeMembership.washes_used_this_period || 0)} ${lang === 'es' ? 'disp.' : 'left'}`}
                          </button>
                        )}
                        {activeCombo && (
                          <button
                            type="button"
                            onClick={consumeCombo}
                            disabled={consumingBenefit || benefitUsed?.kind === 'combo'}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                              benefitUsed?.kind === 'combo'
                                ? 'bg-green-100 dark:bg-green-500/20 border-green-300 dark:border-green-500/40 text-green-700 dark:text-green-400'
                                : 'bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/30 text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-500/20'
                            }`}
                            title={activeCombo.combo_name}
                          >
                            {benefitUsed?.kind === 'combo'
                              ? `✓ ${lang === 'es' ? 'Combo aplicado' : 'Combo used'} · ${benefitUsed.remaining} ${lang === 'es' ? 'restantes' : 'left'}`
                              : `${lang === 'es' ? 'Usar combo' : 'Use combo'} · ${(activeCombo.total_washes || 0) - (activeCombo.used_washes || 0)} ${lang === 'es' ? 'disp.' : 'left'}`}
                          </button>
                        )}
                      </div>
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
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {PAYMENT_METHODS.map(({ id, icon: Icon, es, en }) => (
                      <button
                        key={id}
                        onClick={() => setFormaPago(id)}
                        className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-[12px] font-semibold transition-all min-h-[48px] ${
                          formaPago === id
                            ? 'bg-sky-500 border-sky-500 text-white shadow-md shadow-sky-500/20'
                            : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-sky-300 hover:bg-sky-50/50 dark:hover:bg-white/10'
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
                <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-4 space-y-3">
                  <div>
                    <SectionLabel>{lang === 'es' ? 'Monto rápido' : 'Quick amount'}</SectionLabel>
                    <div className="flex gap-2 flex-wrap">
                      {QUICK.map(amt => (
                        <button
                          key={amt}
                          onClick={() => setRecibido(String(amt))}
                          className={`px-3 py-2 md:py-1.5 rounded-lg border text-[12px] font-semibold transition-all min-h-[44px] md:min-h-0 ${
                            recibidoNum === amt
                              ? 'bg-slate-800 dark:bg-white/10 border-slate-800 dark:border-white/20 text-white'
                              : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-slate-400'
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
                            : 'bg-white dark:bg-white/5 border-sky-200 dark:border-sky-500/30 text-sky-600 hover:border-sky-400'
                        }`}
                      >
                        {tl('exacto', lang)} · {fmtRD(total)}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-1.5">
                        {tl('recibido', lang)}
                      </label>
                      <div className="flex items-center bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 focus-within:border-sky-400 focus-within:ring-1 focus-within:ring-sky-400/30">
                        <span className="text-slate-400 dark:text-white/40 text-[12px] mr-2">RD$</span>
                        <input
                          type="number"
                          value={recibido}
                          onChange={e => setRecibido(e.target.value)}
                          min={0}
                          step="0.01"
                          className="flex-1 text-[14px] font-semibold text-slate-800 dark:text-white focus:outline-none bg-transparent"
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-1.5">
                        {devuelta < 0 ? tl('falta', lang) : tl('devuelta', lang)}
                      </label>
                      <div className={`px-3 py-2.5 rounded-xl border text-[14px] font-bold tabular-nums ${
                        recibido === ''
                          ? 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40'
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

              {/* Descuento */}
              <div>
                <SectionLabel>{lang === 'es' ? 'Descuento (RD$)' : 'Discount (RD$)'}</SectionLabel>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={descuentoInput}
                  onChange={e => { setDescuentoInput(e.target.value); setDescuentoError('') }}
                  placeholder="0.00"
                  className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2.5 text-[13px] text-slate-700 dark:text-white focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30 placeholder:text-slate-400 dark:placeholder:text-white/40"
                />
                {descuento > 0 && (
                  <>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-white/60">
                      {lang === 'es' ? 'Bruto' : 'Gross'}: RD${totalGross.toFixed(2)} · {lang === 'es' ? 'Neto' : 'Net'}: RD${total.toFixed(2)}
                    </p>
                    <input
                      type="text"
                      value={descuentoReason}
                      onChange={e => { setDescuentoReason(e.target.value); setDescuentoError('') }}
                      placeholder={lang === 'es' ? 'Razón del descuento (obligatorio)' : 'Discount reason (required)'}
                      className={`mt-2 w-full bg-slate-50 dark:bg-white/5 border rounded-xl px-3.5 py-2.5 text-[13px] text-slate-700 dark:text-white focus:outline-none focus:ring-1 placeholder:text-slate-400 dark:placeholder:text-white/40 ${descuentoError ? 'border-red-400 focus:border-red-500 focus:ring-red-400/30' : 'border-slate-200 dark:border-white/10 focus:border-sky-400 focus:ring-sky-400/30'}`}
                    />
                    {descuentoError && (
                      <p className="mt-1 text-[11px] text-red-500 font-medium">{descuentoError}</p>
                    )}
                  </>
                )}
              </div>

              {/* Comentario */}
              <div>
                <SectionLabel>{tl('comment', lang)}</SectionLabel>
                <textarea
                  value={comentario}
                  onChange={e => setComentario(e.target.value)}
                  rows={2}
                  placeholder={lang === 'es' ? 'Notas opcionales sobre este pago…' : 'Optional notes about this payment…'}
                  className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2.5 text-[13px] text-slate-700 dark:text-white focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30 resize-none placeholder:text-slate-400 dark:placeholder:text-white/40"
                />
              </div>
            </div>

            {/* ── Footer ────────────────────────────────────────────────── */}
            <div className="flex gap-2 md:gap-3 px-4 py-3 md:px-6 md:py-4 border-t border-slate-100 dark:border-white/10 shrink-0">
              <button
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 py-3 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 rounded-xl text-[13px] font-semibold hover:bg-slate-50 dark:hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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

      {/* v2.6 — Manager Authorization Gate (big-discount override) */}
      {gateOpen && (
        <ManagerAuthGate
          action="discount_big"
          actionLabel={lang === 'es'
            ? `Descuento de ${fmtRD(descuento)} (${((descuento / (totalGross || 1)) * 100).toFixed(1)}%)`
            : `Discount of ${fmtRD(descuento)} (${((descuento / (totalGross || 1)) * 100).toFixed(1)}%)`}
          context={{ amount: descuento, subtotal: totalGross, reason: descuentoReason, ticket_id: ticket?.id }}
          onApprove={() => {
            _gateApprovedRef.current = true
            setGateOpen(false)
            setTimeout(() => handleConfirm(), 0)
          }}
          onCancel={() => setGateOpen(false)}
        />
      )}
    </div>
  )
}
