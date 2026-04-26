// Pure age-check predicate. Lives in a .js file (not .jsx) so the licorería
// smoke harness and any future Node-side validators can import it without
// pulling React/JSX. The AgeVerifyModal component re-exports it for
// existing callers.

export function requiresAgeCheck(config, item) {
  if (!config?.ageVerification?.enabled) return false
  const trigger = (config.ageVerification.triggerCategories || []).map(s => String(s).toLowerCase())
  const cat  = String(item?.category || '').toLowerCase().trim()
  const name = String(item?.name || '').toLowerCase().trim()
  if (!cat && !name) return false
  return trigger.some(t => {
    if (!t) return false
    if (cat && (cat === t || cat.includes(t))) return true
    // Belt-and-suspenders: catch products miscategorized but clearly alcohol
    // by name (e.g. "Brugal Añejo" left under category "General").
    if (name && name.includes(t)) return true
    return false
  })
}
