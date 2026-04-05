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

function getAutoUpdater() {
  if (!_autoUpdater) {
    _autoUpdater = require('electron-updater').autoUpdater
    _autoUpdater.logger = log
    _autoUpdater.logger.transports.file.level = 'info'
    _autoUpdater.autoDownload = true
    _autoUpdater.autoInstallOnAppQuit = true
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
