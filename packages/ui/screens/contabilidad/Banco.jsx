// Banco — Contabilidad bank module: Cuentas · Importar Estado · Conciliación.
// Plan-gated by `contabilidad_banco`. Uses bankParsers/index.js for OFX import
// (Scotiabank, Banco Popular). BHD León + Banreservas show "Próximamente".

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Landmark, Plus, Trash2, Upload, Loader2, Lock, X, Link2, Unlink,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { usePlan } from '../../hooks/usePlan'
import { BANK_LABELS, SUPPORTED_BANKS, COMING_SOON_BANKS, parseStatement, detectFormat } from '@terminal-x/services/bankParsers/index.js'

const TABS = [
  { id: 'cuentas',    label: 'Cuentas' },
  { id: 'importar',   label: 'Importar Estado' },
  { id: 'concilia',   label: 'Conciliación' },
]

const ACCT_TYPES = { checking: 'Corriente', savings: 'Ahorros' }

function fmtRD(n) {
  return Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function ComingSoon() {
  return (
    <div className="p-6 max-w-2xl">
      <div className="rounded-2xl border border-[#b3001e]/30 bg-[#b3001e]/5 p-6">
        <div className="flex items-center gap-2 text-[#b3001e] font-bold mb-2"><Lock size={16}/> Próximamente</div>
        <div className="text-sm text-black/80 dark:text-white/80">
          El módulo Banco requiere el plan Pro CTB. Contáctanos por WhatsApp para activar.
        </div>
      </div>
    </div>
  )
}

function ClientPicker({ clients, value, onChange }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
      <option value="">— Cliente —</option>
      {(clients || []).map(c => <option key={c.id} value={c.id}>{c.nombre_comercial}</option>)}
    </select>
  )
}

// ── Cuentas ────────────────────────────────────────────────────────────────

function CuentasTab({ api, clientId, accounts, reload }) {
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)

  async function save(form) {
    if (COMING_SOON_BANKS.includes(form.banco)) {
      alert('Este banco aún no soporta importación automática (próximamente).')
    }
    setBusy(true)
    try {
      if (editing?.id) await api.contabilidad.bankAccountUpdate(editing.id, form)
      else await api.contabilidad.bankAccountCreate({ ...form, accounting_client_id: clientId })
      setEditing(null)
      await reload()
    } catch (e) { alert(`Error: ${e?.message || e}`) }
    finally    { setBusy(false) }
  }

  async function remove(id) {
    if (!confirm('¿Eliminar la cuenta?')) return
    setBusy(true)
    try { await api.contabilidad.bankAccountDelete(id); await reload() }
    catch (e) { alert(`Error: ${e?.message || e}`) }
    finally   { setBusy(false) }
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setEditing({})} disabled={!clientId}
          className="inline-flex items-center gap-2 rounded-lg bg-[#b3001e] text-white px-3 py-2 text-sm font-bold hover:bg-[#8f0018] disabled:opacity-50">
          <Plus size={14}/> Nueva Cuenta
        </button>
      </div>
      <div className="rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black text-white">
            <tr>
              <th className="text-left px-3 py-2">Banco</th>
              <th className="text-left px-3 py-2">Tipo</th>
              <th className="text-left px-3 py-2">Últimos 4</th>
              <th className="text-left px-3 py-2">Moneda</th>
              <th className="text-right px-3 py-2">Saldo Inicial</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {!accounts.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-black/50 dark:text-white/50">Sin cuentas registradas.</td></tr>}
            {accounts.map(a => (
              <tr key={a.id} className="border-t border-black/10 dark:border-white/10">
                <td className="px-3 py-2 font-bold">{BANK_LABELS[a.banco] || a.banco}</td>
                <td className="px-3 py-2">{ACCT_TYPES[a.account_type] || a.account_type}</td>
                <td className="px-3 py-2 font-mono">{a.account_no_last4 || '—'}</td>
                <td className="px-3 py-2">{a.currency}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtRD(a.opening_balance)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => setEditing(a)} className="text-xs font-bold text-[#b3001e] hover:underline mr-3">Editar</button>
                  <button onClick={() => remove(a.id)} className="text-xs font-bold text-black/60 dark:text-white/60 hover:text-[#b3001e]"><Trash2 size={14} className="inline"/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <BankAccountModal initial={editing} onClose={() => setEditing(null)} onSave={save} busy={busy}/>}
    </div>
  )
}

