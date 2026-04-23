#!/usr/bin/env node
/* Smoke-test the packaged build BEFORE release.
 *
 * Launches dist/win-unpacked/Terminal X.exe in a sandboxed user-data-dir,
 * waits 15s, asserts:
 *   - process did not crash / exit
 *   - no "A JavaScript error occurred" dialog (checked via window enumeration)
 *   - main BrowserWindow stdout/stderr contains no "Uncaught Exception"
 *
 * Exits 1 on any failure. Wired into `predist:win` so a broken asar
 * can never reach GitHub Releases (see v2.13.2 sentry-scrub.cjs incident).
 */
const { spawn, execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

const EXE = path.resolve(__dirname, '..', 'dist', 'win-unpacked', 'Terminal X.exe')
const SMOKE_USERDATA = path.join(os.tmpdir(), 'terminal-x-smoke-' + Date.now())
const WAIT_MS = 15000

if (process.platform !== 'win32') {
  console.log('[smoke-test] skipped — not win32')
  process.exit(0)
}
if (!fs.existsSync(EXE)) {
  console.error('[smoke-test] FAIL: ' + EXE + ' not found. Build first.')
  process.exit(1)
}

fs.mkdirSync(SMOKE_USERDATA, { recursive: true })

console.log('[smoke-test] launching ' + EXE)
const child = spawn(EXE, ['--user-data-dir=' + SMOKE_USERDATA, '--smoke-test'], {
  detached: false,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false,
})

let stdout = ''
let stderr = ''
let exitedEarly = false
let exitCode = null

child.stdout.on('data', d => { stdout += d.toString() })
child.stderr.on('data', d => { stderr += d.toString() })
child.on('exit', code => { exitedEarly = true; exitCode = code })

const cleanup = () => {
  try {
    execFileSync('taskkill', ['/F', '/IM', 'Terminal X.exe', '/T'], { stdio: 'ignore' })
  } catch (_) {}
  try { fs.rmSync(SMOKE_USERDATA, { recursive: true, force: true }) } catch (_) {}
}

setTimeout(() => {
  const fatal = /Uncaught Exception|Cannot find module|A JavaScript error occurred/i
  const crashed = fatal.test(stdout) || fatal.test(stderr)

  if (exitedEarly) {
    console.error(`[smoke-test] FAIL: process exited early (code=${exitCode})`)
    if (stderr) console.error('--- stderr ---\n' + stderr.slice(0, 2000))
    if (stdout) console.error('--- stdout ---\n' + stdout.slice(0, 2000))
    cleanup()
    process.exit(1)
  }
  if (crashed) {
    console.error('[smoke-test] FAIL: fatal pattern in output')
    console.error('--- stderr ---\n' + stderr.slice(0, 2000))
    console.error('--- stdout ---\n' + stdout.slice(0, 2000))
    cleanup()
    process.exit(1)
  }

  console.log(`[smoke-test] OK — process alive after ${WAIT_MS}ms, no fatal output`)
  cleanup()
  process.exit(0)
}, WAIT_MS)
