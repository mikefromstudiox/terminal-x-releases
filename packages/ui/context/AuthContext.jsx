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
    api.admin.getUsuarios().then(users => {
      const active = users?.filter(u => u.active)
      if (!active?.length && !loggingOutRef.current) {
        setUser(TEMP_OWNER)
      }
      setWebChecked(true)
    }).catch(() => {
      if (!loggingOutRef.current) setUser(TEMP_OWNER)
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
    setUser(null)
    if (!isWeb) return

    // On web, kill the Supabase session, every cached license/auth artifact,
    // and hard-redirect so the SupabaseAuthGate remounts cleanly on the
    // landing/email-password screen with zero stale state. Using the EXACT
    // same client instance that SupabaseAuthGate created (window.__txSupabase)
    // is mandatory — otherwise signOut fires on a different client and the
    // gate's onAuthStateChange never sees it.
    try {
      const sb = typeof window !== 'undefined' ? window.__txSupabase : null
      if (sb?.auth?.signOut) {
        // AWAIT with a 3s timeout — the gate's onAuthStateChange should fire
        // before the hard reload, BUT if the network is flaky or the Supabase
        // endpoint hangs, we must not block the logout. The localStorage wipe
        // below is a belt-and-suspenders fallback. Without the timeout, a
        // hung signOut would block forever and surface as "failed to fetch"
        // on the next sign-in attempt.
        await Promise.race([
          sb.auth.signOut().catch(() => {}),
          new Promise(resolve => setTimeout(resolve, 3000)),
        ])
      }
    } catch {}

    // Wipe every key that could keep the user signed in across the reload:
    // - tx_pos_user (already cleared by setUser(null), but be defensive)
    // - tx_last_valid (offline-grace timestamp — would let LicenseContext
    //   bypass re-validation)
    // - tx_license_key (auto-fetched from licenses table on next sign-in)
    // - tx_setting_business_id / supabase_business_id (cached business id)
    // - sb-*-auth-token (Supabase SDK session — the SDK clears its own copy
    //   in signOut, but we belt-and-suspenders it here in case signOut failed
    //   silently due to network)
    try {
      sessionStorage.removeItem(STORAGE_KEY)
      const lsKeys = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k) continue
        if (
          k === 'tx_last_valid' ||
          k === 'tx_license_key' ||
          k.startsWith('tx_setting_') ||
          k.startsWith('sb-')
        ) lsKeys.push(k)
      }
      lsKeys.forEach(k => { try { localStorage.removeItem(k) } catch {} })
    } catch {}

    // Hard reload to the public landing so EVERY in-memory React state
    // (LicenseContext, DataContext, BusinessTypeContext, cached api ref) is
    // discarded. The LOGOUT_FLAG sessionStorage entry is consumed on the
    // very next mount of SupabaseAuthGate's children — see useEffect above.
    try {
      window.location.replace('/')
    } catch {
      window.location.href = '/'
    }
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
