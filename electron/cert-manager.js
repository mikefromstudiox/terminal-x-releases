/**
 * cert-manager.js — Digital certificate management for DGII direct e-CF
 *
 * Handles .p12 (PKCS12) certificates from Viafirma or any DGII-authorized CA.
 * Stores certificate in userData, passphrase encrypted via Electron safeStorage.
 *
 * Usage:
 *   const certMgr = require('./cert-manager')
 *   certMgr.init(app)
 *   const { privateKey, certificate, serialNumber } = certMgr.loadCert()
 */

const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')
const forge  = require('node-forge')
const { safeStorage } = require('electron')

let _app = null
let _certDir = null
let _db = null

function init(app, db) {
  _app = app
  _db = db || null
  _certDir = path.join(app.getPath('userData'), 'certs')
  if (!fs.existsSync(_certDir)) fs.mkdirSync(_certDir, { recursive: true })
}

/** Allow main.js to attach the DB handle after DB is ready (init may run earlier). */
function attachDb(db) { _db = db }

/**
 * Snapshot the currently installed cert (if any) + the just-installed cert
 * into local ecf_cert_history so sync.js pushes the audit row to Supabase.
 * Best-effort — never throws. No-op if DB not attached yet.
 */
function _appendHistoryLocal({ cert, rotationReason, prevInfo, actor }) {
  try {
    if (!_db || typeof _db.rawPrepare !== 'function') return
    const certDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary')
    const sha256Fp = crypto.createHash('sha256').update(certDer).digest('hex')
    const row = {
      supabase_id:          crypto.randomUUID(),
      business_id:          null, // sync layer stamps business_id at push time
      cert_serial:          cert.serialNumber || null,
      subject_cn:           cert.subject.getField('CN')?.value || null,
      subject_rnc:          null,
      issued_at:            cert.validity.notBefore ? cert.validity.notBefore.toISOString() : null,
      expires_at:           cert.validity.notAfter  ? cert.validity.notAfter.toISOString()  : null,
      installed_at:         new Date().toISOString(),
      installed_by_user_id: actor?.supabase_id || null,
      installed_by_name:    actor?.name || null,
      installed_from:       'desktop',
      rotation_reason:      rotationReason,
      sha256_fingerprint:   sha256Fp,
      prev_serial:          prevInfo?.serialNumber || null,
      prev_expires_at:      prevInfo?.expiry || null,
    }
    _db.ecfCertHistoryInsert?.(row)
  } catch (e) {
    console.error('[cert-manager] history append failed:', e.message)
  }
}

/**
 * installCert — copy .p12 into userData/certs/, encrypt passphrase via safeStorage.
 * @param {string} sourcePath — full path to the .p12 file
 * @param {string} passphrase — certificate passphrase
 * @returns {{ ok: boolean, serialNumber?: string, subject?: string, expiry?: string, error?: string }}
 */
function installCert(sourcePath, passphrase, opts = {}) {
  if (!_app) throw new Error('cert-manager not initialised — call init(app) first')

  const raw = fs.readFileSync(sourcePath)
  const p12Der = forge.util.decode64(raw.toString('base64'))

  let p12
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(p12Der), false, passphrase)
  } catch (err) {
    return { ok: false, error: 'Contraseña incorrecta o archivo .p12 inválido' }
  }

  // Extract certificate
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const certBag = certBags[forge.pki.oids.certBag]
  if (!certBag || certBag.length === 0) {
    return { ok: false, error: 'No se encontró certificado en el archivo .p12' }
  }
  const cert = certBag[0].cert

  // Extract private key
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
  const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]
  if (!keyBag || keyBag.length === 0) {
    return { ok: false, error: 'No se encontró llave privada en el archivo .p12' }
  }

  const serialNumber = cert.serialNumber
  const subject = cert.subject.getField('CN')?.value || ''
  const expiry = cert.validity.notAfter.toISOString()

  // Snapshot the OUTGOING cert's final state BEFORE we overwrite the .p12 on
  // disk. This is the whole point of the audit trail — we must record the
  // rotation event while we still have both old and new cert in hand.
  let prevInfo = null
  try { prevInfo = getCertInfo() } catch (e) { console.warn('[cert-manager] prevInfo lookup failed (rotation will mark as initial):', e?.message) }
  const hadPrev = prevInfo && prevInfo.installed && prevInfo.serialNumber
  let rotationReason = 'initial'
  if (hadPrev) {
    if (prevInfo.serialNumber !== serialNumber) {
      // Different serial → compare subject CN to separate renewal vs replacement.
      const prevSubject = prevInfo.subject || ''
      rotationReason = (prevSubject && subject && prevSubject !== subject) ? 'replacement' : 'renewal'
    } else {
      rotationReason = 'renewal'
    }
  }

  // Copy .p12 to userData/certs/
  const destPath = path.join(_certDir, 'dgii-cert.p12')
  fs.copyFileSync(sourcePath, destPath)

  // Encrypt passphrase with safeStorage. v2.16.3: refuse to fall back to
  // base64 (effectively cleartext). If the host OS lacks a working keychain
  // (Linux without libsecret, locked-down VM, Wine, etc.) we surface a hard
  // error and audit it as critical — the cert install must NOT silently
  // downgrade to plaintext-on-disk.
  if (!safeStorage.isEncryptionAvailable()) {
    try {
      _db?.activityLogRecord?.({
        event_type:  'cert_safestorage_unavailable',
        severity:    'critical',
        target_type: 'dgii_cert',
        target_name: subject || serialNumber || 'dgii-cert.p12',
        reason:      'safeStorage.isEncryptionAvailable() returned false — refused to persist passphrase as base64',
        metadata:    { serialNumber, subject, expiry, platform: process.platform },
      })
    } catch {}
    throw new Error('Almacenamiento seguro del sistema no disponible. No se puede guardar la contraseña del certificado en este dispositivo.')
  }
  const storePath = path.join(_app.getPath('userData'), 'safe_store.json')
  let store = {}
  try { store = JSON.parse(fs.readFileSync(storePath, 'utf8')) } catch {}
  store['dgii_cert_pass'] = { enc: true, data: safeStorage.encryptString(passphrase).toString('base64') }
  fs.writeFileSync(storePath, JSON.stringify(store))

  // Append audit row for the rotation (desktop-originated).
  _appendHistoryLocal({ cert, rotationReason, prevInfo, actor: opts.actor || null })

  return { ok: true, serialNumber, subject, expiry, rotationReason }
}

