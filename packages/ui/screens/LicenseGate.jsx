import { useState } from 'react'
import { KeyRound, Loader2, CheckCircle2, AlertTriangle, ShieldX, Copy, RefreshCw } from 'lucide-react'
import logoImg from '../assets/logo.webp'
import { useAPI } from '../context/DataContext'
import { useLicense } from '../context/LicenseContext'
import { isValidKeyFormat } from '@terminal-x/services/license'

// ─── Change this to your WhatsApp number (include country code, no +) ─────────
const WHATSAPP_NUMBER = '18098282971'
const WHATSAPP_MSG    = encodeURIComponent('Hola, necesito activar/renovar mi licencia de Terminal X.')
const WHATSAPP_URL    = `https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_MSG}`

const fmtDate = d => d ? new Date(d).toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'

// ─── Auto-formatters for license + RNC/Cédula inputs ──────────────────────────
// License format: TXL-XXXX-XXXX-XXXX (TXL prefix locked + 3 groups of 4 alnum)
function formatLicenseKey(raw) {
  // Strip everything that isn't alphanumeric, uppercase
  let clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  // Don't auto-prepend TXL if user is mid-typing — only on paste of 12+ chars
  // that don't start with T
  if (clean.length >= 12 && !clean.startsWith('TXL')) clean = 'TXL' + clean
  // Cap at 3 prefix + 12 chars = 15 alnum
  clean = clean.slice(0, 15)
  // Apply dashes: TXL-XXXX-XXXX-XXXX
  const parts = []
  if (clean.length > 0) parts.push(clean.slice(0, 3))
  if (clean.length > 3) parts.push(clean.slice(3, 7))
  if (clean.length > 7) parts.push(clean.slice(7, 11))
  if (clean.length > 11) parts.push(clean.slice(11, 15))
  return parts.join('-')
}

