/**
 * QuotePdfModal.jsx — M5 (v2.16.2 Sprint 2E).
 *
 * Pre-sale quote PDF for the concesionario vertical. Triggered from
 * DealBuilder's Resumen step BEFORE CobrarModal opens. Renders a preview
 * (dealer info, client info, vehicle details, pricing, financing, notes,
 * validity) and emits an A4 PDF via dynamic pdf-lib import. No DB record.
 *
 * Filename: Cotizacion-{stockNumber}-{clientName}-{yyyymmdd}.pdf
 * Crimson #b3001e header band matches the rest of the dealership PDFs.
 */

import { useState, useMemo } from 'react'
import { X, Download, FileText, Loader2 } from 'lucide-react'
import { useAPI } from '../../../context/DataContext'
import { useLang } from '../../../i18n'

const fmtMoney = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' })

function safeFile(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'sin-id'
}

function todayStamp() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function QuotePdfModal({
  vehicle,
  client,
  salesperson,
  salePrice,
  tradeInValue = 0,
  downPayment = 0,
  aprAnnual = 0,
  termMonths = 0,
  monthlyPayment = 0,
  notes = '',
  onClose,
}) {
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [validityDays, setValidityDays] = useState(7)
  const [extraNotes, setExtraNotes] = useState('')
  const [exporting, setExporting] = useState(false)
  const [empresa, setEmpresa] = useState(null)

  useMemo(() => {
    let cancelled = false
    ;(async () => {
      try {
        const e = await api?.admin?.getEmpresa?.()
        if (!cancelled) setEmpresa(e || null)
      } catch {}
    })()
    return () => { cancelled = true }
  }, [api])

  const validityDate = useMemo(() => {
    const d = new Date(Date.now() + Math.max(1, Number(validityDays) || 7) * 86400000)
    return d
  }, [validityDays])

  const stockNumber = vehicle?.stock_number || vehicle?.vin || vehicle?.id || ''
  const vehicleLabel = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ').trim()
    : ''

  async function exportPDF() {
    setExporting(true)
    try {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
      const pdf = await PDFDocument.create()
      const page = pdf.addPage([595.28, 841.89]) // A4
      const font = await pdf.embedFont(StandardFonts.Helvetica)
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
      const { width, height } = page.getSize()
      let y = height - 50

      // Crimson header band
      page.drawRectangle({ x: 0, y: y - 10, width, height: 50, color: rgb(0.7019, 0, 0.1176) })
      page.drawText(L('COTIZACION DE VEHICULO', 'VEHICLE QUOTE'), {
        x: 40, y: y + 15, size: 18, font: bold, color: rgb(1, 1, 1),
      })
      page.drawText(`${L('Vence', 'Expires')}: ${validityDate.toLocaleDateString('es-DO')}`, {
        x: width - 200, y: y + 15, size: 10, font, color: rgb(1, 1, 1),
      })
      y -= 40

      function line(text, opts = {}) {
        page.drawText(String(text || ''), { x: opts.x ?? 40, y, size: opts.size || 10, font: opts.bold ? bold : font, color: opts.color || rgb(0.1, 0.1, 0.1) })
        y -= opts.gap ?? 14
      }
      function section(title) {
        y -= 6
        page.drawLine({ start: { x: 40, y: y + 10 }, end: { x: width - 40, y: y + 10 }, thickness: 0.5, color: rgb(0.7019, 0, 0.1176) })
        page.drawText(title, { x: 40, y, size: 11, font: bold, color: rgb(0.7019, 0, 0.1176) })
        y -= 16
      }

      // Dealer
      section(L('Concesionario', 'Dealer'))
      line(empresa?.nombre || empresa?.business_name || 'Concesionario', { bold: true })
      if (empresa?.rnc) line(`RNC: ${empresa.rnc}`)
      if (empresa?.direccion || empresa?.address) line(empresa.direccion || empresa.address)
      if (empresa?.telefono || empresa?.phone) line(`${L('Tel', 'Phone')}: ${empresa.telefono || empresa.phone}`)

      // Client
      section(L('Cliente', 'Client'))
      line(client?.name || L('Sin nombre', 'No name'), { bold: true })
      if (client?.rnc || client?.cedula) line(`${L('RNC/Ced', 'RNC/ID')}: ${client.rnc || client.cedula}`)
      if (client?.phone) line(`${L('Tel', 'Phone')}: ${client.phone}`)
      if (client?.email) line(`Email: ${client.email}`)

      // Vehicle
      section(L('Vehiculo', 'Vehicle'))
      line(vehicleLabel || L('Vehiculo', 'Vehicle'), { bold: true })
      if (vehicle?.vin) line(`VIN: ${vehicle.vin}`)
      if (vehicle?.stock_number) line(`Stock #: ${vehicle.stock_number}`)
      if (vehicle?.mileage != null) line(`${L('Kilometraje', 'Mileage')}: ${Number(vehicle.mileage).toLocaleString('es-DO')} km`)
      if (vehicle?.color) line(`${L('Color', 'Color')}: ${vehicle.color}`)
      if (vehicle?.condition) line(`${L('Condicion', 'Condition')}: ${vehicle.condition}`)

      // Pricing
      section(L('Precios y Financiamiento', 'Pricing & Financing'))
      const financed = Math.max(0, Number(salePrice || 0) - Number(tradeInValue || 0) - Number(downPayment || 0))
      const totalOfPayments = (Number(monthlyPayment || 0) * Number(termMonths || 0)) || 0
      function row(label, value, opts = {}) {
        page.drawText(label, { x: 40, y, size: 10, font: opts.bold ? bold : font })
        const txt = String(value)
        const f = opts.bold ? bold : font
        page.drawText(txt, { x: width - 40 - f.widthOfTextAtSize(txt, 10), y, size: 10, font: f })
        y -= 14
      }
      row(L('Precio de Venta', 'Sale Price'), fmtMoney.format(salePrice || 0))
      if (Number(tradeInValue) > 0) row(L('— Intercambio', '— Trade-in'), `- ${fmtMoney.format(tradeInValue)}`)
      if (Number(downPayment) > 0) row(L('— Inicial', '— Down Payment'), `- ${fmtMoney.format(downPayment)}`)
      row(L('Monto Financiado', 'Financed Amount'), fmtMoney.format(financed), { bold: true })
      if (Number(termMonths) > 0) {
        row(`${L('Plazo', 'Term')} / APR`, `${termMonths} ${L('meses', 'months')} @ ${Number(aprAnnual).toFixed(2)}%`)
        row(L('Pago Mensual', 'Monthly Payment'), fmtMoney.format(monthlyPayment || 0), { bold: true })
        row(L('Total de Pagos', 'Total of Payments'), fmtMoney.format(totalOfPayments))
      }

      // Notes
      const noteText = [notes, extraNotes].filter(Boolean).join('\n').trim()
      if (noteText) {
        section(L('Notas', 'Notes'))
        const maxChars = 90
        for (const raw of noteText.split(/\r?\n/)) {
          let s = raw
          while (s.length > 0 && y > 80) {
            line(s.slice(0, maxChars))
            s = s.slice(maxChars)
          }
        }
      }

      // Salesperson + footer
      y = Math.max(y, 70)
      page.drawLine({ start: { x: 40, y: 60 }, end: { x: width - 40, y: 60 }, thickness: 0.5 })
      page.drawText(`${L('Vendedor', 'Salesperson')}: ${salesperson?.nombre || '—'}`,
        { x: 40, y: 45, size: 9, font })
      page.drawText(L(`Cotizacion valida hasta ${validityDate.toLocaleDateString('es-DO')}. Precios sujetos a disponibilidad.`,
                     `Quote valid until ${validityDate.toLocaleDateString('en-US')}. Prices subject to availability.`),
        { x: 40, y: 30, size: 8, font, color: rgb(0.4, 0.4, 0.4) })
      page.drawText(`Terminal X · ${new Date().toLocaleString('es-DO')}`,
        { x: 40, y: 15, size: 7, font, color: rgb(0.5, 0.5, 0.5) })

      const bytes = await pdf.save()
      const filename = `Cotizacion-${safeFile(stockNumber)}-${safeFile(client?.name)}-${todayStamp()}.pdf`
      downloadBlob(filename, new Blob([bytes], { type: 'application/pdf' }))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-black max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="bg-[#b3001e] text-white px-5 py-3 flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2"><FileText size={18} />{L('Cotizacion de Vehiculo', 'Vehicle Quote')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-white hover:text-[#b3001e]"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="border border-black p-3">
              <div className="text-[10px] font-bold text-black/60 uppercase mb-1">{L('Concesionario', 'Dealer')}</div>
              <div className="font-semibold">{empresa?.nombre || empresa?.business_name || '—'}</div>
              {empresa?.rnc && <div className="text-xs">RNC: {empresa.rnc}</div>}
              {(empresa?.telefono || empresa?.phone) && <div className="text-xs">{empresa.telefono || empresa.phone}</div>}
            </div>
            <div className="border border-black p-3">
              <div className="text-[10px] font-bold text-black/60 uppercase mb-1">{L('Cliente', 'Client')}</div>
              <div className="font-semibold">{client?.name || L('Sin cliente', 'No client')}</div>
              {(client?.rnc || client?.cedula) && <div className="text-xs">{client.rnc || client.cedula}</div>}
              {client?.phone && <div className="text-xs">{client.phone}</div>}
            </div>
          </div>

          <div className="border border-black p-3">
            <div className="text-[10px] font-bold text-black/60 uppercase mb-1">{L('Vehiculo', 'Vehicle')}</div>
            <div className="font-semibold">{vehicleLabel || '—'}</div>
            <div className="grid grid-cols-3 gap-2 text-xs mt-1">
              {vehicle?.vin && <div><span className="text-black/60">VIN:</span> {vehicle.vin}</div>}
              {vehicle?.stock_number && <div><span className="text-black/60">Stock:</span> {vehicle.stock_number}</div>}
              {vehicle?.mileage != null && <div><span className="text-black/60">{L('Km', 'Mi')}:</span> {Number(vehicle.mileage).toLocaleString('es-DO')}</div>}
            </div>
          </div>

          <div className="border border-black p-3 bg-black text-white space-y-1">
            <div className="flex justify-between"><span className="opacity-70">{L('Precio Venta', 'Sale Price')}</span><span className="tabular-nums">{fmtMoney.format(salePrice || 0)}</span></div>
            {Number(tradeInValue) > 0 && <div className="flex justify-between text-xs"><span className="opacity-70">{L('— Intercambio', '— Trade-in')}</span><span className="tabular-nums">- {fmtMoney.format(tradeInValue)}</span></div>}
            {Number(downPayment) > 0 && <div className="flex justify-between text-xs"><span className="opacity-70">{L('— Inicial', '— Down')}</span><span className="tabular-nums">- {fmtMoney.format(downPayment)}</span></div>}
            {Number(termMonths) > 0 && (
              <>
                <div className="border-t border-white/20 my-1" />
                <div className="flex justify-between text-xs"><span className="opacity-70">{L('Plazo', 'Term')} / APR</span><span>{termMonths}m @ {Number(aprAnnual).toFixed(2)}%</span></div>
                <div className="flex justify-between font-bold"><span>{L('Pago Mensual', 'Monthly')}</span><span className="tabular-nums">{fmtMoney.format(monthlyPayment || 0)}</span></div>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold">{L('Validez (dias)', 'Validity (days)')}</span>
              <input type="number" min="1" value={validityDays} onChange={e => setValidityDays(e.target.value)} className="mt-1 w-full border border-black px-2 py-1.5" />
            </label>
            <div className="flex items-end text-xs text-black/60">
              {L('Vence', 'Expires')}: <span className="ml-1 font-semibold text-black">{validityDate.toLocaleDateString('es-DO')}</span>
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-semibold">{L('Notas adicionales', 'Additional notes')}</span>
            <textarea value={extraNotes} onChange={e => setExtraNotes(e.target.value)} rows={2}
              placeholder={L('Garantia, accesorios incluidos, terminos...', 'Warranty, included accessories, terms...')}
              className="mt-1 w-full border border-black px-2 py-1.5 text-xs" />
          </label>
        </div>

        <div className="border-t border-black p-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border border-black text-sm">{L('Cerrar', 'Close')}</button>
          <button onClick={exportPDF} disabled={exporting}
            className="px-4 py-2 bg-[#b3001e] text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {L('Descargar PDF', 'Download PDF')}
          </button>
        </div>
      </div>
    </div>
  )
}
