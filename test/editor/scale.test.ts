import { describe, expect, it } from 'vitest'
import { parseScaleInput, scalePx, scaleStops, scaleValues, SHIFT_STOPS, stepScale, stopIndex, unsetValue } from '#shared/editor/scale'
import { scrubStops } from '#shared/editor/scrub'

describe('scale stepping', () => {
  it('lists a token scale in registry order, for prefixed keys too', () => {
    expect(scaleValues('text')).toEqual(['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl'])
    expect(scaleValues('md:gap')).toEqual(scaleValues('gap'))
    expect(scaleValues('bogus')).toEqual([])
  })

  it('steps a numeric scale through its numbers, clamped at both ends', () => {
    expect(stepScale('mt', '10', 1)).toBe('12')
    expect(stepScale('mt', '10', -1)).toBe('8')
    expect(stepScale('mt', '32', 1)).toBe('32')
    expect(stepScale('mt', '0', -1)).toBe('0')
    expect(stepScale('gap', '2', SHIFT_STOPS)).toBe('5')
  })

  it('skips the words of a numeric scale, so `auto` margins step from 0', () => {
    expect(stepScale('mt', 'auto', 1)).toBe('0.5')
    expect(stepScale('minH', '32', 1)).toBe('48')
    expect(stepScale('minH', '96', 1)).toBe('96')
  })

  it('counts an unset spacing value as 0 and any other unset value as the first', () => {
    expect(stepScale('pt', undefined, 1)).toBe('0.5')
    expect(stepScale('pt', undefined, -1)).toBe('0')
    expect(stepScale('text', undefined, 1)).toBe('sm')
    expect(stepScale('text', undefined, -1)).toBe('xs')
    expect(stepScale('cols', undefined, 1)).toBe('2')
  })

  it('counts an unset value as the token default, so opacity steps from 100', () => {
    expect(unsetValue('opacity')).toBe('100')
    expect(unsetValue('text')).toBeUndefined()
    expect(stepScale('opacity', undefined, 1)).toBe('100')
    expect(stepScale('opacity', undefined, -1)).toBe('95')
    expect(stepScale('opacity', undefined, -SHIFT_STOPS)).toBe('75')
    expect(stepScale('opacity', '50', 1)).toBe('60')
  })

  it('steps a word scale through the registry order', () => {
    expect(stepScale('text', 'base', 1)).toBe('lg')
    expect(stepScale('text', 'base', -2)).toBe('xs')
    expect(stepScale('maxW', 'md', 1)).toBe('lg')
  })

  it('gives the px of spacing-scale values at the project density', () => {
    expect(scalePx('mt', '10', 'default')).toBe('40px')
    expect(scalePx('md:gap', '0.5', 'default')).toBe('2px')
    expect(scalePx('p', '4', 'comfortable')).toBe('19.2px')
    expect(scalePx('minH', '32', 'default')).toBe('128px')
    expect(scalePx('w', '64', 'default')).toBe('256px')
    expect(scalePx('mt', 'auto', 'default')).toBeUndefined()
    expect(scalePx('cols', '3', 'default')).toBeUndefined()
    expect(scalePx('border', '2', 'default')).toBeUndefined()
  })

  it('reads typed input as a scale value, a px size on the scale, or nothing', () => {
    expect(parseScaleInput('mt', ' 10 ', 'default')).toBe('10')
    expect(parseScaleInput('mt', 'AUTO', 'default')).toBe('auto')
    expect(parseScaleInput('mt', '40px', 'default')).toBe('10')
    expect(parseScaleInput('w', '1/2', 'default')).toBe('1/2')
    expect(parseScaleInput('mt', '13', 'default')).toBeUndefined()
    expect(parseScaleInput('mt', '13px', 'default')).toBeUndefined()
    expect(parseScaleInput('mt', '', 'default')).toBeUndefined()
  })
})

describe('scrub stops', () => {
  it('moves one stop per 6px, Shift four, in both directions', () => {
    expect(scrubStops(5, false)).toBe(0)
    expect(scrubStops(6, false)).toBe(1)
    expect(scrubStops(20, false)).toBe(3)
    expect(scrubStops(-13, false)).toBe(-2)
    expect(scrubStops(13, true)).toBe(8)
    expect(Object.is(scrubStops(-2, false), 0)).toBe(true)
  })
})

describe('scale sliders', () => {
  it('snap to the stops a field steps through', () => {
    expect(scaleStops('opacity')[0]).toBe('0')
    expect(scaleStops('opacity').at(-1)).toBe('100')
    expect(scaleStops('md:gap')).toEqual(['0', '0.5', '1', '1.5', '2', '2.5', '3', '4', '5', '6', '8', '10', '12', '16', '20', '24', '32'])
  })

  it('start an unset value at what it renders as', () => {
    expect(stopIndex('opacity', undefined)).toBe(scaleStops('opacity').length - 1)
    expect(stopIndex('gap', undefined)).toBe(0)
    expect(stopIndex('gap', '4')).toBe(7)
    expect(stopIndex('gap', 'bogus')).toBe(0)
  })
})
