import { createContext, useContext, useState, useEffect } from 'react'

const LayoutContext = createContext({
  collapsed:     false,
  setCollapsed:  () => {},
  darkMode:      false,
  toggleDark:    () => {},
  themePreference: 'system',
})

function getSystemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(pref) {
  return pref === 'system' ? getSystemTheme() : pref
}

export function LayoutProvider({ children }) {
  const [collapsed, setCollapsed] = useState(false)

  // 3-state: 'system' | 'light' | 'dark'  (like Content X)
  const [themePreference, setThemePreference] = useState(() => {
    const stored = localStorage.getItem('tx_theme')
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
    // Migrate from old boolean key
    if (localStorage.getItem('tx_dark_mode') === '1') return 'dark'
    return 'system'
  })

  const darkMode = resolveTheme(themePreference) === 'dark'

  // Apply / remove the `dark` class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    localStorage.setItem('tx_theme', themePreference)
    localStorage.removeItem('tx_dark_mode') // clean up old key
  }, [darkMode, themePreference])

  // Listen for OS theme changes when preference is 'system'
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const handler = () => {
      if (themePreference === 'system') {
        // Force re-render by cycling preference
        setThemePreference('system')
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [themePreference])

  // Cycle: system → light → dark → system
  function toggleDark() {
    setThemePreference(p => {
      const order = ['system', 'light', 'dark']
      return order[(order.indexOf(p) + 1) % 3]
    })
  }

  return (
    <LayoutContext.Provider value={{ collapsed, setCollapsed, darkMode, toggleDark, themePreference }}>
      {children}
    </LayoutContext.Provider>
  )
}

export function useLayout() {
  return useContext(LayoutContext)
}
