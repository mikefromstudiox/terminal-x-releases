/**
 * topupLicoreria.js — Adds more tickets + full activity data (payroll,
 * adelantos, cuadre, caja chica, notas, commissions, activity log) to the
 * Licoreria demo so it matches the other 9 demos.
 *
 *   node scripts/topupLicoreria.js
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import crypto from 'crypto'

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

const BIZ_ID = '949fd70b-4609-4c71-a3af-2b9160043c3e' // Licoreria Demo
const TARGET_TICKETS = 22

const uuid = () => crypto.randomUUID()
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const rand = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo
const money = (n) => Math.round(n * 100) / 100
const daysAgo = (d) => { const dt = new Date(); dt.setDate(dt.getDate()-d); dt.setHours(rand(8,20),rand(0,59),rand(0,59),0); return dt.toISOString() }
const ncfStr = (prefix, n) => `${prefix}${String(n).padStart(8,'0')}`

async function topupTickets() {
  const { count: existing } = await sb.from('tickets').select('id',{count:'exact',head:true}).eq('business_id',BIZ_ID)
  const need = TARGET_TICKETS - (existing || 0)
  if (need <= 0) { console.log(`  tickets already at ${existing}, skip`); return }

  const { data: svcRows } = await sb.from('services').select('id, supabase_id, name, price, is_wash').eq('business_id',BIZ_ID)
  const { data: clients } = await sb.from('clients').select('id, supabase_id, name, rnc').eq('business_id',BIZ_ID)
  const { data: empleados } = await sb.from('empleados').select('id, supabase_id, nombre, tipo, role').eq('business_id',BIZ_ID)
  const cajeros = empleados.filter(e => e.tipo === 'cajero')
  const vendedores = empleados.filter(e => e.tipo === 'vendedor')
  const cashStaff = cajeros.length ? cajeros : empleados

  const PM = [...Array(6).fill('cash'), ...Array(3).fill('card'), ...Array(2).fill('transfer')]
  let ncfCounter = 100
  let created = 0
  for (let i = 0; i < need; i++) {
    const created_at = daysAgo(rand(0, 6))
    const items = []
    let subtotal = 0
    const numItems = rand(2, 5)
    for (let j = 0; j < numItems; j++) {
      const svc = pick(svcRows)
      const qty = rand(1, 4)
      items.push({ svc, qty })
      subtotal += parseFloat(svc.price) * qty
    }
    subtotal = money(subtotal)
    const itbis = money(subtotal * 0.18)
    const total = money(subtotal + itbis)
    const pm = pick(PM)
    const client = Math.random() > 0.4 ? pick(clients) : null
    const useEcf = client?.rnc ? 'B01' : 'B02'
    const ncf = ncfStr(useEcf, ncfCounter++)
    const cajero = pick(cashStaff)
    const vendedor = vendedores.length && Math.random() > 0.5 ? pick(vendedores) : null
    const ticketSupId = uuid()

    const { data: tk, error } = await sb.from('tickets').insert({
      business_id: BIZ_ID, supabase_id: ticketSupId,
      doc_number: `T-${String(i + 3000).padStart(4,'0')}`,
      client_name: client?.name || '',
      client_supabase_id: client?.supabase_id || null,
      services_json: JSON.stringify(items.map(it => ({
        name: it.svc.name, price: it.svc.price, qty: it.qty, is_wash: 0,
      }))),
      subtotal, itbis, ley: 0, descuento: 0, total,
      ncf, ncf_type: useEcf, comprobante_type: useEcf,
      payment_method: pm, tipo_venta: 'contado', status: 'cobrado',
      paid_at: created_at,
      cajero_supabase_id: cajero?.supabase_id || null,
      cajero_name: cajero?.nombre || '',
      washer_empleado_supabase_ids: [],
      seller_empleado_supabase_id: vendedor?.supabase_id || null,
      created_at,
    }).select('id, supabase_id').single()
    if (error) { console.log(`    [warn] ticket: ${error.message}`); continue }

    const itemRows = items.map(it => ({
      business_id: BIZ_ID, supabase_id: uuid(),
      ticket_id: tk.id, ticket_supabase_id: tk.supabase_id,
      service_id: it.svc.id, service_supabase_id: it.svc.supabase_id,
      name: it.svc.name, price: it.svc.price, quantity: it.qty,
      itbis: money(parseFloat(it.svc.price) * it.qty * 0.18),
      is_wash: 0,
    }))
    await sb.from('ticket_items').insert(itemRows)
    created++
  }
  console.log(`  tickets +${created} (now ${(existing||0)+created})`)
}

async function main() {
  console.log('\n[ topup ] Licoreria demo\n')
  await topupTickets()

  const seedModule = await import('./seedDemoBusinesses.js')
  const counts = await seedModule.seedActivity(BIZ_ID, { type: 'licoreria' })
  console.log('  activity counts:', counts)

  // Verify
  const [pr, ad, cu, cc, ac, nc, wc, sc, cjc, tk] = await Promise.all([
    sb.from('payroll_runs').select('id',{count:'exact',head:true}).eq('business_id',BIZ_ID),
    sb.from('adelantos').select('id',{count:'exact',head:true}).eq('business_id',BIZ_ID),
    sb.from('cuadre_caja').select('id',{count:'exact',head:true}).eq('business_id',BIZ_ID),
    sb.from('caja_chica').select('id',{count:'exact',head:true}).eq('business_id',BIZ_ID),
    sb.from('activity_log').select('id',{count:'exact',head:true}).eq('business_id',BIZ_ID),
    sb.from('notas_credito').select('id',{count:'exact',head:true}).eq('business_id',BIZ_ID),
    sb.from('washer_commissions').select('id',{count:'exact',head:true}).eq('business_id',BIZ_ID),
    sb.from('seller_commissions').select('id',{count:'exact',head:true}).eq('business_id',BIZ_ID),
    sb.from('cajero_commissions').select('id',{count:'exact',head:true}).eq('business_id',BIZ_ID),
    sb.from('tickets').select('id',{count:'exact',head:true}).eq('business_id',BIZ_ID),
  ])
  console.log('\n=== VERIFY ===')
  console.log(`tickets=${tk.count}  payroll=${pr.count}  adelantos=${ad.count}  cuadre=${cu.count}  caja_chica=${cc.count}  notas=${nc.count}  activity=${ac.count}  commissions=${(wc.count||0)+(sc.count||0)+(cjc.count||0)}`)
}

async function runActivity() {
  // Fallback: inline minimal seedActivity — not needed since we'll export from the main file instead.
  console.log('  (fallback not implemented — please export seedActivity)')
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
