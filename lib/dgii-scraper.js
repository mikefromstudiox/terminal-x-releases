// dgii-scraper.js — DGII Oficina Virtual scraper for e-CF queries.
//
// Endpoints:
//   POST https://www.dgii.gov.do/ofv/Consultas/ConsultaECF.Aspx — Emitidos (sent)
//   POST https://www.dgii.gov.do/ofv/Consultas/ConsultaRCF.Aspx — Recibidos (received)
//
// Auth: ASP.NET_SessionId cookie. Login flow needs to be captured separately
// (see captureLogin TODO below). Until login is wired, the contadora's
// session cookie is stored encrypted and refreshed manually if expired.
//
// IMPORTANT: Recibidos requires a non-blank `txtRncEmisor` per query — DGII
// forces per-issuer iteration. Caller passes a list of supplier RNCs (derive
// from prior accounting_comprobantes history per client).

const BASE = 'https://www.dgii.gov.do/ofv/Consultas'
const URL_EMITIDOS = `${BASE}/ConsultaECF.Aspx`
const URL_RECIBIDOS = `${BASE}/ConsultaRCF.Aspx`
const URL_LOGIN = 'https://www.dgii.gov.do/OFV/login.aspx'
const URL_HOME = 'https://www.dgii.gov.do/OFV/home.aspx'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36'

// ─── ASP.NET response delta parser ─────────────────────────────────────────
// MicrosoftAjax UpdatePanel response format:
//   length|type|name|content|length|type|name|content|...
// Each segment is `<n>|<token>|<id>|<value>`. We extract __VIEWSTATE,
// __EVENTVALIDATION, __VIEWSTATEGENERATOR, and the updatePanel HTML payload.
export function parseAspNetDelta(body) {
  const out = { viewState: null, viewStateGenerator: null, eventValidation: null, html: '', updatePanels: {} }
  let i = 0
  while (i < body.length) {
    const pipe = body.indexOf('|', i)
    if (pipe === -1) break
    const len = parseInt(body.slice(i, pipe), 10)
    if (!Number.isFinite(len)) break
    const j = pipe + 1
    const pipe2 = body.indexOf('|', j)
    const type = body.slice(j, pipe2)
    const k = pipe2 + 1
    const pipe3 = body.indexOf('|', k)
    const name = body.slice(k, pipe3)
    const valStart = pipe3 + 1
    const value = body.slice(valStart, valStart + len)
    const next = valStart + len
    if (body[next] !== '|' && next < body.length) {
      // malformed — bail
      break
    }
    if (type === 'hiddenField') {
      if (name === '__VIEWSTATE') out.viewState = value
      else if (name === '__VIEWSTATEGENERATOR') out.viewStateGenerator = value
      else if (name === '__EVENTVALIDATION') out.eventValidation = value
    } else if (type === 'updatePanel') {
      out.updatePanels[name] = value
      out.html += value
    }
    i = next + 1
  }
  return out
}

