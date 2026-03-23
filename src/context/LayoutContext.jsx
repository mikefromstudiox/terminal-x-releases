import { createContext, useContext, useState, useEffect } from 'react'

const LayoutContext = createContext({
  collapsed:    false,
  setCollapsed: () => {},
  darkMode:     false,
  toggleDark:   () => {},
})

export function LayoutProvider({ children }) {
  const [collapsed, setCollapsed] = useState(false)
  const [darkMode,  setDarkMode]  = useState(
    () => localStorage.getItem('tx_dark_mode') === '1'
  )

  // Apply / remove the `dark` class on <html> whenever darkMode changes
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    localStorage.setItem('tx_dark_mode', darkMode ? '1' : '0')
  }, [darkMode])

  function toggleDark() {
    setDarkMode(d => !d)
  }

  return (
    <LayoutContext.Provider value={{ collapsed, setCollapsed, darkMode, toggleDark }}>
      {children}
    </LayoutContext.Provider>
  )
}

export function useLayout() {
  return useContext(LayoutContext)
}
