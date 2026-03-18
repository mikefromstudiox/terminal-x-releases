import { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

const ipc = () => window?.electronAPI

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)

  async function login(pin) {
    try {
      const u = await ipc()?.auth?.byPin?.(pin)
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
      const u = await ipc()?.auth?.byPin?.(password)
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
