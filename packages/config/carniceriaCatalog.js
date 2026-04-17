// Carniceria preset cuts (RD market).
// Categories double as the top-level grid in CarniceriaPOS and as category
// suggestions in the Inventory "Nuevo Producto" modal.

export const CARNICERIA_CATEGORIES = [
  { key: 'res',       label: 'Res',       emoji: '🥩', color: '#b3001e' },
  { key: 'pollo',     label: 'Pollo',     emoji: '🍗', color: '#d97706' },
  { key: 'cerdo',     label: 'Cerdo',     emoji: '🥓', color: '#be185d' },
  { key: 'embutidos', label: 'Embutidos', emoji: '🌭', color: '#7c3aed' },
  { key: 'mariscos',  label: 'Mariscos',  emoji: '🦐', color: '#0891b2' },
]

// Preset cuts — used as dropdown suggestions in Inventory form and as a filter
// in the POS quick-pick grid. Not a hard lock: owner can type free-form names.
export const CARNICERIA_CUTS = {
  res:       ['Bistec', 'Molida', 'Pincho', 'Lomo', 'Costilla', 'Falda', 'T-Bone', 'Churrasco', 'Rabo', 'Osobuco'],
  pollo:     ['Entero', 'Muslo', 'Pechuga', 'Alitas', 'Menudo', 'Pata', 'Deshuesada', 'Molida'],
  cerdo:     ['Chuleta', 'Costilla', 'Lomo', 'Chicharrón', 'Pernil', 'Longaniza fresca', 'Tocino'],
  embutidos: ['Salami', 'Chorizo', 'Mortadela', 'Jamón', 'Longaniza', 'Butifarra', 'Salchichón'],
  mariscos:  ['Camarón', 'Langostino', 'Pulpo', 'Calamar', 'Mero', 'Chillo', 'Atún', 'Bacalao'],
}

// Flat list of preset category names for Inventory category dropdown.
export function getCarniceriaCategoryOptions() {
  return CARNICERIA_CATEGORIES.map(c => c.label)
}

// Suggested cut names for a given category label (case-insensitive).
export function getCutSuggestions(categoryLabel) {
  const key = CARNICERIA_CATEGORIES.find(c =>
    c.label.toLowerCase() === String(categoryLabel || '').toLowerCase()
  )?.key
  return key ? CARNICERIA_CUTS[key] : []
}
