// KioskLock — full-screen PIN overlay shown when the kiosk idle timer fires.
//
// We do NOT flush the React user state — the session is held as-is and the
// underlying routes/modals stay mounted. This means: re-entering the correct
// PIN dissolves the overlay and the cashier resumes exactly where they were
// (same route, same cart, same open modals).
//
// Security: a mismatched PIN attempt never reveals whose PIN succeeds. It must
// match the CURRENT user (same id as stored in AuthContext). Other staff PINs
// are rejected — the kiosk is locked to whoever opened it, not whoever shows up.
import { useState, useEffect } from 'react'
import { Delete, Lock, AlertCircle } from 'lucide-react'
import { useLang } from '../i18n'
import { useAuth } from '../context/AuthContext'
import { useAPI } from '../context/DataContext'
import { useKiosk } from '../context/KioskContext'
import logoImg from '../assets/logo.webp'

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

function PadBtn({ children, onClick, variant = 'digit' }) {
  const styles = {
    digit:  'bg-slate-50 hover:bg-slate-100 active:bg-[#b3001e] active:text-white text-slate-800 text-xl font-semibold border border-slate-200 dark:bg-white/5 dark:hover:bg-white/10 dark:text-white dark:border-white/10',
    action: 'bg-transparent hover:bg-slate-100 text-slate-400 hover:text-slate-600 text-sm font-medium dark:hover:bg-white/10 dark:text-white/40 dark:hover:text-white/60',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-14 rounded-xl transition-all active:scale-95 select-none ${styles[variant]}`}
    >
      {children}
    </button>
  )
}

export default function KioskLock() {
  const { locked, unlock } = useKiosk()
  const { user, logout } = useAuth()
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(false)
  const [err, setErr] = useState('')
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    if (!locked) { setPin(''); setErr('') }
  }, [locked])

  async function tryUnlock(candidate) {
    if (verifying) return
    setVerifying(true)
    setErr('')
    try {
      const u = await api?.auth?.byPin?.(candidate)
      // Must match the CURRENTLY locked user. A manager/owner PIN will NOT
      // hijack this terminal — logging out is the supported path for that.
      if (u?.id && user?.id && String(u.id) === String(user.id)) {
        unlock()
      } else {
        setShake(true)
        setErr(L('PIN incorrecto', 'Wrong PIN'))
        setTimeout(() => setShake(false), 400)
        setTimeout(() => setPin(''), 200)
      }
    } catch {
      setShake(true)
      setErr(L('Error al verificar', 'Verification error'))
      setTimeout(() => setShake(false), 400)
      setTimeout(() => setPin(''), 200)
    } finally {
      setVerifying(false)
    }
  }

  function onDigit(d) {
    if (verifying) return
    setErr('')
    setPin(p => {
      if (p.length >= 6) return p
      const next = p + d
      if (next.length === 6 || next.length === 4) {
        // Auto-attempt at 4 and 6 digits (covers 4-pin stores and 6-pin stores).
        // If 4 fails, user can keep typing up to 6.
        setTimeout(() => tryUnlock(next), 60)
      }
      return next
    })
  }
  function onBackspace() { setPin(p => p.slice(0, -1)); setErr('') }
  function onClear() { setPin(''); setErr('') }

  if (!locked) return null

  const digits = ['1','2','3','4','5','6','7','8','9']

  return (
    <div className="fixed inset-0 z-[500] bg-slate-900/95 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-xs">
        <div className="flex flex-col items-center mb-6">
          <img src={logoImg} alt="" width="56" height="56" className="mb-3 opacity-90" />
          <div className="flex items-center gap-1.5 text-white/60 text-[11px] uppercase tracking-wider font-semibold">
            <Lock size={11} /> {L('Sesión bloqueada', 'Session locked')}
          </div>
          <p className="text-white text-[15px] font-semibold mt-2">
            {user?.name || L('Usuario', 'User')}
          </p>
          <p className="text-white/50 text-[11px] mt-0.5">
            {L('Ingresa tu PIN para continuar', 'Enter your PIN to continue')}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-5">
          <PinDots filled={pin.length} shake={shake} />
          <div className="h-6 flex items-center justify-center mt-1 mb-2">
            {err && (
              <p className="text-red-500 text-xs flex items-center gap-1">
                <AlertCircle size={11} /> {err}
              </p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {digits.map(d => (
              <PadBtn key={d} onClick={() => onDigit(d)}>{d}</PadBtn>
            ))}
            <PadBtn variant="action" onClick={onClear}>
              {pin.length > 0 ? L('Limpiar', 'Clear') : ''}
            </PadBtn>
            <PadBtn onClick={() => onDigit('0')}>0</PadBtn>
            <PadBtn variant="action" onClick={onBackspace}>
              <Delete size={18} className="mx-auto" />
            </PadBtn>
          </div>
        </div>

        <button
          onClick={logout}
          className="w-full mt-4 py-2 text-white/50 hover:text-white/80 text-[11px] font-medium transition-colors"
        >
          {L('Cerrar sesión', 'Sign out')}
        </button>
      </div>
    </div>
  )
}
