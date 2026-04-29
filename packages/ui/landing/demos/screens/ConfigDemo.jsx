// ConfigDemo — faithful copy of Config.jsx render. Section grid that opens
// detail panels for: Negocio, NCF/e-CF, Impresora, WhatsApp, Comisiones,
// Sincronización, Membresías, Pedidos Ya, Plan & Facturación, Equipo.

import { useState } from 'react'
import { Building2, Receipt, Printer, MessageSquare, PiggyBank, Cloud, Crown, Truck, Package as PackageIcon, KeyRound, Users, Settings, ChevronRight, Check, X, Edit2, Upload, AlertCircle, Shield } from 'lucide-react'

const SECTIONS = [
  { id: 'business',  icon: Building2,    title: 'Negocio',         desc: 'RNC, dirección, teléfono, logo, horario, ciudad, ITBIS' },
  { id: 'ncf',       icon: Receipt,      title: 'NCF / e-CF',      desc: 'Secuencias, certificado Viafirma, ANECF, ambiente DGII' },
  { id: 'printer',   icon: Printer,      title: 'Impresora',       desc: 'Impresora térmica 80mm + cajón de dinero + variantes drawer-kick' },
  { id: 'whatsapp',  icon: MessageSquare, title: 'WhatsApp',       desc: 'Plantillas de recibo, recordatorios, listo para servir, vencimientos' },
  { id: 'commissions',icon: PiggyBank,    title: 'Comisiones',      desc: 'Por servicio, por lavador/cajera/vendedor, reglas de split' },
  { id: 'sync',      icon: Cloud,        title: 'Sincronización',  desc: 'Cada 5 min · cola offline 72h · backup nightly 3 AM' },
  { id: 'memberships', icon: Crown,      title: 'Membresías',      desc: '3 planes activos · débito automático · 27 miembros' },
  { id: 'pedidosya', icon: Truck,        title: 'Pedidos Ya',      desc: 'Canal pink toggle · precios PY · comisión 15% deducida' },
  { id: 'plan',      icon: Crown,        title: 'Plan & Facturación', desc: 'Pro MAX · próximo cobro 15 may · 7 días gratis activo' },
  { id: 'team',      icon: Users,        title: 'Equipo',          desc: 'Acceso admin remoto · roles · auditoría' },
  { id: 'security',  icon: Shield,       title: 'Seguridad',       desc: 'PINs, Manager Auth Card, sesiones activas, 2FA' },
  { id: 'license',   icon: KeyRound,     title: 'Licencia',        desc: 'TXL-XXXX-XXXX-XXXX · vinculada a este equipo · transferir' },
]

function BusinessPanel() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <label className="block col-span-2"><span className="text-xs font-semibold text-slate-500">Nombre comercial</span><input defaultValue="Studio X Car Wash" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-sky-400 outline-none" /></label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">RNC</span><input defaultValue="133-41032-1" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:border-sky-400 outline-none" /></label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Razón Social</span><input defaultValue="Studio X SRL" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-sky-400 outline-none" /></label>
        <label className="block col-span-2"><span className="text-xs font-semibold text-slate-500">Dirección</span><input defaultValue="Av. 27 de Febrero #245, Santo Domingo" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-sky-400 outline-none" /></label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Teléfono</span><input defaultValue="809-555-0123" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-sky-400 outline-none" /></label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Email</span><input defaultValue="contacto@studioxcw.do" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-sky-400 outline-none" /></label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Ciudad</span><input defaultValue="Santo Domingo" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-sky-400 outline-none" /></label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">ITBIS %</span><input type="number" defaultValue={18} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:border-sky-400 outline-none" /></label>
      </div>
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Logo</p>
        <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center"><Upload size={28} className="mx-auto text-slate-400" /><p className="text-sm text-slate-500 mt-2">Arrastra una imagen o clic para subir</p></div>
      </div>
    </div>
  )
}

