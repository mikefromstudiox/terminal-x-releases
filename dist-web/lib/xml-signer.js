/**
 * xml-signer.mjs — ESM port of electron/xml-signer.js
 * XML Digital Signature for DGII e-CF (RSA-SHA256 enveloped).
 */

import { SignedXml } from 'xml-crypto'
import { Signature } from 'dgii-ecf'

export function signXML(xmlString, privateKeyPem, certificatePem) {
  const certBase64 = certificatePem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '')

  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    idMode: null,
  })

  sig.addReference({
    xpath: '/*',
    uri: '',
    isEmptyUri: true,
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'],
  })

  sig.getKeyInfoContent = () =>
    `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`

  sig.computeSignature(xmlString, {
    location: { reference: '/*', action: 'append' },
  })

  const signedXml = sig.getSignedXml()
  const signatureDate = new Date().toISOString()
  const securityCode = getSecurityCode(signedXml)

  return { signedXml, securityCode, signatureDate }
}

export function getSecurityCode(signedXml) {
  const match = signedXml.match(/<SignatureValue[^>]*>([^<]+)<\/SignatureValue>/)
  if (!match) throw new Error('XML signing failed: no SignatureValue found')
  return match[1].replace(/\s/g, '').substring(0, 6)
}

export function signSeed(seedXml, privateKeyPem, certificatePem) {
  const signer = new Signature(privateKeyPem, certificatePem)
  return signer.signXml(seedXml, 'SemillaModel')
}
