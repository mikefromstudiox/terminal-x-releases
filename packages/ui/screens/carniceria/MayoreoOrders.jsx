import { useState, useEffect, useMemo } from 'react'
import { Truck, Plus, X, Save, MessageCircle, ShoppingCart, Loader2, Calendar } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useLang } from '../../i18n'
import { useAPI } from '../../context/DataContext'
import { mayoreoConfirm } from '@terminal-x/services/whatsapp'

const DOW_LABEL = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']

export default function MayoreoOrders() {
  const api = useAPI()
  const nav = useNavigate()
  const { lang } = useLang()
  const [rows, setRows] = useState([])
  const [clients, setClients] = useState([])
  const [businessName, setBusinessName] = useState('')
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const [list, cs, biz] = await Promise.all([
        api?.carniceria?.recurring?.list?.() || [],
        api?.clients?.all?.() || [],
        api?.business?.get?.() || api?.businesses?.get?.() || {},
      ])
      setRows(list); setClients(cs); setBusinessName(biz?.name || '')
    } catch { setRows([]) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const today = new Date().getDay()
  const todayList = useMemo(() => rows.filter(r => r.dia_semana === today && r.active), [rows, today])

  async function save(row) {
    if (row.id) await api?.carniceria?.recurring?.update?.(row)
    else        await api?.carniceria?.recurring?.create?.(row)
    setEdit(null); load()
  }

  function preArm(order) {
    try { localStorage.setItem('tx_prearm_cart', JSON.stringify(order.items_json || [])) } catch {}
    nav('/pos')
  }

  function sendWhatsApp(order) {
    const client = clients.find(c => c.supabase_id === order.client_supabase_id) || {}
    const url = mayoreoConfirm({ client, order, businessName })
    if (url) window.open(url, '_blank')
    api?.carniceria?.recurring?.markSent?.({ id: order.id })
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-zinc-900">
      <header className="flex items-center justify-between px-6 py-4 border-b border-black/10 dark:border-white/10 bg-white dark:bg-black">
        <div className="flex items-center gap-3">
          <Truck size={22} className="text-[#b3001e]" />
          <h1 className="text-[18px] font-bold dark:text-white">{lang === 'es' ? 'Mayoreo & Pedidos Recurrentes' : 'Wholesale & Recurring Orders'}</h1>
        </div>
        <button onClick={() => setEdit({ active: true, dia_semana: today, items_json: [], whatsapp_confirmar: true })}
          className="flex items-center gap-2 px-4 py-2 bg-[#b3001e] hover:bg-[#c8002a] text-white text-[13px] font-bold rounded-xl">
          <Plus size={15} /> {lang === 'es' ? 'Nuevo Pedido' : 'New Order'}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-[#b3001e]" /></div>
        ) : (
          <>
            {todayList.length > 0 && (
              <section>
                <h2 className="text-[13px] font-bold text-[#b3001e] mb-2 flex items-center gap-2">
                  <Calendar size={14} /> {lang === 'es' ? 'Hoy' : 'Today'} ({DOW_LABEL[today]})
                </h2>
                <div className="grid gap-2">
                  {todayList.map(r => <Card key={r.id} order={r} clients={clients} onEdit={() => setEdit(r)} onPreArm={() => preArm(r)} onWA={() => sendWhatsApp(r)} highlight />)}
                </div>
              </section>
            )}
            <section>
              <h2 className="text-[13px] font-bold text-slate-600 dark:text-white/70 mb-2">{lang === 'es' ? 'Todos los pedidos recurrentes' : 'All recurring orders'}</h2>
              {rows.length === 0
                ? <div className="text-center py-12 text-slate-400 text-[13px]">{lang === 'es' ? 'Aún no hay pedidos recurrentes.' : 'No recurring orders yet.'}</div>
                : <div className="grid gap-2">{rows.map(r => <Card key={r.id} order={r} clients={clients} onEdit={() => setEdit(r)} onPreArm={() => preArm(r)} onWA={() => sendWhatsApp(r)} />)}</div>
              }
            </section>
          </>
        )}
      </div>

      {edit && <OrderEditor order={edit} clients={clients} onSave={save} onClose={() => setEdit(null)} />}
    </div>
  )
}

