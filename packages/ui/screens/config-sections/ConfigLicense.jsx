// ConfigLicense — dedicated /config/license page. Masked key + re-validate.
import { KeyRound } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useSettings, SettingSection, SettingRow, Toast } from '../Sistema'
import { useLang } from '../../i18n'

export default function ConfigLicense() {
  const { cfg, toast, show } = useSettings()
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const formatted = (cfg.license_key || cfg.tx_license_key || '').replace(/(.{4})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4') || '—'
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
          <SettingRow label={L('Re-validar', 'Re-validate')} hint={L('Fuerza una verificación contra el servidor.', 'Forces a server-side check.')}>
            <button
              type="button"
              onClick={async () => {
                try { await api.license?.validate?.(); show(L('Licencia re-validada ✓', 'License re-validated ✓')) }
                catch (e) {
                  try {
                    window.__txReportError?.(e, { severity: 'warn', category: 'config_license_revalidate' })
                  } catch {}
                  show(L('Error: ' + (e?.message || 'fallo'), 'Error: ' + (e?.message || 'failed')))
                }
              }}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/70 text-[12px] font-bold hover:bg-slate-50 dark:hover:bg-white/5"
            >{L('Re-validar', 'Re-validate')}</button>
          </SettingRow>
        </SettingSection>
      </div>
    </div>
  )
}
