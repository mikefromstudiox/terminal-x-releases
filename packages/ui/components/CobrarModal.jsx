import { useState, useEffect, useRef, useMemo } from 'react'
import LoyaltyTierBadge, { tierMultiplier } from './LoyaltyTierBadge'
import { X, Search, Banknote, CreditCard, ArrowRightLeft, Landmark, CheckCircle2, AlertTriangle, AlertCircle, Loader2, QrCode, User, MessageSquare, Split, Plus, Minus, Scissors, Award } from 'lucide-react'
import { useLang } from '../i18n'
import { useAPI } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import ManagerAuthGate from './ManagerAuthGate'
import { needsGate, isBigDiscount } from '@terminal-x/services/managerGateRules'
import { signAndSubmitECF, getQRCode, ECF_TYPES, validateRNC } from '@terminal-x/services/ecf'
import { enqueueActivity } from '@terminal-x/services/activity-log-queue.js'
const buildReceiptPDFBase64 = (...args) => import('@terminal-x/services/pdf').then(m => m.buildReceiptPDFBase64(...args))
import { useRNC } from '../hooks/useRNC'
import { usePlan } from '../hooks/usePlan'
import { useBusinessType } from '../hooks/useBusinessType.jsx'
import { Gift } from 'lucide-react'
import { RNC_CEDULA_MAX_LENGTH, formatRncCedula } from '../lib/formatters'

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
// v2.7.1 — configurable loyalty ratio. Earns = floor(amount / ratio). Default
// ratio is 100 (1 point per RD$100). Keeps backward-compat with the original
// salon-only helper that hardcoded 100.
function loyaltyPointsFor(amount, ratio = 100) {
  const r = Number(ratio) || 100
  return Math.max(0, Math.floor(Number(amount || 0) / Math.max(1, r)))
}

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
  { id: 'mixto',         icon: Split,          es: 'Mixto',         en: 'Mixed'    },
]

