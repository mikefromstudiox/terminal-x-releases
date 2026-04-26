/**
 * apr.test.js — vitest-style tests for APR helpers.
 * Run with vitest, or as a quick check via:
 *   node packages/services/apr.test.js
 */
import { effectiveAnnualRate, formatAPR, simpleAnnualRate } from './apr.js'

// Vitest-compatible globals fallback so this file also runs under plain node.
const _describe = globalThis.describe || ((_n, fn) => fn())
const _it       = globalThis.it       || globalThis.test || ((n, fn) => { try { fn(); console.log('  ok -', n) } catch (e) { console.error('  FAIL -', n, e.message); process.exitCode = 1 } })
const _expect   = globalThis.expect   || ((received) => ({
  toBe: (exp)            => { if (!Object.is(received, exp)) throw new Error(`expected ${exp}, got ${received}`) },
  toBeCloseTo: (exp, p=2)=> { const tol = Math.pow(10, -p) / 2; if (Math.abs(received - exp) > tol) throw new Error(`expected ~${exp}, got ${received}`) },
}))

_describe('effectiveAnnualRate', () => {
  _it('compounds 4.5% monthly to ≈ 69.59% annual', () => {
    _expect(effectiveAnnualRate(0.045)).toBeCloseTo(0.6959, 4)
  })
  _it('returns 0 for 0', () => {
    _expect(effectiveAnnualRate(0)).toBe(0)
  })
  _it('returns 0 for null/undefined/NaN', () => {
    _expect(effectiveAnnualRate(null)).toBe(0)
    _expect(effectiveAnnualRate(undefined)).toBe(0)
    _expect(effectiveAnnualRate(NaN)).toBe(0)
  })
})

_describe('simpleAnnualRate', () => {
  _it('multiplies by 12', () => {
    _expect(simpleAnnualRate(0.045)).toBeCloseTo(0.54, 10)
  })
})

_describe('formatAPR', () => {
  _it('formats 4.5% monthly correctly', () => {
    _expect(formatAPR(0.045)).toBe('4.50% mensual (equivalente 69.59% anual)')
  })
  _it('handles 0 gracefully', () => {
    _expect(formatAPR(0)).toBe('0.00% mensual')
  })
  _it('handles null/undefined gracefully', () => {
    _expect(formatAPR(null)).toBe('0.00% mensual')
    _expect(formatAPR(undefined)).toBe('0.00% mensual')
  })
})
