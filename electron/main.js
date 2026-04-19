const { app, BrowserWindow, ipcMain, Menu, shell, dialog, globalShortcut } = require('electron')
const path   = require('path')
const os     = require('os')
const fs     = require('fs')
const crypto = require('crypto')
const https  = require('https')
const { initUpdater } = require('./updater')
const sync = require('./sync')
const guard = require('./auth-guard')

// ── Process-level error handlers (prevent silent crashes) ─────────────────────
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err)
  try {
    const { dialog } = require('electron')
    if (require('electron').app.isReady()) {
      dialog.showErrorBox('Terminal X — Error', `Error inesperado: ${err.message}\n\nLa aplicación continuará funcionando.`)
    }
  } catch {}
})
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason)
})

// ── Load .env from project root ───────────────────────────────────────────────
// dotenv is a dev-dependency; in packaged builds the env vars must be set at
// build time or via the OS environment — dotenv.config() is a no-op if the
// file doesn't exist, so this is always safe to call.
try {
  require('dotenv').config({ path: path.join(__dirname, '../.env') })
} catch { /* dotenv not available in packaged build — env vars must come from OS */ }

// ── Env-var accessors (with safe fallbacks) ───────────────────────────────────
// Anon key is SAFE TO SHIP: it's the public client key, and Supabase RLS
// policies on every table require `business_id IS NOT NULL` so anon writes
// are already constrained per-tenant. Without this fallback, production
// installs have `process.env.SUPABASE_*` empty and sync silently does
// nothing — which is the bug v1.9.12 is fixing.
const HARDCODED_SUPABASE_URL  = 'https://csppjsoirjflumaiipqw.supabase.co'
const HARDCODED_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzcHBqc29pcmpmbHVtYWlpcHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwNTcyMTksImV4cCI6MjA4OTYzMzIxOX0.8rTDuyNJ2FBxju9TR2YFT3PbLkLD0FiedHfKqFJljWk'

const env = {
  masterKey:    process.env.MASTER_LICENSE_KEY ? process.env.MASTER_LICENSE_KEY.toUpperCase().trim() : '',
  supabaseUrl:  process.env.SUPABASE_URL  || HARDCODED_SUPABASE_URL,
  supabaseAnon: process.env.SUPABASE_ANON_KEY || HARDCODED_SUPABASE_ANON,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
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
  try { fs.writeFileSync(storePath, JSON.stringify(store)) } catch (e) { console.error('[safe:set] Write failed:', e.message); return false }
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

ipcMain.handle('app:resetLocalDatabase', () => {
  try {
    // Clear all synced entity + transaction tables so reconnect starts clean.
    // Order: children first (FK deps), then parents.
    const tables = [
      'ticket_item_modificadores', 'kds_events', 'service_modificadores',
      'work_order_items', 'loan_payments', 'pawn_items', 'loan_schedule', 'collections_log',
      'washer_commissions', 'seller_commissions', 'cajero_commissions',
      'credit_payments', 'notas_credito', 'ticket_items', 'queue', 'queue_deletions',
      'cuadre_caja', 'caja_chica', 'inventory_transactions', 'ecf_submissions',
      'adelantos', 'payroll_runs', 'salary_changes', 'activity_log',
      'work_orders', 'appointments', 'loans',
      'tickets', 'mesas', 'modificadores',
      'vehicles', 'service_bays', 'stylist_schedules',
      'services', 'categorias_servicio',
      'washers', 'sellers', 'empleados', 'clients', 'inventory_items',
      'ncf_sequences', 'users', 'businesses',
    ]
    for (const t of tables) {
      try { db?.rawExec?.(`DELETE FROM ${t}`) } catch {}
    }
    // Clear sync cursors so pull starts fresh
    try { db?.rawExec?.("DELETE FROM sync_log") } catch {}
    // Clear business link settings
    try { db?.rawExec?.("DELETE FROM app_settings WHERE key IN ('supabase_business_id','supabase_auth_email','supabase_user_id')") } catch {}
  } catch {}
  return { ok: true }
})

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
  return db.getSetting('dgii_environment') || 'certecf'
}

