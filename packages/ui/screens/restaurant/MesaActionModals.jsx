/**
 * MesaActionModals.jsx — v2.16.3 Restaurante H3 (Mover / Juntar mesas)
 *
 * Two co-located modals + ManagerAuthGate wrapping. Shipped from a single
 * file so the import surface in RestaurantPOS.jsx stays narrow.
 *
 *   <MoveMesaModal>  → choose a free target mesa, transfer the open ticket.
 *   <JoinMesaModal>  → choose another OCCUPIED mesa, merge its ticket.
 *
 * Brand: black/white/#b3001e only — NO gray. Spanish copy. The manager gate is
 * mandatory for both ops (revenue-impacting + audit-required).
 */

import { useState } from 'react'
import { ArrowRightLeft, Combine, X, Loader2, AlertCircle, Users, Clock, Check } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import ManagerAuthGate from '../../components/ManagerAuthGate'

function fmtRD(n) {
  const v = Number.isFinite(n) ? n : 0
  return `RD$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function elapsedMin(seatedAt) {
  if (!seatedAt) return 0
  const t = new Date(seatedAt).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((Date.now() - t) / 60000))
}

function fmtElapsed(mins) {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60), m = mins % 60
  return `${h}h ${m}m`
}

// ── MOVE ─────────────────────────────────────────────────────────────────────
export function MoveMesaModal({ open, onClose, onSuccess, sourceMesa, sourceTicketSupabaseId, mesas }) {
  const api = useAPI()
  const [selectedMesaId, setSelectedMesaId] = useState(null)
  const [authNeeded, setAuthNeeded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)

  if (!open) return null

  const free = (mesas || [])
    .filter(m => m.id !== sourceMesa?.id && ['libre', 'sucia', 'reservada'].includes(m.status))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))

  const onConfirm = () => {
    setErr(null)
    if (!selectedMesaId) { setErr('Selecciona una mesa destino'); return }
    setAuthNeeded(true)
  }

  const runTransfer = async () => {
    setAuthNeeded(false)
    setBusy(true)
    setErr(null)
    try {
      await api.tickets.transferToMesa(sourceTicketSupabaseId, selectedMesaId)
      onSuccess?.()
    } catch (e) {
      setErr(e?.message || 'Error moviendo la mesa')
    } finally {
      setBusy(false)
    }
  }

  if (authNeeded) {
    const target = free.find(m => m.id === selectedMesaId)
    return (
      <ManagerAuthGate
        action="restaurant_mesa_transfer"
        actionLabel={`Mover mesa ${sourceMesa?.name} → ${target?.name || ''}`}
        context={{ target_id: sourceTicketSupabaseId, target_name: `${sourceMesa?.name} → ${target?.name}` }}
        onApprove={runTransfer}
        onCancel={() => setAuthNeeded(false)}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-md bg-white dark:bg-zinc-950 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#b3001e]/10 flex items-center justify-center shrink-0">
              <ArrowRightLeft size={18} className="text-[#b3001e]" />
            </div>
            <div className="min-w-0">
              <div className="text-base font-extrabold text-slate-900 dark:text-white truncate">Mover mesa</div>
              <div className="text-xs text-slate-500 dark:text-white/50 mt-0.5 truncate">
                Desde {sourceMesa?.name} · selecciona destino
              </div>
            </div>
          </div>
          <button onClick={onClose} disabled={busy}
            className="w-9 h-9 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-white/60 flex items-center justify-center disabled:opacity-40">
            <X size={18} />
          </button>
        </div>

        {err && (
          <div className="m-4 p-3 rounded-xl bg-[#b3001e]/10 border border-[#b3001e]/30 text-[#b3001e] text-xs flex items-center gap-2">
            <AlertCircle size={14} /> {err}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
          {free.length === 0 ? (
            <div className="text-center py-12 text-sm text-slate-400 dark:text-white/40">
              No hay mesas disponibles.
            </div>
          ) : free.map(m => {
            const isSel = selectedMesaId === m.id
            return (
              <button key={m.id} onClick={() => setSelectedMesaId(m.id)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 text-left transition-all ${
                  isSel
                    ? 'border-[#b3001e] bg-[#b3001e]/5'
                    : 'border-slate-200 dark:border-white/10 hover:border-[#b3001e]/40'
                }`}>
                <div>
                  <div className="text-base font-extrabold text-slate-900 dark:text-white">{m.name}</div>
                  <div className="text-[11px] text-slate-500 dark:text-white/50 mt-0.5 uppercase tracking-wider">
                    {m.zone || 'Sin zona'} · {m.status === 'libre' ? 'Libre' : m.status === 'sucia' ? 'Por limpiar' : 'Reservada'}
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  isSel ? 'border-[#b3001e] bg-[#b3001e]' : 'border-slate-300 dark:border-white/30'
                }`}>
                  {isSel && <Check size={12} className="text-white" />}
                </div>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-zinc-900/50">
          <button onClick={onClose} disabled={busy}
            className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/5 font-medium disabled:opacity-40">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={busy || !selectedMesaId}
            className="flex-1 py-3 rounded-xl bg-[#b3001e] hover:bg-[#8a0017] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-40">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRightLeft size={16} />} Mover
          </button>
        </div>
      </div>
    </div>
  )
}

// ── JOIN ─────────────────────────────────────────────────────────────────────
export function JoinMesaModal({ open, onClose, onSuccess, targetMesa, targetTicketSupabaseId, mesas }) {
  const api = useAPI()
  const [selectedMesaId, setSelectedMesaId] = useState(null)
  const [authNeeded, setAuthNeeded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)

  if (!open) return null

  const occupied = (mesas || [])
    .filter(m => m.id !== targetMesa?.id && (m.status === 'ocupada' || m.status === 'acuenta'))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))

  const onConfirm = () => {
    setErr(null)
    if (!selectedMesaId) { setErr('Selecciona la mesa a juntar'); return }
    setAuthNeeded(true)
  }

  const runMerge = async () => {
    setAuthNeeded(false)
    setBusy(true)
    setErr(null)
    try {
      // Resolve the source ticket's supabase_id from the chosen mesa.
      const src = await api.tickets?.getActiveByMesa?.(selectedMesaId)
      if (!src?.supabase_id) throw new Error('No se encontró el ticket de la mesa origen')
      await api.tickets.merge(targetTicketSupabaseId, src.supabase_id)
      onSuccess?.()
    } catch (e) {
      setErr(e?.message || 'Error juntando las mesas')
    } finally {
      setBusy(false)
    }
  }

  if (authNeeded) {
    const src = occupied.find(m => m.id === selectedMesaId)
    return (
      <ManagerAuthGate
        action="restaurant_mesa_merge"
        actionLabel={`Juntar ${src?.name} → ${targetMesa?.name}`}
        context={{ target_id: targetTicketSupabaseId, target_name: `${src?.name} → ${targetMesa?.name}` }}
        onApprove={runMerge}
        onCancel={() => setAuthNeeded(false)}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-md bg-white dark:bg-zinc-950 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#b3001e]/10 flex items-center justify-center shrink-0">
              <Combine size={18} className="text-[#b3001e]" />
            </div>
            <div className="min-w-0">
              <div className="text-base font-extrabold text-slate-900 dark:text-white truncate">Juntar mesas</div>
              <div className="text-xs text-slate-500 dark:text-white/50 mt-0.5 truncate">
                Selecciona la otra mesa para combinar con {targetMesa?.name}
              </div>
            </div>
          </div>
          <button onClick={onClose} disabled={busy}
            className="w-9 h-9 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-white/60 flex items-center justify-center disabled:opacity-40">
            <X size={18} />
          </button>
        </div>

        {err && (
          <div className="m-4 p-3 rounded-xl bg-[#b3001e]/10 border border-[#b3001e]/30 text-[#b3001e] text-xs flex items-center gap-2">
            <AlertCircle size={14} /> {err}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
          {occupied.length === 0 ? (
            <div className="text-center py-12 text-sm text-slate-400 dark:text-white/40">
              No hay otras mesas ocupadas para juntar.
            </div>
          ) : occupied.map(m => {
            const isSel = selectedMesaId === m.id
            const total = Number(m.active_ticket_total ?? m.current_ticket_total ?? 0)
            const mins = elapsedMin(m.seated_at)
            return (
              <button key={m.id} onClick={() => setSelectedMesaId(m.id)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 text-left transition-all ${
                  isSel
                    ? 'border-[#b3001e] bg-[#b3001e]/5'
                    : 'border-slate-200 dark:border-white/10 hover:border-[#b3001e]/40'
                }`}>
                <div className="min-w-0">
                  <div className="text-base font-extrabold text-slate-900 dark:text-white">{m.name}</div>
                  <div className="text-[11px] text-slate-500 dark:text-white/50 mt-0.5 flex items-center gap-2">
                    {m.guests_count != null && (<span className="inline-flex items-center gap-1"><Users size={10} /> {m.guests_count}</span>)}
                    {mins > 0 && (<span className="inline-flex items-center gap-1"><Clock size={10} /> {fmtElapsed(mins)}</span>)}
                    {total > 0 && (<span className="font-bold text-slate-700 dark:text-white/80">{fmtRD(total)}</span>)}
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  isSel ? 'border-[#b3001e] bg-[#b3001e]' : 'border-slate-300 dark:border-white/30'
                }`}>
                  {isSel && <Check size={12} className="text-white" />}
                </div>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-zinc-900/50">
          <button onClick={onClose} disabled={busy}
            className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/5 font-medium disabled:opacity-40">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={busy || !selectedMesaId}
            className="flex-1 py-3 rounded-xl bg-[#b3001e] hover:bg-[#8a0017] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-40">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Combine size={16} />} Juntar
          </button>
        </div>
      </div>
    </div>
  )
}
