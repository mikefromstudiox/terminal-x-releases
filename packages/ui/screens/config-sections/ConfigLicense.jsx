// ConfigLicense — dedicated /config/license page. Masked key + re-validate.
//
// 2026-05-19 — Revalidar fix: was calling api.license.validate?.() which
// doesn't exist on either electron or web data layers, so the optional
// chain swallowed the call silently. Now routes through LicenseContext.refresh()
// which is the canonical runCheck() path used by the boot + 4h interval
// (calls validateLicense → /api/validate → updates result/cache/syncJwt).
import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { useSettings, SettingSection, SettingRow, Toast } from '../Sistema'
import { useLang } from '../../i18n'
import { useLicense } from '../../context/LicenseContext'

export default function ConfigLicense() {
  const { cfg, toast, show } = useSettings()
  const { lang } = useLang()
  const license = useLicense()
  const [working, setWorking] = useState(false)
  const L = (es, en) => lang === 'es' ? es : en
  const keyFromCtx = license?.licenseKey || ''
  const rawKey = (keyFromCtx || cfg.license_key || cfg.tx_license_key || '').replace(/-/g, '')
  const formatted = rawKey.length >= 16
    ? `${rawKey.slice(0,4)}-${rawKey.slice(4,8)}-${rawKey.slice(8,12)}-${rawKey.slice(12,16)}`
    : (rawKey || '—')
  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <KeyRound size={22} className="text-[#b3001e]" />
            {L('Licencia', 'License')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Vinculada a este equipo. Para transferir o liberar, contacta a Studio X.',
               'Bound to this terminal. To transfer or release, contact Studio X.')}
          </p>
        </div>
        <Toast toast={toast} />
        <SettingSection title={L('Información', 'Info')}>
          <SettingRow label={L('Clave', 'Key')} hint="">
            <span className="font-mono text-[12px] text-slate-700 dark:text-white">{formatted}</span>
          </SettingRow>
          <SettingRow label={L('Estado', 'Status')} hint="">
            <span className="font-mono text-[12px] text-slate-700 dark:text-white">
              {license?.checking
                ? L('verificando…', 'checking…')
                : (license?.result?.status || (license?.licenseKey ? 'activa' : 'sin-clave'))}
            </span>
          </SettingRow>
          <SettingRow label={L('Re-validar', 'Re-validate')} hint={L('Fuerza una verificación contra el servidor.', 'Forces a server-side check.')}>
            <button
              type="button"
              disabled={working || !license?.refresh}
              onClick={async () => {
                if (!license?.refresh) { show(L('No disponible en este modo', 'Not available in this mode'), 'error'); return }
                setWorking(true)
                try {
                  await license.refresh()
                  show(L('Licencia re-validada ✓', 'License re-validated ✓'))
                } catch (e) {
                  try { window.__txReportError?.(e, { severity: 'warn', category: 'config_license_revalidate' }) } catch {}
                  show(L('Error: ' + (e?.message || 'fallo'), 'Error: ' + (e?.message || 'failed')), 'error')
                } finally { setWorking(false) }
              }}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/70 text-[12px] font-bold hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-50"
            >{working ? L('Validando…', 'Validating…') : L('Re-validar', 'Re-validate')}</button>
          </SettingRow>
        </SettingSection>
      </div>
    </div>
  )
}
