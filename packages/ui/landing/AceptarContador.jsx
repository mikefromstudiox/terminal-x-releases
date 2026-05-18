import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { Loader2, CheckCircle2, AlertTriangle, Briefcase, ArrowRight, LogIn } from 'lucide-react'
import logoImg from '../assets/logo.webp'

export default function AceptarContador({ supabase }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') || ''

  const [lookup, setLookup] = useState({ state: 'loading', data: null, error: null })
  const [session, setSession] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(null)

  useEffect(() => {
    if (!token) {
      setLookup({ state: 'error', data: null, error: 'token_missing' })
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/panel?action=ctb_invite_lookup&token=${encodeURIComponent(token)}`)
        const data = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok || !data.ok) {
          setLookup({ state: 'error', data: null, error: data.error || 'lookup_failed' })
          try { window.__txReportError?.(`invite_lookup_failed: ${data.error || r.status}`, { severity: 'warning', category: 'contabilidad.invite.lookup', extra: { token_prefix: token.slice(0, 6), status: r.status } }) } catch {}
        } else {
          setLookup({ state: 'ok', data, error: null })
        }
      } catch (err) {
        if (!cancelled) setLookup({ state: 'error', data: null, error: err.message })
        try { window.__txReportError?.(err, { severity: 'error', category: 'contabilidad.invite.lookup.exception', extra: { token_prefix: token.slice(0, 6) } }) } catch {}
      }
    })()
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (!cancelled) setSession(data?.session || null)
    })()
    return () => { cancelled = true }
  }, [supabase])

  async function handleAccept() {
    if (!session?.access_token) return
    setSubmitting(true)
    try {
      const r = await fetch('/api/panel?action=ctb_accept_invite_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ token }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data.ok) {
        const friendly = data.error === 'token_expired'
          ? 'La invitación venció. Pídele a tu contador que te envíe una nueva.'
          : data.error === 'token_not_found_or_consumed'
            ? 'Esta invitación ya fue usada o no existe.'
            : data.error === 'already_granted_to_other_business'
              ? 'Esta invitación ya fue aceptada por otra cuenta.'
              : data.error || 'No se pudo aceptar la invitación.'
        setLookup({ state: 'error', data: null, error: friendly })
        try { window.__txReportError?.(`invite_accept_failed: ${data.error || r.status}`, { severity: 'warning', category: 'contabilidad.invite.accept', extra: { token_prefix: token.slice(0, 6), status: r.status } }) } catch {}
        return
      }
      setSuccess(data)
    } catch (err) {
      setLookup({ state: 'error', data: null, error: err.message })
      try { window.__txReportError?.(err, { severity: 'error', category: 'contabilidad.invite.accept.exception', extra: { token_prefix: token.slice(0, 6) } }) } catch {}
    } finally {
      setSubmitting(false)
    }
  }

  function stashAndGo(target) {
    try { sessionStorage.setItem('tx_pending_invite_token', token) } catch {}
    navigate(target)
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <img src={logoImg} alt="Terminal X" className="h-10 w-auto" />
          <span className="text-white/40 text-sm">Invitación de contador</span>
        </div>

        {lookup.state === 'loading' && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 flex items-center gap-3">
            <Loader2 size={18} className="animate-spin text-[#b3001e]" />
            <span className="text-sm text-white/70">Verificando invitación…</span>
          </div>
        )}

        {lookup.state === 'error' && (
          <div className="rounded-2xl border border-[#b3001e]/40 bg-[#b3001e]/10 p-6">
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle size={20} className="text-[#b3001e]" />
              <div className="text-base font-bold">Invitación no válida</div>
            </div>
            <p className="text-sm text-white/70 leading-relaxed">
              {String(lookup.error || '').includes('token_expired') ? 'La invitación venció (válidas por 7 días). Pídele a tu contador que te envíe una nueva.'
                : String(lookup.error || '').includes('token_not_found') ? 'Esta invitación ya fue usada o no existe.'
                : String(lookup.error || '').includes('token_missing') ? 'No se encontró un código de invitación en el link.'
                : lookup.error}
            </p>
            <Link to="/" className="mt-4 inline-flex items-center gap-1 text-xs text-white/60 hover:text-white">
              ← Volver al inicio
            </Link>
          </div>
        )}

        {lookup.state === 'ok' && !success && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-[#b3001e] flex items-center justify-center shrink-0">
                <Briefcase size={22} className="text-white" />
              </div>
              <div className="min-w-0">
                <div className="text-base font-bold truncate">{lookup.data.firm_name || 'Tu contador'}</div>
                <div className="text-xs text-white/50">quiere conectarse a tu Terminal X</div>
              </div>
            </div>

            <div className="text-sm text-white/70 leading-relaxed mb-4">
              Aceptando esta invitación, tu contador podrá:
            </div>
            <ul className="text-sm text-white/80 space-y-2 mb-6">
              <li className="flex items-start gap-2">
                <CheckCircle2 size={14} className="text-emerald-400 mt-1 shrink-0" />
                <span>Ver tus ventas, e-CFs e inventario en vivo desde su Portfolio</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 size={14} className="text-emerald-400 mt-1 shrink-0" />
                <span>Entrar a tu POS como usuario con rol <strong>Contador</strong></span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 size={14} className="text-emerald-400 mt-1 shrink-0" />
                <span>Lo puedes <strong>revocar cuando quieras</strong> desde Admin → Mi Contador</span>
              </li>
            </ul>

            {session ? (
              <button
                onClick={handleAccept}
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[#b3001e] text-white text-sm font-bold hover:bg-[#8f0018] disabled:opacity-50"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                Aceptar invitación <ArrowRight size={14} />
              </button>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={() => stashAndGo('/pos')}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[#b3001e] text-white text-sm font-bold hover:bg-[#8f0018]"
                >
                  <LogIn size={14} /> Inicia sesión para aceptar
                </button>
                <button
                  onClick={() => stashAndGo('/signup')}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-white/15 text-white text-sm font-bold hover:bg-white/5"
                >
                  Crear cuenta Terminal X
                </button>
              </div>
            )}

            <p className="mt-4 text-[11px] text-white/40 text-center">
              Esta invitación vence en 7 días. Acceso revocable en cualquier momento.
            </p>
          </div>
        )}

        {success && (
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-6 text-center">
            <CheckCircle2 size={48} className="text-emerald-400 mx-auto mb-3" />
            <div className="text-base font-bold mb-1">¡Conectado!</div>
            <p className="text-sm text-white/70 mb-1">
              <strong>{success.firm_name}</strong> ya puede ver tu Terminal X.
            </p>
            {success.staff_user_created && (
              <p className="text-xs text-white/50 mb-4">
                También fue creado como usuario con rol Contador en tu sistema.
              </p>
            )}
            <button
              onClick={() => navigate('/pos')}
              className="mt-4 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-white text-black text-sm font-bold hover:bg-white/90"
            >
              Ir a mi POS <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
