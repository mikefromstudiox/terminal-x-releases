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

// ── Per-client error reporter — POSTs to admin panel so errors land in
// `client_errors` and surface in /admin Errores tab. Mirror of web/main.jsx so
// desktop crashes (TDZ etc) are visible without screenshots. Fire-and-forget.
const REPORT_ENDPOINT = 'https://www.terminalxpos.com/api/panel?action=report_error'
const _errReportRecent = new Set()
function reportClientError(err, severity = 'error') {
  try {
    const message = String((err && err.message) || err || 'unknown error')
    const sig = message.slice(0, 200)
    if (_errReportRecent.has(sig)) return
    _errReportRecent.add(sig)
    setTimeout(() => _errReportRecent.delete(sig), 60000)
    const get = (k) => { try { return localStorage.getItem(k) || null } catch { return null } }
    const businessId = get('tx_business_id')
    const userId = get('tx_user_id')
    const userRole = get('tx_user_role')
    const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null
    fetch(REPORT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        business_id: businessId,
        user_id: userId,
        user_role: userRole,
        message,
        stack: (err && err.stack) || null,
        route: typeof window !== 'undefined' ? (window.location.hash || window.location.pathname) : null,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        app_version: appVersion,
        severity,
        metadata: { platform: 'desktop' },
      }),
    }).catch(() => {})
  } catch {}
}
if (typeof window !== 'undefined') window.__txReportError = reportClientError

// ── Global error handlers — catch unhandled errors outside React tree ────────
window.addEventListener('error', (e) => {
  console.error('[renderer] Uncaught error:', e.error || e.message)
  try { captureSentryException(e.error || new Error(String(e.message || 'renderer error'))) } catch {}
  try { reportClientError(e.error || e.message) } catch {}
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[renderer] Unhandled promise rejection:', e.reason)
  try { captureSentryException(e.reason instanceof Error ? e.reason : new Error(String(e.reason))) } catch {}
  try { reportClientError(e.reason) } catch {}
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
