/**
 * usbPrint.js — Raw ESC/POS over USB (driverless)
 *
 * Writes ESC/POS bytes directly to the printer's USB bulk-OUT endpoint.
 * No Windows vendor driver required — communicates via libusb (WinUSB on Windows).
 *
 * Windows setup (one-time): If the device isn't detected, run Zadig
 * (https://zadig.akeo.ie), select the printer's USB interface, and install
 * the WinUSB driver for it. Takes < 1 minute, no reboot needed.
 *
 * Uses the `usb` npm package (N-API, works with Electron 41).
 * Native module — must be rebuilt for the target Electron version via
 * electron-builder install-app-deps (run automatically on npm install if
 * postinstall script is present, or via npm run dist:win at build time).
 */
'use strict'

// Known thermal printer vendor IDs — used to surface likely printers in USB list
const THERMAL_VIDS = new Set([
  0x04b8, // Epson
  0x0519, // Star Micronics
  0x154f, // Sewoo
  0x20d1, // Bixolon
  0x1a86, // QinHeng Electronics (CH340 — many Chinese/OEM thermal printers)
  0x0483, // STMicroelectronics (many OEM thermal printers)
  0x0dd4, // Custom America
  0x0a5f, // Zebra Technologies
  0x067b, // Prolific Technology (USB-serial adapters)
  0x0fe6, // ICS Advent
  0x6868, // Rongta / common clone
])

let _usb = null
let _usbLoadError = null
function getUsb() {
  if (_usb !== null) return _usb
  try {
    _usb = require('usb')
  } catch (e) {
    _usbLoadError = e.message
    console.error('[usbPrint] usb package failed to load:', e.message)
    console.error('[usbPrint] stack:', e.stack)
    _usb = false
  }
  return _usb
}

// ── List USB devices that look like thermal printers ──────────────────────────
function listUsbPrinters() {
  const usbLib = getUsb()
  if (!usbLib) return { ok: false, error: 'usb_not_available', detail: _usbLoadError, data: [] }
  if (usbLib.INIT_ERROR) {
    console.error('[usbPrint] libusb INIT_ERROR — USB not initialized on this system')
    return { ok: false, error: 'libusb_init_failed', detail: 'INIT_ERROR flag set — libusb failed to initialize. On Windows, try installing WinUSB driver via Zadig (https://zadig.akeo.ie)', data: [] }
  }
  try {
    const devices = usbLib.getDeviceList()
    const data = devices
      .map(d => {
        const desc   = d.deviceDescriptor
        const vid    = desc.idVendor
        const pid    = desc.idProduct
        const vidHex = vid.toString(16).padStart(4, '0')
        const pidHex = pid.toString(16).padStart(4, '0')
        return {
          vid:     vidHex,
          pid:     pidHex,
          vidNum:  vid,
          pidNum:  pid,
          class:   desc.bDeviceClass,
          label:   `${vidHex}:${pidHex}`,
          // class 7 = USB Printer class; class 0 = defined at interface level (common)
          likely:  desc.bDeviceClass === 7 || desc.bDeviceClass === 0 || THERMAL_VIDS.has(vid),
        }
      })
      .filter(d => d.likely)
    return { ok: true, data }
  } catch (err) {
    console.error('[usbPrint] getDeviceList() threw:', err.message)
    return { ok: false, error: err.message, detail: err.stack, data: [] }
  }
}

// ── Open device and return its bulk-OUT endpoint ──────────────────────────────
function openPrinterEndpoint(device) {
  device.open()

  // Prefer USB Printer class interface (class 7); fall back to first interface
  let iface = null
  for (const i of device.interfaces) {
    if (i.descriptor.bInterfaceClass === 7) { iface = i; break }
  }
  if (!iface) iface = device.interfaces[0]
  if (!iface) { device.close(); throw new Error('No USB interface found on device') }

  // Detach kernel driver if active (Linux/macOS); Windows doesn't have one here
  try { if (iface.isKernelDriverActive()) iface.detachKernelDriver() } catch { /* safe to ignore on Windows */ }

  iface.claim()

  // BULK transfer type = 2
  const endpoint = iface.endpoints.find(e => e.direction === 'out' && e.transferType === 2)
  if (!endpoint) {
    try { iface.release(true, () => {}) } catch {}
    device.close()
    throw new Error('No bulk-OUT endpoint found — is this really a printer?')
  }

  return { device, iface, endpoint }
}

// ── Send raw ESC/POS bytes to a USB printer ───────────────────────────────────
function printRaw(vid, pid, escposData) {
  const usbLib = getUsb()
  if (!usbLib) return Promise.reject(new Error('usb_not_available'))

  const vidNum = typeof vid === 'string' ? parseInt(vid, 16) : vid
  const pidNum = typeof pid === 'string' ? parseInt(pid, 16) : pid

  return new Promise((resolve, reject) => {
    const device = usbLib.findByIds(vidNum, pidNum)
    if (!device) {
      return reject(new Error(
        `USB device ${vid}:${pid} not found — is it plugged in? ` +
        `On Windows, WinUSB driver may be needed (see Zadig).`
      ))
    }

    let endpoint, iface
    try {
      ;({ iface, endpoint } = openPrinterEndpoint(device))
    } catch (err) {
      return reject(err)
    }

    const buf = Buffer.isBuffer(escposData)
      ? escposData
      : Buffer.from(escposData, 'binary')

    endpoint.transfer(buf, err => {
      // Release interface then close device regardless of transfer result
      try { iface.release(true, () => { try { device.close() } catch {} }) } catch { try { device.close() } catch {} }
      if (err) reject(new Error(`USB transfer failed: ${err.message}`))
      else     resolve({ success: true })
    })
  })
}

// ── Cash drawer kick via USB ──────────────────────────────────────────────────
function openDrawerUsb(vid, pid) {
  // ESC p m t1 t2 — kick pin 2, pulse 50ms on / 250ms off
  const cmd = Buffer.from([0x1B, 0x70, 0x00, 0x32, 0xFA])
  return printRaw(vid, pid, cmd)
}

// ── Test page ─────────────────────────────────────────────────────────────────
function testPrint(vid, pid) {
  const ESC = '\x1B', GS = '\x1D', LF = '\x0A'
  const hr  = '\u2500'.repeat(32)   // ─ repeated
  const data = [
    ESC + '@',               // INIT
    ESC + 'a\x01',           // CENTER
    GS  + '!\x11',           // DOUBLE SIZE
    'Terminal X' + LF,
    GS  + '!\x00',           // NORMAL SIZE
    ESC + 'a\x00',           // LEFT
    hr  + LF,
    'Prueba de impresion USB' + LF,
    'USB Print Test OK'      + LF,
    new Date().toLocaleString('es-DO') + LF,
    hr  + LF,
    LF + LF + LF,
    GS + 'V\x41\x03',        // PARTIAL CUT
  ].join('')
  return printRaw(vid, pid, data)
}

module.exports = { listUsbPrinters, printRaw, openDrawerUsb, testPrint }
