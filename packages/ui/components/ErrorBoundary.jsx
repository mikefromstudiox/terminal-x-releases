import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

const CHUNK_PATTERNS = [
  /Loading chunk/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /result\.default/i,
  /Importing a module script failed/i,
  /ChunkLoadError/i,
]

const RELOAD_FLAG = '__tx_chunk_reload__'

function isChunkError(err) {
  const msg = err?.message || String(err || '')
  return CHUNK_PATTERNS.some(p => p.test(msg))
}

async function nukeCachesAndReload() {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return
    sessionStorage.setItem(RELOAD_FLAG, '1')
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
    }
    if (typeof caches !== 'undefined' && caches.keys) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
  } catch (e) {
    console.error('[ErrorBoundary] cache nuke failed', e)
  }
  const u = new URL(window.location.href)
  u.searchParams.set('_r', Date.now().toString(36))
  window.location.replace(u.toString())
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', e => {
    if (isChunkError(e.error || e.message)) nukeCachesAndReload()
  })
  window.addEventListener('unhandledrejection', e => {
    if (isChunkError(e.reason)) nukeCachesAndReload()
  })
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack)
    if (isChunkError(error)) nukeCachesAndReload()
  }

  render() {
    if (!this.state.error) return this.props.children
    const chunk = isChunkError(this.state.error)

    return (
      <div className="h-full flex items-center justify-center bg-white p-8">
        <div className="max-w-sm text-center space-y-4">
          <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center mx-auto">
            <AlertTriangle size={22} className="text-red-500" />
          </div>
          <div>
            <p className="text-slate-800 font-semibold text-[15px]">
              {chunk ? 'Actualizando a la nueva versión…' : 'Error al cargar esta pantalla'}
            </p>
            <p className="text-slate-400 text-[12px] mt-1 font-mono break-all">
              {this.state.error?.message || 'Error desconocido'}
            </p>
          </div>
          <button
            onClick={() => { sessionStorage.removeItem(RELOAD_FLAG); nukeCachesAndReload() }}
            className="flex items-center gap-2 mx-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-[13px] font-semibold text-slate-600 transition-colors"
          >
            <RefreshCw size={13} />
            Recargar
          </button>
        </div>
      </div>
    )
  }
}
