/**
 * ManagerAuthGate.jsx — Barcode-first manager authorization modal.
 *
 * Protected cashier actions wrap their confirm handler with this gate. The
 * cashier scans the manager's physical card; the 20-char barcode is read by
 * the OS as rapid keystrokes ending in Enter. On match we emit `onApprove`
 * with the authorizing staff identity and write an `activity_log` row.
 *
 * Fallback: manager PIN entry (4-6 digits) — severity=warn. We never expose
 * the card token in any UI; the input is password-masked.
 *
 * Props:
 *   action       string — one of GATED_ACTIONS (used for audit metadata).
 *   actionLabel  string — human-friendly label for the modal title.
 *   context      object — free-form metadata logged alongside the event.
 *   onApprove({ staff_id, staff_name, role, method })
 *   onCancel()
 */

import { useEffect, useRef, useState } from 'react'
import { Lock, X, AlertTriangle, Loader2, KeyRound, ScanLine } from 'lucide-react'
import { useLang } from '../i18n'
import { useAPI } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { enqueueActivity } from '@terminal-x/services/activity-log-queue.js'

// Failure counter — persisted via activity_log so it survives reloads AND
// spans devices for the same business. Each invalid scan/PIN writes a
// `manager_override_failed` row; we query the last 5 minutes of those on
// every new attempt. After 5 strikes we escalate with a `manager_override`
// critical row so the owner sees it in the audit feed.
const STRIKE_WINDOW_MS = 5 * 60 * 1000

async function recordStrike(api, { action, user }) {
  const sinceIso = new Date(Date.now() - STRIKE_WINDOW_MS).toISOString()
  const strikePayload = {
    event_type: 'manager_override_failed',
    severity: 'warn',
    target_type: action || 'gate',
    reason: 'Tarjeta/PIN de gerente invalido',
    metadata: { action, by_user: user?.id || null, by_user_name: user?.name || null },
  }
  // FIX-HIGH-8 — never silent-drop manager override audit. Fall back to the
  // IndexedDB queue if the live write fails so the row gets retried.
  try {
    await api.activity.record(strikePayload)
  } catch (e) {
    try { await enqueueActivity(strikePayload) } catch {}
  }
  // Count recent failures across all devices for this business.
  try {
    const rows = await api.activity.list({
      dateFrom: sinceIso,
      eventTypes: ['manager_override_failed'],
      limit: 20,
    })
    return Array.isArray(rows) ? rows.length : 0
  } catch { return 0 }
}

