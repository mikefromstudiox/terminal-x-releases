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
  masterKey:    process.env.MASTER_LICENSE_KEY ? process.env.MASTER_LICENSE_KEY.toUpperCase().trim() : '',
  supabaseUrl:  process.env.SUPABASE_URL  || '',
  supabaseAnon: process.env.SUPABASE_ANON_KEY || '',
}

// ── Safe storage (OS-encrypted key-value store) ───────────────────────────────
// Uses Electron safeStorage (Windows DPAPI / macOS Keychain / Linux secret-service).
// Falls back to base64 if encryption is unavailable (CI, headless envs).
ipcMain.handle('safe:set', (_, key, val) => {
  const storePath = path.join(app.getPath('userData'), 'safe_store.json')
  let store = {}
  try { store = JSON.parse(fs.readFileSync(storePath, 'utf8')) } catch {}
  if (app.safeStorage.isEncryptionAvailable()) {
    store[key] = { enc: true,  data: app.safeStorage.encryptString(val).toString('base64') }
  } else {
    store[key] = { enc: false, data: Buffer.from(val).toString('base64') }
  }
  try { fs.writeFileSync(storePath, JSON.stringify(store)) } catch {}
  return true
})

ipcMain.handle('safe:get', (_, key) => {
  const storePath = path.join(app.getPath('userData'), 'safe_store.json')
  let store = {}
  try { store = JSON.parse(fs.readFileSync(storePath, 'utf8')) } catch {}
  const entry = store[key]
  if (!entry) return ''
  try {
    if (entry.enc) return app.safeStorage.decryptString(Buffer.from(entry.data, 'base64'))
    return Buffer.from(entry.data, 'base64').toString('utf8')
  } catch { return '' }
})

// Expose non-secret config to the renderer on request.
// ef2Token and supabase keys are NOT sent proactively — only when requested,
// so the renderer can detect stub/offline mode.
ipcMain.handle('env:get', (_, key) => {
  const allowed = { ef2Token: env.ef2Token, supabaseUrl: env.supabaseUrl, supabaseAnon: env.supabaseAnon }
  return allowed[key] ?? null
})

ipcMain.handle('app:version', () => app.getVersion())

// ── WhatsApp (UltraMsg) ───────────────────────────────────────────────────────
ipcMain.handle('whatsapp:send', (_, { to, body }) => {
  return new Promise((resolve, reject) => {
    const instance = db?.getSetting('whatsapp_instance') || ''
    const token    = db?.getSetting('whatsapp_token')    || ''
    if (!instance || !token) return reject(new Error('WhatsApp no configurado'))

    const postData = `token=${encodeURIComponent(token)}&to=${encodeURIComponent(to)}&body=${encodeURIComponent(body)}`
    const req = https.request({
      hostname: 'api.ultramsg.com',
      path:     `/${instance}/messages/chat`,
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, res => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end',  ()    => {
        try { resolve(JSON.parse(raw)) } catch { resolve({ sent: true }) }
      })
    })
    req.on('error', reject)
    req.write(postData)
    req.end()
  })
})

// Send a PDF document via WhatsApp (UltraMsg document endpoint)
ipcMain.handle('whatsapp:sendDocument', (_, { to, base64, filename, caption }) => {
  return new Promise((resolve, reject) => {
    const instance = db?.getSetting('whatsapp_instance') || ''
    const token    = db?.getSetting('whatsapp_token')    || ''
    if (!instance || !token) return reject(new Error('WhatsApp no configurado'))

    const postData = [
      `token=${encodeURIComponent(token)}`,
      `to=${encodeURIComponent(to)}`,
      `filename=${encodeURIComponent(filename || 'recibo.pdf')}`,
      `document=data:application/pdf;base64,${base64}`,
      caption ? `caption=${encodeURIComponent(caption)}` : '',
    ].filter(Boolean).join('&')

    const req = https.request({
      hostname: 'api.ultramsg.com',
      path:     `/${instance}/messages/document`,
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, res => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end',  ()    => {
        try { resolve(JSON.parse(raw)) } catch { resolve({ sent: true }) }
      })
    })
    req.on('error', reject)
    req.write(postData)
    req.end()
  })
})

