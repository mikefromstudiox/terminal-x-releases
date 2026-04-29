// Activos — Contabilidad fixed assets module: Inventario + cédula de
// depreciación + auto-asiento mensual + retenciones (emitidas + recibidas).
// Plan-gated by `contabilidad_activos`.
//
// Categorías DGII (Ley 11-92, Art. 287, Reg. 139-98):
//   Cat. 1 — edificaciones (5% anual línea recta)
//   Cat. 2 — automóviles, mobiliario, eq. oficina (25% anual)
//   Cat. 3 — equipos PC, software (50% anual / 2-3 años)
//
// Implementación:
//   – Linea recta (saldo - residual) / vida_util_meses → cuota mensual
//   – `depreciacion_acumulada` se acumula al postear el período
//   – Auto-post crea asiento Dr Gasto Depreciación / Cr Depreciación Acumulada

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Package, Plus, Trash2, Loader2, FileDown, Lock, X, Check, Receipt, TrendingDown,
} from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { usePlan } from '../../hooks/usePlan'

const MONTHS = [
  '01 - Enero','02 - Febrero','03 - Marzo','04 - Abril','05 - Mayo','06 - Junio',
  '07 - Julio','08 - Agosto','09 - Septiembre','10 - Octubre','11 - Noviembre','12 - Diciembre',
]

const CATEGORIA_LABELS = {
  cat_1: 'Cat. 1 — Edificaciones (5% anual)',
  cat_2: 'Cat. 2 — Automóviles, mobiliario (25% anual)',
  cat_3: 'Cat. 3 — Equipos PC, software (50% anual)',
}

const CATEGORIA_RATES = {
  cat_1: { annual: 0.05, suggestedMonths: 240 }, // 20 años
  cat_2: { annual: 0.25, suggestedMonths: 48  }, // 4 años
  cat_3: { annual: 0.50, suggestedMonths: 24  }, // 2 años
}

const RETENTION_TIPOS_EMIT = {
  alquiler:        'Alquileres (10% s/ excedente RD$26,567/mes)',
  honorarios:      'Honorarios profesionales (10%)',
  dividendos:      'Dividendos (10%)',
  servicios_no_dom:'Servicios pagados al exterior (10-27%)',
}

function fmtRD(n) { return Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

function ComingSoon() {
  return (
    <div className="p-6 max-w-2xl">
      <div className="rounded-2xl border border-[#b3001e]/30 bg-[#b3001e]/5 p-6">
        <div className="flex items-center gap-2 text-[#b3001e] font-bold mb-2"><Lock size={16}/> Próximamente</div>
        <div className="text-sm text-black/80 dark:text-white/80">
          El módulo Activos requiere el plan Pro CTB o Pro MAX.
        </div>
      </div>
    </div>
  )
}

function ClientPicker({ clients, value, onChange }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
      <option value="">— Cliente —</option>
      {(clients || []).map(c => <option key={c.id} value={c.id}>{c.nombre_comercial}</option>)}
    </select>
  )
}

// ── Activos tab ──────────────────────────────────────────────────────────────

function depCuotaMensual(asset) {
  const costo = Number(asset.costo || 0)
  const residual = Number(asset.valor_residual || 0)
  const vida = Math.max(1, Number(asset.vida_util_meses || 0))
  const base = Math.max(0, costo - residual)
  return Math.round((base / vida) * 100) / 100
}

// Per-asset cuota capped at residual-value floor: never depreciate below
// (costo - residual). Returns the actual cuota that may be posted this period
// (0 when fully depreciated, partial when floor would be breached).
function depCuotaCapped(asset) {
  const costo = Number(asset.costo || 0)
  const residual = Number(asset.valor_residual || 0)
  const acum = Number(asset.depreciacion_acumulada || 0)
  const maxAcum = Math.max(0, costo - residual)
  const remaining = Math.max(0, maxAcum - acum)
  const cuota = depCuotaMensual(asset)
  return Math.round(Math.min(cuota, remaining) * 100) / 100
}

function isFullyDepreciated(asset) {
  const costo = Number(asset.costo || 0)
  const residual = Number(asset.valor_residual || 0)
  const acum = Number(asset.depreciacion_acumulada || 0)
  return (costo - acum) <= residual + 0.005
}

function depMesesTranscurridos(asset, year, month) {
  if (!asset.fecha_adquisicion) return 0
  const adq = new Date(asset.fecha_adquisicion + 'T00:00:00')
  const cierre = new Date(year, month, 0) // último día del mes
  if (cierre < adq) return 0
  const months = (cierre.getFullYear() - adq.getFullYear()) * 12 + (cierre.getMonth() - adq.getMonth()) + 1
  return Math.max(0, Math.min(Number(asset.vida_util_meses || 0), months))
}

