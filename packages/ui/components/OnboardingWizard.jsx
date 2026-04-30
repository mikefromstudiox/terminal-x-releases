/**
 * OnboardingWizard.jsx — first-login walkthrough for web POS owners.
 *
 * Mounts globally at the App level. Shows a 4-step modal the first time an
 * owner lands at /pos and dismisses itself permanently once completed or
 * skipped. Each step computes its own "done" state from real Supabase
 * settings, so a returning user resuming an unfinished setup picks up at
 * whatever step is still open.
 *
 * State persistence: app_settings keys
 *   onboarding_state   = 'open' | 'dismissed' | 'completed'
 *   (no key = treat as 'open' for owners on web; cashiers / desktop never see it)
 *
 * Steps:
 *   1. Bienvenida — overview + Pro PLUS upgrade if on Pro base
 *   2. Datos del negocio — RNC, dirección, teléfono missing
 *   3. Cargar certificado — link to /pos/dgii cert tab
 *   4. Primera factura prueba — link to /pos
 *
 * Brand: black, white, #b3001e crimson. No emojis. Spanish primary.
 */
import { useState, useEffect, useMemo } from 'react'
import { X, CheckCircle2, Circle, ArrowRight, ShieldCheck, Building2, Sparkles, Receipt, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAPI } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../i18n'
import { usePlan } from '../hooks/usePlan'

const STATE_KEY = 'onboarding_state'

