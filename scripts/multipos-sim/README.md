# Multi-POS Simulation Harness

Stress test for Terminal X's multi-device concurrency guarantees.

## Safety

Every operation is fenced by `assertSim()` which refuses any business whose name
does not start with `__MULTIPOS_SIM__`. This harness **cannot** touch real client data.

## Setup

Reads `.env` at the Terminal X project root. Requires `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. No new npm deps — uses `better-sqlite3` and
`@supabase/supabase-js` already in `package.json`.

## Quick start

```bash
node scripts/multipos-sim/harness.mjs --smoke
```

Spins up 2 devices, each creates 3 tickets, runs the audit, tears everything down.

## Scenarios

Ready-to-run once the new multi-POS architecture ships:

1. `baseline.mjs` — 2 devices, 100 tickets each, online. Expect zero collisions.
2. `offline.mjs` — 1 device offline for 30 tickets then reconnects. Expect clean reconciliation.
3. `oversell.mjs` — 2 devices race for the last unit. Expect one success + one rejection (not silent negative stock).

## Files

- `harness.mjs` — `MultiPOSSimulation` + `SimulatedDevice` classes. CLI: `--smoke`.
- `fixtures.mjs` — `setUp()` / `tearDown()` for the `__MULTIPOS_SIM__` business.
- `report.mjs` — `auditBusiness()` + `printViolations()` checker.
- `baseline.mjs` / `offline.mjs` / `oversell.mjs` — scenario scripts.

## What the audit catches

- **Duplicate NCFs** — two tickets with the same `(ncf_type, ncf)`.
- **Duplicate doc numbers** — two tickets with the same `doc_number`.
- **Oversells** — inventory below zero, or total units sold > initial stock.

Empty arrays = PASS. Any violation = loud failure with a per-row diff.

## Expected TODAY (pre-fix)

Current architecture allocates NCF sequences and doc numbers from **local SQLite
per-device**. With two devices running in parallel, the harness is expected to
report duplicate NCFs and duplicate doc numbers — that is the bug the new
architecture must fix.
