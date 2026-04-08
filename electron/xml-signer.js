/**
 * xml-signer.js — XML Digital Signature for DGII e-CF
 *
 * Signs XML documents using RSA-SHA256 enveloped signature per DGII spec:
 *   - CanonicalizationMethod: C14N 1.0
 *   - SignatureMethod: RSA-SHA256
 *   - DigestMethod: SHA-256
 *   - Reference URI="" (entire document)
 *   - Transform: enveloped-signature
 *   - <Signature> appended as last child of root element
 *
 * Ref: "Firmado de e-CF.pdf" from DGII documentation
 */

const { SignedXml } = require('xml-crypto')
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom')
const crypto = require('crypto')

/**
 * signXML — signs an XML string with the given private key and certificate.
 *
 * @param {string} xmlString — unsigned XML document
 * @param {string} privateKeyPem — PEM-encoded private key
 * @param {string} certificatePem — PEM-encoded X.509 certificate
 * @returns {{ signedXml: string, securityCode: string, signatureDate: string }}
 */
function signXML(xmlString, privateKeyPem, certificatePem) {
  // Strip PEM headers to get raw base64 certificate for KeyInfo
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

  // Add reference to entire document (URI="") — DGII requires empty URI
  sig.addReference({
    xpath: '/*',
    uri: '',
    isEmptyUri: true,
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'],
  })

  // KeyInfo with X509Certificate — DGII requires this block
  sig.getKeyInfoContent = () => {
    return `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`
  }

  // Compute signature
  sig.computeSignature(xmlString, {
    location: { reference: '/*', action: 'append' },
  })

  const signedXml = sig.getSignedXml()

  // Extract SignatureValue for security code
  const signatureDate = new Date().toISOString()
  const securityCode = getSecurityCode(signedXml)

  return { signedXml, securityCode, signatureDate }
}

/**
 * getSecurityCode — extracts CodigoSeguridadeCF from signed XML.
 * Per DGII spec: first 6 characters of the raw base64 SignatureValue (no hashing).
 */
function getSecurityCode(signedXml) {
  const match = signedXml.match(/<SignatureValue[^>]*>([^<]+)<\/SignatureValue>/)
  if (!match) throw new Error('XML signing failed: no SignatureValue found — cannot generate CodigoSeguridad')
  const sigValue = match[1].replace(/\s/g, '')
  return sigValue.substring(0, 6)
}

/**
 * signSeed — signs a DGII semilla XML for the authentication flow.
 * Uses dgii-ecf Signature class which handles DGII's custom digest
 * (namespace attribute sorting) correctly with xml-crypto v2.
 */
function signSeed(seedXml, privateKeyPem, certificatePem) {
  const { Signature } = require('dgii-ecf')
  const signer = new Signature(privateKeyPem, certificatePem)
  return signer.signXml(seedXml, 'SemillaModel')
}

module.exports = { signXML, getSecurityCode, signSeed }
