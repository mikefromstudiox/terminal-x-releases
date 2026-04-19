import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
for (const line of fs.readFileSync('.env','utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: bizs, error: bizErr } = await sb.from('businesses').select('id, name, email, settings').like('email', '%demo.terminalxpos.com');
if (bizErr) { console.error('bizErr', bizErr); process.exit(1); }
console.log('=== BUSINESSES ===');
for (const b of bizs) {
  const bt = b.settings?.business_type || b.settings?.businessType || '?';
  console.log(`${b.email} | id=${b.id} | type=${bt} | name=${b.name}`);
}

console.log('\n=== COUNTS & DATA PER BUSINESS ===');
for (const b of bizs) {
  const bt = b.settings?.business_type || b.settings?.businessType || '?';
  const [services, empleados, inv, tickets, ncf] = await Promise.all([
    sb.from('services').select('id,name,category,is_wash,price', {count:'exact'}).eq('business_id', b.id),
    sb.from('empleados').select('id,nombre,tipo,role', {count:'exact'}).eq('business_id', b.id),
    sb.from('inventory_items').select('id', {count:'exact', head:true}).eq('business_id', b.id),
    sb.from('tickets').select('id,doc_number,created_at', {count:'exact'}).eq('business_id', b.id).gte('created_at', new Date(Date.now()-7*86400000).toISOString()).order('created_at',{ascending:false}).limit(5),
    sb.from('ncf_sequences').select('ncf_type,current_sequence,max_sequence', {count:'exact'}).eq('business_id', b.id),
  ]);

  console.log(`\n--- ${b.email} (${bt}) ---`);
  console.log(`services=${services.count} empleados=${empleados.count} inventory=${inv.count} tickets7d=${tickets.count} ncf=${ncf.count}`);
  const lavadoSvcs = (services.data||[]).filter(s=>s.category==='Lavado');
  const isWashSvcs = (services.data||[]).filter(s=>s.is_wash===1 || s.is_wash===true);
  if (bt !== 'carwash') {
    if (lavadoSvcs.length) console.log(`  [BUG] ${lavadoSvcs.length} services with category='Lavado': ${lavadoSvcs.map(s=>s.name).join(', ')}`);
    if (isWashSvcs.length) console.log(`  [BUG] ${isWashSvcs.length} services with is_wash=1: ${isWashSvcs.map(s=>s.name).join(', ')}`);
  }
  const nonServiceTypes = ['retail','restaurant','dealership','prestamos','licoreria','carniceria','tienda'];
  if (nonServiceTypes.includes(bt)) {
    const lavs = (empleados.data||[]).filter(e=>e.tipo==='lavador');
    if (lavs.length) console.log(`  [BUG] ${lavs.length} empleados tipo=lavador: ${lavs.map(e=>e.nombre).join(', ')}`);
  }
  const types = (ncf.data||[]).map(n=>n.ncf_type);
  if (!types.includes('B01')) console.log(`  [WARN] Missing B01 NCF sequence`);
  if (!types.includes('B02')) console.log(`  [WARN] Missing B02 NCF sequence`);
  if ((services.count||0) < 3) console.log(`  [SPARSE] services count ${services.count}`);
  if ((empleados.count||0) < 3) console.log(`  [SPARSE] empleados count ${empleados.count}`);
  if ((inv.count||0) < 3 && ['retail','licoreria','carniceria','tienda'].includes(bt)) console.log(`  [SPARSE] inventory count ${inv.count}`);
  if ((tickets.count||0) < 3) console.log(`  [SPARSE] tickets 7d count ${tickets.count}`);
  if (tickets.data?.length) console.log(`  sample doc_numbers: ${tickets.data.slice(0,3).map(t=>t.doc_number||'(null)').join(' | ')}`);
  const catCounts = {};
  for (const s of (services.data||[])) catCounts[s.category||'(null)'] = (catCounts[s.category||'(null)']||0)+1;
  console.log(`  service categories: ${JSON.stringify(catCounts)}`);
}
