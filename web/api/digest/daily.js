/**
 * /api/digest/daily — Daily Owner Digest (Pro MAX).
 *
 * Invoked by Vercel Cron at 13:00 UTC (09:00 America/Santo_Domingo).
 * For every business where app_settings.daily_digest_enabled='true':
 *   1. Compute yesterday's (local DR day) recap.
 *   2. Build a Spanish HTML + plaintext digest.
 *   3. Send via WhatsApp (if UltraMsg configured) + Resend email (if RESEND_API_KEY + owner email).
 *   4. Always log to activity_log (severity=info, event_type=daily_digest_sent) +
 *      update last_digest_sent in app_settings.
 *
 * Auth: Vercel Cron hits this with a CRON_SECRET bearer (optional). Any direct
 * POST from outside must include the bearer. GET from Vercel Cron is allowed.
 *
 * Safety: per-business failures never abort the whole run. Each business is
 * wrapped in try/catch and surfaced in the response summary.
 */

import { createClient } from '@supabase/supabase-js'

// ── DR timezone math (UTC-4 year-round, no DST) ────────────────────────────
// Dominican Republic observes AST without DST. "Yesterday" = the 24h window
// starting at 00:00:00 DR local and ending 23:59:59.999 DR local. In UTC that
// maps to [yesterday 04:00:00 UTC, today 04:00:00 UTC).
function drYesterdayWindow(now = new Date()) {
  const DR_OFFSET_MS = 4 * 60 * 60 * 1000  // UTC-4
  const drNow = new Date(now.getTime() - DR_OFFSET_MS)
  // Midnight DR local, converted back to UTC
  const drMidnightLocal = new Date(Date.UTC(drNow.getUTCFullYear(), drNow.getUTCMonth(), drNow.getUTCDate()))
  const todayStartUtc = new Date(drMidnightLocal.getTime() + DR_OFFSET_MS)
  const yesterdayStartUtc = new Date(todayStartUtc.getTime() - 24 * 60 * 60 * 1000)
  const fmt = (d) => {
    const loc = new Date(d.getTime() - DR_OFFSET_MS)
    return `${loc.getUTCDate().toString().padStart(2, '0')}/${(loc.getUTCMonth() + 1).toString().padStart(2, '0')}/${loc.getUTCFullYear()}`
  }
  return {
    fromIso: yesterdayStartUtc.toISOString(),
    toIso:   todayStartUtc.toISOString(),
    label:   fmt(yesterdayStartUtc),
  }
}

