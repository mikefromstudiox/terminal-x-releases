import { useState, useEffect } from 'react'
import { Loader2, Save, Check, MessageSquare, Receipt, Settings, Printer, Users, FileText, Palette } from 'lucide-react'
import { useLang } from '../../i18n'

const SERVICE_TEMPLATES = {
  carwash: {
    label: { es: 'Lavadero de Autos', en: 'Car Wash' },
    services: [
      { name: 'Lavado Simple', name_en: 'Basic Wash', price: 300, is_wash: true, aplica_itbis: true },
      { name: 'Lavado Completo', name_en: 'Full Wash', price: 500, is_wash: true, aplica_itbis: true },
      { name: 'Encerado', name_en: 'Wax', price: 800, is_wash: true, aplica_itbis: true },
      { name: 'Interior Profundo', name_en: 'Deep Interior', price: 1200, is_wash: true, aplica_itbis: true },
      { name: 'Ceramico', name_en: 'Ceramic Coating', price: 5000, is_wash: true, aplica_itbis: true },
      { name: 'Motor', name_en: 'Engine Wash', price: 600, is_wash: true, aplica_itbis: true },
      { name: 'Agua', name_en: 'Water', price: 50, is_wash: false, aplica_itbis: true },
      { name: 'Refresco', name_en: 'Soda', price: 75, is_wash: false, aplica_itbis: true },
    ],
  },
  mechanic: {
    label: { es: 'Taller Mecanico', en: 'Mechanic Shop' },
    services: [
      { name: 'Cambio de Aceite', name_en: 'Oil Change', price: 1500, is_wash: false, aplica_itbis: true },
      { name: 'Alineacion', name_en: 'Alignment', price: 2000, is_wash: false, aplica_itbis: true },
      { name: 'Balanceo', name_en: 'Balancing', price: 800, is_wash: false, aplica_itbis: true },
      { name: 'Frenos', name_en: 'Brakes', price: 3500, is_wash: false, aplica_itbis: true },
      { name: 'Diagnostico', name_en: 'Diagnostic', price: 1000, is_wash: false, aplica_itbis: true },
      { name: 'Bateria', name_en: 'Battery', price: 4500, is_wash: false, aplica_itbis: true },
    ],
  },
  dealer: {
    label: { es: 'Car Dealer / Importadora', en: 'Car Dealer' },
    services: [
      { name: 'Detailing Completo', name_en: 'Full Detail', price: 8000, is_wash: true, aplica_itbis: true },
      { name: 'Tint Ventanas', name_en: 'Window Tint', price: 5000, is_wash: false, aplica_itbis: true },
      { name: 'PPF (Paint Protection)', name_en: 'PPF', price: 25000, is_wash: false, aplica_itbis: true },
      { name: 'Ceramico Pro', name_en: 'Pro Ceramic', price: 15000, is_wash: false, aplica_itbis: true },
      { name: 'Pulido', name_en: 'Polish', price: 3000, is_wash: false, aplica_itbis: true },
    ],
  },
}

