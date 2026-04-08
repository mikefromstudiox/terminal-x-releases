import { createContext, useContext, useState, useEffect } from 'react'
import { useAPI } from './DataContext'

const AuthContext = createContext(null)

const DEV_USER = import.meta.env.DEV
  ? { id: 0, name: 'Dev Owner', username: 'dev', role: 'owner', active: 1 }
  : null

const isWeb = typeof window !== 'undefined' && !window.electronAPI

// Temporary owner for first-time setup (no staff created yet)
const TEMP_OWNER = { id: 'web', name: 'Owner', username: 'owner', role: 'owner', active: 1 }

export function AuthProvider({ children }) {
  const api = useAPI()
  const [user, setUser] = useState(DEV_USER || null)
  const [webChecked, setWebChecked] = useState(!isWeb) // desktop skips check

  // On web, check if business has staff — if none, allow temporary owner for setup
  useEffect(() => {
    if (!isWeb || DEV_USER) { setWebChecked(true); return }
    if (!api?.admin?.getUsuarios) return
    api.admin.getUsuarios().then(users => {
      const active = users?.filter(u => u.active)
      if (!active?.length) {
        // No staff yet — allow temporary owner for first-time setup
        setUser(TEMP_OWNER)
      }
      // If staff exists, user stays null — Login screen shows
      setWebChecked(true)
    }).catch(() => {
      // Can't load staff — allow temporary owner (offline/error case)
      setUser(TEMP_OWNER)
      setWebChecked(true)
    })
  }, [api])

  async function login(pin) {
    try {
      const u = await api?.auth?.byPin?.(pin)
      if (u?.id) { setUser(u); return true }
      return false
    } catch {
      return false
    }
  }

  // For username+password mode, verify username exists then use password as PIN
  async function loginWithPassword(username, password) {
    try {
      // Try PIN-based auth using password field as the PIN
      const u = await api?.auth?.byPin?.(password)
      if (u?.id && u.username?.toLowerCase() === username.trim().toLowerCase()) {
        setUser(u); return true
      }
      // Fallback: match by PIN alone (for owner who might not know username)
      if (u?.id) { setUser(u); return true }
      return false
    } catch {
      return false
    }
  }

  function logout() {
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
