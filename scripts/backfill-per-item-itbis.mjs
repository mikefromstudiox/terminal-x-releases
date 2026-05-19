#!/usr/bin/env node
// backfill-per-item-itbis.mjs
//
// 2026-05-19 — One-shot backfill of historical ticket_items where
// `itbis` was computed as `price * 0.18` (the bug) instead of
// `price - price/1.18` (the DR embedded-extraction convention from
// CLAUDE.md hard rule §19).
//
// Why this exists: per-item itbis fix shipped in commit b3b1672 on
// 2026-05-17 19:00, first desktop release v2.17.10. Anything older
// (or anyone running pre-v2.17.10 desktop while logged-in) wrote
// `price * 0.18` to ticket_items.itbis. The schema-suite +
// Mega Smoke `inv.itbis_not_overcounted` scenario surfaced 372
// affected rows across 8 businesses.
//
// What we DO backfill:
//   - All demo businesses (369 rows) — no fiscal impact
//   - Voided test tickets (is_test=true AND status=anulado) on real
//     businesses (2 rows on CAR WASH DJ) — never landed with a customer
//
// What we DO NOT backfill:
//   - Real fiscal sales (NCF assigned, status=cobrado/aprobado/aceptado)
//     on real businesses. These are immutable — the customer received a
//     printed receipt with the old itbis; local + cloud must match what
//     the customer holds. 1 row on Ranoza Liquor Store (NCF
//     B0200000005, $180/$32.40) falls in this bucket.
//
// Mega Smoke scenario is patched in a separate edit to skip pre-2026-05-17
// rows + fiscal-immutable rows, so this 1 historical anomaly will not
// keep waking Mike.
//
// Usage:
//   node scripts/backfill-per-item-itbis.mjs              # dry run
//   node scripts/backfill-per-item-itbis.mjs --apply      # write fix

import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] || true] : [a, true]
}))
const apply = !!argv.apply

async function q(sql) {
  const r = await fetch('https://api.supabase.com/v1/projects/csppjsoirjflumaiipqw/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await r.text()
  try { return JSON.parse(text) } catch { return { error: text } }
}

console.log(`=== backfill-per-item-itbis ===`)
console.log(`mode: ${apply ? 'APPLY (will write)' : 'DRY RUN (no writes)'}\n`)

// 1. Count what's eligible vs preserved.
const breakdown = await q(`
  SELECT
    CASE
      WHEN b.is_demo THEN 'demo'
      WHEN t.is_test = true AND t.status = 'anulado' THEN 'real_voided_test'
      WHEN t.ncf IS NOT NULL AND t.status IN ('cobrado','aprobado','aceptado','en_proceso') THEN 'fiscal_immutable'
      ELSE 'real_other'
    END AS bucket,
    count(*)::int AS rows
  FROM public.ticket_items ti
  JOIN public.businesses b ON b.id = ti.business_id
  JOIN public.tickets t ON t.supabase_id = ti.ticket_supabase_id
  WHERE ti.price > 0 AND ti.itbis > ti.price - ti.price/1.18 + 0.01
  GROUP BY 1 ORDER BY 1
`)
console.log('Eligibility breakdown:')
breakdown.forEach(r => console.log(`  ${r.bucket.padEnd(20)} ${r.rows}`))
console.log()

if (apply) {
  // 2. Apply the backfill. Embedded extraction: itbis = price - price/1.18.
  //    Round to 2dp to match column scale.
  const res = await q(`
    WITH eligible AS (
      SELECT ti.id
      FROM public.ticket_items ti
      JOIN public.businesses b ON b.id = ti.business_id
      JOIN public.tickets t ON t.supabase_id = ti.ticket_supabase_id
      WHERE ti.price > 0
        AND ti.itbis > ti.price - ti.price/1.18 + 0.01
        AND (
          b.is_demo
          OR (t.is_test = true AND t.status = 'anulado')
        )
    )
    UPDATE public.ticket_items ti
    SET itbis = ROUND((price - price/1.18)::numeric, 2),
        updated_at = now()
    FROM eligible e
    WHERE ti.id = e.id
    RETURNING ti.id
  `)
  console.log(`UPDATED: ${Array.isArray(res) ? res.length : '?'} rows`)
  console.log()
}

// 3. Verify post state.
const after = await q(`
  SELECT
    CASE
      WHEN b.is_demo THEN 'demo'
      WHEN t.is_test = true AND t.status = 'anulado' THEN 'real_voided_test'
      WHEN t.ncf IS NOT NULL AND t.status IN ('cobrado','aprobado','aceptado','en_proceso') THEN 'fiscal_immutable'
      ELSE 'real_other'
    END AS bucket,
    count(*)::int AS rows
  FROM public.ticket_items ti
  JOIN public.businesses b ON b.id = ti.business_id
  JOIN public.tickets t ON t.supabase_id = ti.ticket_supabase_id
  WHERE ti.price > 0 AND ti.itbis > ti.price - ti.price/1.18 + 0.01
  GROUP BY 1 ORDER BY 1
`)
console.log('Post-state remaining:')
if (after.length === 0) console.log('  (none — all eligible rows backfilled)')
else after.forEach(r => console.log(`  ${r.bucket.padEnd(20)} ${r.rows}`))
console.log()

// 4. List any remaining real-client rows for visibility.
const remainingReal = await q(`
  SELECT b.name AS biz, t.id::text AS ticket_id, t.ncf, t.status,
         ti.price::text, ti.itbis::text, t.created_at::date::text AS dt
  FROM public.ticket_items ti
  JOIN public.businesses b ON b.id = ti.business_id
  JOIN public.tickets t ON t.supabase_id = ti.ticket_supabase_id
  WHERE b.is_demo = false
    AND ti.price > 0 AND ti.itbis > ti.price - ti.price/1.18 + 0.01
  ORDER BY b.name, t.created_at
`)
if (remainingReal.length > 0) {
  console.log('Real-client rows preserved (fiscal-immutable):')
  remainingReal.forEach(r => console.log(`  ${r.biz} | ${r.dt} | NCF=${r.ncf || '(none)'} | status=${r.status} | price=${r.price} itbis=${r.itbis}`))
}
