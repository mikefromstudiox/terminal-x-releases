// PickupDisplay — fullscreen wall TV showing two columns:
//   EN COCINA  · orders being prepared
//   LISTOS     · orders ready for pickup (green, with optional ding sound)
//
// Pro MAX gated. Customer-facing — no auth UI, but the route is wrapped in
// ProtectedRoute + PlanGate('food_truck_pickup_display') so only an
// authenticated owner-on-Pro-MAX can open it. Kiosk pattern: open this in a
// second browser tab, drag to a wall display, full-screen the tab.
import { useState, useEffect, useMemo, useRef } from 'react'
import { useAPI } from '../../context/DataContext'
import { useBackup as _ } from '../../context/BackupContext'  // noop import to ensure context tree
import { ChefHat, CheckCircle2 } from 'lucide-react'

const POLL_MS = 7000  // 7s — balances freshness vs request volume on a 12hr day

function elapsedMinutes(iso) {
  if (!iso) return 0
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
}

export default function PickupDisplay() {
  const api = useAPI()
  const [rows, setRows]     = useState([])
  const [error, setError]   = useState(null)
  const prevReady = useRef(new Set())  // track which doc_numbers were already in LISTOS to ding only on new ones
  const audioRef = useRef(null)

  // Initialize a one-shot "ding" audio. Modern browsers gate autoplay until
  // user interaction — we lazily build the AudioContext on first poll.
  const ding = () => {
    try {
      if (!audioRef.current) {
        const Ctx = window.AudioContext || window.webkitAudioContext
        if (!Ctx) return
        audioRef.current = new Ctx()
      }
      const ctx = audioRef.current
      if (ctx.state === 'suspended') ctx.resume()
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = 880
      g.gain.value = 0.15
      o.connect(g); g.connect(ctx.destination)
      o.start()
      o.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.18)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      o.stop(ctx.currentTime + 0.42)
    } catch (_aetherErr) {
      try { (typeof window !== 'undefined') && window.__txReportError?.(_aetherErr, { severity: 'error', category: 'pickupdisplay.ding' }) } catch {}}
  }

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const list = await api.tickets?.listOpen?.({})
        if (cancelled) return
        const next = Array.isArray(list) ? list : []
        // Detect new LISTOS rows (ticket flagged ready by KDS) — for now we
        // approximate "ready" via elapsed > 2 min OR a notes flag set by KDS
        // when it bumps the ticket. Phase 2 wires kds_events directly.
        const ready = next.filter(r => /\bLISTO\b/i.test(r.notes || ''))
        const justReady = ready.filter(r => !prevReady.current.has(r.doc_number))
        if (justReady.length > 0) ding()
        prevReady.current = new Set(ready.map(r => r.doc_number))
        setRows(next)
        setError(null)
      } catch (e) {
        try { (typeof window !== 'undefined') && window.__txReportError?.(e, { severity: 'error', category: 'pickupdisplay.ding' }) } catch {}
        if (!cancelled) setError(e?.message || 'No se pudo cargar la pantalla')
      }
    }
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [api])

  const { ready, cooking } = useMemo(() => {
    const r = []
    const c = []
    for (const row of rows) {
      if (/\bLISTO\b/i.test(row.notes || '')) r.push(row)
      else c.push(row)
    }
    return { ready: r, cooking: c }
  }, [rows])

  return (
    <div className="fixed inset-0 bg-black text-white overflow-hidden flex flex-col">
      <div className="px-10 py-8 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#b3001e] grid place-items-center">
            <ChefHat size={26} className="text-white" />
          </div>
          <h1 className="text-[40px] md:text-[56px] font-black tracking-tight">Tu orden</h1>
        </div>
        <div className="text-right">
          <p className="text-[14px] uppercase tracking-[2px] text-white/40">Powered by Terminal X</p>
          <p className="text-[12px] text-white/30 mt-1 font-mono">{new Date().toLocaleTimeString('es-DO')}</p>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-2 min-h-0">
        {/* EN COCINA */}
        <div className="border-r border-white/10 p-8 md:p-12 overflow-y-auto">
          <p className="text-[22px] md:text-[28px] font-extrabold tracking-tight text-amber-400 mb-6 uppercase">
            En cocina
          </p>
          {cooking.length === 0 ? (
            <p className="text-white/30 text-[20px]">—</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {cooking.map(r => (
                <div key={r.supabase_id} className="rounded-2xl border border-white/10 bg-white/[0.03] py-6 px-5 flex flex-col items-center justify-center">
                  <p className="font-mono text-[36px] md:text-[52px] font-black text-white">{(r.doc_number || '').replace(/^T-/, '')}</p>
                  <p className="text-[11px] text-white/40 mt-1">{elapsedMinutes(r.created_at)} min</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* LISTOS */}
        <div className="p-8 md:p-12 overflow-y-auto bg-emerald-500/5">
          <p className="text-[22px] md:text-[28px] font-extrabold tracking-tight text-emerald-400 mb-6 uppercase flex items-center gap-2">
            <CheckCircle2 size={26} /> Listos
          </p>
          {ready.length === 0 ? (
            <p className="text-white/30 text-[20px]">—</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {ready.map(r => (
                <div key={r.supabase_id} className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/10 py-6 px-5 flex flex-col items-center justify-center animate-pulse">
                  <p className="font-mono text-[36px] md:text-[52px] font-black text-emerald-400">{(r.doc_number || '').replace(/^T-/, '')}</p>
                  <p className="text-[11px] text-emerald-300/80 mt-1">RETIRAR</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="absolute bottom-4 left-4 right-4 px-4 py-2 rounded-xl bg-[#b3001e] text-white text-[12px] text-center">
          {error}
        </div>
      )}
    </div>
  )
}
