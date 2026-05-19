// ConfigImpuestos — dedicated /config/impuestos page.
//
// Tax + surcharge configuration. Promoted from Sistema.jsx L772-805 as part
// of the 2026-05-19 config consolidation so taxes have a clear, single home
// instead of being buried in the legacy monolith.
import { Receipt } from 'lucide-react'
import { useSettings, SettingSection, SettingRow, SaveBtn, Toast, Toggle, Input } from '../Sistema'
import { useLang } from '../../i18n'
import { useBusinessType } from '../../hooks/useBusinessType.jsx'

export default function ConfigImpuestos() {
  const { cfg, set, on, handleSave, saving, saved, toast } = useSettings()
  const { lang } = useLang()
  const { isMechanic } = useBusinessType()
  const L = (es, en) => lang === 'es' ? es : en
  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <Receipt size={22} className="text-[#b3001e]" />
            {L('Impuestos y Cargos', 'Taxes & Charges')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('ITBIS, tasa USD, ley 10%, y otros cargos automáticos.',
               'ITBIS, USD rate, 10% service law, and other automatic charges.')}
          </p>
        </div>
        <Toast toast={toast} />

        <SettingSection title={L('Impuestos y Cargos', 'Taxes & Charges')}>
          <SettingRow settingKey="ley_enabled"
            label="Ley 10%"
            hint={L('Cargo de servicio en facturas', 'Service charge on invoices')}>
            <Toggle enabled={on('ley_enabled')} onChange={v => set('ley_enabled', v ? '1' : '0')} />
          </SettingRow>
          <SettingRow settingKey="itbis_pct"
            label="ITBIS %"
            hint={L('Porcentaje del impuesto (defecto: 18)', 'Tax rate (default: 18)')}>
            <Input type="number" min="0" max="100" value={cfg.itbis_pct} onChange={e => set('itbis_pct', e.target.value)} className="w-20 text-center" />
          </SettingRow>
          <SettingRow settingKey="usd_rate"
            label={L('Tasa USD', 'USD Rate')}
            hint="RD$ por USD">
            <Input type="number" min="0" step="0.01" value={cfg.usd_rate} onChange={e => set('usd_rate', e.target.value)} className="w-24 text-center" />
          </SettingRow>
          <SettingRow settingKey="rnc_verify"
            label={L('Verificar RNC', 'Verify RNC')}
            hint={L('Valida RNC contra DGII', 'Validates RNC against DGII')}>
            <Toggle enabled={on('rnc_verify')} onChange={v => set('rnc_verify', v ? '1' : '0')} />
          </SettingRow>
        </SettingSection>

        {isMechanic && (
          <SettingSection title={L('Mecánica — Cargos automáticos', 'Mechanic — Auto charges')}>
            <SettingRow settingKey="mechanic_tow_fee_default"
              label={L('Tarifa de remolque', 'Tow fee')}
              hint={L('Monto en RD$ que se cobra automáticamente al usar el botón Remolque en órdenes de trabajo.',
                      'Amount in RD$ auto-charged when toggling the tow button on work orders.')}>
              <Input type="number" min="0" step="1" placeholder="500"
                value={cfg.mechanic_tow_fee_default ?? '500'}
                onChange={e => set('mechanic_tow_fee_default', e.target.value)}
                className="w-28 text-center" />
            </SettingRow>
          </SettingSection>
        )}

        <div className="flex justify-end mt-4">
          <SaveBtn saving={saving} saved={saved} label={L('Guardar', 'Save')} onClick={handleSave} />
        </div>
      </div>
    </div>
  )
}
