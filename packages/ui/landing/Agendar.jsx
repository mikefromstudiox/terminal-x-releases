/**
 * Agendar.jsx — Public salon booking page (no auth).
 *
 * Flow:
 *   /agendar/:slug
 *   1. GET ?action=salon-public-booking-info&slug=...&date=...
 *      → business name, services, stylists, available_slots
 *   2. User picks: service → stylist (or "cualquiera") → date → slot
 *   3. Form: name + WhatsApp phone (DR mask)
 *   4. hCaptcha widget (VITE_HCAPTCHA_SITEKEY; falls back to 'dev' token)
 *   5. POST ?action=salon-public-booking-create
 *   6. Confirmation screen
 *
 * Brand: black background, white text, crimson #b3001e accents. Mobile-first.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
  Scissors, Calendar, Clock, User, Check, ChevronRight, ChevronLeft,
  Loader2, AlertCircle, Phone, X, ArrowRight, MapPin,
} from 'lucide-react'

const HCAPTCHA_SITEKEY = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_HCAPTCHA_SITEKEY) || ''

// ── Helpers ────────────────────────────────────────────────────────────────

// v2.16.1 patch (#6) — local YYYY-MM-DD, never `toISOString()`. After 8 PM
// DR-local the UTC string rolls to "tomorrow" and the public booking page
// silently lost "today" as a slot.
function localDateStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayStr() { return localDateStr() }

function nextNDays(n) {
  const out = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = 0; i < n; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    out.push({
      iso: localDateStr(d),
      day: d.toLocaleDateString('es-DO', { weekday: 'short' }),
      num: d.getDate(),
      month: d.toLocaleDateString('es-DO', { month: 'short' }),
      label: i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : null,
    })
  }
  return out
}

function maskPhoneDR(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 11)
  // Always force +1 prefix
  let d = digits.startsWith('1') ? digits : `1${digits}`
  d = d.slice(0, 11)
  const area = d.slice(1, 4)
  const mid  = d.slice(4, 7)
  const end  = d.slice(7, 11)
  let out = '+1'
  if (area) out += ` ${area}`
  if (mid)  out += ` ${mid}`
  if (end)  out += ` ${end}`
  return out
}

function digitsOnly(s) { return String(s || '').replace(/\D/g, '') }

// ── hCaptcha widget (lightweight wrapper) ──────────────────────────────────

function HCaptchaWidget({ onToken, onError }) {
  const ref = useRef(null)
  const widgetIdRef = useRef(null)

  useEffect(() => {
    if (!HCAPTCHA_SITEKEY) {
      // Dev fallback — auto-emit a 'dev' token immediately so the form works
      onToken('dev')
      return
    }
    let cancelled = false

    function render() {
      if (cancelled || !ref.current || !window.hcaptcha) return
      try {
        widgetIdRef.current = window.hcaptcha.render(ref.current, {
          sitekey: HCAPTCHA_SITEKEY,
          theme: 'dark',
          callback: (token) => onToken(token),
          'error-callback': () => onError?.('error'),
          'expired-callback': () => onToken(''),
        })
      } catch (e) { onError?.(e?.message || 'render_failed') }
    }

    if (window.hcaptcha) {
      render()
    } else {
      const existing = document.querySelector('script[data-hcaptcha]')
      if (!existing) {
        const s = document.createElement('script')
        s.src = 'https://js.hcaptcha.com/1/api.js?render=explicit'
        s.async = true
        s.defer = true
        s.dataset.hcaptcha = 'true'
        s.onload = render
        document.head.appendChild(s)
      } else {
        existing.addEventListener('load', render)
      }
    }
    return () => { cancelled = true }
  }, [onToken, onError])

  if (!HCAPTCHA_SITEKEY) {
    return <p className="text-[10px] text-white/30 italic">hCaptcha (dev mode — auto-passed)</p>
  }
  return <div ref={ref} className="flex justify-center" />
}

// ── Steps ──────────────────────────────────────────────────────────────────

const STEPS = [
  { key: 'service', label: 'Servicio' },
  { key: 'stylist', label: 'Estilista' },
  { key: 'date',    label: 'Fecha' },
  { key: 'slot',    label: 'Hora' },
  { key: 'form',    label: 'Datos' },
]

// ── Main component ─────────────────────────────────────────────────────────

export default function Agendar() {
  const { slug } = useParams()

  // Data
  const [info, setInfo]       = useState(null) // { business_name, services, stylists, available_slots }
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null) // { code, message }
  const [date, setDate]       = useState(todayStr())

  // Selection
  const [step, setStep]               = useState(0)
  const [serviceId, setServiceId]     = useState(null)
  const [stylistId, setStylistId]     = useState('any') // 'any' or supabase_id
  const [slotTime, setSlotTime]       = useState(null)
  const [slotEmpId, setSlotEmpId]     = useState(null) // resolved when 'any' is chosen

  // Form
  const [name, setName]   = useState('')
  const [phone, setPhone] = useState('+1 ')
  const [hToken, setHToken] = useState('')

  // Submission
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr]   = useState('')
  const [success, setSuccess]       = useState(false)

  const days = useMemo(() => nextNDays(14), [])

  // Load info on slug + date + service change.
  // v2.16.2 (Fix 3) — once a service is picked, re-fetch slots with
  // service_supabase_id so the API blocks slots that would overlap the real
  // duration (60min masaje no longer leaves 10:30 abierto).
  const loadInfo = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const svcParam = serviceId ? `&service_supabase_id=${encodeURIComponent(serviceId)}` : ''
      const r = await fetch(`/api/panel?action=salon-public-booking-info&slug=${encodeURIComponent(slug)}&date=${encodeURIComponent(date)}${svcParam}`)
      if (r.status === 404) {
        const j = await r.json().catch(() => ({}))
        setError({ code: 404, message: j?.error || 'not_found' })
        setInfo(null)
      } else if (r.status === 429) {
        setError({ code: 429, message: 'rate_limited' })
        setInfo(null)
      } else if (!r.ok) {
        setError({ code: r.status, message: 'server_error' })
        setInfo(null)
      } else {
        const j = await r.json()
        setInfo(j)
      }
    } catch (e) {
      setError({ code: 0, message: 'network' })
    }
    setLoading(false)
  }, [slug, date, serviceId])

  useEffect(() => { loadInfo() }, [loadInfo])

  // Filter slots by selected stylist + service
  const filteredSlots = useMemo(() => {
    if (!info?.available_slots) return []
    let slots = info.available_slots
    if (stylistId && stylistId !== 'any') {
      slots = slots.filter(s => s.empleado_supabase_id === stylistId)
    }
    // Dedupe by time, keep first stylist
    const seen = new Set()
    const out = []
    for (const s of slots) {
      if (seen.has(s.time)) continue
      seen.add(s.time)
      out.push(s)
    }
    return out.sort((a, b) => a.time.localeCompare(b.time))
  }, [info, stylistId])

  function pickService(id) { setServiceId(id); setStep(1) }
  function pickStylist(id) { setStylistId(id); setStep(2); setSlotTime(null); setSlotEmpId(null) }
  function pickDate(iso)   { setDate(iso); setStep(3); setSlotTime(null); setSlotEmpId(null) }
  function pickSlot(s)     { setSlotTime(s.time); setSlotEmpId(s.empleado_supabase_id); setStep(4) }

  function handlePhone(v) {
    const masked = maskPhoneDR(v)
    setPhone(masked)
  }

  async function submit(e) {
    e.preventDefault()
    setSubmitErr('')
    if (!name.trim()) { setSubmitErr('Tu nombre es requerido'); return }
    if (digitsOnly(phone).length < 10) { setSubmitErr('WhatsApp requerido (mínimo 10 dígitos)'); return }
    if (!hToken) { setSubmitErr('Completa la verificación de seguridad'); return }
    if (!serviceId || !slotTime || !slotEmpId) { setSubmitErr('Selección incompleta'); return }

    setSubmitting(true)
    try {
      const r = await fetch('/api/panel?action=salon-public-booking-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          service_supabase_id: serviceId,
          empleado_supabase_id: slotEmpId,
          date,
          start_time: slotTime,
          client_name: name.trim(),
          client_phone: digitsOnly(phone),
          hcaptcha_token: hToken,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        // v2.16.2 — centralised Spanish error mapping. Backend ships enum
        // codes; the user must never see them raw.
        const ERROR_COPY = {
          slot_taken:         'Ese horario ya fue tomado. Intenta otro.',
          captcha_failed:     'Verificación fallida. Intenta de nuevo.',
          rate_limited:       'Demasiados intentos. Espera 1 minuto.',
          business_not_found: 'No encontramos este salón.',
          not_enabled:        'Las reservas online están desactivadas.',
          service_not_found:  'Servicio no disponible.',
          stylist_not_found:  'Estilista no disponible.',
          invalid_phone:      'Teléfono inválido.',
        }
        const fallback = 'No se pudo agendar. Intenta más tarde.'
        if (r.status === 429) setSubmitErr(ERROR_COPY.rate_limited)
        else setSubmitErr(ERROR_COPY[j?.error] || fallback)
        setSubmitting(false)
        return
      }
      setSuccess(true)
    } catch {
      setSubmitErr('Error de red. Verifica tu conexión.')
    }
    setSubmitting(false)
  }

  // ── 404 / error states ────────────────────────────────────────────────
  if (!loading && error?.code === 404) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-[#b3001e]/20 flex items-center justify-center mb-5">
          <AlertCircle size={28} className="text-[#b3001e]" />
        </div>
        <h1 className="text-[20px] font-bold mb-2">Salón no encontrado</h1>
        <p className="text-white/60 text-[14px] max-w-sm">
          Esta URL no corresponde a ningún salón activo. Verifica el enlace que recibiste.
        </p>
      </div>
    )
  }

  if (!loading && error?.code === 429) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center mb-5">
          <Clock size={28} className="text-amber-400" />
        </div>
        <h1 className="text-[20px] font-bold mb-2">Muchos intentos</h1>
        <p className="text-white/60 text-[14px] max-w-sm">Intenta de nuevo en un minuto.</p>
      </div>
    )
  }

  if (!loading && error) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 text-center">
        <AlertCircle size={28} className="text-[#b3001e] mb-4" />
        <h1 className="text-[18px] font-bold mb-2">Algo salió mal</h1>
        <p className="text-white/60 text-[13px] mb-5">{error.message}</p>
        <button onClick={loadInfo} className="px-5 py-2 bg-[#b3001e] hover:bg-[#8c0017] rounded-lg text-[13px] font-bold transition-colors">
          Reintentar
        </button>
      </div>
    )
  }

  // ── Success screen ───────────────────────────────────────────────────
  if (success) {
    const slotLabel = `${date} ${slotTime}`
    const stylistName = info?.stylists?.find(s => s.supabase_id === slotEmpId)?.name || 'Cualquier estilista'
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 text-center">
        <div className="w-20 h-20 rounded-full bg-[#b3001e] flex items-center justify-center mb-6 animate-pulse">
          <Check size={36} className="text-white" strokeWidth={3} />
        </div>
        <h1 className="text-[22px] md:text-[26px] font-bold mb-2">¡Cita confirmada!</h1>
        <p className="text-white/70 text-[14px] mb-6 max-w-sm">
          Te enviamos una confirmación por WhatsApp al {phone}. Recibirás un recordatorio 24h y 2h antes de tu cita.
        </p>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 max-w-sm w-full space-y-2 text-left">
          <Row icon={Scissors} label={info?.business_name} />
          <Row icon={Calendar} label={slotLabel} />
          <Row icon={User} label={stylistName} />
        </div>
        <p className="text-white/30 text-[11px] mt-8">Studio X · Terminal X POS</p>
      </div>
    )
  }

  // ── Loading ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-2 border-white/10" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#b3001e] animate-spin" />
        </div>
        <div className="text-white/60 text-[12px] tracking-wider uppercase font-semibold">Cargando…</div>
      </div>
    )
  }

  // ── Main flow ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-5 py-5">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          {info?.business_logo ? (
            <img src={info.business_logo} alt="" className="w-10 h-10 rounded-xl object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-[#b3001e] flex items-center justify-center">
              <Scissors size={18} className="text-white" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-[16px] font-bold truncate">{info?.business_name || 'Salón'}</h1>
            <p className="text-[11px] text-white/50">Reserva tu cita</p>
          </div>
        </div>
      </header>

      {/* Step indicator */}
      <div className="border-b border-white/10 px-5 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-1.5 overflow-x-auto">
          {STEPS.map((s, i) => {
            const done = i < step
            const active = i === step
            return (
              <button key={s.key} disabled={i > step}
                onClick={() => i < step && setStep(i)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                  active ? 'bg-[#b3001e] text-white'
                  : done ? 'bg-white/10 text-white/70 hover:bg-white/15'
                  : 'text-white/30'
                }`}>
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${
                  done ? 'bg-white/20' : active ? 'bg-white text-[#b3001e]' : 'bg-white/10'
                }`}>
                  {done ? <Check size={9} /> : i + 1}
                </span>
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Body */}
      <main className="flex-1 px-5 py-6">
        <div className="max-w-2xl mx-auto">

          {/* Step 0: Service */}
          {step === 0 && (
            <Section title="Elige un servicio" subtitle="Tu cita se reservará por la duración de este servicio.">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(info?.services || []).map(s => (
                  <button key={s.supabase_id} onClick={() => pickService(s.supabase_id)}
                    className={`text-left p-4 rounded-2xl border-2 transition-colors ${
                      serviceId === s.supabase_id
                        ? 'bg-[#b3001e]/10 border-[#b3001e]'
                        : 'bg-white/5 border-white/10 hover:border-white/30'
                    }`}>
                    <p className="font-bold text-[14px]">{s.name}</p>
                    <div className="flex items-center justify-between mt-2 text-[11px]">
                      <span className="text-white/50 flex items-center gap-1"><Clock size={11} /> {s.duration_min} min</span>
                      <span className="font-bold text-[#b3001e]">RD$ {Number(s.price).toLocaleString('en-US')}</span>
                    </div>
                  </button>
                ))}
                {(info?.services || []).length === 0 && (
                  <p className="text-white/40 text-[13px] col-span-full text-center py-8">Sin servicios disponibles.</p>
                )}
              </div>
            </Section>
          )}

          {/* Step 1: Stylist */}
          {step === 1 && (
            <Section title="Elige un estilista" subtitle="O deja que asignemos al primero disponible.">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <button onClick={() => pickStylist('any')}
                  className={`p-4 rounded-2xl border-2 transition-colors flex flex-col items-center gap-2 ${
                    stylistId === 'any' ? 'bg-[#b3001e]/10 border-[#b3001e]' : 'bg-white/5 border-white/10 hover:border-white/30'
                  }`}>
                  <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
                    <User size={22} className="text-white/60" />
                  </div>
                  <p className="text-[12px] font-bold">Cualquiera</p>
                </button>
                {(info?.stylists || []).map(st => (
                  <button key={st.supabase_id} onClick={() => pickStylist(st.supabase_id)}
                    className={`p-4 rounded-2xl border-2 transition-colors flex flex-col items-center gap-2 ${
                      stylistId === st.supabase_id ? 'bg-[#b3001e]/10 border-[#b3001e]' : 'bg-white/5 border-white/10 hover:border-white/30'
                    }`}>
                    {st.photo ? (
                      <img src={st.photo} alt="" className="w-14 h-14 rounded-full object-cover" />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-[#b3001e]/20 flex items-center justify-center text-[16px] font-bold text-[#b3001e]">
                        {(st.name || '?')[0].toUpperCase()}
                      </div>
                    )}
                    <p className="text-[12px] font-bold text-center truncate w-full">{st.name}</p>
                  </button>
                ))}
              </div>
            </Section>
          )}

          {/* Step 2: Date */}
          {step === 2 && (
            <Section title="Elige una fecha" subtitle="Próximos 14 días.">
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                {days.map(d => (
                  <button key={d.iso} onClick={() => pickDate(d.iso)}
                    className={`p-3 rounded-xl border-2 transition-colors text-center ${
                      date === d.iso ? 'bg-[#b3001e]/10 border-[#b3001e]' : 'bg-white/5 border-white/10 hover:border-white/30'
                    }`}>
                    <p className="text-[10px] uppercase text-white/50 font-bold">{d.label || d.day}</p>
                    <p className="text-[18px] font-bold mt-0.5">{d.num}</p>
                    <p className="text-[10px] text-white/40 capitalize">{d.month}</p>
                  </button>
                ))}
              </div>
            </Section>
          )}

          {/* Step 3: Slot */}
          {step === 3 && (
            <Section title="Elige una hora" subtitle="Solo se muestran horarios disponibles.">
              {filteredSlots.length === 0 ? (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-center">
                  <Clock size={24} className="text-white/30 mx-auto mb-3" />
                  <p className="text-[13px] text-white/60 mb-3">No hay horarios disponibles para este día.</p>
                  <button onClick={() => setStep(2)} className="px-4 py-2 bg-[#b3001e] hover:bg-[#8c0017] rounded-lg text-[12px] font-bold transition-colors">
                    Elegir otro día
                  </button>
                </div>
              ) : (() => {
                // v2.16.2 (item #6) — group by mañana/tarde/noche so a 12-hour
                // day with 24 slots doesn't render as a wall of identical
                // tiles. Sticky headers on mobile so the section label stays
                // visible while scrolling.
                const groups = [
                  { key: 'morning',   label: 'Mañana',  match: h => h >= 0  && h <= 11 },
                  { key: 'afternoon', label: 'Tarde',   match: h => h >= 12 && h <= 17 },
                  { key: 'night',     label: 'Noche',   match: h => h >= 18 && h <= 23 },
                ].map(g => ({
                  ...g,
                  slots: filteredSlots.filter(s => {
                    const h = parseInt(String(s.time || '').split(':')[0], 10)
                    return Number.isFinite(h) && g.match(h)
                  }),
                })).filter(g => g.slots.length > 0)
                return (
                  <div className="space-y-5">
                    {groups.map(g => (
                      <div key={g.key}>
                        <div className="sticky top-0 z-10 bg-black/95 backdrop-blur-sm py-2 mb-2 flex items-center gap-3">
                          <span className="text-[11px] font-bold text-white/70 uppercase tracking-wider">{g.label}</span>
                          <span className="text-[10px] text-white/40">{g.slots.length}</span>
                          <div className="flex-1 h-px bg-[#b3001e]/40" />
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                          {g.slots.map(s => (
                            <button key={`${s.empleado_supabase_id}-${s.time}`} onClick={() => pickSlot(s)}
                              className={`py-3 rounded-xl border-2 transition-colors font-mono font-bold text-[14px] ${
                                slotTime === s.time ? 'bg-[#b3001e]/10 border-[#b3001e] text-[#b3001e]'
                                  : 'bg-white/5 border-white/10 hover:border-white/30'
                              }`}>
                              {s.time}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </Section>
          )}

          {/* Step 4: Form */}
          {step === 4 && (
            <Section title="Tus datos" subtitle="Recibirás confirmación y recordatorios por WhatsApp.">
              <form onSubmit={submit} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-white/50 uppercase tracking-wider mb-1.5">
                    Nombre completo
                  </label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)}
                    placeholder="Maritza Pérez" required maxLength={120}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-[14px] text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#b3001e]/40 focus:border-[#b3001e]" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-white/50 uppercase tracking-wider mb-1.5">
                    WhatsApp
                  </label>
                  <div className="relative">
                    <Phone size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
                    <input type="tel" value={phone} onChange={e => handlePhone(e.target.value)}
                      placeholder="+1 809 555 0123" required inputMode="tel"
                      className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-[14px] text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#b3001e]/40 focus:border-[#b3001e]" />
                  </div>
                </div>

                {/* Booking summary */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-[12px] space-y-1.5">
                  <Row icon={Scissors} label={info?.services?.find(s => s.supabase_id === serviceId)?.name || '—'} />
                  <Row icon={User} label={info?.stylists?.find(st => st.supabase_id === slotEmpId)?.name || 'Cualquier estilista'} />
                  <Row icon={Calendar} label={`${date} · ${slotTime}`} />
                </div>

                {/* hCaptcha */}
                <div className="py-2">
                  <HCaptchaWidget onToken={setHToken} onError={() => setHToken('')} />
                </div>

                {submitErr && (
                  <div className="bg-[#b3001e]/20 border border-[#b3001e]/50 rounded-xl p-3 flex items-start gap-2">
                    <AlertCircle size={14} className="text-[#b3001e] mt-0.5 shrink-0" />
                    <p className="text-[12px] text-[#ff7a8c]">{submitErr}</p>
                  </div>
                )}

                <button type="submit" disabled={submitting || !hToken}
                  className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#b3001e] hover:bg-[#8c0017] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-[14px] font-bold transition-colors">
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  {submitting ? 'Confirmando...' : 'Confirmar Cita'}
                </button>
              </form>
            </Section>
          )}

          {/* Back button */}
          {step > 0 && step < 5 && !success && (
            <button onClick={() => setStep(s => Math.max(0, s - 1))}
              className="mt-6 flex items-center gap-1.5 text-white/50 hover:text-white text-[12px] transition-colors">
              <ChevronLeft size={14} /> Atrás
            </button>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 px-5 py-4 mt-auto">
        <p className="text-center text-[10px] text-white/30 tracking-wider">
          POWERED BY <span className="text-[#b3001e] font-bold">TERMINAL X</span> · STUDIO X
        </p>
      </footer>
    </div>
  )
}

// ── Tiny presentational helpers ────────────────────────────────────────────

function Section({ title, subtitle, children }) {
  return (
    <div>
      <h2 className="text-[18px] md:text-[20px] font-bold mb-1">{title}</h2>
      {subtitle && <p className="text-[12px] text-white/50 mb-5">{subtitle}</p>}
      {children}
    </div>
  )
}

function Row({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-2 text-white/80">
      <Icon size={13} className="text-[#b3001e] shrink-0" />
      <span className="text-[12px] truncate">{label}</span>
    </div>
  )
}
