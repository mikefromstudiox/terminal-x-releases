/**
 * updater.js — Terminal X Auto-Update (electron-updater)
 *
 * Checks for updates on startup and notifies the renderer.
 * Updates are downloaded in the background and installed on next restart.
 *
 * To use: publish releases on GitHub (configure build.publish in package.json).
 * Set GH_TOKEN env var during CI builds.
 */

const { autoUpdater } = require('electron-updater')
const { ipcMain }     = require('electron')
const log             = require('electron-log')

let _mainWindow = null

// Use electron-log so update events are written to the app log file
autoUpdater.logger         = log
autoUpdater.logger.transports.file.level = 'info'
autoUpdater.autoDownload   = true   // download silently in background
autoUpdater.autoInstallOnAppQuit = true

function initUpdater(mainWindow) {
  _mainWindow = mainWindow

  // Don't check in dev mode
  if (process.argv.includes('--dev')) return

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

// IPC: renderer requests install-and-restart
ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall(false, true)
})

module.exports = { initUpdater }
