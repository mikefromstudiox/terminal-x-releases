/**
 * updater.js — Terminal X Auto-Update (electron-updater)
 *
 * Checks for updates on startup and notifies the renderer.
 * Updates are downloaded in the background and installed on next restart.
 *
 * To use: publish releases on GitHub (configure build.publish in package.json).
 * Set GH_TOKEN env var during CI builds.
 */

const log = require('electron-log')

let _mainWindow  = null
let _autoUpdater = null

// Valid channel values. 'latest' is the electron-builder default channel name
// for stable releases; we accept 'stable' as a human-friendly alias.
const VALID_CHANNELS = new Set(['latest', 'stable', 'beta'])

function normalizeChannel(ch) {
  if (!ch) return 'latest'
  const v = String(ch).toLowerCase().trim()
  if (v === 'stable') return 'latest'
  return VALID_CHANNELS.has(v) ? v : 'latest'
}

// Read the desired update channel from app_settings. Lazy-required to avoid
// a circular init with database.js. Falls back to 'latest' on any error so a
// corrupt DB never prevents stable-channel updates.
function resolveChannel() {
  try {
    const db = require('./database')
    const v = db.getSetting && db.getSetting('update_channel')
    return normalizeChannel(v)
  } catch (e) {
    log.warn('[updater] channel resolve failed, defaulting to latest:', e.message)
    return 'latest'
  }
}

function getAutoUpdater() {
  if (!_autoUpdater) {
    _autoUpdater = require('electron-updater').autoUpdater
    _autoUpdater.logger = log
    _autoUpdater.logger.transports.file.level = 'info'
    _autoUpdater.autoDownload = true
    _autoUpdater.autoInstallOnAppQuit = true
    // R-C3 — allow re-publishing an older build to roll a bad release back.
    // Clients on the broken version will downgrade on the next check.
    _autoUpdater.allowDowngrade = true
    // R-C2 — pin to the channel the client subscribed to. electron-updater
    // will fetch `{channel}.yml` (latest.yml / beta.yml) from the publish
    // provider. Unset = 'latest'.
    const channel = resolveChannel()
    _autoUpdater.channel = channel
    // Only allow pre-release feeds when explicitly on a pre-release channel.
    _autoUpdater.allowPrerelease = (channel !== 'latest')
    log.info(`[updater] channel=${channel} allowDowngrade=true allowPrerelease=${_autoUpdater.allowPrerelease}`)
  }
  return _autoUpdater
}

function initUpdater(mainWindow) {
  const { ipcMain } = require('electron')
  _mainWindow = mainWindow

  // IPC: renderer requests install-and-restart
  ipcMain.handle('updater:install', () => {
    getAutoUpdater().quitAndInstall(false, true)
  })

  // IPC: renderer reads the currently active channel (post-normalisation).
  ipcMain.handle('updater:get-channel', () => {
    return { channel: resolveChannel() }
  })

  // IPC: renderer sets channel. Persists to app_settings and hot-swaps the
  // autoUpdater channel so the next check hits the new feed without a restart.
  // A restart is still recommended to drop any in-flight download from the old
  // feed, which the UI should surface.
  ipcMain.handle('updater:set-channel', (_evt, channel) => {
    const normalized = normalizeChannel(channel)
    try {
      const db = require('./database')
      db.setSetting && db.setSetting('update_channel', normalized)
    } catch (e) {
      return { error: e.message }
    }
    if (_autoUpdater) {
      _autoUpdater.channel = normalized
      _autoUpdater.allowPrerelease = (normalized !== 'latest')
    }
    log.info(`[updater] channel switched to ${normalized}`)
    return { ok: true, channel: normalized }
  })

  // IPC: renderer requests manual update check
  ipcMain.handle('updater:check', async () => {
    if (process.argv.includes('--dev')) return { error: 'dev-mode' }
    try {
      const result = await getAutoUpdater().checkForUpdates()
      return { ok: true, version: result?.updateInfo?.version || null }
    } catch (err) {
      return { error: err.message }
    }
  })

  // Don't check in dev mode
  if (process.argv.includes('--dev')) return

  const autoUpdater = getAutoUpdater()

  function send(event, data) {
    if (_mainWindow && !_mainWindow.isDestroyed()) {
      _mainWindow.webContents.send('updater:' + event, data)
    }
  }

  autoUpdater.on('checking-for-update',  ()    => send('checking'))
  autoUpdater.on('update-not-available', ()    => send('up-to-date'))
  autoUpdater.on('error',                (err) => send('error', err.message))

  autoUpdater.on('update-available', info => {
    send('available', { version: info.version, releaseDate: info.releaseDate })
  })

  autoUpdater.on('download-progress', progress => {
    send('progress', Math.round(progress.percent))
  })

  autoUpdater.on('update-downloaded', info => {
    send('downloaded', { version: info.version })
  })

  // Check on startup (delay 5s to let the app settle)
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000)

  // Re-check every 6 hours
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000)
}

module.exports = { initUpdater }
