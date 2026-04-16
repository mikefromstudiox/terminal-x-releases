import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Plus, Trash2, Search, Check, AlertCircle, Download, Send, Loader2, ArrowLeft, QrCode } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import { useAuth } from '../../context/AuthContext'
import { signAndSubmitECF, formatDGIIDate, validateRNC, getQRCode } from '@terminal-x/services/ecf'
import { saveReceiptPDF } from '@terminal-x/services/pdf'

function fmtRD(n) {
  return 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const PAYMENT_METHODS = [
  { key: 'efectivo', es: 'Efectivo', en: 'Cash' },
  { key: 'tarjeta', es: 'Tarjeta', en: 'Card' },
  { key: 'transferencia', es: 'Transferencia', en: 'Transfer' },
  { key: 'cheque', es: 'Cheque', en: 'Check' },
  { key: 'credito', es: 'Credito', en: 'Credit' },
]

const EMPTY_ITEM = { descripcion: '', cantidad: 1, precio: 0, itbis: true }

export default function InvoiceCreate() {
  const api = useAPI()
  const navigate = useNavigate()
  const { lang } = useLang()
  const { user } = useAuth()
  const L = (es, en) => lang === 'es' ? es : en

  // e-CF type
  const [tipoECF, setTipoECF] = useState('32')

  // Client
  const [clients, setClients] = useState([])
  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState(null)
  const [newClient, setNewClient] = useState(false)
  const [clientForm, setClientForm] = useState({ name: '', rnc: '', phone: '', email: '', address: '' })
  const [rncLooking, setRncLooking] = useState(false)
  const [rncResult, setRncResult] = useState(null)

  // Items
  const [items, setItems] = useState([{ ...EMPTY_ITEM }])

  // Payment & notes
  const [paymentMethod, setPaymentMethod] = useState('efectivo')
  const [notes, setNotes] = useState('')

  // Submission state
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  // Business info
  const [empresa, setEmpresa] = useState(null)

  const confirmedRef = useRef(false)

  // Load clients + empresa
  useEffect(() => {
    let cancelled = false
    async function load() {
      const [cls, emp] = await Promise.all([
        api?.clients?.all?.() || [],
        api?.admin?.getEmpresa?.() || null,
      ])
      if (cancelled) return
      setClients(cls || [])
      setEmpresa(emp)
    }
    load()
    return () => { cancelled = true }
  }, [api])

  // RNC lookup
  const lookupRNC = useCallback(async (rnc) => {
    if (!rnc || rnc.replace(/[-\s]/g, '').length < 9) return
    setRncLooking(true)
    setRncResult(null)
    try {
      const result = await api?.rnc?.lookup?.(rnc)
      if (result) {
        setRncResult(result)
        if (result.name && !clientForm.name) {
          setClientForm(prev => ({ ...prev, name: result.name }))
        }
      }
    } catch {}
    setRncLooking(false)
  }, [api, clientForm.name])

  // Filtered clients
  const filteredClients = clientSearch.trim()
    ? clients.filter(c =>
        (c.name || '').toLowerCase().includes(clientSearch.toLowerCase()) ||
        (c.rnc || '').includes(clientSearch) ||
        (c.phone || '').includes(clientSearch)
      )
    : []

  // Item operations
  function addItem() {
    setItems(prev => [...prev, { ...EMPTY_ITEM }])
  }

  function removeItem(idx) {
    setItems(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx))
  }

  function updateItem(idx, field, value) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  // Calculations
  const subtotal = items.reduce((sum, item) => sum + (Number(item.precio) * Number(item.cantidad || 1)), 0)
  const itbisTotal = items.reduce((sum, item) => {
    if (!item.itbis) return sum
    return sum + (Number(item.precio) * Number(item.cantidad || 1) * 0.18)
  }, 0)
  const total = subtotal + itbisTotal

  // Validation
  function validate() {
    const validItems = items.filter(i => i.descripcion.trim() && Number(i.precio) > 0)
    if (validItems.length === 0) return L('Agrega al menos un item con descripcion y precio', 'Add at least one item with description and price')
    if (total <= 0) return L('El total debe ser mayor a 0', 'Total must be greater than 0')
    if (tipoECF === '31') {
      const rnc = selectedClient?.rnc || clientForm.rnc
      if (!rnc || !validateRNC(rnc)) return L('E31 (Credito Fiscal) requiere un RNC valido del comprador', 'E31 (Tax Credit) requires a valid buyer RNC')
    }
    return null
  }

  // Submit invoice
  async function handleSubmit() {
    if (confirmedRef.current || submitting) return
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setError(null)
    setSubmitting(true)

    try {
      const validItems = items.filter(i => i.descripcion.trim() && Number(i.precio) > 0)

      // Resolve or create client
      let clientId = selectedClient?.id || null
      let clientSid = selectedClient?.supabase_id || null
      const clientRnc = selectedClient?.rnc || clientForm.rnc || null
      const clientName = selectedClient?.name || clientForm.name || null

      if (newClient && clientForm.name.trim()) {
        try {
          const created = await api?.clients?.create?.({
            name: clientForm.name.trim(),
            rnc: clientForm.rnc || null,
            phone: clientForm.phone || null,
            email: clientForm.email || null,
            address: clientForm.address || null,
          })
          if (created?.id) {
            clientId = created.id
            clientSid = created.supabase_id || null
          }
        } catch (e) {
          console.error('[InvoiceCreate] client creation failed:', e.message)
        }
      }

      // Build ticket items
      const ticketItems = validItems.map(item => ({
        name: item.descripcion,
        price: Number(item.precio),
        quantity: Number(item.cantidad || 1),
        aplica_itbis: item.itbis ? 1 : 0,
        is_wash: false,
      }))

      const itemSubtotal = validItems.reduce((s, i) => s + Number(i.precio) * Number(i.cantidad || 1), 0)
      const itemItbis = validItems.reduce((s, i) => {
        if (!i.itbis) return s
        return s + Number(i.precio) * Number(i.cantidad || 1) * 0.18
      }, 0)
      const itemTotal = itemSubtotal + itemItbis

      // Get next e-NCF
      const ncfType = `E${tipoECF}`
      let eNCF = null
      try {
        eNCF = await api?.ncf?.next?.(ncfType)
      } catch (e) {
        throw new Error(L('No se pudo obtener el proximo e-NCF. Verifique las secuencias.', 'Could not get next e-NCF. Check sequences.'))
      }
      if (!eNCF) throw new Error(L('Secuencia e-NCF no disponible', 'e-NCF sequence not available'))

      // Create ticket first
      const ticketData = {
        items: ticketItems,
        subtotal: parseFloat(itemSubtotal.toFixed(2)),
        itbis: parseFloat(itemItbis.toFixed(2)),
        ley: 0,
        descuento: 0,
        total: parseFloat(itemTotal.toFixed(2)),
        payment_method: paymentMethod,
        comprobante_type: ncfType,
        tipo_venta: paymentMethod === 'credito' ? 'credito' : 'contado',
        status: paymentMethod === 'credito' ? 'pendiente' : 'cobrado',
        client_id: clientId,
        client_supabase_id: clientSid,
        notes: notes || null,
        vehicle_plate: null,
        washer_ids: [],
      }

      const ticketResult = await api?.tickets?.create?.(ticketData)
      if (!ticketResult?.id) throw new Error(L('Error creando factura', 'Error creating invoice'))

      // Build e-CF payload and submit
      const emisor = {
        rnc: empresa?.rnc || '',
        nombre: empresa?.name || empresa?.nombre || '',
        nombreComercial: empresa?.name || empresa?.nombre || '',
        direccion: empresa?.address || empresa?.direccion || 'Santo Domingo',
        email: empresa?.email || '',
      }

      const comprador = (clientRnc && validateRNC(clientRnc)) ? {
        rnc: clientRnc.replace(/[-\s]/g, ''),
        nombre: clientName || clientRnc,
        email: '',
        direccion: clientForm.address || 'Santo Domingo',
      } : null

      const ecfItems = validItems.map(item => ({
        nombre: item.descripcion,
        precio: Number(item.precio),
        cantidad: Number(item.cantidad || 1),
        indicadorFacturacion: item.itbis ? '1' : '4',
        indicadorBienoServicio: '2',
      }))

      const ecfInvoiceData = {
        tipoECF,
        eNCF,
        emisor,
        comprador,
        items: ecfItems,
        totales: {
          subtotal: parseFloat(itemSubtotal.toFixed(2)),
          itbis: parseFloat(itemItbis.toFixed(2)),
          total: parseFloat(itemTotal.toFixed(2)),
        },
        metodoPago: paymentMethod,
        tipoIngresos: '01',
        ticket: { id: ticketResult.id },
      }

      const ecfResult = await signAndSubmitECF(ecfInvoiceData, api)

      // Update ticket with e-CF result
      if (ecfResult && ticketResult.id) {
        try {
          await api?.tickets?.update?.(ticketResult.id, {
            ecf_result: ecfResult,
            comprobante_type: ncfType,
          })
        } catch (e) {
          console.error('[InvoiceCreate] ticket ecf update failed:', e.message)
        }
      }

      confirmedRef.current = true
      setSuccess({
        ticketId: ticketResult.id,
        docNumber: ticketResult.docNumber,
        eNCF: ecfResult?.eNCF || eNCF,
        status: ecfResult?.status || 'EN_PROCESO',
        qrLink: ecfResult?.qrLink || null,
        securityCode: ecfResult?.securityCode || null,
        signatureDate: ecfResult?.signatureDate || null,
        total: itemTotal,
        clientName,
        ecfResult,
      })
    } catch (err) {
      setError(err.message || L('Error al emitir factura', 'Error issuing invoice'))
    } finally {
      setSubmitting(false)
    }
  }

  // PDF download
  async function downloadPDF() {
    if (!success) return
    const pdfData = {
      docNo: success.eNCF || success.docNumber || `T-${success.ticketId}`,
      ncf: success.eNCF,
      ncfType: `E${tipoECF}`,
      total: success.total,
      subtotal,
      itbis: itbisTotal,
      ley: 0,
      descuento: 0,
      formaPago: PAYMENT_METHODS.find(p => p.key === paymentMethod)?.es || paymentMethod,
      services: items.filter(i => i.descripcion.trim()).map(i => ({ name: i.descripcion, price: Number(i.precio), qty: Number(i.cantidad || 1) })),
      biz: { name: empresa?.name || '', rnc: empresa?.rnc || '', phone: empresa?.phone || '', address: empresa?.address || '' },
      client: selectedClient || (clientForm.name ? { name: clientForm.name, rnc: clientForm.rnc } : null),
      paidAt: new Date(),
      securityCode: success.securityCode,
      signatureDate: success.signatureDate,
      qrLink: success.qrLink,
    }
    await saveReceiptPDF(pdfData, api)
  }

  // WhatsApp send
  function sendWhatsApp() {
    if (!success) return
    const phone = selectedClient?.phone || clientForm.phone
    if (!phone) return
    const text = `Factura ${success.eNCF || success.docNumber}\nTotal: ${fmtRD(success.total)}\n${success.qrLink ? `Verificar: ${success.qrLink}` : ''}`
    window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`, '_blank')
  }

  // New invoice
  function resetForm() {
    confirmedRef.current = false
    setTipoECF('32')
    setSelectedClient(null)
    setNewClient(false)
    setClientForm({ name: '', rnc: '', phone: '', email: '', address: '' })
    setItems([{ ...EMPTY_ITEM }])
    setPaymentMethod('efectivo')
    setNotes('')
    setError(null)
    setSuccess(null)
    setRncResult(null)
  }

  // -- Success view --
  if (success) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 p-8 text-center space-y-6">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
            <Check size={32} className="text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white">{L('Factura Emitida', 'Invoice Issued')}</h2>
            <p className="text-sm text-slate-500 dark:text-white/50 mt-1">{success.clientName || ''}</p>
          </div>

          <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-5 space-y-3 text-left">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 dark:text-white/50">e-NCF</span>
              <span className="font-mono font-bold text-slate-800 dark:text-white">{success.eNCF}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 dark:text-white/50">Total</span>
              <span className="font-bold text-slate-800 dark:text-white">{fmtRD(success.total)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 dark:text-white/50">Estado DGII</span>
              <span className={`font-bold ${success.status === 'ACEPTADO' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {success.status}
              </span>
            </div>
            {success.securityCode && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-white/50">{L('Codigo Seguridad', 'Security Code')}</span>
                <span className="font-mono text-slate-800 dark:text-white">{success.securityCode}</span>
              </div>
            )}
          </div>

          {success.qrLink && (
            <div className="flex justify-center">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&margin=4&data=${encodeURIComponent(success.qrLink)}`}
                alt="QR"
                width="150"
                height="150"
                className="rounded-lg"
              />
            </div>
          )}

          <div className="flex flex-wrap justify-center gap-3">
            <button onClick={downloadPDF} className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-slate-700 dark:text-white rounded-lg font-semibold text-sm transition-colors">
              <Download size={16} /> {L('Descargar PDF', 'Download PDF')}
            </button>
            {(selectedClient?.phone || clientForm.phone) && (
              <button onClick={sendWhatsApp} className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm transition-colors">
                <Send size={16} /> WhatsApp
              </button>
            )}
            <button onClick={resetForm} className="flex items-center gap-2 px-4 py-2.5 bg-[#b3001e] hover:bg-[#8c0017] text-white rounded-lg font-bold text-sm transition-colors">
              <Plus size={16} /> {L('Nueva Factura', 'New Invoice')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // -- Main form --
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/invoicing')} className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-slate-500 dark:text-white/50" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white">{L('Nueva Factura', 'New Invoice')}</h1>
          <p className="text-sm text-slate-500 dark:text-white/50">{L('Facturacion electronica e-CF', 'Electronic invoicing e-CF')}</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl p-4">
          <AlertCircle size={18} className="text-red-600 dark:text-red-400 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — form */}
        <div className="lg:col-span-2 space-y-6">
          {/* e-CF Type */}
          <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 p-5">
            <h3 className="text-sm font-bold text-slate-700 dark:text-white mb-3">{L('Tipo de Comprobante', 'Invoice Type')}</h3>
            <div className="flex gap-3">
              <button
                onClick={() => setTipoECF('31')}
                className={`flex-1 px-4 py-3 rounded-lg border-2 text-center transition-all ${
                  tipoECF === '31' ? 'border-[#b3001e] bg-[#b3001e]/5' : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                }`}
              >
                <p className={`text-sm font-bold ${tipoECF === '31' ? 'text-[#b3001e]' : 'text-slate-700 dark:text-white'}`}>E31</p>
                <p className="text-xs text-slate-500 dark:text-white/50">{L('Credito Fiscal (B2B)', 'Tax Credit (B2B)')}</p>
              </button>
              <button
                onClick={() => setTipoECF('32')}
                className={`flex-1 px-4 py-3 rounded-lg border-2 text-center transition-all ${
                  tipoECF === '32' ? 'border-[#b3001e] bg-[#b3001e]/5' : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                }`}
              >
                <p className={`text-sm font-bold ${tipoECF === '32' ? 'text-[#b3001e]' : 'text-slate-700 dark:text-white'}`}>E32</p>
                <p className="text-xs text-slate-500 dark:text-white/50">{L('Consumidor Final (B2C)', 'Consumer Final (B2C)')}</p>
              </button>
            </div>
          </div>

          {/* Client */}
          <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-700 dark:text-white">{L('Cliente', 'Client')}</h3>
              <button
                onClick={() => { setNewClient(!newClient); setSelectedClient(null) }}
                className="text-xs font-semibold text-[#b3001e] hover:underline"
              >
                {newClient ? L('Buscar existente', 'Search existing') : L('Nuevo Cliente', 'New Client')}
              </button>
            </div>

            {!newClient ? (
              <div className="relative">
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={e => { setClientSearch(e.target.value); setSelectedClient(null) }}
                    placeholder={L('Buscar por nombre, RNC o telefono...', 'Search by name, RNC or phone...')}
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-white/30 outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                  />
                </div>
                {selectedClient && (
                  <div className="mt-2 p-3 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-lg">
                    <p className="text-sm font-semibold text-green-800 dark:text-green-300">{selectedClient.name}</p>
                    {selectedClient.rnc && <p className="text-xs text-green-600 dark:text-green-400">RNC: {selectedClient.rnc}</p>}
                  </div>
                )}
                {filteredClients.length > 0 && !selectedClient && (
                  <div className="absolute z-10 mt-1 w-full bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-white/10 shadow-lg max-h-48 overflow-y-auto">
                    {filteredClients.slice(0, 10).map(c => (
                      <button
                        key={c.id}
                        onClick={() => { setSelectedClient(c); setClientSearch(c.name || '') }}
                        className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors border-b border-slate-100 dark:border-white/5 last:border-0"
                      >
                        <p className="text-sm font-medium text-slate-800 dark:text-white">{c.name}</p>
                        <p className="text-xs text-slate-400 dark:text-white/40">{c.rnc || ''} {c.phone || ''}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {tipoECF === '31' && (
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-1">RNC *</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={clientForm.rnc}
                        onChange={e => setClientForm(prev => ({ ...prev, rnc: e.target.value }))}
                        onBlur={() => lookupRNC(clientForm.rnc)}
                        placeholder="123456789"
                        className="flex-1 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                      />
                      <button
                        onClick={() => lookupRNC(clientForm.rnc)}
                        disabled={rncLooking}
                        className="px-3 py-2 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 rounded-lg text-xs font-semibold text-slate-600 dark:text-white/70 transition-colors disabled:opacity-50"
                      >
                        {rncLooking ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                      </button>
                    </div>
                    {rncResult && (
                      <p className="mt-1 text-xs text-green-600 dark:text-green-400">{rncResult.name} - {rncResult.status}</p>
                    )}
                  </div>
                )}
                {tipoECF !== '31' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-1">{L('RNC (opcional)', 'RNC (optional)')}</label>
                    <input
                      type="text"
                      value={clientForm.rnc}
                      onChange={e => setClientForm(prev => ({ ...prev, rnc: e.target.value }))}
                      onBlur={() => lookupRNC(clientForm.rnc)}
                      placeholder="123456789"
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                    />
                  </div>
                )}
                <div className={tipoECF === '31' ? 'sm:col-span-2' : ''}>
                  <label className="block text-xs font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-1">{L('Nombre', 'Name')} {tipoECF === '31' ? '*' : ''}</label>
                  <input
                    type="text"
                    value={clientForm.name}
                    onChange={e => setClientForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder={L('Nombre del cliente', 'Client name')}
                    className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-1">{L('Telefono', 'Phone')}</label>
                  <input
                    type="text"
                    value={clientForm.phone}
                    onChange={e => setClientForm(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="809-555-0000"
                    className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-1">Email</label>
                  <input
                    type="email"
                    value={clientForm.email}
                    onChange={e => setClientForm(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="email@empresa.com"
                    className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Items */}
          <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-700 dark:text-white">{L('Items', 'Items')}</h3>

            {/* Header row — desktop only */}
            <div className="hidden sm:grid grid-cols-12 gap-2 text-xs font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider px-1">
              <div className="col-span-5">{L('Descripcion', 'Description')}</div>
              <div className="col-span-1 text-center">{L('Cant', 'Qty')}</div>
              <div className="col-span-2 text-right">{L('Precio', 'Price')}</div>
              <div className="col-span-1 text-center">ITBIS</div>
              <div className="col-span-2 text-right">Total</div>
              <div className="col-span-1"></div>
            </div>

            {items.map((item, idx) => {
              const rowTotal = Number(item.precio) * Number(item.cantidad || 1)
              const rowItbis = item.itbis ? rowTotal * 0.18 : 0
              return (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    type="text"
                    value={item.descripcion}
                    onChange={e => updateItem(idx, 'descripcion', e.target.value)}
                    placeholder={L('Descripcion del servicio o producto', 'Service or product description')}
                    className="col-span-12 sm:col-span-5 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                  />
                  <input
                    type="number"
                    min="1"
                    value={item.cantidad}
                    onChange={e => updateItem(idx, 'cantidad', Math.max(1, parseInt(e.target.value) || 1))}
                    className="col-span-3 sm:col-span-1 px-2 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-center text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.precio || ''}
                    onChange={e => updateItem(idx, 'precio', e.target.value)}
                    placeholder="0.00"
                    className="col-span-4 sm:col-span-2 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-right text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                  />
                  <div className="col-span-2 sm:col-span-1 flex justify-center">
                    <button
                      onClick={() => updateItem(idx, 'itbis', !item.itbis)}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold transition-colors ${
                        item.itbis ? 'bg-[#b3001e]/10 text-[#b3001e]' : 'bg-slate-100 dark:bg-white/10 text-slate-400 dark:text-white/30'
                      }`}
                    >
                      18%
                    </button>
                  </div>
                  <div className="col-span-2 sm:col-span-2 text-right text-sm font-medium text-slate-800 dark:text-white">
                    {fmtRD(rowTotal + rowItbis)}
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <button onClick={() => removeItem(idx)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors" disabled={items.length <= 1}>
                      <Trash2 size={14} className={items.length <= 1 ? 'text-slate-300 dark:text-white/10' : 'text-red-500'} />
                    </button>
                  </div>
                </div>
              )
            })}

            <button
              onClick={addItem}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[#b3001e] hover:bg-[#b3001e]/5 rounded-lg transition-colors"
            >
              <Plus size={16} /> {L('Agregar Item', 'Add Item')}
            </button>
          </div>

          {/* Notes */}
          <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 p-5">
            <label className="block text-sm font-bold text-slate-700 dark:text-white mb-2">{L('Notas (opcional)', 'Notes (optional)')}</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder={L('Notas adicionales para la factura...', 'Additional invoice notes...')}
              className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30 resize-none"
            />
          </div>

          {/* Payment method */}
          <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 p-5">
            <label className="block text-sm font-bold text-slate-700 dark:text-white mb-3">{L('Forma de Pago', 'Payment Method')}</label>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map(pm => (
                <button
                  key={pm.key}
                  onClick={() => setPaymentMethod(pm.key)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    paymentMethod === pm.key
                      ? 'bg-[#b3001e] text-white'
                      : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/15'
                  }`}
                >
                  {lang === 'es' ? pm.es : pm.en}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right column — summary */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 p-5 space-y-4 sticky top-32">
            <h3 className="text-sm font-bold text-slate-700 dark:text-white">{L('Resumen', 'Summary')}</h3>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-white/50">Subtotal</span>
                <span className="font-medium text-slate-800 dark:text-white">{fmtRD(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-white/50">ITBIS (18%)</span>
                <span className="font-medium text-slate-800 dark:text-white">{fmtRD(itbisTotal)}</span>
              </div>
              <div className="h-px bg-slate-200 dark:bg-white/10" />
              <div className="flex justify-between text-lg">
                <span className="font-bold text-slate-800 dark:text-white">Total</span>
                <span className="font-extrabold text-[#b3001e]">{fmtRD(total)}</span>
              </div>
            </div>

            {/* Preview card */}
            <div className="bg-slate-50 dark:bg-white/5 rounded-lg p-4 space-y-2 border border-slate-100 dark:border-white/5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/30">{L('Vista previa', 'Preview')}</p>
              <p className="text-xs font-bold text-slate-700 dark:text-white">{tipoECF === '31' ? 'E31 - Credito Fiscal' : 'E32 - Consumidor Final'}</p>
              {(selectedClient?.name || clientForm.name) && (
                <p className="text-xs text-slate-500 dark:text-white/50">{selectedClient?.name || clientForm.name}</p>
              )}
              <p className="text-xs text-slate-400 dark:text-white/30">{items.filter(i => i.descripcion.trim()).length} {L('items', 'items')}</p>
              <p className="text-xs text-slate-400 dark:text-white/30">{PAYMENT_METHODS.find(p => p.key === paymentMethod)?.[lang === 'es' ? 'es' : 'en']}</p>
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-3 rounded-xl bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold text-sm disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-red-500/20"
            >
              {submitting ? (
                <><Loader2 size={16} className="animate-spin" /> {L('Emitiendo...', 'Issuing...')}</>
              ) : (
                <><FileText size={16} /> {L('Emitir Factura', 'Issue Invoice')}</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
