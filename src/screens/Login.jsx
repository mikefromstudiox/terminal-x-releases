import { useState, useEffect } from 'react'
import { Delete } from 'lucide-react'
import { useLang } from '../i18n'
import { useAuth } from '../context/AuthContext'
import LanguageToggle from '../components/LanguageToggle'

// ── PIN Dots ──────────────────────────────────────────────────────────────────
function PinDots({ filled, shake }) {
  return (
    <div className={`flex items-center justify-center gap-4 h-8 ${shake ? 'animate-shake' : ''}`}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
            i < filled
              ? 'bg-[#0C447C] scale-110'
              : 'bg-slate-200 border border-slate-300'
          }`}
        />
      ))}
    </div>
  )
}

// ── Pad Button ────────────────────────────────────────────────────────────────
function PadBtn({ children, onClick, variant = 'digit' }) {
  const styles = {
    digit:  'bg-slate-50 hover:bg-slate-100 active:bg-[#0C447C] active:text-white text-slate-800 text-xl font-semibold border border-slate-200',
    action: 'bg-transparent hover:bg-slate-100 text-slate-400 hover:text-slate-600 text-sm font-medium',
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
      <p className="text-slate-400 text-sm text-center mb-5">{t('login_pin_hint')}</p>
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
        <label className="block text-[11px] font-medium text-slate-500 mb-1.5">{t('login_username')}</label>
        <input
          type="text"
          value={username}
          autoFocus
          autoComplete="username"
          onChange={e => onChange('username', e.target.value)}
          placeholder="admin"
        />
      </div>
      <div>
        <label className="block text-[11px] font-medium text-slate-500 mb-1.5">{t('login_password')}</label>
        <input
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={e => onChange('password', e.target.value)}
        />
      </div>

      <div className="h-4 flex items-center">
        {error && <p className="text-red-500 text-xs">{error}</p>}
      </div>

      <button
        type="submit"
        className="w-full bg-black hover:bg-slate-800 text-white font-semibold py-3 rounded-xl transition-colors active:scale-95 text-[14px]"
      >
        {t('login_enter')}
      </button>
    </form>
  )
}

// ── Login Screen ──────────────────────────────────────────────────────────────
export default function Login() {
  const { t } = useLang()
  const { login, loginWithPassword } = useAuth()

  const [mode, setMode]         = useState('pin')
  const [pin, setPin]           = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState(null)
  const [shake, setShake]       = useState(false)
  // Keyboard support for PIN mode
  useEffect(() => {
    if (mode !== 'pin') return
    function onKey(e) {
      if (e.key >= '0' && e.key <= '9') {
        setPin(p => p.length < 4 ? p + e.key : p)
        setError(null)
      } else if (e.key === 'Backspace') {
        setPin(p => p.slice(0, -1))
        setError(null)
      } else if (e.key === 'Escape') {
        setPin('')
        setError(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])

  // Auto-submit when 4 digits entered
  useEffect(() => {
    if (pin.length !== 4) return
    const timer = setTimeout(() => {
      const ok = login(pin)
      if (!ok) {
        setError(t('login_wrong_pin'))
        setShake(true)
        setPin('')
        setTimeout(() => setShake(false), 500)
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [pin, login, t])

  function handleDigit(d) {
    setPin(p => p.length < 4 ? p + d : p)
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

  function handlePasswordSubmit(e) {
    e.preventDefault()
    const ok = loginWithPassword(username, password)
    if (!ok) setError(t('login_wrong_credentials'))
  }

  function switchMode() {
    setMode(m => m === 'pin' ? 'password' : 'pin')
    setPin('')
    setUsername('')
    setPassword('')
    setError(null)
  }

  return (
    <div className="min-h-screen flex overflow-hidden bg-white">

      {/* ── Left panel — brand ─────────────────────────────────────────────── */}
      <div
        className="hidden md:flex flex-col items-center justify-center bg-black shrink-0 px-8 py-10 relative overflow-hidden"
        style={{ width: 280 }}
      >
        {/* Logo box */}
        <div className="w-20 h-20 bg-white flex items-center justify-center mb-6 shrink-0" style={{ borderRadius: 14 }}>
          <img
            src="/assets/logo.png"
            alt="Terminal X"
            className="w-14 h-14 object-contain"
            draggable={false}
          />
        </div>

        {/* Brand name */}
        <p className="text-white font-[500] tracking-[3px] leading-none text-center w-full" style={{ fontSize: 24 }}>TERMINAL X</p>
        <p className="text-white/40 leading-none mt-2 text-center w-full" style={{ fontSize: 12 }}>POS</p>

      </div>

      {/* ── Right panel — login form ───────────────────────────────────────── */}
      <div className="flex flex-col items-center justify-center flex-1 bg-white relative px-8">

        {/* Language toggle */}
        <div className="absolute top-5 right-5">
          <LanguageToggle />
        </div>

        {/* Mobile-only logo */}
        <div className="md:hidden flex flex-col items-center gap-2 mb-8">
          <div className="w-16 h-16 bg-black rounded-[12px] flex items-center justify-center">
            <img src="/assets/logo.png" alt="Terminal X" className="w-11 h-11 object-contain" draggable={false} />
          </div>
          <p className="text-slate-800 text-[16px] font-[500] tracking-[2px]">TERMINAL X</p>
        </div>

        <div className="w-full max-w-xs">
          <h2 className="text-slate-800 text-[20px] font-bold mb-7 text-center">{t('login_title')}</h2>

          {/* Card */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
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
              className="mt-6 w-full text-center text-slate-400 text-xs hover:text-slate-600 transition-colors"
            >
              {mode === 'pin' ? t('login_switch_to_password') : t('login_switch_to_pin')}
            </button>
          </div>

          {/* Demo hint */}
          <p className="text-slate-300 text-xs text-center mt-4">
            Demo PIN: 1234 (owner) · 0000 (cajero)
          </p>
        </div>
      </div>
    </div>
  )
}
