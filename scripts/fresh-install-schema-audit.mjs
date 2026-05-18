#!/usr/bin/env node
// scripts/fresh-install-schema-audit.mjs
//
// LAYER 7 — Fresh-install schema-parity audit.
//
// Built 2026-05-18 after Ranoza's first paying desktop install surfaced
// THREE distinct schema-drift bugs in one onboarding session:
//   - empleados missing updated_at (1,081 errors before fix)
//   - notas_credito missing original_ticket_supabase_id
//   - inventory_items missing updated_at + 20 other columns
//
// Root cause: tables CREATE'd in electron/database.js AFTER the migrations
// array (lines 310-2057) miss every ALTER TABLE migration in the array.
// Existing installs got the columns from prior version schemas; clean
// installs miss them. 350 stress scenarios didn't catch this — they all
// run against an already-installed desktop.
//
// This harness parses db/schema.sql + electron/database.js STATICALLY to
// model what columns each table would have on a fresh install, then
// compares against:
//   1. PULL_TABLES descriptors in electron/sync.js (cols[] + fkCols)
//   2. Supabase information_schema (for cloud-vs-local drift)
//
// Exits non-zero on any "no such column" risk. Wire into the release gate.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const env = fs.existsSync(path.join(ROOT, '.env'))
  ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').reduce((a, l) => {
      const m = l.match(/^([A-Z_]+)\s*=\s*(.*)$/)
      if (m) a[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
      return a
    }, {})
  : {}

const SUPABASE_PROJECT = 'csppjsoirjflumaiipqw'

// ─── Static schema model ────────────────────────────────────────────────────
//
// Each table maps to { columns: Set<string>, notNull: Set<string> }
//
// We start from db/schema.sql (the bedrock CREATE TABLEs) and then apply the
// migrations array from electron/database.js in order, simulating what a
// fresh install would actually end up with.

