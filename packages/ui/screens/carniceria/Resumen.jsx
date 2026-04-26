import { useState, useEffect } from 'react'
import { BarChart3, Beef, Users, Scale, Percent, Trash2, Loader2 } from 'lucide-react'
import { useLang } from '../../i18n'
import { useAPI } from '../../context/DataContext'

function fmtRD(n) { return `RD$ ${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

export default function Resumen() {
  const api = useAPI()
  const { lang } = useLang()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const d = await api?.carniceria?.resumen?.get?.() || {}
      setData(d)
    } catch { setData({}) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-zinc-900">
      <header className="flex items-center justify-between px-6 py-4 border-b border-black/10 dark:border-white/10 bg-white dark:bg-black">
        <div className="flex items-center gap-3">
          <BarChart3 size={22} className="text-[#b3001e]" />
          <h1 className="text-[18px] font-bold dark:text-white">{lang === 'es' ? 'Resumen del Carnicero' : 'Butcher Summary'}</h1>
        </div>
        <button onClick={load} className="px-3 py-1.5 text-[12px] font-semibold bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 dark:text-white rounded-lg">
          {lang === 'es' ? 'Actualizar' : 'Refresh'}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-[#b3001e]" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Tile icon={Beef} title={lang === 'es' ? 'Ventas hoy por corte' : 'Sales today by cut'}>
              <BarRows rows={data?.ventas_por_corte || []} fmt={fmtRD} />
            </Tile>
            <Tile icon={Users} title={lang === 'es' ? 'Top 5 mayoreo' : 'Top 5 wholesale'}>
              <BarRows rows={(data?.top_mayoreo || []).map(r => ({ label: r.client_name, value: r.total }))} fmt={fmtRD} />
            </Tile>
            <Tile icon={Scale} title={lang === 'es' ? 'Lb vendidas' : 'Lb sold'}>
              <Big value={`${Number(data?.lb_vendidas || 0).toFixed(1)} lb`} sub={lang === 'es' ? 'hoy' : 'today'} />
            </Tile>
            <Tile icon={Percent} title={lang === 'es' ? 'Margen por corte' : 'Margin by cut'}>
              <BarRows rows={(data?.margen_por_corte || []).map(r => ({ label: r.name, value: r.margin_pct }))} fmt={(v) => `${Number(v).toFixed(1)}%`} />
            </Tile>
            <Tile icon={Trash2} title={lang === 'es' ? 'Mermas' : 'Discards'}>
              <Big value={`${Number(data?.mermas?.kg || 0).toFixed(2)} kg`} sub={`${Number(data?.mermas?.pct || 0).toFixed(1)}% del inventario`} accent />
            </Tile>
          </div>
        )}
      </div>
    </div>
  )
}

function Tile({ icon: Icon, title, children }) {
  return (
    <section className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={15} className="text-[#b3001e]" />
        <h2 className="text-[13px] font-bold dark:text-white">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Big({ value, sub, accent }) {
  return (
    <div>
      <p className={`text-[28px] font-black leading-none ${accent ? 'text-[#b3001e]' : 'dark:text-white'}`}>{value}</p>
      <p className="text-[11px] text-slate-500 dark:text-white/50 mt-1">{sub}</p>
    </div>
  )
}

function BarRows({ rows, fmt }) {
  if (!rows.length) return <p className="text-[12px] text-slate-400">— sin datos —</p>
  const max = Math.max(...rows.map(r => Number(r.value) || 0), 1)
  return (
    <div className="space-y-2">
      {rows.slice(0, 5).map((r, i) => (
        <div key={i}>
          <div className="flex justify-between text-[12px] dark:text-white/80 mb-0.5">
            <span className="truncate">{r.label}</span>
            <span className="font-bold">{fmt(r.value)}</span>
          </div>
          <div className="w-full h-1.5 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden">
            <div className="h-1.5 bg-[#b3001e] rounded-full transition-all duration-500" style={{ width: `${(Number(r.value) || 0) / max * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
