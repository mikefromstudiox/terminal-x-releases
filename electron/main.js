const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron')
const path   = require('path')
const os     = require('os')
const fs     = require('fs')
const crypto = require('crypto')
const { initUpdater } = require('./updater')

const isDev = process.argv.includes('--dev')

// ── Hardware ID (MAC address + hostname fingerprint, stable per machine) ───────
let _hwid = null

function buildHardwareFingerprint() {
  const interfaces = os.networkInterfaces()
  const macs = []
  for (const iface of Object.values(interfaces)) {
    for (const addr of (iface || [])) {
      if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
        macs.push(addr.mac.toLowerCase())
      }
    }
  }
  macs.sort()
  const raw = [os.hostname(), os.platform(), ...macs].join('|')
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

function getHardwareId() {
  if (_hwid) return _hwid
  if (!app.isReady()) return null

  const hwidFile = path.join(app.getPath('userData'), 'hwid.json')

  // Load existing stored ID
  if (fs.existsSync(hwidFile)) {
    try {
      const stored = JSON.parse(fs.readFileSync(hwidFile, 'utf8'))
      _hwid = stored.id
      if (_hwid) return _hwid
    } catch {}
  }

  // Generate: use MAC fingerprint as primary, store it persistently
  _hwid = buildHardwareFingerprint() || crypto.randomUUID().replace(/-/g, '').slice(0, 32)
  fs.writeFileSync(hwidFile, JSON.stringify({
    id:      _hwid,
    created: new Date().toISOString(),
  }))
  return _hwid
}

ipcMain.handle('license:hwid', () => {
  return getHardwareId()
})

// ── Database ──────────────────────────────────────────────────────────────────
let db = null
try {
  db = require('./database.js')
} catch (err) {
  console.error('[main] Failed to load database module:', err.message)
}

function createWindow() {
  const iconPath = isDev
    ? path.join(__dirname, '../public/assets/logo.png')
    : path.join(__dirname, '../dist/assets/logo.png')

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0f172a',
    show: false,
  })

  if (!isDev) Menu.setApplicationMenu(null)
  win.once('ready-to-show', () => {
    win.show()
    initUpdater(win)
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  // Init database
  if (db) {
    try {
      db.init(app.getPath('userData'))
    } catch (err) {
      console.error('[main] DB init failed:', err.message)
    }
  }
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC wrapper helper ────────────────────────────────────────────────────────
// Wraps every handler in try/catch and returns { ok, data } or { ok:false, error }
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!db) return { ok: false, error: 'Base de datos no disponible' }
    try {
      const data = await fn(...args)
      return { ok: true, data }
    } catch (err) {
      console.error(`[ipc:${channel}]`, err.message)
      return { ok: false, error: err.message }
    }
  })
}

// ── Settings ──────────────────────────────────────────────────────────────────
handle('settings:get',    ()     => db.settingsGet())
handle('settings:update', (obj)  => { db.settingsUpdate(obj); return true })

// ── Auth ──────────────────────────────────────────────────────────────────────
handle('auth:pin',         (pin)  => db.authByPin(pin))
handle('users:all',        ()     => db.usersGetAll())
handle('users:create',     (data) => db.userCreate(data))
handle('users:update',     ({id, ...data}) => db.userUpdate(id, data))

// ── Services ──────────────────────────────────────────────────────────────────
handle('services:all',       ()              => db.servicesGetAll())
handle('services:all-admin', ()              => db.servicesGetAllAdmin())
handle('services:create',    (data)          => db.serviceCreate(data))
handle('services:update',    ({id,...data})  => db.serviceUpdate(id, data))

// ── Washers ───────────────────────────────────────────────────────────────────
handle('washers:all',       ()              => db.washersGetAll())
handle('washers:all-admin', ()              => db.washersGetAllAdmin())
handle('washers:create',    (data)          => db.washerCreate(data))
handle('washers:update',    ({id,...data})  => db.washerUpdate(id, data))

// ── Sellers ───────────────────────────────────────────────────────────────────
handle('sellers:all',       ()              => db.sellersGetAll())
handle('sellers:all-admin', ()              => db.sellersGetAllAdmin())
handle('sellers:create',    (data)          => db.sellerCreate(data))
handle('sellers:update',    ({id,...data})  => db.sellerUpdate(id, data))

// ── Clients ───────────────────────────────────────────────────────────────────
handle('clients:all',          ()          => db.clientsGetAll())
handle('clients:byId',         (id)        => db.clientGetById(id))
handle('clients:create',       (data)      => db.clientCreate(data))
handle('clients:update',       ({id,...d}) => db.clientUpdate(id, d))
handle('clients:updateBalance', ({id,delta}) => db.clientUpdateBalance(id, delta))
handle('clients:openTickets',  (clientId)  => db.clientGetOpenTickets(clientId))
handle('credits:collect',      (data)      => db.collectCredit(data))

// ── Tickets ───────────────────────────────────────────────────────────────────
handle('tickets:all',         (params)    => db.ticketsGetAll(params))
handle('tickets:byId',        (id)        => db.ticketGetById(id))
handle('tickets:create',      (data)      => db.ticketCreate(data))
handle('tickets:markPaid',    ({id,...d})            => db.ticketMarkPaid(id, d))
handle('tickets:void',        ({id,reason,voidById}) => db.ticketVoid(id, reason, voidById))
handle('tickets:byDateRange', ({from,to}) => db.ticketGetByDateRange(from, to))

// ── Queue ─────────────────────────────────────────────────────────────────────
handle('queue:active',       ()                        => db.queueGetActive())
handle('queue:updateStatus', ({id,status,washerId})   => db.queueUpdateStatus(id, status, washerId))

