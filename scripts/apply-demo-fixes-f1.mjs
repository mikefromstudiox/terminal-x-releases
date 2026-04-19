/**
 * apply-demo-fixes-f1.mjs — Applies category/is_wash fixes from
 * docs/DEMO-AUDIT-REPORT.md section F1 to 9 demo businesses.
 *
 *   node scripts/apply-demo-fixes-f1.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const envPath = resolve(import.meta.dirname, '..', '.env')
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch {}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const BIZES = [
  { key: 'retail',      id: 'bdbd4efd-8dce-4dca-bfc0-a89846d96754' },
  { key: 'restaurant',  id: 'b037c2a8-d8d2-45f6-ada1-f851cf0190a4' },
  { key: 'salon',       id: 'b14f83cb-15c9-4c1f-946c-5256265dab7a' },
  { key: 'hybrid',      id: '354ffa7b-1198-4ff9-983a-5a6e344633ef' },
  { key: 'mechanic',    id: '32e2cc8f-8626-4e54-ad80-71dfb100247c' },
  { key: 'service',     id: '9fe0cab2-5e92-4222-a43a-616083c6470b' },
  { key: 'prestamos',   id: 'd8db00a2-30c5-4aa5-8fbe-26d06e69dce0' },
  { key: 'dealership',  id: '60dbf844-323f-4913-8847-9499ca6be995' },
  { key: 'carniceria',  id: '52d0a7be-03c9-4352-92d2-19e4825eaf3a' },
]

async function updateByIds(ids, patch) {
  if (!ids.length) return 0
  const { error, data } = await sb
    .from('services')
    .update(patch)
    .in('id', ids)
    .select('id')
  if (error) throw new Error(`update failed: ${error.message}`)
  return data?.length || 0
}

async function fetchServices(business_id) {
  const { data, error } = await sb
    .from('services')
    .select('id,name,category,is_wash')
    .eq('business_id', business_id)
  if (error) throw new Error(`fetch ${business_id}: ${error.message}`)
  return data || []
}

async function run() {
  const results = []

  for (const biz of BIZES) {
    const svcs = await fetchServices(biz.id)
    let touched = 0

    if (biz.key === 'retail') {
      const ids = svcs.filter(s => s.category === 'Lavado').map(s => s.id)
      touched += await updateByIds(ids, { category: 'Productos' })
    }

    if (biz.key === 'restaurant') {
      const comidas = ['Pollo Frito','Pizza Mediana','Sancocho','Hamburguesa Clasica','Mofongo']
      const bebidas = ['Cerveza Presidente','Refresco']
      touched += await updateByIds(svcs.filter(s => comidas.includes(s.name)).map(s => s.id), { category: 'Comidas' })
      touched += await updateByIds(svcs.filter(s => bebidas.includes(s.name)).map(s => s.id), { category: 'Bebidas' })
    }

    if (biz.key === 'salon') {
      const ids = svcs.filter(s => s.category === 'Lavado').map(s => s.id)
      touched += await updateByIds(ids, { category: 'Servicios', is_wash: 0 })
    }

    if (biz.key === 'hybrid') {
      const lavado = ['Lavado Express','Lavado Completo','Encerado','Detallado Premium']
      const prod = ['Coca Cola 600ml','Cerveza Presidente','Agua 500ml','Snickers']
      touched += await updateByIds(svcs.filter(s => lavado.includes(s.name)).map(s => s.id), { category: 'Lavado', is_wash: 1 })
      touched += await updateByIds(svcs.filter(s => prod.includes(s.name)).map(s => s.id), { category: 'Productos', is_wash: 0 })
    }

    if (biz.key === 'mechanic') {
      const ids = svcs.filter(s => s.category === 'Lavado').map(s => s.id)
      touched += await updateByIds(ids, { category: 'Servicios' })
    }

    if (biz.key === 'service') {
      const ids = svcs.filter(s => s.category === 'Lavado').map(s => s.id)
      touched += await updateByIds(ids, { category: 'Servicios', is_wash: 0 })
    }

    if (biz.key === 'prestamos') {
      const ids = svcs.filter(s => s.category === 'Lavado').map(s => s.id)
      touched += await updateByIds(ids, { category: 'Cargos', is_wash: 0 })
    }

    if (biz.key === 'dealership') {
      const vehiculos = ['Hyundai Tucson 2026','Toyota Corolla 2026']
      const servicios = ['Inspeccion Tecnica','Garantia Extendida','Servicio Post-Venta','Cambio de Aceite']
      touched += await updateByIds(svcs.filter(s => vehiculos.includes(s.name)).map(s => s.id), { category: 'Vehiculos' })
      touched += await updateByIds(svcs.filter(s => servicios.includes(s.name)).map(s => s.id), { category: 'Servicios' })
    }

    if (biz.key === 'carniceria') {
      const embutidos = ['Salami Inducero (lb)','Longaniza (lb)','Jamon de Cocinar (lb)','Queso Amarillo (lb)','Chorizo Espanol (lb)']
      const mariscos  = ['Camaron Mediano (lb)','Camaron Grande (lb)','Filete de Mero (lb)','Chillo Entero (lb)','Pulpo Limpio (lb)']
      // Order matters: embutidos/mariscos first (explicit), then pork (Cerdo/Chicharron),
      // then chicken (Pollo), then beef (Res) — so "Res" bucket excludes pork/chicken.
      const embutidosIds = svcs.filter(s => embutidos.includes(s.name)).map(s => s.id)
      const mariscosIds  = svcs.filter(s => mariscos.includes(s.name)).map(s => s.id)
      const claimed = new Set([...embutidosIds, ...mariscosIds])

      const cerdoIds = svcs
        .filter(s => !claimed.has(s.id) && (/cerdo/i.test(s.name) || s.name === 'Chicharron de Cerdo (lb)'))
        .map(s => s.id)
      cerdoIds.forEach(id => claimed.add(id))

      const polloIds = svcs
        .filter(s => !claimed.has(s.id) && /pollo/i.test(s.name))
        .map(s => s.id)
      polloIds.forEach(id => claimed.add(id))

      const resIds = svcs
        .filter(s => !claimed.has(s.id) && /res/i.test(s.name) && !/cerdo/i.test(s.name))
        .map(s => s.id)

      touched += await updateByIds(embutidosIds, { category: 'Embutidos' })
      touched += await updateByIds(mariscosIds,  { category: 'Mariscos' })
      touched += await updateByIds(cerdoIds,     { category: 'Cerdo' })
      touched += await updateByIds(polloIds,     { category: 'Pollo' })
      touched += await updateByIds(resIds,       { category: 'Res' })
    }

    results.push({ biz, touched })
  }

  // Verify
  console.log('\n=== F1 APPLY RESULTS ===')
  const summary = []
  for (const { biz, touched } of results) {
    const svcs = await fetchServices(biz.id)
    const cats = [...new Set(svcs.map(s => s.category))].sort()
    const lavadoCount = svcs.filter(s => s.category === 'Lavado').length
    summary.push({
      key: biz.key,
      id: biz.id,
      rows: svcs.length,
      updated: touched,
      categories: cats.join(', '),
      lavado_rows: lavadoCount,
    })
  }

  // Pretty table
  const pad = (s, n) => String(s ?? '').padEnd(n)
  console.log('\n' + pad('business', 12) + pad('rows', 6) + pad('updated', 9) + pad('lavado', 8) + 'categories')
  console.log('-'.repeat(100))
  for (const r of summary) {
    console.log(pad(r.key, 12) + pad(r.rows, 6) + pad(r.updated, 9) + pad(r.lavado_rows, 8) + r.categories)
  }

  // Sanity: Lavado should be 0 except hybrid
  const unexpected = summary.filter(r => r.lavado_rows > 0 && r.key !== 'hybrid')
  if (unexpected.length) {
    console.log('\nWARNING — unexpected Lavado rows remain:')
    unexpected.forEach(r => console.log(`  ${r.key}: ${r.lavado_rows}`))
  } else {
    console.log('\nOK — no stray Lavado rows outside hybrid.')
  }
}

run().catch(e => { console.error(e); process.exit(1) })
