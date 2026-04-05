/**
 * print-web.js — Web/PWA printing service for Terminal X POS
 *
 * Two strategies:
 * 1. qz-tray — USB thermal printers on desktop browsers (raw ESC/POS)
 * 2. PDF fallback — tablets/phones (generate PDF, open browser print dialog)
 */
import { buildReceiptPDFBase64 } from './pdf'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasQZ() {
  return typeof qz !== 'undefined'
}

/** Read the saved printer name from localStorage */
export function getSelectedPrinter() {
  try {
    return localStorage.getItem('tx_web_printer') || null
  } catch {
    return null
  }
}

/** Save the selected printer name to localStorage */
export function setSelectedPrinter(name) {
  try {
    localStorage.setItem('tx_web_printer', name || '')
  } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// qz-tray connection
// ---------------------------------------------------------------------------

/**
 * Initialize qz-tray websocket connection. Call once on app start.
 * Safe to call multiple times — skips if already connected.
 * @returns {{ ok: boolean, error?: string }}
 */
export async function initQZTray() {
  try {
    if (!hasQZ()) return { ok: false, error: 'qz-tray not loaded' }
    if (qz.websocket.isActive()) return { ok: true }
    await qz.websocket.connect()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || 'qz-tray connection failed' }
  }
}

/**
 * Check if qz-tray websocket is connected and ready.
 * @returns {boolean}
 */
export function isQZReady() {
  return hasQZ() && qz.websocket.isActive()
}

// ---------------------------------------------------------------------------
// qz-tray printer operations
// ---------------------------------------------------------------------------

/**
 * List available printers via qz-tray.
 * @returns {{ ok: boolean, printers?: string[], error?: string }}
 */
export async function listPrinters() {
  try {
    if (!isQZReady()) {
      const conn = await initQZTray()
      if (!conn.ok) return { ok: false, printers: [], error: conn.error }
    }
    const printers = await qz.printers.find()
    return { ok: true, printers: Array.isArray(printers) ? printers : [printers] }
  } catch (err) {
    return { ok: false, printers: [], error: err?.message || 'Failed to list printers' }
  }
}

/**
 * Print a raw ESC/POS buffer via qz-tray.
 * @param {Uint8Array|ArrayBuffer|number[]} buffer  Raw ESC/POS bytes
 * @param {string} [printerName]  Printer name (falls back to localStorage selection)
 * @returns {{ ok: boolean, error?: string }}
 */
export async function printRaw(buffer, printerName) {
  try {
    const name = printerName || getSelectedPrinter()
    if (!name) return { ok: false, error: 'No printer selected' }

    if (!isQZReady()) {
      const conn = await initQZTray()
      if (!conn.ok) return { ok: false, error: conn.error }
    }

    // Convert buffer to base64
    const bytes = buffer instanceof Uint8Array
      ? buffer
      : buffer instanceof ArrayBuffer
        ? new Uint8Array(buffer)
        : new Uint8Array(buffer)

    const base64 = btoa(String.fromCharCode(...bytes))

    const config = qz.configs.create(name)
    await qz.print(config, [{ type: 'raw', format: 'base64', data: base64 }])
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || 'Raw print failed' }
  }
}

/**
 * Open cash drawer via qz-tray ESC/POS command.
 * Sends standard drawer kick pulse: ESC p 0 32 80
 * @param {string} [printerName]  Printer name (falls back to localStorage selection)
 * @returns {{ ok: boolean, error?: string }}
 */
export async function openDrawer(printerName) {
  try {
    const name = printerName || getSelectedPrinter()
    if (!name) return { ok: false, error: 'No printer selected' }

    if (!isQZReady()) {
      const conn = await initQZTray()
      if (!conn.ok) return { ok: false, error: conn.error }
    }

    // ESC p 0 0x20 0x50 — standard cash drawer kick
    const drawerCmd = '\x1B\x70\x00\x20\x50'
    const base64 = btoa(drawerCmd)

    const config = qz.configs.create(name)
    await qz.print(config, [{ type: 'raw', format: 'base64', data: base64 }])
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || 'Drawer kick failed' }
  }
}

// ---------------------------------------------------------------------------
// PDF fallback
// ---------------------------------------------------------------------------

/**
 * Print receipt via PDF fallback — generates PDF, opens browser print dialog.
 * Works on any device (tablets, phones, desktops without qz-tray).
 * @param {object} receiptData  Same shape as printClientReceipt data object
 * @returns {{ ok: boolean, error?: string }}
 */
export async function printPDFFallback(receiptData) {
  try {
    const { base64, filename } = await buildReceiptPDFBase64(receiptData)

    // Convert base64 to blob
    const byteChars = atob(base64)
    const byteArray = new Uint8Array(byteChars.length)
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i)
    }
    const blob = new Blob([byteArray], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)

    // Open in new window and trigger print
    const win = window.open(url, '_blank')
    if (win) {
      win.addEventListener('load', () => {
        win.focus()
        win.print()
      })
      // Clean up blob URL after a delay to ensure print dialog has opened
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } else {
      // Popup blocked — fall back to download
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || 'PDF print failed' }
  }
}

// ---------------------------------------------------------------------------
// Smart print — qz-tray first, PDF fallback
// ---------------------------------------------------------------------------

/**
 * Smart print — tries qz-tray raw printing first, falls back to PDF.
 * @param {object} receiptData  Receipt data object (used for PDF fallback)
 * @param {string} [printerName]  Printer name for qz-tray
 * @returns {{ ok: boolean, method?: 'qz'|'pdf', error?: string }}
 */
export async function printReceipt(receiptData, printerName) {
  // Try qz-tray first if available
  if (isQZReady() || hasQZ()) {
    const name = printerName || getSelectedPrinter()
    if (name && receiptData._rawBuffer) {
      const result = await printRaw(receiptData._rawBuffer, name)
      if (result.ok) return { ok: true, method: 'qz' }
    }
  }

  // Fall back to PDF
  const result = await printPDFFallback(receiptData)
  return { ...result, method: 'pdf' }
}
