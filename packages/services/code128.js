/**
 * code128.js — Zero-dependency Code 128 (subset B) encoder.
 *
 * Returns an array of module widths (each entry = number of consecutive equal-
 * width modules, alternating bar/space starting with BAR). Caller scales by
 * `moduleWidth` (mm/px) and paints bars directly into pdf-lib / canvas.
 *
 * Alphabet: ASCII 32..126 (printable). Our token alphabet fits entirely in
 * Code128-B so we never need to switch code sets mid-string.
 *
 * Spec refs:
 *   - Start B = 104, Stop = 106 (terminated with extra 2 modules).
 *   - Checksum = (startCode + Σ pos*value) % 103.
 *   - Every symbol = 11 modules except Stop = 13 modules.
 */

// 107 patterns (0..106). Each is an 8-char string of decimal module widths
// summing to 11 (or 13 for Stop). Bars start first (BSBSBSBS).
const PATTERNS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112', // 106 = Stop (13 modules)
]

const START_B = 104

function charValB(ch) {
  const code = ch.charCodeAt(0)
  // Code128-B: values 0..95 map to ASCII 32..126; we only use printable ASCII.
  if (code < 32 || code > 126) {
    throw new Error(`code128: char out of Code128-B range: ${JSON.stringify(ch)}`)
  }
  return code - 32
}

/**
 * Encode a printable-ASCII string as an array of module widths.
 * Each entry = width of a run; runs alternate BAR/SPACE starting with BAR.
 *
 * @param {string} text
 * @returns {number[]} module run-lengths (ints)
 */
export function encodeCode128B(text) {
  if (!text) throw new Error('code128: empty string')
  const values = [START_B]
  for (const ch of text) values.push(charValB(ch))
  // Checksum = (start + Σ position*value) mod 103. Position starts at 1 for
  // the first data char; start itself contributes position 0 (weight 1).
  let sum = START_B
  for (let i = 1; i < values.length; i++) sum += i * values[i]
  values.push(sum % 103)
  values.push(106) // Stop

  const widths = []
  for (const v of values) {
    const p = PATTERNS[v]
    for (const ch of p) widths.push(parseInt(ch, 10))
  }
  return widths
}

/** Total logical module count (for sizing the bar area). */
export function totalModules(widths) {
  return widths.reduce((s, w) => s + w, 0)
}
