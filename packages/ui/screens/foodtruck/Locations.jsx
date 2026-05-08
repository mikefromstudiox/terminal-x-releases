import { useState, useEffect, useCallback } from 'react'
import { MapPin, Plus, Trash2, Crosshair, Edit3, Check, X, Loader2 } from 'lucide-react'
import { useAPI } from '../../context/DataContext'

// Food truck favorite stops — name + optional GPS + free-text notes.
// A "stop" is just a saved location the truck parks at on a route. Used as
// a label on tickets and at shift-open time so reports can group sales by
// where the truck was that day.
export default function Locations() {
  const api = useAPI()
  const [locations, setLocations] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [editing, setEditing]     = useState(null) // null | { id?, name, lat, lng, notes }
  const [busy, setBusy]           = useState(false)
  const [geoBusy, setGeoBusy]     = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api?.foodTruckLocations?.list?.() || []
      setLocations(Array.isArray(list) ? list : [])
      setError(null)
    } catch (e) {
      setError(e?.message || 'Error cargando ubicaciones')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { reload() }, [reload])

  const startNew = () => setEditing({ name: '', lat: null, lng: null, notes: '' })

  const captureCurrentPosition = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Tu dispositivo no soporta GPS — ingresa lat/lng manualmente.')
      return
    }
    setGeoBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoBusy(false)
        setEditing(e => e ? {
          ...e,
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        } : e)
      },
      (err) => {
        setGeoBusy(false)
        setError('No se pudo obtener la ubicación: ' + (err?.message || 'permiso denegado'))
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
    )
  }

  const save = async () => {
    if (!editing?.name?.trim()) { setError('Nombre requerido'); return }
    setBusy(true)
    try {
      if (editing.id) {
        await api.foodTruckLocations.update(editing.id, {
          name: editing.name.trim(),
          lat: editing.lat,
          lng: editing.lng,
          notes: editing.notes || null,
        })
      } else {
        await api.foodTruckLocations.create({
          name: editing.name.trim(),
          lat: editing.lat,
          lng: editing.lng,
          notes: editing.notes || null,
          active: true,
        })
      }
      setEditing(null)
      setError(null)
      await reload()
    } catch (e) {
      setError(e?.message || 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id) => {
    if (!confirm('¿Eliminar esta ubicación?')) return
    try {
      await api.foodTruckLocations.delete(id)
      await reload()
    } catch (e) {
      setError(e?.message || 'No se pudo eliminar')
    }
  }

  return (
    <div className="h-full overflow-y-auto p-5 lg:p-7 bg-slate-50 dark:bg-black min-h-0">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-[#b3001e]/10 grid place-items-center">
          <MapPin className="text-[#b3001e]" size={20} />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Ubicaciones</h1>
          <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5">Paradas favoritas de tu food truck</p>
        </div>
        <button
          onClick={startNew}
          className="px-4 py-2.5 rounded-xl bg-[#b3001e] hover:bg-red-700 text-white text-sm font-semibold flex items-center gap-2"
        >
          <Plus size={16} /> Nueva
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-[#b3001e]/10 text-[#b3001e] text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}

      {editing && (
        <div className="mb-6 p-5 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5">
          <div className="text-[11px] font-extrabold tracking-[2px] text-slate-400 dark:text-white/40 mb-3 uppercase">
            {editing.id ? 'Editar parada' : 'Nueva parada'}
          </div>
          <input
            type="text"
            value={editing.name}
            onChange={e => setEditing({ ...editing, name: e.target.value })}
            placeholder="Nombre (ej. Parque Mirador)"
            className="w-full mb-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black text-slate-900 dark:text-white text-sm focus:outline-none focus:border-[#b3001e]"
            autoComplete="off"
          />
          <div className="flex gap-2 mb-3">
            <input
              type="number" step="0.000001"
              value={editing.lat ?? ''}
              onChange={e => setEditing({ ...editing, lat: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="Latitud"
              className="flex-1 px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black text-slate-900 dark:text-white text-sm focus:outline-none focus:border-[#b3001e]"
            />
            <input
              type="number" step="0.000001"
              value={editing.lng ?? ''}
              onChange={e => setEditing({ ...editing, lng: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="Longitud"
              className="flex-1 px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black text-slate-900 dark:text-white text-sm focus:outline-none focus:border-[#b3001e]"
            />
            <button
              onClick={captureCurrentPosition}
              disabled={geoBusy}
              className="px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-800 dark:text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-60"
            >
              {geoBusy ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />}
              Mi ubicación
            </button>
          </div>
          <textarea
            value={editing.notes || ''}
            onChange={e => setEditing({ ...editing, notes: e.target.value })}
            placeholder="Notas (horario, contacto del lugar, peajes...)"
            className="w-full mb-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black text-slate-900 dark:text-white text-sm focus:outline-none focus:border-[#b3001e]"
            rows={3}
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setEditing(null)}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-800 dark:text-white text-sm font-semibold"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="px-4 py-2.5 rounded-xl bg-[#b3001e] hover:bg-red-700 text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-60"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Guardar
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400 dark:text-white/40 text-sm">Cargando...</div>
      ) : locations.length === 0 ? (
        <div className="text-center py-12 text-slate-400 dark:text-white/40 text-sm">
          No hay ubicaciones guardadas todavía. Toca <strong className="text-[#b3001e]">Nueva</strong> para agregar tu primera parada.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {locations.map(loc => (
            <div key={loc.id} className="p-4 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5">
              <div className="flex items-start gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="text-base font-bold text-slate-900 dark:text-white truncate">{loc.name}</div>
                  {loc.lat != null && loc.lng != null && (
                    <div className="text-xs text-slate-400 dark:text-white/40 font-mono mt-0.5">
                      {Number(loc.lat).toFixed(5)}, {Number(loc.lng).toFixed(5)}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setEditing({ ...loc })}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-white/50"
                  aria-label="Editar"
                >
                  <Edit3 size={14} />
                </button>
                <button
                  onClick={() => remove(loc.id)}
                  className="p-1.5 rounded-lg hover:bg-[#b3001e]/10 text-[#b3001e]"
                  aria-label="Eliminar"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {loc.notes && (
                <div className="text-xs text-slate-500 dark:text-white/50 line-clamp-3">{loc.notes}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
