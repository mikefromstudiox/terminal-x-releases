// ConfigNCF — dedicated /config/ncf page. The fiscal control center:
//   1. Certificado digital
//        - web: Viafirma upload + env switch via <ScreenCert />
//        - desktop: native file dialog + passphrase → installCert IPC
//   2. Modo fiscal (B-series legacy vs e-CF electrónico)
//   3. Secuencias B01/B02/E31/E32/E33/E34/E43/E44/E47 with per-line toggle + range inputs
//
// DGII tab (/pos/dgii) keeps only 606 / 607 / Anular e-NCF.
//
// 2026-05-19 — Desktop "Instalar certificado" card added. Was previously
// only rendered on web because ScreenCert's upload UI uses File objects
// + /api/dgii-cert-upload (not exposed to electron preload). Desktop
// owners landed on /config/ncf, saw only the NCF sequences, and the
// install affordance was nowhere to be found (regression after the
// config rework moved the entry point off /pos/dgii). Now a separate
// desktop-only card calls electronAPI.dgii_ecf.installCert({ passphrase })
// — the IPC handler opens the native file dialog and persists via
// cert-manager.
import { useState, useEffect } from 'react'
import { Receipt, Upload, Check } from 'lucide-react'
import { FiscalNCF } from '../Admin'
import { ScreenCert } from '../DGII'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../i18n'

export default function ConfigNCF() {
  const { lang } = useLang()
  const { user } = useAuth()
  const L = (es, en) => lang === 'es' ? es : en

  const isWeb     = typeof window !== 'undefined' && !window.electronAPI
  const isDesktop = !isWeb
  const isOwner   = String(user?.role || '').toLowerCase() === 'owner'
  const showWebCert     = isWeb     && isOwner
  const showDesktopCert = isDesktop && isOwner

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <Receipt size={22} className="text-[#b3001e]" />
            {L('NCF / e-CF', 'NCF / e-CF')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Certificado digital, modo fiscal (B-series vs e-CF) y secuencias autorizadas por la DGII.',
               'Digital certificate, fiscal mode (B-series vs e-CF) and DGII-authorized sequences.')}
          </p>
        </div>

        {showWebCert && (
          <div className="mb-6 bg-white dark:bg-white/[0.03] rounded-2xl border border-slate-200 dark:border-white/10 p-4 md:p-5">
            <ScreenCert />
          </div>
        )}

        {showDesktopCert && <DesktopCertCard L={L} />}

        <FiscalNCF />
      </div>
    </div>
  )
}

function DesktopCertCard({ L }) {
  const [info, setInfo]               = useState(null)
  const [loading, setLoading]         = useState(true)
  const [pass, setPass]               = useState('')
  const [installing, setInstalling]   = useState(false)
  const [msg, setMsg]                 = useState(null)  // {type:'ok'|'error', text}

  useEffect(() => {
    let cancelled = false
    const dgii = window.electronAPI?.dgii_ecf
    if (!dgii?.certInfo) { setLoading(false); return }
    dgii.certInfo()
      .then(r => { if (!cancelled) setInfo(r?.data || r || { installed: false }) })
      .catch(() => { if (!cancelled) setInfo({ installed: false }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [msg?.type === 'ok'])

  async function handleInstall() {
    const dgii = window.electronAPI?.dgii_ecf
    if (!dgii?.installCert) return
    setInstalling(true); setMsg(null)
    try {
      const result = await dgii.installCert({ passphrase: pass })
      // installCert returns {ok, data:{...}} after the 2026-04 IPC wrapper.
      // Older builds returned a flat object — handle both.
      const r = result?.data || result
      if (r?.ok === false || (!r?.ok && !r?.serialNumber)) {
        setMsg({ type: 'error', text: r?.error || result?.error || L('Error al instalar certificado', 'Error installing certificate') })
      } else {
        const sn = r?.serialNumber ? `${r.serialNumber.slice(0, 12)}…` : ''
        setMsg({ type: 'ok', text: sn ? L(`Certificado instalado (SN: ${sn})`, `Certificate installed (SN: ${sn})`) : L('Certificado instalado ✓', 'Certificate installed ✓') })
        setPass('')
      }
    } catch (err) {
      try { window.__txReportError?.(err, { severity: 'error', category: 'config_ncf.install_cert' }) } catch {}
      const m = err?.message || ''
      const friendly = /isEncryptionAvailable|safeStorage/i.test(m)
        ? L('Error de cifrado del sistema. Reinicia el app e intenta de nuevo.', 'System encryption error. Restart the app and try again.')
        : /cancelado|cancel/i.test(m)
          ? L('Operación cancelada', 'Cancelled')
          : (m || L('Error desconocido', 'Unknown error'))
      setMsg({ type: 'error', text: friendly })
    } finally {
      setInstalling(false)
    }
  }

  const installed = !!info?.installed
  const subject   = info?.subject || info?.cn || ''
  const expiry    = info?.expiry  || info?.notAfter || ''

  return (
    <div className="mb-6 bg-white dark:bg-white/[0.03] rounded-2xl border border-slate-200 dark:border-white/10 p-4 md:p-5">
      <p className="text-[11px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-3">
        {installed
          ? L('Reinstalar Certificado .p12', 'Reinstall Certificate .p12')
          : L('Instalar Certificado .p12', 'Install Certificate .p12')}
      </p>

      {loading ? (
        <p className="text-[12px] text-slate-500 dark:text-white/50">{L('Cargando…', 'Loading…')}</p>
      ) : installed ? (
        <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-[12px] text-emerald-700 dark:text-emerald-300">
          <p className="font-semibold">{L('Certificado instalado', 'Certificate installed')}</p>
          {subject && <p className="opacity-80 mt-0.5">{subject}</p>}
          {expiry && <p className="opacity-80">{L('Vence:', 'Expires:')} {String(expiry).slice(0, 10)}</p>}
        </div>
      ) : (
        <p className="text-[12px] text-slate-600 dark:text-white/70 mb-3">
          {L('Aún no hay certificado instalado en este equipo.', 'No certificate installed on this terminal yet.')}
        </p>
      )}

      <p className="text-[11px] text-slate-500 dark:text-white/50 mb-2">
        {L('Ingresa la contraseña del .p12 y selecciona el archivo en el siguiente diálogo.',
           'Enter the .p12 password and pick the file in the next dialog.')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="password"
          value={pass}
          onChange={e => setPass(e.target.value)}
          placeholder={L('Contraseña del .p12', '.p12 password')}
          className="flex-1 min-w-[180px] max-w-[260px] px-3 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/40"
        />
        <button
          onClick={handleInstall}
          disabled={installing || !pass}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#b3001e] text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition"
        >
          <Upload size={14} />
          {installing
            ? L('Instalando…', 'Installing…')
            : (installed ? L('Reinstalar', 'Reinstall') : L('Seleccionar .p12', 'Select .p12'))}
        </button>
      </div>
      {msg?.type === 'ok' && (
        <p className="text-[12px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1 mt-2">
          <Check size={11} /> {msg.text}
        </p>
      )}
      {msg?.type === 'error' && (
        <p className="text-[12px] text-red-500 dark:text-red-400 mt-2">{msg.text}</p>
      )}
    </div>
  )
}