// RNC (9 digits) = XXX-XXXXX-X  |  Cédula (11 digits) = XXX-XXXXXXX-X
function formatRncCedula(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 9) {
    // Assume RNC layout until 9 digits: XXX-XXXXX-X
    if (digits.length <= 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`
    return `${digits.slice(0, 3)}-${digits.slice(3, 8)}-${digits.slice(8)}`
  }
  // 10–11 digits → cédula: XXX-XXXXXXX-X
  return `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}`
}

const STATUS_INFO = {
  not_found:        { icon: ShieldX,       color: 'red',   msg: 'Clave de licencia no encontrada.' },
  hardware_mismatch:{ icon: ShieldX,       color: 'red',   msg: 'Esta licencia está registrada en otro equipo.' },
  rebind_required:  { icon: AlertTriangle, color: 'amber', msg: 'Este equipo no está autorizado. El propietario ha sido notificado. Intenta de nuevo en unos minutos.' },
  rnc_mismatch:     { icon: ShieldX,       color: 'red',   msg: 'El RNC no coincide con el de esta licencia.' },
  invalid_format:   { icon: AlertTriangle, color: 'amber', msg: 'Formato de clave inválido. Ejemplo: TXL-A1B2-C3D4-E5F6' },
  inactive:         { icon: ShieldX,       color: 'slate', msg: 'Esta licencia ha sido desactivada.' },
  suspended:        { icon: ShieldX,       color: 'red',   msg: 'Licencia suspendida. Contacta a Terminal X.' },
  pending:          { icon: AlertTriangle, color: 'amber', msg: 'Tu licencia está pendiente de activación. Contacta a Terminal X.' },
  expired:          { icon: AlertTriangle, color: 'amber', msg: 'Tu licencia ha vencido.' },
  no_key:           { icon: KeyRound,      color: 'brand', msg: 'Ingresa tu clave de licencia para continuar.' },
}

export default function LicenseGate() {
  const api = useAPI()
  const { result, hwid, checking, activate, isExpired } = useLicense()
  const [key,        setKey]        = useState('')
  const [rnc,        setRnc]        = useState('')
  const [activating, setActivating] = useState(false)
  const [error,      setError]      = useState('')
  const [success,    setSuccess]    = useState(false)

  const statusKey = result?.status || 'no_key'
  const info      = STATUS_INFO[statusKey] || STATUS_INFO.no_key
  const Icon      = info.icon

  async function handleActivate() {
    const trimmedKey = key.trim().toUpperCase()
    const trimmedRnc = rnc.replace(/\D/g, '')
    const isMaster = await api?.license?.isMaster?.(trimmedKey)
    if (!isMaster && !isValidKeyFormat(trimmedKey)) { setError('Formato inválido. Ejemplo: TXL-A1B2-C3D4-E5F6'); return }
    if (!trimmedRnc) { setError('Ingresa el RNC o cédula del negocio.'); return }
    setError('')
    setActivating(true)
    try {
      await activate(trimmedKey, trimmedRnc)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err.message || 'Error al verificar la licencia.')
    } finally {
      setActivating(false)
    }
  }

  // ── Expired mode — read-only bypass ────────────────────────────────────────
  if (isExpired) {
    return (
      <div className="fixed inset-0 bg-amber-50 dark:bg-black flex flex-col items-center justify-center z-50 p-8">
        <div className="w-full max-w-md bg-white dark:bg-white/5 rounded-3xl shadow-2xl border border-amber-200 dark:border-white/10 overflow-hidden">
          <div className="bg-amber-500 px-8 py-6 text-white text-center">
            <AlertTriangle size={40} className="mx-auto mb-3" />
            <h1 className="text-[22px] font-bold">Licencia Vencida</h1>
            <p className="text-amber-100 text-[13px] mt-1">
              Vencida hace <strong>{result?.daysExpired ?? 0} días</strong> · Solo lectura
            </p>
          </div>

          <div className="px-8 py-6 space-y-4">
            <p className="text-[13px] text-slate-600 dark:text-white/60 text-center">
              Los datos son visibles pero no puedes registrar nuevas transacciones.
            </p>

            <div className="space-y-2">
              <label className="block text-[11px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider">Nueva Clave</label>
              <input type="text" value={key} onChange={e => { setKey(formatLicenseKey(e.target.value)); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleActivate()}
                placeholder="TXL-XXXX-XXXX-XXXX"
                maxLength={16}
                inputMode="text"
                className="w-full px-4 py-3 border border-slate-200 dark:border-white/10 rounded-xl text-[14px] font-mono tracking-widest focus:outline-none focus:border-amber-400 bg-slate-50 dark:bg-white/5 dark:text-white text-center uppercase" />
              <input type="text" value={rnc} onChange={e => { setRnc(formatRncCedula(e.target.value)); setError('') }}
                placeholder="RNC / Cédula del negocio"
                maxLength={13}
                inputMode="numeric"
                className="w-full px-4 py-3 border border-slate-200 dark:border-white/10 rounded-xl text-[14px] focus:outline-none focus:border-amber-400 bg-slate-50 dark:bg-white/5 dark:text-white text-center" />
              {error && <p className="text-[11px] text-red-500 text-center">{error}</p>}
            </div>

            <button onClick={handleActivate} disabled={activating || !key.trim() || !rnc.trim()}
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white font-bold rounded-xl text-[14px] transition-all flex items-center justify-center gap-2">
              {activating ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
              Activar Nueva Licencia
            </button>

            <button onClick={() => { sessionStorage.setItem('tx_read_only_chosen', '1'); window.location.reload() }}
              className="w-full py-2.5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10 font-semibold rounded-xl text-[13px] transition-colors flex items-center justify-center gap-2">
              <RefreshCw size={14} />
              Continuar en Modo Solo Lectura
            </button>

            <WhatsAppButton />
            <HwidBox hwid={hwid} />
          </div>
        </div>
      </div>
    )
  }

  // ── Full gate — invalid / no license ───────────────────────────────────────
  const colorMap = {
    red:   { header: 'bg-red-50 border-red-100',         icon: 'text-red-500'     },
    amber: { header: 'bg-amber-50 border-amber-100',     icon: 'text-amber-500'   },
    slate: { header: 'bg-slate-50 border-slate-200',     icon: 'text-slate-500'   },
    brand: { header: 'bg-[#b3001e]/5 border-[#b3001e]/20', icon: 'text-[#b3001e]' },
  }
  const colors = colorMap[info.color] || colorMap.brand

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center z-50 p-8">
      {/* Brand */}
      <div className="mb-8 text-center flex flex-col items-center">
        <div className="flex items-center gap-0">
          <span className="text-4xl font-black tracking-[3px] text-white sm:text-5xl leading-none -mt-1">TERMINAL</span>
          <img src={logoImg} alt="X" className="h-12 w-auto object-contain sm:h-14" draggable="false" />
        </div>
        <p className="text-slate-400 text-[13px] mt-2">Sistema POS</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-[440px] bg-white dark:bg-white/5 rounded-3xl shadow-2xl overflow-hidden">
        <div className={`flex items-center gap-3 px-6 py-4 border-b ${colors.header}`}>
          <Icon size={20} className={colors.icon} />
          <div>
            <p className="text-[13px] font-bold text-slate-800 dark:text-white">
              {statusKey === 'no_key' ? 'Activación de Licencia' : 'Licencia Inválida'}
            </p>
            <p className="text-[12px] text-slate-500 dark:text-white/60">{info.msg}</p>
          </div>
        </div>

        <div className="px-7 py-6 space-y-4">
          {/* Key input */}
          <div className="space-y-2">
            <label className="block text-[11px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider">
              Clave de Licencia
            </label>
            <input type="text" value={key}
              onChange={e => { setKey(formatLicenseKey(e.target.value)); setError('') }}
              onKeyDown={e => e.key === 'Enter' && handleActivate()}
              placeholder="TXL-XXXX-XXXX-XXXX"
              maxLength={16}
              autoFocus
              className="w-full px-4 py-3.5 border border-slate-200 dark:border-white/10 rounded-xl text-[15px] font-mono tracking-widest focus:outline-none focus:border-[#b3001e] focus:ring-2 focus:ring-[#b3001e]/20 bg-slate-50 dark:bg-white/5 dark:text-white text-center uppercase" />
          </div>

          {/* RNC input */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-1.5">
              RNC / Cédula del Negocio
            </label>
            <input type="text" value={rnc}
              onChange={e => { setRnc(formatRncCedula(e.target.value)); setError('') }}
              onKeyDown={e => e.key === 'Enter' && handleActivate()}
              placeholder="130-12345-6 / 001-1234567-8"
              maxLength={13}
              inputMode="numeric"
              className="w-full px-4 py-3 border border-slate-200 dark:border-white/10 rounded-xl text-[14px] focus:outline-none focus:border-[#b3001e] focus:ring-2 focus:ring-[#b3001e]/20 bg-slate-50 dark:bg-white/5 dark:text-white text-center" />
          </div>

          {error && (
            <p className="text-[11px] text-red-500 font-medium text-center flex items-center justify-center gap-1">
              <AlertTriangle size={11} /> {error}
            </p>
          )}
          {success && (
            <p className="text-[11px] text-green-600 font-medium text-center flex items-center justify-center gap-1">
              <CheckCircle2 size={11} /> Licencia válida
            </p>
          )}

          <button onClick={handleActivate}
            disabled={activating || !key.trim() || !rnc.trim() || checking}
            className="w-full py-3.5 bg-[#b3001e] hover:bg-[#8c0017] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-[14px] transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-md shadow-[#b3001e]/20">
            {activating || checking
              ? <><Loader2 size={16} className="animate-spin" /> Verificando…</>
              : <><KeyRound size={16} /> Activar Terminal X</>
            }
          </button>

          <WhatsAppButton />
          <HwidBox hwid={hwid} />
        </div>
      </div>

      <p className="text-slate-500 text-[11px] mt-6">
        Terminal X · © {new Date().getFullYear()} · Todos los derechos reservados
      </p>
    </div>
  )
}

// ── WhatsApp contact button ───────────────────────────────────────────────────
function WhatsAppButton() {
  return (
    <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer"
      className="flex items-center justify-center gap-2 w-full py-2.5 bg-[#25D366] hover:bg-[#1ebe5c] text-white font-semibold rounded-xl text-[13px] transition-colors">
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.054.519 4 1.426 5.703L0 24l6.439-1.399A11.938 11.938 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-4.964-1.347l-.356-.211-3.698.803.827-3.607-.232-.371A9.818 9.818 0 1112 21.818z"/>
      </svg>
      Contactar Terminal X por WhatsApp
    </a>
  )
}

// ── Hardware ID display ───────────────────────────────────────────────────────
function HwidBox({ hwid }) {
  const [copied, setCopied] = useState(false)
  function copy() { navigator.clipboard?.writeText(hwid || ''); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  return (
    <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3">
      <p className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1.5">ID de Equipo (para soporte)</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-[11px] text-slate-600 dark:text-white/60 font-mono truncate">{hwid || '—'}</code>
        <button onClick={copy} disabled={!hwid} title="Copiar"
          className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white transition-colors shrink-0">
          {copied ? <CheckCircle2 size={13} className="text-green-500" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  )
}
