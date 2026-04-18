#!/usr/bin/env node
// Dedupe lavadores — fixes the UPPERCASE/original duplicate pairs created by
// the v2.1 sync migration. Rewrites all queue/tickets/commissions refs onto
// the canonical (non-UPPERCASE) supabase_id and soft-deletes the dupe.
//
// Usage:
//   node scripts/dedupe-lavadores.js --dry-run
//   node scripts/dedupe-lavadores.js --apply

const path  = require('path')
const os    = require('os')
const Database = require('better-sqlite3')

const dbPath = process.env.TX_DB || path.join(os.homedir(), 'AppData', 'Roaming', 'terminal-x', 'terminal-x.db')
const apply  = process.argv.includes('--apply')

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

const rows = db.prepare(`SELECT id, nombre, tipo, supabase_id, active
                         FROM empleados
                         WHERE tipo IN ('lavador', 'hybrid')`).all()

// Dupe detection — every ALL-UPPERCASE row is a dupe candidate (created by the
// v2.1 sync migration). For each, find the proper-case canonical by matching
// the dupe's first token against any token (or parenthetical) in the canonical's
// name. Handles: ALEJANDRO LAVADOR → Alejandro Barrie, TIO LAVADOR → Franklin
// Arias (Tio), MIGUEL CUBANO → Miguel Barrie (Cubano).
const stripPunct = s => String(s || '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim()
const tokens = s => stripPunct(s).split(/\s+/).map(t => t.toUpperCase())
const isUpper = r => r.nombre === r.nombre.toUpperCase() && /[A-Z]/.test(r.nombre)

const dupes  = rows.filter(isUpper)
const canons = rows.filter(r => !isUpper(r))

const pairs = []
dupes.forEach(d => {
  const dupeTokens = tokens(d.nombre).filter(t => !['LAVADOR','CUBANO','HYBRID'].includes(t))
  if (!dupeTokens.length) return
  const matches = canons.filter(c => tokens(c.nombre).some(t => dupeTokens.includes(t)))
  if (matches.length === 1) pairs.push({ dupe: d, canon: matches[0] })
  else if (matches.length > 1) console.log(`⚠ ambiguous: ${d.nombre} matches ${matches.length} canonicals — skipping`)
  else console.log(`⚠ no canonical found for ${d.nombre} — skipping`)
})

if (!pairs.length) {
  console.log('No UPPERCASE/canonical dupe pairs found.')
  process.exit(0)
}

console.log(`Found ${pairs.length} dupe pair(s):`)
pairs.forEach(p => console.log(`  KILL "${p.dupe.nombre}" (${p.dupe.supabase_id}) → KEEP "${p.canon.nombre}" (${p.canon.supabase_id})`))

if (!apply) {
  console.log('\n[dry-run] pass --apply to execute.')
  process.exit(0)
}

const tx = db.transaction(() => {
  pairs.forEach(({ dupe, canon }) => {
    db.prepare(`UPDATE queue SET empleado_supabase_id=? WHERE empleado_supabase_id=?`).run(canon.supabase_id, dupe.supabase_id)

    // tickets.washer_empleado_supabase_ids is JSON array — rewrite in JS
    const tickets = db.prepare(`SELECT id, washer_empleado_supabase_ids FROM tickets
                                WHERE washer_empleado_supabase_ids LIKE ?`).all('%' + dupe.supabase_id + '%')
    const upd = db.prepare(`UPDATE tickets SET washer_empleado_supabase_ids=? WHERE id=?`)
    tickets.forEach(t => {
      try {
        const arr = JSON.parse(t.washer_empleado_supabase_ids || '[]')
        const next = arr.map(x => x === dupe.supabase_id ? canon.supabase_id : x)
        upd.run(JSON.stringify(next), t.id)
      } catch {}
    })

    // commissions (if table has empleado_supabase_id col)
    try {
      db.prepare(`UPDATE commissions SET empleado_supabase_id=? WHERE empleado_supabase_id=?`).run(canon.supabase_id, dupe.supabase_id)
    } catch {}

    // soft-delete dupe
    db.prepare(`UPDATE empleados SET active=0, nombre=nombre || ' (DUP)' WHERE id=?`).run(dupe.id)
    console.log(`  ✓ merged ${dupe.nombre} → ${canon.nombre}`)
  })
})

tx()
console.log(`\nApplied. Run a manual sync now to push the rewrites to Supabase.`)
