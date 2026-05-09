// ConfigPrinter — dedicated /config/printer page. Just printer + drawer
// settings, nothing else from Preferencias.
import { Printer } from 'lucide-react'
import ImpresionSettings from '../Sistema'
import { useLang } from '../../i18n'

// Sistema.jsx already exports an `ImpresionSettings` component focused on
// the printer surface. We just wrap it in our own shell with a clean
// header so the user sees ONLY printer settings.
import { ImpresionSettings as PrinterPanel } from '../Sistema'

export default function ConfigPrinter() {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <Printer size={22} className="text-[#b3001e]" />
            {L('Impresora y caja', 'Printer & drawer')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Impresora térmica 80mm, cajón de dinero, variantes drawer-kick.',
               'Thermal 80mm printer, cash drawer, drawer-kick variants.')}
          </p>
        </div>
        <PrinterPanel />
      </div>
    </div>
  )
}
