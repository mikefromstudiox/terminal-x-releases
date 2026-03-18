import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { LangProvider } from './i18n'
import { AuthProvider } from './context/AuthContext'
import { LicenseProvider } from './context/LicenseContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <LangProvider>
        <AuthProvider>
          <LicenseProvider>
            <App />
          </LicenseProvider>
        </AuthProvider>
      </LangProvider>
    </HashRouter>
  </React.StrictMode>
)
