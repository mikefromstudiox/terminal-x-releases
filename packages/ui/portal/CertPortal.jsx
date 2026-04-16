import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
  Loader2, Upload, Send, Download, FileText, MessageSquare,
  CheckCircle2, XCircle, Clock, AlertCircle, Phone, ExternalLink,
  Shield, CreditCard, ChevronDown, ChevronUp, Award, ArrowUpRight
} from 'lucide-react'
import PortalStepTracker, { STEPS } from './PortalStepTracker'

// ---------------------------------------------------------------------------
// Client instructions per step
// ---------------------------------------------------------------------------
const CLIENT_INSTRUCTIONS = {
  1:  'Necesitamos que nos envie su RNC, nombre comercial y datos de contacto para iniciar la solicitud ante la DGII.',
  2:  'La DGII esta procesando su autorizacion. Le notificaremos cuando sea aprobada.',
  3:  'Estamos configurando su sistema. Si necesita instalar el certificado digital, suba el archivo .p12 aqui.',
  4:  'Etapa de pruebas de simulacion. Puede que necesitemos datos adicionales de su parte.',
  5:  'Necesitamos que apruebe el formato de impresion de sus comprobantes fiscales.',
  6:  'La DGII esta revisando su caso. Tiempo estimado: 3-5 dias habiles.',
  7:  'Estamos registrando las URLs de servicios de prueba. No requiere accion de su parte.',
  8:  'Iniciando pruebas de recepcion de e-CF. Puede que le pidamos datos adicionales.',
  9:  'Pruebas de recepcion en progreso. Los resultados apareceran debajo.',
  10: 'Iniciando pruebas de aprobacion comercial.',
  11: 'Pruebas de aprobacion comercial en progreso. Los resultados apareceran debajo.',
  12: 'Configurando URLs de produccion. No requiere accion de su parte.',
  13: 'Necesitamos que firme y suba la declaracion jurada. El documento se le enviara por correo o WhatsApp.',
  14: 'Verificacion final de estatus con la DGII.',
  15: 'Su certificacion esta completa. Ya puede emitir comprobantes fiscales electronicos (e-CF).',
}

const CLIENT_ACTION_STEPS = [1, 3, 5, 13]
const TEST_RESULT_STEPS = [4, 9, 10, 11]

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
const RED = '#b3001e'
const INK = '#0a0a0a'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDate(d) {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return d }
}
function formatDateTime(d) {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return d }
}

function StatusPill({ status }) {
  const map = {
    active:    { label: 'En Progreso', bg: `${RED}10`, fg: RED, ring: `${RED}25` },
    completed: { label: 'Completado',  bg: '#05966910', fg: '#059669', ring: '#05966925' },
    paused:    { label: 'Pausado',     bg: '#d9770610', fg: '#d97706', ring: '#d9770625' },
  }
  const s = map[status] || map.active
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em]"
      style={{ color: s.fg }}>
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.fg, boxShadow: `0 0 0 3px ${s.ring}` }} />
      {s.label}
    </span>
  )
}

function PackagePill({ pkg }) {
  const map = {
    asesoria:          'Asesoria',
    completa:          'Completa',
    completa_terminal: 'Completa + Terminal X',
  }
  return (
    <span className="inline-flex items-center px-3 py-1 rounded-md text-[11px] font-bold uppercase tracking-[0.1em] border"
      style={{ color: INK, borderColor: `${INK}15`, backgroundColor: `${INK}03` }}>
      {map[pkg] || pkg || 'N/A'}
    </span>
  )
}

