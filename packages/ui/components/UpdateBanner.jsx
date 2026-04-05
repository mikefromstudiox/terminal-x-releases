import { useState, useEffect } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import { useAPI } from '../context/DataContext'

export default function UpdateBanner() {
  const api = useAPI()
  const [state, setState] = useState(null)  // null | { type, data }

  useEffect(() => {
    if (!api?.updater?.onStatus) return

    const off = api.updater.onStatus((event, data) => {
      if (event === 'available')   setState({ type: 'available',   data })
      if (event === 'progress')    setState({ type: 'progress',    data })
      if (event === 'downloaded')  setState({ type: 'downloaded',  data })
      if (event === 'error')       setState(null)
      if (event === 'up-to-date')  setState(null)
    })

    return off
  }, [])

  if (!state) return null

  async function install() {
    await api.updater.install()
  }

  if (state.type === 'downloaded') {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 bg-slate-800 text-white px-4 py-3 rounded-2xl shadow-2xl max-w-sm">
        <RefreshCw size={16} className="shrink-0 text-sky-400" />
        <div className="flex-1">
          <p className="text-[13px] font-bold">Actualización lista</p>
          <p className="text-[11px] text-slate-300">v{state.data?.version} — instala al reiniciar</p>
        </div>
        <button onClick={install}
          className="shrink-0 px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-white text-[12px] font-bold rounded-lg transition-colors">
          Instalar
        </button>
        <button onClick={() => setState(null)}
          className="shrink-0 p-1 text-slate-400 hover:text-white transition-colors">
          <X size={14} />
        </button>
      </div>
    )
  }

  if (state.type === 'available') {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 bg-slate-800 text-white px-4 py-3 rounded-2xl shadow-2xl max-w-sm">
        <Download size={16} className="shrink-0 text-sky-400 animate-bounce" />
        <div className="flex-1">
          <p className="text-[13px] font-bold">Descargando actualización</p>
          <p className="text-[11px] text-slate-300">v{state.data?.version} — descargando en segundo plano</p>
        </div>
        <button onClick={() => setState(null)}
          className="shrink-0 p-1 text-slate-400 hover:text-white transition-colors">
          <X size={14} />
        </button>
      </div>
    )
  }

  if (state.type === 'progress') {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 bg-slate-800 text-white px-4 py-3 rounded-2xl shadow-2xl max-w-xs">
        <Download size={15} className="shrink-0 text-sky-400" />
        <div className="flex-1">
          <p className="text-[12px] font-semibold mb-1">Descargando actualización…</p>
          <div className="w-full bg-slate-600 rounded-full h-1.5">
            <div className="bg-sky-400 h-1.5 rounded-full transition-all"
              style={{ width: `${state.data}%` }} />
          </div>
        </div>
        <span className="text-[11px] text-slate-400 shrink-0">{state.data}%</span>
      </div>
    )
  }

  return null
}
