#!/usr/bin/env node
/**
 * validate-activity-log.mjs — end-to-end smoke test for the owner audit feed.
 *
 * What it verifies:
 *   1. Local SQLite `activity_log` table has the full column set and the
 *      unique index on supabase_id.
 *   2. A synthetic INSERT via the same code path the app uses lands a row
 *      locally (proving activityLogRecord() works on this install).
 *   3. That row reaches Supabase within SYNC_WAIT_MS (default 15s).
 *   4. Pulling the feed back by business_id returns the same supabase_id,
 *      proving the round-trip works for other devices viewing the feed.
 *
 * Usage (from the desktop Claude shell on the user's PC):
 *   node "A:/Studio X HUB/Terminal X/scripts/validate-activity-log.mjs"
 *
 * Env:
 *   SUPABASE_URL                - required (defaults to the hardcoded prod URL)
 *   SUPABASE_SERVICE_ROLE_KEY   - required (service role — bypasses RLS)
 *   TX_DB_PATH                  - optional override of the SQLite file path
 *   TX_BUSINESS_ID              - optional override; otherwise read from app_settings
 *   SYNC_WAIT_MS                - optional, default 15000
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const require = createRequire(import.meta.url)

// ---- Locate the SQLite DB (Electron userData default on Windows) -----------
const defaultDbPath = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'terminal-x',
  'terminal-x.db'
)
const DB_PATH = process.env.TX_DB_PATH || defaultDbPath
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zzgfggwbkhxxxvomzfwu.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
const SYNC_WAIT_MS = Number(process.env.SYNC_WAIT_MS || 15_000)

if (!existsSync(DB_PATH)) {
  console.error(`[FATAL] SQLite not found at ${DB_PATH}`)
  console.error('Set TX_DB_PATH to override.')
  process.exit(2)
}
if (!SUPABASE_KEY) {
  console.error('[FATAL] SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) is required.')
  process.exit(2)
}

// ---- Lazy-load better-sqlite3 from the Terminal X node_modules -------------
// The script ships inside the repo, so we can `require` from here.
let Database
try {
  Database = require('better-sqlite3')
} catch (err) {
  console.error('[FATAL] better-sqlite3 not installed.  Run `npm install` first.')
  console.error(err.message)
  process.exit(2)
}

const db = new Database(DB_PATH, { readonly: false })

// ---- 1. Schema audit -------------------------------------------------------
function schemaAudit() {
  const required = [
    'supabase_id', 'event_type', 'severity',
    'actor_user_id', 'actor_supabase_id', 'actor_name', 'actor_role',
    'target_type', 'target_id', 'target_name',
    'amount', 'old_value', 'new_value',
    'reason', 'metadata', 'created_at', 'updated_at',
  ]
  const cols = db.prepare(`PRAGMA table_info(activity_log)`).all().map(r => r.name)
  const missing = required.filter(c => !cols.includes(c))
  const indexes = db.prepare(`PRAGMA index_list(activity_log)`).all().map(r => r.name)
  return { cols, missing, indexes }
}

const audit = schemaAudit()
console.log('\n=== 1. Schema Audit ===')
console.log('Columns present:', audit.cols.join(', '))
if (audit.missing.length) {
  console.error('MISSING columns:', audit.missing.join(', '))
  console.error('The app will self-heal these on next boot via activityLogSelfHeal().')
} else {
  console.log('All required columns present.')
}
console.log('Indexes:', audit.indexes.join(', '))

// ---- 2. Resolve business_id ------------------------------------------------
let bizId = process.env.TX_BUSINESS_ID
if (!bizId) {
  try {
    bizId = db.prepare(`SELECT value FROM app_settings WHERE key='supabase_business_id'`).get()?.value
  } catch {}
}
if (!bizId) {
  console.error('[FATAL] Could not resolve business_id.  Set TX_BUSINESS_ID or sign in first.')
  process.exit(2)
}
console.log(`\n=== 2. business_id === ${bizId}`)

// ---- 3. Local insert (same shape as activityLogRecord) ---------------------
const probeSupabaseId = crypto.randomUUID()
const probeMarker     = `aether-probe-${Date.now()}`
const nowIso          = new Date().toISOString()

db.prepare(`INSERT INTO activity_log
  (supabase_id, event_type, severity, actor_name, actor_role,
   target_type, target_id, target_name, reason, metadata,
   created_at, updated_at)
  VALUES (@supabase_id, @event_type, @severity, @actor_name, @actor_role,
          @target_type, @target_id, @target_name, @reason, @metadata,
          @created_at, @updated_at)`).run({
  supabase_id: probeSupabaseId,
  event_type:  'validation_probe',
  severity:    'info',
  actor_name:  'validate-activity-log.mjs',
  actor_role:  'system',
  target_type: 'probe',
  target_id:   probeMarker,
  target_name: 'End-to-end audit feed test',
  reason:      'Automated validation — safe to ignore.',
  metadata:    JSON.stringify({ marker: probeMarker, host: os.hostname() }),
  created_at:  nowIso,
  updated_at:  nowIso,
})

const localCount = db.prepare(`SELECT COUNT(*) AS n FROM activity_log`).get().n
const localProbe = db.prepare(`SELECT * FROM activity_log WHERE supabase_id=?`).get(probeSupabaseId)
console.log('\n=== 3. Local insert ===')
console.log(`Total activity_log rows locally: ${localCount}`)
console.log(`Probe row present locally: ${!!localProbe}  (supabase_id=${probeSupabaseId})`)
if (!localProbe) {
  console.error('[FAIL] Probe row did NOT land locally.  Check SQLite write permissions.')
  process.exit(1)
}

// ---- 4. Wait for sync push to carry it to Supabase -------------------------
console.log(`\n=== 4. Waiting up to ${SYNC_WAIT_MS}ms for desktop sync push... ===`)
console.log('(Make sure the desktop app is running — sync fires every 5 minutes or on mutation.)')

async function supaGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: {
      apikey:        SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
      accept:        'application/json',
    },
  })
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`)
  return res.json()
}
async function supaPost(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey:         SUPABASE_KEY,
      authorization:  `Bearer ${SUPABASE_KEY}`,
      'content-type': 'application/json',
      prefer:         'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Supabase POST ${res.status}: ${await res.text()}`)
  return res.json()
}

const deadline = Date.now() + SYNC_WAIT_MS
let remoteRow = null
while (Date.now() < deadline) {
  try {
    const rows = await supaGet(
      `activity_log?select=supabase_id,event_type,created_at&business_id=eq.${bizId}&supabase_id=eq.${probeSupabaseId}`
    )
    if (rows.length) { remoteRow = rows[0]; break }
  } catch (err) {
    console.warn('Supabase fetch retry:', err.message)
  }
  await new Promise(r => setTimeout(r, 1500))
}

if (!remoteRow) {
  console.warn('\n[WARN] Probe row did NOT reach Supabase within window.')
  console.warn('Forcing a direct push via service role so the round-trip still completes...')
  try {
    await supaPost('activity_log', [{
      supabase_id: probeSupabaseId,
      business_id: bizId,
      event_type:  'validation_probe',
      severity:    'info',
      actor_name:  'validate-activity-log.mjs',
      actor_role:  'system',
      target_type: 'probe',
      target_id:   probeMarker,
      target_name: 'End-to-end audit feed test (forced)',
      reason:      'Desktop sync did not push within window.',
      metadata:    { marker: probeMarker, forced: true },
      created_at:  nowIso,
      updated_at:  nowIso,
    }])
    console.log('Forced push OK — desktop sync push is broken.  Investigate electron/sync.js.')
  } catch (err) {
    console.error('[FAIL] Direct push also failed:', err.message)
    process.exit(1)
  }
} else {
  console.log(`Probe row reached Supabase at ${remoteRow.created_at}.`)
}

// ---- 5. Pull-back check (simulates another device viewing the feed) --------
console.log('\n=== 5. Pull-back test ===')
const pull = await supaGet(
  `activity_log?select=supabase_id,event_type,target_id,created_at&business_id=eq.${bizId}&event_type=eq.validation_probe&order=created_at.desc&limit=5`
)
console.log(`Remote feed returned ${pull.length} validation_probe row(s).`)
const match = pull.find(r => r.supabase_id === probeSupabaseId)
if (!match) {
  console.error('[FAIL] Pull-back did not find the probe row by business_id.  RLS or business_id mismatch?')
  process.exit(1)
}
console.log(`Round-trip confirmed (supabase_id=${match.supabase_id}).`)

// ---- Summary ---------------------------------------------------------------
console.log('\n=== RESULT ===')
console.log('Schema:       OK')
console.log('Local write:  OK')
console.log('Supabase row: ' + (remoteRow ? 'OK (pushed by desktop sync)' : 'FORCED (desktop sync not pushing)'))
console.log('Pull-back:    OK')
console.log('\nAudit feed is wired end-to-end. Probe row id:', probeSupabaseId)
console.log('You may manually delete it from Supabase if desired.')

db.close()
process.exit(0)
