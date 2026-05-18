// Cartera — Contabilidad client roster + per-client semáforo (Phase 1).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search, X, Loader2, Building2, AlertCircle, Link2, Copy, Check, Unlink, Eye, Mail, Send, Trash2 } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useAuth } from '../../context/AuthContext'
import { usePlan } from '../../hooks/usePlan'
import { useRNC } from '../../hooks/useRNC'
import { applicableTemplates } from '@terminal-x/config/contabilidadCalendar.js'

const PANEL_API = '/api/panel'

async function callCtb(action, payload, method = 'POST') {
  // Auth: read from window.__txSupabase (the persistent client that holds
  // the user's session). The services/supabase singleton creates a parallel
  // non-persistent client and would return null here.
  let token = null
  try {
    const sb = (typeof window !== 'undefined') ? window.__txSupabase : null
    const sess = (await sb?.auth?.getSession?.())?.data?.session
    token = sess?.access_token || null
  } catch {}
  if (!token) {
    try {
      const mod = await import('@terminal-x/services/supabase')
      const sb2 = mod.getSupabaseClient?.()
      const sess2 = (await sb2?.auth?.getSession?.())?.data?.session
      token = sess2?.access_token || null
    } catch {}
  }
  if (!token) throw new Error('Sesión expirada — inicia sesión.')
  const isGet = method === 'GET'
  const qs = isGet
    ? '?' + new URLSearchParams({ action, ...(payload || {}) }).toString()
    : `?action=${encodeURIComponent(action)}`
  const res = await fetch(`${PANEL_API}${qs}`, {
    method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: isGet ? undefined : JSON.stringify(payload || {}),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j?.ok === false) throw new Error(j?.error || j?.message || `HTTP ${res.status}`)
  return j
}

const PERSONA_LABEL = { pf: 'Persona física', pj: 'Persona jurídica', eirl: 'EIRL' }
const REGIMEN_LABEL = { ordinario: 'Ordinario', rst: 'RST', pst: 'PST', sin_operaciones: 'Sin operaciones' }

function pendingForClient(obligations, clientId, year, month) {
  return (obligations || []).filter(o =>
    o.accounting_client_id === clientId &&
    o.period_year === year &&
    o.period_month === month &&
    o.status === 'pendiente'
  ).length
}

export default function Cartera() {
  const api = useAPI()
  const { hasFeature } = usePlan()
  const { enterImpersonation } = useAuth()
  const canImpersonate = hasFeature('contabilidad_view_as_client')
  const { lookup: rncLookup, lookupLoading: rncLoading } = useRNC()
  const [rows, setRows] = useState([])
  const [obligations, setObligations] = useState([])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)

  const today = useMemo(() => new Date(), [])
  const year = today.getFullYear()
  const month = today.getMonth() + 1

  const reload = useCallback(async () => {
    if (!api?.contabilidad) return
    const [c, o] = await Promise.all([
      api.contabilidad.clientList(),
      api.contabilidad.obligationsList({ dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` }),
    ])
    setRows(c || [])
    setObligations(o || [])
  }, [api, year])

  useEffect(() => { reload() }, [reload])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return rows
    return rows.filter(r => (r.nombre_comercial || '').toLowerCase().includes(s) || (r.rnc || '').includes(s))
  }, [rows, search])

  async function save(input) {
    setBusy(true)
    try {
      if (editing?.id) {
        await api.contabilidad.clientUpdate(editing.id, input)
      } else {
        await api.contabilidad.clientCreate(input)
      }
      setEditing(null)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function generateYear(client) {
    if (!api?.contabilidad?.obligationsGenerateYear) return
    const templates = applicableTemplates({ regimen: client.regimen, persona: client.tipo_persona })
    setBusy(true)
    try {
      await api.contabilidad.obligationsGenerateYear({ accountingClientId: client.id, year, templates })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const [linkClient, setLinkClient] = useState(null)
  const [linkResult, setLinkResult] = useState(null)
  const [inviteClient, setInviteClient] = useState(null)
  const [inviteResult, setInviteResult] = useState(null)

  async function sendEmailInvite({ email, business_name }) {
    setBusy(true); setInviteResult(null)
    try {
      const r = await callCtb('ctb_invite_by_email', { email, business_name, send_email: true })
      setInviteResult(r)
      await reload()
    } catch (e) {
      setInviteResult({ ok: false, error: e?.message || String(e) })
      try { window.__txReportError?.(e, { severity: 'error', category: 'contabilidad.invite.email.send', extra: { email, business_name } }) } catch {}
    }
    finally { setBusy(false) }
  }

  async function deleteClient(client) {
    if (!confirm(`¿Eliminar a "${client.nombre_comercial}" de tu cartera? Esto archiva el cliente.`)) return
    setBusy(true)
    try {
      await api.contabilidad.clientDelete(client.id)
      await reload()
    } catch (e) {
      try { window.__txReportError?.(e, { severity: 'error', category: 'contabilidad.client.delete', extra: { client_id: client?.id } }) } catch {}
      alert(`Error: ${e?.message || e}`)
    }
    finally { setBusy(false) }
  }

  async function generateAccessCode(client) {
    setBusy(true); setLinkResult(null); setLinkClient(client)
    try {
      const r = await callCtb('ctb_generate_access_code', { accounting_client_id: client.id })
      setLinkResult(r)
      await reload()
    } catch (e) { alert(`Error: ${e?.message || e}`); setLinkClient(null) }
    finally    { setBusy(false) }
  }
  async function revokeAccess(client) {
    if (!confirm(`¿Revocar acceso de "${client.nombre_comercial}"?`)) return
    setBusy(true)
    try { await callCtb('ctb_revoke_access', { accounting_client_id: client.id }); await reload() }
    catch (e) { alert(`Error: ${e?.message || e}`) }
    finally   { setBusy(false) }
  }

  // "Ver como cliente" — server verifies the firm has an access_granted
  // accounting_clients row pointing at shared_business_id, writes the
  // firm_impersonate_start activity log entry under BOTH tenants, then we
  // flip sessionStorage and hard-reload into /pos so every memoized
  // createWebAPI(supabase, businessId) closure rebuilds against the client.
  async function viewAsClient(client) {
    if (!client?.shared_business_id) {
      alert('Este cliente aún no ha aceptado el código. Primero generale un código y pídele que lo acepte.')
      return
    }
    if (!confirm(`Vas a ver el sistema como "${client.nombre_comercial}". Toda actividad queda registrada en la auditoría. ¿Continuar?`)) return
    setBusy(true)
    try {
      await enterImpersonation({
        clientBusinessId:    client.shared_business_id,
        clientName:          client.nombre_comercial,
        accountingClientId:  client.id,
      })
      // enterImpersonation does a hard reload — execution typically does not
      // reach here, but if the navigation is intercepted we still drop busy.
    } catch (e) {
      alert(`Error: ${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-black text-black dark:text-white">Cartera</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => { setInviteClient({}); setInviteResult(null) }}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-[#b3001e] text-[#b3001e] hover:bg-[#b3001e]/10 text-sm font-bold">
            <Mail size={14} /> Invitar por email
          </button>
          <button onClick={() => setEditing({})}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#b3001e] hover:bg-[#c8002a] text-white text-sm font-bold">
            <Plus size={16} /> Nuevo cliente
          </button>
        </div>
      </div>

      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40 dark:text-white/40" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o RNC"
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-black dark:text-white text-sm" />
      </div>

      <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black text-white">
            <tr className="text-left">
              <th className="px-4 py-2 font-bold">Cliente</th>
              <th className="px-4 py-2 font-bold">RNC / Cédula</th>
              <th className="px-4 py-2 font-bold">Persona</th>
              <th className="px-4 py-2 font-bold">Régimen</th>
              <th className="px-4 py-2 font-bold">Honorarios</th>
              <th className="px-4 py-2 font-bold">Pendientes mes</th>
              <th className="px-4 py-2 font-bold text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan="7" className="px-4 py-12">
                <div className="max-w-md mx-auto text-center">
                  <div className="w-14 h-14 rounded-full bg-[#b3001e] flex items-center justify-center mx-auto mb-4">
                    <Building2 size={26} className="text-white" />
                  </div>
                  <div className="text-base font-black text-black dark:text-white mb-2">
                    Conecta tu primer cliente
                  </div>
                  <p className="text-sm text-black/60 dark:text-white/60 leading-relaxed mb-5">
                    Terminal X cobra sentido cuando tienes a tu primer cliente conectado. En 2 minutos verás sus ventas, e-CFs e inventario en vivo desde aquí.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 justify-center">
                    <button onClick={() => { setInviteClient({}); setInviteResult(null) }}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#b3001e] text-white text-sm font-bold hover:bg-[#8f0018]">
                      <Mail size={14}/> Invitar por email
                    </button>
                    <button onClick={() => setEditing({})}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-black/15 dark:border-white/15 text-black dark:text-white text-sm font-bold hover:border-[#b3001e] hover:text-[#b3001e]">
                      <Plus size={14}/> Agregar manualmente
                    </button>
                  </div>
                  <p className="text-[11px] text-black/40 dark:text-white/40 mt-4">
                    Si tu cliente ya está en Terminal X, el email le llega con un link de un click.<br/>Si no está, puedes agregarlo manualmente y trabajar con la sesión DGII de su portal.
                  </p>
                </div>
              </td></tr>
            )}
            {filtered.map(r => {
              const pend = pendingForClient(obligations, r.id, year, month)
              return (
                <tr key={r.id} className="border-b border-black/5 dark:border-white/10 hover:bg-[#b3001e]/5">
                  <td className="px-4 py-2 font-bold text-black dark:text-white">{r.nombre_comercial}</td>
                  <td className="px-4 py-2 text-black/70 dark:text-white/70">{r.rnc || r.cedula || '—'}</td>
                  <td className="px-4 py-2 text-black/70 dark:text-white/70">{PERSONA_LABEL[r.tipo_persona] || r.tipo_persona}</td>
                  <td className="px-4 py-2 text-black/70 dark:text-white/70">{REGIMEN_LABEL[r.regimen] || r.regimen}</td>
                  <td className="px-4 py-2 text-black dark:text-white">RD$ {Number(r.honorarios_mensuales || 0).toFixed(2)}</td>
                  <td className="px-4 py-2">
                    {pend > 0
                      ? <span className="inline-flex items-center gap-1 text-[#b3001e] font-bold"><AlertCircle size={12} /> {pend}</span>
                      : <span className="text-black/40 dark:text-white/40">0</span>}
                  </td>
                  <td className="px-4 py-2 text-right space-x-2 whitespace-nowrap">
                    {r.access_granted ? (
                      <button onClick={() => revokeAccess(r)} title="Revocar acceso a datos del cliente"
                        className="px-2.5 py-1 rounded-lg bg-[#b3001e]/10 border border-[#b3001e]/30 text-[#b3001e] text-xs font-bold inline-flex items-center gap-1">
                        <Unlink size={12}/> Conectado
                      </button>
                    ) : (
                      <>
                        <button onClick={() => generateAccessCode(r)} disabled={busy} title="Generar código de 8 caracteres"
                          className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 text-xs text-black/70 dark:text-white/70 hover:border-[#b3001e] hover:text-[#b3001e] inline-flex items-center gap-1 disabled:opacity-50">
                          <Link2 size={12}/> Código
                        </button>
                        <button onClick={() => { setInviteClient(r); setInviteResult(null) }} disabled={busy} title="Enviar invitación por email"
                          className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 text-xs text-black/70 dark:text-white/70 hover:border-[#b3001e] hover:text-[#b3001e] inline-flex items-center gap-1 disabled:opacity-50">
                          <Mail size={12}/> Email
                        </button>
                      </>
                    )}
                    {canImpersonate && r.access_granted && r.shared_business_id && (
                      <button onClick={() => viewAsClient(r)} disabled={busy}
                        title="Ver el sistema como este cliente (modo solo-lectura, auditado)"
                        className="px-2.5 py-1 rounded-lg bg-black text-white text-xs font-bold inline-flex items-center gap-1 hover:bg-[#b3001e] dark:bg-white dark:text-black dark:hover:bg-[#b3001e] dark:hover:text-white disabled:opacity-50">
                        <Eye size={12}/> Ver como cliente
                      </button>
                    )}
                    <button onClick={() => generateYear(r)}
                      className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 text-xs text-black/70 dark:text-white/70 hover:border-[#b3001e] hover:text-[#b3001e]">
                      Generar {year}
                    </button>
                    <button onClick={() => setEditing(r)}
                      className="px-2.5 py-1 rounded-lg bg-black text-white text-xs hover:bg-[#b3001e] dark:bg-white dark:text-black dark:hover:bg-[#b3001e] dark:hover:text-white">
                      Editar
                    </button>
                    <button onClick={() => deleteClient(r)} disabled={busy} title="Eliminar (archivar) cliente"
                      className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 text-xs text-black/50 dark:text-white/50 hover:border-[#b3001e] hover:text-[#b3001e] inline-flex items-center gap-1 disabled:opacity-50">
                      <Trash2 size={12}/>
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <ClientModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={save}
          busy={busy}
          rncLookup={rncLookup}
          rncLoading={rncLoading}
        />
      )}

      {linkClient && (
        <AccessCodeModal
          client={linkClient}
          result={linkResult}
          busy={busy}
          onRegenerate={() => generateAccessCode(linkClient)}
          onClose={() => { setLinkClient(null); setLinkResult(null) }}
        />
      )}

      {inviteClient && (
        <InviteEmailModal
          client={inviteClient}
          result={inviteResult}
          busy={busy}
          onSend={sendEmailInvite}
          onClose={() => { setInviteClient(null); setInviteResult(null) }}
        />
      )}
    </div>
  )
}

function InviteEmailModal({ client, result, busy, onSend, onClose }) {
  const [email, setEmail] = useState('')
  const [businessName, setBusinessName] = useState(client?.nombre_comercial || '')
  const [copied, setCopied] = useState(false)
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  function copy() {
    if (!result?.magic_link) return
    navigator.clipboard?.writeText(result.magic_link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }
  function whatsappShare() {
    const msg = `Te invito a conectar tu Terminal X a mi contabilidad. Click aquí: ${result.magic_link}`
    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-black text-black dark:text-white text-base inline-flex items-center gap-2">
            <Mail size={16} className="text-[#b3001e]"/> Invitar por email
          </h2>
          <button onClick={onClose} className="text-black/50 dark:text-white/50 hover:text-[#b3001e]"><X size={18}/></button>
        </div>

        {!result && (
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-black/50 dark:text-white/50 mb-1">Email del cliente</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="cliente@ejemplo.com"
                className="w-full px-3 py-2 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-black text-sm text-black dark:text-white"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-black/50 dark:text-white/50 mb-1">Nombre del negocio (opcional)</label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Nombre Comercial SRL"
                className="w-full px-3 py-2 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-black text-sm text-black dark:text-white"
              />
            </div>
            <div className="text-[11px] text-black/60 dark:text-white/60 leading-relaxed">
              Le mandaremos un email con un link mágico. Cuando lo clickee, automáticamente quedará conectado a tu Portfolio y serás creado como usuario con rol <strong>Contador</strong> en su Terminal X. Vence en 7 días.
            </div>
            <button
              onClick={() => onSend({ email: email.trim(), business_name: businessName.trim() })}
              disabled={!valid || busy}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#b3001e] text-white text-sm font-bold hover:bg-[#8f0018] disabled:opacity-50"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              <Send size={14} /> Enviar invitación
            </button>
          </div>
        )}

        {result?.ok && (
          <div className="space-y-3">
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-700 dark:text-emerald-300 inline-flex items-start gap-2">
              <Check size={16} className="mt-0.5 shrink-0" />
              <div>
                {result.email?.sent
                  ? <>Email enviado a <strong>{result.invite_email}</strong>.</>
                  : <>Invitación creada. <strong>Email no enviado</strong> ({result.email?.reason || 'sin servicio'}) — usa el link de abajo.</>}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-black/50 dark:text-white/50 mb-1">Link de invitación</label>
              <div className="flex gap-2">
                <input value={result.magic_link} readOnly
                  className="flex-1 px-3 py-2 rounded-lg border border-black/15 dark:border-white/15 bg-black/5 dark:bg-white/5 text-[11px] font-mono text-black dark:text-white truncate"/>
                <button onClick={copy} className="px-3 py-2 rounded-lg bg-black text-white dark:bg-white dark:text-black text-xs font-bold inline-flex items-center gap-1">
                  {copied ? <><Check size={12}/> Copiado</> : <><Copy size={12}/> Copiar</>}
                </button>
              </div>
            </div>
            <button onClick={whatsappShare} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-black/15 dark:border-white/15 text-sm font-bold text-black/70 dark:text-white/70 hover:border-[#b3001e] hover:text-[#b3001e]">
              Compartir por WhatsApp
            </button>
            <div className="text-[11px] text-black/50 dark:text-white/50">
              Vence el {new Date(result.expires_at).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' })}.
            </div>
          </div>
        )}

        {result?.ok === false && (
          <div className="rounded-xl bg-[#b3001e]/10 border border-[#b3001e]/30 p-3 text-sm text-[#b3001e]">
            {result.error || 'No se pudo enviar la invitación.'}
          </div>
        )}

        <div className="flex justify-end mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-black/15 dark:border-white/15 text-sm">Cerrar</button>
        </div>
      </div>
    </div>
  )
}

function AccessCodeModal({ client, result, busy, onRegenerate, onClose }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    if (!result?.code) return
    navigator.clipboard?.writeText(result.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-black text-black dark:text-white text-base inline-flex items-center gap-2">
            <Link2 size={16} className="text-[#b3001e]"/> Conectar con cliente
          </h2>
          <button onClick={onClose} className="text-black/50 dark:text-white/50 hover:text-[#b3001e]"><X size={18}/></button>
        </div>
        <div className="text-sm text-black/70 dark:text-white/70 mb-3">
          <strong>{client.nombre_comercial}</strong>
        </div>
        {busy && <div className="text-sm text-[#b3001e] inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin"/> Generando código…</div>}
        {!busy && result?.code && (
          <>
            <div className="rounded-2xl border-2 border-[#b3001e] bg-[#b3001e]/5 p-4 text-center mb-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#b3001e] mb-2">Código de un solo uso</div>
              <div className="font-mono text-3xl font-black text-black dark:text-white tracking-widest mb-3 select-all">{result.code}</div>
              <button onClick={copy} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-black text-white dark:bg-white dark:text-black text-xs font-bold">
                {copied ? <><Check size={12}/> Copiado</> : <><Copy size={12}/> Copiar</>}
              </button>
            </div>
            <div className="text-xs text-black/70 dark:text-white/70 space-y-1">
              <p><strong>Pasos para el cliente:</strong></p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Iniciar sesión en su Terminal X.</li>
                <li>Ir a <strong>Configuración → Compartir con contador</strong>.</li>
                <li>Ingresar el código de 8 caracteres y confirmar.</li>
              </ol>
              <p className="text-[#b3001e] mt-2">Vence en 24 horas. Una vez aceptado, el código se invalida automáticamente.</p>
            </div>
          </>
        )}
        {!busy && !result && (
          <button onClick={onRegenerate} className="w-full px-4 py-2 rounded-lg bg-[#b3001e] text-white text-sm font-bold">
            Generar código
          </button>
        )}
        <div className="flex justify-end mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-black/15 dark:border-white/15 text-sm">Cerrar</button>
        </div>
      </div>
    </div>
  )
}

function ClientModal({ initial, onClose, onSave, busy, rncLookup, rncLoading }) {
  const [form, setForm] = useState({
    nombre_comercial: initial?.nombre_comercial || '',
    rnc: initial?.rnc || '',
    cedula: initial?.cedula || '',
    tipo_persona: initial?.tipo_persona || 'pj',
    regimen: initial?.regimen || 'ordinario',
    honorarios_mensuales: initial?.honorarios_mensuales || 0,
    anticipo_ingresos_brutos_previos: initial?.anticipo_ingresos_brutos_previos || 0,
    anticipo_isr_previo: initial?.anticipo_isr_previo || 0,
    anticipo_had_loss: initial?.anticipo_had_loss ? 1 : 0,
    anticipo_base_year: initial?.anticipo_base_year || (new Date().getFullYear() - 1),
    notes: initial?.notes || '',
  })

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleRncBlur() {
    if (!form.rnc || form.nombre_comercial) return
    const r = await rncLookup(form.rnc)
    if (r?.razon_social) set('nombre_comercial', r.razon_social)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-black border border-black/10 dark:border-white/10 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black text-black dark:text-white">
            {initial?.id ? 'Editar cliente' : 'Nuevo cliente'}
          </h2>
          <button onClick={onClose} className="text-black/50 dark:text-white/50 hover:text-[#b3001e]"><X size={18} /></button>
        </div>

        <div className="space-y-3 text-sm">
          <Field label="Nombre comercial">
            <input value={form.nombre_comercial} onChange={(e) => set('nombre_comercial', e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="RNC">
              <div className="relative">
                <input value={form.rnc} onChange={(e) => set('rnc', e.target.value)} onBlur={handleRncBlur}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white" />
                {rncLoading && <Loader2 size={12} className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-[#b3001e]" />}
              </div>
            </Field>
            <Field label="Cédula">
              <input value={form.cedula} onChange={(e) => set('cedula', e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo de persona">
              <select value={form.tipo_persona} onChange={(e) => set('tipo_persona', e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white">
                <option value="pj">Persona jurídica</option>
                <option value="pf">Persona física</option>
                <option value="eirl">EIRL</option>
              </select>
            </Field>
            <Field label="Régimen">
              <select value={form.regimen} onChange={(e) => set('regimen', e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white">
                <option value="ordinario">Ordinario</option>
                <option value="rst">RST</option>
                <option value="pst">PST</option>
                <option value="sin_operaciones">Sin operaciones</option>
              </select>
            </Field>
          </div>
          <Field label="Honorarios mensuales (RD$)">
            <input type="number" min="0" step="0.01"
              value={form.honorarios_mensuales}
              onChange={(e) => set('honorarios_mensuales', Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white" />
          </Field>

          {form.tipo_persona === 'pj' && form.regimen === 'ordinario' && (
            <div className="rounded-xl border border-[#b3001e]/30 bg-[#b3001e]/5 p-3 space-y-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-[#b3001e]">
                Anticipos ISR — base IR-2 año anterior (Art. 314 CT)
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Año fiscal base">
                  <input type="number" min="2000" max="2100" step="1"
                    value={form.anticipo_base_year}
                    onChange={(e) => set('anticipo_base_year', Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white" />
                </Field>
                <Field label="Pérdida fiscal año anterior">
                  <select value={form.anticipo_had_loss}
                    onChange={(e) => set('anticipo_had_loss', Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white">
                    <option value={0}>No</option>
                    <option value={1}>Sí — anticipo = 0</option>
                  </select>
                </Field>
              </div>
              <Field label="Ingresos brutos año anterior (RD$)">
                <input type="number" min="0" step="0.01"
                  value={form.anticipo_ingresos_brutos_previos}
                  disabled={form.anticipo_had_loss === 1}
                  onChange={(e) => set('anticipo_ingresos_brutos_previos', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white disabled:opacity-50" />
              </Field>
              <Field label="ISR liquidado año anterior (RD$)">
                <input type="number" min="0" step="0.01"
                  value={form.anticipo_isr_previo}
                  disabled={form.anticipo_had_loss === 1}
                  onChange={(e) => set('anticipo_isr_previo', Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white disabled:opacity-50" />
              </Field>
            </div>
          )}

          <Field label="Notas">
            <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/15 dark:border-white/15 text-black dark:text-white" />
          </Field>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-black/15 dark:border-white/15 text-sm text-black/70 dark:text-white/70 hover:border-[#b3001e]">Cancelar</button>
          <button disabled={busy || !form.nombre_comercial} onClick={() => onSave(form)}
            className="px-4 py-2 rounded-lg bg-[#b3001e] text-white text-sm font-bold disabled:opacity-50 hover:bg-[#c8002a]">
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wide text-black/50 dark:text-white/50 mb-1">{label}</label>
      {children}
    </div>
  )
}