// ─── Auto-login: GET login.aspx → POST creds → return authenticated cookie ─
//
// DGII Oficina Virtual login flow:
//   1. GET /OFV/login.aspx — sets ASP.NET_SessionId cookie + has __VIEWSTATE
//   2. POST /OFV/login.aspx with txtUsuario, txtPassword, BtnAceptar=Entrar
//      using the SAME cookie + ViewState
//   3. On success: 302 redirect to /OFV/home.aspx; the same SessionId is now
//      authenticated. Failures stay on login.aspx with an error message.
//   4. We additionally GET /OFV/home.aspx to confirm session actually persists.
//
// Returns: { ok, sessionCookie, cookies, error, errorCode }.
//
// errorCode taxonomy (stable, machine-readable — caller branches on this):
//   - 'bad_credentials'      Usuario o contraseña incorrectos / wrong creds
//   - 'captcha_required'     DGII surfaced a captcha challenge (recaptcha or img)
//   - 'account_locked'       Account bloqueado/suspendido or too many intentos
//   - 'server_error'         5xx from DGII or known server-side error markup
//   - 'network_error'        fetch threw (DNS, TLS, timeout, abort)
//   - 'session_not_persisted' login looked OK but home.aspx bounced to login
//   - 'invalid_input'        missing user/pass argument
//   - 'no_session_cookie'    DGII never issued ASP.NET_SessionId
//   - 'no_viewstate'         login page didn't expose __VIEWSTATE/__EVENTVALIDATION
//   - 'unexpected'           anything else (response shape we don't recognize)
//
// `error` field stays human-readable Spanish/English text for UI surfacing.
export async function loginToDgii({ user, pass }) {
  if (!user || !pass) {
    return { ok: false, error: 'user + pass required', errorCode: 'invalid_input' }
  }

  // Step 1: GET login.aspx
  let r1
  try {
    r1 = await fetch(URL_LOGIN, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'manual',
    })
  } catch (err) {
    return { ok: false, error: `GET login network error: ${err?.message || err}`, errorCode: 'network_error' }
  }
  if (r1.status >= 500) {
    return { ok: false, error: `GET login → HTTP ${r1.status}`, errorCode: 'server_error' }
  }
  if (!r1.ok && r1.status !== 302) {
    return { ok: false, error: `GET login → HTTP ${r1.status}`, errorCode: 'unexpected' }
  }
  const setCookies = r1.headers.getSetCookie?.() || []
  let sessionCookie = null
  const cookieJar = []
  for (const c of setCookies) {
    const m = c.match(/^([^=]+)=([^;]+)/)
    if (m) {
      cookieJar.push(`${m[1]}=${m[2]}`)
      if (m[1] === 'ASP.NET_SessionId') sessionCookie = m[2]
    }
  }
  if (!sessionCookie) {
    return { ok: false, error: 'no ASP.NET_SessionId issued by login GET', errorCode: 'no_session_cookie' }
  }
  const html = await r1.text()

  // Captcha check on the login GET itself — sometimes DGII gates the form.
  const captchaOnGet = detectCaptcha(html)
  if (captchaOnGet) {
    return { ok: false, error: `Captcha requerido (${captchaOnGet})`, errorCode: 'captcha_required' }
  }

  const m = (re) => (html.match(re) || [])[1] || ''
  const viewState = m(/id="__VIEWSTATE"\s+value="([^"]+)"/)
  const viewStateGenerator = m(/id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/)
  const eventValidation = m(/id="__EVENTVALIDATION"\s+value="([^"]+)"/)
  if (!viewState || !eventValidation) {
    return { ok: false, error: 'no ViewState/EventValidation in login page', errorCode: 'no_viewstate' }
  }

  // Step 2: POST creds
  const body = encodeForm({
    '__EVENTTARGET': '',
    '__EVENTARGUMENT': '',
    '__VIEWSTATE': viewState,
    '__VIEWSTATEGENERATOR': viewStateGenerator,
    '__EVENTVALIDATION': eventValidation,
    'ctl00$ContentPlaceHolder1$txtUsuario': user,
    'ctl00$ContentPlaceHolder1$txtPassword': pass,
    'ctl00$ContentPlaceHolder1$BtnAceptar': 'Entrar',
  })
  let r2
  try {
    r2 = await fetch(URL_LOGIN, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Cookie': cookieJar.join('; '),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Origin': 'https://www.dgii.gov.do',
        'Referer': URL_LOGIN,
        'Upgrade-Insecure-Requests': '1',
      },
      body,
      redirect: 'manual',
    })
  } catch (err) {
    return { ok: false, error: `POST login network error: ${err?.message || err}`, errorCode: 'network_error' }
  }

  if (r2.status >= 500) {
    return { ok: false, error: `login POST → HTTP ${r2.status}`, errorCode: 'server_error' }
  }

  // Pick up any new cookies from the login response (e.g. NSC_* updated)
  for (const c of (r2.headers.getSetCookie?.() || [])) {
    const mm = c.match(/^([^=]+)=([^;]+)/)
    if (mm) {
      const idx = cookieJar.findIndex(x => x.startsWith(mm[1] + '='))
      if (idx >= 0) cookieJar[idx] = `${mm[1]}=${mm[2]}`
      else cookieJar.push(`${mm[1]}=${mm[2]}`)
      if (mm[1] === 'ASP.NET_SessionId') sessionCookie = mm[2]
    }
  }

  // Success = 302 redirect to home.aspx (most likely) or a 200 with home page
  const location = r2.headers.get('location') || ''
  let provisionallyOk = false
  if (r2.status === 302 && /home\.aspx/i.test(location)) {
    provisionallyOk = true
  } else if (r2.status === 302) {
    // Redirect somewhere else (e.g. back to login or an error page) — inspect target
    if (/login\.aspx/i.test(location)) {
      return { ok: false, error: 'login_failed (redirect back to login)', errorCode: 'bad_credentials' }
    }
    return { ok: false, error: `login POST → 302 ${location}`, errorCode: 'unexpected' }
  } else if (r2.status === 200) {
    const body2 = await r2.text()
    const cls = classifyLoginBody(body2)
    if (cls.code) return { ok: false, error: cls.error, errorCode: cls.code }
    if (cls.stillOnLogin) {
      return { ok: false, error: cls.error || 'login_failed (still on login form)', errorCode: 'bad_credentials' }
    }
    // Body looks like home — assume provisional success and verify with home.aspx GET
    provisionallyOk = true
  } else {
    return { ok: false, error: `login POST → HTTP ${r2.status} loc=${location}`, errorCode: 'unexpected' }
  }

  if (!provisionallyOk) {
    return { ok: false, error: `login POST → HTTP ${r2.status} loc=${location}`, errorCode: 'unexpected' }
  }

  // Step 3: sanity-check session by GET-ing home.aspx with the cookie jar
  let r3
  try {
    r3 = await fetch(URL_HOME, {
      headers: {
        'User-Agent': UA,
        'Cookie': cookieJar.join('; '),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': URL_LOGIN,
      },
      redirect: 'manual',
    })
  } catch (err) {
    return { ok: false, error: `home.aspx network error: ${err?.message || err}`, errorCode: 'network_error' }
  }
  if (r3.status >= 500) {
    return { ok: false, error: `home.aspx → HTTP ${r3.status}`, errorCode: 'server_error' }
  }
  // Update cookies again in case home.aspx rotates anything
  for (const c of (r3.headers.getSetCookie?.() || [])) {
    const mm = c.match(/^([^=]+)=([^;]+)/)
    if (mm) {
      const idx = cookieJar.findIndex(x => x.startsWith(mm[1] + '='))
      if (idx >= 0) cookieJar[idx] = `${mm[1]}=${mm[2]}`
      else cookieJar.push(`${mm[1]}=${mm[2]}`)
      if (mm[1] === 'ASP.NET_SessionId') sessionCookie = mm[2]
    }
  }
  const homeLoc = r3.headers.get('location') || ''
  if ((r3.status === 302 || r3.status === 301) && /login\.aspx/i.test(homeLoc)) {
    return { ok: false, error: 'session_not_persisted (home → login redirect)', errorCode: 'session_not_persisted' }
  }
  if (r3.status === 200) {
    const homeBody = await r3.text()
    if (/id="ctl00_ContentPlaceHolder1_txtPassword"/i.test(homeBody) || /BtnAceptar/.test(homeBody) && /txtPassword/.test(homeBody)) {
      return { ok: false, error: 'session_not_persisted (home shows login form)', errorCode: 'session_not_persisted' }
    }
  }

  return { ok: true, sessionCookie, cookies: cookieJar.join('; ') }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Detect captcha presence in an HTML body.
 * @param {string} body
 * @returns {string|null} short tag identifying which captcha flavor, or null
 */