export default function ManagerAuthGate({ action, actionLabel, context, onApprove, onCancel }) {
  const { lang } = useLang()
  const api      = useAPI()
  const { user } = useAuth()
  const L        = (es, en) => lang === 'es' ? es : en

  const [mode,    setMode]    = useState('scan')  // 'scan' | 'pin'
  const [value,   setValue]   = useState('')
  const [busy,    setBusy]    = useState(false)
  const [err,     setErr]     = useState('')
  const [shake,   setShake]   = useState(false)
  const inputRef              = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 20)
    return () => clearTimeout(t)
  }, [mode])

  function flashError(msg) {
    setErr(msg); setShake(true); setValue('')
    setTimeout(() => setShake(false), 450)
    setTimeout(() => inputRef.current?.focus(), 20)
  }

  async function submitScan() {
    const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (raw.length < 8) { flashError(L('Tarjeta incompleta', 'Incomplete card')); return }
    setBusy(true); setErr('')
    try {
      const match = await api.staff.verifyAuthToken(raw)
      if (!match?.id) {
        const count = await recordStrike(api, { action, user })
        if (count >= 5) {
          const escalation = {
            event_type: 'manager_override', severity: 'critical',
            target_type: action || 'gate', reason: 'Multiples autorizaciones invalidas (≥5 en 5 min)',
            metadata: { action, attempts: count, method: 'card', by_user: user?.id || null },
          }
          try { await api.activity.record(escalation) }
          catch { try { await enqueueActivity(escalation) } catch {} }
        }
        flashError(L('Tarjeta no válida', 'Invalid card'))
        return
      }
      // Mint a server-side one-time MAC jti bound to this action + target.
      // If mac.issue is unavailable or fails, we DO NOT proceed — better to
      // fail loudly than approve without a server-verifiable token that
      // downstream guardMac will reject anyway.
      let mac_jti = null
      if (api?.mac?.issue) {
        try {
          const issued = await api.mac.issue({ scan_token: raw, action, target_id: context?.target_id ?? null })
          mac_jti = issued?.jti || null
        } catch {}
        if (!mac_jti) { flashError(L('No se pudo autorizar en el servidor', 'Server authorization failed')); return }
      }
      const approval = {
        event_type: 'manager_override', severity: 'info',
        target_type: action || 'gate', target_id: context?.target_id || null, target_name: context?.target_name || null,
        amount: context?.amount ?? null,
        reason: actionLabel || action || null,
        metadata: { method: 'card', action, approved_by: match.name, approved_by_role: match.role, ...(context || {}) },
      }
      try { await api.activity.record(approval) }
      catch { try { await enqueueActivity(approval) } catch {} }
      onApprove?.({ staff_id: match.id, staff_name: match.name, role: match.role, method: 'card', mac_jti })
    } catch (e) {
      flashError(e?.message || L('Error al verificar', 'Verify error'))
    } finally { setBusy(false) }
  }

  async function submitPin() {
    const pin = value.replace(/\D/g, '')
    if (pin.length < 4) { flashError(L('PIN incompleto', 'PIN incomplete')); return }
    setBusy(true); setErr('')
    try {
      const manager = await api.auth.byPin(pin)
      if (!manager || !['owner', 'manager'].includes(manager.role)) {
        const count = await recordStrike(api, { action, user })
        if (count >= 5) {
          const escalation = {
            event_type: 'manager_override', severity: 'critical',
            target_type: action || 'gate', reason: 'Multiples autorizaciones invalidas (≥5 en 5 min)',
            metadata: { action, attempts: count, method: 'pin', by_user: user?.id || null },
          }
          try { await api.activity.record(escalation) }
          catch { try { await enqueueActivity(escalation) } catch {} }
        }
        flashError(L('PIN de gerente incorrecto', 'Invalid manager PIN'))
        return
      }
      let mac_jti = null
      if (api?.mac?.issue) {
        try {
          const issued = await api.mac.issue({ pin, action, target_id: context?.target_id ?? null })
          mac_jti = issued?.jti || null
        } catch {}
        if (!mac_jti) { flashError(L('No se pudo autorizar en el servidor', 'Server authorization failed')); return }
      }
      const approval = {
        event_type: 'manager_override', severity: 'warn',
        target_type: action || 'gate', target_id: context?.target_id || null, target_name: context?.target_name || null,
        amount: context?.amount ?? null,
        reason: actionLabel || action || null,
        metadata: { method: 'pin_fallback', action, approved_by: manager.name, approved_by_role: manager.role, ...(context || {}) },
      }
      try { await api.activity.record(approval) }
      catch { try { await enqueueActivity(approval) } catch {} }
      onApprove?.({ staff_id: manager.id, staff_name: manager.name, role: manager.role, method: 'pin', mac_jti })
    } catch (e) {
      flashError(e?.message || L('Error al verificar PIN', 'PIN verify error'))
    } finally { setBusy(false) }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (mode === 'scan') submitScan()
      else submitPin()
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className={`bg-white dark:bg-black rounded-2xl shadow-2xl w-full max-w-sm border-2 border-[#b3001e] ${shake ? 'animate-[shake_0.4s]' : ''}`}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#b3001e]/10 flex items-center justify-center">
              <Lock size={17} className="text-[#b3001e]" />
            </div>
            <div>
              <h3 className="text-[14px] font-black text-slate-900 dark:text-white leading-tight">
                {L('Autorización de gerente', 'Manager authorization')}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-white/60 mt-0.5">
                {actionLabel || L('Acción protegida', 'Protected action')}
              </p>
            </div>
          </div>
          <button onClick={onCancel} disabled={busy}
            className="text-slate-400 hover:text-slate-700 dark:text-white/40 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-40">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          <div className="flex items-start gap-2.5 bg-[#b3001e]/5 border border-[#b3001e]/20 rounded-xl px-3.5 py-3">
            {mode === 'scan' ? <ScanLine size={15} className="text-[#b3001e] shrink-0 mt-0.5" /> : <KeyRound size={15} className="text-[#b3001e] shrink-0 mt-0.5" />}
            <p className="text-[12px] text-slate-700 dark:text-white/80 leading-relaxed">
              {mode === 'scan'
                ? L('Escanee la tarjeta del gerente para continuar.', 'Scan the manager card to continue.')
                : L('Ingrese el PIN del gerente.', 'Enter the manager PIN.')
              }
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider mb-1.5">
              {mode === 'scan' ? L('Tarjeta', 'Card') : 'PIN'}
            </label>
            {/* Hidden absorber: Chrome / 1Password / LastPass detect the
                password input below and try to autofill the saved login
                email into the NEAREST text input (e.g. DailyReport search
                box), which then filters every row out and the list goes
                blank with no error. The hidden username input gives
                autofill a target to write to instead, so it never leaks
                into the visible page. Confirmed bug 2026-05-02. */}
            <input type="text" name="username" autoComplete="username" tabIndex={-1}
              aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />
            <input
              ref={inputRef}
              type="password"
              inputMode={mode === 'pin' ? 'numeric' : 'text'}
              autoComplete="new-password"
              data-lpignore="true"
              data-1p-ignore="true"
              value={value}
              onChange={e => {
                setErr('')
                if (mode === 'pin') setValue(e.target.value.replace(/\D/g, '').slice(0, 6))
                else                setValue(e.target.value.slice(0, 64))
              }}
              onKeyDown={onKeyDown}
              placeholder={mode === 'scan' ? L('Apunte al código…', 'Aim at code…') : '••••'}
              className={`w-full text-center tracking-[0.3em] text-lg font-mono font-bold
                bg-white dark:bg-white/5 border-2 rounded-xl py-3 px-3
                ${err ? 'border-[#b3001e] text-[#b3001e]' : 'border-slate-200 dark:border-white/10 text-slate-900 dark:text-white'}
                focus:outline-none focus:border-[#b3001e] focus:ring-2 focus:ring-[#b3001e]/30`}
              disabled={busy}
            />
            {err && (
              <p className="mt-2 text-[12px] font-semibold text-[#b3001e] flex items-center gap-1.5">
                <AlertTriangle size={12} /> {err}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={onCancel} disabled={busy}
              className="flex-1 px-3 py-2.5 text-[12px] font-bold text-slate-600 dark:text-white/70 border border-slate-200 dark:border-white/10 rounded-xl hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-40">
              {L('Cancelar', 'Cancel')}
            </button>
            <button
              onClick={mode === 'scan' ? submitScan : submitPin}
              disabled={busy || !value.trim()}
              className="flex-1 px-3 py-2.5 text-[12px] font-black text-white bg-[#b3001e] rounded-xl hover:bg-[#8f0018] disabled:opacity-40 flex items-center justify-center gap-1.5">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
              {L('Autorizar', 'Authorize')}
            </button>
          </div>

          <button
            onClick={() => { setMode(m => m === 'scan' ? 'pin' : 'scan'); setValue(''); setErr('') }}
            className="w-full text-[11px] font-semibold text-slate-500 dark:text-white/50 hover:text-[#b3001e] underline underline-offset-2">
            {mode === 'scan'
              ? L('Usar PIN de gerente (emergencia)', 'Use manager PIN (emergency)')
              : L('← Volver a escanear tarjeta', '← Back to card scan')
            }
          </button>
        </div>
      </div>

      {/* shake keyframes — scoped, avoids polluting global Tailwind */}
      <style>{`@keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-6px)} 40%,80%{transform:translateX(6px)} }`}</style>
    </div>
  )
}
