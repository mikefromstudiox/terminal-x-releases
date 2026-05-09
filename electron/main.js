const { app, BrowserWindow, ipcMain, Menu, shell, dialog, globalShortcut } = require('electron')
const path   = require('path')
const os     = require('os')
const fs     = require('fs')
const crypto = require('crypto')
const https  = require('https')

// ── Load .env from project root (MUST run before Sentry init so SENTRY_DSN
// picked up from .env is visible) ────────────────────────────────────────────
try {
  require('dotenv').config({ path: path.join(__dirname, '../.env') })
} catch { /* dotenv not available in packaged build — env vars must come from OS */ }

// ── Sentry (error telemetry) — MUST be the first instrumentation so it can
// hook uncaught exceptions BEFORE our own process.on handlers swallow them.
// No-op when SENTRY_DSN is unset (dynamic require is guarded). ───────────────
let pkgVersion = ''
try { pkgVersion = require('../package.json').version } catch {}
const { initSentryMain, captureSentryException: captureMainException } = require('./sentry-init')
initSentryMain({ release: pkgVersion ? `terminal-x@${pkgVersion}` : undefined })

// ── Auto-instrument every ipcMain.handle() so failures POST to /api/panel
// ?action=report_error via reportMainProcessError. Must run BEFORE any module
// that calls ipcMain.handle (updater.js, sync.js, etc.). reportMainProcessError
// is referenced lazily (only invoked at runtime), so its definition can live
// further down without breaking this hoist.
const _origIpcHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, fn) => _origIpcHandle(channel, async (...args) => {
  try { return await fn(...args) }
  catch (err) {
    try { reportMainProcessError(err instanceof Error ? err : new Error(String(err)), 'ipc:' + channel) } catch {}
    throw err
  }
})

const { initUpdater } = require('./updater')
const sync = require('./sync')
const guard = require('./auth-guard')

// ── Process-level error handlers (prevent silent crashes) ─────────────────────
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err)
  try { captureMainException(err) } catch {}
  try {
    const { dialog } = require('electron')
    if (require('electron').app.isReady()) {
      dialog.showErrorBox('Terminal X — Error', `Error inesperado: ${err.message}\n\nLa aplicación continuará funcionando.`)
    }
  } catch {}
})
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason)
  try { captureMainException(reason instanceof Error ? reason : new Error(String(reason))) } catch {}
  reportMainProcessError(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledRejection')
})

// Main-process error reporter — POSTs to /api/panel?action=report_error so
// errors that happen outside the renderer (backup, sync, IPC handlers) are
// visible in admin Errores tab. Mirrors web/main.jsx + packages/ui/main.jsx
// reporters but uses Node's https module + `app_settings` for business_id.
const _mainErrReportRecent = new Set()
function reportMainProcessError(err, source) {
  try {
    const message = String((err && err.message) || err || 'unknown error')
    const sig = source + ':' + message.slice(0, 200)
    if (_mainErrReportRecent.has(sig)) return
    _mainErrReportRecent.add(sig)
    setTimeout(() => _mainErrReportRecent.delete(sig), 60000)
    let businessId = null
    try { businessId = db?.rawPrepare?.("SELECT value FROM app_settings WHERE key='supabase_business_id'").get()?.value || null } catch {}
    const body = JSON.stringify({
      business_id: businessId,
      message,
      stack: (err && err.stack) || null,
      route: 'main-process:' + source,
      app_version: pkgVersion || null,
      severity: 'error',
      metadata: { platform: 'desktop-main', source },
    })
    const req = https.request({
      method: 'POST',
      hostname: 'www.terminalxpos.com',
      path: '/api/panel?action=report_error',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 10000,
    }, () => {})
    req.on('error', () => {})
    req.on('timeout', () => { try { req.destroy() } catch {} })
    req.write(body)
    req.end()
  } catch {}
}
// Expose to other electron/* modules (sync.js, updater.js, db-backup.js) without
// re-importing main.js (would crash on cyclic require). Callers MUST optional-chain:
//   try { global.__txMainReport?.(err, 'src') } catch {}
try { global.__txMainReport = reportMainProcessError } catch {}

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
// Supabase keys are NOT sent proactively — only when requested,
// so the renderer can detect stub/offline mode.
ipcMain.handle('env:get', (_, key) => {
  const allowed = { supabaseUrl: env.supabaseUrl, supabaseAnon: env.supabaseAnon }
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
        let body = {}
        try { body = JSON.parse(raw) || {} } catch {}
        const ok = !body.error && (body.sent === 'true' || body.sent === true || !!body.id || body.message === 'ok')
        // Surface the real UltraMsg failure (e.g. instance suspended for
        // non-payment returns HTTP 404 with `{error:"Your instance has been
        // Stopped..."}`). Previously the renderer just saw a generic
        // "error de red" because the body was discarded on non-2xx.
        const err = body.error || (res.statusCode >= 400 ? `UltraMsg HTTP ${res.statusCode}: ${raw.slice(0,200)}` : null)
        resolve({ ok, error: err, raw: body })
      })
    })
    req.on('error', e => resolve({ ok: false, error: `red: ${e.message}` }))
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
        let body = {}
        try { body = JSON.parse(raw) || {} } catch {}
        const ok = !body.error && (body.sent === 'true' || body.sent === true || !!body.id || body.message === 'ok')
        const err = body.error || (res.statusCode >= 400 ? `UltraMsg HTTP ${res.statusCode}: ${raw.slice(0,200)}` : null)
        resolve({ ok, error: err, raw: body })
      })
    })
    req.on('error', e => resolve({ ok: false, error: `red: ${e.message}` }))
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
// Parent-acceptance gate for Notas de Crédito (E33 / E34) — see
// ecfSubmissionGetByEncf comment in database.js. Returns null if this
// invoice is not an NC (no gate needed) or if the parent has been
// accepted by DGII (dgii_status === 1 ACEPTADO or 4 ACEPTADO_CONDICIONAL).
// Returns a structured error otherwise so callers can surface a clear
// "Esperando aceptación de la factura padre" message to the cashier.
function checkParentAccepted(invoiceData) {
  const tipo = String(invoiceData?.tipoECF || invoiceData?.payload?.ECF?.Encabezado?.IdDoc?.TipoECF || '')
  // Only E33 (Nota de Débito) and E34 (Nota de Crédito) reference a parent.
  if (tipo !== '33' && tipo !== '34') return null
  const parentEncf = invoiceData?.payload?.ECF?.Encabezado?.InformacionReferencia?.NCFModificado
                  || invoiceData?.referencia?.ncfModificado
                  || null
  if (!parentEncf) {
    // NC without a parent reference is malformed — DGII would reject anyway.
    return { ok: false, error: 'parent_missing', message: 'Esta nota requiere referenciar la factura padre (NCFModificado).', code: 'parent_missing' }
  }
  const parent = db?.ecfSubmissionGetByEncf?.(parentEncf)
  if (!parent) {
    return { ok: false, error: 'parent_unknown', code: 'parent_unknown', parentEncf,
             message: `Esperando que la factura ${parentEncf} sea registrada antes de enviar esta nota.` }
  }
  // dgii_status: 1=ACEPTADO, 2=RECHAZADO, 3=EN_PROCESO, 4=ACEPTADO_CONDICIONAL
  if (parent.dgii_status === 1 || parent.dgii_status === 4) return null
  if (parent.dgii_status === 2) {
    return { ok: false, error: 'parent_rejected', code: 'parent_rejected', parentEncf,
             message: `La factura padre ${parentEncf} fue RECHAZADA por DGII. Resuelva esa factura antes de emitir nota de crédito sobre ella.` }
  }
  // EN_PROCESO or unknown — wait for resolution.
  return { ok: false, error: 'parent_pending', code: 'parent_pending', parentEncf,
           message: `La factura padre ${parentEncf} sigue en proceso en DGII. La nota se enviará automáticamente cuando sea aceptada.` }
}

ipcMain.handle('dgii:submit', async (_, invoiceData) => {
  try {
    const { privateKeyPem, certificatePem } = certManager.loadCert()
    const dgiiEnv = getDgiiEnv()

    // 0. Parent-acceptance gate. Block any NC (E33/E34) submission whose
    // parent factura is not yet ACEPTADO on DGII. Without this, a fast
    // void can race the parent's DGII registration and corrupt the 607
    // mensual. Caller (CobrarModal / queue) gets a structured error with
    // the parent eNCF so it can show "esperando…" and retry.
    const gateResult = checkParentAccepted(invoiceData)
    if (gateResult) return gateResult

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
      // Build and sign RFCE for consumer < 250K using the dgii-ecf Signature
      // class (same path tools/cert-step4-gen.js used to pass certification).
      // xml-crypto's enveloped signature produces DGII-incompatible output
      // for RFCE — 'Archivo no válido' rejection on every submission.
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
      const signedRFCE = xmlSigner.signRFCE(rfceXml, privateKeyPem, certificatePem)
      // Persist signed XML to disk so post-mortem diffing against the
      // cert-step4 reference output is possible without re-submitting.
      try {
        const xmlDir = path.join(app.getPath('userData'), 'ecf-xml')
        require('fs').mkdirSync(xmlDir, { recursive: true })
        require('fs').writeFileSync(path.join(xmlDir, `RFCE_${invoiceData.emisor?.rnc || ''}${eNCF}.xml`), signedRFCE.signedXml, 'utf8')
      } catch (e) {
        try { require('electron-log').warn('[dgii:submit] failed to persist signed RFCE:', e.message) } catch {}
      }
      submitResult = await dgiiClient.submitRFCE(signedRFCE.signedXml, token, dgiiEnv, {
        rncEmisor: invoiceData.emisor?.rnc,
        eNCF,
      })
    } else {
      submitResult = await dgiiClient.submitECF(signedXml, token, dgiiEnv)
      // Persist signed ECF XML too — same reasoning.
      try {
        const xmlDir = path.join(app.getPath('userData'), 'ecf-xml')
        require('fs').mkdirSync(xmlDir, { recursive: true })
        require('fs').writeFileSync(path.join(xmlDir, `ECF_${invoiceData.emisor?.rnc || ''}${eNCF}.xml`), signedXml, 'utf8')
      } catch (e) {
        try { require('electron-log').warn('[dgii:submit] failed to persist signed ECF:', e.message) } catch {}
      }
    }

    // 6. Poll for status
    const trackId = submitResult.trackId || submitResult.encf || eNCF
    let status = { codigo: 3, estado: 'EN_PROCESO' }
    if (!isE32Under250K && trackId) {
      status = await dgiiClient.pollStatus(trackId, token, dgiiEnv, { maxRetries: 5, delayMs: 1000 })
    } else if (isE32Under250K) {
      // RFCE returns the verdict synchronously. DGII mensajes are usually
      // an array of OBJECTS (e.g. { codigo, valor }), not strings. Joining
      // them raw yields '[object Object]'. Normalize each entry to a
      // human-readable string before we store them so dgii_message holds
      // the actual reason instead of the object.toString default.
      const normalizeMsg = (m) => {
        if (typeof m === 'string') return m
        if (m && typeof m === 'object') {
          const txt = m.valor || m.mensaje || m.descripcion || m.message || ''
          if (m.codigo && txt) return `[${m.codigo}] ${txt}`
          if (txt) return txt
          return JSON.stringify(m)
        }
        return String(m)
      }
      const rawMsgs = Array.isArray(submitResult.mensajes) ? submitResult.mensajes
                    : submitResult.mensaje ? [submitResult.mensaje]
                    : []
      status = {
        codigo: submitResult.codigo === 0 ? 1 : submitResult.codigo,
        estado: submitResult.estado || 'ACEPTADO',
        mensajes: rawMsgs.map(normalizeMsg),
      }
      // electron-log is the only route to %APPDATA%\Terminal X\logs\main.log.
      // console.log in the main process gets swallowed unless log.initialize()
      // hooks it — which isn't done in main.js.
      try {
        const log = require('electron-log')
        log.info('[dgii:submit] RFCE raw submitResult:', JSON.stringify(submitResult))
        log.info('[dgii:submit] RFCE normalized status:', JSON.stringify(status))
      } catch {}
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

    // DGII audit D-H — on accept (1 or 4), clear any stale deferred flag so a
    // later manual resubmit of this ticket doesn't emit IndicadorEnvioDiferido=1.
    if ((status.codigo === 1 || status.codigo === 4) && invoiceData.ticketId) {
      try { db.ecfClearDeferredForTicket(invoiceData.ticketId) } catch {}
    }

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
      // v2.10.5 — stamp ticket_supabase_id so the cloud-mirrored queue row
      // keeps a stable FK to the ticket (surviving local id re-sequencing).
      let ticketSupabaseId = invoiceData.ticketSupabaseId || null
      if (!ticketSupabaseId && invoiceData.ticketId) {
        try {
          const t = db.rawPrepare?.('SELECT supabase_id FROM tickets WHERE id = ?')?.get(invoiceData.ticketId)
                 || db.prepare?.('SELECT supabase_id FROM tickets WHERE id = ?')?.get?.(invoiceData.ticketId)
          ticketSupabaseId = t?.supabase_id || null
        } catch {}
      }
      db.ecfQueueAdd('dgii:submit', invoiceData, '', {
        encf: invoiceData.eNCF,
        tipoEcf: invoiceData.tipoECF,
        environment: getDgiiEnv(),
        ticketSupabaseId,
      })
      // DGII audit D-H — stamp deferred flag on ticket so XML rebuild in
      // processDgiiQueue emits IndicadorEnvioDiferido=1. Cleared by the
      // reconciler after DGII accept (status 1 or 4).
      if (invoiceData.ticketId) {
        try {
          db.rawPrepare?.('UPDATE tickets SET ecf_indicator_diferido=1, updated_at=datetime(\'now\') WHERE id=?').run?.(invoiceData.ticketId)
          || db.prepare?.('UPDATE tickets SET ecf_indicator_diferido=1, updated_at=datetime(\'now\') WHERE id=?').run?.(invoiceData.ticketId)
        } catch {}
      }
      return { ok: false, error: err.message, queued: true }
    }
    return { ok: false, error: err.message }
  }
})

