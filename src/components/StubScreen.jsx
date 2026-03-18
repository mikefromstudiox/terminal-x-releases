// Shared placeholder component for all screens not yet built.
// Each screen passes its icon, translated title, description, and feature list.
export default function StubScreen({ icon: Icon, title, description, features = [] }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-10 max-w-md w-full">
        {Icon && (
          <div className="w-14 h-14 bg-sky-50 rounded-xl flex items-center justify-center mb-5 mx-auto">
            <Icon size={28} className="text-sky-500" strokeWidth={1.5} />
          </div>
        )}

        <h2 className="text-xl font-bold text-slate-800 text-center mb-2">{title}</h2>
        <p className="text-slate-500 text-sm text-center mb-6 leading-relaxed">{description}</p>

        {features.length > 0 && (
          <ul className="space-y-2 mb-7">
            {features.map((f, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-slate-600">
                <span className="text-sky-500 font-bold mt-0.5 shrink-0">✓</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-center">
          <span className="px-4 py-1.5 bg-slate-100 text-slate-400 rounded-full text-xs font-medium tracking-wide">
            En construcción · Under construction
          </span>
        </div>
      </div>
    </div>
  )
}
