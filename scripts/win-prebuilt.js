#!/usr/bin/env node
/**
 * Downloads the better-sqlite3 win32-x64 prebuilt binary before electron-builder runs.
 * Required because npmRebuild:false skips native module compilation, and
 * better-sqlite3 has no bundled prebuilds — only the platform binary from npm install.
 *
 * The downloaded win32 binary replaces build/Release/better_sqlite3.node so that
 * electron-builder picks it up and packages the correct Windows binary.
 */

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const SQLITE_VERSION = '12.8.0'
const ELECTRON_VERSION = '41.0.3'
const ROOT = path.join(__dirname, '..')
const SQLITE_DIR = path.join(ROOT, 'node_modules', 'better-sqlite3')
const BUILD_DIR = path.join(SQLITE_DIR, 'build', 'Release')

console.log('[win-prebuilt] Downloading better-sqlite3 win32-x64 prebuilt...')
console.log(`  better-sqlite3 v${SQLITE_VERSION}, Electron v${ELECTRON_VERSION}`)

// Ensure the Release directory exists
if (!fs.existsSync(BUILD_DIR)) {
  fs.mkdirSync(BUILD_DIR, { recursive: true })
}

// Use prebuild-install to download the correct prebuilt binary
// --platform win32 --arch x64 forces the target platform
// --tag-prefix v is required for better-sqlite3 release tags
// --runtime electron --target sets the Electron ABI version
try {
  execSync(
    `npx prebuild-install \
      --platform win32 \
      --arch x64 \
      --runtime electron \
      --target ${ELECTRON_VERSION} \
      --tag-prefix v`,
    {
      cwd: SQLITE_DIR,
      stdio: 'inherit',
      env: { ...process.env, npm_config_platform: 'win32', npm_config_arch: 'x64' }
    }
  )
  console.log('[win-prebuilt] better-sqlite3 win32-x64 prebuilt downloaded successfully.')
} catch (err) {
  console.error('[win-prebuilt] prebuild-install failed:', err.message)
  console.error('[win-prebuilt] Attempting fallback: manual GitHub release download...')

  // Fallback: download directly from GitHub releases
  const https = require('https')
  const zlib = require('zlib')
  const tar = require('tar') // node-tar is bundled with npm

  const tag = `v${SQLITE_VERSION}`
  const filename = `better_sqlite3-v${SQLITE_VERSION}-electron-v${ELECTRON_VERSION}-win32-x64.tar.gz`
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/${tag}/${filename}`
  const dest = path.join(BUILD_DIR, 'better_sqlite3.node')

  console.log(`[win-prebuilt] Downloading ${filename} from GitHub...`)

  // Simple redirect-following download
  function download(url, cb) {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location, cb)
      }
      if (res.statusCode !== 200) {
        return cb(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      cb(null, res)
    }).on('error', cb)
  }

  // Run async in sync context using a promise + exit code trick
  ;(async () => {
    await new Promise((resolve, reject) => {
      download(url, (err, stream) => {
        if (err) return reject(err)
        const gunzip = zlib.createGunzip()
        const chunks = []
        stream.pipe(gunzip)
        gunzip.on('data', d => chunks.push(d))
        gunzip.on('end', () => {
          // Extract build/Release/better_sqlite3.node from the tar
          const tarBuf = Buffer.concat(chunks)
          // Write the raw tar to a temp file and extract with tar module
          const tmpTar = path.join(BUILD_DIR, '_tmp.tar')
          fs.writeFileSync(tmpTar, tarBuf)
          try {
            execSync(`tar -xf "${tmpTar}" -C "${BUILD_DIR}" --strip-components=2 build/Release/better_sqlite3.node`, { stdio: 'inherit' })
            fs.unlinkSync(tmpTar)
            console.log('[win-prebuilt] Fallback download succeeded.')
            resolve()
          } catch (e) {
            fs.unlinkSync(tmpTar)
            reject(e)
          }
        })
        gunzip.on('error', reject)
      })
    })
  })().catch(e => {
    console.error('[win-prebuilt] Fallback also failed:', e.message)
    console.error('[win-prebuilt] The Windows build may not work. Please manually place the win32-x64 binary at:')
    console.error(`  ${dest}`)
    process.exit(1)
  })
}
