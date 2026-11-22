import { describe, expect, it } from 'vitest'
import { formatValue } from '../../src/render/format'

describe('formatValue (the canvas side of the generated money and percent text)', () => {
  it('writes money in its currency and a percent of 100, in en-US', () => {
    expect(formatValue(9.99, { kind: 'money', currency: 'EUR' })).toBe('€9.99')
    expect(formatValue(1234.5, { kind: 'money', currency: 'USD' })).toBe('$1,234.50')
    expect(formatValue(25, { kind: 'percent' })).toBe('25%')
    expect(formatValue(12.345, { kind: 'percent' })).toBe('12.35%')
  })
})
