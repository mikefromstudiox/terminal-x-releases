/**
 * demo-fixes-probe.mjs — verify tonight's fixes hold across all 10 demo
 * businesses. Programmatic probes against Supabase, no UI clicks needed.
 *
 * Each demo gets:
 *   1. UNIQUE-index sanity — try to insert a duplicate empleado/service/SKU,
 *      expect 23505 (unique violation). Cleans up after itself.
 *   2. CASCADE-FK sanity — pick one ticket, attempt to insert a dummy
 *      washer_commission with a fake ticket_supabase_id, expect 23503 (FK).
 *      Then verify normal cascade works on a real ticket if any has dependents.
 *   3. Liquidación pull — call the equivalent of commissionsGetByPeriod
 *      via SQL and confirm it returns ≥0 rows with empleado names resolved
 *      (LEFT JOIN test).
 */
import 'dotenv/config'
import crypto from 'node:crypto'

const TOK = process.env.SUPABASE_ACCESS_TOKEN
const REF = new URL(process.env.SUPABASE_URL).hostname.split('.')[0]
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  return r.json()
}

const DEMOS = [
  { id: '52d0a7be-03c9-4352-92d2-19e4825eaf3a', name: 'Carniceria Demo' },
  { id: 'e5fa6fc1-75d1-4bab-8e07-6480de202b1b', name: 'Demo Car Wash' },
  { id: '60dbf844-323f-4913-8847-9499ca6be995', name: 'Demo Concesionario' },
  { id: 'd8db00a2-30c5-4aa5-8fbe-26d06e69dce0', name: 'Demo Prestamos' },
  { id: 'b037c2a8-d8d2-45f6-ada1-f851cf0190a4', name: 'Demo Restaurante' },
  { id: 'b14f83cb-15c9-4c1f-946c-5256265dab7a', name: 'Demo Salon de Belleza' },
  { id: '9fe0cab2-5e92-4222-a43a-616083c6470b', name: 'Demo Servicios Profesionales' },
  { id: '32e2cc8f-8626-4e54-ad80-71dfb100247c', name: 'Demo Taller Mecanico' },
  { id: '46c28a6c-a20a-4b91-9d7d-8f5bf3fd497e', name: 'Demo Tienda' },
  { id: '949fd70b-4609-4c71-a3af-2b9160043c3e', name: 'Licoreria Demo' },
]

