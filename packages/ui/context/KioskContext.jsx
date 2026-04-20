// KioskContext — idle-timeout session lock for kiosk / unattended POS devices.
//
// Goal: if the cashier walks away, the POS must auto-lock so the next person
// can't ring up sales under the previous cashier's identity. Re-entering the
// PIN unlocks the session IN PLACE — we never flush `user`, so route state,
// cart contents, unsaved modals, and Supabase session all survive the lock.
//
// Activity signals: mousemove, keydown, pointerdown, touchstart, wheel.
// Settings:
//   - kiosk_auto_lock_enabled (device-local, "0"/"1")
//   - kiosk_auto_lock_minutes (device-local, integer, default 10; 0 = never)
//
// The timer runs only while a user is authenticated AND auto-lock is enabled.
// Debounced reset per animation frame so high-frequency mousemove doesn't melt
// the CPU on mid-range Windows cash registers.

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { useAPI } from './DataContext'

const KioskContext = createContext(null)

const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'pointerdown', 'touchstart', 'wheel']
const DEFAULT_MINUTES = 10
const MIN_MINUTES = 1
const MAX_MINUTES = 120

export function KioskProvider({ children }) {
  const api = useAPI()
  const { user } = useAuth()
  const [locked, setLocked] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [minutes, setMinutes] = useState(DEFAULT_MINUTES)
  const timerRef = useRef(null)
  const rafRef = useRef(null)

  // Load settings once + whenever they change via storage event.
  const loadSettings = useCallback(async () => {
    try {
      const s = await api?.settings?.get?.()
      if (!s) return
      const en = String(s.kiosk_auto_lock_enabled ?? '0') === '1'
      const raw = Number(s.kiosk_auto_lock_minutes ?? DEFAULT_MINUTES)
      const m = Number.isFinite(raw) ? Math.max(0, Math.min(MAX_MINUTES, raw)) : DEFAULT_MINUTES
      setEnabled(en)
      setMinutes(m)
    } catch {}
  }, [api])

  useEffect(() => { loadSettings() }, [loadSettings])
  // Sistema.jsx saves via api.settings.update → web writes to localStorage and
  // desktop writes to SQLite. Listen for storage changes so a save elsewhere
  // in the app reloads the timer config without a full reload.
  useEffect(() => {
    function onChange() { loadSettings() }
    window.addEventListener('storage', onChange)
    window.addEventListener('tx:settings-updated', onChange)
    return () => {
      window.removeEventListener('storage', onChange)
      window.removeEventListener('tx:settings-updated', onChange)
    }
  }, [loadSettings])

  const lock = useCallback(() => {
    // Don't lock if there's no one to re-authenticate.
    if (!user?.id) return
    setLocked(true)
  }, [user?.id])

  const unlock = useCallback(() => setLocked(false), [])

  // Idle timer wiring. Runs only when: user is signed in, feature enabled,
  // minutes > 0, and session isn't already locked (no point counting while
  // the PIN overlay is already up).
  useEffect(() => {
    if (!user?.id || !enabled || !minutes || locked) {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
      return
    }
    const ms = minutes * 60_000

    function arm() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        setLocked(true)
      }, ms)
    }

    function onActivity() {
      // rAF-coalesce: mousemove fires ~120Hz; we only need one reset per frame.
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        arm()
      })
    }

    arm()
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true })
    }
    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity)
      }
    }
  }, [user?.id, enabled, minutes, locked])

  // If the user signs out manually, drop the lock overlay so the Login screen
  // renders cleanly instead of stacking on top of it.
  useEffect(() => { if (!user?.id) setLocked(false) }, [user?.id])

  const value = { locked, lock, unlock, enabled, minutes, reloadSettings: loadSettings, MIN_MINUTES, MAX_MINUTES }
  return <KioskContext.Provider value={value}>{children}</KioskContext.Provider>
}

export function useKiosk() {
  const ctx = useContext(KioskContext)
  if (!ctx) throw new Error('useKiosk must be used within KioskProvider')
  return ctx
}