function BankAccountModal({ initial, onClose, onSave, busy }) {
  const [form, setForm] = useState({
    banco: initial?.banco || 'scotiabank',
    account_type: initial?.account_type || 'checking',
    account_no_last4: initial?.account_no_last4 || '',
    currency: initial?.currency || 'DOP',
    opening_balance: initial?.opening_balance ?? 0,
    active: initial?.active ?? 1,
  })
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-bold">{initial?.id ? 'Editar Cuenta' : 'Nueva Cuenta Bancaria'}</div>
          <button onClick={onClose}><X size={16}/></button>
        </div>
        <div className="space-y-3">
          <label className="block text-xs font-bold">Banco
            <select value={form.banco} onChange={(e) => set('banco', e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
              {SUPPORTED_BANKS.map(b => <option key={b} value={b}>{BANK_LABELS[b]}</option>)}
              {COMING_SOON_BANKS.map(b => <option key={b} value={b}>{BANK_LABELS[b]} — Próximamente</option>)}
              <option value="otro">Otro</option>
            </select>
          </label>
          {COMING_SOON_BANKS.includes(form.banco) && (
            <div className="text-xs text-[#b3001e] font-bold">Próximamente — formato CSV pendiente.</div>
          )}
          <label className="block text-xs font-bold">Tipo de cuenta
            <select value={form.account_type} onChange={(e) => set('account_type', e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
              <option value="checking">Corriente</option>
              <option value="savings">Ahorros</option>
            </select>
          </label>
          <label className="block text-xs font-bold">Últimos 4 dígitos
            <input value={form.account_no_last4 || ''} maxLength={4} onChange={(e) => set('account_no_last4', e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono"/>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold">Moneda
              <select value={form.currency} onChange={(e) => set('currency', e.target.value)}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
                <option value="DOP">DOP</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </label>
            <label className="block text-xs font-bold">Saldo Inicial
              <input type="number" step="0.01" value={form.opening_balance} onChange={(e) => set('opening_balance', e.target.value)}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono text-right"/>
            </label>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-bold border border-black/10 dark:border-white/10">Cancelar</button>
          <button disabled={busy} onClick={() => onSave(form)}
            className="px-3 py-2 rounded-lg text-sm font-bold bg-[#b3001e] text-white disabled:opacity-50">
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Importar Estado ────────────────────────────────────────────────────────

function ImportarTab({ api, accounts, reloadLines }) {
  const [bankAccountId, setBankAccountId] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)

  const account = useMemo(() => accounts.find(a => a.id === bankAccountId), [accounts, bankAccountId])

  async function handleFile(file) {
    if (!file) return
    if (!bankAccountId) { alert('Selecciona una cuenta bancaria primero.'); return }
    setBusy(true)
    try {
      const text = await file.text()
      const fmt = detectFormat(text)
      if (!fmt && !COMING_SOON_BANKS.includes(account?.banco)) {
        alert('Formato no reconocido. Por ahora soportamos OFX (Scotiabank y Banco Popular).')
      }
      const r = parseStatement({ content: text, banco: account?.banco })
      setParsed({ ...r, filename: file.name })
    } catch (e) {
      alert(`Error al leer archivo: ${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!parsed?.lines?.length || !bankAccountId) return
    setBusy(true)
    try {
      for (const l of parsed.lines) {
        await api.contabilidad.bankStatementLineAdd({
          bank_account_id: bankAccountId,
          fecha: l.fecha, descripcion: l.descripcion, referencia: l.referencia,
          debit: l.debit, credit: l.credit, balance: l.balance,
          match_status: 'unmatched',
          raw_row: l,
        })
      }
      setParsed(null)
      await reloadLines()
      alert(`${parsed.lines.length} líneas importadas.`)
    } catch (e) {
      alert(`Error al importar: ${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <select value={bankAccountId || ''} onChange={(e) => setBankAccountId(e.target.value ? Number(e.target.value) : null)}
          className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
          <option value="">— Cuenta bancaria —</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{BANK_LABELS[a.banco]} ··· {a.account_no_last4 || '—'}</option>)}
        </select>
        {account && COMING_SOON_BANKS.includes(account.banco) && (
          <span className="text-xs text-[#b3001e] font-bold">Próximamente — formato CSV pendiente para {BANK_LABELS[account.banco]}.</span>
        )}
      </div>

      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files?.[0]) }}
        className={`block rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors
          ${drag ? 'border-[#b3001e] bg-[#b3001e]/5' : 'border-black/20 dark:border-white/20 hover:border-[#b3001e]/50'}`}>
        <Upload className="mx-auto mb-2 text-[#b3001e]" size={28}/>
        <div className="text-sm font-bold">Arrastra tu archivo OFX aquí o haz clic para seleccionar</div>
        <div className="text-xs text-black/60 dark:text-white/60 mt-1">Scotiabank y Banco Popular exportan OFX desde su banca en línea.</div>
        <input type="file" accept=".ofx,.qfx,.txt" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])}/>
      </label>

      {busy && <div className="flex items-center gap-2 text-sm text-[#b3001e]"><Loader2 size={14} className="animate-spin"/> Procesando…</div>}

      {parsed && (
        <div className="space-y-2">
          {parsed.errors?.length > 0 && (
            <div className="rounded-2xl border border-[#b3001e]/30 bg-[#b3001e]/5 p-3 text-xs text-[#b3001e]">
              {parsed.errors.map((e, i) => <div key={i}>• {e}</div>)}
            </div>
          )}
          {parsed.lines?.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <div className="text-sm font-bold">{parsed.lines.length} línea(s) detectadas en {parsed.filename}</div>
                <button onClick={confirm} disabled={busy}
                  className="ml-auto inline-flex items-center gap-2 rounded-lg bg-[#b3001e] text-white px-3 py-2 text-sm font-bold hover:bg-[#8f0018] disabled:opacity-50">
                  Confirmar importación
                </button>
                <button onClick={() => setParsed(null)} className="px-3 py-2 rounded-lg text-sm font-bold border border-black/10 dark:border-white/10">Cancelar</button>
              </div>
              <div className="rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-black text-white sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2">Fecha</th>
                      <th className="text-left px-3 py-2">Descripción</th>
                      <th className="text-left px-3 py-2">Referencia</th>
                      <th className="text-right px-3 py-2">Débito</th>
                      <th className="text-right px-3 py-2">Crédito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.lines.map((l, i) => (
                      <tr key={i} className="border-t border-black/10 dark:border-white/10">
                        <td className="px-3 py-2 font-mono">{l.fecha}</td>
                        <td className="px-3 py-2">{l.descripcion}</td>
                        <td className="px-3 py-2 font-mono text-xs text-black/60 dark:text-white/60">{l.referencia}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtRD(l.debit)}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtRD(l.credit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Conciliación ───────────────────────────────────────────────────────────

function ConciliaTab({ api, clientId, year, month, accounts, accounts_chart }) {
  const [bankAccountId, setBankAccountId] = useState(null)
  const [bankLines, setBankLines] = useState([])
  const [journalLines, setJournalLines] = useState([])
  const [busy, setBusy] = useState(false)
  const [bankSel, setBankSel] = useState(null)
  const [jrnlSel, setJrnlSel] = useState(null)
  const [adjustOpen, setAdjustOpen] = useState(null)

  const reload = useCallback(async () => {
    if (!api?.contabilidad || !bankAccountId) { setBankLines([]); setJournalLines([]); return }
    setBusy(true)
    try {
      const [bl] = await Promise.all([
        api.contabilidad.bankStatementLineList({ bankAccountId, matchStatus: 'unmatched' }),
      ])
      setBankLines(bl || [])
      // Pull journal lines for the period: fetch entries first, then lines.
      const entries = await api.contabilidad.journalEntryList({
        accountingClientId: clientId, periodYear: year, periodMonth: month, status: 'posted',
      }) || []
      const collected = []
      for (const e of entries) {
        const ll = await api.contabilidad.journalLineList({ journalEntryId: e.id, journalEntrySupabaseId: e.supabase_id }) || []
        for (const l of ll) collected.push({ ...l, fecha: e.fecha, description: e.description })
      }
      // Heuristic: only show unmatched (no row in bank_lines with matched_journal_line_id === l.id)
      const matched = new Set((bankLines || []).filter(b => b.matched_journal_line_id).map(b => b.matched_journal_line_id))
      setJournalLines(collected.filter(l => !matched.has(l.id)))
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, bankAccountId, clientId, year, month])

  useEffect(() => { reload() }, [reload])

  async function match() {
    if (!bankSel || !jrnlSel) return
    setBusy(true)
    try {
      await api.contabilidad.bankStatementLineUpdate(bankSel.id, {
        matched_journal_line_id: jrnlSel.id,
        matched_journal_line_supabase_id: jrnlSel.supabase_id || null,
        match_status: 'matched',
      })
      setBankSel(null); setJrnlSel(null)
      await reload()
    } catch (e) { alert(`Error: ${e?.message || e}`) }
    finally { setBusy(false) }
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <select value={bankAccountId || ''} onChange={(e) => setBankAccountId(e.target.value ? Number(e.target.value) : null)}
          className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
          <option value="">— Cuenta bancaria —</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{BANK_LABELS[a.banco]} ··· {a.account_no_last4 || '—'}</option>)}
        </select>
        <button disabled={!bankSel || !jrnlSel || busy} onClick={match}
          className="inline-flex items-center gap-2 rounded-lg bg-[#b3001e] text-white px-3 py-2 text-sm font-bold hover:bg-[#8f0018] disabled:opacity-50">
          <Link2 size={14}/> Cuadrar par seleccionado
        </button>
        {bankSel && (
          <button onClick={() => setAdjustOpen({ bank: bankSel })}
            className="inline-flex items-center gap-2 rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 text-sm font-bold">
            <Plus size={14}/> Crear asiento de ajuste
          </button>
        )}
      </div>

      {busy && <div className="flex items-center gap-2 text-sm text-[#b3001e]"><Loader2 size={14} className="animate-spin"/> Cargando…</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden">
          <div className="bg-black text-white px-3 py-2 text-xs font-bold">Líneas bancarias sin conciliar ({bankLines.length})</div>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {!bankLines.length && <tr><td className="px-3 py-4 text-center text-black/50 dark:text-white/50">Sin pendientes.</td></tr>}
                {bankLines.map(l => {
                  const sel = bankSel?.id === l.id
                  return (
                    <tr key={l.id} onClick={() => setBankSel(sel ? null : l)}
                      className={`border-t border-black/10 dark:border-white/10 cursor-pointer ${sel ? 'bg-[#b3001e]/15' : 'hover:bg-[#b3001e]/5'}`}>
                      <td className="px-2 py-1 font-mono">{l.fecha}</td>
                      <td className="px-2 py-1">{l.descripcion}</td>
                      <td className="px-2 py-1 text-right font-mono">{l.debit > 0 ? `-${fmtRD(l.debit)}` : fmtRD(l.credit)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden">
          <div className="bg-black text-white px-3 py-2 text-xs font-bold">Líneas contables sin conciliar ({journalLines.length})</div>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {!journalLines.length && <tr><td className="px-3 py-4 text-center text-black/50 dark:text-white/50">Sin pendientes.</td></tr>}
                {journalLines.map(l => {
                  const sel = jrnlSel?.id === l.id
                  return (
                    <tr key={l.id} onClick={() => setJrnlSel(sel ? null : l)}
                      className={`border-t border-black/10 dark:border-white/10 cursor-pointer ${sel ? 'bg-[#b3001e]/15' : 'hover:bg-[#b3001e]/5'}`}>
                      <td className="px-2 py-1 font-mono">{l.fecha}</td>
                      <td className="px-2 py-1">{l.description || l.memo || '—'}</td>
                      <td className="px-2 py-1 text-right font-mono">{l.debit > 0 ? fmtRD(l.debit) : `-${fmtRD(l.credit)}`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {adjustOpen && (
        <AdjustmentModal
          api={api}
          clientId={clientId} year={year} month={month}
          bankLine={adjustOpen.bank}
          accounts={accounts_chart}
          onClose={() => setAdjustOpen(null)}
          onSaved={async () => { setAdjustOpen(null); await reload() }}
        />
      )}
    </div>
  )
}

function AdjustmentModal({ api, clientId, year, month, bankLine, accounts, onClose, onSaved }) {
  const amount = Number(bankLine.debit || 0) - Number(bankLine.credit || 0)
  const [debitId, setDebitId] = useState(null)
  const [creditId, setCreditId] = useState(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!debitId || !creditId) return alert('Selecciona ambas cuentas.')
    setBusy(true)
    try {
      const entry = await api.contabilidad.journalEntryCreate({
        accounting_client_id: clientId,
        fecha: bankLine.fecha,
        description: `Ajuste conciliación: ${bankLine.descripcion}`,
        type: 'adjustment',
        period_year: year, period_month: month,
        totals_debit: Math.abs(amount), totals_credit: Math.abs(amount), status: 'posted',
      })
      const abs = Math.abs(amount)
      const debitLine  = await api.contabilidad.journalLineAdd({ journal_entry_id: entry.id, account_id: debitId,  debit: abs, credit: 0, memo: bankLine.descripcion })
      await api.contabilidad.journalLineAdd({ journal_entry_id: entry.id, account_id: creditId, debit: 0, credit: abs, memo: bankLine.descripcion })
      await api.contabilidad.bankStatementLineUpdate(bankLine.id, {
        matched_journal_line_id: debitLine.id,
        matched_journal_line_supabase_id: debitLine.supabase_id || null,
        match_status: 'matched',
      })
      await onSaved?.()
    } catch (e) { alert(`Error: ${e?.message || e}`) }
    finally    { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 max-w-lg w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-bold">Asiento de ajuste</div>
          <button onClick={onClose}><X size={16}/></button>
        </div>
        <div className="text-xs text-black/60 dark:text-white/60 mb-3">
          {bankLine.fecha} — {bankLine.descripcion} — RD$ {fmtRD(Math.abs(amount))}
        </div>
        <div className="space-y-3">
          <label className="block text-xs font-bold">Cuenta a debitar
            <select value={debitId || ''} onChange={(e) => setDebitId(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
              <option value="">— Seleccionar —</option>
              {(accounts || []).filter(a => a.is_postable).map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold">Cuenta a acreditar
            <select value={creditId || ''} onChange={(e) => setCreditId(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
              <option value="">— Seleccionar —</option>
              {(accounts || []).filter(a => a.is_postable).map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-bold border border-black/10 dark:border-white/10">Cancelar</button>
          <button disabled={busy} onClick={save}
            className="px-3 py-2 rounded-lg text-sm font-bold bg-[#b3001e] text-white disabled:opacity-50">
            Crear y conciliar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Shell ───────────────────────────────────────────────────────────────────

export default function Banco() {
  const api = useAPI()
  const { hasFeature } = usePlan()
  const allowed = hasFeature('contabilidad_banco')

  const [tab, setTab] = useState('cuentas')
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState(null)
  const [accounts, setAccounts] = useState([])     // bank accounts
  const [chart, setChart] = useState([])           // chart of accounts
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!api?.contabilidad) return
      const c = await api.contabilidad.clientList()
      if (cancelled) return
      setClients(c || [])
      if (!clientId && c?.length) setClientId(c[0].id)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  const reloadAccounts = useCallback(async () => {
    if (!api?.contabilidad || !clientId) { setAccounts([]); setChart([]); return }
    const [ba, coa] = await Promise.all([
      api.contabilidad.bankAccountList({ accountingClientId: clientId }),
      api.contabilidad.coaList({ accountingClientId: clientId }),
    ])
    setAccounts(ba || [])
    setChart(coa || [])
  }, [api, clientId])

  useEffect(() => { reloadAccounts() }, [reloadAccounts])

  if (!allowed) return <ComingSoon/>

  return (
    <div className="flex flex-col min-h-full">
      <div className="border-b border-black/10 dark:border-white/10 bg-white dark:bg-black px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 font-bold text-[#b3001e]">
          <Landmark size={16}/> Banco
        </div>
        <ClientPicker clients={clients} value={clientId} onChange={setClientId}/>
        <div className="flex gap-2">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
            {[today.getFullYear(), today.getFullYear() - 1, today.getFullYear() - 2].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
          </select>
        </div>
      </div>
      <nav className="border-b border-black/10 dark:border-white/10 bg-white dark:bg-black px-2 py-1 flex gap-1 overflow-x-auto">
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-colors
                ${active ? 'bg-[#b3001e] text-white' : 'text-black/70 dark:text-white/70 hover:bg-[#b3001e]/10 hover:text-[#b3001e]'}`}>
              {t.label}
            </button>
          )
        })}
      </nav>
      <div className="flex-1 min-w-0 bg-white dark:bg-black">
        {!clientId && <div className="p-6 text-sm text-black/60 dark:text-white/60">Selecciona un cliente para empezar.</div>}
        {clientId && tab === 'cuentas'  && <CuentasTab  api={api} clientId={clientId} accounts={accounts} reload={reloadAccounts}/>}
        {clientId && tab === 'importar' && <ImportarTab api={api} accounts={accounts} reloadLines={reloadAccounts}/>}
        {clientId && tab === 'concilia' && <ConciliaTab api={api} clientId={clientId} year={year} month={month} accounts={accounts} accounts_chart={chart}/>}
      </div>
    </div>
  )
}
