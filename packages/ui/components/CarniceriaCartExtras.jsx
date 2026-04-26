// Carnicería-specific cart enhancements (v2.16.3).
// Renders a Pre-pack vs At-moment mode toggle at the top of the POS cart and
// a per-line "Notas Cocina" button. Hidden unless business_type === 'carniceria'.

import { useState } from 'react'
import { Scale, Package, StickyNote, X } from 'lucide-react'

export function CarniceriaModeToggle({ mode, onChange, lang = 'es' }) {
  return (
    <div className="flex gap-1 p-1 bg-slate-100 dark:bg-white/5 rounded-xl mb-2">
      <button onClick={() => onChange('prepacked')}
        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[12px] font-bold transition-colors ${
          mode === 'prepacked'
            ? 'bg-white dark:bg-black text-[#b3001e] shadow-sm'
            : 'text-slate-500 dark:text-white/50 hover:text-slate-700 dark:hover:text-white/80'
        }`}>
        <Package size={14} />
        {lang === 'es' ? 'Pre-empacado' : 'Pre-packed'}
      </button>
      <button onClick={() => onChange('at_moment')}
        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[12px] font-bold transition-colors ${
          mode === 'at_moment'
            ? 'bg-[#b3001e] text-white shadow-sm'
            : 'text-slate-500 dark:text-white/50 hover:text-slate-700 dark:hover:text-white/80'
        }`}>
        <Scale size={14} />
        {lang === 'es' ? 'Al momento' : 'At moment'}
      </button>
    </div>
  )
}

export function PrepNotesButton({ value, onChange, lang = 'es' }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const has = !!(value || '').trim()
  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setDraft(value || ''); setOpen(true) }}
        title={lang === 'es' ? 'Notas para cocina' : 'Kitchen notes'}
        className={`p-1 rounded-lg transition-colors ${
          has ? 'text-[#b3001e] bg-[#b3001e]/10' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
        }`}>
        <StickyNote size={13} />
      </button>
      {open && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60" onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 p-5 w-[400px] max-w-[92vw] shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold dark:text-white text-[14px]">
                {lang === 'es' ? 'Notas para Cocina' : 'Kitchen Notes'}
              </h3>
              <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"><X size={15} className="dark:text-white/40" /></button>
            </div>
            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} autoFocus
              placeholder={lang === 'es' ? 'Ej. 1 lb marinada limón-cebolla cubos' : 'e.g. 1 lb marinated lemon-onion cubes'}
              className="w-full px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[13px] outline-none focus:ring-2 focus:ring-[#b3001e]/25 focus:border-[#b3001e] resize-none" />
            <div className="flex gap-2">
              <button onClick={() => { onChange(''); setOpen(false) }}
                className="px-3 py-2 text-[12px] font-semibold bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 dark:text-white rounded-lg">
                {lang === 'es' ? 'Borrar' : 'Clear'}
              </button>
              <button onClick={() => { onChange(draft.trim()); setOpen(false) }}
                className="flex-1 px-3 py-2 text-[12px] font-bold bg-[#b3001e] hover:bg-[#c8002a] text-white rounded-lg">
                {lang === 'es' ? 'Guardar' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// SeasonalPromoBanner — crimson banner shown on POS header during DR holidays.
export function SeasonalPromoBanner({ seasons, lang = 'es', onDismiss }) {
  if (!seasons || seasons.length === 0) return null
  const labels = {
    ano_nuevo:    lang === 'es' ? '🎆 Año Nuevo'        : '🎆 New Year',
    navidad:      lang === 'es' ? '🎄 Navidad'          : '🎄 Christmas',
    dia_madres:   lang === 'es' ? '💐 Día de las Madres' : '💐 Mother\'s Day',
    dia_padres:   lang === 'es' ? '🥩 Día de los Padres' : '🥩 Father\'s Day',
    semana_santa: lang === 'es' ? '🐟 Semana Santa'     : '🐟 Holy Week',
  }
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[#b3001e] text-white text-[12px] font-bold">
      <span className="flex items-center gap-2">
        {seasons.map(s => <span key={s.key}>{labels[s.key] || s.key}</span>)}
        <span className="opacity-75 font-normal">— {lang === 'es' ? 'promociones activas' : 'active promotions'}</span>
      </span>
      {onDismiss && (
        <button onClick={onDismiss} className="opacity-70 hover:opacity-100"><X size={13} /></button>
      )}
    </div>
  )
}
