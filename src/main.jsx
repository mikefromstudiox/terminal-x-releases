import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { LangProvider } from './i18n'
import { AuthProvider } from './context/AuthContext'
import { LicenseProvider } from './context/LicenseContext'
import { DataProvider } from './context/DataContext'
import { PlanProvider } from './hooks/usePlan.jsx'
import { createElectronAPI, createElectronPrinterAPI, isElectron } from './data/electron'
import { createWebAPI, createWebPrinterAPI } from './data/web'
import './index.css'

// Platform detection: Electron (preload.js present) vs Web browser
const api       = isElectron() ? createElectronAPI()        : createWebAPI()
const printerApi = isElectron() ? createElectronPrinterAPI() : createWebPrinterAPI()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DataProvider api={api} printerApi={printerApi}>
      <PlanProvider>
        <HashRouter>
          <LangProvider>
            <AuthProvider>
              <LicenseProvider>
                <App />
              </LicenseProvider>
            </AuthProvider>
          </LangProvider>
        </HashRouter>
      </PlanProvider>
    </DataProvider>
  </React.StrictMode>
)
