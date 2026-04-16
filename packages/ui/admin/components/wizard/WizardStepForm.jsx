import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Upload, ExternalLink, Loader2, AlertCircle } from 'lucide-react'

const inputBase = (isDark) =>
  `w-full px-3 py-2.5 border rounded-xl text-[13px] font-medium focus:outline-none focus:ring-2 focus:ring-[#b3001e]/40 focus:border-[#b3001e] transition-all ${
    isDark
      ? 'bg-white/5 border-white/10 text-white placeholder-white/25'
      : 'bg-white border-black/10 text-black placeholder-black/25'
  }`

const labelCls = (isDark) =>
  `block text-[11px] font-bold uppercase tracking-[1px] mb-1.5 ${isDark ? 'text-white/40' : 'text-black/40'}`

export default function WizardStepForm({ config, data = {}, onChange, onFileUpload, isDark, lang }) {
  const L = (es, en) => lang === 'es' ? es : en
  const [saving, setSaving] = useState(false)
  const [urlChecking, setUrlChecking] = useState({})
  const timerRef = useRef(null)

  const debouncedSave = useCallback(() => {
    setSaving(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setSaving(false), 1200)
  }, [])

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  function handleChange(key, value) {
    onChange?.(key, value)
    debouncedSave()
  }

  async function checkUrl(key, url) {
    if (!url) return
    setUrlChecking(prev => ({ ...prev, [key]: 'checking' }))
    try {
      const resp = await fetch(url, { method: 'HEAD', mode: 'no-cors' })
      setUrlChecking(prev => ({ ...prev, [key]: 'ok' }))
    } catch {
      setUrlChecking(prev => ({ ...prev, [key]: 'error' }))
    }
    setTimeout(() => setUrlChecking(prev => ({ ...prev, [key]: null })), 3000)
  }

  if (!config?.fields?.length) return null

  return (
    <div className="space-y-4">
      {/* Auto-save indicator */}
      <AnimatePresence>
        {saving && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium"
          >
            <Check size={12} />
            {L('Guardado automaticamente', 'Auto-saved')}
          </motion.div>
        )}
      </AnimatePresence>

      {config.fields.map((field) => {
        const val = data[field.key] ?? ''

        if (field.type === 'text') {
          return (
            <div key={field.key}>
              <label className={labelCls(isDark)}>
                {field.label}{field.required && <span className="text-[#b3001e] ml-0.5">*</span>}
              </label>
              <input
                type="text"
                value={val}
                onChange={(e) => handleChange(field.key, e.target.value)}
                placeholder={field.placeholder || ''}
                className={inputBase(isDark)}
              />
            </div>
          )
        }

        if (field.type === 'textarea') {
          return (
            <div key={field.key}>
              <label className={labelCls(isDark)}>
                {field.label}{field.required && <span className="text-[#b3001e] ml-0.5">*</span>}
              </label>
              <textarea
                value={val}
                onChange={(e) => handleChange(field.key, e.target.value)}
                rows={3}
                className={`${inputBase(isDark)} resize-none`}
              />
            </div>
          )
        }

        if (field.type === 'date') {
          return (
            <div key={field.key}>
              <label className={labelCls(isDark)}>
                {field.label}{field.required && <span className="text-[#b3001e] ml-0.5">*</span>}
              </label>
              <input
                type="date"
                value={val}
                onChange={(e) => handleChange(field.key, e.target.value)}
                className={inputBase(isDark)}
              />
            </div>
          )
        }

        if (field.type === 'select') {
          return (
            <div key={field.key}>
              <label className={labelCls(isDark)}>
                {field.label}{field.required && <span className="text-[#b3001e] ml-0.5">*</span>}
              </label>
              <select
                value={val}
                onChange={(e) => handleChange(field.key, e.target.value)}
                className={inputBase(isDark)}
              >
                <option value="">{L('Seleccionar...', 'Select...')}</option>
                {field.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          )
        }

        if (field.type === 'boolean') {
          return (
            <div key={field.key} className="flex items-center gap-3">
              <button
                onClick={() => handleChange(field.key, !val)}
                className={`w-10 h-6 rounded-full relative transition-colors ${
                  val ? 'bg-emerald-500' : isDark ? 'bg-white/10' : 'bg-black/10'
                }`}
              >
                <motion.div
                  className="absolute top-1 w-4 h-4 rounded-full bg-white shadow"
                  animate={{ left: val ? 20 : 4 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              </button>
              <label className={`text-[13px] font-medium cursor-pointer ${isDark ? 'text-white/70' : 'text-black/70'}`}
                onClick={() => handleChange(field.key, !val)}>
                {field.label}
              </label>
            </div>
          )
        }

        if (field.type === 'url') {
          const checkStatus = urlChecking[field.key]
          return (
            <div key={field.key}>
              <label className={labelCls(isDark)}>
                {field.label}{field.required && <span className="text-[#b3001e] ml-0.5">*</span>}
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={val}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  placeholder={field.placeholder || 'https://...'}
                  className={`flex-1 ${inputBase(isDark)}`}
                />
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => checkUrl(field.key, val)}
                  disabled={!val || checkStatus === 'checking'}
                  className={`shrink-0 px-3 py-2 rounded-xl text-[11px] font-bold border transition-colors ${
                    checkStatus === 'ok'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : checkStatus === 'error'
                        ? 'bg-[#b3001e]/10 text-[#b3001e] border-[#b3001e]/30'
                        : isDark
                          ? 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
                          : 'bg-black/5 text-black/60 border-black/10 hover:bg-black/10'
                  } disabled:opacity-30`}
                >
                  {checkStatus === 'checking' ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : checkStatus === 'ok' ? (
                    <Check size={12} />
                  ) : checkStatus === 'error' ? (
                    <AlertCircle size={12} />
                  ) : (
                    <ExternalLink size={12} />
                  )}
                </motion.button>
              </div>
            </div>
          )
        }

        if (field.type === 'file') {
          return (
            <div key={field.key}>
              <label className={labelCls(isDark)}>
                {field.label}{field.required && <span className="text-[#b3001e] ml-0.5">*</span>}
              </label>
              <div className="flex items-center gap-3">
                {val ? (
                  <span className={`text-[12px] font-medium truncate flex-1 ${isDark ? 'text-white/60' : 'text-black/60'}`}>
                    {typeof val === 'string' ? val : val.name || L('Archivo subido', 'File uploaded')}
                  </span>
                ) : (
                  <span className={`text-[12px] flex-1 ${isDark ? 'text-white/25' : 'text-black/25'}`}>
                    {L('Sin archivo', 'No file')}
                  </span>
                )}
                <label className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold border cursor-pointer transition-colors ${
                  isDark ? 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10' : 'bg-black/5 text-black/60 border-black/10 hover:bg-black/10'
                }`}>
                  <Upload size={12} />
                  {L('Subir', 'Upload')}
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file && onFileUpload) {
                        onFileUpload(file, field.key)
                      }
                    }}
                  />
                </label>
              </div>
            </div>
          )
        }

        return null
      })}
    </div>
  )
}
