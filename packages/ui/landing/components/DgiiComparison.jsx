import { useNavigate } from 'react-router-dom'
import { Check, X, ArrowRight } from 'lucide-react'

// DgiiComparison — head-to-head capability table.
// Self-contained. Accepts `lang` prop ("es" | "en"). Default "es".

const ROWS = {
  es: [
    { cap: 'e-CFs/mes', dgii: '150 (cap puede cambiar por aviso)', tx: '50 + RD$15/extra (sin tope)' },
    { cap: 'Tipos e-CF', dgii: 'Limitado', tx: 'E31 / E32 / E33 / E34 / E43 / ANECF' },
    { cap: 'API / integraciones', dgii: false, tx: 'REST + webhooks' },
    { cap: 'App móvil', dgii: false, tx: 'PWA iOS + Android' },
    { cap: 'WhatsApp envío automático', dgii: false, tx: 'Post-cobro' },
    { cap: 'Modo offline 72h', dgii: 'Manual en Oficina Virtual', tx: 'Cola automática' },
    { cap: 'Multi-moneda', dgii: 'DOP solo', tx: 'DOP + USD' },
    { cap: 'Multi-usuario', dgii: false, tx: '5 roles (owner/manager/CFO/accountant/cashier)' },
    { cap: 'Formato 606 (compras)', dgii: 'Manual', tx: 'TXT 1 click' },
    { cap: 'Formato 607 (ventas)', dgii: 'Manual', tx: 'TXT 1 click' },
    { cap: 'RNC lookup 900K', dgii: false, tx: 'Local + megaplus.com.do fallback' },
    { cap: 'Validar Certificado nonce', dgii: false, tx: 'Automático' },
    { cap: 'Soporte', dgii: 'Tickets DGII', tx: 'WhatsApp + remoto' },
    { cap: 'Configuración', dgii: 'Manual', tx: 'Remota por nuestro equipo' },
  ],
  en: [
    { cap: 'e-CFs/month', dgii: '150 (cap may change via notice)', tx: '50 + RD$15/extra (no ceiling)' },
    { cap: 'e-CF types', dgii: 'Limited', tx: 'E31 / E32 / E33 / E34 / E43 / ANECF' },
    { cap: 'API / integrations', dgii: false, tx: 'REST + webhooks' },
    { cap: 'Mobile app', dgii: false, tx: 'PWA iOS + Android' },
    { cap: 'Auto WhatsApp delivery', dgii: false, tx: 'Post-checkout' },
    { cap: 'Offline mode 72h', dgii: 'Manual in Oficina Virtual', tx: 'Auto queue' },
    { cap: 'Multi-currency', dgii: 'DOP only', tx: 'DOP + USD' },
    { cap: 'Multi-user', dgii: false, tx: '5 roles (owner/manager/CFO/accountant/cashier)' },
    { cap: 'Format 606 (purchases)', dgii: 'Manual', tx: '1-click TXT export' },
    { cap: 'Format 607 (sales)', dgii: 'Manual', tx: '1-click TXT export' },
    { cap: 'RNC lookup 900K', dgii: false, tx: 'Local + megaplus.com.do fallback' },
    { cap: 'Validar Certificado nonce', dgii: false, tx: 'Automatic' },
    { cap: 'Support', dgii: 'DGII tickets', tx: 'WhatsApp + remote' },
    { cap: 'Setup', dgii: 'Manual', tx: 'Remote by our team' },
  ],
}

const HEAD = {
  es: {
    eyebrow: 'COMPARACIÓN DIRECTA',
    title: 'Cuando 150 facturas al mes no alcanzan',
    sub: 'Misma compliance Ley 32-23. Capacidades diferentes.',
    colA: 'Capacidad',
    colB: 'DGII Gratuito',
    colC: 'Terminal X Facturación',
    cta: 'Empezar con Facturación · 7 días gratis',
  },
  en: {
    eyebrow: 'HEAD-TO-HEAD',
    title: 'When 150 invoices a month is not enough',
    sub: 'Same Law 32-23 compliance. Very different capabilities.',
    colA: 'Capability',
    colB: 'DGII Free Invoicer',
    colC: 'Terminal X Invoicing',
    cta: 'Start with Invoicing · 7 days free',
  },
}

