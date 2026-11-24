// layout-containers L5: the pin picker's model over the inset tokens, and a row's "Stack below" over its responsive direction.
import { describe, expect, it } from 'vitest'
import { pinOf, pinWrite } from '../../src/shared/pin.ts'
import { stackBelowOf, stackBelowWrite } from '../../src/shared/stackBelow.ts'

describe('pinOf', () => {
  it('reads each axis from its insets: a side, both sides (stretch), or both with an auto margin (centre)', () => {
    expect(pinOf({})).toEqual({ h: undefined, v: undefined })
    expect(pinOf({ top: '0', left: '4' })).toEqual({ h: 'start', v: 'start' })
    expect(pinOf({ bottom: '0', right: '0' })).toEqual({ h: 'end', v: 'end' })
    expect(pinOf({ insetX: '0', insetY: '0' })).toEqual({ h: 'stretch', v: 'stretch' })
    expect(pinOf({ left: '0', right: '0' })).toEqual({ h: 'stretch', v: undefined })
    expect(pinOf({ insetX: '0', mx: 'auto', top: '0' })).toEqual({ h: 'center', v: 'start' })
    expect(pinOf({ inset: '0' })).toEqual({ h: 'stretch', v: 'stretch' })
    expect(pinOf({ inset: '0', my: 'auto', mx: 'auto' })).toEqual({ h: 'center', v: 'center' })
  })
})

describe('pinWrite', () => {
  it('pins one axis to a side, clearing what pinned it before', () => {
    expect(pinWrite({ right: '0' }, 'h', 'start')).toEqual({ left: '0', right: null, insetX: null, mx: null })
    expect(pinWrite({ top: '0' }, 'v', 'end')).toEqual({ bottom: '0', top: null, insetY: null, my: null })
  })

  it('keeps an offset already on the side it pins to', () => {
    expect(pinWrite({ left: '4' }, 'h', 'start')).toEqual({ left: '4', right: null, insetX: null, mx: null })
  })

  it('stretches across both sides, and centres with auto margins at its own size (fit unless set)', () => {
    expect(pinWrite({ left: '0' }, 'h', 'stretch')).toEqual({ insetX: '0', left: null, right: null, mx: null })
    expect(pinWrite({ left: '0' }, 'h', 'center')).toEqual({ insetX: '0', left: null, right: null, mx: 'auto', w: 'fit' })
    expect(pinWrite({ left: '0', w: '64' }, 'h', 'center')).toEqual({ insetX: '0', left: null, right: null, mx: 'auto' })
  })

  it('splits an all-sides inset into its axes before writing one', () => {
    expect(pinWrite({ inset: '0' }, 'h', 'start')).toEqual({ inset: null, insetY: '0', left: '0', right: null, insetX: null, mx: null })
  })
})

describe('stackBelow', () => {
  it('reads a column that becomes a row from a breakpoint up (mobile-first), or a row that is a column below one (desktop-first)', () => {
    expect(stackBelowOf({ 'direction': 'col', 'md:direction': 'row' }, 'mobile')).toBe('md')
    expect(stackBelowOf({ 'direction': 'row', 'max-sm:direction': 'col' }, 'desktop')).toBe('sm')
    expect(stackBelowOf({ direction: 'row' }, 'mobile')).toBeUndefined()
    expect(stackBelowOf({ 'direction': 'col', 'md:direction': 'row', 'lg:direction': 'col' }, 'mobile')).toBeUndefined()
    expect(stackBelowOf({ 'direction': 'col', 'md:direction': 'row-reverse' }, 'mobile')).toBeUndefined()
  })

  it('writes the pair and clears the other breakpoints\' directions; never is a plain row', () => {
    expect(stackBelowWrite({ 'direction': 'row', 'sm:direction': 'col' }, 'lg', 'mobile')).toEqual({ 'direction': 'col', 'lg:direction': 'row', 'sm:direction': null })
    expect(stackBelowWrite({ 'direction': 'col', 'md:direction': 'row' }, null, 'mobile')).toEqual({ 'direction': 'row', 'md:direction': null })
    expect(stackBelowWrite({}, 'md', 'desktop')).toEqual({ 'direction': 'row', 'max-md:direction': 'col' })
  })
})
