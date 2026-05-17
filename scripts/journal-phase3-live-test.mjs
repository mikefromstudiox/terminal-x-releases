#!/usr/bin/env node
// Phase 3 live test — synthetic sale + void against journal_entries.
// Service-role insert (bypasses RLS) to prove table shape + helper output.
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'
import {
  buildSaleEntries,
  buildReversalEntries,
  buildExpenseEntries,
} from '../packages/services/journal.js'

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error('missing env'); process.exit(1) }
const sb = createClient(URL, KEY, { auth: { persistSession: false } })

const BIZ = process.argv[2] || '46c28a6c-a20a-4b91-9d7d-8f5bf3fd497e' // Demo Tienda
const FLAG_KEY = 'journal_entries_v1'

async function main() {
  console.log('=== Phase 3 live test against biz', BIZ, '===')

  // 1) flip flag on
  {
    const sid = crypto.randomUUID()
    const { error } = await sb.from('app_settings').upsert({
      supabase_id: sid, business_id: BIZ, key: FLAG_KEY, value: 'true',
      is_device_local: false, device_hwid: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'business_id,key,device_hwid' })
    if (error) console.warn('flag set warn:', error.message)
    else console.log('flag set ON')
  }

  // 2) build synthetic sale entries
  const ticketSid = crypto.randomUUID()
  const it1Sid = crypto.randomUUID()
  const it2Sid = crypto.randomUUID()
  const it3Sid = crypto.randomUUID()
  // Prices are GROSS (DR ITBIS-inclusive). 4 units × 100 = 400 gross total.
  // Items with aplica_itbis=true → itbis = gross - gross/1.18 per line.
  const args = {
    ticket: {
      supabase_id: ticketSid, business_id: BIZ,
      total: 400.00, itbis: 61.02,
      payment_method: 'cash', tipo_venta: 'contado',
      created_at: new Date().toISOString(), date: new Date().toISOString(),
      created_by: null,
    },
    items: [
      { supabase_id: it1Sid, service_supabase_id: 'svc-1', qty: 1, price: 100, cost: 60, itbis: null, name: 'Test Soda', is_wash: false },
      { supabase_id: it2Sid, service_supabase_id: 'svc-2', qty: 2, price: 100, cost: 50, itbis: null, name: 'Test Beer', is_wash: false },
      { supabase_id: it3Sid, service_supabase_id: 'svc-3', qty: 1, price: 100, cost: 0, itbis: null, name: 'Test Service', is_wash: true },
    ],
    services: [
      { supabase_id: 'svc-1', is_wash: false, aplica_itbis: true, is_menu_item: false, category: 'bebidas' },
      { supabase_id: 'svc-2', is_wash: false, aplica_itbis: true, is_menu_item: false, category: 'cerveza' },
      { supabase_id: 'svc-3', is_wash: true,  aplica_itbis: true, is_menu_item: false, category: null },
    ],
    biz: { id: BIZ, business_type: 'tienda' },
  }
  const saleRows = buildSaleEntries(args)
  console.log('built', saleRows.length, 'sale rows')

  // 3) insert via service role
  {
    const { error } = await sb.from('journal_entries').insert(saleRows)
    if (error) { console.error('sale insert error:', error.message); process.exit(2) }
    console.log('inserted sale rows')
  }

  // 4) query back
  {
    const { data } = await sb.from('journal_entries')
      .select('tx_group_id, account, debit, credit')
      .eq('business_id', BIZ).eq('source_id', ticketSid)
      .order('id', { ascending: true })
    console.log('SALE SELECT:')
    console.table(data)
    const sumD = (data || []).reduce((s, r) => s + Number(r.debit || 0), 0)
    const sumC = (data || []).reduce((s, r) => s + Number(r.credit || 0), 0)
    console.log(`Σdebit=${sumD.toFixed(2)}  Σcredit=${sumC.toFixed(2)}  diff=${(sumD - sumC).toFixed(4)}`)
  }

  // 5) build reversal entries
  {
    const { data: origs } = await sb.from('journal_entries').select('*')
      .eq('business_id', BIZ).eq('source_id', ticketSid).is('reversal_of_id', null)
    const revRows = buildReversalEntries({ originalRows: origs || [] })
    console.log('built', revRows.length, 'reversal rows')
    const { error } = await sb.from('journal_entries').insert(revRows)
    if (error) { console.error('reversal insert error:', error.message); process.exit(3) }
    console.log('inserted reversal rows')
  }

  // 6) confirm reversal
  {
    const { data } = await sb.from('journal_entries')
      .select('tx_group_id, account, debit, credit, reversal_of_id')
      .eq('business_id', BIZ).eq('source_id', ticketSid)
      .not('reversal_of_id', 'is', null)
      .order('id', { ascending: true })
    console.log('REVERSAL SELECT:')
    console.table(data)
  }

  // 7) cleanup — delete our synthetic test rows so we don't pollute the demo.
  {
    const { error } = await sb.from('journal_entries').delete()
      .eq('business_id', BIZ).eq('source_id', ticketSid)
    if (error) console.warn('cleanup warn:', error.message)
    else console.log('cleaned up synthetic test rows')
  }

  // 8) flip flag back to false
  {
    const { error } = await sb.from('app_settings').update({ value: 'false' })
      .eq('business_id', BIZ).eq('key', FLAG_KEY)
    if (error) console.warn('flag reset warn:', error.message)
    else console.log('flag reset OFF')
  }

  console.log('OK')
}

main().catch(e => { console.error('FATAL', e); process.exit(99) })
