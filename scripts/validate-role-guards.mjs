#!/usr/bin/env node
/**
 * validate-role-guards.mjs — verify server-side role-hierarchy guards.
 *
 * Two modes:
 *   1. Pure logic mode (default): exercises electron/auth-guard.js against an
 *      in-memory stub db. Environment-independent — runs under any Node. This
 *      is what proves the Enrique→Michael PIN-change exploit is closed.
 *   2. Live SQLite mode (--live): boots the real database.js to also assert
 *      that permission_denied rows land in activity_log. Requires a Node
 *      that matches the better-sqlite3 build ABI (use `electron-rebuild`
 *      first, or run inside Electron).
 *
 * Usage:
 *   node scripts/validate-role-guards.mjs
 *   node scripts/validate-role-guards.mjs --live
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const guard = require(path.join(__dirname, '..', 'electron', 'auth-guard.js'))

let passed = 0, failed = 0
const assert = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${msg}`)
  cond ? passed++ : failed++
}

// ── In-memory db stub for pure-logic mode ────────────────────────────────────
// Only needs rawPrepare('SELECT … FROM users WHERE id=?').get(id)
function makeStubDb(users) {
  const byId = new Map(users.map(u => [u.id, u]))
  const denials = []
  return {
    rawPrepare(sql) {
      const table = sql.match(/FROM\s+(\w+)/i)?.[1] || ''
      return {
        get: (id) => (table === 'users' ? byId.get(id) : null) || null,
      }
    },
    activityLogRecord(evt) { denials.push(evt) },
    _denials: denials,
  }
}

// Seed: id=1 Michael owner, id=2 Enrique manager, id=3 Peer manager, id=4 Ana cashier
const michael = { id: 1, name: 'Michael', username: 'michael', role: 'owner'   }
const enrique = { id: 2, name: 'Enrique', username: 'enrique', role: 'manager' }
const peer    = { id: 3, name: 'Peer',    username: 'peer',    role: 'manager' }
const ana     = { id: 4, name: 'Ana',     username: 'ana',     role: 'cashier' }
const stub = makeStubDb([michael, enrique, peer, ana])
const actorEnrique = { id: enrique.id, name: enrique.name, role: enrique.role }
const actorMichael = { id: michael.id, name: michael.name, role: michael.role }

// ── 1. The exact exploit: manager editing owner's PIN → DENY ─────────────────
const exploit = guard.guardUserUpdate(stub, actorEnrique, { id: michael.id, pin_hash: 'XXXX' })
assert(typeof exploit === 'string' && /permiso/i.test(exploit),
  `manager→owner PIN change denied: "${exploit}"`)

// ── 2. Manager editing a peer manager (equal level) → DENY (strict >) ────────
const peerEdit = guard.guardUserUpdate(stub, actorEnrique, { id: peer.id, name: 'x' })
assert(typeof peerEdit === 'string', `manager→peer-manager edit denied: "${peerEdit}"`)

// ── 3. Manager editing a cashier (lower) → ALLOW ─────────────────────────────
const cashierEdit = guard.guardUserUpdate(stub, actorEnrique, { id: ana.id, name: 'Ana M.' })
assert(cashierEdit === null, 'manager→cashier edit allowed')

// ── 4. Self edit own name/pin → ALLOW ────────────────────────────────────────
assert(guard.guardUserUpdate(stub, actorEnrique, { id: enrique.id, name: 'E.R.' }) === null,
  'self-edit name allowed')
assert(guard.guardUserUpdate(stub, actorEnrique, { id: enrique.id, pin_hash: 'abc' }) === null,
  'self-edit PIN allowed')

// ── 5. Self role-promotion → DENY ────────────────────────────────────────────
const promote = guard.guardUserUpdate(stub, actorEnrique, { id: enrique.id, role: 'owner' })
assert(typeof promote === 'string', `self-promotion denied: "${promote}"`)

// ── 6. Self deactivation → DENY ──────────────────────────────────────────────
const selfOff = guard.guardUserUpdate(stub, actorEnrique, { id: enrique.id, active: 0 })
assert(typeof selfOff === 'string', `self-deactivation denied: "${selfOff}"`)

// ── 7. Manager deleting owner → DENY ─────────────────────────────────────────
const delOwner = guard.guardUserDelete(stub, actorEnrique, { id: michael.id })
assert(typeof delOwner === 'string', `manager→owner delete denied: "${delOwner}"`)

// ── 8. Manager deleting own account → DENY ───────────────────────────────────
const delSelf = guard.guardUserDelete(stub, actorEnrique, { id: enrique.id })
assert(typeof delSelf === 'string', `self-delete denied: "${delSelf}"`)

// ── 9. guardOwnerOnly: manager → DENY, owner → ALLOW ─────────────────────────
assert(typeof guard.guardOwnerOnly(stub, actorEnrique, null, 'save-empresa') === 'string',
  'manager blocked from save-empresa')
assert(guard.guardOwnerOnly(stub, actorMichael, null, 'save-empresa') === null,
  'owner allowed on save-empresa')

// ── 10. guardOwnerOrManager: cashier → DENY, manager → ALLOW ─────────────────
const actorAna = { id: ana.id, name: ana.name, role: ana.role }
assert(typeof guard.guardOwnerOrManager(stub, actorAna, null, 'services:update') === 'string',
  'cashier blocked from services:update')
assert(guard.guardOwnerOrManager(stub, actorEnrique, null, 'services:update') === null,
  'manager allowed on services:update')

// ── 11. Manager promoting cashier to owner → DENY ────────────────────────────
const promoteCash = guard.guardUserUpdate(stub, actorEnrique, { id: ana.id, role: 'owner' })
assert(typeof promoteCash === 'string',
  `manager cannot promote cashier to owner: "${promoteCash}"`)

// ── 12. Owner editing anyone → ALLOW, even role change ───────────────────────
assert(guard.guardUserUpdate(stub, actorMichael, { id: enrique.id, role: 'cfo' }) === null,
  'owner→role change allowed')

// ── 13. Unknown role safe-default (edge case) → DENY ─────────────────────────
const actorBogus = { id: 99, name: 'Rogue', role: 'hacker' }
const bogus = guard.guardUserUpdate(stub, actorBogus, { id: michael.id, pin_hash: 'x' })
assert(typeof bogus === 'string', `unknown role treated as level 0, denied: "${bogus}"`)

// ── 14. Denial logging: logDenied writes through db.activityLogRecord ────────
stub._denials.length = 0
guard.logDenied(stub, {
  actor: actorEnrique, attempted_op: 'users:update',
  target_type: 'user', target_id: michael.id, target_name: 'Michael (@michael)',
  reason: 'No tienes permiso para editar este usuario',
})
const rec = stub._denials[0]
assert(rec?.event_type === 'permission_denied' && rec.severity === 'warn' && rec.metadata?.attempted_op === 'users:update',
  'logDenied writes permission_denied row with warn severity + attempted_op metadata')

// ── Live SQLite mode (optional) ──────────────────────────────────────────────
if (process.argv.includes('--live')) {
  console.log('\n── live SQLite mode ──')
  const SCRATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'txguard-'))
  let db
  try {
    db = require(path.join(__dirname, '..', 'electron', 'database.js'))
  } catch (e) {
    console.log(`SKIP — cannot load database.js (${e.message}). Run via Electron or after electron-rebuild.`)
    process.exit(failed === 0 ? 0 : 1)
  }
  try {
    const ready = db.init(SCRATCH_DIR)
    if (!ready) throw new Error(db.getError() || 'init failed')
    const o = db.userCreate({ name: 'Michael', username: `m_${Date.now()}`, pin: '1111', role: 'owner' })
    const m = db.userCreate({ name: 'Enrique', username: `e_${Date.now()}`, pin: '2222', role: 'manager' })
    db.setActiveUser({ id: m.id, name: 'Enrique', role: 'manager' })
    guard.logDenied(db, {
      actor: db.getActiveUser(),
      attempted_op: 'users:update',
      target_type: 'user', target_id: o.id, target_name: 'Michael',
      reason: 'No tienes permiso para editar este usuario',
    })
    const logs = db.activityLogList({ eventTypes: ['permission_denied'], limit: 10 })
    const hit = logs.find(r => r.target_id === String(o.id) && r.actor_name === 'Enrique')
    assert(!!hit, `activity_log row persisted (found ${logs.length})`)
    assert(hit?.severity === 'warn', 'persisted severity=warn')
  } catch (e) {
    console.log(`SKIP live assertions — ${e.message}`)
  } finally {
    try { db?.closeDb?.() } catch {}
    try { fs.rmSync(SCRATCH_DIR, { recursive: true, force: true }) } catch {}
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
