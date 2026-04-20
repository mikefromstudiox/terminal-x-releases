/**
 * key-vault.js — derives + caches the SQLite encryption key for Terminal X.
 *
 * Strategy:
 *   - HWID (stable across app reinstalls on same machine) is the primary entropy.
 *   - A 32-byte random "app salt" is generated on first boot and persisted via
 *     Electron safeStorage (DPAPI / Keychain / libsecret). If safeStorage is
 *     unavailable we fall back to a plaintext salt file with 0600 perms — the
 *     key is still rooted in HWID, so the attacker needs BOTH the salt file
 *     AND the MAC/hostname of the origin machine to decrypt an exfiltrated DB.
 *   - Final key = HKDF-SHA256(ikm=HWID, salt=appSalt, info="terminal-x-sqlcipher",
 *     length=32) → hex → passed to `PRAGMA key="x'<hex>'"` (raw-key form).
 *
 * Raw-key form (64 hex chars prefixed x'...') is used deliberately:
 *   - Bypasses SQLCipher PBKDF2 rounds (HKDF already did the KDF work).
 *   - Deterministic across restarts → no migration needed when we change KDF
 *     params, only when we change salt or HWID (neither should happen).
 */

const crypto = require('crypto')
const fs     = require('fs')
const path   = require('path')

let cachedKey = null

function hkdf(ikm, salt, info, length = 32) {
  // Node's crypto.hkdfSync is available on Node 15+ (Electron 41 ships Node 20).
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(ikm), salt, Buffer.from(info), length))
}

function loadOrCreateSalt(userDataPath) {
  const saltPath = path.join(userDataPath, '.dbsalt')
  let safeStorage = null
  try { safeStorage = require('electron').safeStorage } catch {}

  if (fs.existsSync(saltPath)) {
    const raw = fs.readFileSync(saltPath)
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      try { return safeStorage.decryptString(raw) ? Buffer.from(safeStorage.decryptString(raw), 'hex') : raw } catch { return raw }
    }
    return raw
  }

  const salt = crypto.randomBytes(32)
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const enc = safeStorage.encryptString(salt.toString('hex'))
      fs.writeFileSync(saltPath, enc, { mode: 0o600 })
    } else {
      fs.writeFileSync(saltPath, salt, { mode: 0o600 })
    }
  } catch (err) {
    console.warn('[key-vault] salt persist failed:', err.message)
  }
  return salt
}

/**
 * getDbKey(userDataPath, hwid) -> hex string (64 chars) for PRAGMA key raw form.
 */
function getDbKey(userDataPath, hwid) {
  if (cachedKey) return cachedKey
  if (!hwid) throw new Error('[key-vault] HWID required')
  const salt = loadOrCreateSalt(userDataPath)
  const key  = hkdf(String(hwid), salt, 'terminal-x-sqlcipher', 32)
  cachedKey = key.toString('hex')
  return cachedKey
}

function clearCache() { cachedKey = null }

module.exports = { getDbKey, clearCache }