/**
 * loadCert — reads the installed .p12 and returns crypto objects ready for signing.
 * @returns {{ privateKeyPem: string, certificatePem: string, certificateDer: Buffer, serialNumber: string, subject: string, expiry: string }}
 */
function loadCert() {
  if (!_app) throw new Error('cert-manager not initialised')

  const certPath = path.join(_certDir, 'dgii-cert.p12')
  if (!fs.existsSync(certPath)) throw new Error('Certificado no instalado — vaya a Configuración > e-CF')

  // Read passphrase from safeStorage
  const storePath = path.join(_app.getPath('userData'), 'safe_store.json')
  let store = {}
  try { store = JSON.parse(fs.readFileSync(storePath, 'utf8')) } catch {}
  const entry = store['dgii_cert_pass']
  if (!entry) throw new Error('Contraseña del certificado no encontrada')

  let passphrase
  try {
    if (entry.enc) {
      passphrase = safeStorage.decryptString(Buffer.from(entry.data, 'base64'))
    } else {
      passphrase = Buffer.from(entry.data, 'base64').toString('utf8')
    }
  } catch {
    throw new Error('No se pudo descifrar la contraseña del certificado')
  }

  const raw = fs.readFileSync(certPath)
  const p12Der = forge.util.decode64(raw.toString('base64'))
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(p12Der), false, passphrase)

  // Extract certificate
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const cert = certBags[forge.pki.oids.certBag][0].cert
  const certificatePem = forge.pki.certificateToPem(cert)
  const certificateDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary')

  // Extract private key
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
  const privateKey = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0].key
  const privateKeyPem = forge.pki.privateKeyToPem(privateKey)

  return {
    privateKeyPem,
    certificatePem,
    certificateDer,
    serialNumber: cert.serialNumber,
    subject: cert.subject.getField('CN')?.value || '',
    expiry: cert.validity.notAfter.toISOString(),
  }
}

/**
 * getCertInfo — returns certificate metadata without loading the private key.
 * @returns {{ installed: boolean, serialNumber?: string, subject?: string, expiry?: string, expired?: boolean }}
 */
function getCertInfo() {
  if (!_app) return { installed: false }
  const certPath = path.join(_certDir, 'dgii-cert.p12')
  if (!fs.existsSync(certPath)) return { installed: false }

  // v2.16.3: detect legacy base64 passphrase (pre-hardening installs) so the
  // UI can prompt the user to re-enter and migrate to safeStorage.
  let legacyPassphrase = false
  try {
    const storePath = path.join(_app.getPath('userData'), 'safe_store.json')
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'))
    if (store?.dgii_cert_pass && store.dgii_cert_pass.enc === false) legacyPassphrase = true
  } catch {}

  try {
    const { serialNumber, subject, expiry } = loadCert()
    return {
      installed: true,
      serialNumber,
      subject,
      expiry,
      expired: new Date(expiry) < new Date(),
      legacyPassphrase,
    }
  } catch {
    return { installed: true, error: 'No se pudo leer el certificado', legacyPassphrase }
  }
}

/**
 * validateForRNC — checks that the cert SN or subject contains the given RNC.
 */
function validateForRNC(rnc) {
  const info = loadCert()
  const clean = String(rnc).replace(/[-\s]/g, '')
  const snMatch = info.serialNumber.includes(clean)
  const subMatch = info.subject.includes(clean)
  return { valid: snMatch || subMatch, serialNumber: info.serialNumber, subject: info.subject }
}

module.exports = { init, attachDb, installCert, loadCert, getCertInfo, validateForRNC }
