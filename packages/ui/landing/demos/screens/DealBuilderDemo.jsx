// DealBuilderDemo — faithful copy of dealership/DealBuilder.jsx.
// Brutalist style. 2-column grid: Vehicle/Client + Financing. Trade-in
// section. Right-side totals summary + close-deal button. UAF banner.

import { useState, useMemo } from 'react'
import { CarFront, FileText, Banknote, Shield, AlertTriangle, FileSignature, Camera, MessageCircle, Check, X } from 'lucide-react'

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}` }

const UNITS = [
  { id: 1, year: 2024, make: 'Toyota',    model: 'Corolla XLE',    listing_price: 1450000 },
  { id: 2, year: 2023, make: 'Honda',     model: 'Civic Sport',    listing_price: 1380000 },
  { id: 3, year: 2024, make: 'Hyundai',   model: 'Tucson Limited', listing_price: 2150000 },
  { id: 4, year: 2022, make: 'Ford',      model: 'F-150 XLT',      listing_price: 2850000 },
  { id: 5, year: 2024, make: 'Mazda',     model: 'CX-5 Touring',   listing_price: 1890000 },
  { id: 8, year: 2023, make: 'Chevrolet', model: 'Tahoe LT',       listing_price: 3450000 },
]

const CLIENTS = [
  { id: 1, name: 'Roberto Castillo' },
  { id: 2, name: 'Empresa Logistics SRL' },
  { id: 3, name: 'Maria Sanchez' },
  { id: 4, name: 'Ana Reyes' },
]

const STAFF = [
  { id: 1, nombre: 'Pedro Mendez',  commission_pct: 1.5 },
  { id: 2, nombre: 'Carlos Reyes',  commission_pct: 2.0 },
  { id: 3, nombre: 'Sofia Almonte', commission_pct: 1.8 },
]

function computeDeal({ salePrice, tradeInValue, downPayment, aprAnnualPct, termMonths }) {
  const sale = Number(salePrice) || 0
  const trade = Number(tradeInValue) || 0
  const down = Number(downPayment) || 0
  const apr = Number(aprAnnualPct) || 0
  const term = Number(termMonths) || 0
  const itbis = Math.round(sale * 0.18 * 100) / 100
  const subtotal = sale - trade
  const financed = Math.max(0, subtotal - down)
  let monthly = 0
  if (financed > 0 && term > 0) {
    const r = (apr / 100) / 12
    monthly = r > 0 ? +(financed * r * Math.pow(1 + r, term) / (Math.pow(1 + r, term) - 1)).toFixed(2) : +(financed / term).toFixed(2)
  }
  return { sale, trade, down, apr, term, itbis, subtotal, financed, monthly }
}

export default function DealBuilderDemo() {
  const [vehicleId, setVehicleId]         = useState('')
  const [clientId, setClientId]           = useState('')
  const [salespersonId, setSalespersonId] = useState('')
  const [commissionPct, setCommissionPct] = useState(0)
  const [salePrice, setSalePrice]         = useState(0)
  const [hasTradeIn, setHasTradeIn]       = useState(false)
  const [tradeIn, setTradeIn]             = useState({ make: '', model: '', year: '', mileage: 0, appraisal: 0 })
  const [downPayment, setDownPayment]     = useState(0)
  const [aprAnnual, setAprAnnual]         = useState(0)
  const [termMonths, setTermMonths]       = useState(0)
  const [downPaymentMethod, setDPM]       = useState('cash')
  const [createWarranty, setCreateWarranty] = useState(true)
  const [usedPreapproval, setUsedPreapproval] = useState(null)
  const [closed, setClosed]               = useState(false)

  const selectedUnit = useMemo(() => UNITS.find(u => u.id === Number(vehicleId)), [vehicleId])
  const selectedSalesperson = useMemo(() => STAFF.find(s => s.id === Number(salespersonId)), [salespersonId])
  const selectedClient = useMemo(() => CLIENTS.find(c => c.id === Number(clientId)), [clientId])

  // Auto-fill price when vehicle selected
  if (selectedUnit && !salePrice) setSalePrice(selectedUnit.listing_price)
  if (selectedSalesperson && !commissionPct) setCommissionPct(selectedSalesperson.commission_pct)

  const deal = computeDeal({ salePrice, tradeInValue: hasTradeIn ? tradeIn.appraisal : 0, downPayment, aprAnnualPct: aprAnnual, termMonths })
  const totalForCommission = Math.max(0, salePrice - (hasTradeIn ? tradeIn.appraisal : 0))
  const commissionAmount = +(totalForCommission * (Number(commissionPct) || 0) / 100).toFixed(2)
  const isUafTrigger = totalForCommission >= 500000

  const canClose = !!vehicleId && !!clientId && Number(salePrice) > 0

  function close() {
    if (!canClose) return
    setClosed(true)
  }

  if (closed) {
    return (
      <div className="p-6 max-w-3xl mx-auto h-full overflow-y-auto">
        <div className="border-2 border-emerald-600 bg-emerald-50 p-8 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-600 flex items-center justify-center"><Check size={32} className="text-white" strokeWidth={3} /></div>
          <h2 className="text-3xl font-bold mt-4">Deal Cerrado</h2>
          <p className="text-sm text-emerald-900 mt-2">Venta de {selectedUnit?.year} {selectedUnit?.make} {selectedUnit?.model} a {selectedClient?.name}</p>
          <div className="grid grid-cols-2 gap-3 mt-6 text-left max-w-md mx-auto">
            <div className="border border-black p-3 bg-white"><p className="text-xs uppercase">Venta</p><p className="text-lg font-bold tabular-nums">{fmtRD(salePrice)}</p></div>
            <div className="border border-black p-3 bg-white"><p className="text-xs uppercase">Comisión</p><p className="text-lg font-bold text-[#b3001e] tabular-nums">{fmtRD(commissionAmount)}</p></div>
            <div className="border border-black p-3 bg-white"><p className="text-xs uppercase">Cuota mensual</p><p className="text-lg font-bold tabular-nums">{fmtRD(deal.monthly)}</p></div>
            <div className="border border-black p-3 bg-white"><p className="text-xs uppercase">Plazo</p><p className="text-lg font-bold">{termMonths || 0}m</p></div>
          </div>
          <div className="flex flex-col items-center gap-2 mt-6">
            <button className="px-5 py-2.5 bg-black text-white font-bold inline-flex items-center gap-2 hover:bg-slate-800"><FileText size={14} /> Imprimir contrato</button>
            <button onClick={() => { setClosed(false); setVehicleId(''); setClientId(''); setSalePrice(0); setDownPayment(0); setAprAnnual(0); setTermMonths(0) }} className="text-sm text-slate-600 hover:underline mt-2">Iniciar nuevo deal</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto h-full overflow-y-auto">
      <h1 className="text-3xl font-bold mb-6 flex items-center gap-3"><CarFront size={32} /> Cierre de Venta</h1>

      {isUafTrigger && (
        <div className="border-2 border-amber-500 bg-amber-50 p-3 text-xs mb-4 flex items-start gap-2">
          <AlertTriangle size={16} className="text-amber-700 mt-0.5 shrink-0" />
          <div className="text-amber-900">
            <p className="font-bold">UAF Ley 155-17 · operacion en efectivo ≥ RD$500,000</p>
            <p className="mt-0.5">Este deal requiere reporte UAF antes de cerrar. Verifica origen de fondos y registra documentación del cliente.</p>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-black p-4 space-y-3">
          <h2 className="font-bold border-b border-black pb-2">1. Vehículo y Cliente</h2>
          <label className="block"><span className="text-xs font-semibold">Unidad *</span>
            <select value={vehicleId} onChange={e => { setVehicleId(e.target.value); const u = UNITS.find(x => x.id === Number(e.target.value)); if (u) setSalePrice(u.listing_price) }} className="mt-1 w-full border border-black px-2 py-1.5">
              <option value="">Seleccionar...</option>
              {UNITS.map(u => <option key={u.id} value={u.id}>{u.year} {u.make} {u.model} · {fmtRD(u.listing_price)}</option>)}
            </select>
          </label>
          <label className="block"><span className="text-xs font-semibold">Cliente *</span>
            <select value={clientId} onChange={e => setClientId(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
              <option value="">Seleccionar...</option>
              {CLIENTS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block col-span-2"><span className="text-xs font-semibold">Vendedor</span>
              <select value={salespersonId} onChange={e => { setSalespersonId(e.target.value); const s = STAFF.find(x => x.id === Number(e.target.value)); if (s) setCommissionPct(s.commission_pct) }} className="mt-1 w-full border border-black px-2 py-1.5">
                <option value="">—</option>
                {STAFF.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </label>
            <label className="block"><span className="text-xs font-semibold">Comisión %</span>
              <input type="number" step="0.1" min="0" value={commissionPct} onChange={e => setCommissionPct(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
          </div>
          <label className="block"><span className="text-xs font-semibold">Precio de Venta RD$</span>
            <input type="number" step="0.01" value={salePrice} onChange={e => setSalePrice(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
          </label>
        </div>

        <div className="border border-black p-4 space-y-3">
          <h2 className="font-bold border-b border-black pb-2">2. Trade-in (opcional)</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hasTradeIn} onChange={e => setHasTradeIn(e.target.checked)} className="accent-[#b3001e]" />
            <span>El cliente entrega un vehículo en pago</span>
          </label>
          {hasTradeIn && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="Marca" value={tradeIn.make} onChange={e => setTradeIn({ ...tradeIn, make: e.target.value })} className="border border-black px-2 py-1.5 text-sm" />
                <input placeholder="Modelo" value={tradeIn.model} onChange={e => setTradeIn({ ...tradeIn, model: e.target.value })} className="border border-black px-2 py-1.5 text-sm" />
                <input type="number" placeholder="Año" value={tradeIn.year} onChange={e => setTradeIn({ ...tradeIn, year: e.target.value })} className="border border-black px-2 py-1.5 text-sm" />
                <input type="number" placeholder="KM" value={tradeIn.mileage} onChange={e => setTradeIn({ ...tradeIn, mileage: e.target.value })} className="border border-black px-2 py-1.5 text-sm" />
              </div>
              <label className="block"><span className="text-xs font-semibold">Avalúo RD$</span>
                <input type="number" step="0.01" value={tradeIn.appraisal} onChange={e => setTradeIn({ ...tradeIn, appraisal: Number(e.target.value) })} className="mt-1 w-full border border-black px-2 py-1.5" />
              </label>
              <button className="text-xs font-semibold border border-black px-3 py-1.5 hover:bg-black hover:text-white inline-flex items-center gap-1.5">
                <Camera size={12} /> Hacer checklist de avalúo (38 puntos)
              </button>
            </>
          )}
        </div>

        <div className="border border-black p-4 space-y-3">
          <h2 className="font-bold border-b border-black pb-2">3. Financiamiento</h2>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-xs font-semibold">Inicial RD$</span>
              <input type="number" step="0.01" value={downPayment} onChange={e => setDownPayment(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
            <label className="block"><span className="text-xs font-semibold">Método inicial</span>
              <select value={downPaymentMethod} onChange={e => setDPM(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5">
                <option value="cash">Efectivo</option>
                <option value="transfer">Transferencia</option>
                <option value="check">Cheque</option>
              </select>
            </label>
            <label className="block"><span className="text-xs font-semibold">APR Anual %</span>
              <input type="number" step="0.01" value={aprAnnual} onChange={e => setAprAnnual(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
            <label className="block"><span className="text-xs font-semibold">Plazo (meses)</span>
              <input type="number" value={termMonths} onChange={e => setTermMonths(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
          </div>
          <button onClick={() => setUsedPreapproval(usedPreapproval ? null : { bank: 'Banco Popular', rate: 9.5, term: 60, monthly: 25400 })}
            className={`w-full inline-flex items-center justify-center gap-1.5 border ${usedPreapproval ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-black'} px-3 py-2 text-xs font-bold hover:bg-slate-50`}>
            <Shield size={12} />
            {usedPreapproval ? `Usando pre-aprobación: ${usedPreapproval.bank} · ${usedPreapproval.rate}%` : 'Cargar pre-aprobación bancaria'}
          </button>
        </div>

        <div className="border border-black p-4 space-y-3">
          <h2 className="font-bold border-b border-black pb-2">4. Garantía + Reserva</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={createWarranty} onChange={e => setCreateWarranty(e.target.checked)} className="accent-[#b3001e]" />
            <span>Crear garantía 90 días post-venta</span>
          </label>
          {createWarranty && (
            <select className="w-full border border-black px-2 py-1.5 text-sm">
              <option>General · 90 días</option>
              <option>Mecánica · 60 días</option>
              <option>Cosmética · 30 días</option>
            </select>
          )}
          <button className="text-xs font-semibold border border-black px-3 py-1.5 hover:bg-black hover:text-white inline-flex items-center gap-1.5 w-full justify-center">
            <FileText size={12} /> Generar cotización PDF
          </button>
        </div>
      </div>

      <div className="border-2 border-black p-5 mt-4 bg-slate-50">
        <h2 className="font-bold mb-3 text-lg">Resumen del Deal</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="border border-black bg-white p-3"><p className="text-xs uppercase">Precio venta</p><p className="text-lg font-bold tabular-nums">{fmtRD(deal.sale)}</p></div>
          {hasTradeIn && <div className="border border-black bg-white p-3"><p className="text-xs uppercase">Trade-in</p><p className="text-lg font-bold tabular-nums">−{fmtRD(deal.trade)}</p></div>}
          <div className="border border-black bg-white p-3"><p className="text-xs uppercase">Inicial</p><p className="text-lg font-bold tabular-nums">−{fmtRD(deal.down)}</p></div>
          <div className="border border-black bg-white p-3"><p className="text-xs uppercase">Financiar</p><p className="text-lg font-bold tabular-nums">{fmtRD(deal.financed)}</p></div>
          <div className="border border-black bg-white p-3"><p className="text-xs uppercase">Cuota mensual</p><p className="text-lg font-bold text-[#b3001e] tabular-nums">{fmtRD(deal.monthly)}</p></div>
          <div className="border border-black bg-white p-3"><p className="text-xs uppercase">Plazo</p><p className="text-lg font-bold">{termMonths || 0}m</p></div>
          <div className="border border-black bg-white p-3"><p className="text-xs uppercase">APR</p><p className="text-lg font-bold">{aprAnnual || 0}%</p></div>
          <div className="border border-black bg-[#b3001e]/10 p-3"><p className="text-xs uppercase text-[#b3001e]">Comisión</p><p className="text-lg font-bold text-[#b3001e] tabular-nums">{fmtRD(commissionAmount)}</p></div>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <button className="px-4 py-2 border border-black text-sm font-semibold hover:bg-slate-100 inline-flex items-center gap-1.5"><MessageCircle size={13} /> Enviar por WhatsApp</button>
          <button className="px-4 py-2 border border-black text-sm font-semibold hover:bg-slate-100 inline-flex items-center gap-1.5"><FileSignature size={13} /> Generar contrato</button>
          <button onClick={close} disabled={!canClose}
            className="px-6 py-2 bg-[#b3001e] text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#8c0017] inline-flex items-center gap-2">
            <Banknote size={14} /> Cerrar Deal y Cobrar
          </button>
        </div>
      </div>
    </div>
  )
}
