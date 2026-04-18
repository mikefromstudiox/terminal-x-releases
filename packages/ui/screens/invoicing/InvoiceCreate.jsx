import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Plus, Trash2, Search, Check, AlertCircle, Download, Send, Loader2, ArrowLeft } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import { useAuth } from '../../context/AuthContext'
import { signAndSubmitECF, validateRNC } from '@terminal-x/services/ecf'
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

// Ley 10% is computed on pre-ITBIS subtotal to mirror POS/CobrarModal.
const LEY_RATE = 0.10
const EMPTY_ITEM = { descripcion: '', cantidad: 1, precio: 0, itbis: true }

export default function InvoiceCreate() {
  const api = useAPI()
  const navigate = useNavigate()
  const { lang } = useLang()
  const { user } = useAuth()
  const L = (es, en) => lang === 'es' ? es : en

  const [tipoECF, setTipoECF] = useState('32')

  const [clients, setClients] = useState([])
  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState(null)
  const [newClient, setNewClient] = useState(false)
  const [clientForm, setClientForm] = useState({ name: '', rnc: '', phone: '', email: '', address: '' })
  const [rncLooking, setRncLooking] = useState(false)
  const [rncResult, setRncResult] = useState(null)

  const [items, setItems] = useState([{ ...EMPTY_ITEM }])

  const [paymentMethod, setPaymentMethod] = useState('efectivo')
  const [notes, setNotes] = useState('')

  // Settings-driven fiscal rates. itbis_pct lives in app_settings (string),
  // default 18. ley_enabled is the per-business default for the Ley 10% toggle.
  const [itbisRate, setItbisRate] = useState(18)
  const [leyEnabled, setLeyEnabled] = useState(false)

  // Commission pickers — sellers load from api.sellers.all(); cajeros are
  // users (staff) filterable by role. Cajero auto-defaults to the logged-in
  // user when they log in as a cashier.
  const [sellers, setSellers] = useState([])
  const [cajeros, setCajeros] = useState([])
  const [sellerId, setSellerId] = useState('')
  const [cajeroId, setCajeroId] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  const [empresa, setEmpresa] = useState(null)

  const confirmedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [cls, emp, settings, sls, usrs] = await Promise.all([
        api?.clients?.all?.() || [],
        api?.admin?.getEmpresa?.() || null,
        api?.settings?.get?.() || {},
        api?.sellers?.all?.() || [],
        api?.users?.all?.() || [],
      ])
      if (cancelled) return
      setClients(cls || [])
      setEmpresa(emp)
      const pct = Number(settings?.itbis_pct)
      if (Number.isFinite(pct) && pct > 0) setItbisRate(pct)
      const leyDefault = String(settings?.ley_enabled ?? '').toLowerCase()
      setLeyEnabled(leyDefault === 'true' || leyDefault === '1')
      setSellers((sls || []).filter(s => s.active !== false && s.active !== 0))
      const cashierPool = (usrs || []).filter(u => (u.active !== false && u.active !== 0) && (u.role === 'cashier' || (u.commission_pct && u.commission_pct > 0)))
      setCajeros(cashierPool)
      if (user?.role === 'cashier' && user?.id && user.id !== 'web' && cashierPool.some(c => String(c.id) === String(user.id))) {
        setCajeroId(String(user.id))
      }
    }
    load()
    return () => { cancelled = true }
  }, [api, user?.id, user?.role])

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

  const filteredClients = clientSearch.trim()
    ? clients.filter(c =>
        (c.name || '').toLowerCase().includes(clientSearch.toLowerCase()) ||
        (c.rnc || '').includes(clientSearch) ||
        (c.phone || '').includes(clientSearch)
      )
    : []

  function addItem() {
    setItems(prev => [...prev, { ...EMPTY_ITEM }])
  }

  function removeItem(idx) {
    setItems(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx))
  }

  function updateItem(idx, field, value) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  const itbisFactor = itbisRate / 100

  const { subtotal, itbisTotal, leyAmount, total } = useMemo(() => {
    const sub = items.reduce((s, i) => s + (Number(i.precio) * Number(i.cantidad || 1)), 0)
    const itb = items.reduce((s, i) => {
      if (!i.itbis) return s
      return s + (Number(i.precio) * Number(i.cantidad || 1) * itbisFactor)
    }, 0)
    const ley = leyEnabled ? sub * LEY_RATE : 0
    return {
      subtotal: sub,
      itbisTotal: itb,
      leyAmount: ley,
      total: sub + itb + ley,
    }
  }, [items, itbisFactor, leyEnabled])

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

  async function handleSubmit() {
    if (confirmedRef.current || submitting) return
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setError(null)
    setSubmitting(true)

    try {
      const validItems = items.filter(i => i.descripcion.trim() && Number(i.precio) > 0)

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
        return s + Number(i.precio) * Number(i.cantidad || 1) * itbisFactor
      }, 0)
      const itemLey = leyEnabled ? itemSubtotal * LEY_RATE : 0
      const itemTotal = itemSubtotal + itemItbis + itemLey

      const ncfType = `E${tipoECF}`
      let eNCF = null
      try {
        eNCF = await api?.ncf?.next?.(ncfType)
      } catch {
        throw new Error(L('No se pudo obtener el proximo e-NCF. Verifique las secuencias.', 'Could not get next e-NCF. Check sequences.'))
      }
      if (!eNCF) throw new Error(L('Secuencia e-NCF no disponible', 'e-NCF sequence not available'))

      // NB: seller_id / cajero_id / washer_ids are intentionally NOT passed
      // into ticketCreate — invoice commissions use the flat `invoiceTotal *
      // comision_pct / 100` model and are written below via the dedicated
      // sellerCommissions.create / cajeroCommissions.create endpoints.
      // Washers don't apply to standalone invoices.
      const ticketData = {
        items: ticketItems,
        subtotal: parseFloat(itemSubtotal.toFixed(2)),
        itbis: parseFloat(itemItbis.toFixed(2)),
        ley: parseFloat(itemLey.toFixed(2)),
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
        seller_id: null,
        cajero_id: null,
      }

      const ticketResult = await api?.tickets?.create?.(ticketData)
      if (!ticketResult?.id) throw new Error(L('Error creando factura', 'Error creating invoice'))
      const ticketSid = ticketResult.supabase_id || null

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
          ley: parseFloat(itemLey.toFixed(2)),
          total: parseFloat(itemTotal.toFixed(2)),
        },
        metodoPago: paymentMethod,
        tipoIngresos: '01',
        ticket: { id: ticketResult.id },
      }

      const ecfResult = await signAndSubmitECF(ecfInvoiceData, api)

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

      // ── Commission wiring (flat invoiceTotal * pct / 100 model) ─────────
      if (sellerId) {
        const seller = sellers.find(s => String(s.id) === String(sellerId))
        const pct = Number(seller?.commission_pct || 0)
        if (seller && pct > 0) {
          try {
            await api?.sellerCommissions?.create?.({
              seller_id: seller.id,
              seller_supabase_id: seller.supabase_id || null,
              ticket_id: ticketResult.id,
              ticket_supabase_id: ticketSid,
              base_amount: parseFloat(itemTotal.toFixed(2)),
              commission_pct: pct,
              commission_amount: parseFloat((itemTotal * pct / 100).toFixed(2)),
            })
          } catch (e) { console.error('[InvoiceCreate] seller commission failed:', e.message) }
        }
      }
      if (cajeroId) {
        const cajero = cajeros.find(c => String(c.id) === String(cajeroId))
        const pct = Number(cajero?.commission_pct || 0)
        if (cajero && pct > 0) {
          try {
            await api?.cajeroCommissions?.create?.({
              cajero_id: cajero.id,
              cajero_supabase_id: cajero.supabase_id || null,
              ticket_id: ticketResult.id,
              ticket_supabase_id: ticketSid,
              base_amount: parseFloat(itemTotal.toFixed(2)),
              commission_pct: pct,
              commission_amount: parseFloat((itemTotal * pct / 100).toFixed(2)),
            })
          } catch (e) { console.error('[InvoiceCreate] cajero commission failed:', e.message) }
        }
      }

      // ── Activity log ────────────────────────────────────────────────────
      try {
        const docNumber = ticketResult.docNumber || `T-${ticketResult.id}`
        await api?.activity?.record?.({
          event_type: 'invoice_issued',
          severity: 'info',
          target_type: 'ticket',
          target_id: ticketResult.id,
          target_name: docNumber,
          amount: parseFloat(itemTotal.toFixed(2)),
          metadata: {
            eNCF: ecfResult?.eNCF || eNCF,
            clientName: clientName || null,
            comprobante_type: ncfType,
          },
        })
      } catch (e) { console.error('[InvoiceCreate] activity log failed:', e.message) }

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
        subtotal: itemSubtotal,
        itbis: itemItbis,
        ley: itemLey,
        clientName,
        ecfResult,
      })
    } catch (err) {
      setError(err.message || L('Error al emitir factura', 'Error issuing invoice'))
    } finally {
      setSubmitting(false)
    }
  }

  async function downloadPDF() {
    if (!success) return
    const pdfData = {
      docNo: success.eNCF || success.docNumber || `T-${success.ticketId}`,
      ncf: success.eNCF,
      ncfType: `E${tipoECF}`,
      total: success.total,
      subtotal: success.subtotal,
      itbis: success.itbis,
      ley: success.ley,
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

  function sendWhatsApp() {
    if (!success) return
    const phone = selectedClient?.phone || clientForm.phone
    if (!phone) return
    const text = `Factura ${success.eNCF || success.docNumber}\nTotal: ${fmtRD(success.total)}\n${success.qrLink ? `Verificar: ${success.qrLink}` : ''}`
    window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`, '_blank')
  }

  function resetForm() {
    confirmedRef.current = false
    setTipoECF('32')
    setSelectedClient(null)
    setNewClient(false)
    setClientForm({ name: '', rnc: '', phone: '', email: '', address: '' })
    setItems([{ ...EMPTY_ITEM }])
    setPaymentMethod('efectivo')
    setNotes('')
    setSellerId('')
    if (!(user?.role === 'cashier' && user?.id && user.id !== 'web' && cajeros.some(c => String(c.id) === String(user.id)))) {
      setCajeroId('')
    }
    setError(null)
    setSuccess(null)
    setRncResult(null)
  }

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

  return (
    <div className="p-3 sm:p-4 max-w-6xl mx-auto space-y-3">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/invoicing')} className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-slate-500 dark:text-white/50" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-white leading-tight">{L('Nueva Factura', 'New Invoice')}</h1>
          <p className="text-xs text-slate-500 dark:text-white/50">{L('Facturacion electronica e-CF', 'Electronic invoicing e-CF')}</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg p-3">
          <AlertCircle size={16} className="text-red-600 dark:text-red-400 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 space-y-3">
          {/* ── Card 1: Tipo + Cliente ─────────────────────────────────── */}
          <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 divide-y divide-slate-200 dark:divide-white/10">
          <div className="p-3">
            <h3 className="text-xs font-bold text-slate-700 dark:text-white mb-2 uppercase tracking-wider">{L('Tipo de Comprobante', 'Invoice Type')}</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setTipoECF('31')}
                className={`flex-1 px-3 py-2 rounded-lg border-2 text-center transition-all ${
                  tipoECF === '31' ? 'border-[#b3001e] bg-[#b3001e]/5' : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                }`}
              >
                <p className={`text-sm font-bold leading-tight ${tipoECF === '31' ? 'text-[#b3001e]' : 'text-slate-700 dark:text-white'}`}>E31</p>
                <p className="text-[11px] text-slate-500 dark:text-white/50 leading-tight">{L('Credito Fiscal (B2B)', 'Tax Credit (B2B)')}</p>
              </button>
              <button
                onClick={() => setTipoECF('32')}
                className={`flex-1 px-3 py-2 rounded-lg border-2 text-center transition-all ${
                  tipoECF === '32' ? 'border-[#b3001e] bg-[#b3001e]/5' : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                }`}
              >
                <p className={`text-sm font-bold leading-tight ${tipoECF === '32' ? 'text-[#b3001e]' : 'text-slate-700 dark:text-white'}`}>E32</p>
                <p className="text-[11px] text-slate-500 dark:text-white/50 leading-tight">{L('Consumidor Final (B2C)', 'Consumer Final (B2C)')}</p>
              </button>
            </div>
          </div>

          <div className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-700 dark:text-white uppercase tracking-wider">{L('Cliente', 'Client')}</h3>
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
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={e => { setClientSearch(e.target.value); setSelectedClient(null) }}
                    placeholder={L('Buscar por nombre, RNC o telefono...', 'Search by name, RNC or phone...')}
                    className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-white/30 outline-none focus:ring-2 focus:ring-[#b3001e]/30"
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
          </div>

          {/* ── Card 2: Items ──────────────────────────────────────────── */}
          <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 p-3 space-y-2">
            <h3 className="text-xs font-bold text-slate-700 dark:text-white uppercase tracking-wider">{L('Items', 'Items')}</h3>

            <div className="hidden sm:grid grid-cols-12 gap-2 text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider px-1">
              <div className="col-span-5">{L('Descripcion', 'Description')}</div>
              <div className="col-span-1 text-center">{L('Cant', 'Qty')}</div>
              <div className="col-span-2 text-right">{L('Precio', 'Price')}</div>
              <div className="col-span-1 text-center">{L('Exento', 'Exempt')}</div>
              <div className="col-span-2 text-right">Total</div>
              <div className="col-span-1"></div>
            </div>

            {items.map((item, idx) => {
              const rowTotal = Number(item.precio) * Number(item.cantidad || 1)
              const rowItbis = item.itbis ? rowTotal * itbisFactor : 0
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
                      title={item.itbis
                        ? L(`ITBIS ${itbisRate}% — click para marcar Exento`, `ITBIS ${itbisRate}% — click to mark Exempt`)
                        : L('Exento de ITBIS — click para aplicar ITBIS', 'ITBIS Exempt — click to apply ITBIS')}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-colors ${
                        item.itbis ? 'bg-[#b3001e]/10 text-[#b3001e]' : 'bg-slate-200 dark:bg-white/15 text-slate-600 dark:text-white/70'
                      }`}
                    >
                      {item.itbis ? `${itbisRate}%` : 'EX'}
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

          {/* ── Card 3: Comisiones + Opciones + Pago + Notas ──────────── */}
          <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 divide-y divide-slate-200 dark:divide-white/10">
            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-1">{L('Vendedor (opcional)', 'Seller (optional)')}</label>
                <select
                  value={sellerId}
                  onChange={e => setSellerId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                >
                  <option value="">{L('Ninguno', 'None')}</option>
                  {sellers.map(s => (
                    <option key={s.id} value={s.id}>{s.name} {s.commission_pct ? `- ${s.commission_pct}%` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-1">{L('Cajero (opcional)', 'Cashier (optional)')}</label>
                <select
                  value={cajeroId}
                  onChange={e => setCajeroId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                >
                  <option value="">{L('Ninguno', 'None')}</option>
                  {cajeros.map(c => (
                    <option key={c.id} value={c.id}>{c.name} {c.commission_pct ? `- ${c.commission_pct}%` : ''}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="p-3 flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={leyEnabled}
                  onChange={e => setLeyEnabled(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-[#b3001e] focus:ring-[#b3001e]/30"
                />
                <span className="text-sm font-bold text-slate-700 dark:text-white">{L('Aplicar Ley 10%', 'Apply 10% Service Charge')}</span>
                <span className="text-[11px] text-slate-500 dark:text-white/50 hidden sm:inline">— {L('propina sobre subtotal', 'tip on subtotal')}</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {PAYMENT_METHODS.map(pm => (
                  <button
                    key={pm.key}
                    onClick={() => setPaymentMethod(pm.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
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

            <div className="p-3">
              <label className="block text-[10px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-1">{L('Notas (opcional)', 'Notes (optional)')}</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={1}
                placeholder={L('Notas adicionales para la factura...', 'Additional invoice notes...')}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30 resize-none"
              />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 p-3 space-y-3 sticky top-4">
            <h3 className="text-xs font-bold text-slate-700 dark:text-white uppercase tracking-wider">{L('Resumen', 'Summary')}</h3>

            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-white/50">Subtotal</span>
                <span className="font-medium text-slate-800 dark:text-white">{fmtRD(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-white/50">ITBIS ({itbisRate}%)</span>
                <span className="font-medium text-slate-800 dark:text-white">{fmtRD(itbisTotal)}</span>
              </div>
              {leyAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500 dark:text-white/50">{L('Ley 10%', 'Service 10%')}</span>
                  <span className="font-medium text-slate-800 dark:text-white">{fmtRD(leyAmount)}</span>
                </div>
              )}
              <div className="h-px bg-slate-200 dark:bg-white/10" />
              <div className="flex justify-between text-lg">
                <span className="font-bold text-slate-800 dark:text-white">Total</span>
                <span className="font-extrabold text-[#b3001e]">{fmtRD(total)}</span>
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-white/5 rounded-lg p-2.5 space-y-1 border border-slate-100 dark:border-white/5">
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
