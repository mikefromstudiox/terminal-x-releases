// ConfigCommissions — dedicated /config/commissions page.
import { PiggyBank } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useSettings, SettingSection, SettingRow, SaveBtn, Toast, Toggle } from '../Sistema'
import { useLang } from '../../i18n'
import { useBusinessType } from '../../hooks/useBusinessType.jsx'

export default function ConfigCommissions() {
  const { cfg, set, on, handleSave, saving, saved, toast } = useSettings()
  const { lang } = useLang()
  const { businessType } = useBusinessType()
  const navigate = useNavigate()
  const L = (es, en) => lang === 'es' ? es : en
  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <PiggyBank size={22} className="text-[#b3001e]" />
            {L('Comisiones', 'Commissions')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Reglas globales. Configura por empleado o por servicio en sus pantallas.',
               'Global rules. Configure per-employee or per-service in their dedicated screens.')}
          </p>
        </div>
        <Toast toast={toast} />
        <SettingSection title={L('Reglas globales', 'Global rules')}>
          <SettingRow settingKey="comm_round_to_peso"
            label={L('Redondear a peso entero', 'Round to whole peso')}
            hint={L('Aplica al cálculo final por liquidación', 'Applies to final per-period payout')}>
            <Toggle enabled={on('comm_round_to_peso')} onChange={v => set('comm_round_to_peso', v ? '1' : '0')} />
          </SettingRow>
          <SettingRow settingKey="comm_business_type"
            label={L('Tipo de negocio activo', 'Active business type')}
            hint={L('Determina qué empleados/servicios califican.', 'Determines which employees/services qualify.')}>
            <span className="text-[12px] text-slate-500 dark:text-white/50">{businessType}</span>
          </SettingRow>
        </SettingSection>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button" onClick={() => navigate('/empleados')}
            className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-4 text-left hover:border-[#b3001e] transition-colors"
          >
            <p className="text-[13px] font-bold text-slate-900 dark:text-white">{L('Empleados', 'Employees')}</p>
            <p className="text-[11px] text-slate-500 dark:text-white/50 mt-0.5">
              {L('% de comisión por empleado · liquidación.',
                 'Per-employee commission % · payouts.')}
            </p>
          </button>
          <button
            type="button" onClick={() => navigate('/config/servicios')}
            className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-4 text-left hover:border-[#b3001e] transition-colors"
          >
            <p className="text-[13px] font-bold text-slate-900 dark:text-white">{L('Servicios', 'Services')}</p>
            <p className="text-[11px] text-slate-500 dark:text-white/50 mt-0.5">
              {L('Marca servicios sin comisión · split lavador/cajero/vendedor.',
                 'Flag commission-exempt services · per-service split.')}
            </p>
          </button>
        </div>
        <div className="flex justify-end mt-4">
          <SaveBtn saving={saving} saved={saved} label={L('Guardar', 'Save')} onClick={handleSave} />
        </div>
      </div>
    </div>
  )
}
