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
import { createElectronAPI, createElectronPrinterAPI, isElectron } from '@terminal-x/data/electron'
import { createWebAPI, createWebPrinterAPI } from '@terminal-x/data/web'
import './index.css'

// ── Global error handlers — catch unhandled errors outside React tree ────────
window.addEventListener('error', (e) => {
  console.error('[renderer] Uncaught error:', e.error || e.message)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[renderer] Unhandled promise rejection:', e.reason)
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
                  <App />
                </BusinessTypeProvider>
              </PlanProvider>
            </LicenseProvider>
          </AuthProvider>
        </LangProvider>
      </HashRouter>
    </DataProvider>
  </React.StrictMode>
)
