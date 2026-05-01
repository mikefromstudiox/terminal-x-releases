# audit-flows.mjs — Tier 1 end-to-end data-flow audit

Durable regression guard against the bug class exposed in the 2026-04-30 audit:
silently-dropped columns, missing FK linkage, skipped side-effects.

## What it covers

1. **Schema-payload contract** — for the critical synced tables, INSERT a
   payload with every meaningful field, re-read the row, fail if PostgREST
   silently dropped any column. This is the silent-drop detector.
   - tickets, ticket_items, clients, appointments, sales_deals,
     vehicle_inventory, vehicle_reservations, leads, test_drives, work_orders,
     memberships, restaurant_reservations, kds_events, mesas, inventory_counts,
     credit_payments, anecf_queue, ncf_sequences

2. **Round-trip** — every schema-payload scenario re-reads via `select('*')`
   and diffs.

3. **Side-effect rules** — encoded as scenarios per vertical:
   - carwash + retail: credit ticket → balance ↑, cobrado → inventory ↓,
     partial payment → status stays pendiente.
   - salon: appointment ticket booked → status=completed, membership consume →
     uses_remaining ↓, multi-stylist → empleado_supabase_id on each line.
   - restaurant: fire → kds_events row, cobro → mesa.status=libre.
   - concesionario: deal close → vehicle.status=sold + deal.ticket linked,
     reservation deposit → ticket linked.
   - mecanica: WO complete → ticket created + WO=facturado.
   - cuadre / counts: one row per shift, counted_qty persisted.

4. **Sync integrity** — LWW assertion: stale desktop push must NOT revert a
   newer web counter (Batch 5 fix verifier).

5. **RLS contract** — anon-without-JWT cannot read tenant data; defers full
   sweep to `scripts/rls-policy-audit.mjs`.

## Coverage gaps (FAILS until fixed)

These scenarios are red on purpose right now — the harness's whole point is to
keep them red until each fix ships.

- **Void path** — no server RPC the harness can invoke today.
  Web owns it via `web.js` (Vite-only `@terminal-x/*` aliases — not Node
  importable). Desktop owns it via `electron/database.js`. Migrate void into a
  Postgres RPC (`ticket_void_with_side_effects(p_ticket_supabase_id)`) so any
  client can call it and the harness can verify inventory restore + commission
  reversal + NCF decrement + ANECF enqueue in one shot.
- **Returns / e-CF E33/E34** — same blocker as void.
- **Web-vs-desktop parity** — needs either a CLI shim around
  `electron/database.js` or a server-side mirror of the same orchestration.
  Today these are documented gaps, not tested.
- **LWW** — fails until the timestamp guard ships in sync push.

## How to run

```bash
node scripts/audit-flows.mjs
```

Reads `.env` for `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (and optional
`SUPABASE_ANON_KEY` for the RLS negative scenarios). Exit 0 = pass, 1 = any
failure, 2 = bootstrap crash. Wall-time budget: under 60s.

The harness creates a synthetic `Audit Harness Test ${timestamp}` business at
start and tears it down at end. It refuses to run against the production
business UUIDs (Studio X SRL `1e14fdf4-...`, Ranoza `4f789f41-...`).

## When to run

- **Before every release** — alongside `node scripts/rls-policy-audit.mjs` and
  `node scripts/ranoza-e2e-smoke.mjs`. Three-script gate.
- **In CI on push to `main`** — fail the pipeline on red.
- **After any change to** `packages/data/web.js`, `electron/database.js`,
  `electron/sync.js`, or any Supabase migration that touches a synced table.

## Adding a scenario

1. Pick the right vertical block in `audit-flows.mjs`
   (`runSchemaPayloadScenarios` or `runSideEffectScenarios`).
2. Wrap with `await scenario('label', async () => { ... })`. Throw on fail.
3. Prefer `insertReadDiff(table, payload)` for new schema contracts — you get
   silent-drop detection for free.
4. Always allocate via `track(table, id)` so teardown wipes it.
5. Never reference the production business UUIDs.

## Exit codes

- `0` — all scenarios green.
- `1` — at least one scenario red.
- `2` — bootstrap crash (env missing, network down, schema broken at the
  `businesses` table itself).
