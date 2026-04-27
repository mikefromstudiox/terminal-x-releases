// Terminal X — Contabilidad web data layer (Supabase).
//
// Phase 1 surface — same API shape the desktop IPC will expose under
// `window.electronAPI.contabilidad.*` once Phase 1B ships in electron/.
//
// Every INSERT sets `supabase_id = crypto.randomUUID()` so desktop pulls see
// the row. RLS on every table is scoped by business_id (owner = firm tenant).
//
// All read paths swallow errors and return [] / null (tryOr semantics) so the
// Contabilidad shell never explodes when the network blips. All write paths
// throw (tryWrite semantics) so the UI surfaces a useful error toast.

const TBL = {
  clients:           'accounting_clients',
  inbox:             'accounting_inbox',
  obligations:       'accounting_obligations_calendar',
  documents:         'accounting_documents',
  billingPlans:      'accounting_billing_plans',
  billingInvoices:   'accounting_billing_invoices',
  csvMappings:       'accounting_csv_mappings',
  // Phase 2 Slice 1
  coa:               'accounting_chart_of_accounts',
  journalEntries:    'accounting_journal_entries',
  journalLines:      'accounting_journal_lines',
  autoPostRules:     'accounting_coa_auto_post_rules',
  bankAccounts:      'accounting_bank_accounts',
  bankStatementLines:'accounting_bank_statement_lines',
  fixedAssets:       'accounting_fixed_assets',
  retentionsEmit:    'accounting_retentions_emitidas',
  retentionsRecv:    'accounting_retentions_recibidas',
  payrollPeriods:    'accounting_payroll_periods',
  payrollLines:      'accounting_payroll_lines',
  tssFilings:        'accounting_tss_filings',
  tasks:             'accounting_tasks',
  foreignPayments:   'accounting_foreign_payments',
}

// Dual-key filter: when caller passes both an integer FK and a UUID companion,
// match on EITHER so web-created (UUID-only) and desktop-synced (int+UUID) rows
// resolve. Pass to `q.or(_dualKey('accounting_client_id', id, sid))`.
function _dualKey(intCol, intVal, sidCol, sidVal) {
  if (intVal != null && sidVal) return `${intCol}.eq.${intVal},${sidCol}.eq.${sidVal}`
  if (intVal != null)           return `${intCol}.eq.${intVal}`
  if (sidVal)                   return `${sidCol}.eq.${sidVal}`
  return null
}

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // RFC4122 v4 fallback — deterministic shape, non-crypto random ok here as
  // a last resort (browser without webcrypto, e.g. very old Safari).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

function nowIso() { return new Date().toISOString() }

async function tryOr(fn, fallback) {
  try { return await fn() } catch { return fallback }
}
async function tryWrite(fn) {
  const r = await fn()
  if (r?.error) throw r.error
  return r?.data ?? null
}

