/**
 * dgii-seed-verify.js — verify an emisor-signed SemillaModel XML.
 *
 * Architectural correction (2026-04-20, v2.13.0 revision):
 * ---------------------------------------------------------
 * DGII does NOT sign seeds. The flow is:
 *   1. Our /api/fe/semilla issues an UNSIGNED seed (<valor>, <fecha>).
 *   2. The emisor signs the seed with THEIR .p12 (RSA-SHA256 XMLDSIG).
 *   3. Emisor posts the signed XML to /api/fe/validarcertificado.
 *   4. We must verify:
 *        (a) the nonce (<valor>) was issued by us and not yet consumed,
 *        (b) fecha clock-skew is within tolerance,
 *        (c) the XMLDSIG signature is cryptographically valid against
 *            the cert embedded in <KeyInfo><X509Certificate>,
 *        (d) the emisor cert is inside its validity window,
 *        (e) (v2.14 TODO) the emisor cert chains to a trusted Dominican CA.
 *
 * The previously-pinned DGII_PUBLIC_CERT_PEM env was fundamentally
 * wrong — there is no DGII seed-signing cert. Pinning removed.
 *
 * Exports:
 *   verifySeed(signedXml)  — crypto + structural checks; returns
 *                            { valor, fecha, emisorCert }
 *   requireIssuedNonce(v)  — gate: we-issued-this check
 *   consumeNonce(v)        — atomic single-use transition
 *   persistIssuedNonce(v)  — called from /semilla to register issuance
 *
 * Error codes (thrown as Error.message, opaque to clients):
 *   SEED_MALFORMED          structural/parse failure
 *   SEED_EXPIRED            fecha > ±10 min skew
 *   SIGNATURE_MISSING       no <Signature> node
 *   EMISOR_CERT_MISSING     no <X509Certificate> in KeyInfo
 *   EMISOR_CERT_INVALID     cert parse failure
 *   EMISOR_CERT_EXPIRED     cert notBefore/notAfter out of range
 *   SIGNATURE_INVALID       XMLDSIG verify failed
 *   SEED_NOT_ISSUED         nonce absent or not ours
 *   SEED_REPLAY_OR_UNKNOWN  atomic consume matched 0 rows
 *
 * Fail-open policy on Supabase outages is retained for infra resilience
 * (explicit console.warn on the fail-open branch so SRE sees it).
 *
 * Escape hatch: DGII_VERIFY_OPEN=1 disables crypto+nonce gates entirely
 * (emergency bypass; default strict).
 */
import crypto from 'crypto'
import { SignedXml } from 'xml-crypto'
import { DOMParser } from '@xmldom/xmldom'
import { createClient } from '@supabase/supabase-js'

const SKEW_MS = 10 * 60 * 1000
const OPEN = process.env.DGII_VERIFY_OPEN === '1'

// ────────────────────────────────────────────────────────────────────────
// Supabase client (service role) — shared across helpers
// ────────────────────────────────────────────────────────────────────────
function client() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// ────────────────────────────────────────────────────────────────────────
// Nonce lifecycle
// ────────────────────────────────────────────────────────────────────────
/**
 * Called from /api/fe/semilla at issuance. Registers the freshly-minted
 * <valor> as OUTSTANDING (consumed_at NULL, issued_at now()). Idempotent —
 * a collision on the PK valor would only happen on a 1-in-2^1024 RNG
 * coincidence, but we treat it as a non-fatal already-issued no-op.
 */
export async function persistIssuedNonce(valor) {
  const sb = client()
  if (!sb) {
    console.warn('[dgii-seed-verify] persistIssuedNonce: Supabase unavailable — fail open')
    return
  }
  try {
    const { error } = await sb.from('dgii_seed_nonces').insert({
      valor,
      issued_at: new Date().toISOString(),
      consumed_at: null,
    })
    if (error && !(error.code === '23505' || /duplicate/i.test(error.message || ''))) {
      console.warn('[dgii-seed-verify] persistIssuedNonce non-fatal error:', error.code)
    }
  } catch (e) {
    console.warn('[dgii-seed-verify] persistIssuedNonce threw — fail open:', e?.message)
  }
}

