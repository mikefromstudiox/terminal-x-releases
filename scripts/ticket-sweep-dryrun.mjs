#!/usr/bin/env node
import fs from 'node:fs';
function loadEnv(f){if(!fs.existsSync(f))return;for(const l of fs.readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);if(!m)continue;if(process.env[m[1]]==null)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}}
loadEnv('./.env')
const URL_=process.env.SUPABASE_URL, MGMT=process.env.SUPABASE_ACCESS_TOKEN
const REF=(URL_||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1]
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${MGMT}`},body:JSON.stringify({query:sql})}); return r.ok?r.json():(console.error(r.status,await r.text()),null)}
const BIZ = {
  'Studio X Car Wash': '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79',
  'Ranoza Liquor Store': '4f789f41-76d2-4402-838f-5fe20a91641f',
}
for (const [name, id] of Object.entries(BIZ)) {
  console.log(`\n══════════ ${name}  (${id}) ══════════`)
  const counts = await q(`
    SELECT
      (SELECT count(*) FROM public.tickets WHERE business_id='${id}')                  AS tickets,
      (SELECT count(*) FROM public.ticket_items WHERE business_id='${id}')             AS ticket_items,
      (SELECT count(*) FROM public.ticket_item_modificadores WHERE business_id='${id}') AS ticket_item_mods,
      (SELECT count(*) FROM public.seller_commissions WHERE business_id='${id}')       AS seller_comm,
      (SELECT count(*) FROM public.washer_commissions WHERE business_id='${id}')       AS washer_comm,
      (SELECT count(*) FROM public.cajero_commissions WHERE business_id='${id}')       AS cajero_comm,
      (SELECT count(*) FROM public.mechanic_commissions WHERE business_id='${id}')     AS mechanic_comm,
      (SELECT count(*) FROM public.credit_payments WHERE business_id='${id}')          AS credit_payments,
      (SELECT count(*) FROM public.loyalty_transactions WHERE business_id='${id}')     AS loyalty_tx,
      (SELECT count(*) FROM public.inventory_transactions WHERE business_id='${id}')   AS inv_tx,
      (SELECT count(*) FROM public.notas_credito WHERE business_id='${id}')            AS notas_credito,
      (SELECT count(*) FROM public.ecf_queue WHERE business_id='${id}')                AS ecf_queue,
      (SELECT count(*) FROM public.ecf_submissions WHERE business_id='${id}')          AS ecf_subm,
      (SELECT count(*) FROM public.kds_events WHERE business_id='${id}')               AS kds_events,
      (SELECT count(*) FROM public.queue WHERE business_id='${id}')                    AS queue,
      (SELECT count(*) FROM public.cuadre_caja WHERE business_id='${id}')              AS cuadre,
      (SELECT count(*) FROM public.clients WHERE business_id='${id}' AND (balance != 0 OR total_spent != 0 OR visits != 0 OR loyalty_points != 0 OR loyalty_lifetime_earned != 0)) AS clients_with_history,
      (SELECT count(*) FROM public.inventory_items WHERE business_id='${id}')          AS inventory_items_total,
      (SELECT count(*) FROM public.ncf_sequences WHERE business_id='${id}' AND current_number > 0) AS ncf_seq_used
  `)
  console.table(counts[0])
}