function TestBadge({ status }) {
  if (status === 'passed' || status === 'aprobado')
    return <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600"><CheckCircle2 size={14} /> Aprobado</span>
  if (status === 'failed' || status === 'rechazado')
    return <span className="inline-flex items-center gap-1 text-xs font-bold" style={{ color: RED }}><XCircle size={14} /> Rechazado</span>
  return <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600"><Clock size={14} /> Pendiente</span>
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------
function SkeletonLoader() {
  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f5 100%)' }}>
      <div className="max-w-2xl mx-auto px-5 py-10 sm:py-16">
        <div className="animate-pulse space-y-5">
          <div className="h-8 w-40 bg-black/[0.04] rounded-lg" />
          <div className="h-4 w-64 bg-black/[0.04] rounded" />
          <div className="h-48 bg-black/[0.04] rounded-2xl" />
          <div className="h-64 bg-black/[0.04] rounded-2xl" />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------
function ErrorView({ message }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'linear-gradient(180deg, #fafafa 0%, #f5f5f5 100%)' }}>
      <div className="max-w-sm w-full text-center">
        <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6" style={{ backgroundColor: `${RED}08` }}>
          <AlertCircle size={36} style={{ color: RED }} />
        </div>
        <h1 className="text-xl font-black tracking-tight mb-2" style={{ color: INK }}>Enlace no valido</h1>
        <p className="text-sm leading-relaxed mb-8" style={{ color: `${INK}60` }}>
          {message || 'Este enlace de portal no es valido o ha expirado. Contacte a soporte para obtener un nuevo enlace.'}
        </p>
        <a href="https://wa.me/18098282971" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{ backgroundColor: INK }}>
          <Phone size={16} /> Contactar Soporte
        </a>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Upload Dropzone