/**
 * Gate: did WE issue this nonce, and is it still outstanding? Separate
 * call from consume so we can return distinct error codes.
 * Fail-open on Supabase outage (logged).
 */
export async function requireIssuedNonce(valor) {
  if (OPEN) return
  const sb = client()
  if (!sb) {
    console.warn('[dgii-seed-verify] requireIssuedNonce: Supabase unavailable — fail open')
    return
  }
  try {
    const { data, error } = await sb
      .from('dgii_seed_nonces')
      .select('valor, consumed_at')
      .eq('valor', valor)
      .maybeSingle()
    if (error) {
      console.warn('[dgii-seed-verify] requireIssuedNonce error — fail open:', error.code)
      return
    }
    if (!data) throw new Error('SEED_NOT_ISSUED')
    if (data.consumed_at) throw new Error('SEED_REPLAY_OR_UNKNOWN')
  } catch (e) {
    if (e?.message === 'SEED_NOT_ISSUED' || e?.message === 'SEED_REPLAY_OR_UNKNOWN') throw e
    console.warn('[dgii-seed-verify] requireIssuedNonce threw — fail open:', e?.message)
  }
}

/**
 * Atomic single-use consume. UPDATE … WHERE consumed_at IS NULL so two
 * racing verifiers can't both succeed — first write wins, second matches
 * 0 rows and is rejected.
 */
export async function consumeNonce(valor) {
  if (OPEN) return
  const sb = client()
  if (!sb) {
    console.warn('[dgii-seed-verify] consumeNonce: Supabase unavailable — fail open')
    return
  }
  try {
    const { data, error } = await sb
      .from('dgii_seed_nonces')
      .update({ consumed_at: new Date().toISOString() })
      .eq('valor', valor)
      .is('consumed_at', null)
      .select('valor')
    if (error) {
      console.warn('[dgii-seed-verify] consumeNonce error — fail open:', error.code)
      return
    }
    if (!data || data.length === 0) throw new Error('SEED_REPLAY_OR_UNKNOWN')
  } catch (e) {
    if (e?.message === 'SEED_REPLAY_OR_UNKNOWN') throw e
    console.warn('[dgii-seed-verify] consumeNonce threw — fail open:', e?.message)
  }
}

// ────────────────────────────────────────────────────────────────────────
// XML / crypto helpers
// ────────────────────────────────────────────────────────────────────────
function parseDoc(xml) {
  return new DOMParser({
    errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} },
  }).parseFromString(xml, 'text/xml')
}

function firstEl(doc, localName, ns) {
  const nodes = ns ? doc.getElementsByTagNameNS(ns, localName) : doc.getElementsByTagName(localName)
  return nodes && nodes.length ? nodes[0] : null
}

function textOf(el) {
  return el && el.firstChild ? String(el.firstChild.nodeValue || '').trim() : ''
}

/**
 * Convert a base64 DER X.509 body (as found inside <X509Certificate>) to PEM.
 */
