#!/usr/bin/env node
/**
 * rotate-supabase-keys.js — Full Supabase API key rotation script
 *
 * What it does:
 *   1. Rotates the PostgREST JWT secret (invalidates old anon + service_role keys)
 *   2. Waits for PostgREST to restart and keys to regenerate
 *   3. Fetches the new keys
 *   4. Updates your local .env file
 *   5. Updates Vercel environment variables
 *   6. Tells you what to do next (rebuild + redeploy)
 *
 * Usage:
 *   node scripts/rotate-supabase-keys.js
 *
 * Prerequisites:
 *   - SUPABASE_ACCESS_TOKEN in .env (Management API token)
 *   - Vercel CLI logged in (`npx vercel login`)
 *   - Run during a maintenance window — web POS will be down for ~5 min
 */

const https = require('https')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')

const PROJECT_REF = 'csppjsoirjflumaiipqw'
const ENV_PATH = path.join(__dirname, '../.env')
const VERCEL_PROJECT = 'prj_AjhpUcrbNGuSWZrs9CLxQmKkGXnL'

// ── Helpers ──────────────────────────────────────────────────────────────────

function supabaseAPI(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const envContent = fs.readFileSync(ENV_PATH, 'utf8')
    const tokenMatch = envContent.match(/SUPABASE_ACCESS_TOKEN=(.+)/)
    if (!tokenMatch) return reject(new Error('SUPABASE_ACCESS_TOKEN not found in .env'))
    const token = tokenMatch[1].trim()

    const bodyStr = body ? JSON.stringify(body) : null
    const options = {
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}${endpoint}`,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr)

    const req = https.request(options, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)) } catch { resolve(data) }
        } else {
          reject(new Error(`Supabase API ${res.statusCode}: ${data}`))
        }
      })
    })
    req.on('error', reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function updateEnvKey(envContent, key, value) {
  const regex = new RegExp(`^${key}=.*$`, 'm')
  if (regex.test(envContent)) {
    return envContent.replace(regex, `${key}=${value}`)
  }
  return envContent + `\n${key}=${value}`
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== SUPABASE KEY ROTATION ===\n')
  console.log('Project:', PROJECT_REF)
  console.log('This will:')
  console.log('  1. Rotate the PostgREST JWT secret')
  console.log('  2. Wait for new keys to propagate (~90s)')
  console.log('  3. Update .env with new keys')
  console.log('  4. Update Vercel env vars')
  console.log('')
  console.log('WARNING: The web POS will be DOWN during rotation (~2-5 min)')
  console.log('         Desktop app sync will fail until next update')
  console.log('')

  // Confirm
  if (!process.argv.includes('--yes')) {
    console.log('Run with --yes to proceed, or Ctrl+C to abort.')
    console.log('  node scripts/rotate-supabase-keys.js --yes')
    process.exit(0)
  }

  // Step 1: Get current keys for comparison
  console.log('[1/6] Fetching current keys...')
  const oldKeys = await supabaseAPI('GET', '/api-keys')
  const oldAnon = oldKeys.find(k => k.name === 'anon')?.api_key
  const oldService = oldKeys.find(k => k.name === 'service_role')?.api_key
  console.log('  Old anon prefix:', oldAnon?.substring(oldAnon.length - 10))
  console.log('  Old service_role prefix:', oldService?.substring(oldService.length - 10))

  // Step 2: Generate and apply new JWT secret
  console.log('\n[2/6] Rotating PostgREST JWT secret...')
  const newSecret = crypto.randomBytes(64).toString('base64')
  await supabaseAPI('PATCH', '/postgrest', { jwt_secret: newSecret })
  console.log('  New JWT secret applied.')

  // Step 3: Wait for propagation
  console.log('\n[3/6] Waiting for PostgREST to restart (90 seconds)...')
  for (let i = 90; i > 0; i -= 10) {
    process.stdout.write(`  ${i}s remaining...\r`)
    await sleep(10000)
  }
  console.log('  Done waiting.                    ')

  // Step 4: Fetch new keys
  console.log('\n[4/6] Fetching new keys...')
  const newKeys = await supabaseAPI('GET', '/api-keys')
  const newAnon = newKeys.find(k => k.name === 'anon')?.api_key
  const newService = newKeys.find(k => k.name === 'service_role')?.api_key

  if (!newAnon || !newService) {
    console.error('ERROR: Could not fetch new keys. Check Supabase dashboard manually.')
    console.error('Keys response:', JSON.stringify(newKeys, null, 2))
    process.exit(1)
  }

  const anonChanged = newAnon !== oldAnon
  const serviceChanged = newService !== oldService
  console.log('  Anon key changed:', anonChanged)
  console.log('  Service role key changed:', serviceChanged)

  if (!anonChanged && !serviceChanged) {
    console.log('\n  Keys have not changed yet. Supabase legacy keys may need')
    console.log('  to be rotated from the dashboard. The JWT secret has been')
    console.log('  rotated, which means the OLD keys will stop working once')
    console.log('  PostgREST fully restarts.')
    console.log('')
    console.log('  Check: https://supabase.com/dashboard/project/' + PROJECT_REF + '/settings/api')
    console.log('')
    console.log('  If keys show as unchanged, the old ones are now INVALID.')
    console.log('  You need to create new keys from the dashboard.')
  }

  // Step 5: Update .env
  console.log('\n[5/6] Updating .env...')
  let envContent = fs.readFileSync(ENV_PATH, 'utf8')

  // Update all occurrences of the keys
  if (anonChanged) {
    envContent = updateEnvKey(envContent, 'SUPABASE_ANON_KEY', newAnon)
    envContent = updateEnvKey(envContent, 'VITE_SUPABASE_ANON_KEY', newAnon)
    envContent = updateEnvKey(envContent, 'VITE_DEV_SUPABASE_KEY', newAnon)
  }
  if (serviceChanged) {
    envContent = updateEnvKey(envContent, 'SUPABASE_SERVICE_ROLE_KEY', newService)
  }

  fs.writeFileSync(ENV_PATH, envContent)
  console.log('  .env updated.')

  // Step 6: Update Vercel env vars
  console.log('\n[6/6] Updating Vercel environment variables...')
  try {
    if (anonChanged) {
      execSync(`npx vercel env rm SUPABASE_ANON_KEY production -y 2>/dev/null; npx vercel env add SUPABASE_ANON_KEY production <<< "${newAnon}"`, { stdio: 'pipe' })
      execSync(`npx vercel env rm VITE_SUPABASE_ANON_KEY production -y 2>/dev/null; npx vercel env add VITE_SUPABASE_ANON_KEY production <<< "${newAnon}"`, { stdio: 'pipe' })
      console.log('  Vercel anon key updated.')
    }
    if (serviceChanged) {
      execSync(`npx vercel env rm SUPABASE_SERVICE_ROLE_KEY production -y 2>/dev/null; npx vercel env add SUPABASE_SERVICE_ROLE_KEY production <<< "${newService}"`, { stdio: 'pipe' })
      console.log('  Vercel service_role key updated.')
    }
    console.log('  Vercel env vars synced.')
  } catch (e) {
    console.log('  Vercel CLI not available or not logged in.')
    console.log('  Manually update these in Vercel dashboard:')
    if (anonChanged) {
      console.log('    SUPABASE_ANON_KEY=' + newAnon)
      console.log('    VITE_SUPABASE_ANON_KEY=' + newAnon)
    }
    if (serviceChanged) {
      console.log('    SUPABASE_SERVICE_ROLE_KEY=' + newService)
    }
  }

  // Summary
  console.log('\n=== ROTATION COMPLETE ===\n')
  console.log('Next steps:')
  console.log('  1. Rebuild and deploy web:')
  console.log('     cd "A:\\Studio X HUB\\Terminal X" && npm run build:web')
  console.log('     (then follow the deploy steps in CLAUDE.md)')
  console.log('')
  console.log('  2. Rebuild desktop installer:')
  console.log('     npm run dist:win')
  console.log('     (push to GitHub releases for auto-update)')
  console.log('')
  console.log('  3. Verify:')
  console.log('     - Open terminalxpos.com/pos and confirm it loads')
  console.log('     - Open desktop app and check sync status')
  console.log('')
  if (anonChanged) console.log('  New anon key: ' + newAnon.substring(0, 30) + '...')
  if (serviceChanged) console.log('  New service_role key: ' + newService.substring(0, 30) + '...')
  console.log('')
}

main().catch(err => {
  console.error('\nFATAL:', err.message)
  process.exit(1)
})