const rd = (n) => `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ── Digest builder ──────────────────────────────────────────────────────────
function buildDigest({ bizName, label, tickets, overrides, cuadreFlags, countVariances }) {
  const count    = tickets.length
  const revenue  = tickets.reduce((s, t) => s + Number(t.total || 0), 0)
  const avg      = count ? revenue / count : 0

  // Top 3 products — tickets.services_json carries { name, qty, price } rows.
  const productMap = {}
  for (const t of tickets) {
    const items = Array.isArray(t.services_json) ? t.services_json : []
    for (const it of items) {
      const name = it?.name || 'Sin nombre'
      const qty  = Number(it?.qty || it?.quantity || 1)
      const line = Number(it?.price || 0) * qty
      if (!productMap[name]) productMap[name] = { name, qty: 0, revenue: 0 }
      productMap[name].qty     += qty
      productMap[name].revenue += line
    }
  }
  const top3 = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 3)

  // Plain text
  const lines = []
  lines.push(`Terminal X — Resumen Diario`)
  lines.push(`${bizName} · ${label}`)
  lines.push('')
  lines.push(`Ventas: ${rd(revenue)}`)
  lines.push(`Tickets: ${count}`)
  lines.push(`Ticket promedio: ${rd(avg)}`)
  if (top3.length) {
    lines.push('')
    lines.push('Top 3 productos:')
    top3.forEach((p, i) => lines.push(`  ${i + 1}. ${p.name} — ${p.qty}u · ${rd(p.revenue)}`))
  }
  if (overrides > 0) {
    lines.push('')
    lines.push(`⚠ Autorizaciones de gerente: ${overrides}`)
  }
  if (cuadreFlags.length) {
    lines.push('')
    lines.push('⚠ Cuadre con descuadre:')
    for (const c of cuadreFlags) {
      lines.push(`  · ${c.cajero || 'Caja'} — descuadre ${rd(c.discrepancia)}`)
    }
  }
  if (countVariances.length) {
    lines.push('')
    lines.push('⚠ Variaciones de inventario:')
    for (const v of countVariances) {
      lines.push(`  · ${v.name || 'Conteo'} — ${rd(v.variance)}`)
    }
  }
  const text = lines.join('\n')

  // HTML — single column, black/white/#b3001e only, inline styles for email clients.
  const row = (label, value, strong) => `<tr><td style="padding:6px 0;color:#000;font-size:14px;">${label}</td><td style="padding:6px 0;text-align:right;color:${strong ? '#b3001e' : '#000'};font-size:14px;font-weight:${strong ? '700' : '600'};">${value}</td></tr>`
  const html = `<!DOCTYPE html><html lang="es-DO"><body style="margin:0;padding:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;padding:24px;">
  <tr><td style="border-bottom:2px solid #b3001e;padding-bottom:12px;">
    <div style="color:#b3001e;font-weight:900;font-size:12px;letter-spacing:2px;">TERMINAL X</div>
    <div style="color:#000;font-size:22px;font-weight:800;margin-top:2px;">Resumen Diario</div>
    <div style="color:#000;font-size:13px;margin-top:2px;">${bizName} · ${label}</div>
  </td></tr>
  <tr><td style="padding-top:16px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${row('Ventas', rd(revenue), true)}
      ${row('Tickets', count, false)}
      ${row('Ticket promedio', rd(avg), false)}
    </table>
  </td></tr>
  ${top3.length ? `<tr><td style="padding-top:20px;">
    <div style="color:#000;font-weight:800;font-size:14px;margin-bottom:8px;">Top 3 productos</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${top3.map((p, i) => `<tr><td style="padding:4px 0;color:#000;font-size:13px;">${i + 1}. ${p.name}</td><td style="padding:4px 0;text-align:right;color:#000;font-size:13px;font-weight:600;">${p.qty}u · ${rd(p.revenue)}</td></tr>`).join('')}
    </table>
  </td></tr>` : ''}
  ${(overrides > 0 || cuadreFlags.length || countVariances.length) ? `<tr><td style="padding-top:20px;border-top:1px solid #000;">
    <div style="color:#b3001e;font-weight:800;font-size:13px;margin:12px 0 8px;">Alertas</div>
    ${overrides > 0 ? `<div style="color:#000;font-size:13px;padding:3px 0;">• Autorizaciones de gerente: <strong style="color:#b3001e;">${overrides}</strong></div>` : ''}
    ${cuadreFlags.map(c => `<div style="color:#000;font-size:13px;padding:3px 0;">• Descuadre ${c.cajero || 'caja'}: <strong style="color:#b3001e;">${rd(c.discrepancia)}</strong></div>`).join('')}
    ${countVariances.map(v => `<div style="color:#000;font-size:13px;padding:3px 0;">• ${v.name || 'Conteo'}: <strong style="color:#b3001e;">${rd(v.variance)}</strong></div>`).join('')}
  </td></tr>` : ''}
  <tr><td style="padding-top:24px;color:#000;font-size:11px;border-top:1px solid #000;padding-top:12px;margin-top:24px;">Terminal X · studioxrd.com · +1 809 828 2971</td></tr>
</table>
</body></html>`

  return { html, text, stats: { count, revenue, avg, top3, overrides, cuadreFlags, countVariances } }
}

// ── Deliverers ──────────────────────────────────────────────────────────────
async function sendWhatsApp(cfg, to, body) {
  if (!cfg?.whatsapp_instance || !cfg?.whatsapp_token || !to) return { ok: false, skipped: true }
  try {
    const r = await fetch(`https://api.ultramsg.com/${cfg.whatsapp_instance}/messages/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(cfg.whatsapp_token)}&to=${encodeURIComponent(to)}&body=${encodeURIComponent(body)}`,
    })
    if (!r.ok) return { ok: false, error: `ultramsg_${r.status}` }
    return { ok: true }
  } catch (e) { return { ok: false, error: e?.message || 'wa_failed' } }
}

