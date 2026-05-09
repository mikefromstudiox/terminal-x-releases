// useFoodTruckHotkeys — desktop keyboard shortcuts for FoodTruckPOS.
//
// F2 → focus search input
// F3 → Send to Kitchen (calls onSendKitchen if provided)
// F4 → Cobrar (calls onCobrar if provided)
// F8 → Navigate to Pendientes
// Esc → onCancel (clear active modal / cart edit, etc.)
//
// All handlers are no-op safe — passing nothing for any handler simply
// disables that shortcut. Only attaches listeners while document is
// visible (skip when tab backgrounded).
import { useEffect } from 'react'

export default function useFoodTruckHotkeys({
  onSearchFocus,
  onSendKitchen,
  onCobrar,
  onPendientes,
  onCancel,
  enabled = true,
} = {}) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const onKey = (e) => {
      // Skip when user is typing in an input/textarea — the F-keys are still
      // global but Esc should not nuke their typing.
      const tag = (e.target && e.target.tagName) || ''
      const isTyping = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || e.target?.isContentEditable
      if (e.key === 'F2' && onSearchFocus) {
        e.preventDefault(); onSearchFocus()
      } else if (e.key === 'F3' && onSendKitchen) {
        e.preventDefault(); onSendKitchen()
      } else if (e.key === 'F4' && onCobrar) {
        e.preventDefault(); onCobrar()
      } else if (e.key === 'F8' && onPendientes) {
        e.preventDefault(); onPendientes()
      } else if (e.key === 'Escape' && onCancel && !isTyping) {
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, onSearchFocus, onSendKitchen, onCobrar, onPendientes, onCancel])
}
