// Pro MAX placeholder — real INTRANT API requires partnership.
// For now: opens INTRANT public website with placa lookup.
export function lookupPlaca(placa) {
  if (!placa) return false
  const url = `https://intrant.gob.do/vehiculos?placa=${encodeURIComponent(placa)}`
  if (typeof window !== 'undefined' && window.open) { window.open(url, '_blank', 'noopener'); return true }
  return false
}
export function isIntrantApiAvailable() { return false }
