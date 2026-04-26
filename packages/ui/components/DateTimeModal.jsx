/**
 * DateTimeModal.jsx — uniform date/time picker prompt.
 *
 * Replaces native `prompt()` calls that ask the cashier for a future timestamp
 * (e.g. lead next-followup, reservation expiration). HTML5 `datetime-local`
 * input keeps the browser's native picker, so Windows/macOS/iOS/Android each
 * render their preferred calendar without any extra deps.
 *
 * Props:
 *   open          (bool)            — controls visibility
 *   title         (string)          — header text (Spanish default)
 *   initialValue  (ISO string opt.) — prefills the picker
 *   minDate       (ISO string opt.) — clamps the picker minimum (e.g. "now")
 *   onConfirm(iso) — called with ISO 8601 string when user saves
 *   onCancel()     — called on Esc / backdrop / cancel button
 */

import { useEffect, useRef, useState } from 'react'
import { X, Check } from 'lucide-react'

// `datetime-local` wants `YYYY-MM-DDTHH:mm` in LOCAL time. Using
// toISOString() would shift to UTC and confuse the cashier (booking at 6pm
// suddenly displays at 10pm). Build the local string by hand.
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function DateTimeModal({
  open,
  title = 'Seleccionar fecha y hora',
  initialValue,
  minDate,
  onConfirm,
  onCancel,
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setValue(toLocalInput(initialValue) || toLocalInput(new Date().toISOString()))
    // Focus the input on open so Enter immediately saves.
    setTimeout(() => { try { inputRef.current?.focus() } catch {} }, 30)
  }, [open, initialValue])

  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel?.() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  function save(e) {
    e?.preventDefault?.()
    if (!value) return
    const d = new Date(value)
    if (isNaN(d.getTime())) return
    onConfirm?.(d.toISOString())
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white border border-black max-w-sm w-full"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-black">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 hover:bg-black hover:text-white"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={save} className="p-5 space-y-4">
          <label className="block">
            <span className="text-xs font-semibold">Fecha y hora</span>
            <input
              ref={inputRef}
              type="datetime-local"
              value={value}
              min={minDate ? toLocalInput(minDate) : undefined}
              onChange={e => setValue(e.target.value)}
              className="mt-1 w-full border border-black px-2 py-1.5"
              required
            />
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 border border-black bg-white text-black hover:bg-black hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!value}
              className="px-4 py-2 bg-[#b3001e] text-white font-bold disabled:opacity-50 inline-flex items-center gap-2"
            >
              <Check size={14} />
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
