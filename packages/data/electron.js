/**
 * electron.js — Electron data layer.
 *
 * Simply passes through to window.electronAPI and window.printerAPI
 * which are set up by electron/preload.js via contextBridge.
 *
 * This is the "do nothing" adapter — the existing IPC bridge already
 * provides the exact shape we need. We just expose it through the
 * DataContext so screens don't reference window globals directly.
 */

export function createElectronAPI() {
  return window.electronAPI || null
}

export function createElectronPrinterAPI() {
  if (!window.printerAPI) return null
  // Augment the preload-injected printerAPI with a `print` method that
  // delegates to electronAPI.print (the real receipt-sending IPC). Without
  // this, callers that do `printerApi.print(...)` silently no-op because
  // window.printerAPI only exposes listPrinters / openDrawer / testDrawerVariants.
  return {
    ...window.printerAPI,
    print: (payload) => (window.electronAPI?.print
      ? window.electronAPI.print(payload)
      : Promise.resolve({ success: false, error: 'no_print_ipc' })),
  }
}

/** True when running inside Electron (preload.js injected the bridge) */
export function isElectron() {
  return typeof window !== 'undefined' && !!window.electronAPI
}
