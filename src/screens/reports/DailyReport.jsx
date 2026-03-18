import { useState, useMemo } from 'react'
import {
  Search, X, Eye, Printer, AlertTriangle, CheckCircle2,
  ChevronDown, ReceiptText, TrendingUp, CircleDollarSign,
  Clock, Ban,
} from 'lucide-react'
import { useLang } from '../../i18n'

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtRD(n) {
  return `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(d) {
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtTime(d) {
  return d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
}
function ncfNumber(t) {
  return `${t.ncfType}000000${String(t.id).padStart(2, '0')}`
}
function payLabel(pm, lang) {
  const m = { cash: { es: 'Efectivo', en: 'Cash' }, card: { es: 'Tarjeta', en: 'Card' }, transfer: { es: 'Transferencia', en: 'Transfer' }, credit: { es: 'Crédito', en: 'Credit' } }
  return m[pm]?.[lang] ?? pm
}

// ── Demo data (relative to real Date.now() so date pills work live) ───────────
const _now = Date.now()
const D = (daysAgo, h = 10, m = 0) => new Date(_now - daysAgo * 86_400_000 + (h * 3600 + m * 60) * 1000)

const TRANSACTIONS_INIT = [
  { id:  1, ticketNo:'T-0850', client:'Hotel Mirador del Mar, SAS',       vehicle:'Toyota Hilux Plateada',        services:[{name:'Full Detailing',price:3500},{name:'Encerado',price:300}],                                             cashier:'Admin',  date:D(0,14,30), subtotal:3800,  itbis:684,   ley:380,  total:4864,   payMethod:'credit',   estado:'normal', ncfType:'B01' },
  { id:  2, ticketNo:'T-0849', client:'Walk-in',                           vehicle:'Kia Sportage Gris',             services:[{name:'Lavado Básico',price:300}],                                                                          cashier:'Carlos', date:D(0,13,15), subtotal:300,   itbis:54,    ley:30,   total:384,    payMethod:'cash',     estado:'normal', ncfType:'B02' },
  { id:  3, ticketNo:'T-0848', client:'Walk-in',                           vehicle:'Nissan Sentra Negro',           services:[{name:'Lavado Completo',price:500},{name:'Aromatizante',price:100}],                                        cashier:'Admin',  date:D(0,11,45), subtotal:600,   itbis:108,   ley:60,   total:768,    payMethod:'cash',     estado:'nula',   ncfType:'B02', voidReason:'Error en el servicio registrado', voidedBy:'Admin', voidedAt:D(0,12,0) },
  { id:  4, ticketNo:'T-0847', client:'Supermercados La Cadena, SRL',      vehicle:'Toyota Camry Rojo',             services:[{name:'Lavado Completo',price:500},{name:'Encerado',price:300},{name:'Limpia Vidrios',price:50}],            cashier:'Admin',  date:D(1,16,20), subtotal:850,   itbis:153,   ley:85,   total:1088,   payMethod:'credit',   estado:'normal', ncfType:'B01' },
  { id:  5, ticketNo:'T-0846', client:'Walk-in',                           vehicle:'Honda CR-V Azul',               services:[{name:'Full Detailing',price:3500}],                                                                        cashier:'María',  date:D(1,14,10), subtotal:3500,  itbis:630,   ley:350,  total:4480,   payMethod:'card',     estado:'normal', ncfType:'B02' },
  { id:  6, ticketNo:'T-0845', client:'Constructora Hernández & Asoc.',    vehicle:'Ford F-150 Plateada',           services:[{name:'Lavado Flota × 3',price:900}],                                                                      cashier:'Admin',  date:D(1,10,30), subtotal:900,   itbis:162,   ley:90,   total:1152,   payMethod:'credit',   estado:'normal', ncfType:'B01' },
  { id:  7, ticketNo:'T-0844', client:'Walk-in',                           vehicle:'Chevrolet Traverse Blanca',     services:[{name:'Lavado Premium',price:800},{name:'Silicon Tablero',price:80}],                                       cashier:'Pedro',  date:D(2,15,50), subtotal:880,   itbis:158.4, ley:88,   total:1126.4, payMethod:'cash',     estado:'normal', ncfType:'B02' },
  { id:  8, ticketNo:'T-0843', client:'Walk-in',                           vehicle:'Jeep Wrangler Verde',           services:[{name:'Tapizado',price:1200},{name:'Aromatizante',price:100}],                                              cashier:'Carlos', date:D(2,14,0),  subtotal:1300,  itbis:234,   ley:130,  total:1664,   payMethod:'transfer', estado:'normal', ncfType:'B02' },
  { id:  9, ticketNo:'T-0842', client:'Grupo Empresarial Mejía, SA',       vehicle:'BMW 5 Series Negro',            services:[{name:'Lavado Premium',price:800}],                                                                         cashier:'Admin',  date:D(2,11,20), subtotal:800,   itbis:144,   ley:80,   total:1024,   payMethod:'credit',   estado:'normal', ncfType:'B01' },
  { id: 10, ticketNo:'T-0841', client:'Walk-in',                           vehicle:'Toyota Corolla Rojo',           services:[{name:'Lavado Básico',price:300}],                                                                          cashier:'Juan',   date:D(3,16,40), subtotal:300,   itbis:54,    ley:30,   total:384,    payMethod:'cash',     estado:'normal', ncfType:'B02' },
  { id: 11, ticketNo:'T-0840', client:'Walk-in',                           vehicle:'Hyundai Santa Fe Gris',         services:[{name:'Lavado Completo',price:500},{name:'Encerado',price:300},{name:'Pulido',price:250},{name:'Cera Carnauba',price:150}], cashier:'Pedro', date:D(3,14,25), subtotal:1200, itbis:216, ley:120, total:1536, payMethod:'card',   estado:'normal', ncfType:'B02' },
  { id: 12, ticketNo:'T-0839', client:'Walk-in',                           vehicle:'Mazda CX-5 Azul',               services:[{name:'Lavado Interior',price:400}],                                                                       cashier:'María',  date:D(3,13,0),  subtotal:400,   itbis:72,    ley:40,   total:512,    payMethod:'cash',     estado:'nula',   ncfType:'B02', voidReason:'Cliente solicitó cancelación',    voidedBy:'Admin', voidedAt:D(3,13,30) },
  { id: 13, ticketNo:'T-0838', client:'Hotel Mirador del Mar, SAS',        vehicle:'Land Rover Defender Negro',     services:[{name:'Lavado Completo',price:500},{name:'Tapizado',price:1200}],                                           cashier:'Admin',  date:D(5,15,10), subtotal:1700,  itbis:306,   ley:170,  total:2176,   payMethod:'credit',   estado:'normal', ncfType:'B01' },
  { id: 14, ticketNo:'T-0837', client:'Walk-in',                           vehicle:'Mitsubishi Outlander Blanco',   services:[{name:'Lavado Básico',price:300},{name:'Aromatizante',price:100}],                                          cashier:'Juan',   date:D(5,11,0),  subtotal:400,   itbis:72,    ley:40,   total:512,    payMethod:'cash',     estado:'normal', ncfType:'B02' },
  { id: 15, ticketNo:'T-0836', client:'Farmacia El Alivio, SRL',           vehicle:'Honda Pilot Gris',              services:[{name:'Full Detailing',price:3500},{name:'Encerado',price:300},{name:'Silicon Tablero',price:80}],          cashier:'Admin',  date:D(10,14,0), subtotal:3880,  itbis:698.4, ley:388,  total:4966.4, payMethod:'credit',   estado:'normal', ncfType:'B01' },
  { id: 16, ticketNo:'T-0835', client:'Walk-in',                           vehicle:'Suzuki Vitara Rojo',            services:[{name:'Lavado Completo',price:500}],                                                                        cashier:'Carlos', date:D(10,10,30),subtotal:500,   itbis:90,    ley:50,   total:640,    payMethod:'cash',     estado:'normal', ncfType:'B02' },
  { id: 17, ticketNo:'T-0834', client:'Constructora Hernández & Asoc.',    vehicle:'Toyota Prado Negro',            services:[{name:'Lavado Flota × 5',price:1500},{name:'Encerado',price:300}],                                         cashier:'Admin',  date:D(20,13,20),subtotal:1800,  itbis:324,   ley:180,  total:2304,   payMethod:'credit',   estado:'normal', ncfType:'B01' },
  { id: 18, ticketNo:'T-0833', client:'Walk-in',                           vehicle:'Kia Rio Plateado',              services:[{name:'Lavado Básico',price:300}],                                                                          cashier:'Pedro',  date:D(20,11,45),subtotal:300,   itbis:54,    ley:30,   total:384,    payMethod:'card',     estado:'normal', ncfType:'B02' },
]

const CASHIERS = ['Admin', 'Carlos', 'María', 'Pedro', 'Juan']

const DATE_PILLS = [
  { id: 'hoy',    es: 'Hoy',          en: 'Today'      },
  { id: 'ayer',   es: 'Ayer',         en: 'Yesterday'  },
  { id: 'semana', es: 'Esta semana',  en: 'This week'  },
  { id: 'mes',    es: 'Este mes',     en: 'This month' },
]

// Perfectly aligned column definitions — used for BOTH header and rows
const COLS = [
  { key: 'ticket',   es: '#',               en: '#',             cls: 'w-[80px] shrink-0'                       },
  { key: 'client',   es: 'Cliente / Vehículo', en: 'Client / Vehicle', cls: 'flex-1 min-w-0'                    },
  { key: 'services', es: 'Servicio(s)',      en: 'Service(s)',    cls: 'w-[160px] shrink-0'                      },
  { key: 'cashier',  es: 'Cajero',          en: 'Cashier',       cls: 'w-[90px] shrink-0'                       },
  { key: 'date',     es: 'Fecha / Hora',    en: 'Date / Time',   cls: 'w-[120px] shrink-0'                      },
  { key: 'subtotal', es: 'Subtotal',        en: 'Subtotal',      cls: 'w-[96px] shrink-0 text-right'            },
  { key: 'itbis',    es: 'ITBIS',           en: 'ITBIS',         cls: 'w-[84px] shrink-0 text-right'            },
  { key: 'total',    es: 'Total',           en: 'Total',         cls: 'w-[104px] shrink-0 text-right'           },
  { key: 'estado',   es: 'Estado',          en: 'Status',        cls: 'w-[108px] shrink-0'                      },
]

const MANAGER_PIN = '1111'

// ── Date filter ───────────────────────────────────────────────────────────────
function inPill(date, pill) {
  const d       = new Date(date)
  const now     = new Date()
  const today   = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (pill === 'hoy')  return d >= today
  if (pill === 'ayer') {
    const y = new Date(today); y.setDate(y.getDate() - 1)
    return d >= y && d < today
  }
  if (pill === 'semana') {
    const mon = new Date(today)
    mon.setDate(mon.getDate() - (mon.getDay() === 0 ? 6 : mon.getDay() - 1))
    return d >= mon
  }
  if (pill === 'mes') {
    return d >= new Date(now.getFullYear(), now.getMonth(), 1)
  }
  return true
}

// ── Estado badge ──────────────────────────────────────────────────────────────
function EstadoBadge({ t, lang }) {
  if (t.estado === 'nula')
    return <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-0.5"><Ban size={9} />{lang === 'es' ? 'Anulada' : 'Voided'}</span>
  if (t.payMethod === 'credit')
    return <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">CxC</span>
  return <span className="text-[10px] font-bold bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5">{lang === 'es' ? 'Pagado' : 'Paid'}</span>
}

// ── Metric card ───────────────────────────────────────────────────────────────
function MetricCard({ icon: Icon, label, value, sub, accent }) {
  const colors = {
    sky:    'bg-sky-50 text-sky-600 border-sky-100',
    green:  'bg-green-50 text-green-600 border-green-100',
    violet: 'bg-violet-50 text-violet-600 border-violet-100',
    amber:  'bg-amber-50 text-amber-600 border-amber-100',
    red:    'bg-red-50 text-red-600 border-red-100',
  }
  return (
    <div className="flex-1 bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${colors[accent]}`}>
        <Icon size={16} />
      </div>
      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-[15px] font-bold text-slate-800 leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
      </div>
    </div>
  )
}

