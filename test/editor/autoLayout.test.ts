import { describe, expect, it } from 'vitest'
import { inferAutoLayout, nearestSpacingToken } from '#shared/editor/autoLayout'

const box = (id: string, x: number, y: number, width = 100, height = 40) => ({ id, x, y, width, height })

describe('inferAutoLayout', () => {
  it('lays side-by-side boxes out in a row, in visual order, with their gap', () => {
    const layout = inferAutoLayout([box('b', 124, 0), box('a', 0, 0)])
    expect(layout).toEqual({ direction: 'row', gapPx: 24, order: ['a', 'b'] })
  })

  it('lays stacked boxes out in a column, with the median gap', () => {
    const layout = inferAutoLayout([box('a', 0, 0, 200, 20), box('c', 0, 40, 120, 20), box('b', 0, 28, 160, 4), box('d', 0, 100, 200, 20)])
    expect(layout.direction).toBe('col')
    expect(layout.order).toEqual(['a', 'b', 'c', 'd'])
    // Gaps 8, 8 and 40: the median ignores the outlier.
    expect(layout.gapPx).toBe(8)
  })

  it('averages the two middle gaps of an even count', () => {
    expect(inferAutoLayout([box('a', 0, 0), box('b', 0, 52), box('c', 0, 112)]).gapPx).toBe(16)
  })

  it('prefers a row when boxes share more height than width, even with uneven heights', () => {
    const layout = inferAutoLayout([box('a', 0, 0, 80, 200), box('b', 96, 50, 80, 40)])
    expect(layout).toMatchObject({ direction: 'row', gapPx: 16 })
  })

  it('counts overlapping boxes as no gap', () => {
    expect(inferAutoLayout([box('a', 0, 0), box('b', 90, 0)]).gapPx).toBe(0)
  })

  it('makes a single box a gapless column', () => {
    expect(inferAutoLayout([box('a', 10, 10)])).toEqual({ direction: 'col', gapPx: 0, order: ['a'] })
  })

  it('breaks a tie between diagonal boxes by the wider spread', () => {
    expect(inferAutoLayout([box('a', 0, 0), box('b', 300, 50)]).direction).toBe('row')
    expect(inferAutoLayout([box('a', 0, 0), box('b', 110, 300)]).direction).toBe('col')
  })
})

describe('nearestSpacingToken', () => {
  it('maps px to the nearest gap token at the default density (4px)', () => {
    expect(nearestSpacingToken(12, 'default')).toBe('3')
    expect(nearestSpacingToken(13, 'default')).toBe('3')
    expect(nearestSpacingToken(24, 'default')).toBe('6')
    expect(nearestSpacingToken(0, 'default')).toBe('0')
  })

  it('takes the smaller token on a tie', () => {
    // 14px sits between 3 (12px) and 4 (16px).
    expect(nearestSpacingToken(14, 'default')).toBe('3')
  })

  it('follows the project spacing density', () => {
    expect(nearestSpacingToken(24, 'comfortable')).toBe('5')
    expect(nearestSpacingToken(24, 'compact')).toBe('8')
  })

  it('clamps beyond the scale', () => {
    expect(nearestSpacingToken(1000, 'default')).toBe('32')
    expect(nearestSpacingToken(-5, 'default')).toBe('0')
  })
})
