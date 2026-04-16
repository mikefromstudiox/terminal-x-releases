import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
  Loader2, Upload, Send, Download, FileText, MessageSquare,
  CheckCircle2, XCircle, Clock, AlertCircle, Phone, ExternalLink,
  Shield, CreditCard, ChevronDown, ChevronUp
} from 'lucide-react'
import xMark from '@/assets/x-mark.webp'
import PortalStepTracker, { STEPS } from './PortalStepTracker'

// ---------------------------------------------------------------------------
// Client instructions per step — what the CLIENT needs to do at each stage
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

// Steps where client action might be needed
const CLIENT_ACTION_STEPS = [1, 3, 5, 13]
// Steps that show test results
const TEST_RESULT_STEPS = [4, 9, 10, 11]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function statusBadge(status) {
  const map = {
    active:    { label: 'Activo',     cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    completed: { label: 'Completado', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    paused:    { label: 'Pausado',    cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    cancelled: { label: 'Cancelado',  cls: 'bg-red-50 text-red-700 border-red-200' },
    pending:   { label: 'Pendiente',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  }
  const s = map[status] || map.pending
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>{s.label}</span>
}

function packageBadge(pkg) {
  const map = {
    asesoria:          { label: 'Asesoria',              cls: 'bg-black/5 text-black border-black/10' },
    completa:          { label: 'Completa',              cls: 'bg-[#b3001e]/5 text-[#b3001e] border-[#b3001e]/20' },
    completa_terminal: { label: 'Completa + Terminal X', cls: 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/30 font-semibold' },
  }
  const p = map[pkg] || { label: pkg || 'N/A', cls: 'bg-black/5 text-black border-black/10' }
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${p.cls}`}>{p.label}</span>
}

function paymentBadge(status) {
  const map = {
    paid:    { label: 'Pagado',   cls: 'text-emerald-700 bg-emerald-50' },
    partial: { label: 'Parcial',  cls: 'text-amber-700 bg-amber-50' },
    pending: { label: 'Pendiente', cls: 'text-red-700 bg-red-50' },
  }
  const s = map[status] || map.pending
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.cls}`}>{s.label}</span>
}

function testStatusBadge(status) {
  if (status === 'passed' || status === 'aprobado')
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 size={14} /> Aprobado</span>
  if (status === 'failed' || status === 'rechazado')
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700"><XCircle size={14} /> Rechazado</span>
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><Clock size={14} /> Pendiente</span>
}

function formatDate(d) {
  if (!d) return ''
  try {
    return new Date(d).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return d }
}

function formatDateTime(d) {
  if (!d) return ''
  try {
    return new Date(d).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return d }
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------
function SkeletonLoader() {
  return (
    <div className="min-h-screen bg-[#f8f8f8]">
      <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
        {/* Header skeleton */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-black/5 mb-6 animate-pulse">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-black/5 rounded-full" />
            <div className="h-6 w-48 bg-black/5 rounded" />
          </div>
          <div className="h-4 w-64 bg-black/5 rounded mb-3" />
          <div className="h-4 w-40 bg-black/5 rounded mb-4" />
          <div className="flex gap-2">
            <div className="h-6 w-20 bg-black/5 rounded-full" />
            <div className="h-6 w-16 bg-black/5 rounded-full" />
          </div>
        </div>
        {/* Steps skeleton */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-black/5 mb-6 animate-pulse">
          <div className="h-2 w-full bg-black/5 rounded-full mb-8" />
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex gap-3 mb-4">
              <div className="w-8 h-8 bg-black/5 rounded-full shrink-0" />
              <div className="h-4 w-40 bg-black/5 rounded mt-1" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Error view
// ---------------------------------------------------------------------------
function ErrorView({ message }) {
  return (
    <div className="min-h-screen bg-[#f8f8f8] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-8 sm:p-10 max-w-md w-full text-center shadow-sm border border-black/5">
        <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-5">
          <AlertCircle size={32} className="text-[#b3001e]" />
        </div>
        <h1 className="text-xl font-bold text-black mb-2">Enlace no valido</h1>
        <p className="text-sm text-black/50 mb-6">{message || 'Este enlace de portal no es valido o ha expirado. Contacte a soporte para obtener un nuevo enlace.'}</p>
        <a
          href="https://wa.me/18098282971"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-6 py-3 bg-black text-white rounded-xl text-sm font-semibold hover:bg-black/80 transition-colors"
        >
          <Phone size={16} />
          Contactar Soporte
        </a>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Upload Dropzone
// ---------------------------------------------------------------------------
function UploadDropzone({ token, onUploadComplete }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const fileRef = useRef(null)

  const handleFiles = useCallback(async (files) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadError(null)
    try {
      const formData = new FormData()
      for (const f of files) {
        formData.append('files', f)
      }
      const res = await fetch(`/api/panel?action=cert_portal_upload&token=${token}`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error al subir archivo')
      }
      if (onUploadComplete) onUploadComplete()
    } catch (e) {
      setUploadError(e.message)
    } finally {
      setUploading(false)
    }
  }, [token, onUploadComplete])

  return (
    <div
      className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
        dragging ? 'border-[#b3001e] bg-[#b3001e]/5' : 'border-black/10 hover:border-black/20'
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
    >
      {uploading ? (
        <div className="flex flex-col items-center gap-2">
          <Loader2 size={24} className="animate-spin text-[#b3001e]" />
          <p className="text-sm text-black/50">Subiendo...</p>
        </div>
      ) : (
        <>
          <Upload size={24} className="mx-auto text-black/30 mb-2" />
          <p className="text-sm text-black/60 mb-1">Arrastre archivos aqui o haga clic para seleccionar</p>
          <p className="text-xs text-black/30">PDF, P12, JPG, PNG (max 10MB)</p>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            onChange={(e) => handleFiles(e.target.files)}
            accept=".pdf,.p12,.pfx,.jpg,.jpeg,.png,.doc,.docx"
          />
        </>
      )}
      {uploadError && (
        <p className="text-xs text-red-600 mt-2">{uploadError}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Messages Section
// ---------------------------------------------------------------------------
function MessagesSection({ messages = [], token, onMessageSent }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function handleSend(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSending(true)
    try {
      const res = await fetch(`/api/panel?action=cert_portal_message&token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim() }),
      })
      if (!res.ok) throw new Error('Error al enviar')
      setText('')
      if (onMessageSent) onMessageSent()
    } catch {
      // silently fail — user can retry
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      {/* Message list */}
      <div className="space-y-3 max-h-[400px] overflow-y-auto mb-4 pr-1">
        {messages.length === 0 && (
          <p className="text-sm text-black/30 text-center py-6">No hay mensajes aun.</p>
        )}
        {messages.map((msg, i) => {
          const isSystem = msg.type === 'system'
          const isClient = msg.type === 'client'
          // admin or default
          if (isSystem) {
            return (
              <div key={i} className="flex justify-center">
                <p className="text-xs text-black/30 bg-black/[0.03] rounded-full px-3 py-1">
                  {msg.text} {msg.date && <span className="ml-1 text-black/20">- {formatDate(msg.date)}</span>}
                </p>
              </div>
            )
          }
          return (
            <div key={i} className={`flex ${isClient ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                isClient
                  ? 'bg-[#b3001e] text-white rounded-br-sm'
                  : 'bg-black/[0.04] text-black rounded-bl-sm'
              }`}>
                <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                <p className={`text-[10px] mt-1 ${isClient ? 'text-white/50' : 'text-black/30'}`}>
                  {formatDateTime(msg.date)}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escriba un mensaje..."
          className="flex-1 px-4 py-3 rounded-xl bg-black/[0.03] text-sm text-black placeholder-black/30 outline-none border border-black/5 focus:border-[#b3001e]/30 focus:ring-1 focus:ring-[#b3001e]/20 transition-all"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="shrink-0 w-11 h-11 rounded-xl bg-[#b3001e] text-white flex items-center justify-center hover:bg-[#8c0017] disabled:opacity-40 transition-colors"
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Collapsible Card
// ---------------------------------------------------------------------------
function CollapsibleCard({ title, icon: Icon, defaultOpen = true, count, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-black/5 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-black/[0.01] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          {Icon && <Icon size={18} className="text-black/40" />}
          <span className="text-sm font-semibold text-black">{title}</span>
          {count != null && (
            <span className="text-xs text-black/30 bg-black/5 rounded-full px-2 py-0.5">{count}</span>
          )}
        </div>
        {open ? <ChevronUp size={16} className="text-black/30" /> : <ChevronDown size={16} className="text-black/30" />}
      </button>
      {open && <div className="px-6 pb-5 pt-0">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main CertPortal component
// ---------------------------------------------------------------------------
export default function CertPortal() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/panel?action=cert_portal&token=${token}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Portal no encontrado')
      }
      const json = await res.json()
      setData(json.data)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (!token) {
      setError('Token no proporcionado')
      setLoading(false)
      return
    }
    fetchData()
  }, [token, fetchData])

  if (loading) return <SkeletonLoader />
  if (error || !data) return <ErrorView message={error} />

  const {
    business_name,
    rnc,
    package_type,
    status,
    current_step,
    steps_completed = [],
    step_dates = {},
    documents = [],
    messages = [],
    test_results = [],
    payment = {},
  } = data

  const currentStepInfo = STEPS.find(s => s.num === current_step)
  const showTestResults = TEST_RESULT_STEPS.includes(current_step) && test_results.length > 0
  const clientDocs = documents.filter(d => d.visible_to_client !== false)

  return (
    <div className="min-h-screen bg-[#f8f8f8]">
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-10">

        {/* ---- HEADER ---- */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-black/5 mb-4">
          {/* Logo + title */}
          <div className="flex items-center gap-2 mb-5">
            <span className="text-xl font-black text-black tracking-[2px]">TERMINAL</span>
            <img src={xMark} alt="X" width="48" height="48" className="h-12 w-12 object-contain" />
          </div>

          <h1 className="text-lg sm:text-xl font-bold text-black mb-1">Certificacion e-CF</h1>
          <p className="text-base font-semibold text-black/80 mb-0.5">{business_name || 'Negocio'}</p>
          {rnc && <p className="text-sm text-black/40 mb-4">RNC: {rnc}</p>}

          <div className="flex flex-wrap gap-2">
            {packageBadge(package_type)}
            {statusBadge(status)}
          </div>
        </div>

        {/* ---- PROGRESS / STEPS ---- */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-black/5 mb-4">
          <PortalStepTracker
            currentStep={current_step}
            stepsCompleted={steps_completed}
            stepDates={step_dates}
          />
        </div>

        {/* ---- CURRENT STEP ACTION CARD ---- */}
        {currentStepInfo && status !== 'completed' && (
          <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border-2 border-[#b3001e]/20 mb-4">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-[#b3001e]/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-bold text-[#b3001e]">{current_step}</span>
              </div>
              <div>
                <h2 className="text-sm font-bold text-black">Paso actual: {currentStepInfo.label}</h2>
                <p className="text-sm text-black/50 mt-1 leading-relaxed">
                  {CLIENT_INSTRUCTIONS[current_step] || 'Estamos trabajando en este paso. Le notificaremos cuando haya novedades.'}
                </p>
              </div>
            </div>

            {/* Upload area for action steps */}
            {CLIENT_ACTION_STEPS.includes(current_step) && (
              <div className="mt-4">
                <p className="text-xs font-medium text-black/40 uppercase tracking-wider mb-3">Subir Documentos</p>
                <UploadDropzone token={token} onUploadComplete={fetchData} />
              </div>
            )}
          </div>
        )}

        {/* ---- COMPLETED BANNER ---- */}
        {status === 'completed' && (
          <div className="bg-emerald-50 rounded-2xl p-6 sm:p-8 border border-emerald-200 mb-4 text-center">
            <CheckCircle2 size={40} className="text-emerald-600 mx-auto mb-3" />
            <h2 className="text-lg font-bold text-emerald-800 mb-1">Certificacion Completada</h2>
            <p className="text-sm text-emerald-700/70">
              Su negocio esta certificado como Emisor Electronico ante la DGII. Ya puede emitir e-CF.
            </p>
          </div>
        )}

        {/* ---- TEST RESULTS ---- */}
        {showTestResults && (
          <CollapsibleCard title="Resultados de Pruebas" icon={Shield} count={test_results.length}>
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/5">
                    <th className="text-left py-2 px-2 text-xs font-medium text-black/40">#</th>
                    <th className="text-left py-2 px-2 text-xs font-medium text-black/40">Prueba</th>
                    <th className="text-left py-2 px-2 text-xs font-medium text-black/40">Estado</th>
                    <th className="text-left py-2 px-2 text-xs font-medium text-black/40">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {test_results.map((t, i) => (
                    <tr key={i} className="border-b border-black/[0.03]">
                      <td className="py-2.5 px-2 text-black/30">{i + 1}</td>
                      <td className="py-2.5 px-2 text-black/80">{t.name}</td>
                      <td className="py-2.5 px-2">{testStatusBadge(t.status)}</td>
                      <td className="py-2.5 px-2 text-black/40 text-xs">{formatDate(t.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleCard>
        )}

        {/* ---- DOCUMENTS ---- */}
        <div className="mt-4">
          <CollapsibleCard title="Documentos" icon={FileText} count={clientDocs.length}>
            {clientDocs.length === 0 ? (
              <p className="text-sm text-black/30 text-center py-4">No hay documentos disponibles.</p>
            ) : (
              <div className="space-y-2">
                {clientDocs.map((doc, i) => (
                  <div key={i} className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-black/[0.02] hover:bg-black/[0.04] transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText size={16} className="text-black/30 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm text-black/80 truncate">{doc.name}</p>
                        <p className="text-[11px] text-black/30">
                          {doc.type && <span className="uppercase">{doc.type}</span>}
                          {doc.date && <span> - {formatDate(doc.date)}</span>}
                        </p>
                      </div>
                    </div>
                    {doc.url && (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 w-8 h-8 rounded-lg bg-black/5 hover:bg-black/10 flex items-center justify-center transition-colors"
                      >
                        <Download size={14} className="text-black/50" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Upload for documents (always available) */}
            <div className="mt-4 pt-4 border-t border-black/5">
              <p className="text-xs font-medium text-black/40 mb-2">Subir nuevo documento</p>
              <UploadDropzone token={token} onUploadComplete={fetchData} />
            </div>
          </CollapsibleCard>
        </div>

        {/* ---- MESSAGES ---- */}
        <div className="mt-4">
          <CollapsibleCard title="Mensajes" icon={MessageSquare} count={messages.length}>
            <MessagesSection messages={messages} token={token} onMessageSent={fetchData} />
          </CollapsibleCard>
        </div>

        {/* ---- PAYMENT INFO ---- */}
        {payment && (payment.total || payment.status) && (
          <div className="mt-4">
            <CollapsibleCard title="Informacion de Pago" icon={CreditCard} defaultOpen={false}>
              <div className="space-y-3">
                {payment.package_name && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-black/50">Paquete</span>
                    <span className="text-sm font-medium text-black">{payment.package_name}</span>
                  </div>
                )}
                {payment.total && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-black/50">Monto Total</span>
                    <span className="text-sm font-semibold text-black">RD${Number(payment.total).toLocaleString('es-DO')}</span>
                  </div>
                )}
                {payment.paid != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-black/50">Monto Pagado</span>
                    <span className="text-sm font-medium text-emerald-700">RD${Number(payment.paid).toLocaleString('es-DO')}</span>
                  </div>
                )}
                {payment.status && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-black/50">Estado de Pago</span>
                    {paymentBadge(payment.status)}
                  </div>
                )}
              </div>
            </CollapsibleCard>
          </div>
        )}

        {/* ---- FOOTER ---- */}
        <footer className="mt-10 mb-6 text-center space-y-3">
          <p className="text-xs text-black/30">Terminal X -- Sistema de Punto de Venta</p>
          <div className="flex items-center justify-center gap-4">
            <a
              href="https://wa.me/18098282971"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-black/40 hover:text-[#b3001e] transition-colors"
            >
              <Phone size={12} />
              +1 (809) 828-2971
            </a>
            <a
              href="https://terminalxpos.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-black/40 hover:text-[#b3001e] transition-colors"
            >
              <ExternalLink size={12} />
              terminalxpos.com
            </a>
          </div>
        </footer>
      </div>
    </div>
  )
}
