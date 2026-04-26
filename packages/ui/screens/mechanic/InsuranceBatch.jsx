import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { Shield, ArrowLeft, Loader2, Plus, FileText, CheckCircle2 } from 'lucide-react'
import { useAPI } from '../../context/DataContext'
import { useLang } from '../../i18n'
import { signAndSubmitECF, formatDGIIDate } from '@terminal-x/services/ecf'

function fmtRD(n) {
  return `RD$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function currentMonthYM() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-01`
}

export default function InsuranceBatch() {
  const { aseguradoraId } = useParams()
  const api = useAPI()
  const navigate = useNavigate()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [aseguradora, setAseguradora] = useState(null)
  const [period, setPeriod] = useState(currentMonthYM())
  const [periodWOs, setPeriodWOs] = useState([])
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [err, setErr] = useState('')

  async function refresh() {
    setLoading(true)
    setErr('')
    // H1: previously every step had a `.catch(() => null/[])` which silently
    // hid network/RLS failures behind an empty list. Now we surface the
    // first error to the user (without crashing the whole page).
    const errors = []
    let aseg = null, wos = [], list = []
    try { aseg = await api.aseguradoras?.bySupabaseId?.(aseguradoraId) }
    catch (e) { errors.push(L('Aseguradora','Insurer') + ': ' + (e?.message || 'error')) }
    try { wos = (await api.insuranceBatches?.workOrdersFor?.(aseguradoraId, period)) || [] }
    catch (e) { errors.push('WO: ' + (e?.message || 'error')) }
    try { list = (await api.insuranceBatches?.listByPeriod?.({ aseguradora_supabase_id: aseguradoraId })) || [] }
    catch (e) { errors.push(L('Lotes','Batches') + ': ' + (e?.message || 'error')) }
    setAseguradora(aseg)
    setPeriodWOs(wos)
    setBatches(list)
    if (errors.length) setErr(L('No se pudieron cargar todos los datos: ', 'Some data failed to load: ') + errors.join(' | '))
    setLoading(false)
  }
  useEffect(() => { refresh() }, [aseguradoraId, period]) // eslint-disable-line

  const total = periodWOs.reduce((s, w) => s + (Number(w.total) || 0), 0)
  const itbis = periodWOs.reduce((s, w) => s + (Number(w.itbis) || 0), 0)

  // FIX-C3 — real E31 consolidated signing.
  //
  // Aggregates every WO in the period into one e-CF (tipoECF=31, comprador =
  // aseguradora). Reuses the existing `signAndSubmitECF` pipeline so:
  //   • on desktop with cert installed → IPC dgii:submit signs + sends
  //   • on web (PWA) → POST /api/ecf-sign on the server signs + sends
  //   • offline / DGII unreachable → row is queued in ecf_queue with
  //     IndicadorEnvioDiferido='1' and resubmitted by processDgiiQueue() on
  //     reconnect (the existing 72h offline contingency).
  //
  // Persisted side-effects:
  //   1. insurance_batches row created in 'borrador' (so the lote is visible
  //      even if the e-CF call fails — the user can retry without losing the
  //      aggregated dataset).
  //   2. On e-CF success, batch flips to 'emitido' with ecf_ncf + total +
  //      itbis stamped.
  //   3. activity_log emits `insurance_batch_emitted` (already wired in
  //      web.js insuranceBatches.create).
  async function generate() {
    if (!periodWOs.length) return
    setGenerating(true)
    setErr('')
    try {
      if (!aseguradora?.rnc) {
        throw new Error('La aseguradora no tiene RNC configurado. Edítela primero.')
      }

      // 1. Create the batch row first (status=borrador) so the user can
      //    retry without losing the aggregation if the e-CF firma falla.
      const batch = await api.insuranceBatches?.create?.({
        aseguradora_supabase_id: aseguradoraId,
        period_month: period,
        total_amount: total,
        itbis_amount: itbis,
        work_order_count: periodWOs.length,
        status: 'borrador',
      })
      if (!batch?.id) throw new Error('No se pudo crear el lote en la base de datos.')

      // 2. Pull emisor info (business RNC + name) for the e-CF header.
      const empresa = await (api.admin?.getEmpresa?.() || Promise.resolve({}))

      // 3. Allocate next E31 NCF.
      const eNCF = await api?.ncf?.next?.('E31')
      if (!eNCF) throw new Error('No hay secuencia E31 disponible. Configure el rango en DGII.')

      // 4. Build aggregated items — one line per WO (e-CF spec allows up to
      //    1000 items, well above any monthly batch).
      const items = periodWOs.map((w, i) => ({
        nombre: `WO-${String(w.id).padStart(4, '0')} · Placa ${w.vehicle_plate || 's/p'} · Reclamo ${w.reclamo_no || 's/r'}`,
        descripcion: `Servicio ${formatDGIIDate(w.completed_date || w.finished_at || w.updated_at).slice(0, 10)} — ${w.client_name || ''}`.slice(0, 80),
        cantidad: 1,
        precioUnitario: Number(w.total) || 0,
        montoItem: Number(w.total) || 0,
        // Parts ITBIS share, prorrateado a la línea — DGII acepta itbis por línea
        // o consolidado en Totales. Consolidado en Totales es suficiente.
        indicadorFacturacion: '1',
      }))

      // 5. Build invoiceData for signAndSubmitECF.
      const subtotal = total - itbis
      const invoiceData = {
        tipoECF: '31',
        eNCF,
        emisor: {
          rnc: (empresa?.rnc || '').replace(/\D/g, ''),
          razonSocial: empresa?.name || empresa?.razon_social || 'Taller Mecánico',
          nombreComercial: empresa?.name || '',
          direccion: empresa?.address || '',
        },
        comprador: {
          rnc: String(aseguradora.rnc).replace(/\D/g, ''),
          razonSocial: aseguradora.nombre,
          // Aseguradora no tiene phone/email obligatorios en E31; opcionales.
        },
        totales: {
          subtotal: Number(subtotal.toFixed(2)),
          itbis18: Number(Number(itbis).toFixed(2)),
          total: Number(Number(total).toFixed(2)),
          montoGravado18: Number(subtotal.toFixed(2)),
          montoExento: 0,
        },
        items,
        metodoPago: 'credito',
        tipoIngresos: '01',
        fechaVencimiento: '31-12-2028',
      }

      // 6. Sign + submit. signAndSubmitECF handles offline transparently:
      //    desktop main process queues to ecf_queue with IndicadorEnvioDiferido='1'
      //    and processDgiiQueue() retries every 30s for up to 72h.
      const result = await signAndSubmitECF(invoiceData, api)

      // 7. Update the batch row with the e-CF results.
      const queued = result?.status === 'pending' || result?.status === 'queued' || result?.status === 'EN_PROCESO'
      const batchPatch = {
        ecf_ncf: result?.eNCF || eNCF,
        status: queued ? 'borrador' : 'emitido',
        notes: queued
          ? `e-CF en cola offline (72h). Track ${result?.trackId || '—'}.`
          : `Emitido ${formatDGIIDate(result?.signatureDate || new Date()).slice(0, 10)}. Track ${result?.trackId || '—'}.`,
      }
      try { await api.insuranceBatches?.update?.(batch.id, batchPatch) }
      catch (e) { console.warn('[InsuranceBatch] update failed', e?.message || e) }

      await refresh()
    } catch (e) {
      setErr(e?.message || 'Error generando lote')
    } finally {
      setGenerating(false)
    }
  }

  if (loading) return <div className="p-12 text-center"><Loader2 className="animate-spin mx-auto"/></div>

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Link to="/aseguradoras" className="inline-flex items-center gap-2 text-sm mb-4 underline dark:text-white"><ArrowLeft size={14}/>{L('Aseguradoras', 'Insurers')}</Link>

      <div className="mb-6 flex items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 dark:text-white"><Shield size={32}/>{aseguradora?.nombre || L('Aseguradora','Insurer')}</h1>
          <p className="text-sm text-black/70 dark:text-white/70 mt-1">
            {L('Modo:','Mode:')} <strong>{aseguradora?.ecf_mode === 'monthly_batch' ? L('Lote mensual consolidado','Monthly consolidated batch') : L('Por WO','Per WO')}</strong>
          </p>
        </div>
        <div>
          <label className="block text-xs font-bold uppercase mb-1 dark:text-white">{L('Periodo','Period')}</label>
          <input type="month" value={period.slice(0,7)} onChange={e => setPeriod(e.target.value + '-01')} className="p-2 border border-black dark:border-white/30 dark:bg-white/5 dark:text-white"/>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <KPI label={L('WO en periodo','WO in period')} value={periodWOs.length}/>
        <KPI label={L('Total','Total')} value={fmtRD(total)}/>
        <KPI label={L('ITBIS','ITBIS')} value={fmtRD(itbis)}/>
      </div>

      <div className="border border-black dark:border-white/20 bg-white dark:bg-white/5 mb-6">
        <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs uppercase tracking-wide bg-black text-white">
          <div className="col-span-2">{L('Fecha','Date')}</div>
          <div className="col-span-2">{L('Placa','Plate')}</div>
          <div className="col-span-3">{L('Cliente','Client')}</div>
          <div className="col-span-2">{L('Reclamo','Claim')}</div>
          <div className="col-span-2 text-right">{L('Total','Total')}</div>
          <div className="col-span-1">{L('Estado','Status')}</div>
        </div>
        {periodWOs.length === 0 ? (
          <p className="p-6 text-center text-sm text-black/50 dark:text-white/50">{L('Sin WO en este periodo.','No WOs in this period.')}</p>
        ) : periodWOs.map(w => (
          <div key={w.id} className="grid grid-cols-12 gap-2 px-4 py-2 text-sm border-t border-black/10 dark:border-white/10 dark:text-white">
            <div className="col-span-2 text-xs">{w.completed_date ? new Date(w.completed_date).toLocaleDateString('es-DO') : '—'}</div>
            <div className="col-span-2 font-semibold">{w.vehicle_plate}</div>
            <div className="col-span-3">{w.client_name}</div>
            <div className="col-span-2">{w.reclamo_no || '—'}</div>
            <div className="col-span-2 text-right">{fmtRD(w.total)}</div>
            <div className="col-span-1 text-xs">{w.aseguradora_status || '—'}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-end mb-8 gap-2">
        {err && <p className="text-[12px] text-[#b3001e] font-bold self-stretch">{err}</p>}
        <button onClick={generate} disabled={generating || !periodWOs.length} className="px-4 py-2 bg-[#b3001e] text-white font-bold hover:bg-black disabled:opacity-50 flex items-center gap-2">
          {generating ? <Loader2 size={16} className="animate-spin"/> : <Plus size={16}/>}{L('Generar Lote (PDF + e-CF)', 'Generate Batch (PDF + e-CF)')}
        </button>
      </div>

      <h2 className="font-bold mb-2 flex items-center gap-2 dark:text-white"><FileText size={18}/>{L('Lotes generados','Generated batches')}</h2>
      <div className="border border-black dark:border-white/20 bg-white dark:bg-white/5">
        {batches.length === 0 ? (
          <p className="p-6 text-center text-sm text-black/50 dark:text-white/50">{L('Aún sin lotes.','No batches yet.')}</p>
        ) : batches.map(b => (
          <div key={b.id} className="grid grid-cols-12 gap-2 px-4 py-3 text-sm border-t border-black/10 dark:border-white/10 dark:text-white">
            <div className="col-span-2 font-semibold">{b.period_month?.slice(0,7)}</div>
            <div className="col-span-2">WO: {b.work_order_count}</div>
            <div className="col-span-2 text-right">{fmtRD(b.total_amount)}</div>
            <div className="col-span-2">{b.ecf_ncf || '—'}</div>
            <div className="col-span-2"><span className="px-2 py-0.5 bg-black text-white text-xs">{b.status}</span></div>
            <div className="col-span-2 text-right">{b.created_at ? new Date(b.created_at).toLocaleDateString('es-DO') : ''}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function KPI({ label, value }) {
  return (
    <div className="border border-black dark:border-white/20 p-4 bg-white dark:bg-white/5 dark:text-white">
      <div className="text-xs uppercase opacity-70">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  )
}