export default function ConfigEditor({ businessId, getToken, onRefresh, isDark }) {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [pushingTemplate, setPushingTemplate] = useState('')

  // Business settings
  const [fiscalMode, setFiscalMode] = useState('b_series')
  const [itbisPct, setItbisPct] = useState('18')
  const [leyPct, setLeyPct] = useState('10')
  const [usdRate, setUsdRate] = useState('61.00')
  const [bizLanguage, setBizLanguage] = useState('es')

  // WhatsApp
  const [waInstance, setWaInstance] = useState('')
  const [waToken, setWaToken] = useState('')

  // Printer
  const [printerName, setPrinterName] = useState('')
  const [printerWidth, setPrinterWidth] = useState('80')

  // Features
  const [features, setFeatures] = useState({})

  // Notes
  const [notes, setNotes] = useState('')

  useEffect(() => { load() }, [businessId])

  async function load() {
    setLoading(true)
    try {
      const resp = await fetch(`/api/panel?action=client_config&id=${businessId}`, {
        headers: { 'Authorization': `Bearer ${getToken()}` },
      })
      if (!resp.ok) throw new Error('Failed')
      const { data } = await resp.json()
      const biz = data.bizSettings || {}
      const app = data.appSettings || {}
      setFiscalMode(biz.facturacion_mode || app.fiscal_mode || 'b_series')
      setItbisPct(String(biz.itbis_pct ?? app.itbis_pct ?? '18'))
      setLeyPct(String(biz.ley_pct ?? app.ley_pct ?? '10'))
      setUsdRate(app.usd_rate || '61.00')
      setBizLanguage(biz.language || 'es')
      setWaInstance(app.whatsapp_instance || '')
      setWaToken(app.whatsapp_token || '')
      setPrinterName(app.printer_name || '')
      setPrinterWidth(app.printer_width || '80')
      setFeatures(biz.feature_overrides || {})
      setNotes(data.notes || '')
    } catch {}
    setLoading(false)
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await fetch('/api/panel?action=client_config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify({
          id: businessId,
          bizSettings: {
            facturacion_mode: fiscalMode,
            itbis_pct: parseFloat(itbisPct) || 18,
            ley_pct: parseFloat(leyPct) || 10,
            language: bizLanguage,
            feature_overrides: features,
          },
          appSettings: {
            fiscal_mode: fiscalMode === 'ecf' ? 'ecf' : 'legacy',
            itbis_pct: itbisPct,
            ley_pct: leyPct,
            usd_rate: usdRate,
            whatsapp_instance: waInstance,
            whatsapp_token: waToken,
            printer_name: printerName,
            printer_width: printerWidth,
          },
          notes,
        }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onRefresh?.()
    } catch {}
    setSaving(false)
  }

  async function pushTemplate(templateKey) {
    setPushingTemplate(templateKey)
    try {
      const template = SERVICE_TEMPLATES[templateKey]
      if (!template) return
      const token = getToken()
      for (const svc of template.services) {
        await fetch('/api/panel?action=push_service', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ business_id: businessId, ...svc }),
        })
      }
      onRefresh?.()
    } catch {}
    setPushingTemplate('')
  }

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-slate-400" size={18} /></div>

  const card = `rounded-xl p-4 ${isDark ? 'bg-white/5 border border-white/10' : 'bg-slate-50 border border-slate-200'}`
  const sectionTitle = `text-[12px] font-bold uppercase tracking-wider mb-3 flex items-center gap-2 ${isDark ? 'text-white/40' : 'text-slate-400'}`
  const labelCls = `text-[11px] font-semibold mb-1 ${isDark ? 'text-white/50' : 'text-slate-500'}`
  const inputCls = `w-full px-3 py-2 rounded-lg text-[13px] outline-none transition-colors ${isDark ? 'bg-zinc-800 border border-zinc-700 text-white focus:border-[#b3001e]' : 'bg-white border border-slate-200 text-slate-800 focus:border-[#b3001e]'}`
  const selectCls = inputCls

  return (
    <div className="space-y-4">
      {/* Fiscal */}
      <div className={card}>
        <p className={sectionTitle}><Receipt size={13} /> {L('Fiscal', 'Fiscal')}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className={labelCls}>{L('Modo', 'Mode')}</p>
            <select value={fiscalMode} onChange={e => setFiscalMode(e.target.value)} className={selectCls}>
              <option value="b_series">B01/B02 (Papel)</option>
              <option value="ecf">e-CF (Electronico)</option>
            </select>
          </div>
          <div>
            <p className={labelCls}>{L('Idioma', 'Language')}</p>
            <select value={bizLanguage} onChange={e => setBizLanguage(e.target.value)} className={selectCls}>
              <option value="es">Espanol</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <p className={labelCls}>ITBIS %</p>
            <input type="number" value={itbisPct} onChange={e => setItbisPct(e.target.value)} className={inputCls} />
          </div>
          <div>
            <p className={labelCls}>{L('Ley 10%', 'Law 10%')}</p>
            <input type="number" value={leyPct} onChange={e => setLeyPct(e.target.value)} className={inputCls} />
          </div>
          <div>
            <p className={labelCls}>{L('Tasa USD', 'USD Rate')}</p>
            <input type="number" value={usdRate} onChange={e => setUsdRate(e.target.value)} className={inputCls} />
          </div>
        </div>
      </div>

      {/* WhatsApp */}
      <div className={card}>
        <p className={sectionTitle}><MessageSquare size={13} /> WhatsApp (UltraMsg)</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className={labelCls}>Instance ID</p>
            <input value={waInstance} onChange={e => setWaInstance(e.target.value)} placeholder="instance123456" className={inputCls} />
          </div>
          <div>
            <p className={labelCls}>Token</p>
            <input value={waToken} onChange={e => setWaToken(e.target.value)} placeholder="abc123token" className={inputCls} />
          </div>
        </div>
        <p className={`text-[10px] mt-2 ${isDark ? 'text-white/20' : 'text-slate-300'}`}>
          {L('El cliente necesita su propia cuenta UltraMsg con su numero de WhatsApp Business.', 'Client needs their own UltraMsg account with their WhatsApp Business number.')}
        </p>
      </div>

      {/* Printer */}
      <div className={card}>
        <p className={sectionTitle}><Printer size={13} /> {L('Impresora', 'Printer')}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className={labelCls}>{L('Nombre', 'Name')}</p>
            <input value={printerName} onChange={e => setPrinterName(e.target.value)} placeholder="POS-80" className={inputCls} />
          </div>
          <div>
            <p className={labelCls}>{L('Ancho (mm)', 'Width (mm)')}</p>
            <select value={printerWidth} onChange={e => setPrinterWidth(e.target.value)} className={selectCls}>
              <option value="80">80mm</option>
              <option value="58">58mm</option>
            </select>
          </div>
        </div>
      </div>

      {/* Feature Overrides */}
      <div className={card}>
        <p className={sectionTitle}><Settings size={13} /> {L('Funciones', 'Features')}</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: 'inventory', es: 'Inventario', en: 'Inventory' },
            { key: 'credits', es: 'Creditos', en: 'Credits' },
            { key: 'credit_notes', es: 'Notas de Credito', en: 'Credit Notes' },
            { key: 'commissions', es: 'Comisiones', en: 'Commissions' },
            { key: 'cash_recon', es: 'Cuadre de Caja', en: 'Cash Recon' },
            { key: 'petty_cash', es: 'Caja Chica', en: 'Petty Cash' },
            { key: 'reports', es: 'Reportes Avanzados', en: 'Advanced Reports' },
            { key: 'ecf', es: 'e-CF Electronico', en: 'e-CF Electronic' },
            { key: 'whatsapp_receipts', es: 'Recibos WhatsApp', en: 'WhatsApp Receipts' },
            { key: 'remote_dashboard', es: 'Dashboard Remoto', en: 'Remote Dashboard' },
          ].map(f => (
            <label key={f.key} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[12px] ${isDark ? 'hover:bg-white/5' : 'hover:bg-slate-100'}`}>
              <input type="checkbox" checked={features[f.key] !== false}
                onChange={e => setFeatures(prev => ({ ...prev, [f.key]: e.target.checked }))}
                className="accent-[#b3001e]" />
              <span className={isDark ? 'text-white/70' : 'text-slate-600'}>{lang === 'es' ? f.es : f.en}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Service Templates */}
      <div className={card}>
        <p className={sectionTitle}><Palette size={13} /> {L('Plantillas de Servicios', 'Service Templates')}</p>
        <p className={`text-[11px] mb-3 ${isDark ? 'text-white/30' : 'text-slate-400'}`}>
          {L('Agrega servicios predeterminados al negocio del cliente.', 'Push preset services to the client\'s business.')}
        </p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(SERVICE_TEMPLATES).map(([key, tpl]) => (
            <button key={key} onClick={() => pushTemplate(key)} disabled={!!pushingTemplate}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold border transition-colors disabled:opacity-50 ${isDark ? 'border-white/10 text-white/60 hover:bg-white/5' : 'border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
              {pushingTemplate === key ? <Loader2 size={12} className="animate-spin" /> : <Palette size={12} />}
              {lang === 'es' ? tpl.label.es : tpl.label.en}
              <span className={`text-[10px] ${isDark ? 'text-white/30' : 'text-slate-400'}`}>({tpl.services.length})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className={card}>
        <p className={sectionTitle}><FileText size={13} /> {L('Notas Internas', 'Internal Notes')}</p>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder={L('Notas sobre este cliente...', 'Notes about this client...')}
          className={`${inputCls} resize-none`} />
      </div>

      {/* Save */}
      <button onClick={handleSave} disabled={saving}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#b3001e] hover:bg-[#8c0017] text-white text-[13px] font-bold rounded-xl disabled:opacity-50 transition-colors">
        {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
        {saving ? L('Guardando...', 'Saving...') : saved ? L('Guardado', 'Saved') : L('Guardar Configuracion', 'Save Configuration')}
      </button>
    </div>
  )
}