function Cell({ value, isCrimson }) {
  if (value === false) {
    return (
      <span className="inline-flex items-center justify-center">
        <X size={18} className={isCrimson ? 'text-[#b3001e]/50' : 'text-black/30'} />
      </span>
    )
  }
  if (value === true) {
    return (
      <span className="inline-flex items-center justify-center">
        <Check size={18} className="text-[#b3001e]" />
      </span>
    )
  }
  return <span className="text-sm leading-snug">{value}</span>
}

export default function DgiiComparison({ lang = 'es' }) {
  const navigate = useNavigate()
  const rows = ROWS[lang] || ROWS.es
  const t = HEAD[lang] || HEAD.es

  return (
    <section id="dgii-comparison" className="relative bg-white text-black py-20 md:py-28 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12 md:mb-16">
          <p className="text-[11px] font-extrabold tracking-[3px] text-[#b3001e] mb-3">{t.eyebrow}</p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight leading-tight text-black">{t.title}</h2>
          <p className="mt-4 text-black/60 text-base sm:text-lg max-w-2xl mx-auto">{t.sub}</p>
        </div>

        {/* Desktop / md+ table */}
        <div className="hidden md:block rounded-2xl overflow-hidden border border-black/10">
          <div className="grid grid-cols-12 bg-black/[0.03] border-b border-black/10">
            <div className="col-span-4 px-6 py-4 text-[11px] font-extrabold tracking-[2px] uppercase text-black/60">{t.colA}</div>
            <div className="col-span-4 px-6 py-4 text-[11px] font-extrabold tracking-[2px] uppercase text-black/60 border-l border-black/10">{t.colB}</div>
            <div className="col-span-4 px-6 py-4 text-[11px] font-extrabold tracking-[2px] uppercase text-white border-l border-[#b3001e]/40 bg-[#b3001e]">{t.colC}</div>
          </div>
          {rows.map((row, i) => (
            <div key={i} className={`grid grid-cols-12 border-b border-black/5 ${i % 2 === 0 ? '' : 'bg-black/[0.02]'}`}>
              <div className="col-span-4 px-6 py-4 text-sm font-semibold text-black">{row.cap}</div>
              <div className="col-span-4 px-6 py-4 text-sm text-black/55 bg-black/[0.02] border-l border-black/10 flex items-center">
                <Cell value={row.dgii} isCrimson={false} />
              </div>
              <div className="col-span-4 px-6 py-4 text-sm text-black border-l border-[#b3001e]/40 bg-[#b3001e]/[0.08] flex items-center">
                <Cell value={row.tx} isCrimson={true} />
              </div>
            </div>
          ))}
        </div>

        {/* Mobile stacked cards */}
        <div className="md:hidden space-y-4">
          {rows.map((row, i) => (
            <div key={i} className="rounded-xl border border-black/10 overflow-hidden">
              <div className="px-4 py-3 bg-black/[0.03] text-sm font-bold text-black">{row.cap}</div>
              <div className="grid grid-cols-2 divide-x divide-black/10">
                <div className="px-4 py-3 bg-black/[0.02]">
                  <p className="text-[10px] font-extrabold tracking-[2px] uppercase text-black/60 mb-1.5">{t.colB}</p>
                  <div className="text-sm text-black/60"><Cell value={row.dgii} isCrimson={false} /></div>
                </div>
                <div className="px-4 py-3 bg-[#b3001e]/[0.08]">
                  <p className="text-[10px] font-extrabold tracking-[2px] uppercase text-[#b3001e] mb-1.5">{t.colC}</p>
                  <div className="text-sm text-black"><Cell value={row.tx} isCrimson={true} /></div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center">
          <button
            onClick={() => navigate('/signup?plan=facturacion')}
            className="group inline-flex items-center gap-2 bg-[#b3001e] hover:bg-[#d4002a] text-white font-bold px-8 py-4 rounded-xl shadow-xl shadow-[#b3001e]/25 transition-all hover:scale-[1.02]"
          >
            {t.cta}
            <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </div>
    </section>
  )
}
