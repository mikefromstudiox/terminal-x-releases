import { createContext, useContext, useState, useEffect } from 'react'
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
  useEffect(() => {
    if (!isWeb || DEV_USER) { setWebChecked(true); return }
    if (user) { setWebChecked(true); return }
    if (!api?.admin?.getUsuarios) return
    api.admin.getUsuarios().then(users => {
      const active = users?.filter(u => u.active)
      if (!active?.length) {
        setUser(TEMP_OWNER)
      }
      setWebChecked(true)
    }).catch(() => {
      setUser(TEMP_OWNER)
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

  function logout() {
    setUser(null)
    // On web, also kill the Supabase session so SupabaseAuthGate flips back
    // to the email/password sign-in screen. Use the EXACT same client instance
    // that SupabaseAuthGate created — stashed on window.__txSupabase by
    // web/main.jsx. Without using the same instance, signOut fires on a
    // different client and the gate's onAuthStateChange never sees it.
    if (isWeb) {
      try {
        const sb = typeof window !== 'undefined' ? window.__txSupabase : null
        if (sb?.auth?.signOut) sb.auth.signOut().catch(() => {})
      } catch {}
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
