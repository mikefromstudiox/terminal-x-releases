import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { LangProvider } from './i18n'
import { AuthProvider } from './context/AuthContext'
import { LicenseProvider } from './context/LicenseContext'
import { DataProvider } from './context/DataContext'
import { PlanProvider } from './hooks/usePlan.jsx'
import { BusinessTypeProvider } from './hooks/useBusinessType.jsx'
import { KioskProvider } from './context/KioskContext'
import { createElectronAPI, createElectronPrinterAPI, isElectron } from '@terminal-x/data/electron'
import { createWebAPI, createWebPrinterAPI } from '@terminal-x/data/web'
import { initSentryRenderer, captureSentryException } from '@terminal-x/services/sentry-renderer.js'
import './index.css'

// ── Sentry (no-op when VITE_SENTRY_DSN unset) ────────────────────────────────
const __release = (typeof __APP_VERSION__ !== 'undefined' ? `terminal-x@${__APP_VERSION__}` : undefined)
initSentryRenderer({ release: __release })

// ── Global error handlers — catch unhandled errors outside React tree ────────
window.addEventListener('error', (e) => {
  console.error('[renderer] Uncaught error:', e.error || e.message)
  try { captureSentryException(e.error || new Error(String(e.message || 'renderer error'))) } catch {}
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[renderer] Unhandled promise rejection:', e.reason)
  try { captureSentryException(e.reason instanceof Error ? e.reason : new Error(String(e.reason))) } catch {}
})

// Platform detection: Electron (preload.js present) vs Web browser
const api       = isElectron() ? createElectronAPI()        : createWebAPI()
const printerApi = isElectron() ? createElectronPrinterAPI() : createWebPrinterAPI()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DataProvider api={api} printerApi={printerApi}>
      <HashRouter>
        <LangProvider>
          <AuthProvider>
            <LicenseProvider>
              <PlanProvider>
                <BusinessTypeProvider>
                  <KioskProvider>
                    <App />
                  </KioskProvider>
                </BusinessTypeProvider>
              </PlanProvider>
            </LicenseProvider>
          </AuthProvider>
        </LangProvider>
      </HashRouter>
    </DataProvider>
  </React.StrictMode>
)
