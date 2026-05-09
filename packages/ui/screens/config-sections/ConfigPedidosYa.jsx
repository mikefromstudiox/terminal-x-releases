// ConfigPedidosYa — dedicated /config/pedidosya page.
import { Truck } from 'lucide-react'
import { useSettings, SettingSection, SettingRow, SaveBtn, Toast, Toggle, Input } from '../Sistema'
import { useLang } from '../../i18n'

export default function ConfigPedidosYa() {
  const { cfg, set, on, handleSave, saving, saved, toast } = useSettings()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <Truck size={22} className="text-[#b3001e]" />
            Pedidos Ya
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Canal de delivery con precios y comisión separados.',
               'Delivery channel with separate prices and commission.')}
          </p>
        </div>
        <Toast toast={toast} />
        <SettingSection title={L('Canal Pedidos Ya', 'Pedidos Ya channel')}>
          <SettingRow settingKey="pedidos_ya_enabled"
            label={L('Canal activo', 'Channel enabled')}
            hint={L('Activa precios y comisión PY al cobrar.', 'Enables PY pricing + commission at cobro.')}>
            <Toggle enabled={on('pedidos_ya_enabled')} onChange={v => set('pedidos_ya_enabled', v ? '1' : '0')} />
          </SettingRow>
          <SettingRow settingKey="pedidos_ya_commission_pct"
            label={L('Comisión PY %', 'PY commission %')}
            hint={L('Se descuenta del total al cobrar (default 15%).', 'Stripped off the total at cobro (default 15%).')}>
            <Input type="number" min="0" max="100" step="0.1"
              value={cfg.pedidos_ya_commission_pct ?? '15'}
              onChange={e => set('pedidos_ya_commission_pct', e.target.value)}
              className="w-20 text-center" />
          </SettingRow>
        </SettingSection>
        <div className="flex justify-end mt-4">
          <SaveBtn saving={saving} saved={saved} label={L('Guardar', 'Save')} onClick={handleSave} />
        </div>
      </div>
    </div>
  )
}
