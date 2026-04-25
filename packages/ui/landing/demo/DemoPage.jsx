import { useState, useEffect } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { VERTICAL_TO_TEMPLATE, t } from './demoMockData'
import { DemoBanner, DemoToast } from './DemoChrome'
import TiendaDemo from './templates/TiendaDemo'
import CarwashDemo from './templates/CarwashDemo'
import RestauranteDemo from './templates/RestauranteDemo'
import ConcesionarioDemo from './templates/ConcesionarioDemo'
import FacturacionDemo from './templates/FacturacionDemo'
import PayrollDemo from './templates/PayrollDemo'

const TEMPLATE_MAP = {
  tienda: TiendaDemo,
  carwash: CarwashDemo,
  restaurante: RestauranteDemo,
  concesionario: ConcesionarioDemo,
  facturacion: FacturacionDemo,
  nomina: PayrollDemo,
}

function resolveLang() {
  try {
    const url = new URL(window.location.href)
    const q = url.searchParams.get('lang')
    if (q === 'en' || q === 'es') return q
    const stored = localStorage.getItem('tx_landing_lang')
    if (stored === 'en' || stored === 'es') return stored
  } catch {}
  try {
    return typeof navigator !== 'undefined' && navigator.language?.startsWith('en') ? 'en' : 'es'
  } catch { return 'es' }
}

export default function DemoPage(props) {
  const { vertical } = useParams()
  const [lang] = useState(props.lang || resolveLang())
  const [toastMessage, setToastMessage] = useState(null)
  const [toastCta, setToastCta] = useState(null)

  const templateKey = VERTICAL_TO_TEMPLATE[vertical]

  useEffect(() => {
    document.title = `Demo · ${vertical || 'Terminal X'} | Terminal X`
  }, [vertical])

  if (!templateKey) {
    return <Navigate to="/" replace />
  }

  const Template = TEMPLATE_MAP[templateKey]

  function handleCobrar() {
    setToastMessage(
      t(lang,
        'Demo: el cobro no se guardó. ¿Listo para facturar de verdad?',
        'Demo: that sale was not saved. Ready to bill for real?'
      )
    )
    setToastCta({
      label: t(lang, 'Empieza tu prueba gratis', 'Start your free trial'),
      href: `/signup?plan=facturacion&utm_source=demo_cobrar&utm_medium=demo_${vertical}`,
    })
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black">
      <DemoBanner lang={lang} vertical={vertical} />
      <Template vertical={vertical} lang={lang} onCobrar={handleCobrar} />
      <DemoToast
        message={toastMessage}
        ctaLabel={toastCta?.label}
        ctaHref={toastCta?.href}
        onClose={() => { setToastMessage(null); setToastCta(null) }}
      />
    </div>
  )
}
