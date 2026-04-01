/**
 * ecf-submit.js — Submit Step 4 simulation XMLs to DGII CerteCF API
 *
 * Usage: node tools/ecf-submit.js <config.json>
 * Reads signed XMLs from ecf-output-{RNC}/, submits each, polls for status.
 */
const fs = require('fs')
const path = require('path')
const { ECF, ENVIRONMENT } = require('dgii-ecf')

const configPath = process.argv[2]
if (!configPath) { console.error('Usage: node tools/ecf-submit.js <config.json>'); process.exit(1) }

const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const key = fs.readFileSync(cfg.keyPemPath, 'utf8')
const cert = fs.readFileSync(cfg.certPemPath, 'utf8')

const XML_DIR = path.join(path.dirname(configPath), `ecf-output-${cfg.rnc}`)
const ENV_MAP = { DEV: ENVIRONMENT.DEV, CERT: ENVIRONMENT.CERT, PROD: ENVIRONMENT.PROD }
const env = ENV_MAP[cfg.environment] || ENVIRONMENT.CERT

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`))
  return m ? m[1].trim() : ''
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function run() {
  const files = fs.readdirSync(XML_DIR).filter(f => f.endsWith('.xml'))
  const ecfFiles = files.filter(f => !f.startsWith('RFCE_') && !f.startsWith('ACECF_') && f !== 'manifest.json')
  const rfceFiles = files.filter(f => f.startsWith('RFCE_'))

  console.log(`Found ${ecfFiles.length} e-CFs + ${rfceFiles.length} RFCEs in ${XML_DIR}\n`)

  const ecf = new ECF({ key, cert }, env)

  console.log(`Authenticating with DGII (${cfg.environment})...`)
  await ecf.authenticate()
  console.log('OK — token obtained\n')

  // Build RFCE eNCF lookup
  const rfceEncfs = new Set(rfceFiles.map(f => { const xml = fs.readFileSync(path.join(XML_DIR, f), 'utf8'); return xmlTag(xml, 'eNCF') }))

  // Parse all ECF files
  const allEcfs = ecfFiles.map(f => {
    const xml = fs.readFileSync(path.join(XML_DIR, f), 'utf8')
    return { file: f, xml, encf: xmlTag(xml, 'eNCF'), tipo: xmlTag(xml, 'TipoeCF'), isE32lt250k: rfceEncfs.has(xmlTag(xml, 'eNCF')) }
  })

  // Submission order: base docs first, notas second, skip E32<250K
  const ORDER_1 = ['31','32','41','43','44','45','46','47']
  const ORDER_2 = ['33','34']
  const batch1 = allEcfs.filter(e => ORDER_1.includes(e.tipo) && !e.isE32lt250k)
  const batch2 = allEcfs.filter(e => ORDER_2.includes(e.tipo))
  const submitEcfFiles = [...batch1, ...batch2]

  console.log(`Batch 1 (base): ${batch1.length} | Batch 2 (notas): ${batch2.length} | Skipping: ${allEcfs.length - submitEcfFiles.length} E32<250K\n`)

  let accepted = 0, rejected = 0, errors = 0

  console.log('=== Submitting e-CFs ===\n')
  for (const entry of submitEcfFiles) {
    const { xml, encf, tipo } = entry
    const fileName = `${cfg.rnc}${encf}.xml`
    try {
      const result = await ecf.sendElectronicDocument(xml, fileName)
      const trackId = result.trackId || result.TrackId || ''
      process.stdout.write(`E${tipo} ${encf} → trackId=${trackId} ... `)
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
          } catch (e) {}
        }
        console.log(finalStatus || 'EN_PROCESO (timeout)')
        if (finalStatus && finalStatus.startsWith('ACEPTADO')) accepted++
        else if (finalStatus && finalStatus.startsWith('RECHAZADO')) rejected++
        else errors++
      } else { console.log('NO TRACKID:', JSON.stringify(result)); errors++ }
    } catch (err) { console.log(`E${tipo} ${encf} → ERROR: ${err.message || JSON.stringify(err)}`); errors++ }

    if (rejected > 0) { console.log('\nSTOPPING — rejection detected, DGII portal resets on any rejection'); break }
    await sleep(500)
  }

  console.log(`\ne-CF results: ${accepted} accepted, ${rejected} rejected, ${errors} errors\n`)

  // Submit RFCEs
  console.log('=== Submitting RFCEs ===\n')
  let ra = 0, rr = 0, re = 0
  for (const file of rfceFiles) {
    const xml = fs.readFileSync(path.join(XML_DIR, file), 'utf8')
    const encf = xmlTag(xml, 'eNCF')
    const fileName = `${cfg.rnc}${encf}.xml`
    try {
      const result = await ecf.sendSummary(xml, fileName)
      const code = result.codigo ?? result.Codigo ?? ''
      if (code === 1 || code === '1') { console.log(`RFCE ${encf} → ACEPTADO`); ra++ }
      else { console.log(`RFCE ${encf} → code=${code}`, JSON.stringify(result)); code === 2 || code === '2' ? rr++ : re++ }
    } catch (err) { console.log(`RFCE ${encf} → ERROR: ${err.message || JSON.stringify(err)}`); re++ }
    await sleep(500)
  }

  console.log(`\nRFCE results: ${ra} accepted, ${rr} rejected, ${re} errors`)
  console.log(`TOTAL: ${accepted + ra}/${submitEcfFiles.length + rfceFiles.length} accepted`)
}

run().catch(e => console.error('Fatal:', e))