// ── e-CF offline queue ────────────────────────────────────────────────────────

ipcMain.handle('ecf:queue-count', () => db ? db.ecfQueueCount() : 0)

// ── DGII Direct e-CF ──────────────────────────────────────────────────────────

const certManager = require('./cert-manager')
const xmlBuilder  = require('./xml-builder')
const xmlSigner   = require('./xml-signer')
const dgiiClient  = require('./dgii-client')

// Get current DGII environment from app settings (default: testecf)
function getDgiiEnv() {
  if (!db) return 'testecf'
  return db.getSetting('dgii_environment') || 'testecf'
}

// dgii:submit — full flow: build XML → sign → authenticate → submit → poll status
ipcMain.handle('dgii:submit', async (_, invoiceData) => {
  try {
    const { privateKeyPem, certificatePem } = certManager.loadCert()
    const env = getDgiiEnv()

    // 1. Build the JSON payload (same shape as ecf.js buildEXX())
    // invoiceData.payload is the pre-built ECF payload from the renderer
    const payload = invoiceData.payload
    const eNCF = invoiceData.eNCF
    const tipoECF = invoiceData.tipoECF

    // 2. Build XML from payload
    const xml = xmlBuilder.buildECFXml(payload, eNCF)

    // 3. Sign XML
    const { signedXml, securityCode, signatureDate } = xmlSigner.signXML(xml, privateKeyPem, certificatePem)

    // 4. Authenticate with DGII
    const token = await dgiiClient.authenticate(env, privateKeyPem, certificatePem)

    // 5. Submit to DGII
    const isE32Under250K = tipoECF === '32' && Number(invoiceData.montoTotal) < 250000
    let submitResult

    if (isE32Under250K) {
      // Build and sign RFCE for consumer < 250K
      const rfceXml = xmlBuilder.buildRFCEXml({
        emisor: invoiceData.emisor,
        totales: {
          montoGravadoTotal: invoiceData.totales?.subtotal,
          montoGravadoI1: invoiceData.totales?.subtotal,
          totalITBIS: invoiceData.totales?.itbis,
          totalITBIS1: invoiceData.totales?.itbis,
          montoTotal: invoiceData.totales?.total,
        },
        eNCF,
        tipoIngresos: invoiceData.tipoIngresos || '01',
        tipoPago: invoiceData.tipoPago || '1',
        comprador: invoiceData.comprador,
        fechaEmision: invoiceData.fechaEmision,
        securityCode,
      })
      const signedRFCE = xmlSigner.signXML(rfceXml, privateKeyPem, certificatePem)
      submitResult = await dgiiClient.submitRFCE(signedRFCE.signedXml, token, env)
    } else {
      submitResult = await dgiiClient.submitECF(signedXml, token, env)
    }

    // 6. Poll for status
    const trackId = submitResult.trackId || submitResult.encf || eNCF
    let status = { codigo: 3, estado: 'EN_PROCESO' }
    if (!isE32Under250K && trackId) {
      status = await dgiiClient.pollStatus(trackId, token, env, { maxRetries: 5, delayMs: 1000 })
    } else if (isE32Under250K) {
      // RFCE returns status directly
      status = { codigo: submitResult.codigo === 0 ? 1 : submitResult.codigo, estado: submitResult.estado || 'ACEPTADO' }
    }

    // 7. Build QR URL
    const qrUrl = dgiiClient.buildQRUrl({
      env,
      rncEmisor: invoiceData.emisor?.rnc,
      rncComprador: invoiceData.comprador?.rnc || '',
      eNCF,
      fechaEmision: invoiceData.fechaEmision,
      montoTotal: String(invoiceData.totales?.total || 0),
      fechaFirma: signatureDate,
      codigoSeguridad: securityCode,
      isRFCE: isE32Under250K,
    })

    // 8. Save to ecf_submissions
    const xmlHash = require('crypto').createHash('sha256').update(signedXml).digest('hex').slice(0, 32)
    db.ecfSubmissionAdd({
      encf: eNCF,
      tipoEcf: tipoECF,
      ticketId: invoiceData.ticketId,
      xmlHash,
      trackId,
      dgiiStatus: status.codigo,
      dgiiMessage: status.mensajes?.join('; ') || status.estado,
      securityCode,
      signatureDate,
      environment: env,
    })

    return {
      ok: true,
      data: {
        eNCF,
        status: status.estado || 'ACEPTADO',
        trackId,
        submittedAt: new Date().toISOString(),
        securityCode,
        signatureDate,
        qrLink: qrUrl,
        dgiiCodigo: status.codigo,
      },
    }
  } catch (err) {
    // Queue for retry on network errors
    const isNetwork = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'timeout'].some(
      c => err.message?.includes(c)
    )
    if (isNetwork && invoiceData.payload && invoiceData.eNCF) {
      db.ecfQueueAdd('dgii:submit', invoiceData, '', {
        encf: invoiceData.eNCF,
        tipoEcf: invoiceData.tipoECF,
        environment: getDgiiEnv(),
      })
      return { ok: false, error: err.message, queued: true }
    }
    return { ok: false, error: err.message }
  }
})

