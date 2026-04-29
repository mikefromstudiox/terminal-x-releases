// DGIIDemo — faithful copy of packages/ui/screens/DGII.jsx render structure.
// Top tab bar (606 Ventas / 606 Compras / Anular eNCF / Certificado) + active
// content. NCFSeqCard, MetricCard, PeriodSelector copied verbatim from real.
// All API mutations stripped.

import { useState } from 'react'
import {
  FileText, Database, ShoppingCart, Ban, ShieldCheck, AlertTriangle,
  Download, Upload, Send, RefreshCw, Check, X, Calendar, Clock,
} from 'lucide-react'

function fmtMoney(n) { return n != null ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00' }

function NCFSeqCard({ code, seq, accentColor }) {
  const pct = seq.limit > 0 ? Math.round(seq.current / seq.limit * 100) : 0
  const remaining = seq.limit - seq.current
  const warning = seq.limit > 0 && remaining < 500
  const colors = {
    blue:  { bar: 'bg-blue-500',    bg: warning ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200',       text: 'text-blue-700' },
    green: { bar: 'bg-emerald-500', bg: warning ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
  }
  const c = colors[accentColor] || colors.blue
  return (
    <div className={`rounded-xl border p-4 flex-1 ${c.bg}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono font-bold text-slate-800">{code}</span>
        {warning ? (
          <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1"><AlertTriangle size={10} />Pocas disponibles</span>
        ) : seq.limit > 0 ? (
          <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">OK</span>
        ) : (
          <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-semibold">Pendiente</span>
        )}
      </div>
      <p className="text-xs text-slate-500 mb-1">{seq.name}</p>
      {seq.limit > 0 && (
        <>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-500">Actual: <span className="font-medium text-slate-700">{seq.current.toLocaleString()}</span></span>
            <span className="text-slate-500">Límite: <span className="font-medium text-slate-700">{seq.limit.toLocaleString()}</span></span>
          </div>
          <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${warning ? 'bg-amber-400' : c.bar}`} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <div className="flex justify-between text-xs mt-1">
            <span className={warning ? 'text-amber-600 font-medium' : 'text-slate-400'}>{remaining.toLocaleString()} disponibles</span>
            <span className="text-slate-400">Vence: {seq.expires}</span>
          </div>
        </>
      )}
    </div>
  )
}

function PeriodSelector({ period, setPeriod }) {
  const items = [
    { id: 'mes_actual',      label: 'Mes Actual'    },
    { id: 'mes_anterior',    label: 'Mes Anterior'  },
    { id: 'trimestre',       label: 'Trimestre'     },
    { id: 'ano',             label: 'Año Actual'    },
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(it => (
        <button key={it.id} onClick={() => setPeriod(it.id)}
          className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${period === it.id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          {it.label}
        </button>
      ))}
    </div>
  )
}

function MetricCard({ label, value, sub, color = 'slate', icon: Icon }) {
  const colors = {
    slate:   'text-slate-700  bg-slate-50',
    blue:    'text-blue-700   bg-blue-50',
    green:   'text-emerald-700 bg-emerald-50',
    amber:   'text-amber-700  bg-amber-50',
    red:     'text-red-700    bg-red-50',
  }
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 flex-1">
      <div className="flex items-center gap-2 mb-2">
        {Icon && <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[color]}`}><Icon size={14} /></div>}
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
      </div>
      <p className="text-[20px] font-extrabold text-slate-800 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function Screen607({ ecfTodayCount }) {
  const [period, setPeriod] = useState('mes_actual')
  const SAMPLE = [
    { ncf: 'E320000001847', client: 'Empresa Tropical SRL',  rnc: '131-1234567-8', tipo: 'E32', fecha: '2026-04-27', sub: 18500, itbis: 2823,  total: 21323 },
    { ncf: 'E310000000234', client: 'Hotel Atlantico SRL',   rnc: '131-2345678-9', tipo: 'E31', fecha: '2026-04-27', sub: 245000, itbis: 37373, total: 282373 },
    { ncf: 'B0200001846',   client: 'Distribuidora del Sur', rnc: '131-3456789-0', tipo: 'B02', fecha: '2026-04-26', sub: 95000,  itbis: 14492, total: 109492 },
    { ncf: 'E320000001846', client: 'Sra. Ana Reyes',        rnc: '003-4567890-1', tipo: 'E32', fecha: '2026-04-26', sub: 8500,   itbis: 1297,  total: 9797 },
    { ncf: 'E430000000007', client: 'Gastos Menores',        rnc: '',              tipo: 'E43', fecha: '2026-04-26', sub: 1850,   itbis: 282,   total: 2132 },
    { ncf: 'E340000000091', client: 'Empresa Tropical SRL',  rnc: '131-1234567-8', tipo: 'E34', fecha: '2026-04-25', sub: -4500,  itbis: -687,  total: -5187 },
    { ncf: 'E320000001844', client: 'Restaurante La Casona', rnc: '131-5555555-5', tipo: 'E32', fecha: '2026-04-25', sub: 32400,  itbis: 4946,  total: 37346 },
  ]
  const totals = SAMPLE.reduce((acc, r) => ({ sub: acc.sub + r.sub, itbis: acc.itbis + r.itbis, total: acc.total + r.total }), { sub: 0, itbis: 0, total: 0 })
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h3 className="text-[15px] font-bold text-slate-800">Ventas / 607</h3>
            <p className="text-[12px] text-slate-500">Comprobantes emitidos · listo para subir al portal DGII</p>
          </div>
          <PeriodSelector period={period} setPeriod={setPeriod} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <MetricCard label="Lineas"             value={SAMPLE.length}         color="blue"  icon={Database} />
          <MetricCard label="Total operaciones"  value={`RD$ ${fmtMoney(totals.sub)}`}    color="green" icon={Calendar} />
          <MetricCard label="ITBIS"              value={`RD$ ${fmtMoney(totals.itbis)}`}  color="slate" icon={FileText} />
          <MetricCard label="Estado"             value="Listo"  sub={`${ecfTodayCount} hoy enviados`} color="green" icon={Check} />
        </div>
        <div className="flex gap-2 mb-4">
          <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-blue-600 text-white hover:bg-blue-700"><Send size={13} /> Generar archivo TXT</button>
          <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"><Download size={13} /> Descargar</button>
          <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"><RefreshCw size={13} /> Refrescar</button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="text-left px-3 py-2 font-bold">NCF / eNCF</th>
                <th className="text-left px-3 py-2 font-bold">Cliente / RNC</th>
                <th className="text-center px-3 py-2 font-bold">Tipo</th>
                <th className="text-left px-3 py-2 font-bold">Fecha</th>
                <th className="text-right px-3 py-2 font-bold">Subtotal</th>
                <th className="text-right px-3 py-2 font-bold">ITBIS</th>
                <th className="text-right px-3 py-2 font-bold">Total</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE.map((r, i) => (
                <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-[11px] font-bold text-slate-800">{r.ncf}</td>
                  <td className="px-3 py-2"><p className="text-slate-700 truncate">{r.client}</p>{r.rnc && <p className="text-[10px] text-slate-400 font-mono">{r.rnc}</p>}</td>
                  <td className="px-3 py-2 text-center"><span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">{r.tipo}</span></td>
                  <td className="px-3 py-2 text-slate-600">{r.fecha}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.sub < 0 ? 'text-red-600' : 'text-slate-700'}`}>RD$ {fmtMoney(r.sub)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.itbis < 0 ? 'text-red-600' : 'text-slate-600'}`}>RD$ {fmtMoney(r.itbis)}</td>
                  <td className={`px-3 py-2 text-right font-bold tabular-nums ${r.total < 0 ? 'text-red-600' : 'text-slate-800'}`}>RD$ {fmtMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 border-t-2 border-slate-200 font-bold">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right text-slate-500">TOTAL</td>
                <td className="px-3 py-2 text-right tabular-nums">RD$ {fmtMoney(totals.sub)}</td>
                <td className="px-3 py-2 text-right tabular-nums">RD$ {fmtMoney(totals.itbis)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-800">RD$ {fmtMoney(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}

function Screen606() {
  const [period, setPeriod] = useState('mes_actual')
  const SAMPLE = [
    { ncf: 'B011200000045', proveedor: 'Distribuidora RD',  rnc: '131-1111111-1', tipo: 'B01', fecha: '2026-04-26', sub: 18500, itbis: 2823, total: 21323 },
    { ncf: 'B011200000046', proveedor: 'Hogar Plus',        rnc: '131-2222222-2', tipo: 'B01', fecha: '2026-04-25', sub: 7200,  itbis: 1098, total: 8298 },
    { ncf: 'B040000000089', proveedor: 'Lacteos del Norte', rnc: '131-3333333-3', tipo: 'B04', fecha: '2026-04-24', sub: 24800, itbis: 3784, total: 28584 },
  ]
  const totals = SAMPLE.reduce((acc, r) => ({ sub: acc.sub + r.sub, itbis: acc.itbis + r.itbis, total: acc.total + r.total }), { sub: 0, itbis: 0, total: 0 })
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h3 className="text-[15px] font-bold text-slate-800">Compras / 606</h3>
            <p className="text-[12px] text-slate-500">Gastos recibidos con comprobante fiscal · entrada manual o importacion</p>
          </div>
          <PeriodSelector period={period} setPeriod={setPeriod} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <MetricCard label="Lineas"             value={SAMPLE.length}        color="blue"  icon={Database} />
          <MetricCard label="Total compras"      value={`RD$ ${fmtMoney(totals.sub)}`}    color="amber" icon={ShoppingCart} />
          <MetricCard label="ITBIS pagado"       value={`RD$ ${fmtMoney(totals.itbis)}`}  color="slate" icon={FileText} />
          <MetricCard label="Estado"             value="Borrador" sub="Por enviar" color="amber" icon={Clock} />
        </div>
        <div className="flex gap-2 mb-4">
          <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700"><Upload size={13} /> Importar 606 CSV</button>
          <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"><Send size={13} /> Generar TXT</button>
          <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"><Download size={13} /> Descargar</button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="text-left px-3 py-2 font-bold">NCF Proveedor</th>
                <th className="text-left px-3 py-2 font-bold">Proveedor / RNC</th>
                <th className="text-center px-3 py-2 font-bold">Tipo</th>
                <th className="text-left px-3 py-2 font-bold">Fecha</th>
                <th className="text-right px-3 py-2 font-bold">Subtotal</th>
                <th className="text-right px-3 py-2 font-bold">ITBIS</th>
                <th className="text-right px-3 py-2 font-bold">Total</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE.map((r, i) => (
                <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-[11px] font-bold text-slate-800">{r.ncf}</td>
                  <td className="px-3 py-2"><p className="text-slate-700">{r.proveedor}</p><p className="text-[10px] text-slate-400 font-mono">{r.rnc}</p></td>
                  <td className="px-3 py-2 text-center"><span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">{r.tipo}</span></td>
                  <td className="px-3 py-2 text-slate-600">{r.fecha}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">RD$ {fmtMoney(r.sub)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">RD$ {fmtMoney(r.itbis)}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-800">RD$ {fmtMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ScreenANECF() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <h3 className="text-[15px] font-bold text-slate-800">Anular rangos de e-NCF no utilizados</h3>
      <p className="text-[12px] text-slate-500 mt-1 mb-4">Cuando un certificado expira o cambias secuencia, anula los e-NCF restantes con un comprobante ANECF firmado y enviado a DGII.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <NCFSeqCard code="E32" accentColor="green" seq={{ name: 'Consumo (factura)',   current: 1847, limit: 999999, expires: '2027-03-15' }} />
        <NCFSeqCard code="E31" accentColor="blue"  seq={{ name: 'Credito Fiscal',      current: 234,  limit: 999999, expires: '2027-03-15' }} />
        <NCFSeqCard code="B02" accentColor="blue"  seq={{ name: 'Consumo papel (NCF)', current: 1847, limit: 999999, expires: '2027-03-15' }} />
      </div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
        <div className="text-[12px] text-amber-900">
          <p className="font-bold">Importante</p>
          <p>Anular un rango es irreversible. Solo el dueño puede aprobar esta operacion. Una vez enviado el ANECF a DGII, los e-NCF dentro del rango quedan invalidos para emision.</p>
        </div>
      </div>
      <button className="mt-4 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[13px] font-bold bg-red-600 text-white hover:bg-red-700"><Ban size={14} /> Crear ANECF</button>
    </div>
  )
}

function ScreenCert() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center"><ShieldCheck size={20} className="text-emerald-700" /></div>
        <div>
          <h3 className="text-[16px] font-bold text-slate-800">Certificado digital Viafirma</h3>
          <p className="text-[12px] text-slate-500">RSA-SHA256 · X.509 · Renovacion automatica</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[12px]">
        <div><p className="text-slate-400 uppercase tracking-wider text-[10px]">Subject</p><p className="font-mono text-slate-700">CN=133410321</p></div>
        <div><p className="text-slate-400 uppercase tracking-wider text-[10px]">Emisor</p><p className="text-slate-700">Viafirma Inc</p></div>
        <div><p className="text-slate-400 uppercase tracking-wider text-[10px]">Vigencia</p><p className="text-slate-700">15 mar 2026 — 15 mar 2027</p></div>
        <div><p className="text-slate-400 uppercase tracking-wider text-[10px]">Estado</p><p className="text-emerald-700 font-bold inline-flex items-center gap-1"><Check size={12} /> Activo</p></div>
        <div><p className="text-slate-400 uppercase tracking-wider text-[10px]">Ambiente</p><p className="text-slate-700 font-bold">PRODUCCION</p></div>
        <div><p className="text-slate-400 uppercase tracking-wider text-[10px]">Solicitud DGII</p><p className="text-slate-700 font-mono">#42483</p></div>
      </div>
      <div className="mt-5 flex gap-2">
        <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"><Download size={13} /> Exportar .pem</button>
        <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-slate-800 text-white hover:bg-slate-700"><RefreshCw size={13} /> Verificar contra DGII</button>
      </div>
    </div>
  )
}

export default function DGIIDemo({ ecfTodayCount = 24 }) {
  const [screen, setScreen] = useState('606')
  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
      <div className="bg-white border-b border-slate-100 px-6 py-3 flex items-center gap-4 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-2 mr-4">
          <FileText size={18} className="text-slate-500" />
          <span className="font-semibold text-slate-800">DGII / Fiscal</span>
        </div>
        <div className="flex rounded-xl border border-slate-200 overflow-hidden text-sm">
          <button onClick={() => setScreen('606')}
            className={`flex items-center gap-1.5 px-5 py-2 font-medium transition ${screen === '606' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            <Database size={14} /> 607 Ventas
          </button>
          <button onClick={() => setScreen('607')}
            className={`flex items-center gap-1.5 px-5 py-2 font-medium transition ${screen === '607' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            <ShoppingCart size={14} /> 606 Compras
          </button>
          <button onClick={() => setScreen('anecf')}
            className={`flex items-center gap-1.5 px-5 py-2 font-medium transition ${screen === 'anecf' ? 'bg-red-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            <Ban size={14} /> Anular e-NCF
          </button>
          <button onClick={() => setScreen('cert')}
            className={`flex items-center gap-1.5 px-5 py-2 font-medium transition ${screen === 'cert' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            <ShieldCheck size={14} /> Certificado
          </button>
        </div>
        <div className="ml-auto">
          <span className="text-xs text-slate-400">
            {screen === '606' ? 'Ventas / Comprobantes emitidos'
              : screen === '607' ? 'Compras / Gastos recibidos'
              : screen === 'anecf' ? 'Anulacion de rangos no utilizados'
              : 'Certificado digital Viafirma'}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {screen === '606' ? <Screen607 ecfTodayCount={ecfTodayCount} />
          : screen === '607' ? <Screen606 />
          : screen === 'anecf' ? <ScreenANECF />
          : <ScreenCert />}
      </div>
    </div>
  )
}
