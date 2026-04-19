/**
 * managerAuthToken.js — token + hash utilities for Manager Authorization Cards.
 *
 * Why this shape:
 *  - 20-char raw alphabet string → ~100 bits of entropy (≥ 2^99). Uncrackable.
 *  - Alphabet excludes 0/O/1/I/L/etc. → safe to read + type if scanner fails.
 *  - Matches license-key convention (web/api/signup/provision.js).
 *  - Raw chars get encoded as Code128 (no dashes) for clean scan.
 *  - Display groups of 4 with dashes for human fallback typing.
 *  - Hash = SHA-256 hex of the raw (upper-cased) 20 chars.
 *
 * Environment:
 *  - ESM-first. Works in both browser and Node/Electron via `crypto.getRandomValues`
 *    (browser + Node ≥ 19 globalThis.crypto) and `crypto.subtle` for SHA-256.
 *  - For Electron main process (CommonJS), use the tiny `hashTokenSync(token)` shim
 *    re-exported from electron/database.js which delegates to Node's `crypto`.
 */

export const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const TOKEN_LENGTH   = 20

function getRng() {
  // Prefer WebCrypto (browser / web). Fall back to node's global crypto.
  const g = typeof globalThis !== 'undefined' ? globalThis : {}
  if (g.crypto && typeof g.crypto.getRandomValues === 'function') return g.crypto
  throw new Error('managerAuthToken: no CSPRNG available')
}

/** Generate a 20-char raw token (no dashes). Cryptographically random. */
export function generateToken() {
  const rng  = getRng()
  const buf  = new Uint8Array(TOKEN_LENGTH)
  rng.getRandomValues(buf)
  const A    = TOKEN_ALPHABET
  const L    = A.length
  // Rejection would be overkill here — 32 cleanly divides 256 leaves 0 bias
  // for indices 0..31 mapped via `byte % 32` on uniformly random bytes ONLY
  // when 256 % 32 === 0 (it does). So modulo is unbiased.
  let out = ''
  for (let i = 0; i < TOKEN_LENGTH; i++) out += A[buf[i] % L]
  return out
}

/** Format a raw token as XXXX-XXXX-XXXX-XXXX-XXXX for human display. */
export function formatToken(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return s.match(/.{1,4}/g)?.join('-') || s
}

/** Strip dashes / whitespace — whatever the cashier types becomes canonical raw. */
export function normalizeToken(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** SHA-256 hex of the normalized token. Browser / Web Crypto path. */
export async function hashToken(token) {
  const raw = normalizeToken(token)
  const bytes = new TextEncoder().encode(raw)
  const digest = await getRng().subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
