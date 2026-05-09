// ConfigWhatsApp — dedicated /config/whatsapp page. Shows ONLY WhatsApp
// settings, not the rest of Preferencias. Reachable from the ConfigGrid
// WhatsApp card.
//
// Mirrors the section that lives inside Preferencias for backward-compat
// (legacy /config/preferencias#whatsapp deep-link still works), but this
// page is its own surface — separate save button, separate state, no
// other settings visible above/below.
//
// Per-vertical templates via @terminal-x/services/whatsappTemplates.
// Per the standing rule, error reporting wired on test-send + auto-fire
// failure paths.
import { useState } from 'react'
import { Send, X as IconX, Loader2, MessageSquare } from 'lucide-react'
import { useSettings, SettingSection, SettingRow, SaveBtn, Toast, Toggle, Input } from '../Sistema'
import { useLang } from '../../i18n'
import { useBusinessType } from '../../hooks/useBusinessType.jsx'
import { defaultFor as waDefaultFor } from '@terminal-x/services/whatsappTemplates'

export default function ConfigWhatsApp() {
  const { cfg, set, on, handleSave, saving, saved, toast, show } = useSettings()
  const { lang } = useLang()
  const { businessType, isMechanic, isFoodTruck } = useBusinessType()
  const L = (es, en) => lang === 'es' ? es : en

  const [testOpen, setTestOpen] = useState(false)
  const [testPhone, setTestPhone] = useState('')
  const [testSending, setTestSending] = useState(false)
  async function sendTestWa() {
    const phone = String(testPhone || '').trim()
    if (!phone) return
    setTestSending(true)
    try {
      const r = await fetch('/api/panel?action=salon-whatsapp-send-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ test_message: true, test_phone: phone }),
      })
      if (r.status === 429) show(L('Espera 1 minuto e intenta de nuevo', 'Wait 1 minute and try again'), 'error')
      else if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        if (j?.error === 'invalid_phone') show(L('Teléfono inválido', 'Invalid phone'), 'error')
        else show(L('No se pudo enviar', 'Could not send'), 'error')
        try {
          window.__txReportError?.(new Error(j?.error || 'wa_test_send_failed'), {
            severity: 'warn',
            category: 'config_whatsapp_test_send',
            extra: { status: r.status, error_code: j?.error || null },
          })
        } catch {}
      } else {
        show(L(`Mensaje enviado a ${phone}`, `Message sent to ${phone}`))
        setTestOpen(false); setTestPhone('')
      }
    } catch (e) {
      show(L('Error de red', 'Network error'), 'error')
      try {
        window.__txReportError?.(e, { severity: 'warn', category: 'config_whatsapp_test_send_network' })
      } catch {}
    }
    setTestSending(false)
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <MessageSquare size={22} className="text-[#b3001e]" />
            WhatsApp
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Conexión UltraMsg, mensajes automáticos por evento y plantillas para tu tipo de negocio.',
               'UltraMsg connection, per-event auto-send toggles, and templates tuned to your business type.')}
          </p>
        </div>

        <Toast toast={toast} />

        <SettingSection title="UltraMsg">
          <SettingRow label="Instance ID" hint={L('ID de instancia UltraMsg', 'UltraMsg instance ID')}>
            <Input type="text" value={cfg.whatsapp_instance ?? ''} onChange={e => set('whatsapp_instance', e.target.value)} placeholder="instance166620" className="w-44" />
          </SettingRow>
          <SettingRow label="Token" hint={L('Token de autenticación', 'Auth token')}>
            <Input type="text" value={cfg.whatsapp_token ?? ''} onChange={e => set('whatsapp_token', e.target.value)} placeholder="token..." className="w-44" />
          </SettingRow>
          <SettingRow label={L('Probar conexión', 'Test connection')} hint={L('Envía un mensaje de prueba a un número.', 'Sends a test message to a phone.')}>
            <button
              type="button" onClick={() => setTestOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#b3001e] text-[#b3001e] hover:bg-[#b3001e] hover:text-white rounded-lg text-[12px] font-bold transition-colors"
            >
              <Send size={12}/> {L('Enviar prueba', 'Send test')}
            </button>
          </SettingRow>
        </SettingSection>

        <SettingSection title={L('Envíos automáticos', 'Auto-send')}>
          <SettingRow settingKey="whatsapp_auto_receipt"
            label={L('Recibo al cobrar', 'Receipt on cobro')}
            hint={L('Tras cobrar, envía el recibo al teléfono del cliente.', 'After cobro, sends the receipt to the customer phone.')}>
            <Toggle enabled={on('whatsapp_auto_receipt')} onChange={v => set('whatsapp_auto_receipt', v ? '1' : '0')} />
          </SettingRow>
          {(isFoodTruck || businessType === 'restaurant') && (
            <SettingRow settingKey="whatsapp_auto_kds_ready"
              label={L('Aviso "Orden lista"', '"Order ready" ping')}
              hint={L('Cuando KDS marca la orden lista, envía aviso al cliente.', 'When KDS bumps to ready, pings the customer.')}>
              <Toggle enabled={on('whatsapp_auto_kds_ready')} onChange={v => set('whatsapp_auto_kds_ready', v ? '1' : '0')} />
            </SettingRow>
          )}
          {(businessType === 'salon' || isMechanic || businessType === 'restaurant' || businessType === 'service') && (
            <SettingRow settingKey="whatsapp_auto_appointment"
              label={L('Recordatorio de cita', 'Appointment reminder')}
              hint={L('24h antes de la cita.', '24h before the appointment.')}>
              <Toggle enabled={on('whatsapp_auto_appointment')} onChange={v => set('whatsapp_auto_appointment', v ? '1' : '0')} />
            </SettingRow>
          )}
          <SettingRow settingKey="whatsapp_auto_balance"
            label={L('Recordatorio de saldo', 'Balance reminder')}
            hint={L('Recuerda saldos pendientes a clientes con crédito.', 'Reminds credit clients of pending balance.')}>
            <Toggle enabled={on('whatsapp_auto_balance')} onChange={v => set('whatsapp_auto_balance', v ? '1' : '0')} />
          </SettingRow>
        </SettingSection>

        <SettingSection title={L('Plantillas', 'Templates')}>
          <SettingRow label={L('Recibo', 'Receipt')} hint={L('Placeholders: {cliente} {ticket} {total} {biz}', 'Placeholders: {cliente} {ticket} {total} {biz}')}>
            <textarea
              value={cfg.wa_receipt_template ?? ''}
              onChange={e => set('wa_receipt_template', e.target.value)}
              rows={3}
              placeholder={waDefaultFor(businessType, 'receipt') || ''}
              className="flex-1 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-sky-400 resize-none"
            />
          </SettingRow>
          {(isFoodTruck || businessType === 'restaurant') && (
            <SettingRow label={L('Orden lista', 'Order ready')} hint={L('Placeholders: {cliente} {ticket} {biz}', 'Placeholders: {cliente} {ticket} {biz}')}>
              <textarea
                value={cfg.wa_kds_ready_template ?? ''}
                onChange={e => set('wa_kds_ready_template', e.target.value)}
                rows={3}
                placeholder={waDefaultFor(businessType, 'kds_ready') || ''}
                className="flex-1 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-sky-400 resize-none"
              />
            </SettingRow>
          )}
          {(businessType === 'carwash' || isMechanic) && (
            <SettingRow label={L('Vehículo listo', 'Vehicle ready')} hint={L('Placeholders: {cliente} {vehiculo} {ticket} {biz}', 'Placeholders: {cliente} {vehiculo} {ticket} {biz}')}>
              <textarea
                value={cfg.wa_listo_template ?? ''}
                onChange={e => set('wa_listo_template', e.target.value)}
                rows={3}
                placeholder={waDefaultFor(businessType, 'listo') || ''}
                className="flex-1 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-sky-400 resize-none"
              />
            </SettingRow>
          )}
          {(businessType === 'salon' || isMechanic || businessType === 'restaurant' || businessType === 'service') && (
            <SettingRow label={L('Recordatorio de cita', 'Appointment reminder')} hint={L('Placeholders: {cliente} {fecha} {hora} {servicio} {estilista} {biz}', 'Placeholders: {cliente} {fecha} {hora} {servicio} {estilista} {biz}')}>
              <textarea
                value={cfg.wa_appointment_template ?? ''}
                onChange={e => set('wa_appointment_template', e.target.value)}
                rows={3}
                placeholder={waDefaultFor(businessType, 'appointment') || ''}
                className="flex-1 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-sky-400 resize-none"
              />
            </SettingRow>
          )}
          <SettingRow label={L('Saldo pendiente', 'Balance reminder')} hint={L('Placeholders: {cliente} {saldo} {cuentas} {biz}', 'Placeholders: {cliente} {saldo} {cuentas} {biz}')}>
            <textarea
              value={cfg.wa_balance_template ?? ''}
              onChange={e => set('wa_balance_template', e.target.value)}
              rows={4}
              placeholder={waDefaultFor(businessType, 'balance') || ''}
              className="flex-1 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-sky-400 resize-none"
            />
          </SettingRow>
          <SettingRow label={L('Cuentas bancarias', 'Bank accounts')} hint={L('Un banco/cuenta por línea. Usado como {cuentas} en los mensajes.', 'One bank/account per line. Used as {cuentas} in messages.')}>
            <textarea
              value={cfg.biz_bank_accounts ?? ''}
              onChange={e => set('biz_bank_accounts', e.target.value)}
              rows={3}
              placeholder={L('Banco Popular 000-123456-7\nBanreservas 000-987654-3', 'Banco Popular 000-123456-7\nBanreservas 000-987654-3')}
              className="flex-1 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-[12px] text-slate-700 dark:text-white bg-white dark:bg-white/5 focus:outline-none focus:border-sky-400 resize-none font-mono"
            />
          </SettingRow>
        </SettingSection>

        <div className="flex justify-end mt-2">
          <SaveBtn saving={saving} saved={saved} label={L('Guardar', 'Save')} onClick={handleSave} />
        </div>

        {testOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="bg-white dark:bg-neutral-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl max-w-sm w-full p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[14px] font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <Send size={14} className="text-[#b3001e]" />
                  {L('Enviar prueba WhatsApp', 'Send WhatsApp test')}
                </h3>
                <button onClick={() => setTestOpen(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
                  <IconX size={14} className="text-slate-500 dark:text-white/50"/>
                </button>
              </div>
              <p className="text-[12px] text-slate-500 dark:text-white/60 mb-3">
                {L('Ingresa un número de teléfono.', 'Enter a phone number.')}
              </p>
              <input
                type="tel" autoFocus
                value={testPhone} onChange={e => setTestPhone(e.target.value)}
                placeholder="809-555-0123"
                className="w-full px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-[13px] text-slate-700 dark:text-white focus:outline-none focus:border-[#b3001e] focus:ring-1 focus:ring-[#b3001e]/30"
              />
              <div className="flex gap-2 justify-end mt-4">
                <button onClick={() => setTestOpen(false)} disabled={testSending}
                  className="px-3 py-1.5 text-[12px] rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/10"
                >{L('Cancelar', 'Cancel')}</button>
                <button onClick={sendTestWa} disabled={testSending || !testPhone.trim()}
                  className="px-3 py-1.5 text-[12px] rounded-lg bg-[#b3001e] hover:bg-[#8c0017] text-white font-bold flex items-center gap-1.5 disabled:opacity-60"
                >
                  {testSending && <Loader2 size={11} className="animate-spin" />}
                  {L('Enviar', 'Send')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
