/**
 * Shared Claude client — Layers 6-8 per-business features.
 *
 * One call gated by THREE things, in order:
 *   1. ANTHROPIC_API_KEY env var is set (else silent skip — feature degrades).
 *   2. The business has `claude_feature_flags.<feature> = true` (per-client toggle).
 *   3. The monthly budget hasn't been exhausted (bump_claude_usage RPC atomically
 *      reserves the cost; returns false if it would overflow the cap).
 *
 * Every call emits a `client_errors` row (severity='info', category=`claude.<feature>.call`)
 * with token + cost telemetry so admin can see exactly what was spent and why.
 *
 * Out of scope: this module never sees cross-tenant data. The caller is
 * responsible for scoping its prompt to a single business_id.
 *
 * Cost model: Haiku 4.5 priced at $1/MTok input, $5/MTok output as of 2026-05.
 * We deliberately reserve a conservative pre-estimate ($0.005/call typical) so
 * we never blow past the cap on a single oversized response; the RPC rolls
 * the monthly counter at month boundary.
 */
import { createClient } from '@supabase/supabase-js'

const MODEL = 'claude-haiku-4-5-20251001'

// Per-call reservation in USD. Empirically: 1024 max output + ~500 input tokens
// at Haiku 4.5 prices ≈ $0.0055. We reserve $0.01 to cover variance + retries.
const PER_CALL_RESERVE_USD = 0.01

const FEATURE_COLUMN_MAP = {
  dgii_translator: 'dgii_error_translator',
  cuadre_anomaly:  'cuadre_anomaly',
  insights_digest: 'insights_digest',
  reorder_suggestions: 'reorder_suggestions',
  faq_autoreply:   'faq_autoreply',
}

function _supa() {
  return createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
}

// Token-count → USD. Haiku 4.5 = $1/MTok in, $5/MTok out.
function _computeCostUsd(usage) {
  const inTok  = Number(usage?.input_tokens || 0)
  const outTok = Number(usage?.output_tokens || 0)
  return (inTok / 1_000_000) * 1.00 + (outTok / 1_000_000) * 5.00
}

async function _logCall(supabase, { businessId, feature, ok, costUsd, usage, skippedReason, errText }) {
  try {
    await supabase.from('client_errors').insert({
      severity:    'info',
      message:     ok ? `claude.${feature}.ok` : `claude.${feature}.skipped`,
      route:       '/__claude_client',
      business_id: businessId,
      metadata: {
        category: `claude.${feature}.call`,
        ok,
        cost_usd: Number(costUsd?.toFixed?.(6) || 0),
        tokens_in:  Number(usage?.input_tokens || 0),
        tokens_out: Number(usage?.output_tokens || 0),
        model: MODEL,
        skipped_reason: skippedReason || null,
        error: errText || null,
      },
    })
  } catch { /* never let telemetry crash the caller */ }
}

/**
 * Is a Claude feature enabled for this business?
 * Returns false on any lookup failure (fail-closed — keeps cost predictable).
 */
export async function isClaudeFeatureEnabled(businessId, feature) {
  if (!businessId || !feature) return false
  const col = FEATURE_COLUMN_MAP[feature]
  if (!col) return false
  try {
    const supabase = _supa()
    const { data } = await supabase
      .from('claude_feature_flags')
      .select(col)
      .eq('business_id', businessId)
      .maybeSingle()
    return Boolean(data?.[col])
  } catch {
    return false
  }
}

/**
 * Core call. Returns { ok, text, skipped_reason?, cost_usd, model }.
 * Never throws — failures degrade to { ok:false, skipped_reason }.
 */
