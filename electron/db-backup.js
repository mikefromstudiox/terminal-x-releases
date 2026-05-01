/**
 * electron/db-backup.js — Nightly SQLite → Supabase Storage backup.
 *
 * Flow (runNightlyBackup):
 *   1. better-sqlite3 `.backup(dest)` — consistent online snapshot.
 *      For SQLCipher-encrypted DBs the page-copy preserves the ciphertext
 *      on disk as-is, so the uploaded file is still encrypted.
 *   2. gzip the snapshot (level 9, memory-capped).
 *   3. POST to Supabase Storage bucket `db-backups` at
 *      `{business_id}/{YYYY-MM-DD}.sqlite.gz` using the service-role key.
 *   4. List the prefix and DELETE anything older than 14 days.
 *   5. activityLogRecord({event_type:'db_backup'}) with severity info|warn.
 *
 * Status is persisted in app_settings keys:
 *   backup_last_ok_at       ISO timestamp of last success
 *   backup_last_error_at    ISO timestamp of last failure
 *   backup_last_error       error message (string)
 *   backup_last_bytes       size uploaded (stringified int)
 *   backup_last_path        full storage path of the last upload
 *
 * The module is network-aware (online check) and license-aware (callers must
 * gate). It is a no-op on platforms without `db` (e.g. web build).
 */

const fs   = require('fs')
const path = require('path')
const zlib = require('zlib')
const https = require('https')
const crypto = require('crypto')

const BUCKET       = 'db-backups'
const RETAIN_DAYS  = 14
const GZIP_LEVEL   = 9

function iso() { return new Date().toISOString() }
function todayStr() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function getSetting(db, key) {
  try { return db.rawPrepare("SELECT value FROM app_settings WHERE key=?").get(key)?.value || null } catch { return null }
}
function setSetting(db, key, value) {
  try {
    db.rawPrepare(`
      INSERT INTO app_settings(key,value,updated_at)
      VALUES(?,?,datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
    `).run(key, value == null ? '' : String(value))
  } catch {}
}

// -- HTTP helper (promise-based https) ----------------------------------------
function httpRequest({ method = 'GET', url, headers = {}, body = null, timeoutMs = 120000 }) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(url) } catch (e) { return reject(e) }
    const req = https.request({
      method,
      hostname: u.hostname,
      port:     u.port || 443,
      path:     u.pathname + u.search,
      headers,
      timeout:  timeoutMs,
    }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end',  () => resolve({
        status:  res.statusCode || 0,
        headers: res.headers,
        body:    Buffer.concat(chunks),
      }))
    })
    req.on('error',   reject)
    req.on('timeout', () => { try { req.destroy(new Error('timeout')) } catch {} })
    if (body) req.write(body)
    req.end()
  })
}

// -- Supabase Storage operations ---------------------------------------------
async function ensureBucket({ supabase }) {
  // GET-first: if the bucket exists, skip POST entirely. Newer Supabase
  // projects RLS-reject bucket-create even for service_role tokens (returns
  // HTTP 400 with statusCode:403 / "new row violates row-level security
  // policy") — that path always failed here. Existence check sidesteps it.
  const headRes = await httpRequest({
    method: 'GET',
    url: `${supabase.url}/storage/v1/bucket/${BUCKET}`,
    headers: {
      'apikey':        supabase.key,
      'Authorization': `Bearer ${supabase.key}`,
    },
  })
  if (headRes.status === 200) return true

  // Bucket missing — try to create. 409 = race-already-exists.
  const res = await httpRequest({
    method: 'POST',
    url: `${supabase.url}/storage/v1/bucket`,
    headers: {
      'apikey':        supabase.key,
      'Authorization': `Bearer ${supabase.key}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  })
  if (res.status === 200 || res.status === 201 || res.status === 409) return true
  const text = res.body.toString('utf8')
  if (/already\s*exists/i.test(text)) return true
  // RLS-rejected create on a project where the bucket already exists but the
  // GET probe failed for an auth reason: surface a clearer error so support
  // knows the bucket needs to be provisioned server-side, not from desktop.
  if (res.status === 400 && /row-level security|statusCode["\s:]+403/i.test(text)) {
    throw new Error(
      'ensureBucket: storage RLS blocks bucket creation from this client. ' +
      'Provision the "' + BUCKET + '" bucket once via Supabase dashboard or ' +
      'server-side migration, then retry. Service-role keys on newer projects ' +
      'no longer bypass storage.buckets RLS.'
    )
  }
  throw new Error(`ensureBucket failed: HTTP ${res.status} — ${text.slice(0, 300)}`)
}

async function uploadObject({ supabase, bucket, objectPath, buffer, contentType }) {
  const url = `${supabase.url}/storage/v1/object/${bucket}/${objectPath}`
  const res = await httpRequest({
    method: 'POST',
    url,
    headers: {
      'apikey':         supabase.key,
      'Authorization':  `Bearer ${supabase.key}`,
      'Content-Type':   contentType || 'application/octet-stream',
      'Content-Length': buffer.length,
      'x-upsert':       'true',
      'Cache-Control':  'no-store',
    },
    body: buffer,
  })
  if (res.status >= 200 && res.status < 300) return true
  throw new Error(`uploadObject failed: HTTP ${res.status} — ${res.body.toString('utf8').slice(0, 300)}`)
}

async function listObjects({ supabase, bucket, prefix }) {
  const url = `${supabase.url}/storage/v1/object/list/${bucket}`
  const res = await httpRequest({
    method: 'POST',
    url,
    headers: {
      'apikey':        supabase.key,
      'Authorization': `Bearer ${supabase.key}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
  })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`listObjects failed: HTTP ${res.status} — ${res.body.toString('utf8').slice(0, 300)}`)
  }
  try { return JSON.parse(res.body.toString('utf8')) || [] } catch { return [] }
}

