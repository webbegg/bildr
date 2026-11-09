import { describe, expect, it } from 'vitest'
import { boxSides, boxUniform, boxWrite, spacingSide, spacingWrite } from '#shared/editor/spacing'

describe('spacing sides', () => {
  it('resolves a side from its own key, then its axis, then the all-sides key', () => {
    const style = { m: '2', my: '4', mt: '8' }
    expect(spacingSide(style, 'm', 'top', undefined)).toEqual({ value: '8', key: 'mt', via: 'mt', state: 'set' })
    expect(spacingSide(style, 'm', 'bottom', undefined)).toEqual({ value: '4', key: 'my', via: 'my', state: 'set' })
    expect(spacingSide(style, 'm', 'left', undefined)).toEqual({ value: '2', key: 'm', via: 'm', state: 'set' })
    expect(spacingSide({ px: '3' }, 'p', 'right', undefined)).toEqual({ value: '3', key: 'px', via: 'px', state: 'set' })
    expect(spacingSide({ px: '3' }, 'p', 'top', undefined)).toBeUndefined()
  })

  it('lets a larger breakpoint win over a narrower key below it, which it inherits otherwise', () => {
    const style = { 'mt': '2', 'md:m': '6' }
    expect(spacingSide(style, 'm', 'top', 'md')).toEqual({ value: '6', key: 'md:m', via: 'm', state: 'set' })
    expect(spacingSide(style, 'm', 'top', undefined)).toEqual({ value: '2', key: 'mt', via: 'mt', state: 'set' })
    expect(spacingSide({ 'pt': '4', 'md:pb': '1' }, 'p', 'top', 'lg')).toEqual({ value: '4', key: 'pt', via: 'pt', state: 'inherited' })
  })

  it('writes the side key, or the axis or all-sides key the way bildr stores them', () => {
    expect(spacingWrite({}, 'p', 'top', 'side', undefined, '4')).toEqual({ pt: '4' })
    expect(spacingWrite({}, 'p', 'top', 'axis', undefined, '4')).toEqual({ py: '4' })
    expect(spacingWrite({}, 'p', 'left', 'axis', undefined, '4')).toEqual({ px: '4' })
    expect(spacingWrite({}, 'm', 'right', 'all', 'md', '4')).toEqual({ 'md:m': '4' })
  })

  it('clears the narrower keys at the same breakpoint, so every side it writes follows', () => {
    const style = { 'pt': '2', 'px': '1', 'md:pb': '3', 'md:py': '6' }
    expect(spacingWrite(style, 'p', 'top', 'all', undefined, '4')).toEqual({ p: '4', pt: null, px: null })
    expect(spacingWrite(style, 'p', 'bottom', 'axis', 'md', '8')).toEqual({ 'md:py': '8', 'md:pb': null })
    expect(spacingWrite(style, 'p', 'top', 'axis', undefined, '8')).toEqual({ py: '8', pt: null })
  })
})

describe('padding and margin fields (all or individual)', () => {
  it('reads the four sides at a breakpoint, top right bottom left', () => {
    expect(boxSides({ 'p': '4', 'pt': '8', 'md:px': '2' }, 'p', 'md')).toEqual({ top: '8', right: '2', bottom: '4', left: '2' })
    expect(boxSides({}, 'm', undefined)).toEqual({ top: undefined, right: undefined, bottom: undefined, left: undefined })
  })

  it('is uniform while every side has the same value, or none', () => {
    expect(boxUniform({}, 'p', undefined)).toBe(true)
    expect(boxUniform({ p: '4' }, 'p', 'lg')).toBe(true)
    expect(boxUniform({ px: '4', py: '4' }, 'p', undefined)).toBe(true)
    expect(boxUniform({ p: '4', pt: '8' }, 'p', undefined)).toBe(false)
    expect(boxUniform({ px: '4' }, 'p', undefined)).toBe(false)
  })

  it('writes one value to all sides as `p`, clearing the narrower keys', () => {
    expect(boxWrite({}, 'p', undefined, 'all', '4')).toEqual({ p: '4' })
    expect(boxWrite({ px: '2', pt: '1' }, 'p', undefined, 'all', '4')).toEqual({ p: '4', px: null, pt: null })
    expect(boxWrite({}, 'm', 'md', 'all', '6')).toEqual({ 'md:m': '6' })
  })

  it('writes a side, folding four set sides into `p`, or `px`/`py` when they are symmetric', () => {
    expect(boxWrite({ p: '4' }, 'p', undefined, 'top', '8')).toEqual({ p: null, pt: '8', pr: '4', pb: '4', pl: '4' })
    expect(boxWrite({ p: '4', pt: '8' }, 'p', undefined, 'bottom', '8')).toEqual({ p: null, pt: null, px: '4', py: '8' })
    expect(boxWrite({ px: '4', py: '8' }, 'p', undefined, 'top', '4')).toEqual({ px: null, py: null, pt: '4', pr: '4', pb: '8', pl: '4' })
    expect(boxWrite({ pt: '4', pr: '4', pb: '8', pl: '4' }, 'p', undefined, 'bottom', '4')).toEqual({ p: '4', pt: null, pr: null, pb: null, pl: null })
  })

  it('writes only the side while the others are unset or inherited', () => {
    expect(boxWrite({}, 'p', undefined, 'left', '2')).toEqual({ pl: '2' })
    expect(boxWrite({ p: '4' }, 'p', 'md', 'top', '8')).toEqual({ 'md:pt': '8' })
  })
})
