/**
 * ECF API Test Script — ef2.do sandbox
 * Run: node scripts/test-ecf.js
 *
 * Tests E31, E32 (<250k), E44, then E33 referencing the E31.
 */

const https = require('https')

const TOKEN = 'tok_e0f3065a8a7df34785d30b744bf4715b3c3b96759a1a7ca19f354817e4471e2e'
const RNC_EMISOR = '132596161'

function today() {
  const d = new Date()
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    d.getFullYear(),
  ].join('-')
}

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body)
    const req = https.request({
      hostname: 'master.ef2.do',
      port: 443,
      path: `/api2${urlPath}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'Authorization': `Bearer ${TOKEN}`,
      },
    }, res => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, json: null, raw: data }) }
      })
    })
    req.on('error', reject)
    req.write(bodyStr)
    req.end()
  })
}

const EMISOR = {
  RNCEmisor:         RNC_EMISOR,
  RazonSocialEmisor: '2BUY ELECTRONICS AND SERVICES SRL',
  NombreComercial:   '2BUY',
  DireccionEmisor:   'Santo Domingo',
  Municipio:         '010100',
  Provincia:         '010000',
  CorreoEmisor:      'test@2buy.do',
  FechaEmision:      today(),
}

const COMPRADOR = {
  RNCComprador:         '132596161',   // Use same RNC as emisor — valid in sandbox
  RazonSocialComprador: '2BUY ELECTRONICS AND SERVICES SRL',
  CorreoComprador:      'test@2buy.do',
  DireccionComprador:   'Santo Domingo',
  MunicipioComprador:   '010100',
  ProvinciaComprador:   '010000',
}

const ITEMS = {
  Item: [{
    NumeroLinea:            '1',
    IndicadorFacturacion:   '1',
    NombreItem:             'Lavado de Auto',
    IndicadorBienoServicio: '2',
    CantidadItem:           '1',
    UnidadMedida:           '43',
    PrecioUnitarioItem:     '847.46',
    MontoItem:              '847.46',
  }],
}

const TOTALES_18 = {
  MontoGravadoTotal: '847.46',
  MontoGravadoI1:    '847.46',
  ITBIS1:            '18',
  TotalITBIS:        '152.54',
  TotalITBIS1:       '152.54',
  MontoTotal:        '1000.00',
}

async function runTest(label, payload) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`TEST: ${label}`)
  console.log('─'.repeat(60))
  try {
    const res = await post('/procesar_factura.php', payload)
    const j = res.json
    if (j?.success) {
      console.log('RESULT: SUCCESS')
      console.log('  NCF    :', j.ncf)
      console.log('  Estado :', j.estado)
      console.log('  QR     :', j.qr_link       || '(none)')
      console.log('  PDF    :', j.pdf_cloud_url  || '(none)')
    } else {
      console.log('RESULT: FAILED')
      // Trim message — DGII messages can be long
      const msg = (j?.message || j?.error || '(no message)').split('\n')[0].slice(0, 200)
      console.log('  Error  :', msg)
      if (j?.code) console.log('  Code   :', j.code)
      if (j?.dgii_info?.estado) console.log('  DGII   :', j.dgii_info.estado.slice(0, 200))
    }
    return j
  } catch (err) {
    console.log('✗ NETWORK ERROR:', err.message)
    return null
  }
}

async function main() {
  console.log('ef2.do ECF Sandbox Test — ', today())
  console.log('Token:', TOKEN.slice(0, 20) + '...')
  console.log('Emisor RNC:', RNC_EMISOR)

  // ── TEST 1: E31 Crédito Fiscal ────────────────────────────────────────────
  const e31Result = await runTest('E31 — Crédito Fiscal', {
    ECF: {
      Encabezado: {
        Version: '1.0',
        IdDoc: {
          TipoeCF:                   '31',
          FechaVencimientoSecuencia: '31-12-2028',
          IndicadorMontoGravado:     '0',
          TipoIngresos:              '01',
          TipoPago:                  '1',
        },
        Emisor:    EMISOR,
        Comprador: COMPRADOR,
        Totales:   TOTALES_18,
      },
      DetallesItems: ITEMS,
    },
  })

  // ── TEST 2: E32 Consumidor Final (<250k — no Comprador) ───────────────────
  await runTest('E32 — Consumidor Final (<250k, sin Comprador)', {
    ECF: {
      Encabezado: {
        Version: '1.0',
        IdDoc: {
          TipoeCF:               '32',
          IndicadorMontoGravado: '0',
          TipoIngresos:          '01',
          TipoPago:              '1',
          FechaLimitePago:       today(),
        },
        Emisor:  EMISOR,
        Totales: TOTALES_18,
      },
      DetallesItems: ITEMS,
    },
  })

  // ── TEST 3: E44 Regímenes Especiales ─────────────────────────────────────
  // E44 must NOT have IndicadorMontoGravado — ef2.do was injecting it by default.
  // Test A: without it (baseline — may still inject)
  await runTest('E44 — Regímenes Especiales (sin IndicadorMontoGravado)', {
    ECF: {
      Encabezado: {
        Version: '1.0',
        IdDoc: {
          TipoeCF:                   '44',
          FechaVencimientoSecuencia: '31-12-2028',
          TipoIngresos:              '01',
          TipoPago:                  '2',
        },
        Emisor: { ...EMISOR },
        Totales: {
          MontoExento: '847.46',
          MontoTotal:  '847.46',
          ValorPagar:  '847.46',
        },
      },
      DetallesItems: ITEMS,
    },
  })

  // ── TEST 4: E33 Nota de Débito referencing E31 ────────────────────────────
  const e31NCF = e31Result?.ncf
  if (e31NCF) {
    await runTest(`E33 — Nota de Débito (ref: ${e31NCF})`, {
      ECF: {
        Encabezado: {
          Version: '1.0',
          IdDoc: {
            TipoeCF:                   '33',
            FechaVencimientoSecuencia: '31-12-2027',
            TipoIngresos:              '01',
            TipoPago:                  '1',
          },
          Emisor:    EMISOR,
          Comprador: COMPRADOR,
          InformacionReferencia: {
            NCFModificado:      e31NCF,
            RazonModificacion:  'Ajuste de precio por diferencia',
            FechaNCFModificado: today(),
            CodigoModificacion: '3',
          },
          Totales: {
            MontoGravadoTotal: '84.75',
            MontoGravadoI1:    '84.75',
            ITBIS1:            '18',
            TotalITBIS:        '15.25',
            TotalITBIS1:       '15.25',
            MontoTotal:        '100.00',
          },
        },
        DetallesItems: {
          Item: [{
            NumeroLinea:            '1',
            IndicadorFacturacion:   '1',
            NombreItem:             'Ajuste precio lavado',
            IndicadorBienoServicio: '2',
            CantidadItem:           '1',
            UnidadMedida:           '43',
            PrecioUnitarioItem:     '84.75',
            MontoItem:              '84.75',
          }],
        },
      },
    })
  } else {
    console.log('\n── SKIPPED E33 — E31 did not return an NCF ──')
  }

  console.log('\n' + '═'.repeat(60))
  console.log('Done.')
}

main().catch(console.error)
