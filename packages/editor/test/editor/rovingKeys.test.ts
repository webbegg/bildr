import { describe, expect, it } from 'vitest'
import { rovingTarget } from '../../src/editor/rovingKeys.ts'

/** The keys the Data tree (it stops at the ends) and the tab strip (it wraps) share. */

describe('rovingTarget', () => {
  it('moves one along the axis, and Home and End go to the ends', () => {
    expect(rovingTarget('ArrowDown', 1, 4, { axis: 'vertical' })).toBe(2)
    expect(rovingTarget('ArrowUp', 1, 4, { axis: 'vertical' })).toBe(0)
    expect(rovingTarget('ArrowRight', 1, 4, { axis: 'horizontal' })).toBe(2)
    expect(rovingTarget('ArrowLeft', 1, 4, { axis: 'horizontal' })).toBe(0)
    expect(rovingTarget('Home', 2, 4, { axis: 'vertical' })).toBe(0)
    expect(rovingTarget('End', 1, 4, { axis: 'horizontal' })).toBe(3)
  })

  it('stops at the ends when it clamps', () => {
    expect(rovingTarget('ArrowUp', 0, 3, { axis: 'vertical' })).toBe(0)
    expect(rovingTarget('ArrowDown', 2, 3, { axis: 'vertical' })).toBe(2)
  })

  it('goes round when it wraps', () => {
    expect(rovingTarget('ArrowLeft', 0, 3, { axis: 'horizontal', wrap: true })).toBe(2)
    expect(rovingTarget('ArrowRight', 2, 3, { axis: 'horizontal', wrap: true })).toBe(0)
  })

  it('leaves the keys of the other axis, and the other keys, alone', () => {
    expect(rovingTarget('ArrowLeft', 1, 3, { axis: 'vertical' })).toBeNull()
    expect(rovingTarget('ArrowDown', 1, 3, { axis: 'horizontal' })).toBeNull()
    expect(rovingTarget('Enter', 1, 3, { axis: 'vertical' })).toBeNull()
    expect(rovingTarget('ArrowDown', 0, 0, { axis: 'vertical' })).toBeNull()
  })
})