function buildVirginSchemaModel() {
  const model = new Map()  // tableName → { columns: Set, notNull: Set }

  const upsertTable = (name) => {
    if (!model.has(name)) model.set(name, { columns: new Set(), notNull: new Set() })
    return model.get(name)
  }

  // Parse a CREATE TABLE statement and add to model.
  // Handles: column TYPE [NOT NULL] [DEFAULT ...]
  function applyCreateTable(sql) {
    const m = sql.match(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)\s*\(([\s\S]+)\)/i)
    if (!m) return
    const tableName = m[1]
    const body = m[2]
    const t = upsertTable(tableName)
    // Split on commas at depth 0 (so REFERENCES tbl(col) doesn't break us)
    const parts = []
    let depth = 0, buf = ''
    for (const ch of body) {
      if (ch === '(') depth++
      else if (ch === ')') depth--
      if (ch === ',' && depth === 0) { parts.push(buf); buf = '' }
      else buf += ch
    }
    if (buf.trim()) parts.push(buf)
    for (const part of parts) {
      const trim = part.trim()
      // Skip constraint-only lines (PRIMARY KEY (...), FOREIGN KEY (...), UNIQUE (...), CHECK (...))
      if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(trim)) continue
      // Extract column name (first word)
      const colMatch = trim.match(/^(\w+)\b/)
      if (!colMatch) continue
      const colName = colMatch[1]
      t.columns.add(colName)
      if (/\bNOT\s+NULL\b/i.test(trim)) t.notNull.add(colName)
    }
  }

  function applyAlterAddColumn(sql) {
    const m = sql.match(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)([\s\S]*)/i)
    if (!m) return
    const tableName = m[1]
    const colName = m[2]
    const rest = m[3] || ''
    if (!model.has(tableName)) return  // table doesn't exist on fresh install — silent skip (matches production behaviour)
    const t = model.get(tableName)
    t.columns.add(colName)
    if (/\bNOT\s+NULL\b/i.test(rest)) t.notNull.add(colName)
  }

  function applyDropTable(sql) {
    const m = sql.match(/DROP\s+TABLE(?:\s+IF\s+EXISTS)?\s+(\w+)/i)
    if (!m) return
    model.delete(m[1])
  }

  function applyRenameTable(sql) {
    const m = sql.match(/ALTER\s+TABLE\s+(\w+)\s+RENAME\s+TO\s+(\w+)/i)
    if (!m) return
    if (model.has(m[1])) {
      model.set(m[2], model.get(m[1]))
      model.delete(m[1])
    }
  }

  function applySql(sql) {
    const trimmed = sql.trim()
    if (/^CREATE\s+TABLE/i.test(trimmed)) applyCreateTable(trimmed)
    else if (/^ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN/i.test(trimmed)) applyAlterAddColumn(trimmed)
    else if (/^ALTER\s+TABLE\s+\w+\s+RENAME/i.test(trimmed)) applyRenameTable(trimmed)
    else if (/^DROP\s+TABLE/i.test(trimmed)) applyDropTable(trimmed)
  }

  // Step 1: db/schema.sql — parse all CREATE TABLE
  const schemaSql = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8')
  // Split by semicolons at statement level (rough but works for schema.sql)
  const statements = schemaSql.split(/;\s*\n/).filter(s => s.trim())
  for (const s of statements) applySql(s)

  // Step 2: electron/database.js — migrations array (these run BEFORE late CREATE TABLEs)
  const dbJs = fs.readFileSync(path.join(ROOT, 'electron/database.js'), 'utf8')
  const migStart = dbJs.indexOf('const migrations = [')
  if (migStart >= 0) {
    let depth = 0, end = -1
    for (let i = migStart + 'const migrations = '.length; i < dbJs.length; i++) {
      const ch = dbJs[i]
      if (ch === '[') depth++
      else if (ch === ']') { depth--; if (depth === 0) { end = i; break } }
    }
    let migBlock = ''
    if (end >= 0) {
      migBlock = dbJs.slice(migStart, end + 1)
      // Extract each SQL string (single/double/backtick quoted)
      const re = /(?:'([^']*(?:\\.[^']*)*)'|"([^"]*(?:\\.[^"]*)*)"|`([^`]*(?:\\.[^`]*)*)`)/g
      let m
      while ((m = re.exec(migBlock))) {
        const s = m[1] ?? m[2] ?? m[3]
        if (!s || !/^\s*(ALTER|CREATE|UPDATE|INSERT|DROP)\s/i.test(s)) continue
        applySql(s)
      }
    }

    // Step 3: late CREATE TABLEs + post-CREATE migration arrays AFTER the migrations array.
    const postMig = dbJs.slice(end + 1)
    // CREATE TABLE blocks inside db.exec(`...`)
    const ctRe = /db\.exec\s*\(\s*`([^`]+)`\s*\)/g
    let cm
    while ((cm = ctRe.exec(postMig))) {
      applySql(cm[1])
    }
    // ALTER TABLE / etc. inside db.exec('...') or db.exec("...")
    const ctRe2 = /db\.exec\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    let cm2
    while ((cm2 = ctRe2.exec(postMig))) {
      applySql(cm2[1])
    }
    // Post-CREATE arrays (e.g. _empleadosPostCreate, _inventoryItemsPostCreate)
    const arrRe = /const\s+_\w+PostCreate\s*=\s*\[([\s\S]*?)\]/g
    let am
    while ((am = arrRe.exec(postMig))) {
      const body = am[1]
      const strs = [...body.matchAll(/"([^"]+)"/g)].map(x => x[1])
      for (const s of strs) applySql(s)
    }
    // Standalone try { db.exec(`ALTER TABLE ...`) } patterns — used for
    // template-string ALTERs that aren't in the migrations array (e.g. the
    // accounting_* loop at line 2477 that adds accounting_client_supabase_id
    // to every accounting table dynamically via template literal).
    const tryRe = /try\s*\{\s*db\.exec\s*\(\s*`([^`]+)`\s*\)\s*\}\s*catch/g
    let tm
    while ((tm = tryRe.exec(postMig))) {
      applySql(tm[1])
    }
    // Same with single/double quotes
    const tryRe2 = /try\s*\{\s*db\.exec\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\}\s*catch/g
    let tm3
    while ((tm3 = tryRe2.exec(postMig))) {
      applySql(tm3[1])
    }
    // Template-literal ALTER TABLE inside for-loops, e.g. the accounting loop.
    // Pattern: for (...) { try { db.exec(`ALTER TABLE ${t} ADD COLUMN ...`) }
    // We resolve `${t}` against any const x = [...] array immediately above.
    const loopRe = /for\s*\(\s*const\s+(\w+)\s+of\s+(\w+)\s*\)\s*\{[\s\S]*?try\s*\{\s*db\.exec\s*\(\s*`([^`]+)`\s*\)\s*\}/g
    let lm
    while ((lm = loopRe.exec(postMig))) {
      const loopVar = lm[1]
      const listName = lm[2]
      const tmpl = lm[3]
      // Find the list definition
      const listRe = new RegExp(`const\\s+${listName}\\s*=\\s*\\[([^\\]]+)\\]`)
      const listMatch = postMig.match(listRe)
      if (!listMatch) continue
      const items = [...listMatch[1].matchAll(/'([^']+)'/g)].map(x => x[1])
      for (const it of items) {
        const sql = tmpl.replace(new RegExp('\\$\\{' + loopVar + '\\}', 'g'), it)
        applySql(sql)
      }
    }

    // Step 4: v2.17.12 architectural fix — re-run the migrations array AFTER all
    // CREATE TABLEs are processed. Mirrors the runtime second-pass we added in
    // electron/database.js around line 3977. Without this the audit reports
    // false positives for every column that's added via ALTER TABLE for a
    // late-CREATE'd table (empleados, inventory_items, cajero_commissions,
    // payroll_runs, salary_changes, memberships, etc.).
    if (migBlock) {
      const re2 = /(?:'([^']*(?:\\.[^']*)*)'|"([^"]*(?:\\.[^"]*)*)"|`([^`]*(?:\\.[^`]*)*)`)/g
      let mm
      while ((mm = re2.exec(migBlock))) {
        const s = mm[1] ?? mm[2] ?? mm[3]
        if (!s || !/^\s*(ALTER|CREATE|UPDATE|INSERT|DROP)\s/i.test(s)) continue
        applySql(s)
      }
    }
  }

  return model
}

// ─── PULL_TABLES descriptors from sync.js ───────────────────────────────────

function loadPullTables() {
  const syncJs = fs.readFileSync(path.join(ROOT, 'electron/sync.js'), 'utf8')
  const startIdx = syncJs.indexOf('const PULL_TABLES = [')
  if (startIdx < 0) throw new Error('PULL_TABLES not found')
  let depth = 0, endIdx = -1
  for (let i = startIdx + 'const PULL_TABLES = '.length; i < syncJs.length; i++) {
    const ch = syncJs[i]
    if (ch === '[') depth++
    else if (ch === ']') { depth--; if (depth === 0) { endIdx = i; break } }
  }
  const block = syncJs.slice(startIdx, endIdx + 1)

  // Depth-tracking split: each top-level `{ ... }` inside the array is one
  // descriptor. We respect nested braces so fkCols: { ... } stays inside its
  // parent descriptor instead of closing it.
  const descriptors = []
  let depthBrace = 0, descStart = -1
  for (let i = 0; i < block.length; i++) {
    const ch = block[i]
    if (ch === '{') {
      if (depthBrace === 0) descStart = i
      depthBrace++
    } else if (ch === '}') {
      depthBrace--
      if (depthBrace === 0 && descStart >= 0) {
        const text = block.slice(descStart, i + 1)
        const nameMatch = text.match(/name:\s*'([^']+)'/)
        if (!nameMatch) { descStart = -1; continue }
        const name = nameMatch[1]
        const supMatch = text.match(/supabaseTable:\s*'([^']+)'/)
        const supabaseTable = supMatch ? supMatch[1] : name

        // cols: depth-tracked extraction of the `[...]` after `cols:`
        let cols = []
        const colsIdx = text.indexOf('cols:')
        if (colsIdx >= 0) {
          let bracketDepth = 0, colsStart = -1, colsEnd = -1
          for (let j = colsIdx; j < text.length; j++) {
            if (text[j] === '[') { if (bracketDepth === 0) colsStart = j + 1; bracketDepth++ }
            else if (text[j] === ']') { bracketDepth--; if (bracketDepth === 0) { colsEnd = j; break } }
          }
          if (colsStart >= 0 && colsEnd > colsStart) {
            cols = [...text.slice(colsStart, colsEnd).matchAll(/'([^']+)'/g)].map(x => x[1])
          }
        }

        // fkCols: depth-tracked extraction of the `{...}` after `fkCols:`
        let fkCols = []
        const fkIdx = text.indexOf('fkCols:')
        if (fkIdx >= 0) {
          let braceDepth = 0, fkStart = -1, fkEnd = -1
          for (let j = fkIdx; j < text.length; j++) {
            if (text[j] === '{') { if (braceDepth === 0) fkStart = j + 1; braceDepth++ }
            else if (text[j] === '}') { braceDepth--; if (braceDepth === 0) { fkEnd = j; break } }
          }
          if (fkStart >= 0 && fkEnd > fkStart) {
            const body = text.slice(fkStart, fkEnd)
            fkCols = [...body.matchAll(/(\w+_supabase_id)\s*:\s*'([^']+)'/g)].map(x => ({ fk: x[1], ref: x[2] }))
          }
        }

        descriptors.push({ name, supabaseTable, cols, fkCols })
        descStart = -1
      }
    }
  }
  return descriptors
}

async function getSupabaseColumns(tableName) {
  if (!env.SUPABASE_ACCESS_TOKEN) return null
  const SQL = `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${tableName}' ORDER BY ordinal_position`
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT}/database/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: SQL }),
    })
    const j = await res.json()
    if (!Array.isArray(j)) return null
    return j
  } catch { return null }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Fresh-install schema-parity audit')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  console.log('\n→ Building static schema model (simulating a virgin install)…')
  const model = buildVirginSchemaModel()
  console.log(`  ${model.size} tables modeled`)

  console.log('\n→ Parsing PULL_TABLES descriptors from electron/sync.js…')
  const descriptors = loadPullTables()
  console.log(`  ${descriptors.length} table descriptors found`)

  const findings = []

  console.log('\n→ Scenario 1: every cols[] entry exists in virgin local schema…')
  let scen1 = 0
  for (const d of descriptors) {
    const t = model.get(d.name)
    if (!t) {
      findings.push({ severity: 'critical', table: d.name, kind: 'missing_table',
        detail: `Table referenced in PULL_TABLES but not created by virgin schema init` })
      continue
    }
    for (const col of d.cols) {
      scen1++
      if (!t.columns.has(col)) {
        findings.push({ severity: 'critical', table: d.name, kind: 'missing_local_col',
          detail: `cols[] references '${col}' but virgin local schema lacks it — sync.pull will throw "no such column: ${col}"` })
      }
    }
  }
  console.log(`  ${scen1} column-existence checks`)

  console.log('\n→ Scenario 2: every fkCols entry exists in virgin local schema…')
  let scen2 = 0
  for (const d of descriptors) {
    const t = model.get(d.name)
    if (!t) continue
    for (const { fk } of d.fkCols) {
      scen2++
      if (!t.columns.has(fk)) {
        findings.push({ severity: 'critical', table: d.name, kind: 'missing_local_fk',
          detail: `fkCols references '${fk}' but virgin local schema lacks it — sync.pull INSERT will fail` })
      }
    }
  }
  console.log(`  ${scen2} fk-column-existence checks`)

  console.log('\n→ Scenario 3: NOT NULL parent-FK columns covered by either cols[] or fkCols…')
  let scen3 = 0
  for (const d of descriptors) {
    const t = model.get(d.name)
    if (!t) continue
    const fkSet = new Set(d.fkCols.map(x => x.fk))
    const colSet = new Set(d.cols)
    for (const col of t.columns) {
      if (!col.endsWith('_supabase_id')) continue
      if (col === 'supabase_id') continue
      if (!t.notNull.has(col)) continue
      scen3++
      if (!fkSet.has(col) && !colSet.has(col)) {
        findings.push({ severity: 'critical', table: d.name, kind: 'fk_not_null_uncovered',
          detail: `Local has '${col}' NOT NULL but it's in neither cols[] nor fkCols — sync.pull INSERT will fail with NOT NULL violation (this is the v2.17.10 oferta_items bug)` })
      }
    }
  }
  console.log(`  ${scen3} NOT-NULL FK coverage checks`)

  console.log('\n→ Scenario 4: cross-check against Supabase information_schema (8 high-traffic tables)…')
  const sampleTables = ['empleados','inventory_items','oferta_items','ofertas','staff','tickets','ticket_items','clients']
  let scen4 = 0
  for (const tname of sampleTables) {
    const t = model.get(tname === 'staff' ? 'users' : tname)  // local 'users' is the staff view name
    if (!t) continue
    const cloud = await getSupabaseColumns(tname)
    if (!cloud) {
      findings.push({ severity: 'warning', table: tname, kind: 'cloud_unreachable',
        detail: 'could not query Supabase information_schema' })
      continue
    }
    for (const row of cloud) {
      scen4++
      const col = row.column_name
      if (col === 'id') continue
      if (!t.columns.has(col)) {
        findings.push({ severity: 'info', table: tname, kind: 'cloud_col_missing_local',
          detail: `Cloud has '${col}' (nullable=${row.is_nullable}) — virgin local lacks it. Only matters if sync.pull references it.` })
      }
    }
  }
  console.log(`  ${scen4} cloud-vs-local column comparisons`)

  // ─── Report ──────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  RESULTS — ${findings.length} finding(s) across ${scen1 + scen2 + scen3 + scen4} scenarios`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  const bySev = { critical: [], warning: [], info: [] }
  for (const f of findings) bySev[f.severity].push(f)

  for (const sev of ['critical', 'warning', 'info']) {
    if (!bySev[sev].length) continue
    console.log(`\n  ${sev.toUpperCase()} (${bySev[sev].length}):`)
    for (const f of bySev[sev]) {
      console.log(`    [${f.kind}] ${f.table}: ${f.detail}`)
    }
  }

  const exitCode = bySev.critical.length > 0 ? 1 : 0
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  ${exitCode === 0 ? '✓ PASS' : '✗ FAIL'} — ${bySev.critical.length} critical, ${bySev.warning.length} warnings, ${bySev.info.length} info`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  process.exit(exitCode)
}

main().catch(e => {
  console.error('FATAL:', e.message)
  console.error(e.stack)
  process.exit(2)
})
