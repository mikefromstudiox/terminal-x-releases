import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { useAPI } from './DataContext'
import { setSentryContext } from '@terminal-x/services/sentry-renderer.js'

const AuthContext = createContext(null)

const DEV_USER = import.meta.env.DEV
  ? { id: 0, name: 'Dev Owner', username: 'dev', role: 'owner', active: 1 }
  : null

const isWeb = typeof window !== 'undefined' && !window.electronAPI

// Temporary owner for first-time setup (no staff created yet)
const TEMP_OWNER = { id: 'web', name: 'Owner', username: 'owner', role: 'owner', active: 1 }

// Persist PIN-auth user to sessionStorage on web so navigation doesn't kick
// them back to the PIN screen. Desktop has no lazy-reload issue.
const STORAGE_KEY = 'tx_pos_user'
// Cross-firm impersonation ("Ver como cliente"). When set, the SupabaseAuthGate
// hands the impersonated business_id into createWebAPI() so every web.js read
// is scoped to the client tenant rather than the contadora's firm. Pro MAX
// only — gate enforced both in the UI (hasFeature('contabilidad_view_as_client'))
// and on the server (panel.js?action=firm_impersonate_check verifies an active
// access_granted row in accounting_clients).
const IMPERSONATION_KEY    = 'tx_impersonating_biz_id'
const IMPERSONATION_META   = 'tx_impersonating_meta'   // { client_name, firm_business_id }
// Sticky flag — survives full page reload. While set, the TEMP_OWNER auto-login
// path must NOT fire, otherwise logging out of the seeded demo accounts (which
// have active users) silently re-grants owner access on the very next render.
const LOGOUT_FLAG = 'tx_logging_out'
function loadStoredUser() {
  if (DEV_USER) return DEV_USER
  if (!isWeb || typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function AuthProvider({ children }) {
  const api = useAPI()
  const [user, setUserState] = useState(loadStoredUser)
  const [webChecked, setWebChecked] = useState(!isWeb || !!loadStoredUser()) // desktop skips check; web skips if user already cached
  const loggingOutRef = useRef(false)

  // Persist user state on every change (web only) + push actor to electron DB
  const setUser = (u) => {
    setUserState(u)
    if (isWeb && typeof sessionStorage !== 'undefined') {
      try {
        if (u) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(u))
        else sessionStorage.removeItem(STORAGE_KEY)
      } catch {}
    }
    // localStorage scope tags so reportClientError() in main.jsx can attach
    // them to error reports without needing the AuthContext at error time.
    if (isWeb && typeof localStorage !== 'undefined') {
      try {
        if (u?.id) localStorage.setItem('tx_user_id', String(u.id)); else localStorage.removeItem('tx_user_id')
        if (u?.role) localStorage.setItem('tx_user_role', String(u.role)); else localStorage.removeItem('tx_user_role')
      } catch {}
    }
    try { api?.activity?.setActor?.(u || null) } catch {}
    // Sentry user context (no-op when DSN unset).
    try { setSentryContext({ user: u || null }) } catch {}
  }

  useEffect(() => { try { api?.activity?.setActor?.(user || null) } catch {} }, [api, user])

  // Push business context (id, type, vertical) to Sentry once we can read it.
  // Safe when Sentry is disabled — setSentryContext is a no-op.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      try {
        const [empresa, kv] = await Promise.all([
          api?.admin?.getEmpresa?.().catch((err) => { try { window.__txReportError?.(err, { severity: 'warn', category: 'auth.getEmpresa.sentry_context' }) } catch {} ; return null }),
          api?.settings?.get?.().catch((err) => { try { window.__txReportError?.(err, { severity: 'warn', category: 'auth.settingsGet.sentry_context' }) } catch {} ; return null }),
        ])
        if (cancelled) return
        // 2026-05-18 — JWT app_metadata.business_id is the canonical claim
        // (Hard Rule #20). Resolve from the live Supabase session FIRST so the
        // per-tab window var always reflects THIS tab's session, never another
        // tab's localStorage write. Empresa fallback covers desktop / pre-JWT.
        let jwtBusinessId = null
        try {
          const sb = typeof window !== 'undefined' ? window.__txSupabase : null
          const { data } = sb?.auth?.getSession ? await sb.auth.getSession() : { data: null }
          jwtBusinessId = data?.session?.user?.app_metadata?.business_id || null
        } catch {}
        const businessId   = jwtBusinessId || empresa?.business_id || empresa?.id || empresa?.supabase_id || null
        const businessType = kv?.business_type || empresa?.business_type || null
        const vertical     = kv?.vertical || kv?.subtype || null
        // Per-tab globals consumed by web/main.jsx reportClientError(). Window
        // vars are per-tab memory and cannot be clobbered by another tab the
        // way localStorage 'tx_business_id' can.
        try {
          if (typeof window !== 'undefined') {
            if (businessId) window.__txBusinessId = businessId
            if (businessType) window.__txBusinessType = businessType
          }
        } catch {}
        setSentryContext({ business: { id: businessId, type: businessType, vertical } })
      } catch {}
    })()
    return () => { cancelled = true }
  }, [api, user?.id])

  // On web, check if business has staff — if none, allow temporary owner for setup.
  // Skip entirely if a cached user already exists (avoids wiping auth on navigation).
  // CRITICAL: also skip while a logout is in flight, otherwise this effect will
  // re-instate TEMP_OWNER right after setUser(null) and the user is silently
  // signed back in before the Supabase signOut callback flips the auth gate.
  useEffect(() => {
    if (!isWeb || DEV_USER) { setWebChecked(true); return }
    if (user) { setWebChecked(true); return }
    if (loggingOutRef.current) { setWebChecked(true); return }
    try { if (sessionStorage.getItem(LOGOUT_FLAG)) { setWebChecked(true); return } } catch {}
    if (!api?.admin?.getUsuarios) return
    api.admin.getUsuarios().then(async users => {
      const active = users?.filter(u => u.active)
      if (!active?.length && !loggingOutRef.current) {
        // Defense-in-depth: an empty active list could mean (a) genuine
        // first-time-setup, or (b) an RLS silent-empty (staff SELECT missing,
        // network hiccup, stale JWT). Before granting TEMP_OWNER, verify we
        // are really in a fresh state by also checking for a setup marker.
        // Require BOTH: no users AND no business/empresa record visible.
        let isFreshInstall = false
        try {
          const empresa = await api?.admin?.getEmpresa?.()
          // Fresh install = empresa row absent OR lacking a rnc
          isFreshInstall = !empresa || !empresa.rnc
        } catch { isFreshInstall = false }
        if (isFreshInstall) setUser(TEMP_OWNER)
        // else: leave user null → Login screen renders → user must auth properly
      }
      setWebChecked(true)
    }).catch(() => {
      // A failed getUsuarios is NO LONGER a green light for TEMP_OWNER.
      // Network/RLS/JWT failures should surface as a login-required state,
      // not silently grant owner role (prior vector: staff RLS missing SELECT
      // → every web user got TEMP_OWNER).
      setWebChecked(true)
    })
  }, [api])

  // Resolve role from linked employee record (if employee_id exists)
  async function resolveRole(u) {
    if (!u?.employee_id || !api?.empleados?.all) return u
    try {
      const emps = await api.empleados.all()
      const emp = emps?.find(e => e.id === u.employee_id)
      if (emp?.role && emp.role !== 'none') return { ...u, role: emp.role }
    } catch (err) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(err, { severity: 'critical', category: 'auth.resolveRole.empleados_load_failed', extra: { user_id: u?.id, employee_id: u?.employee_id } }) } catch {}
    }
    return u
  }

  // Sprint 10 (v2.10.5) — login returns a tri-state { ok, lockedUntil }.
  // Callers that used the old boolean path (existing code) still work: truthy
  // objects evaluate as truthy. The Login screen now checks the object shape
  // to surface "Cuenta bloqueada" instead of a generic "PIN incorrecto" when
  // the miss was accompanied by any row reaching the 5-attempt lockout.
  async function login(pin) {
    try {
      const u = await api?.auth?.byPin?.(pin)
      if (u?.id) { setUser(await resolveRole(u)); return { ok: true } }
      let lockedUntil = null
      try {
        const s = await api?.auth?.lockoutStatus?.()
        if (s?.locked) lockedUntil = s.until
      } catch {}
      return { ok: false, lockedUntil }
    } catch {
      return { ok: false, lockedUntil: null }
    }
  }

  async function loginWithPassword(username, password) {
    try {
      const u = await api?.auth?.byPin?.(password)
      if (u?.id && u.username?.toLowerCase() === username.trim().toLowerCase()) {
        setUser(await resolveRole(u)); return { ok: true }
      }
      let lockedUntil = null
      try {
        const s = await api?.auth?.lockoutStatus?.()
        if (s?.locked) lockedUntil = s.until
      } catch {}
      return { ok: false, lockedUntil }
    } catch {
      return { ok: false, lockedUntil: null }
    }
  }

  async function logout() {
    // Mark logout in flight FIRST so the TEMP_OWNER auto-login effect cannot
    // race in and silently re-authenticate the user after setUser(null) flips.
    loggingOutRef.current = true
    if (isWeb) {
      try { sessionStorage.setItem(LOGOUT_FLAG, '1') } catch {}
    }
    if (!isWeb) { setUser(null); return }

    // Cancel any offline-sync interval BEFORE signOut. The interval's closure
    // holds a reference to the Supabase client; if it fires mid-signOut it can
    // issue fetches against a half-revoked GoTrue subsystem and poison the
    // client's fetch wrapper — the trigger for "Failed to fetch" on the next
    // signInWithPassword when location.replace('/') gets blocked/delayed.
    try {
      const { stopOfflineSync } = await import('@terminal-x/services/offline-queue.js')
      stopOfflineSync?.()
    } catch {}

    // CRITICAL ORDERING (web): do signOut + storage wipe BEFORE any React state
    // mutation that could unmount this component and cancel the in-flight work.
    // Previously we called setUser(null) first — that re-rendered ancestors,
    // could unmount AuthProvider mid-await, and leave the Supabase session
    // half-revoked. On the next sign-in the SDK's fetch layer then failed with
    // "Failed to fetch" because localStorage still had a stale sb-*-auth-token
    // that the new client tried (and failed) to refresh before accepting the
    // new signInWithPassword call.

    // Use the SAME client SupabaseAuthGate mounted — window.__txSupabase is
    // the single canonical instance set in web/main.jsx. Fall back to the
    // services-side client on desktop/hybrid contexts.
    let sb = null
    try { sb = typeof window !== 'undefined' ? window.__txSupabase : null } catch {}

    // Issue signOut while component is still mounted. Use { scope: 'local' }
    // so the SDK only touches local storage + broadcasts to other tabs; this
    // avoids the server round-trip that was being aborted by the subsequent
    // location.replace() and leaving the refresh token in a weird state.
    // A separate global signOut is fired-and-forgotten so other devices still
    // get revoked server-side, but we never block on it.
    try {
      if (sb?.auth?.signOut) {
        // v2.16.3 — instantaneous logout. Awaits only real local cleanup (no
        // fake setTimeout delay). Local-scope signOut is a synchronous
        // localStorage wipe + same-tab broadcast — it resolves immediately.
        await sb.auth.signOut({ scope: 'local' }).catch(() => {})
        // Fire-and-forget global revocation — does not block redirect.
        try { sb.auth.signOut({ scope: 'global' }).catch(() => {}) } catch {}
      }
    } catch {}

    // Wipe EVERY key that could keep the user signed in across the reload.
    // Belt-and-suspenders for the SDK's own cleanup. This MUST include every
    // tx_* and sb-* key from BOTH storages — a stale sb-*-auth-token is the
    // exact trigger for "Failed to fetch" on the next signInWithPassword.
    try {
      const wipeFrom = (store) => {
        if (!store) return
        const kill = []
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i)
          if (!k) continue
          if (
            k === STORAGE_KEY ||
            k === LOGOUT_FLAG ||
            k === 'tx_last_valid' ||
            k === 'tx_license_key' ||
            k.startsWith('tx_setting_') ||
            k.startsWith('tx_') ||
            k.startsWith('sb-') ||
            k.startsWith('supabase.')
          ) kill.push(k)
        }
        kill.forEach(k => { try { store.removeItem(k) } catch {} })
      }
      wipeFrom(typeof localStorage !== 'undefined' ? localStorage : null)
      wipeFrom(typeof sessionStorage !== 'undefined' ? sessionStorage : null)
      // Re-set LOGOUT_FLAG — we just wiped it above, but SupabaseAuthGate's
      // clearLogoutFlag() only fires after mount, so it MUST exist across the
      // hard reload to suppress the TEMP_OWNER auto-login race.
      try { sessionStorage.setItem(LOGOUT_FLAG, '1') } catch {}
    } catch {}

    // SECURITY: wipe Service Worker caches before redirect. The legacy
    // sw.js used to cache Supabase REST responses keyed by URL alone; that
    // cache could survive logout and serve a previous tenant's response to
    // the next tenant. v4 sw.js no longer caches Supabase, but other caches
    // (HTML, asset chunks) might hold authenticated responses too — wipe
    // everything on logout. Idempotent and cheap.
    try {
      if (typeof caches !== 'undefined' && caches.keys) {
        const keys = await caches.keys()
        await Promise.all(keys.map(k => caches.delete(k).catch(() => {})))
      }
    } catch {}

    // Drop the cached client reference so that if, for any reason, the SPA
    // reuses the module cache (e.g. redirect blocked by a beforeunload), the
    // next auth call forces a fresh createClient instead of reusing a client
    // whose GoTrue subsystem is now torn down.
    try {
      if (typeof window !== 'undefined') {
        window.__txSupabase = null
        // Clear per-tab business attribution so any error fired after logout
        // does NOT carry the dead session's business_id. See
        // feedback_app_metadata_canonical_jwt_claim + report-error fix.
        try { window.__txBusinessId = null } catch {}
        try { window.__txBusinessType = null } catch {}
        // Also reset the module-scope cache in web/main.jsx so a subsequent
        // signInWithPassword (in the same SPA instance, e.g. if the hard
        // reload is suppressed) recreates a fresh createClient() instead of
        // reusing the torn-down one.
        try { window.__txResetSupabase?.() } catch {}
      }
    } catch {}

    // Hard reload to the public landing so EVERY in-memory React state
    // (LicenseContext, DataContext, BusinessTypeContext, cached api ref,
    // module-scoped _supabase in web/main.jsx) is discarded. Only flip the
    // React state AFTER the navigation is queued — if the browser honors
    // the replace synchronously the setUser is a no-op; if it doesn't, the
    // gate still sees user=null and shows the login screen.
    try {
      window.location.replace('/')
    } catch {
      try { window.location.href = '/' } catch {}
    }
    setUser(null)
  }

  // ── Cross-firm impersonation ("Ver como cliente") ────────────────────────
  // The effective business_id swap happens at SupabaseAuthGate (createWebAPI
  // closes over businessId, so React state is captured at construction time).
  // We therefore drive the swap via sessionStorage + a hard reload — every
  // memoized hook, DataContext consumer, sync interval, and offline queue gets
  // a clean slate against the new tenant. This is also the safest pattern:
  // never accidentally leak a firm-scoped query into a client-scoped session.
  const [impersonatingBusinessId, setImpersonatingBusinessId] = useState(() => {
    if (typeof sessionStorage === 'undefined') return null
    try { return sessionStorage.getItem(IMPERSONATION_KEY) || null } catch { return null }
  })
  const [impersonationMeta, setImpersonationMeta] = useState(() => {
    if (typeof sessionStorage === 'undefined') return null
    try {
      const raw = sessionStorage.getItem(IMPERSONATION_META)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })

  async function enterImpersonation({ clientBusinessId, clientName, firmBusinessId, accountingClientId } = {}) {
    if (!clientBusinessId) throw new Error('clientBusinessId required')
    // Server-side authorization + audit write. Bearer-auth via the canonical
    // Supabase client — same pattern as ctb_* actions in Cartera.jsx.
    const sb = (typeof window !== 'undefined' && window.__txSupabase) || null
    const sess = sb ? (await sb.auth.getSession())?.data?.session : null
    const token = sess?.access_token
    if (!token) throw new Error('Sesión expirada — inicia sesión.')
    const res = await fetch('/api/panel?action=firm_impersonate_check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        client_business_id:    clientBusinessId,
        accounting_client_id:  accountingClientId || null,
      }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || j?.ok === false) {
      throw new Error(j?.error || j?.message || `HTTP ${res.status}`)
    }
    const meta = {
      client_business_id:   clientBusinessId,
      client_name:          clientName || j?.client_name || '',
      firm_business_id:     firmBusinessId || j?.firm_business_id || null,
      accounting_client_id: accountingClientId || null,
      started_at:           new Date().toISOString(),
    }
    try {
      sessionStorage.setItem(IMPERSONATION_KEY, String(clientBusinessId))
      sessionStorage.setItem(IMPERSONATION_META, JSON.stringify(meta))
    } catch {}
    setImpersonatingBusinessId(String(clientBusinessId))
    setImpersonationMeta(meta)
    // Hard reload into /pos so every context (Data/License/Plan/BizType) and
    // memoized createWebAPI(supabase, businessId) closure rebuilds against
    // the new tenant. No partial-state leakage.
    try { window.location.replace('/pos') } catch {
      try { window.location.href = '/pos' } catch {}
    }
    return j
  }

  async function exitImpersonation() {
    // Fire-and-forget audit write; failures must NOT block the user from
    // escaping the impersonated tenant. The server endpoint is idempotent.
    try {
      const sb = (typeof window !== 'undefined' && window.__txSupabase) || null
      const sess = sb ? (await sb.auth.getSession())?.data?.session : null
      const token = sess?.access_token
      if (token) {
        await fetch('/api/panel?action=firm_impersonate_end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            client_business_id:    impersonatingBusinessId,
            accounting_client_id:  impersonationMeta?.accounting_client_id || null,
          }),
        }).catch(() => {})
      }
    } catch {}
    try {
      sessionStorage.removeItem(IMPERSONATION_KEY)
      sessionStorage.removeItem(IMPERSONATION_META)
    } catch {}
    setImpersonatingBusinessId(null)
    setImpersonationMeta(null)
    // Hard reload back to /contabilidad/cartera — the contadora's natural home.
    try { window.location.replace('/contabilidad/cartera') } catch {
      try { window.location.href = '/contabilidad/cartera' } catch {}
    }
  }

  return (
    <AuthContext.Provider value={{
      user, login, loginWithPassword, logout, webChecked,
      impersonatingBusinessId, impersonationMeta,
      enterImpersonation, exitImpersonation,
      isImpersonating: !!impersonatingBusinessId,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
