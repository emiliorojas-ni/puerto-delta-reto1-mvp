import { describe, expect, it } from 'vitest'
import {
  addMoney,
  formatAmount,
  formatQty,
  formatUSD,
  fromCents,
  ratio,
  roundDecimalString,
  subMoney,
  toCents,
} from '../src/lib/money'

describe('money utilities (decimal strings without float drift)', () => {
  it('formats 23158.24 as USD 23.158,24', () => {
    expect(formatUSD('23158.24')).toBe('USD 23.158,24')
    expect(formatAmount('23158.24')).toBe('23.158,24')
    expect(formatUSD('81.31')).toBe('USD 81,31')
    expect(formatUSD('0.00')).toBe('USD 0,00')
    expect(formatUSD(null)).toBe('—')
  })

  it('adds and subtracts decimal strings without IEEE-754 float drift', () => {
    expect(addMoney('0.10', '0.20')).toBe('0.30')
    expect(addMoney('9594.58', '13563.66')).toBe('23158.24')
    expect(subMoney('23158.24', '23158.24')).toBe('0.00')
    expect(subMoney('100.00', '120.50')).toBe('-20.50')
  })

  it('rounds decimal strings with ROUND_HALF_UP', () => {
    expect(roundDecimalString('1952.80512', 2)).toBe('1952.81')
    expect(roundDecimalString('325.24', 2)).toBe('325.24')
    expect(roundDecimalString('10.005', 2)).toBe('10.01')
    expect(roundDecimalString('10.004', 2)).toBe('10.00')
  })

  it('converts to/from cents accurately and formats quantities preserving precision', () => {
    expect(toCents('23158.24')).toBe(2315824n)
    expect(fromCents(2315824n)).toBe('23158.24')
    expect(formatQty('1525.629')).toBe('1.525,629')
    expect(formatQty('118')).toBe('118')
    expect(ratio('11579.12', '23158.24')).toBe(0.5)
  })
})
