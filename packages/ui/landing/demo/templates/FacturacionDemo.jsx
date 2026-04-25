import { useState, useMemo } from 'react'
import { FileText, Plus, Trash2, ShieldCheck, Send, CheckCircle2 } from 'lucide-react'
import { fmtRD, t, VERTICAL_LABEL, CLIENTS, nextFakeNCF, fakeSecurityCode } from '../demoMockData'
import { FakeQR } from '../DemoChrome'

export default function FacturacionDemo({ vertical, lang, onCobrar }) {
  const [client, setClient] = useState(CLIENTS[2])
  const [items, setItems] = useState([
    { id: 1, desc: 'Servicio profesional · consultoría', qty: 1, price: 25000 },
    { id: 2, desc: 'Hora soporte técnico',               qty: 8, price: 1500 },
  ])
  const [issued, setIssued] = useState(null)

  function addItem() {
    setItems(it => [...it, { id: Date.now(), desc: '', qty: 1, price: 0 }])
  }
  function updateItem(id, field, v) {
    setItems(it => it.map(x => x.id === id ? { ...x, [field]: field === 'desc' ? v : Number(v) || 0 } : x))
  }
  function removeItem(id) {
    setItems(it => it.filter(x => x.id !== id))
  }

  const totals = useMemo(() => {
    const total = items.reduce((s, i) => s + i.qty * i.price, 0)
    const subtotal = total / 1.18
    const itbis = total - subtotal
    return { total, subtotal, itbis }
  }, [items])

  function emit() {
    if (!items.length || totals.total <= 0) return
    setIssued({
      ncf: nextFakeNCF(),
      code: fakeSecurityCode(),
      ts: new Date().toLocaleString('es-DO'),
    })
    onCobrar?.()
  }

  function reset() {
    setIssued(null)
    setItems([{ id: Date.now(), desc: '', qty: 1, price: 0 }])
  }

  return (
    <div className="bg-slate-50 dark:bg-black min-h-[calc(100vh-44px)]">
      <div className="bg-white dark:bg-white/5 border-b border-black/5 dark:border-white/10 px-4 sm:px-6 py-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#b3001e]/10 flex items-center justify-center">
          <FileText size={20} className="text-[#b3001e]" />
        </div>
        <div>
          <h2 className="text-base sm:text-lg font-black text-black dark:text-white">{VERTICAL_LABEL.facturacion[lang]}</h2>
          <p className="text-[11px] font-bold text-black/50 dark:text-white/50">
            {t(lang, 'Solo facturación · sin POS', 'Invoicing only · no POS')}
          </p>
        </div>
        <div className="flex-1" />
        <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
          <ShieldCheck size={11} /> DGII Cert #42483
        </span>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Form */}
        <div className="lg:col-span-2 space-y-5">
          {/* Client selector */}
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-black/10 dark:border-white/10 p-5">
            <h3 className="text-[11px] font-extrabold tracking-[2px] uppercase text-black/50 dark:text-white/50 mb-3">
              {t(lang, 'Cliente', 'Client')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {CLIENTS.map(c => (
                <button
                  key={c.id}
                  onClick={() => setClient(c)}
                  className={`text-left p-3 rounded-lg border transition-all ${
                    client?.id === c.id
                      ? 'border-[#b3001e] bg-[#b3001e]/5'
                      : 'border-black/10 dark:border-white/10 bg-slate-50 dark:bg-white/5 hover:border-[#b3001e]/40'
                  }`}
                >
                  <p className="text-xs font-black text-black dark:text-white">{c.name}</p>
                  <p className="text-[11px] font-mono text-black/50 dark:text-white/50 tabular-nums mt-0.5">RNC {c.rnc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Line items */}
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-black/10 dark:border-white/10 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] font-extrabold tracking-[2px] uppercase text-black/50 dark:text-white/50">
                {t(lang, 'Conceptos', 'Line items')}
              </h3>
              <button onClick={addItem} className="inline-flex items-center gap-1 text-[11px] font-black text-[#b3001e] hover:text-[#cc1a33] uppercase tracking-wide">
                <Plus size={13} /> {t(lang, 'Agregar', 'Add')}
              </button>
            </div>
            <div className="space-y-2">
              {items.map(it => (
                <div key={it.id} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    value={it.desc}
                    onChange={e => updateItem(it.id, 'desc', e.target.value)}
                    placeholder={t(lang, 'Descripción', 'Description')}
                    className="col-span-6 px-2.5 py-2 rounded-lg bg-slate-100 dark:bg-white/10 text-xs text-black dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]"
                  />
                  <input
                    type="number"
                    value={it.qty}
                    onChange={e => updateItem(it.id, 'qty', e.target.value)}
                    className="col-span-2 px-2.5 py-2 rounded-lg bg-slate-100 dark:bg-white/10 text-xs text-black dark:text-white text-center tabular-nums outline-none focus:ring-2 focus:ring-[#b3001e]"
                  />
                  <input
                    type="number"
                    value={it.price}
                    onChange={e => updateItem(it.id, 'price', e.target.value)}
                    className="col-span-3 px-2.5 py-2 rounded-lg bg-slate-100 dark:bg-white/10 text-xs text-black dark:text-white text-right tabular-nums outline-none focus:ring-2 focus:ring-[#b3001e]"
                  />
                  <button
                    onClick={() => removeItem(it.id)}
                    className="col-span-1 w-8 h-8 mx-auto rounded-md text-black/40 dark:text-white/40 hover:text-[#b3001e] hover:bg-[#b3001e]/10 flex items-center justify-center"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Preview / status */}
        <div className="space-y-5">
          {/* Totals */}
          <div className="bg-black text-white rounded-2xl p-5">
            <h3 className="text-[10px] font-extrabold tracking-[2px] uppercase text-white/50 mb-3">
              {t(lang, 'Totales', 'Totals')}
            </h3>
            <div className="space-y-1.5 text-sm">
              <Row label={t(lang, 'Subtotal', 'Subtotal')} value={fmtRD(totals.subtotal)} />
              <Row label="ITBIS 18%" value={fmtRD(totals.itbis)} />
              <div className="h-px bg-white/10 my-2" />
              <Row label="Total" value={fmtRD(totals.total)} bold />
            </div>
            <button
              onClick={emit}
              disabled={!items.length || totals.total <= 0}
              className="mt-4 w-full py-3 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] disabled:opacity-30 text-white font-black text-sm uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Send size={14} /> {t(lang, 'Emitir e-CF', 'Issue e-CF')}
            </button>
          </div>

          {/* DGII status */}
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-black/10 dark:border-white/10 p-5">
            <h3 className="text-[10px] font-extrabold tracking-[2px] uppercase text-black/50 dark:text-white/50 mb-3">
              {t(lang, 'Estado DGII', 'DGII status')}
            </h3>
            {issued ? (
              <div className="space-y-3">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={11} /> {t(lang, 'Aceptado', 'Accepted')}
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-16 h-16 rounded-md bg-white border-2 border-black flex items-center justify-center flex-shrink-0">
                    <FakeQR size={56} />
                  </div>
                  <div className="text-[11px] font-mono">
                    <p className="text-black dark:text-white font-black">{issued.ncf}</p>
                    <p className="text-black/50 dark:text-white/50 mt-1">cs: {issued.code}</p>
                    <p className="text-black/50 dark:text-white/50">{issued.ts}</p>
                  </div>
                </div>
                <p className="text-[11px] text-black/60 dark:text-white/60 font-semibold leading-snug">
                  {client?.name} · RNC {client?.rnc}
                </p>
                <button onClick={reset} className="text-[11px] font-black text-[#b3001e] hover:text-[#cc1a33] uppercase tracking-wide">
                  {t(lang, 'Nueva factura', 'New invoice')}
                </button>
              </div>
            ) : (
              <p className="text-xs text-black/50 dark:text-white/50 font-semibold">
                {t(lang, 'Listo para emitir. Toca "Emitir e-CF" cuando termines.', 'Ready to issue. Tap "Issue e-CF" when done.')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, bold }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-white/60 ${bold ? 'font-black text-white' : ''}`}>{label}</span>
      <span className={`tabular-nums ${bold ? 'text-lg font-black text-white' : 'text-white/90 font-bold'}`}>{value}</span>
    </div>
  )
}
