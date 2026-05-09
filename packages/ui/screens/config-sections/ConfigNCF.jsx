// ConfigNCF — dedicated /config/ncf page. The fiscal control center:
//   1. Certificado digital (web: Viafirma upload + env switch · desktop: .p12 install)
//   2. Modo fiscal (B-series legacy vs e-CF electrónico)
//   3. Secuencias B01/B02/E31/E32/E33/E34/E43/E44/E47 with per-line toggle + range inputs
//
// DGII tab (/pos/dgii) keeps only 606 / 607 / Anular e-NCF.
import { Receipt } from 'lucide-react'
import { FiscalNCF } from '../Admin'
import { ScreenCert } from '../DGII'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../i18n'

export default function ConfigNCF() {
  const { lang } = useLang()
  const { user } = useAuth()
  const L = (es, en) => lang === 'es' ? es : en

  const isWeb   = typeof window !== 'undefined' && !window.electronAPI
  const isOwner = String(user?.role || '').toLowerCase() === 'owner'
  const showWebCert = isWeb && isOwner

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <Receipt size={22} className="text-[#b3001e]" />
            {L('NCF / e-CF', 'NCF / e-CF')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Certificado digital, modo fiscal (B-series vs e-CF) y secuencias autorizadas por la DGII.',
               'Digital certificate, fiscal mode (B-series vs e-CF) and DGII-authorized sequences.')}
          </p>
        </div>

        {showWebCert && (
          <div className="mb-6 bg-white dark:bg-white/[0.03] rounded-2xl border border-slate-200 dark:border-white/10 p-4 md:p-5">
            <ScreenCert />
          </div>
        )}

        <FiscalNCF />
      </div>
    </div>
  )
}
