import { describe, expect, it } from 'vitest'
import {
  cssColorToHex,
  customColorName,
  customColorNameProblem,
  hexToHsva,
  hsvaToHex,
  normalizeHex,
  oklchToHex,
  parseHex,
  rgbaToHex
} from '../src/color.ts'

describe('parseHex and rgbaToHex', () => {
  it('reads #rgb, #rrggbb and #rrggbbaa', () => {
    expect(parseHex('#f60')).toEqual({ r: 255, g: 102, b: 0, a: 1 })
    expect(parseHex('#FF6600')).toEqual({ r: 255, g: 102, b: 0, a: 1 })
    expect(parseHex('#ff660080')).toEqual({ r: 255, g: 102, b: 0, a: 128 / 255 })
    expect(parseHex('ff6600')).toBeUndefined()
    expect(parseHex('#ff66')).toBeUndefined()
  })

  it('writes lowercase #rrggbb, with an alpha byte only below 1', () => {
    expect(rgbaToHex({ r: 255, g: 102, b: 0, a: 1 })).toBe('#ff6600')
    expect(rgbaToHex({ r: 255, g: 102, b: 0, a: 0.5 })).toBe('#ff660080')
    expect(rgbaToHex({ r: 300, g: -4, b: 12.6, a: 1 })).toBe('#ff000d')
  })
})

describe('normalizeHex', () => {
  it('accepts a typed hex with or without # and lowercases it', () => {
    expect(normalizeHex(' F60 ')).toBe('#f60')
    expect(normalizeHex('#ABCDEF')).toBe('#abcdef')
    expect(normalizeHex('#abcdef80')).toBe('#abcdef80')
    expect(normalizeHex('nope')).toBeUndefined()
    expect(normalizeHex('#12345')).toBeUndefined()
  })
})

describe('hexToHsva and hsvaToHex', () => {
  it('converts primaries and greys', () => {
    expect(hexToHsva('#ff0000')).toEqual({ h: 0, s: 1, v: 1, a: 1 })
    expect(hexToHsva('#00ff00')).toEqual({ h: 120, s: 1, v: 1, a: 1 })
    expect(hexToHsva('#0000ff')).toEqual({ h: 240, s: 1, v: 1, a: 1 })
    expect(hexToHsva('#808080')).toMatchObject({ h: 0, s: 0 })
    expect(hexToHsva('bad')).toBeUndefined()
  })

  it('round-trips a hex through HSV, alpha included', () => {
    for (const hex of ['#ff6600', '#123456', '#abcdef', '#000000', '#ffffff', '#ff660080']) {
      expect(hsvaToHex(hexToHsva(hex)!)).toBe(hex)
    }
  })

  it('writes HSV as a hex', () => {
    expect(hsvaToHex({ h: 60, s: 1, v: 1, a: 1 })).toBe('#ffff00')
    expect(hsvaToHex({ h: 360, s: 1, v: 1, a: 1 })).toBe('#ff0000')
    expect(hsvaToHex({ h: 0, s: 0, v: 0, a: 0 })).toBe('#00000000')
  })
})

describe('oklchToHex and cssColorToHex', () => {
  it('converts OKLCH to sRGB hex', () => {
    expect(oklchToHex(1, 0, 0)).toBe('#ffffff')
    expect(oklchToHex(0, 0, 0)).toBe('#000000')
    expect(oklchToHex(0.627955, 0.257683, 29.2339)).toBe('#ff0000')
  })

  it('reads the colours the theme paints swatches with', () => {
    expect(cssColorToHex('#FFF')).toBe('#ffffff')
    expect(cssColorToHex('oklch(100% 0 0)')).toBe('#ffffff')
    expect(cssColorToHex('var(--color-red-500, oklch(62.7955% 0.257683 29.2339))')).toBe('#ff0000')
    expect(cssColorToHex('oklch(0% 0 0 / 0.5)')).toBe('#00000080')
    expect(cssColorToHex('var(--ui-bg)')).toBeUndefined()
  })
})

describe('customColorName and customColorNameProblem', () => {
  it('turns a typed name into a theme colour name', () => {
    expect(customColorName(' Brand Orange ')).toBe('brand-orange')
    expect(customColorName('Ink_2!')).toBe('ink-2')
    expect(customColorName('2 tone')).toBe('c-2-tone')
    expect(customColorName('  ')).toBe('')
  })

  it('refuses empty, colour-token and taken names', () => {
    expect(customColorNameProblem('', [])).toBe('Give the colour a name')
    expect(customColorNameProblem('primary', [])).toBe('"primary" is already a colour token; pick another name')
    expect(customColorNameProblem('brand', ['brand'])).toBe('The theme already has a colour "brand"')
    expect(customColorNameProblem('brand', [])).toBeUndefined()
  })
})
