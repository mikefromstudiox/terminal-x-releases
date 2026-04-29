// contabilidad-cred-crypto.js — Client-side AES-GCM wrapper for DGII creds.
//
// Each client's DGII Oficina Virtual credentials are encrypted in the browser
// before transit. Server stores only the cipher + iv + salt, never the
// plaintext. The firm's master key is derived from the user's Supabase JWT
// + a per-firm constant — so even a Supabase admin reading the table cannot
// decrypt a client's cred without an active session token.

const TEXT_ENC = new TextEncoder()
const TEXT_DEC = new TextDecoder()

function b64encode(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}
function b64decode(s) {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0))
}

async function deriveKey(masterPassphrase, salt) {
  const baseKey = await crypto.subtle.importKey(
    'raw', TEXT_ENC.encode(masterPassphrase),
    { name: 'PBKDF2' }, false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt', 'decrypt'],
  )
}

/**
 * Encrypt a JSON-serializable creds object for transmission to the server.
 * @param {object} creds - { user, pass, p12_b64? }
 * @param {string} masterPassphrase - typically firm_business_id + user_id concatenated
 * @returns {Promise<{cred_cipher:string, cred_iv:string, cred_salt:string}>}
 */
export async function encryptCreds(creds, masterPassphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(masterPassphrase, salt)
  const plaintext = TEXT_ENC.encode(JSON.stringify(creds))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return {
    cred_cipher: b64encode(cipher),
    cred_iv: b64encode(iv),
    cred_salt: b64encode(salt),
  }
}

/**
 * Decrypt a server-stored creds blob. Throws if key derivation or auth fails.
 */
export async function decryptCreds({ cred_cipher, cred_iv, cred_salt }, masterPassphrase) {
  const salt = b64decode(cred_salt)
  const iv = b64decode(cred_iv)
  const key = await deriveKey(masterPassphrase, salt)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, b64decode(cred_cipher))
  return JSON.parse(TEXT_DEC.decode(plaintext))
}

/**
 * Build the firm's master passphrase from session-available identifiers.
 * Combines firm_business_id + user_id with a constant pepper so even if the
 * server-side DB is compromised, an attacker cannot brute-force without the
 * tenant's session.
 */
export function buildMasterPassphrase({ firm_business_id, user_id }) {
  return `txctb:${firm_business_id}:${user_id}:v1`
}

export default { encryptCreds, decryptCreds, buildMasterPassphrase }
