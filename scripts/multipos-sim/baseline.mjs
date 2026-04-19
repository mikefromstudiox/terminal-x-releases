// Scenario 1 — BASELINE
// 2 devices each create 100 tickets ONLINE. Verify no NCF/doc collisions and no oversells.
// TODO: wire up real test assertions once dataLEAKS ships the multi-POS architecture.
//   - expect report.duplicateNCFs.length === 0
//   - expect report.duplicateDocNums.length === 0
//   - expect report.oversells.length === 0
//
// Run:  node scripts/multipos-sim/baseline.mjs

import { MultiPOSSimulation } from './harness.mjs'
import { printViolations } from './report.mjs'

const sim = new MultiPOSSimulation({ devices: 2 })
await sim.start()
try {
  const item = sim.fixtures.items[3] // qty=10 (not last-unit)
  for (let i = 0; i < 100; i++) {
    await Promise.all([
      sim.device(0).createTicket({ items: [{ name: item.sku, price: item.price, qty: 1 }], ncf_type: 'B01' }),
      sim.device(1).createTicket({ items: [{ name: item.sku, price: item.price, qty: 1 }], ncf_type: 'B01' })
    ])
  }
  await sim.syncAll()
  const report = await sim.audit()
  console.log(JSON.stringify(report, null, 2))
  console.log(printViolations(report))
} finally {
  await sim.cleanup()
}
