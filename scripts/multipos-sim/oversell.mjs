// Scenario 3 — OVERSELL RACE
// 2 devices simultaneously sell the last unit of an item with qty=1.
// Verify ONE succeeds and the other is logged as a rejected sale (not silent negative stock).
// TODO: implement once block-allocation architecture lands.
//   - pick fixtures.items where qty === 1 (SIM-003 or SIM-007)
//   - Promise.all: device(0).createTicket + device(1).createTicket
//   - expect exactly one success + one "out of stock" error
//   - expect report.oversells.length === 0 (architecture must prevent, not log-after)

import { MultiPOSSimulation } from './harness.mjs'
import { printViolations } from './report.mjs'

const sim = new MultiPOSSimulation({ devices: 2 })
await sim.start()
try {
  // TODO: scenario body
  console.log('oversell.mjs — stubbed. Implement after architecture lands.')
  const report = await sim.audit()
  console.log(printViolations(report))
} finally {
  await sim.cleanup()
}