export function createContabilidadAPI(supabase, businessId) {
  const bid = () => businessId

  // Resolve a parent table's supabase_id by integer id. Used to populate the
  // `*_supabase_id` companion FK columns on every child INSERT (Phase 2 hardening).
  // Returns null on miss so callers can still insert with int FK only.
  async function _resolveSid(table, id) {
    if (!id) return null
    try {
      const { data } = await supabase.from(table).select('supabase_id').eq('id', id).eq('business_id', bid()).maybeSingle()
      return data?.supabase_id || null
    } catch { return null }
  }
  const _resolveClientSid          = (id) => _resolveSid(TBL.clients, id)
  const _resolveJournalEntrySid    = (id) => _resolveSid(TBL.journalEntries, id)
  const _resolveAccountSid         = (id) => _resolveSid(TBL.coa, id)
  const _resolveBankAccountSid     = (id) => _resolveSid(TBL.bankAccounts, id)
  const _resolvePayrollPeriodSid   = (id) => _resolveSid(TBL.payrollPeriods, id)

  // ── Clients (cartera) ────────────────────────────────────────────────────
  async function clientList() {
    return tryOr(async () => {
      const { data, error } = await supabase.from(TBL.clients)
        .select('*').eq('business_id', bid())
        .order('nombre_comercial', { ascending: true })
      if (error) throw error
      return data || []
    }, [])
  }
  async function clientCreate(input) {
    return tryWrite(() => supabase.from(TBL.clients).insert({
      supabase_id: uuid(),
      business_id: bid(),
      nombre_comercial: input?.nombre_comercial || '',
      rnc: input?.rnc || null,
      cedula: input?.cedula || null,
      tipo_persona: input?.tipo_persona || 'pj',
      regimen: input?.regimen || 'ordinario',
      fecha_cierre_mes: input?.fecha_cierre_mes ?? null,
      fecha_cierre_dia: input?.fecha_cierre_dia ?? null,
      honorarios_mensuales: input?.honorarios_mensuales ?? 0,
      currency: input?.currency || 'DOP',
      assigned_to_user_id: input?.assigned_to_user_id ?? null,
      status: input?.status || 'active',
      notes: input?.notes || null,
      client_business_supabase_id: input?.client_business_supabase_id ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    }).select('*').single())
  }
  async function clientUpdate(id, patch) {
    return tryWrite(() => supabase.from(TBL.clients)
      .update({ ...patch, updated_at: nowIso() })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }
  async function clientDelete(id) {
    return tryWrite(() => supabase.from(TBL.clients)
      .update({ status: 'archived', updated_at: nowIso() })
      .eq('id', id).eq('business_id', bid()))
  }

  // ── Inbox ────────────────────────────────────────────────────────────────
  async function inboxList({ status } = {}) {
    return tryOr(async () => {
      let q = supabase.from(TBL.inbox).select('*').eq('business_id', bid())
        .order('created_at', { ascending: false }).limit(500)
      if (status) q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw error
      return data || []
    }, [])
  }
  async function inboxAdd(input) {
    const cliSid = input?.accounting_client_supabase_id || await _resolveClientSid(input?.accounting_client_id)
    return tryWrite(() => supabase.from(TBL.inbox).insert({
      supabase_id: uuid(),
      business_id: bid(),
      accounting_client_id: input?.accounting_client_id ?? null,
      accounting_client_supabase_id: cliSid,
      source: input?.source || 'dropzone',
      original_filename: input?.original_filename || 'sin-nombre',
      mime: input?.mime || 'application/octet-stream',
      size: input?.size ?? 0,
      r2_key: input?.r2_key || null,
      ocr_status: input?.ocr_status || 'pending',
      ocr_text: input?.ocr_text || '',
      classified_type: input?.classified_type || 'otro',
      classification_confidence: input?.classification_confidence ?? 0,
      status: input?.status || 'unclassified',
      notes: input?.notes || null,
      created_at: nowIso(),
      updated_at: nowIso(),
    }).select('*').single())
  }
  async function inboxClassify(id, patch) {
    return tryWrite(() => supabase.from(TBL.inbox)
      .update({
        classified_type: patch?.classified_type ?? undefined,
        accounting_client_id: patch?.accounting_client_id ?? undefined,
        status: patch?.status || 'classified',
        notes: patch?.notes ?? undefined,
        updated_at: nowIso(),
      })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }
  async function inboxPost(id, journalEntryId = null) {
    return tryWrite(() => supabase.from(TBL.inbox)
      .update({ status: 'posted', posted_journal_entry_id: journalEntryId, posted_at: nowIso(), updated_at: nowIso() })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }

  // ── Obligations / calendar ────────────────────────────────────────────────
  async function obligationsList({ accountingClientId, accountingClientSupabaseId, dateFrom, dateTo } = {}) {
    return tryOr(async () => {
      let q = supabase.from(TBL.obligations).select('*').eq('business_id', bid())
        .order('due_date', { ascending: true })
      const dk = _dualKey('accounting_client_id', accountingClientId, 'accounting_client_supabase_id', accountingClientSupabaseId)
      if (dk) q = q.or(dk)
      if (dateFrom) q = q.gte('due_date', dateFrom)
      if (dateTo)   q = q.lte('due_date', dateTo)
      const { data, error } = await q
      if (error) throw error
      return data || []
    }, [])
  }
  async function obligationsMarkFiled(id, payload) {
    return tryWrite(() => supabase.from(TBL.obligations)
      .update({
        status: payload?.status || 'radicado',
        filed_at: nowIso(),
        filed_by_user_id: payload?.filed_by_user_id ?? null,
        dgii_constancia_no: payload?.dgii_constancia_no || null,
        attachment_supabase_id: payload?.attachment_supabase_id || null,
        notes: payload?.notes ?? undefined,
        updated_at: nowIso(),
      })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }
  // Bulk seed 12 months × applicable templates for one client/year. Idempotent
  // via the (business_id, accounting_client_id, form_type, period_year, period_month)
  // unique constraint — re-running is safe.
  async function obligationsGenerateYear({ accountingClientId, accountingClientSupabaseId, year, templates }) {
    if (!accountingClientId || !year || !Array.isArray(templates) || !templates.length) return { inserted: 0 }
    const cliSid = accountingClientSupabaseId || await _resolveClientSid(accountingClientId)
    const rows = []
    for (const t of templates) {
      if (t.periodicity === 'annual') {
        rows.push({
          supabase_id: uuid(),
          business_id: bid(),
          accounting_client_id: accountingClientId,
          accounting_client_supabase_id: cliSid,
          form_type: t.form_type,
          period_year: year,
          period_month: 0,
          due_date: `${year}-${String(t.due_month || 4).padStart(2,'0')}-${String(Math.min(28, t.due_day_of_month || 30)).padStart(2,'0')}`,
          status: 'pendiente',
          created_at: nowIso(),
          updated_at: nowIso(),
        })
      } else {
        for (let m = 1; m <= 12; m++) {
          let dueY = year, dueM = m + 1
          if (dueM > 12) { dueM = 1; dueY = year + 1 }
          rows.push({
            supabase_id: uuid(),
            business_id: bid(),
            accounting_client_id: accountingClientId,
            accounting_client_supabase_id: cliSid,
            form_type: t.form_type,
            period_year: year,
            period_month: m,
            due_date: `${dueY}-${String(dueM).padStart(2,'0')}-${String(Math.min(28, t.due_day_of_month || 15)).padStart(2,'0')}`,
            status: 'pendiente',
            created_at: nowIso(),
            updated_at: nowIso(),
          })
        }
      }
    }
    const { data, error } = await supabase.from(TBL.obligations)
      .upsert(rows, { onConflict: 'business_id,accounting_client_id,form_type,period_year,period_month', ignoreDuplicates: true })
      .select('id')
    if (error) throw error
    return { inserted: data?.length || 0 }
  }

  // ── Documents (vault) ────────────────────────────────────────────────────
  async function documentList({ accountingClientId, accountingClientSupabaseId } = {}) {
    return tryOr(async () => {
      let q = supabase.from(TBL.documents).select('*').eq('business_id', bid())
        .order('created_at', { ascending: false }).limit(500)
      const dk = _dualKey('accounting_client_id', accountingClientId, 'accounting_client_supabase_id', accountingClientSupabaseId)
      if (dk) q = q.or(dk)
      const { data, error } = await q
      if (error) throw error
      return data || []
    }, [])
  }
  async function documentAdd(input) {
    const cliSid = input?.accounting_client_supabase_id || await _resolveClientSid(input?.accounting_client_id)
    return tryWrite(() => supabase.from(TBL.documents).insert({
      supabase_id: uuid(),
      business_id: bid(),
      accounting_client_id: input?.accounting_client_id ?? null,
      accounting_client_supabase_id: cliSid,
      category: input?.category || 'otro',
      period_year: input?.period_year ?? null,
      period_month: input?.period_month ?? null,
      filename: input?.filename || 'sin-nombre',
      r2_key: input?.r2_key || null,
      mime: input?.mime || 'application/octet-stream',
      size: input?.size ?? 0,
      uploaded_by_user_id: input?.uploaded_by_user_id ?? null,
      expires_at: input?.expires_at ?? null,
      tags: JSON.stringify(input?.tags || []),
      notes: input?.notes || null,
      created_at: nowIso(),
      updated_at: nowIso(),
    }).select('*').single())
  }
  async function documentDelete(id) {
    return tryWrite(() => supabase.from(TBL.documents)
      .delete().eq('id', id).eq('business_id', bid()))
  }

  // ── Billing plans + invoices (honorarios) ─────────────────────────────────
  async function billingPlanList() {
    return tryOr(async () => {
      const { data, error } = await supabase.from(TBL.billingPlans)
        .select('*').eq('business_id', bid()).order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    }, [])
  }
  async function billingPlanCreate(input) {
    const cliSid = input?.accounting_client_supabase_id || await _resolveClientSid(input?.accounting_client_id)
    return tryWrite(() => supabase.from(TBL.billingPlans).insert({
      supabase_id: uuid(),
      business_id: bid(),
      accounting_client_id: input?.accounting_client_id ?? null,
      accounting_client_supabase_id: cliSid,
      monthly_amount: input?.monthly_amount ?? 0,
      currency: input?.currency || 'DOP',
      bill_day: input?.bill_day ?? 1,
      ecf_type: input?.ecf_type || 'e32',
      late_fee_pct: input?.late_fee_pct ?? 0,
      late_fee_after_days: input?.late_fee_after_days ?? 0,
      active: input?.active === false ? 0 : 1,
      notes: input?.notes || null,
      created_at: nowIso(),
      updated_at: nowIso(),
    }).select('*').single())
  }
  async function billingPlanUpdate(id, patch) {
    return tryWrite(() => supabase.from(TBL.billingPlans)
      .update({ ...patch, updated_at: nowIso() })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }
  async function billingInvoiceList({ accountingClientId, accountingClientSupabaseId, status } = {}) {
    return tryOr(async () => {
      let q = supabase.from(TBL.billingInvoices).select('*').eq('business_id', bid())
        .order('period_year', { ascending: false })
        .order('period_month', { ascending: false })
      const dk = _dualKey('accounting_client_id', accountingClientId, 'accounting_client_supabase_id', accountingClientSupabaseId)
      if (dk) q = q.or(dk)
      if (status) q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw error
      return data || []
    }, [])
  }
  async function billingInvoiceCreate(input) {
    const cliSid = input?.accounting_client_supabase_id || await _resolveClientSid(input?.accounting_client_id)
    return tryWrite(() => supabase.from(TBL.billingInvoices).insert({
      supabase_id: uuid(),
      business_id: bid(),
      accounting_client_id: input?.accounting_client_id ?? null,
      accounting_client_supabase_id: cliSid,
      ticket_supabase_id: input?.ticket_supabase_id || null,
      period_year: input?.period_year,
      period_month: input?.period_month,
      amount: input?.amount ?? 0,
      currency: input?.currency || 'DOP',
      status: input?.status || 'draft',
      ecf_track_id: input?.ecf_track_id || null,
      ecf_status: input?.ecf_status || null,
      paid_at: input?.paid_at || null,
      created_at: nowIso(),
      updated_at: nowIso(),
    }).select('*').single())
  }
  async function billingInvoiceMarkPaid(id) {
    return tryWrite(() => supabase.from(TBL.billingInvoices)
      .update({ status: 'paid', paid_at: nowIso(), updated_at: nowIso() })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }

  // ── Phase 2 Slice 1 — Chart of accounts ──────────────────────────────────
  async function coaList({ accountingClientId, accountingClientSupabaseId, type } = {}) {
    return tryOr(async () => {
      let q = supabase.from(TBL.coa).select('*').eq('business_id', bid()).order('code', { ascending: true })
      const dk = _dualKey('accounting_client_id', accountingClientId, 'accounting_client_supabase_id', accountingClientSupabaseId)
      if (dk) q = q.or(dk)
      if (type) q = q.eq('type', type)
      const { data, error } = await q
      if (error) throw error
      return data || []
    }, [])
  }
  async function coaCreate(input) {
    const cliSid    = input?.accounting_client_supabase_id || await _resolveClientSid(input?.accounting_client_id)
    const parentSid = input?.parent_supabase_id || (input?.parent_id ? await _resolveSid(TBL.coa, input.parent_id) : null)
    return tryWrite(() => supabase.from(TBL.coa).insert({
      supabase_id: uuid(),
      business_id: bid(),
      accounting_client_id: input?.accounting_client_id ?? null,
      accounting_client_supabase_id: cliSid,
      code: input?.code,
      parent_id: input?.parent_id ?? null,
      parent_supabase_id: parentSid,
      name: input?.name || '',
      type: input?.type || 'activo',
      is_postable: input?.is_postable === false ? 0 : 1,
      currency: input?.currency || 'DOP',
      notes: input?.notes || null,
      created_at: nowIso(), updated_at: nowIso(),
    }).select('*').single())
  }
  async function coaUpdate(id, patch) {
    return tryWrite(() => supabase.from(TBL.coa).update({ ...patch, updated_at: nowIso() })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }
  async function coaGet(id) {
    return tryOr(async () => {
      const { data, error } = await supabase.from(TBL.coa).select('*').eq('id', id).eq('business_id', bid()).maybeSingle()
      if (error) throw error
      return data
    }, null)
  }
  async function coaDelete(id) {
    return tryWrite(() => supabase.from(TBL.coa).delete().eq('id', id).eq('business_id', bid()))
  }

  // ── Journal entries + lines ──────────────────────────────────────────────
  async function journalEntryList({ accountingClientId, accountingClientSupabaseId, periodYear, periodMonth, status } = {}) {
    return tryOr(async () => {
      let q = supabase.from(TBL.journalEntries).select('*').eq('business_id', bid())
        .order('fecha', { ascending: false }).order('id', { ascending: false }).limit(1000)
      const dk = _dualKey('accounting_client_id', accountingClientId, 'accounting_client_supabase_id', accountingClientSupabaseId)
      if (dk) q = q.or(dk)
      if (periodYear  != null) q = q.eq('period_year',  periodYear)
      if (periodMonth != null) q = q.eq('period_month', periodMonth)
      if (status) q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw error
      return data || []
    }, [])
  }
  async function journalEntryCreate(input) {
    const cliSid = input?.accounting_client_supabase_id || await _resolveClientSid(input?.accounting_client_id)
    return tryWrite(() => supabase.from(TBL.journalEntries).insert({
      supabase_id: uuid(),
      business_id: bid(),
      accounting_client_id: input?.accounting_client_id ?? null,
      accounting_client_supabase_id: cliSid,
      fecha: input?.fecha || null,
      description: input?.description || null,
      type: input?.type || 'manual',
      reference_doc_supabase_id: input?.reference_doc_supabase_id || null,
      status: input?.status || 'draft',
      posted_by_user_id: input?.posted_by_user_id ?? null,
      period_year: input?.period_year ?? null,
      period_month: input?.period_month ?? null,
      totals_debit: input?.totals_debit ?? 0,
      totals_credit: input?.totals_credit ?? 0,
      created_at: nowIso(), updated_at: nowIso(),
    }).select('*').single())
  }
  async function journalEntryUpdate(id, patch) {
    return tryWrite(() => supabase.from(TBL.journalEntries).update({ ...patch, updated_at: nowIso() })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }
  async function journalEntryGet(id) {
    return tryOr(async () => {
      const { data: entry, error: e1 } = await supabase.from(TBL.journalEntries).select('*').eq('id', id).eq('business_id', bid()).maybeSingle()
      if (e1) throw e1
      if (!entry) return null
      const dk = _dualKey('journal_entry_id', entry.id, 'journal_entry_supabase_id', entry.supabase_id)
      let lq = supabase.from(TBL.journalLines).select('*').eq('business_id', bid()).order('id', { ascending: true })
      if (dk) lq = lq.or(dk)
      const { data: lines, error: e2 } = await lq
      if (e2) throw e2
      entry.lines = lines || []
      return entry
    }, null)
  }
  async function journalEntryDelete(id) {
    // FK delete cascade lives in PG via ON DELETE; we issue both for safety.
    await supabase.from(TBL.journalLines).delete().eq('journal_entry_id', id).eq('business_id', bid())
    return tryWrite(() => supabase.from(TBL.journalEntries).delete().eq('id', id).eq('business_id', bid()))
  }
  async function journalLineList({ journalEntryId, journalEntrySupabaseId, accountId } = {}) {
    return tryOr(async () => {
      let q = supabase.from(TBL.journalLines).select('*').eq('business_id', bid()).order('id', { ascending: true })
      const dk = _dualKey('journal_entry_id', journalEntryId, 'journal_entry_supabase_id', journalEntrySupabaseId)
      if (dk) q = q.or(dk)
      if (accountId) q = q.eq('account_id', accountId)
      const { data, error } = await q
      if (error) throw error
      return data || []
    }, [])
  }
  async function journalLineAdd(input) {
    const entrySid = input?.journal_entry_supabase_id || await _resolveJournalEntrySid(input?.journal_entry_id)
    const acctSid  = input?.account_supabase_id       || await _resolveAccountSid(input?.account_id)
    return tryWrite(() => supabase.from(TBL.journalLines).insert({
      supabase_id: uuid(),
      business_id: bid(),
      journal_entry_id: input?.journal_entry_id ?? null,
      journal_entry_supabase_id: entrySid,
      account_id: input?.account_id ?? null,
      account_supabase_id: acctSid,
      debit: input?.debit ?? 0,
      credit: input?.credit ?? 0,
      currency: input?.currency || 'DOP',
      exchange_rate: input?.exchange_rate ?? 1,
      memo: input?.memo || null,
      created_at: nowIso(), updated_at: nowIso(),
    }).select('*').single())
  }
  async function journalLineDelete(id) {
    return tryWrite(() => supabase.from(TBL.journalLines).delete().eq('id', id).eq('business_id', bid()))
  }

  // ── Auto-post rules ───────────────────────────────────────────────────────
  async function autoPostRuleList({ accountingClientId, accountingClientSupabaseId, event } = {}) {
    return tryOr(async () => {
      let q = supabase.from(TBL.autoPostRules).select('*').eq('business_id', bid())
        .order('priority', { ascending: true }).order('id', { ascending: true })
      const dk = _dualKey('accounting_client_id', accountingClientId, 'accounting_client_supabase_id', accountingClientSupabaseId)
      if (dk) q = q.or(dk)
      if (event) q = q.eq('event', event)
      const { data, error } = await q
      if (error) throw error
      return data || []
    }, [])
  }
  async function autoPostRuleCreate(input) {
    const cliSid    = input?.accounting_client_supabase_id || await _resolveClientSid(input?.accounting_client_id)
    const debitSid  = input?.debit_account_supabase_id  || await _resolveAccountSid(input?.debit_account_id)
    const creditSid = input?.credit_account_supabase_id || await _resolveAccountSid(input?.credit_account_id)
    return tryWrite(() => supabase.from(TBL.autoPostRules).insert({
      supabase_id: uuid(),
      business_id: bid(),
      accounting_client_id: input?.accounting_client_id ?? null,
      accounting_client_supabase_id: cliSid,
      event: input?.event,
      condition_json: typeof input?.condition_json === 'string' ? input.condition_json : (input?.condition_json ? JSON.stringify(input.condition_json) : null),
      debit_account_id: input?.debit_account_id ?? null,
      debit_account_supabase_id: debitSid,
      credit_account_id: input?.credit_account_id ?? null,
      credit_account_supabase_id: creditSid,
      priority: input?.priority ?? 100,
      active: input?.active === false ? 0 : 1,
      created_at: nowIso(), updated_at: nowIso(),
    }).select('*').single())
  }
  async function autoPostRuleUpdate(id, patch) {
    return tryWrite(() => supabase.from(TBL.autoPostRules).update({ ...patch, updated_at: nowIso() })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }
  async function autoPostRuleDelete(id) {
    return tryWrite(() => supabase.from(TBL.autoPostRules).delete().eq('id', id).eq('business_id', bid()))
  }

  // ── Bank accounts + statement lines ──────────────────────────────────────
  async function bankAccountList({ accountingClientId, accountingClientSupabaseId } = {}) {
    return tryOr(async () => {
      let q = supabase.from(TBL.bankAccounts).select('*').eq('business_id', bid()).order('banco', { ascending: true })
      const dk = _dualKey('accounting_client_id', accountingClientId, 'accounting_client_supabase_id', accountingClientSupabaseId)
      if (dk) q = q.or(dk)
      const { data, error } = await q
      if (error) throw error
      return data || []
    }, [])
  }
  async function bankAccountCreate(input) {
    const cliSid = input?.accounting_client_supabase_id || await _resolveClientSid(input?.accounting_client_id)
    return tryWrite(() => supabase.from(TBL.bankAccounts).insert({
      supabase_id: uuid(),
      business_id: bid(),
      accounting_client_id: input?.accounting_client_id ?? null,
      accounting_client_supabase_id: cliSid,
      banco: input?.banco || 'otro',
      account_no_last4: input?.account_no_last4 || null,
      account_type: input?.account_type || 'checking',
      currency: input?.currency || 'DOP',
      opening_balance: input?.opening_balance ?? 0,
      active: input?.active === false ? 0 : 1,
      created_at: nowIso(), updated_at: nowIso(),
    }).select('*').single())
  }
  async function bankAccountUpdate(id, patch) {
    return tryWrite(() => supabase.from(TBL.bankAccounts).update({ ...patch, updated_at: nowIso() })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }
  async function bankAccountDelete(id) {
    return tryWrite(() => supabase.from(TBL.bankAccounts).delete().eq('id', id).eq('business_id', bid()))
  }
  async function bankStatementLineList({ bankAccountId, bankAccountSupabaseId, matchStatus } = {}) {
    return tryOr(async () => {
      let q = supabase.from(TBL.bankStatementLines).select('*').eq('business_id', bid())
        .order('fecha', { ascending: true }).limit(5000)
      const dk = _dualKey('bank_account_id', bankAccountId, 'bank_account_supabase_id', bankAccountSupabaseId)
      if (dk) q = q.or(dk)
      if (matchStatus) q = q.eq('match_status', matchStatus)
      const { data, error } = await q
      if (error) throw error
      return data || []
    }, [])
  }
  async function bankStatementLineAdd(input) {
    const baSid = input?.bank_account_supabase_id || await _resolveBankAccountSid(input?.bank_account_id)
    return tryWrite(() => supabase.from(TBL.bankStatementLines).insert({
      supabase_id: uuid(),
      business_id: bid(),
      bank_account_id: input?.bank_account_id ?? null,
      bank_account_supabase_id: baSid,
      fecha: input?.fecha || null,
      descripcion: input?.descripcion || null,
      referencia: input?.referencia || null,
      debit: input?.debit ?? 0,
      credit: input?.credit ?? 0,
      balance: input?.balance ?? null,
      matched_journal_line_id: input?.matched_journal_line_id ?? null,
      matched_journal_line_supabase_id: input?.matched_journal_line_supabase_id || null,
      match_status: input?.match_status || 'unmatched',
      raw_row: typeof input?.raw_row === 'string' ? input.raw_row : (input?.raw_row ? JSON.stringify(input.raw_row) : null),
      created_at: nowIso(), updated_at: nowIso(),
    }).select('*').single())
  }
  async function bankStatementLineUpdate(id, patch) {
    return tryWrite(() => supabase.from(TBL.bankStatementLines).update({ ...patch, updated_at: nowIso() })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }
  async function bankStatementLineDelete(id) {
    return tryWrite(() => supabase.from(TBL.bankStatementLines).delete().eq('id', id).eq('business_id', bid()))
  }

  // ── Fixed assets ─────────────────────────────────────────────────────────
  async function fixedAssetList({ accountingClientId, accountingClientSupabaseId, status } = {}) {
    return tryOr(async () => {
      let q = supabase.from(TBL.fixedAssets).select('*').eq('business_id', bid())
        .order('fecha_adquisicion', { ascending: false })
      const dk = _dualKey('accounting_client_id', accountingClientId, 'accounting_client_supabase_id', accountingClientSupabaseId)
      if (dk) q = q.or(dk)
      if (status) q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw error
      return data || []
    }, [])
  }
  async function fixedAssetCreate(input) {
    const cliSid = input?.accounting_client_supabase_id || await _resolveClientSid(input?.accounting_client_id)
    return tryWrite(() => supabase.from(TBL.fixedAssets).insert({
      supabase_id: uuid(),
      business_id: bid(),
      accounting_client_id: input?.accounting_client_id ?? null,
      accounting_client_supabase_id: cliSid,
      name: input?.name || '',
      categoria: input?.categoria || 'cat_2',
      fecha_adquisicion: input?.fecha_adquisicion || null,
      costo: input?.costo ?? 0,
      vida_util_meses: input?.vida_util_meses ?? 0,
      valor_residual: input?.valor_residual ?? 0,
      depreciacion_acumulada: input?.depreciacion_acumulada ?? 0,
      status: input?.status || 'active',
      sold_at: input?.sold_at || null,
      sold_amount: input?.sold_amount ?? null,
      notes: input?.notes || null,
      created_at: nowIso(), updated_at: nowIso(),
    }).select('*').single())
  }
  async function fixedAssetUpdate(id, patch) {
    return tryWrite(() => supabase.from(TBL.fixedAssets).update({ ...patch, updated_at: nowIso() })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }
  async function fixedAssetDelete(id) {
    return tryWrite(() => supabase.from(TBL.fixedAssets).delete().eq('id', id).eq('business_id', bid()))
  }

  // ── Retentions emitidas/recibidas ────────────────────────────────────────
  function _retList(table) {
    return async ({ accountingClientId, accountingClientSupabaseId, dateFrom, dateTo } = {}) => {
      return tryOr(async () => {
        let q = supabase.from(table).select('*').eq('business_id', bid()).order('fecha', { ascending: false })
        const dk = _dualKey('accounting_client_id', accountingClientId, 'accounting_client_supabase_id', accountingClientSupabaseId)
        if (dk) q = q.or(dk)
        if (dateFrom) q = q.gte('fecha', dateFrom)
        if (dateTo)   q = q.lte('fecha', dateTo)
        const { data, error } = await q
        if (error) throw error
        return data || []
      }, [])
    }
  }
  const retentionEmitidaList  = _retList(TBL.retentionsEmit)
  const retentionRecibidaList = _retList(TBL.retentionsRecv)
  async function retentionEmitidaCreate(input) {
    const cliSid = input?.accounting_client_supabase_id || await _resolveClientSid(input?.accounting_client_id)
    return tryWrite(() => supabase.from(TBL.retentionsEmit).insert({
      supabase_id: uuid(), business_id: bid(),
      accounting_client_id: input?.accounting_client_id ?? null,
      accounting_client_supabase_id: cliSid,
      fecha: input?.fecha || null,
      beneficiario_rnc: input?.beneficiario_rnc || null,
      beneficiario_nombre: input?.beneficiario_nombre || null,
      tipo: input?.tipo || 'servicios_no_dom',
      base: input?.base ?? 0,
      tasa: input?.tasa ?? 0,
      retencion: input?.retencion ?? 0,
      ncf_emitido: input?.ncf_emitido || null,
      comprobante_url: input?.comprobante_url || null,
      created_at: nowIso(), updated_at: nowIso(),
    }).select('*').single())
  }
  async function retentionEmitidaUpdate(id, patch) {
    return tryWrite(() => supabase.from(TBL.retentionsEmit).update({ ...patch, updated_at: nowIso() })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }
  async function retentionEmitidaDelete(id) {
    return tryWrite(() => supabase.from(TBL.retentionsEmit).delete().eq('id', id).eq('business_id', bid()))
  }
  async function retentionRecibidaCreate(input) {
    const cliSid = input?.accounting_client_supabase_id || await _resolveClientSid(input?.accounting_client_id)
    return tryWrite(() => supabase.from(TBL.retentionsRecv).insert({
      supabase_id: uuid(), business_id: bid(),
      accounting_client_id: input?.accounting_client_id ?? null,
      accounting_client_supabase_id: cliSid,
      fecha: input?.fecha || null,
      retenedor_rnc: input?.retenedor_rnc || null,
      retenedor_nombre: input?.retenedor_nombre || null,
      tipo: input?.tipo || null,
      base: input?.base ?? 0,
      tasa: input?.tasa ?? 0,
      retencion: input?.retencion ?? 0,
      comprobante_url: input?.comprobante_url || null,
      created_at: nowIso(), updated_at: nowIso(),
    }).select('*').single())
  }
  async function retentionRecibidaUpdate(id, patch) {
    return tryWrite(() => supabase.from(TBL.retentionsRecv).update({ ...patch, updated_at: nowIso() })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }
  async function retentionRecibidaDelete(id) {
    return tryWrite(() => supabase.from(TBL.retentionsRecv).delete().eq('id', id).eq('business_id', bid()))
  }

  // ── Payroll periods + lines ──────────────────────────────────────────────
  async function payrollPeriodList({ accountingClientId, accountingClientSupabaseId, year, status } = {}) {
    return tryOr(async () => {
      let q = supabase.from(TBL.payrollPeriods).select('*').eq('business_id', bid())
        .order('year', { ascending: false }).order('month', { ascending: false })
      const dk = _dualKey('accounting_client_id', accountingClientId, 'accounting_client_supabase_id', accountingClientSupabaseId)
      if (dk) q = q.or(dk)
      if (year != null) q = q.eq('year', year)
      if (status) q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw error
      return data || []
    }, [])
  }
  async function payrollPeriodCreate(input) {
    const cliSid = input?.accounting_client_supabase_id || await _resolveClientSid(input?.accounting_client_id)
    return tryWrite(() => supabase.from(TBL.payrollPeriods).insert({
      supabase_id: uuid(), business_id: bid(),
      accounting_client_id: input?.accounting_client_id ?? null,
      accounting_client_supabase_id: cliSid,
      year: input?.year, month: input?.month,
      status: input?.status || 'draft',
      totals_json: typeof input?.totals_json === 'string' ? input.totals_json : (input?.totals_json ? JSON.stringify(input.totals_json) : null),
      created_at: nowIso(), updated_at: nowIso(),
    }).select('*').single())
  }
  async function payrollPeriodUpdate(id, patch) {
    return tryWrite(() => supabase.from(TBL.payrollPeriods).update({ ...patch, updated_at: nowIso() })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }
  async function payrollPeriodGet(id) {
    return tryOr(async () => {
      const { data: period, error: e1 } = await supabase.from(TBL.payrollPeriods).select('*').eq('id', id).eq('business_id', bid()).maybeSingle()
      if (e1) throw e1
      if (!period) return null
      const dk = _dualKey('payroll_period_id', period.id, 'payroll_period_supabase_id', period.supabase_id)
      let lq = supabase.from(TBL.payrollLines).select('*').eq('business_id', bid()).order('id', { ascending: true })
      if (dk) lq = lq.or(dk)
      const { data: lines, error: e2 } = await lq
      if (e2) throw e2
      period.lines = lines || []
      return period
    }, null)
  }
  async function payrollPeriodDelete(id) {
    await supabase.from(TBL.payrollLines).delete().eq('payroll_period_id', id).eq('business_id', bid())
    return tryWrite(() => supabase.from(TBL.payrollPeriods).delete().eq('id', id).eq('business_id', bid()))
  }
  async function payrollLineList({ payrollPeriodId, payrollPeriodSupabaseId } = {}) {
    return tryOr(async () => {
      let q = supabase.from(TBL.payrollLines).select('*').eq('business_id', bid()).order('id', { ascending: true })
      const dk = _dualKey('payroll_period_id', payrollPeriodId, 'payroll_period_supabase_id', payrollPeriodSupabaseId)
      if (dk) q = q.or(dk)
      const { data, error } = await q
      if (error) throw error
      return data || []
    }, [])
  }
  async function payrollLineAdd(input) {
    const periodSid = input?.payroll_period_supabase_id || await _resolvePayrollPeriodSid(input?.payroll_period_id)
    return tryWrite(() => supabase.from(TBL.payrollLines).insert({
      supabase_id: uuid(), business_id: bid(),
      payroll_period_id: input?.payroll_period_id ?? null,
      payroll_period_supabase_id: periodSid,
      employee_name: input?.employee_name || null,
      employee_cedula: input?.employee_cedula || null,
      employee_nss: input?.employee_nss || null,
      salario_base: input?.salario_base ?? 0,
      dependientes: input?.dependientes ?? 0,
      afp: input?.afp ?? 0, ars: input?.ars ?? 0, sfs: input?.sfs ?? 0,
      riesgos_laborales: input?.riesgos_laborales ?? 0,
      isr: input?.isr ?? 0,
      otras_deducciones: input?.otras_deducciones ?? 0,
      neto: input?.neto ?? 0,
      created_at: nowIso(), updated_at: nowIso(),
    }).select('*').single())
  }
  async function payrollLineDelete(id) {
    return tryWrite(() => supabase.from(TBL.payrollLines).delete().eq('id', id).eq('business_id', bid()))
  }

  // ── TSS filings ──────────────────────────────────────────────────────────
  async function tssFilingList({ accountingClientId, accountingClientSupabaseId, year, status } = {}) {
    return tryOr(async () => {
      let q = supabase.from(TBL.tssFilings).select('*').eq('business_id', bid())
        .order('year', { ascending: false }).order('month', { ascending: false })
      const dk = _dualKey('accounting_client_id', accountingClientId, 'accounting_client_supabase_id', accountingClientSupabaseId)
      if (dk) q = q.or(dk)
      if (year != null) q = q.eq('year', year)
      if (status) q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw error
      return data || []
    }, [])
  }
  async function tssFilingCreate(input) {
    const cliSid = input?.accounting_client_supabase_id || await _resolveClientSid(input?.accounting_client_id)
    return tryWrite(() => supabase.from(TBL.tssFilings).insert({
      supabase_id: uuid(), business_id: bid(),
      accounting_client_id: input?.accounting_client_id ?? null,
      accounting_client_supabase_id: cliSid,
      year: input?.year, month: input?.month,
      filename: input?.filename || null,
      file_supabase_id: input?.file_supabase_id || null,
      status: input?.status || 'pendiente',
      created_at: nowIso(), updated_at: nowIso(),
    }).select('*').single())
  }
  async function tssFilingUpdate(id, patch) {
    return tryWrite(() => supabase.from(TBL.tssFilings).update({ ...patch, updated_at: nowIso() })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }
  async function tssFilingDelete(id) {
    return tryWrite(() => supabase.from(TBL.tssFilings).delete().eq('id', id).eq('business_id', bid()))
  }

  // ── Tasks ────────────────────────────────────────────────────────────────
  async function taskList({ accountingClientId, accountingClientSupabaseId, status, assignedToUserId } = {}) {
    return tryOr(async () => {
      let q = supabase.from(TBL.tasks).select('*').eq('business_id', bid())
        .order('due_date', { ascending: true }).order('priority', { ascending: false })
      const dk = _dualKey('accounting_client_id', accountingClientId, 'accounting_client_supabase_id', accountingClientSupabaseId)
      if (dk) q = q.or(dk)
      if (status) q = q.eq('status', status)
      if (assignedToUserId) q = q.eq('assigned_to_user_id', assignedToUserId)
      const { data, error } = await q
      if (error) throw error
      return data || []
    }, [])
  }
  async function taskCreate(input) {
    const cliSid = input?.accounting_client_supabase_id || await _resolveClientSid(input?.accounting_client_id)
    return tryWrite(() => supabase.from(TBL.tasks).insert({
      supabase_id: uuid(), business_id: bid(),
      accounting_client_id: input?.accounting_client_id ?? null,
      accounting_client_supabase_id: cliSid,
      title: input?.title || '',
      description: input?.description || null,
      assigned_to_user_id: input?.assigned_to_user_id ?? null,
      status: input?.status || 'pending',
      priority: input?.priority || 'med',
      due_date: input?.due_date || null,
      parent_obligation_supabase_id: input?.parent_obligation_supabase_id || null,
      created_at: nowIso(), updated_at: nowIso(),
    }).select('*').single())
  }
  async function taskUpdate(id, patch) {
    return tryWrite(() => supabase.from(TBL.tasks).update({ ...patch, updated_at: nowIso() })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }
  async function taskDelete(id) {
    return tryWrite(() => supabase.from(TBL.tasks).delete().eq('id', id).eq('business_id', bid()))
  }

  // ── Foreign payments (609) ───────────────────────────────────────────────
  async function foreignPaymentList({ accountingClientId, accountingClientSupabaseId, dateFrom, dateTo } = {}) {
    return tryOr(async () => {
      let q = supabase.from(TBL.foreignPayments).select('*').eq('business_id', bid())
        .order('fecha', { ascending: false })
      const dk = _dualKey('accounting_client_id', accountingClientId, 'accounting_client_supabase_id', accountingClientSupabaseId)
      if (dk) q = q.or(dk)
      if (dateFrom) q = q.gte('fecha', dateFrom)
      if (dateTo)   q = q.lte('fecha', dateTo)
      const { data, error } = await q
      if (error) throw error
      return data || []
    }, [])
  }
  async function foreignPaymentCreate(input) {
    const cliSid = input?.accounting_client_supabase_id || await _resolveClientSid(input?.accounting_client_id)
    return tryWrite(() => supabase.from(TBL.foreignPayments).insert({
      supabase_id: uuid(), business_id: bid(),
      accounting_client_id: input?.accounting_client_id ?? null,
      accounting_client_supabase_id: cliSid,
      fecha: input?.fecha || null,
      beneficiario_id: input?.beneficiario_id || null,
      beneficiario_pais: input?.beneficiario_pais || null,
      beneficiario_nombre: input?.beneficiario_nombre || null,
      tipo_renta: input?.tipo_renta || null,
      moneda: input?.moneda || 'USD',
      monto_moneda_pago: input?.monto_moneda_pago ?? 0,
      tasa_cambio: input?.tasa_cambio ?? 1,
      monto_local: input?.monto_local ?? 0,
      isr_retenido: input?.isr_retenido ?? 0,
      created_at: nowIso(), updated_at: nowIso(),
    }).select('*').single())
  }
  async function foreignPaymentUpdate(id, patch) {
    return tryWrite(() => supabase.from(TBL.foreignPayments).update({ ...patch, updated_at: nowIso() })
      .eq('id', id).eq('business_id', bid()).select('*').single())
  }
  async function foreignPaymentDelete(id) {
    return tryWrite(() => supabase.from(TBL.foreignPayments).delete().eq('id', id).eq('business_id', bid()))
  }

  // ── Slice 2 — DGII generators (web) ──────────────────────────────────────
  // TXT generators run fully in-browser — no roundtrip to the server. PDF
  // facsimiles (IT-1) run in-browser too because pdf-lib already ships in the
  // PWA bundle (used by the receipt builder). The annual / corporate forms
  // (IR-1, IR-2, Anexo A) compute in desktop only because they require the
  // accountant to attach a Viafirma .p12 firma digital, which lives on the
  // local cert-manager. Web returns a structured "not implemented" envelope so
  // the screen can prompt the contable to switch to desktop.
  async function _resolveEmisorByClientId(accountingClientId) {
    if (!accountingClientId) return { rncEmisor: '', razonSocial: '' }
    const { data } = await supabase.from(TBL.clients)
      .select('rnc, cedula, nombre_comercial')
      .eq('id', accountingClientId).eq('business_id', bid()).maybeSingle()
    return {
      rncEmisor:   data?.rnc || data?.cedula || '',
      razonSocial: data?.nombre_comercial || '',
    }
  }
  function _periodRange(year, month) {
    const y = Number(year), m = Number(month)
    const last = new Date(y, m, 0).getDate()
    return { from: `${y}-${String(m).padStart(2,'0')}-01`, to: `${y}-${String(m).padStart(2,'0')}-${String(last).padStart(2,'0')}` }
  }
  async function gen609({ accountingClientId, year, month } = {}) {
    const mod = await import('@terminal-x/services/dgii-reports.js')
    const { rncEmisor, razonSocial } = await _resolveEmisorByClientId(accountingClientId)
    const { from, to } = _periodRange(year, month)
    const fp = await foreignPaymentList({ accountingClientId, dateFrom: from, dateTo: to })
    return mod.generate609({ rncEmisor, razonSocial, year, month, foreignPayments: fp })
  }
  async function genIT1({ accountingClientId, year, month, ventas, compras, retencionesRecibidas } = {}) {
    const mod = await import('@terminal-x/services/dgii-reports.js')
    const { rncEmisor, razonSocial } = await _resolveEmisorByClientId(accountingClientId)
    return mod.generateIT1({
      rncEmisor, razonSocial, year, month,
      ventas: ventas || [], compras: compras || [], retencionesRecibidas: retencionesRecibidas || [],
    })
  }
  async function genIR3({ accountingClientId, year, month } = {}) {
    const mod = await import('@terminal-x/services/dgii-reports.js')
    const { rncEmisor, razonSocial } = await _resolveEmisorByClientId(accountingClientId)
    const periods = await payrollPeriodList({ accountingClientId, year })
    const matching = periods.filter(p => Number(p.month) === Number(month))
    let lines = []
    for (const p of matching) {
      const ll = await payrollLineList({ payrollPeriodId: p.id, payrollPeriodSupabaseId: p.supabase_id })
      lines = lines.concat(ll)
    }
    return mod.generateIR3({ rncEmisor, razonSocial, year, month, payrollLines: lines })
  }
  async function genIR17({ accountingClientId, year, month } = {}) {
    const mod = await import('@terminal-x/services/dgii-reports.js')
    const { rncEmisor, razonSocial } = await _resolveEmisorByClientId(accountingClientId)
    const { from, to } = _periodRange(year, month)
    const retentions = await retentionEmitidaList({ accountingClientId, dateFrom: from, dateTo: to })
    return mod.generateIR17({ rncEmisor, razonSocial, year, month, retentions })
  }
  async function _notImplementedDesktopOnly(form, year) {
    return {
      filename: `DGII_${form}_${year}.pdf`,
      content: '',
      contentType: 'application/pdf;base64',
      summary: { form, period: String(year), notImplemented: true, source: 'desktop-only' },
      error: 'Disponible en versión escritorio (requiere firma digital .p12 local)',
    }
  }
  async function genIR1(params)    { return _notImplementedDesktopOnly('IR-1',    params?.year) }
  async function genIR2(params)    { return _notImplementedDesktopOnly('IR-2',    params?.year) }
  async function genAnexoA(params) { return _notImplementedDesktopOnly('AnexoA',  params?.year) }

  const dgii = { gen609, genIT1, genIR3, genIR17, genIR1, genIR2, genAnexoA }

  return {
    clientList, clientCreate, clientUpdate, clientDelete,
    inboxList, inboxAdd, inboxClassify, inboxPost,
    obligationsList, obligationsMarkFiled, obligationsGenerateYear,
    documentList, documentAdd, documentDelete,
    billingPlanList, billingPlanCreate, billingPlanUpdate,
    billingInvoiceList, billingInvoiceCreate, billingInvoiceMarkPaid,
    // Phase 2 Slice 1
    coaList, coaCreate, coaUpdate, coaGet, coaDelete,
    journalEntryList, journalEntryCreate, journalEntryUpdate, journalEntryGet, journalEntryDelete,
    journalLineList, journalLineAdd, journalLineDelete,
    autoPostRuleList, autoPostRuleCreate, autoPostRuleUpdate, autoPostRuleDelete,
    bankAccountList, bankAccountCreate, bankAccountUpdate, bankAccountDelete,
    bankStatementLineList, bankStatementLineAdd, bankStatementLineUpdate, bankStatementLineDelete,
    fixedAssetList, fixedAssetCreate, fixedAssetUpdate, fixedAssetDelete,
    retentionEmitidaList, retentionEmitidaCreate, retentionEmitidaUpdate, retentionEmitidaDelete,
    retentionRecibidaList, retentionRecibidaCreate, retentionRecibidaUpdate, retentionRecibidaDelete,
    payrollPeriodList, payrollPeriodCreate, payrollPeriodUpdate, payrollPeriodGet, payrollPeriodDelete,
    payrollLineList, payrollLineAdd, payrollLineDelete,
    tssFilingList, tssFilingCreate, tssFilingUpdate, tssFilingDelete,
    taskList, taskCreate, taskUpdate, taskDelete,
    foreignPaymentList, foreignPaymentCreate, foreignPaymentUpdate, foreignPaymentDelete,
    // Slice 2 — DGII generators
    dgii,
  }
}
