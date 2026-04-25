import { useState, useEffect } from 'react'
import { ArrowLeft, ArrowRight, X as XIcon, Printer, Check, QrCode } from 'lucide-react'
import { t, fmtRD, nextFakeNCF, fakeSecurityCode } from './demoMockData'

// ─── Sticky Demo Banner ────────────────────────────────────────────────────
export function DemoBanner({ lang, vertical }) {
  const utm = `utm_source=demo&utm_medium=demo_${vertical}`
  return (
    <div data-demo-banner className="sticky top-0 z-50 bg-black text-white border-b-2 border-[#b3001e]">
      <div className="max-w-[1600px] mx-auto px-3 sm:px-5 py-2.5 flex items-center gap-3 sm:gap-4">
        <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#b3001e] text-[10px] font-black tracking-[2px] uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          {t(lang, 'Modo Demo', 'Demo Mode')}
        </span>
        <span className="text-[12px] sm:text-sm font-semibold flex-1 truncate">
          {t(lang,
            'Estás explorando Terminal X · los cambios no se guardan',
            "You're exploring Terminal X · changes are not saved"
          )}
        </span>
        <a
          href="/"
          className="hidden md:inline-flex items-center gap-1.5 text-[12px] font-bold text-white/70 hover:text-white transition-colors"
        >
          <ArrowLeft size={14} />
          {t(lang, 'Volver', 'Back')}
        </a>
        <a
          href={`/signup?plan=pro_plus&${utm}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#b3001e] hover:bg-[#cc1a33] text-white text-[11px] sm:text-xs font-black tracking-wide uppercase transition-all hover:shadow-lg hover:shadow-[#b3001e]/30"
        >
          {t(lang, 'Probar Gratis 7 días', 'Free 7-day Trial')}
          <ArrowRight size={13} />
        </a>
      </div>
    </div>
  )
}

// ─── Toast ─────────────────────────────────────────────────────────────────
export function DemoToast({ message, ctaLabel, ctaHref, onClose }) {
  useEffect(() => {
    if (!message) return
    const t = setTimeout(onClose, 6000)
    return () => clearTimeout(t)
  }, [message, onClose])
  if (!message) return null
  return (
    <div className="fixed bottom-6 right-6 z-[60] max-w-sm bg-black text-white rounded-xl shadow-2xl border border-[#b3001e]/40 overflow-hidden animate-[slideIn_0.3s_ease]">
      <div className="p-4 flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-[#b3001e]/20 flex items-center justify-center flex-shrink-0">
          <Check size={16} className="text-[#b3001e]" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold leading-snug">{message}</p>
          {ctaHref && (
            <a
              href={ctaHref}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-[#b3001e] hover:text-[#cc1a33]"
            >
              {ctaLabel} <ArrowRight size={12} />
            </a>
          )}
        </div>
        <button onClick={onClose} className="text-white/40 hover:text-white">
          <XIcon size={16} />
        </button>
      </div>
    </div>
  )
}

// ─── Fake e-CF success modal — looks just like real CobrarModal success ────
export function DemoCobrarModal({ open, onClose, total, lang, vertical, items = [], paymentMethod = 'efectivo' }) {
  const [ncf, setNcf] = useState('')
  const [securityCode, setSecurityCode] = useState('')

  useEffect(() => {
    if (open) {
      setNcf(nextFakeNCF())
      setSecurityCode(fakeSecurityCode())
    }
  }, [open])

  if (!open) return null

  const subtotal = total / 1.18
  const itbis = total - subtotal

  const utm = `utm_source=demo_cobrar&utm_medium=demo_${vertical}`

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-black rounded-2xl shadow-2xl overflow-hidden">
        {/* Header — green success bar */}
        <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white px-6 py-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
            <Check size={28} strokeWidth={3} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-black tracking-tight">
              {t(lang, '¡Cobro exitoso!', 'Payment successful!')}
            </h3>
            <p className="text-[12px] text-white/85 font-medium">
              {t(lang, 'e-CF emitido y validado por DGII', 'e-CF issued and validated by DGII')}
            </p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {/* NCF + QR fake */}
          <div className="rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-extrabold tracking-[2px] text-black/50 dark:text-white/50 uppercase">
                  {t(lang, 'NCF Electrónico', 'Electronic NCF')}
                </p>
                <p className="text-sm font-mono font-black text-black dark:text-white tabular-nums mt-1">{ncf}</p>
                <p className="text-[10px] font-extrabold tracking-[2px] text-black/50 dark:text-white/50 uppercase mt-3">
                  {t(lang, 'Código Seguridad', 'Security Code')}
                </p>
                <p className="text-sm font-mono font-black text-black dark:text-white mt-1">{securityCode}</p>
              </div>
              <div className="w-20 h-20 rounded-lg bg-white border-2 border-black flex items-center justify-center flex-shrink-0">
                <FakeQR />
              </div>
            </div>
          </div>

          {/* Totals */}
          <div className="space-y-1.5 text-sm">
            <Row label={t(lang, 'Subtotal', 'Subtotal')} value={fmtRD(subtotal)} />
            <Row label="ITBIS 18%" value={fmtRD(itbis)} />
            <div className="h-px bg-black/10 dark:bg-white/10 my-2" />
            <Row label={t(lang, 'Total cobrado', 'Total charged')} value={fmtRD(total)} bold />
            <Row
              label={t(lang, 'Método', 'Method')}
              value={paymentMethod === 'efectivo' ? t(lang, 'Efectivo', 'Cash') : 'Tarjeta'}
            />
          </div>

          {/* Demo banner inside modal */}
          <div className="rounded-lg bg-[#b3001e]/10 border border-[#b3001e]/30 p-3">
            <p className="text-[12px] text-black dark:text-white font-semibold">
              {t(lang,
                'Esto es un demo. Para facturar de verdad,',
                'This is a demo. To bill for real,'
              )}{' '}
              <a href={`/signup?plan=facturacion&${utm}`} className="text-[#b3001e] font-black underline hover:no-underline">
                {t(lang, 'empieza tu prueba gratis →', 'start your free trial →')}
              </a>
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 text-black dark:text-white font-bold text-sm transition-colors"
            >
              {t(lang, 'Cerrar', 'Close')}
            </button>
            <button
              onClick={() => alert(t(lang, 'Demo: en producción esto imprime el recibo térmico de 80mm.', 'Demo: in production this prints the 80mm thermal receipt.'))}
              className="flex-1 py-3 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <Printer size={15} />
              {t(lang, 'Imprimir', 'Print')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, bold }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-black/60 dark:text-white/60 ${bold ? 'font-black text-black dark:text-white' : ''}`}>{label}</span>
      <span className={`tabular-nums ${bold ? 'text-base font-black text-black dark:text-white' : 'text-black dark:text-white font-semibold'}`}>{value}</span>
    </div>
  )
}

// Fake QR — a deterministic 7×7 grid of squares that LOOKS like a QR.
export function FakeQR({ size = 64 }) {
  const cells = []
  // simple deterministic pseudo-pattern
  const seed = [1,0,1,1,0,1,0, 1,1,0,0,1,0,1, 0,1,1,1,1,0,0, 1,0,0,1,0,1,1, 0,1,1,0,1,1,0, 1,0,1,0,0,1,0, 1,1,1,0,1,1,1]
  for (let i = 0; i < 49; i++) cells.push(seed[i])
  return (
    <div className="grid grid-cols-7 gap-[1px] p-1" style={{ width: size, height: size }}>
      {cells.map((c, i) => (
        <div key={i} className={c ? 'bg-black' : 'bg-white'} />
      ))}
    </div>
  )
}