// ── Commissions ───────────────────────────────────────────────────────────────
handle('commissions:byWasher', ({washerId,from,to}) => db.commissionsGetByWasher(washerId, from, to))
handle('commissions:byPeriod', ({from,to})          => db.commissionsGetByPeriod(from, to))
handle('commissions:markPaid', (ids)                => db.commissionsMarkPaid(ids))

// ── Cuadre de Caja ────────────────────────────────────────────────────────────
handle('cuadre:create',  (data) => db.cuadreCreate(data))
handle('cuadre:history', ()     => db.cuadreGetHistory())
handle('cuadre:daily',   (date) => db.cuadreDailySummary(date))

// ── NCF ───────────────────────────────────────────────────────────────────────
handle('ncf:sequences',        ()            => db.ncfGetSequences())
handle('ncf:next',             (type)        => db.ncfGetNext(type))
handle('ncf:updateSequence',   ({type,...d}) => db.ncfUpdateSequence(type, d))

// ── Caja Chica ────────────────────────────────────────────────────────────────
handle('cajachica:all',          ()               => db.cajaChicaGetAll())
handle('cajachica:create',       (data)           => db.cajaChicaCreate(data))
handle('cajachica:updateStatus', ({id,status,by}) => db.cajaChicaUpdateStatus(id, status, by))

// ── Notas de Crédito ──────────────────────────────────────────────────────────
handle('notas:all',    ()     => db.notasGetAll())
handle('notas:create', (data) => db.notaCreate(data))

// ── DGII ──────────────────────────────────────────────────────────────────────
handle('dgii:606', ({from,to}) => db.get606Data(from, to))

// ── Backup / Export ───────────────────────────────────────────────────────────
handle('db:exportAll',   ()      => db.exportAll())
handle('db:exportSince', (since) => db.exportSince(since))

// ── Print receipt ─────────────────────────────────────────────────────────────
ipcMain.handle('print:receipt', async (event, { type, data, printerName }) => {
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    let printers = []
    try { printers = await win.webContents.getPrintersAsync() } catch {}

    const targetPrinter = printerName
      || printers.find(p => p.isDefault)?.name
      || printers[0]?.name

    if (!targetPrinter && printers.length === 0) {
      return await openHtmlPreview(data, win)
    }
    return process.platform === 'win32'
      ? await printWindows(data, targetPrinter)
      : await printUnix(data, targetPrinter)
  } catch (err) {
    console.error('[print:receipt]', err)
    return { success: false, error: String(err.message) }
  }
})

ipcMain.handle('print:list-printers', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const printers = await win.webContents.getPrintersAsync()
    return { ok: true, data: printers.map(p => ({ name: p.name, isDefault: p.isDefault })) }
  } catch (err) {
    return { ok: false, data: [], error: String(err.message) }
  }
})

// ── File save dialog ──────────────────────────────────────────────────────────
ipcMain.handle('fs:save-file', async (_, { filename, content, defaultPath }) => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  const result = await dialog.showSaveDialog(win, {
    defaultPath: defaultPath || filename,
    filters: [
      { name: 'Texto', extensions: ['txt'] },
      { name: 'CSV',   extensions: ['csv'] },
      { name: 'XML',   extensions: ['xml'] },
      { name: 'Todos', extensions: ['*']   },
    ],
  })
  if (result.canceled) return { ok: false, canceled: true }
  fs.writeFileSync(result.filePath, content, 'utf8')
  return { ok: true, filePath: result.filePath }
})

// ── Print helpers ─────────────────────────────────────────────────────────────
async function printUnix(escposData, printerName) {
  return new Promise((resolve) => {
    const args = printerName ? ['-d', printerName] : []
    const lp = require('child_process').spawn('lp', args)
    lp.on('error', () => resolve({ success: false, error: 'lp not available' }))
    lp.on('close', code => resolve({ success: code === 0, code }))
    lp.stdin.write(Buffer.from(escposData, 'binary'))
    lp.stdin.end()
  })
}
async function printWindows(escposData, printerName) {
  return new Promise((resolve) => {
    const tmpFile = path.join(os.tmpdir(), `tx_receipt_${Date.now()}.bin`)
    fs.writeFileSync(tmpFile, Buffer.from(escposData, 'binary'))
    const cmd = printerName ? `copy /b "${tmpFile}" "\\\\localhost\\${printerName}"` : `print "${tmpFile}"`
    require('child_process').exec(cmd, (err) => {
      fs.unlink(tmpFile, () => {})
      resolve(err ? { success: false, error: err.message } : { success: true })
    })
  })
}
async function openHtmlPreview(escposText, win) {
  const text = escposText.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g,'').replace(/\x1B[@Eaem!\-]/g,'').replace(/\x1D[!V(]/g,'')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recibo — Terminal X</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#e5e5e5;display:flex;justify-content:center;padding:24px}
.receipt{background:white;width:72mm;padding:8mm;box-shadow:0 4px 24px rgba(0,0,0,.15);white-space:pre-wrap;font-family:monospace;font-size:12px;line-height:1.5}
@media print{body{background:white;padding:0}.receipt{box-shadow:none;width:100%}}</style>
</head><body><div class="receipt">${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
<script>setTimeout(()=>window.print(),400)</script></body></html>`
  const tmpHtml = path.join(os.tmpdir(), `tx_receipt_${Date.now()}.html`)
  fs.writeFileSync(tmpHtml, html, 'utf8')
  await shell.openPath(tmpHtml)
  setTimeout(() => fs.unlink(tmpHtml, () => {}), 30000)
  return { success: true, fallback: 'html-preview' }
}