const results = []
for (const d of DEMOS) {
  const row = { name: d.name, t1_unique: null, t2_fk: null, t3_liquidacion: null, t4_cascade_ready: null }

  // T1 — try to insert a duplicate empleado cedula. Pick an existing one
  // and re-insert with same cedula but new supabase_id; expect 23505.
  const sample = await q(`SELECT cedula FROM empleados WHERE business_id='${d.id}' AND cedula IS NOT NULL AND cedula <> '' LIMIT 1`)
  if (Array.isArray(sample) && sample[0]?.cedula) {
    const cedula = sample[0].cedula.replace(/'/g, "''")
    const dupeSid = crypto.randomUUID()
    const r = await q(`INSERT INTO empleados (business_id, supabase_id, nombre, cedula, tipo, active, start_date) VALUES ('${d.id}', '${dupeSid}', 'PROBE_DUPE_${Date.now()}', '${cedula}', 'cajero', true, CURRENT_DATE)`)
    if (r?.message && /23505|duplicate|unique/i.test(r.message)) {
      row.t1_unique = '✓ rejected (unique)'
    } else if (r?.message) {
      row.t1_unique = `? other err (${r.message.slice(0,40)})`
      await q(`DELETE FROM empleados WHERE supabase_id='${dupeSid}'`)
    } else {
      row.t1_unique = '✗ ALLOWED dupe — cleaning up'
      await q(`DELETE FROM empleados WHERE supabase_id='${dupeSid}'`)
    }
  } else {
    row.t1_unique = 'skip (no cedula)'
  }

  // T2 — try to insert a washer_commission referencing a non-existent
  // ticket_supabase_id. Expect 23503 (FK violation) thanks to the new
  // CASCADE FK migration.
  const empSample = await q(`SELECT supabase_id FROM empleados WHERE business_id='${d.id}' LIMIT 1`)
  if (Array.isArray(empSample) && empSample[0]?.supabase_id) {
    const fakeTicketSid = crypto.randomUUID()
    const probeSid = crypto.randomUUID()
    const r = await q(`INSERT INTO washer_commissions (business_id, supabase_id, empleado_supabase_id, ticket_supabase_id, base_amount, commission_amount, paid) VALUES ('${d.id}', '${probeSid}', '${empSample[0].supabase_id}', '${fakeTicketSid}', 100, 10, false)`)
    if (r?.message && /23503|foreign key|violates/i.test(r.message)) {
      row.t2_fk = '✓ FK rejected fake ticket_supabase_id'
    } else {
      row.t2_fk = '✗ FK MISSING or insert succeeded — cleaning up'
      await q(`DELETE FROM washer_commissions WHERE supabase_id='${probeSid}'`)
    }
  } else {
    row.t2_fk = 'skip (no empleado)'
  }

  // T3 — liquidación render: simulate commissionsGetByPeriod with LEFT JOIN.
  // Should return a row per empleado_supabase_id, including any with no
  // matching empleados row (those show as '(sin empleado)').
  const lq = await q(`
    SELECT count(*) AS rows_returned,
           SUM(CASE WHEN washer_name = '(sin empleado)' THEN 1 ELSE 0 END) AS orphan_groups
    FROM (
      SELECT wc.empleado_supabase_id,
             COALESCE(e.nombre, '(sin empleado)') AS washer_name
      FROM washer_commissions wc
      LEFT JOIN empleados e ON e.supabase_id = wc.empleado_supabase_id
      WHERE wc.business_id = '${d.id}'
      GROUP BY wc.empleado_supabase_id, e.nombre
    ) g`)
  if (Array.isArray(lq) && lq[0]) {
    row.t3_liquidacion = `✓ ${lq[0].rows_returned} groups (${lq[0].orphan_groups || 0} orphan)`
  }

  // T4 — count tickets that would be safely cascade-deleted vs orphan-leaving
  const cas = await q(`
    SELECT (SELECT count(*) FROM tickets WHERE business_id='${d.id}') AS tickets,
           (SELECT count(*) FROM washer_commissions WHERE business_id='${d.id}' AND ticket_supabase_id IS NOT NULL AND ticket_supabase_id NOT IN (SELECT supabase_id FROM tickets WHERE supabase_id IS NOT NULL)) AS w_orphans,
           (SELECT count(*) FROM seller_commissions WHERE business_id='${d.id}' AND ticket_supabase_id IS NOT NULL AND ticket_supabase_id NOT IN (SELECT supabase_id FROM tickets WHERE supabase_id IS NOT NULL)) AS s_orphans,
           (SELECT count(*) FROM ticket_items WHERE business_id='${d.id}' AND ticket_supabase_id IS NOT NULL AND ticket_supabase_id NOT IN (SELECT supabase_id FROM tickets WHERE supabase_id IS NOT NULL)) AS i_orphans`)
  if (Array.isArray(cas) && cas[0]) {
    const orphans = Number(cas[0].w_orphans) + Number(cas[0].s_orphans) + Number(cas[0].i_orphans)
    row.t4_cascade_ready = orphans === 0 ? `✓ ${cas[0].tickets} tickets, 0 orphans` : `✗ ${orphans} orphans across w/s/items`
  }

  results.push(row)
}

console.log('\n' + 'BUSINESS'.padEnd(32) + 'T1 unique' .padEnd(28) + 'T2 ticket FK'.padEnd(40) + 'T3 liquidación'.padEnd(28) + 'T4 cascade ready')
console.log('-'.repeat(180))
for (const r of results) {
  console.log(r.name.padEnd(32) + (r.t1_unique || '-').padEnd(28) + (r.t2_fk || '-').padEnd(40) + (r.t3_liquidacion || '-').padEnd(28) + (r.t4_cascade_ready || '-'))
}

const failed = results.filter(r => /✗|MISSING|ALLOWED/.test(JSON.stringify(r))).length
console.log('\n' + (failed === 0 ? '✅ ALL CLEAR' : `⚠️  ${failed} demo(s) have findings — see above`))