async function deleteObjects({ supabase, bucket, paths }) {
  if (!paths?.length) return 0
  const url = `${supabase.url}/storage/v1/object/${bucket}`
  const res = await httpRequest({
    method: 'DELETE',
    url,
    headers: {
      'apikey':        supabase.key,
      'Authorization': `Bearer ${supabase.key}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ prefixes: paths }),
  })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`deleteObjects failed: HTTP ${res.status} — ${res.body.toString('utf8').slice(0, 300)}`)
  }
  return paths.length
}

// -- Online check (Supabase reachability via a cheap GET) --------------------
async function isOnline({ supabase }) {
  try {
    const res = await httpRequest({
      method: 'GET',
      url: `${supabase.url}/auth/v1/health`,
      headers: { 'apikey': supabase.key },
      timeoutMs: 8000,
    })
    return res.status >= 200 && res.status < 500
  } catch { return false }
}

// -- Retention purge ---------------------------------------------------------
function olderThanCutoff(name, cutoffMs) {
  // name like "2026-04-06.sqlite.gz" (or arbitrary — fall back to file mtime).
  const m = /^(\d{4})-(\d{2})-(\d{2})\./.exec(name)
  if (!m) return false
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3])
  return t < cutoffMs
}

async function purgeOldBackups({ supabase, businessId }) {
  const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000
  let items = []
  try { items = await listObjects({ supabase, bucket: BUCKET, prefix: `${businessId}/` }) }
  catch { return 0 }
  const victims = items
    .filter(it => it?.name && olderThanCutoff(it.name, cutoff))
    .map(it => `${businessId}/${it.name}`)
  if (!victims.length) return 0
  try { await deleteObjects({ supabase, bucket: BUCKET, paths: victims }); return victims.length }
  catch { return 0 }
}

// -- Snapshot + gzip ---------------------------------------------------------
// v2.16.26 — DO NOT REVERT (FIX-LEDGER §Batch6). Integrity SHA256 of the
// gzipped snapshot. Used to verify roundtrip after upload (HEAD remote and
// confirm Content-Length matches; full content-integrity verify deferred —
// would require re-downloading every backup).
function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    const s = fs.createReadStream(filePath)
    s.on('data', (chunk) => h.update(chunk))
    s.on('end',  () => resolve(h.digest('hex')))
    s.on('error', reject)
  })
}

async function snapshotAndGzip({ db, tmpDir }) {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
  const rawPath = path.join(tmpDir, `snapshot-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.sqlite`)
  const gzPath  = `${rawPath}.gz`
  // better-sqlite3 exposes .backup() on the native handle; our wrapper exposes
  // `rawPrepare` but not the handle directly. We use the documented DB-level
  // `backup` method via `db._handle` if provided, else via a low-level pragma fallback.
  //
  // database.js does NOT expose `backup()`. Add `dbBackupTo(destPath)` there
  // and call it here — falls back to `VACUUM INTO` when unavailable (that
  // path also preserves SQLCipher encryption when the dest file is cipher-less
  // opened, so for encrypted DBs we prefer the real online backup).
  if (typeof db.dbBackupTo === 'function') {
    await db.dbBackupTo(rawPath)
  } else {
    // Fallback: VACUUM INTO. For SQLCipher this writes an encrypted file only
    // if the current key is re-applied — safe for plaintext DBs only.
    db.rawExec(`VACUUM INTO '${rawPath.replace(/'/g, "''")}'`)
  }
  // Stream gzip so a multi-GB DB doesn't blow the heap.
  await new Promise((resolve, reject) => {
    const src = fs.createReadStream(rawPath)
    const dst = fs.createWriteStream(gzPath)
    const gz  = zlib.createGzip({ level: GZIP_LEVEL })
    src.on('error', reject)
    gz .on('error', reject)
    dst.on('error', reject)
    dst.on('close', resolve)
    src.pipe(gz).pipe(dst)
  })
  const bytes = fs.statSync(gzPath).size
  const sha256 = await sha256OfFile(gzPath)
  return { rawPath, gzPath, bytes, sha256 }
}

