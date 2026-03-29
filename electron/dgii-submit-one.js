/**
 * dgii-submit-one.js — Submit a single e-CF XML to DGII CerteCF
 *
 * Usage: node electron/dgii-submit-one.js <filename>
 *   e.g.: node electron/dgii-submit-one.js 133410321E310000000007.xml
 *
 * Also: node electron/dgii-submit-one.js rfce <filename>
 *   e.g.: node electron/dgii-submit-one.js rfce RFCE_133410321E320000000013.xml
 */

const https = require('https')
const fs = require('fs')
const path = require('path')
const { Signature } = require('dgii-ecf')

const keyPem = fs.readFileSync('C:/Users/City/Downloads/dgii-key.pem', 'utf8')
const certPem = fs.readFileSync('C:/Users/City/Downloads/dgii-cert.pem', 'utf8')
const signer = new Signature(keyPem, certPem)
// Default to step4-sim, override with --dir=step2-dgii
const dirArg = process.argv.find(a => a.startsWith('--dir='))
const DIR = path.join(__dirname, '../test-xmls/' + (dirArg ? dirArg.split('=')[1] : 'step4-sim'))

function httpPostMultipart(hostname, urlPath, fileName, fileContent, token) {
  return new Promise((resolve) => {
    const boundary = '----DGIIBound' + Date.now()
    let body = '--' + boundary + '\r\n'
    body += 'Content-Disposition: form-data; name="xml"; filename="' + fileName + '"\r\n'
    body += 'Content-Type: application/xml\r\n\r\n'
    body += fileContent + '\r\n'
    body += '--' + boundary + '--\r\n'
    const buf = Buffer.from(body, 'utf8')
    const req = https.request({
      hostname, port: 443, path: urlPath, method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': buf.length,
        'Authorization': 'Bearer ' + token,
      },
      timeout: 30000,
    }, res => {
      let data = ''; res.on('data', c => data += c)
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', e => resolve({ status: 0, body: e.message }))
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }) })
    req.write(buf); req.end()
  })
}

async function authenticate() {
  const seed = await new Promise(r => https.get(
    'https://ecf.dgii.gov.do/CerteCF/Autenticacion/api/Autenticacion/Semilla',
    { headers: { 'Accept': 'application/xml' } },
    res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)) }
  ))
  const signed = signer.signXml(seed, 'SemillaModel')
  const res = await httpPostMultipart('ecf.dgii.gov.do',
    '/CerteCF/Autenticacion/api/Autenticacion/ValidarSemilla', 'semilla.xml', signed)
  return JSON.parse(res.body).token
}

async function run() {
  const args = process.argv.slice(2)
  let isRFCE = false
  let fileName = args[0]
  if (args[0] === 'rfce') {
    isRFCE = true
    fileName = args[1]
  }

  if (!fileName) {
    console.log('Usage: node electron/dgii-submit-one.js <filename>')
    console.log('       node electron/dgii-submit-one.js rfce <filename>')
    process.exit(1)
  }

  const filePath = path.join(DIR, fileName)
  if (!fs.existsSync(filePath)) {
    console.log('File not found:', filePath)
    process.exit(1)
  }

  console.log('Authenticating...')
  const token = await authenticate()
  console.log('Auth OK\n')

  const xml = fs.readFileSync(filePath, 'utf8')
  const host = isRFCE ? 'fc.dgii.gov.do' : 'ecf.dgii.gov.do'
  const urlPath = isRFCE
    ? '/CerteCF/RecepcionFC/api/recepcion/ecf'
    : '/CerteCF/Recepcion/api/FacturasElectronicas'

  // DGII wants filename format {RNC}{eNCF}.xml — strip RFCE_ prefix if present
  const uploadName = fileName.replace(/^RFCE_/, '')
  console.log('Submitting', fileName, 'as', uploadName, 'to', host + urlPath)
  const r = await httpPostMultipart(host, urlPath, uploadName, xml, token)
  console.log('Status:', r.status)
  try {
    console.log(JSON.stringify(JSON.parse(r.body), null, 2))
  } catch {
    console.log(r.body)
  }
}

run().catch(e => console.error('Error:', e.message))
