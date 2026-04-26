/**
 * Run demo-e2e-smoke.mjs against every vertical sequentially.
 * Aggregates pass/fail per vertical and exits non-zero if any fail.
 *
 * Usage:
 *   node scripts/demo-e2e-all.mjs
 *   npm run e2e:demo:all
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(__dirname, 'demo-e2e-smoke.mjs')

const VERTICALS = ['carwash', 'tienda', 'restaurante', 'salon', 'hibrido', 'mecanica', 'servicios', 'prestamos', 'concesionario', 'carniceria']

function runOne(vertical) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, vertical], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', d => { out += d.toString(); process.stdout.write(d) })
    p.stderr.on('data', d => { err += d.toString(); process.stderr.write(d) })
    p.on('close', code => {
      const m = out.match(/RESULTS:\s+(\d+)\s+pass\s+\/\s+(\d+)\s+fail\s+\/\s+(\d+)\s+total/)
      resolve({
        vertical,
        code,
        pass: m ? Number(m[1]) : 0,
        fail: m ? Number(m[2]) : -1,
        total: m ? Number(m[3]) : 0,
      })
    })
  })
}

async function main() {
  const summary = []
  for (const v of VERTICALS) {
    const r = await runOne(v)
    summary.push(r)
  }
  console.log('\n\n========== ALL-VERTICAL SUMMARY ==========')
  let totalPass = 0, totalFail = 0
  for (const r of summary) {
    const sym = r.code === 0 ? '✅' : '❌'
    console.log(`${sym} ${r.vertical.padEnd(14)} ${r.pass}/${r.total} pass${r.fail > 0 ? `  (${r.fail} fail)` : ''}${r.code !== 0 && r.fail <= 0 ? '  [crashed]' : ''}`)
    totalPass += r.pass
    totalFail += Math.max(r.fail, 0)
  }
  console.log(`\nGRAND TOTAL: ${totalPass} pass / ${totalFail} fail across ${summary.length} verticals`)
  process.exit(summary.some(r => r.code !== 0) ? 1 : 0)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