async function sendEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY
  if (!key || !to) return { ok: false, skipped: true }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body:    JSON.stringify({
        from:    process.env.DIGEST_EMAIL_FROM || 'Terminal X <digest@terminalxpos.com>',
        to:      [to],
        subject,
        html,
        text,
      }),
    })
    if (!r.ok) return { ok: false, error: `resend_${r.status}` }
    return { ok: true }
  } catch (e) { return { ok: false, error: e?.message || 'email_failed' } }
}

// ── Per-business run ────────────────────────────────────────────────────────
async function runForBusiness(supabase, business, window) {
  const bid   = business.id
  const name  = business.name || 'Mi negocio'
  const settings = (business.settings && typeof business.settings === 'object') ? business.settings : {}

  // Pull yesterday's paid tickets
  const { data: tickets, error: ticketsErr } = await supabase
    .from('tickets')
    .select('total, services_json, paid_at')
    .eq('business_id', bid)
    .eq('status', 'cobrado')
    .gte('paid_at', window.fromIso)
    .lt('paid_at', window.toIso)
  if (ticketsErr) throw ticketsErr

  // Manager overrides (activity_log entries with override event types — we
  // count anything severity=warn/critical that rolls up to a mgr_gate trigger).
  const { data: overridesRows } = await supabase
    .from('activity_log')
    .select('id,event_type,severity')
    .eq('business_id', bid)
    .in('event_type', ['manager_override', 'discount_big', 'void_invoice', 'credit_note', 'inv_adjust'])
    .gte('created_at', window.fromIso)
    .lt('created_at', window.toIso)
  const overrides = (overridesRows || []).length

  // Cuadre discrepancies > RD$50.
  const { data: cuadreRows } = await supabase
    .from('cuadre_caja')
    .select('cajero,discrepancia,created_at')
    .eq('business_id', bid)
    .gte('created_at', window.fromIso)
    .lt('created_at', window.toIso)
  const cuadreFlags = (cuadreRows || []).filter(c => Math.abs(Number(c.discrepancia || 0)) > 50)

  // Inventory count variances > RD$2,000 (completed counts only).
  let countVariances = []
  try {
    const { data: cnts } = await supabase
      .from('inventory_counts')
      .select('name,variance_total,status,completed_at')
      .eq('business_id', bid)
      .eq('status', 'completed')
      .gte('completed_at', window.fromIso)
      .lt('completed_at', window.toIso)
    countVariances = (cnts || [])
      .filter(c => Math.abs(Number(c.variance_total || 0)) > 2000)
      .map(c => ({ name: c.name, variance: c.variance_total }))
  } catch { /* table may not exist yet — non-fatal */ }

  const digest = buildDigest({
    bizName: name,
    label:   window.label,
    tickets: tickets || [],
    overrides,
    cuadreFlags,
    countVariances,
  })

  const subject = `Terminal X — Resumen ${window.label} · ${name}`

  // Delivery: WhatsApp (if configured on business) + email (if Resend + owner email).
  const waRes = await sendWhatsApp(settings, settings.whatsapp_owner_phone || business.phone, digest.text)
  const ownerEmail = settings.biz_email || business.email || null
  const emailRes = await sendEmail({ to: ownerEmail, subject, html: digest.html, text: digest.text })

  // Persist last_digest_sent + activity_log (always, even if all channels skipped —
  // an in-app notification feed can surface it).
  const nowIso = new Date().toISOString()
  await supabase.from('app_settings').upsert(
    { business_id: bid, key: 'last_digest_sent', value: nowIso, device_hwid: null, supabase_id: crypto.randomUUID() },
    { onConflict: 'business_id,key,device_hwid', ignoreDuplicates: false }
  )

  await supabase.from('activity_log').insert({
    supabase_id: crypto.randomUUID(),
    business_id: bid,
    event_type:  'daily_digest_sent',
    severity:    'info',
    target_type: 'business',
    target_id:   bid,
    target_name: name,
    metadata:    {
      window_from: window.fromIso,
      window_to:   window.toIso,
      stats: {
        revenue:  digest.stats.revenue,
        tickets:  digest.stats.count,
        avg:      digest.stats.avg,
        top3:     digest.stats.top3.map(p => ({ name: p.name, qty: p.qty, revenue: p.revenue })),
        overrides,
        cuadre_flags: cuadreFlags.length,
        count_variances: countVariances.length,
      },
      channels: {
        whatsapp: waRes.ok ? 'sent' : (waRes.skipped ? 'skipped' : `error:${waRes.error || 'unknown'}`),
        email:    emailRes.ok ? 'sent' : (emailRes.skipped ? 'skipped' : `error:${emailRes.error || 'unknown'}`),
      },
    },
  })

  return { bid, name, channels: { whatsapp: waRes, email: emailRes }, stats: digest.stats }
}

