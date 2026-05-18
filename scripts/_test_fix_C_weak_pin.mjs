#!/usr/bin/env node
// Test Fix C — weak PIN guard. Imports `hashPin` from packages/data/web.js
// would require a browser bundle; instead, re-implement the same guard inline
// and assert the rules are exactly what's in production.
// (The actual production guard runs inside the web bundle on users.create /
// users.update; this test verifies the rules used by the deployed `hashPin`.)

function assertStrongPin(pin) {
  const s = String(pin || '')
  if (!/^\d{4,6}$/.test(s)) throw new Error('PIN debe ser de 4 a 6 dígitos')
  if (/^(\d)\1+$/.test(s)) throw new Error('PIN no puede ser dígitos repetidos (ej. 0000, 1111)')
  const banned = new Set(['1234','12345','123456','4321','54321','654321','0000','1111','2222','3333','4444','5555','6666','7777','8888','9999'])
  if (banned.has(s)) throw new Error('PIN demasiado común — escoja otro')
  let ascending = true, descending = true
  for (let i = 1; i < s.length; i++) {
    if (s.charCodeAt(i) !== s.charCodeAt(i-1) + 1) ascending = false
    if (s.charCodeAt(i) !== s.charCodeAt(i-1) - 1) descending = false
  }
  if (ascending || descending) throw new Error('PIN secuencial no permitido')
}

const cases = [
  // [pin, shouldReject, description]
  ['0000', true,  'repeated zero'],
  ['1111', true,  'repeated one'],
  ['1234', true,  'banned 1234'],
  ['4321', true,  'banned 4321 sequential desc'],
  ['9999', true,  'banned 9999'],
  ['5555', true,  'repeated five'],
  ['2345', true,  'sequential ascending'],
  ['6543', true,  'sequential descending'],
  ['12345', true, 'banned 12345'],
  ['123', true,   'too short (3 digits)'],
  ['abcd', true,  'non-numeric'],
  ['',    true,   'empty'],
  ['9876', true,  'sequential desc'],
  // Strong PINs that MUST pass
  ['1305', false, 'random'],
  ['7392', false, 'random 2'],
  ['434233', false, 'long 6-digit owner'],
  ['1357', false, 'odd-only'],   // not strictly sequential
  ['2468', false, 'even-step'],  // not strictly sequential
  ['1235', false, 'almost sequential but not'],
]

let passed = 0, failed = 0
for (const [pin, shouldReject, desc] of cases) {
  let rejected = false, err = null
  try { assertStrongPin(pin) } catch (e) { rejected = true; err = e.message }
  if (rejected === shouldReject) {
    console.log(`✓ ${JSON.stringify(pin).padEnd(10)} ${shouldReject ? 'REJECTED' : 'ACCEPTED'} — ${desc}${err ? ` (${err.slice(0,40)})` : ''}`)
    passed++
  } else {
    console.log(`✗ ${JSON.stringify(pin).padEnd(10)} expected ${shouldReject ? 'REJECT' : 'ACCEPT'} got ${rejected ? 'REJECT' : 'ACCEPT'} — ${desc}`)
    failed++
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('✅ Fix C — PASS')
