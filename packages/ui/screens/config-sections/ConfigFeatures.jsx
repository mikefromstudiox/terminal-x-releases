// ConfigFeatures — dedicated /config/funciones page. Per-business
// owner-controlled feature toggles (commissions / discounts / per-line
// ITBIS / age-verification). Was buried under Mi Empresa → Configuracion
// Avanzada; promoted to its own page so it stops competing with business
// identity fields.
import { ToggleLeft } from 'lucide-react'
import { BusinessFeatureToggles } from '../Admin'
import { useLang } from '../../i18n'

export default function ConfigFeatures() {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
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
      </div>
    </div>
  )
}
