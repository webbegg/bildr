import { describe, expect, it } from 'vitest'
import { measuredSize, sizeMode, sizeModes, sizeModeValue } from '#shared/editor/sizeModes'

describe('size modes', () => {
  it('offers the modes each size token can express', () => {
    expect(sizeModes('w')).toEqual(['fixed', 'fit', 'fill', 'relative'])
    expect(sizeModes('h')).toEqual(['fixed', 'fit', 'fill', 'relative'])
  })

  it('reads the mode from the token value', () => {
    expect(sizeMode('w', 'fit')).toBe('fit')
    expect(sizeMode('w', 'full')).toBe('fill')
    expect(sizeMode('w', '1/2')).toBe('relative')
    expect(sizeMode('w', 'screen')).toBe('relative')
    expect(sizeMode('w', '64')).toBe('fixed')
    expect(sizeMode('w', '0')).toBe('fixed')
    expect(sizeMode('w', 'auto')).toBeUndefined()
    expect(sizeMode('w', undefined)).toBeUndefined()
    expect(sizeMode('h', '64')).toBe('fixed')
    expect(sizeMode('h', 'fit')).toBe('fit')
    expect(sizeMode('h', 'full')).toBe('fill')
    expect(sizeMode('h', 'screen')).toBe('relative')
    expect(sizeMode('h', 'auto')).toBeUndefined()
    expect(sizeMode('h', undefined)).toBeUndefined()
  })

  it('writes the token of a mode, keeping a value that fits it', () => {
    expect(sizeModeValue('w', 'fill', undefined)).toBe('full')
    expect(sizeModeValue('w', 'fit', '1/2')).toBe('fit')
    expect(sizeModeValue('w', 'relative', 'full')).toBe('1/2')
    expect(sizeModeValue('w', 'relative', '2/3')).toBe('2/3')
    expect(sizeModeValue('w', 'fixed', undefined)).toBe('64')
    expect(sizeModeValue('w', 'fixed', 'full')).toBe('64')
    expect(sizeModeValue('w', 'fixed', '32')).toBe('32')
    expect(sizeModeValue('w', 'fill', '32')).toBe('full')
    expect(sizeModeValue('h', 'fixed', undefined)).toBe('64')
    expect(sizeModeValue('h', 'fixed', '32')).toBe('32')
    expect(sizeModeValue('h', 'fit', '64')).toBe('fit')
    expect(sizeModeValue('h', 'fill', '64')).toBe('full')
    expect(sizeModeValue('h', 'relative', undefined)).toBe('screen')
  })

  it('shows the measured px, rounded, for an auto, Fit or Fill size', () => {
    expect(measuredSize('w', undefined, [78.4])).toBe('78')
    expect(measuredSize('w', 'auto', [77.5])).toBe('78')
    expect(measuredSize('h', 'fit', [40])).toBe('40')
    expect(measuredSize('w', 'full', [1199.6])).toBe('1200')
  })

  it('shows no measure for a Fixed or Relative size, without a box, or when the selected boxes differ', () => {
    expect(measuredSize('w', '64', [256])).toBeUndefined()
    expect(measuredSize('w', '1/2', [300])).toBeUndefined()
    expect(measuredSize('h', 'screen', [800])).toBeUndefined()
    expect(measuredSize('w', undefined, [])).toBeUndefined()
    expect(measuredSize('w', 'fit', [40, 52])).toBeUndefined()
    expect(measuredSize('w', 'fit', [40.2, 39.8])).toBe('40')
    expect(measuredSize('w', 'fit', [Number.NaN])).toBeUndefined()
  })

  it('round-trips: the mode of the written token is the mode picked', () => {
    for (const key of ['w', 'h'] as const) {
      for (const mode of sizeModes(key)) expect(sizeMode(key, sizeModeValue(key, mode, undefined))).toBe(mode)
    }
  })
})
