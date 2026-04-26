import { useState, useEffect, useRef } from 'react'
import { Package, Plus, Loader2, ScanLine, CheckCircle2, X, Truck } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export default function Suministros() {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [orders, setOrders] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanInput, setScanInput] = useState('')
  const [toast, setToast] = useState(null)
  const scanRef = useRef(null)

  async function refresh() {
    setLoading(true)
    const [po, sup] = await Promise.all([
      api.partsOrders?.listAwaiting?.().catch(() => []) || Promise.resolve([]),
      api.suppliers?.list?.().catch(() => []) || Promise.resolve([]),
    ])
    setOrders(po || [])
    setSuppliers(sup || [])
    setLoading(false)
  }
  useEffect(() => { refresh() }, []) // eslint-disable-line

  async function onScan(e) {
    e?.preventDefault()
    const code = String(scanInput || '').trim()
    if (!code) return
    const found = await api.partsOrders?.findByBarcode?.(code).catch(() => null)
    if (!found) {
      setToast({ kind: 'err', msg: L(`Código ${code} no encontrado en suministros pendientes.`, `Code ${code} not found in pending orders.`) })
    } else {
      await api.partsOrders?.markReceived?.(found.id, code)
      // FIX-WA — auto-send WhatsApp to the client when the WO is linked. Falls
      // back silently if WhatsApp not configured (the wa.me link in the row
      // remains as a manual fallback). Activity log emit is non-blocking.
      let waMsg = ''
      try {
        if (found.work_order_supabase_id) {
          const orders = (await api.workOrders?.list?.()) || []
          const wo = orders.find(o => o.supabase_id === found.work_order_supabase_id)
          const phone = wo?.client_phone || ''
          if (wo && phone) {
            const body = `Su vehículo ${wo.plate || wo.vehicle_plate || ''} ya tiene las piezas. Lo contactaremos cuando esté listo. — ${wo.business_name || 'Taller'}`
            try { await api.whatsapp?.send?.({ to: phone.replace(/\D/g, ''), body }); waMsg = ' ✓ WhatsApp enviado.' }
            catch { waMsg = ' (WhatsApp no enviado)' }
          }
          try {
            await api.activity?.log?.({
              event_type: 'wo_parts_received', severity: 'info',
              target_type: 'parts_order', target_id: found.id,
              target_name: found.part_name,
              metadata: { work_order_supabase_id: found.work_order_supabase_id, barcode: code },
            })
          } catch {}
        }
      } catch {}
      setToast({ kind: 'ok', msg: L(`Recibido: ${found.part_name}.${waMsg}`, `Received: ${found.part_name}.${waMsg}`) })
      await refresh()
    }
    setScanInput('')
    setTimeout(() => setToast(null), 4000)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 dark:text-white"><Package size={32} />{L('Suministros / Repuestos', 'Parts Orders')}</h1>
          <p className="text-sm text-black/70 dark:text-white/70 mt-1">{L('Pedidos a proveedores. Escanee el código al recibir para liberar la WO.', 'Supplier orders. Scan barcode on arrival to unblock the WO.')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setScanning(true); setTimeout(() => scanRef.current?.focus(), 60) }} className="px-4 py-2 bg-black text-white font-bold hover:bg-[#b3001e] flex items-center gap-2"><ScanLine size={16}/>{L('Escanear', 'Scan')}</button>
          <button onClick={() => setShowNew(true)} className="px-4 py-2 bg-[#b3001e] text-white font-bold hover:bg-black flex items-center gap-2"><Plus size={16}/>{L('Nuevo Pedido', 'New Order')}</button>
        </div>
      </div>

      {toast && (
        <div className={`mb-4 p-3 border ${toast.kind === 'err' ? 'border-[#b3001e] bg-[#b3001e] text-white' : 'border-black bg-black text-white'} flex items-center gap-2`}>
          {toast.kind === 'err' ? <X size={16}/> : <CheckCircle2 size={16}/>}<span>{toast.msg}</span>
        </div>
      )}

      {scanning && (
        <form onSubmit={onScan} className="mb-4 flex items-center gap-2 border border-black dark:border-white/20 p-3 bg-white dark:bg-white/5">
          <ScanLine size={20} className="dark:text-white"/>
          <input
            ref={scanRef}
            value={scanInput}
            onChange={e => setScanInput(e.target.value)}
            placeholder={L('Escanee o escriba el código de barras y Enter', 'Scan or type barcode + Enter')}
            className="flex-1 px-3 py-2 border border-black dark:border-white/20 dark:bg-black dark:text-white"
            autoFocus
          />
          <button type="button" onClick={() => { setScanning(false); setScanInput('') }} className="px-3 py-2 border border-black dark:border-white dark:text-white"><X size={16}/></button>
        </form>
      )}

      {loading ? <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto"/></div> : (
        <div className="border border-black dark:border-white/20 bg-white dark:bg-white/5">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs uppercase tracking-wide bg-black text-white">
            <div className="col-span-2">{L('WO / Placa', 'WO / Plate')}</div>
            <div className="col-span-3">{L('Parte', 'Part')}</div>
            <div className="col-span-2">{L('Proveedor', 'Supplier')}</div>
            <div className="col-span-1 text-right">{L('Cant.', 'Qty')}</div>
            <div className="col-span-2 text-right">{L('Costo Est.', 'Est. Cost')}</div>
            <div className="col-span-1">{L('Esperado', 'ETA')}</div>
            <div className="col-span-1">{L('Estado', 'Status')}</div>
          </div>
          {orders.length === 0 ? (
            <p className="p-6 text-center text-sm text-black/50 dark:text-white/50">{L('Sin pedidos pendientes.', 'No pending orders.')}</p>
          ) : orders.map(po => (
            <div key={po.id} className={`grid grid-cols-12 gap-2 px-4 py-3 text-sm border-t border-black/10 dark:border-white/10 ${po.status === 'pendiente' ? 'bg-yellow-50 dark:bg-yellow-900/20' : 'dark:text-white'}`}>
              <div className="col-span-2 font-semibold">{po.vehicle_plate || `WO#${po.wo_id || ''}`}</div>
              <div className="col-span-3">{po.part_name} {po.part_sku && <span className="text-xs text-black/50 dark:text-white/50">· {po.part_sku}</span>}</div>
              <div className="col-span-2">{po.supplier_name || po.suppliers?.nombre || '—'}</div>
              <div className="col-span-1 text-right">{po.quantity}</div>
              <div className="col-span-2 text-right">{fmtRD(po.unit_cost_estimate)}</div>
              <div className="col-span-1 text-xs">{po.expected_at ? new Date(po.expected_at).toLocaleDateString('es-DO') : '—'}</div>
              <div className="col-span-1 flex items-center gap-2">
                <span className="text-xs">{po.status === 'pendiente' ? L('Pendiente','Pending') : L('En camino','En route')}</span>
                <button
                  onClick={async () => { await api.partsOrders?.markReceived?.(po.id); refresh() }}
                  title={L('Marcar recibido','Mark received')}
                  className="text-[#b3001e] hover:text-black dark:hover:text-white"
                ><CheckCircle2 size={16}/></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && <NewPartsOrderModal suppliers={suppliers} onClose={() => setShowNew(false)} onSaved={async () => { setShowNew(false); refresh() }} />}
    </div>
  )
}

function NewPartsOrderModal({ suppliers, onClose, onSaved }) {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [form, setForm] = useState({ part_name: '', part_sku: '', quantity: 1, unit_cost_estimate: 0, expected_at: '', supplier_supabase_id: '', work_order_supabase_id: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [workOrders, setWorkOrders] = useState([])
  useEffect(() => { (async () => { setWorkOrders((await api.workOrders?.list?.().catch(() => [])) || []) })() }, []) // eslint-disable-line
  async function save() {
    if (!form.part_name) return
    setSaving(true)
    await api.partsOrders?.create?.(form)
    setSaving(false)
    onSaved?.()
  }
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-black border border-black dark:border-white max-w-lg w-full">
        <div className="p-4 border-b border-black dark:border-white flex items-center justify-between">
          <h2 className="font-bold text-lg flex items-center gap-2 dark:text-white"><Truck size={18}/>{L('Nuevo Pedido de Suministro', 'New Parts Order')}</h2>
          <button onClick={onClose} className="dark:text-white"><X size={18}/></button>
        </div>
        <div className="p-4 space-y-3 dark:text-white">
          <input className="w-full p-2 border border-black dark:border-white/30 dark:bg-white/5" placeholder={L('Nombre de la parte', 'Part name')} value={form.part_name} onChange={e => setForm({ ...form, part_name: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <input className="p-2 border border-black dark:border-white/30 dark:bg-white/5" placeholder={L('SKU / código', 'SKU')} value={form.part_sku} onChange={e => setForm({ ...form, part_sku: e.target.value })} />
            <input type="number" min="1" step="1" className="p-2 border border-black dark:border-white/30 dark:bg-white/5" placeholder={L('Cantidad', 'Qty')} value={form.quantity} onChange={e => setForm({ ...form, quantity: Number(e.target.value) })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min="0" step="0.01" className="p-2 border border-black dark:border-white/30 dark:bg-white/5" placeholder={L('Costo estimado', 'Est. cost')} value={form.unit_cost_estimate} onChange={e => setForm({ ...form, unit_cost_estimate: Number(e.target.value) })} />
            <input type="date" className="p-2 border border-black dark:border-white/30 dark:bg-white/5" value={form.expected_at} onChange={e => setForm({ ...form, expected_at: e.target.value })} />
          </div>
          <select className="w-full p-2 border border-black dark:border-white/30 dark:bg-white/5" value={form.supplier_supabase_id} onChange={e => setForm({ ...form, supplier_supabase_id: e.target.value })}>
            <option value="">{L('— Proveedor —', '— Supplier —')}</option>
            {suppliers.map(s => <option key={s.id} value={s.supabase_id}>{s.nombre}</option>)}
          </select>
          <select className="w-full p-2 border border-black dark:border-white/30 dark:bg-white/5" value={form.work_order_supabase_id} onChange={e => setForm({ ...form, work_order_supabase_id: e.target.value })}>
            <option value="">{L('— WO asociada (opcional) —', '— Linked WO (optional) —')}</option>
            {workOrders.filter(w => !['facturado','closed','listo'].includes(w.status)).map(w => (
              <option key={w.id} value={w.supabase_id}>{w.vehicle_plate || ''} · {w.client_name || ''}</option>
            ))}
          </select>
          <textarea className="w-full p-2 border border-black dark:border-white/30 dark:bg-white/5" rows="2" placeholder={L('Notas','Notes')} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div className="p-4 border-t border-black dark:border-white flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border border-black dark:border-white dark:text-white">{L('Cancelar', 'Cancel')}</button>
          <button disabled={saving || !form.part_name} onClick={save} className="px-4 py-2 bg-[#b3001e] text-white font-bold hover:bg-black disabled:opacity-50">{saving ? '…' : L('Guardar', 'Save')}</button>
        </div>
      </div>
    </div>
  )
}