// v2.16.26 — Verify the upload by HEAD-ing the public storage path and
// asserting Content-Length matches the local size. Returns true on match,
// false on any failure mode (so callers don't proceed to purge old backups).
async function verifyUploadIntegrity({ supabase, useSignedUrl, businessId, objectPath, expectedBytes, signedHeadUrl }) {
  try {
    let url
    if (useSignedUrl && signedHeadUrl) url = signedHeadUrl
    else url = `${supabase.url}/storage/v1/object/${BUCKET}/${objectPath}`
    const headers = useSignedUrl ? {} : {
      'apikey': supabase.key,
      'Authorization': `Bearer ${supabase.key}`,
    }
    const r = await httpRequest({ method: 'HEAD', url, headers, timeoutMs: 30000 })
    if (r.status < 200 || r.status >= 300) return { ok: false, reason: `HEAD ${r.status}` }
    const remoteBytes = Number(r.headers['content-length'] || 0)
    if (remoteBytes && remoteBytes !== expectedBytes) {
      return { ok: false, reason: `size mismatch local=${expectedBytes} remote=${remoteBytes}` }
    }
    return { ok: true, remoteBytes }
  } catch (e) {
    return { ok: false, reason: e?.message || 'verify failed' }
  }
}

function cleanup(paths) {
  for (const p of paths) { try { fs.unlinkSync(p) } catch {} }
}

// -- Service-role detection --------------------------------------------------
// Production installers ship the anon key; only devs running with
// SUPABASE_SERVICE_ROLE_KEY in env get the direct-write path. Anon key cannot
// create buckets or insert into storage.objects without RLS policies, so we
// route through the server-signed URL endpoint instead.
function isServiceRoleKey(key) {
  try {
    const part = String(key).split('.')[1]
    if (!part) return false
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return JSON.parse(json).role === 'service_role'
  } catch { return false }
}

// -- Server-signed upload (production path) ----------------------------------
// Calls panel.js?action=db-backup-sign with license_key + hwid; receives a
// short-lived signed upload URL (service role mints it server-side); PUTs the
// gzipped DB to that URL. No bucket-create or storage RLS gymnastics needed.
async function uploadViaSignedUrl({ supabase, apiBase, licenseKey, hwid, businessId, objectPath, gzPath, bytes }) {
  const signRes = await httpRequest({
    method: 'POST',
    url: `${apiBase}/api/panel?action=db-backup-sign`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: licenseKey, hwid, business_id: businessId, path: objectPath, bytes }),
    timeoutMs: 30000,
  })
  if (signRes.status < 200 || signRes.status >= 300) {
    throw new Error(`db-backup-sign HTTP ${signRes.status}: ${signRes.body.toString('utf8').slice(0, 200)}`)
  }
  let sign
  try { sign = JSON.parse(signRes.body.toString('utf8')) } catch { sign = {} }
  if (!sign.ok || !sign.signedUrl) throw new Error(sign.error || 'db-backup-sign: no url')
  const fullUrl = sign.signedUrl.startsWith('http') ? sign.signedUrl : `${supabase.url}${sign.signedUrl}`
  const buf = fs.readFileSync(gzPath)
  const putRes = await httpRequest({
    method: 'PUT',
    url: fullUrl,
    headers: {
      'Content-Type':   'application/gzip',
      'Content-Length': buf.length,
      'x-upsert':       'true',
      'Cache-Control':  'no-store',
    },
    body: buf,
  })
  if (putRes.status < 200 || putRes.status >= 300) {
    throw new Error(`signed PUT HTTP ${putRes.status}: ${putRes.body.toString('utf8').slice(0, 200)}`)
  }
  return true
}

async function reportBackupStatus({ apiBase, licenseKey, hwid, businessId, status }) {
  try {
    await httpRequest({
      method: 'POST',
      url: `${apiBase}/api/panel?action=db-backup-status`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: licenseKey, hwid, business_id: businessId, ...status }),
      timeoutMs: 10000,
    })
  } catch {}
}