// dgii:submit — full flow: build XML → sign → authenticate → submit → poll status
ipcMain.handle('dgii:submit', async (_, invoiceData) => {
  try {
    const { privateKeyPem, certificatePem } = certManager.loadCert()
    const dgiiEnv = getDgiiEnv()

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
    const token = await dgiiClient.authenticate(dgiiEnv, privateKeyPem, certificatePem)

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
      submitResult = await dgiiClient.submitRFCE(signedRFCE.signedXml, token, dgiiEnv)
    } else {
      submitResult = await dgiiClient.submitECF(signedXml, token, dgiiEnv)
    }

    // 6. Poll for status
    const trackId = submitResult.trackId || submitResult.encf || eNCF
    let status = { codigo: 3, estado: 'EN_PROCESO' }
    if (!isE32Under250K && trackId) {
      status = await dgiiClient.pollStatus(trackId, token, dgiiEnv, { maxRetries: 5, delayMs: 1000 })
    } else if (isE32Under250K) {
      // RFCE returns status directly
      status = { codigo: submitResult.codigo === 0 ? 1 : submitResult.codigo, estado: submitResult.estado || 'ACEPTADO' }
    }

    // 7. Build QR URL
    const qrUrl = dgiiClient.buildQRUrl({
      env: dgiiEnv,
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
      environment: dgiiEnv,
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

// dgii:void-sequence — ANECF: void unused e-NCF sequence ranges
ipcMain.handle('dgii:void-sequence', async (_, data) => {
  try {
    const { privateKeyPem, certificatePem } = certManager.loadCert()
    const dgiiEnv = getDgiiEnv()

    // data: { rncEmisor, tipoECF, rangoDesde, rangoHasta }
    const rangoDesde = data.rangoDesde
    const rangoHasta = data.rangoHasta

    // Calculate count from range (numeric suffix)
    const numDesde = parseInt(rangoDesde.replace(/[^\d]/g, ''), 10)
    const numHasta = parseInt(rangoHasta.replace(/[^\d]/g, ''), 10)
    const cantidadNCF = numHasta - numDesde + 1

    if (cantidadNCF < 1) throw new Error('Rango inválido: desde debe ser menor o igual a hasta')

    // 1. Build ANECF XML
    const xml = xmlBuilder.buildANECFXml({
      rncEmisor: data.rncEmisor,
      cantidadNCF,
      rangoDesde,
      rangoHasta,
    })

    // 2. Sign XML
    const { signedXml } = xmlSigner.signXML(xml, privateKeyPem, certificatePem)

    // 3. Authenticate with DGII
    const token = await dgiiClient.authenticate(dgiiEnv, privateKeyPem, certificatePem)

    // 4. Submit ANECF
    const result = await dgiiClient.submitANECF(signedXml, token, dgiiEnv)

    return {
      ok: true,
      data: {
        ...result,
        rangoDesde,
        rangoHasta,
        cantidadNCF,
        submittedAt: new Date().toISOString(),
        environment: dgiiEnv,
      },
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// dgii:install-cert — open file dialog, install .p12, return cert info
ipcMain.handle('dgii:install-cert', async (event, { filePath, passphrase } = {}) => {
  try {
    let certPath = filePath
    if (!certPath) {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win, {
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

// dgii:cert-pem — returns PEM-encoded private key + certificate for web signing proxy sync
ipcMain.handle('dgii:cert-pem', () => {
  try {
    const { privateKeyPem, certificatePem, subject, expiry } = certManager.loadCert()
    return { ok: true, data: { privateKeyPem, certificatePem, subject, expiry } }
  } catch {
    return { ok: false }
  }
})

// F17 — dgii:restore-from-pem: rebuild a .p12 from the PEM blobs Supabase
// stashed during a prior validate() round-trip, and write it into userData so
// e-CF signing comes back online immediately after a wipe+reactivate. Called
// by LicenseContext once bizSettings yields both ecf_private_key_pem and
// ecf_certificate_pem AND the local cert is missing.
ipcMain.handle('dgii:restore-from-pem', async (_, { privateKeyPem, certificatePem, password } = {}) => {
  try {
    if (!privateKeyPem || !certificatePem) return { ok: false, error: 'PEM_MISSING' }
    const forge = require('node-forge')
    const fs = require('fs')
    const pathMod = require('path')

    const privateKey = forge.pki.privateKeyFromPem(privateKeyPem)
    const certificate = forge.pki.certificateFromPem(certificatePem)

    const pass = password || 'terminal-x-restored'
    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, [certificate], pass, {
      algorithm: '3des',
    })
    const p12Der = forge.asn1.toDer(p12Asn1).getBytes()
    const p12Buf = Buffer.from(p12Der, 'binary')

    const certDir = pathMod.join(app.getPath('userData'), 'certs')
    if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true })
    const destPath = pathMod.join(certDir, 'dgii-cert.p12')
    fs.writeFileSync(destPath, p12Buf)

    // Also encrypt and store the passphrase via safeStorage (same shape as
    // cert-manager.installCert so loadCert() works without re-install).
    try {
      const { safeStorage } = require('electron')
      const storePath = pathMod.join(app.getPath('userData'), 'safe_store.json')
      let store = {}
      try { store = JSON.parse(fs.readFileSync(storePath, 'utf8')) } catch {}
      if (safeStorage.isEncryptionAvailable()) {
        store['dgii_cert_pass'] = { enc: true, data: safeStorage.encryptString(pass).toString('base64') }
      } else {
        store['dgii_cert_pass'] = { enc: false, data: Buffer.from(pass).toString('base64') }
      }
      fs.writeFileSync(storePath, JSON.stringify(store))
    } catch (e) {
      console.error('[dgii:restore-from-pem] safe_store write:', e.message)
    }

    // Validate that the round-trip works (loadCert must succeed now).
    try {
      const info = certManager.loadCert()
      return { ok: true, data: { subject: info.subject, expiry: info.expiry, serialNumber: info.serialNumber } }
    } catch (e) {
      return { ok: false, error: 'VERIFY_FAILED: ' + e.message }
    }
  } catch (err) {
    console.error('[dgii:restore-from-pem] failed:', err.message)
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

// Queue processor — rebuilds XML with IndicadorEnvioDiferido=1 for deferred submissions
async function processDgiiQueue() {
  if (!db) return
  const pending = db.ecfQueueGetPending(10)
  for (const item of pending) {
    try {
      if (item.body_json && item.encf) {
        // DGII direct path — rebuild XML with IndicadorEnvioDiferido=1, re-sign, submit
        const invoiceData = JSON.parse(item.body_json)
        const { privateKeyPem, certificatePem } = certManager.loadCert()
        const env = item.environment || getDgiiEnv()

        // Inject deferred indicator into the payload IdDoc so XML includes it
        if (invoiceData.payload?.ECF?.Encabezado?.IdDoc) {
          invoiceData.payload.ECF.Encabezado.IdDoc.IndicadorEnvioDiferido = '1'
        }

        // Rebuild and re-sign XML with the deferred indicator
        const xml = xmlBuilder.buildECFXml(invoiceData.payload, item.encf)
        const { signedXml, securityCode, signatureDate } = xmlSigner.signXML(xml, privateKeyPem, certificatePem)

        const token = await dgiiClient.authenticate(env, privateKeyPem, certificatePem)

        const isE32Under250K = item.tipo_ecf === '32' && Number(invoiceData.montoTotal) < 250000
        let submitResult

        if (isE32Under250K) {
          const rfceXml = xmlBuilder.buildRFCEXml({
            emisor: invoiceData.emisor,
            totales: {
              montoGravadoTotal: invoiceData.totales?.subtotal,
              montoGravadoI1: invoiceData.totales?.subtotal,
              totalITBIS: invoiceData.totales?.itbis,
              totalITBIS1: invoiceData.totales?.itbis,
              montoTotal: invoiceData.totales?.total,
            },
            eNCF: item.encf,
            tipoIngresos: invoiceData.tipoIngresos || '01',
            tipoPago: invoiceData.tipoPago || '1',
            comprador: invoiceData.comprador,
            fechaEmision: invoiceData.fechaEmision,
            securityCode,
            indicadorEnvioDiferido: '1',
          })
          const signedRFCE = xmlSigner.signXML(rfceXml, privateKeyPem, certificatePem)
          submitResult = await dgiiClient.submitRFCE(signedRFCE.signedXml, token, env)
        } else {
          submitResult = await dgiiClient.submitECF(signedXml, token, env)
        }

        const trackId = submitResult.trackId || submitResult.encf || item.encf
        let status = { codigo: 3, estado: 'EN_PROCESO' }

        if (!isE32Under250K && trackId) {
          status = await dgiiClient.pollStatus(trackId, token, env, { maxRetries: 3, delayMs: 1000 })
        } else if (isE32Under250K) {
          status = { codigo: submitResult.codigo === 0 ? 1 : submitResult.codigo, estado: submitResult.estado || 'ACEPTADO' }
        }

        if (status.codigo === 1 || status.codigo === 4) {
          const qrUrl = dgiiClient.buildQRUrl({
            env, rncEmisor: invoiceData.emisor?.rnc, rncComprador: invoiceData.comprador?.rnc || '',
            eNCF: item.encf, fechaEmision: invoiceData.fechaEmision,
            montoTotal: String(invoiceData.totales?.total || 0),
            fechaFirma: signatureDate, codigoSeguridad: securityCode, isRFCE: isE32Under250K,
          })
          const xmlHash = require('crypto').createHash('sha256').update(signedXml).digest('hex').slice(0, 32)
          db.ecfSubmissionAdd({
            encf: item.encf, tipoEcf: item.tipo_ecf, ticketId: invoiceData.ticketId,
            xmlHash, trackId, dgiiStatus: status.codigo,
            dgiiMessage: status.mensajes?.join('; ') || status.estado,
            securityCode, signatureDate, environment: env,
          })
        }

        if (status.codigo === 1 || status.codigo === 4 || trackId) {
          db.ecfQueueDelete(item.id)
        } else {
          db.ecfQueueIncrAttempts(item.id)
        }
      } else if (item.xml_signed) {
        // Legacy pre-signed XML path (no deferred indicator rebuild possible)
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
    } catch (e) {
      console.error('[ecf-queue] Item', item.id, 'failed:', e.message)
      try { db.ecfQueueIncrAttempts(item.id) } catch {}
      // Alert on items approaching DGII 72h contingency limit (attempts > 100 ~ 50min at 30s interval)
      if ((item.attempts || 0) >= 100) {
        console.error('[ecf-queue] CRITICAL: Item', item.id, 'has', item.attempts, 'failed attempts — risk of exceeding DGII 72h contingency window')
      }
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

// ── License cache status (for Diagnosticar Red panel) ───────────────────────
// Renderer owns the real license cache (localStorage). Main reports the
// hwid.json file mtime as a proxy for "last touched by license flow" so the
// diagnostic panel can render a meaningful timestamp even if localStorage was
// wiped. Renderer merges this with its own localStorage values.
ipcMain.handle('license:status', () => {
  try {
    const hwidFile = path.join(app.getPath('userData'), 'hwid.json')
    if (!fs.existsSync(hwidFile)) {
      return { hasHwid: false, lastValidated: null, expiresAt: null, inGrace: false }
    }
    const stat = fs.statSync(hwidFile)
    return {
      hasHwid:       true,
      lastValidated: stat.mtime.toISOString(),
      expiresAt:     null,  // renderer reads real value from localStorage cache
      inGrace:       false, // renderer computes this from localStorage cache
    }
  } catch (e) {
    return { hasHwid: false, lastValidated: null, expiresAt: null, inGrace: false, error: String(e?.message || e) }
  }
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
    frame: false,
    fullscreen: !isDev,
    kiosk: !isDev,
    autoHideMenuBar: true,
    closable: true,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    backgroundColor: '#0f172a',
    show: false,
  })

  // Hidden menu to enable Ctrl+C/V/X/A keyboard shortcuts without visible menu bar
  if (!isDev) {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '', submenu: [
        { role: 'undo', visible: false }, { role: 'redo', visible: false },
        { role: 'cut', visible: false }, { role: 'copy', visible: false },
        { role: 'paste', visible: false }, { role: 'selectAll', visible: false },
      ]},
    ]))
  }
  win.once('ready-to-show', () => {
    win.show()
    if (!isDev) {
      win.setKiosk(true)
      win.setFullScreen(true)
    }
    initUpdater(win)
  })

  // Block window close — only ESC confirmation can quit
  win.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault()
      promptExit(win)
    }
  })

  // ESC key → confirm exit popup (intercept before renderer)
  win.webContents.on('before-input-event', (_, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      promptExit(win)
    }
    // F12 always toggles DevTools — needed for live diagnostics on production installs.
    if (input.key === 'F12' && input.type === 'keyDown') {
      win.webContents.toggleDevTools()
    }
  })

  if (isDev) {
    win.webContents.openDevTools()
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// Exit confirmation dialog — only way out of kiosk mode
let exitPromptOpen = false
function promptExit(win) {
  if (exitPromptOpen) return
  exitPromptOpen = true
  const choice = dialog.showMessageBoxSync(win, {
    type: 'question',
    buttons: ['Cancelar', 'Salir'],
    defaultId: 0,
    cancelId: 0,
    title: 'Salir de Terminal X',
    message: '¿Está seguro que desea salir?',
    detail: 'Se cerrará la aplicación.',
    noLink: true,
  })
  exitPromptOpen = false
  if (choice === 1) {
    app.isQuiting = true
    try { globalShortcut.unregisterAll() } catch {}
    try { if (win && !win.isDestroyed()) { win.setKiosk(false); win.setClosable(true); win.destroy() } } catch {}
    app.exit(0)
  }
}

app.whenReady().then(async () => {
  // Clear renderer cache when app version changes (prevents stale UI after update)
  const versionPath = path.join(app.getPath('userData'), '.last-version')
  const currentVersion = app.getVersion()
  let lastVersion = ''
  try { lastVersion = fs.readFileSync(versionPath, 'utf8').trim() } catch {}
  if (lastVersion !== currentVersion) {
    try { await require('electron').session.defaultSession.clearCache() } catch {}
    try { fs.writeFileSync(versionPath, currentVersion) } catch {}
  }

  // Init database
  if (db) {
    try {
      const ok = db.init(app.getPath('userData'))
      if (!ok) console.error('[main] DB init returned false:', db.getError?.())
      else console.log('[main] DB initialized at', app.getPath('userData'))
      // v2.3 — stamp HWID into app_settings so database.js (no electron dep)
      // can read it inside ticketCreate for multi-POS block consumption.
      try {
        const hwid = getHardwareId()
        if (hwid && db.rawPrepare) {
          db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('hwid',?)").run(hwid)
        }
      } catch (e) { console.warn('[main] hwid stamp failed:', e.message) }
      // Prestamos — recompute mora at startup so dashboard numbers are fresh.
      try { const ids = db.loansComputeMora?.(); if (ids?.length) console.log(`[main] mora recomputed for ${ids.length} loans`) } catch (e) { console.warn('[main] computeMora failed:', e.message) }
      // Daily cron (12h interval — idempotent, cheap).
      try { setInterval(() => { try { db.loansComputeMora?.() } catch {} }, 12 * 60 * 60 * 1000) } catch {}
    } catch (err) {
      console.error('[main] DB init failed:', err.message)
    }
  } else {
    console.error('[main] DB module not loaded')
  }
  // Init certificate manager for DGII direct e-CF
  certManager.init(app)
  // Init cloud sync (SQLite → Supabase backup)
  if (db) {
    // Prefer service_role if a dev has it set (bypasses RLS, useful for dev).
    // Otherwise fall back to anon key, which is safe to ship and works with the
    // existing per-tenant RLS policies (`business_id IS NOT NULL`).
    const syncKey = env.supabaseServiceKey || env.supabaseAnon
    sync.init(db, { supabaseUrl: env.supabaseUrl, supabaseKey: syncKey })
    sync.startAutoSync(5 * 60 * 1000) // every 5 min
  }
  createWindow()

  // Block Alt+F4, Ctrl+W, Ctrl+R, Win key combos in kiosk mode
  if (!isDev) {
    const blocked = ['Alt+F4','CommandOrControl+W','CommandOrControl+Q','CommandOrControl+R','CommandOrControl+Shift+R','F11','Super']
    blocked.forEach(k => { try { globalShortcut.register(k, () => {
      const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      if (k === 'Alt+F4') promptExit(w)
    }) } catch {} })
  }

  // Retry any queued e-CF submissions every 30s (DGII 72h contingency compliance)
  setInterval(processDgiiQueue, 30_000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll() } catch {}
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

// F14 — same as `handle` but fires `sync.syncNow()` after a successful
// mutation so the change propagates to Supabase immediately instead of
// waiting up to 5 minutes for the auto-sync tick. During that window a
// concurrent pull could clobber the fresh local write, so every channel
// that writes state goes through `handleMut` rather than `handle`.
function writeErrorLog(channel, err, args) {
  try {
    const logPath = path.join(app.getPath('userData'), 'error.log')
    const line = `[${new Date().toISOString()}] ${channel}: ${err.message}\n  stack: ${err.stack?.split('\n').slice(0, 4).join(' | ')}\n  args: ${JSON.stringify(args).slice(0, 1500)}\n\n`
    fs.appendFileSync(logPath, line)
  } catch {}
}

function handleMut(channel, fn, opts = {}) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!db || !db.isReady()) return { ok: false, error: db?.getError?.() || 'Base de datos no disponible' }
    // ── Server-side role guard (auth-guard.js) ───────────────────────────────
    // If a `requires` predicate is supplied, it returns null to allow or a
    // string reason to deny. Denials log `permission_denied` to activity_log
    // so the owner sees them in the Actividad feed.
    if (typeof opts.requires === 'function') {
      try {
        const actor = db.getActiveUser?.() || null
        const reason = opts.requires({ actor, args, db, channel })
        if (reason) {
          try {
            const ctx = (typeof opts.targetCtx === 'function') ? opts.targetCtx({ args, db }) : {}
            guard.logDenied(db, { actor, attempted_op: channel, reason, ...ctx })
          } catch {}
          return { ok: false, error: reason }
        }
      } catch (e) {
        console.error(`[guard:${channel}]`, e.message)
        return { ok: false, error: 'Error de autorización' }
      }
    }
    try {
      const data = await fn(...args)
      try { sync.syncNow?.() } catch {}
      return { ok: true, data }
    } catch (err) {
      writeErrorLog(channel, err, args)
      if (err.message?.includes('FOREIGN KEY')) {
        const argSummary = JSON.stringify(args).slice(0, 800)
        console.error(`[ipc:${channel}] FOREIGN KEY constraint failed. Args: ${argSummary}`)
        return { ok: false, error: `FOREIGN KEY constraint failed — channel: ${channel}. Verify washer_id, seller_id, service_id, and cajero_id all exist in their respective tables.` }
      }
      console.error(`[ipc:${channel}]`, err.message)
      // Pop a native dialog for critical ticket/queue failures so the cashier
      // sees them even if the in-app toast is covered by a modal.
      if (channel === 'tickets:create' || channel === 'ticket:void') {
        try {
          const w = BrowserWindow.getAllWindows()[0]
          dialog.showErrorBox(`Terminal X — Error en ${channel}`, `${err.message}\n\n(Guardado en error.log)`)
        } catch {}
      }
      return { ok: false, error: err.message }
    }
  })
}

// ── Admin panel — unified CRUD handlers ───────────────────────────────────────
// Empresa
handle('get-empresa',   ()     => db.empresaGet())
handleMut('save-empresa',  (data) => { db.empresaSave(data); return true }, {
  // v2.3.12 — allow during FirstTimeSetup bootstrap. The reconnect wizard
  // authenticates via Supabase Auth and then needs to seed the local
  // empresa BEFORE any local user exists. If there's no actor, we're
  // guaranteed to be in the bootstrap path (every other call site happens
  // after a login). Once an actor exists, require owner as before.
  requires: ({ actor }) => actor ? guard.guardOwnerOnly(db, actor, null, 'save-empresa') : null,
})

// Usuarios
handle('get-usuarios',    ()     => db.usersGetAll())
handleMut('save-usuario',    (data) => data.id ? db.userUpdate(data.id, data) : db.userCreate(data), {
  requires: ({ actor, args }) => {
    const data = args[0] || {}
    return data.id
      ? guard.guardUserUpdate(db, actor, data)
      : guard.guardUserCreate(db, actor, data)
  },
  targetCtx: ({ args }) => args[0]?.id ? guard.userTargetCtx(db, args[0].id) : { target_type: 'user' },
})
handleMut('delete-usuario',  ({id}) => { db.userDelete(id); return true }, {
  requires: ({ actor, args }) => guard.guardUserDelete(db, actor, args[0] || {}),
  targetCtx: ({ args }) => guard.userTargetCtx(db, args[0]?.id),
})

// Lavadores
handle('get-lavadores',   ()     => db.washersGetAllAdmin())
handleMut('save-lavador',    (data) => data.id ? db.washerUpdate(data.id, data) : db.washerCreate(data))
handleMut('delete-lavador',  ({id}) => { db.washerDelete(id); return true })

// Vendedores
handle('get-vendedores',  ()     => db.sellersGetAllAdmin())
handleMut('save-vendedor',   (data) => data.id ? db.sellerUpdate(data.id, data) : db.sellerCreate(data))
handleMut('delete-vendedor', ({id}) => { db.sellerDelete(id); return true })

// Servicios
handle('get-servicios',   ()     => db.servicesGetAllAdmin())
handleMut('save-servicio',   (data) => data.id ? db.serviceUpdate(data.id, data) : db.serviceCreate(data), {
  requires: ({ actor }) => guard.guardOwnerOrManager(db, actor, null, 'save-servicio'),
  targetCtx: ({ args }) => args[0]?.id ? guard.serviceTargetCtx(db, args[0].id) : { target_type: 'service' },
})
handleMut('delete-servicio', ({id}) => { db.serviceDelete(id); return true }, {
  requires: ({ actor }) => guard.guardOwnerOrManager(db, actor, null, 'delete-servicio'),
  targetCtx: ({ args }) => guard.serviceTargetCtx(db, args[0]?.id),
})
handle('get-categorias',  ()     => db.categoriasGetAll())

// Secuencias NCF
handle('get-secuencias-ncf',  ()     => db.ncfGetSequences())
handleMut('save-secuencia-ncf',  (data) => { db.ncfUpdateSequence(data.type, data); return true })

// Configuración
handle('get-configuracion',   ()     => db.settingsGet())
handleMut('save-configuracion',  (data) => {
  db.settingsUpdate(data)
  // Mirror setup_complete to configuracion table (used by empresaGet first-run check)
  if ('setup_complete' in data) db.configSet('setup_complete', data.setup_complete)
  return true
})

// ── Settings ──────────────────────────────────────────────────────────────────
handle('settings:get',    ()     => db.settingsGet())
handleMut('settings:update', (obj)  => { db.settingsUpdate(obj); return true })

// ── Cloud Sync ───────────────────────────────────────────────────────────────
handle('sync:status', () => sync.getStatus())
handle('sync:now',    async () => { await sync.syncNow(); return sync.getStatus() })
handle('sync:pull',   async () => { return sync.pullNow() })

// ── Multi-POS: block allocation status + manual refill (v2.3) ───────────────
handle('blocks:status',  () => sync.blocksStatus())
handle('blocks:refill',  async () => {
  const res = await sync.ensureBlocks()
  return { ...res, status: sync.blocksStatus() }
})
handle('blocks:list',    () => {
  try {
    const bizId = (db.settingsGet?.() || {}).supabase_business_id || null
    return {
      ncf: db.ncfBlocksListLocal ? db.ncfBlocksListLocal({}) : [],
      doc: db.docNumberBlocksListLocal ? db.docNumberBlocksListLocal({}) : [],
      bizId,
    }
  } catch (e) { return { ncf: [], doc: [], error: e.message } }
})

// ── Multi-POS: inventory oversells ───────────────────────────────────────────
handle('oversells:list',    ({ unresolvedOnly } = {}) => db.oversellList?.({ unresolvedOnly }) || [])
handle('oversells:count',   () => db.oversellUnresolvedCount?.() || 0)
handleMut('oversells:resolve', async ({ id, supabase_id, resolution_type, notes, resolved_by }) => {
  // Accept either the local id or supabase_id — UI may pass either.
  let sid = supabase_id
  if (!sid && id) {
    try {
      const row = db.rawPrepare('SELECT supabase_id FROM inventory_oversells WHERE id=?').get(id)
      sid = row?.supabase_id
    } catch {}
  }
  if (!sid) return { ok: false, error: 'missing supabase_id' }
  return await sync.resolveOversellRemote({ supabase_id: sid, resolution_type, notes, resolved_by })
})

// ── Auth ──────────────────────────────────────────────────────────────────────
handle('auth:pin',         (pin)  => db.authByPin(pin))
handle('users:all',        ()     => db.usersGetAll())
handleMut('users:create',     (data)          => db.userCreate(data), {
  requires: ({ actor, args }) => guard.guardUserCreate(db, actor, args[0] || {}),
  targetCtx: () => ({ target_type: 'user' }),
})
handleMut('users:update',     ({id, ...data}) => db.userUpdate(id, data), {
  requires: ({ actor, args }) => guard.guardUserUpdate(db, actor, args[0] || {}),
  targetCtx: ({ args }) => guard.userTargetCtx(db, args[0]?.id),
})
handleMut('users:delete',     ({id})          => db.userDelete(id), {
  requires: ({ actor, args }) => guard.guardUserDelete(db, actor, args[0] || {}),
  targetCtx: ({ args }) => guard.userTargetCtx(db, args[0]?.id),
})
handleMut('users:delete-hard',({id})          => db.userDeleteHard(id), {
  requires: ({ actor, args }) => {
    const r = guard.guardOwnerOnly(db, actor, null, 'users:delete-hard')
    if (r) return r
    if (actor?.id === args[0]?.id) return 'No puedes eliminar tu propia cuenta'
    return null
  },
  targetCtx: ({ args }) => guard.userTargetCtx(db, args[0]?.id),
})

// ── Activity log (owner audit feed) ───────────────────────────────────────────
// v2.2.1 — route silent activity_log failures into error.log so we never
// swallow audit-feed breakage again (root cause of the 0-rows incident).
try { db.setActivityErrorSink?.((channel, err, args) => writeErrorLog(channel, err, args)) } catch {}
try { sync.setErrorLogSink?.((channel, err, args) => writeErrorLog(channel, err, args)) } catch {}
handle('activity:set-actor', (user) => { db.setActiveUser(user); return true })
handle('activity:list',      (args) => db.activityLogList(args || {}))
handleMut('activity:record',    (evt)  => { db.activityLogRecord(evt || {}); return true })
// permission_denied — renderer logs every role-gated action rejection so the
// owner sees attempted escalations in the audit feed.
handleMut('activity:permission-denied', ({ action, requiredRole, currentRole, reason } = {}) => {
  db.activityLogRecord({
    event_type: 'permission_denied',
    severity: 'warn',
    target_type: 'action',
    target_id: action || null,
    reason: reason || `required=${requiredRole || '?'} current=${currentRole || '?'}`,
    metadata: { action, requiredRole, currentRole },
  })
  return true
})

// ── Categorías de Servicio ────────────────────────────────────────────────────
handle('categorias:all',    ()              => db.categoriasGetAll())
handleMut('categorias:create', (data)          => db.categoriaCreate(data))
handleMut('categorias:update', ({id,...data})  => db.categoriaUpdate(id, data))
handleMut('categorias:delete', ({id})          => db.categoriaDelete(id))

// ── Services ──────────────────────────────────────────────────────────────────
handle('services:all',       ()              => db.servicesGetAll())
handle('services:all-admin', ()              => db.servicesGetAllAdmin())
handleMut('services:create',    (data)          => db.serviceCreate(data), {
  requires: ({ actor }) => guard.guardOwnerOrManager(db, actor, null, 'services:create'),
  targetCtx: () => ({ target_type: 'service' }),
})
handleMut('services:update',    ({id,...data})  => db.serviceUpdate(id, data), {
  requires: ({ actor }) => guard.guardOwnerOrManager(db, actor, null, 'services:update'),
  targetCtx: ({ args }) => guard.serviceTargetCtx(db, args[0]?.id),
})
handleMut('services:delete',    ({id})          => db.serviceDelete(id), {
  requires: ({ actor }) => guard.guardOwnerOrManager(db, actor, null, 'services:delete'),
  targetCtx: ({ args }) => guard.serviceTargetCtx(db, args[0]?.id),
})

// ── Washers ───────────────────────────────────────────────────────────────────
handle('washers:all',       ()              => db.washersGetAll())
handle('washers:all-admin', ()              => db.washersGetAllAdmin())
handleMut('washers:create',    (data)          => db.washerCreate(data))
handleMut('washers:update',    ({id,...data})  => db.washerUpdate(id, data))

// ── Sellers ───────────────────────────────────────────────────────────────────
handle('sellers:all',       ()              => db.sellersGetAll())
handle('sellers:all-admin', ()              => db.sellersGetAllAdmin())
handleMut('sellers:create',    (data)          => db.sellerCreate(data))
handleMut('sellers:update',    ({id,...data})  => db.sellerUpdate(id, data))

// ── Empleados (payroll) ──────────────────────────────────────────────────────
handle('empleados:all',       ()              => db.empleadosGetAll())
handle('empleados:all-admin', ()              => db.empleadosGetAllAdmin())
handleMut('empleados:create',    (data)          => db.empleadoCreate(data), {
  requires: ({ actor }) => guard.guardOwnerOrManager(db, actor, null, 'empleados:create'),
  targetCtx: () => ({ target_type: 'empleado' }),
})
handleMut('empleados:update',    ({id,...data})  => db.empleadoUpdate(id, data), {
  requires: ({ actor }) => guard.guardOwnerOrManager(db, actor, null, 'empleados:update'),
  targetCtx: ({ args }) => guard.empleadoTargetCtx(db, args[0]?.id),
})
handleMut('empleados:delete',    ({id})          => { db.empleadoDelete(id); return true }, {
  requires: ({ actor }) => guard.guardOwnerOrManager(db, actor, null, 'empleados:delete'),
  targetCtx: ({ args }) => guard.empleadoTargetCtx(db, args[0]?.id),
})
handleMut('empleados:hard-delete', ({id})        => db.empleadoHardDelete(id), {
  requires: ({ actor }) => guard.guardOwnerOnly(db, actor, null, 'empleados:hard-delete'),
  targetCtx: ({ args }) => guard.empleadoTargetCtx(db, args[0]?.id),
})

// ── Restaurant Mode — Mesas ──────────────────────────────────────────────────
handle('mesas:list',       ()                    => db.mesasGetAll())
handleMut('mesas:create',     (data)                => db.mesaCreate(data))
handleMut('mesas:update',     ({id, ...data})       => db.mesaUpdate(id, data))
handleMut('mesas:setStatus',  ({id, status, opts})  => db.mesaSetStatus(id, status, opts || {}))
handleMut('mesas:delete',     ({id})                => { db.mesaDelete(id); return true })

// ── Restaurant Mode — Modificadores ──────────────────────────────────────────
handle('modificadores:list',       ()                                  => db.modificadoresGetAll())
handle('modificadores:listAll',    ()                                  => db.modificadoresGetAllAdmin())
handleMut('modificadores:create',     (data)                              => db.modificadorCreate(data))
handleMut('modificadores:update',     ({id, ...data})                     => db.modificadorUpdate(id, data))
handleMut('modificadores:delete',     ({id})                              => { db.modificadorDelete(id); return true })
handle('modificadores:listForService', ({serviceId})                   => db.modificadoresListForService(serviceId))
handleMut('modificadores:attach',     ({serviceId, modificadorId, isRequired}) => { db.modificadorAttachToService(serviceId, modificadorId, isRequired ? 1 : 0); return true })
handleMut('modificadores:detach',     ({serviceId, modificadorId})        => { db.modificadorDetachFromService(serviceId, modificadorId); return true })

// ── Restaurant Mode — KDS events ─────────────────────────────────────────────
handle('kds:listActive', ()                => db.kdsListActive())
handleMut('kds:fire',       (data)            => db.kdsFire(data))
handleMut('kds:setStatus',  ({id, status})    => db.kdsSetStatus(id, status))

// ── Restaurant Mode — Ticket-item modifier snapshots ─────────────────────────
handle('restaurant:itemModificadores:list',
  ({ticketItemId}) => db.ticketItemModificadoresList(ticketItemId))
handleMut('restaurant:itemModificadores:snapshot',
  ({ticketItemSupabaseId, ticketItemId, selections}) => { db.ticketItemModificadoresSnapshot(ticketItemSupabaseId, ticketItemId, selections); return true })

// ── Payroll runs (paycheck history) ──────────────────────────────────────────
handleMut('payroll-runs:create',      (data)                => db.payrollRunCreate(data))
handleMut('payroll-runs:bulk-create', (runs)                => db.payrollRunsBulkCreate(runs))
handle('payroll-runs:by-empleado', ({empleadoId, limit}) => db.payrollRunsByEmpleado(empleadoId, limit || 100))
handle('payroll-runs:by-period',   ({from, to})          => db.payrollRunsByPeriod(from, to))
handleMut('payroll-runs:delete',      ({id})                => { db.payrollRunDelete(id); return true })

// ── Payroll settings + salary changes ────────────────────────────────────────
handle('payroll-settings:get',     ()                    => db.payrollSettingsGet())
handleMut('payroll-settings:update',  (data)                => { db.payrollSettingsUpdate(data); return true })
handle('salary-changes:by-empleado', ({empleadoId})      => db.salaryChangesByEmpleado(empleadoId))
handle('salary-changes:at-date',    ({empleadoId, date}) => db.salaryAtDate(empleadoId, date))
handleMut('salary-changes:create',     (data)               => db.salaryChangeCreate(data), {
  requires: ({ actor }) => guard.guardOwnerOrManager(db, actor, null, 'salary-changes:create'),
  targetCtx: ({ args }) => ({ target_type: 'salary_change', target_id: args[0]?.empleado_id }),
})
handleMut('salary-changes:delete',     async ({id})         => { const r = db.salaryChangeDelete(id); if (r?.supabase_id) { try { await sync.supabaseDelete?.('salary_changes', r.supabase_id) } catch {} } return true }, {
  requires: ({ actor }) => guard.guardOwnerOrManager(db, actor, null, 'salary-changes:delete'),
  targetCtx: ({ args }) => ({ target_type: 'salary_change', target_id: args[0]?.id }),
})

// ── Adelantos de nomina (salary advances) ────────────────────────────────────
handleMut('adelantos:create',        (data)               => db.adelantoCreate(data))
handle('adelantos:list',          (params)             => db.adelantoList(params))
handle('adelantos:by-empleado',   (empleadoId)         => db.adelantosByEmpleado(empleadoId))
handle('adelantos:pending-total', (empleadoId)         => db.adelantoPendingTotal(empleadoId))
handleMut('adelantos:deduct',        ({id, payrollRunId}) => { db.adelantoDeduct(id, payrollRunId); return true })
handleMut('adelantos:cancel',        ({id})               => { db.adelantoCancel(id); return true })
handle('adelantos:summary',       ()                   => db.adelantoSummary())

// ── Vehicles (auto repair / detailing) ───────────────────────────────────────
handleMut('vehicles:create',  (data)            => db.vehicleCreate(data))
handleMut('vehicles:update',  ({id, ...data})   => db.vehicleUpdate(id, data))
handle('vehicles:list',    (params)          => db.vehicleList(params))
handle('vehicles:byId',    (id)              => db.vehicleGetById(id))
handleMut('vehicles:delete',  ({id})            => { db.vehicleDelete(id); return true })

// ── Service Bays ─────────────────────────────────────────────────────────────
handleMut('serviceBays:create', (data)          => db.serviceBayCreate(data))
handleMut('serviceBays:update', ({id, ...data}) => db.serviceBayUpdate(id, data))
handle('serviceBays:list',   (params)        => db.serviceBayList(params))
handleMut('serviceBays:delete', ({id})          => { db.serviceBayDelete(id); return true })

// ── Work Orders ──────────────────────────────────────────────────────────────
handleMut('workOrders:create', (data)           => db.workOrderCreate(data))
handleMut('workOrders:update', ({id, ...data})  => db.workOrderUpdate(id, data))
handle('workOrders:list',   (params)         => db.workOrderList(params))
handle('workOrders:byId',   (id)             => db.workOrderGetById(id))

// ── Work Order Items ─────────────────────────────────────────────────────────
handleMut('workOrderItems:create',  (data)          => db.workOrderItemCreate(data))
handleMut('workOrderItems:update',  ({id, ...data}) => db.workOrderItemUpdate(id, data))
handleMut('workOrderItems:delete',  ({id})          => { db.workOrderItemDelete(id); return true })
handle('workOrderItems:byOrder', (workOrderId)   => db.workOrderItemsByOrder(workOrderId))

// ── Mechanic-specific WO extensions: inspection / approval / parts order / close
handleMut('workOrders:saveInspection',        ({id, inspection})             => db.workOrderSaveInspection(id, inspection))
handleMut('workOrders:generateApprovalToken', ({id})                         => db.workOrderGenerateApprovalToken(id))
handleMut('workOrders:approveEstimate',       ({id, signature_url})          => db.workOrderApproveEstimate(id, { signature_url }))
handleMut('workOrders:setPartsOrder',         ({id, expected_parts_arrival}) => db.workOrderSetPartsOrder(id, { expected_parts_arrival }))
handleMut('workOrders:close',                 ({id, odometer_out_km})        => db.workOrderClose(id, { odometer_out_km }))

// ── Appointments (salon / barbershop) ────────────────────────────────────────
handleMut('appointments:create', (data)           => db.appointmentCreate(data))
handleMut('appointments:update', ({id, ...data})  => db.appointmentUpdate(id, data))
handle('appointments:list',   (params)         => db.appointmentList(params))
handle('appointments:byId',   (id)             => db.appointmentGetById(id))
handleMut('appointments:delete', ({id})           => { db.appointmentDelete(id); return true })

// ── Stylist Schedules ────────────────────────────────────────────────────────
handleMut('stylistSchedules:create', (data)           => db.stylistScheduleCreate(data))
handleMut('stylistSchedules:update', ({id, ...data})  => db.stylistScheduleUpdate(id, data))
handle('stylistSchedules:list',   (params)         => db.stylistScheduleList(params))
handleMut('stylistSchedules:delete', ({id})           => { db.stylistScheduleDelete(id); return true })

// ── Loans (prestamos) ────────────────────────────────────────────────────────
handleMut('loans:create',  (data)           => db.loanCreate(data))
handleMut('loans:update',  ({id, ...data})  => db.loanUpdate(id, data))
handle('loans:list',    (params)         => db.loanList(params))
handle('loans:byId',    (id)             => db.loanGetById(id))

// ── Loan Payments ────────────────────────────────────────────────────────────
handleMut('loanPayments:create', (data)     => db.loanPaymentCreate(data))
handle('loanPayments:list',   (params)   => db.loanPaymentList(params))

// ── Pawn Items ───────────────────────────────────────────────────────────────
handleMut('pawnItems:create',  (data)           => db.pawnItemCreate(data))
handleMut('pawnItems:update',  ({id, ...data})  => db.pawnItemUpdate(id, data))
handle('pawnItems:list',    (params)         => db.pawnItemList(params))
handleMut('pawnItems:delete',  ({id})           => { db.pawnItemDelete(id); return true })
handleMut('pawnItems:redeem',  ({id})           => db.pawnItemRedeem(id))
handle('pawnItems:byCode',  (code)            => db.pawnItemGetByCode(code))

// ── Loan schedule + mora + collections (prestamos phase 2) ───────────────────
handle('loanSchedule:list',         (params) => db.loanScheduleList(params))
handleMut('loanSchedule:markPaid',  (data)   => db.loanScheduleMarkPaid(data))
handleMut('loans:computeMora',      ()       => db.loansComputeMora())
handle('loans:overdue',             ()       => db.loansOverdueList())
handleMut('collectionsLog:create',  (data)   => db.collectionsLogCreate(data))
handle('collectionsLog:list',       (params) => db.collectionsLogList(params))

// ── Memberships (carwash monthly subscriptions) ─────────────────────────────
handleMut('memberships:create',    (data)          => db.membershipCreate(data))
handleMut('memberships:update',    ({id, ...d})    => db.membershipUpdate(id, d))
handle('memberships:list',      (params)        => db.membershipList(params))
handle('memberships:activeForClient', (clientId) => db.membershipGetActiveForClient(clientId))
handleMut('memberships:consume',   ({id})          => db.membershipConsumeWash(id))
handleMut('memberships:delete',    ({id})          => { db.membershipDelete(id); return true })

// ── Wash Combos (punch-card N-wash bundles) ─────────────────────────────────
handleMut('washCombos:create',  (data)       => db.washComboCreate(data))
handleMut('washCombos:update',  ({id, ...d}) => db.washComboUpdate(id, d))
handle('washCombos:list',    (params)     => db.washComboList(params))
handle('washCombos:activeForClient', (clientId) => db.washComboActiveForClient(clientId))
handleMut('washCombos:consume', ({id})       => db.washComboConsume(id))
handleMut('washCombos:delete',  ({id})       => { db.washComboDelete(id); return true })

// ── Carwash metrics ─────────────────────────────────────────────────────────
handle('queue:waitMetrics',  ()                 => db.queueWaitMetrics())
handle('reports:topWashers', ({ limit } = {})   => db.topWashersThisMonth(limit))
handle('tickets:byClient',   ({ clientId, limit } = {}) => db.ticketsByClient(clientId, limit))

// ── Service vertical: subscriptions / packages / projects / per-client rates ─
handleMut('subscriptions:create',     (data)        => db.subscriptionCreate(data))
handleMut('subscriptions:update',     ({id,...d})   => db.subscriptionUpdate(id, d))
handle('subscriptions:list',       (params)      => db.subscriptionList(params))
handleMut('subscriptions:markBilled', ({id})        => db.subscriptionMarkBilled(id))
handleMut('subscriptions:delete',     ({id})        => { db.subscriptionDelete(id); return true })

handleMut('servicePackages:create', (data)       => db.servicePackageCreate(data))
handleMut('servicePackages:update', ({id,...d})  => db.servicePackageUpdate(id, d))
handle('servicePackages:list',   (params)     => db.servicePackageList(params))
handle('servicePackages:activeForClient', (clientId) => db.servicePackageActiveForClient(clientId))
handleMut('servicePackages:consume',({id})       => db.servicePackageConsume(id))
handleMut('servicePackages:delete', ({id})       => { db.servicePackageDelete(id); return true })

handleMut('projects:create', (data)       => db.projectCreate(data))
handleMut('projects:update', ({id,...d})  => db.projectUpdate(id, d))
handle('projects:list',   (params)     => db.projectList(params))
handle('projects:byId',   (id)         => db.projectGetById(id))

handleMut('clientRates:set',    (data)            => db.clientRateSet(data))
handle('clientRates:list',   (params)          => db.clientRateList(params))
handle('clientRates:get',    (params)          => db.clientRateGet(params))
handleMut('clientRates:delete', ({id})            => { db.clientRateDelete(id); return true })

// v2.5 — per-client inventory item prices
handleMut('clientItemPrices:set',        (data)   => db.clientItemPriceSet(data))
handle('clientItemPrices:list',          (params) => db.clientItemPriceList(params))
handle('clientItemPrices:get',           (params) => db.clientItemPriceGet(params))
handleMut('clientItemPrices:delete',     ({id})   => { db.clientItemPriceDelete(id); return true })
handleMut('clientItemPrices:bulkImport', ({rows}) => db.clientItemPriceBulkImport(rows))

// ── Clients ───────────────────────────────────────────────────────────────────
handle('clients:all',          ()          => db.clientsGetAll())
handle('clients:byId',         (id)        => db.clientGetById(id))
handleMut('clients:create',       (data)      => db.clientCreate(data))
handleMut('clients:update',       ({id,...d}) => db.clientUpdate(id, d))
handleMut('clients:updateBalance', ({id,delta}) => db.clientUpdateBalance(id, delta))
handleMut('clients:addLoyaltyPoints', ({id,delta}) => { db.clientAddLoyaltyPoints(id, delta); return true })
handle('clients:openTickets',  (clientId)  => db.clientGetOpenTickets(clientId))
handleMut('credits:collect',      (data)      => db.collectCredit(data))

// ── Tickets ───────────────────────────────────────────────────────────────────
handle('tickets:all',         (params)    => db.ticketsGetAll(params))
handle('tickets:byId',        (id)        => db.ticketGetById(id))
handleMut('tickets:create',      (data)      => db.ticketCreate(data))
handleMut('tickets:markPaid',    ({id,...d})            => db.ticketMarkPaid(id, d))
handleMut('tickets:void',        ({id,reason,voidById}) => db.ticketVoid(id, reason, voidById))
handle('tickets:byDateRange', ({from,to}) => db.ticketGetByDateRange(from, to))
handleMut('tickets:updateItemPrice', (data) => db.ticketItemUpdatePrice(data))
handle('tickets:priceChanges',    ({ticketId}) => db.priceChangesGetByTicket(ticketId))
handle('tickets:allPriceChanges', ({from,to}) => db.priceChangesGetAll(from, to))

// ── Queue ─────────────────────────────────────────────────────────────────────
handle('queue:active',       ()                        => db.queueGetActive())
handleMut('queue:updateStatus', ({id,status,washerId})   => db.queueUpdateStatus(id, status, washerId))
handleMut('queue:delete',       ({id,deletedBy})         => db.queueDelete(id, deletedBy))

// ── Commissions ───────────────────────────────────────────────────────────────
handle('commissions:byWasher', ({washerId,from,to}) => db.commissionsGetByWasher(washerId, from, to))
handle('commissions:byPeriod', ({from,to})          => db.commissionsGetByPeriod(from, to))
handleMut('commissions:markPaid', (ids)                => db.commissionsMarkPaid(ids))
handleMut('sellerCommissions:create', (data)           => db.sellerCommissionCreate(data))
handleMut('cajeroCommissions:create', (data)           => db.cajeroCommissionCreate(data))
handle('sellerCommissions:bySeller', ({sellerId,from,to}) => db.sellerCommissionsBySeller(sellerId, from, to))
handle('sellerCommissions:byPeriod', ({from,to})          => db.sellerCommissionsByPeriod(from, to))
handleMut('sellerCommissions:markPaid', (ids)                => db.sellerCommissionsMarkPaid(ids))
handle('cajeroCommissions:byCajero', ({cajeroId,from,to}) => db.cajeroCommissionsByCajero(cajeroId, from, to))
handle('cajeroCommissions:byPeriod', ({from,to})          => db.cajeroCommissionsByPeriod(from, to))
handleMut('cajeroCommissions:markPaid', (ids)                => db.cajeroCommissionsMarkPaid(ids))

// ── Cuadre de Caja ────────────────────────────────────────────────────────────
handleMut('cuadre:create',  (data)    => db.cuadreCreate(data))
handle('cuadre:history', ()        => db.cuadreGetHistory())
handle('cuadre:list',    (filters) => db.cuadreList(filters || {}))
handle('cuadre:daily',   (date)    => db.cuadreDailySummary(date))

// ── NCF ───────────────────────────────────────────────────────────────────────
handle('ncf:sequences',        ()            => db.ncfGetSequences())
handleMut('ncf:next',             (type)        => db.ncfGetNext(type))
handleMut('ncf:updateSequence',   ({type,...d}) => db.ncfUpdateSequence(type, d))

// ── Caja Chica ────────────────────────────────────────────────────────────────
handle('cajachica:all',          ()               => db.cajaChicaGetAll())
handleMut('cajachica:create',       (data)           => db.cajaChicaCreate(data))
handleMut('cajachica:updateStatus', ({id,status,by}) => db.cajaChicaUpdateStatus(id, status, by))

// ── Notas de Crédito ──────────────────────────────────────────────────────────
handle('notas:all',    ()     => db.notasGetAll())
handleMut('notas:create', (data) => db.notaCreate(data))

// ── DGII ──────────────────────────────────────────────────────────────────────
handle('dgii:606',        ({from,to}) => db.get606Data(from, to))
handle('dgii:607:get',    ({from,to}) => db.getCompras607(from, to))
handleMut('dgii:607:add',    (data)      => db.addCompra607(data))
handleMut('dgii:607:delete', ({id})      => db.deleteCompra607(id))

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

ipcMain.handle('rnc:status', () => {
  try {
    return { ok: true, count: db.rncCount(), lastSync: db.rncLastSync() }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('rnc:sync', async (event) => {
  try {
    const send = data => { if (!event.sender.isDestroyed()) event.sender.send('rnc:sync-progress', data) }
    const count = await dgiiRncSync(send)
    return { ok: true, count }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('rnc:lookup', async (_, { rnc }) => {
  try {
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
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── Inventory ─────────────────────────────────────────────────────────────────
handle('inventory:all',          ()                              => db.inventoryGetAll())
handleMut('inventory:create',       (data)                         => db.inventoryCreate(data))
handleMut('inventory:update',       ({id, ...data})                => { db.inventoryUpdate(id, data); return true })
handleMut('inventory:bulkUpdate',   ({ids, patch})                 => db.inventoryBulkUpdate(ids || [], patch || {}))
handleMut('inventory:delete',       ({id})                         => { db.inventoryDelete(id); return true })
handleMut('inventory:adjust',       ({id, delta, notes, userId})   => db.inventoryAdjust(id, delta, notes, userId))
handle('inventory:transactions', ({id})                         => db.inventoryTransactions(id))
handle('inventory:lookupSku',    (sku)                          => db.inventoryLookupBySku(sku))
handle('inventory:search',       (query)                        => db.inventorySearch(query))
handle('inventory:lowStockCount', ()                             => db.inventoryLowStockCount())

// ── Conteo Fisico (v2.5) ──────────────────────────────────────────────────────
handleMut('inventoryCount:start',     (args)                          => db.inventoryCountStart(args || {}))
handle   ('inventoryCount:list',      (args)                          => db.inventoryCountList(args || {}))
handle   ('inventoryCount:get',       (id)                            => db.inventoryCountGet(id))
handleMut('inventoryCount:saveItem',  (args)                          => db.inventoryCountSaveItem(args || {}))
handleMut('inventoryCount:complete',  (args)                          => db.inventoryCountComplete(args || {}))
handleMut('inventoryCount:cancel',    ({id})                          => db.inventoryCountCancel(id))
handleMut('inventoryCount:delete',    ({id})                          => db.inventoryCountDelete(id))

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
  // v2.3.24 — default is now the StarSISA-captured pulse with CR LF terminator,
  // which opens DR-clone POS-80 drawers out of the box. Saved variant from
  // Probar Variantes still wins if the operator picked a different one.
  let drawerCmd = Buffer.from(DRAWER_DEFAULT_HEX, 'hex')
  try {
    const savedHex = db?.settingsGet?.()?.drawer_pulse_hex
    if (savedHex && /^[0-9a-fA-F]+$/.test(savedHex) && savedHex.length % 2 === 0) {
      drawerCmd = Buffer.from(savedHex, 'hex')
    }
  } catch {}
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

// ── Drawer kick variants ──────────────────────────────────────────────────────
// Shared variant list used by both the legacy bulk tester and the new
// per-variant tester (one-at-a-time so the cashier can identify which one
// opens the drawer).
const DRAWER_VARIANTS = [
  // v2.3.24 — CONFIRMED WORKING pulse captured from StarSISA's print spool file
  // (00117.SPL) while it physically opened Studio X's drawer. The CR+LF (0D 0A)
  // terminator forces DR-clone firmwares to flush/execute the drawer command
  // instead of queueing it indefinitely. Ship as variant 1 (highest priority)
  // and as the global default fallback for every new install.
  { desc: 'StarSISA captured (pin-2, 30/126ms + CR LF)', hex: '1B70000F3F0D0A' },
  // v2.3.23 — StarSISA reverse-engineered variants from static binary analysis.
  { desc: 'StarSISA pin-5 instant (m=1, t1=0, t2=0)', hex: '1B7001000000' },
  { desc: 'StarSISA pin-2 38/30ms (m=0, t1=38, t2=30)', hex: '1B7000261E' },
  { desc: 'StarSISA pin-2 41/28ms (m=0, t1=41, t2=28)', hex: '1B7000291C' },
  // Standard ESC/POS variants (kept as fallbacks).
  { desc: 'Original (m=0, t1=25, t2=250)',    hex: '1B700019FA' },
  { desc: 'Longer pulse (m=0, t1=50, t2=250)', hex: '1B700032FA' },
  { desc: 'Epson alt (m=0, t1=30, t2=255)',    hex: '1B70001EFF' },
  { desc: 'm=48 decimal pin2 (clone fix)',      hex: '1B703019FA' },
  { desc: 'Pin5 variant (m=1, t1=25, t2=250)',  hex: '1B700119FA' },
]
const DRAWER_DEFAULT_HEX = '1B70000F3F0D0A'

// Fire a SINGLE drawer variant by index. Lets the UI walk through them one at
// a time so the operator can identify which one opens the drawer and save it.
ipcMain.handle('print:fire-drawer-variant', async (_, { index, printerName } = {}) => {
  if (typeof index !== 'number' || index < 0 || index >= DRAWER_VARIANTS.length) {
    return { success: false, error: 'invalid_index', total: DRAWER_VARIANTS.length }
  }
  const v = DRAWER_VARIANTS[index]
  let targetPrinter = printerName
  if (!targetPrinter) { try { targetPrinter = db?.settingsGet?.()?.printer || undefined } catch {} }
  if (!targetPrinter) {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      const printers = await win.webContents.getPrintersAsync().catch(() => [])
      targetPrinter = printers.find(p => p.isDefault)?.name || printers[0]?.name
    }
  }
  if (!targetPrinter) return { success: false, error: 'no_printer', total: DRAWER_VARIANTS.length }
  const buf = Buffer.from(v.hex, 'hex')
  const result = process.platform === 'win32'
    ? await printWindows(buf.toString('binary'), targetPrinter)
    : await printUnix(buf.toString('binary'), targetPrinter)
  return { ...result, index, variant: v.desc, hex: v.hex, total: DRAWER_VARIANTS.length }
})

// ── Drawer kick variant tester (bulk, legacy) ─────────────────────────────────
ipcMain.handle('print:test-drawer-variants', async (_, printerName) => {
  const VARIANTS = DRAWER_VARIANTS

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
