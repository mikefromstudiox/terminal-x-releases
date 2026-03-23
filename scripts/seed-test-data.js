/**
 * seed-test-data.js — Populate Supabase with realistic test data
 *
 * Usage: node scripts/seed-test-data.js
 *
 * Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Or reads from .env in project root.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env manually
const envPath = resolve(import.meta.dirname, '..', '.env')
try {
  const envContent = readFileSync(envPath, 'utf8')
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim()
  }
} catch {}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

const sb = createClient(url, key)

// ── Helpers ──────────────────────────────────────────────────────────────────
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function money(n) { return parseFloat(n.toFixed(2)) }
function daysAgo(d) { const dt = new Date(); dt.setDate(dt.getDate() - d); return dt.toISOString() }
function uuid() { return crypto.randomUUID() }

// ── Config ───────────────────────────────────────────────────────────────────
const VEHICLE_PLATES = [
  'A123456', 'B789012', 'C345678', 'D901234', 'E567890',
  'G112233', 'H445566', 'K778899', 'L001122', 'M334455',
  'N667788', 'P990011', 'R223344', 'S556677', 'T889900',
]
const VEHICLE_COLORS = ['Blanco', 'Negro', 'Gris', 'Rojo', 'Azul', 'Verde', 'Plateado']
const VEHICLE_MAKES = ['Toyota Corolla', 'Honda Civic', 'Hyundai Tucson', 'Kia Sportage', 'Nissan Sentra', 'Toyota Hilux', 'Jeep Wrangler', 'Hyundai Santa Fe', 'Honda CR-V', 'Toyota RAV4']
const CLIENT_NAMES = [
  'Juan Rodriguez', 'Maria Santos', 'Pedro Fernandez', 'Ana Martinez',
  'Carlos Perez', 'Lucia Garcia', 'Miguel Hernandez', 'Carmen Diaz',
  'Jose Ramirez', 'Rosa Gonzalez', 'Francisco Lopez', 'Elena Morales',
  'Auto Parts El Caribe SRL', 'Inversiones San Juan SA', 'Transport Express RD',
]
const WASHER_NAMES = ['Roberto', 'Julio', 'Manuel', 'Andres', 'Felix']
const SELLER_NAMES = ['Daniela', 'Sofia', 'Isabella']

const SERVICES = [
  { name: 'Lavado Basico', name_en: 'Basic Wash', category: 'Lavado', price: 350, is_wash: true },
  { name: 'Lavado Completo', name_en: 'Full Wash', category: 'Lavado', price: 600, is_wash: true },
  { name: 'Lavado Premium', name_en: 'Premium Wash', category: 'Lavado', price: 1000, is_wash: true },
  { name: 'Lavado de Motor', name_en: 'Engine Wash', category: 'Lavado', price: 500, is_wash: true },
  { name: 'Encerado', name_en: 'Wax', category: 'Detallado', price: 800, is_wash: true },
  { name: 'Pulido', name_en: 'Polish', category: 'Detallado', price: 1500, is_wash: true },
  { name: 'Interior Profundo', name_en: 'Deep Interior', category: 'Detallado', price: 1200, is_wash: true },
  { name: 'Agua (botella)', name_en: 'Water (bottle)', category: 'Bebidas', price: 50, is_wash: false },
  { name: 'Refresco', name_en: 'Soda', category: 'Bebidas', price: 75, is_wash: false },
  { name: 'Cerveza', name_en: 'Beer', category: 'Bebidas', price: 150, is_wash: false },
  { name: 'Ambientador', name_en: 'Air Freshener', category: 'Adicionales', price: 200, is_wash: false },
]

const INVENTORY_ITEMS = [
  { name: 'Jabon para autos (galon)', sku: 'JAB-001', category: 'Quimicos', quantity: 25, min_quantity: 5, price: 450, cost: 280 },
  { name: 'Cera liquida (galon)', sku: 'CER-001', category: 'Quimicos', quantity: 12, min_quantity: 3, price: 850, cost: 520 },
  { name: 'Desengrasante (galon)', sku: 'DES-001', category: 'Quimicos', quantity: 18, min_quantity: 4, price: 380, cost: 210 },
  { name: 'Toallas de microfibra (paq 12)', sku: 'TOA-001', category: 'Suministros', quantity: 8, min_quantity: 2, price: 600, cost: 350 },
  { name: 'Esponja de lavado', sku: 'ESP-001', category: 'Suministros', quantity: 30, min_quantity: 10, price: 120, cost: 65 },
  { name: 'Agua botella (caja 24)', sku: 'AGU-001', category: 'Bebidas', quantity: 15, min_quantity: 3, price: 600, cost: 360 },
  { name: 'Refresco (caja 24)', sku: 'REF-001', category: 'Bebidas', quantity: 10, min_quantity: 2, price: 900, cost: 550 },
  { name: 'Cerveza (caja 24)', sku: 'CER-002', category: 'Bebidas', quantity: 6, min_quantity: 2, price: 1800, cost: 1200 },
  { name: 'Ambientador carro', sku: 'AMB-001', category: 'Adicionales', quantity: 40, min_quantity: 10, price: 200, cost: 80 },
  { name: 'Pulimento (litro)', sku: 'PUL-001', category: 'Quimicos', quantity: 3, min_quantity: 2, price: 950, cost: 600 },
]

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Find the first business
  const { data: businesses } = await sb.from('businesses').select('id').limit(1)
  if (!businesses?.length) { console.error('No business found. Create one first via the app.'); process.exit(1) }
  const bid = businesses[0].id
  console.log(`Seeding business: ${bid}`)

  // Update business plan to pro_max for full testing
  await sb.from('businesses').update({ plan: 'pro_max' }).eq('id', bid)
  console.log('Set plan to pro_max')

  // ── Services ──────────────────────────────────────────────────────────────
  const existingServices = (await sb.from('services').select('name').eq('business_id', bid)).data || []
  const existingNames = new Set(existingServices.map(s => s.name))
  const newServices = SERVICES.filter(s => !existingNames.has(s.name))
  if (newServices.length) {
    const { data: svcs } = await sb.from('services').insert(
      newServices.map(s => ({ business_id: bid, ...s, aplica_itbis: true, active: true }))
    ).select('id, name, price, is_wash')
    console.log(`Created ${svcs?.length || 0} services`)
  }
  const { data: allServices } = await sb.from('services').select('id, name, price, is_wash').eq('business_id', bid).eq('active', true)
  const washServices = allServices.filter(s => s.is_wash)
  const bevServices = allServices.filter(s => !s.is_wash)

  // ── Washers ───────────────────────────────────────────────────────────────
  const existingWashers = (await sb.from('washers').select('name').eq('business_id', bid)).data || []
  const existingWasherNames = new Set(existingWashers.map(w => w.name))
  const newWashers = WASHER_NAMES.filter(n => !existingWasherNames.has(n))
  if (newWashers.length) {
    await sb.from('washers').insert(newWashers.map(name => ({
      business_id: bid, name, phone: `809-${rand(100,999)}-${rand(1000,9999)}`,
      cedula: `${rand(1,4)}${rand(10,99)}-${rand(1000000,9999999)}-${rand(1,9)}`,
      commission_pct: pick([15, 20, 25]), active: true,
    })))
    console.log(`Created ${newWashers.length} washers`)
  }
  const { data: washers } = await sb.from('washers').select('id, name, commission_pct').eq('business_id', bid).eq('active', true)

  // ── Sellers ───────────────────────────────────────────────────────────────
  const existingSellers = (await sb.from('sellers').select('name').eq('business_id', bid)).data || []
  const existingSellerNames = new Set(existingSellers.map(s => s.name))
  const newSellers = SELLER_NAMES.filter(n => !existingSellerNames.has(n))
  if (newSellers.length) {
    await sb.from('sellers').insert(newSellers.map(name => ({
      business_id: bid, name, phone: `809-${rand(100,999)}-${rand(1000,9999)}`,
      commission_pct: pick([3, 5, 7]), active: true,
    })))
    console.log(`Created ${newSellers.length} sellers`)
  }
  const { data: sellers } = await sb.from('sellers').select('id, name, commission_pct').eq('business_id', bid).eq('active', true)

  // ── Clients ───────────────────────────────────────────────────────────────
  const existingClients = (await sb.from('clients').select('name').eq('business_id', bid)).data || []
  const existingClientNames = new Set(existingClients.map(c => c.name))
  const newClients = CLIENT_NAMES.filter(n => !existingClientNames.has(n))
  if (newClients.length) {
    await sb.from('clients').insert(newClients.map(name => ({
      business_id: bid, name,
      rnc: name.includes('SRL') || name.includes('SA') ? `${rand(100,499)}-${rand(10000,99999)}-${rand(1,9)}` : '',
      phone: `809-${rand(100,999)}-${rand(1000,9999)}`,
      credit_limit: pick([0, 5000, 10000, 20000, 50000]),
      balance: 0, visits: 0, total_spent: 0, active: true,
    })))
    console.log(`Created ${newClients.length} clients`)
  }
  const { data: clients } = await sb.from('clients').select('id, name, credit_limit').eq('business_id', bid).eq('active', true)
  const creditClients = clients.filter(c => c.credit_limit > 0)

  // ── NCF Sequences ─────────────────────────────────────────────────────────
  const { data: existingNCF } = await sb.from('ncf_sequences').select('type').eq('business_id', bid)
  const existingTypes = new Set((existingNCF || []).map(n => n.type))
  const ncfTypes = [
    { type: 'B01', prefix: 'B01' },
    { type: 'B02', prefix: 'B02' },
    { type: 'B14', prefix: 'B14' },
    { type: 'B15', prefix: 'B15' },
  ]
  const newNCF = ncfTypes.filter(n => !existingTypes.has(n.type))
  if (newNCF.length) {
    await sb.from('ncf_sequences').insert(newNCF.map(n => ({
      business_id: bid, ...n, current_number: 0, limit_number: 500, active: true, enabled: true,
    })))
    console.log(`Created ${newNCF.length} NCF sequences`)
  }

  // ── Inventory Items ───────────────────────────────────────────────────────
  const { data: existingInv } = await sb.from('inventory_items').select('sku').eq('business_id', bid)
  const existingSkus = new Set((existingInv || []).map(i => i.sku))
  const newInv = INVENTORY_ITEMS.filter(i => !existingSkus.has(i.sku))
  if (newInv.length) {
    const { data: inserted } = await sb.from('inventory_items').insert(
      newInv.map(i => ({ business_id: bid, ...i, active: true }))
    ).select('id, name, quantity')
    // Create initial stock-in transactions
    if (inserted?.length) {
      await sb.from('inventory_transactions').insert(
        inserted.map(i => ({
          business_id: bid, item_id: i.id, type: 'in',
          delta: i.quantity, notes: 'Stock inicial',
        }))
      )
    }
    console.log(`Created ${inserted?.length || 0} inventory items with stock-in transactions`)
  }
  const { data: invItems } = await sb.from('inventory_items').select('id, name, quantity, price').eq('business_id', bid)

  // ── Generate Tickets (30 paid + 5 credit pending) ─────────────────────────
  let ncfCounter = 1
  const ticketsToCreate = []
  const TOTAL_TICKETS = 35

  for (let i = 0; i < TOTAL_TICKETS; i++) {
    const isCredit = i >= 30 // Last 5 are credit
    const daysBack = rand(0, 14)
    const washer = pick(washers)
    const seller = Math.random() > 0.5 ? pick(sellers) : null
    const client = isCredit ? pick(creditClients) : (Math.random() > 0.4 ? pick(clients) : null)

    // Pick 1-3 wash services + 0-2 beverages
    const numWash = rand(1, 3)
    const numBev = rand(0, 2)
    const ticketWashSvcs = []
    const ticketBevSvcs = []
    for (let w = 0; w < numWash; w++) ticketWashSvcs.push(pick(washServices))
    for (let b = 0; b < numBev; b++) ticketBevSvcs.push(pick(bevServices))
    const allItems = [...ticketWashSvcs, ...ticketBevSvcs]

    const subtotal = allItems.reduce((s, svc) => s + parseFloat(svc.price), 0)
    const bevSubtotal = ticketBevSvcs.reduce((s, svc) => s + parseFloat(svc.price), 0)
    const itbis = money(subtotal * 0.18)
    const ley = money(subtotal * 0.10)
    const total = money(subtotal + itbis + ley)
    const docNum = `T-${String(i + 100).padStart(4, '0')}`
    const comprobante = client?.rnc ? 'B01' : 'B02'
    const ncf = `${comprobante}${String(ncfCounter++).padStart(8, '0')}`

    ticketsToCreate.push({
      business_id: bid,
      doc_number: docNum,
      client_id: client?.id || null,
      washer_ids: [washer.id],
      seller_id: seller?.id || null,
      subtotal, descuento: 0, itbis, ley, total,
      beverage_subtotal: bevSubtotal,
      payment_method: isCredit ? 'credit' : pick(['cash', 'cash', 'cash', 'card', 'transfer']),
      comprobante_type: comprobante,
      ncf,
      tipo_venta: isCredit ? 'credito' : 'contado',
      status: isCredit ? 'pendiente' : 'cobrado',
      vehicle_plate: pick(VEHICLE_PLATES),
      vehicle_color: pick(VEHICLE_COLORS),
      vehicle_make: pick(VEHICLE_MAKES),
      created_at: daysAgo(daysBack),
      _items: allItems,
      _washer: washer,
      _seller: seller,
      _client: client,
    })
  }

  // Insert tickets one by one to get IDs back
  let createdCount = 0
  for (const t of ticketsToCreate) {
    const items = t._items
    const washer = t._washer
    const seller = t._seller
    const client = t._client
    delete t._items; delete t._washer; delete t._seller; delete t._client

    const { data: ticket, error: tickErr } = await sb.from('tickets').insert(t).select('id, total, status').single()
    if (tickErr) { console.error(`Ticket ${t.doc_number}:`, tickErr.message); continue }

    // Ticket items
    await sb.from('ticket_items').insert(items.map(svc => ({
      business_id: bid, ticket_id: ticket.id,
      service_id: svc.id, name: svc.name, price: svc.price,
      itbis: money(parseFloat(svc.price) * 0.18), is_wash: svc.is_wash,
    })))

    // Queue entry
    const queueStatus = ticket.status === 'cobrado'
      ? pick(['done', 'done', 'done', 'in_progress'])
      : pick(['waiting', 'in_progress'])
    await sb.from('queue').insert({
      business_id: bid, ticket_id: ticket.id,
      status: queueStatus, washer_id: washer.id,
      assigned_at: queueStatus !== 'waiting' ? t.created_at : null,
      completed_at: queueStatus === 'done' ? t.created_at : null,
    })

    // Washer commission
    const commBase = money((t.subtotal - (t.beverage_subtotal || 0)) / 1.28)
    const commAmt = money(commBase * washer.commission_pct / 100)
    await sb.from('washer_commissions').insert({
      business_id: bid, washer_id: washer.id, ticket_id: ticket.id,
      base_amount: commBase, commission_pct: washer.commission_pct,
      commission_amount: commAmt, paid: ticket.status === 'cobrado' && Math.random() > 0.5,
    })

    // Seller commission
    if (seller) {
      const sellerAmt = money(commBase * seller.commission_pct / 100)
      await sb.from('seller_commissions').insert({
        business_id: bid, seller_id: seller.id, ticket_id: ticket.id,
        base_amount: commBase, commission_pct: seller.commission_pct,
        commission_amount: sellerAmt, paid: false,
      })
    }

    // Update client balance for credit tickets
    if (t.tipo_venta === 'credito' && client) {
      const { data: cur } = await sb.from('clients').select('balance, visits, total_spent').eq('id', client.id).single()
      await sb.from('clients').update({
        balance: money((parseFloat(cur?.balance) || 0) + t.total),
        visits: (cur?.visits || 0) + 1,
        total_spent: money((parseFloat(cur?.total_spent) || 0) + t.total),
      }).eq('id', client.id)
    } else if (client) {
      const { data: cur } = await sb.from('clients').select('visits, total_spent').eq('id', client.id).single()
      await sb.from('clients').update({
        visits: (cur?.visits || 0) + 1,
        total_spent: money((parseFloat(cur?.total_spent) || 0) + t.total),
      }).eq('id', client.id)
    }

    // Inventory sale transactions for beverages sold
    for (const bev of items.filter(s => !s.is_wash)) {
      const invItem = invItems.find(inv => inv.name.toLowerCase().includes(bev.name.toLowerCase().split(' ')[0]))
      if (invItem) {
        await sb.from('inventory_transactions').insert({
          business_id: bid, item_id: invItem.id, type: 'sale', delta: -1,
          notes: `Vendido en ticket ${t.doc_number}`,
        })
        await sb.from('inventory_items').update({
          quantity: Math.max(0, invItem.quantity - 1),
        }).eq('id', invItem.id)
        invItem.quantity = Math.max(0, invItem.quantity - 1)
      }
    }

    createdCount++
  }

  console.log(`Created ${createdCount} tickets with items, queue entries, and commissions`)

  // ── Summary ───────────────────────────────────────────────────────────────
  const { count: ticketCount } = await sb.from('tickets').select('id', { count: 'exact', head: true }).eq('business_id', bid)
  const { count: queueCount } = await sb.from('queue').select('id', { count: 'exact', head: true }).eq('business_id', bid).neq('status', 'done')
  const { count: clientCount } = await sb.from('clients').select('id', { count: 'exact', head: true }).eq('business_id', bid)
  const { count: commCount } = await sb.from('washer_commissions').select('id', { count: 'exact', head: true }).eq('business_id', bid)
  const { data: creditTickets } = await sb.from('tickets').select('id').eq('business_id', bid).eq('status', 'pendiente')

  console.log('\n--- SEED COMPLETE ---')
  console.log(`Tickets:          ${ticketCount}`)
  console.log(`Active in queue:  ${queueCount}`)
  console.log(`Clients:          ${clientCount}`)
  console.log(`Commissions:      ${commCount}`)
  console.log(`Credit (pending): ${creditTickets?.length || 0}`)
  console.log(`Services:         ${allServices.length}`)
  console.log(`Washers:          ${washers.length}`)
  console.log(`Sellers:          ${sellers.length}`)
  console.log(`Inventory items:  ${invItems.length}`)
  console.log('\nPlan set to: pro_max (all features unlocked)')
}

main().catch(err => { console.error(err); process.exit(1) })