const MIXTO_METHODS = [
  { id: 'efectivo',      icon: Banknote,       es: 'Efectivo',      en: 'Cash'     },
  { id: 'tarjeta',       icon: CreditCard,     es: 'Tarjeta',       en: 'Card'     },
  { id: 'transferencia', icon: ArrowRightLeft, es: 'Transferencia', en: 'Transfer' },
  { id: 'cheque',        icon: Landmark,       es: 'Cheque',        en: 'Check'    },
]
const MIXTO_MAX_PARTS = 5

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
          // Thread the receipt-customization toggles (ITBIS %, etc.) so the
          // WhatsApp-sent PDF honors Sistema → Personalización de Recibo just
          // like the printed thermal receipt does.
          cfg: {
            itbis_pct: bizSettings?.itbis_pct,
            receipt_show_itbis_pct: bizSettings?.receipt_show_itbis_pct,
            receipt_show_commission: bizSettings?.receipt_show_commission,
          },
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
export default function CobrarModal({ ticket, onConfirm, onClose, forceNcfType = null }) {
  const api = useAPI()
  const { lang } = useLang()
  const { businessType, hasFeature: hasBizFeature } = useBusinessType()
  const { hasFeature } = usePlan()
  // v2.16.10 — Owner toggle (Mi Empresa). When OFF, the descuento input is
  // hidden and any pending value is ignored in totals/handleConfirm so a
  // stored value can't sneak through.
  const discountsEnabled = hasBizFeature('discounts')
  const isSalon = businessType === 'salon'
  const upsellTip = useMemo(() => isSalon ? salonUpsellSuggestion(ticket, lang) : null, [isSalon, ticket, lang])

  // ── v2.16.1 — Salon-only POS extensions ───────────────────────────────────
  // Per-line stylist picker (defaults to client.preferred_stylist_supabase_id),
  // commission breakdown, retail upsell tiles, "Usar Membresía" button.
  const [salonEmpleados, setSalonEmpleados] = useState([]) // [{id, supabase_id, nombre, comision_pct}]
  const [salonUpsellItems, setSalonUpsellItems] = useState([]) // up to 6 inventory_items
  const [salonClientMemberships, setSalonClientMemberships] = useState([]) // active client_memberships
  // v2.16.13 — selectedClient state was declared on line 859 but salon
  // useEffects on ~541/559 referenced selectedClient?.supabase_id in their
  // dep arrays. Hooks are evaluated top-down at render time, so accessing
  // selectedClient before its declaration line is a TDZ violation:
  // "Cannot access 'selectedClient' before initialization" (minified to
  // "Ht" in the production bundle). Worked accidentally before React 19 /
  // Vite 5 minifier rev. Hoisted up here to before any useEffect that
  // depends on it. Original line 859 declaration is removed below.
  const [selectedClient, setSelectedClient] = useState(ticket?.client || null)
  // Per-line cart annotations: keyed by ticket.services index.
  // { stylistEmpId, redeemed, commissionPct, isService }
  const [lineMeta, setLineMeta] = useState(() => (ticket?.services || []).map(svc => ({
    stylistEmpId: '',
    redeemed: false,
    redemptionId: null,
    commissionPct: null, // null = derive from svc/inventory default
    isService: !svc.inventory_item_id,
  })))
  // Local cart state for upsell-added retail tiles (mirrors ticket.services into a derived list).
  const [extraLines, setExtraLines] = useState([]) // [{ id, name, price, qty, inventory_item_id, commission_pct }]
  const allCartLines = useMemo(() => {
    const base = (ticket?.services || []).map((s, i) => ({ ...s, _idx: i, _kind: 'base' }))
    const extras = extraLines.map((s, i) => ({ ...s, _idx: i, _kind: 'extra' }))
    return [...base, ...extras]
  }, [ticket?.services, extraLines])
  // Per-line meta for both base + extra rows.
  const [extraMeta, setExtraMeta] = useState([]) // mirrors extraLines

  // Load salon-context data (empleados, upsell items) once when modal opens.
  useEffect(() => {
    if (!isSalon) return
    let cancel = false
    ;(async () => {
      try {
        const emps = await (api?.empleados?.all?.() || Promise.resolve([]))
        if (!cancel) setSalonEmpleados((emps || []).filter(e => e.active !== 0))
      } catch {}
      try {
        const inv = await (api?.inventory?.all?.() || Promise.resolve([]))
        // v2.16.1 patch (#4) — column now exists in both schemas. Sort by
        // salon_upsell_order ASC NULLS LAST, name ASC. Falls back to legacy
        // featured/top-N path for back-compat with carwash inventory.
        const list = (inv || [])
        const flagged = list
          .filter(i => i.salon_upsell)
          .sort((a, b) => {
            const ao = a.salon_upsell_order, bo = b.salon_upsell_order
            const aHas = ao != null, bHas = bo != null
            if (aHas && bHas) return Number(ao) - Number(bo)
            if (aHas) return -1
            if (bHas) return 1
            return String(a.name || '').localeCompare(String(b.name || ''))
          })
        const pool = flagged.length ? flagged : list.filter(i => i.featured)
        const final = (pool.length ? pool : list).slice(0, 6)
        if (!cancel) setSalonUpsellItems(final)
      } catch {}
    })()
    return () => { cancel = true }
  }, [isSalon, api])

  // Load active client_memberships when client picked.
  useEffect(() => {
    if (!isSalon) return
    if (!hasFeature?.('salon_memberships')) return
    const supaId = selectedClient?.supabase_id
    if (!supaId) { setSalonClientMemberships([]); return }
    let cancel = false
    ;(async () => {
      try {
        const rows = await (api?.clientMemberships?.byClient?.(supaId) || Promise.resolve([]))
        if (!cancel) setSalonClientMemberships(rows || [])
      } catch {
        if (!cancel) setSalonClientMemberships([])
      }
    })()
    return () => { cancel = true }
  }, [isSalon, hasFeature, selectedClient?.supabase_id, api])

  // Default each base line's stylist to the client's preferred stylist (when known).
  useEffect(() => {
    if (!isSalon) return
    const psSupaId = selectedClient?.preferred_stylist_supabase_id
    if (!psSupaId) return
    const psEmp = salonEmpleados.find(e => e.supabase_id === psSupaId)
    if (!psEmp) return
    setLineMeta(metas => metas.map(m => m.stylistEmpId ? m : { ...m, stylistEmpId: String(psEmp.id) }))
  }, [isSalon, selectedClient?.preferred_stylist_supabase_id, salonEmpleados])

  function pickLineStylist(idx, kind, value) {
    if (kind === 'extra') {
      setExtraMeta(arr => {
        const copy = [...arr]
        copy[idx] = { ...(copy[idx] || {}), stylistEmpId: value }
        return copy
      })
    } else {
      setLineMeta(arr => {
        const copy = [...arr]
        copy[idx] = { ...(copy[idx] || {}), stylistEmpId: value }
        return copy
      })
    }
  }

  function getLineCommissionPct(line, meta) {
    // Line-stamped value wins; else service.commission_pct; else default by kind.
    if (meta?.commissionPct != null) return Number(meta.commissionPct)
    if (line.commission_pct != null) return Number(line.commission_pct)
    return meta?.isService === false || line.inventory_item_id ? 10 : 50
  }

  function addUpsellItem(item) {
    // v2.16.2 (item #11) — copy `cost`, `aplica_itbis`, `unit` so the resulting
    // ticket_item carries the same tax / cost-of-goods / unit metadata as a
    // POS-added line. Defaults: ITBIS-applicable, cost 0, unit null.
    const newLine = {
      id: `upsell-${item.id}-${Date.now()}`,
      name: item.name || item.nombre,
      price: Number(item.price) || 0,
      qty: 1,
      inventory_item_id: item.id,
      sku: item.sku || item.codigo || null,
      supabase_id: item.supabase_id || null,
      commission_pct: item.commission_pct ?? 10,
      cost:           Number(item.cost ?? item.costo ?? 0) || 0,
      aplica_itbis:   item.aplica_itbis != null ? (Number(item.aplica_itbis) ? 1 : 0) : 1,
      unit:           item.unit || item.unidad || null,
    }
    setExtraLines(arr => [...arr, newLine])
    setExtraMeta(arr => [...arr, { stylistEmpId: '', redeemed: false, redemptionId: null, isService: false, commissionPct: newLine.commission_pct }])
  }

  // ── Membership redemption ────────────────────────────────────────────────
  const [showMembershipPicker, setShowMembershipPicker] = useState(false)
  const eligibleMemberships = useMemo(() => {
    if (!isSalon || !hasFeature?.('salon_memberships')) return []
    if (!salonClientMemberships?.length) return []
    // Match if membership is "any service" (service_supabase_id null) OR matches a cart service.
    const cartSvcSupaIds = new Set((ticket?.services || []).map(s => s.service_supabase_id || s.supabase_id).filter(Boolean))
    return salonClientMemberships.filter(m =>
      Number(m.sessions_remaining || 0) > 0 &&
      (!m.service_supabase_id || cartSvcSupaIds.has(m.service_supabase_id))
    )
  }, [isSalon, hasFeature, salonClientMemberships, ticket?.services])

  async function consumeMembershipForLine(lineKind, lineIdx, membership) {
    try {
      // Optimistic local zero-out + tag — server consume happens on cobro confirm.
      if (lineKind === 'extra') {
        setExtraLines(arr => arr.map((l, i) => i === lineIdx ? { ...l, price: 0 } : l))
        setExtraMeta(arr => {
          const copy = [...arr]
          copy[lineIdx] = { ...(copy[lineIdx] || {}), redeemed: true, redemptionId: membership.supabase_id }
          return copy
        })
      } else {
        // Mutate local copy — base line price drives total memo.
        setLineMeta(arr => {
          const copy = [...arr]
          copy[lineIdx] = { ...(copy[lineIdx] || {}), redeemed: true, redemptionId: membership.supabase_id }
          return copy
        })
        // For base lines we override price in totals via redemption discount path.
        // We zero by adding a synthetic discount line — handled in totals.
      }
      setShowMembershipPicker(false)
    } catch {}
  }

  // Sum redemption discounts for base lines (extras are already mutated to price=0).
  const membershipDiscount = useMemo(() => {
    if (!isSalon) return 0
    let total = 0
    ;(ticket?.services || []).forEach((svc, i) => {
      if (lineMeta[i]?.redeemed) total += (Number(svc.price) || 0) * (svc.qty || 1)
    })
    return total
  }, [isSalon, lineMeta, ticket?.services])

  // Commission breakdown: { stylistEarned, businessEarned } against post-discount line totals.
  const commissionBreakdown = useMemo(() => {
    if (!isSalon) return { stylistEarned: 0, businessEarned: 0 }
    let stylist = 0, biz = 0
    const calcLine = (line, meta) => {
      const lineSubtotal = (Number(line.price) || 0) * (line.qty || 1)
      const pct = getLineCommissionPct(line, meta) / 100
      const sty = lineSubtotal * pct
      stylist += sty
      biz += lineSubtotal - sty
    }
    ;(ticket?.services || []).forEach((s, i) => {
      const m = lineMeta[i] || {}
      if (m.redeemed) return
      calcLine(s, m)
    })
    extraLines.forEach((s, i) => calcLine(s, extraMeta[i] || {}))
    return { stylistEarned: stylist, businessEarned: biz }
  }, [isSalon, ticket?.services, lineMeta, extraLines, extraMeta])

  // v2.7.1 — cross-vertical loyalty program. Plan-gated (Pro PLUS + Pro MAX)
  // + owner toggle in Settings. Legacy salon auto-accrual still works when the
  // business hasn't enabled the program (back-compat).
  const [loyaltyCfg, setLoyaltyCfg] = useState({
    enabled: false,
    pointsRatio: 100,       // RD$ per 1 point
    redemptionRatio: 2,     // points per RD$1 off
  })
  const loyaltyEnabled = hasFeature?.('loyalty') && loyaltyCfg.enabled

  // Fire-and-forget loyalty accrual. Runs AFTER onConfirm fires so it never
  // blocks the success view. Silently swallows errors.
  //   - Loyalty program ON + plan has 'loyalty'  → ledger-backed award
  //   - Legacy salon auto-accrual                → simple balance bump
  async function awardLoyaltyPoints(client, totalAmount, ticketSupabaseId) {
    const clientId           = client?.id || null
    const clientSupabaseId   = client?.supabase_id || null
    if (!clientId || !totalAmount) return
    if (loyaltyEnabled) {
      const pts = loyaltyPointsFor(totalAmount, loyaltyCfg.pointsRatio)
      if (pts <= 0) return
      try {
        if (api?.clients?.loyaltyAward) {
          await api.clients.loyaltyAward({
            clientId,
            clientSupabaseId,
            ticketSupabaseId,
            points: pts,
            notes: 'earn_ticket',
          })
        }
      } catch (e) {
        console.error('[loyalty] award failed', e)
        try { window.alert('Puntos no acreditados — contacta soporte') } catch {}
      }
      return
    }
    if (isSalon) {
      const pts = loyaltyPointsFor(totalAmount, 100)
      if (pts <= 0) return
      try { await api?.clients?.addLoyaltyPoints?.({ id: clientId, delta: pts }) }
      catch (e) {
        console.error('[loyalty] salon addLoyaltyPoints failed', e)
        try { window.alert('Puntos no acreditados — contacta soporte') } catch {}
      }
    }
  }

  // ITBIS rate — loaded from app_settings.itbis_pct on mount (see useEffect
  // below). Stays a numeric percentage (e.g. 18). Totals are memoised against
  // both ticket services and the live rate so display refreshes on settings
  // change without a manual reload.
  const [itbisRate, setItbisRate] = useState(DEFAULT_ITBIS_RATE)
  const itbisFactor = Number(itbisRate) / 100
  const [descuentoInput, setDescuentoInput] = useState('')
  // v2.7.1 — pending loyalty redemption { points, discount }. Applied as a
  // descuento line; consumed (ledger burn) on successful onConfirm.
  const [loyaltyRedemption, setLoyaltyRedemption] = useState(null)
  const [loyaltyPickerOpen, setLoyaltyPickerOpen]   = useState(false)

  // v2.7.1 — offline detection (web PWA). Desktop (Electron) ignores
  // navigator.onLine because it has local SQLite + offline queue.
  const isWeb = typeof window !== 'undefined' && !window.electronAPI
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    if (!isWeb) return
    const on  = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online',  on)
      window.removeEventListener('offline', off)
    }
  }, [isWeb])
  const offlineBlock = isWeb && !online

  // Totals — prices already include ITBIS, extract it for display.
  // Descuento = RD$ flat amount subtracted from gross; proportionally
  // reduces subtotal + itbis so e-CF totals stay internally consistent.
  const baseGross  = ticket.services.reduce((s, svc) => s + svc.price * (svc.qty || 1), 0)
  const extraGross = extraLines.reduce((s, svc) => s + svc.price * (svc.qty || 1), 0)
  const totalGross = baseGross + extraGross
  const manualDescuento   = discountsEnabled ? Math.max(0, parseFloat(descuentoInput) || 0) : 0
  const loyaltyDiscount   = Math.max(0, Number(loyaltyRedemption?.discount || 0))
  const membershipDescuento = Math.max(0, Number(membershipDiscount || 0))
  const descuento         = Math.min(manualDescuento + loyaltyDiscount + membershipDescuento, totalGross)
  const total    = parseFloat((totalGross - descuento).toFixed(2))
  const subtotal = parseFloat((total / (1 + itbisFactor)).toFixed(2))
  const itbis    = parseFloat((total - subtotal).toFixed(2))
  const ley      = 0

  // Fiscal mode — derived from bizSettings once loaded
  // Enabled e-CF types (loaded from NCF sequences)
  const [enabledEcfTypes, setEnabledEcfTypes] = useState(null) // null = loading, [] after load

  // Prerequisite check — printer configured, business type set, fiscal path
  // available (NCF sequence OR DGII .p12). Not a hard block — renders a warning
  // banner so the cashier sees what's missing before cobrar. Ranoza's Day-1
  // silent-failure trap: no printer + no NCF = sale succeeds but no receipt.
  const [prereqs, setPrereqs] = useState({ missing: [], loading: true })
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const missing = []
      // Per-check try/catch so one API failure doesn't hide the other warnings.
      try {
        const printerCfg = await (api?.settings?.get?.('printer') || Promise.resolve(null))
        const printerName = printerCfg?.value || printerCfg || ''
        if (!printerName) missing.push({ k: 'printer', es: 'Impresora no configurada (Sistema → Impresión)', en: 'Printer not configured (Settings → Printing)' })
      } catch { missing.push({ k: 'printer_err', es: 'No se pudo verificar la impresora', en: 'Could not verify printer' }) }
      try {
        if (!businessType) missing.push({ k: 'biz_type', es: 'Tipo de negocio no configurado', en: 'Business type not set' })
      } catch {}
      try {
        const seqs = await (api?.ncf?.sequences?.() || Promise.resolve([]))
        const certInfo = await (api?.dgii_ecf?.certInfo?.() || Promise.resolve({ installed: false }))
        if ((seqs || []).length === 0 && !certInfo?.installed) {
          missing.push({ k: 'fiscal', es: 'Ni NCF ni certificado DGII instalado — el ticket no tendrá comprobante fiscal', en: 'No NCF sequence or DGII cert installed — ticket will not have a fiscal receipt' })
        }
      } catch { missing.push({ k: 'fiscal_err', es: 'No se pudo verificar configuración fiscal', en: 'Could not verify fiscal setup' }) }
      if (!cancelled) setPrereqs({ missing, loading: false })
    })()
    return () => { cancelled = true }
  }, [])

  const { lookup: rncLookup } = useRNC()

  // Form state
  const [ncfType,    setNcfType]    = useState('B02') // updated once bizSettings loads
  // Per-sale fiscal-mode override — null means "follow business default".
  // Set by the segmented toggle above the comprobante picker so the cashier
  // can emit a one-off e-CF on a legacy-configured biz (or vice versa).
  const [fiscalOverride, setFiscalOverride] = useState(null) // null | 'legacy' | 'ecf'
  // If POS passed a pre-selected client with a saved RNC, inherit it so the
  // cashier doesn't have to re-type it when flipping to B01 / E31. Walk-ins
  // (no client) still get an empty, editable input. selectClient() + the
  // effect below keep rnc in sync if the cashier swaps client mid-flow.
  const [rnc,        setRnc]        = useState(ticket?.client?.rnc || '')
  const [rncName,    setRncName]    = useState(ticket?.client?.rnc ? (ticket?.client?.name || '') : '')
  // v2.14.34 — auto-default to Crédito when POS passed a pre-selected client.
  // Cashiers picking a known client almost always intend a credit sale; the
  // Contado default forced an extra click on every saved-client transaction.
  // Cashier can still flip back to Contado manually before confirming.
  const [tipo,       setTipo]       = useState(ticket?.client?.id ? 'credito' : 'contado')
  const [formaPago,  setFormaPago]  = useState(null)
  // v2.14.34 — Mixto (split payment inline). When formaPago === 'mixto' the
  // cashier defines per-method amounts. Built INSIDE CobrarModal to kill the
  // floating-button race that hid Pago Dividido behind a closed modal.
  const [mixtoParts, setMixtoParts] = useState([
    { method: 'efectivo', amount: '' },
    { method: 'tarjeta',  amount: '' },
  ])
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
  // selectedClient hoisted to ~line 488 (above salon useEffects) — see
  // v2.16.13 note. DO NOT redeclare it here.
  const [showClientDrop, setShowClientDrop] = useState(false)
  const clientRef = useRef(null)
  const confirmedRef = useRef(false)
  // v2.6 — latches approval for the current attempt so re-entry skips the gate.
  const _gateApprovedRef = useRef(false)
  const _macJtiRef       = useRef(null)

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
    const loadBizSettings = () => api.settings.get().then(s => {
      const cfg = s || {}
      setBizSettings(cfg)
      const pct = Number(cfg.itbis_pct)
      if (Number.isFinite(pct) && pct >= 0) setItbisRate(pct)
      // Historic naming drift — app_settings KV uses `fiscal_mode`, while
      // businesses.settings JSONB used `facturacion_mode`. Accept either and
      // treat any non-'ecf' value (legacy / ncf / b_series / paper) as the
      // legacy B-series path. Default 'ecf' only when nothing is set.
      const rawMode = (cfg.fiscal_mode || cfg.facturacion_mode || 'ecf').toLowerCase()
      const isLegacyMode = rawMode !== 'ecf'
      setNcfType(forceNcfType || (isLegacyMode ? 'B02' : 'E32'))
      setLoyaltyCfg({
        enabled:         String(cfg.loyalty_enabled || '0') === '1',
        pointsRatio:     Math.max(1, Number(cfg.loyalty_points_ratio) || 100),
        redemptionRatio: Math.max(0.1, Number(cfg.loyalty_redemption_ratio) || 2),
      })
    }).catch(() => setBizSettings({}))
    loadBizSettings()
    // v2.14.7 — if the initial sync pull lands AFTER this modal mounts, the
    // fiscal_mode read above is stale and we'd default to E-series on a biz
    // configured for B01/B02. Listen for the pull-complete event and refresh.
    const onPull = () => loadBizSettings()
    window.addEventListener('tx:sync-pull-complete', onPull)
    return () => window.removeEventListener('tx:sync-pull-complete', onPull)
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
  // v2.14.23 — SKIP this override when the business is in legacy (B-series)
  // mode. enabledEcfTypes is populated from ncf_sequences.enabled=1, which
  // includes any E-series rows left over from certification. Previously the
  // B02 default set by loadBizSettings() was silently reverted to E31/E32
  // by this effect → legacy-mode businesses were issuing e-CFs by mistake.
  // Identified by desktop-Claude audit 2026-04-24 D-b.
  useEffect(() => {
    if (forceNcfType) return // locked by caller (dealership / WO bridge)
    const rawMode = (bizSettings?.fiscal_mode || bizSettings?.facturacion_mode || 'ecf').toLowerCase()
    if (rawMode !== 'ecf' && !fiscalOverride) return // legacy mode — B-series stays put
    if (enabledEcfTypes && enabledEcfTypes.length > 0) {
      setNcfType(prev => {
        const isCurrentEnabled = enabledEcfTypes.some(e => e.code === prev)
        return isCurrentEnabled ? prev : enabledEcfTypes[0].code
      })
    }
  }, [enabledEcfTypes, forceNcfType, bizSettings, fiscalOverride])

  // v2.16.3/4 — Auto-E31 when client has RNC. Carnicería golden path: pick a
  // restaurant/colmadón client → sale silently routes to E31 with no extra
  // taps. The ref tracks the *RNC value* we last auto-promoted so swapping
  // to a new client (different RNC) re-fires, and clearing the RNC fully
  // resets the latch.
  const _autoE31Ref = useRef('')
  useEffect(() => {
    if (forceNcfType) return
    const rawMode = (bizSettings?.fiscal_mode || bizSettings?.facturacion_mode || 'ecf').toLowerCase()
    if (rawMode !== 'ecf' && !fiscalOverride) return
    const rncDigits = String(rnc || '').replace(/\D+/g, '')
    if (!rncDigits) { _autoE31Ref.current = ''; return } // RNC cleared — reset latch
    // DGII: 9 digits = empresa RNC, 11 digits = cédula. Anything else = invalid.
    if (rncDigits.length !== 9 && rncDigits.length !== 11) return
    if (_autoE31Ref.current === rncDigits) return // already promoted for this exact RNC
    const e31Available = !enabledEcfTypes || enabledEcfTypes.some(e => e.code === 'E31')
    if (!e31Available) return
    if (ncfType !== 'E31') setNcfType('E31')
    _autoE31Ref.current = rncDigits
  }, [rnc, enabledEcfTypes, forceNcfType, bizSettings, fiscalOverride, ncfType])

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

  // Accept both historic keys + treat any non-'ecf' value as legacy to match
  // what the provisioning / FirstTimeSetup paths may have written.
  const rawFiscalMode = (bizSettings?.fiscal_mode || bizSettings?.facturacion_mode || 'ecf').toLowerCase()
  const defaultIsLegacy = rawFiscalMode !== 'ecf'
  const isLegacy     = fiscalOverride ? fiscalOverride === 'legacy' : defaultIsLegacy
  const currentType  = isLegacy
    ? LEGACY_TYPES.find(t => t.code === ncfType)
    : ECF_TYPES[ncfType]

  const recibidoNum  = parseFloat(recibido.replace(/,/g, '')) || 0
  const devuelta     = recibidoNum - total
  const showEfectivo = tipo === 'contado' && formaPago === 'efectivo'
  const showMixto    = tipo === 'contado' && formaPago === 'mixto'

  // Mixto totals — sum per-row amounts in cents to avoid float drift.
  const mixtoAssignedCents = mixtoParts.reduce((s, p) => s + Math.round((Number(p.amount) || 0) * 100), 0)
  const totalCents         = Math.round((Number(total) || 0) * 100)
  const mixtoDiffCents     = totalCents - mixtoAssignedCents   // >0 falta, <0 sobrante, =0 exacto
  const mixtoExact         = mixtoDiffCents === 0 && mixtoAssignedCents > 0
  const hasMixtoEmptyRow   = mixtoParts.some(p => !p.amount || Number(p.amount) <= 0)

  // Build a single human-readable reason explaining why the charge button
  // is disabled. Empty string = nothing blocks, button is enabled.
  const lockReason = (() => {
    if (offlineBlock) return lang === 'es' ? 'Red desconectada — esperando conexión' : 'Offline — waiting for connection'
    if (tipo === 'contado' && formaPago === null) return lang === 'es' ? 'Selecciona método de pago' : 'Pick a payment method'
    if (tipo === 'contado' && formaPago === 'efectivo' && recibidoNum < total) return lang === 'es' ? 'Recibido menor que total' : 'Received amount less than total'
    if (tipo === 'contado' && formaPago === 'mixto') {
      if (mixtoParts.length < 2) return lang === 'es' ? 'Mixto requiere al menos 2 métodos' : 'Mixto requires at least 2 methods'
      if (hasMixtoEmptyRow)      return lang === 'es' ? 'Completa el monto de cada parte'  : 'Fill every part amount'
      if (!mixtoExact)           return lang === 'es'
        ? `Las partes no suman el total (faltan ${fmtRD(mixtoDiffCents / 100)})`
        : `Parts must sum to total (missing ${fmtRD(mixtoDiffCents / 100)})`
    }
    // v2.14.26 — credit sale REQUIRES a client. Without one the balance
    // has nowhere to attach (ticketMarkPaid only runs its balance UPDATE
    // inside `if (tipoVenta === 'credito' && clientId)`), so the money
    // was walking away unaccounted. Audit D-a 2026-04-24.
    if (tipo === 'credito' && !selectedClient) {
      return lang === 'es'
        ? 'Venta a crédito requiere seleccionar un cliente'
        : 'Credit sale requires a client'
    }
    if (currentType?.requiresRnc && !validateRNC(rnc)) {
      return lang === 'es'
        ? `${currentType.code} requiere RNC/Cédula (9 o 11 dígitos). Escribe el RNC o cambia a B02 / E32 (Consumidor Final).`
        : `${currentType.code} requires a 9 or 11 digit RNC/Cédula. Type the RNC or switch to B02 / E32 (Final Consumer).`
    }
    if (currentType?.requiresReferencia && (refNCF.trim().length < 11 || refRazon.trim().length === 0)) {
      return lang === 'es' ? 'Este tipo requiere NCF de referencia y razón' : 'This type requires a reference NCF and reason'
    }
    return ''
  })()
  const canSubmit = !lockReason && !offlineBlock

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

  // v2.16.1 patch (#1, #2) — payload builders the parent threads into
  // tickets.create (per-line empleado_supabase_id) and the post-create
  // clientMemberships.consume loop. Resolves stylistEmpId (numeric local id)
  // to the canonical empleado_supabase_id via the loaded salonEmpleados list.
  // v2.16.1 hotfix — reshape an upsell extraLine into a regular cart-item
  // shape so downstream tickets.create auto-deducts inventory, logs retail
  // commission, and prints the line. Membership-redeemed extras keep
  // price=0 (already mutated optimistically in consumeMembershipForLine).
  function extraToItemShape(line, idx) {
    const meta = extraMeta[idx] || {}
    const empId = meta.stylistEmpId
    const emp = empId ? salonEmpleados.find(e => String(e.id) === String(empId)) : null
    return {
      name: line.name,
      price: Number(line.price) || 0,
      qty: line.qty || 1,
      sku: line.sku || null,
      inventory_item_id: line.inventory_item_id || null,
      supabase_id: line.supabase_id || null,
      empleado_supabase_id: emp?.supabase_id || null,
      commission_pct: line.commission_pct ?? meta.commissionPct ?? 10,
    }
  }
  // Single source of truth for what gets persisted, printed, and e-CF'd.
  // Base lines first (preserve their indices for legacy lineMeta lookups),
  // upsell extras appended. NEVER mutate ticket.services.
  function buildEffectiveItems() {
    const base = (ticket?.services || [])
    const extras = extraLines.map(extraToItemShape)
    return [...base, ...extras]
  }
  function buildLineStylistsPayload() {
    if (!isSalon) return []
    const out = []
    const baseLen = (ticket?.services || []).length
    ;(ticket?.services || []).forEach((_svc, idx) => {
      const m = lineMeta[idx] || {}
      const empId = m.stylistEmpId
      if (!empId) return
      const emp = salonEmpleados.find(e => String(e.id) === String(empId))
      const supaId = emp?.supabase_id || null
      if (supaId) out.push({ line_idx: idx, empleado_supabase_id: supaId })
    })
    // Re-key extras against the merged effectiveItems index (baseLen + i).
    extraLines.forEach((_line, i) => {
      const m = extraMeta[i] || {}
      const empId = m.stylistEmpId
      if (!empId) return
      const emp = salonEmpleados.find(e => String(e.id) === String(empId))
      const supaId = emp?.supabase_id || null
      if (supaId) out.push({ line_idx: baseLen + i, empleado_supabase_id: supaId })
    })
    return out
  }
  function buildRedemptionsPayload() {
    if (!isSalon) return []
    const out = []
    const baseLen = (ticket?.services || []).length
    ;(ticket?.services || []).forEach((_svc, idx) => {
      const m = lineMeta[idx] || {}
      if (m.redeemed && m.redemptionId) {
        out.push({ line_idx: idx, client_membership_supabase_id: m.redemptionId })
      }
    })
    extraLines.forEach((_line, i) => {
      const m = extraMeta[i] || {}
      if (m.redeemed && m.redemptionId) {
        out.push({ line_idx: baseLen + i, client_membership_supabase_id: m.redemptionId })
      }
    })
    return out
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
        const mixtoPayload = (formaPago === 'mixto')
          ? mixtoParts.map(p => ({ method: p.method, amount: Math.round(Number(p.amount) * 100) / 100 }))
          : null
        const dominantMethod = mixtoPayload
          ? mixtoPayload.slice().sort((a, b) => b.amount - a.amount)[0].method
          : formaPago
        const effectiveItems = buildEffectiveItems()
        onConfirm({
          ticketId:  ticket.id,
          ticketNo:  ticket.ticketNo,
          clientId:  selectedClient?.id || null,
          // v2.16.10 — Supabase tickets table has NO client_id column. Web
          // path MUST send client_supabase_id + client_name snapshot or the
          // ticket lands orphaned (clients.balance never updates → Credits
          // screen empty). Audited 2026-04-30 — every Ranoza ticket prior
          // had client_supabase_id=NULL.
          clientSupabaseId: selectedClient?.supabase_id || null,
          clientName: selectedClient?.name || null,
          ncfType, rnc, rncName, tipo,
          formaPago: tipo === 'credito' ? 'credit' : dominantMethod,
          payment_parts: mixtoPayload,
          recibido:  recibidoNum,
          devuelta:  showEfectivo ? devuelta : null,
          comentario, total, descuento, descuentoReason: descuentoReason.trim() || null, subtotal, itbis,
          mac_jti:   _macJtiRef.current || null,
          paidAt:    new Date(),
          // v2.16.1 hotfix — merged base + upsell-tile lines. Downstream
          // tickets.create auto-deducts inventory, logs retail commission,
          // and the printer/e-CF builder iterate from this single source.
          items:     effectiveItems,
          // v2.16.1 patch (#1, #2) — surface per-line stylist credit (ticket_items.empleado_supabase_id)
          // and pending membership redemptions (caller awaits salon.clientMemberships.consume
          // post-tickets.create using the resulting ticket_supabase_id).
          lineStylists: buildLineStylistsPayload(),
          redemptions:  buildRedemptionsPayload(),
          ecf:       legacyResult,
        })
        awardLoyaltyPoints(selectedClient, total, ticket?.supabase_id || null)
        // v2.7.1 — commit staged redemption (burn points + ledger row)
        // SAFETY: ticket + descuento already booked. If burn fails, customer
        // got the discount AND kept the points. Surface critically so cashier
        // can manually adjust balance.
        if (loyaltyRedemption && loyaltyEnabled && selectedClient?.id) {
          if (api?.clients?.loyaltyRedeem) {
            Promise.resolve(api.clients.loyaltyRedeem({
              clientId: selectedClient.id,
              clientSupabaseId: selectedClient.supabase_id || null,
              ticketSupabaseId: ticket?.supabase_id || null,
              points: loyaltyRedemption.points,
              notes: `redeem_ticket:${ticket?.id ?? ''}`,
            })).catch(err => {
              console.error('[loyalty] redeem failed after sale (legacy path)', err)
              const redeemFailEvt = {
                event_type: 'loyalty_redeem_failed', severity: 'critical',
                target_type: 'client', target_id: String(selectedClient.id),
                target_name: selectedClient?.name || null,
                amount: loyaltyRedemption.discount,
                reason: 'Redención falló post-venta — ajustar puntos manualmente',
                metadata: { points: loyaltyRedemption.points, ticket_id: ticket?.id ?? null, error: err?.message || String(err) },
              }
              // FIX-HIGH-8 — fall back to IDB queue so the critical audit row
              // gets retried even if the live record() write fails.
              ;(async () => {
                try { await api?.activity?.record?.(redeemFailEvt) }
                catch { try { await enqueueActivity(redeemFailEvt) } catch {} }
              })()
              try { window.alert(`URGENTE: No se pudieron canjear ${loyaltyRedemption.points} puntos del cliente ${selectedClient?.name || ''}. El descuento se aplicó. Ajusta los puntos manualmente.`) } catch {}
            })
          }
        }
      }
      return
    }

    setEcfState('submitting')
    setSubmitStep(0)
    setEcfError('')

    const t1 = setTimeout(() => setSubmitStep(1), 400)
    const t2 = setTimeout(() => setSubmitStep(2), 850)

    // For e-CF XML, collapse 'mixto' to the dominant method — DGII doesn't
    // model split tender. The full parts[] still persists locally on the ticket
    // (payment_parts JSONB) for cuadre / 606 breakdown.
    const ecfFormaPago = (formaPago === 'mixto' && mixtoParts.length)
      ? mixtoParts.slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))[0].method
      : formaPago

    try {
      const tipoNum = ncfType.replace('E', '') // 'E31' → '31'
      const seq     = ncfSeqs.find(s => s.type === ncfType)

      // Convert valid_until yyyy-mm-dd → dd-mm-yyyy for ef2.do
      let fechaVencimiento = null
      if (seq?.valid_until && !ECF_TYPES[ncfType]?.noVencimiento) {
        const [y, m, d] = seq.valid_until.split('-')
        fechaVencimiento = `${d}-${m}-${y}`
      }

      // Reserve the next eNCF from the local ncf_sequences BEFORE sending
      // to DGII. Same pattern as the legacy path (line ~865). Without this
      // invoiceData.eNCF is undefined, main.js dgii:submit eventually tries
      // ecfSubmissionAdd({ encf: undefined, ... }) and SQLite rejects with
      // 'NOT NULL constraint failed: ecf_submissions.encf'.
      let eNCF = null
      try {
        eNCF = await api?.ncf?.next?.(ncfType) || null
      } catch (err) {
        throw new Error(`No se pudo reservar el NCF ${ncfType}: ${err?.message || err}`)
      }
      if (!eNCF) {
        // Last-ditch fallback: synthesise from the in-memory sequence.
        const next = (seq?.current_number || 0) + 1
        const prefix = seq?.prefix || ncfType
        eNCF = `${prefix}${String(next).padStart(8, '0')}`
      }

      // DGII requires a valid 9-digit emisor RNC that matches the installed
      // cert. Read from the KV first, fall back to the top-level businesses
      // column (empresa.rnc). Strip dashes/spaces either way so the XML
      // emits digits only.
      const emisorRncRaw = (bizSettings?.biz_rnc || bizSettings?.rnc || '').toString().replace(/[-\s]/g, '')
      if (!/^\d{9}$/.test(emisorRncRaw)) {
        throw new Error(lang === 'es'
          ? 'RNC del emisor no configurado. Ve a Admin → Mi Empresa y guarda el RNC antes de emitir e-CF.'
          : 'Emisor RNC not configured. Go to Admin → My Company and save the RNC before emitting e-CF.')
      }

      const invoiceData = {
        // ef2.do format
        eNCF,
        tipoECF: tipoNum,
        emisor: {
          rnc:       emisorRncRaw,
          nombre:    bizSettings?.biz_name    || bizSettings?.name    || 'Terminal X',
          direccion: bizSettings?.biz_address || bizSettings?.address || 'Santo Domingo',
          email:     bizSettings?.biz_email   || bizSettings?.email   || '',
        },
        comprador: ECF_TYPES[ncfType]?.requiresRnc && validateRNC(rnc) ? {
          rnc:       rnc.replace(/[-\s]/g, ''),
          nombre:    rncName || rnc,
          email:     selectedClient?.email   || '',
          direccion: selectedClient?.address || 'Santo Domingo',
        } : null,
        totales: { subtotal, itbis, total },
        // v2.16.1 hotfix — include upsell extraLines so e-CF XML matches
        // the charged total + printed receipt.
        items: buildEffectiveItems().map(s => ({
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
        formaPago:  tipo === 'credito' ? 'credit' : ecfFormaPago,
        ticket:     { id: ticket.id, ticketNo: ticket.ticketNo, vehicle: ticket.vehicle, services: buildEffectiveItems() },
        comentario,
        paidAt:     new Date(),
      }

      // Pass `api` so the web build routes through the Supabase-backed proxy
      // (api.dgii_ecf → /api/ecf-sign). Without it, web users silently fall
      // back to the local stub and emit fake e-CFs.
      const result = await signAndSubmitECF(invoiceData, api)
      clearTimeout(t1); clearTimeout(t2)
      // 2026-04-30 — parent-acceptance gate. If the desktop dgii:submit IPC
      // or web /api/ecf-sign returned ok=false with a parent_* code, this
      // is a Nota de Crédito whose factura padre is not yet ACEPTADA on
      // DGII. Show the cashier a clear message and DO NOT mark the ticket
      // confirmed — they can retry once the parent settles.
      if (result?.ok === false && (result.code === 'parent_pending' || result.code === 'parent_unknown' || result.code === 'parent_rejected' || result.code === 'parent_missing')) {
        setEcfResult(result)
        setEcfState('error')
        setEcfError(result.error || 'Esperando aceptación de la factura padre antes de enviar la nota de crédito.')
        return
      }
      setEcfResult(result)
      setEcfState('success')
      if (!confirmedRef.current) {
        confirmedRef.current = true
        const mixtoPayload = (formaPago === 'mixto')
          ? mixtoParts.map(p => ({ method: p.method, amount: Math.round(Number(p.amount) * 100) / 100 }))
          : null
        const dominantMethod = mixtoPayload
          ? mixtoPayload.slice().sort((a, b) => b.amount - a.amount)[0].method
          : formaPago
        const effectiveItems = buildEffectiveItems()
        onConfirm({
          ticketId:  ticket.id,
          ticketNo:  ticket.ticketNo,
          clientId:  selectedClient?.id || null,
          // v2.16.10 — Supabase tickets table has NO client_id column. Web
          // path MUST send client_supabase_id + client_name snapshot or the
          // ticket lands orphaned (clients.balance never updates → Credits
          // screen empty). Audited 2026-04-30 — every Ranoza ticket prior
          // had client_supabase_id=NULL.
          clientSupabaseId: selectedClient?.supabase_id || null,
          clientName: selectedClient?.name || null,
          ncfType, rnc, rncName, tipo,
          formaPago: tipo === 'credito' ? 'credit' : dominantMethod,
          payment_parts: mixtoPayload,
          recibido:  recibidoNum,
          devuelta:  showEfectivo ? devuelta : null,
          comentario, total, descuento, descuentoReason: descuentoReason.trim() || null, subtotal, itbis,
          mac_jti:   _macJtiRef.current || null,
          paidAt:    new Date(),
          // v2.16.1 hotfix — merged base + upsell-tile lines. Downstream
          // tickets.create auto-deducts inventory, logs retail commission,
          // and the printer/e-CF builder iterate from this single source.
          items:     effectiveItems,
          // v2.16.1 patch (#1, #2) — surface per-line stylist credit (ticket_items.empleado_supabase_id)
          // and pending membership redemptions (caller awaits salon.clientMemberships.consume
          // post-tickets.create using the resulting ticket_supabase_id).
          lineStylists: buildLineStylistsPayload(),
          redemptions:  buildRedemptionsPayload(),
          ecf:       result,
        })
        awardLoyaltyPoints(selectedClient, total, ticket?.supabase_id || null)
        // v2.7.1 — commit staged redemption (burn points + ledger row)
        // SAFETY: e-CF + ticket already booked. If burn fails, surface a
        // critical alert so cashier can adjust the client's points manually.
        if (loyaltyRedemption && loyaltyEnabled && selectedClient?.id) {
          if (api?.clients?.loyaltyRedeem) {
            Promise.resolve(api.clients.loyaltyRedeem({
              clientId: selectedClient.id,
              clientSupabaseId: selectedClient.supabase_id || null,
              ticketSupabaseId: ticket?.supabase_id || null,
              points: loyaltyRedemption.points,
              notes: `redeem_ticket:${ticket?.id ?? ''}`,
            })).catch(err => {
              console.error('[loyalty] redeem failed after sale (e-CF path)', err)
              const redeemFailEvt = {
                event_type: 'loyalty_redeem_failed', severity: 'critical',
                target_type: 'client', target_id: String(selectedClient.id),
                target_name: selectedClient?.name || null,
                amount: loyaltyRedemption.discount,
                reason: 'Redención falló post-venta — ajustar puntos manualmente',
                metadata: { points: loyaltyRedemption.points, ticket_id: ticket?.id ?? null, ecf: result?.eNCF || null, error: err?.message || String(err) },
              }
              // FIX-HIGH-8 — fall back to IDB queue on live-write failure.
              ;(async () => {
                try { await api?.activity?.record?.(redeemFailEvt) }
                catch { try { await enqueueActivity(redeemFailEvt) } catch {} }
              })()
              try { window.alert(`URGENTE: No se pudieron canjear ${loyaltyRedemption.points} puntos del cliente ${selectedClient?.name || ''}. El descuento se aplicó. Ajusta los puntos manualmente.`) } catch {}
            })
          }
        }
      }

      // Use qrLink from DGII directly; fall back to QR generation
      getQRCode(result.eNCF, result)
        .then(({ qrUrl: url }) => setQrUrl(url))
        .catch(() => { /* QR optional */ })

    } catch (err) {
      clearTimeout(t1); clearTimeout(t2)
      // v2.16.10 — Go-Live gate: in TEST MODE the ecf service throws
      // TEST_MODE_NO_DGII. Treat it as a "soft success": persist the ticket
      // locally (no e-CF), let the parent close the cart, and surface a banner
      // confirming the test save. The persistent crimson frame already tells
      // the cashier the POS isn't live.
      if (err?.code === 'TEST_MODE_NO_DGII' || /TEST_MODE_NO_DGII/.test(err?.message || '')) {
        setEcfResult(null)
        setEcfState('success')
        if (!confirmedRef.current) {
          confirmedRef.current = true
          const mixtoPayload = (formaPago === 'mixto')
            ? mixtoParts.map(p => ({ method: p.method, amount: Math.round(Number(p.amount) * 100) / 100 }))
            : null
          const dominantMethod = mixtoPayload
            ? mixtoPayload.slice().sort((a, b) => b.amount - a.amount)[0].method
            : formaPago
          const effectiveItems = buildEffectiveItems()
          onConfirm({
            ticketId:  ticket.id,
            ticketNo:  ticket.ticketNo,
            clientId:  selectedClient?.id || null,
            ncfType, rnc, rncName, tipo,
            formaPago: tipo === 'credito' ? 'credit' : dominantMethod,
            payment_parts: mixtoPayload,
            recibido:  recibidoNum,
            devuelta:  showEfectivo ? devuelta : null,
            comentario, total, descuento, descuentoReason: descuentoReason.trim() || null, subtotal, itbis,
            mac_jti:   _macJtiRef.current || null,
            paidAt:    new Date(),
            items:     effectiveItems,
            lineStylists: buildLineStylistsPayload(),
            redemptions:  buildRedemptionsPayload(),
            ecf:       null,
            testMode:  true,
          })
        }
        return
      }
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

        {/* v2.7.1 — offline banner (web PWA only) */}
        {offlineBlock && (
          <div className="px-4 py-2 bg-[#b3001e] text-white text-[12px] font-semibold flex items-center gap-2 shrink-0">
            <AlertTriangle size={14} />
            {lang === 'es'
              ? 'Sin conexión — cobro deshabilitado. La venta no se puede confirmar offline.'
              : 'Offline — checkout disabled. Cannot confirm sale without connection.'}
          </div>
        )}

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

        {/* ── Prerequisites warning banner ────────────────────────────────── */}
        {!prereqs.loading && prereqs.missing.length > 0 && ecfState !== 'success' && (
          <div className="bg-amber-50 dark:bg-amber-500/10 border-b border-amber-300 dark:border-amber-500/30 px-4 py-3 shrink-0">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-bold text-amber-900 dark:text-amber-200">
                  {lang === 'es' ? 'Configuración pendiente' : 'Setup pending'}
                </p>
                <ul className="mt-1 space-y-0.5 text-[11px] text-amber-800 dark:text-amber-300">
                  {prereqs.missing.map(m => <li key={m.k}>• {lang === 'es' ? m.es : m.en}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}

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
                  {ticket.services.map((svc, i) => {
                    const meta = lineMeta[i] || {}
                    const lineTotal = (svc.price || 0) * (svc.qty || 1)
                    const pct = isSalon ? getLineCommissionPct(svc, meta) : null
                    return (
                      <div key={i} className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[13px] text-slate-700 dark:text-white">
                              {(svc.qty || 1) > 1 && svc.weight == null ? `${svc.qty}x ` : ''}{svc.name}
                            </span>
                            {meta.redeemed && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-[#b3001e]/10 text-[#b3001e] border border-[#b3001e]/30">
                                <Award size={9} /> {lang === 'es' ? 'Membresía' : 'Membership'}
                              </span>
                            )}
                          </div>
                          {svc.weight != null && svc.unit && svc.price_per_unit != null && (
                            <p className="text-[10px] text-slate-400 tabular-nums">{Number(svc.weight).toFixed(3)} {svc.unit} × {fmtRD(svc.price_per_unit)}/{svc.unit}</p>
                          )}
                          {isSalon && salonEmpleados.length > 0 && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <Scissors size={10} className="text-slate-400" />
                              <select
                                value={meta.stylistEmpId || ''}
                                onChange={e => pickLineStylist(i, 'base', e.target.value)}
                                className="text-[10px] py-0.5 px-1.5 rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 focus:outline-none focus:border-[#b3001e]"
                              >
                                <option value="">— {lang === 'es' ? 'estilista' : 'stylist'} —</option>
                                {salonEmpleados.map(emp => (
                                  <option key={emp.id} value={String(emp.id)}>{emp.nombre}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <span className={`text-[13px] font-medium tabular-nums ${meta.redeemed ? 'text-slate-400 line-through' : 'text-slate-600 dark:text-white/60'}`}>
                            {fmtRD(lineTotal)}
                          </span>
                          {isSalon && !meta.redeemed && pct != null && (
                            <p className="text-[9px] text-slate-400 dark:text-white/40 tabular-nums">
                              {lang === 'es' ? 'comisión' : 'commission'}: {pct}%
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {/* Extra lines added by upsell tiles */}
                  {extraLines.map((svc, i) => {
                    const meta = extraMeta[i] || {}
                    const lineTotal = (svc.price || 0) * (svc.qty || 1)
                    const pct = isSalon ? getLineCommissionPct(svc, meta) : null
                    return (
                      <div key={`extra-${i}`} className="flex justify-between items-start gap-2 pl-2 border-l-2 border-[#b3001e]/30">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[13px] text-slate-700 dark:text-white">{svc.name}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setExtraLines(arr => arr.filter((_, idx) => idx !== i))
                                setExtraMeta(arr => arr.filter((_, idx) => idx !== i))
                              }}
                              className="text-slate-300 hover:text-red-500"
                              title={lang === 'es' ? 'Quitar' : 'Remove'}
                            >
                              <X size={11} />
                            </button>
                            {meta.redeemed && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-[#b3001e]/10 text-[#b3001e] border border-[#b3001e]/30">
                                <Award size={9} /> {lang === 'es' ? 'Membresía' : 'Membership'}
                              </span>
                            )}
                          </div>
                          {salonEmpleados.length > 0 && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <Scissors size={10} className="text-slate-400" />
                              <select
                                value={meta.stylistEmpId || ''}
                                onChange={e => pickLineStylist(i, 'extra', e.target.value)}
                                className="text-[10px] py-0.5 px-1.5 rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-white/70 focus:outline-none focus:border-[#b3001e]"
                              >
                                <option value="">— {lang === 'es' ? 'estilista' : 'stylist'} —</option>
                                {salonEmpleados.map(emp => (
                                  <option key={emp.id} value={String(emp.id)}>{emp.nombre}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <span className={`text-[13px] font-medium tabular-nums ${meta.redeemed ? 'text-slate-400 line-through' : 'text-slate-600 dark:text-white/60'}`}>
                            {fmtRD(lineTotal)}
                          </span>
                          {pct != null && !meta.redeemed && (
                            <p className="text-[9px] text-slate-400 dark:text-white/40 tabular-nums">
                              {lang === 'es' ? 'comisión' : 'commission'}: {pct}%
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {/* Salon cross-sell tip — surfaced when the cart hits a cut/color/treatment keyword */}
                {upsellTip && (
                  <div className="mb-3 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-[#b3001e]/5 border border-[#b3001e]/20 text-[12px] text-[#b3001e] dark:text-[#ff6b7e]">
                    <Gift size={13} className="mt-0.5 shrink-0" />
                    <span className="font-semibold leading-snug">{upsellTip}</span>
                  </div>
                )}
                {/* v2.7.1 — loyalty earn preview + redeem (cross-vertical, plan-gated) */}
                {loyaltyEnabled && selectedClient?.id && (() => {
                  const basePts      = loyaltyPointsFor(total, loyaltyCfg.pointsRatio)
                  const currentTier  = selectedClient.loyalty_tier || 'bronze'
                  const mult         = tierMultiplier(currentTier)
                  const earn         = Math.round(basePts * mult * 100) / 100
                  const currentPoints = Math.max(0, Number(selectedClient.loyalty_points) || 0)
                  const redeemRatio = loyaltyCfg.redemptionRatio // pts per RD$1 off
                  const minRedeemPts = Math.max(1, Math.round(50 * redeemRatio)) // RD$50 minimum
                  const canRedeem = currentPoints >= minRedeemPts && !loyaltyRedemption
                  const redeemOptions = [50, 100, 200, 500]
                    .map(rd => ({ discount: rd, points: Math.round(rd * redeemRatio) }))
                    .filter(o => o.points <= currentPoints && o.discount <= totalGross - manualDescuento)
                  return (
                    <div className="mb-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 p-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-white/70">
                          <Gift size={12} className="text-[#b3001e]" />
                          <span>
                            {lang === 'es'
                              ? `Saldo: ${currentPoints.toLocaleString()} pts`
                              : `Balance: ${currentPoints.toLocaleString()} pts`}
                          </span>
                          <LoyaltyTierBadge tier={currentTier} lang={lang} />
                          {earn > 0 && (
                            <span className="text-slate-400 dark:text-white/40">
                              · {lang === 'es' ? `ganará ${earn} pts` : `earns ${earn} pts`}
                              {mult > 1 && (
                                <span className="ml-1 font-bold text-[#b3001e]">×{mult}</span>
                              )}
                            </span>
                          )}
                        </div>
                        {canRedeem && (
                          <button
                            type="button"
                            onClick={() => setLoyaltyPickerOpen(o => !o)}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-[#b3001e] text-white hover:bg-[#8c0017]"
                          >
                            {lang === 'es' ? 'Canjear' : 'Redeem'}
                          </button>
                        )}
                        {loyaltyRedemption && (
                          <button
                            type="button"
                            onClick={() => { setLoyaltyRedemption(null); setLoyaltyPickerOpen(false) }}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-[#b3001e] text-[#b3001e] hover:bg-[#b3001e]/5"
                          >
                            {lang === 'es' ? 'Quitar canje' : 'Remove redeem'}
                          </button>
                        )}
                      </div>
                      {loyaltyPickerOpen && canRedeem && (
                        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-200 dark:border-white/10">
                          {redeemOptions.length === 0 ? (
                            <span className="text-[10px] text-slate-400">{lang === 'es' ? 'Sin opciones disponibles' : 'No options available'}</span>
                          ) : redeemOptions.map(o => (
                            <button
                              key={o.discount}
                              type="button"
                              onClick={() => { setLoyaltyRedemption({ points: o.points, discount: o.discount }); setLoyaltyPickerOpen(false) }}
                              className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-white dark:bg-black border border-slate-300 dark:border-white/20 text-slate-700 dark:text-white hover:border-[#b3001e]"
                            >
                              {o.points} pts → RD${o.discount}
                            </button>
                          ))}
                        </div>
                      )}
                      {loyaltyRedemption && (
                        <div className="text-[11px] font-semibold text-[#b3001e]">
                          {lang === 'es'
                            ? `Canjeando ${loyaltyRedemption.points} pts por RD$${loyaltyRedemption.discount} de descuento`
                            : `Redeeming ${loyaltyRedemption.points} pts for RD$${loyaltyRedemption.discount} off`}
                        </div>
                      )}
                    </div>
                  )
                })()}
                {/* Legacy salon loyalty preview (back-compat when program disabled) */}
                {!loyaltyEnabled && isSalon && selectedClient?.id && loyaltyPointsFor(total) > 0 && (
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

                  {/* Mode toggle — flip between legacy NCF (B-series) and
                      e-CF (E-series) per-sale. Locked when caller forces a
                      specific type (dealership E31, work-order bridges). */}
                  {!forceNcfType && (
                    <div className="inline-flex items-center gap-1 mb-2 p-0.5 bg-slate-100 dark:bg-white/5 rounded-lg text-[11px] font-semibold">
                      <button
                        type="button"
                        onClick={() => { setFiscalOverride('legacy'); setNcfType('B02') }}
                        className={`px-2.5 py-1 rounded-md transition-all ${isLegacy ? 'bg-white dark:bg-white/10 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-white/50 hover:text-slate-700 dark:hover:text-white/80'}`}
                      >
                        NCF
                      </button>
                      <button
                        type="button"
                        onClick={() => { setFiscalOverride('ecf'); setNcfType((enabledEcfTypes && enabledEcfTypes[0]?.code) || 'E32') }}
                        className={`px-2.5 py-1 rounded-md transition-all ${!isLegacy ? 'bg-white dark:bg-white/10 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-white/50 hover:text-slate-700 dark:hover:text-white/80'}`}
                      >
                        e-CF
                      </button>
                    </div>
                  )}

                  {/* v2.16.3 — Auto-E31 Mayoreo pill */}
                  {!isLegacy && ncfType === 'E31' && _autoE31Ref.current && (
                    <div className="mb-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#b3001e] text-white text-[10px] font-bold uppercase tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      {lang === 'es' ? 'E31 Mayoreo · auto' : 'E31 Wholesale · auto'}
                    </div>
                  )}

                  {/* Legacy B01/B02/SIN buttons */}
                  {isLegacy ? (
                    <div className="flex flex-wrap gap-2">
                      {LEGACY_TYPES.map(lt => (
                        <ToggleBtn key={lt.code} active={ncfType === lt.code} onClick={() => { if (!forceNcfType) setNcfType(lt.code) }}>
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
                        <ToggleBtn key={ecf.code} active={ncfType === ecf.code} onClick={() => { if (!forceNcfType) setNcfType(ecf.code) }}>
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
                          onChange={e => { setRnc(formatRncCedula(e.target.value)); setRncName('') }}
                          onKeyDown={e => e.key === 'Enter' && lookupRnc()}
                          placeholder={tl('rnc', lang)}
                          inputMode="numeric"
                          maxLength={RNC_CEDULA_MAX_LENGTH}
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

              {/* ── Salon upsell tiles + commission breakdown + membership ── */}
              {isSalon && (
                <>
                  {salonUpsellItems.length > 0 && (
                    <div>
                      <SectionLabel>{lang === 'es' ? 'Productos para vender' : 'Add a retail product'}</SectionLabel>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {salonUpsellItems.map(item => {
                          const initials = (item.name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => addUpsellItem(item)}
                              className="flex flex-col items-center gap-1 p-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-[#b3001e] hover:bg-[#b3001e]/5 transition-colors"
                            >
                              {item.photo_url || item.image_url ? (
                                <img src={item.photo_url || item.image_url} alt="" className="w-10 h-10 rounded-lg object-cover" />
                              ) : (
                                <div className="w-10 h-10 rounded-lg bg-[#b3001e]/10 text-[#b3001e] flex items-center justify-center text-[11px] font-bold">
                                  {initials}
                                </div>
                              )}
                              <p className="text-[10px] font-semibold text-slate-700 dark:text-white text-center leading-tight line-clamp-2">{item.name}</p>
                              <p className="text-[10px] font-bold text-[#b3001e] tabular-nums">RD${Number(item.price || 0).toFixed(0)}</p>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Membership "Usar Membresía" button */}
                  {hasFeature?.('salon_memberships') && eligibleMemberships.length > 0 && (
                    <div className="rounded-xl border border-[#b3001e]/30 bg-[#b3001e]/5 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Award size={14} className="text-[#b3001e]" />
                          <span className="text-[12px] font-bold text-[#b3001e]">
                            {lang === 'es' ? 'Membresía disponible' : 'Membership available'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowMembershipPicker(o => !o)}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[#b3001e] text-white hover:bg-[#8c0017]"
                        >
                          {lang === 'es' ? 'Usar membresía' : 'Use membership'}
                        </button>
                      </div>
                      {showMembershipPicker && (
                        <div className="mt-2 space-y-1.5">
                          {eligibleMemberships.map(m => (
                            <div key={m.supabase_id} className="flex items-center justify-between gap-2">
                              <div>
                                <p className="text-[12px] font-semibold text-slate-700 dark:text-white">
                                  {m.membership_nombre || (lang === 'es' ? 'Membresía' : 'Membership')}
                                </p>
                                <p className="text-[10px] text-slate-500 dark:text-white/60">
                                  {Number(m.sessions_remaining || 0)} {lang === 'es' ? 'sesiones restantes' : 'sessions left'}
                                </p>
                              </div>
                              <div className="flex flex-col gap-1">
                                {/* For each redeemable cart line offer a quick "apply to". */}
                                {(ticket?.services || []).map((svc, i) => {
                                  const meta = lineMeta[i]
                                  if (meta?.redeemed) return null
                                  // Membership filtered by service in eligibleMemberships;
                                  // any-service memberships apply to all lines.
                                  if (m.service_supabase_id && (svc.service_supabase_id || svc.supabase_id) !== m.service_supabase_id) return null
                                  return (
                                    <button
                                      key={`${m.supabase_id}-${i}`}
                                      type="button"
                                      onClick={() => consumeMembershipForLine('base', i, m)}
                                      className="px-2 py-1 rounded text-[10px] font-bold border border-[#b3001e]/40 text-[#b3001e] hover:bg-[#b3001e] hover:text-white transition-colors"
                                    >
                                      {lang === 'es' ? 'Aplicar a' : 'Apply to'} "{svc.name}"
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Commission breakdown footer (Estilista gana / Negocio gana) */}
                  {(commissionBreakdown.stylistEarned > 0 || commissionBreakdown.businessEarned > 0) && (
                    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-3">
                      <SectionLabel>{lang === 'es' ? 'Comisiones' : 'Commissions'}</SectionLabel>
                      <div className="grid grid-cols-2 gap-2 text-center">
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-0.5">
                            {lang === 'es' ? 'Estilista gana' : 'Stylist earns'}
                          </p>
                          <p className="text-[14px] font-bold text-[#b3001e] tabular-nums">
                            {fmtRD(commissionBreakdown.stylistEarned)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-0.5">
                            {lang === 'es' ? 'Negocio gana' : 'Business earns'}
                          </p>
                          <p className="text-[14px] font-bold text-slate-800 dark:text-white tabular-nums">
                            {fmtRD(commissionBreakdown.businessEarned)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Forma de pago */}
              {tipo === 'credito' ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <p className="text-[12px] text-amber-700 font-medium">{tl('creditNote', lang)}</p>
                </div>
              ) : (
                <div>
                  <SectionLabel>{tl('formaPago', lang)}</SectionLabel>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
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

                  {/* Mixto — inline split editor (v2.14.34) */}
                  {showMixto && (
                    <div className="mt-3 bg-slate-50 dark:bg-white/5 rounded-xl p-4 space-y-3 border border-slate-200 dark:border-white/10">
                      <div className="flex items-center justify-between">
                        <SectionLabel>{lang === 'es' ? 'Partes del pago' : 'Payment parts'}</SectionLabel>
                        <button
                          type="button"
                          onClick={() => {
                            const remainingCents = Math.max(0, totalCents - mixtoAssignedCents)
                            setMixtoParts(arr => arr.length >= MIXTO_MAX_PARTS ? arr : [
                              ...arr,
                              { method: 'efectivo', amount: remainingCents > 0 ? (remainingCents / 100).toFixed(2) : '' },
                            ])
                          }}
                          disabled={mixtoParts.length >= MIXTO_MAX_PARTS}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 disabled:opacity-40"
                        >
                          <Plus size={12} strokeWidth={2.5} /> {lang === 'es' ? 'Agregar parte' : 'Add part'}
                        </button>
                      </div>

                      <div className="space-y-2">
                        {mixtoParts.map((part, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <select
                              value={part.method}
                              onChange={e => {
                                const m = e.target.value
                                setMixtoParts(arr => arr.map((p, i) => i === idx ? { ...p, method: m } : p))
                              }}
                              className="flex-[1.2] bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2 text-[12px] font-semibold text-slate-700 dark:text-white focus:outline-none focus:border-sky-400"
                            >
                              {MIXTO_METHODS.map(m => (
                                <option key={m.id} value={m.id}>{lang === 'es' ? m.es : m.en}</option>
                              ))}
                            </select>
                            <div className="flex-1 flex items-center bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2 focus-within:border-sky-400">
                              <span className="text-slate-400 dark:text-white/40 text-[11px] mr-1.5">RD$</span>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={part.amount}
                                onChange={e => {
                                  const v = e.target.value
                                  setMixtoParts(arr => arr.map((p, i) => i === idx ? { ...p, amount: v } : p))
                                }}
                                placeholder="0.00"
                                className="flex-1 bg-transparent text-[13px] font-semibold text-slate-800 dark:text-white focus:outline-none min-w-0"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => setMixtoParts(arr => arr.length <= 2 ? arr : arr.filter((_, i) => i !== idx))}
                              disabled={mixtoParts.length <= 2}
                              title={lang === 'es' ? 'Eliminar parte' : 'Remove part'}
                              className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/60 hover:border-red-300 hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Minus size={14} strokeWidth={2.5} />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-white/10">
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wider">
                          {lang === 'es' ? 'Asignado' : 'Assigned'} · <span className="text-slate-800 dark:text-white">{fmtRD(mixtoAssignedCents / 100)}</span>
                          <span className="mx-1.5 text-slate-300 dark:text-white/20">/</span>
                          <span className="text-slate-800 dark:text-white">{fmtRD(total)}</span>
                        </span>
                        <span className={`text-[12px] font-bold ${
                          mixtoExact ? 'text-emerald-600 dark:text-emerald-400'
                          : mixtoDiffCents > 0 ? 'text-red-500'
                          : 'text-amber-500'
                        }`}>
                          {mixtoExact
                            ? (lang === 'es' ? 'Exacto ✓' : 'Exact ✓')
                            : mixtoDiffCents > 0
                              ? `${lang === 'es' ? 'Falta' : 'Missing'} ${fmtRD(mixtoDiffCents / 100)}`
                              : `${lang === 'es' ? 'Sobrante' : 'Excess'} ${fmtRD(-mixtoDiffCents / 100)}`}
                        </span>
                      </div>
                    </div>
                  )}
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

              {/* Descuento — gated by Mi Empresa → Descuentos al cobrar */}
              {discountsEnabled && (
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
              )}

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
            {lockReason && !isSubmitting && (
              <div className="px-4 md:px-6 pt-2 pb-1 shrink-0">
                <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                  <AlertCircle size={12} className="mt-0.5 shrink-0" />
                  <span>{lockReason}</span>
                </p>
              </div>
            )}
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
                title={lockReason || ''}
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
          onApprove={({ mac_jti } = {}) => {
            _gateApprovedRef.current = true
            _macJtiRef.current = mac_jti || null
            setGateOpen(false)
            setTimeout(() => handleConfirm(), 0)
          }}
          onCancel={() => setGateOpen(false)}
        />
      )}
    </div>
  )
}
