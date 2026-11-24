import { describe, expect, it } from 'vitest'
import { alignState, cellWrite, distributeWrite, matrixCells } from '../../src/shared/alignMatrix.ts'

/** The active cells as rows of the 3×3 matrix, top to bottom: `x` active, `.` not. */
const picture = (direction: string, justify?: string, items?: string) =>
  [0, 1, 2].map(y => matrixCells(alignState(direction, justify, items)).filter(c => c.y === y).sort((a, b) => a.x - b.x).map(c => (c.active ? 'x' : '.')).join(''))

describe('alignment matrix (layout-containers L2)', () => {
  it('reads a row\'s justify along x and its items along y', () => {
    expect(picture('row', 'start', 'start')).toEqual(['x..', '...', '...'])
    expect(picture('row', 'end', 'center')).toEqual(['...', '..x', '...'])
  })

  it('reads a column\'s justify along y and its items along x', () => {
    expect(picture('col', 'center', 'end')).toEqual(['...', '..x', '...'])
    expect(picture('col', 'end', 'start')).toEqual(['...', '...', 'x..'])
  })

  it('mirrors the main axis of a reversed stack: its start is the far end', () => {
    expect(picture('row-reverse', 'start', 'start')).toEqual(['..x', '...', '...'])
    expect(picture('col-reverse', 'start', 'center')).toEqual(['...', '...', '.x.'])
  })

  it('shows a distributed main axis as the whole line at the cross position', () => {
    expect(picture('row', 'between', 'center')).toEqual(['...', 'xxx', '...'])
    expect(alignState('row', 'evenly', 'center')).toMatchObject({ main: 'distributed', distribution: 'evenly' })
  })

  it('shows stretch as the whole cross line, and both at once as every cell', () => {
    expect(picture('row', 'center', 'stretch')).toEqual(['.x.', '.x.', '.x.'])
    expect(picture('col', 'around', 'stretch')).toEqual(['xxx', 'xxx', 'xxx'])
  })

  it('falls back to CSS: justify start, items stretch; baseline sits at the cross start', () => {
    expect(alignState('row', undefined, undefined)).toMatchObject({ main: 'start', distribution: 'packed', cross: 'stretch' })
    expect(picture('row', 'start', 'baseline')).toEqual(['x..', '...', '...'])
  })

  it('writes a click as the cell\'s justify and items, translated by the axis', () => {
    const cell = (direction: string, x: number, y: number) => matrixCells(alignState(direction, 'start', 'start')).find(c => c.x === x && c.y === y)!
    expect(cellWrite(alignState('row', 'start', 'start'), cell('row', 2, 1))).toEqual({ justify: 'end', items: 'center' })
    expect(cellWrite(alignState('col', 'start', 'start'), cell('col', 2, 1))).toEqual({ justify: 'center', items: 'end' })
    expect(cellWrite(alignState('row-reverse', 'start', 'start'), cell('row-reverse', 2, 0))).toEqual({ justify: 'start', items: 'start' })
  })

  it('keeps a distribution: a click then only moves the cross axis', () => {
    const state = alignState('row', 'between', 'start')
    expect(cellWrite(state, matrixCells(state).find(c => c.x === 0 && c.y === 2)!)).toEqual({ items: 'end' })
  })

  it('stretches with Alt and spreads with a double-click', () => {
    const state = alignState('row', 'start', 'start')
    const center = matrixCells(state).find(c => c.x === 1 && c.y === 1)!
    expect(cellWrite(state, center, 'stretch')).toEqual({ justify: 'center', items: 'stretch' })
    expect(cellWrite(state, center, 'between')).toEqual({ justify: 'between', items: 'center' })
  })

  it('writes Distribute: a spread as its justify, Packed as start where a spread applied', () => {
    expect(distributeWrite(alignState('row', 'center', 'start'), 'around')).toEqual({ justify: 'around' })
    expect(distributeWrite(alignState('row', 'between', 'start'), 'packed')).toEqual({ justify: 'start' })
    expect(distributeWrite(alignState('row', 'center', 'start'), 'packed')).toEqual({})
    expect(distributeWrite(alignState('row', 'evenly', 'start'), 'evenly')).toEqual({})
  })

  it('labels each cell for assistive tech by what it does on that axis', () => {
    const cells = matrixCells(alignState('row', 'start', 'start'))
    expect(cells.find(c => c.x === 0 && c.y === 0)!.label).toBe('Top left')
    expect(cells.find(c => c.x === 1 && c.y === 1)!.label).toBe('Center')
    expect(cells.find(c => c.x === 2 && c.y === 2)!.label).toBe('Bottom right')
  })
})
