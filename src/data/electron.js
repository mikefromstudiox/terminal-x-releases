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
  return window.printerAPI || null
}

/** True when running inside Electron (preload.js injected the bridge) */
export function isElectron() {
  return typeof window !== 'undefined' && !!window.electronAPI
}
