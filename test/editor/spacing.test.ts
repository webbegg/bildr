import { describe, expect, it } from 'vitest'
import { dragScope, spacingSide, spacingWrite } from '#shared/editor/spacing'

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

  it('maps a drag to the side, Alt to the axis, Shift to all sides', () => {
    expect(dragScope({ shiftKey: false, altKey: false })).toBe('side')
    expect(dragScope({ shiftKey: false, altKey: true })).toBe('axis')
    expect(dragScope({ shiftKey: true, altKey: false })).toBe('all')
    expect(dragScope({ shiftKey: true, altKey: true })).toBe('all')
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
