import { Sparkles, X } from 'lucide-react'

// Compact banner shown at the top of FoodTruckPOS while a special event is
// active. Toggle lives in app_settings:
//   food_truck_event_active = '1' | '0'
//   food_truck_event_label  = 'Festival ABC'
//   food_truck_event_multiplier = '1.20'  (optional; default 1.0)
//
// Tapping the X clears the toggle (manager-gated upstream if you choose to
// require auth). The component is dumb — it surfaces what the parent reads
// from settings + offers a deactivation hook.
export default function EventModeBanner({ label, multiplier, onClear }) {
  if (!label) return null
  const pct = Math.round((Number(multiplier || 1) - 1) * 100)
  return (
    <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-[#b3001e] text-white shadow-sm">
      <Sparkles size={16} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-extrabold tracking-[1.5px] uppercase opacity-80">Modo Evento</div>
        <div className="text-sm font-bold truncate">
          {label}{pct ? ` · +${pct}%` : ''}
        </div>
      </div>
      {onClear && (
        <button onClick={onClear} className="opacity-80 hover:opacity-100" aria-label="Desactivar modo evento">
          <X size={16} />
        </button>
      )}
    </div>
  )
}
