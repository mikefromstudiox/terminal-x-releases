#!/usr/bin/env node
// seed-demos-v2120.mjs — Refresh Terminal X demo data on Supabase prod for v2.12.0.
// Append-only (won't wipe existing tickets). Per-account additions:
//   - Licoreria (retail): 4 loyalty clients with loyalty_transactions earn/redeem trail
//   - Restaurant: 2-3 tickets with payment_parts JSONB populated (cash + card)
//   - Carwash: 1 inventory_oversells row referencing an existing sold-out SKU ticket
//   - Every demo: businesses.settings.ecf_cert_expiry = NOW + 45 days
//   - Every demo: 1 activity_log ticket_void with Manager Auth Card metadata

import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const env = Object.fromEntries(
  fs.readFileSync('A:/Studio X HUB/Terminal X/.env', 'utf8')
    .split(/\r?\n/).filter(Boolean)
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);
const SUPABASE_URL = env.SUPABASE_URL || 'https://csppjsoirjflumaiipqw.supabase.co';
const SRK = env.SUPABASE_SERVICE_ROLE_KEY;
const AT  = env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = 'csppjsoirjflumaiipqw';
if (!SRK) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

async function rest(method, pq, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pq}`, {
    method,
    headers: {
      apikey: SRK, Authorization: `Bearer ${SRK}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`REST ${method} ${pq} ${res.status}: ${text}`);
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}
async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${text}`);
  return JSON.parse(text);
}

const summary = {};
const log = (email, msg) => { (summary[email] ||= []).push(msg); console.log(`[${email}] ${msg}`); };

async function main() {
  const businesses = await sql(
    `SELECT id::text AS id, name, email, settings FROM businesses WHERE email LIKE '%demo.terminalxpos.com%' ORDER BY email;`
  );
  console.log(`Found ${businesses.length} demo businesses\n`);
  const byEmail = Object.fromEntries(businesses.map(b => [b.email, b]));

  // ------------------------------------------------------------------
  // 1) EVERY demo: set ecf_cert_expiry to NOW + 45 days
  // ------------------------------------------------------------------
  const expiryISO = new Date(Date.now() + 45 * 86400 * 1000).toISOString();
  for (const b of businesses) {
    const settings = { ...(b.settings || {}), ecf_cert_expiry: expiryISO };
    await rest('PATCH', `businesses?id=eq.${b.id}`, { settings });
    log(b.email, `settings.ecf_cert_expiry set to ${expiryISO.slice(0, 10)}`);
  }

  // ------------------------------------------------------------------
  // 2) EVERY demo: add 1 activity_log row: voided ticket w/ MAC metadata
  //    (idempotent: skip if a row w/ source=seed-demos-v2120 already exists)
  // ------------------------------------------------------------------
  for (const b of businesses) {
    const existing = await sql(
      `SELECT COUNT(*)::int AS n FROM activity_log WHERE business_id='${b.id}' AND event_type='ticket_voided' AND metadata->>'source'='seed-demos-v2120';`
    );
    if (existing[0].n > 0) {
      log(b.email, `activity_log ticket_voided already seeded (n=${existing[0].n}) — skip`);
      continue;
    }
    const row = {
      supabase_id: randomUUID(),
      business_id: b.id,
      event_type: 'ticket_voided',
      severity: 'warn',
      actor_name: 'demo_owner',
      actor_role: 'owner',
      target_type: 'ticket',
      target_name: 'Ticket #DEMO-VOID',
      amount: 250,
      reason: 'Cliente canceló — demo v2.12.0',
      metadata: { mac_scan: 'barcode', approved_by: 'demo_owner', source: 'seed-demos-v2120' },
    };
    await rest('POST', 'activity_log', row);
    log(b.email, `activity_log +1 ticket_void (mac_scan=barcode, approved_by=demo_owner)`);
  }

  // ------------------------------------------------------------------
  // 3) Licoreria (retail) loyalty: 4 clients w/ loyalty_transactions
  //    Loyalty "membership" = clients.loyalty_points column.
  //    Ledger = loyalty_transactions (event_type, points, balance_after).
  // ------------------------------------------------------------------
  const licoreria = byEmail['admin@retail.demo.terminalxpos.com'];
  if (licoreria) {
    const demoClients = [
      { name: 'María Hernández (Loyalty)', phone: '8095551001', earn: 450, redeem: 100 },
      { name: 'Juan Pérez (Loyalty)',       phone: '8095551002', earn: 200, redeem: 50  },
      { name: 'Laura Rosario (Loyalty)',    phone: '8095551003', earn: 900, redeem: 200 },
      { name: 'Carlos Martínez (Loyalty)',  phone: '8095551004', earn: 150, redeem: 40  },
    ];
    for (const c of demoClients) {
      // Idempotent: check by phone within this business
      const found = await sql(
        `SELECT id::text AS id, supabase_id::text AS supabase_id, loyalty_points FROM clients WHERE business_id='${licoreria.id}' AND phone='${c.phone}' LIMIT 1;`
      );
      let clientSupaId, clientId, currentPts;
      if (found.length) {
        clientId = found[0].id; clientSupaId = found[0].supabase_id;
        currentPts = Number(found[0].loyalty_points || 0);
        log(licoreria.email, `client ${c.name} exists (id=${clientId}, current_pts=${currentPts}) — will append ledger`);
      } else {
        const sid = randomUUID();
        const inserted = await rest('POST', 'clients', {
          supabase_id: sid,
          business_id: licoreria.id,
          name: c.name,
          phone: c.phone,
          loyalty_points: 0,
        });
        const r = Array.isArray(inserted) ? inserted[0] : inserted;
        clientId = r.id; clientSupaId = r.supabase_id || sid; currentPts = 0;
        log(licoreria.email, `client +${c.name} (id=${clientId})`);
      }

      // Check if ledger already seeded for this client+source
      const seeded = await sql(
        `SELECT COUNT(*)::int AS n FROM loyalty_transactions WHERE business_id='${licoreria.id}' AND client_supabase_id='${clientSupaId}' AND notes LIKE '%seed-demos-v2120%';`
      );
      if (seeded[0].n > 0) {
        log(licoreria.email, `  loyalty_transactions already seeded for ${c.name} — skip`);
        continue;
      }

      // Earn row
      const earnBalance = currentPts + c.earn;
      await rest('POST', 'loyalty_transactions', {
        supabase_id: randomUUID(),
        business_id: licoreria.id,
        client_supabase_id: clientSupaId,
        event_type: 'earn',
        points: c.earn,
        balance_after: earnBalance,
        notes: 'Compra demo — seed-demos-v2120',
      });
      // Redeem row
      const redeemBalance = earnBalance - c.redeem;
      await rest('POST', 'loyalty_transactions', {
        supabase_id: randomUUID(),
        business_id: licoreria.id,
        client_supabase_id: clientSupaId,
        event_type: 'redeem',
        points: -c.redeem,
        balance_after: redeemBalance,
        notes: 'Redención demo — seed-demos-v2120',
      });
      // Update client balance
      await rest('PATCH', `clients?id=eq.${clientId}`, { loyalty_points: redeemBalance });
      log(licoreria.email, `  loyalty_transactions +2 (earn ${c.earn} → ${earnBalance}, redeem ${c.redeem} → ${redeemBalance})`);
    }
  }

  // ------------------------------------------------------------------
  // 4) Restaurant: payment_parts on 2-3 existing tickets
  // ------------------------------------------------------------------
  const resto = byEmail['admin@restaurant.demo.terminalxpos.com'];
  if (resto) {
    const tickets = await sql(
      `SELECT id::text AS id, total FROM tickets
         WHERE business_id='${resto.id}'
           AND (payment_parts IS NULL OR payment_parts::text='null')
           AND COALESCE(status,'') NOT IN ('void','cancelled','anulado')
           AND total > 0
         ORDER BY created_at DESC LIMIT 3;`
    );
    if (!tickets.length) log(resto.email, 'No eligible restaurant tickets found to split');
    for (const t of tickets) {
      const total = Number(t.total) || 500;
      const cash = Math.round(total * 0.4 * 100) / 100;
      const card = Math.round((total - cash) * 100) / 100;
      const parts = [
        { method: 'cash', amount: cash },
        { method: 'card', amount: card },
      ];
      await rest('PATCH', `tickets?id=eq.${t.id}`, { payment_parts: parts });
      log(resto.email, `payment_parts set on ticket ${t.id.slice(0, 8)} — ${cash} cash + ${card} card (total ${total})`);
    }
  }

  // ------------------------------------------------------------------
  // 5) Carwash: inventory_oversells row (actual schema uses requested_qty/actual_qty)
  // ------------------------------------------------------------------
  const carwash = byEmail['admin@carwash.demo.terminalxpos.com'];
  if (carwash) {
    const seeded = await sql(
      `SELECT COUNT(*)::int AS n FROM inventory_oversells WHERE business_id='${carwash.id}' AND resolution_notes LIKE '%seed-demos-v2120%';`
    );
    if (seeded[0].n > 0) {
      log(carwash.email, `inventory_oversells already seeded (n=${seeded[0].n}) — skip`);
    } else {
      // Find a ticket_item with SKU in carwash
      const items = await sql(
        `SELECT ti.ticket_supabase_id::text AS ticket_supabase_id,
                ti.inventory_item_supabase_id::text AS item_supabase_id,
                ti.name AS item_name,
                ti.quantity AS qty
           FROM ticket_items ti
           JOIN tickets t ON t.id = ti.ticket_id
          WHERE t.business_id = '${carwash.id}'
            AND ti.inventory_item_supabase_id IS NOT NULL
          ORDER BY t.created_at DESC
          LIMIT 1;`
      );
      const src = items[0];
      const row = {
        supabase_id: randomUUID(),
        business_id: carwash.id,
        ticket_supabase_id: src?.ticket_supabase_id || null,
        item_supabase_id:   src?.item_supabase_id   || null,
        item_name:          src?.item_name || 'Shampoo Premium (demo)',
        requested_qty:      (src?.qty ?? 2),
        actual_qty:         0,
        resolution_notes:   'Demo oversell row — seed-demos-v2120',
      };
      try {
        await rest('POST', 'inventory_oversells', row);
        log(carwash.email, `inventory_oversells +1 (item="${row.item_name}" req=${row.requested_qty} avail=0)`);
      } catch (e) {
        log(carwash.email, `inventory_oversells insert FAILED: ${String(e).slice(0, 250)}`);
      }
    }
  }

  // ------------------------------------------------------------------
  // 6) Per-account verification
  // ------------------------------------------------------------------
  console.log('\n=== VERIFICATION ===');
  for (const b of businesses) {
    const r = await sql(
      `SELECT
         (SELECT COUNT(*)::int FROM activity_log WHERE business_id='${b.id}' AND event_type='ticket_voided' AND metadata->>'source'='seed-demos-v2120') AS void_n,
         (SELECT settings->>'ecf_cert_expiry' FROM businesses WHERE id='${b.id}') AS cert_expiry;`
    );
    log(b.email, `VERIFY void_n=${r[0].void_n} cert_expiry=${String(r[0].cert_expiry || '').slice(0, 10)}`);
  }
  if (licoreria) {
    const r1 = await sql(`SELECT COUNT(*)::int AS n FROM loyalty_transactions WHERE business_id='${licoreria.id}' AND notes LIKE '%seed-demos-v2120%';`);
    const r2 = await sql(`SELECT COUNT(*)::int AS n FROM clients WHERE business_id='${licoreria.id}' AND loyalty_points > 0;`);
    log(licoreria.email, `VERIFY loyalty_transactions(seed)=${r1[0].n} clients_with_points=${r2[0].n}`);
  }
  if (resto) {
    const r = await sql(`SELECT COUNT(*)::int AS n FROM tickets WHERE business_id='${resto.id}' AND payment_parts IS NOT NULL AND payment_parts::text<>'null';`);
    log(resto.email, `VERIFY tickets_with_payment_parts=${r[0].n}`);
  }
  if (carwash) {
    const r = await sql(`SELECT COUNT(*)::int AS n FROM inventory_oversells WHERE business_id='${carwash.id}';`);
    log(carwash.email, `VERIFY inventory_oversells=${r[0].n}`);
  }

  console.log('\n=== SUMMARY ===');
  for (const email of Object.keys(summary)) {
    console.log(`\n${email}:`);
    summary[email].forEach(m => console.log(`  - ${m}`));
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
