import { useLang } from '../i18n'

export default function LanguageToggle() {
  const { lang, setLang } = useLang()

  return (
    <div className="flex items-center gap-0.5 bg-slate-100 rounded-full p-0.5 select-none">
      {['es', 'en'].map(l => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors uppercase ${
            lang === l
              ? 'bg-sky-500 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}
