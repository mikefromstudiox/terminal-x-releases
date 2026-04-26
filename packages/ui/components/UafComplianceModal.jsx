/**
 * UafComplianceModal.jsx — Concesionario AML gate (Ley 155-17).
 *
 * Triggered when the cash portion of a vehicle deal >= USD 15,000
 * (~RD$880,000). Blocks the deal until the cashier confirms a UAF report
 * has been filed and supplies the report URL + supervisor cedula.
 */

import { useState } from 'react'
import { Loader2, AlertTriangle, X } from 'lucide-react'

const CED_RGX = /^\d{3}-\d{7}-\d$/
const URL_RGX = /^https:\/\/.+/i

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export default function UafComplianceModal({ cashPortion, onConfirm, onCancel }) {
  const [acked, setAcked]   = useState(false)
  const [url, setUrl]       = useState('')
  const [cedula, setCedula] = useState('')
  const [err, setErr]       = useState('')
  const [busy, setBusy]     = useState(false)

  function submit(e) {
    e.preventDefault()
    setErr('')
    if (!acked) { setErr('Debe confirmar que el reporte UAF fue generado.'); return }
    if (!URL_RGX.test(url.trim())) { setErr('URL del reporte invalida (debe iniciar con https://).'); return }
    if (!CED_RGX.test(cedula.trim())) { setErr('Cedula del supervisor invalida (formato 000-0000000-0).'); return }
    setBusy(true)
    onConfirm({
      uaf_report_url:       url.trim(),
      uaf_acknowledged_by:  cedula.trim(),
      uaf_acknowledged_at:  new Date().toISOString(),
    })
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-[#b3001e] max-w-lg w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-[#b3001e] bg-[#b3001e] text-white">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <AlertTriangle size={20} />
            Reporte UAF requerido (Ley 155-17)
          </h2>
          <button onClick={onCancel} className="p-1 hover:bg-white hover:text-[#b3001e]" aria-label="Cerrar"><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4 text-sm">
          <div className="bg-black text-white p-3 text-xs leading-relaxed">
            Esta operacion incluye un pago en efectivo de <strong>{fmtRD(cashPortion)}</strong>,
            igual o mayor al umbral de USD 15,000 (RD$880,000). La Ley 155-17 contra
            Lavado de Activos exige reportar la operacion a la Unidad de Analisis
            Financiero (UAF) <strong>antes</strong> de completar la venta.
          </div>

          {err && <div className="bg-[#b3001e] text-white px-3 py-2 text-xs">{err}</div>}

          <label className="flex items-start gap-2">
            <input type="checkbox" checked={acked} onChange={e => setAcked(e.target.checked)} className="mt-0.5" />
            <span className="text-xs">He generado el reporte UAF Ley 155-17 para esta operacion.</span>
          </label>

          <label className="block">
            <span className="text-xs font-semibold">URL del reporte UAF (https)</span>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1 w-full border border-black px-2 py-1.5"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold">Cedula del supervisor que autoriza</span>
            <input
              value={cedula}
              onChange={e => setCedula(e.target.value)}
              placeholder="000-0000000-0"
              maxLength={13}
              className="mt-1 w-full border border-black px-2 py-1.5 font-mono"
              required
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onCancel} className="px-4 py-2 border border-black">Cancelar venta</button>
            <button type="submit" disabled={busy} className="px-4 py-2 bg-[#b3001e] text-white font-bold disabled:opacity-50 inline-flex items-center gap-2">
              {busy && <Loader2 size={14} className="animate-spin" />}
              Confirmar y continuar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
