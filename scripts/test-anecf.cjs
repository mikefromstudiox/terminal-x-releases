// Test ANECF submission without rebuilding the installer.
// Reads current xml-builder.js + dgii-client.js + cert-manager.js
// directly from source, so iterating on xml-builder.js shapes takes ~10s:
//   1. cloud commits a buildANECFXml tweak + pushes
//   2. desktop: git pull && node scripts/test-anecf.cjs E32 1 22
//   3. script prints DGII raw response
//
// Usage:
//   node scripts/test-anecf.cjs                     # defaults: E32, 1, 2
//   node scripts/test-anecf.cjs E31 1 2
//   node scripts/test-anecf.cjs E32 1 22
//
// Reads userData paths directly (cert-manager.js expects electron.app).
// We shim a minimal `app` object so cert-manager loads without Electron.

const path = require('path')
const os = require('os')
const fs = require('fs')

// Shim electron.app before cert-manager requires it.
process.env.ELECTRON_RUN_AS_NODE = '1'
require.cache[require.resolve.paths('electron')[0] + path.sep + 'electron'] = undefined

// Find userData (Windows: %APPDATA%\Terminal X)
const userData = path.join(os.homedir(), 'AppData', 'Roaming', 'Terminal X')
if (!fs.existsSync(userData)) {
  console.error('userData not found at', userData)
  process.exit(1)
}

// Monkey-patch electron.app so cert-manager can init without electron runtime.
const mockApp = {
  getPath: (name) => (name === 'userData' ? userData : os.homedir()),
}
const Module = require('module')
const origResolve = Module._resolveFilename
Module._resolveFilename = function(request, parent, ...rest) {
  if (request === 'electron') {
    // return a fake id that we'll short-circuit below
    return '__electron_shim__'
  }
  return origResolve.call(this, request, parent, ...rest)
}
require.cache['__electron_shim__'] = {
  id: '__electron_shim__',
  filename: '__electron_shim__',
  loaded: true,
  exports: { app: mockApp, safeStorage: { decryptString: (b) => b.toString('utf8') } },
}

const certManager = require('../electron/cert-manager')
const xmlBuilder = require('../electron/xml-builder')
const xmlSigner = require('../electron/xml-signer')
const dgiiClient = require('../electron/dgii-client')

const [tipoECF = 'E32', desde = '1', hasta = '2'] = process.argv.slice(2)
const pad10 = (n) => String(n).padStart(10, '0')
const rangoDesde = `${tipoECF}${pad10(desde)}`
const rangoHasta = `${tipoECF}${pad10(hasta)}`

async function main() {
  // Load env from app_settings SQLite? Simpler: read from userData's settings JSON if exists,
  // else default to ecf (production).
  const dgiiEnv = 'ecf'
  console.log('DGII env:', dgiiEnv)
  console.log('Tipo eCF:', tipoECF, '| Rango:', rangoDesde, '→', rangoHasta)

  certManager.init({ getPath: (name) => name === 'userData' ? userData : os.homedir() })

  let cert
  try {
    cert = certManager.loadCert()
    console.log('cert subject:', cert.subject)
  } catch (e) {
    console.error('cert load failed:', e.message)
    process.exit(1)
  }

  // Build XML
  const numDesde = parseInt(rangoDesde.replace(/[^\d]/g, ''), 10)
  const numHasta = parseInt(rangoHasta.replace(/[^\d]/g, ''), 10)
  const cantidadNCF = numHasta - numDesde + 1

  const rncEmisor = '133410321'
  const xml = xmlBuilder.buildANECFXml({
    rncEmisor,
    cantidadNCF,
    tipoECF,
    rangoDesde,
    rangoHasta,
  })
  console.log('\n── XML (unsigned) ──')
  console.log(xml)

  // Sign
  const { signedXml } = xmlSigner.signXML(xml, cert.privateKeyPem, cert.certificatePem)
  console.log('\n── Signed XML length:', signedXml.length)

  // Auth
  console.log('\n── Authenticating with DGII...')
  const token = await dgiiClient.authenticate(dgiiEnv, cert.privateKeyPem, cert.certificatePem)
  console.log('token acquired:', !!token)

  // Submit
  console.log('\n── Submitting ANECF...')
  try {
    const result = await dgiiClient.submitANECF(signedXml, token, dgiiEnv)
    console.log('\n── DGII response:')
    console.log(JSON.stringify(result, null, 2))
  } catch (e) {
    console.error('\n── DGII submit failed:', e.message)
    if (e.response) console.error('response:', e.response)
  }
}

main().catch(e => { console.error('fatal:', e); process.exit(1) })
