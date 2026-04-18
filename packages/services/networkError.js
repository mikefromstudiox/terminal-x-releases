/**
 * networkError.js — Humanize raw network / auth errors into bilingual
 * Spanish/English strings the cashier actually understands.
 *
 * Pure ESM. Zero deps. Browser + Electron renderer safe.
 *
 * Contract:
 *   humanizeNetworkError(err, opts?) → string  (never empty, never "[object Object]")
 *   Also console.warn's a single `[net]` line so ops can correlate.
 *
 * Default language is Spanish (app is DR-first). Pass { lang: 'en' } for English.
 */

// ── Language detection ───────────────────────────────────────────────────────
function detectLang(opt) {
  if (opt === 'en' || opt === 'es') return opt
  try {
    const stored = typeof localStorage !== 'undefined' && localStorage.getItem('tx_lang')
    if (stored === 'en' || stored === 'es') return stored
  } catch {}
  try {
    const nav = typeof navigator !== 'undefined' ? navigator.language || '' : ''
    if (/^en\b/i.test(nav)) return 'en'
  } catch {}
  return 'es'
}

// ── Catalog ──────────────────────────────────────────────────────────────────
// Each entry: { es, en }. Key is an internal tag.
const MESSAGES = {
  offline:           { es: 'Sin conexión a internet. Revisa tu red.',                      en: 'No internet connection. Check your network.' },
  timeout:           { es: 'La solicitud tardó demasiado. Intenta de nuevo.',              en: 'The request took too long. Please try again.' },
  server_down:       { es: 'El servidor no responde. Intenta en un momento.',              en: 'The server is not responding. Please try again shortly.' },
  rate_limited:      { es: 'Demasiados intentos. Espera unos segundos.',                   en: 'Too many attempts. Please wait a few seconds.' },
  dns:               { es: 'No se pudo resolver la dirección del servidor.',               en: 'Could not resolve the server address.' },
  cors:              { es: 'Bloqueado por el navegador (CORS). Contacta soporte.',         en: 'Blocked by the browser (CORS). Contact support.' },
  tls:               { es: 'Error de certificado seguro. Revisa la fecha/hora del equipo.', en: 'Secure certificate error. Check this device\'s date/time.' },
  bad_credentials:   { es: 'Correo o contraseña incorrectos.',                             en: 'Incorrect email or password.' },
  email_not_confirmed:{es: 'Tu correo aún no ha sido confirmado.',                         en: 'Your email has not been confirmed yet.' },
  user_not_found:    { es: 'No existe una cuenta con ese correo.',                         en: 'No account exists with that email.' },
  permission_denied: { es: 'No tienes permiso para hacer esta acción.',                    en: 'You do not have permission for this action.' },
  not_found:         { es: 'No se encontró el recurso solicitado.',                        en: 'The requested resource was not found.' },
  conflict:          { es: 'Conflicto al guardar. Otro usuario ya modificó estos datos.',  en: 'Save conflict. Another user already changed this data.' },
  license_unreachable:{es: 'No se pudo contactar el servidor de licencias.',               en: 'Could not reach the license server.' },
  unknown:           { es: 'Ocurrió un error inesperado. Intenta de nuevo.',               en: 'Something went wrong. Please try again.' },
}

// ── Classifier ───────────────────────────────────────────────────────────────
function classify(err) {
  if (!err) return 'unknown'

  const status = Number(err.status || err.statusCode || err.code)
  const name   = String(err.name || '')
  const raw    = String(err.message || err || '').toLowerCase()

  // Auth-level (Supabase / gotrue)
  if (/invalid login credentials|invalid_grant|wrong password|bad.credentials/.test(raw)) return 'bad_credentials'
  if (/email not confirmed|email.*not.*confirm/.test(raw))                                return 'email_not_confirmed'
  if (/user not found|no user found/.test(raw))                                           return 'user_not_found'

  // Network-layer
  if (name === 'AbortError' || name === 'TimeoutError' || /timeout|timed out/.test(raw))  return 'timeout'
  if (/failed to fetch|networkerror|network error|load failed|err_network|err_internet_disconnected|err_connection/.test(raw)) return 'offline'
  if (/enotfound|eai_again|dns/.test(raw))                                                return 'dns'
  if (/econnrefused|econnreset|socket hang up|etimedout/.test(raw))                       return 'server_down'
  if (/cors|cross.origin/.test(raw))                                                      return 'cors'
  if (/cert|ssl|tls|self.signed/.test(raw))                                               return 'tls'

  // HTTP-status
  if (status === 401)               return 'bad_credentials'
  if (status === 403)               return 'permission_denied'
  if (status === 404)               return 'not_found'
  if (status === 408)               return 'timeout'
  if (status === 409)               return 'conflict'
  if (status === 429)               return 'rate_limited'
  if (status >= 500 && status < 600) return 'server_down'

  return 'unknown'
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Turn any thrown value into a short, user-safe, bilingual message.
 *
 * @param {unknown} err
 * @param {{ lang?: 'es'|'en', context?: string, fallback?: string, silent?: boolean }} [opts]
 * @returns {string}
 */
export function humanizeNetworkError(err, opts = {}) {
  const lang   = detectLang(opts.lang)
  const tag    = classify(err)
  const entry  = MESSAGES[tag] || MESSAGES.unknown
  const msg    = entry[lang] || entry.es

  if (!opts.silent) {
    const raw = String(err?.message || err || 'unknown')
    const ctx = opts.context ? ` ctx=${opts.context}` : ''
    // eslint-disable-next-line no-console
    console.warn(`[net] humanized tag=${tag}${ctx} raw=${raw}`)
  }

  return msg || opts.fallback || MESSAGES.unknown[lang]
}

/**
 * Context-specific helper used by LicenseContext / license.js so the wording
 * mentions "license server" when appropriate. Falls through to generic network
 * wording for everything else.
 */
export function humanizeLicenseError(err, opts = {}) {
  const lang = detectLang(opts.lang)
  const tag  = classify(err)
  if (tag === 'offline' || tag === 'server_down' || tag === 'dns' || tag === 'timeout') {
    // eslint-disable-next-line no-console
    if (!opts.silent) console.warn(`[net] humanized tag=license_unreachable raw=${String(err?.message || err || '')}`)
    return MESSAGES.license_unreachable[lang]
  }
  return humanizeNetworkError(err, { ...opts, lang })
}
