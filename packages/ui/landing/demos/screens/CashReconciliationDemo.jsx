// CashReconciliationDemo — faithful copy of CashReconciliation.jsx render.
// Bill denomination counter (10 denominations, qty + auto-total), expected
// cash from sales, varianza pill (sobrante/faltante/exacto), close-day CTA.

import { useState, useMemo } from 'react'
import { PiggyBank, Calendar, Check, AlertTriangle, X, Calculator, FileText } from 'lucide-react'

function fmtRD(n) { return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

const DENOMS = [
  { v: 2000, label: 'RD$ 2,000' },
  { v: 1000, label: 'RD$ 1,000' },
  { v: 500,  label: 'RD$ 500' },
  { v: 200,  label: 'RD$ 200' },
  { v: 100,  label: 'RD$ 100' },
  { v: 50,   label: 'RD$ 50' },
  { v: 25,   label: 'RD$ 25' },
  { v: 10,   label: 'RD$ 10' },
  { v: 5,    label: 'RD$ 5' },
  { v: 1,    label: 'RD$ 1' },
]

export default function CashReconciliationDemo({ ventasCash = 9200, ticketsCount = 27, openingFloat = 1500 }) {
  const [counts, setCounts] = useState({
    2000: 1, 1000: 4, 500: 3, 200: 4, 100: 5, 50: 4, 25: 4, 10: 6, 5: 3, 1: 5,
  })
  const [pettyOut, setPettyOut] = useState(0)
  const [closed, setClosed] = useState(false)

  const counted = useMemo(() => DENOMS.reduce((s, d) => s + d.v * (Number(counts[d.v]) || 0), 0), [counts])
  const expected = ventasCash + Number(openingFloat || 0) - Number(pettyOut || 0)
  const variance = counted - expected

  function updateQty(v, n) {
    setCounts(c => ({ ...c, [v]: Math.max(0, Number(n) || 0) }))
  }

  if (closed) {
    return (
      <div className="p-8 max-w-2xl mx-auto h-full overflow-y-auto">
        <div className="bg-emerald-50 border-2 border-emerald-500 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500 flex items-center justify-center"><Check size={32} className="text-white" strokeWidth={3} /></div>
          <h2 className="text-2xl font-bold mt-4 text-emerald-900">Cuadre Cerrado</h2>
          <p className="text-sm text-emerald-800 mt-2">{new Date().toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <div className="grid grid-cols-2 gap-3 mt-6 text-left max-w-md mx-auto">
            <div className="bg-white rounded-xl p-3 border border-slate-200"><p className="text-[10px] uppercase text-slate-400 tracking-wider">Total contado</p><p className="text-lg font-bold tabular-nums">{fmtRD(counted)}</p></div>
            <div className="bg-white rounded-xl p-3 border border-slate-200"><p className="text-[10px] uppercase text-slate-400 tracking-wider">Esperado</p><p className="text-lg font-bold tabular-nums">{fmtRD(expected)}</p></div>
            <div className={`rounded-xl p-3 border-2 col-span-2 ${variance === 0 ? 'border-emerald-500 bg-emerald-50' : variance > 0 ? 'border-amber-500 bg-amber-50' : 'border-red-500 bg-red-50'}`}>
              <p className="text-[10px] uppercase tracking-wider opacity-70">Varianza</p>
              <p className="text-2xl font-bold tabular-nums">{variance >= 0 ? '+' : ''}{fmtRD(variance)}</p>
              <p className="text-xs mt-0.5">{variance === 0 ? 'Cuadre exacto' : variance > 0 ? 'Sobrante registrado' : 'Faltante registrado'}</p>
            </div>
          </div>
          <button className="mt-6 inline-flex items-center gap-2 bg-black text-white font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-slate-800"><FileText size={14} /> Imprimir reporte de cierre</button>
          <button onClick={() => setClosed(false)} className="block mx-auto text-xs text-slate-500 hover:underline mt-3">Volver al conteo</button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3"><PiggyBank size={26} className="text-[#b3001e]" /> Cuadre de Caja</h1>
          <p className="text-sm text-slate-500 mt-1 inline-flex items-center gap-1.5"><Calendar size={12} /> {new Date().toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tickets del día</p>
          <p className="text-2xl font-bold text-slate-800 tabular-nums">{ticketsCount}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-bold text-slate-800">Conteo de efectivo</h3>
            <button onClick={() => setCounts({ 2000: 0, 1000: 0, 500: 0, 200: 0, 100: 0, 50: 0, 25: 0, 10: 0, 5: 0, 1: 0 })} className="text-[11px] text-slate-400 hover:text-slate-700 hover:underline">Limpiar</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
            {DENOMS.map(d => (
              <div key={d.v} className="flex items-center gap-2 border-b border-slate-100 py-1.5">
                <span className="w-20 text-slate-500 font-mono tabular-nums">{d.label}</span>
                <span className="text-slate-400">×</span>
                <input type="number" value={counts[d.v] ?? 0} onChange={e => updateQty(d.v, e.target.value)} min="0"
                  className="w-16 border border-slate-200 rounded px-2 py-1 text-right tabular-nums focus:border-[#b3001e] outline-none" />
                <span className="ml-auto font-bold text-slate-800 tabular-nums">{fmtRD(d.v * (Number(counts[d.v]) || 0))}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t-2 border-slate-200 flex items-center justify-between">
            <span className="text-[14px] font-bold text-slate-700">Total contado</span>
            <span className="text-[26px] font-black text-slate-900 tabular-nums">{fmtRD(counted)}</span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-3">Esperado en caja</h3>
            <dl className="space-y-1.5 text-[13px]">
              <div className="flex justify-between"><dt className="text-slate-600">Apertura (fondo inicial)</dt><dd className="font-semibold text-slate-800 tabular-nums">{fmtRD(openingFloat)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">+ Ventas en efectivo</dt><dd className="font-semibold text-slate-800 tabular-nums">{fmtRD(ventasCash)}</dd></div>
              <div className="flex justify-between items-center"><dt className="text-slate-600">− Caja chica retirada</dt>
                <input type="number" value={pettyOut} onChange={e => setPettyOut(e.target.value)} className="w-24 text-right border border-slate-200 rounded px-2 py-1 text-[13px] font-semibold tabular-nums focus:border-[#b3001e] outline-none" />
              </div>
            </dl>
            <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between">
              <span className="text-[13px] font-bold text-slate-700">Total esperado</span>
              <span className="text-[20px] font-bold text-slate-900 tabular-nums">{fmtRD(expected)}</span>
            </div>
          </div>

          <div className={`rounded-2xl border-2 p-5 ${variance === 0 ? 'border-emerald-500 bg-emerald-50' : variance > 0 ? 'border-amber-500 bg-amber-50' : 'border-red-500 bg-red-50'}`}>
            <div className="flex items-center gap-2 mb-1">
              {variance === 0 ? <Check size={16} className="text-emerald-700" /> : <AlertTriangle size={16} className={variance > 0 ? 'text-amber-700' : 'text-red-700'} />}
              <p className={`text-[10px] font-bold uppercase tracking-[2px] ${variance === 0 ? 'text-emerald-700' : variance > 0 ? 'text-amber-700' : 'text-red-700'}`}>Varianza</p>
            </div>
            <p className={`text-[24px] font-black tabular-nums ${variance === 0 ? 'text-emerald-900' : variance > 0 ? 'text-amber-900' : 'text-red-900'}`}>{variance >= 0 ? '+' : ''}{fmtRD(variance)}</p>
            <p className="text-[11px] text-slate-700 mt-0.5">{variance === 0 ? 'Cuadre exacto · listo para cerrar' : variance > 0 ? 'Sobrante · revisa el conteo' : 'Faltante · investiga antes de cerrar'}</p>
          </div>

          <button onClick={() => setClosed(true)} className="w-full py-3 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold text-[13px] inline-flex items-center justify-center gap-2 shadow-lg shadow-[#b3001e]/25">
            <Check size={14} /> Cerrar cuadre del día
          </button>
        </div>
      </div>

      {/* Method breakdown */}
      <div className="mt-6 bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-3 inline-flex items-center gap-1.5"><Calculator size={12} /> Desglose por método</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[13px]">
          <div className="bg-slate-50 rounded-xl p-3"><p className="text-[10px] uppercase text-slate-400 tracking-wider">Efectivo</p><p className="font-bold text-slate-800 tabular-nums">{fmtRD(ventasCash)}</p></div>
          <div className="bg-slate-50 rounded-xl p-3"><p className="text-[10px] uppercase text-slate-400 tracking-wider">Tarjeta</p><p className="font-bold text-slate-800 tabular-nums">{fmtRD(ventasCash * 0.74)}</p></div>
          <div className="bg-slate-50 rounded-xl p-3"><p className="text-[10px] uppercase text-slate-400 tracking-wider">Transferencia</p><p className="font-bold text-slate-800 tabular-nums">{fmtRD(ventasCash * 0.26)}</p></div>
          <div className="bg-slate-50 rounded-xl p-3"><p className="text-[10px] uppercase text-slate-400 tracking-wider">CxC (crédito)</p><p className="font-bold text-amber-700 tabular-nums">{fmtRD(ventasCash * 0.12)}</p></div>
        </div>
      </div>
    </div>
  )
}
