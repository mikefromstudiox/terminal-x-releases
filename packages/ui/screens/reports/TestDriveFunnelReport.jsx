// Stub — feature in flight, route already wired in App.jsx. Real screen
// lands in a separate concesionario sprint; this placeholder keeps the build
// green so the Facturación tier work can ship.
import { useLang } from '../../i18n'

export default function TestDriveFunnelReport() {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  return (
    <div className="h-full flex items-center justify-center bg-slate-50 dark:bg-black px-6">
      <div className="max-w-sm text-center">
        <h2 className="text-xl font-bold text-slate-800 dark:text-white">{L('Reporte: Embudo de Pruebas de Manejo', 'Report: Test Drive Funnel')}</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
          {L('Próximamente.', 'Coming soon.')}
        </p>
      </div>
    </div>
  )
}
