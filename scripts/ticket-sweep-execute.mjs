#!/usr/bin/env node
// ticket-sweep-execute.mjs — wipe test tickets for Studio X Car Wash + Ranoza
// Preserves: NCF sequence numbers (DGII compliance), historical commission
// imports (ticket_supabase_id IS NULL), inventory_items quantities (Ranoza
// test sales weren't linked to inventory rows so nothing was deducted).
import fs from 'node:fs';
function loadEnv(f){if(!fs.existsSync(f))return;for(const l of fs.readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);if(!m)continue;if(process.env[m[1]]==null)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}}
loadEnv('./.env')
const URL_=process.env.SUPABASE_URL, MGMT=process.env.SUPABASE_ACCESS_TOKEN
const REF=(URL_||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1]
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${MGMT}`},body:JSON.stringify({query:sql})}); return r.ok?r.json():[r.status, await r.text()]}

const BIZ = {
  'Studio X Car Wash':   '1e14fdf4-eaf9-4a8e-abaf-deb81dc25b79',
  'Ranoza Liquor Store': '4f789f41-76d2-4402-838f-5fe20a91641f',
}

const sweepSql = (bizId) => `
DO $$
DECLARE
  v_biz uuid := '${bizId}'::uuid;
  v_tickets int;
  v_items   int;
  v_w_comm  int;
  v_s_comm  int;
  v_c_comm  int;
  v_m_comm  int;
  v_loyalty int;
  v_credit  int;
  v_ecf_q   int;
  v_ecf_s   int;
  v_kds     int;
  v_queue   int;
  v_cuadre  int;
  v_clients int;
BEGIN
  -- All ticket_items modificadores tied to this biz's tickets
  DELETE FROM public.ticket_item_modificadores tim
  USING public.ticket_items ti
  WHERE tim.ticket_item_supabase_id = ti.supabase_id AND ti.business_id = v_biz;

  -- ticket-linked commissions (preserve NULL-ticket historical imports)
  DELETE FROM public.washer_commissions   WHERE business_id = v_biz AND ticket_supabase_id IS NOT NULL;
  GET DIAGNOSTICS v_w_comm = ROW_COUNT;
  DELETE FROM public.seller_commissions   WHERE business_id = v_biz AND ticket_supabase_id IS NOT NULL;
  GET DIAGNOSTICS v_s_comm = ROW_COUNT;
  DELETE FROM public.cajero_commissions   WHERE business_id = v_biz AND ticket_supabase_id IS NOT NULL;
  GET DIAGNOSTICS v_c_comm = ROW_COUNT;
  DELETE FROM public.mechanic_commissions WHERE business_id = v_biz AND ticket_supabase_id IS NOT NULL;
  GET DIAGNOSTICS v_m_comm = ROW_COUNT;

  -- credit + loyalty linked to tickets
  DELETE FROM public.credit_payments      WHERE business_id = v_biz;
  GET DIAGNOSTICS v_credit = ROW_COUNT;
  DELETE FROM public.loyalty_transactions WHERE business_id = v_biz;
  GET DIAGNOSTICS v_loyalty = ROW_COUNT;

  -- e-CF queue + submissions for these tickets
  DELETE FROM public.ecf_queue        WHERE business_id = v_biz;
  GET DIAGNOSTICS v_ecf_q = ROW_COUNT;
  DELETE FROM public.ecf_submissions  WHERE business_id = v_biz;
  GET DIAGNOSTICS v_ecf_s = ROW_COUNT;

  -- kitchen + queue + cuadre
  DELETE FROM public.kds_events  WHERE business_id = v_biz;
  GET DIAGNOSTICS v_kds = ROW_COUNT;
  DELETE FROM public.queue       WHERE business_id = v_biz;
  GET DIAGNOSTICS v_queue = ROW_COUNT;
  DELETE FROM public.cuadre_caja WHERE business_id = v_biz;
  GET DIAGNOSTICS v_cuadre = ROW_COUNT;

  -- ticket items + tickets
  DELETE FROM public.ticket_items WHERE business_id = v_biz;
  GET DIAGNOSTICS v_items = ROW_COUNT;
  DELETE FROM public.tickets      WHERE business_id = v_biz;
  GET DIAGNOSTICS v_tickets = ROW_COUNT;

  -- reset client aggregates (zero out balance/visits/loyalty for this biz only)
  UPDATE public.clients
     SET balance = 0,
         total_spent = 0,
         visits = 0,
         loyalty_points = 0,
         loyalty_lifetime_earned = 0,
         birthday_treat_available = false,
         updated_at = now()
   WHERE business_id = v_biz
     AND (balance != 0 OR total_spent != 0 OR visits != 0
          OR loyalty_points != 0 OR loyalty_lifetime_earned != 0);
  GET DIAGNOSTICS v_clients = ROW_COUNT;

  RAISE NOTICE 'biz=% tickets=% items=% washer_comm=% seller_comm=% cajero_comm=% mechanic_comm=% credit=% loyalty=% ecf_q=% ecf_s=% kds=% queue=% cuadre=% clients_reset=%',
    v_biz, v_tickets, v_items, v_w_comm, v_s_comm, v_c_comm, v_m_comm,
    v_credit, v_loyalty, v_ecf_q, v_ecf_s, v_kds, v_queue, v_cuadre, v_clients;
END $$;
`

for (const [name, id] of Object.entries(BIZ)) {
  console.log(`\n══════ ${name} ══════`)
  const r = await q(sweepSql(id))
  console.log(JSON.stringify(r))
}

console.log('\n--- post-wipe verification ---')
for (const [name, id] of Object.entries(BIZ)) {
  const c = await q(`SELECT
      (SELECT count(*) FROM public.tickets WHERE business_id='${id}') AS tickets,
      (SELECT count(*) FROM public.ticket_items WHERE business_id='${id}') AS items,
      (SELECT count(*) FROM public.washer_commissions WHERE business_id='${id}' AND ticket_supabase_id IS NOT NULL) AS live_washer_comm,
      (SELECT count(*) FROM public.washer_commissions WHERE business_id='${id}' AND ticket_supabase_id IS NULL) AS historical_washer_comm,
      (SELECT count(*) FROM public.seller_commissions WHERE business_id='${id}' AND ticket_supabase_id IS NOT NULL) AS live_seller_comm,
      (SELECT count(*) FROM public.seller_commissions WHERE business_id='${id}' AND ticket_supabase_id IS NULL) AS historical_seller_comm,
      (SELECT count(*) FROM public.queue WHERE business_id='${id}') AS queue,
      (SELECT count(*) FROM public.cuadre_caja WHERE business_id='${id}') AS cuadre,
      (SELECT count(*) FROM public.clients WHERE business_id='${id}' AND (balance!=0 OR total_spent!=0 OR visits!=0)) AS clients_with_history`)
  console.log(name, c[0])
}
