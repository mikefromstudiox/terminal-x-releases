/**
 * apply-demo-fixes-f2-f3.mjs — Apply two data fixes to Supabase demo businesses:
 *   F2: retag empleados.tipo lavador→vendedor for restaurant + dealership
 *   F3: seed B01+B02 ncf_sequences for all 11 demo businesses (idempotent)
 *
 *   node scripts/apply-demo-fixes-f2-f3.mjs
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

const uuid = () => crypto.randomUUID()

const F2_TARGETS = [
  { id: 'b037c2a8-d8d2-45f6-ada1-f851cf0190a4', label: 'restaurant' },
  { id: '60dbf844-323f-4913-8847-9499ca6be995', label: 'dealership' },
]

async function fix2() {
  console.log('\n=== FIX 2: empleados.tipo lavador→vendedor ===')
  for (const t of F2_TARGETS) {
    const { data, error } = await sb
      .from('empleados')
      .update({ tipo: 'vendedor' })
      .eq('business_id', t.id)
      .eq('tipo', 'lavador')
      .select('id')
    if (error) { console.log(`  [${t.label}] ERROR: ${error.message}`); continue }
    console.log(`  [${t.label}] empleados retagged: ${data?.length || 0} rows`)
  }
}

async function fix3() {
  console.log('\n=== FIX 3: NCF B01+B02 sequences for demo businesses ===')
  const { data: demos, error } = await sb
    .from('businesses')
    .select('id, name, email')
    .like('email', '%demo.terminalxpos.com')
    .order('name')
  if (error) { console.log(`  ERROR listing: ${error.message}`); return [] }
  console.log(`  found ${demos.length} demo businesses`)

  for (const biz of demos) {
    const { data: existing } = await sb
      .from('ncf_sequences')
      .select('type')
      .eq('business_id', biz.id)
      .in('type', ['B01', 'B02'])
    const have = new Set((existing || []).map(r => r.type))
    const rows = []
    if (!have.has('B01')) rows.push({ business_id: biz.id, supabase_id: uuid(), type: 'B01', prefix: 'B01', current_number: 0, limit_number: 500, active: true, enabled: true })
    if (!have.has('B02')) rows.push({ business_id: biz.id, supabase_id: uuid(), type: 'B02', prefix: 'B02', current_number: 0, limit_number: 500, active: true, enabled: true })
    if (rows.length === 0) {
      console.log(`  [${biz.name}] ncf seeded: +0 rows (already has B01+B02)`)
      continue
    }
    const { error: insErr } = await sb.from('ncf_sequences').insert(rows)
    if (insErr) { console.log(`  [${biz.name}] ERROR: ${insErr.message}`); continue }
    console.log(`  [${biz.name}] ncf seeded: +${rows.length} rows`)
  }
  return demos
}

async function verify(demos) {
  console.log('\n=== VERIFY ===')
  for (const biz of demos) {
    const { data: emps } = await sb
      .from('empleados')
      .select('tipo')
      .eq('business_id', biz.id)
    const tipoCounts = {}
    for (const e of emps || []) tipoCounts[e.tipo || 'null'] = (tipoCounts[e.tipo || 'null'] || 0) + 1
    const { data: ncfs } = await sb
      .from('ncf_sequences')
      .select('type')
      .eq('business_id', biz.id)
      .order('type')
    const ncfTypes = (ncfs || []).map(r => r.type).sort()
    console.log(`  [${biz.name.padEnd(40)}] empleados=${JSON.stringify(tipoCounts)}  ncf=[${ncfTypes.join(',')}]`)
  }
}

async function main() {
  await fix2()
  const demos = await fix3()
  if (demos?.length) await verify(demos)
  console.log('\ndone.')
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
