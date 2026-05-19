// ConfigBasculas — dedicated /config/basculas page.
//
// Scale registry for carnicería vertical. Wraps CarniceriaScalesSection
// (currently lives in Sistema.jsx — exported as a named export so this
// thin card can mount it). Promoted to its own card on 2026-05-19.
import { Scale } from 'lucide-react'
import { CarniceriaScalesSection, useSettings, Toast } from '../Sistema'
import { useLang } from '../../i18n'
import { useAPI } from '../../context/DataContext'

export default function ConfigBasculas() {
  const { toast, show } = useSettings()
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <Scale size={22} className="text-[#b3001e]" />
            {L('Básculas', 'Scales')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Configura tus básculas para venta por peso.',
               'Configure your scales for sales by weight.')}
          </p>
        </div>
        <Toast toast={toast} />
        <CarniceriaScalesSection L={L} api={api} show={show} />
      </div>
    </div>
  )
}