export async function callClaudeForBusiness({
  businessId,
  feature,
  prompt,
  maxTokens = 1024,
  temperature = 0,
}) {
  const supabase = _supa()
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    await _logCall(supabase, { businessId, feature, ok: false, costUsd: 0, usage: {}, skippedReason: 'no_api_key' })
    return { ok: false, text: '', skipped_reason: 'no_api_key', cost_usd: 0, model: MODEL }
  }
  if (!businessId) {
    return { ok: false, text: '', skipped_reason: 'no_business_id', cost_usd: 0, model: MODEL }
  }
  const col = FEATURE_COLUMN_MAP[feature]
  if (!col) {
    return { ok: false, text: '', skipped_reason: 'unknown_feature', cost_usd: 0, model: MODEL }
  }

  // Toggle check.
  let row = null
  try {
    const { data } = await supabase
      .from('claude_feature_flags')
      .select(`${col}, monthly_budget_usd, spent_this_month_usd`)
      .eq('business_id', businessId)
      .maybeSingle()
    row = data
  } catch { row = null }
  if (!row || !row[col]) {
    await _logCall(supabase, { businessId, feature, ok: false, costUsd: 0, usage: {}, skippedReason: 'feature_off' })
    return { ok: false, text: '', skipped_reason: 'feature_off', cost_usd: 0, model: MODEL }
  }

  // Budget check — reserve via RPC. False = would exceed cap; do not call.
  try {
    const { data: ok } = await supabase.rpc('bump_claude_usage', {
      p_business_id: businessId,
      p_cost_usd:    PER_CALL_RESERVE_USD,
    })
    if (!ok) {
      await _logCall(supabase, { businessId, feature, ok: false, costUsd: 0, usage: {}, skippedReason: 'budget_exhausted' })
      return { ok: false, text: '', skipped_reason: 'budget_exhausted', cost_usd: 0, model: MODEL }
    }
  } catch (e) {
    await _logCall(supabase, { businessId, feature, ok: false, costUsd: 0, usage: {}, skippedReason: 'budget_rpc_failed', errText: String(e?.message || e) })
    return { ok: false, text: '', skipped_reason: 'budget_rpc_failed', cost_usd: 0, model: MODEL }
  }

  // Call Claude.
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!r.ok) {
      const errText = (await r.text().catch(() => '')).slice(0, 1000)
      await _logCall(supabase, { businessId, feature, ok: false, costUsd: PER_CALL_RESERVE_USD, usage: {}, skippedReason: `api_${r.status}`, errText })
      return { ok: false, text: '', skipped_reason: `api_${r.status}`, cost_usd: PER_CALL_RESERVE_USD, model: MODEL }
    }
    const json = await r.json()
    const text = (json?.content?.[0]?.text || '').trim()
    const usage = json?.usage || {}
    const actualCost = _computeCostUsd(usage)

    // True-up: if actual > reserve, charge the delta now so the counter is honest.
    const delta = actualCost - PER_CALL_RESERVE_USD
    if (delta > 0) {
      try { await supabase.rpc('bump_claude_usage', { p_business_id: businessId, p_cost_usd: delta }) } catch { /* counter best-effort */ }
    }

    await _logCall(supabase, { businessId, feature, ok: true, costUsd: actualCost, usage })
    return { ok: true, text, cost_usd: actualCost, model: MODEL, usage }
  } catch (e) {
    await _logCall(supabase, { businessId, feature, ok: false, costUsd: PER_CALL_RESERVE_USD, usage: {}, skippedReason: 'transport_failed', errText: String(e?.message || e) })
    return { ok: false, text: '', skipped_reason: 'transport_failed', cost_usd: PER_CALL_RESERVE_USD, model: MODEL }
  }
}

/**
 * Helper to send a Claude alert to the business owner via UltraMsg. Falls
 * back to a claude_alerts_pending row when UltraMsg credentials are missing
 * or delivery fails — admin can manually drain those later.
 */
export async function deliverClaudeAlert({ businessId, feature, severity, message }) {
  if (!businessId || !message) return { ok: false, reason: 'invalid_args' }
  const supabase = _supa()
  let phone = null
  let instance = null
  let tokenSecret = null
  try {
    const { data: biz } = await supabase
      .from('businesses')
      .select('phone, settings')
      .eq('id', businessId)
      .maybeSingle()
    const settings = (biz?.settings && typeof biz.settings === 'object') ? biz.settings : {}
    phone = settings.whatsapp_owner_phone || biz?.phone || null
    instance = settings.whatsapp_instance || null
    tokenSecret = settings.whatsapp_token || null
  } catch { /* ignore */ }

  const enqueue = async (failed_reason) => {
    try {
      await supabase.from('claude_alerts_pending').insert({
        business_id: businessId,
        feature,
        severity,
        message,
        to_phone: phone,
        failed_reason,
      })
    } catch { /* nowhere left to escalate */ }
  }

  if (!instance || !tokenSecret || !phone) {
    await enqueue('no_whatsapp_credentials_or_phone')
    return { ok: false, reason: 'no_whatsapp_credentials_or_phone' }
  }

  try {
    const r = await fetch(`https://api.ultramsg.com/${encodeURIComponent(instance)}/messages/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(tokenSecret)}&to=${encodeURIComponent(phone)}&body=${encodeURIComponent(message)}`,
    })
    if (!r.ok) {
      const errText = (await r.text().catch(() => '')).slice(0, 200)
      await enqueue(`ultramsg_${r.status}_${errText}`)
      return { ok: false, reason: `ultramsg_${r.status}` }
    }
    return { ok: true }
  } catch (e) {
    await enqueue(`transport_${String(e?.message || e).slice(0, 200)}`)
    return { ok: false, reason: 'transport_failed' }
  }
}
