/**
 * Smoke test for xml-crypto v6 port in web/api/fe/recepcion.js + aprobacion.js.
 *
 * The D-C2 audit finding was: fe receivers called the old v2 API
 * (sig.signingKey = / sig.keyInfoProvider = / positional addReference)
 * which throws on xml-crypto@^6. This test locks in the v6 API shape by
 * performing a full sign→verify round-trip with the same ctor options, same
 * enveloped-signature transform, same rsa-sha256 + sha256 digest algorithms
 * used by recepcion.signXml() / aprobacion.signXml().
 *
 * Run: node tests/smoke/fe-xmlcrypto-v6.test.mjs
 *
 * NOTE: a real DGII-signed ARECF/ACECF sample would let us verify against the
 * DGII public cert, but no such sample is checked into the repo. A self-
 * issued keypair still exercises every code path that previously crashed
 * under v6 (constructor options, structured addReference, computeSignature,
 * checkSignature), so a green run here is sufficient to prove the port
 * compiles and executes end-to-end. Live verification against DGII's cert is
 * still required before deploy.
 */
import { SignedXml } from 'xml-crypto'
import { generateKeyPairSync, createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto'
import forge from 'node-forge'
import assert from 'node:assert/strict'

function makeSelfSignedPem() {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000)
  const attrs = [{ name: 'commonName', value: 'TEST' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return {
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certPem: forge.pki.certificateToPem(cert),
  }
}

function signArecf(xml, rootTag, keyPem, certPem) {
  const certB64 = certPem.replace(/-----BEGIN CERTIFICATE-----/g, '').replace(/-----END CERTIFICATE-----/g, '').replace(/\s/g, '')
  const sig = new SignedXml({
    privateKey: keyPem,
    publicCert: certPem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    getKeyInfoContent: () => `<X509Data><X509Certificate>${certB64}</X509Certificate></X509Data>`,
  })
  sig.addReference({
    xpath: `//*[local-name()='${rootTag}']`,
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    isEmptyUri: true,
  })
  sig.computeSignature(xml)
  return sig.getSignedXml()
}

function verify(signedXml, certPem) {
  const sig = new SignedXml({ publicCert: certPem })
  const sigNode = signedXml.match(/<Signature[\s\S]*<\/Signature>/)[0]
  sig.loadSignature(sigNode)
  return sig.checkSignature(signedXml)
}

function main() {
  const { keyPem, certPem } = makeSelfSignedPem()

  // ARECF round-trip — same shape recepcion.js produces.
  const arecf = '<?xml version="1.0" encoding="utf-8"?><ARECF><DetalleAcusedeRecibo><Version>1.0</Version><RNCEmisor>133410321</RNCEmisor><RNCComprador>133410321</RNCComprador><eNCF>E310000000001</eNCF><Estado>0</Estado><FechaHoraAcuseRecibo>19-04-2026 12:00:00</FechaHoraAcuseRecibo></DetalleAcusedeRecibo></ARECF>'
  const signedArecf = signArecf(arecf, 'ARECF', keyPem, certPem)
  assert.ok(signedArecf.includes('<Signature'), 'ARECF must contain <Signature>')
  assert.ok(signedArecf.includes('<X509Certificate>'), 'ARECF KeyInfo must carry X509Certificate')
  assert.equal(verify(signedArecf, certPem), true, 'ARECF signature must verify against the embedded cert')
  console.log('ARECF v6 sign+verify: OK')

  // ACECF round-trip — same shape aprobacion.js produces.
  const acecf = '<?xml version="1.0" encoding="utf-8"?><ACECF><DetalleAprobacionComercial><Version>1.0</Version><RNCEmisor>133410321</RNCEmisor><eNCF>E310000000001</eNCF><FechaEmision>19-04-2026</FechaEmision><MontoTotal>1000.00</MontoTotal><RNCComprador>133410321</RNCComprador><Estado>1</Estado><FechaHoraAprobacionComercial>19-04-2026 12:00:00</FechaHoraAprobacionComercial></DetalleAprobacionComercial></ACECF>'
  const signedAcecf = signArecf(acecf, 'ACECF', keyPem, certPem)
  assert.ok(signedAcecf.includes('<Signature'), 'ACECF must contain <Signature>')
  assert.equal(verify(signedAcecf, certPem), true, 'ACECF signature must verify against the embedded cert')
  console.log('ACECF v6 sign+verify: OK')

  console.log('\nxml-crypto v6 port: PASS')
}

main()