// dgii:install-cert — open file dialog, install .p12, return cert info
ipcMain.handle('dgii:install-cert', async (_, { filePath, passphrase } = {}) => {
  try {
    let certPath = filePath
    if (!certPath) {
      const result = await dialog.showOpenDialog({
        title: 'Seleccionar certificado digital (.p12)',
        filters: [{ name: 'Certificado PKCS12', extensions: ['p12', 'pfx'] }],
        properties: ['openFile'],
      })
      if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'Cancelado' }
      certPath = result.filePaths[0]
    }
    const info = certManager.installCert(certPath, passphrase || '')
    return { ok: info.ok, data: info }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// dgii:cert-info — get current certificate info
ipcMain.handle('dgii:cert-info', () => {
  try {
    return { ok: true, data: certManager.getCertInfo() }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// dgii:auth-test — test DGII authentication (seed dance)
ipcMain.handle('dgii:auth-test', async () => {
  try {
    const { privateKeyPem, certificatePem } = certManager.loadCert()
    const env = getDgiiEnv()
    dgiiClient.clearTokenCache()
    const token = await dgiiClient.authenticate(env, privateKeyPem, certificatePem)
    return { ok: true, data: { token: token.substring(0, 20) + '...', env } }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// dgii:check-status — check trackId status
ipcMain.handle('dgii:check-status', async (_, trackId) => {
  try {
    const { privateKeyPem, certificatePem } = certManager.loadCert()
    const env = getDgiiEnv()
    const token = await dgiiClient.authenticate(env, privateKeyPem, certificatePem)
    const result = await dgiiClient.checkStatus(trackId, token, env)
    return { ok: true, data: result }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// dgii:get-env — returns current DGII environment
ipcMain.handle('dgii:get-env', () => getDgiiEnv())

// dgii:generate-test-set — generate test XMLs for certification steps 2-3
ipcMain.handle('dgii:generate-test-set', async (_, step) => {
  try {
    const certData = certManager.loadCert()
    const testGen = require('./test-xml-generator')
    const outputDir = path.join(app.getPath('userData'), 'test-xmls')
    const result = testGen.generateAndSign(step || 2, certData, outputDir)
    // Open folder in explorer
    shell.openPath(result.outputDir)
    return { ok: true, data: { count: result.count, dir: result.outputDir, manifest: result.manifest } }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// dgii:submissions — list recent e-CF submissions
ipcMain.handle('dgii:submissions', (_, limit) => {
  return db ? db.ecfSubmissionGetAll(limit || 50) : []
})

// Updated queue processor — uses DGII direct when xml_signed is present
async function processDgiiQueue() {
  if (!db) return
  const pending = db.ecfQueueGetPending(10)
  for (const item of pending) {
    try {
      if (item.xml_signed) {
        // New DGII direct path
        const { privateKeyPem, certificatePem } = certManager.loadCert()
        const env = item.environment || getDgiiEnv()
        const token = await dgiiClient.authenticate(env, privateKeyPem, certificatePem)
        const result = await dgiiClient.submitECF(item.xml_signed, token, env)
        if (result.trackId) {
          const status = await dgiiClient.pollStatus(result.trackId, token, env, { maxRetries: 3, delayMs: 1000 })
          if (status.codigo === 1 || status.codigo === 4) {
            db.ecfSubmissionUpdate(result.trackId, { dgiiStatus: status.codigo, dgiiMessage: status.estado })
          }
          db.ecfQueueDelete(item.id)
        } else {
          db.ecfQueueIncrAttempts(item.id)
        }
      } else {
        // Legacy ef2.do path
        const { status, json } = await ef2Fetch({
          method: 'POST', path: item.url_path,
          body: JSON.parse(item.body_json), token: item.token,
        })
        if (status >= 200 && status < 300 && json?.success) {
          db.ecfQueueDelete(item.id)
        } else {
          db.ecfQueueIncrAttempts(item.id)
        }
      }
    } catch {
      // Still offline — retry next interval
    }
  }
}

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
  if (typeof key !== 'string' || !env.masterKey) return false
  const match = key.toUpperCase().trim() === env.masterKey
  if (match) console.warn('Master key active — real license not yet applied')
  return match
})

// ── Remote API calls (bypass CORS) ────────────────────────────────────────────
const API_BASE = 'https://terminalxpos.com'

ipcMain.handle('remote:register', async (_, body) => {
  const resp = await fetch(`${API_BASE}/api/panel?action=register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.error || 'Registration failed')
  return data
})

ipcMain.handle('remote:validate', async (_, body) => {
  const resp = await fetch(`${API_BASE}/api/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return resp.json()
})

// ── Database ──────────────────────────────────────────────────────────────────
let db = null
try {
  db = require('./database.js')
} catch (err) {
  console.error('[main] Failed to load database module:', err.message)
}

function createWindow() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../assets/icon.png')

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

  // F12 toggles DevTools only in dev mode
  if (isDev) {
    win.webContents.on('before-input-event', (_, input) => {
      if (input.key === 'F12' && input.type === 'keyDown') win.webContents.toggleDevTools()
    })
  }

  if (isDev) {
    win.webContents.openDevTools()
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  // Init database
  if (db) {
    try {
      const ok = db.init(app.getPath('userData'))
      if (!ok) console.error('[main] DB init returned false:', db.getError?.())
      else console.log('[main] DB initialized at', app.getPath('userData'))
    } catch (err) {
      console.error('[main] DB init failed:', err.message)
    }
  } else {
    console.error('[main] DB module not loaded')
  }
  // Init certificate manager for DGII direct e-CF
  certManager.init(app)
  createWindow()
  // Retry any queued e-CF submissions every 30s (DGII 72h contingency compliance)
  setInterval(processDgiiQueue, 30_000)
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
    if (!db || !db.isReady()) return { ok: false, error: db?.getError?.() || 'Base de datos no disponible' }
    try {
      const data = await fn(...args)
      return { ok: true, data }
    } catch (err) {
      // FK violations: log the exact args so we can see which value failed
      if (err.message?.includes('FOREIGN KEY')) {
        const argSummary = JSON.stringify(args).slice(0, 800)
        console.error(`[ipc:${channel}] FOREIGN KEY constraint failed. Args: ${argSummary}`)
        return { ok: false, error: `FOREIGN KEY constraint failed — channel: ${channel}. Verify washer_id, seller_id, service_id, and cajero_id all exist in their respective tables.` }
      }
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

// ── Empleados (payroll) ──────────────────────────────────────────────────────
handle('empleados:all',       ()              => db.empleadosGetAll())
handle('empleados:all-admin', ()              => db.empleadosGetAllAdmin())
handle('empleados:create',    (data)          => db.empleadoCreate(data))
handle('empleados:update',    ({id,...data})  => db.empleadoUpdate(id, data))
handle('empleados:delete',    ({id})          => { db.empleadoDelete(id); return true })

// ── Payroll runs (paycheck history) ──────────────────────────────────────────
handle('payroll-runs:create',      (data)                => db.payrollRunCreate(data))
handle('payroll-runs:by-empleado', ({empleadoId, limit}) => db.payrollRunsByEmpleado(empleadoId, limit || 100))
handle('payroll-runs:by-period',   ({from, to})          => db.payrollRunsByPeriod(from, to))
handle('payroll-runs:delete',      ({id})                => { db.payrollRunDelete(id); return true })

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
handle('queue:delete',       ({id,deletedBy})         => db.queueDelete(id, deletedBy))

// ── Commissions ───────────────────────────────────────────────────────────────
handle('commissions:byWasher', ({washerId,from,to}) => db.commissionsGetByWasher(washerId, from, to))
handle('commissions:byPeriod', ({from,to})          => db.commissionsGetByPeriod(from, to))
handle('commissions:markPaid', (ids)                => db.commissionsMarkPaid(ids))
handle('sellerCommissions:bySeller', ({sellerId,from,to}) => db.sellerCommissionsBySeller(sellerId, from, to))
handle('sellerCommissions:byPeriod', ({from,to})          => db.sellerCommissionsByPeriod(from, to))
handle('sellerCommissions:markPaid', (ids)                => db.sellerCommissionsMarkPaid(ids))
handle('cajeroCommissions:byCajero', ({cajeroId,from,to}) => db.cajeroCommissionsByCajero(cajeroId, from, to))
handle('cajeroCommissions:byPeriod', ({from,to})          => db.cajeroCommissionsByPeriod(from, to))
handle('cajeroCommissions:markPaid', (ids)                => db.cajeroCommissionsMarkPaid(ids))

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
handle('dgii:606',        ({from,to}) => db.get606Data(from, to))
handle('dgii:607:get',    ({from,to}) => db.getCompras607(from, to))
handle('dgii:607:add',    (data)      => db.addCompra607(data))
handle('dgii:607:delete', ({id})      => db.deleteCompra607(id))

// ── RNC — helpers ─────────────────────────────────────────────────────────────

// Download any URL to a Buffer — handles HTTP redirects
function downloadBuffer(url, onProgress) {
  return new Promise((resolve, reject) => {
    const request = (reqUrl) => {
      https.get(reqUrl, { timeout: 120000 }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return request(res.headers.location)
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
        const total  = parseInt(res.headers['content-length'] || '0', 10)
        const chunks = []
        let  received = 0
        res.on('data', chunk => {
          chunks.push(chunk)
          received += chunk.length
          if (onProgress && total) onProgress(Math.round((received / total) * 100))
        })
        res.on('end',   () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      }).on('error', reject).on('timeout', () => reject(new Error('Timeout descargando')))
    }
    request(url)
  })
}

// Full DGII RNC sync — downloads official ZIP, parses, inserts into SQLite
async function dgiiRncSync(sendProgress) {
  sendProgress({ percent: 2, message: 'Descargando base de datos DGII...' })

  const zipBuffer = await downloadBuffer(
    'https://dgii.gov.do/app/WebApps/Consultas/RNC/DGII_RNC.zip',
    pct => sendProgress({ percent: Math.round(pct * 0.2), message: `Descargando... ${pct}%` })
  )

  sendProgress({ percent: 22, message: 'Descomprimiendo archivo...' })
  const AdmZip = require('adm-zip')
  const zip    = new AdmZip(zipBuffer)
  const entry  = zip.getEntry('DGII_RNC.TXT') || zip.getEntry('DGII_RNC.txt') || zip.getEntries()[0]
  if (!entry) throw new Error('No se encontró DGII_RNC.TXT en el ZIP')

  const content = entry.getData().toString('latin1')  // DGII uses latin1 encoding
  const lines   = content.split('\n').filter(l => l.trim())

  sendProgress({ percent: 28, message: `Importando ${lines.length.toLocaleString()} contribuyentes...` })

  const BATCH = 50000
  const batch = []
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i].split('|').map(s => s.trim())
    batch.push({
      rnc:             c[0]  || '',
      nombre:          c[1]  || '',
      nombre_comercial: c[2] || '',
      actividad:       c[3]  || '',
      estado:          c[10] || 'ACTIVO',   // column index current as of 2026
      regimen:         c[11] || 'NORMAL',
      provincia:       c[8]  || '',
    })
    if (batch.length >= BATCH || i === lines.length - 1) {
      db.rncBulkSync(batch.splice(0))
      const pct = 28 + Math.round((i / lines.length) * 70)
      sendProgress({ percent: pct, message: `Importando... ${(i + 1).toLocaleString()} / ${lines.length.toLocaleString()}` })
    }
  }

  sendProgress({ percent: 100, message: `✅ ${lines.length.toLocaleString()} contribuyentes sincronizados` })
  return lines.length
}

// ── RNC IPC handlers ──────────────────────────────────────────────────────────

ipcMain.handle('rnc:status', () => ({
  count:    db.rncCount(),
  lastSync: db.rncLastSync(),
}))

ipcMain.handle('rnc:sync', async (event) => {
  try {
    const send = data => event.sender.send('rnc:sync-progress', data)
    const count = await dgiiRncSync(send)
    return { ok: true, count }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('rnc:lookup', async (_, { rnc }) => {
  const clean = String(rnc || '').replace(/[-\s]/g, '')
  if (!/^\d{9}$|^\d{11}$/.test(clean)) return { ok: false, error: 'RNC inválido' }

  // 1 — Local DB first (instant, works offline — includes full DGII sync data)
  const local = db.rncLookupLocal(clean)
  if (local) return {
    ok: true,
    nombre:          local.nombre,
    nombreComercial: local.nombre_comercial,
    estado:          local.estado,
    actividad:       local.actividad,
    provincia:       local.provincia,
    fromLocal:       true,
  }

  // 2 — Live fallback via megaplus.com.do (no API key required)
  return new Promise(resolve => {
    const req = https.get(`https://rnc.megaplus.com.do/api/consulta?rnc=${clean}`, { timeout: 8000 }, res => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => {
        try {
          const data = JSON.parse(body)
          const nombre = data?.nombre_razon_social || data?.nombre || ''
          if (nombre) {
            const normalized = {
              nombre:            nombre,
              nombreComercial:   data.nombre_comercial   || '',
              actividadEconomica:data.actividad_economica|| '',
              estado:            data.estado             || 'ACTIVO',
              regimen:           data.regimen_de_pagos   || 'NORMAL',
            }
            db.rncSave(clean, normalized, 'api')
            resolve({ ok: true, nombre, nombreComercial: normalized.nombreComercial, estado: normalized.estado, actividad: normalized.actividadEconomica })
          } else {
            resolve({ ok: false, error: 'RNC no encontrado' })
          }
        } catch {
          resolve({ ok: false, error: 'Respuesta inválida' })
        }
      })
    })
    req.on('error',   ()  => resolve({ ok: false, error: 'Sin conexión' }))
    req.on('timeout', ()  => { req.destroy(); resolve({ ok: false, error: 'Tiempo agotado' }) })
  })
})

// ── Inventory ─────────────────────────────────────────────────────────────────
handle('inventory:all',          ()                              => db.inventoryGetAll())
handle('inventory:create',       (data)                         => db.inventoryCreate(data))
handle('inventory:update',       ({id, ...data})                => { db.inventoryUpdate(id, data); return true })
handle('inventory:delete',       ({id})                         => { db.inventoryDelete(id); return true })
handle('inventory:adjust',       ({id, delta, notes, userId})   => db.inventoryAdjust(id, delta, notes, userId))
handle('inventory:transactions', ({id})                         => db.inventoryTransactions(id))

// ── Backup / Export ───────────────────────────────────────────────────────────
handle('db:exportAll',   ()      => db.exportAll())
handle('db:exportSince', (since) => db.exportSince(since))

// ── Export to Supabase (full dump) ───────────────────────────────────────────
ipcMain.handle('db:exportToSupabase', () => {
  if (!db) return { ok: false, error: 'DB not initialized' }
  try {
    return { ok: true, data: db.exportToSupabase() }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── List system printers ──────────────────────────────────────────────────────
ipcMain.handle('print:list-usb-printers', async () => {
  try {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (!mainWindow) return { ok: false, error: 'no_window_available', data: [] }

    const allPrinters = await mainWindow.webContents.getPrintersAsync()

    const thermalPrinters = allPrinters.filter(p => {
      const n = p.name.toLowerCase()
      return n.includes('thermal') || n.includes('epson')   ||
             n.includes('bixolon') || n.includes('star')    ||
             n.includes('pos')     || n.includes('receipt') ||
             n.includes('xprinter')|| n.includes('rongta')  ||
             n.includes('citizen') || p.status === 0
    })

    const list = thermalPrinters.length > 0 ? thermalPrinters : allPrinters

    return {
      ok: true,
      data: list.map(p => ({
        name:        p.name,
        displayName: p.displayName || p.name,
        description: p.description || '',
        isDefault:   p.isDefault   || false,
        status:      p.status,
      })),
    }
  } catch (err) {
    console.error('getPrintersAsync failed:', err)
    return { ok: false, error: 'printer_list_failed', detail: err.message, data: [] }
  }
})

// ── Print receipt ─────────────────────────────────────────────────────────────
ipcMain.handle('print:receipt', async (_, { data, printerName }) => {
  try {
    let targetPrinter = printerName
    if (!targetPrinter) {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        const printers = await win.webContents.getPrintersAsync().catch(() => [])
        targetPrinter = printers.find(p => p.isDefault)?.name || printers[0]?.name
      }
    }

    if (!targetPrinter) {
      const win = BrowserWindow.getAllWindows()[0]
      return win ? await openHtmlPreview(data) : { success: false, error: 'no_printer' }
    }

    return process.platform === 'win32'
      ? await printWindows(data, targetPrinter)
      : await printUnix(data, targetPrinter)
  } catch (err) {
    if (isDev) console.error('[print:receipt]', err)
    return { success: false, error: String(err.message) }
  }
})

ipcMain.handle('print:open-drawer', async () => {
  // ESC p m t1 t2 kick on pin 2
  const drawerCmd = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA])
  try {
    // Prefer saved printer from settings; fall back to system default
    let targetPrinter
    try { targetPrinter = db?.settingsGet?.()?.printer || undefined } catch {}

    if (!targetPrinter) {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        const printers = await win.webContents.getPrintersAsync().catch(() => [])
        targetPrinter = printers.find(p => p.isDefault)?.name || printers[0]?.name
      }
    }

    if (!targetPrinter) return { success: false, error: 'no_printer' }
    return process.platform === 'win32'
      ? await printWindows(drawerCmd.toString('binary'), targetPrinter)
      : await printUnix(drawerCmd.toString('binary'), targetPrinter)
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ── Drawer kick variant tester ────────────────────────────────────────────────
// Tries multiple ESC/POS drawer-kick sequences with a 2-second gap between each.
// Returns an array of { variant, hex, success, error? } for diagnosis.
ipcMain.handle('print:test-drawer-variants', async (_, printerName) => {
  const VARIANTS = [
    { desc: 'Original (m=0, t1=25, t2=250)',    hex: '1B700019FA' },
    { desc: 'Longer pulse (m=0, t1=50, t2=250)', hex: '1B700032FA' },
    { desc: 'Epson alt (m=0, t1=30, t2=255)',    hex: '1B70001EFF' },
    { desc: 'm=48 decimal pin2 (clone fix)',      hex: '1B703019FA' },
    { desc: 'Pin5 variant (m=1)',                 hex: '1B700119FA' },
  ]

  let targetPrinter = printerName
  if (!targetPrinter) {
    try { targetPrinter = db?.settingsGet?.()?.printer || undefined } catch {}
  }
  if (!targetPrinter) {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      const printers = await win.webContents.getPrintersAsync().catch(() => [])
      targetPrinter = printers.find(p => p.isDefault)?.name || printers[0]?.name
    }
  }
  if (!targetPrinter) return [{ success: false, error: 'no_printer' }]

  const results = []
  for (const v of VARIANTS) {
    const buf = Buffer.from(v.hex, 'hex')
    const result = process.platform === 'win32'
      ? await printWindows(buf.toString('binary'), targetPrinter)
      : await printUnix(buf.toString('binary'), targetPrinter)
    results.push({ variant: v.desc, hex: v.hex, ...result })
    if (!result.success) continue
    // Wait 2 s so the solenoid resets before next attempt
    await new Promise(r => setTimeout(r, 2000))
  }
  return results
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

// ── PDF receipt save ──────────────────────────────────────────────────────────
// Saves a PDF buffer (base64) to userData/receipts/
ipcMain.handle('pdf:save', (_, { filename, base64 }) => {
  try {
    const dir = path.join(app.getPath('userData'), 'receipts')
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, filename)
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
    return { ok: true, filePath }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── Local SQLite backup ───────────────────────────────────────────────────────
// Copies terminal-x.db to userData/backups/, keeps the 7 newest files.
ipcMain.handle('backup:local', () => {
  try {
    const dbPath   = path.join(app.getPath('userData'), 'terminal-x.db')
    if (!fs.existsSync(dbPath)) return { ok: false, error: 'DB not found' }

    const backupDir = path.join(app.getPath('userData'), 'backups')
    fs.mkdirSync(backupDir, { recursive: true })

    const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `backup_${ts}.db`
    const destPath = path.join(backupDir, filename)

    fs.copyFileSync(dbPath, destPath)

    // Prune: keep newest 7
    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.db'))
      .sort()
      .reverse()
    files.slice(7).forEach(f => {
      try { fs.unlinkSync(path.join(backupDir, f)) } catch {}
    })

    return { ok: true, filename, path: destPath }
  } catch (err) {
    return { ok: false, error: err.message }
  }
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
  const ts     = Date.now()
  const tmpBin = path.join(os.tmpdir(), `tx_${ts}.bin`)
  const tmpPs  = path.join(os.tmpdir(), `tx_${ts}.ps1`)

  try {
    fs.writeFileSync(tmpBin, Buffer.from(escposData, 'binary'))
  } catch (e) {
    return { success: false, error: 'bin_write: ' + e.message }
  }

  // Escape for PowerShell single-quoted strings
  const psBin  = tmpBin.replace(/\\/g, '\\\\').replace(/'/g, "''")
  const psName = printerName.replace(/'/g, "''")

  // Uses Windows Spooler API (winspool.Drv) via P/Invoke to send RAW bytes.
  // Works for any installed local printer without requiring printer sharing.
  const psScript = `Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;
public class TxRaw {
    [DllImport("winspool.Drv",CharSet=CharSet.Auto,SetLastError=true)]
    public static extern bool OpenPrinter(string n,out IntPtr h,IntPtr d);
    [DllImport("winspool.Drv",SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.Drv",CharSet=CharSet.Auto,SetLastError=true)]
    public static extern int StartDocPrinter(IntPtr h,int lev,ref Doc1 d);
    [DllImport("winspool.Drv",SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.Drv",SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.Drv",SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.Drv",SetLastError=true)]
    public static extern bool WritePrinter(IntPtr h,IntPtr b,int n,out int w);
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Auto)]
    public struct Doc1{public string pDocName;public string pOutputFile;public string pDatatype;}
}
"@ -Language CSharp
$bytes = [System.IO.File]::ReadAllBytes('${psBin}')
$h = [IntPtr]::Zero
if(-not [TxRaw]::OpenPrinter('${psName}',[ref]$h,[IntPtr]::Zero)){exit 2}
$d = New-Object TxRaw+Doc1
$d.pDocName  = 'TXReceipt'
$d.pDatatype = 'RAW'
[TxRaw]::StartDocPrinter($h,1,[ref]$d) | Out-Null
[TxRaw]::StartPagePrinter($h) | Out-Null
$p = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
[Runtime.InteropServices.Marshal]::Copy($bytes,0,$p,$bytes.Length)
$w = 0; [TxRaw]::WritePrinter($h,$p,$bytes.Length,[ref]$w) | Out-Null
[Runtime.InteropServices.Marshal]::FreeHGlobal($p)
[TxRaw]::EndPagePrinter($h) | Out-Null
[TxRaw]::EndDocPrinter($h) | Out-Null
[TxRaw]::ClosePrinter($h) | Out-Null
exit 0`

  try {
    fs.writeFileSync(tmpPs, psScript, 'utf8')
  } catch (e) {
    fs.unlink(tmpBin, () => {})
    return { success: false, error: 'ps_write: ' + e.message }
  }

  return new Promise((resolve) => {
    require('child_process').exec(
      `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpPs}"`,
      { timeout: 15000 },
      (err, _stdout, stderr) => {
        fs.unlink(tmpBin, () => {})
        fs.unlink(tmpPs, () => {})
        if (err) return resolve({ success: false, error: (stderr || err.message).trim().slice(0, 300) })
        resolve({ success: true })
      }
    )
  })
}
async function openHtmlPreview(escposText) {
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
