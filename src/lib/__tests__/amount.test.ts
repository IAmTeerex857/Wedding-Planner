import { describe, expect, it } from 'vitest'
import { formatAmount, parseAmount } from '../amount'

describe('formatAmount', () => {
  it('groups thousands', () => {
    expect(formatAmount('1200000')).toBe('1,200,000')
    expect(formatAmount('500')).toBe('500')
    expect(formatAmount('1000')).toBe('1,000')
  })

  it('keeps a decimal part', () => {
    expect(formatAmount('1200000.5')).toBe('1,200,000.5')
    expect(formatAmount('250000.75')).toBe('250,000.75')
  })

  it('handles empty and numeric input', () => {
    expect(formatAmount('')).toBe('')
    expect(formatAmount(1500)).toBe('1,500')
  })

  it('survives a value that already has separators', () => {
    expect(formatAmount(formatAmount('1200000'))).toBe('1,200,000')
  })
})

describe('parseAmount', () => {
  it('strips grouping back to a plain number string', () => {
    expect(parseAmount('1,200,000')).toBe('1200000')
    expect(parseAmount('250,000.75')).toBe('250000.75')
  })

  it('ignores stray characters', () => {
    expect(parseAmount('NGN 1,000abc')).toBe('1000')
  })

  it('keeps at most two decimal places', () => {
    expect(parseAmount('10.999')).toBe('10.99')
  })

  it('round-trips with formatAmount', () => {
    expect(parseAmount(formatAmount('987654321'))).toBe('987654321')
  })
})
