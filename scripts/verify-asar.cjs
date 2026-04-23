#!/usr/bin/env node
/* Verifies the built app.asar contains every file the runtime requires.
 * If a file in REQUIRED is missing, exit 1 — blocks release.
 *
 * Rationale: v2.13.2 shipped without packages/services/sentry-scrub.cjs,
 * causing a hard boot crash. electron-builder's `files` glob silently
 * dropped it. This script is the tripwire so that can never happen again.
 */
const { execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const ASAR = path.resolve(__dirname, '..', 'dist', 'win-unpacked', 'resources', 'app.asar')
const ASAR_BIN = path.resolve(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'asar.cmd' : 'asar')

const REQUIRED = [
  'electron/main.js',
  'electron/preload.js',
  'electron/database.js',
  'electron/sync.js',
  'electron/updater.js',
  'electron/sentry-init.js',
  'electron/xml-signer.js',
  'electron/xml-builder.js',
  'electron/dgii-client.js',
  'electron/cert-manager.js',
  'packages/services/sentry-scrub.cjs',
  'dist/index.html',
  'package.json',
]

if (!fs.existsSync(ASAR)) {
  console.error(`[verify-asar] FAIL: ${ASAR} not found. Run electron-builder first.`)
  process.exit(1)
}

const listing = execFileSync(ASAR_BIN, ['list', ASAR], { encoding: 'utf8' })
const present = new Set(listing.split(/\r?\n/).map(l => l.replace(/^\/+/, '').trim()))

const missing = REQUIRED.filter(f => !present.has(f))

if (missing.length) {
  console.error('[verify-asar] FAIL: required files missing from app.asar:')
  for (const f of missing) console.error('  - ' + f)
  console.error('\nFix: add the path(s) to the `build.files` allowlist in package.json.')
  process.exit(1)
}

console.log(`[verify-asar] OK — all ${REQUIRED.length} required files present in app.asar`)
