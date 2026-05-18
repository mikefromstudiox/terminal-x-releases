import { useState, useEffect } from 'react'
import { Loader2, Save, Check, MessageSquare, Receipt, Settings, Printer, Users, FileText, Palette, Lock, Upload, Image } from 'lucide-react'
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

export default function ConfigEditor({ businessId, getToken, onRefresh, isDark, plan }) {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [pushingTemplate, setPushingTemplate] = useState('')
  const [logoFile, setLogoFile] = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const readOnly = plan === 'pro' || plan === 'starter' || plan === 'free'

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
  const [businessType, setBusinessType] = useState('')

  // Support Log
  const [supportLog, setSupportLog] = useState([])
  const [newNote, setNewNote] = useState('')

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
      setBusinessType(biz.business_type || biz.biz_type || app.business_type || '')
      setLogoPreview(data.logo_url || null)
      // Parse notes — if JSON array, use as structured log; if string, migrate
      const rawNotes = data.notes || ''
      try {
        const parsed = JSON.parse(rawNotes)
        if (Array.isArray(parsed)) setSupportLog(parsed)
        else setSupportLog(rawNotes ? [{ text: rawNotes, author: 'Admin', date: new Date().toISOString() }] : [])
      } catch {
        setSupportLog(rawNotes ? [{ text: rawNotes, author: 'Admin', date: new Date().toISOString() }] : [])
      }
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
          notes: JSON.stringify(supportLog),
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

  function addNote() {
    if (!newNote.trim()) return
    setSupportLog(prev => [{ text: newNote.trim(), author: 'Admin', date: new Date().toISOString() }, ...prev])
    setNewNote('')
  }

  async function handleLogoUpload() {
    if (!logoFile) return
    setUploadingLogo(true)
    try {
      const reader = new FileReader()
      const base64 = await new Promise((resolve) => {
        reader.onload = () => resolve(reader.result.split(',')[1])
        reader.readAsDataURL(logoFile)
      })
      const resp = await fetch('/api/panel?action=upload_logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify({ business_id: businessId, base64, filename: logoFile.name, contentType: logoFile.type }),
      })
      const result = await resp.json()
      if (result.url) {
        setLogoPreview(result.url)
        setLogoFile(null)
      }
      onRefresh?.()
    } catch {}
    setUploadingLogo(false)
  }

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-[#b3001e]" size={18} /></div>

  const card = `rounded-2xl p-5 transition-colors ${isDark ? 'bg-white/[0.03] border border-white/10' : 'bg-white border border-black/10 shadow-sm'}`
  const sectionTitle = `text-[11px] font-bold uppercase tracking-[1.2px] mb-3 flex items-center gap-2 text-[#b3001e]`
  const labelCls = `text-[10px] font-bold uppercase tracking-[1.2px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`
  const inputCls = `w-full px-3.5 py-2.5 rounded-xl text-[13px] outline-none transition-all focus:ring-2 ${isDark ? 'bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-[#b3001e] focus:ring-[#b3001e]/25' : 'bg-white border border-black/10 text-black placeholder-black/30 focus:border-[#b3001e] focus:ring-[#b3001e]/25'}`
  const selectCls = inputCls

  return (
    <div className="space-y-4">
      {readOnly && (
        <div className={`rounded-2xl p-4 flex items-center gap-3 border ${isDark ? 'bg-amber-500/5 border-amber-500/20' : 'bg-amber-50 border-amber-200'}`}>
          <Lock size={16} className="text-amber-500 shrink-0" />
          <div>
            <p className={`text-[12px] font-bold ${isDark ? 'text-white/80' : 'text-black/80'}`}>{L('Acceso de solo lectura', 'Read-only access')}</p>
            <p className={`text-[11px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>{L('Actualice a Pro PLUS para configuracion remota.', 'Upgrade to Pro PLUS for remote configuration.')}</p>
          </div>
        </div>
      )}
      {/* Fiscal */}
      <div className={`${card} ${readOnly ? 'opacity-60 pointer-events-none' : ''}`}>
        <p className={sectionTitle}><Receipt size={13} /> {L('Fiscal', 'Fiscal')}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className={labelCls}>{L('Modo', 'Mode')}</p>
            <select value={fiscalMode} onChange={e => setFiscalMode(e.target.value)} disabled={readOnly} className={selectCls}>
              <option value="b_series">B01/B02 (Papel)</option>
              <option value="ecf">e-CF (Electronico)</option>
            </select>
          </div>
          <div>
            <p className={labelCls}>{L('Idioma', 'Language')}</p>
            <select value={bizLanguage} onChange={e => setBizLanguage(e.target.value)} disabled={readOnly} className={selectCls}>
              <option value="es">Espanol</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <p className={labelCls}>ITBIS %</p>
            <input type="number" value={itbisPct} onChange={e => setItbisPct(e.target.value)} disabled={readOnly} className={inputCls} />
          </div>
          <div>
            <p className={labelCls}>{L('Ley 10%', 'Law 10%')}</p>
            <input type="number" value={leyPct} onChange={e => setLeyPct(e.target.value)} disabled={readOnly} className={inputCls} />
          </div>
          <div>
            <p className={labelCls}>{L('Tasa USD', 'USD Rate')}</p>
            <input type="number" value={usdRate} onChange={e => setUsdRate(e.target.value)} disabled={readOnly} className={inputCls} />
          </div>
        </div>
      </div>

      {/* WhatsApp */}
      <div className={`${card} ${readOnly ? 'opacity-60 pointer-events-none' : ''}`}>
        <p className={sectionTitle}><MessageSquare size={13} /> WhatsApp (UltraMsg)</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className={labelCls}>Instance ID</p>
            <input value={waInstance} onChange={e => setWaInstance(e.target.value)} placeholder="instance123456" disabled={readOnly} className={inputCls} />
          </div>
          <div>
            <p className={labelCls}>Token</p>
            <input value={waToken} onChange={e => setWaToken(e.target.value)} placeholder="abc123token" disabled={readOnly} className={inputCls} />
          </div>
        </div>
        <p className={`text-[10px] mt-2 ${isDark ? 'text-white/25' : 'text-black/30'}`}>
          {L('El cliente necesita su propia cuenta UltraMsg con su numero de WhatsApp Business.', 'Client needs their own UltraMsg account with their WhatsApp Business number.')}
        </p>
      </div>

      {/* Printer */}
      <div className={`${card} ${readOnly ? 'opacity-60 pointer-events-none' : ''}`}>
        <p className={sectionTitle}><Printer size={13} /> {L('Impresora', 'Printer')}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className={labelCls}>{L('Nombre', 'Name')}</p>
            <input value={printerName} onChange={e => setPrinterName(e.target.value)} placeholder="POS-80" disabled={readOnly} className={inputCls} />
          </div>
          <div>
            <p className={labelCls}>{L('Ancho (mm)', 'Width (mm)')}</p>
            <select value={printerWidth} onChange={e => setPrinterWidth(e.target.value)} disabled={readOnly} className={selectCls}>
              <option value="80">80mm</option>
              <option value="58">58mm</option>
            </select>
          </div>
        </div>
      </div>

      {/* Feature Overrides — branch by business_type */}
      {(businessType === 'accounting' || businessType === 'contabilidad') ? (
        <div className={`${card} ${readOnly ? 'opacity-60 pointer-events-none' : ''}`}>
          <p className={sectionTitle}><Settings size={13} /> {L('Funciones', 'Features')}</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'contabilidad', es: 'Contabilidad', en: 'Accounting' },
            ].map(f => (
              <label key={f.key} className={`flex items-center gap-2 px-2.5 py-2 rounded-xl cursor-pointer text-[12px] transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'}`}>
                <input type="checkbox" checked={features[f.key] !== false}
                  onChange={e => setFeatures(prev => ({ ...prev, [f.key]: e.target.checked }))}
                  disabled={readOnly} className="accent-[#b3001e]" />
                <span className={isDark ? 'text-white/80' : 'text-black/80'}>{lang === 'es' ? f.es : f.en}</span>
              </label>
            ))}
          </div>
          <p className={`text-[11px] mt-3 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
            {L('Cliente de contabilidad — funciones POS no aplican.', 'Accounting client — POS features do not apply.')}
          </p>
        </div>
      ) : (
        <>
          <div className={`${card} ${readOnly ? 'opacity-60 pointer-events-none' : ''}`}>
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
                <label key={f.key} className={`flex items-center gap-2 px-2.5 py-2 rounded-xl cursor-pointer text-[12px] transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'}`}>
                  <input type="checkbox" checked={features[f.key] !== false}
                    onChange={e => setFeatures(prev => ({ ...prev, [f.key]: e.target.checked }))}
                    disabled={readOnly} className="accent-[#b3001e]" />
                  <span className={isDark ? 'text-white/80' : 'text-black/80'}>{lang === 'es' ? f.es : f.en}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Service Templates — POS only */}
          <div className={`${card} ${readOnly ? 'opacity-60 pointer-events-none' : ''}`}>
            <p className={sectionTitle}><Palette size={13} /> {L('Plantillas de Servicios', 'Service Templates')}</p>
            <p className={`text-[11px] mb-3 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
              {L('Agrega servicios predeterminados al negocio del cliente.', 'Push preset services to the client\'s business.')}
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(SERVICE_TEMPLATES).map(([key, tpl]) => (
                <button key={key} onClick={() => pushTemplate(key)} disabled={!!pushingTemplate}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-bold border transition-colors disabled:opacity-50 ${isDark ? 'border-white/10 text-white/70 hover:bg-white/5 hover:border-[#b3001e]/40 hover:text-white' : 'border-black/10 text-black/70 hover:bg-black/5 hover:border-[#b3001e]/40 hover:text-black'}`}>
                  {pushingTemplate === key ? <Loader2 size={12} className="animate-spin" /> : <Palette size={12} />}
                  {lang === 'es' ? tpl.label.es : tpl.label.en}
                  <span className={`text-[10px] ${isDark ? 'text-white/40' : 'text-black/40'}`}>({tpl.services.length})</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Support Log */}
      <div className={card}>
        <p className={sectionTitle}><FileText size={13} /> {L('Registro de Soporte', 'Support Log')}</p>
        {!readOnly && (
          <div className="flex gap-2 mb-3">
            <input value={newNote} onChange={e => setNewNote(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addNote()}
              placeholder={L('Agregar nota...', 'Add note...')}
              className={`${inputCls} flex-1`} />
            <button onClick={addNote} disabled={!newNote.trim()}
              className="px-3 py-2 rounded-xl text-[11px] font-bold bg-[#b3001e] text-white hover:bg-[#c8002a] disabled:opacity-50 transition-colors shrink-0">
              {L('Agregar', 'Add')}
            </button>
          </div>
        )}
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {supportLog.length === 0 ? (
            <p className={`text-[11px] ${isDark ? 'text-white/25' : 'text-black/25'}`}>{L('Sin notas.', 'No notes.')}</p>
          ) : supportLog.map((note, i) => (
            <div key={i} className={`flex gap-2 py-2 border-b last:border-0 ${isDark ? 'border-white/5' : 'border-black/5'}`}>
              <div className="flex-1">
                <p className={`text-[12px] ${isDark ? 'text-white/80' : 'text-black/80'}`}>{note.text}</p>
                <p className={`text-[10px] mt-0.5 ${isDark ? 'text-white/25' : 'text-black/25'}`}>
                  {note.author} — {new Date(note.date).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              {!readOnly && (
                <button onClick={() => setSupportLog(prev => prev.filter((_, j) => j !== i))}
                  className={`text-[10px] shrink-0 px-1.5 rounded hover:bg-red-500/10 hover:text-red-500 transition-colors ${isDark ? 'text-white/20' : 'text-black/20'}`}>&#x2715;</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Logo */}
      <div className={`${card} ${readOnly ? 'opacity-60 pointer-events-none' : ''}`}>
        <p className={sectionTitle}><Image size={13} /> Logo</p>
        <div className="flex items-center gap-4">
          {logoPreview && <img src={logoPreview} alt="Logo" className="w-16 h-16 rounded-xl object-contain border border-black/10 dark:border-white/10" />}
          <div className="flex-1">
            <input type="file" accept="image/*" disabled={readOnly}
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                setLogoFile(file)
                setLogoPreview(URL.createObjectURL(file))
              }}
              className={`text-[12px] ${isDark ? 'text-white/60' : 'text-black/60'}`} />
            {logoFile && (
              <button onClick={handleLogoUpload} disabled={uploadingLogo || readOnly}
                className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-[#b3001e] text-white hover:bg-[#c8002a] disabled:opacity-50 transition-colors">
                {uploadingLogo ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {L('Subir Logo', 'Upload Logo')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Save */}
      {!readOnly && (
        <button onClick={handleSave} disabled={saving}
          className="w-full flex items-center justify-center gap-2 px-4 py-3.5 bg-[#b3001e] hover:bg-[#c8002a] text-white text-[13px] font-bold rounded-xl disabled:opacity-50 transition-colors shadow-lg shadow-[#b3001e]/20">
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
          {saving ? L('Guardando...', 'Saving...') : saved ? L('Guardado', 'Saved') : L('Guardar Configuracion', 'Save Configuration')}
        </button>
      )}
    </div>
  )
}
