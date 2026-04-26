/**
 * SignaturePad.jsx — Shared canvas signature capture
 *
 * Lightweight, dependency-free canvas signature pad. Supports mouse, pointer,
 * and touch input. Emits PNG dataURL via `onChange` when a stroke ends, and
 * `null` on clear. Tailwind-styled to match repo conventions.
 *
 * Usage:
 *   <SignaturePad value={dataUrl} onChange={setDataUrl} height={140} disabled={false} />
 */
import { useRef, useEffect } from 'react'
import { RotateCcw } from 'lucide-react'

export default function SignaturePad({ value, onChange, height = 140, disabled = false }) {
  const canvasRef  = useRef(null)
  const drawingRef = useRef(false)
  const dirtyRef   = useRef(false)
  const lastPtRef  = useRef(null)

  const getCtx = () => {
    const c = canvasRef.current
    if (!c) return null
    const ctx = c.getContext('2d')
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    ctx.lineWidth   = 2
    ctx.strokeStyle = '#000'
    return ctx
  }

  const pointFromEvent = (e) => {
    const c = canvasRef.current
    const rect = c.getBoundingClientRect()
    const t = e.touches?.[0]
    const cx = t ? t.clientX : e.clientX
    const cy = t ? t.clientY : e.clientY
    return {
      x: (cx - rect.left) * (c.width  / rect.width),
      y: (cy - rect.top)  * (c.height / rect.height),
    }
  }

  const start = (e) => {
    if (disabled) return
    e.preventDefault()
    drawingRef.current = true
    lastPtRef.current  = pointFromEvent(e)
  }
  const move = (e) => {
    if (disabled || !drawingRef.current) return
    e.preventDefault()
    const ctx = getCtx(); if (!ctx) return
    const p = pointFromEvent(e)
    const last = lastPtRef.current || p
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastPtRef.current = p
    dirtyRef.current  = true
  }
  const end = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastPtRef.current  = null
    if (dirtyRef.current && onChange) {
      try { onChange(canvasRef.current.toDataURL('image/png')) } catch {}
    }
  }

  const clear = () => {
    const c = canvasRef.current; if (!c) return
    const ctx = getCtx(); if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    dirtyRef.current = false
    if (onChange) onChange(null)
  }

  // If parent clears `value` externally (e.g., reset on submit), wipe canvas.
  useEffect(() => {
    if (value == null && canvasRef.current) {
      const ctx = getCtx()
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
      dirtyRef.current = false
    }
  }, [value])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
          Firma
        </label>
        <button
          type="button"
          onClick={clear}
          disabled={disabled}
          className="inline-flex items-center gap-1 text-xs text-black/60 dark:text-white/60 hover:text-[#b3001e] disabled:opacity-50">
          <RotateCcw size={12} /> Limpiar
        </button>
      </div>
      <div className="rounded-lg border border-black/15 dark:border-white/15 bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          width={560}
          height={height * 2}
          style={{
            width: '100%',
            height,
            touchAction: 'none',
            cursor: disabled ? 'not-allowed' : 'crosshair',
            display: 'block',
            opacity: disabled ? 0.6 : 1,
          }}
          onMouseDown={start}  onMouseMove={move}  onMouseUp={end}  onMouseLeave={end}
          onTouchStart={start} onTouchMove={move}  onTouchEnd={end}
          onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        />
      </div>
      <div className="text-[11px] text-black/50 dark:text-white/50">
        Firme con el dedo o el mouse — requerido para finalizar.
      </div>
    </div>
  )
}
