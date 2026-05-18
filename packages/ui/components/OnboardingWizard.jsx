/**
 * OnboardingWizard.jsx — first-login walkthrough for web POS owners.
 *
 * Mounts globally at the App level. Triggers on first /pos visit for an
 * owner whose business hasn't completed onboarding yet. Persists progress
 * across reloads via `app_settings.onboarding_state`.
 *
 * Stage machine (persisted in `app_settings.onboarding_state`):
 *   missing | 'open'   = needs PIN
 *   'pin_done'         = chooser
 *   'path_settings'    = inside settings path
 *   'path_firstsale'   = inside first-sale path
 *   'crosspromo'       = offering the other path
 *   'completed'        = done forever
 *   'dismissed'        = user closed out (still treated as done)
 *
 * Brand: black / white / #b3001e crimson, Spanish primary, demo-grade polish.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  X, CheckCircle2, ArrowRight, ChevronRight, ChevronLeft,
  KeyRound, Settings as SettingsIcon, ShoppingCart, Building2,
  Receipt, Loader2, Sparkles, Tag, Check, Delete,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAPI } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../i18n'

const STATE_KEY = 'onboarding_state'

export default function OnboardingWizard() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()
  const navigate = useNavigate()
  const L = useCallback((es, en) => lang === 'es' ? es : en, [lang])

  const isWeb = typeof window !== 'undefined' && !window.electronAPI
  const isOwner = String(user?.role || '').toLowerCase() === 'owner'

  const [stage, setStage] = useState(null)
  const [doneFlags, setDoneFlags] = useState({ pin: false, settings: false, firstsale: false })

  useEffect(() => {
    if (!isWeb || !isOwner || !user?.id || !api) return
    let cancelled = false
    ;(async () => {
      try {
        const s = await api.settings?.get?.()
        if (cancelled) return
        const stored = s?.[STATE_KEY]
        if (stored === 'completed' || stored === 'dismissed') return

        // GRANDFATHER GUARD — pre-existing clients (Ranoza, Crokao, Studio X
        // SRL, Perla, every business provisioned before this wizard shipped)
        // already have PINs, services, and tickets. They must NEVER see this
        // popup. If we detect any of those signals AND no explicit onboarding
        // state, silently mark 'completed' and bail. Only brand-new accounts
        // (no services, no tickets) reach the actual stages.
        let svcCount = 0, ticketCount = 0
        try {
          const svcs = await api.services?.all?.()
          svcCount = Array.isArray(svcs) ? svcs.length : 0
        } catch (_) { /* non-fatal */ }
        try {
          const tx = await api.tickets?.all?.({ limit: 1 })
          ticketCount = Array.isArray(tx) ? tx.length : 0
        } catch (_) { /* non-fatal */ }
        if (cancelled) return

        const isBrandNew = !stored && svcCount === 0 && ticketCount === 0
        if (!isBrandNew && !stored) {
          // Existing client without a stored state → grandfather as completed.
          try { await api.settings?.update?.({ [STATE_KEY]: 'completed' }) } catch (err) {
            try { window.__txReportError?.(err, { severity: 'warn', category: 'onboarding.grandfather.persist' }) } catch {}
          }
          return
        }
        // Stored state exists OR truly brand new. Continue.

        const pinSet = ['pin_done','path_settings','path_firstsale','crosspromo'].includes(stored)
        const settingsDone = !!(s?.biz_rnc && s?.biz_address && s?.biz_phone)
        const firstsaleDone = svcCount > 0
        setDoneFlags({ pin: pinSet, settings: settingsDone, firstsale: firstsaleDone })

        // Contabilidad firms skip the POS-flavored chooser entirely. Their
        // activation moment is in Cartera (connect first client). After PIN
        // is set, mark wizard completed so it exits.
        const businessType = String(s?.business_type || s?.biz_type || '').toLowerCase()
        const isContabilidad = businessType === 'accounting' || businessType === 'contabilidad'

        if (!pinSet) { setStage('pin'); return }
        if (isContabilidad) {
          try { await api.settings?.update?.({ [STATE_KEY]: 'completed' }) }
          catch (err) { try { window.__txReportError?.(err, { severity: 'warn', category: 'onboarding.contabilidad.complete_settings_update' }) } catch {} }
          return
        }
        if (stored === 'path_settings')  { setStage('settings');  return }
        if (stored === 'path_firstsale') { setStage('firstsale'); return }
        if (stored === 'crosspromo')     { setStage('crosspromo'); return }
        setStage('chooser')
      } catch (err) {
        try { window.__txReportError?.(err, { severity: 'warn', category: 'onboarding.bootstrap' }) } catch {}
      }
    })()
    return () => { cancelled = true }
  }, [api, isWeb, isOwner, user?.id])

  const persistState = useCallback(async (state) => {
    try { await api.settings?.update?.({ [STATE_KEY]: state }) }
    catch (err) {
      try { window.__txReportError?.(err, { severity: 'warn', category: 'onboarding.persistState', extra: { state } }) } catch {}
    }
  }, [api])

  const close = useCallback(async (finalState = 'dismissed') => {
    await persistState(finalState)
    setStage(null)
  }, [persistState])

  if (!stage) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-tx-fade-in">
      <div className="w-full max-w-2xl bg-white dark:bg-black rounded-2xl shadow-[0_24px_80px_-20px_rgba(179,0,30,0.45)] border border-black/10 dark:border-white/10 overflow-hidden animate-tx-pop-in">
        <WizardHeader stage={stage} doneFlags={doneFlags} onClose={stage === 'pin' ? null : () => close('dismissed')} L={L} />
        <div key={stage} className="animate-tx-slide-in">
          {stage === 'pin' && (
            <PinStep api={api} user={user} L={L}
              onDone={async () => {
                setDoneFlags(f => ({ ...f, pin: true }))
                await persistState('pin_done')
                setStage('chooser')
              }} />
          )}
          {stage === 'chooser' && (
            <ChooserStep L={L} doneFlags={doneFlags}
              onPick={async (path) => {
                if (path === 'settings') { await persistState('path_settings'); setStage('settings') }
                else { await persistState('path_firstsale'); setStage('firstsale') }
              }}
              onSkip={() => close('dismissed')} />
          )}
          {stage === 'settings' && (
            <SettingsPath api={api} L={L}
              onDone={async () => {
                setDoneFlags(f => ({ ...f, settings: true }))
                if (doneFlags.firstsale) { await close('completed'); return }
                await persistState('crosspromo'); setStage('crosspromo')
              }}
              onBack={() => setStage('chooser')} />
          )}
          {stage === 'firstsale' && (
            <FirstSalePath api={api} L={L}
              onDone={async () => {
                setDoneFlags(f => ({ ...f, firstsale: true }))
                if (doneFlags.settings) { await close('completed'); navigate('/pos'); return }
                await persistState('crosspromo'); setStage('crosspromo')
              }}
              onGoToPos={async () => { await close('completed'); navigate('/pos') }}
              onBack={() => setStage('chooser')} />
          )}
          {stage === 'crosspromo' && (
            <CrossPromo L={L} missing={doneFlags.settings ? 'firstsale' : 'settings'}
              onPick={async (path) => {
                if (path === 'settings') { await persistState('path_settings'); setStage('settings') }
                else { await persistState('path_firstsale'); setStage('firstsale') }
              }}
              onFinish={() => close('completed')} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Header with progress rail ───────────────────────────────────────────────
function WizardHeader({ stage, doneFlags, onClose, L }) {
  const titles = {
    pin:        L('Paso 1 — Crea tu PIN',          'Step 1 — Create your PIN'),
    chooser:    L('Por donde quieres empezar?',     'Where would you like to start?'),
    settings:   L('Configura tu negocio',           'Set up your business'),
    firstsale:  L('Tu primera venta',               'Your first sale'),
    crosspromo: L('Un paso mas, opcional',          'One more step, optional'),
  }
  const subs = {
    pin:        L('Lo usaras cada vez que abras el POS',         'You\'ll use it every time you open the POS'),
    chooser:    L('Elige tu camino — puedes hacer el otro despues','Pick your path — you can do the other later'),
    settings:   L('Datos fiscales y de recibo',                   'Fiscal and receipt details'),
    firstsale:  L('Producto o servicio listo en 1 minuto',        'Product or service ready in 1 minute'),
    crosspromo: L('Casi listo',                                   'Almost done'),
  }

  // Order: pin → (settings|firstsale|chooser) → crosspromo (sometimes) → done
  const rail = [
    { id: 'pin',      label: L('PIN', 'PIN'),                done: doneFlags.pin },
    { id: 'config',   label: L('Configurar', 'Set up'),      done: doneFlags.settings || doneFlags.firstsale },
    { id: 'sell',     label: L('Vender', 'Sell'),            done: doneFlags.firstsale },
  ]
  const activeRailIdx =
    stage === 'pin' ? 0 :
    stage === 'chooser' ? 1 :
    stage === 'settings' ? 1 :
    stage === 'firstsale' ? 2 :
    stage === 'crosspromo' ? 2 : 0

  return (
    <div className="relative bg-gradient-to-br from-[#b3001e] via-[#9a0019] to-[#7a0014] text-white px-6 pt-5 pb-4 overflow-hidden">
      <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/[0.06] blur-2xl pointer-events-none" />
      <div className="absolute -bottom-10 -left-6 w-32 h-32 rounded-full bg-white/[0.04] blur-xl pointer-events-none" />

      <div className="relative flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-white/85 text-[10px] font-bold uppercase tracking-[3px]">
            <Sparkles size={11} /> {L('Bienvenido a Terminal X', 'Welcome to Terminal X')}
          </div>
          <h2 className="mt-1 text-[20px] sm:text-[22px] font-black leading-tight tracking-tight truncate">{titles[stage]}</h2>
          <p className="text-[11px] text-white/70 mt-0.5">{subs[stage]}</p>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Cerrar"
            className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/15 transition shrink-0">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="relative flex items-center gap-2 mt-2">
        {rail.map((r, i) => {
          const active = i === activeRailIdx
          return (
            <div key={r.id} className="flex items-center flex-1 min-w-0">
              <div className={`flex items-center gap-1.5 min-w-0 ${active ? 'text-white' : r.done ? 'text-emerald-200' : 'text-white/45'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 transition ${
                  active ? 'bg-white text-[#b3001e] ring-2 ring-white/40' :
                  r.done ? 'bg-emerald-400/90 text-black' : 'bg-white/15 text-white/60'
                }`}>
                  {r.done ? <Check size={10} strokeWidth={3.5} /> : i + 1}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-[2px] truncate">{r.label}</span>
              </div>
              {i < rail.length - 1 && <div className={`flex-1 h-px mx-2 ${i < activeRailIdx || rail[i].done ? 'bg-emerald-300/60' : 'bg-white/15'}`} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Step 1: PIN (mandatory) — production POS keypad ─────────────────────────
function PinStep({ api, user, L, onDone }) {
  // 'set' = first entry, 'confirm' = re-entry
  const [phase, setPhase]   = useState('set')
  const [pin, setPin]       = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [shake, setShake]   = useState(false)
  const [error, setError]   = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const target = phase === 'set' ? pin : confirmPin
  const setTarget = phase === 'set' ? setPin : setConfirmPin

  function digit(d) {
    if (submitting) return
    if (target.length >= 6) return
    setError(null)
    setTarget(target + d)
  }
  function back() { if (submitting) return; setError(null); setTarget(target.slice(0, -1)) }
  function clear() { if (submitting) return; setError(null); setTarget('') }

  // When the user finishes typing in 'set' phase, gate the confirm step.
  // Manual: they tap "Continuar" once they have ≥4 digits.
  function advanceSet() {
    if (pin.length < 4) { setError(L('Minimo 4 digitos', 'At least 4 digits')); setShake(true); setTimeout(() => setShake(false), 450); return }
    setError(null)
    setPhase('confirm')
  }

  async function submit() {
    if (confirmPin !== pin) {
      setError(L('Los PINes no coinciden. Intenta de nuevo.', 'PINs don\'t match. Try again.'))
      setShake(true); setTimeout(() => setShake(false), 450)
      setConfirmPin('')
      return
    }
    setSubmitting(true)
    try {
      const users = await api.admin?.getUsuarios?.()
      const owner = (users || []).find(u => String(u.role || '').toLowerCase() === 'owner')
      if (!owner?.id) {
        await api.admin?.saveUsuario?.({
          name: user?.name || 'Owner', username: 'owner', role: 'owner', pin, active: true,
        })
      } else {
        await api.admin?.saveUsuario?.({ id: owner.id, pin })
      }
      onDone()
    } catch (err) {
      try { window.__txReportError?.(err, { severity: 'error', category: 'onboarding.pin.save' }) } catch {}
      setError(err?.message || L('Error guardando el PIN', 'Error saving PIN'))
      setSubmitting(false)
    }
  }

  const canAdvanceSet = pin.length >= 4 && phase === 'set'
  const canSubmit     = phase === 'confirm' && confirmPin.length === pin.length && confirmPin.length >= 4

  return (
    <div className="px-6 sm:px-8 py-7">
      <div className="flex items-center justify-center mb-2">
        <div className="w-12 h-12 rounded-2xl bg-[#b3001e]/10 dark:bg-[#b3001e]/15 flex items-center justify-center">
          <KeyRound size={22} className="text-[#b3001e]" />
        </div>
      </div>
      <h3 className="text-center text-[18px] font-black text-black dark:text-white tracking-tight">
        {phase === 'set' ? L('Crea tu PIN', 'Create your PIN') : L('Confirma tu PIN', 'Confirm your PIN')}
      </h3>
      <p className="text-center text-[12px] text-black/55 dark:text-white/55 mt-1 mb-5">
        {phase === 'set'
          ? L('4 a 6 digitos. Lo usaras para abrir el POS.', '4 to 6 digits. You\'ll use it to open the POS.')
          : L('Una vez mas para confirmar.', 'One more time to confirm.')}
      </p>

      <PinDots filled={target.length} shake={shake} />

      <div className="h-6 flex items-center justify-center mt-2 mb-3">
        {error && <p className="text-red-600 dark:text-red-400 text-[12px] font-semibold">{error}</p>}
      </div>

      <div className="max-w-xs mx-auto">
        <div className="grid grid-cols-3 gap-2">
          {['1','2','3','4','5','6','7','8','9'].map(d => (
            <PadBtn key={d} onClick={() => digit(d)}>{d}</PadBtn>
          ))}
          <PadBtn variant="action" onClick={clear}>
            {target.length > 0 ? L('Borrar', 'Clear') : ''}
          </PadBtn>
          <PadBtn onClick={() => digit('0')}>0</PadBtn>
          <PadBtn variant="action" onClick={back}>
            <Delete size={18} className="mx-auto" />
          </PadBtn>
        </div>

        <div className="mt-5 flex items-center gap-2">
          {phase === 'confirm' && (
            <button onClick={() => { setPhase('set'); setConfirmPin(''); setError(null) }} disabled={submitting}
              className="inline-flex items-center gap-1 text-[12px] text-black/55 dark:text-white/55 hover:text-[#b3001e]">
              <ChevronLeft size={13} /> {L('Cambiar PIN', 'Change PIN')}
            </button>
          )}
          <div className="flex-1" />
          {phase === 'set' ? (
            <button onClick={advanceSet} disabled={!canAdvanceSet}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-[0.98] shadow-lg shadow-[#b3001e]/25 text-[13px]">
              {L('Continuar', 'Continue')} <ArrowRight size={14} />
            </button>
          ) : (
            <button onClick={submit} disabled={!canSubmit || submitting}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-[0.98] shadow-lg shadow-[#b3001e]/25 text-[13px]">
              {submitting
                ? <><Loader2 size={14} className="animate-spin" /> {L('Guardando...', 'Saving...')}</>
                : <>{L('Guardar PIN', 'Save PIN')} <Check size={14} /></>}
            </button>
          )}
        </div>
      </div>

      <p className="text-center text-[10px] text-black/40 dark:text-white/40 mt-5">
        {L('Puedes cambiarlo luego en Configuracion > Empleados.', 'You can change it later in Settings > Staff.')}
      </p>
    </div>
  )
}

function PinDots({ filled, shake }) {
  return (
    <div className={`flex items-center justify-center gap-3 h-8 ${shake ? 'animate-shake' : ''}`}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i}
          className={`w-3 h-3 rounded-full transition-all duration-150 ${
            i < filled
              ? 'bg-[#b3001e] scale-110 shadow-[0_0_12px_rgba(179,0,30,0.5)]'
              : 'bg-slate-200 border border-slate-300 dark:bg-white/10 dark:border-white/10'
          }`} />
      ))}
    </div>
  )
}

function PadBtn({ children, onClick, variant = 'digit' }) {
  const styles = {
    digit:  'bg-slate-50 hover:bg-slate-100 active:bg-[#b3001e] active:text-white text-slate-800 text-[19px] font-bold border border-slate-200 dark:bg-white/5 dark:hover:bg-white/10 dark:text-white dark:border-white/10',
    action: 'bg-transparent hover:bg-slate-100 text-slate-400 hover:text-slate-600 text-[11px] font-bold uppercase tracking-wider dark:hover:bg-white/10 dark:text-white/40 dark:hover:text-white/70',
  }
  return (
    <button onClick={onClick}
      className={`h-14 rounded-xl transition-all active:scale-95 select-none ${styles[variant]}`}>
      {children}
    </button>
  )
}

// ── Step 2: Path chooser ────────────────────────────────────────────────────
function ChooserStep({ L, doneFlags, onPick, onSkip }) {
  return (
    <div className="px-6 sm:px-8 py-7 space-y-5">
      <p className="text-[13px] text-black/65 dark:text-white/65 leading-relaxed">
        {L('Tu cuenta esta lista y el plan Pro MAX activo por 7 dias. Elige por donde empezar — puedes hacer la otra mitad despues.',
           'Your account is set up and Pro MAX trial is running. Pick where to start — you can do the other half later.')}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ChooserCard
          icon={SettingsIcon}
          title={L('Configura tu negocio', 'Configure your business')}
          desc={L('RNC, telefono, direccion, ITBIS y como salen los recibos. Ideal si emites facturas con e-CF.',
                  'RNC, phone, address, tax % and how receipts print. Best if you\'ll issue e-CF invoices.')}
          time={L('3 min', '3 min')}
          done={doneFlags.settings}
          onClick={() => onPick('settings')}
          L={L}
        />
        <ChooserCard
          icon={ShoppingCart}
          title={L('Haz tu primera venta', 'Make your first sale')}
          desc={L('Agrega un producto o servicio y vendelo ya. Ideal si quieres ver el flujo real desde ya.',
                  'Add a product or service and sell it now. Best if you want the real flow right away.')}
          time={L('1 min', '1 min')}
          done={doneFlags.firstsale}
          onClick={() => onPick('firstsale')}
          accent
          L={L}
        />
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-white/5">
        <button onClick={onSkip}
          className="text-[11px] text-black/40 dark:text-white/40 hover:text-[#b3001e] py-2">
          {L('Explorar por mi cuenta', 'Explore on my own')}
        </button>
        <span className="text-[10px] text-black/30 dark:text-white/30">
          {L('Volveras desde Configuracion', 'Re-open from Settings')}
        </span>
      </div>
    </div>
  )
}

function ChooserCard({ icon: Icon, title, desc, time, done, onClick, accent, L }) {
  return (
    <button onClick={onClick}
      className={`group relative text-left p-5 rounded-2xl border-2 transition-all duration-200 overflow-hidden
        ${accent
          ? 'border-[#b3001e]/35 bg-gradient-to-br from-[#b3001e]/[0.07] via-white to-white dark:via-black dark:to-black hover:border-[#b3001e] hover:shadow-[0_18px_40px_-14px_rgba(179,0,30,0.5)] hover:-translate-y-0.5'
          : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] hover:border-[#b3001e] hover:shadow-[0_14px_32px_-12px_rgba(179,0,30,0.4)] hover:-translate-y-0.5'}
      `}>
      <span className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#b3001e] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

      {done && (
        <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[9px] font-bold uppercase tracking-wider">
          <CheckCircle2 size={10} /> {L('Hecho', 'Done')}
        </span>
      )}

      <div className="w-11 h-11 rounded-2xl bg-[#b3001e]/10 group-hover:bg-[#b3001e]/15 flex items-center justify-center mb-3 transition">
        <Icon size={22} className="text-[#b3001e]" />
      </div>

      <h4 className="text-[15px] font-black text-black dark:text-white leading-tight tracking-tight">{title}</h4>
      <p className="text-[11px] text-black/55 dark:text-white/55 mt-1.5 leading-relaxed">{desc}</p>

      <div className="mt-3 pt-3 border-t border-dashed border-slate-200 dark:border-white/10 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[2px] text-[#b3001e]">{time}</span>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-black/50 dark:text-white/50 group-hover:text-[#b3001e] transition">
          {done ? L('Repasar', 'Review') : L('Empezar', 'Start')} <ChevronRight size={11} />
        </span>
      </div>
    </button>
  )
}

// ── Path A: Settings ────────────────────────────────────────────────────────
function SettingsPath({ api, L, onDone, onBack }) {
  const [form, setForm] = useState({
    biz_name: '', biz_rnc: '', biz_address: '', biz_phone: '', biz_email: '',
    itbis_pct: '18', ley_pct: '0', receipt_footer: '',
  })
  const [loaded, setLoaded] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [subStep, setSubStep] = useState(0)

  useEffect(() => {
    (async () => {
      try {
        const s = await api.settings?.get?.()
        if (s) setForm(f => ({
          ...f,
          biz_name:       s.biz_name       || '',
          biz_rnc:        s.biz_rnc        || '',
          biz_address:    s.biz_address    || '',
          biz_phone:      s.biz_phone      || '',
          biz_email:      s.biz_email      || '',
          itbis_pct:      s.itbis_pct      || '18',
          ley_pct:        s.ley_pct        || '0',
          receipt_footer: s.receipt_footer || '',
        }))
      } catch (err) {
        try { window.__txReportError?.(err, { severity: 'warn', category: 'onboarding.settings.load' }) } catch {}
      }
      setLoaded(true)
    })()
  }, [api])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function next() {
    setError(null)
    if (subStep === 0) {
      if (!form.biz_rnc.trim() || !form.biz_address.trim() || !form.biz_phone.trim()) {
        setError(L('RNC, direccion y telefono son requeridos para recibos fiscales.',
                   'RNC, address and phone are required for fiscal receipts.'))
        return
      }
      setSubmitting(true)
      try {
        await api.settings?.update?.({
          biz_name:    form.biz_name.trim() || undefined,
          biz_rnc:     form.biz_rnc.trim(),
          biz_address: form.biz_address.trim(),
          biz_phone:   form.biz_phone.trim(),
          biz_email:   form.biz_email.trim(),
        })
        setSubStep(1)
      } catch (err) {
        try { window.__txReportError?.(err, { severity: 'error', category: 'onboarding.settings.bizinfo' }) } catch {}
        setError(err?.message || L('Error guardando', 'Error saving'))
      } finally { setSubmitting(false) }
      return
    }
    setSubmitting(true)
    try {
      await api.settings?.update?.({
        itbis_pct:      String(form.itbis_pct || '18'),
        ley_pct:        String(form.ley_pct   || '0'),
        receipt_footer: form.receipt_footer.trim(),
      })
      onDone()
    } catch (err) {
      try { window.__txReportError?.(err, { severity: 'error', category: 'onboarding.settings.receipt' }) } catch {}
      setError(err?.message || L('Error guardando', 'Error saving'))
      setSubmitting(false)
    }
  }

  if (!loaded) {
    return <div className="px-6 py-14 flex items-center justify-center"><Loader2 size={22} className="animate-spin text-[#b3001e]" /></div>
  }

  return (
    <div className="px-6 sm:px-8 py-6 space-y-5">
      <div className="flex gap-1.5">
        {[0, 1].map(i => (
          <div key={i} className={`flex-1 h-1 rounded-full transition-all ${i === subStep ? 'bg-[#b3001e]' : i < subStep ? 'bg-emerald-500/70' : 'bg-black/10 dark:bg-white/10'}`} />
        ))}
      </div>

      <div key={subStep} className="animate-tx-slide-in">
        {subStep === 0 ? (
          <SubHeader icon={Building2}
            title={L('Datos del negocio', 'Business details')}
            sub={L('Salen en cada recibo y factura.', 'Appear on every receipt and invoice.')} />
        ) : (
          <SubHeader icon={Receipt}
            title={L('Recibos e impuestos', 'Receipts and tax')}
            sub={L('Como se calcula y como se imprime.', 'How it\'s calculated and printed.')} />
        )}

        {subStep === 0 && (
          <div className="grid grid-cols-2 gap-3 mt-4">
            <Field label={L('Nombre comercial', 'Business name')} value={form.biz_name} onChange={v => set('biz_name', v)} placeholder="Mi Negocio SRL" />
            <Field label={L('RNC / Cedula', 'RNC / ID')} value={form.biz_rnc} onChange={v => set('biz_rnc', v.replace(/[^\d-]/g, ''))} placeholder="130-12345-6" required />
            <Field label={L('Direccion', 'Address')} value={form.biz_address} onChange={v => set('biz_address', v)} placeholder="Av. Winston Churchill 1099" full required />
            <Field label={L('Telefono', 'Phone')} value={form.biz_phone} onChange={v => set('biz_phone', v)} placeholder="809-555-0000" required />
            <Field label={L('Email', 'Email')} value={form.biz_email} onChange={v => set('biz_email', v)} placeholder="info@mi-negocio.do" type="email" />
          </div>
        )}

        {subStep === 1 && (
          <div className="grid grid-cols-2 gap-3 mt-4">
            <Field label={L('ITBIS %', 'VAT %')} value={form.itbis_pct} onChange={v => set('itbis_pct', v.replace(/[^\d.]/g, ''))} placeholder="18" />
            <Field label={L('Ley 16-92 % (restaurant)', 'Law 16-92 % (restaurant)')} value={form.ley_pct} onChange={v => set('ley_pct', v.replace(/[^\d.]/g, ''))} placeholder="0" />
            <div className="col-span-2">
              <label className="block text-[10px] font-bold uppercase tracking-[2px] text-black/50 dark:text-white/50 mb-1.5">
                {L('Mensaje al pie del recibo', 'Receipt footer message')}
              </label>
              <textarea
                value={form.receipt_footer}
                onChange={e => set('receipt_footer', e.target.value)}
                placeholder={L('Gracias por su compra. Vuelva pronto!', 'Thank you for your purchase. Come back soon!')}
                rows={2}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-white/5 text-[13px] text-black dark:text-white border border-slate-200 dark:border-white/10 focus:border-[#b3001e] focus:bg-white dark:focus:bg-white/10 outline-none resize-none transition" />
            </div>
          </div>
        )}
      </div>

      {error && <ErrorBox text={error} />}

      <FooterNav L={L}
        onBack={subStep === 0 ? onBack : () => setSubStep(0)}
        onNext={next}
        submitting={submitting}
        nextLabel={subStep === 0 ? L('Siguiente', 'Next') : L('Guardar y terminar', 'Save and finish')}
      />
    </div>
  )
}

function SubHeader({ icon: Icon, title, sub }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-11 h-11 rounded-2xl bg-[#b3001e]/10 flex items-center justify-center shrink-0">
        <Icon size={22} className="text-[#b3001e]" />
      </div>
      <div className="min-w-0">
        <h3 className="text-[16px] font-black text-black dark:text-white tracking-tight">{title}</h3>
        <p className="text-[11px] text-black/55 dark:text-white/55 mt-0.5">{sub}</p>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text', required, full }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="block text-[10px] font-bold uppercase tracking-[2px] text-black/50 dark:text-white/50 mb-1.5">
        {label}{required && <span className="text-[#b3001e] ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-white/5 text-[13px] text-black dark:text-white border border-slate-200 dark:border-white/10 focus:border-[#b3001e] focus:bg-white dark:focus:bg-white/10 outline-none transition" />
    </div>
  )
}

function ErrorBox({ text }) {
  return (
    <div className="text-[12px] bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-300 px-3 py-2 rounded-xl">{text}</div>
  )
}

function FooterNav({ L, onBack, onNext, submitting, nextLabel }) {
  return (
    <div className="flex items-center justify-between pt-1">
      <button onClick={onBack} disabled={submitting}
        className="inline-flex items-center gap-1 text-[12px] text-black/55 dark:text-white/55 hover:text-[#b3001e] disabled:opacity-40">
        <ChevronLeft size={13} /> {L('Atras', 'Back')}
      </button>
      <button onClick={onNext} disabled={submitting}
        className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] text-white text-[13px] font-bold disabled:opacity-50 transition-all active:scale-[0.98] shadow-lg shadow-[#b3001e]/25">
        {submitting
          ? <><Loader2 size={14} className="animate-spin" /> {L('Guardando...', 'Saving...')}</>
          : <>{nextLabel} <ArrowRight size={14} /></>}
      </button>
    </div>
  )
}

// ── Path B: First sale ──────────────────────────────────────────────────────
function FirstSalePath({ api, L, onDone, onGoToPos, onBack }) {
  const [form, setForm] = useState({ name: '', price: '', category: 'General', aplica_itbis: true })
  const [stage, setStage] = useState('form')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [createdName, setCreatedName] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    setError(null)
    if (!form.name.trim()) { setError(L('Pon un nombre al producto.', 'Add a product name.')); return }
    const price = Number(form.price)
    if (!Number.isFinite(price) || price <= 0) { setError(L('Precio debe ser mayor a cero.', 'Price must be greater than zero.')); return }
    setSubmitting(true)
    try {
      await api.services?.create?.({
        name: form.name.trim(),
        price,
        category: form.category.trim() || 'General',
        aplica_itbis: form.aplica_itbis ? 1 : 0,
        is_wash: 0, is_menu_item: 0,
      })
      setCreatedName(form.name.trim())
      setStage('success')
    } catch (err) {
      try { window.__txReportError?.(err, { severity: 'error', category: 'onboarding.firstsale.create' }) } catch {}
      setError(err?.message || L('Error creando el producto', 'Error creating product'))
    } finally { setSubmitting(false) }
  }

  if (stage === 'success') {
    const previewTotal = Number(form.price || 0) * (form.aplica_itbis ? 1.18 : 1)
    return (
      <div className="px-6 sm:px-8 py-8 space-y-5">
        <div className="flex flex-col items-center text-center">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full bg-emerald-100 dark:bg-emerald-500/20 animate-tx-pulse" />
            <div className="relative w-16 h-16 rounded-full bg-emerald-500 dark:bg-emerald-400 flex items-center justify-center">
              <Check size={32} className="text-white" strokeWidth={3.5} />
            </div>
          </div>
          <h3 className="text-[22px] font-black text-black dark:text-white tracking-tight mt-4">
            {L('Producto creado', 'Product created')}
          </h3>
          <p className="text-[13px] text-black/60 dark:text-white/60 mt-1.5 max-w-sm leading-relaxed">
            {L('Tu inventario tiene su primer item. Vamos al POS a venderlo.',
               'Your inventory has its first item. Let\'s go to POS and sell it.')}
          </p>
        </div>

        {/* Preview card — matches the POS product tile style so they recognize it */}
        <div className="mx-auto max-w-xs">
          <div className="relative overflow-hidden flex flex-col justify-between p-4 rounded-2xl border-2 border-[#b3001e] bg-gradient-to-br from-[#b3001e]/[0.09] via-white to-white dark:via-black dark:to-black shadow-[0_12px_30px_-12px_rgba(179,0,30,0.55)]">
            <span className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#b3001e] to-transparent" />
            <p className="text-[14px] font-bold text-[#b3001e] leading-snug">{createdName}</p>
            <div className="flex justify-end items-baseline gap-1.5 mt-3 pt-2.5 border-t border-dashed border-slate-200">
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">RD$</span>
              <span className="font-black tabular-nums leading-none text-[24px] text-[#b3001e]">
                {Number(form.price || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </span>
            </div>
            {form.aplica_itbis && (
              <p className="text-[9px] text-slate-400 mt-1.5 text-right">+ ITBIS = RD${previewTotal.toLocaleString('en-US', { maximumFractionDigits: 2 })}</p>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2 pt-2">
          <button onClick={onGoToPos}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold text-[13px] transition-all active:scale-[0.98] shadow-lg shadow-[#b3001e]/25">
            {L('Ir al POS y vender', 'Go to POS and sell')} <ArrowRight size={14} />
          </button>
          <button onClick={onDone}
            className="px-4 py-3 rounded-xl border-2 border-slate-200 dark:border-white/10 text-black/70 dark:text-white/70 hover:border-[#b3001e] hover:text-[#b3001e] text-[12px] font-bold transition">
            {L('Seguir configurando', 'Keep setting up')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 sm:px-8 py-6 space-y-5">
      <SubHeader icon={Tag}
        title={L('Agrega tu primer producto o servicio', 'Add your first product or service')}
        sub={L('Despues lo cobras desde el POS como cualquier venta real.', 'Then ring it up from POS like any real sale.')} />

      <div className="grid grid-cols-2 gap-3">
        <Field label={L('Nombre', 'Name')} value={form.name} onChange={v => set('name', v)}
          placeholder={L('Ej: Lavado Completo', 'e.g. Full Wash')} full required />
        <Field label={L('Precio (RD$)', 'Price (RD$)')} value={form.price}
          onChange={v => set('price', v.replace(/[^\d.]/g, ''))} placeholder="250" required />
        <Field label={L('Categoria', 'Category')} value={form.category} onChange={v => set('category', v)} placeholder="General" />

        <label className="col-span-2 flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-slate-200 dark:border-white/10 cursor-pointer hover:border-[#b3001e] transition">
          <input type="checkbox" checked={form.aplica_itbis} onChange={e => set('aplica_itbis', e.target.checked)} className="accent-[#b3001e] w-4 h-4" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold text-black/80 dark:text-white/80">{L('Aplica ITBIS 18%', 'Apply VAT 18%')}</p>
            <p className="text-[10px] text-black/45 dark:text-white/45 mt-0.5">{L('Desmarca si el producto es exento.', 'Uncheck if the product is exempt.')}</p>
          </div>
          {form.aplica_itbis && <span className="text-[10px] font-bold text-[#b3001e] uppercase tracking-wider">RD$ {(Number(form.price || 0) * 1.18).toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>}
        </label>
      </div>

      {error && <ErrorBox text={error} />}

      <FooterNav L={L} onBack={onBack} onNext={save} submitting={submitting}
        nextLabel={L('Crear producto', 'Create product')} />
    </div>
  )
}

// ── Cross-promo ─────────────────────────────────────────────────────────────
function CrossPromo({ L, missing, onPick, onFinish }) {
  const isMissingFirstsale = missing === 'firstsale'
  const Icon  = isMissingFirstsale ? ShoppingCart : SettingsIcon
  const title = isMissingFirstsale
    ? L('Quieres vender ya tu primer producto?', 'Want to ring up your first sale now?')
    : L('Quieres terminar de configurar?',        'Want to finish configuring?')
  const desc  = isMissingFirstsale
    ? L('Agrega un producto y vendelo en menos de 1 minuto.',                      'Add a product and sell it in under a minute.')
    : L('RNC, telefono, direccion e ITBIS — 3 min y emites recibos fiscales.',     'RNC, phone, address and tax — 3 min and you can issue fiscal receipts.')
  return (
    <div className="px-6 sm:px-8 py-7 space-y-5">
      <div className="flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center">
          <CheckCircle2 size={28} className="text-emerald-700 dark:text-emerald-300" />
        </div>
        <h3 className="text-[18px] font-black text-black dark:text-white tracking-tight mt-3">
          {L('Listo, va por buen camino', 'All set, you\'re on track')}
        </h3>
        <p className="text-[12px] text-black/55 dark:text-white/55 mt-1">
          {L('Antes de cerrar — un paso opcional:', 'Before closing — one optional step:')}
        </p>
      </div>

      <button onClick={() => onPick(missing)}
        className="group w-full text-left p-5 rounded-2xl border-2 border-[#b3001e]/35 bg-gradient-to-br from-[#b3001e]/[0.06] via-white to-white dark:via-black dark:to-black hover:border-[#b3001e] hover:shadow-[0_18px_40px_-14px_rgba(179,0,30,0.5)] hover:-translate-y-0.5 transition-all flex items-center gap-4 relative overflow-hidden">
        <span className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#b3001e] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="w-11 h-11 rounded-2xl bg-[#b3001e]/10 group-hover:bg-[#b3001e]/15 flex items-center justify-center shrink-0 transition">
          <Icon size={22} className="text-[#b3001e]" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-[14px] font-black text-black dark:text-white tracking-tight">{title}</h4>
          <p className="text-[11px] text-black/55 dark:text-white/55 mt-1 leading-relaxed">{desc}</p>
        </div>
        <ChevronRight size={18} className="text-[#b3001e] shrink-0 group-hover:translate-x-0.5 transition-transform" />
      </button>

      <div className="flex items-center justify-center pt-1">
        <button onClick={onFinish}
          className="text-[12px] text-black/45 dark:text-white/45 hover:text-[#b3001e] transition">
          {L('No, terminar configuracion', 'No, finish setup')}
        </button>
      </div>
    </div>
  )
}
