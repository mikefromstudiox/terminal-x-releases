import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { useAPI } from './DataContext'
import {
  validateLicense,
  getStoredLicenseKey,
  getStoredRnc,
  setStoredLicenseKey,
  clearStoredLicenseKey,
} from '@terminal-x/services/license'
import { humanizeLicenseError } from '@terminal-x/services/networkError.js'

const LicenseContext = createContext(null)

export function useLicense() {
  const ctx = useContext(LicenseContext)
  if (!ctx) throw new Error('useLicense must be used inside LicenseProvider')
  return ctx
}

const CHECK_INTERVAL = 4 * 60 * 60 * 1000  // 4 hours
const OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000  // 72 hours

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Ask the main process whether this key matches the hardcoded master key. */
async function checkMasterKey(api, key) {
  try {
    return !!(await api?.license?.isMaster?.(key))
  } catch {
    return false
  }
}

/** Synthesise a result object for non-server modes. */
function makeResult(status, extra = {}) {
  return { valid: true, status, readOnly: false, warning: false, ...extra }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function LicenseProvider({ children }) {
  const api = useAPI()
  const [hwid,       setHwid]       = useState(null)
  const [licenseKey, setLicenseKey] = useState(getStoredLicenseKey())

  // v2.7 — on web, main.jsx auto-fetches the license key from Supabase and
  // writes it to localStorage AFTER LicenseContext has already mounted. Poll
  // for a few seconds so the first paint doesn't flash "Licencia inválida"
  // when the key is about to arrive.
  useEffect(() => {
    const onDesktop = typeof window !== 'undefined' && !!window.electronAPI
    if (onDesktop || licenseKey) return
    let elapsed = 0
    const intv = setInterval(() => {
      elapsed += 300
      const k = getStoredLicenseKey()
      if (k) { setLicenseKey(k); clearInterval(intv); return }
      if (elapsed >= 6000) clearInterval(intv) // give up after 6s
    }, 300)
    // Also listen to the storage event — covers cross-tab writes.
    const onStorage = (e) => {
      if (e.key === 'tx_license_key' && e.newValue) {
        setLicenseKey(e.newValue); clearInterval(intv)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => { clearInterval(intv); window.removeEventListener('storage', onStorage) }
  }, [licenseKey])
  const [rnc,        setRnc]        = useState(getStoredRnc())
  const [result,     setResult]     = useState(null)
  const [checking,   setChecking]   = useState(true)
  // F16 — expose first-pull progress so App/Login can render a friendly
  // "Sincronizando datos iniciales" spinner instead of a blank screen.
  const [firstPullDone,     setFirstPullDone]     = useState(false)
  const [firstPullProgress, setFirstPullProgress] = useState(null)  // { done, total, table }
  // v2.10.2 — surface pull failures to the UI so users get a retry banner
  // instead of silently landing on an empty login screen.
  const [pullError,         setPullError]         = useState(null)  // string | null
  const intervalRef = useRef(null)

  // Wire up the sync-pull-progress channel once. Main process emits progress
  // events from electron/sync.js::pullNow as it iterates tables.
  useEffect(() => {
    if (!window.electronAPI) return
    let off = null
    try {
      // preload exposes electronAPI, but not all builds ship a typed helper —
      // fall back to ipcRenderer via window.electron if present.
      const handler = (payload) => {
        if (payload && typeof payload === 'object') {
          setFirstPullProgress({
            done:  Number(payload.done || 0),
            total: Number(payload.total || 0),
            table: payload.table || null,
            stage: payload.stage || null,
          })
        }
      }
      // We rely on ipcRenderer being exposed indirectly via the bridge in
      // later versions. In this codebase the sync module emits via
      // `webContents.send('sync:pull-progress', ...)` which surfaces on the
      // window as a custom event relayed by the renderer's bridge. If the
      // direct listener isn't available, the spinner will still render — it
      // just won't animate the table counter.
      if (typeof window.addEventListener === 'function') {
        const evtHandler = (e) => handler(e.detail)
        window.addEventListener('tx:sync-pull-progress', evtHandler)
        off = () => window.removeEventListener('tx:sync-pull-progress', evtHandler)
      }
    } catch {}
    return () => { try { off?.() } catch {} }
  }, [])

  // ── Load hardware ID from Electron ─────────────────────────────────────────
  useEffect(() => {
    async function loadHwid() {
      if (typeof window !== 'undefined' && api?.license?.hwid) {
        try {
          const id = await api.license.hwid()
          setHwid(id || 'browser-dev')
        } catch {
          setHwid('browser-dev')
        }
      } else {
        // Web: use the sentinel 'web-client' so validate.js takes the
        // Supabase-JWT + owner/staff-linkage branch (not desktop HWID check).
        setHwid('web-client')
      }
    }
    loadHwid()
  }, [])

  // ── Core validation — check order: DEV → MASTER → REAL ────────────────────
  const runCheck = useCallback(async (key, id, rncOverride) => {
    // ── 1. DEV MODE: skip all license checks in development ────────────────
    if (import.meta.env.DEV) {
      setResult(makeResult('dev'))
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
    if (!h) return   // wait for hwid to load

    setChecking(true)
    try {
      // ── 2. MASTER KEY: bypass server, grant full access ─────────────────
      if (await checkMasterKey(api, k)) {
        setResult(makeResult('master'))
        return
      }

      // ── 3. LICENSED MODE: validate against server ───────────────────────
      // Gather local biz settings + cert status to sync to Supabase
      let bizSync = null
      try {
        const s = await api?.settings?.get?.()
        if (s && (s.biz_name || s.biz_rnc)) {
          // v2.16.10 — prefer the unambiguous `direccion` slot for the street
          // address; only fall back to `biz_address` if direccion is empty.
          // Defense-in-depth: drop the address entirely if it equals the city
          // (case-insensitive) — the dual-key flow used to let user errors
          // pollute biz_address with the city value, then re-stamp cloud on
          // every validate. Better to send no address than the city as both.
          const direccion = String(s.direccion || s.biz_address || '').trim()
          const city = String(s.ciudad || s.biz_city || '').trim()
          const addrToSync = (direccion && direccion.toLowerCase() !== city.toLowerCase()) ? direccion : null
          bizSync = { name: s.biz_name, rnc: s.biz_rnc, address: addrToSync, phone: s.biz_phone, email: s.biz_email }
        }
        const certInfo = await window.electronAPI?.dgii_ecf?.certInfo?.()
        if (certInfo && bizSync) {
          bizSync.ecf_cert_installed = certInfo.installed || false
          bizSync.ecf_cert_subject = certInfo.subject || null
          bizSync.ecf_cert_expiry = certInfo.expiry || null
          bizSync.ecf_cert_expired = certInfo.expired || false
          bizSync.ecf_environment = s?.dgii_environment || 'certecf'
          // Push PEM keys for web e-CF signing proxy
          if (certInfo.installed) {
            try {
              const pemResult = await window.electronAPI?.dgii_ecf?.certPem?.()
              if (pemResult?.ok && pemResult.data) {
                bizSync.ecf_private_key_pem = pemResult.data.privateKeyPem
                bizSync.ecf_certificate_pem = pemResult.data.certificatePem
              }
            } catch {}
          }
        }
      } catch {}
      const res = await validateLicense(k, h, r, bizSync)
      // Track last successful online validation for offline grace
      if (res.valid) {
        try { localStorage.setItem('tx_last_valid', String(Date.now())) } catch {}
      }
      // Store business_id for cloud sync + BLOCKING initial pull so Login has data
      if (res.valid && res.businessId && api?.settings?.update) {
        try { await api.settings.update({ supabase_business_id: res.businessId }) } catch {}
        // Await the pull — otherwise Login screen renders against an empty DB
        // and every PIN fails. Fall through on network error (still let user in).
        try {
          const pullFn = window.electronAPI?.sync?.pull || window.electronAPI?.sync?.now
          if (pullFn) {
            setFirstPullProgress({ stage: 'starting', done: 0, total: 1, table: null })
            setPullError(null)
            // v2.16.3 — 8s hard timeout via AbortController. Previously this
            // await could hang indefinitely on a flaky link, blocking the
            // login screen forever. On timeout we drop into the catch below
            // and let the user proceed with cached license (offline grace).
            const ac = new AbortController()
            const timeoutId = setTimeout(() => ac.abort(), 8000)
            try {
              await Promise.race([
                pullFn(),
                new Promise((_, reject) => {
                  ac.signal.addEventListener('abort', () => {
                    reject(new Error('initial_pull_timeout_8s'))
                  }, { once: true })
                }),
              ])
            } finally {
              clearTimeout(timeoutId)
            }
          }
        } catch (pullErr) {
          const isTimeout = pullErr?.message === 'initial_pull_timeout_8s'
          if (isTimeout) {
            console.warn('[LicenseContext] initial pull timed out after 8s — using cached license (offline grace path)')
          } else {
            console.error('[LicenseContext] initial pull failed:', pullErr)
          }
          // v2.10.2 — surface a human-readable message so the UI can render a
          // non-blocking retry banner. Keep the gate flip below intact.
          const msg = isTimeout
            ? 'Conexión lenta — usando licencia en caché.'
            : (humanizeLicenseError(pullErr, { context: 'LicenseContext.initialPull' })
                || pullErr?.message
                || 'No se pudo sincronizar los datos iniciales. Verifique su conexión.')
          setPullError(msg)
        } finally {
          // F16 — flip the gate once pull resolves (success or failure). UI
          // already has an empty-DB fallback path; blocking forever on a flaky
          // network would be worse than letting the user try to log in.
          setFirstPullDone(true)
          setFirstPullProgress(prev => ({ ...(prev || {}), stage: 'done' }))
        }
      } else {
        // No business_id → nothing to pull; don't gate login.
        setFirstPullDone(true)
      }
      // Sync remote config to local settings if available
      // Exclude device-specific settings (printer + auto-print toggles) — those
      // are edited locally by the user and must NOT be clobbered by the stale
      // value in Supabase (desktop never pushes app_settings up, so Supabase is
      // authoritative-stale and would keep overwriting the user's toggle).
      if (res.valid && res.remoteConfig && api?.settings?.update) {
        try {
          const { printer, print_preticket, print_factura_auto, print_conduce_auto, ...safeConfig } = res.remoteConfig
          await api.settings.update(safeConfig)
        } catch {}
      }
      // Sync business settings (logo, name, etc.) from server.
      // validate.js spreads `biz.settings` flat into bizSettings, so we must
      // re-wrap everything that isn't a top-level businesses column into the
      // `settings` JSON column — otherwise empresaSave's allowed-list filter
      // silently drops biz_city / ciudad / biz_type / whatsapp_* / etc.
      // Also fetch the logo URL bytes on desktop so the receipt/PDF path has
      // a usable BLOB (web stays URL-native).
      if (res.valid && res.bizSettings && api?.admin?.saveEmpresa) {
        try {
          const { name, rnc, phone, address, email, logo, plan, ...extra } = res.bizSettings
          const payload = { name, rnc, phone, address, email, plan, settings: JSON.stringify(extra) }
          // Logo comes back as a CDN URL. On desktop (BLOB column), fetch
          // bytes and convert to data-URL so empresaSave can decode. On web,
          // pass the URL through — web.js maps logo→logo_url in the update.
          if (logo) {
            if (window.electronAPI && typeof logo === 'string' && logo.startsWith('http')) {
              try {
                const resp = await fetch(logo, { mode: 'cors' })
                if (resp.ok) {
                  const blob = await resp.blob()
                  const b64 = await new Promise((resolve) => {
                    const r = new FileReader()
                    r.onload = () => resolve(r.result)
                    r.readAsDataURL(blob)
                  })
                  payload.logo = b64
                }
              } catch (logoErr) { console.warn('[LicenseContext] logo fetch failed:', logoErr?.message) }
            } else {
              payload.logo = logo
            }
          }
          await api.admin.saveEmpresa(payload)

          // F17 — auto-restore .p12 from PEM blobs stashed in bizSettings.
          // Only runs on desktop, only if (a) PEMs exist server-side,
          // (b) local cert is currently missing (post-wipe scenario).
          try {
            if (window.electronAPI?.dgii_ecf?.restoreCertFromPEM) {
              const certInfo = await window.electronAPI.dgii_ecf.certInfo?.().catch(() => null)
              const alreadyInstalled = !!(certInfo?.installed)
              const privateKeyPem = extra?.ecf_private_key_pem
              const certificatePem = extra?.ecf_certificate_pem
              if (!alreadyInstalled && privateKeyPem && certificatePem) {
                const restoreRes = await window.electronAPI.dgii_ecf.restoreCertFromPEM({
                  privateKeyPem,
                  certificatePem,
                  password: 'terminal-x-restored',
                }).catch((e) => ({ ok: false, error: e?.message }))
                if (restoreRes && restoreRes.ok !== false) {
                  console.info('[LicenseContext] e-CF cert restored from server PEM')
                } else {
                  console.warn('[LicenseContext] e-CF cert restore failed:', restoreRes?.error)
                }
              }
            }
          } catch (certErr) {
            console.warn('[LicenseContext] cert restore block error:', certErr?.message)
          }
        } catch (saveErr) { console.warn('[LicenseContext] saveEmpresa from bizSettings failed:', saveErr?.message) }
      }
      setResult(res)
    } catch (err) {
      console.error('[LicenseContext]', err)
      // Only grant offline grace if there was a successful validation within 72h
      const lastValid = Number(localStorage.getItem('tx_last_valid') || '0')
      const withinGrace = lastValid > 0 && (Date.now() - lastValid) < OFFLINE_GRACE_MS
      const humanMsg = humanizeLicenseError(err, { context: 'LicenseContext.runCheck' })
      if (withinGrace) {
        setResult({
          valid:      true,
          status:     'offline_grace',
          readOnly:   false,
          warning:    true,
          warningMsg: `${humanMsg} Modo sin conexión activo.`,
        })
      } else {
        setResult({
          valid:      false,
          status:     'offline_expired',
          readOnly:   true,
          warning:    true,
          warningMsg: lastValid > 0
            ? 'Período de gracia sin conexión expirado. Conéctese a internet para verificar su licencia.'
            : humanMsg,
        })
      }
    } finally {
      setChecking(false)
    }
  }, [licenseKey, hwid, rnc])

  // Run check when hwid is ready AND we know the key situation.
  // v2.7 — on web, we need to wait for the licenseKey poll above to complete
  // (or time out) before running the first check — otherwise the first paint
  // flashes "Licencia inválida" for the 1-2s while main.jsx fetches the key.
  useEffect(() => {
    if (!hwid) return
    const onWeb = typeof window !== 'undefined' && !window.electronAPI
    if (onWeb && !licenseKey) return   // wait for poll/storage event
    runCheck()
  }, [hwid, licenseKey])   // eslint-disable-line

  // Periodic re-check every 4 hours
  useEffect(() => {
    if (!hwid || !licenseKey) return
    intervalRef.current = setInterval(() => runCheck(), CHECK_INTERVAL)
    return () => clearInterval(intervalRef.current)
  }, [hwid, licenseKey, runCheck])

  // ── Activate a new key ─────────────────────────────────────────────────────
  async function activate(key, rncValue) {
    const k = key.toUpperCase().trim()
    const r = (rncValue || '').replace(/\D/g, '')
    setLicenseKey(k)
    setRnc(r)

    // DEV: accept any key without validation
    if (import.meta.env.DEV) {
      setResult(makeResult('dev'))
      return
    }

    // MASTER KEY: bypass server entirely
    if (await checkMasterKey(api, k)) {
      setStoredLicenseKey(k, r)
      setResult(makeResult('master'))
      return
    }

    // REAL LICENSE: validate online
    setChecking(true)
    try {
      const res = await validateLicense(k, hwid, r)
      if (res.valid) {
        setStoredLicenseKey(k, r)
        setResult(res)
      } else {
        setResult(res)
        throw new Error(statusMessage(res.status))
      }
    } finally {
      setChecking(false)
    }
  }

  // v2.10.2 — manual retry for the initial Supabase pull. Consumed by the
  // Login banner when `pullError` is set. Safe to call repeatedly.
  const retryPull = useCallback(async () => {
    const pullFn = window.electronAPI?.sync?.pull || window.electronAPI?.sync?.now
    if (!pullFn) return
    setPullError(null)
    setFirstPullProgress({ stage: 'starting', done: 0, total: 1, table: null })
    try {
      await pullFn()
      setFirstPullProgress(prev => ({ ...(prev || {}), stage: 'done' }))
    } catch (err) {
      console.error('[LicenseContext] retryPull failed:', err)
      const msg = humanizeLicenseError(err, { context: 'LicenseContext.retryPull' })
        || err?.message
        || 'No se pudo sincronizar los datos iniciales. Verifique su conexión.'
      setPullError(msg)
    }
  }, [])

  function deactivate() {
    clearStoredLicenseKey()
    setLicenseKey('')
    setRnc('')
    setResult({ valid: false, status: 'no_key', readOnly: true })
  }

  const isMasterKey = result?.status === 'master'
  const isDevMode   = result?.status === 'dev'
  const isReadOnly  = result ? (result.readOnly || !result.valid) : true
  const isExpired   = result?.status === 'expired'
  const isNoKey     = !licenseKey || result?.status === 'no_key'
  const hasWarning  = result?.warning ?? false
  const warningMsg  = result?.warningMsg ?? null

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
      isMasterKey,
      isDevMode,
      hasWarning,
      warningMsg,
      firstPullDone,
      firstPullProgress,
      pullError,
      retryPull,
      activate,
      deactivate,
      refresh: () => runCheck(),
    }}>
      {children}
    </LicenseContext.Provider>
  )
}

// ── Status → message ──────────────────────────────────────────────────────────
function statusMessage(status) {
  return {
    not_found:        'Clave de licencia no encontrada.',
    hardware_mismatch:'Esta licencia está registrada en otro equipo.',
    rnc_mismatch:     'El RNC no coincide con el de la licencia.',
    invalid_format:   'Formato de clave inválido.',
    inactive:         'Esta licencia ha sido desactivada.',
    suspended:        'Esta licencia está suspendida.',
    expired:          'Esta licencia ha vencido.',
    offline_expired:  'Período de gracia sin conexión expirado. Conéctese a internet.',
  }[status] || 'Error al verificar la licencia.'
}
