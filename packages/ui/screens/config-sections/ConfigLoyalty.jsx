// ConfigLoyalty — dedicated /config/loyalty page.
//
// Loyalty program config. Promoted from Sistema.jsx L721-770 as part of
// the 2026-05-19 config consolidation. Plan-gated via the `loyalty`
// feature flag (Pro PLUS / Pro MAX).
import { Award } from 'lucide-react'
import { useSettings, SettingSection, SettingRow, SaveBtn, Toast, Toggle, Input } from '../Sistema'
import { useLang } from '../../i18n'
import { usePlan } from '../../hooks/usePlan.jsx'

export default function ConfigLoyalty() {
  const { cfg, set, on, handleSave, saving, saved, toast } = useSettings()
  const { lang } = useLang()
  const { hasFeature } = usePlan()
  const L = (es, en) => lang === 'es' ? es : en
  const allowed = hasFeature?.('loyalty')

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <Award size={22} className="text-[#b3001e]" />
            {L('Lealtad', 'Loyalty')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Acumula puntos por compra y canjea en cobro.',
               'Earn points per sale and redeem at checkout.')}
          </p>
        </div>
        <Toast toast={toast} />

        <SettingSection title={L('Programa de Lealtad', 'Loyalty Program')}>
          <SettingRow settingKey="loyalty_enabled"
            label={L('Activar programa', 'Enable program')}
            hint={allowed
              ? L('Acumula puntos por compra y permite canjear en cobro', 'Earn points per sale and redeem at checkout')
              : L('Requiere plan Pro PLUS o superior', 'Requires Pro PLUS or higher')}>
            <Toggle enabled={on('loyalty_enabled')} onChange={v => allowed && set('loyalty_enabled', v ? '1' : '0')} disabled={!allowed} />
          </SettingRow>
          {allowed && on('loyalty_enabled') && (
            <>
              <SettingRow settingKey="loyalty_points_ratio"
                label={L('RD$ por 1 punto', 'RD$ per 1 point')}
                hint={L('Cuánto gasta el cliente para ganar 1 punto (defecto: 100)', 'How much client spends to earn 1 point (default: 100)')}>
                <Input type="number" min="1" max="100000" step="1"
                  value={cfg.loyalty_points_ratio ?? '100'}
                  onChange={e => set('loyalty_points_ratio', e.target.value)}
                  className="w-24 text-center" />
              </SettingRow>
              <SettingRow settingKey="loyalty_redemption_ratio"
                label={L('Puntos por RD$1 de descuento', 'Points per RD$1 off')}
                hint={L('Canje: 2 = 100 pts dan RD$50 (defecto)', 'Redeem: 2 = 100 pts = RD$50 off (default)')}>
                <Input type="number" min="0.1" max="100" step="0.1"
                  value={cfg.loyalty_redemption_ratio ?? '2'}
                  onChange={e => set('loyalty_redemption_ratio', e.target.value)}
                  className="w-24 text-center" />
              </SettingRow>
              <SettingRow settingKey="loyalty_tier_silver" label={L('Umbral Silver (pts)', 'Silver threshold (pts)')}>
                <Input type="number" min="0" step="100"
                  value={cfg.loyalty_tier_silver ?? '1000'}
                  onChange={e => set('loyalty_tier_silver', e.target.value)}
                  className="w-28 text-center" />
              </SettingRow>
              <SettingRow settingKey="loyalty_tier_gold" label={L('Umbral Gold (pts)', 'Gold threshold (pts)')}>
                <Input type="number" min="0" step="100"
                  value={cfg.loyalty_tier_gold ?? '5000'}
                  onChange={e => set('loyalty_tier_gold', e.target.value)}
                  className="w-28 text-center" />
              </SettingRow>
              <SettingRow settingKey="loyalty_tier_platinum" label={L('Umbral Platinum (pts)', 'Platinum threshold (pts)')}>
                <Input type="number" min="0" step="100"
                  value={cfg.loyalty_tier_platinum ?? '10000'}
                  onChange={e => set('loyalty_tier_platinum', e.target.value)}
                  className="w-28 text-center" />
              </SettingRow>
            </>
          )}
        </SettingSection>

        <div className="flex justify-end mt-4">
          <SaveBtn saving={saving} saved={saved} label={L('Guardar', 'Save')} onClick={handleSave} />
        </div>
      </div>
    </div>
  )
}
