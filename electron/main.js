const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron')
const path   = require('path')
const os     = require('os')
const fs     = require('fs')
const crypto = require('crypto')
const https  = require('https')
const { initUpdater } = require('./updater')

// ── Load .env from project root ───────────────────────────────────────────────
// dotenv is a dev-dependency; in packaged builds the env vars must be set at
// build time or via the OS environment — dotenv.config() is a no-op if the
// file doesn't exist, so this is always safe to call.
try {
  require('dotenv').config({ path: path.join(__dirname, '../.env') })
} catch { /* dotenv not available in packaged build — env vars must come from OS */ }

// ── Env-var accessors (with safe fallbacks) ───────────────────────────────────
const env = {
  masterKey:    (process.env.MASTER_LICENSE_KEY || 'TX-MASTER-2026').toUpperCase().trim(),
  ef2Token:     process.env.EF2_TOKEN     || '',
  supabaseUrl:  process.env.SUPABASE_URL  || '',
  supabaseAnon: process.env.SUPABASE_ANON_KEY || '',
}

// Expose non-secret config to the renderer on request.
// ef2Token and supabase keys are NOT sent proactively — only when requested,
// so the renderer can detect stub/offline mode.
ipcMain.handle('env:get', (_, key) => {
  const allowed = { ef2Token: env.ef2Token, supabaseUrl: env.supabaseUrl, supabaseAnon: env.supabaseAnon }
  return allowed[key] ?? null
})

// ── ef2.do HTTP proxy (runs in main process — no CORS, no browser restrictions) ─
// Renderer cannot call ef2.do directly due to Chromium CORS enforcement.
// All ef2.do requests go through this IPC bridge instead.
function ef2Fetch({ method = 'POST', path: urlPath, body, token }) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body || {})
    const headers = {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const req = https.request({
      hostname: 'master.ef2.do',
      port:     443,
      path:     `/api2${urlPath}`,
      method,
      headers,
    }, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(data) })
        } catch {
          resolve({ status: res.statusCode, json: null, raw: data })
        }
      })
    })
    req.on('error', err => reject(err))
    req.write(bodyStr)
    req.end()
  })
}

ipcMain.handle('ef2:fetch', async (_, { method, path: urlPath, body, token }) => {
  // Use token from request, fall back to env, stub if neither is set
  const resolvedToken = token || env.ef2Token
  if (!resolvedToken) {
    return { ok: false, error: 'ef2_token_missing', stub: true }
  }
  try {
    const { status, json, raw } = await ef2Fetch({ method, path: urlPath, body, token: resolvedToken })
    return { ok: true, status, data: json, raw }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development'

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

// ── Master license key ────────────────────────────────────────────────────────
ipcMain.handle('license:is-master', (_, key) => {
  if (typeof key !== 'string') return false
  const match = key.toUpperCase().trim() === env.masterKey
  if (match) console.warn('⚠️  Master key active — real license not yet applied')
  return match
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
    title: 'Terminal X',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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

// ── Admin panel — unified CRUD handlers ───────────────────────────────────────
// Empresa
handle('get-empresa',   ()     => db.empresaGet())
handle('save-empresa',  (data) => { db.empresaSave(data); return true })

// Usuarios
handle('get-usuarios',    ()     => db.usersGetAll())
handle('save-usuario',    (data) => data.id ? db.userUpdate(data.id, data) : db.userCreate(data))
handle('delete-usuario',  ({id}) => { db.userDelete(id); return true })

// Lavadores
handle('get-lavadores',   ()     => db.washersGetAllAdmin())
handle('save-lavador',    (data) => data.id ? db.washerUpdate(data.id, data) : db.washerCreate(data))
handle('delete-lavador',  ({id}) => { db.washerDelete(id); return true })

// Vendedores
handle('get-vendedores',  ()     => db.sellersGetAllAdmin())
handle('save-vendedor',   (data) => data.id ? db.sellerUpdate(data.id, data) : db.sellerCreate(data))
handle('delete-vendedor', ({id}) => { db.sellerDelete(id); return true })

// Servicios
handle('get-servicios',   ()     => db.servicesGetAllAdmin())
handle('save-servicio',   (data) => data.id ? db.serviceUpdate(data.id, data) : db.serviceCreate(data))
handle('delete-servicio', ({id}) => { db.serviceDelete(id); return true })
handle('get-categorias',  ()     => db.categoriasGetAll())

// Secuencias NCF
handle('get-secuencias-ncf',  ()     => db.ncfGetSequences())
handle('save-secuencia-ncf',  (data) => { db.ncfUpdateSequence(data.type, data); return true })

// Configuración
handle('get-configuracion',   ()     => db.settingsGet())
handle('save-configuracion',  (data) => {
  db.settingsUpdate(data)
  // Mirror setup_complete to configuracion table (used by empresaGet first-run check)
  if ('setup_complete' in data) db.configSet('setup_complete', data.setup_complete)
  return true
})

// ── Settings ──────────────────────────────────────────────────────────────────
handle('settings:get',    ()     => db.settingsGet())
handle('settings:update', (obj)  => { db.settingsUpdate(obj); return true })

// ── Auth ──────────────────────────────────────────────────────────────────────
handle('auth:pin',         (pin)  => db.authByPin(pin))
handle('users:all',        ()     => db.usersGetAll())
handle('users:create',     (data) => db.userCreate(data))
handle('users:update',     ({id, ...data}) => db.userUpdate(id, data))

// ── Categorías de Servicio ────────────────────────────────────────────────────
handle('categorias:all',    ()              => db.categoriasGetAll())
handle('categorias:create', (data)          => db.categoriaCreate(data))
handle('categorias:update', ({id,...data})  => db.categoriaUpdate(id, data))
handle('categorias:delete', ({id})          => db.categoriaDelete(id))

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
handle('cuadre:create',  (data)    => db.cuadreCreate(data))
handle('cuadre:history', ()        => db.cuadreGetHistory())
handle('cuadre:list',    (filters) => db.cuadreList(filters || {}))
handle('cuadre:daily',   (date)    => db.cuadreDailySummary(date))

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

ipcMain.handle('print:open-drawer', async () => {
  // ESC p m t1 t2 — kick cash drawer on pin 2
  const drawerCmd = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA])
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    let printers = []
    try { printers = await win.webContents.getPrintersAsync() } catch {}
    const targetPrinter = printers.find(p => p.isDefault)?.name || printers[0]?.name
    if (!targetPrinter) return { success: false, error: 'no_printer' }
    return process.platform === 'win32'
      ? await printWindows(drawerCmd.toString('binary'), targetPrinter)
      : await printUnix(drawerCmd.toString('binary'), targetPrinter)
  } catch (err) {
    return { success: false, error: err.message }
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
