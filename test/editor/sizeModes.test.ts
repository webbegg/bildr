import { describe, expect, it } from 'vitest'
import { sizeMode, sizeModes, sizeModeValue } from '#shared/editor/sizeModes'

describe('size modes', () => {
  it('offers the modes each size token can express', () => {
    // Height (`minH`) has no `fit`, so Fit clears it.
    expect(sizeModes('w')).toEqual(['fixed', 'fit', 'fill', 'relative'])
    expect(sizeModes('minH')).toEqual(['fixed', 'fit', 'fill', 'relative'])
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
    expect(sizeMode('minH', '32')).toBe('fixed')
    expect(sizeMode('minH', '0')).toBe('fixed')
    expect(sizeMode('minH', 'full')).toBe('fill')
    expect(sizeMode('minH', 'screen')).toBe('relative')
    // An unset minimum height is the content's height.
    expect(sizeMode('minH', undefined)).toBe('fit')
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
    expect(sizeModeValue('minH', 'fixed', undefined)).toBe('32')
    expect(sizeModeValue('minH', 'fixed', '64')).toBe('64')
    expect(sizeModeValue('minH', 'fill', '64')).toBe('full')
    expect(sizeModeValue('minH', 'relative', undefined)).toBe('screen')
    expect(sizeModeValue('minH', 'fit', '64')).toBeNull()
  })

  it('round-trips: the mode of the written token is the mode picked', () => {
    for (const key of ['w', 'minH'] as const) {
      for (const mode of sizeModes(key)) expect(sizeMode(key, sizeModeValue(key, mode, undefined) ?? undefined)).toBe(mode)
    }
  })
})
