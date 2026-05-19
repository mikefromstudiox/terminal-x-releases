// ConfigFeatures — dedicated /config/funciones page. Per-business
// owner-controlled feature toggles (commissions / discounts / per-line
// ITBIS / age-verification) + Multi-POS coordination.
//
// 2026-05-19 — Added Multi-POS section. When Sistema.jsx was split into
// config-sections cards earlier in v2.17.x, the Multi-POS toggle got left
// behind in the monolithic Sistema page and became unreachable through
// the new navigation. Surfaced during Ranoza's 3-terminal onboarding
// when Mike couldn't find the setting.
import { ToggleLeft, Network } from 'lucide-react'
import { BusinessFeatureToggles } from '../Admin'
import { useLang } from '../../i18n'
import { SettingSection, SettingRow, Toggle, useSettings } from '../Sistema'
import { usePlan } from '../../hooks/usePlan.jsx'

export default function ConfigFeatures() {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const { cfg, set, on } = useSettings()
  const { plan, hasFeature } = usePlan()
  const multiPosAllowed = plan === 'pro_max' || hasFeature?.('multi_pos')

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <ToggleLeft size={22} className="text-[#b3001e]" />
            {L('Funciones del Negocio', 'Business Features')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Activa o apaga funciones según tu operación. Estos cambios afectan toda la caja.',
               'Turn features on or off to match your operation. These changes affect the whole POS.')}
          </p>
        </div>

        <div className="bg-white dark:bg-white/[0.03] rounded-2xl border border-slate-200 dark:border-white/10 p-4 md:p-5">
          <BusinessFeatureToggles />
        </div>

        {/* Multi-POS — promoted from Sistema.jsx in v2.17.13 so it's
            reachable from the new config navigation. Required for any
            client running 2+ desktop terminals on the same business so
            NCFs and ticket doc_numbers coordinate via cloud blocks
            (prevents uq_tickets_biz_ncf collisions). */}
        <div className="bg-white dark:bg-white/[0.03] rounded-2xl border border-slate-200 dark:border-white/10 p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <Network size={18} className="text-[#b3001e]" />
            <h2 className="text-[15px] font-bold text-slate-900 dark:text-white">{L('Multi-POS', 'Multi-POS')}</h2>
          </div>
          <SettingSection title={null}>
            <SettingRow
              settingKey="multi_pos_enabled"
              label={L('Modo multi-POS', 'Multi-POS Mode')}
              hint={multiPosAllowed
                ? L('Activar para correr 2+ POS en el mismo negocio con NCFs sincronizados desde la nube',
                    'Enable to run 2+ POS for the same business with cloud-synced NCFs')
                : L('Requiere plan Pro MAX', 'Requires Pro MAX plan')}
            >
              <Toggle
                enabled={on('multi_pos_enabled')}
                onChange={v => multiPosAllowed && set('multi_pos_enabled', v ? '1' : '0')}
                disabled={!multiPosAllowed}
              />
            </SettingRow>
            {on('multi_pos_enabled') && (
              <>
                <SettingRow label={L('Tamaño de bloque NCF', 'NCF Block Size')} hint={L('Cuántos NCFs se reservan por dispositivo por bloque (defecto: 500)', 'How many NCFs reserved per device per block (default: 500)')}>
                  <input
                    type="number" min="50" max="10000" step="50"
                    className="w-32 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5"
                    value={cfg.ncf_block_size || '500'}
                    onChange={e => set('ncf_block_size', e.target.value)}
                  />
                </SettingRow>
                <SettingRow label={L('Tamaño de bloque ticket', 'Ticket Block Size')} hint={L('Cuántos doc_numbers por bloque (defecto: 200)', 'How many doc_numbers per block (default: 200)')}>
                  <input
                    type="number" min="20" max="5000" step="20"
                    className="w-32 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5"
                    value={cfg.doc_block_size || '200'}
                    onChange={e => set('doc_block_size', e.target.value)}
                  />
                </SettingRow>
              </>
            )}
          </SettingSection>
        </div>
      </div>
    </div>
  )
}
