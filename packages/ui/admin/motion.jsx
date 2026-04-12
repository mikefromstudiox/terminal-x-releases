// Shared framer-motion variants for the Terminal X Admin Panel.
// One source of truth so every screen moves with the same rhythm.

export const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, y: -6, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } },
}

export const listContainer = {
  initial: {},
  animate: { transition: { staggerChildren: 0.045, delayChildren: 0.05 } },
}

export const listItem = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
}

export const cardHover = {
  rest:  { scale: 1, y: 0 },
  hover: { scale: 1.012, y: -2, transition: { type: 'spring', stiffness: 320, damping: 22 } },
}

export const buttonTap = {
  whileTap:   { scale: 0.96 },
  whileHover: { scale: 1.015 },
  transition: { type: 'spring', stiffness: 420, damping: 26 },
}

export const modalBackdrop = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.22 } },
  exit:    { opacity: 0, transition: { duration: 0.15 } },
}

export const modalPanel = {
  initial: { opacity: 0, scale: 0.94, y: 12 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 320, damping: 26 } },
  exit:    { opacity: 0, scale: 0.96, y: 6, transition: { duration: 0.15 } },
}

export const loginCard = {
  initial: { opacity: 0, y: 24, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
}

export const dropdown = {
  initial: { opacity: 0, y: -6, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.16, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } },
}

// Simple number count-up using requestAnimationFrame (no motion value needed for discrete values).
import { useEffect, useRef, useState } from 'react'
export function useCountUp(value, duration = 900) {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    const start = performance.now()
    const from = fromRef.current
    const to = Number(value) || 0
    let raf
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (to - from) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
      else { fromRef.current = to; setDisplay(to) }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return display
}

export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString('es-DO'), className }) {
  const n = useCountUp(value)
  return <span className={className}>{format(n)}</span>
}
