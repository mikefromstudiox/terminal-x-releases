/**
 * retry.js — Bounded exponential-backoff retry for network operations.
 *
 * Pure ESM. Zero dependencies. Safe to use from both browser + Electron renderer.
 *
 * Design goals:
 *   - Only retry transient failures (fetch error, timeout, 5xx, 429, supabase
 *     network-layer errors). Never retry auth errors (400/401/403/422) or
 *     logically-invalid responses (those should surface immediately to the UI).
 *   - Preserve the happy path: a success on the first attempt is indistinguishable
 *     from calling the underlying fn directly — no extra awaits, no logging.
 *   - Emit a single structured `[net]` console.warn per retry so ops can see
 *     what's happening without drowning the console on healthy installs.
 *   - Final failure re-throws the ORIGINAL error so humanizeNetworkError() +
 *     upstream try/catch still work untouched.
 *
 * Usage:
 *   const result = await withRetry(() => fetch(url), { label: 'license.validate' })
 *   const { data, error } = await withRetry(
 *     () => sb.auth.signInWithPassword({ email, password }),
 *     { label: 'auth.signIn', isRetryable: isSupabaseRetryable }
 *   )
 */

// ── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULT_RETRIES = 2            // 3 total attempts
const DEFAULT_BASE_MS = 400          // 400ms → 800ms → 1600ms (capped)
const DEFAULT_MAX_MS  = 2500
const DEFAULT_JITTER  = 0.25         // ±25%

// ── Retryability detection ───────────────────────────────────────────────────

/**
 * Default predicate: true for transient network / 5xx / 429 / fetch failures.
 * Returns false for auth / validation errors so the UI can react immediately.
 */
export function isRetryableNetworkError(err) {
  if (!err) return false

  // AbortError from a timeout signal → retry
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true

  // DOMException network failures
  if (err.name === 'TypeError' && /fetch/i.test(String(err.message || ''))) return true

  // Plain string messages (defensive)
  const msg = String(err.message || err || '').toLowerCase()
  if (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('load failed') ||
    msg.includes('err_network') ||
    msg.includes('err_internet_disconnected') ||
    msg.includes('err_connection') ||
    msg.includes('socket hang up') ||
    msg.includes('etimedout') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('eai_again') ||
    msg.includes('timeout')
  ) return true

  // HTTP status on Response-style errors
  const status = Number(err.status || err.statusCode || err.code)
  if (status === 408 || status === 425 || status === 429) return true
  if (status >= 500 && status < 600) return true

  return false
}

/**
 * Supabase-aware predicate. `supabase.auth.*` resolves with `{ error }` for
 * auth failures (e.g. wrong password) → never retry. But it REJECTS with a
 * real Error for network failures (AuthRetryableFetchError) → retry.
 */
export function isSupabaseRetryable(err) {
  if (!err) return false
  // Supabase tags its retryable fetch errors
  const name = String(err.name || '')
  if (name === 'AuthRetryableFetchError') return true
  return isRetryableNetworkError(err)
}

// ── Core ─────────────────────────────────────────────────────────────────────

/**
 * Execute `fn` with bounded exponential backoff + jitter.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{
 *   label?: string,
 *   retries?: number,
 *   baseMs?: number,
 *   maxMs?: number,
 *   jitter?: number,
 *   isRetryable?: (err: unknown) => boolean,
 *   signal?: AbortSignal,
 * }} [opts]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts = {}) {
  const {
    label       = 'net',
    retries     = DEFAULT_RETRIES,
    baseMs      = DEFAULT_BASE_MS,
    maxMs       = DEFAULT_MAX_MS,
    jitter      = DEFAULT_JITTER,
    isRetryable = isRetryableNetworkError,
    signal,
  } = opts

  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      return await fn()
    } catch (err) {
      const canRetry = attempt < retries && isRetryable(err)
      if (!canRetry) throw err

      const exp   = Math.min(baseMs * Math.pow(2, attempt), maxMs)
      const jit   = exp * jitter * (Math.random() * 2 - 1)
      const delay = Math.max(50, Math.round(exp + jit))
      const msg   = String(err?.message || err || 'unknown')

      // Structured single-line log. Easy to grep, cheap to emit.
      // eslint-disable-next-line no-console
      console.warn(`[net] retry ${label} attempt=${attempt + 1}/${retries + 1} delay=${delay}ms reason=${msg}`)

      await sleep(delay, signal)
      attempt++
    }
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}
