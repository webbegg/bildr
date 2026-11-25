import { describe, expect, it } from 'vitest'
import { fillCount, spanPatch, tokenAt, trackRects, trackStep, trackSizes } from '../src/gridTracks.ts'

describe('grid edit mode (layout-containers L6)', () => {
  it('reads a token where a frame renders: the base, overridden by each breakpoint up to it', () => {
    const style = { 'cols': '1', 'md:cols': '3' }
    expect(tokenAt(style, 'cols', undefined, 'mobile')).toBe('1')
    expect(tokenAt(style, 'cols', 'sm', 'mobile')).toBe('1')
    expect(tokenAt(style, 'cols', 'lg', 'mobile')).toBe('3')
    expect(tokenAt({ 'cols': '4', 'max-md:cols': '2' }, 'cols', 'max-sm', 'desktop')).toBe('2')
    expect(tokenAt({ 'cols': '4', 'max-md:cols': '2' }, 'cols', 'max-lg', 'desktop')).toBe('4')
    expect(tokenAt({}, 'rows', 'md', 'mobile')).toBeUndefined()
  })

  it('reads the resolved track sizes of a grid template', () => {
    expect(trackSizes('98px 98.5px 98px')).toEqual([98, 98.5, 98])
    expect(trackSizes('none')).toEqual([])
    expect(trackSizes('')).toEqual([])
  })

  it('lays the track headers along the content box, the gaps between them', () => {
    const content = { x: 10, y: 20, width: 320, height: 100 }
    expect(trackRects(content, [100, 100, 100], 10, 'col')).toEqual([
      { x: 10, y: 20, width: 100, height: 100 },
      { x: 120, y: 20, width: 100, height: 100 },
      { x: 230, y: 20, width: 100, height: 100 }
    ])
    expect(trackRects(content, [40, 50], 10, 'row')).toEqual([
      { x: 10, y: 20, width: 320, height: 40 },
      { x: 10, y: 70, width: 320, height: 50 }
    ])
  })

  it('adds or removes a track along the token\'s values; rows start from the count shown, a set count goes back to auto at one', () => {
    expect(trackStep('cols', '3', 3, 1)).toBe('4')
    expect(trackStep('cols', '3', 3, -1)).toBe('2')
    expect(trackStep('cols', '6', 6, 1)).toBe('12')
    expect(trackStep('cols', '12', 12, -1)).toBe('6')
    expect(trackStep('cols', '12', 12, 1)).toBeUndefined()
    expect(trackStep('cols', '1', 1, -1)).toBeUndefined()
    // A Grid with no cols token renders its default (measured).
    expect(trackStep('cols', undefined, 2, 1)).toBe('3')
    expect(trackStep('cols', 'auto-fit', 4, 1)).toBeUndefined()
    // Implicit rows: + makes the count explicit, − has nothing to remove.
    expect(trackStep('rows', undefined, 2, 1)).toBe('3')
    expect(trackStep('rows', undefined, 2, -1)).toBeUndefined()
    expect(trackStep('rows', '2', 2, -1)).toBe('1')
    expect(trackStep('rows', '1', 1, -1)).toBeNull()
    expect(trackStep('rows', '6', 6, 1)).toBeUndefined()
  })

  it('spans a grid child by the tracks its edge is dragged across, Full at the column count', () => {
    const drag = { handle: 'e' as const, breakpoint: undefined, col: { track: 100, gap: 10, count: 3, span: 1 }, row: { track: 40, gap: 10, count: 2, span: 1 } }
    expect(spanPatch(drag, { dx: 30, dy: 0 })).toEqual({})
    expect(spanPatch(drag, { dx: 80, dy: 0 })).toEqual({ colSpan: '2' })
    expect(spanPatch(drag, { dx: 220, dy: 0 })).toEqual({ colSpan: 'full' })
    expect(spanPatch(drag, { dx: 900, dy: 0 })).toEqual({ colSpan: 'full' })
    expect(spanPatch({ ...drag, col: { ...drag.col, span: 2 } }, { dx: -80, dy: 0 })).toEqual({ colSpan: '1' })
    // A left edge spans as it moves out; the bottom edge spans rows, at the breakpoint.
    expect(spanPatch({ ...drag, handle: 'w' }, { dx: -80, dy: 0 })).toEqual({ colSpan: '2' })
    expect(spanPatch({ ...drag, handle: 's', breakpoint: 'md' }, { dx: 0, dy: 60 })).toEqual({ 'md:rowSpan': '2' })
    expect(spanPatch({ ...drag, handle: 'se' }, { dx: 80, dy: 60 })).toEqual({ colSpan: '2', rowSpan: '2' })
    // 12 columns: spans past 6 snap to the nearest value the token has.
    expect(spanPatch({ ...drag, col: { track: 10, gap: 0, count: 12, span: 1 } }, { dx: 75, dy: 0 })).toEqual({ colSpan: '6' })
  })

  it('counts the empty cells appended children fill: up to the last row, or the set rows', () => {
    expect(fillCount(3, undefined, [{}, {}, {}, {}])).toBe(2)
    expect(fillCount(3, undefined, [{}, {}, {}])).toBe(0)
    expect(fillCount(3, undefined, [])).toBe(0)
    expect(fillCount(3, 2, [])).toBe(6)
    expect(fillCount(3, undefined, [{ colSpan: 2 }, {}, {}])).toBe(2)
    expect(fillCount(3, undefined, [{ colSpan: 'full' }, {}])).toBe(2)
    // A child two rows tall takes a cell of the next row too.
    expect(fillCount(3, undefined, [{ rowSpan: 2 }, {}, {}])).toBe(2)
    expect(fillCount(2, 3, [{ colSpan: 2 }])).toBe(4)
  })
})
