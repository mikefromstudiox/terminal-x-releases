// ConfigRecibo — dedicated /config/recibo page.
//
// Receipt customization (12 visibility flags + footer text). Promoted from
// Sistema.jsx L1395-1563 as part of the 2026-05-19 config consolidation.
//
// Each flag has 3 states: explicit ON ('1'), explicit OFF ('0'), or
// per-business-type default (''). The hint surfaces the source (forced /
// default ON / default OFF) so the owner knows where the current
// behavior comes from. Reset button collapses an explicit value back to
// per-vertical default.
import { ReceiptText } from 'lucide-react'
import { useSettings, SettingSection, SettingRow, SaveBtn, Toast, Toggle } from '../Sistema'
import { useLang } from '../../i18n'
import { useBusinessType } from '../../hooks/useBusinessType.jsx'
import { resolveReceiptFlag, RECEIPT_DEFAULT_FOOTER } from '@terminal-x/config/receiptDefaults'

export default function ConfigRecibo() {
  const { cfg, set, handleSave, saving, saved, toast } = useSettings()
  const { lang } = useLang()
  const { businessType } = useBusinessType()
  const L = (es, en) => lang === 'es' ? es : en

  const rcptRow = (key, labelEs, labelEn, hintEs, hintEn) => {
    const explicit = cfg[key] === '1' || cfg[key] === '0'
    const effective = resolveReceiptFlag(cfg, businessType, key)
    const defaultOn = resolveReceiptFlag({}, businessType, key)
    const sourceTag = explicit
      ? (lang === 'es' ? ' (forzado)' : ' (forced)')
      : (defaultOn ? (lang === 'es' ? ' (por defecto: ON)' : ' (default: ON)')
                   : (lang === 'es' ? ' (por defecto: OFF)' : ' (default: OFF)'))
    return (
      <SettingRow key={key} settingKey={key} label={L(labelEs, labelEn)} hint={L(hintEs, hintEn) + sourceTag}>
        <div className="flex items-center gap-2">
          <Toggle enabled={effective} onChange={v => set(key, v ? '1' : '0')} />
          {explicit && (
            <button
              type="button"
              onClick={() => set(key, '')}
              className="text-[10px] uppercase tracking-wider text-slate-400 hover:text-[#b3001e]"
              title={L('Restablecer al valor por defecto del tipo de negocio', 'Reset to business-type default')}
            >{L('Restablecer', 'Reset')}</button>
          )}
        </div>
      </SettingRow>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-black">
      <div className="px-3 md:px-6 py-4 md:py-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[20px] md:text-[24px] font-black tracking-tight text-slate-900 dark:text-white inline-flex items-center gap-3">
            <ReceiptText size={22} className="text-[#b3001e]" />
            {L('Recibo (Diseño y Footer)', 'Receipt (Design & Footer)')}
          </h1>
          <p className="text-[12px] md:text-[13px] text-slate-500 dark:text-white/40 mt-1">
            {L('Personaliza qué información se imprime en el ticket y el mensaje al pie.',
               'Customize what prints on the ticket and the footer message.')}
          </p>
        </div>
        <Toast toast={toast} />

        <SettingSection title={L('Personalización de Recibo', 'Receipt Customization')}>
          {rcptRow('receipt_show_itbis_pct',
            'Mostrar % de ITBIS', 'Show ITBIS %',
            'Muestra "ITBIS 18%" en los totales del recibo',
            'Shows "ITBIS 18%" on the totals line')}
          {rcptRow('receipt_show_commission',
            'Mostrar comisión en factura', 'Show commission on invoice',
            'Imprime una línea de Comisión en los totales (solo factura, no afecta el conduce)',
            'Prints a Commission line in totals (invoice only, not the conduce)')}
          {rcptRow('conduce_show_commission',
            'Mostrar comisión en conduce', 'Show commission on conduce',
            'Imprime "Comisión: RD$X" al pie del conduce del lavador',
            'Prints "Comisión: RD$X" at the foot of the washer conduce')}
          {rcptRow('receipt_show_sku',
            'Mostrar SKU/código por línea', 'Show SKU/code per line',
            'Imprime el SKU debajo del nombre del producto',
            'Prints the SKU underneath each item name')}
          {rcptRow('receipt_show_unit_price',
            'Precio por unidad en multi-cantidad', 'Per-unit price on multi-qty',
            'En líneas con cantidad mayor a 1, muestra "Producto @ RD$ precio"',
            'On qty > 1 lines, shows "Item @ RD$ price"')}
          {rcptRow('receipt_show_exempt_label',
            'Etiqueta EXENTO en items 0% ITBIS', 'EXENTO label on 0% ITBIS items',
            'Imprime "[EXENTO ITBIS]" en productos exentos (normativa DGII)',
            'Prints "[EXENTO ITBIS]" on tax-exempt items (DGII normative)')}
          {rcptRow('receipt_show_client_address',
            'Dirección del cliente en E31', 'Client address on E31',
            'Imprime la dirección del cliente cuando el comprobante es Crédito Fiscal',
            'Prints the client address when the receipt is Credit Fiscal')}
          {rcptRow('receipt_show_servicio_ley',
            'Servicio 10% Ley 16-92', 'Service 10% Law 16-92',
            'Imprime "Servicio Ley 10%" cuando el ticket carga propina de servicio',
            'Prints "Servicio Ley 10%" when the ticket carries service tip')}
          {rcptRow('receipt_show_credit_ref',
            'Referencia NCF en notas de crédito', 'NCF reference on credit notes',
            'En E33/E34 imprime "MODIFICA NCF" con el NCF del comprobante original',
            'On E33/E34 prints "MODIFICA NCF" with the original NCF')}
          {rcptRow('receipt_show_vehicle_details',
            'Detalles del vehículo (marca/modelo/VIN)', 'Vehicle details (make/model/VIN)',
            'Imprime VIN, marca, modelo y kilometraje cuando están disponibles',
            'Prints VIN, make, model and odometer when available')}
          {rcptRow('receipt_show_contact_extra',
            'Email/IG/Website del negocio', 'Business email/IG/website',
            'Línea adicional en el encabezado con email, @instagram y sitio web',
            'Extra header line with email, @instagram and website')}
          {rcptRow('receipt_show_loyalty',
            'Puntos de fidelidad en el recibo', 'Loyalty points on receipt',
            'Imprime "Acumulas +N pts" y "Saldo total" cuando el cliente tiene puntos',
            'Prints "Acumulas +N pts" and "Saldo total" when the client has points')}

          <SettingRow
            settingKey="receipt_footer_message"
            label={L('Mensaje al pie del recibo', 'Receipt footer message')}
            hint={L(
              `Máx 42 caracteres. Vacío usa: "${RECEIPT_DEFAULT_FOOTER}"`,
              `Max 42 chars. Empty uses: "${RECEIPT_DEFAULT_FOOTER}"`,
            )}
          >
            <input
              type="text"
              maxLength={42}
              value={cfg.receipt_footer_message || ''}
              onChange={e => set('receipt_footer_message', e.target.value)}
              placeholder={RECEIPT_DEFAULT_FOOTER}
              className="w-72 max-w-full px-3 py-1.5 text-[13px] rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#b3001e]/40"
            />
          </SettingRow>
        </SettingSection>

        <div className="flex justify-end mt-2">
          <SaveBtn saving={saving} saved={saved} label={L('Guardar', 'Save')} onClick={handleSave} />
        </div>
      </div>
    </div>
  )
}