function derBase64ToPem(b64) {
  const clean = b64.replace(/\s+/g, '')
  const lines = clean.match(/.{1,64}/g) || []
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`
}

/**
 * Parse emisor cert, validate window, extract identity fields.
 * Returns { pem, subject, issuer, rnc, notBefore, notAfter, fingerprint }.
 */
function parseEmisorCert(b64Der) {
  let pem
  try {
    pem = derBase64ToPem(b64Der)
  } catch {
    throw new Error('EMISOR_CERT_INVALID')
  }

  let cert
  try {
    cert = new crypto.X509Certificate(pem)
  } catch {
    throw new Error('EMISOR_CERT_INVALID')
  }

  const now = Date.now()
  const notBefore = Date.parse(cert.validFrom)
  const notAfter = Date.parse(cert.validTo)
  if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter)) {
    throw new Error('EMISOR_CERT_INVALID')
  }
  if (now < notBefore || now > notAfter) throw new Error('EMISOR_CERT_EXPIRED')

  // RNC extraction — Dominican DGII certs put the RNC in SERIALNUMBER
  // (OID 2.5.4.5) or occasionally in CN. Try SERIALNUMBER first.
  const subject = cert.subject || ''
  let rnc = null
  const serialMatch = subject.match(/(?:^|[,\n])\s*(?:serialNumber|2\.5\.4\.5)\s*=\s*([0-9]{9,11})/i)
  if (serialMatch) rnc = serialMatch[1]
  if (!rnc) {
    // Fallback: scan any 9-or-11 digit run in the subject
    const any = subject.match(/\b(\d{9}|\d{11})\b/)
    if (any) rnc = any[1]
  }

  return {
    pem,
    subject,
    issuer: cert.issuer || '',
    rnc,
    notBefore: cert.validFrom,
    notAfter: cert.validTo,
    fingerprint: cert.fingerprint256,
  }
}

/**
 * Primary verifier. Structural + clock + crypto + cert-window. Does NOT
 * touch Supabase — nonce gate is caller's responsibility via
 * requireIssuedNonce / consumeNonce.
 */
export function verifySeed(signedXmlString) {
  if (!signedXmlString || typeof signedXmlString !== 'string') {
    throw new Error('SEED_MALFORMED')
  }

  const doc = parseDoc(signedXmlString)

  // Structural fields
  const valorEl = firstEl(doc, 'valor')
  const fechaEl = firstEl(doc, 'fecha')
  if (!valorEl || !fechaEl) throw new Error('SEED_MALFORMED')

  const valor = textOf(valorEl)
  const fecha = textOf(fechaEl)
  if (!valor || valor.length < 64) throw new Error('SEED_MALFORMED')

  // Clock skew (±10 min)
  const fechaMs = Date.parse(fecha)
  if (!Number.isFinite(fechaMs)) throw new Error('SEED_MALFORMED')
  if (Math.abs(Date.now() - fechaMs) > SKEW_MS) throw new Error('SEED_EXPIRED')

  if (OPEN) {
    return { valor, fecha, emisorCert: { rnc: null, subject: '', issuer: '', notBefore: null, notAfter: null, fingerprint: null } }
  }

  // Signature node
  const sigNs = 'http://www.w3.org/2000/09/xmldsig#'
  const sigNodes = doc.getElementsByTagNameNS(sigNs, 'Signature')
  if (!sigNodes || sigNodes.length === 0) throw new Error('SIGNATURE_MISSING')
  const signatureNode = sigNodes[0]

  // Embedded cert
  const x509Nodes = signatureNode.getElementsByTagNameNS(sigNs, 'X509Certificate')
  if (!x509Nodes || x509Nodes.length === 0) throw new Error('EMISOR_CERT_MISSING')
  const certB64 = textOf(x509Nodes[0])
  if (!certB64) throw new Error('EMISOR_CERT_MISSING')

  const emisorCert = parseEmisorCert(certB64)

  // xml-crypto v6 — verify against the self-embedded emisor cert. This
  // proves crypto integrity (XML wasn't tampered after sign) but not
  // identity (anyone can embed any cert they hold). v2.14 adds chain
  // validation to a pinned Dominican CA trust root.
  const verifier = new SignedXml({ publicCert: emisorCert.pem })
  verifier.loadSignature(signatureNode)
  let ok = false
  try { ok = verifier.checkSignature(signedXmlString) } catch { ok = false }
  if (!ok) throw new Error('SIGNATURE_INVALID')

  return { valor, fecha, emisorCert }
}
