import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { useAPI } from './DataContext'

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
    try { api?.activity?.setActor?.(u || null) } catch {}
  }

  useEffect(() => { try { api?.activity?.setActor?.(user || null) } catch {} }, [api, user])

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
    } catch {}
    return u
  }

  async function login(pin) {
    try {
      const u = await api?.auth?.byPin?.(pin)
      if (u?.id) { setUser(await resolveRole(u)); return true }
      return false
    } catch {
      return false
    }
  }

  // For username+password mode, verify both username AND PIN match
  async function loginWithPassword(username, password) {
    try {
      const u = await api?.auth?.byPin?.(password)
      if (u?.id && u.username?.toLowerCase() === username.trim().toLowerCase()) {
        setUser(await resolveRole(u)); return true
      }
      return false
    } catch {
      return false
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
        await Promise.race([
          sb.auth.signOut({ scope: 'local' }).catch(() => {}),
          new Promise(resolve => setTimeout(resolve, 1500)),
        ])
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

    // Drop the cached client reference so that if, for any reason, the SPA
    // reuses the module cache (e.g. redirect blocked by a beforeunload), the
    // next auth call forces a fresh createClient instead of reusing a client
    // whose GoTrue subsystem is now torn down.
    try { if (typeof window !== 'undefined') window.__txSupabase = null } catch {}

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

  return (
    <AuthContext.Provider value={{ user, login, loginWithPassword, logout, webChecked }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