function ActivosTab({ api, clientId, accounts, year, month }) {
  const [assets, setAssets] = useState([])
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null)
  const [postOpen, setPostOpen] = useState(false)
  const [disposing, setDisposing] = useState(null)

  const reload = useCallback(async () => {
    if (!api?.contabilidad || !clientId) { setAssets([]); return }
    const r = await api.contabilidad.fixedAssetList({ accountingClientId: clientId })
    setAssets(r || [])
  }, [api, clientId])

  useEffect(() => { reload() }, [reload])

  async function save(form) {
    setBusy(true)
    try {
      if (editing?.id) {
        await api.contabilidad.fixedAssetUpdate(editing.id, form)
      } else {
        await api.contabilidad.fixedAssetCreate({ ...form, accounting_client_id: clientId })
      }
      setEditing(null)
      await reload()
    } catch (e) { alert(`Error: ${e?.message || e}`) }
    finally    { setBusy(false) }
  }

  async function remove(id) {
    if (!confirm('¿Eliminar el activo? Si tiene depreciación posteada, considera marcarlo como dado de baja.')) return
    setBusy(true)
    try { await api.contabilidad.fixedAssetDelete(id); await reload() }
    catch (e) { alert(`Error: ${e?.message || e}`) }
    finally   { setBusy(false) }
  }

  // Build dep schedule for a single asset
  function schedule(asset) {
    const cuota = depCuotaMensual(asset)
    const vida = Number(asset.vida_util_meses || 0)
    const adq = asset.fecha_adquisicion ? new Date(asset.fecha_adquisicion + 'T00:00:00') : new Date()
    const rows = []
    let acumulado = 0
    for (let i = 1; i <= vida; i++) {
      const d = new Date(adq.getFullYear(), adq.getMonth() + i - 1, 1)
      acumulado = Math.min(Number(asset.costo || 0) - Number(asset.valor_residual || 0), acumulado + cuota)
      rows.push({
        idx: i,
        period: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`,
        cuota,
        acumulado: Math.round(acumulado * 100) / 100,
        valorEnLibros: Math.round((Number(asset.costo || 0) - acumulado) * 100) / 100,
      })
    }
    return rows
  }

  const totals = useMemo(() => {
    let cuotaPeriodo = 0, valorEnLibros = 0
    for (const a of assets) {
      if (a.status !== 'active') continue
      const transcurridos = depMesesTranscurridos(a, year, month)
      const cap = depCuotaCapped(a) // residual-floor enforced
      // Solo contar cuota si todavía está dentro de la vida útil al cierre del período
      if (transcurridos > 0 && transcurridos <= Number(a.vida_util_meses || 0)) cuotaPeriodo += cap
      const acum = Number(a.depreciacion_acumulada || 0)
      valorEnLibros += Math.max(Number(a.valor_residual || 0), Number(a.costo || 0) - acum)
    }
    return { cuotaPeriodo: Math.round(cuotaPeriodo * 100) / 100, valorEnLibros: Math.round(valorEnLibros * 100) / 100 }
  }, [assets, year, month])

  // Auto-post depreciation entry for the period
  async function postDepreciacion({ gastoAccountId, acumDepreciacionAccountId }) {
    if (totals.cuotaPeriodo <= 0) return alert('Sin depreciación a postear en el período.')
    setBusy(true)
    try {
      const fecha = `${year}-${String(month).padStart(2,'0')}-${String(Math.min(28, new Date(year, month, 0).getDate())).padStart(2,'0')}`
      const entry = await api.contabilidad.journalEntryCreate({
        accounting_client_id: clientId,
        fecha, description: `Depreciación ${MONTHS[month - 1]} ${year}`,
        type: 'auto_depreciation',
        period_year: year, period_month: month,
        totals_debit: totals.cuotaPeriodo, totals_credit: totals.cuotaPeriodo,
        status: 'posted',
      })
      await api.contabilidad.journalLineAdd({
        journal_entry_id: entry.id, account_id: gastoAccountId,
        debit: totals.cuotaPeriodo, credit: 0,
        memo: `Cuota mensual depreciación`,
      })
      await api.contabilidad.journalLineAdd({
        journal_entry_id: entry.id, account_id: acumDepreciacionAccountId,
        debit: 0, credit: totals.cuotaPeriodo,
        memo: `Depreciación acumulada del período`,
      })
      // increment depreciacion_acumulada per active asset, capped at residual floor
      for (const a of assets) {
        if (a.status !== 'active') continue
        const cap = depCuotaCapped(a)
        if (cap <= 0) continue // already at residual — never depreciate below it
        const transcurridos = depMesesTranscurridos(a, year, month)
        if (transcurridos > 0 && transcurridos <= Number(a.vida_util_meses || 0)) {
          const newAcum = Math.min(
            Number(a.depreciacion_acumulada || 0) + cap,
            Number(a.costo || 0) - Number(a.valor_residual || 0)
          )
          await api.contabilidad.fixedAssetUpdate(a.id, { depreciacion_acumulada: Math.round(newAcum * 100) / 100 })
        }
      }
      setPostOpen(false)
      await reload()
      alert(`Depreciación posteada: RD$ ${fmtRD(totals.cuotaPeriodo)}`)
    } catch (e) { alert(`Error: ${e?.message || e}`) }
    finally    { setBusy(false) }
  }

  // Disposal: post a balanced journal entry, mark asset sold/written_off.
  //
  // Asiento (DR Banco/CxC + DR Dep. Acumulada + CR Costo del activo):
  //
  //   DR  Banco / CxC                          monto_venta
  //   DR  Depreciación Acumulada               depreciacion_acumulada
  //   DR  Pérdida por venta de activo fijo     loss            (si loss > 0)
  //   CR  Costo del Activo Fijo                                          costo
  //   CR  Ingreso por venta de activo fijo                                gain   (si gain > 0)
  //
  // Donde:
  //   book_value = costo - depreciacion_acumulada
  //   diff       = monto_venta - book_value     (>0 ganancia, <0 pérdida)
  //
  // Debits = monto_venta + depreciacion_acumulada + max(-diff, 0)
  // Credits= costo + max(diff, 0)
  // Identity check: monto_venta + dep + max(-diff,0) === costo + max(diff,0)
  //                 monto_venta + dep + (book - venta if loss) === costo + (venta - book if gain)
  //                 → both reduce to costo + dep_or_minus on each side. Verified balanced.
  async function disposeAsset({ asset, fechaVenta, montoVenta, notas, cuentas }) {
    const costo = Number(asset.costo || 0)
    const acum  = Number(asset.depreciacion_acumulada || 0)
    const venta = Number(montoVenta || 0)
    const bookValue = Math.round((costo - acum) * 100) / 100
    const diff = Math.round((venta - bookValue) * 100) / 100
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    const isWriteOff = venta <= 0
    const totalDebit  = Math.round((venta + acum + loss) * 100) / 100
    const totalCredit = Math.round((costo + gain) * 100) / 100

    // Sanity: balanced within 1 cent (rounding tolerance)
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(`Asiento desbalanceado: Dr ${totalDebit} ≠ Cr ${totalCredit}`)
    }

    setBusy(true)
    try {
      const entry = await api.contabilidad.journalEntryCreate({
        accounting_client_id: clientId,
        fecha: fechaVenta,
        description: `${isWriteOff ? 'Baja' : 'Venta'} de activo fijo: ${asset.name}${notas ? ' — ' + notas : ''}`,
        type: 'asset_disposal',
        period_year: Number(fechaVenta.slice(0, 4)),
        period_month: Number(fechaVenta.slice(5, 7)),
        totals_debit: totalDebit,
        totals_credit: totalCredit,
        status: 'posted',
      })

      // DR Banco/CxC (only if there's a sale price)
      if (venta > 0 && cuentas.bancoId) {
        await api.contabilidad.journalLineAdd({
          journal_entry_id: entry.id, account_id: cuentas.bancoId,
          debit: venta, credit: 0,
          memo: isWriteOff ? null : `Venta de ${asset.name}`,
        })
      }
      // DR Depreciación Acumulada (reverse the accumulated depreciation)
      if (acum > 0) {
        await api.contabilidad.journalLineAdd({
          journal_entry_id: entry.id, account_id: cuentas.acumId,
          debit: Math.round(acum * 100) / 100, credit: 0,
          memo: `Reverso depreciación acumulada de ${asset.name}`,
        })
      }
      // DR Pérdida (if loss)
      if (loss > 0) {
        await api.contabilidad.journalLineAdd({
          journal_entry_id: entry.id, account_id: cuentas.perdidaId,
          debit: loss, credit: 0,
          memo: `Pérdida por ${isWriteOff ? 'baja' : 'venta'} de ${asset.name}`,
        })
      }
      // CR Costo del activo fijo
      await api.contabilidad.journalLineAdd({
        journal_entry_id: entry.id, account_id: cuentas.activoId,
        debit: 0, credit: Math.round(costo * 100) / 100,
        memo: `Baja del activo ${asset.name} (costo histórico)`,
      })
      // CR Ganancia (if gain)
      if (gain > 0) {
        await api.contabilidad.journalLineAdd({
          journal_entry_id: entry.id, account_id: cuentas.gananciaId,
          debit: 0, credit: gain,
          memo: `Ganancia por venta de ${asset.name}`,
        })
      }

      // Mark asset disposed
      await api.contabilidad.fixedAssetUpdate(asset.id, {
        status: isWriteOff ? 'written_off' : 'sold',
        sold_at: fechaVenta,
        sold_amount: venta,
        notes: notas ? `${asset.notes ? asset.notes + '\n' : ''}[${fechaVenta}] ${isWriteOff ? 'Baja' : 'Venta'}: ${notas}` : asset.notes,
      })

      setDisposing(null)
      await reload()
      const sign = gain > 0 ? `Ganancia RD$ ${fmtRD(gain)}` : loss > 0 ? `Pérdida RD$ ${fmtRD(loss)}` : 'Sin ganancia ni pérdida'
      alert(`${isWriteOff ? 'Baja' : 'Venta'} registrada. ${sign}.`)
    } catch (e) { alert(`Error: ${e?.message || e}`) }
    finally    { setBusy(false) }
  }

  function exportCedula() {
    const lines = [
      ['Activo','Categoría','Fecha adq.','Costo','Residual','Vida (meses)','Cuota mensual','Dep. acumulada','Valor en libros','Status'].join(','),
      ...assets.map(a => {
        const c = depCuotaMensual(a)
        const acum = Number(a.depreciacion_acumulada || 0)
        return [
          (a.name || '').replace(/,/g, ';'),
          CATEGORIA_LABELS[a.categoria] || a.categoria,
          a.fecha_adquisicion || '',
          Number(a.costo || 0).toFixed(2),
          Number(a.valor_residual || 0).toFixed(2),
          a.vida_util_meses || 0,
          c.toFixed(2),
          acum.toFixed(2),
          (Number(a.costo || 0) - acum).toFixed(2),
          a.status,
        ].join(',')
      }),
    ].join('\n')
    const blob = new Blob([lines], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `cedula_depreciacion_${year}${String(month).padStart(2,'0')}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setEditing({})} disabled={!clientId}
          className="inline-flex items-center gap-1 rounded-lg bg-[#b3001e] text-white px-3 py-2 text-sm font-bold hover:bg-[#8f0018] disabled:opacity-50">
          <Plus size={14}/> Nuevo activo
        </button>
        <button onClick={() => setPostOpen(true)} disabled={totals.cuotaPeriodo <= 0}
          className="inline-flex items-center gap-1 rounded-lg bg-black text-white dark:bg-white dark:text-black px-3 py-2 text-sm font-bold disabled:opacity-50">
          <Check size={14}/> Postear depreciación {MONTHS[month - 1]}
        </button>
        <button onClick={exportCedula} className="inline-flex items-center gap-1 rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 text-xs font-bold">
          <FileDown size={12}/> Cédula CSV
        </button>
        <div className="ml-auto text-xs text-black/60 dark:text-white/60">
          Cuota mensual: <strong>RD$ {fmtRD(totals.cuotaPeriodo)}</strong> · Valor en libros: <strong>RD$ {fmtRD(totals.valorEnLibros)}</strong>
        </div>
      </div>
      <div className="rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black text-white">
            <tr>
              <th className="text-left px-3 py-2">Activo</th>
              <th className="text-left px-3 py-2">Categoría</th>
              <th className="text-left px-3 py-2">Adquisición</th>
              <th className="text-right px-3 py-2">Costo</th>
              <th className="text-right px-3 py-2">Residual</th>
              <th className="text-right px-3 py-2">Cuota/mes</th>
              <th className="text-right px-3 py-2">Acumulada</th>
              <th className="text-right px-3 py-2">En libros</th>
              <th className="text-left px-3 py-2">Estado</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {!assets.length && <tr><td colSpan={10} className="px-3 py-6 text-center text-black/50 dark:text-white/50">Sin activos. Agrega uno con "Nuevo activo".</td></tr>}
            {assets.map(a => {
              const cuota = depCuotaMensual(a)
              const acum = Number(a.depreciacion_acumulada || 0)
              const bookValue = Math.round((Number(a.costo || 0) - acum) * 100) / 100
              const enLibros = Math.max(Number(a.valor_residual || 0), bookValue)
              const atFloor = isFullyDepreciated(a)
              const isDisposed = a.status === 'sold' || a.status === 'written_off'
              const pillCls = a.status === 'active'
                ? 'bg-[#b3001e] text-white border-[#b3001e]'
                : a.status === 'sold'
                  ? 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white'
                  : 'bg-white text-black border-black/30 dark:bg-black dark:text-white dark:border-white/30'
              const pillLabel = a.status === 'active' ? 'Activo' : a.status === 'sold' ? 'Vendido' : 'Baja'
              const enLibrosCls = isDisposed
                ? 'text-black/30 dark:text-white/30 line-through'
                : atFloor
                  ? 'text-black/40 dark:text-white/40'
                  : ''
              return (
                <tr key={a.id} className={`border-t border-black/10 dark:border-white/10 ${isDisposed ? 'opacity-60' : ''}`}>
                  <td className="px-3 py-2 font-bold">{a.name}</td>
                  <td className="px-3 py-2 text-xs">{CATEGORIA_LABELS[a.categoria] || a.categoria}</td>
                  <td className="px-3 py-2 font-mono text-xs">{a.fecha_adquisicion || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtRD(a.costo)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtRD(a.valor_residual)}</td>
                  <td className="px-3 py-2 text-right font-mono">{atFloor || isDisposed ? '—' : fmtRD(cuota)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtRD(acum)}</td>
                  <td className={`px-3 py-2 text-right font-mono font-bold ${enLibrosCls}`} title={atFloor ? 'Totalmente depreciado (al valor residual)' : ''}>
                    {fmtRD(enLibros)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${pillCls}`}>
                      {pillLabel}
                    </span>
                    {a.sold_at && (
                      <div className="text-[10px] text-black/50 dark:text-white/50 font-mono mt-0.5">{a.sold_at}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {!isDisposed && (
                      <button onClick={() => setDisposing(a)} className="text-xs font-bold text-[#b3001e] hover:underline mr-3 inline-flex items-center gap-1" title="Vender o dar de baja">
                        <TrendingDown size={12}/> Vender
                      </button>
                    )}
                    <button onClick={() => setEditing(a)} className="text-xs font-bold text-[#b3001e] hover:underline mr-3">Editar</button>
                    <button onClick={() => remove(a.id)} className="text-xs font-bold text-black/60 dark:text-white/60 hover:text-[#b3001e]"><Trash2 size={12} className="inline"/></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && <AssetModal initial={editing} onClose={() => setEditing(null)} onSave={save} busy={busy}/>}
      {postOpen && (
        <DepPostModal totals={totals} accounts={accounts} year={year} month={month}
          onClose={() => setPostOpen(false)} onConfirm={postDepreciacion} busy={busy}/>
      )}
      {disposing && (
        <DisposalModal asset={disposing} accounts={accounts}
          onClose={() => setDisposing(null)}
          onConfirm={(payload) => disposeAsset({ asset: disposing, ...payload })}
          busy={busy}/>
      )}
    </div>
  )
}

// Disposal modal: sale price (0 = write-off), date, notes, account picks for
// the disposal journal entry. Live computes book value, gain/loss preview.
function DisposalModal({ asset, accounts, onClose, onConfirm, busy }) {
  const [fechaVenta, setFechaVenta] = useState(new Date().toISOString().slice(0, 10))
  const [montoVenta, setMontoVenta] = useState(0)
  const [notas, setNotas] = useState('')

  // Catálogo Único guesses:
  //   1101 — Caja/Banco; 1102 — CxC
  //   1290 — Depreciación acumulada
  //   1200 / 12 — Activo fijo (costo histórico)
  //   4xxx — Ingreso por venta de activo fijo
  //   5xxx — Pérdida por venta de activo fijo
  const guess = useMemo(() => {
    const byCode = (code) => accounts.find(a => String(a.code).startsWith(code))
    const byKeyword = (kw) => accounts.find(a => (a.name || '').toLowerCase().includes(kw))
    return {
      banco:    byCode('1101') || byCode('1102') || byKeyword('banco') || byKeyword('caja') || null,
      acum:     byCode('1290') || byCode('129')  || byKeyword('depreciación acum') || byKeyword('depreciacion acum') || null,
      activo:   byCode('1200') || byCode('12')   || byKeyword('activo fijo') || null,
      ganancia: byKeyword('ganancia') || byKeyword('ingreso por venta') || null,
      perdida:  byKeyword('pérdida por venta') || byKeyword('perdida por venta') || byKeyword('pérdida') || null,
    }
  }, [accounts])

  const [bancoId, setBancoId]       = useState(guess.banco?.id || null)
  const [acumId, setAcumId]         = useState(guess.acum?.id || null)
  const [activoId, setActivoId]     = useState(guess.activo?.id || null)
  const [gananciaId, setGananciaId] = useState(guess.ganancia?.id || null)
  const [perdidaId, setPerdidaId]   = useState(guess.perdida?.id || null)

  const postable = (accounts || []).filter(a => a.is_postable)

  const costo = Number(asset.costo || 0)
  const acum  = Number(asset.depreciacion_acumulada || 0)
  const venta = Number(montoVenta || 0)
  const bookValue = Math.round((costo - acum) * 100) / 100
  const diff = Math.round((venta - bookValue) * 100) / 100
  const isWriteOff = venta <= 0
  const gain = diff > 0 ? diff : 0
  const loss = diff < 0 ? -diff : 0

  // Required accounts for the entry to balance:
  //   – Activo histórico (CR costo) — always
  //   – Dep. acumulada (DR) — if acum > 0
  //   – Banco/CxC (DR venta) — if venta > 0
  //   – Ganancia (CR) — if gain > 0
  //   – Pérdida (DR) — if loss > 0
  const missing = []
  if (!activoId) missing.push('Cuenta del activo')
  if (acum > 0 && !acumId) missing.push('Depreciación acumulada')
  if (venta > 0 && !bancoId) missing.push('Banco / Caja')
  if (gain > 0 && !gananciaId) missing.push('Cuenta de ganancia')
  if (loss > 0 && !perdidaId) missing.push('Cuenta de pérdida')
  const canSubmit = !busy && fechaVenta && missing.length === 0

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 max-w-2xl w-full p-5 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-bold inline-flex items-center gap-2"><TrendingDown size={16}/> Vender / dar de baja: {asset.name}</div>
          <button onClick={onClose}><X size={16}/></button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="block text-xs font-bold">Fecha de venta / baja
            <input type="date" value={fechaVenta} onChange={(e) => setFechaVenta(e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm"/>
          </label>
          <label className="block text-xs font-bold">Monto de venta (RD$) — 0 = baja
            <input type="number" min="0" step="0.01" value={montoVenta} onChange={(e) => setMontoVenta(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono text-right"/>
          </label>
        </div>

        <label className="block text-xs font-bold mb-3">Notas
          <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2}
            placeholder="Comprador, motivo, referencia de pago…"
            className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm"/>
        </label>

        <div className="rounded-2xl border border-[#b3001e]/30 bg-[#b3001e]/5 p-3 text-xs space-y-1 mb-4">
          <div className="font-bold text-[#b3001e] mb-1">Cálculo</div>
          <div className="flex justify-between"><span>Costo histórico</span><span className="font-mono">RD$ {fmtRD(costo)}</span></div>
          <div className="flex justify-between"><span>(–) Depreciación acumulada</span><span className="font-mono">RD$ {fmtRD(acum)}</span></div>
          <div className="flex justify-between font-bold border-t border-[#b3001e]/20 pt-1"><span>Valor en libros</span><span className="font-mono">RD$ {fmtRD(bookValue)}</span></div>
          <div className="flex justify-between"><span>Monto de venta</span><span className="font-mono">RD$ {fmtRD(venta)}</span></div>
          <div className={`flex justify-between font-bold pt-1 border-t border-[#b3001e]/20 ${gain > 0 ? 'text-[#b3001e]' : loss > 0 ? 'text-black dark:text-white' : ''}`}>
            <span>{gain > 0 ? 'Ganancia' : loss > 0 ? 'Pérdida' : 'Sin ganancia ni pérdida'}</span>
            <span className="font-mono">RD$ {fmtRD(gain || loss)}</span>
          </div>
          <div className="text-[10px] text-black/50 dark:text-white/50 pt-1">{isWriteOff ? 'Se marcará como Baja (written_off).' : 'Se marcará como Vendido (sold).'}</div>
        </div>

        <div className="space-y-3">
          <div className="text-xs font-bold uppercase text-black/60 dark:text-white/60">Cuentas del asiento</div>
          <label className="block text-xs font-bold">Cuenta del activo (Cr costo)
            <select value={activoId || ''} onChange={(e) => setActivoId(Number(e.target.value) || null)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
              <option value="">— Seleccionar —</option>
              {postable.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold">Depreciación acumulada (Dr reverso) {acum <= 0 && <span className="text-black/40 dark:text-white/40">(no aplica — sin acumulada)</span>}
            <select disabled={acum <= 0} value={acumId || ''} onChange={(e) => setAcumId(Number(e.target.value) || null)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm disabled:opacity-50">
              <option value="">— Seleccionar —</option>
              {postable.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold">Banco / Caja / CxC (Dr venta) {venta <= 0 && <span className="text-black/40 dark:text-white/40">(no aplica — baja sin venta)</span>}
            <select disabled={venta <= 0} value={bancoId || ''} onChange={(e) => setBancoId(Number(e.target.value) || null)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm disabled:opacity-50">
              <option value="">— Seleccionar —</option>
              {postable.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold">Ganancia por venta (Cr) {gain <= 0 && <span className="text-black/40 dark:text-white/40">(no aplica)</span>}
              <select disabled={gain <= 0} value={gananciaId || ''} onChange={(e) => setGananciaId(Number(e.target.value) || null)}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm disabled:opacity-50">
                <option value="">— Seleccionar —</option>
                {postable.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-bold">Pérdida por venta (Dr) {loss <= 0 && <span className="text-black/40 dark:text-white/40">(no aplica)</span>}
              <select disabled={loss <= 0} value={perdidaId || ''} onChange={(e) => setPerdidaId(Number(e.target.value) || null)}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm disabled:opacity-50">
                <option value="">— Seleccionar —</option>
                {postable.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </label>
          </div>
        </div>

        {missing.length > 0 && (
          <div className="mt-3 text-xs text-[#b3001e]">Falta seleccionar: {missing.join(', ')}.</div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-bold border border-black/10 dark:border-white/10">Cancelar</button>
          <button disabled={!canSubmit}
            onClick={() => onConfirm({
              fechaVenta, montoVenta: venta, notas,
              cuentas: { bancoId, acumId, activoId, gananciaId, perdidaId },
            })}
            className="px-3 py-2 rounded-lg text-sm font-bold bg-[#b3001e] text-white disabled:opacity-50 inline-flex items-center gap-1">
            {busy && <Loader2 size={12} className="animate-spin"/>} Confirmar {isWriteOff ? 'baja' : 'venta'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AssetModal({ initial, onClose, onSave, busy }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    categoria: initial?.categoria || 'cat_2',
    fecha_adquisicion: initial?.fecha_adquisicion || '',
    costo: Number(initial?.costo || 0),
    vida_util_meses: Number(initial?.vida_util_meses || CATEGORIA_RATES.cat_2.suggestedMonths),
    valor_residual: Number(initial?.valor_residual || 0),
    depreciacion_acumulada: Number(initial?.depreciacion_acumulada || 0),
    status: initial?.status || 'active',
    notes: initial?.notes || '',
  })
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  // When categoria changes, suggest vida útil
  function onCategoria(cat) {
    set('categoria', cat)
    if (!initial?.id) set('vida_util_meses', CATEGORIA_RATES[cat]?.suggestedMonths || 48)
  }

  const cuota = depCuotaMensual(form)

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 max-w-lg w-full p-5 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-bold inline-flex items-center gap-2"><Package size={16}/> {initial?.id ? 'Editar activo' : 'Nuevo activo'}</div>
          <button onClick={onClose}><X size={16}/></button>
        </div>
        <div className="space-y-3">
          <label className="block text-xs font-bold">Nombre / descripción
            <input value={form.name} onChange={(e) => set('name', e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm"/>
          </label>
          <label className="block text-xs font-bold">Categoría DGII
            <select value={form.categoria} onChange={(e) => onCategoria(e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
              {Object.entries(CATEGORIA_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold">Fecha adquisición
              <input type="date" value={form.fecha_adquisicion} onChange={(e) => set('fecha_adquisicion', e.target.value)}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm"/>
            </label>
            <label className="block text-xs font-bold">Vida útil (meses)
              <input type="number" min="1" value={form.vida_util_meses} onChange={(e) => set('vida_util_meses', Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono text-right"/>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold">Costo (RD$)
              <input type="number" min="0" step="0.01" value={form.costo} onChange={(e) => set('costo', Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono text-right"/>
            </label>
            <label className="block text-xs font-bold">Valor residual (RD$)
              <input type="number" min="0" step="0.01" value={form.valor_residual} onChange={(e) => set('valor_residual', Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono text-right"/>
            </label>
          </div>
          <label className="block text-xs font-bold">Depreciación acumulada arrastrada (RD$)
            <input type="number" min="0" step="0.01" value={form.depreciacion_acumulada} onChange={(e) => set('depreciacion_acumulada', Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono text-right"/>
            <span className="text-[10px] text-black/50 dark:text-white/50">Para activos preexistentes que ya venían con depreciación al inicio del período.</span>
          </label>
          <label className="block text-xs font-bold">Status
            <select value={form.status} onChange={(e) => set('status', e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
              <option value="active">Activo</option>
              <option value="sold">Vendido</option>
              <option value="written_off">Dado de baja</option>
            </select>
          </label>
          {Number(form.costo) > 0 && Number(form.vida_util_meses) > 0 && (
            <div className="rounded-2xl border border-[#b3001e]/30 bg-[#b3001e]/5 p-3 text-xs">
              <div className="font-bold mb-1 text-[#b3001e]">Línea recta</div>
              <div>Cuota mensual: <strong>RD$ {fmtRD(cuota)}</strong> · Cuota anual: <strong>RD$ {fmtRD(cuota * 12)}</strong></div>
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-bold border border-black/10 dark:border-white/10">Cancelar</button>
          <button disabled={busy || !form.name || !(form.costo > 0)}
            onClick={() => onSave(form)}
            className="px-3 py-2 rounded-lg text-sm font-bold bg-[#b3001e] text-white disabled:opacity-50">
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

function DepPostModal({ totals, accounts, year, month, onClose, onConfirm, busy }) {
  // Suggested codes from Catálogo Único:
  //   5104 / 5106 — gasto depreciación
  //   1290 — depreciación acumulada (contra-activo)
  const guess = useMemo(() => {
    const byCode = (code) => accounts.find(a => String(a.code).startsWith(code))
    return {
      gasto: byCode('5104') || byCode('5106') || byCode('51') || null,
      acum:  byCode('1290') || byCode('129')  || byCode('12') || null,
    }
  }, [accounts])
  const [gastoId, setGastoId] = useState(guess.gasto?.id || null)
  const [acumId,  setAcumId]  = useState(guess.acum?.id  || null)
  const postable = (accounts || []).filter(a => a.is_postable)

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 max-w-lg w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-bold">Postear depreciación · {MONTHS[month - 1]} {year}</div>
          <button onClick={onClose}><X size={16}/></button>
        </div>
        <div className="text-xs text-black/60 dark:text-white/60 mb-3">
          Asiento: Dr Gasto Depreciación {fmtRD(totals.cuotaPeriodo)} | Cr Depreciación Acumulada {fmtRD(totals.cuotaPeriodo)}.
        </div>
        <div className="space-y-3">
          <label className="block text-xs font-bold">Cuenta de gasto (Dr)
            <select value={gastoId || ''} onChange={(e) => setGastoId(Number(e.target.value) || null)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
              <option value="">— Seleccionar —</option>
              {postable.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold">Depreciación acumulada (Cr)
            <select value={acumId || ''} onChange={(e) => setAcumId(Number(e.target.value) || null)}
              className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
              <option value="">— Seleccionar —</option>
              {postable.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-bold border border-black/10 dark:border-white/10">Cancelar</button>
          <button disabled={busy || !gastoId || !acumId}
            onClick={() => onConfirm({ gastoAccountId: gastoId, acumDepreciacionAccountId: acumId })}
            className="px-3 py-2 rounded-lg text-sm font-bold bg-[#b3001e] text-white disabled:opacity-50 inline-flex items-center gap-1">
            {busy && <Loader2 size={12} className="animate-spin"/>} Postear
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Retenciones tabs ──────────────────────────────────────────────────────────

function RetencionesTab({ api, clientId, year, month, kind /* 'emit' | 'recv' */ }) {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null)

  const reload = useCallback(async () => {
    if (!api?.contabilidad || !clientId) { setRows([]); return }
    const from = `${year}-01-01`
    const to   = `${year}-12-31`
    const list = kind === 'emit'
      ? await api.contabilidad.retentionEmitidaList({ accountingClientId: clientId, dateFrom: from, dateTo: to })
      : await api.contabilidad.retentionRecibidaList({ accountingClientId: clientId, dateFrom: from, dateTo: to })
    setRows(list || [])
  }, [api, clientId, year, kind])

  useEffect(() => { reload() }, [reload])

  async function save(form) {
    setBusy(true)
    try {
      if (editing?.id) {
        if (kind === 'emit') await api.contabilidad.retentionEmitidaUpdate(editing.id, form)
        else                  await api.contabilidad.retentionRecibidaUpdate(editing.id, form)
      } else {
        const payload = { ...form, accounting_client_id: clientId }
        if (kind === 'emit') await api.contabilidad.retentionEmitidaCreate(payload)
        else                  await api.contabilidad.retentionRecibidaCreate(payload)
      }
      setEditing(null)
      await reload()
    } catch (e) { alert(`Error: ${e?.message || e}`) }
    finally    { setBusy(false) }
  }

  async function remove(id) {
    if (!confirm('¿Eliminar la retención?')) return
    setBusy(true)
    try {
      if (kind === 'emit') await api.contabilidad.retentionEmitidaDelete(id)
      else                  await api.contabilidad.retentionRecibidaDelete(id)
      await reload()
    } catch (e) { alert(`Error: ${e?.message || e}`) }
    finally   { setBusy(false) }
  }

  const totales = useMemo(() => {
    let base = 0, ret = 0
    for (const r of rows) {
      if (Number(r.fecha?.slice(5, 7)) !== month && month != null && month !== 0) continue
      base += Number(r.base || 0); ret += Number(r.retencion || 0)
    }
    return { base, ret }
  }, [rows, month])

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setEditing({})} disabled={!clientId}
          className="inline-flex items-center gap-1 rounded-lg bg-[#b3001e] text-white px-3 py-2 text-sm font-bold hover:bg-[#8f0018] disabled:opacity-50">
          <Plus size={14}/> {kind === 'emit' ? 'Nueva retención emitida' : 'Nueva retención recibida'}
        </button>
        <div className="ml-auto text-xs text-black/60 dark:text-white/60">
          Mes seleccionado: base RD$ {fmtRD(totales.base)} · retenido RD$ {fmtRD(totales.ret)}
        </div>
      </div>
      <div className="rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black text-white">
            <tr>
              <th className="text-left px-3 py-2">Fecha</th>
              <th className="text-left px-3 py-2">{kind === 'emit' ? 'Beneficiario' : 'Retenedor'}</th>
              <th className="text-left px-3 py-2">RNC</th>
              <th className="text-left px-3 py-2">Tipo</th>
              <th className="text-right px-3 py-2">Base</th>
              <th className="text-right px-3 py-2">Tasa %</th>
              <th className="text-right px-3 py-2">Retenido</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-black/50 dark:text-white/50">Sin retenciones del año.</td></tr>}
            {rows.map(r => (
              <tr key={r.id} className="border-t border-black/10 dark:border-white/10">
                <td className="px-3 py-2 font-mono">{r.fecha || '—'}</td>
                <td className="px-3 py-2 font-bold">{kind === 'emit' ? (r.beneficiario_nombre || '—') : (r.retenedor_nombre || '—')}</td>
                <td className="px-3 py-2 font-mono text-xs">{kind === 'emit' ? (r.beneficiario_rnc || '—') : (r.retenedor_rnc || '—')}</td>
                <td className="px-3 py-2 text-xs">{r.tipo || '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtRD(r.base)}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(r.tasa || 0).toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold">{fmtRD(r.retencion)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => setEditing(r)} className="text-xs font-bold text-[#b3001e] hover:underline mr-3">Editar</button>
                  <button onClick={() => remove(r.id)} className="text-xs font-bold text-black/60 dark:text-white/60 hover:text-[#b3001e]"><Trash2 size={12} className="inline"/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <RetencionModal initial={editing} kind={kind} onClose={() => setEditing(null)} onSave={save} busy={busy}/>}
    </div>
  )
}

function RetencionModal({ initial, kind, onClose, onSave, busy }) {
  const [form, setForm] = useState({
    fecha: initial?.fecha || new Date().toISOString().slice(0, 10),
    [kind === 'emit' ? 'beneficiario_rnc' : 'retenedor_rnc']: initial?.[kind === 'emit' ? 'beneficiario_rnc' : 'retenedor_rnc'] || '',
    [kind === 'emit' ? 'beneficiario_nombre' : 'retenedor_nombre']: initial?.[kind === 'emit' ? 'beneficiario_nombre' : 'retenedor_nombre'] || '',
    tipo: initial?.tipo || (kind === 'emit' ? 'honorarios' : 'isr'),
    base: Number(initial?.base || 0),
    tasa: Number(initial?.tasa || 10),
    retencion: Number(initial?.retencion || 0),
    ncf_emitido: initial?.ncf_emitido || '',
    comprobante_url: initial?.comprobante_url || '',
  })
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }
  // auto-calc retencion when base/tasa change
  useEffect(() => {
    set('retencion', Math.round((Number(form.base) * Number(form.tasa) / 100) * 100) / 100)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.base, form.tasa])

  const rncKey = kind === 'emit' ? 'beneficiario_rnc' : 'retenedor_rnc'
  const nameKey = kind === 'emit' ? 'beneficiario_nombre' : 'retenedor_nombre'

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-black rounded-2xl border border-black/10 dark:border-white/10 max-w-lg w-full p-5 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-bold inline-flex items-center gap-2"><Receipt size={16}/> {initial?.id ? 'Editar' : 'Nueva'} retención {kind === 'emit' ? 'emitida' : 'recibida'}</div>
          <button onClick={onClose}><X size={16}/></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold">Fecha
              <input type="date" value={form.fecha} onChange={(e) => set('fecha', e.target.value)}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm"/>
            </label>
            <label className="block text-xs font-bold">Tipo
              {kind === 'emit' ? (
                <select value={form.tipo} onChange={(e) => set('tipo', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
                  {Object.entries(RETENTION_TIPOS_EMIT).map(([k, v]) => <option key={k} value={k}>{v.split('(')[0].trim()}</option>)}
                </select>
              ) : (
                <input value={form.tipo} onChange={(e) => set('tipo', e.target.value)} placeholder="ISR, ITBIS, etc."
                  className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm"/>
              )}
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold">RNC / Cédula
              <input value={form[rncKey]} onChange={(e) => set(rncKey, e.target.value.replace(/\D/g, '').slice(0, 11))}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono"/>
            </label>
            <label className="block text-xs font-bold">Nombre / Razón social
              <input value={form[nameKey]} onChange={(e) => set(nameKey, e.target.value)}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm"/>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-xs font-bold">Base (RD$)
              <input type="number" min="0" step="0.01" value={form.base} onChange={(e) => set('base', Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono text-right"/>
            </label>
            <label className="block text-xs font-bold">Tasa (%)
              <input type="number" min="0" max="100" step="0.01" value={form.tasa} onChange={(e) => set('tasa', Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono text-right"/>
            </label>
            <label className="block text-xs font-bold">Retenido (RD$)
              <input type="number" min="0" step="0.01" value={form.retencion} onChange={(e) => set('retencion', Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono text-right"/>
            </label>
          </div>
          {kind === 'emit' && (
            <label className="block text-xs font-bold">NCF emitido (opcional)
              <input value={form.ncf_emitido} onChange={(e) => set('ncf_emitido', e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm font-mono"/>
            </label>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-bold border border-black/10 dark:border-white/10">Cancelar</button>
          <button disabled={busy} onClick={() => onSave(form)}
            className="px-3 py-2 rounded-lg text-sm font-bold bg-[#b3001e] text-white disabled:opacity-50">
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Shell ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'activos',  label: 'Activos fijos' },
  { id: 'ret_emit', label: 'Retenciones emitidas' },
  { id: 'ret_recv', label: 'Retenciones recibidas' },
]

export default function Activos() {
  const api = useAPI()
  const { hasFeature } = usePlan()
  const allowed = hasFeature('contabilidad_activos')

  const [tab, setTab] = useState('activos')
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState(null)
  const [accounts, setAccounts] = useState([])
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!api?.contabilidad) return
      const c = await api.contabilidad.clientList()
      if (cancelled) return
      setClients(c || [])
      if (!clientId && c?.length) setClientId(c[0].id)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  const reloadAccounts = useCallback(async () => {
    if (!api?.contabilidad || !clientId) { setAccounts([]); return }
    const r = await api.contabilidad.coaList({ accountingClientId: clientId })
    setAccounts(r || [])
  }, [api, clientId])

  useEffect(() => { reloadAccounts() }, [reloadAccounts])

  if (!allowed) return <ComingSoon/>

  return (
    <div className="flex flex-col min-h-full">
      <div className="border-b border-black/10 dark:border-white/10 bg-white dark:bg-black px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 font-bold text-[#b3001e]"><Package size={16}/> Activos & retenciones</div>
        <ClientPicker clients={clients} value={clientId} onChange={setClientId}/>
        <div className="flex gap-2">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
            {[today.getFullYear() + 1, today.getFullYear(), today.getFullYear() - 1, today.getFullYear() - 2].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-black px-3 py-2 text-sm">
            {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
      </div>
      <nav className="border-b border-black/10 dark:border-white/10 bg-white dark:bg-black px-2 py-1 flex gap-1 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-colors
              ${tab === t.id ? 'bg-[#b3001e] text-white' : 'text-black/70 dark:text-white/70 hover:bg-[#b3001e]/10 hover:text-[#b3001e]'}`}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="flex-1 min-w-0 bg-white dark:bg-black">
        {!clientId && <div className="p-6 text-sm text-black/60 dark:text-white/60">Selecciona un cliente para empezar.</div>}
        {clientId && tab === 'activos'  && <ActivosTab     api={api} clientId={clientId} accounts={accounts} year={year} month={month}/>}
        {clientId && tab === 'ret_emit' && <RetencionesTab api={api} clientId={clientId} year={year} month={month} kind="emit"/>}
        {clientId && tab === 'ret_recv' && <RetencionesTab api={api} clientId={clientId} year={year} month={month} kind="recv"/>}
      </div>
    </div>
  )
}
