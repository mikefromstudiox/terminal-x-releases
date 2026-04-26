// FIX-HIGH-8 verification — exercises packages/services/activity-log-queue.js
// in a fake-IDB environment. Confirms:
//   1) failing writer → row enqueued
//   2) drain with healthy writer → row sent + queue empties
//   3) 5 consecutive failures → row marked dead + activity_log_dropped emitted
//
// Run: node scripts/verify-activity-fallback.mjs

import 'fake-indexeddb/auto'
import { enqueueActivity, drainActivity, getPendingCount, registerWriter } from '../packages/services/activity-log-queue.js'

const log = (...a) => console.log('[verify]', ...a)
let calls = []
function makeWriter({ failTimes = 0 } = {}) {
  let n = 0
  return async (payload) => {
    calls.push(payload)
    if (n < failTimes) { n++; throw new Error('simulated network down') }
  }
}

async function step1_enqueueOnFailure() {
  log('STEP 1 — enqueue on failure')
  calls = []
  const writer = makeWriter({ failTimes: 999 })
  registerWriter(writer)
  await enqueueActivity({ event_type: 'manager_override_failed', severity: 'warn', reason: 'test-1' })
  const n = await getPendingCount()
  if (n !== 1) throw new Error(`expected 1 pending, got ${n}`)
  log('  ✓ 1 row queued')
}

async function step2_drainOnRecovery() {
  log('STEP 2 — drain when writer recovers')
  calls = []
  const writer = makeWriter({ failTimes: 0 })
  registerWriter(writer)
  // Force next_attempt_at to past so drain is eligible
  const { openDB } = await import('idb')
  const db = await openDB('terminalx-activity-fallback', 1)
  const all = await db.getAll('pending')
  for (const r of all) { r.next_attempt_at = Date.now() - 1000; await db.put('pending', r) }
  const r = await drainActivity({ supabaseInsertFn: writer })
  log('  drain result', r)
  if (r.drained < 1) throw new Error('expected at least 1 drained')
  log('  ✓ drained on recovery')
}

async function step3_deadAfter5() {
  log('STEP 3 — row goes dead after 5 retries')
  // Fresh enqueue
  await enqueueActivity({ event_type: 'manager_override_failed', severity: 'warn', reason: 'test-3' })
  const writer = makeWriter({ failTimes: 999 })
  registerWriter(writer)
  const { openDB } = await import('idb')
  const db = await openDB('terminalx-activity-fallback', 1)
  for (let i = 0; i < 5; i++) {
    // Force eligible
    const all = await db.getAll('pending')
    for (const r of all) {
      if (r.status === 'pending') { r.next_attempt_at = Date.now() - 1000; await db.put('pending', r) }
    }
    const r = await drainActivity({ supabaseInsertFn: writer })
    log(`  attempt ${i + 1} →`, r)
  }
  const all = await db.getAll('pending')
  const dead = all.filter(r => r.status === 'dead')
  if (dead.length < 1) throw new Error(`expected ≥1 dead row, got ${dead.length}`)
  log(`  ✓ ${dead.length} row(s) marked dead`)
  // Check activity_log_dropped emitted
  const droppedCalls = calls.filter(c => c.event_type === 'activity_log_dropped')
  // (writer keeps failing so the dropped-marker write is attempted but throws — that's expected)
  log('  attempted activity_log_dropped writes:', droppedCalls.length)
  if (droppedCalls.length < 1) throw new Error('expected at least 1 activity_log_dropped attempt')
  log('  ✓ activity_log_dropped emitted via canonical writer')
}

;(async () => {
  try {
    await step1_enqueueOnFailure()
    await step2_drainOnRecovery()
    await step3_deadAfter5()
    log('\nALL 3 STEPS PASSED')
    process.exit(0)
  } catch (e) {
    console.error('FAIL:', e)
    process.exit(1)
  }
})()
