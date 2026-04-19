import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Package, Plus, Search, AlertTriangle, X,
  ChevronUp, ChevronDown, Pencil, Trash2,
  History, RefreshCw, Loader2, Upload, FileSpreadsheet,
  Check, Wine, Tags, Bike,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAPI } from '../context/DataContext'
import { useLang } from '../i18n'
import { useBusinessType } from '../hooks/useBusinessType.jsx'
import ManagerAuthGate from '../components/ManagerAuthGate'
import { needsGate } from '@terminal-x/services/managerGateRules'
import { getCarniceriaCategoryOptions, getCutSuggestions } from '@terminal-x/config/carniceriaCatalog'

const ALLOWED = ['owner', 'manager', 'cfo', 'accountant']

// Licorería categories — replaces the generic carwash default when the
// business type is 'licoreria'. Ordering matches shelf-walk flow.
const LICORERIA_CATEGORIES = ['Ron', 'Whisky', 'Vodka', 'Cerveza', 'Vino', 'Gin', 'Tequila', 'Champagne', 'Licor', 'Brandy', 'Aperitivo', 'Bebidas', 'Snacks', 'Otro']
const CARNICERIA_CATEGORIES_LIST = getCarniceriaCategoryOptions()

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(s) {
  if (!s) return '—'
  return new Date(s.includes('T') ? s : s + 'T12:00:00').toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const DEFAULT_CATEGORIES = ['Bebidas', 'Insumos', 'Repuestos', 'Herramientas', 'Limpieza', 'Otro']

// ── Item form modal ────────────────────────────────────────────────────────────
function ItemModal({ item, onSave, onClose }) {
  const api = useAPI()
  const { isLicoreria, licoreriaConfig, isCarniceria } = useBusinessType()
  const CATEGORIES = isCarniceria ? CARNICERIA_CATEGORIES_LIST
                   : isLicoreria  ? LICORERIA_CATEGORIES
                   : DEFAULT_CATEGORIES
  const brandSuggestions = licoreriaConfig?.brandSuggestions || {}

  const [form, setForm] = useState({
    sku:            item?.sku          || '',
    name:           item?.name         || '',
    category:       item?.category     || CATEGORIES[0],
    quantity:       item?.quantity     ?? 0,
    min_quantity:   item?.min_quantity ?? 5,
    price:          item?.price        ?? 0,
    price_pedidos_ya: item?.price_pedidos_ya ?? '',
    cost:           item?.cost         ?? 0,
    bottle_deposit: item?.bottle_deposit ?? (isLicoreria ? (licoreriaConfig?.bottleDeposit?.defaultAmount || 0) : 0),
    // Carnicería — sold-by-weight defaults. When enabled, `price` is ignored at
    // POS time in favor of price_per_unit × weight; we mirror price_per_unit →
    // price on save so legacy reports (which read `price`) still render sanely.
    sold_by_weight: !!(item?.sold_by_weight) || (isCarniceria && !item),
    unit:           item?.unit || (isCarniceria ? 'lb' : ''),
    price_per_unit: item?.price_per_unit ?? (isCarniceria ? 0 : null),
    tare_default:   item?.tare_default ?? 0,
  })
  const cutSuggestions = isCarniceria ? getCutSuggestions(form.category) : []
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.name.trim()) { setErr('El nombre es requerido.'); return }
    setSaving(true)
    try {
      const ppu = parseFloat(form.price_per_unit) || 0
      const sold_by_weight = !!form.sold_by_weight
      const data = {
        ...form,
        name:           form.name.trim(),
        sku:            form.sku.trim() || null,
        quantity:       Number(form.quantity)     || 0,
        min_quantity:   Number(form.min_quantity) || 0,
        // For weighted products we mirror price_per_unit → price so legacy
        // reports (which only understand `price`) still see a sane number.
        price:          sold_by_weight ? ppu : (parseFloat(form.price) || 0),
        price_pedidos_ya: (form.price_pedidos_ya === '' || form.price_pedidos_ya == null) ? null : Number(form.price_pedidos_ya),
        cost:           parseFloat(form.cost)     || 0,
        bottle_deposit: parseFloat(form.bottle_deposit) || 0,
        sold_by_weight,
        unit:           sold_by_weight ? (form.unit || 'lb') : null,
        price_per_unit: sold_by_weight ? ppu : null,
        tare_default:   sold_by_weight ? (parseFloat(form.tare_default) || 0) : null,
      }
      if (item?.id) await api.inventory.update({ id: item.id, ...data })
      else          await api.inventory.create(data)
      onSave()
    } catch (e) {
      setErr(e?.message || 'Error al guardar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-white/5 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/10">
          <h3 className="font-bold text-slate-800 dark:text-white">{item ? 'Editar item' : 'Nuevo item'}</h3>
          <button onClick={onClose} className="text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1">SKU (opcional)</label>
              <input value={form.sku} onChange={e => set('sku', e.target.value)}
                placeholder="SKU-001"
                className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1">Categoría</label>
              <select value={form.category} onChange={e => set('category', e.target.value)}
                className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1">Nombre *</label>
            <input value={form.name} onChange={e => { set('name', e.target.value); setErr('') }}
              list={isLicoreria ? 'licoreria-brands' : undefined}
              placeholder={isLicoreria ? 'Ej: Brugal Añejo 750ml' : 'Ej: Shampoo para autos 1L'}
              className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
            {isLicoreria && (
              <datalist id="licoreria-brands">
                {Object.values(brandSuggestions).flat().map(b => <option key={b} value={b} />)}
              </datalist>
            )}
          </div>
          {isLicoreria && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1 flex items-center gap-1">
                  <Wine size={10} className="text-[#b3001e]" /> Depósito botella (RD$)
                </label>
                <input type="number" min="0" step="0.01" value={form.bottle_deposit}
                  onChange={e => set('bottle_deposit', e.target.value)}
                  placeholder="0.00"
                  className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30" />
                <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1">Se añade automáticamente al cobrar.</p>
              </div>
            </div>
          )}
          {(isCarniceria || form.sold_by_weight) && (
            <>
              {cutSuggestions.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1">Corte sugerido</label>
                  <div className="flex flex-wrap gap-1.5">
                    {cutSuggestions.map(cut => (
                      <button type="button" key={cut}
                        onClick={() => set('name', `${cut} ${form.category}`.trim())}
                        className="px-2.5 py-1 rounded-full border border-slate-200 dark:border-white/10 text-[11px] font-medium text-slate-600 dark:text-white/60 hover:border-[#b3001e] hover:text-[#b3001e] transition-colors">
                        {cut}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <label className="flex items-center gap-2 select-none cursor-pointer">
                <input type="checkbox" checked={!!form.sold_by_weight}
                  onChange={e => set('sold_by_weight', e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-[#b3001e] focus:ring-[#b3001e]/30" />
                <span className="text-[13px] text-slate-700 dark:text-white/80">Vender por peso (báscula)</span>
              </label>
              {form.sold_by_weight && (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1">Unidad</label>
                    <select value={form.unit} onChange={e => set('unit', e.target.value)}
                      className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30">
                      <option value="lb">lb (libra)</option>
                      <option value="kg">kg</option>
                      <option value="oz">oz</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1">Precio / {form.unit || 'lb'} (RD$)</label>
                    <input type="number" min="0" step="0.01" value={form.price_per_unit}
                      onChange={e => set('price_per_unit', e.target.value)}
                      placeholder="0.00"
                      className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1">Tara ({form.unit || 'lb'})</label>
                    <input type="number" min="0" step="0.001" value={form.tare_default}
                      onChange={e => set('tare_default', e.target.value)}
                      placeholder="0.000"
                      className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30" />
                  </div>
                </div>
              )}
            </>
          )}
          <div className={`grid ${form.sold_by_weight ? 'grid-cols-1' : 'grid-cols-2'} gap-3`}>
            {!form.sold_by_weight && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1">Precio venta</label>
                <input type="number" min="0" step="0.01" value={form.price} onChange={e => set('price', e.target.value)}
                  className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1">Costo {form.sold_by_weight ? `(por ${form.unit || 'lb'})` : ''}</label>
              <input type="number" min="0" step="0.01" value={form.cost} onChange={e => set('cost', e.target.value)}
                className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
          {!form.sold_by_weight && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                <Bike size={11} className="text-[#b3001e]" /> Precio Pedidos Ya (opcional)
              </label>
              <input type="number" min="0" step="0.01" value={form.price_pedidos_ya}
                onChange={e => set('price_pedidos_ya', e.target.value)}
                placeholder="Deja en blanco para usar el precio normal"
                className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30" />
              <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1">Se usa al facturar pedidos del canal de delivery Pedidos Ya.</p>
            </div>
          )}
          {!item && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1">Cantidad inicial</label>
                <input type="number" min="0" value={form.quantity} onChange={e => set('quantity', e.target.value)}
                  className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1">Mínimo (alerta)</label>
                <input type="number" min="0" value={form.min_quantity} onChange={e => set('min_quantity', e.target.value)}
                  className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>
          )}
          {item && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1">Mínimo (alerta)</label>
              <input type="number" min="0" value={form.min_quantity} onChange={e => set('min_quantity', e.target.value)}
                className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          )}
          {err && <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle size={12} />{err}</p>}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/10 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-1.5">
            {saving && <Loader2 size={13} className="animate-spin" />}
            {item ? 'Guardar cambios' : 'Crear item'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Adjust qty modal ───────────────────────────────────────────────────────────
function AdjustModal({ item, onSave, onClose }) {
  const api = useAPI()
  const { user } = useAuth()
  const [delta,  setDelta]  = useState(0)
  const [notes,  setNotes]  = useState('')
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')
  const [gateOpen, setGateOpen] = useState(false)
  const gateApprovedRef = useRef(false)

  const newQty = item.quantity + Number(delta || 0)

  async function handleSave() {
    const d = Number(delta)
    if (!d || isNaN(d)) { setErr('Ingresa una cantidad distinta de cero.'); return }
    // v2.6 — Manager Authorization Gate for negative (or any, per rules) adjustments.
    if (!gateApprovedRef.current && needsGate(user, 'inv_adjust')) {
      setGateOpen(true)
      return
    }
    setSaving(true)
    try {
      await api.inventory.adjust({ id: item.id, delta: d, notes, userId: user?.id })
      onSave()
    } catch (e) {
      setErr(e?.message || 'Error al ajustar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-white/5 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/10">
          <h3 className="font-bold text-slate-800 dark:text-white">Ajustar cantidad</h3>
          <button onClick={onClose} className="text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-white">{item.name}</p>
            <p className="text-xs text-slate-400 dark:text-white/40 mt-0.5">Stock actual: <span className="font-semibold text-slate-600 dark:text-white/60">{item.quantity}</span></p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1">
              Cantidad (+ para entrada, - para salida)
            </label>
            <div className="flex items-center gap-2">
              <button onClick={() => setDelta(d => Number(d) - 1)}
                className="w-9 h-9 rounded-lg border border-slate-200 dark:border-white/10 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-white/10 text-slate-600 dark:text-white/60">
                <ChevronDown size={16} />
              </button>
              <input type="number" value={delta} onChange={e => { setDelta(e.target.value); setErr('') }}
                className="flex-1 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-center font-semibold dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <button onClick={() => setDelta(d => Number(d) + 1)}
                className="w-9 h-9 rounded-lg border border-slate-200 dark:border-white/10 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-white/10 text-slate-600 dark:text-white/60">
                <ChevronUp size={16} />
              </button>
            </div>
            {newQty >= 0 && (
              <p className="text-xs text-slate-400 dark:text-white/40 mt-1.5 text-center">
                Nuevo stock: <span className={`font-semibold ${newQty <= item.min_quantity ? 'text-amber-600' : 'text-green-600'}`}>{newQty}</span>
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1">Notas (opcional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Ej: Recepción factura #123"
              className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          {err && <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle size={12} />{err}</p>}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/10 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-1.5">
            {saving && <Loader2 size={13} className="animate-spin" />}
            Confirmar
          </button>
        </div>
      </div>

      {gateOpen && (
        <ManagerAuthGate
          action="inv_adjust"
          actionLabel={`Ajuste de ${item.name}: ${Number(delta) > 0 ? '+' : ''}${delta}`}
          context={{ target_id: item.id, target_name: item.name, amount: Number(delta) || 0,
            old_value: item.quantity, new_value: newQty, reason: notes }}
          onApprove={() => {
            gateApprovedRef.current = true
            setGateOpen(false)
            setTimeout(() => handleSave(), 0)
          }}
          onCancel={() => setGateOpen(false)}
        />
      )}
    </div>
  )
}

// ── Transaction history panel ──────────────────────────────────────────────────
function HistoryPanel({ item, onClose }) {
  const api = useAPI()
  const [txns, setTxns]       = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.inventory.transactions({ id: item.id })
      .then(r => { setTxns(r || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [item.id])

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-white/5 rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/10 shrink-0">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-white">Historial — {item.name}</h3>
            <p className="text-xs text-slate-400 dark:text-white/40 mt-0.5">Últimas 50 transacciones</p>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading && <p className="text-center text-slate-400 dark:text-white/40 text-sm py-8">Cargando…</p>}
          {!loading && txns.length === 0 && <p className="text-center text-slate-400 dark:text-white/40 text-sm py-8">Sin movimientos registrados.</p>}
          {txns.map(t => (
            <div key={t.id} className="flex items-start gap-3 py-3 border-b border-slate-50 dark:border-white/5 last:border-0">
              <span className={`text-sm font-bold w-10 text-right shrink-0 ${t.delta > 0 ? 'text-green-600' : 'text-red-500'}`}>
                {t.delta > 0 ? `+${t.delta}` : t.delta}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-600 dark:text-white/60">{t.notes || '—'}</p>
                <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">{t.user_name || 'Sistema'} · {fmtDate(t.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── CSV Import modal ──────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { headers: [], rows: [] }
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','

  function splitRow(line) {
    const result = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { current += '"'; i++ }
          else inQuotes = false
        } else {
          current += ch
        }
      } else if (ch === '"') {
        inQuotes = true
      } else if (ch === sep) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = splitRow(lines[0]).map(h => h.replace(/^["']|["']$/g, '').toLowerCase())
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const vals = splitRow(lines[i])
    if (vals.every(v => !v)) continue
    const obj = {}
    headers.forEach((h, idx) => { obj[h] = vals[idx] || '' })
    rows.push(obj)
  }
  return { headers, rows }
}

const FIELD_MAP = {
  sku: ['sku', 'codigo', 'code', 'cod'],
  barcode: ['barcode', 'codigo_barras', 'codigo de barras', 'ean', 'upc'],
  name: ['name', 'nombre', 'producto', 'product', 'descripcion', 'description', 'item'],
  category: ['category', 'categoria', 'cat', 'tipo'],
  price: ['price', 'precio', 'precio_venta', 'venta', 'sell'],
  price_pedidos_ya: ['price_pedidos_ya', 'precio_pedidos_ya', 'precio_py', 'py_precio', 'pedidos_ya', 'py', 'precio_pedidosya', 'pedidosya'],
  cost: ['cost', 'costo', 'precio_costo', 'compra', 'buy'],
  quantity: ['quantity', 'stock', 'cantidad', 'qty', 'existencia'],
  min_quantity: ['min_quantity', 'min_stock', 'minimo', 'min', 'reorder'],
  bottle_deposit: ['bottle_deposit', 'deposito', 'deposito_botella', 'envase', 'deposit'],
}

function mapField(header) {
  const h = header.toLowerCase().trim()
  for (const [field, aliases] of Object.entries(FIELD_MAP)) {
    if (aliases.includes(h)) return field
  }
  return null
}

function ImportModal({ onDone, onClose }) {
  const api = useAPI()
  const [step, setStep] = useState('pick')    // 'pick' | 'preview' | 'importing' | 'done'
  const [rows, setRows] = useState([])
  const [mapping, setMapping] = useState({})   // csvHeader → field
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState({ ok: 0, fail: 0 })
  const fileRef = useRef(null)

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const { headers, rows: parsed } = parseCSV(ev.target.result)
      if (!parsed.length) return
      // Auto-map columns
      const autoMap = {}
      headers.forEach(h => {
        const field = mapField(h)
        if (field) autoMap[h] = field
      })
      setMapping(autoMap)
      setRows(parsed)
      setStep('preview')
    }
    reader.readAsText(file)
  }

  function getMapped(row) {
    const out = {}
    for (const [csvH, field] of Object.entries(mapping)) {
      if (field && row[csvH] !== undefined) out[field] = row[csvH]
    }
    return out
  }

  async function handleImport() {
    setStep('importing')
    let ok = 0, fail = 0
    for (let i = 0; i < rows.length; i++) {
      const raw = getMapped(rows[i])
      if (!raw.name) { fail++; continue }
      try {
        await api.inventory.create({
          name:           raw.name,
          sku:            raw.sku || null,
          barcode:        raw.barcode || null,
          category:       raw.category || 'Otro',
          price:          parseFloat(raw.price) || 0,
          price_pedidos_ya: (raw.price_pedidos_ya === '' || raw.price_pedidos_ya == null) ? null : (parseFloat(raw.price_pedidos_ya) || null),
          cost:           parseFloat(raw.cost) || 0,
          quantity:       parseInt(raw.quantity) || 0,
          min_quantity:   parseInt(raw.min_quantity) || 5,
          bottle_deposit: parseFloat(raw.bottle_deposit) || 0,
        })
        ok++
      } catch { fail++ }
      setProgress(Math.round(((i + 1) / rows.length) * 100))
    }
    setResults({ ok, fail })
    setStep('done')
  }

  const previewRows = rows.slice(0, 10)
  const mappedFields = Object.values(mapping).filter(Boolean)
  const hasName = mappedFields.includes('name')

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-3xl shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/10 shrink-0">
          <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <FileSpreadsheet size={18} /> Importar Productos (CSV)
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-white/40 dark:hover:text-white"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          {step === 'pick' && (
            <div className="flex flex-col items-center py-8 gap-4">
              <div className="w-16 h-16 bg-slate-100 dark:bg-white/10 rounded-2xl flex items-center justify-center">
                <Upload size={28} className="text-slate-400" />
              </div>
              <p className="text-sm text-slate-600 dark:text-white/60 text-center max-w-sm">
                Sube un archivo CSV con tus productos. Columnas soportadas: SKU, Barcode, Nombre, Categoria, Precio, Costo, Stock, Min Stock.
              </p>
              <label className="cursor-pointer px-6 py-3 bg-black text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors">
                Seleccionar archivo CSV
                <input type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleFile} />
              </label>
            </div>
          )}

          {step === 'preview' && (
            <div>
              <p className="text-sm text-slate-600 dark:text-white/60 mb-3">
                {rows.length} productos encontrados. Vista previa (primeros 10):
              </p>
              {!hasName && (
                <div className="flex items-center gap-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg p-3 mb-3">
                  <AlertTriangle size={14} className="text-red-500 shrink-0" />
                  <p className="text-xs text-red-600 dark:text-red-400">No se detecto columna de nombre. Verifica que tu CSV tenga una columna "Nombre" o "Name".</p>
                </div>
              )}
              <div className="overflow-x-auto border border-slate-200 dark:border-white/10 rounded-xl">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10">
                      {Object.keys(rows[0] || {}).map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-white/40">
                          <div>{h}</div>
                          <select value={mapping[h] || ''} onChange={e => setMapping(m => ({ ...m, [h]: e.target.value || undefined }))}
                            className="mt-1 text-[10px] bg-white dark:bg-white/10 border border-slate-200 dark:border-white/10 rounded px-1 py-0.5 w-full">
                            <option value="">— ignorar —</option>
                            {Object.keys(FIELD_MAP).map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-b border-slate-100 dark:border-white/5">
                        {Object.values(row).map((v, j) => (
                          <td key={j} className="px-3 py-1.5 text-slate-600 dark:text-white/60 truncate max-w-[150px]">{v}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 10 && <p className="text-[10px] text-slate-400 mt-2">...y {rows.length - 10} mas</p>}
            </div>
          )}

          {step === 'importing' && (
            <div className="flex flex-col items-center py-12 gap-4">
              <Loader2 size={32} className="animate-spin text-blue-500" />
              <p className="text-sm font-medium text-slate-700 dark:text-white">Importando productos... {progress}%</p>
              <div className="w-full max-w-xs bg-slate-100 dark:bg-white/10 rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center py-12 gap-4">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-500/10 rounded-full flex items-center justify-center">
                <Check size={32} className="text-green-500" />
              </div>
              <p className="text-lg font-bold text-slate-800 dark:text-white">{results.ok} productos importados</p>
              {results.fail > 0 && <p className="text-sm text-red-500">{results.fail} fallaron (sin nombre o error)</p>}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/10 flex justify-end gap-3 shrink-0">
          {step === 'preview' && (
            <>
              <button onClick={() => { setStep('pick'); setRows([]) }}
                className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 dark:text-white/40 dark:hover:text-white">
                Atras
              </button>
              <button onClick={handleImport} disabled={!hasName}
                className="px-6 py-2 bg-black text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-40 transition-colors">
                Importar {rows.length} productos
              </button>
            </>
          )}
          {step === 'done' && (
            <button onClick={() => { onDone(); onClose() }}
              className="px-6 py-2 bg-black text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors">
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Organizar (bulk categorize + PY price) modal ─────────────────────────────
function OrganizeModal({ items, categories, onDone, onClose }) {
  const api = useAPI()
  const [query, setQuery]           = useState('')
  const [selected, setSelected]     = useState(() => new Set())
  const [newCategory, setNewCategory] = useState('')
  const [newPY, setNewPY]           = useState('')
  const [saving, setSaving]         = useState(false)
  const [toast, setToast]           = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(i =>
      (i.name || '').toLowerCase().includes(q)
      || (i.sku || '').toLowerCase().includes(q)
      || (i.barcode || '').toLowerCase().includes(q)
      || (i.category || '').toLowerCase().includes(q)
    )
  }, [items, query])

  const allVisibleSelected = filtered.length > 0 && filtered.every(i => selected.has(i.id))

  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) filtered.forEach(i => next.delete(i.id))
      else                    filtered.forEach(i => next.add(i.id))
      return next
    })
  }
  function toggleOne(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function apply() {
    const ids = Array.from(selected)
    if (!ids.length) return
    const patch = {}
    if (newCategory.trim())                             patch.category = newCategory.trim()
    if (newPY !== '' && !Number.isNaN(Number(newPY)))   patch.price_pedidos_ya = Number(newPY)
    if (!Object.keys(patch).length) { setToast('Ingresa una categoría o un precio Pedidos Ya.'); return }
    setSaving(true)
    try {
      if (typeof api.inventory.bulkUpdate === 'function') {
        await api.inventory.bulkUpdate(ids, patch)
      } else {
        for (const id of ids) await api.inventory.update({ id, ...patch })
      }
      setToast(`${ids.length} producto${ids.length === 1 ? '' : 's'} actualizado${ids.length === 1 ? '' : 's'}.`)
      setSelected(new Set())
      setNewCategory('')
      setNewPY('')
      await onDone()
    } catch (e) {
      setToast(e?.message || 'Error al aplicar cambios.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-4xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/10 shrink-0">
          <div>
            <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <Tags size={18} className="text-[#b3001e]" /> Organizar productos
            </h3>
            <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">
              Filtra, selecciona y aplica categoría o precio Pedidos Ya a varios productos a la vez.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-white/40 dark:hover:text-white"><X size={18} /></button>
        </div>

        {/* Search */}
        <div className="px-6 pt-4 shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl focus-within:ring-2 focus-within:ring-[#b3001e]/30">
            <Search size={14} className="text-slate-400 dark:text-white/40 shrink-0" />
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Buscar por nombre, SKU, código de barras o categoría…"
              className="flex-1 bg-transparent outline-none text-sm text-slate-700 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40" />
            {query && (
              <button onClick={() => setQuery('')} className="text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between mt-2 text-[11px]">
            <span className="text-slate-500 dark:text-white/60">
              {filtered.length} coincidencia{filtered.length === 1 ? '' : 's'} · {selected.size} seleccionado{selected.size === 1 ? '' : 's'}
            </span>
            <button onClick={toggleAll} disabled={filtered.length === 0}
              className="text-[11px] font-medium text-[#b3001e] hover:underline disabled:opacity-40">
              {allVisibleSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto px-6 py-3 min-h-[200px]">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-400 dark:text-white/40 text-sm">Sin resultados.</div>
          ) : (
            <div className="border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-white/5 text-[11px] text-slate-500 dark:text-white/50 uppercase tracking-wide">
                  <tr>
                    <th className="w-10 px-3 py-2"></th>
                    <th className="px-3 py-2 text-left font-semibold">Producto</th>
                    <th className="px-3 py-2 text-left font-semibold">Categoría</th>
                    <th className="px-3 py-2 text-right font-semibold">Precio</th>
                    <th className="px-3 py-2 text-right font-semibold">PY</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 500).map(i => {
                    const checked = selected.has(i.id)
                    return (
                      <tr key={i.id}
                        onClick={() => toggleOne(i.id)}
                        className={`border-t border-slate-100 dark:border-white/5 cursor-pointer transition-colors ${checked ? 'bg-[#b3001e]/5 dark:bg-[#b3001e]/10' : 'hover:bg-slate-50 dark:hover:bg-white/5'}`}>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={checked} onChange={() => toggleOne(i.id)}
                            onClick={e => e.stopPropagation()}
                            className="w-4 h-4 rounded border-slate-300 text-[#b3001e] focus:ring-[#b3001e]/30" />
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-medium text-slate-800 dark:text-white text-[13px]">{i.name}</p>
                          {i.sku && <p className="text-[10px] text-slate-400 dark:text-white/40">{i.sku}</p>}
                        </td>
                        <td className="px-3 py-2 text-slate-500 dark:text-white/60 text-xs">{i.category || '—'}</td>
                        <td className="px-3 py-2 text-right text-slate-600 dark:text-white/70 text-xs">{fmtRD(i.price)}</td>
                        <td className="px-3 py-2 text-right text-xs">
                          {i.price_pedidos_ya != null
                            ? <span className="text-[#b3001e] font-semibold">{fmtRD(i.price_pedidos_ya)}</span>
                            : <span className="text-slate-300 dark:text-white/20">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filtered.length > 500 && (
                <p className="px-3 py-2 text-[10px] text-slate-400 dark:text-white/40 bg-slate-50 dark:bg-white/5 border-t border-slate-100 dark:border-white/10">
                  Mostrando 500 de {filtered.length}. Refina tu búsqueda para ver más.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Action strip */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/10 bg-slate-50/50 dark:bg-white/5 shrink-0 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1">Categoría</label>
              <input list="org-categories" value={newCategory} onChange={e => setNewCategory(e.target.value)}
                placeholder="Ej: Ron, Whisky, Cerveza…"
                className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30" />
              <datalist id="org-categories">
                {categories.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                <Bike size={11} className="text-[#b3001e]" /> Precio Pedidos Ya (RD$)
              </label>
              <input type="number" min="0" step="0.01" value={newPY} onChange={e => setNewPY(e.target.value)}
                placeholder="Deja en blanco para no cambiar"
                className="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-slate-500 dark:text-white/60 flex-1 truncate">
              {toast || (selected.size === 0 ? 'Selecciona al menos un producto.' : 'Listo para aplicar cambios.')}
            </p>
            <div className="flex gap-2">
              <button onClick={onClose}
                className="px-4 py-2 border border-slate-200 dark:border-white/10 rounded-xl text-sm text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10">
                Cerrar
              </button>
              <button onClick={apply} disabled={saving || selected.size === 0 || (!newCategory.trim() && newPY === '')}
                className="px-6 py-2 bg-black text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-colors">
                {saving && <Loader2 size={14} className="animate-spin" />}
                Aplicar a {selected.size || 0} seleccionado{selected.size === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Inline PY price editor ────────────────────────────────────────────────────
function InlinePYPrice({ item, onSave }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue]     = useState(item.price_pedidos_ya ?? '')
  const [saving, setSaving]   = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { setValue(item.price_pedidos_ya ?? '') }, [item.price_pedidos_ya])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  async function commit() {
    const normalized = value === '' || value == null ? null : Number(value)
    if (normalized === (item.price_pedidos_ya ?? null)) { setEditing(false); return }
    setSaving(true)
    try {
      await onSave(normalized)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)}
        className="w-full text-right px-2 py-1 rounded-md hover:bg-[#b3001e]/5 dark:hover:bg-[#b3001e]/10 transition-colors group">
        {item.price_pedidos_ya != null
          ? <span className="text-[#b3001e] font-semibold text-xs">{fmtRD(item.price_pedidos_ya)}</span>
          : <span className="text-slate-300 dark:text-white/20 text-xs group-hover:text-[#b3001e]/60">Añadir</span>}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1 justify-end">
      <input ref={inputRef} type="number" min="0" step="0.01" value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') { setValue(item.price_pedidos_ya ?? ''); setEditing(false) }
        }}
        placeholder="—"
        className="w-24 text-right border border-[#b3001e]/40 rounded-md px-2 py-1 text-xs dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/30" />
      {saving && <Loader2 size={11} className="animate-spin text-[#b3001e]" />}
    </div>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function Inventory() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()

  const [items,    setItems]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [filter,   setFilter]   = useState('all')   // 'all' | 'low'
  const [modal,    setModal]    = useState(null)     // null | { type: 'item'|'adjust'|'history'|'import', item }
  const [showImport, setShowImport] = useState(false)
  const [showOrganize, setShowOrganize] = useState(false)
  const [delConfirm, setDelConfirm] = useState(null)

  if (!ALLOWED.includes(user?.role)) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-white/40 text-sm">
        Sin acceso
      </div>
    )
  }

  async function load() {
    setLoading(true)
    try {
      const data = await api?.inventory?.all()
      setItems(data || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleDelete(item) {
    await api.inventory.delete({ id: item.id })
    setDelConfirm(null)
    load()
  }

  // v2.3.27 — bulk wipe. Loops through each row and deletes. Sync pushes the
  // deletions on next cycle via supabaseDelete. Confirmation is destructive.
  async function handleWipeAll() {
    const n = items.length
    if (n === 0) return
    const confirm1 = window.confirm(
      lang === 'en'
        ? `Delete ALL ${n} inventory items? This cannot be undone.`
        : `¿Eliminar TODOS los ${n} productos del inventario? No se puede deshacer.`)
    if (!confirm1) return
    const typed = window.prompt(lang === 'en' ? `Type ERASE to confirm:` : `Escribe BORRAR para confirmar:`)
    if ((typed || '').toUpperCase().trim() !== (lang === 'en' ? 'ERASE' : 'BORRAR')) return
    setLoading(true)
    try {
      for (const it of items) {
        try { await api.inventory.delete({ id: it.id }) } catch {}
      }
    } finally {
      setLoading(false)
      load()
    }
  }

  const filtered = useMemo(() => {
    let list = items
    if (filter === 'low') list = list.filter(i => i.quantity <= i.min_quantity)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(i => i.name.toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q))
    }
    return list
  }, [items, search, filter])

  const lowCount    = items.filter(i => i.quantity <= i.min_quantity).length
  const totalValue  = items.reduce((s, i) => s + (i.quantity * i.price), 0)
  const totalCost   = items.reduce((s, i) => s + (i.quantity * (i.cost || 0)), 0)
  const totalProfit = totalValue - totalCost

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-black">
      {/* Header */}
      <div className="bg-white dark:bg-white/5 border-b border-slate-200 dark:border-white/10 px-3 py-3 md:px-6 md:py-4 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <Package size={20} className="text-slate-500 dark:text-white/60" />
          <h1 className="text-[14px] md:text-[16px] font-bold text-slate-800 dark:text-white">{lang === 'en' ? 'Inventory' : 'Inventario'}</h1>
        </div>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <button onClick={handleWipeAll}
              title={lang === 'en' ? 'Delete all inventory (destructive)' : 'Borrar todo el inventario (destructivo)'}
              className="flex items-center gap-2 px-3 py-2 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 rounded-xl text-sm font-medium hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
              <Trash2 size={15} /> {lang === 'en' ? 'Erase All' : 'Borrar Todo'}
            </button>
          )}
          {items.length > 0 && (
            <button onClick={() => setShowOrganize(true)}
              title={lang === 'en' ? 'Bulk categorize + Pedidos Ya prices' : 'Categorizar en bloque + precios Pedidos Ya'}
              className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 rounded-xl text-sm font-medium hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
              <Tags size={15} className="text-[#b3001e]" /> {lang === 'en' ? 'Organize' : 'Organizar'}
            </button>
          )}
          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 rounded-xl text-sm font-medium hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
            <Upload size={15} /> {lang === 'en' ? 'Import CSV' : 'Importar CSV'}
          </button>
          <button
            onClick={() => setModal({ type: 'item', item: null })}
            className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors">
            <Plus size={15} /> Agregar item
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
        {[
          { label: 'Total items',         value: items.length,         color: 'text-slate-700 dark:text-white' },
          { label: 'Stock bajo',          value: lowCount,             color: lowCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-white' },
          { label: 'Valor en stock',      value: fmtRD(totalValue),    color: 'text-slate-700 dark:text-white' },
          { label: 'Ganancia potencial',  value: fmtRD(totalProfit),   color: totalProfit > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-white' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 px-4 py-3">
            <p className="text-xs text-slate-400 dark:text-white/40 mb-1">{label}</p>
            <p className={`text-[18px] font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters + search */}
      <div className="px-6 pb-3 flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl focus-within:ring-2 focus-within:ring-blue-400 flex-1 max-w-xs">
          <Search size={14} className="text-slate-400 dark:text-white/40 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, SKU, categoría…"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-700 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40" />
        </div>
        <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden text-sm">
          {[['all', 'Todos'], ['low', `Stock bajo (${lowCount})`]].map(([v, label]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`px-4 py-1.5 font-medium transition ${filter === v ? 'bg-black text-white' : 'text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10'}`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={load} className="p-2 text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white transition-colors">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-white/40 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> Cargando…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400 dark:text-white/40 text-sm">
            {items.length === 0 ? 'No hay items. Agrega tu primer producto.' : 'Sin resultados para la búsqueda.'}
          </div>
        ) : (
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
            {/* Desktop table */}
            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/10 text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide">Nombre</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide">Categoría</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide text-right">Stock</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide text-right">Costo</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide text-right">Precio</th>
                  <th className="px-4 py-3 text-xs font-semibold text-[#b3001e] uppercase tracking-wide text-right whitespace-nowrap">PY Precio</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide text-right">Margen</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-white/60 uppercase tracking-wide text-right">Valor</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => {
                  const isLow = item.quantity <= item.min_quantity
                  return (
                    <tr key={item.id} className="border-b border-slate-50 dark:border-white/5 last:border-0 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800 dark:text-white">{item.name}</p>
                        {item.sku && <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">{item.sku}</p>}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-white/60 text-xs">{item.category || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-bold text-base ${isLow ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-white'}`}>
                          {item.quantity}
                        </span>
                        {isLow && (
                          <span className="ml-1.5 text-[10px] font-medium text-amber-500 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                            mín {item.min_quantity}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500 dark:text-white/50 text-xs">{item.cost > 0 ? fmtRD(item.cost) : '—'}</td>
                      <td className="px-4 py-3 text-right text-slate-600 dark:text-white/60">{fmtRD(item.price)}</td>
                      <td className="px-4 py-3 text-right">
                        <InlinePYPrice item={item}
                          onSave={async (py) => {
                            await api.inventory.update({ id: item.id, price_pedidos_ya: py })
                            // Optimistic local patch so the inline cell reflects the new value
                            // without a full reload round-trip (avoids flash).
                            setItems(prev => prev.map(x => x.id === item.id ? { ...x, price_pedidos_ya: py } : x))
                          }} />
                      </td>
                      <td className="px-4 py-3 text-right text-xs">
                        {item.cost > 0 && item.price > 0 ? (
                          <span className={`font-semibold ${item.price > item.cost ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                            {Math.round(((item.price - item.cost) / item.price) * 100)}%
                          </span>
                        ) : <span className="text-slate-300 dark:text-white/20">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500 dark:text-white/60 text-xs">{fmtRD(item.quantity * item.price)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setModal({ type: 'adjust', item })}
                            className="px-2 py-1 text-xs border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/10 text-slate-600 dark:text-white/60 font-medium">
                            Ajustar
                          </button>
                          <button onClick={() => setModal({ type: 'history', item })}
                            className="p-1.5 text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white rounded-lg hover:bg-slate-50 dark:hover:bg-white/10" title="Historial">
                            <History size={14} />
                          </button>
                          <button onClick={() => setModal({ type: 'item', item })}
                            className="p-1.5 text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white rounded-lg hover:bg-slate-50 dark:hover:bg-white/10" title="Editar">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => setDelConfirm(item)}
                            className="p-1.5 text-slate-400 dark:text-white/40 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10" title="Eliminar">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-white/10">
              {filtered.map(item => {
                const isLow = item.quantity <= item.min_quantity
                return (
                  <div key={item.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">{item.name}</p>
                        <p className="text-[11px] text-slate-400 dark:text-white/40">{item.category || '—'}{item.sku ? ` / ${item.sku}` : ''}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`text-[15px] font-bold ${isLow ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-white'}`}>{item.quantity}</span>
                        {isLow && <p className="text-[10px] text-amber-500 dark:text-amber-400">min {item.min_quantity}</p>}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500 dark:text-white/60">Precio: <span className="font-semibold text-slate-700 dark:text-white">{fmtRD(item.price)}</span></span>
                      <span className="text-slate-400 dark:text-white/40">Valor: {fmtRD(item.quantity * item.price)}</span>
                    </div>
                    {item.price_pedidos_ya != null && (
                      <div className="flex items-center gap-1.5 text-[11px] text-[#b3001e]">
                        <Bike size={11} /> <span className="font-semibold">PY: {fmtRD(item.price_pedidos_ya)}</span>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button onClick={() => setModal({ type: 'adjust', item })}
                        className="flex-1 py-2 text-[11px] font-medium border border-slate-200 dark:border-white/10 rounded-lg text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">
                        Ajustar
                      </button>
                      <button onClick={() => setModal({ type: 'item', item })}
                        className="px-3 py-2 text-[11px] border border-slate-200 dark:border-white/10 rounded-lg text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => setDelConfirm(item)}
                        className="px-3 py-2 text-[11px] border border-red-200 dark:border-red-500/30 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {modal?.type === 'item' && (
        <ItemModal item={modal.item} onClose={() => setModal(null)} onSave={() => { setModal(null); load() }} />
      )}
      {modal?.type === 'adjust' && (
        <AdjustModal item={modal.item} onClose={() => setModal(null)} onSave={() => { setModal(null); load() }} />
      )}
      {modal?.type === 'history' && (
        <HistoryPanel item={modal.item} onClose={() => setModal(null)} />
      )}
      {showImport && (
        <ImportModal onDone={load} onClose={() => setShowImport(false)} />
      )}
      {showOrganize && (
        <OrganizeModal
          items={items}
          categories={Array.from(new Set(items.map(i => (i.category || '').trim()).filter(Boolean))).sort()}
          onDone={load}
          onClose={() => setShowOrganize(false)} />
      )}

      {/* Delete confirm */}
      {delConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-white/5 rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center">
            <p className="font-semibold text-slate-800 dark:text-white mb-2">¿Eliminar item?</p>
            <p className="text-sm text-slate-500 dark:text-white/60 mb-6">Se eliminará <span className="font-medium text-slate-700 dark:text-white">{delConfirm.name}</span>. Esta acción no se puede deshacer.</p>
            <div className="flex gap-3">
              <button onClick={() => setDelConfirm(null)} className="flex-1 py-2 border border-slate-200 dark:border-white/10 rounded-lg text-sm text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/10">Cancelar</button>
              <button onClick={() => handleDelete(delConfirm)} className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
