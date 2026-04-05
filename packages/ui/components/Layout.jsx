import { LayoutProvider } from '../context/LayoutContext'
import { BackupProvider } from '../context/BackupContext'
import { useLicense } from '../context/LicenseContext'
import Sidebar from './Sidebar'
import { AlertTriangle, ShieldX, KeyRound } from 'lucide-react'

// Change to your WhatsApp number (must match LicenseGate.jsx)
const WA_NUMBER = '18098282971'
const WA_MSG    = encodeURIComponent('Hola, necesito renovar mi licencia de Terminal X.')
const WA_URL    = `https://wa.me/${WA_NUMBER}?text=${WA_MSG}`

// ── Read-only / expiry banner ─────────────────────────────────────────────────

function LicenseBanner() {
  const { isReadOnly, hasWarning, warningMsg, result, isMasterKey } = useLicense()

  // ── Master key mode: amber "Setup Mode" badge ──────────────────────────────
  if (isMasterKey) {
    return (
      <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-amber-400 text-amber-900 text-[12px] font-semibold">
        <KeyRound size={13} className="shrink-0" />
        <span className="flex-1">
          Modo Configuración — Licencia provisional activa. Aplica una licencia real desde Administración → Sistema.
        </span>
      </div>
    )
  }

  if (!hasWarning && !isReadOnly) return null

  const isExpired = result?.status === 'expired'
  const isGrace   = result?.status === 'grace'

  const WaBtn = ({ light }) => (
    <a href={WA_URL} target="_blank" rel="noopener noreferrer"
      className={`ml-auto shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold transition-colors ${
        light ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-amber-900/20 hover:bg-amber-900/30 text-amber-900'
      }`}>
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.054.519 4 1.426 5.703L0 24l6.439-1.399A11.938 11.938 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-4.964-1.347l-.356-.211-3.698.803.827-3.607-.232-.371A9.818 9.818 0 1112 21.818z"/>
      </svg>
      WhatsApp
    </a>
  )

  if (isExpired || isGrace) {
    return (
      <div className={`shrink-0 flex items-center gap-2 px-4 py-1.5 text-[12px] font-medium ${isExpired ? 'bg-red-600 text-white' : 'bg-orange-500 text-white'}`}>
        <ShieldX size={14} className="shrink-0" />
        <span className="flex-1">
          {isExpired
            ? `Licencia vencida hace ${result?.daysExpired ?? 0} días — solo lectura activa.`
            : warningMsg}
        </span>
        <WaBtn light />
      </div>
    )
  }

  if (hasWarning && warningMsg) {
    return (
      <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-amber-400 text-amber-900 text-[12px] font-medium">
        <AlertTriangle size={14} className="shrink-0" />
        <span className="flex-1">{warningMsg}</span>
        <WaBtn light={false} />
      </div>
    )
  }

  return null
}

// ── Main Layout ───────────────────────────────────────────────────────────────

function AppLayout({ children }) {
  return (
    <div className="flex h-screen bg-[#f0f2f5] dark:bg-zinc-950 overflow-hidden flex-col">
      <LicenseBanner />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden dark:bg-zinc-900 pb-20 md:pb-0">
          {children}
        </main>
      </div>
    </div>
  )
}

export default function Layout({ children }) {
  return (
    <BackupProvider>
      <LayoutProvider>
        <AppLayout>{children}</AppLayout>
      </LayoutProvider>
    </BackupProvider>
  )
}