function NcfPanel() {
  return (
    <div className="space-y-4">
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 inline-flex items-center gap-2 w-full">
        <Check size={16} className="text-emerald-700" />
        <span className="text-sm font-bold text-emerald-900">Certificado Viafirma activo · vence 15 mar 2027 · auto-renovación</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block col-span-2"><span className="text-xs font-semibold text-slate-500">Ambiente DGII</span>
          <select defaultValue="produccion" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="produccion">PRODUCCIÓN (e-CF reales)</option>
            <option value="certecf">Pre-certificación</option>
          </select>
        </label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Solicitud DGII #</span><input defaultValue="42483" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" /></label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Modo de facturación</span>
          <select defaultValue="ecf" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="ecf">e-CF (Ley 32-23)</option>
            <option value="ncf">NCF papel (legado)</option>
            <option value="hybrid">Híbrido (default e-CF, fallback NCF)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 col-span-2 text-sm text-slate-700"><input type="checkbox" defaultChecked className="accent-[#b3001e]" /> Cola offline 72h con IndicadorEnvioDiferido=1</label>
        <label className="flex items-center gap-2 col-span-2 text-sm text-slate-700"><input type="checkbox" defaultChecked className="accent-[#b3001e]" /> Avisar 30 días antes del vencimiento del certificado</label>
        <label className="flex items-center gap-2 col-span-2 text-sm text-slate-700"><input type="checkbox" defaultChecked className="accent-[#b3001e]" /> ANECF automático al anular comprobantes</label>
      </div>
    </div>
  )
}

function PrinterPanel() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block col-span-2"><span className="text-xs font-semibold text-slate-500">Impresora térmica</span>
          <select defaultValue="usb-1" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="usb-1">2connect USB v6 (USB Port 1)</option>
            <option value="lan">2connect v10 LAN (192.168.1.45)</option>
          </select>
        </label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Ancho de papel</span>
          <select defaultValue="80" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="80">80mm (42 chars/línea)</option>
            <option value="58">58mm (32 chars/línea)</option>
          </select>
        </label>
        <label className="block"><span className="text-xs font-semibold text-slate-500">Code Page</span><input defaultValue="858 (Latín)" disabled className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 font-mono" /></label>
      </div>
      <div className="border-t border-slate-200 pt-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Cajón de dinero (drawer-kick)</p>
        <p className="text-[12px] text-slate-600 mb-3">Variante extraída por captura del POS anterior del cliente (técnica universal de onboarding).</p>
        <div className="grid grid-cols-3 gap-2">
          {[
            { id: 'std',     label: 'Estándar ESC/POS', test: 'Probar' },
            { id: 'starsisa-1', label: 'StarSISA Pulse #1', test: 'Probar' },
            { id: 'starsisa-2', label: 'StarSISA Pulse #2', test: 'Probar' },
          ].map(v => (
            <button key={v.id} className="border border-slate-200 hover:border-[#b3001e] rounded-lg p-3 text-left">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-700">{v.label}</p>
              <p className="text-[10px] text-[#b3001e] mt-1">{v.test} ›</p>
            </button>
          ))}
        </div>
      </div>
      <div className="border-t border-slate-200 pt-4 space-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" defaultChecked className="accent-[#b3001e]" /> Imprimir factura automático al cobrar</label>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" defaultChecked className="accent-[#b3001e]" /> Imprimir conduce de servicio a lavadores</label>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="accent-[#b3001e]" /> Imprimir copia para el negocio</label>
      </div>
    </div>
  )
}

function WhatsappPanel() {
  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2"><AlertCircle size={14} className="text-amber-700 mt-0.5" /><span className="text-xs text-amber-900">Pro MAX requiere aprobación WABA. Mientras tanto, los enlaces wa.me funcionan inmediatamente.</span></div>
      <label className="block"><span className="text-xs font-semibold text-slate-500">Plantilla recibo de cobro</span>
        <textarea rows={3} defaultValue="Hola {{cliente}}, gracias por tu visita a {{negocio}}. Tu factura {{ncf}} por {{total}} ya está disponible: {{link}}" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:border-sky-400 outline-none resize-none" />
      </label>
      <label className="block"><span className="text-xs font-semibold text-slate-500">Plantilla "Vehículo listo"</span>
        <textarea rows={3} defaultValue="¡{{cliente}}, tu {{vehiculo}} ({{placa}}) está listo! Te esperamos en {{negocio}}." className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:border-sky-400 outline-none resize-none" />
      </label>
      <label className="block"><span className="text-xs font-semibold text-slate-500">Plantilla recordatorio cita</span>
        <textarea rows={3} defaultValue="Hola {{cliente}}, te recordamos tu cita {{fecha}} {{hora}} en {{negocio}}. Confirma con un mensaje." className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:border-sky-400 outline-none resize-none" />
      </label>
    </div>
  )
}

