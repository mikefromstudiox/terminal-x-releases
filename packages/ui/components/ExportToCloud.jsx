import { useState } from 'react'
import { CloudUpload, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { getSupabaseClient, getBusinessId, ensureBusinessRegistered } from '@terminal-x/services/supabase.js'
import { useLang } from '../i18n'

const TABLES = [
  { key: 'users',           supaTable: 'users',           label_es: 'Usuarios',       label_en: 'Users' },
  { key: 'services',        supaTable: 'services',        label_es: 'Servicios',      label_en: 'Services' },
  { key: 'washers',         supaTable: 'washers',         label_es: 'Lavadores',      label_en: 'Washers' },
  { key: 'sellers',         supaTable: 'sellers',         label_es: 'Vendedores',     label_en: 'Sellers' },
  { key: 'clients',         supaTable: 'clients',         label_es: 'Clientes',       label_en: 'Clients' },
  { key: 'tickets',         supaTable: 'tickets',         label_es: 'Tickets',        label_en: 'Tickets' },
  { key: 'ticket_items',    supaTable: 'ticket_items',    label_es: 'Items',          label_en: 'Items' },
  { key: 'ncf_sequences',   supaTable: 'ncf_sequences',   label_es: 'Secuencias NCF', label_en: 'NCF Sequences' },
  { key: 'inventory_items', supaTable: 'inventory_items', label_es: 'Inventario',     label_en: 'Inventory' },
]

export default function ExportToCloud() {
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const [exporting, setExporting] = useState(false)
  const [current, setCurrent]     = useState('')
  const [result, setResult]       = useState(null) // { ok, message } or null

  async function handleExport() {
    setExporting(true)
    setResult(null)
    setCurrent(L('Preparando...', 'Preparing...'))

    try {
      // Ensure business is registered in Supabase
      const regResult = await ensureBusinessRegistered()
      if (!regResult.ok) throw new Error(regResult.error)

      const businessId = getBusinessId()
      if (!businessId) throw new Error(L('No se encontró el ID del negocio', 'Business ID not found'))

      const sb = getSupabaseClient()
      if (!sb) throw new Error(L('Supabase no configurado', 'Supabase not configured'))

      // Pull all data from local SQLite
      setCurrent(L('Leyendo base de datos local...', 'Reading local database...'))
      if (!window.electronAPI) throw new Error(L('Solo disponible en la app de escritorio', 'Only available in desktop app'))
      const data = await window.electronAPI.db.exportToSupabase()

      let totalRows = 0

      for (const table of TABLES) {
        const rows = data[table.key]
        if (!rows || (Array.isArray(rows) && rows.length === 0)) continue

        const label = lang === 'es' ? table.label_es : table.label_en
        setCurrent(L(`Exportando ${label}...`, `Exporting ${label}...`))

        const rowsArray = Array.isArray(rows) ? rows : [rows]

        // Map rows: add business_id, use supabase_id pattern
        const mapped = rowsArray.map(row => {
          const { id, ...rest } = row
          return {
            ...rest,
            business_id: businessId,
          }
        })

        // Upsert in batches of 100
        for (let i = 0; i < mapped.length; i += 100) {
          const batch = mapped.slice(i, i + 100)
          const { error } = await sb
            .from(table.supaTable)
            .upsert(batch, { onConflict: 'business_id,supabase_id' })

          if (error) throw new Error(`${table.supaTable}: ${error.message}`)
        }

        totalRows += rowsArray.length
      }

      setCurrent('')
      setResult({
        ok: true,
        message: L(
          `Exportacion completada. ${totalRows} registros sincronizados.`,
          `Export complete. ${totalRows} records synced.`
        ),
      })
    } catch (err) {
      setCurrent('')
      setResult({ ok: false, message: err.message })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="border border-slate-200 rounded-xl p-4">
      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
        {L('Exportar a la Nube', 'Export to Cloud')}
      </p>
      <p className="text-[12px] text-slate-500 mb-4">
        {L(
          'Sube todos los datos locales a Supabase para respaldo en la nube y acceso remoto.',
          'Push all local data to Supabase for cloud backup and remote access.'
        )}
      </p>

      <button
        onClick={handleExport}
        disabled={exporting}
        className="flex items-center gap-2 px-4 py-2.5 bg-[#0C447C] hover:bg-[#0a3a6a] disabled:opacity-50
          text-white text-[13px] font-bold rounded-lg transition-colors"
      >
        {exporting
          ? <><Loader2 size={14} className="animate-spin" /> {current}</>
          : <><CloudUpload size={14} /> {L('Exportar a la Nube', 'Export to Cloud')}</>
        }
      </button>

      {result && (
        <div className={`mt-3 flex items-center gap-2 text-[12px] font-semibold ${
          result.ok ? 'text-emerald-600' : 'text-red-500'
        }`}>
          {result.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          {result.message}
        </div>
      )}
    </div>
  )
}
