import { createContext, useContext, useState, useEffect } from 'react'
import { useAPI } from './DataContext'

const AuthContext = createContext(null)

const DEV_USER = import.meta.env.DEV
  ? { id: 0, name: 'Dev Owner', username: 'dev', role: 'owner', active: 1 }
  : null

// On web, provide a default owner user (Supabase auth already verified identity)
const isWeb = typeof window !== 'undefined' && !window.electronAPI
const WEB_USER = isWeb
  ? { id: 'web', name: 'Owner', username: 'owner', role: 'owner', active: 1 }
  : null

export function AuthProvider({ children }) {
  const api = useAPI()
  const [user, setUser] = useState(DEV_USER || WEB_USER)

  // On web, load actual user name from staff/users table
  useEffect(() => {
    if (!isWeb || !api?.users?.all) return
    api.users.all().then(users => {
      if (users?.length) {
        const owner = users.find(u => u.role === 'owner') || users[0]
        setUser(prev => prev ? { ...prev, name: owner.name, username: owner.username || prev.username } : prev)
      }
    }).catch(() => {})
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
    <AuthContext.Provider value={{ user, login, loginWithPassword, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
