import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import {
  validateLicense,
  getStoredLicenseKey,
  getStoredRnc,
  setStoredLicenseKey,
  clearStoredLicenseKey,
} from '../services/license'

const LicenseContext = createContext(null)

export function useLicense() {
  const ctx = useContext(LicenseContext)
  if (!ctx) throw new Error('useLicense must be used inside LicenseProvider')
  return ctx
}

const CHECK_INTERVAL = 4 * 60 * 60 * 1000  // 4 hours

export function LicenseProvider({ children }) {
  const [hwid,       setHwid]       = useState(null)
  const [licenseKey, setLicenseKey] = useState(getStoredLicenseKey())
  const [rnc,        setRnc]        = useState(getStoredRnc())
  const [result,     setResult]     = useState(null)
  const [checking,   setChecking]   = useState(true)
  const intervalRef = useRef(null)

  // ── Load hardware ID from Electron ─────────────────────────────────────────
  useEffect(() => {
    async function loadHwid() {
      if (typeof window !== 'undefined' && window.electronAPI?.license?.hwid) {
        try {
          const id = await window.electronAPI.license.hwid()
          setHwid(id || 'browser-dev')
        } catch {
          setHwid('browser-dev')
        }
      } else {
        const stored = localStorage.getItem('tx_dev_hwid') || (() => {
          const id = 'dev-' + Math.random().toString(36).slice(2)
          localStorage.setItem('tx_dev_hwid', id)
          return id
        })()
        setHwid(stored)
      }
    }
    loadHwid()
  }, [])

  // ── Validation ─────────────────────────────────────────────────────────────
  const runCheck = useCallback(async (key, id, rncOverride) => {
    // ── Dev bypass: skip license check in development ──────────────────────
    if (import.meta.env.DEV) {
      setResult({ valid: true, status: 'active', readOnly: false, warning: false })
      setChecking(false)
      return
    }

    const k = key         ?? licenseKey
    const h = id          ?? hwid
    const r = rncOverride ?? rnc

    if (!k) {
      setResult({ valid: false, status: 'no_key', readOnly: true })
      setChecking(false)
      return
    }
    if (!h) return  // wait for hwid

    setChecking(true)
    try {
      const res = await validateLicense(k, h, r)
      setResult(res)
    } catch (err) {
      console.error('[LicenseContext]', err)
      setResult({ valid: true, status: 'offline_grace', readOnly: false, warning: true,
                  warningMsg: 'Error al verificar licencia.' })
    } finally {
      setChecking(false)
    }
  }, [licenseKey, hwid, rnc])

  // Run check when hwid is ready
  useEffect(() => {
    if (hwid) runCheck()
  }, [hwid])   // eslint-disable-line

  // Periodic re-check every 4 hours
  useEffect(() => {
    if (!hwid || !licenseKey) return
    intervalRef.current = setInterval(() => runCheck(), CHECK_INTERVAL)
    return () => clearInterval(intervalRef.current)
  }, [hwid, licenseKey, runCheck])

  // ── Activate a new license key + RNC ───────────────────────────────────────
  async function activate(key, rncValue) {
    const k = key.toUpperCase().trim()
    const r = (rncValue || '').replace(/\D/g, '')
    setLicenseKey(k)
    setRnc(r)
    await runCheck(k, hwid, r)
    // Persist after successful check
    const fresh = await validateLicense(k, hwid, r)
    if (fresh.valid) {
      setStoredLicenseKey(k, r)
      setResult(fresh)
    } else {
      setResult(fresh)
      throw new Error(statusMessage(fresh.status))
    }
  }

  function deactivate() {
    clearStoredLicenseKey()
    setLicenseKey('')
    setRnc('')
    setResult({ valid: false, status: 'no_key', readOnly: true })
  }

  const isReadOnly = result ? (result.readOnly || !result.valid) : true
  const isExpired  = result?.status === 'expired'
  const isNoKey    = !licenseKey || result?.status === 'no_key'
  const hasWarning = result?.warning ?? false
  const warningMsg = result?.warningMsg ?? null

  return (
    <LicenseContext.Provider value={{
      hwid,
      licenseKey,
      rnc,
      result,
      checking,
      isReadOnly,
      isExpired,
      isNoKey,
      hasWarning,
      warningMsg,
      activate,
      deactivate,
      refresh: () => runCheck(),
    }}>
      {children}
    </LicenseContext.Provider>
  )
}

function statusMessage(status) {
  return {
    not_found:        'Clave de licencia no encontrada.',
    hardware_mismatch:'Esta licencia está registrada en otro equipo.',
    rnc_mismatch:     'El RNC no coincide con el de la licencia.',
    invalid_format:   'Formato de clave inválido.',
    inactive:         'Esta licencia ha sido desactivada.',
    suspended:        'Esta licencia está suspendida.',
    expired:          'Esta licencia ha vencido.',
  }[status] || 'Error al verificar la licencia.'
}