function CommissionsPanel() {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-slate-700">Reglas de comisión por categoría de servicio. Aplica a todos los lavadores activos.</p>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
            <tr><th className="text-left px-3 py-2 font-bold">Categoría</th><th className="text-right px-3 py-2 font-bold">% Default</th><th className="text-right px-3 py-2 font-bold">Override</th></tr>
          </thead>
          <tbody>
            {[
              { name: 'Lavados',    pct: 30 },
              { name: 'Detallado',  pct: 35 },
              { name: 'Interior',   pct: 35 },
              { name: 'Especial',   pct: 30 },
              { name: 'Productos',  pct: 10 },
            ].map((c, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-2.5 font-semibold text-slate-800">{c.name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{c.pct}%</td>
                <td className="px-3 py-2.5 text-right"><input type="number" defaultValue={c.pct} className="w-20 border border-slate-200 rounded px-2 py-1 text-right tabular-nums" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700 pt-2"><input type="checkbox" defaultChecked className="accent-[#b3001e]" /> Permitir split entre múltiples lavadores</label>
      <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" defaultChecked className="accent-[#b3001e]" /> Aplicar % sobre subtotal (ex-ITBIS)</label>
      <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="accent-[#b3001e]" /> Cajera autorizada a sobreescribir comisión por ticket</label>
    </div>
  )
}

function SyncPanel() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4"><p className="text-[10px] uppercase tracking-wider text-emerald-700">Estado</p><p className="text-lg font-bold text-emerald-900 inline-flex items-center gap-1"><Check size={14} /> Sincronizado</p></div>
        <div className="bg-white border border-slate-200 rounded-xl p-4"><p className="text-[10px] uppercase tracking-wider text-slate-400">Última sync</p><p className="text-lg font-bold text-slate-800">hace 2 min</p></div>
        <div className="bg-white border border-slate-200 rounded-xl p-4"><p className="text-[10px] uppercase tracking-wider text-slate-400">Cola pendiente</p><p className="text-lg font-bold text-slate-800">0 tickets</p></div>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-slate-600">Frecuencia automática</span><span className="font-bold">Cada 5 min</span></div>
        <div className="flex justify-between"><span className="text-slate-600">Cola offline máxima</span><span className="font-bold">72 horas</span></div>
        <div className="flex justify-between"><span className="text-slate-600">Backup nightly</span><span className="font-bold">3:00 AM · 14 días retención</span></div>
        <div className="flex justify-between"><span className="text-slate-600">Encriptación local</span><span className="font-bold inline-flex items-center gap-1"><Shield size={12} /> SQLCipher AES-256</span></div>
      </div>
      <button className="px-4 py-2 bg-black text-white rounded-lg text-sm font-bold hover:bg-slate-800 inline-flex items-center gap-2"><Cloud size={14} /> Sincronizar ahora</button>
    </div>
  )
}

const PANEL_BY_ID = {
  business: BusinessPanel,
  ncf: NcfPanel,
  printer: PrinterPanel,
  whatsapp: WhatsappPanel,
  commissions: CommissionsPanel,
  sync: SyncPanel,
}

export default function ConfigDemo() {
  const [active, setActive] = useState(null)

  if (active) {
    const section = SECTIONS.find(s => s.id === active)
    const Panel = PANEL_BY_ID[active]
    return (
      <div className="p-6 max-w-4xl mx-auto h-full overflow-y-auto bg-white">
        <button onClick={() => setActive(null)} className="text-sm text-slate-500 hover:underline mb-4">← Volver a Configuración</button>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-[#b3001e]/10 flex items-center justify-center"><section.icon size={22} className="text-[#b3001e]" /></div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{section.title}</h1>
            <p className="text-sm text-slate-500">{section.desc}</p>
          </div>
        </div>
        {Panel ? <Panel /> : (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-10 text-center">
            <Settings size={36} className="mx-auto text-slate-300 mb-3" />
            <p className="text-sm text-slate-500">Panel detallado disponible en el sistema completo.</p>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-6 pt-6 border-t border-slate-200">
          <button onClick={() => setActive(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50">Cancelar</button>
          <button onClick={() => setActive(null)} className="px-4 py-2 bg-[#b3001e] text-white rounded-lg text-sm font-bold hover:bg-[#8c0017]">Guardar cambios</button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto h-full overflow-y-auto bg-white">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 inline-flex items-center gap-3"><Settings size={24} className="text-[#b3001e]" /> Configuración</h1>
        <p className="text-sm text-slate-500 mt-1">Tu equipo lo configura por ti remotamente con Pro PLUS y Pro MAX</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {SECTIONS.map(s => {
          const Icon = s.icon
          return (
            <button key={s.id} onClick={() => setActive(s.id)} className="bg-white rounded-2xl border border-slate-200 p-5 text-left hover:border-[#b3001e] hover:shadow-md transition-all group">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-[#b3001e]/10 flex items-center justify-center group-hover:bg-[#b3001e]/20"><Icon size={18} className="text-[#b3001e]" /></div>
                <ChevronRight size={14} className="text-slate-300 group-hover:text-[#b3001e]" />
              </div>
              <p className="font-bold text-slate-800 text-[14px]">{s.title}</p>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{s.desc}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
