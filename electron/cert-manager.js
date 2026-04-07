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

function init(app) {
  _app = app
  _certDir = path.join(app.getPath('userData'), 'certs')
  if (!fs.existsSync(_certDir)) fs.mkdirSync(_certDir, { recursive: true })
}

/**
 * installCert — copy .p12 into userData/certs/, encrypt passphrase via safeStorage.
 * @param {string} sourcePath — full path to the .p12 file
 * @param {string} passphrase — certificate passphrase
 * @returns {{ ok: boolean, serialNumber?: string, subject?: string, expiry?: string, error?: string }}
 */
function installCert(sourcePath, passphrase) {
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

  // Copy .p12 to userData/certs/
  const destPath = path.join(_certDir, 'dgii-cert.p12')
  fs.copyFileSync(sourcePath, destPath)

  // Encrypt passphrase with safeStorage
  const storePath = path.join(_app.getPath('userData'), 'safe_store.json')
  let store = {}
  try { store = JSON.parse(fs.readFileSync(storePath, 'utf8')) } catch {}
  if (safeStorage.isEncryptionAvailable()) {
    store['dgii_cert_pass'] = { enc: true, data: safeStorage.encryptString(passphrase).toString('base64') }
  } else {
    store['dgii_cert_pass'] = { enc: false, data: Buffer.from(passphrase).toString('base64') }
  }
  fs.writeFileSync(storePath, JSON.stringify(store))

  return { ok: true, serialNumber, subject, expiry }
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

  try {
    const { serialNumber, subject, expiry } = loadCert()
    return {
      installed: true,
      serialNumber,
      subject,
      expiry,
      expired: new Date(expiry) < new Date(),
    }
  } catch {
    return { installed: true, error: 'No se pudo leer el certificado' }
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

module.exports = { init, installCert, loadCert, getCertInfo, validateForRNC }