// dgii:void-sequence — ANECF: void unused e-NCF sequence ranges
ipcMain.handle('dgii:void-sequence', async (_, data) => {
  try {
    // MAC required unless owner (owner can always authorize themselves)
    const actor = db.getActiveUser?.() || null
    if (actor?.role !== 'owner') {
      const check = guard.macStore.consume(data?.mac_jti, 'dgii:void-sequence')
      if (!check) return { ok: false, error: 'Autorización de gerente requerida (o expirada)' }
    }
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
    // v2.14.29 — forward tipoECF. DGII rejects TipoeCF='00' with
    // "Enumeration constraint failed" when tipoECF isn't passed; the
    // builder's default produces '00' from an empty input.
    const xml = xmlBuilder.buildANECFXml({
      rncEmisor: data.rncEmisor,
      cantidadNCF,
      tipoECF: data.tipoECF,
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
ipcMain.handle('dgii:install-cert', async (event, { filePath, passphrase, mac_jti } = {}) => {
  try {
    // MAC required unless owner
    const actor = db.getActiveUser?.() || null
    if (actor?.role !== 'owner') {
      const check = guard.macStore.consume(mac_jti, 'dgii:install-cert')
      if (!check) return { ok: false, error: 'Autorización de gerente requerida (o expirada)' }
    }
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
    const info = certManager.installCert(certPath, passphrase || '', { actor: actor || null })
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

// ── Cert expiry monitoring (v2.11.2) ──────────────────────────────────────
// Proactive 90/60/30-day alerts so clients renew BEFORE the cert dies
// mid-day and e-CF emission blows up. Called on app:ready (post DB init)
// and then every 12h.
//
// Tier mapping (days until cert.expiry):
//   > 90            → 'none'      (no action)
//   61..90          → 'info'      (silent activity_log on transition)
//   31..60          → 'warn'      (activity_log + Sidebar banner)
//   1..30           → 'critical'  (activity_log + startup modal)
//   <= 0            → 'expired'   (blocks new e-CFs — existing path)
//
// Last-notified tier is persisted to local app_settings and mirrored to
// Supabase.cert_expiry_alerts (via sync) so transitions log exactly once.
function computeExpiryTier(daysLeft) {
  if (daysLeft <= 0)  return 'expired'
  if (daysLeft <= 30) return 'critical'
  if (daysLeft <= 60) return 'warn'
  if (daysLeft <= 90) return 'info'
  return 'none'
}

async function checkCertExpiry() {
  try {
    if (!db || !db.isReady?.()) return
    const info = certManager.getCertInfo()
    if (!info || !info.installed || !info.expiry) return
    const expiryMs = new Date(info.expiry).getTime()
    if (!Number.isFinite(expiryMs)) return
    const daysLeft = Math.ceil((expiryMs - Date.now()) / 86_400_000)
    const tier     = computeExpiryTier(daysLeft)
    const serial   = info.serialNumber || ''

    // Read last-notified tier + serial from local app_settings.
    let lastTier = 'none', lastSerial = ''
    try {
      lastTier   = db.rawPrepare("SELECT value FROM app_settings WHERE key='cert_expiry_last_tier'").get()?.value || 'none'
      lastSerial = db.rawPrepare("SELECT value FROM app_settings WHERE key='cert_expiry_last_serial'").get()?.value || ''
    } catch {}

    // Reset if cert serial changed (new cert installed → fresh lifecycle).
    if (serial && lastSerial && serial !== lastSerial) lastTier = 'none'

    // Broadcast latest status to every window so banner/modal can
    // re-render on boot even when there's no transition (the banner is
    // dismissible per session but MUST re-appear on next app start).
    const payload = { installed: true, expiry: info.expiry, serialNumber: serial, subject: info.subject, daysLeft, tier }
    try {
      for (const w of BrowserWindow.getAllWindows()) {
        try { w.webContents.send('cert:expiry-status', payload) } catch {}
      }
    } catch {}

    // No transition → do not log, do not notify.
    if (tier === lastTier) return

    const severity = (tier === 'critical' || tier === 'expired') ? 'critical'
                   : tier === 'warn' ? 'warn' : 'info'
    try {
      db.activityLogRecord?.({
        event_type: 'cert_expiry_alert',
        severity,
        target_type: 'dgii_cert',
        target_id:   serial || null,
        target_name: info.subject || 'DGII e-CF Certificate',
        old_value:   lastTier,
        new_value:   tier,
        amount:      daysLeft,
        reason:      daysLeft <= 0
          ? 'Certificado DGII VENCIDO — e-CF detenido'
          : `Certificado DGII vence en ${daysLeft} dia${daysLeft===1?'':'s'}`,
        metadata:    { expiry: info.expiry, daysLeft, tier, serial },
      })
    } catch (e) { console.warn('[cert-expiry] activity_log failed:', e.message) }

    // Persist new tier locally.
    try {
      db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('cert_expiry_last_tier',?)").run(tier)
      if (serial) db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('cert_expiry_last_serial',?)").run(serial)
      db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('cert_expiry_last_checked_at',?)").run(new Date().toISOString())
    } catch {}

    // Best-effort cloud mirror. Sync module exposes upsertCertExpiryAlert
    // when present; if not (older build), the local tier still suffices.
    try {
      const bizId = db.rawPrepare?.("SELECT value FROM app_settings WHERE key='supabase_business_id'").get()?.value
      if (bizId && sync && typeof sync.upsertCertExpiryAlert === 'function') {
        sync.upsertCertExpiryAlert({
          business_id: bizId, cert_serial: serial, cert_expiry: info.expiry,
          last_tier: tier, last_notified_at: new Date().toISOString(),
        }).catch(() => {})
      }
    } catch {}

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[cert-expiry] tier transition ${lastTier} → ${tier} (${daysLeft}d left)`)
    }
  } catch (e) {
    console.warn('[cert-expiry] check failed:', e.message)
  }
}

// Renderer-initiated check (banner/modal mount → pulls fresh status).
ipcMain.handle('cert:expiry-check', async () => {
  try {
    const info = certManager.getCertInfo()
    if (!info?.installed || !info.expiry) return { ok: true, data: { installed: false } }
    const daysLeft = Math.ceil((new Date(info.expiry).getTime() - Date.now()) / 86_400_000)
    return { ok: true, data: {
      installed: true, expiry: info.expiry, serialNumber: info.serialNumber,
      subject: info.subject, daysLeft, tier: computeExpiryTier(daysLeft),
    } }
  } catch (e) { return { ok: false, error: e.message } }
})

// dgii:cert-pem — returns PEM-encoded private key + certificate for web signing
// proxy sync. ONLY the owner can call this — any other role would be able to
// exfiltrate the DGII signing key, which is catastrophic.
//
// v2.13.0 hardening (audit 2026-04-19):
//   1. Owner re-verified from DB (not from in-memory actor) to defeat
//      activity:set-actor spoofing — same pattern guardMac uses.
//   2. Every successful read writes a CRITICAL activity_log row
//      (`cert_pem_export`) so any unauthorized exfiltration is visible
//      in the Actividad feed within seconds, with full actor context
//      and cert subject as metadata. Failed reads also log (warn).
//   3. We deliberately do NOT require MAC here — bizSync invokes this
//      automatically every license validation cycle and there is no UI
//      surface to scan a card from. The audit trail is the compensating
//      control.
ipcMain.handle('dgii:cert-pem', () => {
  const actor = db.getActiveUser?.() || null
  // Re-verify role from DB (actor object may be spoofed via activity:set-actor).
  let realRole = null
  try { realRole = db.rawPrepare?.('SELECT role FROM users WHERE id=? AND active=1').get?.(actor?.id)?.role || null } catch {}
  const isOwner = actor?.role === 'owner' && realRole === 'owner'
  if (!isOwner) {
    try {
      db.activityLogRecord?.({
        event_type: 'cert_pem_export',
        severity: 'critical',
        actor_user_id: actor?.id || null,
        actor_name:    actor?.name || null,
        actor_role:    actor?.role || realRole || null,
        target_type:   'dgii_cert',
        reason:        'denied: non-owner attempted to read DGII private key',
        metadata:      { claimed_role: actor?.role || null, db_role: realRole },
      })
    } catch {}
    return { ok: false, error: 'Solo el propietario puede leer el certificado' }
  }
  try {
    const { privateKeyPem, certificatePem, subject, expiry } = certManager.loadCert()
    try {
      db.activityLogRecord?.({
        event_type: 'cert_pem_export',
        severity: 'critical',
        actor_user_id: actor?.id || null,
        actor_name:    actor?.name || null,
        actor_role:    'owner',
        target_type:   'dgii_cert',
        target_name:   subject || null,
        reason:        'DGII private key + cert PEM exported to renderer (web sync)',
        metadata:      { subject, expiry },
      })
    } catch {}
    return { ok: true, data: { privateKeyPem, certificatePem, subject, expiry } }
  } catch (e) {
    try {
      db.activityLogRecord?.({
        event_type: 'cert_pem_export',
        severity: 'warn',
        actor_user_id: actor?.id || null,
        actor_name:    actor?.name || null,
        actor_role:    'owner',
        target_type:   'dgii_cert',
        reason:        'cert load failed: ' + (e?.message || 'unknown'),
      })
    } catch {}
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
      if (!safeStorage.isEncryptionAvailable()) {
        try {
          db.activityLogRecord?.({
            event_type:  'cert_safestorage_unavailable',
            severity:    'critical',
            target_type: 'dgii_cert',
            target_name: 'restore-from-pem',
            reason:      'safeStorage.isEncryptionAvailable() returned false during PEM restore — refused to persist passphrase as base64',
            metadata:    { platform: process.platform },
          })
        } catch {}
        return { ok: false, error: 'Almacenamiento seguro del sistema no disponible. No se puede guardar la contraseña del certificado en este dispositivo.' }
      }
      store['dgii_cert_pass'] = { enc: true, data: safeStorage.encryptString(pass).toString('base64') }
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

// v2.16.2 — dgii:queue-anecf-void — DealBuilder.salesDeals.close failure path
// enqueues a compensating ANECF (anulación) when the sale could not be linked
// to the e-CF that was already accepted by DGII. processAnecfQueue() drains it
// on its 60s tick. Returns { ok, queued, ncf, reason } so the renderer can
// surface a crimson banner when the void was actually queued.
ipcMain.handle('dgii:queue-anecf-void', async (_, { eNCF, ticketId, ticketSupabaseId, reason } = {}) => {
  try {
    if (!eNCF) return { ok: false, error: 'eNCF required' }
    const id = db.anecfQueueEnqueue({
      ncf: eNCF,
      ticketId: ticketId || null,
      ticketSupabaseId: ticketSupabaseId || null,
      reason: reason || null,
    })
    return { ok: true, queued: !!id, ncf: eNCF, reason: reason || null, id: id || null }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
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
      // v2.10.5 — peer-device race guard. Between the SELECT above and here a
      // sync pull may have flipped this row to 'submitted' (another install of
      // the same business already pushed the e-CF to DGII). Re-read live
      // state; skip if no longer pending. DGII would reject a dupe submission
      // (encf is globally unique), but this avoids the wasted auth round-trip
      // and the scary-looking reject in error.log.
      const live = db.ecfQueueGetById(item.id)
      if (!live || live.status !== 'pending') {
        console.info('[ecf-queue] Item', item.id, 'skipped — status=', live?.status || 'gone (peer handled it)')
        continue
      }
      if (item.body_json && item.encf) {
        // DGII direct path — rebuild XML with IndicadorEnvioDiferido=1, re-sign, submit
        const invoiceData = JSON.parse(item.body_json)

        // Parent-acceptance gate (re-check on every queue tick). If this
        // queued item is an NC and its parent factura isn't ACEPTADO yet,
        // skip and try again next tick. Increment attempts so eventually
        // the user gets surfaced if the parent stays rejected/missing for
        // too long.
        const queueGate = checkParentAccepted(invoiceData)
        if (queueGate) {
          db.ecfQueueIncrAttempts(item.id, `parent_gate: ${queueGate.code}`)
          continue
        }

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
          // DGII audit D-H — clear deferred flag so a future resubmit of this
          // ticket doesn't carry IndicadorEnvioDiferido=1.
          if (invoiceData.ticketId) {
            try { db.ecfClearDeferredForTicket(invoiceData.ticketId) } catch {}
          }
        }

        // v2.10.5 — mark submitted instead of DELETE so the LWW status flip
        // propagates to peer devices on the next sync push. DGII's trackId is
        // the durable proof the e-CF reached the system.
        if (status.codigo === 1 || status.codigo === 4 || trackId) {
          db.ecfQueueMarkSubmitted(item.id, trackId)
        } else {
          db.ecfQueueIncrAttempts(item.id, status.mensajes?.join('; ') || status.estado)
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
          db.ecfQueueMarkSubmitted(item.id, result.trackId)
        } else {
          db.ecfQueueIncrAttempts(item.id, 'no trackId from DGII')
        }
      } else {
        // Legacy ef2.do path. Pre-supabase_id rows — keep DELETE for cleanup
        // since they have no encf to survive on cloud anyway.
        const { status, json } = await ef2Fetch({
          method: 'POST', path: item.url_path,
          body: JSON.parse(item.body_json), token: item.token,
        })
        if (status >= 200 && status < 300 && json?.success) {
          db.ecfQueueDelete(item.id)
        } else {
          db.ecfQueueIncrAttempts(item.id, `ef2 ${status}`)
        }
      }
    } catch (e) {
      console.error('[ecf-queue] Item', item.id, 'failed:', e.message)
      try { db.ecfQueueIncrAttempts(item.id, e.message) } catch {}
      // Surface to admin Errores so DGII outages don't sit silently for 72h.
      // Critical-tier when we're past the 100-attempt waterline because that's
      // ~50 min from the 72h contingency cliff.
      const severity = (item.attempts || 0) >= 100 ? 'critical' : 'high'
      reportMainProcessError(e, `background.dgii.queue.item_failed:${severity}:item_id=${item.id}`)
      if ((item.attempts || 0) >= 100) {
        console.error('[ecf-queue] CRITICAL: Item', item.id, 'has', item.attempts, 'failed attempts — risk of exceeding DGII 72h contingency window')
      }
    }
  }
}

// ── EN_PROCESO reconciler (audit Tier 2) ─────────────────────────────────────
// When a submitted e-CF stays in DGII status 3 (EN_PROCESO) because the
// inline pollStatus() timed out, this background tick resolves it to the
// final verdict (ACEPTADO / RECHAZADO / ACEPTADO_CONDICIONAL). Caps at 20 rows
// per tick to avoid DGII rate-limiting. Idempotent: rows that already hit a
// final dgii_status in ecf_submissions are filtered out at the SQL level.
// Also clears tickets.ecf_indicator_diferido on accept so a later manual
// resubmit of the same ticket rebuilds XML without a stale deferred flag
// (audit D-H).
let _reconcileRunning = false
async function processDgiiPendingQueue() {
  if (!db) return
  if (_reconcileRunning) return                       // reentrancy guard — slow DGII tick
  // Online gate: Node doesn't have navigator.onLine, but the hwid.json file
  // must exist (license fresh/in-grace) or there's nothing to reconcile for.
  try {
    const hwidFile = path.join(app.getPath('userData'), 'hwid.json')
    if (!fs.existsSync(hwidFile)) return
  } catch { return }

  _reconcileRunning = true
  try {
    const stale = db.ecfQueueGetStaleSubmitted(20, 5)   // max 20, 5-min min age
    if (!stale.length) return

    let certPair
    try { certPair = certManager.loadCert() }
    catch (e) {
      console.warn('[dgii-reconcile] cert not loaded, deferring tick:', e.message)
      return
    }
    const { privateKeyPem, certificatePem } = certPair

    // Auth once per env per tick. dgii-client caches tokens internally too.
    const tokensByEnv = {}
    let resolved = 0, stillProcessing = 0, errored = 0

    for (const row of stale) {
      const env = row.environment || getDgiiEnv()
      try {
        if (!tokensByEnv[env]) {
          tokensByEnv[env] = await dgiiClient.authenticate(env, privateKeyPem, certificatePem)
        }
        const token  = tokensByEnv[env]
        const status = await dgiiClient.checkStatus(row.track_id, token, env)
        const ticketId = (() => {
          try { return JSON.parse(row.body_json || '{}').ticketId || null } catch { return null }
        })()

        if (status.codigo === 1 || status.codigo === 2 || status.codigo === 4) {
          // Final verdict — upsert ecf_submissions (may not exist yet if the
          // original submit crashed after trackId but before ecfSubmissionAdd).
          const existing = db.ecfSubmissionGetByTrackId(row.track_id)
          const msg = status.mensajes?.join('; ') || status.estado || ''
          if (existing) {
            db.ecfSubmissionUpdate(row.track_id, {
              dgiiStatus: status.codigo,
              dgiiMessage: msg,
              confirmedAt: new Date().toISOString(),
            })
          } else {
            db.ecfSubmissionAdd({
              encf: row.encf, tipoEcf: row.tipo_ecf,
              ticketId,
              trackId: row.track_id,
              dgiiStatus: status.codigo, dgiiMessage: msg,
              environment: env,
            })
          }
          db.ecfQueueMarkDone(row.id)

          // Clear deferred flag on accept (1 or 4). Reject keeps it so a retry
          // resubmits with IndicadorEnvioDiferido=1 still set.
          if ((status.codigo === 1 || status.codigo === 4) && ticketId) {
            try { db.ecfClearDeferredForTicket(ticketId) } catch {}
          }
          resolved++
        } else {
          // status 0 (no encontrado) or 3 (still processing) — leave queue row
          // as 'submitted'. Touch updated_at so the 5-min stale window slides.
          db.ecfQueueMarkSubmitted(row.id, row.track_id)
          stillProcessing++
        }
      } catch (e) {
        errored++
        console.warn('[dgii-reconcile] row', row.id, 'trackId', row.track_id, 'failed:', e.message)
        // No attempt bump — transient DGII/network fault isn't the row's fault.
        // Surface to admin Errores so a multi-hour DGII outage is visible.
        reportMainProcessError(e, `background.dgii.reconcile.row_failed:track_id=${row.track_id}`)
      }
    }

    // Single summary activity_log entry per tick (keeps volume sane).
    try {
      db.activityLogRecord?.({
        event_type: 'dgii_reconcile',
        severity: errored ? 'warn' : 'info',
        target_type: 'ecf_queue',
        metadata: {
          scanned: stale.length, resolved, still_processing: stillProcessing, errored,
        },
      })
    } catch {}
  } finally {
    _reconcileRunning = false
  }
}

// Dev-only manual tick (DevTools → window.electronAPI.dgii?.reconcileNow?.())
ipcMain.handle('dgii:reconcile-now', async () => {
  await processDgiiPendingQueue()
  return { ok: true }
})

// ── ANECF auto-queue processor (v2.10.4, audit E-C6) ─────────────────────────
// Runs alongside processDgiiQueue on a 60s tick. For every pending row:
//   1. Build ANECF XML (single-NCF range: desde == hasta == row.ncf).
//   2. Sign with cert (same xml-signer used by regular e-CF submit).
//   3. Authenticate + submit to DGII (existing dgii-client.submitANECF).
//   4. Mark submitted (+ trackId) or failed (bump attempts, store error).
// Failures stay pending and retry on the next tick until 500 attempts,
// at which point the row flips to 'failed' (requires manual intervention).
let _anecfProcessing = false
async function processAnecfQueue() {
  if (!db) return
  if (_anecfProcessing) return           // reentrancy guard — tick could overlap a slow DGII call
  _anecfProcessing = true
  try {
    const pending = db.anecfQueueGetPending(10)
    if (!pending.length) return

    // Resolve emitter RNC once per batch. Missing RNC = hard stop: we
    // cannot build a valid ANECF without it. We mark the batch failed
    // with a descriptive error so the admin sees it.
    const biz = db.empresaGet?.()
    const rncEmisor = String(biz?.rnc || '').replace(/[-\s]/g, '')
    if (!rncEmisor) {
      for (const item of pending) {
        try { db.anecfQueueMarkFailed(item.id, 'RNC del emisor no configurado') } catch {}
      }
      return
    }

    // Load cert once per batch — avoid re-reading .p12 for every row.
    let privateKeyPem, certificatePem
    try {
      ({ privateKeyPem, certificatePem } = certManager.loadCert())
    } catch (e) {
      // No cert installed = can't ANECF anything yet. Don't bump attempts
      // so these rows stay pending until the cert is installed.
      console.warn('[anecf-queue] cert not loaded, deferring batch:', e.message)
      return
    }

    // Authenticate once per batch — DGII tokens are reusable for a bit.
    let token
    try {
      const env0 = pending[0].environment || getDgiiEnv()
      token = await dgiiClient.authenticate(env0, privateKeyPem, certificatePem)
    } catch (e) {
      console.warn('[anecf-queue] auth failed, retrying batch later:', e.message)
      for (const item of pending) {
        try { db.anecfQueueMarkFailed(item.id, `auth: ${e.message}`) } catch {}
      }
      return
    }

    for (const item of pending) {
      try {
        const env = item.environment || getDgiiEnv()
        const xml = xmlBuilder.buildANECFXml({
          rncEmisor,
          cantidadNCF: 1,                      // single-NCF range per void
          rangoDesde: item.rango_desde,
          rangoHasta: item.rango_hasta,
        })
        const { signedXml } = xmlSigner.signXML(xml, privateKeyPem, certificatePem)
        const result = await dgiiClient.submitANECF(signedXml, token, env)
        db.anecfQueueMarkSubmitted(item.id, result?.trackId || result?.encf || null)
        if (process.env.NODE_ENV !== 'production') {
          console.log('[anecf-queue] submitted ANECF for', item.ncf, '→', result?.trackId || 'ok')
        }
      } catch (e) {
        console.error('[anecf-queue] item', item.id, 'failed:', e.message)
        try { db.anecfQueueMarkFailed(item.id, e.message) } catch {}
        reportMainProcessError(e, `background.anecf.queue.item_failed:item_id=${item.id}:ncf=${item.ncf || ''}`)
      }
    }
  } finally {
    _anecfProcessing = false
  }
}

// Manual trigger + pending count for UI (optional DGII panel indicator).
ipcMain.handle('dgii:process-anecf-queue', async () => {
  try { await processAnecfQueue(); return { ok: true, pending: db?.anecfQueueCount?.() ?? 0 } }
  catch (err) { return { ok: false, error: err.message } }
})
ipcMain.handle('dgii:anecf-queue-count', () => db ? db.anecfQueueCount() : 0)
ipcMain.handle('dgii:anecf-queue-list', (_, limit) => db ? db.anecfQueueList(limit || 100) : [])

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

// ── Per-license JWT (sync auth) ───────────────────────────────────────────────
// The renderer owns the license_key (localStorage). After every successful
// license validation it pushes the key into main via `license:set-key`, which
// triggers a JWT mint + wires it into the sync layer. The JWT is what RLS
// reads (`auth.jwt() ->> 'business_id'`); the project anon key is still the
// `apikey` header but no longer the `Authorization: Bearer` value.
//
// Soft fallback: if the mint Edge Function is unreachable or the license has
// not been migrated yet, we log + continue without the JWT. Sync still works
// against the legacy permissive RLS policies until the lockdown migration
// goes live; after that, mint failure becomes an effective hard error
// (sync calls 401) which surfaces in the existing error log path.
const licenseJwt = require('./licenseJwt')

function getOrCreateMachineId() {
  try {
    const file = path.join(app.getPath('userData'), 'machine_id.txt')
    try { const v = fs.readFileSync(file, 'utf8').trim(); if (v) return v } catch {}
    const id = crypto.randomUUID()
    fs.writeFileSync(file, id)
    return id
  } catch (e) {
    console.warn('[main] getOrCreateMachineId fallback:', e.message)
    return getHardwareId() || 'unknown-machine'
  }
}

let _licenseJwtRefreshTimer = null
let _activeLicenseKey = null

async function _wireLicenseJwt(licenseKey, { force = false } = {}) {
  if (!licenseKey || typeof licenseKey !== 'string') return
  if (!env.supabaseUrl) return
  const machineId = getOrCreateMachineId()
  try {
    const bundle = await licenseJwt.getOrMintJwt({
      licenseKey,
      machineId,
      supabaseUrl: env.supabaseUrl,
      force,
    })
    sync.setUserJwt(bundle.access_token)
    _activeLicenseKey = licenseKey
    if (process.env.NODE_ENV !== 'production') {
      console.log('[license-jwt] minted/loaded; expires_at=', new Date(bundle.expires_at).toISOString())
    }
  } catch (e) {
    // Soft fallback during the RLS lockdown migration window.
    console.error('[license-jwt] could not mint JWT, sync will run with bare anon (legacy fallback):', e.message)
  }

  // Install refresh hook so an active sync cycle can self-heal a near-expired
  // JWT without waiting for the periodic interval.
  sync.setJwtRefreshHook(async () => {
    if (!_activeLicenseKey) return
    const fresh = await licenseJwt.getOrMintJwt({
      licenseKey: _activeLicenseKey,
      machineId: getOrCreateMachineId(),
      supabaseUrl: env.supabaseUrl,
      force: true,
    })
    sync.setUserJwt(fresh.access_token)
  })

  // Periodic refresh (idempotent — safe to re-arm on every wire call).
  if (_licenseJwtRefreshTimer) { try { clearInterval(_licenseJwtRefreshTimer) } catch {} }
  _licenseJwtRefreshTimer = setInterval(async () => {
    if (!_activeLicenseKey) return
    try {
      const fresh = await licenseJwt.getOrMintJwt({
        licenseKey: _activeLicenseKey,
        machineId: getOrCreateMachineId(),
        supabaseUrl: env.supabaseUrl,
      })
      sync.setUserJwt(fresh.access_token)
    } catch (e) {
      console.warn('[license-jwt] refresh failed:', e.message)
    }
  }, 30 * 60_000)
}

// Renderer pushes the license key here after a successful validate cycle.
// Idempotent: re-calling with the same key is a no-op once a fresh JWT is
// cached, and a new key triggers a forced re-mint.
ipcMain.handle('license:set-key', async (_evt, licenseKey) => {
  if (!licenseKey || typeof licenseKey !== 'string') return { ok: false, error: 'no key' }
  const force = (_activeLicenseKey && _activeLicenseKey !== licenseKey)
  if (force) licenseJwt.clearCachedJwt()
  await _wireLicenseJwt(licenseKey, { force })
  return { ok: true }
})

ipcMain.handle('license:clear-jwt', () => {
  try { licenseJwt.clearCachedJwt() } catch {}
  sync.setUserJwt(null)
  _activeLicenseKey = null
  if (_licenseJwtRefreshTimer) { try { clearInterval(_licenseJwtRefreshTimer) } catch {} _licenseJwtRefreshTimer = null }
  return { ok: true }
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
  const data = await resp.json()
  // v2.16.9 — feed the license-scoped sync JWT into the sync engine so RLS
  // policies that require auth.jwt()->'app_metadata'->>'business_id' accept
  // us. Without this, every anon read since the 2026-04-26 RLS migration
  // returns 0 rows. sync.js uses (_userJwt || _key) in _authHeaders(); we
  // populate _userJwt and the existing path takes over.
  try {
    if (data?.valid && data?.syncJwt) {
      const sync = require('./sync')
      if (typeof sync.setUserJwt === 'function') sync.setUserJwt(data.syncJwt)
    }
  } catch (e) { console.warn('[main] setUserJwt after validate failed:', e.message) }
  return data
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

  // v2.16.12 — forward renderer console + uncaught errors to main.log so
  // diagnostics are persistent. Up to v2.16.11 the renderer's
  // window.onerror only went to console.error which lives in DevTools
  // (kiosk mode never opens DevTools so the trace was lost). This is the
  // gap that hid the original 'Cannot access Ht before initialization'
  // source location during the v2.16.10/11 cobro investigation.
  try {
    const levels = ['debug','info','warn','error']
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      try {
        const tag = `[renderer:${levels[level] || level}]`
        const where = sourceId ? ` ${sourceId}:${line}` : ''
        log.info(`${tag}${where} ${String(message).slice(0, 4000)}`)
      } catch {}
    })
    win.webContents.on('render-process-gone', (event, details) => {
      log.error(`[renderer] render-process-gone reason=${details?.reason} exit=${details?.exitCode}`)
    })
    win.webContents.on('preload-error', (event, preloadPath, error) => {
      log.error(`[renderer] preload-error ${preloadPath}: ${error?.message || error}`)
    })
  } catch (e) { try { log.warn('[main] renderer console forward setup failed:', e.message) } catch {} }

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

// v2.16.10 2026-04-30 — DO NOT REVERT (FIX-LEDGER §3.4). Without this, two
// electron instances on the same machine each run their own ANECF + DGII queue
// drainers in parallel — they SELECT-then-UPDATE the same `anecf_queue` rows
// without row locks, so DGII receives duplicate ANECF submissions, rejects the
// second with a duplicate-comprobante error, and our `attempts` counter climbs
// to 500 → row flips to status='failed' silently. Lock the second instance out
// and forward its argv to the primary so the user gets a window-focus instead
// of a corrupt drainer race.
const _gotPrimaryLock = app.requestSingleInstanceLock()
if (!_gotPrimaryLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    try {
      const all = require('electron').BrowserWindow.getAllWindows()
      const w = all && all[0]
      if (w) { if (w.isMinimized()) w.restore(); w.focus() }
    } catch {}
  })
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
      // v2.13 — derive SQLCipher key from HWID + app-local salt. Feature flag
      // TERMINAL_X_ENCRYPT_DB=0 disables encryption for rollback. Default ON.
      let encryptionKey = null
      try {
        if (process.env.TERMINAL_X_ENCRYPT_DB !== '0') {
          const { getDbKey } = require('./key-vault')
          encryptionKey = getDbKey(app.getPath('userData'), getHardwareId())
        }
      } catch (e) { console.warn('[main] key derivation failed, opening plaintext:', e.message) }
      const ok = db.init(app.getPath('userData'), { encryptionKey })
      if (!ok) console.error('[main] DB init returned false:', db.getError?.())
      else if (process.env.NODE_ENV !== 'production') console.log('[main] DB initialized at', app.getPath('userData'))
      // v2.3 — stamp HWID into app_settings so database.js (no electron dep)
      // can read it inside ticketCreate for multi-POS block consumption.
      try {
        const hwid = getHardwareId()
        if (hwid && db.rawPrepare) {
          db.rawPrepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('hwid',?)").run(hwid)
        }
      } catch (e) { console.warn('[main] hwid stamp failed:', e.message) }
      // Prestamos — recompute mora at startup so dashboard numbers are fresh.
      try { const ids = db.loansComputeMora?.(); if (ids?.length && process.env.NODE_ENV !== 'production') console.log(`[main] mora recomputed for ${ids.length} loans`) } catch (e) { console.warn('[main] computeMora failed:', e.message) }
      // Daily cron (12h interval — idempotent, cheap).
      try { setInterval(() => { try { db.loansComputeMora?.() } catch {} }, 12 * 60 * 60 * 1000) } catch {}
    } catch (err) {
      console.error('[main] DB init failed:', err.message)
    }
  } else {
    console.error('[main] DB module not loaded')
  }
  // Init certificate manager for DGII direct e-CF (db handle passed so cert
  // rotations write rows into ecf_cert_history for the sync layer to push).
  certManager.init(app, db)
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
  // Each tick is fire-and-forget and may reject async — wrap so an unhandled
  // rejection (network, DGII 5xx, signer crash) lands in admin Errores instead
  // of bubbling to process.on('unhandledRejection') and getting deduped away.
  setInterval(() => {
    try { Promise.resolve(processDgiiQueue()).catch(e => reportMainProcessError(e, 'background.dgii.queue_30s_tick')) }
    catch (e) { reportMainProcessError(e, 'background.dgii.queue_30s_tick') }
  }, 30_000)

  // v2.11.2 — DGII cert expiry proactive alerts (90/60/30-day tiers).
  // First check fires 15s after boot (gives DB + window time to settle),
  // then every 12h. Safe no-op when no cert is installed.
  setTimeout(() => {
    checkCertExpiry().catch(e => reportMainProcessError(e, 'background.dgii.cert_expiry_first'))
    setInterval(() => {
      try { Promise.resolve(checkCertExpiry()).catch(e => reportMainProcessError(e, 'background.dgii.cert_expiry_12h')) }
      catch (e) { reportMainProcessError(e, 'background.dgii.cert_expiry_12h') }
    }, 12 * 60 * 60 * 1000)
  }, 15_000)
  // v2.10.4 — flush ANECF queue (auto-void of e-CFs) every 60s. Offset from
  // processDgiiQueue so they don't fight for the same DGII auth window.
  setTimeout(() => {
    processAnecfQueue().catch(e => reportMainProcessError(e, 'background.anecf.queue_first'))
    setInterval(() => {
      try { Promise.resolve(processAnecfQueue()).catch(e => reportMainProcessError(e, 'background.anecf.queue_60s_tick')) }
      catch (e) { reportMainProcessError(e, 'background.anecf.queue_60s_tick') }
    }, 60_000)
  }, 45_000)
  // DGII EN_PROCESO reconciler — 5-min tick, offset so it never collides with
  // processDgiiQueue (30s) or processAnecfQueue (60s) spikes. First run 90s
  // after boot (license + cert + network should all be settled).
  setTimeout(() => {
    processDgiiPendingQueue().catch(e => reportMainProcessError(e, 'background.dgii.reconcile_first'))
    setInterval(() => {
      try { Promise.resolve(processDgiiPendingQueue()).catch(e => reportMainProcessError(e, 'background.dgii.reconcile_5m_tick')) }
      catch (e) { reportMainProcessError(e, 'background.dgii.reconcile_5m_tick') }
    }, 5 * 60_000)
  }, 90_000)

  // v2.16.4 — Concesionario reservation auto-expire. First sweep on boot, then
  // every 15 minutes. Each expired row gets logged so owners see the release in
  // the activity feed. Cheap query (indexed on expires_at + status).
  function _runReservationExpire() {
    try {
      const r = db?.vehicleReservationsExpire?.()
      if (!r?.expired) return
      for (const item of r.ids) {
        try {
          db.activityLogRecord?.({
            event_type:  'vehicle_reservation_expired',
            severity:    'info',
            target_type: 'vehicle_reservation',
            target_id:   item.id,
            metadata:    { supabase_id: item.supabase_id, vehicle_inventory_supabase_id: item.vehicle_inventory_supabase_id },
          })
        } catch {}
      }
    } catch (e) { console.warn('[main] reservation expire failed:', e?.message); reportMainProcessError(e, 'background.concession.reservation_expire') }
  }
  try { _runReservationExpire() } catch (e) { reportMainProcessError(e, 'background.concession.reservation_expire_boot') }
  setInterval(_runReservationExpire, 15 * 60_000)

  // v2.16.4 Sprint 2B H3 — Concesionario warranty auto-expire. Same cadence as
  // reservations (15 min) — flips date-due rows to 'expired' so the dashboard
  // tile and "vencen este mes" count stay honest.
  function _runWarrantyExpire() {
    try {
      const r = db?.vehicleWarrantiesExpire?.()
      if (!r?.expired) return
      for (const item of r.ids) {
        try {
          db.activityLogRecord?.({
            event_type:  'vehicle_warranty_expired',
            severity:    'info',
            target_type: 'vehicle_warranty',
            target_id:   item.id,
            metadata:    { supabase_id: item.supabase_id, sales_deal_supabase_id: item.sales_deal_supabase_id },
          })
        } catch {}
      }
    } catch (e) { console.warn('[main] warranty expire failed:', e?.message); reportMainProcessError(e, 'background.concession.warranty_expire') }
  }
  try { _runWarrantyExpire() } catch (e) { reportMainProcessError(e, 'background.concession.warranty_expire_boot') }
  setInterval(_runWarrantyExpire, 15 * 60_000)

  // v2.16.4 Sprint 2C — Concesionario bank pre-approval auto-expire. Same
  // 15-min cadence as reservations + warranties — flips date-due rows whose
  // status is still solicitada/en_revision/pre_aprobada to 'expirada' so the
  // "Pre-aprobadas no utilizadas" dashboard tile stays honest.
  function _runPreapprovalExpire() {
    try {
      const r = db?.bankPreapprovalsExpire?.()
      if (!r?.expired) return
      for (const item of r.ids) {
        try {
          db.activityLogRecord?.({
            event_type:  'bank_preapproval_expired',
            severity:    'info',
            target_type: 'bank_preapproval',
            target_id:   item.id,
            target_name: item.bank,
            metadata:    { supabase_id: item.supabase_id, client_supabase_id: item.client_supabase_id, bank: item.bank },
          })
        } catch {}
      }
    } catch (e) { console.warn('[main] preapproval expire failed:', e?.message); reportMainProcessError(e, 'background.concession.preapproval_expire') }
  }
  try { _runPreapprovalExpire() } catch (e) { reportMainProcessError(e, 'background.concession.preapproval_expire_boot') }
  setInterval(_runPreapprovalExpire, 15 * 60_000)

  // Nightly SQLite → Supabase Storage backup (3:00 AM local, 24h cadence).
  scheduleNightlyBackup()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// ── Nightly cloud backup (3:00 AM local) ─────────────────────────────────────
const dbBackup = require('./db-backup')

function msUntilNext3AM() {
  const now  = new Date()
  const next = new Date(now)
  next.setHours(3, 0, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

function backupCreds() {
  const key = env.supabaseServiceKey || env.supabaseAnon
  return { url: env.supabaseUrl, key }
}

// License-active predicate: hwid.json exists AND we have resolvable business_id.
// (Fresh installs without a validated license skip backup to avoid burning
// storage quota on trial-abandoned machines.)
function isLicenseActive() {
  try {
    const hwidFile = path.join(app.getPath('userData'), 'hwid.json')
    if (!fs.existsSync(hwidFile)) return false
    const bizId = db?.rawPrepare?.("SELECT value FROM app_settings WHERE key='supabase_business_id'").get()?.value
    return !!bizId
  } catch { return false }
}

async function runBackupGuarded(reason) {
  if (!db?.isReady?.()) throw new Error('DB not ready')
  if (!isLicenseActive()) throw new Error('license not active')
  const creds = backupCreds()
  if (!creds.url || !creds.key) throw new Error('Supabase credentials missing')
  return dbBackup.runNightlyBackup({
    db,
    supabase:    creds,
    business_id: null, // resolved from app_settings inside
    tmpDir:      path.join(app.getPath('userData'), 'backup-tmp'),
    reason,
    // Production path (anon key): server-signed upload URL via panel.js. The
    // endpoint validates license+hwid before minting the URL, so the desktop
    // never needs storage write privilege.
    licenseKey:  _activeLicenseKey,
    hwid:        getHardwareId(),
    apiBase:     process.env.TX_ADMIN_API_BASE || 'https://terminalxpos.com',
  })
}

function scheduleNightlyBackup() {
  const delay = msUntilNext3AM()
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[backup] next nightly run in ${Math.round(delay / 60000)} min`)
  }
  setTimeout(async () => {
    try { await runBackupGuarded('scheduled') }
    catch (e) {
      console.warn('[backup] scheduled run failed:', e.message)
      reportMainProcessError(e, 'backup:scheduled')
    }
    scheduleNightlyBackup() // recompute for next 3 AM (handles DST drift)
  }, delay)
}

ipcMain.handle('backup:runNow', async () => {
  try {
    const res = await runBackupGuarded('manual')
    return { ok: true, data: res }
  } catch (e) {
    reportMainProcessError(e, 'backup:runNow')
    return { ok: false, error: e?.message || String(e) }
  }
})

ipcMain.handle('backup:lastStatus', () => {
  try { return { ok: true, data: dbBackup.getLastStatus(db) } }
  catch (e) { return { ok: false, error: e?.message || String(e) } }
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
handleMut('save-usuario',    (data) => {
  // Inject actorId from server-side session so userUpdate can enforce the
  // self-PIN old-PIN check (S-H6). Renderer cannot be trusted to send it.
  if (data.id) {
    const actor = db.getActiveUser?.() || null
    return db.userUpdate(data.id, { ...data, actorId: actor?.id ?? null })
  }
  return db.userCreate(data)
}, {
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
// NOTE: settings:update MAC enforcement deferred — UI doesn't yet wrap via
// ManagerAuthGate so gating here would break all non-owner settings edits.
// Will add once Sistema/DGII screens wrap their save buttons in ManagerAuthGate.
handleMut('settings:update', (obj)  => { db.settingsUpdate(obj); return true })

// ── Go-Live Gate ─────────────────────────────────────────────────────────────
handle('app:is-live',         ()  => db.isProductionLive())
handle('app:test-data-count', ()  => db.testDataCount())
handleMut('app:go-live-commit', () => db.goLiveCommit())

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
// Fresh install / local-wipe safety: if PIN lookup misses the local staff cache,
// force a blocking pull from Supabase and retry ONCE. Without this, a user who
// wiped their DB (or whose PIN was changed server-side) sees "PIN incorrecto"
// even though the correct hash exists in the cloud. Throttled so a wrong-PIN
// spam can't trigger pull storms.
let _lastPinRescuePullAt = 0
const PIN_RESCUE_COOLDOWN_MS = 30_000
handle('auth:pin', async (pin) => {
  let u = db.authByPin(pin)
  if (u) return u

  const staffCount = (db.usersGetAll?.() || []).length
  const now = Date.now()
  const stale = (now - _lastPinRescuePullAt) > PIN_RESCUE_COOLDOWN_MS
  const shouldRescue = staffCount === 0 || stale
  if (!shouldRescue) return u

  _lastPinRescuePullAt = now
  try {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[auth:pin] miss — staffCount=${staffCount} stale=${stale}, forcing sync pull`)
    }
    await Promise.race([
      sync.pullNow?.() || Promise.resolve(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('rescue-pull timeout')), 10_000)),
    ])
  } catch (err) {
    console.warn('[auth:pin] rescue pull failed:', err?.message || err)
    return u
  }
  return db.authByPin(pin)
})
handle('auth:lockout-status', ()  => db.authLockoutStatus?.() || { locked: false, until: null })
handle('users:all',        ()     => db.usersGetAll())
handleMut('users:create',     (data)          => db.userCreate(data), {
  requires: ({ actor, args }) => guard.guardUserCreate(db, actor, args[0] || {}),
  targetCtx: () => ({ target_type: 'user' }),
})
handleMut('users:update',     ({id, ...data}) => {
  // Inject trusted actorId for the S-H6 self-PIN guard.
  const actor = db.getActiveUser?.() || null
  return db.userUpdate(id, { ...data, actorId: actor?.id ?? null })
}, {
  requires: ({ actor, args }) => guard.guardUserUpdate(db, actor, args[0] || {}),
  targetCtx: ({ args }) => guard.userTargetCtx(db, args[0]?.id),
})
handleMut('users:delete',     ({id})          => db.userDelete(id), {
  requires: ({ actor, args }) => guard.guardUserDelete(db, actor, args[0] || {}),
  targetCtx: ({ args }) => guard.userTargetCtx(db, args[0]?.id),
})
// v2.6 — Manager Authorization Card (scan-only barcode token).
// generate/revoke are owner-or-manager only (enforced via auth-guard). verify
// is intentionally NOT mutation-guarded — any logged-in user (including
// cashiers) must be able to invoke it to pass the gate. The hash comparison
// itself is the security boundary.
// Owner-only: a manager with card-gen rights could mint themselves an
// override token and bypass cashier gates. Keep this strictly owner-tier.
handleMut('staff:generateAuthCard', ({ id }) => db.staffGenerateAuthCard(id), {
  requires: ({ actor }) => guard.guardOwnerOnly(null, actor, null, 'staff:generateAuthCard'),
  targetCtx: ({ args }) => guard.userTargetCtx(db, args[0]?.id),
})
handleMut('staff:revokeAuthCard',   ({ id }) => db.staffRevokeAuthCard(id), {
  requires: ({ actor }) => guard.guardOwnerOnly(null, actor, null, 'staff:revokeAuthCard'),
  targetCtx: ({ args }) => guard.userTargetCtx(db, args[0]?.id),
})
handle('staff:verifyAuthToken',     (token)  => db.staffVerifyAuthToken(token))

// ── MAC issue ────────────────────────────────────────────────────────────────
// Validate a scanned Manager Auth Card token, then mint a one-time jti bound
// to (action, target_id). Renderer includes jti on the subsequent protected
// IPC; guardMac consumes it server-side. Owner is exempt — they can self-
// authorize without a scan (see guardMac in auth-guard.js).
handle('mac:issue', ({ scan_token, pin, action, target_id } = {}) => {
  if (!action) return { ok: false, error: 'action required' }
  let verified = null
  if (scan_token) {
    verified = db.staffVerifyAuthToken(scan_token)
    if (!verified) return { ok: false, error: 'Tarjeta invalida' }
  } else if (pin) {
    // PIN fallback — validate via authByPin server-side, require owner/manager
    const u = db.authByPin?.(String(pin).replace(/\D/g, ''))
    if (!u || !['owner', 'manager'].includes(u.role)) return { ok: false, error: 'PIN invalido o sin permiso' }
    verified = { id: u.id, name: u.name, role: u.role, supabase_id: u.supabase_id }
  } else {
    return { ok: false, error: 'scan_token o pin requerido' }
  }
  const out = guard.macStore.issue({
    staff_id: verified.id,
    role:     verified.role,
    action,
    target_id,
  })
  return { ok: true, jti: out.jti, exp: out.exp, staff: { id: verified.id, name: verified.name, role: verified.role } }
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
handle('services:top-sellers', (opts)        => db.servicesTopSellers(opts || {}))
handleMut('services:create',    (data)          => db.serviceCreate(data), {
  requires: ({ actor }) => guard.guardOwnerOrManager(db, actor, null, 'services:create'),
  targetCtx: () => ({ target_type: 'service' }),
})
handleMut('services:update',    ({id,...data})  => db.serviceUpdate(id, data), {
  requires: ({ actor }) => guard.guardOwnerOrManager(db, actor, null, 'services:update'),
  targetCtx: ({ args }) => guard.serviceTargetCtx(db, args[0]?.id),
})
handleMut('services:set-in-stock', ({ key, inStock }) => db.serviceSetInStock(key, inStock), {
  requires: ({ actor }) => guard.guardOwnerOrManager(db, actor, null, 'services:set-in-stock'),
  targetCtx: ({ args }) => guard.serviceTargetCtx(db, args[0]?.key),
})
handleMut('services:delete',    async ({id})    => {
  const r = db.serviceDelete(id)
  // Propagate hard-delete to Supabase so pullUpsertRow doesn't resurrect it.
  // Soft-deleted rows keep their cloud row (active=0 will sync normally).
  if (r?.deleted && r?.supabase_id) {
    try { await sync.supabaseDelete?.('services', r.supabase_id) } catch {}
  }
  return r
}, {
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
handleMut('mesas:request-bill', ({id})              => db.mesaRequestBill(id))
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

// ── Restaurant Mode — Service recipes (Bill-of-Materials, v2.16.3) ──────────
handle('recipeItems:listForService', ({ serviceKey })                  => db.recipeItemsListForService(serviceKey))
handleMut('recipeItems:add',         (data)                             => db.recipeItemsAdd(data))
handleMut('recipeItems:update',      ({ id, qty_per_unit })             => db.recipeItemsUpdate(id, qty_per_unit))
handleMut('recipeItems:remove',      ({ id })                           => { db.recipeItemsRemove(id); return true })

// ── Ofertas (product bundles) ────────────────────────────────────────────────
handle('ofertas:list',    (opts = {})        => db.ofertasList(opts || {}))
handle('ofertas:get',     ({ supabase_id })  => db.ofertasGet(supabase_id))
handleMut('ofertas:upsert', (data)           => db.ofertasUpsert(data))
handleMut('ofertas:delete', ({ supabase_id }) => db.ofertasDelete(supabase_id))

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

// ── Salon v2.16.1 — memberships catalog, client balances, reminders ─────────
handle('salon:memberships:list',                () => db.salonMembershipList())
handleMut('salon:memberships:create',           (data) => db.salonMembershipCreate(data || {}))
handleMut('salon:memberships:update',           ({ supabase_id, ...patch }) => db.salonMembershipUpdate(supabase_id, patch))
handleMut('salon:memberships:archive',          ({ supabase_id }) => db.salonMembershipArchive(supabase_id))

handle('salon:client-memberships:by-client',    (client_supabase_id) => db.clientMembershipsByClient(client_supabase_id))
handleMut('salon:client-memberships:purchase',  (data) => db.clientMembershipPurchase(data || {}))
handleMut('salon:client-memberships:consume',   (data) => db.clientMembershipConsume(data || {}))
handle('salon:client-memberships:expiring-soon',(days) => db.clientMembershipsExpiringSoon(days))

handleMut('salon:reminders:schedule',           ({ appointment_supabase_id, fire_at, kind }) => db.appointmentReminderSchedule(appointment_supabase_id, fire_at, kind))
handle('salon:reminders:pending-due',           (now) => db.appointmentRemindersPendingDue(now))
handle('salon:reminders:recent',                (opts) => db.appointmentRemindersRecent(opts || {}))
handleMut('salon:reminders:mark-sent',          ({ id, ultramsg_message_id }) => db.appointmentReminderMarkSent(id, ultramsg_message_id))
handleMut('salon:reminders:mark-failed',        ({ id, error }) => db.appointmentReminderMarkFailed(id, error))
handleMut('salon:reminders:schedule-for-appointment', (appt) => db.appointmentReminderScheduleForAppointment(appt || {}))

handleMut('salon:appointments:mark-no-show',    ({ supabase_id }) => db.appointmentMarkNoShow(supabase_id))

// ── Stylist Schedules ────────────────────────────────────────────────────────
handleMut('stylistSchedules:create', (data)           => db.stylistScheduleCreate(data))
handleMut('stylistSchedules:update', ({id, ...data})  => db.stylistScheduleUpdate(id, data))
handle('stylistSchedules:list',   (params)         => db.stylistScheduleList(params))
handleMut('stylistSchedules:delete', ({id})           => { db.stylistScheduleDelete(id); return true })

// ── Concesionario v2 / v2.5 — dealership ─────────────────────────────────────
handle('vehicleInventory:list',         (params)               => db.vehicleInventoryList(params))
handle('vehicleInventory:byId',         (id)                   => db.vehicleInventoryGetById(id))
handleMut('vehicleInventory:create',    (data)                 => db.vehicleInventoryCreate(data))
handleMut('vehicleInventory:update',    ({id, ...data})        => db.vehicleInventoryUpdate(id, data))
handleMut('vehicleInventory:setStatus', ({id, status})         => db.vehicleInventorySetStatus(id, status))
handleMut('vehicleInventory:delete',    ({id})                 => { db.vehicleInventoryDelete(id); return true })

handle('salesDeals:list',               (params)               => db.salesDealsList(params))
handle('salesDeals:byId',               (id)                   => db.salesDealsGetById(id))
handleMut('salesDeals:create',          (data)                 => db.salesDealsCreate(data))
handleMut('salesDeals:update',          ({id, ...data})        => db.salesDealsUpdate(id, data))
handleMut('salesDeals:close',           ({id, ticketInfo})     => db.salesDealsClose(id, ticketInfo))
handleMut('salesDeals:markCommissionPaid', ({id})              => db.salesDealsMarkCommissionPaid(id))
handle('salesDeals:commissionsForPeriod', (params)             => db.salesDealsCommissionsForPeriod(params))
handleMut('salesDeals:delete',          ({id})                 => { db.salesDealsDelete(id); return true })

handle('leads:list',                    (params)               => db.leadsList(params))
handleMut('leads:create',               (data)                 => db.leadsCreate(data))
handleMut('leads:update',               ({id, ...data})        => db.leadsUpdate(id, data))
handleMut('leads:setStage',             ({id, stage, extra})   => db.leadsSetStage(id, stage, extra))
handleMut('leads:logContact',           ({id, ...rest})        => db.leadsLogContact(id, rest))
handle('leads:overdue',                 ()                     => db.leadsOverdue())
handleMut('leads:delete',               ({id})                 => { db.leadsDelete(id); return true })

handle('testDrives:list',               ()                     => db.testDrivesList())
handleMut('testDrives:create',          (data)                 => db.testDrivesCreate(data))
handleMut('testDrives:update',          ({id, ...data})        => db.testDrivesUpdate(id, data))
handleMut('testDrives:complete',        ({id, notes})          => db.testDrivesComplete(id, notes))
handleMut('testDrives:setOutcome',      ({id, ...rest})        => db.testDrivesSetOutcome(id, rest))
handleMut('testDrives:delete',          ({id})                 => { db.testDrivesDelete(id); return true })

handle('vehicleDocuments:byVehicle',    (vehicleSupabaseId)    => db.vehicleDocumentsByVehicle(vehicleSupabaseId))
handle('vehicleDocuments:expiringSoon', (days)                 => db.vehicleDocumentsExpiringSoon(days))
handleMut('vehicleDocuments:create',    (data)                 => db.vehicleDocumentsCreate(data))
handleMut('vehicleDocuments:delete',    ({id})                 => { db.vehicleDocumentsDelete(id); return true })

// v2.16.2 — Vehicle Titulo (INTRANT matricula / traspaso)
handle('vehicleTitulo:list',            ()                     => db.vehicleTituloList())
handleMut('vehicleTitulo:upsert',       (data)                 => db.vehicleTituloUpsert(data))
handleMut('vehicleTitulo:delete',       ({id})                 => { db.vehicleTituloDelete(id); return true })

// v2.16.4 — Vehicle Reservations (deposit + expiry, Sprint 2A H2)
handle('vehicle-reservation:list',      ({ business_id } = {}) => db.vehicleReservationList(business_id))
handle('vehicle-reservation:active',    ({ business_id } = {}) => db.vehicleReservationsActive(business_id))
handleMut('vehicle-reservation:upsert', (data)                 => db.vehicleReservationUpsert(data))
handleMut('vehicle-reservation:release',(args)                 => db.vehicleReservationRelease(args || {}))
handleMut('vehicle-reservation:convert',(args)                 => db.vehicleReservationConvert(args || {}))
handleMut('vehicle-reservation:expire', ()                     => db.vehicleReservationsExpire())

// v2.16.4 Sprint 2B H3 — Vehicle warranties (post-sale).
handle('vehicle-warranty:list',           ({ business_id } = {})            => db.vehicleWarrantyList(business_id))
handle('vehicle-warranty:by-deal',        ({ sales_deal_supabase_id } = {}) => db.vehicleWarrantyByDeal(sales_deal_supabase_id))
handle('vehicle-warranty:expiring-soon',  ({ business_id, days } = {})      => db.vehicleWarrantyExpiringSoon(business_id, days))
handleMut('vehicle-warranty:upsert',      (data)                            => db.vehicleWarrantyUpsert(data))
handleMut('vehicle-warranty:add-claim',   (args)                            => db.vehicleWarrantyAddClaim(args || {}))
handleMut('vehicle-warranty:void',        (args)                            => db.vehicleWarrantyVoid(args || {}))
handleMut('vehicle-warranty:expire',      ()                                => db.vehicleWarrantiesExpire())

// v2.16.4 Sprint 2C — Bank pre-approvals (manual workflow).
handle('bank-preapproval:list',             ({ business_id, ...opts } = {})            => db.bankPreapprovalList(business_id, opts))
handle('bank-preapproval:active-by-client', ({ client_supabase_id } = {})              => db.bankPreapprovalActiveByClient(client_supabase_id))
handleMut('bank-preapproval:upsert',        (data)                                     => db.bankPreapprovalUpsert(data))
handleMut('bank-preapproval:set-status',    (args)                                     => db.bankPreapprovalSetStatus(args || {}))
handleMut('bank-preapproval:expire',        ()                                         => db.bankPreapprovalsExpire())

// ── v2.16.0 — Taller Mecánico hardening ─────────────────────────────────────
handle('aseguradoras:list',          (params)               => db.aseguradoraList(params))
handle('aseguradoras:byId',          (id)                   => db.aseguradoraGetById(id))
handle('aseguradoras:bySupabaseId',  (supabaseId)           => db.aseguradoraGetBySupabaseId(supabaseId))
handleMut('aseguradoras:create',     (data)                 => db.aseguradoraCreate(data))
handleMut('aseguradoras:update',     ({id, ...data})        => db.aseguradoraUpdate(id, data))
handleMut('aseguradoras:delete',     ({id})                 => { db.aseguradoraDelete(id); return true })

// ── Loan renewals (M2) ─────────────────────────────────────────────────────
handle('loan-renewals:list',         (params)               => db.loanRenewalsList(params || {}))
handleMut('loan-renewals:create',    (data)                 => db.loanRenewalCreate(data || {}))

handle('suppliers:list',             (params)               => db.supplierList(params))
handle('suppliers:byId',             (id)                   => db.supplierGetById(id))
handleMut('suppliers:create',        (data)                 => db.supplierCreate(data))
handleMut('suppliers:update',        ({id, ...data})        => db.supplierUpdate(id, data))
handleMut('suppliers:delete',        ({id})                 => { db.supplierDelete(id); return true })

handle('partsOrders:listByWO',       (wo_supabase_id)       => db.partsOrderListByWO(wo_supabase_id))
handle('partsOrders:listAwaiting',   ()                     => db.partsOrderListAwaiting())
handle('partsOrders:findByBarcode',  (barcode)              => db.partsOrderFindByBarcode(barcode))
handleMut('partsOrders:create',      (data)                 => db.partsOrderCreate(data))
handleMut('partsOrders:update',      ({id, ...data})        => db.partsOrderUpdate(id, data))
handleMut('partsOrders:markReceived',({id, received_barcode}) => db.partsOrderMarkReceived(id, { received_barcode }))
handleMut('partsOrders:delete',      ({id})                 => { db.partsOrderDelete(id); return true })

handle('workOrderPhotos:listByWO',      (wo_supabase_id)    => db.workOrderPhotoListByWO(wo_supabase_id))
handle('workOrderPhotos:listByVehicle', (veh_supabase_id)   => db.workOrderPhotoListByVehicle(veh_supabase_id))
handleMut('workOrderPhotos:insert',  (data)                 => db.workOrderPhotoInsert(data))
handleMut('workOrderPhotos:delete',  ({id})                 => { db.workOrderPhotoDelete(id); return true })

handle('insuranceBatches:listByPeriod', (params)            => db.insuranceBatchListByPeriod(params))
handle('insuranceBatches:byId',         (id)                => db.insuranceBatchGet(id))
handleMut('insuranceBatches:create',    (data)              => db.insuranceBatchCreate(data))
handleMut('insuranceBatches:update',    ({id, ...data})     => db.insuranceBatchUpdate(id, data))
handle('insuranceBatches:workOrdersFor', ({aseguradora_supabase_id, period_month}) => db.workOrdersForInsuranceBatch(aseguradora_supabase_id, period_month))

handle('mechanic:productivityForPeriod', ({period_start, period_end}) => db.mechanicProductivityForPeriod(period_start, period_end))
handle('mechanic:serviceRemindersDue',   ()                 => db.mechanicServiceRemindersDue())
handle('mechanicCommissions:byPeriod',   ({period_start, period_end}) => db.mechanicCommissionsByPeriod(period_start, period_end))
handleMut('mechanicCommissions:markPaid', ({id, paid_by_supabase_id}) => db.mechanicCommissionsMarkPaid(id, paid_by_supabase_id))

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
// v2.7.1 — ledger-backed loyalty
handleMut('loyalty:award',   (data)      => db.loyaltyAward(data || {}))
handleMut('loyalty:redeem',  (data)      => db.loyaltyRedeem(data || {}))
handleMut('loyalty:adjust',  (data)      => db.loyaltyAdjust(data || {}))
handle('loyalty:history',    (data)      => db.loyaltyHistory(data || {}))
handle('clients:openTickets',  (clientId)  => db.clientGetOpenTickets(clientId))
handleMut('credits:collect',      (data)      => db.collectCredit(data))

// ── Tickets ───────────────────────────────────────────────────────────────────
handle('tickets:all',         (params)    => db.ticketsGetAll(params))
handle('tickets:byId',        (id)        => db.ticketGetById(id))
// Big-discount gate: if descuento > RD$500 or > 15% of subtotal, require MAC.
// Owner is exempt (handled inside guardMac via DB role re-verify).
function requiresBigDiscountMac({ actor, args, db: _db }) {
  const d = args[0] || {}
  const desc = Number(d.descuento || 0)
  const sub  = Number(d.subtotal  || 0)
  const isBig = desc > 500 || (sub > 0 && (desc / sub) > 0.15)
  if (!isBig) return null
  return guard.guardMac('discount_big')({ actor, args, db: _db })
}
handleMut('tickets:create',      (data)      => db.ticketCreate(data), {
  requires: requiresBigDiscountMac,
})
handleMut('tickets:markPaid',    ({id,...d})            => db.ticketMarkPaid(id, d), {
  requires: requiresBigDiscountMac,
})
handleMut('tickets:void',        ({id,reason,voidById}) => db.ticketVoid(id, reason, voidById), {
  requires: guard.guardMac('tickets:void', ([a]) => a?.id),
})
handle('tickets:byDateRange', ({from,to}) => db.ticketGetByDateRange(from, to))
// v2.16.4 — Restaurant open-ticket lifecycle (persist at seat-time, not cobro).
// 2026-05-09 — Generalized to any fulfillment (food_truck reuses).
handleMut('tickets:openForFulfillment', (data) => db.ticketOpenForFulfillment(data || {}))
handleMut('tickets:openForMesa',     (data) => db.ticketOpenForMesa(data || {}))
handle('tickets:listOpen',           (data) => db.ticketsListOpen(data || {}))
handleMut('tickets:addItem',         (data) => db.ticketAddItem(data || {}))
handleMut('tickets:updateItemQty',   (data) => db.ticketUpdateItemQty(data || {}))
handleMut('tickets:removeItem',      (data) => db.ticketRemoveItem(data || {}))
handle('tickets:getActiveByMesa',    ({ mesa_id } = {}) => db.ticketGetActiveByMesa(mesa_id))
handleMut('tickets:closeWithPayment', (data) => db.ticketCloseWithPayment(data || {}), {
  // closeWithPayment nests the cobro fields under `payload`, so unwrap before
  // delegating to the shared big-discount gate.
  requires: ({ actor, args, db: _db }) => {
    const payload = args?.[0]?.payload || {}
    return requiresBigDiscountMac({ actor, args: [payload], db: _db })
  },
})
handle('reports:ticketsWithItems', ({from,to}) => db.ticketGetByDateRangeWithItems(from, to))
handleMut('tickets:updateItemPrice', (data) => db.ticketItemUpdatePrice(data))
handle('tickets:priceChanges',    ({ticketId}) => db.priceChangesGetByTicket(ticketId))
handle('tickets:allPriceChanges', ({from,to}) => db.priceChangesGetAll(from, to))

// v2.16.3 H3 — Restaurante Mover/Juntar (manager-gated at UI layer).
handleMut('tickets:transferToMesa', ({ ticket_supabase_id, new_mesa_id } = {}) =>
  db.ticketTransferToMesa({ ticket_supabase_id, new_mesa_id }))
handleMut('tickets:merge', ({ target_ticket_supabase_id, source_ticket_supabase_id } = {}) =>
  db.ticketMerge({ target_ticket_supabase_id, source_ticket_supabase_id }))

// v2.16.3 H4 — Restaurant front-of-house reservations.
handle('reservations:list',          (params)       => db.reservationsList(params || {}))
handleMut('reservations:create',     (data)         => db.reservationsCreate(data || {}))
handleMut('reservations:update',     ({ id, ...d }) => db.reservationsUpdate(id, d))
handleMut('reservations:confirm',    ({ id })       => db.reservationsConfirm(id))
handleMut('reservations:cancel',     ({ id, reason }) => db.reservationsCancel(id, reason))
handleMut('reservations:markNoShow', ({ id })       => db.reservationsMarkNoShow(id))
handleMut('reservations:seat',       ({ id, mesa_id }) => db.reservationsSeat(id, mesa_id))
handleMut('reservations:stampWhatsapp', ({ id })    => db.reservationsStampWhatsapp(id))

// ── v2.17 — Food Truck: favorite stops + waste log ───────────────────────────
handle   ('food-truck-locations:list',   (params)               => db.foodTruckLocationsList(params || {}))
handleMut('food-truck-locations:create', (data)                 => db.foodTruckLocationsCreate(data || {}))
handleMut('food-truck-locations:update', ({ id, ...patch } = {}) => db.foodTruckLocationsUpdate(id, patch))
handleMut('food-truck-locations:delete', ({ id } = {})          => db.foodTruckLocationsDelete(id))
handle   ('waste-log:list',              (params)               => db.wasteLogList(params || {}))
handleMut('waste-log:create',            (data)                 => db.wasteLogCreate(data || {}))
handleMut('waste-log:delete',            ({ id } = {})          => db.wasteLogDelete(id))

// ── Phase 1B — Contabilidad (firm-side suite) ────────────────────────────────
handleMut('contabilidad:client-create',  (payload)               => db.accountingClientCreate(payload || {}))
handleMut('contabilidad:client-update',  ({ id, ...patch } = {}) => db.accountingClientUpdate(id, patch))
handle   ('contabilidad:client-list',    (params)                => db.accountingClientList(params || {}))
handle   ('contabilidad:client-get',     ({ id } = {})           => db.accountingClientGet(id))
handleMut('contabilidad:client-delete',  ({ id } = {})           => db.accountingClientDelete(id))

handleMut('contabilidad:inbox-add',      (payload)               => db.accountingInboxAdd(payload || {}))
handle   ('contabilidad:inbox-list',     (params)                => db.accountingInboxList(params || {}))
handleMut('contabilidad:inbox-classify', ({ id, ...patch } = {}) => db.accountingInboxClassify(id, patch))
handleMut('contabilidad:inbox-post',     ({ id, ...rest } = {})  => db.accountingInboxPost(id, rest))
handleMut('contabilidad:inbox-delete',   ({ id } = {})           => db.accountingInboxDelete(id))

handleMut('contabilidad:obligations-generate-year', (params)            => db.accountingObligationGenerateYear(params || {}))
handle   ('contabilidad:obligations-list',          (params)            => db.accountingObligationsList(params || {}))
handleMut('contabilidad:obligations-mark-filed',    ({ id, ...rest } = {}) => db.accountingObligationMarkFiled(id, rest))

handleMut('contabilidad:document-add',    (payload)      => db.accountingDocumentAdd(payload || {}))
handle   ('contabilidad:document-list',   (params)       => db.accountingDocumentList(params || {}))
handleMut('contabilidad:document-delete', ({ id } = {})  => db.accountingDocumentDelete(id))

handleMut('contabilidad:billing-plan-create', (payload)               => db.accountingBillingPlanCreate(payload || {}))
handleMut('contabilidad:billing-plan-update', ({ id, ...patch } = {}) => db.accountingBillingPlanUpdate(id, patch))
handle   ('contabilidad:billing-plan-list',   (params)                => db.accountingBillingPlanList(params || {}))

handleMut('contabilidad:billing-invoice-create',    (payload)     => db.accountingBillingInvoiceCreate(payload || {}))
handleMut('contabilidad:billing-invoice-mark-paid', ({ id } = {}) => db.accountingBillingInvoiceMarkPaid(id))
handle   ('contabilidad:billing-invoice-list',      (params)      => db.accountingBillingInvoiceList(params || {}))

handleMut('contabilidad:csv-mapping-create', (payload) => db.accountingCsvMappingCreate(payload || {}))
handle   ('contabilidad:csv-mapping-list',   (params)  => db.accountingCsvMappingList(params || {}))

// ── Phase 2 Slice 1 — Contabilidad full firm-side suite ──────────────────────
// Chart of accounts
handleMut('contabilidad:coa-create',  (payload)               => db.accountingCoaCreate(payload || {}))
handleMut('contabilidad:coa-update',  ({ id, ...patch } = {}) => db.accountingCoaUpdate(id, patch))
handle   ('contabilidad:coa-list',    (params)                => db.accountingCoaList(params || {}))
handle   ('contabilidad:coa-get',     ({ id } = {})           => db.accountingCoaGet(id))
handleMut('contabilidad:coa-delete',  ({ id } = {})           => db.accountingCoaDelete(id))
// Journal entries + lines
handleMut('contabilidad:journal-entry-create',  (payload)               => db.accountingJournalEntryCreate(payload || {}))
handleMut('contabilidad:journal-entry-update',  ({ id, ...patch } = {}) => db.accountingJournalEntryUpdate(id, patch))
handle   ('contabilidad:journal-entry-list',    (params)                => db.accountingJournalEntryList(params || {}))
handle   ('contabilidad:journal-entry-get',     ({ id } = {})           => db.accountingJournalEntryGet(id))
handleMut('contabilidad:journal-entry-delete',  ({ id } = {})           => db.accountingJournalEntryDelete(id))
handleMut('contabilidad:journal-line-add',      (payload)               => db.accountingJournalLineAdd(payload || {}))
handle   ('contabilidad:journal-line-list',     (params)                => db.accountingJournalLineList(params || {}))
handleMut('contabilidad:journal-line-delete',   ({ id } = {})           => db.accountingJournalLineDelete(id))
// Auto-post rules
handleMut('contabilidad:auto-post-rule-create', (payload)               => db.accountingAutoPostRuleCreate(payload || {}))
handleMut('contabilidad:auto-post-rule-update', ({ id, ...patch } = {}) => db.accountingAutoPostRuleUpdate(id, patch))
handle   ('contabilidad:auto-post-rule-list',   (params)                => db.accountingAutoPostRuleList(params || {}))
handleMut('contabilidad:auto-post-rule-delete', ({ id } = {})           => db.accountingAutoPostRuleDelete(id))
// Bank accounts + statement lines
handleMut('contabilidad:bank-account-create',   (payload)               => db.accountingBankAccountCreate(payload || {}))
handleMut('contabilidad:bank-account-update',   ({ id, ...patch } = {}) => db.accountingBankAccountUpdate(id, patch))
handle   ('contabilidad:bank-account-list',     (params)                => db.accountingBankAccountList(params || {}))
handleMut('contabilidad:bank-account-delete',   ({ id } = {})           => db.accountingBankAccountDelete(id))
handleMut('contabilidad:bank-statement-line-add',    (payload)               => db.accountingBankStatementLineAdd(payload || {}))
handleMut('contabilidad:bank-statement-line-update', ({ id, ...patch } = {}) => db.accountingBankStatementLineUpdate(id, patch))
handle   ('contabilidad:bank-statement-line-list',   (params)                => db.accountingBankStatementLineList(params || {}))
handleMut('contabilidad:bank-statement-line-delete', ({ id } = {})           => db.accountingBankStatementLineDelete(id))
// Fixed assets
handleMut('contabilidad:fixed-asset-create', (payload)               => db.accountingFixedAssetCreate(payload || {}))
handleMut('contabilidad:fixed-asset-update', ({ id, ...patch } = {}) => db.accountingFixedAssetUpdate(id, patch))
handle   ('contabilidad:fixed-asset-list',   (params)                => db.accountingFixedAssetList(params || {}))
handleMut('contabilidad:fixed-asset-delete', ({ id } = {})           => db.accountingFixedAssetDelete(id))
// Retentions emitidas/recibidas
handleMut('contabilidad:retention-emitida-create', (payload)               => db.accountingRetentionEmitidaCreate(payload || {}))
handleMut('contabilidad:retention-emitida-update', ({ id, ...patch } = {}) => db.accountingRetentionEmitidaUpdate(id, patch))
handle   ('contabilidad:retention-emitida-list',   (params)                => db.accountingRetentionEmitidaList(params || {}))
handleMut('contabilidad:retention-emitida-delete', ({ id } = {})           => db.accountingRetentionEmitidaDelete(id))
handleMut('contabilidad:retention-recibida-create', (payload)               => db.accountingRetentionRecibidaCreate(payload || {}))
handleMut('contabilidad:retention-recibida-update', ({ id, ...patch } = {}) => db.accountingRetentionRecibidaUpdate(id, patch))
handle   ('contabilidad:retention-recibida-list',   (params)                => db.accountingRetentionRecibidaList(params || {}))
handleMut('contabilidad:retention-recibida-delete', ({ id } = {})           => db.accountingRetentionRecibidaDelete(id))
// Payroll
handleMut('contabilidad:payroll-period-create', (payload)               => db.accountingPayrollPeriodCreate(payload || {}))
handleMut('contabilidad:payroll-period-update', ({ id, ...patch } = {}) => db.accountingPayrollPeriodUpdate(id, patch))
handle   ('contabilidad:payroll-period-list',   (params)                => db.accountingPayrollPeriodList(params || {}))
handle   ('contabilidad:payroll-period-get',    ({ id } = {})           => db.accountingPayrollPeriodGet(id))
handleMut('contabilidad:payroll-period-delete', ({ id } = {})           => db.accountingPayrollPeriodDelete(id))
handleMut('contabilidad:payroll-line-add',      (payload)               => db.accountingPayrollLineAdd(payload || {}))
handle   ('contabilidad:payroll-line-list',     (params)                => db.accountingPayrollLineList(params || {}))
handleMut('contabilidad:payroll-line-delete',   ({ id } = {})           => db.accountingPayrollLineDelete(id))
// TSS filings
handleMut('contabilidad:tss-filing-create', (payload)               => db.accountingTssFilingCreate(payload || {}))
handleMut('contabilidad:tss-filing-update', ({ id, ...patch } = {}) => db.accountingTssFilingUpdate(id, patch))
handle   ('contabilidad:tss-filing-list',   (params)                => db.accountingTssFilingList(params || {}))
handleMut('contabilidad:tss-filing-delete', ({ id } = {})           => db.accountingTssFilingDelete(id))
// Tasks
handleMut('contabilidad:task-create', (payload)               => db.accountingTaskCreate(payload || {}))
handleMut('contabilidad:task-update', ({ id, ...patch } = {}) => db.accountingTaskUpdate(id, patch))
handle   ('contabilidad:task-list',   (params)                => db.accountingTaskList(params || {}))
handleMut('contabilidad:task-delete', ({ id } = {})           => db.accountingTaskDelete(id))
// Foreign payments (609)
handleMut('contabilidad:foreign-payment-create', (payload)               => db.accountingForeignPaymentCreate(payload || {}))
handleMut('contabilidad:foreign-payment-update', ({ id, ...patch } = {}) => db.accountingForeignPaymentUpdate(id, patch))
handle   ('contabilidad:foreign-payment-list',   (params)                => db.accountingForeignPaymentList(params || {}))
handleMut('contabilidad:foreign-payment-delete', ({ id } = {})           => db.accountingForeignPaymentDelete(id))

// ── Slice 2 — DGII generators (609 / IT-1 / IR-3 / IR-17 / IR-1 / IR-2 / Anexo A)
// Each handler:
//   1. Resolves emisor RNC + razón social from accounting_clients (or businesses settings).
//   2. Pulls the relevant source rows for the period from db.*.
//   3. Calls the corresponding generator from packages/services/dgii-reports.js.
//   4. Returns { filename, content, contentType, summary } to the renderer.
// PDF facsimiles return base64; TXT generators return plain text.
//
// dgii-reports.js is ESM and the rest of electron/ is CommonJS, so we lazy-load
// via dynamic import. Cache the module promise to avoid re-importing per call.
let _dgiiReportsModPromise = null
function _loadDgiiReports() {
  if (!_dgiiReportsModPromise) _dgiiReportsModPromise = import('../packages/services/dgii-reports.js')
  return _dgiiReportsModPromise
}
async function _resolveEmisor(accountingClientId) {
  if (!accountingClientId || !db.accountingClientGet) return { rncEmisor: '', razonSocial: '' }
  const c = await db.accountingClientGet(accountingClientId)
  return {
    rncEmisor:   c?.rnc || c?.cedula || '',
    razonSocial: c?.nombre_comercial || '',
  }
}
function _periodFromArgs({ year, month }) {
  const y = Number(year)
  const m = Number(month)
  return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-31` }
}

handle('contabilidad:gen-609', async ({ businessId, accountingClientId, year, month } = {}) => {
  const mod = await _loadDgiiReports()
  const { rncEmisor, razonSocial } = await _resolveEmisor(accountingClientId)
  const { from, to } = _periodFromArgs({ year, month })
  const foreignPayments = (await db.accountingForeignPaymentList?.({ accountingClientId, dateFrom: from, dateTo: to })) || []
  void businessId
  return mod.generate609({ rncEmisor, razonSocial, year, month, foreignPayments })
})

handle('contabilidad:gen-it1', async ({ businessId, accountingClientId, year, month, ventas, compras, retencionesRecibidas } = {}) => {
  const mod = await _loadDgiiReports()
  const { rncEmisor, razonSocial } = await _resolveEmisor(accountingClientId)
  // Ventas/compras for IT-1 are taken from the same data the existing 606/607
  // IPC consumes. Caller may pre-fetch and pass them in to avoid double query;
  // when omitted we fall back to the 606/607 datasets.
  const v = Array.isArray(ventas)  ? ventas  : ((await db.dgiiVentasByPeriod?.(year, month)) || [])
  const c = Array.isArray(compras) ? compras : ((await db.dgiiComprasByPeriod?.(year, month)) || [])
  const ret = Array.isArray(retencionesRecibidas) ? retencionesRecibidas : []
  void businessId
  return mod.generateIT1({ rncEmisor, razonSocial, year, month, ventas: v, compras: c, retencionesRecibidas: ret })
})

handle('contabilidad:gen-ir3', async ({ businessId, accountingClientId, year, month } = {}) => {
  const mod = await _loadDgiiReports()
  const { rncEmisor, razonSocial } = await _resolveEmisor(accountingClientId)
  // Sum payroll lines across all periods of (accountingClientId, year, month).
  const periods = (await db.accountingPayrollPeriodList?.({ accountingClientId, year })) || []
  const matchingIds = periods.filter(p => Number(p.month) === Number(month)).map(p => p.id)
  let lines = []
  for (const pid of matchingIds) {
    const ll = (await db.accountingPayrollLineList?.({ payrollPeriodId: pid })) || []
    lines = lines.concat(ll)
  }
  void businessId
  return mod.generateIR3({ rncEmisor, razonSocial, year, month, payrollLines: lines })
})

handle('contabilidad:gen-ir17', async ({ businessId, accountingClientId, year, month } = {}) => {
  const mod = await _loadDgiiReports()
  const { rncEmisor, razonSocial } = await _resolveEmisor(accountingClientId)
  const { from, to } = _periodFromArgs({ year, month })
  const retentions = (await db.accountingRetentionEmitidaList?.({ accountingClientId, dateFrom: from, dateTo: to })) || []
  void businessId
  return mod.generateIR17({ rncEmisor, razonSocial, year, month, retentions })
})

handle('contabilidad:gen-ir1', async ({ businessId, accountingClientId, year, journalEntries, retencionesRecibidas, anticiposPagados, deducciones } = {}) => {
  const mod = await _loadDgiiReports()
  const { rncEmisor, razonSocial } = await _resolveEmisor(accountingClientId)
  // Caller may pass synthesized journal_entries (computed) or rely on us to
  // pull from accounting_journal_entries for the year. We default to caller-
  // provided arrays since the COA-aware aggregation lives in renderer.
  void businessId
  return mod.generateIR1({
    rncEmisor, razonSocial, year,
    journalEntries: journalEntries || [],
    retencionesRecibidas: retencionesRecibidas || [],
    anticiposPagados: anticiposPagados || 0,
    deducciones: deducciones || {},
  })
})

handle('contabilidad:gen-ir2', async ({ businessId, accountingClientId, year, resultadoNeto, anticiposPagados, retencionesRecibidas, ajustes } = {}) => {
  const mod = await _loadDgiiReports()
  const { rncEmisor, razonSocial } = await _resolveEmisor(accountingClientId)
  void businessId
  return mod.generateIR2({
    rncEmisor, razonSocial, year,
    resultadoNeto: resultadoNeto || 0,
    anticiposPagados: anticiposPagados || 0,
    retencionesRecibidas: retencionesRecibidas || [],
    ajustes: ajustes || {},
  })
})

handle('contabilidad:gen-anexoa', async ({ businessId, accountingClientId, year, accounts } = {}) => {
  const mod = await _loadDgiiReports()
  const { rncEmisor, razonSocial } = await _resolveEmisor(accountingClientId)
  void businessId
  return mod.generateAnexoA({ rncEmisor, razonSocial, year, accounts: accounts || [] })
})

// ── Queue ─────────────────────────────────────────────────────────────────────
handle('queue:active',       ()                        => db.queueGetActive())
handleMut('queue:updateStatus', ({id,status,washerId})   => db.queueUpdateStatus(id, status, washerId))
handleMut('queue:delete',       ({id,deletedBy})         => db.queueDelete(id, deletedBy), {
  requires: guard.guardMac('queue:delete', ([a]) => a?.id),
})

// ── Commissions ───────────────────────────────────────────────────────────────
handle('commissions:byWasher', ({washerId,from,to}) => db.commissionsGetByWasher(washerId, from, to))
handle('commissions:byPeriod', ({from,to})          => db.commissionsGetByPeriod(from, to))
// v2.14.24 — per-ticket lookup used by Queue.jsx Cobrar-from-Cola to print
// one conduce per washer with the right per-worker commission amount.
handle('commissions:byTicket', ({ticketId})          => db.washerCommissionsByTicket(ticketId))
handleMut('commissions:markPaid', (ids)                => db.commissionsMarkPaid(ids))
handleMut('commissions:markPaidByPeriod', (args)       => db.commissionsMarkPaidByPeriod(args))
handleMut('commissions:create',       (data)           => db.washerCommissionCreate(data))
handleMut('sellerCommissions:create', (data)           => db.sellerCommissionCreate(data))
handleMut('cajeroCommissions:create', (data)           => db.cajeroCommissionCreate(data))
handle('sellerCommissions:bySeller', ({sellerId,from,to}) => db.sellerCommissionsBySeller(sellerId, from, to))
handle('sellerCommissions:byPeriod', ({from,to})          => db.sellerCommissionsByPeriod(from, to))
handleMut('sellerCommissions:markPaid', (ids)                => db.sellerCommissionsMarkPaid(ids))
handleMut('sellerCommissions:markPaidByPeriod', (args)       => db.sellerCommissionsMarkPaidByPeriod(args))
handle('cajeroCommissions:byCajero', ({cajeroId,from,to}) => db.cajeroCommissionsByCajero(cajeroId, from, to))
handle('cajeroCommissions:byPeriod', ({from,to})          => db.cajeroCommissionsByPeriod(from, to))
handleMut('cajeroCommissions:markPaid', (ids)                => db.cajeroCommissionsMarkPaid(ids))
handleMut('cajeroCommissions:markPaidByPeriod', (args)       => db.cajeroCommissionsMarkPaidByPeriod(args))

// ── Cuadre de Caja ────────────────────────────────────────────────────────────
handleMut('cuadre:create',  (data)    => db.cuadreCreate(data))
handle('cuadre:history', ()        => db.cuadreGetHistory())
handle('cuadre:list',    (filters) => db.cuadreList(filters || {}))
handle('cuadre:daily',   (date)    => db.cuadreDailySummary(date))
handle('cuadre:getOpen',    (data)   => db.cuadreGetOpen(data || {}))
handleMut('cuadre:openShift', (data) => db.cuadreOpenShift(data || {}))

// ── NCF ───────────────────────────────────────────────────────────────────────
handle('ncf:sequences',        ()            => db.ncfGetSequences())
handleMut('ncf:next',             (type)        => db.ncfGetNext(type))
handleMut('ncf:rollback',         (ncf)         => db.ncfSequenceRollback(ncf))
handleMut('ncf:updateSequence',   ({type,...d}) => db.ncfUpdateSequence(type, d))

// ── Caja Chica ────────────────────────────────────────────────────────────────
handle('cajachica:all',          ()               => db.cajaChicaGetAll())
handleMut('cajachica:create',       (data)           => db.cajaChicaCreate(data))
handleMut('cajachica:updateStatus', ({id,status,by}) => db.cajaChicaUpdateStatus(id, status, by))

// ── Notas de Crédito ──────────────────────────────────────────────────────────
handle('notas:all',    ()     => db.notasGetAll())
handleMut('notas:create', (data) => db.notaCreate(data), {
  requires: guard.guardMac('notas:create', ([a]) => a?.original_ticket_id || null),
})

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
handleMut('inventory:adjust',       ({id, delta, notes, userId})   => db.inventoryAdjust(id, delta, notes, userId), {
  requires: guard.guardMac('inv_adjust', ([a]) => a?.id),
})
handle('inventory:transactions', ({id})                         => db.inventoryTransactions(id))
handle('inventory:lookupSku',    (sku)                          => db.inventoryLookupBySku(sku))
handle('inventory:search',       (query)                        => db.inventorySearch(query))
handle('inventory:lowStockCount', ()                             => db.inventoryLowStockCount())
handle('inventory:oversells:list', (args)                        => db.inventoryOversellsList(args || {}))

// ── v2.16.3 — Carnicería hardening ────────────────────────────────────────────
handle    ('carniceria:cortes:list',         ()     => db.carniceriaCorteList())
handleMut ('carniceria:cortes:create',       (data) => db.carniceriaCorteCreate(data || {}))
handleMut ('carniceria:cortes:update',       (data) => db.carniceriaCorteUpdate(data || {}))
handleMut ('carniceria:cortes:remove',       (id)   => { db.carniceriaCorteDelete(id); return true })
handle    ('carniceria:freshness:list',      ()     => db.carniceriaFreshnessList())
handleMut ('carniceria:freshness:create',    (data) => db.carniceriaFreshnessCreate(data || {}))
handleMut ('carniceria:freshness:applyDiscount', (args) => db.carniceriaFreshnessApplyDiscount(args || {}))
handleMut ('carniceria:discards:create',     (data) => db.carniceriaDiscardCreate(data || {}))
handle    ('carniceria:discards:list',       (args) => db.carniceriaDiscardList(args || {}))
handle    ('carniceria:recurring:list',      ()     => db.carniceriaRecurringList())
handleMut ('carniceria:recurring:create',    (data) => db.carniceriaRecurringCreate(data || {}))
handleMut ('carniceria:recurring:update',    (data) => db.carniceriaRecurringUpdate(data || {}))
handleMut ('carniceria:recurring:remove',    (id)   => { db.carniceriaRecurringDelete(id); return true })
handleMut ('carniceria:recurring:markSent',  (args) => db.carniceriaRecurringMarkSent(args || {}))
handle    ('carniceria:scales:list',         ()     => db.carniceriaScalesList())
handleMut ('carniceria:scales:create',       (data) => db.carniceriaScalesCreate(data || {}))
handleMut ('carniceria:scales:update',       (data) => db.carniceriaScalesUpdate(data || {}))
handleMut ('carniceria:scales:remove',       (id)   => { db.carniceriaScalesDelete(id); return true })
handleMut ('carniceria:scales:setActiveDefault', (id) => db.carniceriaScalesSetActiveDefault(id))
handle    ('carniceria:resumen:get',         ()     => db.carniceriaResumenGet())
handle    ('carniceria:discounts:activeFor',  (args) => db.carniceriaActiveDiscounts(args || {}))

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
