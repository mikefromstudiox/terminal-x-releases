/**
 * GET /fe/autenticacion/api/semilla
 * Returns an unsigned XML seed for the emisor to sign with their .p12
 * and post back to /validarcertificado.
 *
 * v2.13.0 (architectural correction, 2026-04-20):
 * Persists the issued <valor> in dgii_seed_nonces as OUTSTANDING so the
 * validarcertificado endpoint can gate verification on "we issued this".
 * This is the first half of the single-use nonce contract; the second
 * half (consume) runs in validarcertificado on successful verify.
 *
 * Persist is best-effort + fail-open — a Supabase outage must never
 * brick seed issuance.
 */
import crypto from 'crypto'
import { persistIssuedNonce } from '../../lib/dgii-seed-verify.js'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const randomValue = crypto.randomBytes(128).toString('base64')
  const date = new Date()
  const offset = -4
  const localDate = new Date(date.getTime() + offset * 3600 * 1000)
  const formattedDate = localDate.toISOString().replace('Z', '-04:00')

  // Fire-and-await (cheap; Supabase upsert ~50–120ms) — we'd rather emit
  // a persisted nonce than hand out a seed that can't be validated later.
  // The helper itself fails open on Supabase outage so GET never 500s.
  try { await persistIssuedNonce(randomValue) } catch { /* swallow */ }

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<SemillaModel xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <valor>${randomValue}</valor>
    <fecha>${formattedDate}</fecha>
</SemillaModel>`

  res.setHeader('Content-Type', 'application/xml')
  res.status(200).send(xml)
}
