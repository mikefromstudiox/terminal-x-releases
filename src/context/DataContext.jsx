/**
 * DataContext — Platform abstraction layer.
 *
 * Provides the same API shape regardless of platform (Electron IPC vs Supabase).
 * Every screen/component uses useAPI() instead of window.electronAPI directly.
 *
 * Platform layers:
 *   - src/data/electron.js  → wraps window.electronAPI (current desktop app)
 *   - src/data/web.js       → wraps Supabase client   (future PWA)
 */
import { createContext, useContext } from 'react'

const DataContext = createContext(null)

// Deep proxy that returns no-op functions for any property access.
// Prevents "cannot read X of null/undefined" when api is not yet ready.
const NOOP = () => Promise.resolve(null)
const noopHandler = {
  get(_, prop) {
    if (prop === 'then' || prop === Symbol.toPrimitive || prop === Symbol.iterator) return undefined
    return new Proxy(NOOP, noopHandler)
  },
  apply() { return Promise.resolve(null) },
}
const SAFE_API = new Proxy(NOOP, noopHandler)
const SAFE_PRINTER = new Proxy(NOOP, noopHandler)

export function DataProvider({ api, printerApi, children }) {
  return (
    <DataContext.Provider value={{ api, printerApi }}>
      {children}
    </DataContext.Provider>
  )
}

/** Returns the full platform API — never null, returns safe proxy if not ready */
export function useAPI() {
  const ctx = useContext(DataContext)
  return ctx?.api || SAFE_API
}

/** Returns the printer API — never null */
export function usePrinterAPI() {
  const ctx = useContext(DataContext)
  return ctx?.printerApi || SAFE_PRINTER
}

/** Check if real API is available */
export function useHasAPI() {
  const ctx = useContext(DataContext)
  return !!ctx?.api && ctx.api !== SAFE_API
}