// -- Public entrypoint -------------------------------------------------------
async function runNightlyBackup({ db, supabase, business_id, tmpDir, reason = 'scheduled', licenseKey = null, hwid = null, apiBase = 'https://terminalxpos.com' }) {
  if (!db || !supabase?.url || !supabase?.key) {
    throw new Error('runNightlyBackup: db + supabase credentials required')
  }
  const businessId = business_id || getSetting(db, 'supabase_business_id')
  if (!businessId) throw new Error('runNightlyBackup: no business_id')

  const online = await isOnline({ supabase })
  if (!online) throw new Error('offline — Supabase unreachable')

  const useSignedUrl = !isServiceRoleKey(supabase.key)
  if (useSignedUrl && (!licenseKey || !hwid)) {
    throw new Error('cloud backup requires license activation — log in and try again')
  }

  const workDir = tmpDir || path.join(require('os').tmpdir(), 'terminal-x-backups')
  let rawPath = null, gzPath = null, bytes = 0, sha256 = null
  try {
    if (!useSignedUrl) await ensureBucket({ supabase })
    ;({ rawPath, gzPath, bytes, sha256 } = await snapshotAndGzip({ db, tmpDir: workDir }))
    const objectPath = `${businessId}/${todayStr()}.sqlite.gz`
    if (useSignedUrl) {
      await uploadViaSignedUrl({ supabase, apiBase, licenseKey, hwid, businessId, objectPath, gzPath, bytes })
    } else {
      await uploadObject({
        supabase, bucket: BUCKET, objectPath,
        buffer: fs.readFileSync(gzPath),
        contentType: 'application/gzip',
      })
    }

    // v2.16.26 — DO NOT REVERT (FIX-LEDGER §Batch6). Integrity verify before
    // we trust the upload. HEAD the remote object + assert size matches. Only
    // after a verified-good upload do we run retention purge — otherwise a
    // run of failed uploads ages out the last good backup silently.
    const verify = await verifyUploadIntegrity({ supabase, useSignedUrl, businessId, objectPath, expectedBytes: bytes })
    if (!verify.ok) {
      throw new Error(`upload verify failed: ${verify.reason}`)
    }

    // Retention purge ONLY runs after verified-good upload.
    const purged = useSignedUrl ? 0 : await purgeOldBackups({ supabase, businessId })

    const okAt = iso()
    setSetting(db, 'backup_last_ok_at', okAt)
    setSetting(db, 'backup_last_bytes', bytes)
    setSetting(db, 'backup_last_path',  objectPath)
    setSetting(db, 'backup_last_sha256', sha256)
    setSetting(db, 'backup_last_error', '')
    setSetting(db, 'backup_consecutive_failures', '0')

    try {
      db.activityLogRecord?.({
        event_type:  'db_backup',
        severity:    'info',
        target_type: 'backup',
        target_name: objectPath,
        amount:      bytes,
        metadata:    { reason, bytes, purged, path: objectPath },
      })
    } catch {}
    if (useSignedUrl) {
      await reportBackupStatus({ apiBase, licenseKey, hwid, businessId,
        status: { last_ok_at: okAt, last_error_at: null, last_error: null, last_bytes: bytes, last_path: objectPath } })
    }
    return { ok: true, path: objectPath, bytes, purged }
  } catch (err) {
    const msg = err?.message || String(err)
    const errAt = iso()
    setSetting(db, 'backup_last_error_at', errAt)
    setSetting(db, 'backup_last_error', msg)
    // v2.16.26 — Track consecutive failures so the user gets escalated alerts.
    // 1st failure → warn. 2+ → critical.
    const prevFails = Number(getSetting(db, 'backup_consecutive_failures') || '0') || 0
    const fails = prevFails + 1
    setSetting(db, 'backup_consecutive_failures', String(fails))
    const sev = fails >= 2 ? 'critical' : 'warn'
    try {
      db.activityLogRecord?.({
        event_type:  'db_backup',
        severity:    sev,
        target_type: 'backup',
        target_name: `${businessId}/${todayStr()}.sqlite.gz`,
        reason:      msg,
        metadata:    { reason, error: msg, consecutive_failures: fails },
      })
    } catch {}
    if (useSignedUrl && licenseKey && hwid) {
      await reportBackupStatus({ apiBase, licenseKey, hwid, businessId,
        status: { last_error_at: errAt, last_error: msg } })
    }
    throw err
  } finally {
    cleanup([rawPath, gzPath].filter(Boolean))
  }
}

function getLastStatus(db) {
  return {
    last_ok_at:    getSetting(db, 'backup_last_ok_at'),
    last_error_at: getSetting(db, 'backup_last_error_at'),
    last_error:    getSetting(db, 'backup_last_error'),
    last_bytes:    Number(getSetting(db, 'backup_last_bytes') || 0) || 0,
    last_path:     getSetting(db, 'backup_last_path'),
    retain_days:   RETAIN_DAYS,
  }
}

module.exports = { runNightlyBackup, getLastStatus, BUCKET, RETAIN_DAYS }
