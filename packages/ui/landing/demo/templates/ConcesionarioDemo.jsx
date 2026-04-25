import { useState } from 'react'
import { Car, Calculator, FileSignature, ArrowRight } from 'lucide-react'
import { VEHICLES, fmtRD, t, VERTICAL_LABEL } from '../demoMockData'
import { DemoCobrarModal } from '../DemoChrome'

export default function ConcesionarioDemo({ vertical, lang, onCobrar }) {
  const [selected, setSelected] = useState(VEHICLES[0])
  const [downPct, setDownPct] = useState(20)
  const [termMonths, setTermMonths] = useState(60)
  const [rate, setRate] = useState(11.5)
  const [cobrarOpen, setCobrarOpen] = useState(false)

  const down = selected ? selected.price * (downPct / 100) : 0
  const financed = selected ? selected.price - down : 0
  const monthlyRate = rate / 100 / 12
  const monthly = financed && monthlyRate
    ? (financed * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths))
    : 0

  return (
    <div className="bg-slate-50 dark:bg-black min-h-[calc(100vh-44px)] flex flex-col xl:flex-row">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="bg-white dark:bg-white/5 border-b border-black/5 dark:border-white/10 px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#b3001e]/10 flex items-center justify-center">
            <Car size={20} className="text-[#b3001e]" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black text-black dark:text-white">{VERTICAL_LABEL[vertical]?.[lang]}</h2>
            <p className="text-[11px] font-bold text-black/50 dark:text-white/50">
              {VEHICLES.length} {t(lang, 'unidades en inventario', 'units in inventory')}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <h3 className="text-[11px] font-extrabold tracking-[2px] uppercase text-black/50 dark:text-white/50 mb-3">
            {t(lang, 'Inventario', 'Inventory')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {VEHICLES.map(v => {
              const active = selected?.id === v.id
              return (
                <button
                  key={v.id}
                  onClick={() => setSelected(v)}
                  className={`text-left rounded-xl border-2 p-4 transition-all hover:-translate-y-0.5 ${
                    active
                      ? 'border-[#b3001e] bg-[#b3001e]/5 shadow-lg'
                      : 'border-black/10 dark:border-white/10 bg-white dark:bg-white/5 hover:border-[#b3001e]/40'
                  }`}
                >
                  <div className="aspect-video rounded-lg bg-gradient-to-br from-slate-200 to-slate-100 dark:from-white/10 dark:to-white/5 mb-3 flex items-center justify-center">
                    <Car size={48} className={active ? 'text-[#b3001e]' : 'text-black/30 dark:text-white/30'} />
                  </div>
                  <p className="text-[10px] font-extrabold tracking-wider uppercase text-[#b3001e]">
                    {v.year} · {v.make}
                  </p>
                  <p className="text-sm font-black text-black dark:text-white mt-0.5">{v.model}</p>
                  <p className="text-[10px] font-mono text-black/40 dark:text-white/40 mt-1 tabular-nums">VIN {v.vin}</p>
                  <p className="text-[11px] font-bold text-black/60 dark:text-white/60 mt-1 tabular-nums">
                    {v.km.toLocaleString('en-US')} km
                  </p>
                  <p className="mt-2 text-lg font-black text-black dark:text-white tabular-nums">{fmtRD(v.price)}</p>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Deal builder + financing calc */}
      <div className="w-full xl:w-[420px] bg-white dark:bg-white/5 border-t xl:border-t-0 xl:border-l border-black/5 dark:border-white/10 flex flex-col">
        <div className="px-5 py-4 border-b border-black/5 dark:border-white/10">
          <h3 className="text-sm font-black uppercase tracking-wide text-black dark:text-white flex items-center gap-2">
            <FileSignature size={16} className="text-[#b3001e]" />
            {t(lang, 'Deal Builder', 'Deal Builder')}
          </h3>
        </div>

        {selected ? (
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Vehicle card */}
            <div className="rounded-xl bg-slate-50 dark:bg-white/5 p-4 border border-black/10 dark:border-white/10">
              <p className="text-[10px] font-extrabold tracking-wider uppercase text-[#b3001e]">{selected.year} · {selected.make}</p>
              <p className="text-base font-black text-black dark:text-white">{selected.model}</p>
              <p className="text-xl font-black text-black dark:text-white mt-2 tabular-nums">{fmtRD(selected.price)}</p>
            </div>

            {/* Calc */}
            <div className="space-y-3">
              <h4 className="text-[11px] font-extrabold tracking-[2px] uppercase text-black/50 dark:text-white/50 flex items-center gap-2">
                <Calculator size={12} /> {t(lang, 'Financiamiento', 'Financing')}
              </h4>

              <Slider label={t(lang, 'Inicial', 'Down payment')} value={downPct} onChange={setDownPct} min={10} max={60} unit="%" />
              <Slider label={t(lang, 'Plazo', 'Term')} value={termMonths} onChange={setTermMonths} min={12} max={84} unit={t(lang, 'meses', 'months')} step={6} />
              <Slider label={t(lang, 'Tasa', 'Rate')} value={rate} onChange={setRate} min={6} max={20} unit="%" step={0.25} />
            </div>

            {/* Summary */}
            <div className="rounded-xl bg-black text-white p-4 space-y-1.5">
              <Row label={t(lang, 'Inicial', 'Down')} value={fmtRD(down)} />
              <Row label={t(lang, 'Financiado', 'Financed')} value={fmtRD(financed)} />
              <div className="h-px bg-white/10 my-2" />
              <Row label={t(lang, 'Cuota mensual', 'Monthly')} value={fmtRD(monthly)} bold />
              <p className="text-[10px] text-white/50 font-bold mt-2">
                {t(lang, 'Cálculo referencial. Sujeto a aprobación.', 'Reference only. Subject to approval.')}
              </p>
            </div>

            {/* Big route badge */}
            {selected.price >= 250000 && (
              <div className="rounded-lg bg-[#b3001e]/10 border border-[#b3001e]/30 p-3 text-[11px] font-bold text-black dark:text-white">
                {t(lang, 'Operación ≥ RD$250K · ruteada a comprobante E31 fiscal.', 'Operation ≥ RD$250K · routed to fiscal E31 receipt.')}
              </div>
            )}

            <button
              onClick={() => setCobrarOpen(true)}
              className="w-full py-4 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] text-white font-black text-base uppercase tracking-wider transition-all hover:shadow-lg hover:shadow-[#b3001e]/30 inline-flex items-center justify-center gap-2"
            >
              {t(lang, 'Cerrar venta', 'Close deal')}
              <ArrowRight size={16} />
            </button>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-black/40 dark:text-white/40 text-sm">
            {t(lang, 'Selecciona un vehículo.', 'Select a vehicle.')}
          </div>
        )}
      </div>

      <DemoCobrarModal
        open={cobrarOpen}
        onClose={() => { setCobrarOpen(false); onCobrar?.() }}
        total={selected?.price || 0}
        lang={lang}
        vertical={vertical}
      />
    </div>
  )
}

function Slider({ label, value, onChange, min, max, unit, step = 1 }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-bold text-black dark:text-white">{label}</span>
        <span className="text-xs font-black text-[#b3001e] tabular-nums">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-[#b3001e]"
      />
    </div>
  )
}

function Row({ label, value, bold }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className={`text-white/60 ${bold ? 'font-black text-white' : ''}`}>{label}</span>
      <span className={`tabular-nums ${bold ? 'text-base font-black text-white' : 'text-white/90 font-bold'}`}>{value}</span>
    </div>
  )
}
