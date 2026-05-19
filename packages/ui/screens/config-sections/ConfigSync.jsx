// ConfigSync — dedicated /config/sync page. Read-only info about sync
// frequency + offline queue + nightly backup + "Sync now" button +
// owner daily digest toggle.
//
// 2026-05-19 — daily_digest_enabled promoted from Sistema.jsx L989-1003.
import { Cloud } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useSettings, SettingSection, SettingRow, SaveBtn, Toast, Toggle } from '../Sistema'
import { useLang } from '../../i18n'
import { usePlan } from '../../hooks/usePlan.jsx'

export default function ConfigSync() {
  const { cfg, set, on, handleSave, saving, saved, toast, show } = useSettings()
  const api = useAPI()
  const { lang } = useLang()
  const { hasFeature } = usePlan()
  const L = (es, en) => lang === 'es' ? es : en
  const digestAllowed = hasFeature?.('remote_dashboard')
  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <Cloud size={22} className="text-[#b3001e]" />
            {L('Sincronización', 'Sync')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Datos al día entre tus terminales y la nube.',
               'Data in sync between your terminals and the cloud.')}
          </p>
        </div>
        <Toast toast={toast} />
        <SettingSection title={L('Estado', 'Status')}>
          <SettingRow label={L('Frecuencia automática', 'Auto frequency')} hint="">
            <span className="text-[12px] font-bold text-slate-700 dark:text-white">Cada 5 min</span>
          </SettingRow>
          <SettingRow label={L('Cola offline máxima', 'Max offline queue')} hint="">
            <span className="text-[12px] font-bold text-slate-700 dark:text-white">72 horas</span>
          </SettingRow>
          <SettingRow label={L('Backup nocturno', 'Nightly backup')} hint="">
            <span className="text-[12px] font-bold text-slate-700 dark:text-white">3:00 AM · 14d retención</span>
          </SettingRow>
          <SettingRow label={L('Encriptación local', 'Local encryption')} hint="">
            <span className="text-[12px] font-bold text-slate-700 dark:text-white">SQLCipher AES-256</span>
          </SettingRow>
          <SettingRow label={L('Sincronizar ahora', 'Sync now')} hint={L('Fuerza un push pendiente.', 'Force pending push.')}>
            <button
              type="button"
              onClick={async () => {
                try { await api.sync?.runOnce?.(); show(L('Sync iniciado', 'Sync started')) }
                catch (e) {
                  try {
                    window.__txReportError?.(e, { severity: 'warn', category: 'config_sync_now' })
                  } catch {}
                  show(L('Error: ' + (e?.message || 'sync falló'), 'Error: ' + (e?.message || 'sync failed')))
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-black text-white text-[12px] font-bold hover:bg-slate-800"
            >{L('Sincronizar', 'Sync')}</button>
          </SettingRow>
        </SettingSection>

        {/* 2026-05-19 — Daily Digest promoted from Sistema.jsx. Sends the
            owner a daily WhatsApp/email recap. Plan-gated on remote_dashboard
            feature (Pro PLUS / Pro MAX). */}
        <SettingSection title={L('Resumen Diario del Dueño', 'Owner Daily Digest')}>
          <SettingRow settingKey="daily_digest_enabled"
            label={L('Activar resumen diario', 'Enable daily digest')}
            hint={digestAllowed
              ? L('Envía un resumen diario al dueño (ventas, gastos, cuadre).',
                  'Sends a daily recap to the owner (sales, expenses, cuadre).')
              : L('Requiere plan Pro PLUS o superior', 'Requires Pro PLUS or higher')}>
            <Toggle
              enabled={on('daily_digest_enabled')}
              onChange={v => digestAllowed && set('daily_digest_enabled', v ? '1' : '0')}
              disabled={!digestAllowed}
            />
          </SettingRow>
        </SettingSection>

        <div className="flex justify-end mt-4">
          <SaveBtn saving={saving} saved={saved} label={L('Guardar', 'Save')} onClick={handleSave} />
        </div>
      </div>
    </div>
  )
}
