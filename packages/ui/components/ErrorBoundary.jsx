import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

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
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="h-full flex items-center justify-center bg-white p-8">
        <div className="max-w-sm text-center space-y-4">
          <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center mx-auto">
            <AlertTriangle size={22} className="text-red-500" />
          </div>
          <div>
            <p className="text-slate-800 font-semibold text-[15px]">Error al cargar esta pantalla</p>
            <p className="text-slate-400 text-[12px] mt-1 font-mono break-all">
              {this.state.error?.message || 'Error desconocido'}
            </p>
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            className="flex items-center gap-2 mx-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-[13px] font-semibold text-slate-600 transition-colors"
          >
            <RefreshCw size={13} />
            Reintentar
          </button>
        </div>
      </div>
    )
  }
}
