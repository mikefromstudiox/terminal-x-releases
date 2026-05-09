// ConfigEvent — dedicated /config/event page (food_truck Modo Evento).
import { Sparkles } from 'lucide-react'
import { useSettings, SettingSection, SettingRow, SaveBtn, Toast, Toggle, Input } from '../Sistema'
import { useLang } from '../../i18n'

export default function ConfigEvent() {
  const { cfg, set, on, handleSave, saving, saved, toast } = useSettings()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <Sparkles size={22} className="text-[#b3001e]" />
            {L('Modo Evento', 'Event Mode')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Multiplica precios temporalmente para eventos privados (bodas, fiestas, conciertos).',
               'Temporarily multiply prices for private events (weddings, parties, concerts).')}
          </p>
        </div>
        <Toast toast={toast} />
        <SettingSection title={L('Configuración', 'Configuration')}>
          <SettingRow settingKey="food_truck_event_active"
            label={L('Activo', 'Active')}
            hint={L('Aplica el multiplicador a todas las ventas hasta que lo apagues.', 'Applies the multiplier to all sales until you turn it off.')}>
            <Toggle enabled={on('food_truck_event_active')} onChange={v => set('food_truck_event_active', v ? '1' : '0')} />
          </SettingRow>
          <SettingRow settingKey="food_truck_event_label"
            label={L('Etiqueta', 'Label')}
            hint={L('Aparece en el recibo del evento.', 'Shows on the event receipt.')}>
            <Input type="text" value={cfg.food_truck_event_label ?? ''}
              onChange={e => set('food_truck_event_label', e.target.value)}
              placeholder="Boda Plaza Naco"
              className="w-48 text-left" />
          </SettingRow>
          <SettingRow settingKey="food_truck_event_multiplier"
            label={L('Multiplicador', 'Multiplier')}
            hint={L('1.0 = sin cambio · 1.25 = +25% · 2.0 = doble.', '1.0 = no change · 1.25 = +25% · 2.0 = double.')}>
            <Input type="number" min="0.5" max="5" step="0.05"
              value={cfg.food_truck_event_multiplier ?? '1'}
              onChange={e => set('food_truck_event_multiplier', e.target.value)}
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