export default function OnboardingWizard() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()
  const { hasFeature } = usePlan()
  const L = (es, en) => lang === 'es' ? es : en

  const isWeb = typeof window !== 'undefined' && !window.electronAPI
  const isOwner = String(user?.role || '').toLowerCase() === 'owner'

  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState(null)
  const [certInfo, setCertInfo] = useState(null)
  const [tickets, setTickets] = useState({ count: 0 })
  const [persisting, setPersisting] = useState(false)

  // Load state on mount. Skip entirely if not web + owner.
  useEffect(() => {
    if (!isWeb || !isOwner || !user?.id || !api) return
    let cancelled = false
    ;(async () => {
      try {
        const s = await api.settings?.get?.()
        if (cancelled) return
        setSettings(s || {})
        const stored = s?.[STATE_KEY]
        if (stored === 'completed' || stored === 'dismissed') return
        // Fetch supplementary signals — cert + ticket count drive step completion.
        try {
          const c = await api.dgii_ecf?.certInfo?.()
          if (!cancelled) setCertInfo(c || { installed: false })
        } catch {}
        try {
          const t = await api.tickets?.all?.({ limit: 1 })
          if (!cancelled) setTickets({ count: Array.isArray(t) ? t.length : 0 })
        } catch {}
        if (!cancelled) setOpen(true)
      } catch {}
    })()
    return () => { cancelled = true }
  }, [api, isWeb, isOwner, user?.id])

  // Per-step done state, recomputed when settings/cert/tickets change.
  const steps = useMemo(() => {
    const bizFilled = !!(settings?.biz_rnc && settings?.biz_address && settings?.biz_phone)
    const planOk = hasFeature('ecf') || hasFeature('invoicing')
    return [
      {
        id: 'bienvenida',
        icon: Sparkles,
        title: L('Bienvenido a Terminal X', 'Welcome to Terminal X'),
        body: L(
          'En 4 pasos cortos su POS queda listo para emitir e-CFs validos por la DGII desde la web. Si en cualquier momento necesita ayuda, escribanos por WhatsApp al +1 (809) 828-2971.',
          'In 4 short steps your POS is ready to issue DGII-valid e-CFs from the web. Need help any time? WhatsApp us at +1 (809) 828-2971.'
        ),
        cta: planOk
          ? { label: L('Continuar', 'Continue'), action: 'next' }
          : { label: L('Activar Pro PLUS para e-CFs', 'Upgrade to Pro PLUS for e-CFs'), href: 'https://terminalxpos.com/pricing' },
        done: true,  // pure intro, always satisfiable
      },
      {
        id: 'datos',
        icon: Building2,
        title: L('Datos del negocio', 'Business details'),
        body: bizFilled
          ? L('Listos. Su RNC, direccion y telefono ya estan configurados — saldran en cada recibo y factura.',
              'All set. Your RNC, address and phone are configured — they appear on every receipt and invoice.')
          : L('Falta algun dato. Para que cada factura tenga formato fiscal correcto necesitamos su RNC, direccion y telefono.',
              'Some details are missing. For invoices to render with proper fiscal headers we need your RNC, address and phone.'),
        cta: bizFilled
          ? { label: L('Marcar como listo', 'Mark as done'), action: 'next' }
          : { label: L('Completar datos', 'Fill in details'), to: '/pos/sistema' },
        done: bizFilled,
      },
      {
        id: 'certificado',
        icon: ShieldCheck,
        title: L('Cargar certificado .p12', 'Upload .p12 certificate'),
        body: certInfo?.installed
          ? L('Certificado activo. Listo para emitir e-CFs.', 'Certificate active. Ready to issue e-CFs.')
          : L('Su certificado de Viafirma se carga en 30 segundos via /pos/dgii. Si aun no tiene certificado, Tech X gestiona la certificacion DGII completa.',
              'Your Viafirma certificate uploads in 30 seconds at /pos/dgii. If you don’t have one yet, Tech X handles the full DGII certification.'),
        cta: certInfo?.installed
          ? { label: L('Continuar', 'Continue'), action: 'next' }
          : { label: L('Cargar certificado', 'Upload certificate'), to: '/pos/dgii' },
        done: !!certInfo?.installed,
      },
      {
        id: 'primer-ticket',
        icon: Receipt,
        title: L('Primera factura de prueba', 'First test invoice'),
        body: tickets.count > 0
          ? L('Excelente — ya emitio su primer ticket. Si no fue una factura electronica de prueba aun, hagala desde POS para confirmar el flujo end-to-end.',
              'Great — you have already issued your first ticket. If it wasn’t a test e-CF yet, do one from POS to confirm the full flow.')
          : L('Emita una venta cualquiera desde POS para confirmar que el flujo de cobro funciona. Recomendamos comenzar en modo Pruebas (certecf) antes de Produccion.',
              'Issue any sale from POS to confirm the cobro flow works. We recommend starting in test mode (certecf) before flipping to Production.'),
        cta: { label: L('Ir a POS', 'Go to POS'), to: '/pos' },
        done: tickets.count > 0,
      },
    ]
  }, [settings, certInfo, tickets, hasFeature, lang])

  const [stepIdx, setStepIdx] = useState(0)
  const step = steps[stepIdx]

  async function persistState(state /* 'completed' | 'dismissed' */) {
    setPersisting(true)
    try {
      await api.settings?.update?.({ [STATE_KEY]: state })
    } catch {}
    setPersisting(false)
    setOpen(false)
  }

  if (!open || !step) return null

  const Icon = step.icon
  const completedCount = steps.filter(s => s.done).length
  const allDone = completedCount === steps.length

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white dark:bg-black rounded-2xl shadow-2xl border border-black/10 dark:border-white/10 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#b3001e] text-white">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider opacity-90">
              {L('Configuracion inicial', 'Initial setup')}
            </span>
            <span className="text-xs opacity-70">{stepIdx + 1} / {steps.length}</span>
          </div>
          <button onClick={() => persistState('dismissed')} disabled={persisting}
            aria-label={L('Cerrar', 'Close')}
            className="p-1 rounded hover:bg-white/15 transition">
            <X size={16} />
          </button>
        </div>

        {/* Step indicator rail */}
        <div className="flex gap-1 px-6 py-2 bg-black/[0.03] dark:bg-white/[0.03]">
          {steps.map((s, i) => (
            <button key={s.id} onClick={() => setStepIdx(i)}
              className={`flex-1 h-1 rounded-full transition ${
                i === stepIdx ? 'bg-[#b3001e]' : s.done ? 'bg-emerald-500/60' : 'bg-black/15 dark:bg-white/15'
              }`}
              aria-label={s.title} />
          ))}
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-12 h-12 rounded-xl bg-[#b3001e]/10 flex items-center justify-center flex-shrink-0">
              <Icon size={24} className="text-[#b3001e]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-lg font-bold text-black dark:text-white">{step.title}</h3>
                {step.done && (
                  <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                )}
              </div>
              <p className="text-sm text-black/70 dark:text-white/70 leading-relaxed">{step.body}</p>
            </div>
          </div>

          {/* Step list (compact summary) */}
          <ul className="space-y-1.5 mb-5 text-sm">
            {steps.map((s, i) => (
              <li key={s.id} className="flex items-center gap-2">
                {s.done
                  ? <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400" />
                  : <Circle size={14} className={i === stepIdx ? 'text-[#b3001e]' : 'text-black/30 dark:text-white/30'} />}
                <button onClick={() => setStepIdx(i)}
                  className={`text-left flex-1 transition ${i === stepIdx ? 'font-semibold text-black dark:text-white' : s.done ? 'text-black/60 dark:text-white/60' : 'text-black/50 dark:text-white/50 hover:text-[#b3001e]'}`}>
                  {s.title}
                </button>
              </li>
            ))}
          </ul>

          {/* CTA */}
          <div className="flex items-center justify-between gap-3">
            <button onClick={() => persistState('dismissed')} disabled={persisting}
              className="text-xs text-black/50 dark:text-white/50 hover:text-[#b3001e] transition disabled:opacity-40">
              {L('No mostrar mas', 'Don’t show again')}
            </button>
            {step.cta?.to ? (
              <Link to={step.cta.to} onClick={() => persistState('dismissed')}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#b3001e] text-white text-sm font-bold rounded-xl hover:bg-[#8f0018] transition">
                {step.cta.label}
                <ChevronRight size={15} />
              </Link>
            ) : step.cta?.href ? (
              <a href={step.cta.href} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#b3001e] text-white text-sm font-bold rounded-xl hover:bg-[#8f0018] transition">
                {step.cta.label}
                <ChevronRight size={15} />
              </a>
            ) : (
              <button onClick={() => stepIdx < steps.length - 1 ? setStepIdx(stepIdx + 1) : persistState('completed')}
                disabled={persisting}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#b3001e] text-white text-sm font-bold rounded-xl hover:bg-[#8f0018] transition disabled:opacity-50">
                {step.cta?.label || (allDone ? L('Cerrar', 'Close') : L('Siguiente', 'Next'))}
                <ArrowRight size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