// ---------------------------------------------------------------------------
function UploadZone({ token, onDone }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState(null)
  const ref = useRef(null)

  const upload = useCallback(async (files) => {
    if (!files?.length) return
    setUploading(true); setErr(null)
    try {
      const fd = new FormData()
      for (const f of files) fd.append('files', f)
      const res = await fetch(`/api/panel?action=cert_portal_upload&token=${token}`, { method: 'POST', body: fd })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Error al subir') }
      onDone?.()
    } catch (e) { setErr(e.message) }
    finally { setUploading(false) }
  }, [token, onDone])

  return (
    <div
      className={`relative rounded-xl border-2 border-dashed p-5 text-center transition-all duration-200 ${
        dragging ? 'border-[#b3001e] bg-[#b3001e]/[0.03] scale-[1.01]' : 'border-black/[0.08] hover:border-black/15'
      }`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files) }}
    >
      {uploading ? (
        <div className="flex flex-col items-center gap-2 py-2">
          <Loader2 size={22} className="animate-spin" style={{ color: RED }} />
          <p className="text-xs font-semibold" style={{ color: `${INK}50` }}>Subiendo...</p>
        </div>
      ) : (
        <>
          <Upload size={20} className="mx-auto mb-2" style={{ color: `${INK}20` }} />
          <p className="text-[13px] font-medium" style={{ color: `${INK}50` }}>Arrastre archivos o haga clic</p>
          <p className="text-[11px] mt-0.5" style={{ color: `${INK}25` }}>PDF, P12, JPG, PNG (max 10MB)</p>
          <input ref={ref} type="file" multiple className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            onChange={e => upload(e.target.files)} accept=".pdf,.p12,.pfx,.jpg,.jpeg,.png,.doc,.docx" />
        </>
      )}
      {err && <p className="text-xs mt-2 font-medium" style={{ color: RED }}>{err}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
function Messages({ messages = [], token, onSent }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length])

  async function send(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSending(true)
    try {
      const res = await fetch(`/api/panel?action=cert_portal_message&token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim() }),
      })
      if (!res.ok) throw new Error()
      setText(''); onSent?.()
    } catch {} finally { setSending(false) }
  }

  return (
    <div>
      <div className="space-y-3 max-h-[360px] overflow-y-auto mb-4 scroll-smooth" style={{ scrollbarWidth: 'thin' }}>
        {messages.length === 0 && (
          <p className="text-sm text-center py-8" style={{ color: `${INK}20` }}>No hay mensajes aun</p>
        )}
        {messages.map((msg, i) => {
          if (msg.type === 'system') return (
            <div key={i} className="flex justify-center">
              <p className="text-[11px] py-1 px-3 rounded-full" style={{ color: `${INK}30`, backgroundColor: `${INK}03` }}>
                {msg.text} {msg.date && <span style={{ color: `${INK}15` }}>— {formatDate(msg.date)}</span>}
              </p>
            </div>
          )
          const isClient = msg.type === 'client'
          return (
            <div key={i} className={`flex ${isClient ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] px-4 py-3 ${isClient
                ? 'rounded-2xl rounded-br-md text-white'
                : 'rounded-2xl rounded-bl-md'
              }`} style={{
                backgroundColor: isClient ? INK : `${INK}04`,
                color: isClient ? '#fff' : INK,
              }}>
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                <p className="text-[10px] mt-1.5" style={{ opacity: 0.4 }}>{formatDateTime(msg.date)}</p>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="flex gap-2">
        <input type="text" value={text} onChange={e => setText(e.target.value)}
          placeholder="Escriba un mensaje..."
          disabled={sending}
          className="flex-1 px-4 py-3 rounded-xl text-[13px] outline-none transition-all"
          style={{
            backgroundColor: `${INK}03`, border: `1px solid ${INK}08`,
            color: INK,
          }}
          onFocus={e => e.target.style.borderColor = `${RED}40`}
          onBlur={e => e.target.style.borderColor = `${INK}08`}
        />
        <button type="submit" disabled={sending || !text.trim()}
          className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-white transition-all hover:scale-105 active:scale-95 disabled:opacity-30"
          style={{ backgroundColor: RED }}>
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------
function Section({ title, icon: Icon, count, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#fff', border: `1px solid ${INK}06` }}>
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 text-left transition-colors"
        style={{ ':hover': { backgroundColor: `${INK}01` } }}>
        <div className="flex items-center gap-2.5">
          {Icon && <Icon size={16} style={{ color: `${INK}30` }} />}
          <span className="text-[13px] font-bold tracking-tight" style={{ color: INK }}>{title}</span>
          {count != null && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-md"
              style={{ color: `${INK}35`, backgroundColor: `${INK}04` }}>{count}</span>
          )}
        </div>
        {open
          ? <ChevronUp size={15} style={{ color: `${INK}20` }} />
          : <ChevronDown size={15} style={{ color: `${INK}20` }} />}
      </button>
      {open && <div className="px-6 pb-5">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Portal
// ---------------------------------------------------------------------------
export default function CertPortal() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/panel?action=cert_portal&token=${token}`)
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Portal no encontrado') }
      const json = await res.json()
      setData(json.data); setError(null)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => {
    if (!token) { setError('Token no proporcionado'); setLoading(false); return }
    load()
  }, [token, load])

  if (loading) return <SkeletonLoader />
  if (error || !data) return <ErrorView message={error} />

  const {
    business_name, rnc, package_type, status,
    current_step, steps_completed = [], step_dates = {},
    documents = [], messages = [], test_results = [],
    payment = {},
  } = data

  const currentStepInfo = STEPS.find(s => s.num === current_step)
  const showTests = TEST_RESULT_STEPS.includes(current_step) && test_results.length > 0
  const clientDocs = documents.filter(d => d.visible_to_client !== false)
  const completedPct = Math.round((steps_completed.length / 15) * 100)

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg, #fafafa 0%, #f3f3f3 50%, #f8f8f8 100%)' }}>

      {/* ── Top accent bar ── */}
      <div className="h-1" style={{ background: `linear-gradient(90deg, ${RED}, ${RED}80, ${RED}40, transparent)` }} />

      <div className="max-w-2xl mx-auto px-5 py-8 sm:py-14">

        {/* ── HEADER ── */}
        <header className="mb-8">
          {/* Brand mark */}
          <div className="flex items-center gap-1 mb-6">
            <span className="text-[13px] font-black tracking-[3px] uppercase" style={{ color: INK }}>TERMINAL</span>
            <span className="text-[13px] font-black" style={{ color: RED }}>X</span>
            <span className="mx-2 text-[10px]" style={{ color: `${INK}15` }}>|</span>
            <span className="text-[11px] font-bold uppercase tracking-[2px]" style={{ color: `${INK}30` }}>Certificacion e-CF</span>
          </div>

          {/* Business identity */}
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight leading-tight mb-2" style={{ color: INK }}>
            {business_name || 'Negocio'}
          </h1>
          {rnc && (
            <p className="text-[13px] font-medium mb-4" style={{ color: `${INK}35` }}>
              RNC {rnc}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={status} />
            <PackagePill pkg={package_type} />
          </div>
        </header>

        {/* ── PROGRESS CARD ── */}
        <div className="rounded-2xl p-6 sm:p-8 mb-5" style={{ backgroundColor: '#fff', border: `1px solid ${INK}06` }}>
          <PortalStepTracker
            currentStep={current_step}
            stepsCompleted={steps_completed}
            stepDates={step_dates}
          />
        </div>

        {/* ── CURRENT STEP ACTION ── */}
        {currentStepInfo && status !== 'completed' && (
          <div className="rounded-2xl p-6 sm:p-8 mb-5" style={{ backgroundColor: '#fff', border: `2px solid ${RED}18` }}>
            <div className="flex items-start gap-4 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${RED}08` }}>
                <span className="text-sm font-black" style={{ color: RED }}>{current_step}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] mb-1" style={{ color: RED }}>Paso Actual</p>
                <h2 className="text-[15px] font-bold tracking-tight mb-2" style={{ color: INK }}>{currentStepInfo.label}</h2>
                <p className="text-[13px] leading-relaxed" style={{ color: `${INK}55` }}>
                  {CLIENT_INSTRUCTIONS[current_step] || 'Estamos trabajando en este paso. Le notificaremos cuando haya novedades.'}
                </p>
              </div>
            </div>

            {CLIENT_ACTION_STEPS.includes(current_step) && (
              <div className="mt-5 pt-5" style={{ borderTop: `1px solid ${INK}06` }}>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] mb-3" style={{ color: `${INK}30` }}>
                  Subir Documentos
                </p>
                <UploadZone token={token} onDone={load} />
              </div>
            )}
          </div>
        )}

        {/* ── COMPLETED ── */}
        {status === 'completed' && (
          <div className="rounded-2xl p-8 sm:p-10 mb-5 text-center" style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#dcfce7' }}>
              <Award size={32} className="text-emerald-600" />
            </div>
            <h2 className="text-xl font-black tracking-tight text-emerald-800 mb-2">Certificacion Completada</h2>
            <p className="text-[13px] text-emerald-700/60 leading-relaxed max-w-sm mx-auto">
              Su negocio esta certificado como Emisor Electronico ante la DGII. Ya puede emitir comprobantes fiscales electronicos.
            </p>
          </div>
        )}

        {/* ── TEST RESULTS ── */}
        {showTests && (
          <div className="mb-5">
            <Section title="Resultados de Pruebas" icon={Shield} count={test_results.length}>
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${INK}06` }}>
                      <th className="text-left py-2.5 px-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: `${INK}30` }}>#</th>
                      <th className="text-left py-2.5 px-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: `${INK}30` }}>Prueba</th>
                      <th className="text-left py-2.5 px-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: `${INK}30` }}>Estado</th>
                      <th className="text-left py-2.5 px-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: `${INK}30` }}>Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {test_results.map((t, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${INK}04` }}>
                        <td className="py-3 px-2" style={{ color: `${INK}25` }}>{i + 1}</td>
                        <td className="py-3 px-2 font-medium" style={{ color: `${INK}80` }}>{t.name}</td>
                        <td className="py-3 px-2"><TestBadge status={t.status} /></td>
                        <td className="py-3 px-2 text-[11px]" style={{ color: `${INK}30` }}>{formatDate(t.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>
        )}

        {/* ── DOCUMENTS ── */}
        <div className="mb-5">
          <Section title="Documentos" icon={FileText} count={clientDocs.length}>
            {clientDocs.length === 0 ? (
              <p className="text-[13px] text-center py-6" style={{ color: `${INK}20` }}>No hay documentos disponibles</p>
            ) : (
              <div className="space-y-1.5">
                {clientDocs.map((doc, i) => (
                  <div key={i} className="flex items-center justify-between py-2.5 px-3 rounded-xl transition-colors"
                    style={{ backgroundColor: `${INK}02` }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = `${INK}04`}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = `${INK}02`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText size={15} style={{ color: `${INK}25` }} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium truncate" style={{ color: `${INK}80` }}>{doc.name}</p>
                        <p className="text-[11px]" style={{ color: `${INK}25` }}>
                          {doc.type && <span className="uppercase">{doc.type}</span>}
                          {doc.date && <span> — {formatDate(doc.date)}</span>}
                        </p>
                      </div>
                    </div>
                    {doc.url && (
                      <a href={doc.url} target="_blank" rel="noopener noreferrer"
                        className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:scale-110"
                        style={{ backgroundColor: `${INK}05` }}>
                        <Download size={13} style={{ color: `${INK}40` }} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${INK}06` }}>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] mb-3" style={{ color: `${INK}25` }}>
                Subir documento
              </p>
              <UploadZone token={token} onDone={load} />
            </div>
          </Section>
        </div>

        {/* ── MESSAGES ── */}
        <div className="mb-5">
          <Section title="Mensajes" icon={MessageSquare} count={messages.length}>
            <Messages messages={messages} token={token} onSent={load} />
          </Section>
        </div>

        {/* ── PAYMENT ── */}
        {payment && (payment.total || payment.status) && (
          <div className="mb-5">
            <Section title="Informacion de Pago" icon={CreditCard} defaultOpen={false}>
              <div className="grid grid-cols-2 gap-4">
                {payment.package_name && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: `${INK}25` }}>Paquete</p>
                    <p className="text-[13px] font-bold" style={{ color: INK }}>{payment.package_name}</p>
                  </div>
                )}
                {payment.total && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: `${INK}25` }}>Total</p>
                    <p className="text-[15px] font-black" style={{ color: INK }}>RD${Number(payment.total).toLocaleString('es-DO')}</p>
                  </div>
                )}
                {payment.paid != null && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: `${INK}25` }}>Pagado</p>
                    <p className="text-[15px] font-black text-emerald-600">RD${Number(payment.paid).toLocaleString('es-DO')}</p>
                  </div>
                )}
                {payment.status && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: `${INK}25` }}>Estado</p>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold ${
                      payment.status === 'paid' ? 'bg-emerald-50 text-emerald-700'
                      : payment.status === 'partial' ? 'bg-amber-50 text-amber-700'
                      : 'bg-red-50 text-red-700'
                    }`}>
                      {payment.status === 'paid' ? 'Pagado' : payment.status === 'partial' ? 'Parcial' : 'Pendiente'}
                    </span>
                  </div>
                )}
              </div>
            </Section>
          </div>
        )}

        {/* ── FOOTER ── */}
        <footer className="mt-12 mb-8 text-center">
          <div className="flex items-center justify-center gap-1 mb-4">
            <span className="text-[11px] font-black tracking-[2px] uppercase" style={{ color: `${INK}20` }}>TERMINAL</span>
            <span className="text-[11px] font-black" style={{ color: `${RED}40` }}>X</span>
          </div>
          <div className="flex items-center justify-center gap-5">
            <a href="https://wa.me/18098282971" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold transition-colors"
              style={{ color: `${INK}30` }}
              onMouseEnter={e => e.currentTarget.style.color = RED}
              onMouseLeave={e => e.currentTarget.style.color = `${INK}30`}>
              <Phone size={11} /> +1 (809) 828-2971
            </a>
            <a href="https://terminalxpos.com" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold transition-colors"
              style={{ color: `${INK}30` }}
              onMouseEnter={e => e.currentTarget.style.color = RED}
              onMouseLeave={e => e.currentTarget.style.color = `${INK}30`}>
              <ArrowUpRight size={11} /> terminalxpos.com
            </a>
          </div>
        </footer>
      </div>
    </div>
  )
}
