// ConfigRestaurant — dedicated /config/restaurant page.
//
// Restaurant-specific settings: servicio Ley 16-92, pre-cuenta print,
// course pacing, KDS color thresholds. Promoted from Sistema.jsx
// L822-890 as part of the 2026-05-19 config consolidation. Vertical-
// gated to restaurant only (ConfigGrid filter).
import { UtensilsCrossed } from 'lucide-react'
import { useSettings, SettingSection, SettingRow, SaveBtn, Toast, Toggle, Input } from '../Sistema'
import { useLang } from '../../i18n'

export default function ConfigRestaurant() {
  const { cfg, set, handleSave, saving, saved, toast } = useSettings()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <UtensilsCrossed size={22} className="text-[#b3001e]" />
            {L('Restaurante (KDS y Mesas)', 'Restaurant (KDS & Tables)')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Servicio 10% (Ley 16-92), pre-cuenta, tiempos de cocina y umbrales del KDS.',
               '10% service (Law 16-92), pre-bill, course pacing and KDS color thresholds.')}
          </p>
        </div>
        <Toast toast={toast} />

        <SettingSection title={L('Servicio (Ley 16-92)', 'Service (Law 16-92)')}>
          <SettingRow settingKey="restaurant_servicio_pct"
            label={L('Servicio (%)', 'Service charge (%)')}
            hint={L('Costumbre RD / Ley 16-92. Defecto: 10%.', 'DR custom / Law 16-92. Default: 10%.')}>
            <Input type="number" min="0" max="100" step="0.5"
              value={cfg.restaurant_servicio_pct ?? '10'}
              onChange={e => set('restaurant_servicio_pct', e.target.value)}
              className="w-24 text-center" />
          </SettingRow>
          <SettingRow settingKey="restaurant_servicio_auto_apply"
            label={L('Aplicar automáticamente', 'Apply automatically')}
            hint={L('Pre-selecciona la propina al cobrar.', 'Pre-selects the tip chip at checkout.')}>
            <Toggle enabled={String(cfg.restaurant_servicio_auto_apply ?? '1') === '1'}
              onChange={v => set('restaurant_servicio_auto_apply', v ? '1' : '0')} />
          </SettingRow>
        </SettingSection>

        <SettingSection title={L('Mesas y Pre-cuenta', 'Tables & Pre-bill')}>
          <SettingRow settingKey="restaurant_print_precuenta_enabled"
            label={L('Imprimir pre-cuenta', 'Print pre-bill')}
            hint={L('Al pulsar "Pedir cuenta" se imprime un recibo NO fiscal.', 'On "Request bill", prints a NON-fiscal receipt.')}>
            <Toggle enabled={String(cfg.restaurant_print_precuenta_enabled ?? '1') === '1'}
              onChange={v => set('restaurant_print_precuenta_enabled', v ? '1' : '0')} />
          </SettingRow>
          <SettingRow settingKey="restaurant_course_pacing_minutes"
            label={L('Tiempo entre tiempos (min)', 'Course pacing (min)')}
            hint={L('Disparo automático del siguiente tiempo. 0 = desactivado.', 'Auto-fires the next course after this delay. 0 = off.')}>
            <Input type="number" min="0" max="120" step="1"
              value={cfg.restaurant_course_pacing_minutes ?? '0'}
              onChange={e => set('restaurant_course_pacing_minutes', String(Math.max(0, Math.min(120, parseInt(e.target.value, 10) || 0))))}
              className="w-24 text-center" />
          </SettingRow>
        </SettingSection>

        <SettingSection title={L('KDS — Umbrales de tiempo', 'KDS — Time thresholds')}>
          <SettingRow settingKey="kds_warn_seconds"
            label={L('Aviso KDS (amarillo)', 'KDS warn (amber)')}
            hint={L('Segundos antes de marcar la orden en amarillo.', 'Seconds before flagging order amber.')}>
            <Input type="number" min="30" max="3600" step="30"
              value={cfg.kds_warn_seconds ?? '300'}
              onChange={e => set('kds_warn_seconds', e.target.value)}
              className="w-24 text-center" />
          </SettingRow>
          <SettingRow settingKey="kds_stale_seconds"
            label={L('Alerta KDS (rojo)', 'KDS stale (red)')}
            hint={L('Segundos antes de marcar la orden en rojo + parpadeo.', 'Seconds before pulsing red.')}>
            <Input type="number" min="60" max="7200" step="30"
              value={cfg.kds_stale_seconds ?? '600'}
              onChange={e => set('kds_stale_seconds', e.target.value)}
              className="w-24 text-center" />
          </SettingRow>
        </SettingSection>

        <div className="flex justify-end mt-4">
          <SaveBtn saving={saving} saved={saved} label={L('Guardar', 'Save')} onClick={handleSave} />
        </div>
      </div>
    </div>
  )
}