function detectCaptcha(body) {
  if (!body) return null
  if (/g-recaptcha-response/i.test(body)) return 'recaptcha-response'
  if (/class\s*=\s*["'][^"']*g-recaptcha/i.test(body)) return 'g-recaptcha'
  if (/grecaptcha\s*\.\s*(execute|render)/i.test(body)) return 'grecaptcha-js'
  if (/www\.google\.com\/recaptcha/i.test(body)) return 'recaptcha-script'
  if (/<img[^>]+(captcha|Captcha|CAPTCHA)[^>]*>/i.test(body)) return 'captcha-image'
  if (/name=["']?(captcha|txtCaptcha|CaptchaCode)["']?/i.test(body)) return 'captcha-input'
  return null
}

/**
 * Extract lblMensaje text from an HTML body, decoded + trimmed.
 * @param {string} body
 * @returns {string|null}
 */
function extractLblMensaje(body) {
  const m = body.match(/id=["'][^"']*lblMensaje[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div|p|td)>/i)
  if (!m) return null
  const raw = m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  return raw || null
}

/**
 * Classify a 200-OK login response body into a structured error.
 * @param {string} body
 * @returns {{ code: string|null, error: string|null, stillOnLogin: boolean }}
 */
function classifyLoginBody(body) {
  const stillOnLogin = /BtnAceptar/.test(body) && /txtPassword/.test(body)
  const lbl = extractLblMensaje(body)
  const lower = body.toLowerCase()

  // Captcha takes precedence — user can't proceed regardless
  const cap = detectCaptcha(body)
  if (cap) {
    return { code: 'captcha_required', error: lbl || `Captcha requerido (${cap})`, stillOnLogin }
  }

  // Account-locked patterns
  if (/\bbloquead[oa]\b/i.test(body) || /\bsuspendid[oa]\b/i.test(body) ||
      /demasiados\s+intentos/i.test(body) || /intentos?\s+(fallidos|excedidos|máximos|maximos)/i.test(body)) {
    return { code: 'account_locked', error: lbl || 'Cuenta bloqueada o suspendida', stillOnLogin }
  }

  // Bad-credentials patterns (Spanish + variants)
  if (/usuario\s+o\s+contrase[ñn]a\s+(incorrect[oa]|inv[aá]lid[oa])/i.test(body) ||
      /contrase[ñn]a\s+incorrect[oa]/i.test(body) ||
      /credenciales?\s+(incorrect[oa]s?|inv[aá]lid[oa]s?)/i.test(body) ||
      /\bincorrect[oa]s?\b/i.test(body) && stillOnLogin) {
    return { code: 'bad_credentials', error: lbl || 'Usuario o contraseña incorrectos', stillOnLogin }
  }

  // Generic server-error markup on a 200 page
  if (/error\s+del?\s+servidor/i.test(body) || /server\s+error\s+in\s+'\/'/i.test(lower) ||
      /yellow\s+screen\s+of\s+death/i.test(lower) || /Runtime\s+Error/i.test(body)) {
    return { code: 'server_error', error: lbl || 'Error del servidor DGII', stillOnLogin }
  }

  // Still on login form but no specific marker — treat as bad_credentials with lbl text if any
  if (stillOnLogin) {
    return { code: null, error: lbl || null, stillOnLogin: true }
  }
  return { code: null, error: null, stillOnLogin: false }
}

// ─── Fetch initial page (GET) to seed __VIEWSTATE ──────────────────────────
async function fetchInitialState(url, sessionCookie) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Cookie': `ASP.NET_SessionId=${sessionCookie}`,
      'Accept': 'text/html',
    },
  })
  if (!r.ok) throw new Error(`DGII GET ${url} → HTTP ${r.status}`)
  // Capture any Set-Cookie updates (NSC_*, etc.)
  const setCookies = r.headers.getSetCookie?.() || []
  const html = await r.text()
  const m = (re) => (html.match(re) || [])[1]
  return {
    viewState:        m(/id="__VIEWSTATE"\s+value="([^"]+)"/) || '',
    viewStateGenerator: m(/id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/) || '',
    eventValidation:  m(/id="__EVENTVALIDATION"\s+value="([^"]+)"/) || '',
    cookies: [`ASP.NET_SessionId=${sessionCookie}`, ...setCookies.map(c => c.split(';')[0])].join('; '),
  }
}

