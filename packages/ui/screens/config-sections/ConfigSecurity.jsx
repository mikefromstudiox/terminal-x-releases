// ConfigSecurity — dedicated /config/security page. Manager Authorization
// Card config + Manager Authorization gates + Kiosk auto-lock + Reset Local DB
// recovery action + a quick deep-link to Usuarios for PIN management.
//
// 2026-05-19 — Mgr-auth gates + Reset Local DB promoted from Sistema.jsx
// as part of the config-sections consolidation. Reset DB eliminates the
// manual %APPDATA% delete dance for support + first-install recovery.
import { useState } from 'react'
import { Shield, RotateCcw, AlertTriangle } from 'lucide-react'
import { useSettings, SettingSection, SettingRow, SaveBtn, Toast, Toggle, Input } from '../Sistema'
import { useLang } from '../../i18n'
import { useAuth } from '../../context/AuthContext'

export default function ConfigSecurity() {
  const { cfg, set, on, handleSave, saving, saved, toast, show } = useSettings()
  const { lang } = useLang()
  const { user } = useAuth()
  const L = (es, en) => lang === 'es' ? es : en
  const isOwner = user?.role === 'owner'

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [resetBackupFirst, setResetBackupFirst] = useState(true)
  const [resetWorking, setResetWorking] = useState(false)

  async function confirmReset() {
    setResetWorking(true)
    try {
      const api = window.electronAPI
      if (!api?.app?.resetLocalDb) {
        show(L('Solo disponible en escritorio', 'Desktop-only feature'), 'error')
        setResetConfirmOpen(false)
        return
      }
      const result = await api.app.resetLocalDb({ backupFirst: resetBackupFirst })
      if (!result?.ok) {
        show(result?.error || L('Error al resetear', 'Reset failed'), 'error')
      }
      // App relaunches itself on success — no need to do anything more here.
    } catch (e) {
      try { window.__txReportError?.(e, { severity: 'error', category: 'config.security.reset_db' }) } catch {}
      show(L('Error al resetear', 'Reset failed'), 'error')
    } finally {
      setResetWorking(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <Shield size={22} className="text-[#b3001e]" />
            {L('Seguridad', 'Security')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Autorización de gerente, PINs y sesiones activas.',
               'Manager authorization, PINs and active sessions.')}
          </p>
        </div>
        <Toast toast={toast} />

        <SettingSection title={L('Autorización de Gerente — Tarjeta', 'Manager Authorization — Card')}>
          <SettingRow settingKey="manager_auth_card_required"
            label={L('Tarjeta de gerente requerida', 'Manager card required')}
            hint={L('Acciones sensibles (descuento, void, override) piden tarjeta o PIN.', 'Sensitive actions (discount, void, override) require manager card or PIN.')}>
            <Toggle enabled={on('manager_auth_card_required')} onChange={v => set('manager_auth_card_required', v ? '1' : '0')} />
          </SettingRow>
          <SettingRow settingKey="manager_pin_fallback"
            label={L('PIN como respaldo', 'PIN fallback')}
            hint={L('Si la tarjeta no está disponible, acepta PIN del gerente.', 'If the card is unavailable, accept manager PIN instead.')}>
            <Toggle enabled={on('manager_pin_fallback')} onChange={v => set('manager_pin_fallback', v ? '1' : '0')} />
          </SettingRow>
          <SettingRow settingKey="big_discount_threshold"
            label={L('Umbral descuento grande %', 'Big-discount threshold %')}
            hint={L('Descuentos sobre este % piden gerente.', 'Discounts above this % require manager.')}>
            <Input type="number" min="0" max="100" step="1"
              value={cfg.big_discount_threshold ?? '15'}
              onChange={e => set('big_discount_threshold', e.target.value)}
              className="w-20 text-center" />
          </SettingRow>
        </SettingSection>

        {/* 2026-05-19 — Manager-auth gates per sensitive action. Migrated from
            Sistema.jsx L697-719 where they were buried at the top of the file
            and rarely surfaced. */}
        <SettingSection title={L('Acciones que requieren gerente', 'Actions that require manager auth')}>
          <SettingRow settingKey="mgr_gate_enabled_discount_big"
            label={L('Descuentos grandes', 'Large discounts')}
            hint={L('> RD$500 o > 15% del total', '> RD$500 or > 15% of total')}>
            <Toggle enabled={String(cfg.mgr_gate_enabled_discount_big ?? '1') === '1'}
              onChange={v => set('mgr_gate_enabled_discount_big', v ? '1' : '0')} />
          </SettingRow>
          <SettingRow settingKey="mgr_gate_enabled_void"
            label={L('Anulación de factura', 'Invoice void')}>
            <Toggle enabled={String(cfg.mgr_gate_enabled_void ?? '1') === '1'}
              onChange={v => set('mgr_gate_enabled_void', v ? '1' : '0')} />
          </SettingRow>
          <SettingRow settingKey="mgr_gate_enabled_credit_note"
            label={L('Nota de crédito', 'Credit note')}>
            <Toggle enabled={String(cfg.mgr_gate_enabled_credit_note ?? '1') === '1'}
              onChange={v => set('mgr_gate_enabled_credit_note', v ? '1' : '0')} />
          </SettingRow>
          <SettingRow settingKey="mgr_gate_enabled_inv_adjust"
            label={L('Ajuste de inventario', 'Inventory adjustment')}>
            <Toggle enabled={String(cfg.mgr_gate_enabled_inv_adjust ?? '1') === '1'}
              onChange={v => set('mgr_gate_enabled_inv_adjust', v ? '1' : '0')} />
          </SettingRow>
          <SettingRow settingKey="mgr_gate_enabled_price_edit"
            label={L('Edición de precio en POS', 'Price edit in POS')}>
            <Toggle enabled={String(cfg.mgr_gate_enabled_price_edit ?? '1') === '1'}
              onChange={v => set('mgr_gate_enabled_price_edit', v ? '1' : '0')} />
          </SettingRow>
        </SettingSection>

        <SettingSection title={L('Kiosco / Auto-bloqueo', 'Kiosk / Auto-Lock')}>
          <SettingRow settingKey="kiosk_auto_lock_enabled"
            label={L('Bloqueo automático por inactividad', 'Auto-lock on inactivity')}
            hint={L('Después de X minutos sin actividad, el POS pide PIN para continuar.',
                    'After X idle minutes, the POS requires a PIN to continue.')}>
            <Toggle enabled={on('kiosk_auto_lock_enabled')} onChange={v => set('kiosk_auto_lock_enabled', v ? '1' : '0')} />
          </SettingRow>
          {on('kiosk_auto_lock_enabled') && (
            <SettingRow settingKey="kiosk_auto_lock_minutes"
              label={L('Minutos de inactividad', 'Idle minutes')}
              hint={L('Defecto: 5 minutos', 'Default: 5 minutes')}>
              <Input type="number" min="1" max="60" step="1"
                value={cfg.kiosk_auto_lock_minutes ?? '5'}
                onChange={e => set('kiosk_auto_lock_minutes', e.target.value)}
                className="w-20 text-center" />
            </SettingRow>
          )}
        </SettingSection>

        {/* 2026-05-19 — "Administrar usuarios y PINs" deep-link removed.
            Real user CRUD + PIN reset lives in /config/usuarios (Users card)
            so owners go there directly instead of bouncing through Security. */}

        {/* 2026-05-19 — Reset Local DB recovery action. Owner-only.
            Wipes %APPDATA%\Terminal X folder contents + relaunches app so
            license activation flow runs fresh. Cloud data is untouched —
            everything resyncs after re-activation. Eliminates the manual
            "delete folder via Win+R" support dance. */}
        {isOwner && (
          <div className="mt-5 rounded-2xl border-2 border-amber-300 dark:border-amber-600/40 bg-amber-50 dark:bg-amber-900/10 p-4 md:p-5">
            <div className="flex items-start gap-3">
              <RotateCcw size={20} className="text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <h3 className="text-[14px] font-bold text-amber-900 dark:text-amber-200">
                  {L('Resetear base de datos local', 'Reset local database')}
                </h3>
                <p className="text-[11px] text-amber-800 dark:text-amber-300/70 mt-1 mb-3 leading-snug">
                  {L(
                    'Borra todos los datos locales de este POS y reinicia el app. La nube y otros terminales no se ven afectados. Útil cuando un terminal se queda en un estado inconsistente o necesita re-activarse contra otro negocio.',
                    'Wipes all local data on this POS and restarts the app. Cloud and other terminals are not affected. Useful when a terminal gets into an inconsistent state or needs to re-activate against a different business.',
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => setResetConfirmOpen(true)}
                  className="text-[12px] font-bold px-3 py-1.5 rounded-lg border-2 border-amber-600 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/20 transition-colors"
                >
                  {L('Resetear ahora', 'Reset now')}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end mt-4">
          <SaveBtn saving={saving} saved={saved} label={L('Guardar', 'Save')} onClick={handleSave} />
        </div>

        {resetConfirmOpen && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl max-w-md w-full p-6 border-4 border-amber-500">
              <h3 className="text-lg font-bold text-amber-700 dark:text-amber-300 mb-2 inline-flex items-center gap-2">
                <AlertTriangle size={18} />
                {L('Confirmar reset local', 'Confirm local reset')}
              </h3>
              <p className="text-[13px] text-slate-700 dark:text-white/80 mb-3">
                {L(
                  'Esta acción borrará la base local y reiniciará el app. Necesitarás re-activar la licencia y volver a iniciar sesión.',
                  'This will wipe the local database and restart the app. You will need to re-activate the license and log in again.',
                )}
              </p>
              <label className="flex items-center gap-2 mb-4 text-[12px] text-slate-700 dark:text-white/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={resetBackupFirst}
                  onChange={e => setResetBackupFirst(e.target.checked)}
                  className="w-4 h-4 accent-[#b3001e]"
                />
                {L('Hacer respaldo antes (recomendado)', 'Backup first (recommended)')}
              </label>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setResetConfirmOpen(false)}
                  disabled={resetWorking}
                  className="px-4 py-2 rounded-lg text-[13px] font-semibold border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-50"
                >
                  {L('Cancelar', 'Cancel')}
                </button>
                <button
                  onClick={confirmReset}
                  disabled={resetWorking}
                  className="px-4 py-2 rounded-lg text-[13px] font-bold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {resetWorking ? L('Reseteando…', 'Resetting…') : L('Sí, resetear', 'Yes, reset')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
