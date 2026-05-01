import { useState, useEffect, useRef } from 'react'
import logoImg from '../assets/logo.webp'
import xMark from '../assets/x-mark.webp'
import { Delete } from 'lucide-react'
import { useLang } from '../i18n'
import { useAuth } from '../context/AuthContext'
const isWebRuntime = () => typeof window !== 'undefined' && !window.electronAPI
import LanguageToggle from '../components/LanguageToggle'
import PullErrorBanner from '../components/PullErrorBanner'

// ── PIN Dots ──────────────────────────────────────────────────────────────────
function PinDots({ filled, shake }) {
  return (
    <div className={`flex items-center justify-center gap-3 h-8 ${shake ? 'animate-shake' : ''}`}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={`w-3 h-3 rounded-full transition-all duration-150 ${
            i < filled
              ? 'bg-[#b3001e] scale-110'
              : 'bg-slate-200 border border-slate-300 dark:bg-white/10 dark:border-white/10'
          }`}
        />
      ))}
    </div>
  )
}

// ── Pad Button ────────────────────────────────────────────────────────────────
function PadBtn({ children, onClick, variant = 'digit' }) {
  const styles = {
    digit:  'bg-slate-50 hover:bg-slate-100 active:bg-[#b3001e] active:text-white text-slate-800 text-xl font-semibold border border-slate-200 dark:bg-white/5 dark:hover:bg-white/10 dark:text-white dark:border-white/10',
    action: 'bg-transparent hover:bg-slate-100 text-slate-400 hover:text-slate-600 text-sm font-medium dark:hover:bg-white/10 dark:text-white/40 dark:hover:text-white/60',
  }
  return (
    <button
      onClick={onClick}
      className={`h-14 rounded-xl transition-all active:scale-95 select-none ${styles[variant]}`}
    >
      {children}
    </button>
  )
}

