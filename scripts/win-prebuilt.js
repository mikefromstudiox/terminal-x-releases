#!/usr/bin/env node
/**
 * Rebuilds better-sqlite3 for Electron before electron-builder runs.
 * Uses @electron/rebuild to compile the native module against the correct Electron ABI.
 */

const { execSync } = require('child_process')
const path = require('path')

const ELECTRON_VERSION = '28.3.3'

console.log(`[win-prebuilt] Rebuilding better-sqlite3 for Electron v${ELECTRON_VERSION}...`)

try {
  execSync(
    `npx @electron/rebuild -m node_modules/better-sqlite3 -v ${ELECTRON_VERSION}`,
    { cwd: path.join(__dirname, '..'), stdio: 'inherit' }
  )
  console.log('[win-prebuilt] better-sqlite3 rebuilt successfully.')
} catch (err) {
  console.error('[win-prebuilt] Rebuild failed:', err.message)
  process.exit(1)
}
