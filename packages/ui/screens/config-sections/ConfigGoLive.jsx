// ConfigGoLive — dedicated /config/go-live page.
//
// Production-mode toggle (fiscal go-live date). Promoted from
// Sistema.jsx L90-160 GoLiveSection as part of the 2026-05-19 config
// consolidation so the production-mode flip has its own findable home
// instead of being buried in the legacy monolith.
//
// Behavior: when go_live_date is empty or future, POS stays in MODO
// PRUEBA (no cloud sync, no DGII reporting, no commissions, no credit).
// When date is today or past, app.goLiveCommit() wipes test data and
// stamps go_live_committed_at — the LIVE state is irreversible.
import { useState } from 'react'
import { Rocket } from 'lucide-react'
import { useSettings, SettingSection, SettingRow, Toast } from '../Sistema'
import { useLang } from '../../i18n'
import { useAPI } from '../../context/DataContext'

export default function ConfigGoLive() {
  const { cfg, set, toast, show } = useSettings()
  const api = useAPI()
  const { lang } = useLang()
  const L = (es, en) => lang === 'es' ? es : en

  const goLiveDate = cfg.go_live_date || ''
  const committedAt = cfg.go_live_committed_at || ''

  const [draft, setDraft] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [testCount, setTestCount] = useState(null)
  const [working, setWorking] = useState(false)
  const committed = !!committedAt
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const parsed = goLiveDate ? new Date(`${goLiveDate}T00:00:00`) : null
  const inFuture = parsed && parsed.getTime() > today.getTime()
  const isLive = !!parsed && parsed.getTime() <= today.getTime()

  async function onPick(value) {
    setDraft(value)
    if (!value) { set('go_live_date', ''); return }
    const picked = new Date(`${value}T00:00:00`)
    if (picked.getTime() > today.getTime()) {
      set('go_live_date', value)
      return
    }
    try {
      const c = await api.app?.testDataCount?.()
      setTestCount(c?.tickets ?? 0)
    } catch (err) {
      try { window.__txReportError?.(err, { severity: 'error', category: 'config.golive.test_count' }) } catch {}
      setTestCount(0)
    }
    setConfirmOpen(true)
  }

  async function confirmGoLive() {
    setWorking(true)
    try {
      set('go_live_date', draft)
      await api.settings.update({ go_live_date: draft })
      await api.app?.goLiveCommit?.()
      set('go_live_committed_at', new Date().toISOString())
      try { window.dispatchEvent(new CustomEvent('tx:settings-changed')) } catch {}
      show(L('Producción activada', 'Production activated'))
      setConfirmOpen(false)
    } catch (e) {
      try { window.__txReportError?.(e, { severity: 'error', category: 'config.golive.commit' }) } catch {}
      show(L('Error al activar producción', 'Failed to activate production'), 'error')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <Rocket size={22} className="text-[#b3001e]" />
            {L('Producción (Go-Live)', 'Production (Go-Live)')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Fecha de transición de MODO PRUEBA a producción real.',
               'Date to transition from TEST MODE to real production.')}
          </p>
        </div>
        <Toast toast={toast} />

        <SettingSection title={L('Fecha de puesta en producción', 'Go-Live Date')}>
          <SettingRow
            label={L('Fecha de inicio operativo', 'Operational start date')}
            hint={L(
              'Mientras esta fecha esté vacía o sea futura, el POS está en MODO PRUEBA: ningún ticket se sincroniza ni se reporta al DGII, y no se generan comisiones ni crédito.',
              'While empty or in the future, the POS is in TEST MODE: no tickets sync, no DGII, no commissions, no credit.'
            )}
          >
            <div className="flex flex-col items-end gap-1">
              <input
                type="date"
                value={goLiveDate || ''}
                disabled={committed}
                onChange={e => onPick(e.target.value)}
                className="border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-[#b3001e] disabled:opacity-60"
              />
              {committed && (
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                  {L('Producción activada el', 'Activated on')} {String(committedAt).slice(0, 10)}
                </span>
              )}
              {!committed && !goLiveDate && (
                <span className="text-[10px] text-[#b3001e] font-bold uppercase tracking-wide">
                  {L('⚠ MODO PRUEBA — configure una fecha para activar', '⚠ TEST MODE — set a date to activate')}
                </span>
              )}
              {!committed && inFuture && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">
                  {L('Activará automáticamente el', 'Will activate on')} {goLiveDate}
                </span>
              )}
              {!committed && isLive && (
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">LIVE</span>
              )}
            </div>
          </SettingRow>
        </SettingSection>

        {confirmOpen && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl max-w-md w-full p-6 border-4 border-[#b3001e]">
              <h3 className="text-lg font-bold text-[#b3001e] mb-2">
                {L('Activar producción', 'Activate production')}
              </h3>
              <p className="text-[13px] text-slate-700 dark:text-white/80 mb-3">
                {L(
                  'Esta acción es irreversible. A partir de hoy todas las ventas se sincronizarán con la nube y se reportarán al DGII.',
                  'This is irreversible. From today on, every sale will sync to the cloud and report to DGII.'
                )}
              </p>
              <div className="bg-[#b3001e]/10 border border-[#b3001e]/30 rounded-lg px-3 py-2 mb-4">
                <p className="text-[12px] text-[#b3001e] font-semibold">
                  {L('Se borrarán', 'Will delete')} <span className="text-base">{testCount ?? '…'}</span>{' '}
                  {L('tickets de prueba', 'test tickets')}
                </p>
                <p className="text-[11px] text-slate-600 dark:text-white/60 mt-1">
                  {L(
                    'Incluye items, pagos, y cualquier dato de prueba acumulado durante la configuración.',
                    'Includes items, payments, and any test data accumulated during setup.'
                  )}
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setConfirmOpen(false)}
                  disabled={working}
                  className="px-4 py-2 rounded-lg text-[13px] font-semibold border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-50"
                >
                  {L('Cancelar', 'Cancel')}
                </button>
                <button
                  onClick={confirmGoLive}
                  disabled={working}
                  className="px-4 py-2 rounded-lg text-[13px] font-bold bg-[#b3001e] text-white hover:bg-[#8e0018] disabled:opacity-50"
                >
                  {working ? L('Activando…', 'Activating…') : L('Activar y borrar pruebas', 'Activate and wipe tests')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
