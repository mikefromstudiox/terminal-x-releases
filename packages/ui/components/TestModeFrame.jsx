import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'

export default function TestModeFrame({ goLiveDate }) {
  const future = goLiveDate && new Date(`${goLiveDate}T00:00:00`).getTime() > Date.now()
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[9998] border-[6px] border-[#b3001e]"
      />
      <div
        className="pointer-events-auto fixed bottom-16 md:bottom-0 left-0 right-0 z-[9999] flex flex-wrap items-center justify-center gap-2 px-4 py-2 bg-[#b3001e] text-white text-[12px] font-semibold shadow-[0_-2px_8px_rgba(0,0,0,.25)]"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0) + 8px)' }}
      >
        <AlertTriangle size={14} className="shrink-0" />
        <span>
          MODO PRUEBA · Las ventas no se guardan en la nube ni se reportan al DGII
          {future ? ` · activa el ${goLiveDate}` : ''}
        </span>
        <Link
          to="/sistema"
          className="ml-2 px-3 py-1 rounded-full bg-white text-[#b3001e] hover:bg-white/90 text-[11px] font-bold"
        >
          Configurar fecha de puesta en producción →
        </Link>
      </div>
    </>
  )
}