// ─── Build the form body for a search POST ─────────────────────────────────
function encodeForm(obj) {
  return Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`).join('&')
}

function ddmmyyyy(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// ─── Search e-CFs Recibidos (per supplier RNC) ────────────────────────────
export async function searchRecibidos({ sessionCookie, rncEmisor, fechaDesde, fechaHasta, ncf, tipoECF = -1 }) {
  if (!sessionCookie) throw new Error('sessionCookie required')
  if (!rncEmisor) throw new Error('rncEmisor required (DGII enforces non-blank)')
  const init = await fetchInitialState(URL_RECIBIDOS, sessionCookie)
  const body = encodeForm({
    'ctl00$ScriptManager1': 'ctl00$ContentPlaceHolder1$upd1|ctl00$ContentPlaceHolder1$imgBuscar',
    '__EVENTTARGET': '',
    '__EVENTARGUMENT': '',
    '__VIEWSTATE': init.viewState,
    '__VIEWSTATEGENERATOR': init.viewStateGenerator,
    '__EVENTVALIDATION': init.eventValidation,
    'ctl00$ContentPlaceHolder1$hdnMessage': '',
    'ctl00$ContentPlaceHolder1$hdnMessageType': '',
    'ctl00$ContentPlaceHolder1$hdnIsThereError': '',
    'ctl00$ContentPlaceHolder1$txtRncEmisor': String(rncEmisor).replace(/\D/g, ''),
    'ctl00$ContentPlaceHolder1$ddlTipoECF': tipoECF,
    'ctl00$ContentPlaceHolder1$ddlAprobacionComercial': -1,
    'ctl00$ContentPlaceHolder1$txtFechaDesde': ddmmyyyy(fechaDesde),
    'ctl00$ContentPlaceHolder1$txtFechaHasta': ddmmyyyy(fechaHasta),
    '__ASYNCPOST': 'true',
    'ctl00$ContentPlaceHolder1$imgBuscar': 'Buscar',
  })
  const r = await fetch(URL_RECIBIDOS, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Cookie': init.cookies,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': '*/*',
      'Origin': 'https://www.dgii.gov.do',
      'Referer': URL_RECIBIDOS,
      'X-MicrosoftAjax': 'Delta=true',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body,
  })
  if (!r.ok) throw new Error(`DGII POST RCF → HTTP ${r.status}`)
  const text = await r.text()
  // Detect login expiry — DGII redirects to login.aspx if session is dead
  if (/login\.aspx/i.test(text) || /<title>.*Login/i.test(text)) {
    return { rows: [], errors: ['session_expired'], raw: null }
  }
  const parsed = parseAspNetDelta(text)
  const rows = parseGridFromHtml(parsed.html, 'recibidos', { rncEmisor })
  return { rows, errors: [], raw: parsed }
}

// ─── Search e-CFs Emitidos (no RNC required) ──────────────────────────────
export async function searchEmitidos({ sessionCookie, fechaDesde, fechaHasta, ncf, rncReceptor, tipoECF = -1 }) {
  if (!sessionCookie) throw new Error('sessionCookie required')
  const init = await fetchInitialState(URL_EMITIDOS, sessionCookie)
  const body = encodeForm({
    'ctl00$ScriptManager1': 'ctl00$ContentPlaceHolder1$upd1|ctl00$ContentPlaceHolder1$imgBuscar',
    '__EVENTTARGET': '',
    '__EVENTARGUMENT': '',
    '__VIEWSTATE': init.viewState,
    '__VIEWSTATEGENERATOR': init.viewStateGenerator,
    '__EVENTVALIDATION': init.eventValidation,
    'ctl00$ContentPlaceHolder1$hdnMessage': '',
    'ctl00$ContentPlaceHolder1$hdnMessageType': '',
    'ctl00$ContentPlaceHolder1$hdnIsThereError': '',
    'ctl00$ContentPlaceHolder1$txteNCF': ncf || '',
    'ctl00$ContentPlaceHolder1$txtRncReceptor': rncReceptor ? String(rncReceptor).replace(/\D/g, '') : '',
    'ctl00$ContentPlaceHolder1$ddlTipoECF': tipoECF,
    'ctl00$ContentPlaceHolder1$ddlEstado': -1,
    'ctl00$ContentPlaceHolder1$ddlAprovacionComercial': -1,
    'ctl00$ContentPlaceHolder1$txtFechaDesde': ddmmyyyy(fechaDesde),
    'ctl00$ContentPlaceHolder1$txtFechaHasta': ddmmyyyy(fechaHasta),
    '__ASYNCPOST': 'true',
    'ctl00$ContentPlaceHolder1$imgBuscar': 'Buscar',
  })
  const r = await fetch(URL_EMITIDOS, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Cookie': init.cookies,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': '*/*',
      'Origin': 'https://www.dgii.gov.do',
      'Referer': URL_EMITIDOS,
      'X-MicrosoftAjax': 'Delta=true',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body,
  })
  if (!r.ok) throw new Error(`DGII POST ECF → HTTP ${r.status}`)
  const text = await r.text()
  if (/login\.aspx/i.test(text) || /<title>.*Login/i.test(text)) {
    return { rows: [], errors: ['session_expired'], raw: null }
  }
  const parsed = parseAspNetDelta(text)
  const rows = parseGridFromHtml(parsed.html, 'emitidos', {})
  return { rows, errors: [], raw: parsed }
}

// ─── HTML grid parser — extract <tr> rows from the gvEmisorCF GridView ────
// DGII GridView columns (Recibidos): NCF | Tipo | RNC Emisor | Razón Social
// Emisor | Fecha Emisión | Estado | Aprobación Comercial | Monto | ITBIS
// (column order may shift per page — we match by position relative to NCF).
function parseGridFromHtml(html, kind, ctx) {
  if (!html) return []
  const rows = []
  // Match <tr> within the gvEmisorCF table, skipping the header row.
  const tableMatch = html.match(/<table[^>]*id="ctl00_ContentPlaceHolder1_gvEmisorCF"[\s\S]*?<\/table>/i)
  const tableHtml = tableMatch ? tableMatch[0] : html
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let trMatch
  let isFirst = true
  while ((trMatch = trRe.exec(tableHtml)) !== null) {
    if (isFirst) { isFirst = false; continue } // skip header
    const trInner = trMatch[1]
    const cells = []
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi
    let tdMatch
    while ((tdMatch = tdRe.exec(trInner)) !== null) {
      const text = tdMatch[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim()
      cells.push(text)
    }
    if (!cells.length) continue
    if (kind === 'recibidos') {
      // Best-guess column order: NCF, Tipo, RNC Emisor, Razón Social, Fecha,
      // Estado, Aprobación, Monto, ITBIS. We anchor on the NCF column (E* or B*).
      const ncfIdx = cells.findIndex(c => /^[BE]\d{2}\d{8,11}$/.test(c.replace(/\s+/g, '')))
      if (ncfIdx === -1) continue
      const ncf = cells[ncfIdx].replace(/\s+/g, '')
      const fechaIdx = cells.findIndex(c => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(c.trim()))
      const fecha = fechaIdx >= 0 ? cells[fechaIdx].trim() : null
      // Find amount-shaped cells (last two are usually total + ITBIS)
      const moneyCells = cells.map((c, i) => ({ c, i, n: parseFloat(c.replace(/[$,\s]/g, '').replace(/[^\d.\-]/g, '')) }))
        .filter(x => Number.isFinite(x.n) && x.n > 0 && x.i > ncfIdx)
      const itbis = moneyCells[moneyCells.length - 1]?.n ?? 0
      const total = moneyCells[moneyCells.length - 2]?.n ?? itbis
      rows.push({
        kind: 'recibido',
        ecf_type: ncf.startsWith('E') ? ncf.slice(0, 3) : ncf.slice(0, 3),
        ncf,
        fecha_emision: fecha ? toIsoDate(fecha) : null,
        emisor_rnc: ctx.rncEmisor || cells.find(c => /^\d{9,11}$/.test(c.replace(/\s+/g, ''))) || null,
        emisor_razon_social: cells[ncfIdx + 3] || cells[ncfIdx + 2] || null,
        monto_total: total,
        itbis_facturado: itbis,
        monto_facturado: Math.max(0, total - itbis),
      })
    } else if (kind === 'emitidos') {
      const ncfIdx = cells.findIndex(c => /^[BE]\d{2}\d{8,11}$/.test(c.replace(/\s+/g, '')))
      if (ncfIdx === -1) continue
      const ncf = cells[ncfIdx].replace(/\s+/g, '')
      const fechaIdx = cells.findIndex(c => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(c.trim()))
      rows.push({
        kind: 'emitido',
        ecf_type: ncf.slice(0, 3),
        ncf,
        fecha_emision: fechaIdx >= 0 ? toIsoDate(cells[fechaIdx]) : null,
        receptor_rnc: cells.find(c => /^\d{9,11}$/.test(c.replace(/\s+/g, ''))) || null,
      })
    }
  }
  return rows
}

function toIsoDate(ddmmyyyy) {
  const m = String(ddmmyyyy || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
}

// ─── Search + Export to XLS (single round-trip) ───────────────────────────
// DGII's Exportar button does a SYNC postback (no __ASYNCPOST) with the
// search form fields PLUS btnExportar=Exportar+XLS. Returns binary XLS.
// We must include the gvEmisorCF data in the ViewState — easiest way is
// to first run the search (to get the populated ViewState), then send the
// export with that ViewState. We pass the ViewState/EventValidation from
// the search response.
export async function exportEmitidosXlsx({ sessionCookie, searchState, fechaDesde, fechaHasta, ncf, rncReceptor, tipoECF = -1 }) {
  if (!sessionCookie) throw new Error('sessionCookie required')
  if (!searchState?.viewState) throw new Error('searchState (from search response) required')
  const body = encodeForm({
    'ctl00$ContentPlaceHolder1$hdnMessage': '',
    'ctl00$ContentPlaceHolder1$hdnMessageType': '',
    'ctl00$ContentPlaceHolder1$hdnIsThereError': '',
    'ctl00$ContentPlaceHolder1$txteNCF': ncf || '',
    'ctl00$ContentPlaceHolder1$txtRncReceptor': rncReceptor ? String(rncReceptor).replace(/\D/g, '') : '',
    'ctl00$ContentPlaceHolder1$ddlTipoECF': tipoECF,
    'ctl00$ContentPlaceHolder1$ddlEstado': -1,
    'ctl00$ContentPlaceHolder1$ddlAprovacionComercial': -1,
    'ctl00$ContentPlaceHolder1$txtFechaDesde': ddmmyyyy(fechaDesde),
    'ctl00$ContentPlaceHolder1$txtFechaHasta': ddmmyyyy(fechaHasta),
    'ctl00$ContentPlaceHolder1$btnExportar': 'Exportar XLS',
    'ctl00$ContentPlaceHolder1$hdnPaginaActual': '1',
    '__EVENTTARGET': '',
    '__EVENTARGUMENT': '',
    '__LASTFOCUS': '',
    '__VIEWSTATE': searchState.viewState,
    '__VIEWSTATEGENERATOR': searchState.viewStateGenerator,
    '__EVENTVALIDATION': searchState.eventValidation,
  })
  const r = await fetch(URL_EMITIDOS, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Cookie': `ASP.NET_SessionId=${sessionCookie}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Origin': 'https://www.dgii.gov.do',
      'Referer': URL_EMITIDOS,
    },
    body,
    redirect: 'follow',
  })
  if (!r.ok) throw new Error(`Exportar XLS → HTTP ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  return buf
}

export async function exportRecibidosXlsx({ sessionCookie, searchState, rncEmisor, fechaDesde, fechaHasta, tipoECF = -1 }) {
  if (!sessionCookie) throw new Error('sessionCookie required')
  if (!searchState?.viewState) throw new Error('searchState required')
  if (!rncEmisor) throw new Error('rncEmisor required')
  const body = encodeForm({
    'ctl00$ContentPlaceHolder1$hdnMessage': '',
    'ctl00$ContentPlaceHolder1$hdnMessageType': '',
    'ctl00$ContentPlaceHolder1$hdnIsThereError': '',
    'ctl00$ContentPlaceHolder1$txtRncEmisor': String(rncEmisor).replace(/\D/g, ''),
    'ctl00$ContentPlaceHolder1$ddlTipoECF': tipoECF,
    'ctl00$ContentPlaceHolder1$ddlAprobacionComercial': -1,
    'ctl00$ContentPlaceHolder1$txtFechaDesde': ddmmyyyy(fechaDesde),
    'ctl00$ContentPlaceHolder1$txtFechaHasta': ddmmyyyy(fechaHasta),
    'ctl00$ContentPlaceHolder1$btnExportar': 'Exportar XLS',
    'ctl00$ContentPlaceHolder1$hdnPaginaActual': '1',
    '__EVENTTARGET': '',
    '__EVENTARGUMENT': '',
    '__LASTFOCUS': '',
    '__VIEWSTATE': searchState.viewState,
    '__VIEWSTATEGENERATOR': searchState.viewStateGenerator,
    '__EVENTVALIDATION': searchState.eventValidation,
  })
  const r = await fetch(URL_RECIBIDOS, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Cookie': `ASP.NET_SessionId=${sessionCookie}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Origin': 'https://www.dgii.gov.do',
      'Referer': URL_RECIBIDOS,
    },
    body,
    redirect: 'follow',
  })
  if (!r.ok) throw new Error(`Exportar XLS → HTTP ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

export default { parseAspNetDelta, searchRecibidos, searchEmitidos, exportEmitidosXlsx, exportRecibidosXlsx, loginToDgii }