function Card({ order, clients, onEdit, onPreArm, onWA, highlight }) {
  const client = clients.find(c => c.supabase_id === order.client_supabase_id)
  const items = Array.isArray(order.items_json) ? order.items_json : []
  return (
    <div className={`p-4 rounded-2xl border ${highlight ? 'border-[#b3001e]/40 bg-[#b3001e]/5' : 'border-black/10 dark:border-white/10 bg-white dark:bg-black'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-[14px] dark:text-white">{order.nombre}</h3>
          <p className="text-[11px] text-slate-500 dark:text-white/50">
            {client?.name || '—'} · {DOW_LABEL[order.dia_semana]} · {items.length} ítem{items.length===1?'':'s'}
            {order.total_estimado && <> · ~RD${Number(order.total_estimado).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</>}
          </p>
          <div className="mt-2 text-[11px] text-slate-600 dark:text-white/60 line-clamp-2">
            {items.map(i => `${i.qty} ${i.unit || 'lb'} ${i.name}`).join(' · ')}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button onClick={onPreArm} className="px-3 py-1.5 text-[11px] font-bold bg-[#b3001e] hover:bg-[#c8002a] text-white rounded-lg flex items-center gap-1.5">
            <ShoppingCart size={12} /> Pre-armar
          </button>
          <button onClick={onWA} className="px-3 py-1.5 text-[11px] font-bold bg-[#25D366] hover:bg-[#128C7E] text-white rounded-lg flex items-center gap-1.5">
            <MessageCircle size={12} /> WhatsApp
          </button>
          <button onClick={onEdit} className="px-3 py-1.5 text-[11px] font-semibold bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 dark:text-white rounded-lg">
            Editar
          </button>
        </div>
      </div>
    </div>
  )
}

function OrderEditor({ order, clients, onSave, onClose }) {
  const [draft, setDraft] = useState({ ...order, items_json: Array.isArray(order.items_json) ? order.items_json : [] })
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const updateItem = (idx, patch) => set('items_json', draft.items_json.map((it, i) => i === idx ? { ...it, ...patch } : it))
  const addItem = () => set('items_json', [...draft.items_json, { name: '', qty: 1, unit: 'lb' }])
  const rmItem  = (idx) => set('items_json', draft.items_json.filter((_, i) => i !== idx))

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 p-6 w-[520px] max-w-[92vw] max-h-[90vh] overflow-y-auto shadow-2xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold dark:text-white">{order.id ? 'Editar Pedido' : 'Nuevo Pedido Recurrente'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"><X size={16} className="dark:text-white/40" /></button>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-slate-500 dark:text-white/50 uppercase">Nombre</label>
          <input value={draft.nombre || ''} onChange={e => set('nombre', e.target.value)}
            placeholder="Ej. Pedido típico martes — Restaurante La Vega"
            className="w-full mt-1 px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[13px] outline-none focus:ring-2 focus:ring-[#b3001e]/25" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] font-semibold text-slate-500 dark:text-white/50 uppercase">Cliente</label>
            <select value={draft.client_supabase_id || ''} onChange={e => set('client_supabase_id', e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[13px] outline-none focus:ring-2 focus:ring-[#b3001e]/25">
              <option value="">— Seleccionar —</option>
              {clients.map(c => <option key={c.supabase_id || c.id} value={c.supabase_id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 dark:text-white/50 uppercase">Día</label>
            <select value={draft.dia_semana ?? ''} onChange={e => set('dia_semana', Number(e.target.value))}
              className="w-full mt-1 px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[13px] outline-none focus:ring-2 focus:ring-[#b3001e]/25">
              {DOW_LABEL.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold text-slate-500 dark:text-white/50 uppercase">Ítems</label>
            <button onClick={addItem} className="text-[11px] font-bold text-[#b3001e] hover:underline flex items-center gap-1"><Plus size={11} /> Agregar</button>
          </div>
          <div className="space-y-1.5">
            {draft.items_json.map((it, idx) => (
              <div key={idx} className="flex gap-1.5">
                <input value={it.name || ''} onChange={e => updateItem(idx, { name: e.target.value })} placeholder="Producto"
                  className="flex-1 px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[12px] outline-none focus:ring-1 focus:ring-[#b3001e]" />
                <input type="number" value={it.qty || ''} onChange={e => updateItem(idx, { qty: Number(e.target.value) })} placeholder="Qty"
                  className="w-16 px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[12px] outline-none focus:ring-1 focus:ring-[#b3001e]" />
                <select value={it.unit || 'lb'} onChange={e => updateItem(idx, { unit: e.target.value })}
                  className="px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[12px]">
                  <option>lb</option><option>kg</option><option>uds</option>
                </select>
                <input type="number" step="0.01" value={it.price_per_unit || ''} onChange={e => updateItem(idx, { price_per_unit: Number(e.target.value) })} placeholder="RD$/u"
                  className="w-20 px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[12px] outline-none focus:ring-1 focus:ring-[#b3001e]"
                  title="Precio por unidad" />
                <button onClick={() => rmItem(idx)} className="px-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500"><X size={12} /></button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-slate-500 dark:text-white/50 uppercase">Total estimado (RD$)</label>
          <input type="number" step="0.01" value={draft.total_estimado || ''} onChange={e => set('total_estimado', Number(e.target.value))}
            className="w-full mt-1 px-3 py-2 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white text-[13px] outline-none focus:ring-2 focus:ring-[#b3001e]/25" />
        </div>
        <label className="flex items-center gap-2 text-[12px] dark:text-white/70 cursor-pointer">
          <input type="checkbox" checked={!!draft.whatsapp_confirmar} onChange={e => set('whatsapp_confirmar', e.target.checked)} className="accent-[#b3001e]" />
          Enviar confirmación por WhatsApp el día del pedido
        </label>
        <button onClick={() => onSave(draft)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#b3001e] hover:bg-[#c8002a] text-white text-[13px] font-bold rounded-xl">
          <Save size={14} /> Guardar
        </button>
      </div>
    </div>
  )
}
