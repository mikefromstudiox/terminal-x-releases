#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import crypto from 'crypto'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const BIZ = 'b3ffb106-6a22-4107-bd1c-85f38af30028'

let pass = 0, fail = 0

// FIX T — staff.username empty rejected
const r1 = await sb.from('staff').insert({
  id: crypto.randomUUID(), supabase_id: crypto.randomUUID(), business_id: BIZ,
  name: 'FIX-T', username: '', role: 'cashier', active: true,
  pin_hash: '$2a$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTU',
  pin_hash_algo: 'bcrypt', pin_salt: 'xx',
}).select('id').single()
if (r1.error && /chk_staff_username_not_blank/.test(r1.error.message)) { console.log('✓ FIX T — empty username rejected'); pass++ }
else { console.log('✗ FIX T failed:', r1.error?.message || 'accepted'); fail++ }

// FIX AA — journal_lines debit AND credit both > 0 rejected
// Need a journal_entry first
const jeRes = await sb.from('accounting_journal_entries').insert({
  supabase_id: crypto.randomUUID(), business_id: '334c7e17-f344-443b-b339-46f083b8ebfb',
  fecha: '2026-05-18', description: 'FIX-AA-JE', type: 'manual', status: 'draft',
  period_year: 2026, period_month: 5, totals_debit: 100, totals_credit: 100,
}).select('id, supabase_id').single()
if (jeRes.error) { console.log('cant create je:', jeRes.error); }
else {
  const r2 = await sb.from('accounting_journal_lines').insert({
    supabase_id: crypto.randomUUID(), business_id: '334c7e17-f344-443b-b339-46f083b8ebfb',
    journal_entry_id: jeRes.data.id, journal_entry_supabase_id: jeRes.data.supabase_id,
    debit: 50, credit: 50,
  }).select('id').single()
  if (r2.error && /chk_je_line_debit_xor_credit/.test(r2.error.message)) { console.log('✓ FIX AA — both debit+credit rejected'); pass++ }
  else { console.log('✗ FIX AA:', r2.error?.message || 'accepted'); fail++ }
  await sb.from('accounting_journal_entries').delete().eq('id', jeRes.data.id)
}

// FIX inbox confidence range
const r3 = await sb.from('accounting_inbox').insert({
  supabase_id: crypto.randomUUID(), business_id: '334c7e17-f344-443b-b339-46f083b8ebfb',
  source: 'dropzone', original_filename: 'fixaa.pdf', mime: 'application/pdf', size: 1024,
  ocr_status: 'pending', classified_type: 'factura_pdf',
  classification_confidence: 1.5,
  status: 'unclassified',
}).select('id').single()
if (r3.error && /chk_inbox_confidence_range/.test(r3.error.message)) { console.log('✓ FIX inbox confidence — 1.5 rejected'); pass++ }
else { console.log('✗ inbox confidence:', r3.error?.message || 'accepted'); fail++ }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
