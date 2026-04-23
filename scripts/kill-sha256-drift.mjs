// Drift eradication — 2026-04-23
// Finds every staff row still on sha256 (or no algo tag with a 64-char hex hash)
// and rehashes to bcrypt('1234') + forces pin_failed_attempts=0, pin_locked_until=null.
// Prints per-business list of affected users so each owner can re-PIN their team.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).filter(l => !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DRY = process.argv.includes('--dry');
const TEMP_PIN = '1234';
const NOW = new Date().toISOString();

const genSalt = () => randomBytes(24).toString('base64url').slice(0, 32);
const hashWith = (pin, salt) => bcrypt.hashSync(String(pin) + salt, 10);

// Pull all staff
const { data: staff, error } = await sb.from('staff')
  .select('id, business_id, username, name, role, pin_hash, pin_hash_algo, pin_salt, active');
if (error) { console.error(error); process.exit(1); }

// Classify
const toMigrate = [];
for (const s of staff) {
  if (!s.pin_hash) continue;
  const h = String(s.pin_hash);
  const isBcrypt = h.startsWith('$2') && h.length === 60;
  const isSha256 = /^[0-9a-f]{64}$/.test(h);
  const algo = s.pin_hash_algo || (isBcrypt ? 'bcrypt' : isSha256 ? 'sha256' : null);
  // Target: any row NOT already clean bcrypt
  if (algo !== 'bcrypt' || !isBcrypt) toMigrate.push({ ...s, _detectedAlgo: algo, _isBcrypt: isBcrypt });
}

// Business names
const bizIds = [...new Set(toMigrate.map(r => r.business_id))];
const { data: biz } = await sb.from('businesses').select('id, name').in('id', bizIds);
const bizName = Object.fromEntries((biz || []).map(b => [b.id, b.name]));

console.log(`\nTotal staff: ${staff.length}`);
console.log(`Already bcrypt (skip): ${staff.length - toMigrate.length}`);
console.log(`To migrate → bcrypt('${TEMP_PIN}'): ${toMigrate.length}\n`);

if (!toMigrate.length) { console.log('Nothing to do. Drift already dead.'); process.exit(0); }

// Group by business for display
const byBiz = {};
for (const r of toMigrate) {
  byBiz[r.business_id] = byBiz[r.business_id] || [];
  byBiz[r.business_id].push(r);
}

console.log('=== Users who will be reset to PIN 1234 (tell them to change in-app after login) ===');
for (const [bid, list] of Object.entries(byBiz)) {
  console.log(`\n  Business: ${bizName[bid] || '(?)'} (${bid.slice(0, 8)})`);
  for (const r of list) {
    console.log(`    - ${r.username?.padEnd(20) || '(no username)'}  role=${r.role}  name="${r.name}"  algo=${r._detectedAlgo}`);
  }
}

if (DRY) { console.log('\n[DRY RUN — nothing updated]'); process.exit(0); }

console.log('\n=== Applying updates ===');
let ok = 0, fail = 0;
for (const r of toMigrate) {
  const salt = genSalt();
  const pin_hash = hashWith(TEMP_PIN, salt);
  const { error: upErr } = await sb.from('staff').update({
    pin_hash,
    pin_hash_algo: 'bcrypt',
    pin_salt: salt,
    pin_failed_attempts: 0,
    pin_locked_until: null,
    updated_at: NOW,
  }).eq('id', r.id);
  if (upErr) { console.error(`  FAIL ${r.username}:`, upErr.message); fail++; }
  else { console.log(`  OK   ${r.username?.padEnd(20)} @ ${bizName[r.business_id]?.slice(0, 30)}`); ok++; }
}

console.log(`\n${ok} updated, ${fail} failed.`);

// Verify: count remaining non-bcrypt rows
const { data: after } = await sb.from('staff').select('pin_hash, pin_hash_algo');
const stillDirty = (after || []).filter(s => {
  if (!s.pin_hash) return false;
  const isBcrypt = String(s.pin_hash).startsWith('$2') && s.pin_hash.length === 60;
  return !isBcrypt || s.pin_hash_algo !== 'bcrypt';
}).length;
console.log(`\nRemaining non-bcrypt rows in staff: ${stillDirty}`);
console.log(stillDirty === 0 ? '✅ DRIFT DEAD.' : '⚠️  Some rows still non-bcrypt.');