// ── Detail modal ──────────────────────────────────────────────────────────────
function DetailModal({ ticket: t, onClose, onReprint, lang }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h3 className="text-[15px] font-bold text-slate-800">
              {lang === 'es' ? 'Detalle de Factura' : 'Invoice Detail'} · <span className="text-sky-600">{t.ticketNo}</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">NCF: {ncfNumber(t)}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-4 space-y-4">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
            <div><span className="text-slate-400">{lang === 'es' ? 'Fecha' : 'Date'}:</span> <span className="font-medium text-slate-700">{fmtDate(t.date)} {fmtTime(t.date)}</span></div>
            <div><span className="text-slate-400">{lang === 'es' ? 'Cajero' : 'Cashier'}:</span> <span className="font-medium text-slate-700">{t.cashier}</span></div>
            <div><span className="text-slate-400">{lang === 'es' ? 'Vehículo' : 'Vehicle'}:</span> <span className="font-medium text-slate-700">{t.vehicle}</span></div>
            <div><span className="text-slate-400">{lang === 'es' ? 'Comprobante' : 'Receipt'}:</span> <span className="font-medium text-slate-700">{t.ncfType} · {t.ncfType === 'B01' ? (lang === 'es' ? 'Crédito Fiscal' : 'Tax Credit') : (lang === 'es' ? 'Consumidor Final' : 'Consumer')}</span></div>
            <div className="col-span-2"><span className="text-slate-400">{lang === 'es' ? 'Cliente' : 'Client'}:</span> <span className="font-medium text-slate-700">{t.client}</span></div>
          </div>

          {/* Services */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
            {t.services.map((s, i) => (
              <div key={i} className="flex justify-between px-4 py-2.5 border-b border-slate-100 last:border-0 text-[12px]">
                <span className="text-slate-700">{s.name}</span>
                <span className="font-semibold text-slate-800">{fmtRD(s.price)}</span>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="space-y-1 text-[12px]">
            <div className="flex justify-between text-slate-500">
              <span>{lang === 'es' ? 'Subtotal' : 'Subtotal'}</span>
              <span>{fmtRD(t.subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>ITBIS 18%</span>
              <span>{fmtRD(t.itbis)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>{lang === 'es' ? 'Ley 10%' : 'Service Charge 10%'}</span>
              <span>{fmtRD(t.ley)}</span>
            </div>
            <div className="flex justify-between font-bold text-slate-800 text-[14px] pt-1 border-t border-slate-200">
              <span>Total</span>
              <span>{fmtRD(t.total)}</span>
            </div>
          </div>

          {/* Payment */}
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-slate-400">{lang === 'es' ? 'Método de pago' : 'Payment method'}:</span>
            <span className="font-semibold text-slate-700">{payLabel(t.payMethod, lang)}</span>
            <EstadoBadge t={t} lang={lang} />
          </div>

          {/* Void info */}
          {t.estado === 'nula' && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 space-y-1 text-[12px]">
              <p className="font-bold text-red-700">{lang === 'es' ? 'Factura Anulada' : 'Voided Invoice'}</p>
              <p className="text-red-600"><span className="font-medium">{lang === 'es' ? 'Motivo' : 'Reason'}:</span> {t.voidReason}</p>
              <p className="text-red-500">{lang === 'es' ? 'Anulado por' : 'Voided by'}: {t.voidedBy} · {fmtDate(t.voidedAt)} {fmtTime(t.voidedAt)}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
          {t.estado !== 'nula' && (
            <button
              onClick={() => { console.log('[REPRINT]', t.ticketNo); onReprint?.() }}
              className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl text-[12px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Printer size={14} />
              {lang === 'es' ? 'Reimprimir' : 'Reprint'}
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-[12px] font-semibold transition-colors">
            {lang === 'es' ? 'Cerrar' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Anular modal ──────────────────────────────────────────────────────────────
function AnularModal({ ticket: t, onConfirm, onClose, lang }) {
  const [reason, setReason] = useState('')
  const [pin,    setPin]    = useState('')
  const [error,  setError]  = useState('')

  function handleConfirm() {
    setError('')
    if (!reason.trim()) { setError(lang === 'es' ? 'El motivo es requerido.' : 'Reason is required.'); return }
    if (pin !== MANAGER_PIN) { setError(lang === 'es' ? 'PIN de gerente incorrecto.' : 'Incorrect manager PIN.'); setPin(''); return }
    onConfirm({ ticketId: t.id, reason: reason.trim(), voidedBy: 'Admin', voidedAt: new Date() })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl shadow-2xl w-[420px] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-red-50 rounded-xl flex items-center justify-center">
              <Ban size={15} className="text-red-500" />
            </div>
            <div>
              <h3 className="text-[14px] font-bold text-slate-800">{lang === 'es' ? 'Anular Factura' : 'Void Invoice'}</h3>
              <p className="text-[11px] text-red-500 font-medium">{t.ticketNo} · {fmtRD(t.total)}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"><X size={15} /></button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Warning */}
          <div className="flex gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-3 text-[12px] text-amber-800">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-500" />
            <p>{lang === 'es'
              ? 'Esta acción es irreversible. La factura se marcará como anulada y no aparecerá en futuros reportes DGII, pero permanecerá en el historial.'
              : 'This action cannot be undone. The invoice will be voided and excluded from future DGII reports, but will remain in history.'
            }</p>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">
              {lang === 'es' ? 'Motivo de anulación' : 'Void reason'} <span className="text-red-400">*</span>
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder={lang === 'es' ? 'Describe el motivo de la anulación...' : 'Describe the reason for voiding...'}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[13px] text-slate-700 focus:outline-none focus:border-sky-400 resize-none placeholder:text-slate-400"
            />
          </div>

          {/* Manager PIN */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">
              {lang === 'es' ? 'PIN del gerente' : 'Manager PIN'}
              <span className="ml-2 text-[10px] font-normal text-slate-400">{lang === 'es' ? '(Demo: 1111)' : '(Demo: 1111)'}</span>
            </label>
            <input
              type="password"
              value={pin}
              onChange={e => setPin(e.target.value.slice(0, 4))}
              placeholder="••••"
              maxLength={4}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[16px] text-center tracking-[0.5em] focus:outline-none focus:border-red-400 letter-spacing-wide"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-1.5 text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              <AlertTriangle size={12} className="shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-[13px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
            {lang === 'es' ? 'Cancelar' : 'Cancel'}
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 text-white rounded-xl text-[13px] font-bold transition-colors"
          >
            {lang === 'es' ? 'Confirmar Anulación' : 'Confirm Void'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Sales / Facturas screen ──────────────────────────────────────────────
const TAB_FILTERS = [
  { id: 'todas',   es: 'Todas',      en: 'All',          fn: () => true                                            },
  { id: 'normal',  es: 'Normales',   en: 'Normal',       fn: t => t.estado === 'normal'                           },
  { id: 'cxc',     es: 'CxC',        en: 'Credit A/R',   fn: t => t.payMethod === 'credit' && t.estado === 'normal'},
  { id: 'nulas',   es: 'Nulas',      en: 'Voided',       fn: t => t.estado === 'nula'                             },
  { id: 'contado', es: 'Al Contado', en: 'Cash / Card',  fn: t => t.payMethod !== 'credit' && t.estado === 'normal'},
  { id: 'credito', es: 'A Crédito',  en: 'On Account',   fn: t => t.payMethod === 'credit'                        },
]

export default function DailyReport() {
  const { lang } = useLang()

  const [transactions, setTransactions] = useState(TRANSACTIONS_INIT)
  const [tab,          setTab]          = useState('todas')
  const [datePill,     setDatePill]     = useState('mes')
  const [cashier,      setCashier]      = useState('all')
  const [search,       setSearch]       = useState('')
  const [selectedId,   setSelectedId]   = useState(null)
  const [detailModal,  setDetailModal]  = useState(null)
  const [anularModal,  setAnularModal]  = useState(null)
  const [toast,        setToast]        = useState(null)

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // Base set: date + cashier filtered (for summary metrics)
  const baseFiltered = useMemo(() =>
    transactions.filter(t =>
      inPill(t.date, datePill) &&
      (cashier === 'all' || t.cashier === cashier)
    )
  , [transactions, datePill, cashier])

  // Summary metrics (base, not tab/search filtered)
  const summary = useMemo(() => ({
    count:    baseFiltered.filter(t => t.estado !== 'nula').length,
    total:    baseFiltered.filter(t => t.estado !== 'nula').reduce((s, t) => s + t.total,  0),
    itbis:    baseFiltered.filter(t => t.estado !== 'nula').reduce((s, t) => s + t.itbis,  0),
    cxc:      baseFiltered.filter(t => t.payMethod === 'credit' && t.estado !== 'nula').reduce((s, t) => s + t.total, 0),
    nulas:    baseFiltered.filter(t => t.estado === 'nula').length,
  }), [baseFiltered])

  // Visible rows: base + tab + search
  const visible = useMemo(() => {
    const tabFn = TAB_FILTERS.find(f => f.id === tab)?.fn ?? (() => true)
    const q     = search.toLowerCase().trim()
    return baseFiltered
      .filter(tabFn)
      .filter(t => !q || t.client.toLowerCase().includes(q) || t.ticketNo.toLowerCase().includes(q) || t.vehicle.toLowerCase().includes(q))
  }, [baseFiltered, tab, search])

  const selectedTicket = transactions.find(t => t.id === selectedId) ?? null

  // Tab counts (from base, not search)
  const tabCounts = useMemo(() => {
    const res = {}
    TAB_FILTERS.forEach(f => { res[f.id] = baseFiltered.filter(f.fn).length })
    return res
  }, [baseFiltered])

  function handleVoid({ ticketId, reason, voidedBy, voidedAt }) {
    setTransactions(ts => ts.map(t =>
      t.id === ticketId
        ? { ...t, estado: 'nula', voidReason: reason, voidedBy, voidedAt }
        : t
    ))
    setAnularModal(null)
    setSelectedId(null)
    flash(lang === 'es' ? 'Factura anulada correctamente.' : 'Invoice voided successfully.')
  }

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">

      {/* ── Filter header ──────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-b border-slate-200">

        {/* Row 1: title + cashier + search */}
        <div className="flex items-center justify-between px-6 pt-4 pb-3 gap-4">
          <div>
            <h2 className="text-[16px] font-bold text-slate-800">{lang === 'es' ? 'Ventas / Facturas' : 'Sales / Invoices'}</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">{lang === 'es' ? 'Historial completo de transacciones' : 'Complete transaction history'}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Cashier dropdown */}
            <div className="relative">
              <select
                value={cashier}
                onChange={e => setCashier(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[12px] text-slate-700 focus:outline-none focus:border-sky-400 cursor-pointer"
              >
                <option value="all">{lang === 'es' ? 'Todos los cajeros' : 'All cashiers'}</option>
                {CASHIERS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={lang === 'es' ? 'Buscar cliente o # factura...' : 'Search client or invoice #...'}
                className="pl-8 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[12px] text-slate-700 focus:outline-none focus:border-sky-400 w-56 placeholder:text-slate-400"
              />
            </div>
          </div>
        </div>

        {/* Row 2: type tabs + date pills */}
        <div className="flex items-center justify-between px-6 pb-0">
          {/* Type tabs */}
          <div className="flex gap-0.5">
            {TAB_FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => setTab(f.id)}
                className={`flex items-center gap-2 px-3.5 py-2.5 text-[12px] font-medium border-b-2 -mb-px transition-colors ${
                  tab === f.id ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {lang === 'es' ? f.es : f.en}
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center ${
                  tab === f.id ? 'bg-sky-100 text-sky-600' : 'bg-slate-100 text-slate-400'
                }`}>
                  {tabCounts[f.id] ?? 0}
                </span>
              </button>
            ))}
          </div>

          {/* Date pills */}
          <div className="flex items-center gap-1.5 pb-2.5">
            {DATE_PILLS.map(p => (
              <button
                key={p.id}
                onClick={() => setDatePill(p.id)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                  datePill === p.id
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {lang === 'es' ? p.es : p.en}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Summary bar ────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex gap-3 px-6 py-3">
        <MetricCard icon={ReceiptText}      label={lang === 'es' ? 'Total Facturas'      : 'Total Invoices'}   value={summary.count}            accent="sky"    />
        <MetricCard icon={TrendingUp}       label={lang === 'es' ? 'Total Facturado'     : 'Total Billed'}     value={fmtRD(summary.total)}     accent="green"  />
        <MetricCard icon={CircleDollarSign} label="ITBIS Generado"                                             value={fmtRD(summary.itbis)}     accent="violet" />
        <MetricCard icon={Clock}            label={lang === 'es' ? 'CxC Pendiente'       : 'Pending A/R'}      value={fmtRD(summary.cxc)}       accent="amber"  />
        <MetricCard icon={Ban}              label={lang === 'es' ? 'Facturas Nulas'      : 'Voided Invoices'}  value={summary.nulas}            accent="red"    />
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-white mx-6 mb-3 rounded-2xl border border-slate-200 overflow-hidden">

        {/* Column headers */}
        <div className="flex items-center h-9 bg-slate-50 border-b border-slate-200 px-5 shrink-0">
          {COLS.map(col => (
            <div key={col.key} className={`${col.cls} text-[10px] font-bold text-slate-400 uppercase tracking-wider pr-4`}>
              {lang === 'es' ? col.es : col.en}
            </div>
          ))}
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-300 gap-2">
              <ReceiptText size={28} />
              <p className="text-[13px]">{lang === 'es' ? 'Sin resultados para este filtro' : 'No results for this filter'}</p>
            </div>
          ) : (
            visible.map(t => {
              const isSelected = t.id === selectedId
              const isNula     = t.estado === 'nula'
              const isCxC      = t.payMethod === 'credit' && !isNula
              const main       = t.services[0]
              const extra      = t.services.length - 1

              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}
                  className={`w-full flex items-center h-14 px-5 border-b border-slate-100 text-left transition-colors ${
                    isSelected ? 'bg-sky-50 border-l-2 border-l-sky-500'
                    : isNula   ? 'bg-red-50/60 hover:bg-red-50 border-l-2 border-l-transparent'
                    : isCxC    ? 'bg-amber-50/50 hover:bg-amber-50 border-l-2 border-l-transparent'
                    :            'bg-white hover:bg-slate-50 border-l-2 border-l-transparent'
                  }`}
                >
                  {/* # */}
                  <div className="w-[80px] shrink-0 pr-4">
                    <span className={`text-[13px] font-bold ${isNula ? 'text-red-400 line-through' : 'text-sky-600'}`}>{t.ticketNo}</span>
                  </div>

                  {/* Client / Vehicle */}
                  <div className="flex-1 min-w-0 pr-4">
                    <p className={`text-[12px] font-semibold truncate ${isNula ? 'text-slate-400' : 'text-slate-800'}`}>{t.client}</p>
                    <p className="text-[11px] text-slate-400 truncate">{t.vehicle}</p>
                  </div>

                  {/* Service(s) */}
                  <div className="w-[160px] shrink-0 pr-4 flex items-center gap-1.5 min-w-0">
                    <span className={`text-[12px] truncate ${isNula ? 'text-slate-400' : 'text-slate-700'}`}>{main.name}</span>
                    {extra > 0 && (
                      <span className="shrink-0 text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">+{extra}</span>
                    )}
                  </div>

                  {/* Cashier */}
                  <div className="w-[90px] shrink-0 pr-4">
                    <span className={`text-[12px] ${isNula ? 'text-slate-400' : 'text-slate-600'}`}>{t.cashier}</span>
                  </div>

                  {/* Date / Time */}
                  <div className="w-[120px] shrink-0 pr-4">
                    <p className={`text-[11px] ${isNula ? 'text-slate-400' : 'text-slate-700'}`}>{fmtDate(t.date)}</p>
                    <p className="text-[10px] text-slate-400">{fmtTime(t.date)}</p>
                  </div>

                  {/* Subtotal */}
                  <div className="w-[96px] shrink-0 pr-4 text-right">
                    <span className={`text-[12px] ${isNula ? 'text-slate-400 line-through' : 'text-slate-600'}`}>{fmtRD(t.subtotal)}</span>
                  </div>

                  {/* ITBIS */}
                  <div className="w-[84px] shrink-0 pr-4 text-right">
                    <span className={`text-[12px] ${isNula ? 'text-slate-400 line-through' : 'text-slate-500'}`}>{fmtRD(t.itbis)}</span>
                  </div>

                  {/* Total */}
                  <div className="w-[104px] shrink-0 pr-4 text-right">
                    <span className={`text-[13px] font-bold ${isNula ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{fmtRD(t.total)}</span>
                  </div>

                  {/* Estado */}
                  <div className="w-[108px] shrink-0">
                    <EstadoBadge t={t} lang={lang} />
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* ── Row count footer ── */}
        <div className="shrink-0 border-t border-slate-100 px-5 py-2 flex items-center justify-between bg-slate-50/50">
          <span className="text-[11px] text-slate-400">
            {visible.length} {lang === 'es' ? 'registros' : 'records'}
            {search && ` · ${lang === 'es' ? 'filtrado por' : 'filtered by'} "${search}"`}
          </span>
          <span className="text-[11px] font-semibold text-slate-600">
            {lang === 'es' ? 'Total visible' : 'Visible total'}: {fmtRD(visible.filter(t => t.estado !== 'nula').reduce((s, t) => s + t.total, 0))}
          </span>
        </div>
      </div>

      {/* ── Bottom action bar (when row selected) ─────────────────────────── */}
      {selectedTicket && (
        <div className="shrink-0 bg-white border-t border-slate-200 px-6 py-3 flex items-center gap-4">
          <button onClick={() => setSelectedId(null)} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <X size={15} />
          </button>
          <div className="flex-1 min-w-0">
            <span className="text-[13px] font-bold text-sky-600">{selectedTicket.ticketNo}</span>
            <span className="text-[13px] text-slate-500 ml-2">{selectedTicket.vehicle}</span>
            <span className="text-[13px] font-semibold text-slate-800 ml-3">{fmtRD(selectedTicket.total)}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setDetailModal(selectedTicket)}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-xl text-[12px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Eye size={13} />
              {lang === 'es' ? 'Ver Detalle' : 'View Detail'}
            </button>
            <button
              onClick={() => console.log('[REPRINT]', selectedTicket.ticketNo)}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-xl text-[12px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Printer size={13} />
              {lang === 'es' ? 'Reimprimir' : 'Reprint'}
            </button>
            <button
              onClick={() => selectedTicket.estado !== 'nula' && setAnularModal(selectedTicket)}
              disabled={selectedTicket.estado === 'nula'}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                selectedTicket.estado === 'nula'
                  ? 'bg-slate-50 text-slate-300 cursor-not-allowed border border-slate-100'
                  : 'bg-red-50 hover:bg-red-100 border border-red-200 text-red-600'
              }`}
            >
              <Ban size={13} />
              {lang === 'es' ? 'Anular Factura' : 'Void Invoice'}
            </button>
          </div>
        </div>
      )}

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 right-6 flex items-center gap-2.5 bg-slate-800 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-xl z-50">
          <CheckCircle2 size={15} className="text-green-400 shrink-0" />
          {toast}
        </div>
      )}

      {/* ── Detail modal ────────────────────────────────────────────────────── */}
      {detailModal && (
        <DetailModal
          ticket={detailModal}
          onClose={() => setDetailModal(null)}
          lang={lang}
        />
      )}

      {/* ── Anular modal ─────────────────────────────────────────────────────── */}
      {anularModal && (
        <AnularModal
          ticket={anularModal}
          onConfirm={handleVoid}
          onClose={() => setAnularModal(null)}
          lang={lang}
        />
      )}
    </div>
  )
}
