// Carnicería storage helpers — uploads cortes + descartes photos to Supabase
// storage with full rollback semantics. Every upload returns
// `{ ok, url, path, error }`. Callers MUST keep the `path` so a failed DB
// write can call `removePhoto(bucket, path)` to delete the orphaned blob.
//
// Buckets (created by scripts/create-carniceria-storage-buckets.mjs):
//   • corte-photos              — public, 5 MB cap, image/jpeg|png|webp
//   • inventory-discard-photos  — private, 8 MB cap, image/jpeg|png|webp
//
// Offline behavior: storage is online-only by design (DGII/PCI photo evidence
// is not a contingency artifact). When offline, `uploadCortePhoto` /
// `uploadDiscardPhoto` resolve with `{ ok: false, error: 'offline' }` so the
// caller can surface a toast and refuse to save the row.

import { getSupabaseClient } from './supabase'

const CORTE_BUCKET    = 'corte-photos'
const DISCARD_BUCKET  = 'inventory-discard-photos'
const MAX_CORTE_BYTES = 5 * 1024 * 1024
const MAX_DISC_BYTES  = 8 * 1024 * 1024
const ALLOWED_MIME    = ['image/jpeg', 'image/png', 'image/webp']

function isOnline() {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

function sanitize(s) {
  return String(s || '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80)
}

async function uploadBlob({ bucket, path, blob, contentType, upsert = false }) {
  if (!isOnline()) return { ok: false, error: 'offline' }
  const sb = getSupabaseClient()
  if (!sb) return { ok: false, error: 'no-supabase-client' }
  try {
    const { error } = await sb.storage.from(bucket).upload(path, blob, {
      contentType: contentType || blob.type || 'image/jpeg',
      upsert,
      cacheControl: bucket === CORTE_BUCKET ? '604800' : '0', // public 7d, private no-cache
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, path }
  } catch (e) {
    return { ok: false, error: e?.message || 'upload-failed' }
  }
}

export async function uploadCortePhoto({ business_id, corte_supabase_id, file, onProgress }) {
  if (!file) return { ok: false, error: 'missing-file' }
  if (!business_id || !corte_supabase_id) return { ok: false, error: 'missing-ids' }
  if (file.size > MAX_CORTE_BYTES) return { ok: false, error: `file-too-large (max 5 MB, got ${Math.round(file.size/1024)} KB)` }
  if (!ALLOWED_MIME.includes(file.type)) return { ok: false, error: `mime-not-allowed (${file.type})` }
  onProgress?.(0.1)
  const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg','jpg')
  const path = `${sanitize(business_id)}/cortes/${sanitize(corte_supabase_id)}.${ext}`
  onProgress?.(0.4)
  const r = await uploadBlob({ bucket: CORTE_BUCKET, path, blob: file, upsert: true })
  onProgress?.(1)
  if (!r.ok) return r
  // Public URL — cortes bucket is public so no signing needed.
  const sb = getSupabaseClient()
  const { data } = sb.storage.from(CORTE_BUCKET).getPublicUrl(path)
  return { ok: true, url: data?.publicUrl || null, path, bucket: CORTE_BUCKET }
}

export async function uploadDiscardPhoto({ business_id, discard_supabase_id, file, onProgress }) {
  if (!file) return { ok: false, error: 'missing-file' }
  if (!business_id || !discard_supabase_id) return { ok: false, error: 'missing-ids' }
  if (file.size > MAX_DISC_BYTES) return { ok: false, error: `file-too-large (max 8 MB, got ${Math.round(file.size/1024)} KB)` }
  if (!ALLOWED_MIME.includes(file.type)) return { ok: false, error: `mime-not-allowed (${file.type})` }
  onProgress?.(0.1)
  const today = new Date().toISOString().slice(0, 10)
  const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg','jpg')
  const path = `${sanitize(business_id)}/discards/${today}/${sanitize(discard_supabase_id)}.${ext}`
  onProgress?.(0.4)
  const r = await uploadBlob({ bucket: DISCARD_BUCKET, path, blob: file, upsert: false })
  onProgress?.(1)
  if (!r.ok) return r
  // Signed URL — 1 year so receipts can be re-printed during fiscal cycle.
  const sb = getSupabaseClient()
  const { data, error } = await sb.storage.from(DISCARD_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365)
  if (error) return { ok: false, error: error.message }
  return { ok: true, url: data?.signedUrl || null, path, bucket: DISCARD_BUCKET }
}

// Rollback helper — call this if the DB row write fails AFTER the photo uploaded.
// Logs but does not throw; orphan blob deletion is best-effort.
export async function removePhoto(bucket, path) {
  if (!bucket || !path) return { ok: false, error: 'missing' }
  const sb = getSupabaseClient(); if (!sb) return { ok: false, error: 'no-client' }
  try {
    const { error } = await sb.storage.from(bucket).remove([path])
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || 'remove-failed' }
  }
}

export const CarniceriaBuckets = { CORTE: CORTE_BUCKET, DISCARD: DISCARD_BUCKET }
