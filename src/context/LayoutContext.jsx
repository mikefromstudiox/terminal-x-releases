import { createContext, useContext, useState } from 'react'

const LayoutContext = createContext({ collapsed: false, setCollapsed: () => {} })

export function LayoutProvider({ children }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <LayoutContext.Provider value={{ collapsed, setCollapsed }}>
      {children}
    </LayoutContext.Provider>
  )
}

export function useLayout() {
  return useContext(LayoutContext)
}
