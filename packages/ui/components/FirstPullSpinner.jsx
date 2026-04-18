import { useEffect, useState } from 'react'
import { Loader2, Cloud } from 'lucide-react'
import logoImg from '../assets/logo.webp'
import { useLicense } from '../context/LicenseContext'

// Rotating status phrases so the UI never feels frozen even when pull progress
// events are delayed (e.g. while waiting for the auth JWT or the first RPC to
// return). Cycles every 1.4s regardless of real progress — when a real table
// event arrives it takes priority.
const PREPARING_PHRASES = [
  'Verificando licencia…',
  'Conectando con el servidor…',
  'Validando certificado…',
  'Preparando base de datos…',
  'Cargando catálogo…',
  'Un momento por favor…',
]

// Humanize table names so "inventory_items" reads as "inventario" to the user.
const TABLE_LABEL = {
  services: 'servicios', clients: 'clientes', inventory_items: 'inventario',
  ncf_sequences: 'secuencias NCF', empleados: 'empleados',
  categorias_servicio: 'categorías', mesas: 'mesas',
  modificadores: 'modificadores', vehicles: 'vehículos',
  service_bays: 'bahías', stylist_schedules: 'horarios',
  users: 'usuarios', activity_log: 'actividad',
  service_modificadores: 'modificadores', tickets: 'tickets',
  work_orders: 'órdenes de trabajo', appointments: 'citas',
  loans: 'préstamos', ticket_items: 'items de ticket',
  queue: 'cola', washer_commissions: 'comisiones',
  seller_commissions: 'comisiones', cajero_commissions: 'comisiones',
  credit_payments: 'pagos a crédito', cuadre_caja: 'cuadres',
  caja_chica: 'caja chica', notas_credito: 'notas de crédito',
  salary_changes: 'historial salarial', payroll_runs: 'nóminas',
  adelantos: 'adelantos', compras_607: 'compras 607',
  memberships: 'membresías', wash_combos: 'combos',
  subscriptions: 'suscripciones', service_packages: 'paquetes',
  projects: 'proyectos', client_service_rates: 'tarifas',
  loan_payments: 'pagos préstamos', loan_schedule: 'calendario',
  pawn_items: 'empeños', collections_log: 'cobranzas',
  businesses: 'configuración del negocio',
}

export default function FirstPullSpinner() {
  const { firstPullProgress } = useLicense()
  const done = Number(firstPullProgress?.done || 0)
  const total = Number(firstPullProgress?.total || 0)
  const table = firstPullProgress?.table || null
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null

  // Rotating phrase for the "Preparando…" pre-progress state. Advances every
  // 1.4s so the screen always feels alive.
  const [phraseIdx, setPhraseIdx] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setPhraseIdx(i => (i + 1) % PREPARING_PHRASES.length), 1400)
    return () => clearInterval(id)
  }, [])

  // Elapsed timer — after 45s show a hint that something may be wrong.
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const tableLabel = table ? (TABLE_LABEL[table] || table) : null
  const statusLine = total > 0
    ? (tableLabel
        ? `Descargando ${tableLabel}… (${done} de ${total})`
        : `Descargando datos… (${done} de ${total})`)
    : PREPARING_PHRASES[phraseIdx]

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black">
      <div className="text-center max-w-sm w-full px-6">
        <img
          src={logoImg}
          alt="Terminal X"
          className="w-60 h-60 object-contain mx-auto mb-8 animate-pulse"
          style={{ animationDuration: '2.4s' }}
          width={240}
          height={240}
        />

        <div className="inline-flex items-center gap-2 text-white/80 text-sm mb-3">
          <Cloud size={16} className="text-[#b3001e]" />
          <span>Sincronizando datos iniciales</span>
        </div>

        <div className="flex items-center justify-center gap-2 text-zinc-400 text-xs min-h-[1.25rem]">
          <Loader2 size={12} className="animate-spin" />
          <span key={statusLine} className="transition-opacity duration-300">
            {statusLine}
          </span>
        </div>

        {pct != null && (
          <div className="mt-4 h-1 w-full bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#b3001e] transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        <p className="mt-6 text-zinc-500 text-[11px]">
          Primera activación en este equipo — esto puede tardar hasta 30 segundos.
        </p>

        {elapsed > 45 && (
          <p className="mt-3 text-amber-400/70 text-[11px]">
            Tomando más de lo esperado. Verifica tu conexión a internet.
          </p>
        )}
      </div>
    </div>
  )
}
