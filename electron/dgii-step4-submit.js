/**
 * dgii-step4-submit.js — Submit Step 4 simulation XMLs to DGII CerteCF API
 *
 * Uses dgii-ecf package for authentication and submission.
 * Reads signed XMLs from test-xmls/step4-sim/, submits each, polls for status.
 *
 * Usage: node electron/dgii-step4-submit.js
 */
const fs = require('fs')
const path = require('path')
const { ECF, ENVIRONMENT } = require('dgii-ecf')

const XML_DIR = path.join(__dirname, '../test-xmls/step4-sim')
const RNC = '133410321'

// Load certificate
const key = fs.readFileSync('C:/Users/City/Downloads/dgii-key.pem', 'utf8')
const cert = fs.readFileSync('C:/Users/City/Downloads/dgii-cert.pem', 'utf8')

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`))
  return m ? m[1].trim() : ''
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function run() {
  const files = fs.readdirSync(XML_DIR).filter(f => f.endsWith('.xml'))
  const ecfFiles = files.filter(f => !f.startsWith('RFCE_') && !f.startsWith('ACECF_') && f !== 'manifest.json')
  const rfceFiles = files.filter(f => f.startsWith('RFCE_'))

  console.log(`Found ${ecfFiles.length} e-CFs + ${rfceFiles.length} RFCEs\n`)

  const ecf = new ECF({ key, cert }, ENVIRONMENT.CERT)

  // Authenticate
  console.log('Authenticating with DGII CerteCF...')
  const auth = await ecf.authenticate()
  console.log('OK — token obtained\n')

  // Submit e-CFs
  console.log('=== Submitting e-CFs ===\n')
  let accepted = 0, rejected = 0, errors = 0

  // Build lookup: which eNCFs have RFCE counterparts (E32 <250K)
  const rfceEncfs = new Set(rfceFiles.map(f => { const xml = fs.readFileSync(path.join(XML_DIR, f), 'utf8'); return xmlTag(xml, 'eNCF') }))

  // Parse all ECF files with metadata
  const allEcfs = ecfFiles.map(f => {
    const xml = fs.readFileSync(path.join(XML_DIR, f), 'utf8')
    const encf = xmlTag(xml, 'eNCF')
    const tipo = xmlTag(xml, 'TipoeCF')
    const isE32lt250k = rfceEncfs.has(encf)
    return { file: f, xml, encf, tipo, isE32lt250k }
  })

  // DGII submission order (from certification portal):
  // 1st: E31, E32>=250K, E41, E43, E44, E45, E46, E47 (base documents)
  // 2nd: E33, E34 (notas that reference base documents)
  // 3rd: RFCEs (submitted separately via sendSummary)
  // 4th: E32<250K ECFs — NOT submitted as regular e-CFs
  const ORDER_1 = ['31','32','41','43','44','45','46','47']
  const ORDER_2 = ['33','34']

  const batch1 = allEcfs.filter(e => ORDER_1.includes(e.tipo) && !e.isE32lt250k)
  const batch2 = allEcfs.filter(e => ORDER_2.includes(e.tipo))
  const submitEcfFiles = [...batch1, ...batch2]

  console.log(`Batch 1 (base): ${batch1.length} e-CFs`)
  console.log(`Batch 2 (notas): ${batch2.length} e-CFs`)
  console.log(`Skipping: ${allEcfs.length - submitEcfFiles.length} E32<250K\n`)

  for (const entry of submitEcfFiles) {
    const { xml, encf, tipo } = entry
    const fileName = `${RNC}${encf}.xml`

    try {
      const result = await ecf.sendElectronicDocument(xml, fileName)
      const trackId = result.trackId || result.TrackId || ''
      process.stdout.write(`E${tipo} ${encf} → trackId=${trackId} ... `)

      // Poll for status
      if (trackId) {
        let finalStatus = null
        for (let i = 0; i < 15; i++) {
          await sleep(2000)
          try {
            const status = await ecf.statusTrackId(trackId)
            const code = status.codigo ?? status.Codigo ?? status.estado ?? ''
            if (code === 1 || code === '1') { finalStatus = 'ACEPTADO'; break }
            if (code === 4 || code === '4') { finalStatus = 'ACEPTADO_CONDICIONAL'; break }
            if (code === 2 || code === '2') { finalStatus = 'RECHAZADO: ' + JSON.stringify(status.mensajes || status); break }
          } catch (pollErr) {
            // retry
          }
        }
        console.log(finalStatus || 'EN_PROCESO (timeout)')
        if (finalStatus && finalStatus.startsWith('ACEPTADO')) accepted++
        else if (finalStatus && finalStatus.startsWith('RECHAZADO')) rejected++
        else errors++
      } else {
        console.log('NO TRACKID:', JSON.stringify(result))
        errors++
      }
    } catch (err) {
      console.log(`E${tipo} ${encf} → ERROR: ${err.message || JSON.stringify(err)}`)
      errors++
    }

    // STOP on any rejection — DGII resets all progress on rejection
    if (rejected > 0) {
      console.log('\nSTOPPING — rejection detected, DGII portal resets on any rejection')
      break
    }

    await sleep(500)
  }

  console.log(`\ne-CF results: ${accepted} accepted, ${rejected} rejected, ${errors} errors\n`)

  // Submit RFCEs (E32 < 250K)
  console.log('=== Submitting RFCEs ===\n')
  let rfceAccepted = 0, rfceRejected = 0, rfceErrors = 0

  for (const file of rfceFiles) {
    const xml = fs.readFileSync(path.join(XML_DIR, file), 'utf8')
    const encf = xmlTag(xml, 'eNCF')
    const fileName = `${RNC}${encf}.xml`

    try {
      const result = await ecf.sendSummary(xml, fileName)
      const code = result.codigo ?? result.Codigo ?? ''
      if (code === 1 || code === '1') {
        console.log(`RFCE ${encf} → ACEPTADO`)
        rfceAccepted++
      } else {
        console.log(`RFCE ${encf} → code=${code}`, JSON.stringify(result))
        if (code === 2 || code === '2') rfceRejected++
        else rfceErrors++
      }
    } catch (err) {
      console.log(`RFCE ${encf} → ERROR: ${err.message || JSON.stringify(err)}`)
      rfceErrors++
    }

    await sleep(500)
  }

  console.log(`\nRFCE results: ${rfceAccepted} accepted, ${rfceRejected} rejected, ${rfceErrors} errors`)
  console.log(`\nTOTAL: ${accepted + rfceAccepted}/${ecfFiles.length + rfceFiles.length} accepted`)
}

run().catch(e => console.error('Fatal:', e))
