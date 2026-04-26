import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Plus, Trash2, Search, Check, AlertCircle, Download, Send, Loader2, ArrowLeft, Mail, BookmarkPlus, Bookmark } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import { useAuth } from '../../context/AuthContext'
import { signAndSubmitECF, validateRNC } from '@terminal-x/services/ecf'
import { waLink } from '@terminal-x/services/whatsapp'
const saveReceiptPDF = (...args) => import('@terminal-x/services/pdf').then(m => m.saveReceiptPDF(...args))

function fmtRD(n) {
  return 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// M2 — placeholder for the per-render currency formatter. The component
// uses displayCurrency-aware fmt() which closes over state below.

// M2 — supported invoice currencies. DOP is the DGII-required base; USD is
// the most common foreign currency in DR. Adding a third currency is one
// row + one entry in OtraMoneda payload.
const CURRENCIES = [
  { code: 'DOP', symbol: 'RD$', es: 'Pesos (DOP)', en: 'Dominican Pesos (DOP)' },
  { code: 'USD', symbol: 'US$', es: 'Dólares (USD)', en: 'US Dollars (USD)' },
]
function fmtMoney(n, code) {
  const c = CURRENCIES.find(x => x.code === code) || CURRENCIES[0]
  return c.symbol + ' ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
// H3 — supported ITBIS rates per DGII e-CF spec.
//   1 = Tasa General (18%)
//   2 = Tasa Reducida (16%)
//   3 = Tasa 0% (exportación)
//   4 = Exento
const ITBIS_OPTIONS = [
  { code: '1', rate: 18, label_es: '18%',    label_en: '18%' },
  { code: '2', rate: 16, label_es: '16%',    label_en: '16%' },
  { code: '3', rate: 0,  label_es: '0%',     label_en: '0%'  },
  { code: '4', rate: 0,  label_es: 'Exento', label_en: 'Exempt' },
]
function itbisOptByCode(code) { return ITBIS_OPTIONS.find(o => o.code === String(code)) || ITBIS_OPTIONS[0] }
const EMPTY_ITEM = { descripcion: '', cantidad: 1, precio: 0, itbisCode: '1', descuentoPct: 0 }

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

  // H2 — Global discount. Operator chooses RD$ amount OR % off subtotal.
  // Stored as { mode: 'pct' | 'amount', value: number }; applied AFTER per-line
  // discounts and BEFORE ITBIS so the DGII MontoGravadoTotal lines up with the
  // discounted subtotal (DGII spec §3.2 — `MontoDescuento` reduces base).
  const [descuentoMode, setDescuentoMode] = useState('amount')
  const [descuentoInput, setDescuentoInput] = useState(0)

  // M2 — Currency + exchange rate. Prices on screen are entered in the
  // displayCurrency. The e-CF total stays in DOP (DGII rule); USD invoices
  // emit an OtraMoneda block with TipoMoneda='USD' and the snapshot rate.
  const [displayCurrency, setDisplayCurrency] = useState('DOP')
  const [usdRate, setUsdRate] = useState(60) // default DOP/USD; user can edit before emit

  // Settings-driven fiscal rates. itbis_pct lives in app_settings (string),
  // default 18. ley_enabled is the per-business default for the Ley 10% toggle.
  const [itbisRate, setItbisRate] = useState(18)
  const [leyEnabled, setLeyEnabled] = useState(false)
  // Branding pulled from app_settings — populated below alongside itbisRate.
  const [invoiceFooter, setInvoiceFooter] = useState('')
  const [bizLogo, setBizLogo] = useState('')

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

  // C3 — cert expiry awareness. Loaded alongside settings; used to block
  // emission and surface a crimson banner when expired or ≤7d to expiry.
  const [certInfo, setCertInfo] = useState(null)

  // M1 — track which quote (if any) seeded this invoice, so we can delete it
  // from localStorage after a successful emission.
  const [sourceQuoteId, setSourceQuoteId] = useState(null)

  // ── Item Templates / Favorites ──────────────────────────────────────────
  // Stored in localStorage (same scope as Cotizaciones) so the operator can
  // save a recurring item set ("Servicio mensual de contabilidad", "Hosting
  // anual…") and pre-load it with one click. Same shape as item rows.
  const TEMPLATE_KEY = 'tx.facturacion.itemTemplates'
  const [templates, setTemplatesState] = useState([])
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  function loadTemplates() {
    try {
      const raw = localStorage.getItem(TEMPLATE_KEY)
      const arr = raw ? JSON.parse(raw) : []
      return Array.isArray(arr) ? arr : []
    } catch { return [] }
  }
  useEffect(() => { setTemplatesState(loadTemplates()) }, [])
  function saveTemplate() {
    const usableItems = items.filter(i => i.descripcion?.trim())
    if (!usableItems.length) {
      alert(L('Agrega al menos un item antes de guardar la plantilla.', 'Add at least one item before saving the template.'))
      return
    }
    const name = window.prompt(L('Nombre de la plantilla:', 'Template name:'), '')?.trim()
    if (!name) return
    const tpl = {
      id: 't_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36),
      name,
      items: usableItems.map(i => ({
        descripcion: i.descripcion,
        cantidad: Number(i.cantidad || 1),
        precio: Number(i.precio || 0),
        itbisCode: i.itbisCode || '1',
        descuentoPct: Number(i.descuentoPct || 0),
      })),
      createdAt: Date.now(),
    }
    const next = [tpl, ...templates]
    try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(next)) } catch {}
    setTemplatesState(next)
    alert(L('Plantilla guardada.', 'Template saved.'))
  }
  function applyTemplate(tpl) {
    if (!tpl?.items?.length) return
    setItems(tpl.items.map(i => ({ ...i })))
    setShowTemplatePicker(false)
  }
  function removeTemplate(id) {
    const next = templates.filter(t => t.id !== id)
    try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(next)) } catch {}
    setTemplatesState(next)
  }

  const confirmedRef = useRef(false)

  // M1 — hydrate from a pending quote handed off via sessionStorage by
  // InvoiceQuotes.jsx. Runs once on mount, then clears the slot so a refresh
  // doesn't re-prefill.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('tx.facturacion.pendingQuote')
      if (!raw) return
      sessionStorage.removeItem('tx.facturacion.pendingQuote')
      const q = JSON.parse(raw)
      if (Array.isArray(q?.items) && q.items.length) {
        setItems(q.items.map(i => ({
          descripcion: i.descripcion || '',
          cantidad: Number(i.cantidad || 1),
          precio: Number(i.precio || 0),
          itbisCode: i.itbisCode || '1',
          descuentoPct: Number(i.descuentoPct || 0),
        })))
      }
      if (q.clientName || q.clientRnc || q.clientPhone || q.clientEmail) {
        setNewClient(true)
        setClientForm({
          name: q.clientName || '',
          rnc: q.clientRnc || '',
          phone: q.clientPhone || '',
          email: q.clientEmail || '',
          address: '',
        })
      }
      if (q.notes) setNotes(q.notes)
      if (q.sourceQuoteId) setSourceQuoteId(q.sourceQuoteId)
    } catch {}
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [cls, emp, settings, sls, usrs, cert] = await Promise.all([
        api?.clients?.all?.() || [],
        api?.admin?.getEmpresa?.() || null,
        api?.settings?.get?.() || {},
        api?.sellers?.all?.() || [],
        api?.users?.all?.() || [],
        api?.dgii_ecf?.certInfo?.() || null,
      ])
      if (cancelled) return
      setClients(cls || [])
      setEmpresa(emp)
      setCertInfo(cert)
      const pct = Number(settings?.itbis_pct)
      if (Number.isFinite(pct) && pct > 0) setItbisRate(pct)
      const leyDefault = String(settings?.ley_enabled ?? '').toLowerCase()
      setLeyEnabled(leyDefault === 'true' || leyDefault === '1')
      setInvoiceFooter(settings?.invoice_footer || '')
      setBizLogo(settings?.logo_url || settings?.biz_logo || '')
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

  // Per-line math helper. Honors the chosen ITBIS code (H3) and per-line
  // descuentoPct (H2). Falls back gracefully when legacy `itbis` boolean
  // shape is present so existing demo seed rows keep working.
  function lineMath(i, generalItbisPct) {
    const code = String(i.itbisCode || (i.itbis === false ? '4' : '1'))
    const opt  = itbisOptByCode(code)
    const ratePct = code === '1' ? Number(generalItbisPct ?? 18) : opt.rate
    const qty   = Number(i.cantidad || 1)
    const price = Number(i.precio || 0)
    const gross = price * qty
    const dPct  = Math.max(0, Math.min(100, Number(i.descuentoPct || 0)))
    const lineDescuento = gross * dPct / 100
    const net   = Math.max(0, gross - lineDescuento)
    const itbis = net * (ratePct / 100)
    return { code, ratePct, qty, price, gross, lineDescuento, net, itbis, total: net + itbis }
  }

  const totals = useMemo(() => {
    let sumGross = 0, sumLineDescuento = 0, sumNet = 0
    let netByCode = { '1': 0, '2': 0, '3': 0, '4': 0 }
    let itbisByCode = { '1': 0, '2': 0, '3': 0, '4': 0 }
    for (const i of items) {
      if (!i.descripcion?.trim() || !Number(i.precio)) continue
      const m = lineMath(i, itbisRate)
      sumGross += m.gross
      sumLineDescuento += m.lineDescuento
      sumNet += m.net
      netByCode[m.code]   = (netByCode[m.code]   || 0) + m.net
      itbisByCode[m.code] = (itbisByCode[m.code] || 0) + m.itbis
    }
    // Global discount — applied to the post-line-discount net subtotal.
    const dInput = Number(descuentoInput || 0)
    const globalDescuento = descuentoMode === 'pct'
      ? sumNet * Math.max(0, Math.min(100, dInput)) / 100
      : Math.max(0, Math.min(sumNet, dInput))
    // Spread global discount proportionally across rate buckets so the e-CF
    // MontoGravadoI1/I2/I3/Exento stays internally consistent.
    let netByCodeAfter = { ...netByCode }
    let itbisByCodeAfter = { ...itbisByCode }
    if (globalDescuento > 0 && sumNet > 0) {
      const factor = (sumNet - globalDescuento) / sumNet
      for (const c of ['1','2','3','4']) {
        netByCodeAfter[c]   = netByCode[c] * factor
        itbisByCodeAfter[c] = itbisByCode[c] * factor
      }
    }
    const subtotalAfter = Object.values(netByCodeAfter).reduce((a,b) => a + b, 0)
    const itbisTotal    = Object.values(itbisByCodeAfter).reduce((a,b) => a + b, 0)
    const leyAmount     = leyEnabled ? subtotalAfter * LEY_RATE : 0
    const total         = subtotalAfter + itbisTotal + leyAmount
    return {
      sumGross,
      sumLineDescuento,
      globalDescuento,
      subtotal: subtotalAfter,
      itbisTotal,
      leyAmount,
      total,
      // for e-CF payload split
      gravado18: netByCodeAfter['1'] || 0, itbis18: itbisByCodeAfter['1'] || 0,
      gravado16: netByCodeAfter['2'] || 0, itbis16: itbisByCodeAfter['2'] || 0,
      gravado0:  netByCodeAfter['3'] || 0,
      exento:    netByCodeAfter['4'] || 0,
    }
  }, [items, itbisFactor, itbisRate, leyEnabled, descuentoMode, descuentoInput])

  // Backwards-compat aliases consumed by Resumen + success view.
  const subtotal   = totals.subtotal
  const itbisTotal = totals.itbisTotal
  const leyAmount  = totals.leyAmount
  const total      = totals.total
  const totalDescuento = totals.sumLineDescuento + totals.globalDescuento

  function validate() {
    const validItems = items.filter(i => i.descripcion.trim() && Number(i.precio) > 0)
    if (validItems.length === 0) return L('Agrega al menos un item con descripcion y precio', 'Add at least one item with description and price')
    if (total <= 0) return L('El total debe ser mayor a 0', 'Total must be greater than 0')
    if (tipoECF === '31') {
      const rnc = selectedClient?.rnc || clientForm.rnc
      if (!rnc || !validateRNC(rnc)) return L('E31 (Credito Fiscal) requiere un RNC valido del comprador', 'E31 (Tax Credit) requires a valid buyer RNC')
      // E31 fix from audit §5/C5 — must have a real razón social, never the RNC
      const name = (selectedClient?.name || clientForm.name || '').trim()
      if (!name) return L('E31 (Credito Fiscal) requiere el nombre / razón social del comprador', 'E31 (Tax Credit) requires the buyer name / legal name')
    }
    // C3 hard-stop — refuse emission when cert expired, otherwise DGII rejects
    // and we burn a sequence number for nothing.
    if (certInfo?.installed && (certInfo?.expired || isCertExpired(certInfo?.expiry))) {
      return L('Tu certificado e-CF está vencido. Renueva con Viafirma antes de emitir.', 'Your e-CF certificate has expired. Renew with Viafirma before issuing.')
    }
    return null
  }

  function isCertExpired(expiry) {
    if (!expiry) return false
    const t = new Date(expiry).getTime()
    return Number.isFinite(t) && t < Date.now()
  }

  async function handleSubmit() {
    if (confirmedRef.current || submitting) return
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setError(null)
    setSubmitting(true)

    // C1 rollback bookkeeping — track everything we reserve so the catch path
    // can unwind atomically: the eNCF counter, the local ticket row, and any
    // partial commission writes. If the e-CF never reaches DGII (network drop,
    // cert error, signing failure) we MUST not leave a sequence gap or an
    // orphan `tickets` row with null ecf_result.
    let reservedENCF = null
    let reservedNcfType = null
    let createdTicketId = null
    let ecfSucceeded = false

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

      const ticketItems = validItems.map(item => {
        const m = lineMath(item, itbisRate)
        return {
          name: item.descripcion,
          price: Number(item.precio),
          quantity: Number(item.cantidad || 1),
          // aplica_itbis: anything not '4' is taxable for downstream reports.
          aplica_itbis: m.code === '4' ? 0 : 1,
          itbis_code: m.code,
          itbis_pct: m.ratePct,
          descuento_pct: Number(item.descuentoPct || 0),
          is_wash: false,
        }
      })

      // Use the shared `totals` memo so what the user saw on screen is what
      // gets written to ticket + e-CF — no recompute drift.
      const itemSubtotal = totals.subtotal
      const itemItbis    = totals.itbisTotal
      const itemLey      = totals.leyAmount
      const itemTotal    = totals.total
      const itemDescuento = totals.sumLineDescuento + totals.globalDescuento

      const ncfType = `E${tipoECF}`
      let eNCF = null
      try {
        eNCF = await api?.ncf?.next?.(ncfType)
      } catch {
        throw new Error(L('No se pudo obtener el proximo e-NCF. Verifique las secuencias.', 'Could not get next e-NCF. Check sequences.'))
      }
      if (!eNCF) throw new Error(L('Secuencia e-NCF no disponible', 'e-NCF sequence not available'))
      reservedENCF = eNCF
      reservedNcfType = ncfType

      // NB: seller_id / cajero_id / washer_ids are intentionally NOT passed
      // into ticketCreate — invoice commissions use the flat `invoiceTotal *
      // comision_pct / 100` model and are written below via the dedicated
      // sellerCommissions.create / cajeroCommissions.create endpoints.
      // Washers don't apply to standalone invoices.
      // Save the DOP-equivalent on the ticket (DGII canonical) — Historial /
      // 606/607 reads this. Currency + FX rate live in metadata for receipts.
      const ticketData = {
        items: ticketItems,
        subtotal: parseFloat((itemSubtotal * (displayCurrency === 'USD' ? Number(usdRate || 60) : 1)).toFixed(2)),
        itbis:    parseFloat((itemItbis    * (displayCurrency === 'USD' ? Number(usdRate || 60) : 1)).toFixed(2)),
        ley:      parseFloat((itemLey      * (displayCurrency === 'USD' ? Number(usdRate || 60) : 1)).toFixed(2)),
        descuento:parseFloat((itemDescuento* (displayCurrency === 'USD' ? Number(usdRate || 60) : 1)).toFixed(2)),
        total:    parseFloat((itemTotal    * (displayCurrency === 'USD' ? Number(usdRate || 60) : 1)).toFixed(2)),
        currency: displayCurrency,
        fx_rate:  displayCurrency === 'DOP' ? 1 : Number(usdRate || 60),
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
      createdTicketId = ticketResult.id
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

      // M2 — DGII requires DOP as base. When invoice was entered in USD we
      // multiply per-line nets and totals by usdRate to get the DOP-equivalent
      // numbers DGII validates against, then attach an OtraMoneda block with
      // the original USD totals + snapshot rate.
      const fxRate = displayCurrency === 'USD' ? Number(usdRate || 60) : 1
      const ecfItems = validItems.map(item => {
        const m = lineMath(item, itbisRate)
        const unitDop = m.qty > 0 ? (m.net / m.qty) * fxRate : Number(item.precio || 0) * fxRate
        return {
          nombre: item.descripcion,
          precio: Number(unitDop.toFixed(4)),
          cantidad: m.qty,
          indicadorFacturacion: m.code,
          indicadorBienoServicio: '2',
        }
      })

      const ecfInvoiceData = {
        tipoECF,
        eNCF,
        emisor,
        comprador,
        items: ecfItems,
        totales: {
          // M2 — DOP-equivalent totals reach DGII regardless of display currency.
          subtotal: parseFloat((itemSubtotal * fxRate).toFixed(2)),
          itbis: parseFloat((itemItbis * fxRate).toFixed(2)),
          ley: parseFloat((itemLey * fxRate).toFixed(2)),
          total: parseFloat((itemTotal * fxRate).toFixed(2)),
          // H2/H3 — split totals for multi-rate compliance.
          montoDescuentoTotal: parseFloat((itemDescuento * fxRate).toFixed(2)),
          gravado18: parseFloat((totals.gravado18 * fxRate).toFixed(2)),
          itbis18:   parseFloat((totals.itbis18   * fxRate).toFixed(2)),
          gravado16: parseFloat((totals.gravado16 * fxRate).toFixed(2)),
          itbis16:   parseFloat((totals.itbis16   * fxRate).toFixed(2)),
          gravado0:  parseFloat((totals.gravado0  * fxRate).toFixed(2)),
          exento:    parseFloat((totals.exento    * fxRate).toFixed(2)),
        },
        metodoPago: paymentMethod,
        tipoIngresos: '01',
        ticket: { id: ticketResult.id },
        // M2 — OtraMoneda when invoice currency != DOP.
        ...(displayCurrency !== 'DOP' ? {
          otraMoneda: {
            tipoMoneda: displayCurrency,
            tipoCambio: Number(fxRate.toFixed(4)),
            montoTotalOtraMoneda: parseFloat(itemTotal.toFixed(2)),
          },
        } : {}),
      }

      const ecfResult = await signAndSubmitECF(ecfInvoiceData, api)
      // Anything other than ACEPTADO / ACEPTADO_CONDICIONAL / EN_PROCESO with a
      // trackId is a hard failure — bail before persisting so the catch unwinds.
      if (!ecfResult || (!ecfResult.eNCF && !ecfResult.trackId && !ecfResult._stub)) {
        throw new Error(L('La DGII no aceptó el e-CF. Intente de nuevo.', 'DGII did not accept the e-CF. Please retry.'))
      }
      if (ecfResult.status === 'RECHAZADO') {
        throw new Error(L(`e-CF rechazado por DGII: ${ecfResult.dgiiCodigo || ''}`, `e-CF rejected by DGII: ${ecfResult.dgiiCodigo || ''}`))
      }
      ecfSucceeded = true

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

      // M1 — remove the source quote from localStorage now that it became a
      // real factura. Best-effort, never fails the success view.
      if (sourceQuoteId) {
        try {
          const raw = localStorage.getItem('tx.facturacion.quotes')
          const arr = raw ? JSON.parse(raw) : []
          const next = Array.isArray(arr) ? arr.filter(x => x.id !== sourceQuoteId) : []
          localStorage.setItem('tx.facturacion.quotes', JSON.stringify(next))
        } catch {}
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
        subtotal: itemSubtotal,
        itbis: itemItbis,
        ley: itemLey,
        descuento: itemDescuento,
        clientName,
        clientEmail: selectedClient?.email || clientForm.email || '',
        clientPhone: selectedClient?.phone || clientForm.phone || '',
        ecfResult,
      })
    } catch (err) {
      // ── C1 atomic rollback ──────────────────────────────────────────────
      // If the e-CF never reached DGII (i.e. ecfSucceeded is false), undo
      // every side-effect we created BEFORE persisting state to the user:
      //   1. Soft-void the orphan ticket so Historial doesn't show a
      //      half-baked factura with a null eNCF.
      //   2. Roll back the ncf_sequence counter (only succeeds if this was
      //      the last issued and no DGII trackId was minted).
      // 72h offline queue resilience: if e-CF DID succeed and only the
      // ticket update / activity log failed, we KEEP the eNCF (DGII already
      // owns it) — the queue will reconcile via processDgiiQueue on desktop
      // or the EN_PROCESO reconciler on web (FIX-C7).
      if (!ecfSucceeded) {
        if (createdTicketId) {
          try {
            await api?.tickets?.void?.({ id: createdTicketId, reason: 'e-CF rollback (no DGII)', voidById: user?.id })
          } catch (e) { console.error('[InvoiceCreate] rollback void failed:', e?.message) }
        }
        if (reservedENCF) {
          try {
            const r = await api?.ncf?.rollback?.(reservedENCF)
            if (!r?.decremented) {
              console.warn('[InvoiceCreate] eNCF rollback skipped:', r?.reason, reservedENCF)
            }
          } catch (e) { console.error('[InvoiceCreate] rollback ncf failed:', e?.message) }
        }
      }
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
      formaPago: PAYMENT_METHODS.find(p => p.key === paymentMethod)?.es || paymentMethod,
      services: items.filter(i => i.descripcion.trim()).map(i => {
        const m = lineMath(i, itbisRate)
        return { name: i.descripcion, price: m.qty > 0 ? m.net / m.qty : Number(i.precio || 0), qty: m.qty }
      }),
      descuento: success.descuento,
      biz: {
        name: empresa?.name || '',
        rnc: empresa?.rnc || '',
        phone: empresa?.phone || '',
        address: empresa?.address || '',
        // Facturación-tier custom branding — sourced from app_settings via
        // the settings loader above. PDF builder ignores empty strings.
        logo: bizLogo,
        invoice_footer: invoiceFooter,
      },
      customFooter: invoiceFooter,
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
    window.open(waLink(phone, text), '_blank')
  }

  // FIX-H5 — server-first email send via /api/panel?action=email-invoice; on
  // 501 (RESEND_API_KEY not configured) we open a pre-filled mailto: so the
  // operator's mail client takes over. Either way the user gets confirmation.
  const [emailSending, setEmailSending] = useState(false)
  async function sendEmail() {
    if (!success) return
    let recipient = success.clientEmail || ''
    if (!recipient) {
      recipient = window.prompt(L('Correo del cliente:', 'Client email:'), '') || ''
    }
    recipient = recipient.trim()
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      alert(L('Correo inválido. La factura no fue enviada.', 'Invalid email. Invoice was not sent.'))
      return
    }
    setEmailSending(true)
    try {
      const sender = api?.dgii_ecf // session-aware fetch lives here
      // Inline fetch so we don't have to plumb a new method through the API.
      let token = null
      if (typeof window !== 'undefined' && window.supabase) {
        try { token = (await window.supabase.auth.getSession())?.data?.session?.access_token } catch {}
      }
      // Fallback: read from packages/services/supabase singleton.
      if (!token) {
        try {
          const mod = await import('@terminal-x/services/supabase')
          const client = mod.getSupabaseClient?.()
          token = (await client?.auth.getSession())?.data?.session?.access_token
        } catch {}
      }
      if (!token) { alert(L('Sesión expirada. Vuelve a iniciar sesión.', 'Session expired. Please log in again.')); return }
      const business_id = empresa?.id || empresa?.supabase_id || null
      const r = await fetch('/api/panel?action=email-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          business_id,
          to: recipient,
          subject: `Factura ${success.eNCF || success.docNumber} — ${empresa?.name || ''}`,
          eNCF: success.eNCF,
          total: success.total,
          qrLink: success.qrLink,
          securityCode: success.securityCode,
          bizName: empresa?.name || '',
          clientName: success.clientName || '',
        }),
      })
      const result = await r.json().catch(() => ({}))
      if (r.ok && result.ok) {
        alert(L('Factura enviada por correo.', 'Invoice emailed successfully.'))
      } else if (r.status === 501 || result?.fallback === 'mailto') {
        // Graceful fallback — open the operator's default mail client.
        const subject = encodeURIComponent(`Factura ${success.eNCF}`)
        const body = encodeURIComponent(`Hola ${success.clientName || ''},\n\nTe comparto tu comprobante fiscal:\n\neNCF: ${success.eNCF}\nTotal: ${fmtRD(success.total)}\n${success.qrLink ? `Verificar: ${success.qrLink}` : ''}\n\nGracias por tu compra.\n— ${empresa?.name || ''}`)
        window.location.href = `mailto:${recipient}?subject=${subject}&body=${body}`
      } else {
        alert(L('No se pudo enviar el correo: ', 'Could not send email: ') + (result?.error || r.statusText))
      }
    } catch (err) {
      alert(L('Error de red al enviar correo.', 'Network error sending email.'))
    } finally {
      setEmailSending(false)
    }
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
    setDescuentoMode('amount')
    setDescuentoInput(0)
    setDisplayCurrency('DOP')
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
            <button onClick={sendEmail} disabled={emailSending} className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-slate-700 dark:text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50">
              {emailSending ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
              {L('Enviar por Email', 'Send by Email')}
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

      {certInfo?.installed && (certInfo?.expired || isCertExpired(certInfo?.expiry)) && (
        <div className="flex items-center gap-2 bg-[#b3001e]/5 border border-[#b3001e]/30 rounded-lg p-3">
          <AlertCircle size={16} className="text-[#b3001e] shrink-0" />
          <p className="text-sm font-bold text-[#b3001e]">{L('Certificado e-CF vencido — no se puede emitir hasta renovar.', 'e-CF certificate expired — cannot issue until renewed.')}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 space-y-3">
          {/* ── Card 1: Tipo + Cliente ─────────────────────────────────── */}
          <div className="bg-white dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 divide-y divide-slate-200 dark:divide-white/10">
          <div className="p-3 flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-xs font-bold text-slate-700 dark:text-white uppercase tracking-wider">{L('Moneda', 'Currency')}</h3>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
                {CURRENCIES.map(c => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => setDisplayCurrency(c.code)}
                    className={`px-3 py-1.5 text-xs font-bold transition-colors ${displayCurrency === c.code ? 'bg-[#b3001e] text-white' : 'bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-white/60'}`}
                  >{c.code}</button>
                ))}
              </div>
              {displayCurrency === 'USD' && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50">{L('Tasa', 'Rate')}</span>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={usdRate}
                    onChange={e => setUsdRate(Math.max(1, parseFloat(e.target.value) || 60))}
                    className="w-20 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-right text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                  />
                  <span className="text-[11px] text-slate-400">DOP/USD</span>
                </div>
              )}
            </div>
          </div>

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
                    style={{ paddingLeft: 40 }}
                    className="w-full pr-4 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-white/30 outline-none focus:ring-2 focus:ring-[#b3001e]/30"
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
              <div className="col-span-4">{L('Descripcion', 'Description')}</div>
              <div className="col-span-1 text-center">{L('Cant', 'Qty')}</div>
              <div className="col-span-2 text-right">{L('Precio', 'Price')}</div>
              <div className="col-span-1 text-center">{L('Desc %', 'Disc %')}</div>
              <div className="col-span-1 text-center">ITBIS</div>
              <div className="col-span-2 text-right">Total</div>
              <div className="col-span-1"></div>
            </div>

            {items.map((item, idx) => {
              const m = lineMath(item, itbisRate)
              return (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    type="text"
                    value={item.descripcion}
                    onChange={e => updateItem(idx, 'descripcion', e.target.value)}
                    placeholder={L('Descripcion del servicio o producto', 'Service or product description')}
                    className="col-span-12 sm:col-span-4 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                  />
                  <input
                    type="number"
                    min="1"
                    value={item.cantidad}
                    onChange={e => updateItem(idx, 'cantidad', Math.max(1, parseInt(e.target.value, 10) || 1))}
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
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={item.descuentoPct || ''}
                    onChange={e => updateItem(idx, 'descuentoPct', Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                    placeholder="0"
                    title={L('Descuento por línea (%)', 'Per-line discount (%)')}
                    className="col-span-2 sm:col-span-1 px-2 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-center text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                  />
                  <div className="col-span-2 sm:col-span-1 flex justify-center">
                    <select
                      value={item.itbisCode || (item.itbis === false ? '4' : '1')}
                      onChange={e => updateItem(idx, 'itbisCode', e.target.value)}
                      title={L('Tasa ITBIS', 'ITBIS rate')}
                      className="w-full px-1 py-2 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[11px] font-bold text-center text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                    >
                      {ITBIS_OPTIONS.map(opt => (
                        <option key={opt.code} value={opt.code}>{lang === 'es' ? opt.label_es : opt.label_en}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2 sm:col-span-2 text-right text-sm font-medium text-slate-800 dark:text-white">
                    {fmtMoney(m.total, displayCurrency)}
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <button onClick={() => removeItem(idx)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors" disabled={items.length <= 1}>
                      <Trash2 size={14} className={items.length <= 1 ? 'text-slate-300 dark:text-white/10' : 'text-red-500'} />
                    </button>
                  </div>
                </div>
              )
            })}

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={addItem}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[#b3001e] hover:bg-[#b3001e]/5 rounded-lg transition-colors"
              >
                <Plus size={16} /> {L('Agregar Item', 'Add Item')}
              </button>
              <button
                onClick={() => setShowTemplatePicker(v => !v)}
                disabled={!templates.length}
                title={L('Cargar una plantilla guardada', 'Load a saved template')}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors disabled:opacity-40"
              >
                <Bookmark size={16} /> {L('Plantillas', 'Templates')} {templates.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-white/10">{templates.length}</span>}
              </button>
              <button
                onClick={saveTemplate}
                title={L('Guardar items actuales como plantilla', 'Save current items as a template')}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors"
              >
                <BookmarkPlus size={16} /> {L('Guardar plantilla', 'Save template')}
              </button>
            </div>

            {showTemplatePicker && templates.length > 0 && (
              <div className="mt-2 rounded-lg border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/5 max-h-56 overflow-y-auto">
                {templates.map(tpl => (
                  <div key={tpl.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-white/5">
                    <button onClick={() => applyTemplate(tpl)} className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{tpl.name}</p>
                      <p className="text-xs text-slate-500 dark:text-white/50">{tpl.items.length} {L('items', 'items')}</p>
                    </button>
                    <button onClick={() => applyTemplate(tpl)} className="px-2.5 py-1 rounded-md bg-[#b3001e] hover:bg-[#8c0017] text-white text-xs font-bold transition-colors">
                      {L('Cargar', 'Load')}
                    </button>
                    <button onClick={() => removeTemplate(tpl.id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors" title={L('Eliminar', 'Delete')}>
                      <Trash2 size={14} className="text-red-500" />
                    </button>
                  </div>
                ))}
              </div>
            )}
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

            <div className="p-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none mr-auto">
                <input
                  type="checkbox"
                  checked={leyEnabled}
                  onChange={e => setLeyEnabled(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-[#b3001e] focus:ring-[#b3001e]/30"
                />
                <span className="text-sm font-bold text-slate-700 dark:text-white">{L('Aplicar Ley 10%', 'Apply 10% Service Charge')}</span>
                <span className="text-[11px] text-slate-500 dark:text-white/50 hidden sm:inline">— {L('propina sobre subtotal', 'tip on subtotal')}</span>
              </label>

              {/* H2 — global descuento */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/50">{L('Descuento Global', 'Global Discount')}</span>
                <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setDescuentoMode('amount')}
                    className={`px-2 py-1.5 text-[11px] font-bold transition-colors ${descuentoMode === 'amount' ? 'bg-[#b3001e] text-white' : 'bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-white/60'}`}
                  >RD$</button>
                  <button
                    type="button"
                    onClick={() => setDescuentoMode('pct')}
                    className={`px-2 py-1.5 text-[11px] font-bold transition-colors ${descuentoMode === 'pct' ? 'bg-[#b3001e] text-white' : 'bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-white/60'}`}
                  >%</button>
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={descuentoInput || ''}
                  onChange={e => setDescuentoInput(Math.max(0, parseFloat(e.target.value) || 0))}
                  placeholder="0"
                  className="w-24 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-sm text-right text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#b3001e]/30"
                />
              </div>
            </div>

            <div className="p-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] text-slate-500 dark:text-white/50">{L('Forma de pago', 'Payment method')}</span>
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
              {totals.sumGross > 0 && totalDescuento > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500 dark:text-white/50">{L('Bruto', 'Gross')}</span>
                  <span className="text-slate-500 dark:text-white/50 line-through">{fmtMoney(totals.sumGross, displayCurrency)}</span>
                </div>
              )}
              {totalDescuento > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-[#b3001e] font-semibold">{L('Descuento', 'Discount')}</span>
                  <span className="font-semibold text-[#b3001e]">−{fmtMoney(totalDescuento, displayCurrency)}</span>
                </div>
              )}
              {displayCurrency !== 'DOP' && (
                <div className="flex justify-between text-[11px] pt-1 border-t border-dashed border-slate-200 dark:border-white/10">
                  <span className="text-slate-400 dark:text-white/40">{L('Equivalente DOP', 'DOP equivalent')}</span>
                  <span className="text-slate-500 dark:text-white/50">RD$ {Number(total * Number(usdRate || 60)).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-white/50">Subtotal</span>
                <span className="font-medium text-slate-800 dark:text-white">{fmtMoney(subtotal, displayCurrency)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-white/50">ITBIS</span>
                <span className="font-medium text-slate-800 dark:text-white">{fmtMoney(itbisTotal, displayCurrency)}</span>
              </div>
              {leyAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500 dark:text-white/50">{L('Ley 10%', 'Service 10%')}</span>
                  <span className="font-medium text-slate-800 dark:text-white">{fmtMoney(leyAmount, displayCurrency)}</span>
                </div>
              )}
              <div className="h-px bg-slate-200 dark:bg-white/10" />
              <div className="flex justify-between text-lg">
                <span className="font-bold text-slate-800 dark:text-white">Total</span>
                <span className="font-extrabold text-[#b3001e]">{fmtMoney(total, displayCurrency)}</span>
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