// ── Entry point ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Auth gate — Vercel Cron sends `authorization: Bearer <CRON_SECRET>` when set.
  // Allow unauthenticated GET only if CRON_SECRET is unset (dev).
  // Admin-triggered manual sends (business_id+force) authenticate via Supabase
  // JWT against admin_users — handled below.
  const cronSecret = process.env.CRON_SECRET
  const qBusinessId = req.query.business_id || req.body?.business_id || null
  const qForce = ['1', 'true', 'TRUE', true].includes(req.query.force ?? req.body?.force)
  const authHeader = req.headers.authorization || ''
  const isCronCall = cronSecret ? authHeader === `Bearer ${cronSecret}` : true

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  // Manual single-business trigger: require admin JWT (not CRON_SECRET).
  if (qBusinessId && qForce && !isCronCall) {
    const token = authHeader.replace('Bearer ', '')
    if (!token) return res.status(401).json({ error: 'unauthorized' })
    const { data: { user }, error: uErr } = await supabase.auth.getUser(token)
    if (uErr || !user) return res.status(401).json({ error: 'invalid_token' })
    const { data: admin } = await supabase.from('admin_users')
      .select('id,role,active').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
    if (!admin) return res.status(403).json({ error: 'not_admin' })
  } else if (cronSecret && !isCronCall) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const window = drYesterdayWindow()

  try {
    // Manual single-business mode: skip the enabled-check, process just this biz.
    if (qBusinessId && qForce) {
      const { data: biz, error: bErr } = await supabase
        .from('businesses')
        .select('id,name,phone,email,settings')
        .eq('id', qBusinessId)
        .maybeSingle()
      if (bErr) throw bErr
      if (!biz) return res.status(404).json({ ok: false, error: 'business_not_found' })
      try {
        const result = await runForBusiness(supabase, biz, window)
        return res.json({ ok: true, window, sent: 1, forced: true, results: [result] })
      } catch (e) {
        return res.status(500).json({ ok: false, error: e?.message || 'run_failed' })
      }
    }

    // Businesses with digest enabled. Join settings via app_settings row.
    const { data: enabledRows, error: enabledErr } = await supabase
      .from('app_settings')
      .select('business_id,value')
      .eq('key', 'daily_digest_enabled')
      .in('value', ['1', 'true', 'TRUE'])
    if (enabledErr) throw enabledErr

    const bizIds = [...new Set((enabledRows || []).map(r => r.business_id).filter(Boolean))]
    if (!bizIds.length) return res.json({ ok: true, window, sent: 0, note: 'no businesses enabled' })

    const { data: businesses, error: bizErr } = await supabase
      .from('businesses')
      .select('id,name,phone,email,settings')
      .in('id', bizIds)
    if (bizErr) throw bizErr

    const results = []
    for (const biz of (businesses || [])) {
      try {
        results.push(await runForBusiness(supabase, biz, window))
      } catch (e) {
        results.push({ bid: biz.id, name: biz.name, error: e?.message || 'run_failed' })
      }
    }

    return res.json({ ok: true, window, sent: results.length, results })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'digest_failed' })
  }
}