// ── PIN Mode ──────────────────────────────────────────────────────────────────
function PinMode({ pin, error, shake, onDigit, onBackspace, onClear, t }) {
  const digits = ['1','2','3','4','5','6','7','8','9']

  return (
    <div>
      <p className="text-slate-400 dark:text-white/40 text-sm text-center mb-5">{t('login_pin_hint')}</p>
      <PinDots filled={pin.length} shake={shake} />

      <div className="h-6 flex items-center justify-center mt-1 mb-2">
        {error && <p className="text-red-500 text-xs">{error}</p>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {digits.map(d => (
          <PadBtn key={d} onClick={() => onDigit(d)}>{d}</PadBtn>
        ))}
        {/* Bottom row */}
        <PadBtn variant="action" onClick={onClear}>
          {pin.length > 0 ? t('login_clear') : ''}
        </PadBtn>
        <PadBtn onClick={() => onDigit('0')}>0</PadBtn>
        <PadBtn variant="action" onClick={onBackspace}>
          <Delete size={18} className="mx-auto" />
        </PadBtn>
      </div>
    </div>
  )
}

// ── Password Mode ─────────────────────────────────────────────────────────────
function PasswordMode({ username, password, error, onChange, onSubmit, t }) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-[11px] font-medium text-slate-500 dark:text-white/60 mb-1.5">{t('login_username')}</label>
        <input
          type="text"
          value={username}
          autoFocus
          autoComplete="username"
          onChange={e => onChange('username', e.target.value)}
          placeholder="admin"
          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 text-sm dark:bg-white/5 dark:text-white dark:border-white/10"
        />
      </div>
      <div>
        <label className="block text-[11px] font-medium text-slate-500 dark:text-white/60 mb-1.5">{t('login_password')}</label>
        <input
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={e => onChange('password', e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 text-sm dark:bg-white/5 dark:text-white dark:border-white/10"
        />
      </div>

      <div className="h-4 flex items-center">
        {error && <p className="text-red-500 text-xs">{error}</p>}
      </div>

      <button
        type="submit"
        className="w-full bg-black hover:bg-slate-800 text-white font-semibold py-3 rounded-xl transition-colors active:scale-95 text-[14px] dark:bg-white dark:text-black dark:hover:bg-white/90"
      >
        {t('login_enter')}
      </button>
    </form>
  )
}

// ── Login Screen ──────────────────────────────────────────────────────────────
export default function Login() {
  const { t, lang } = useLang()
  const { login, loginWithPassword, logout } = useAuth()
  const L = (es, en) => lang === 'es' ? es : en

  const [mode, setMode]         = useState('pin')
  const [pin, setPin]           = useState('')
  // v2.16.27 — pinRef tracks the latest pin so the auto-submit timer can
  // detect "user kept typing while we awaited login()" and suppress the
  // stale "PIN incorrecto" toast for a length-4/5 attempt that's already
  // been superseded by a length-5/6 attempt in flight.
  const pinRef = useRef('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState(null)
  const [shake, setShake]       = useState(false)
  // Keyboard support for PIN mode
  useEffect(() => {
    if (mode !== 'pin') return
    function onKey(e) {
      if (e.key >= '0' && e.key <= '9') {
        setPin(p => p.length < 6 ? p + e.key : p)
        setError(null)
      } else if (e.key === 'Backspace') {
        setPin(p => p.slice(0, -1))
        setError(null)
      } else if (e.key === 'Escape') {
        setPin('')
        setError(null)
      } else if (e.key === 'Enter') {
        // Allow manual submit for PINs > 4 digits
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])

  // Auto-submit when 4+ digits entered. Each length waits briefly for more digits
  // before trying. If wrong, we always surface the error — previously 4-5 digit
  // failures were silent, which made it look like "nothing happened" when the
  // user typed their correct PIN and it wasn't in the local DB (unsynced user,
  // hash mismatch, etc). Only reset + shake at max length so users can keep
  // typing a longer PIN without losing their input.
  // Keep pinRef in lockstep with pin state so the timer closure can read
  // the LATEST value (closures capture the snapshot at schedule-time only).
  useEffect(() => { pinRef.current = pin }, [pin])

  useEffect(() => {
    if (pin.length < 4) return
    const delay = pin.length === 6 ? 100 : 600 // wait a bit longer at 4-5 so fast typists can extend
    const submittedPin = pin
    const timer = setTimeout(async () => {
      const res = await login(submittedPin)
      // Back-compat: old return was a boolean; new return is { ok, lockedUntil }.
      const ok = res === true || res?.ok === true
      // v2.16.27 — Two guards against the "PIN incorrecto" flicker:
      //   1. If the user kept typing while login() was awaiting, the PIN is
      //      now longer than what we submitted — a fresher attempt is in
      //      flight. Suppress THIS attempt's error entirely so the user
      //      never sees red for a length-4 fail when their real PIN is
      //      length-5 or length-6.
      //   2. On success, clear any stale error from a prior mid-PIN attempt.
      if (pinRef.current !== submittedPin) return
      if (ok) { setError(null); return }
      if (!ok) {
        // Sprint 10 — if any row is currently locked, surface it explicitly
        // so the cashier knows to wait instead of pounding the pad.
        const lockedUntil = res?.lockedUntil
        if (lockedUntil) {
          const mins = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60000))
          setError(`${L('Cuenta bloqueada. Espera', 'Account locked. Wait')} ${mins} min.`)
        } else {
          setError(t('login_wrong_pin'))
        }
        if (pin.length >= 6) {
          setShake(true)
          setPin('')
          setTimeout(() => setShake(false), 500)
        }
      }
    }, delay)
    return () => clearTimeout(timer)
  }, [pin, login, t])

  function handleDigit(d) {
    setPin(p => p.length < 6 ? p + d : p)
    setError(null)
  }

  function handleBackspace() {
    setPin(p => p.slice(0, -1))
    setError(null)
  }

  function handleClear() {
    setPin('')
    setError(null)
  }

  function handleFieldChange(field, value) {
    if (field === 'username') setUsername(value)
    else setPassword(value)
    setError(null)
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault()
    const res = await loginWithPassword(username, password)
    const ok = res === true || res?.ok === true
    if (!ok) {
      const lockedUntil = res?.lockedUntil
      if (lockedUntil) {
        const mins = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60000))
        setError(`${L('Cuenta bloqueada. Espera', 'Account locked. Wait')} ${mins} min.`)
      } else {
        setError(t('login_wrong_credentials'))
      }
    }
  }

  function switchMode() {
    setMode(m => m === 'pin' ? 'password' : 'pin')
    setPin('')
    setUsername('')
    setPassword('')
    setError(null)
  }

  return (
    <div className="min-h-screen flex overflow-hidden bg-white dark:bg-black">

      {/* ── Left panel — brand ─────────────────────────────────────────────── */}
      <div
        className="hidden md:flex flex-col items-center justify-center bg-black shrink-0 px-10 py-10 relative overflow-hidden"
        style={{ width: 360 }}
      >
        <div className="flex items-center justify-center gap-1">
          <span className="text-3xl font-black tracking-[2px] text-white lg:text-4xl leading-none">TERMINAL</span>
          <img src={logoImg} alt="X" className="h-10 w-auto object-contain lg:h-12" draggable="false" />
        </div>
      </div>

      {/* ── Right panel — login form ───────────────────────────────────────── */}
      <div className="flex flex-col items-center justify-center flex-1 bg-white dark:bg-black relative px-8">

        {/* Language toggle */}
        <div className="absolute top-5 right-5">
          <LanguageToggle />
        </div>

        {/* Mobile-only logo */}
        <div className="md:hidden flex items-center justify-center gap-0 mb-8">
          <span className="text-4xl font-black tracking-[3px] text-black dark:text-white sm:text-5xl leading-none -mt-1">TERMINAL</span>
          <img src={logoImg} alt="X" className="h-12 w-auto object-contain sm:h-14" draggable="false" />
        </div>

        <div className="w-full max-w-xs">
          <h2 className="text-slate-800 dark:text-white text-[20px] font-bold mb-7 text-center">{t('login_title')}</h2>

          <PullErrorBanner />

          {/* Card */}
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/10 shadow-sm p-6">
            {mode === 'pin' ? (
              <PinMode
                pin={pin}
                error={error}
                shake={shake}
                onDigit={handleDigit}
                onBackspace={handleBackspace}
                onClear={handleClear}
                t={t}
              />
            ) : (
              <PasswordMode
                username={username}
                password={password}
                error={error}
                onChange={handleFieldChange}
                onSubmit={handlePasswordSubmit}
                t={t}
              />
            )}

            <button
              onClick={switchMode}
              className="mt-6 w-full text-center text-slate-400 dark:text-white/40 text-xs hover:text-slate-600 dark:hover:text-white/60 transition-colors"
            >
              {mode === 'pin' ? t('login_switch_to_password') : t('login_switch_to_pin')}
            </button>
          </div>


          {/* Disconnect device — on web = full sign out (clears Supabase
              session + redirects to landing). On desktop = wipe local DB
              and reload so setup wizard re-runs. */}
          <button
            onClick={async () => {
              const onWeb = isWebRuntime()
              const msg = onWeb
                ? L(
                    '¿Cerrar sesión en este dispositivo? Volverás a la pantalla de inicio de sesión.',
                    'Sign out on this device? You will return to the login screen.'
                  )
                : L(
                    '¿Desconectar este dispositivo? Volverás a la pantalla de configuración para vincular una cuenta. Tus datos locales se mantienen.',
                    'Disconnect this device? You will return to the setup screen to link an account. Your local data is preserved.'
                  )
              const ok = confirm(msg)
              if (!ok) return
              if (onWeb) {
                try { await logout?.() } catch {}
                return
              }
              try { await window.electronAPI?.resetLocalDatabase?.() } catch {}
              window.location.reload()
            }}
            className="mt-6 w-full text-center text-slate-300 dark:text-white/20 text-[10px] hover:text-red-400 dark:hover:text-red-400 transition-colors"
          >
            {isWebRuntime()
              ? L('Cerrar sesión', 'Sign out')
              : L('Desconectar dispositivo', 'Disconnect device')}
          </button>

        </div>
      </div>
    </div>
  )
}
