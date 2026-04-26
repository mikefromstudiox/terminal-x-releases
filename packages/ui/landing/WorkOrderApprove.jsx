/**
 * WorkOrderApprove.jsx — Public cotización approval page (Taller Mecánico).
 *
 * Customer scans a WhatsApp link → views cotización → signs with finger → approves.
 * Token-gated, no auth. Backed by web/api/panel.js?action=wo-approve-{load,submit}.
 *
 * Brand: black + white + crimson #b3001e only. Mobile-first.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, ShieldCheck, AlertTriangle, Eraser } from 'lucide-react'

const CRIMSON = '#b3001e'

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return '—' }
}
function woNumber(id) {
  const n = String(id ?? '').replace(/\D/g, '').padStart(4, '0')
  return `WO-${n}`
}

async function apiCall(action, init = {}) {
  const res = await fetch(`/api/panel?action=${action}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  let json = null
  try { json = await res.json() } catch {}
  if (!res.ok) {
    const code = json?.error || `http_${res.status}`
    const err = new Error(code); err.code = code; err.status = res.status
    throw err
  }
  return json
}

export default function WorkOrderApprove() {
  const params = useParams()
  // Two URL shapes supported:
  //   /wo/approve/:workOrderId   (token in path — preferred new shape)
  //   /wo/approve?t=...          (legacy, what older WhatsApp links carry)
  const tokenFromPath = params.workOrderId || ''
  const tokenFromQuery = (() => {
    try { return new URLSearchParams(window.location.search).get('t') || '' } catch { return '' }
  })()
  const token = (tokenFromPath || tokenFromQuery).trim()

  const [state, setState] = useState({ loading: true, data: null, error: null })
  const [customerName, setCustomerName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr] = useState('')
  const [approved, setApproved] = useState(null)

  useEffect(() => {
    if (!token) { setState({ loading: false, data: null, error: 'invalid_token' }); return }
    let cancelled = false
    apiCall(`wo-approve-load&t=${encodeURIComponent(token)}`)
      .then(d => { if (!cancelled) setState({ loading: false, data: d, error: null }) })
      .catch(e => { if (!cancelled) setState({ loading: false, data: null, error: e.code || e.message }) })
    return () => { cancelled = true }
  }, [token])

  // ── Signature canvas ───────────────────────────────────────────────────
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const hasInkRef = useRef(false)
  const lastRef = useRef({ x: 0, y: 0 })

  const setupCanvas = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const ratio = window.devicePixelRatio || 1
    const rect = c.getBoundingClientRect()
    c.width  = Math.floor(rect.width  * ratio)
    c.height = Math.floor(rect.height * ratio)
    const ctx = c.getContext('2d')
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 2.4
  }, [])

  useEffect(() => {
    if (state.loading || !state.data || approved) return
    setupCanvas()
    const onResize = () => setupCanvas()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [state.loading, state.data, approved, setupCanvas])

  function pointFromEvent(e) {
    const c = canvasRef.current
    const rect = c.getBoundingClientRect()
    const t = e.touches?.[0] || e.changedTouches?.[0]
    const cx = t ? t.clientX : e.clientX
    const cy = t ? t.clientY : e.clientY
    return { x: cx - rect.left, y: cy - rect.top }
  }
  function startDraw(e) { e.preventDefault(); drawingRef.current = true; lastRef.current = pointFromEvent(e) }
  function moveDraw(e) {
    if (!drawingRef.current) return
    e.preventDefault()
    const p = pointFromEvent(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.beginPath(); ctx.moveTo(lastRef.current.x, lastRef.current.y); ctx.lineTo(p.x, p.y); ctx.stroke()
    lastRef.current = p
    hasInkRef.current = true
  }
  function endDraw() { drawingRef.current = false }
  function clearSig() { hasInkRef.current = false; setupCanvas() }

  async function submit() {
    setSubmitErr('')
    if (!hasInkRef.current) { setSubmitErr('Por favor firme en el recuadro antes de aprobar.'); return }
    setSubmitting(true)
    try {
      const dataUrl = canvasRef.current.toDataURL('image/png')
      const r = await apiCall(`wo-approve-submit&t=${encodeURIComponent(token)}`, {
        method: 'POST',
        body: JSON.stringify({ signature_data_url: dataUrl, customer_name: customerName || null }),
      })
      setApproved({ at: new Date().toISOString(), path: r.signature_path })
    } catch (e) {
      setSubmitErr(({
        already_approved: 'Esta cotización ya fue aprobada.',
        cotizacion_expired: 'Esta cotización ya está vencida. Pida una nueva al taller.',
        invalid_token: 'El enlace no es válido o expiró.',
        work_order_not_found: 'No encontramos esta cotización. Verifique el enlace con el taller.',
        signature_required: 'La firma es obligatoria para aprobar.',
        signature_size_out_of_range: 'La firma no pudo procesarse. Intente de nuevo.',
        rate_limited: 'Demasiados intentos. Espere un momento e intente de nuevo.',
      })[e.code] || `No pudimos aprobar (${e.code || 'error'}).`)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render states ──────────────────────────────────────────────────────
  if (state.loading) {
    return <Shell><div className="p-12 text-center text-black/60"><Loader2 className="animate-spin mx-auto mb-3" /> Cargando cotización…</div></Shell>
  }

  if (state.error || !state.data) {
    const msg = ({
      invalid_token: 'El enlace no es válido. Pida al taller que le envíe el enlace de nuevo.',
      work_order_not_found: 'Esta cotización ya no existe. Pida una nueva al taller.',
      rate_limited: 'Demasiados intentos. Espere un momento e intente de nuevo.',
    })[state.error] || 'No pudimos cargar la cotización. Intente de nuevo en unos minutos.'
    return <Shell><Banner variant="error">{msg}</Banner></Shell>
  }

  const { wo, items, vehicle, business, client, alreadyApproved, expired } = state.data

  if (approved || alreadyApproved) {
    return (
      <Shell>
        <Banner variant="success">
          <strong className="text-base">¡Cotización aprobada!</strong>
          <p className="text-[13px] mt-1.5 leading-snug">
            Aprobada el {fmtDate(approved?.at || wo.estimate_approved_at)}. El taller ya recibió su confirmación
            y comenzará el trabajo. Recibirá un mensaje cuando el vehículo esté listo.
          </p>
        </Banner>
        <Summary wo={wo} items={items} vehicle={vehicle} business={business} client={client} />
      </Shell>
    )
  }

  if (expired) {
    return (
      <Shell>
        <Banner variant="error">
          <strong className="text-base">Cotización vencida.</strong>
          <p className="text-[13px] mt-1.5 leading-snug">
            Esta cotización venció el {fmtDate(wo.validity_until)}. Pida al taller una cotización actualizada.
          </p>
        </Banner>
        <Summary wo={wo} items={items} vehicle={vehicle} business={business} client={client} />
      </Shell>
    )
  }

  return (
    <Shell>
      <Header business={business} />
      <Summary wo={wo} items={items} vehicle={vehicle} business={business} client={client} />

      <section className="bg-white border border-black p-4 mb-4">
        <h2 className="text-[18px] font-extrabold mb-1">Firma del Cliente</h2>
        <p className="text-[12px] text-black/60 mb-3">
          Firme con el dedo en el recuadro. Al aprobar, autoriza al taller a iniciar el trabajo.
        </p>

        <input
          type="text"
          value={customerName}
          onChange={e => setCustomerName(e.target.value)}
          placeholder="Su nombre completo (opcional)"
          maxLength={120}
          className="w-full p-2.5 border border-black text-[14px] mb-3 focus:outline-none focus:ring-2 focus:ring-[#b3001e]/40"
        />

        <div className="relative">
          <canvas
            ref={canvasRef}
            className="block w-full h-[180px] bg-white border-2 border-black"
            style={{ touchAction: 'none' }}
            onMouseDown={startDraw}
            onMouseMove={moveDraw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={moveDraw}
            onTouchEnd={endDraw}
          />
          <button
            type="button"
            onClick={clearSig}
            className="absolute right-2 bottom-2 bg-white border border-black px-2.5 py-1 text-[11px] font-bold flex items-center gap-1 hover:bg-black hover:text-white transition-colors"
          >
            <Eraser size={12} /> Limpiar
          </button>
        </div>

        {submitErr && (
          <div className="mt-3 text-[#b3001e] text-[13px] font-bold flex items-start gap-1.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{submitErr}</span>
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="mt-4 w-full py-3.5 bg-[#b3001e] text-white text-[16px] font-extrabold tracking-wide hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}
          {submitting ? 'Procesando…' : 'Aprobar y Firmar'}
        </button>

        <p className="mt-3 text-[11px] text-black/50 leading-relaxed">
          Al aprobar usted acepta el alcance, los repuestos y el total mostrados arriba.
          La factura electrónica (e-CF) se emitirá al finalizar el trabajo.
        </p>
      </section>
    </Shell>
  )
}

// ─── presentational ──────────────────────────────────────────────────────

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-white text-black" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div className="max-w-[640px] mx-auto px-4 pt-6 pb-12">
        {children}
        <footer className="text-center text-[11px] text-black/50 mt-8">
          Powered by <strong style={{ color: CRIMSON }}>Terminal X</strong> · DGII Emisor #42483
        </footer>
      </div>
    </div>
  )
}

function Header({ business }) {
  return (
    <header className="border-b-[3px] border-[#b3001e] pb-3 mb-5">
      <div className="text-[11px] font-bold text-[#b3001e] tracking-[0.15em]">COTIZACIÓN DIGITAL</div>
      <div className="text-[22px] font-extrabold mt-1">{business?.name || 'Taller Mecánico'}</div>
      {business?.rnc && <div className="text-[12px] text-black/60 mt-0.5">RNC {business.rnc}</div>}
    </header>
  )
}

function Summary({ wo, items, vehicle, business, client }) {
  return (
    <section className="bg-white border border-black p-4 mb-4">
      <div className="flex justify-between items-baseline mb-3">
        <h2 className="text-[18px] font-extrabold">{woNumber(wo.id)}</h2>
        <span className="text-[11px] text-black/60">Vence: {fmtDate(wo.validity_until)}</span>
      </div>

      {vehicle && (
        <div className="grid grid-cols-2 gap-2">
          <Field k="Vehículo" v={[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ') || '—'} />
          <Field k="Placa"    v={vehicle.plate || '—'} />
          {vehicle.vin && <Field k="VIN" v={vehicle.vin} />}
          {vehicle.odometer_km != null && <Field k="Kilometraje" v={`${Number(vehicle.odometer_km).toLocaleString('en-US')} km`} />}
        </div>
      )}

      {client && (
        <div className="grid grid-cols-2 gap-2 mt-2">
          <Field k="Cliente" v={client.name || '—'} />
          {client.phone && <Field k="Teléfono" v={client.phone} />}
        </div>
      )}

      <div className="mt-4 border border-black">
        <div className="bg-black text-white px-3 py-2 text-[11px] font-bold tracking-wider grid grid-cols-[1fr_60px_90px_90px] gap-2">
          <div>DESCRIPCIÓN</div>
          <div className="text-right">CANT.</div>
          <div className="text-right">PRECIO</div>
          <div className="text-right">TOTAL</div>
        </div>
        {(items || []).length === 0 ? (
          <div className="p-4 text-[13px] text-black/50 text-center">Sin partidas registradas.</div>
        ) : (items || []).map(it => (
          <div key={it.id} className="px-3 py-2.5 border-t border-black/10 text-[13px] grid grid-cols-[1fr_60px_90px_90px] gap-2">
            <div>
              <div className="font-semibold">{it.name}</div>
              <div className="text-[10px] text-black/50">
                {it.type === 'part' ? 'Repuesto' : it.type === 'service' ? 'Servicio' : 'Mano de Obra'}
                {it.warranty_months > 0 && ` · Garantía ${it.warranty_months} meses`}
              </div>
            </div>
            <div className="text-right">{Number(it.quantity || 1).toLocaleString('en-US')}</div>
            <div className="text-right">{fmtRD(it.unit_price)}</div>
            <div className="text-right font-bold">{fmtRD(it.total ?? Number(it.quantity || 1) * Number(it.unit_price || 0))}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-1 text-[13px]">
        <Row k="Mano de obra" v={fmtRD(wo.labor_total)} />
        <Row k="Repuestos"    v={fmtRD(wo.parts_total)} />
        <Row k="ITBIS (18% sobre repuestos)" v={fmtRD(wo.itbis)} />
        <div className="border-t-2 border-black mt-1 pt-1.5 flex justify-between text-[16px] font-extrabold">
          <span>TOTAL</span>
          <span style={{ color: CRIMSON }}>{fmtRD(wo.total || wo.estimated_total)}</span>
        </div>
      </div>

      {wo.notes && (
        <div className="mt-3 p-3 bg-black/5 text-[12px] text-black/70">
          <div className="text-[10px] font-bold text-black/50 mb-0.5 tracking-wide">NOTAS</div>
          {wo.notes}
        </div>
      )}
    </section>
  )
}

function Field({ k, v }) {
  return (
    <div>
      <div className="text-[10px] text-black/50 uppercase tracking-wider">{k}</div>
      <div className="text-[13px] font-semibold">{v}</div>
    </div>
  )
}
function Row({ k, v }) {
  return <div className="flex justify-between"><span>{k}</span><span>{v}</span></div>
}

function Banner({ variant, children }) {
  const isErr = variant === 'error'
  const Icon = isErr ? AlertTriangle : ShieldCheck
  return (
    <div className={`p-4 mb-4 text-white flex items-start gap-3 ${isErr ? 'bg-[#b3001e] border-l-[6px] border-black' : 'bg-black border-l-[6px] border-[#b3001e]'}`}>
      <Icon size={20} className="mt-0.5 shrink-0" />
      <div className="text-[14px]">{children}</div>
    </div>
  )
}
