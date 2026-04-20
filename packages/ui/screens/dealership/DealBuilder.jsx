/**
 * DealBuilder.jsx — Dealership big-ticket checkout.
 *
 * Dealerships don't use the standard POS for a vehicle sale — the math is
 * different (trade-in, down payment, financing), the ticket is one line item,
 * and the unit's inventory status needs to flip to `sold`.
 *
 * This screen:
 *   1) pick vehicle from available inventory
 *   2) pick client
 *   3) optional trade-in (appraisal → new row in vehicle_inventory with
 *      acquisition_cost = appraisal, status=available)
 *   4) down payment + financing terms (APR, months) → live monthly payment
 *   5) save deal + mark unit sold
 *
 * e-CF/legal NCF flow is intentionally out of scope here — a dealership in DR
 * normally issues the fiscal document via the Invoicing module (B01/E31) with
 * the client's RNC. This screen stores the deal record so Reportes and the
 * RemoteDashboard can surface it.
 */

import { useState, useEffect, useMemo } from 'react'
import {
  CarFront, User, DollarSign, Calendar, Percent, Loader2, Check,
  ArrowDown, Plus, FileText,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../i18n'
import { computeDeal } from './lib/financing.js'
import CobrarModal from '../../components/CobrarModal'

// DGII: E31 (Crédito Fiscal) required when the buyer expects ITBIS credit,
// and is the norm for DR dealership vehicle sales ≥ RD$250,000. Below that
// threshold, default to E32 (Consumo).
const ECF_E31_THRESHOLD = 250000

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

export default function DealBuilder() {
  const api = useAPI()
  const { user } = useAuth()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [units, setUnits] = useState([])
  const [clients, setClients] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  // v2.6.2 — Ticket + e-CF bridge. After salesDeals.create succeeds we open
  // CobrarModal with the vehicle as a single line item so the sale produces
  // a fiscal receipt + hits Cuadre / reports.
  const [cobrarCtx, setCobrarCtx] = useState(null)

  const [vehicleId, setVehicleId] = useState('')
  const [clientId, setClientId] = useState('')
  const [salespersonId, setSalespersonId] = useState('')
  const [salePrice, setSalePrice] = useState(0)
  const [hasTradeIn, setHasTradeIn] = useState(false)
  const [tradeIn, setTradeIn] = useState({ make: '', model: '', year: '', vin: '', mileage: 0, appraisal: 0 })
  const [downPayment, setDownPayment] = useState(0)
  const [aprAnnual, setAprAnnual] = useState(0)
  const [termMonths, setTermMonths] = useState(0)
  const [notes, setNotes] = useState('')

  useEffect(() => { (async () => {
    setLoading(true)
    const [u, c, s] = await Promise.all([
      api.vehicleInventory.list({ status: 'available' }),
      api.clients?.list?.() || Promise.resolve([]),
      api.empleados?.list?.() || Promise.resolve([]),
    ])
    setUnits(u || []); setClients(c || []); setStaff(s || [])
    setLoading(false)
  })() }, []) // eslint-disable-line

  const selectedUnit = useMemo(() => units.find(u => u.id === vehicleId), [units, vehicleId])
  useEffect(() => {
    if (selectedUnit && !salePrice) setSalePrice(Number(selectedUnit.listing_price || 0))
  }, [selectedUnit]) // eslint-disable-line

  const deal = useMemo(() => computeDeal({
    salePrice,
    tradeInValue: hasTradeIn ? tradeIn.appraisal : 0,
    downPayment,
    aprAnnualPct: aprAnnual,
    termMonths,
  }), [salePrice, hasTradeIn, tradeIn.appraisal, downPayment, aprAnnual, termMonths])

  function resetAll() {
    setVehicleId(''); setClientId(''); setSalespersonId(''); setSalePrice(0)
    setHasTradeIn(false); setTradeIn({ make: '', model: '', year: '', vin: '', mileage: 0, appraisal: 0 })
    setDownPayment(0); setAprAnnual(0); setTermMonths(0); setNotes('')
    setResult(null); setCobrarCtx(null)
  }

  async function closeDeal() {
    if (!vehicleId || !clientId) return
    setSaving(true)
    try {
      let tradeInIdRef = null
      let tradeInSidRef = null
      if (hasTradeIn && Number(tradeIn.appraisal) > 0) {
        const ti = await api.vehicleInventory.create({
          make: tradeIn.make, model: tradeIn.model,
          year: tradeIn.year ? Number(tradeIn.year) : null,
          vin: tradeIn.vin, mileage: Number(tradeIn.mileage) || 0,
          acquisition_cost: Number(tradeIn.appraisal) || 0,
          listing_price: 0, condition: 'used', status: 'available',
          title_status: 'pending',
          notes: L('Recibido como intercambio', 'Received as trade-in'),
        })
        tradeInIdRef = ti?.id || null
        tradeInSidRef = ti?.supabase_id || null
      }

      const client = clients.find(c => c.id === clientId)
      const sp = staff.find(s => s.id === salespersonId)

      const created = await api.salesDeals.create({
        client_id: clientId,
        client_supabase_id: client?.supabase_id || null,
        vehicle_inventory_id: vehicleId,
        vehicle_inventory_supabase_id: selectedUnit?.supabase_id || null,
        salesperson_id: salespersonId || null,
        salesperson_supabase_id: sp?.supabase_id || null,
        sale_price: Number(salePrice) || 0,
        trade_in_vehicle_id: tradeInIdRef,
        trade_in_supabase_id: tradeInSidRef,
        trade_in_value: hasTradeIn ? (Number(tradeIn.appraisal) || 0) : 0,
        down_payment: Number(downPayment) || 0,
        financed_amount: deal.financed,
        term_months: Number(termMonths) || 0,
        apr: Number(aprAnnual) || 0,
        monthly_payment: deal.monthly,
        status: 'closed',
        notes,
        closed_at: new Date().toISOString(),
      })

      await api.vehicleInventory.setStatus(vehicleId, 'sold')

      // v2.6.2 — hand off to CobrarModal for the fiscal receipt. Total price
      // ≥ RD$250K forces E31 (Crédito Fiscal). The success banner appears
      // after the cashier confirms payment in the modal.
      const totalPrice = Math.max(0, Number(salePrice) - (hasTradeIn ? Number(tradeIn.appraisal) || 0 : 0))
      const forceType  = totalPrice >= ECF_E31_THRESHOLD ? 'E31' : 'E32'
      setCobrarCtx({
        dealId:         created?.id || null,
        dealSupabaseId: created?.supabase_id || null,
        client,
        totalPrice,
        forceType,
        ticket: {
          id:       `deal-${created?.id || 'new'}`,
          ticketNo: `DEAL-${created?.id || ''}`,
          vehicle:  selectedUnit ? `${selectedUnit.year || ''} ${selectedUnit.make || ''} ${selectedUnit.model || ''} ${selectedUnit.vin ? '· VIN ' + selectedUnit.vin : ''}`.trim() : '',
          services: [{
            id:           `deal-${created?.id || 'new'}-veh`,
            name:         selectedUnit ? `${selectedUnit.year || ''} ${selectedUnit.make || ''} ${selectedUnit.model || ''}`.trim() : L('Vehículo', 'Vehicle'),
            price:        totalPrice,
            qty:          1,
            cost:         Number(selectedUnit?.acquisition_cost) || 0,
            is_wash:      0,
            aplica_itbis: 0, // vehicle sales typically use ITBIS-exempt flow; owner can override via E31 RNC fields
          }],
          client: client ? { id: client.id, supabase_id: client.supabase_id, name: client.name } : null,
        },
      })
    } catch (ex) {
      setResult({ ok: false, err: ex?.message || 'Error' })
    } finally {
      setSaving(false)
    }
  }

  async function handleDealCobrarConfirm(paymentData) {
    const ctx = cobrarCtx
    if (!ctx) return
    try {
      const result = await api.tickets.create({
        vehicle_plate:    null,
        client_id:        ctx.client?.id || null,
        client_supabase_id: ctx.client?.supabase_id || null,
        washer_ids:       [],
        seller_id:        salespersonId || null,
        cajero_id:        (user?.id && user.id !== 'web') ? user.id : null,
        comprobante_type: paymentData.ncfType || ctx.forceType,
        payment_method:   paymentData.tipo === 'credito' ? 'credit' : (paymentData.formaPago || 'efectivo'),
        tipo_venta:       paymentData.tipo || 'contado',
        status:           paymentData.tipo === 'credito' ? 'pendiente' : 'cobrado',
        subtotal:         Number(paymentData.subtotal) || 0,
        itbis:            Number(paymentData.itbis) || 0,
        ley:              Number(paymentData.ley) || 0,
        total:            Number(paymentData.total) || 0,
        ecf_result:       paymentData.ecf || {},
        items: [{
          service_id:        null,
          inventory_item_id: null,
          name:              ctx.ticket.services[0].name,
          price:             ctx.ticket.services[0].price,
          cost:              ctx.ticket.services[0].cost,
          is_wash:           0,
          quantity:          1,
          sku:               selectedUnit?.vin || null,
          aplica_itbis:      0,
        }],
        comentario:       `[Deal ${ctx.dealId || '?'} · Vehicle ${vehicleId}${selectedUnit?.vin ? ' · VIN ' + selectedUnit.vin : ''}] ${paymentData.comentario || ''}`.trim(),
        descuento:        Number(paymentData.descuento) || 0,
        descuento_reason: paymentData.descuentoReason || null,
        mac_jti:          paymentData.mac_jti || null,
      })

      // Stamp ticket link back onto the deal so Reportes / dashboard joins work.
      // non-fatal: ticket already booked, deal must be closed manually if this fails
      try {
        if (ctx.dealId) {
          await api.salesDeals.close(ctx.dealId, {
            ticket_id:          result?.id || null,
            ticket_supabase_id: result?.supabase_id || null,
          })
        }
      } catch (e) {
        console.error('[DealBuilder] salesDeals.close failed (ticket already booked)', e)
        try { window.alert('Ticket creado pero el deal sigue abierto — ciérralo manualmente') } catch {}
      }

      setResult({ ok: true, id: ctx.dealId })
    } catch (ex) {
      setResult({ ok: false, err: ex?.message || 'Error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto" /></div>

  if (result?.ok) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <div className="border border-black p-8 text-center bg-white">
          <Check size={48} className="mx-auto mb-4" />
          <h2 className="text-2xl font-bold">{L('Venta cerrada', 'Deal closed')}</h2>
          <p className="text-sm mt-2">{L('Unidad marcada como vendida y ticket emitido.', 'Unit marked as sold and ticket issued.')}</p>
          <button onClick={resetAll} className="mt-6 px-4 py-2 bg-black text-white inline-flex items-center gap-2"><Plus size={16} />{L('Nueva Venta', 'New Deal')}</button>
        </div>
      </div>
    )
  }

  const cobrarModal = cobrarCtx ? (
    <CobrarModal
      ticket={cobrarCtx.ticket}
      forceNcfType={cobrarCtx.forceType}
      onConfirm={handleDealCobrarConfirm}
      onClose={() => setCobrarCtx(null)}
    />
  ) : null

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {cobrarModal}
      <h1 className="text-3xl font-bold mb-6 flex items-center gap-3"><CarFront size={32} />{L('Cierre de Venta', 'Deal Builder')}</h1>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-black p-4 space-y-3">
          <h2 className="font-bold border-b border-black pb-2">{L('1. Vehículo y Cliente', '1. Vehicle & Client')}</h2>
          <label className="block"><span className="text-xs font-semibold">{L('Unidad', 'Unit')}*</span>
            <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
              <option value="">{L('Seleccionar...', 'Select...')}</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.year} {u.make} {u.model} · {fmtRD(u.listing_price)}</option>)}
            </select>
          </label>
          <label className="block"><span className="text-xs font-semibold">{L('Cliente', 'Client')}*</span>
            <select value={clientId} onChange={e => setClientId(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
              <option value="">{L('Seleccionar...', 'Select...')}</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block"><span className="text-xs font-semibold">{L('Vendedor', 'Salesperson')}</span>
            <select value={salespersonId} onChange={e => setSalespersonId(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
              <option value="">—</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>
          <label className="block"><span className="text-xs font-semibold">{L('Precio de Venta', 'Sale Price')} RD$</span>
            <input type="number" step="0.01" value={salePrice} onChange={e => setSalePrice(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
        </div>

        <div className="border border-black p-4 space-y-3">
          <h2 className="font-bold border-b border-black pb-2 flex items-center justify-between">
            <span>{L('2. Intercambio (Trade-in)', '2. Trade-in')}</span>
            <label className="text-xs font-normal flex items-center gap-1"><input type="checkbox" checked={hasTradeIn} onChange={e => setHasTradeIn(e.target.checked)} />{L('Incluir', 'Include')}</label>
          </h2>
          {hasTradeIn && (<>
            <div className="grid grid-cols-2 gap-2">
              <input value={tradeIn.make} onChange={e => setTradeIn(t => ({ ...t, make: e.target.value }))} placeholder={L('Marca', 'Make')} className="border border-black px-2 py-1.5" />
              <input value={tradeIn.model} onChange={e => setTradeIn(t => ({ ...t, model: e.target.value }))} placeholder={L('Modelo', 'Model')} className="border border-black px-2 py-1.5" />
              <input type="number" value={tradeIn.year} onChange={e => setTradeIn(t => ({ ...t, year: e.target.value }))} placeholder={L('Año', 'Year')} className="border border-black px-2 py-1.5" />
              <input type="number" value={tradeIn.mileage} onChange={e => setTradeIn(t => ({ ...t, mileage: e.target.value }))} placeholder={L('Kilometraje', 'Mileage')} className="border border-black px-2 py-1.5" />
            </div>
            <input value={tradeIn.vin} onChange={e => setTradeIn(t => ({ ...t, vin: e.target.value.toUpperCase() }))} placeholder="VIN" maxLength={17} className="w-full border border-black px-2 py-1.5 font-mono" />
            <label className="block"><span className="text-xs font-semibold">{L('Valor de Tasación', 'Appraisal')} RD$</span>
              <input type="number" step="0.01" value={tradeIn.appraisal} onChange={e => setTradeIn(t => ({ ...t, appraisal: e.target.value }))} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
          </>)}
          {!hasTradeIn && <p className="text-xs text-black/60">{L('Sin vehículo en intercambio.', 'No trade-in vehicle.')}</p>}
        </div>

        <div className="border border-black p-4 space-y-3">
          <h2 className="font-bold border-b border-black pb-2">{L('3. Financiamiento', '3. Financing')}</h2>
          <label className="block"><span className="text-xs font-semibold">{L('Inicial (Down Payment)', 'Down Payment')} RD$</span>
            <input type="number" step="0.01" value={downPayment} onChange={e => setDownPayment(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-xs font-semibold">{L('Plazo (meses)', 'Term (months)')}</span>
              <input type="number" value={termMonths} onChange={e => setTermMonths(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
            <label className="block"><span className="text-xs font-semibold">APR %</span>
              <input type="number" step="0.001" value={aprAnnual} onChange={e => setAprAnnual(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
          </div>
          <label className="block"><span className="text-xs font-semibold">{L('Notas', 'Notes')}</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
        </div>

        <div className="border border-black p-4 bg-black text-white space-y-2">
          <h2 className="font-bold border-b border-white/20 pb-2">{L('4. Resumen', '4. Summary')}</h2>
          <Row label={L('Precio de Venta', 'Sale Price')} value={fmtRD(salePrice)} />
          {hasTradeIn && <Row label={L('— Intercambio', '— Trade-in')} value={`- ${fmtRD(tradeIn.appraisal)}`} />}
          <Row label={L('— Inicial', '— Down Payment')} value={`- ${fmtRD(downPayment)}`} />
          <div className="border-t border-white/30 pt-2">
            <Row label={L('Monto Financiado', 'Financed Amount')} value={fmtRD(deal.financed)} bold />
          </div>
          <Row label={L('Pago Mensual', 'Monthly Payment')} value={fmtRD(deal.monthly)} big />
          <Row label={L('Total de Pagos', 'Total of Payments')} value={fmtRD(deal.totalOfPayments)} />
          <Row label={L('Interés Total', 'Total Interest')} value={fmtRD(deal.totalInterest)} />
          <button
            onClick={closeDeal}
            disabled={saving || !vehicleId || !clientId}
            className="mt-3 w-full px-4 py-3 bg-[#b3001e] text-white font-bold disabled:opacity-40 inline-flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
            {L('Cerrar Venta', 'Close Deal')}
          </button>
          {result?.ok === false && <div className="bg-white text-[#b3001e] px-3 py-2 text-xs">{result.err}</div>}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, bold, big }) {
  return (
    <div className={`flex items-center justify-between ${big ? 'text-2xl font-bold' : bold ? 'font-bold' : 'text-sm'}`}>
      <span className={big ? '' : 'opacity-80'}>{label}</span>
      <span>{value}</span>
    </div>
  )
}
