// Scenario 2 — OFFLINE RECONCILIATION
// Device 0 goes offline, creates 30 tickets, reconnects, syncs.
// Verify sync reconciles without duplicate NCFs / doc numbers.
// TODO: implement once the multi-POS architecture lands.
//   - device(0).setNetwork(false)
//   - loop: create 30 tickets (should succeed locally even offline)
//   - device(0).setNetwork(true)
//   - sim.syncAll()
//   - assert no collisions against device(1)'s online tickets

import { MultiPOSSimulation } from './harness.mjs'
import { printViolations } from './report.mjs'

const sim = new MultiPOSSimulation({ devices: 2 })
await sim.start()
try {
  // TODO: scenario body
  console.log('offline.mjs — stubbed. Implement after architecture lands.')
  const report = await sim.audit()
  console.log(printViolations(report))
} finally {
  await sim.cleanup()
}
