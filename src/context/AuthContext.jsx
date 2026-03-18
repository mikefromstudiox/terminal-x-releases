import { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

// Placeholder credentials — will be replaced with SQLite auth when Settings is built
const DEMO_USERS = [
  { id: 1, name: 'Admin',    role: 'owner',      pin: '1234', username: 'admin',    password: 'admin123' },
  { id: 2, name: 'Cajero',   role: 'cashier',    pin: '0000', username: 'cajero',   password: 'cajero123' },
  { id: 3, name: 'Gerente',  role: 'manager',    pin: '1111', username: 'gerente',  password: 'gerente123' },
  { id: 4, name: 'CFO',      role: 'cfo',        pin: '2222', username: 'cfo',      password: 'cfo123' },
  { id: 5, name: 'Contador', role: 'accountant', pin: '3333', username: 'contador', password: 'cont123' },
]

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)

  function login(pin) {
    const found = DEMO_USERS.find(u => u.pin === pin)
    if (found) { setUser(found); return true }
    return false
  }

  function loginWithPassword(username, password) {
    const found = DEMO_USERS.find(
      u => u.username === username.trim().toLowerCase() && u.password === password
    )
    if (found) { setUser(found); return true }
    return false
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
