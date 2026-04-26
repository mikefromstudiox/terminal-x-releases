import { useState, useEffect } from 'react'
import { X, Car, Gauge, Camera, ShieldCheck, Users, Loader2, History } from 'lucide-react'
import { useAPI } from '../context/DataContext'
import { useLang } from '../i18n'

function fmtDate(s) { return s ? new Date(s).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' }
function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}` }

const TABS = [
  { id: 'datos',    icon: Car,         es: 'Datos',          en: 'Details' },
  { id: 'km',       icon: Gauge,       es: 'Km Logs',        en: 'Mileage' },
  { id: 'fotos',    icon: Camera,      es: 'Fotos Daños',    en: 'Damage Photos' },
  { id: 'garantias', icon: ShieldCheck, es: 'Garantías',      en: 'Warranty' },
  { id: 'duenos',   icon: Users,       es: 'Cambios Dueño',  en: 'Owner Changes' },
]

export default function VehicleHistoryModal({ vehicle, onClose }) {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [tab, setTab] = useState('datos')
  const [history, setHistory] = useState([])
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { (async () => {
    if (!vehicle?.id && !vehicle?.supabase_id) return
    setLoading(true)
    const [wos, ph] = await Promise.all([
      api.workOrders?.list?.({ vehicle_id: vehicle.id }).catch(() => []) || Promise.resolve([]),
      vehicle.supabase_id ? (api.workOrderPhotos?.listByVehicle?.(vehicle.supabase_id).catch(() => []) || Promise.resolve([])) : Promise.resolve([]),
    ])
    setHistory(wos || [])
    setPhotos(ph || [])
    setLoading(false)
  })() }, [vehicle?.id, vehicle?.supabase_id]) // eslint-disable-line

  if (!vehicle) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-black border border-black dark:border-white max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b border-black dark:border-white flex items-center justify-between">
          <div className="dark:text-white">
            <h2 className="font-bold text-lg flex items-center gap-2"><History size={18}/>{L('Historial del Vehículo', 'Vehicle History')} — {vehicle.plate || vehicle.vin || '—'}</h2>
            <p className="text-xs text-black/60 dark:text-white/60">{[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ')}</p>
          </div>
          <button onClick={onClose} className="dark:text-white"><X size={20}/></button>
        </div>

        <div className="flex border-b border-black dark:border-white overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-3 text-sm font-bold flex items-center gap-2 whitespace-nowrap border-r border-black dark:border-white/20 ${active ? 'bg-[#b3001e] text-white' : 'bg-white dark:bg-white/5 text-black dark:text-white hover:bg-black hover:text-white'}`}>
                <Icon size={14}/>{L(t.es, t.en)}
              </button>
            )
          })}
        </div>

        <div className="overflow-y-auto p-4 flex-1 dark:text-white">
          {loading ? <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto"/></div> : (
            <>
              {tab === 'datos' && (
                <div className="grid grid-cols-2 gap-4">
                  <Field k="Placa" v={vehicle.plate}/>
                  <Field k="VIN" v={vehicle.vin}/>
                  <Field k={L('Marca','Make')} v={vehicle.make}/>
                  <Field k={L('Modelo','Model')} v={vehicle.model}/>
                  <Field k={L('Año','Year')} v={vehicle.year}/>
                  <Field k={L('Color','Color')} v={vehicle.color}/>
                  <Field k={L('Kilometraje actual','Current km')} v={vehicle.odometer_km != null ? `${Number(vehicle.odometer_km).toLocaleString('en-US')} km` : '—'}/>
                  <Field k={L('Próximo servicio','Next service')} v={vehicle.next_service_km ? `${Number(vehicle.next_service_km).toLocaleString('en-US')} km` : '—'}/>
                </div>
              )}

              {tab === 'km' && (
                <div>
                  <div className="text-sm mb-3 text-black/70 dark:text-white/70">{L('Última lectura registrada por orden de trabajo.','Last reading per work order.')}</div>
                  {history.length === 0 ? <p className="text-sm text-black/50 dark:text-white/50">{L('Sin órdenes registradas.','No work orders.')}</p> : (
                    <table className="w-full text-sm">
                      <thead className="bg-black text-white">
                        <tr><th className="text-left p-2">{L('Fecha','Date')}</th><th className="text-right p-2">Km In</th><th className="text-right p-2">Km Out</th><th className="text-left p-2">{L('Servicio','Service')}</th></tr>
                      </thead>
                      <tbody>
                        {history.map(w => (
                          <tr key={w.id} className="border-t border-black/10 dark:border-white/10">
                            <td className="p-2">{fmtDate(w.created_at)}</td>
                            <td className="text-right p-2">{w.odometer_in_km != null ? Number(w.odometer_in_km).toLocaleString('en-US') : '—'}</td>
                            <td className="text-right p-2">{w.odometer_out_km != null ? Number(w.odometer_out_km).toLocaleString('en-US') : '—'}</td>
                            <td className="p-2 text-xs">{(w.notes || '').slice(0, 60)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {tab === 'fotos' && (
                <div>
                  {photos.length === 0 ? <p className="text-sm text-black/50 dark:text-white/50">{L('Sin fotos en el historial.','No photos on file.')}</p> : (
                    <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                      {photos.map(p => (
                        <div key={p.id || p.supabase_id} className="border border-black dark:border-white/20 p-1">
                          <div className="aspect-square bg-black/5 dark:bg-white/5 flex items-center justify-center text-[11px] uppercase">
                            {p.phase === 'despues' ? L('Después','After') : L('Antes','Before')}
                          </div>
                          <div className="text-[10px] mt-1 text-black/60 dark:text-white/60">{fmtDate(p.created_at)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === 'garantias' && (
                <div>
                  <div className="text-sm mb-3 text-black/70 dark:text-white/70">{L('Repuestos con garantía registrada en órdenes pasadas.','Parts with warranty from past work orders.')}</div>
                  {history.length === 0 ? <p className="text-sm text-black/50 dark:text-white/50">{L('Sin órdenes.','No orders.')}</p> : (
                    <ul className="divide-y divide-black/10 dark:divide-white/10">
                      {history.flatMap(w => (w.items || []).filter(i => i.warranty_months > 0).map(i => ({ ...i, _wo: w }))).map(i => (
                        <li key={i.id} className="py-2 flex justify-between text-sm">
                          <div>
                            <div className="font-semibold">{i.name}</div>
                            <div className="text-xs text-black/50 dark:text-white/50">{fmtDate(i._wo?.created_at)} · {i.warranty_months} {L('meses','months')}</div>
                          </div>
                          <div className="text-right text-xs">{fmtRD(i.unit_price)}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {tab === 'duenos' && (() => {
                // Reconstruct an ownership timeline from the WO history: any
                // WO whose client_supabase_id differs from the row above marks
                // a change in the customer who paid for service. It is not a
                // perfect title-change log (the vehicle owner could be the
                // same legal owner across multiple service customers) but it
                // is the best we can do without a dedicated title-history
                // table. Most DR shops want exactly this signal: "who paid
                // for service on this car last time?"
                const sorted = [...(history || [])].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
                const changes = []
                let prev = null
                for (const w of sorted) {
                  const id = w.client_supabase_id || w.client_id || null
                  const name = w.client_name || '—'
                  if (id && id !== prev?.id) {
                    changes.push({ date: w.created_at, name, id })
                    prev = { id, name }
                  }
                }
                const currentId = vehicle.client_supabase_id || vehicle.client_id || null
                const currentName = vehicle.client_name || vehicle.client?.name || (changes[changes.length - 1]?.name) || '—'
                return (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <Field k={L('Cliente actual','Current owner')} v={currentName}/>
                      <Field k={L('Registrado','Registered')} v={fmtDate(vehicle.created_at)}/>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-black/50 dark:text-white/50 mb-2">
                        {L('Línea de tiempo (clientes que han pagado servicio)','Timeline (customers who paid for service)')}
                      </div>
                      {changes.length === 0 ? (
                        <p className="text-sm text-black/50 dark:text-white/50">{L('Sin cambios registrados.','No changes recorded.')}</p>
                      ) : (
                        <ul className="border border-black dark:border-white/20">
                          {changes.map((c, i) => (
                            <li key={i} className={`flex justify-between items-center px-3 py-2 text-sm ${i ? 'border-t border-black/10 dark:border-white/10' : ''} ${c.id === currentId ? 'bg-[#b3001e]/10' : ''}`}>
                              <span className="font-semibold dark:text-white">
                                {c.name}
                                {c.id === currentId && <span className="ml-2 text-[10px] uppercase text-[#b3001e] font-bold tracking-wider">{L('Actual','Current')}</span>}
                              </span>
                              <span className="text-xs text-black/60 dark:text-white/60">{fmtDate(c.date)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ k, v }) {
  return (
    <div className="border-b border-black/10 dark:border-white/10 py-2">
      <div className="text-[11px] uppercase tracking-wide text-black/50 dark:text-white/50">{k}</div>
      <div className="text-sm font-semibold">{v || '—'}</div>
    </div>
  )
}
