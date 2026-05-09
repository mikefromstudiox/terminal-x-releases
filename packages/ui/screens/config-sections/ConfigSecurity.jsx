// ConfigSecurity — dedicated /config/security page. Manager Authorization
// Card config + a quick deep-link to Usuarios for PIN management.
import { Shield, ArrowUpRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useSettings, SettingSection, SettingRow, SaveBtn, Toast, Toggle, Input } from '../Sistema'
import { useLang } from '../../i18n'

export default function ConfigSecurity() {
  const { cfg, set, on, handleSave, saving, saved, toast } = useSettings()
  const { lang } = useLang()
  const navigate = useNavigate()
  const L = (es, en) => lang === 'es' ? es : en
  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <Shield size={22} className="text-[#b3001e]" />
            {L('Seguridad', 'Security')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Autorización de gerente, PINs y sesiones activas.',
               'Manager authorization, PINs and active sessions.')}
          </p>
        </div>
        <Toast toast={toast} />
        <SettingSection title={L('Autorización de Gerente', 'Manager Authorization')}>
          <SettingRow settingKey="manager_auth_card_required"
            label={L('Tarjeta de gerente requerida', 'Manager card required')}
            hint={L('Acciones sensibles (descuento, void, override) piden tarjeta o PIN.', 'Sensitive actions (discount, void, override) require manager card or PIN.')}>
            <Toggle enabled={on('manager_auth_card_required')} onChange={v => set('manager_auth_card_required', v ? '1' : '0')} />
          </SettingRow>
          <SettingRow settingKey="manager_pin_fallback"
            label={L('PIN como respaldo', 'PIN fallback')}
            hint={L('Si la tarjeta no está disponible, acepta PIN del gerente.', 'If the card is unavailable, accept manager PIN instead.')}>
            <Toggle enabled={on('manager_pin_fallback')} onChange={v => set('manager_pin_fallback', v ? '1' : '0')} />
          </SettingRow>
          <SettingRow settingKey="big_discount_threshold"
            label={L('Umbral descuento grande %', 'Big-discount threshold %')}
            hint={L('Descuentos sobre este % piden gerente.', 'Discounts above this % require manager.')}>
            <Input type="number" min="0" max="100" step="1"
              value={cfg.big_discount_threshold ?? '15'}
              onChange={e => set('big_discount_threshold', e.target.value)}
              className="w-20 text-center" />
          </SettingRow>
        </SettingSection>

        <button
          type="button" onClick={() => navigate('/config/usuarios')}
          className="mt-4 w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-4 text-left hover:border-[#b3001e] transition-colors group"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-bold text-slate-900 dark:text-white">{L('Administrar usuarios y PINs', 'Manage users and PINs')}</p>
              <p className="text-[11px] text-slate-500 dark:text-white/50 mt-0.5">
                {L('Crea/edita cuentas · resetea PINs · roles.', 'Create/edit accounts · reset PINs · roles.')}
              </p>
            </div>
            <ArrowUpRight size={16} className="text-slate-400 group-hover:text-[#b3001e]" />
          </div>
        </button>

        <div className="flex justify-end mt-4">
          <SaveBtn saving={saving} saved={saved} label={L('Guardar', 'Save')} onClick={handleSave} />
        </div>
      </div>
    </div>
  )
}
