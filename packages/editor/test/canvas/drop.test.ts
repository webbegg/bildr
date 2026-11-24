import { describe, expect, it } from 'vitest'
import type { ModelNode } from '../../../codegen/src/model/schemas.ts'
import { dropTarget, gridCell, insertTarget, nearestUnlocked } from '../../src/canvas/drop.ts'

describe('gridCell (layout-containers L4)', () => {
  // Two 100x50 columns 10 apart, in a 210 wide grid at (0, 0).
  const grid = { x: 0, y: 0, width: 210, height: 110 }
  const gap = { x: 10, y: 10 }
  it('is the cell of the child the drop goes before: the drop takes its place', () => {
    expect(gridCell('before', { x: 110, y: 0, width: 100, height: 50 }, grid, gap)).toEqual({ x: 110, y: 0, width: 100, height: 50 })
  })

  it('after the last child, the next cell: beside it, or at the start of the next row when the row is full', () => {
    expect(gridCell('after', { x: 0, y: 0, width: 100, height: 50 }, grid, gap)).toEqual({ x: 110, y: 0, width: 100, height: 50 })
    expect(gridCell('after', { x: 110, y: 0, width: 100, height: 50 }, grid, gap)).toEqual({ x: 0, y: 60, width: 100, height: 50 })
  })
})

/** Where a drag dropped on the canvas goes: a slot of the container under the pointer, by its children's boxes. */

const root: ModelNode = {
  id: 'n_page',
  type: 'Page',
  children: [
    { id: 'n_a', type: 'Text' },
    { id: 'n_row', type: 'Row', children: [{ id: 'n_x', type: 'Button' }, { id: 'n_y', type: 'Button' }] },
    { id: 'n_empty', type: 'Container', children: [] },
    { id: 'n_locked', type: 'Container', locked: true, children: [{ id: 'n_in', type: 'Text' }] }
  ]
}
// A column: n_a (0–40), n_row (50–90, n_x 0–100 and n_y 110–210 across), n_empty (100–140), n_locked (150–190).
const rects: Record<string, DOMRect> = {
  n_page: new DOMRect(0, 0, 400, 200),
  n_a: new DOMRect(0, 0, 400, 40),
  n_row: new DOMRect(0, 50, 400, 40),
  n_x: new DOMRect(0, 50, 100, 40),
  n_y: new DOMRect(110, 50, 100, 40),
  n_empty: new DOMRect(0, 100, 400, 40),
  n_locked: new DOMRect(0, 150, 400, 40),
  n_in: new DOMRect(0, 150, 400, 40)
}
const rectOf = (id: string) => rects[id] ?? null
const isRow = (id: string) => id === 'n_row'

describe('dropTarget', () => {
  it('over a container: the slot among its children nearest the pointer, along its axis', () => {
    expect(dropTarget(root, 'n_row', { x: 20, y: 60 }, rectOf, isRow)).toMatchObject({ parentId: 'n_row', index: 0 })
    expect(dropTarget(root, 'n_row', { x: 105, y: 60 }, rectOf, isRow)).toMatchObject({ parentId: 'n_row', index: 1 })
    expect(dropTarget(root, 'n_row', { x: 300, y: 60 }, rectOf, isRow)).toMatchObject({ parentId: 'n_row', index: 2 })
  })

  it('over an empty container: inside it', () => {
    expect(dropTarget(root, 'n_empty', { x: 10, y: 120 }, rectOf, isRow)).toMatchObject({ parentId: 'n_empty', index: 0, position: 'inside' })
  })

  it('over a leaf: before or after it in its parent, by the half the pointer is in', () => {
    expect(dropTarget(root, 'n_a', { x: 10, y: 5 }, rectOf, isRow)).toMatchObject({ parentId: 'n_page', index: 0, position: 'before', markId: 'n_a' })
    expect(dropTarget(root, 'n_a', { x: 10, y: 35 }, rectOf, isRow)).toMatchObject({ parentId: 'n_page', index: 1, position: 'after', markId: 'n_a' })
    expect(dropTarget(root, 'n_y', { x: 190, y: 60 }, rectOf, isRow)).toMatchObject({ parentId: 'n_row', index: 2, horizontal: true })
  })

  it('a locked node takes no drop: its nearest unlocked ancestor does', () => {
    expect(nearestUnlocked(root, 'n_in')).toBe('n_page')
    expect(dropTarget(root, 'n_in', { x: 10, y: 185 }, rectOf, isRow)).toMatchObject({ parentId: 'n_page', index: 4 })
  })

  it('a node never drops into itself', () => {
    // Dragging the Row over its own Button: around the Row, in its parent.
    expect(dropTarget(root, 'n_x', { x: 10, y: 60 }, rectOf, isRow, 'n_row')).toMatchObject({ parentId: 'n_page', index: 1, markId: 'n_row' })
  })
})

describe('insertTarget', () => {
  // The armed tool's slot (the hosted `insertTargetAt`): a container takes it between the children around the pointer, a leaf right after itself.
  const stacked = [new DOMRect(0, 0, 300, 40), new DOMRect(0, 50, 300, 40)]
  const sideBySide = [new DOMRect(0, 0, 100, 40), new DOMRect(120, 0, 100, 40)]
  const tree: ModelNode = {
    id: 'n_page',
    type: 'Page',
    children: [
      { id: 'n_col', type: 'Column', children: [{ id: 'n_a', type: 'Text' }, { id: 'n_b', type: 'Text' }] },
      { id: 'n_row', type: 'Row', children: [{ id: 'n_x', type: 'Button' }, { id: 'n_y', type: 'Button' }] },
      { id: 'n_empty', type: 'Container', children: [] },
      { id: 'n_locked', type: 'Container', locked: true, children: [{ id: 'n_in', type: 'Text' }] }
    ]
  }

  it('inserts into a clicked container between the children around the pointer', () => {
    expect(insertTarget(tree, 'n_col', { x: 10, y: 10 }, stacked, false)).toMatchObject({ parentId: 'n_col', index: 0, position: 'before', markId: 'n_a' })
    expect(insertTarget(tree, 'n_col', { x: 10, y: 45 }, stacked, false)).toMatchObject({ parentId: 'n_col', index: 1, position: 'before', markId: 'n_b' })
    expect(insertTarget(tree, 'n_col', { x: 10, y: 120 }, stacked, false)).toMatchObject({ parentId: 'n_col', index: 2, position: 'after', markId: 'n_b' })
  })

  it('reads a row container along x', () => {
    expect(insertTarget(tree, 'n_row', { x: 110, y: 20 }, sideBySide, true)).toMatchObject({ parentId: 'n_row', index: 1, position: 'before', markId: 'n_y', horizontal: true })
  })

  it('inserts into an empty container, marking the container itself', () => {
    expect(insertTarget(tree, 'n_empty', { x: 5, y: 5 }, [], false)).toMatchObject({ parentId: 'n_empty', index: 0, position: 'inside', markId: 'n_empty' })
  })

  it('inserts after a clicked leaf, and into the page root at the end', () => {
    expect(insertTarget(tree, 'n_a', { x: 5, y: 5 }, [], false)).toMatchObject({ parentId: 'n_col', index: 1, position: 'after', markId: 'n_a' })
    expect(insertTarget(tree, 'n_page', { x: 5, y: 900 }, [new DOMRect(0, 0, 300, 40)], false)).toMatchObject({ parentId: 'n_page', index: 1, position: 'after', markId: 'n_col' })
  })

  it('is null for an unknown node', () => {
    expect(insertTarget(tree, 'missing', { x: 0, y: 0 }, [], false)).toBeNull()
  })

  it('does not count a child with no box (hidden at this breakpoint, or not rendered) as before the pointer', () => {
    // n_a, then a hidden child, then n_b: a pointer between n_a and n_b inserts after n_a, marked by a child that is on screen.
    const three: ModelNode = { id: 'n_col', type: 'Column', children: [{ id: 'n_a', type: 'Text' }, { id: 'n_h', type: 'Text' }, { id: 'n_b', type: 'Text' }] }
    const hidden = [new DOMRect(0, 0, 300, 40), new DOMRect(0, 0, 0, 0), new DOMRect(0, 100, 300, 40)]
    expect(insertTarget(three, 'n_col', { x: 10, y: 60 }, hidden, false)).toMatchObject({ parentId: 'n_col', index: 1, position: 'before', markId: 'n_b' })
    expect(insertTarget(three, 'n_col', { x: 10, y: 60 }, [hidden[0]!, null, hidden[2]!], false)).toMatchObject({ parentId: 'n_col', index: 1, position: 'before', markId: 'n_b' })
    // A hidden child last: a pointer past the last visible child inserts right after it, not after the hidden one.
    const trailing = [new DOMRect(0, 0, 300, 40), new DOMRect(0, 50, 300, 40), new DOMRect(0, 0, 0, 0)]
    const tail: ModelNode = { id: 'n_col', type: 'Column', children: [{ id: 'n_a', type: 'Text' }, { id: 'n_b', type: 'Text' }, { id: 'n_h', type: 'Text' }] }
    expect(insertTarget(tail, 'n_col', { x: 10, y: 500 }, trailing, false)).toMatchObject({ parentId: 'n_col', index: 2, position: 'after', markId: 'n_b' })
    // Nothing on screen: the end of the container.
    expect(insertTarget(three, 'n_col', { x: 10, y: 60 }, [null, null, null], false)).toMatchObject({ parentId: 'n_col', index: 3, position: 'inside', markId: 'n_col' })
  })

  it('in a wrapping row, a child on a later line is never before a pointer on an earlier line', () => {
    // Line 1 (y 0–40): n_x at x 0–100, n_y at x 120–220. Line 2 (y 50–90): n_z at x 0–100.
    const wrapped: ModelNode = { id: 'n_row', type: 'Row', children: [{ id: 'n_x', type: 'Button' }, { id: 'n_y', type: 'Button' }, { id: 'n_z', type: 'Button' }] }
    const lines = [new DOMRect(0, 0, 100, 40), new DOMRect(120, 0, 100, 40), new DOMRect(0, 50, 100, 40)]
    // On line 1, right of n_y's middle but with n_z (line 2, x past the pointer or not) not before: the slot is before n_z.
    expect(insertTarget(wrapped, 'n_row', { x: 300, y: 10 }, lines, true)).toMatchObject({ index: 2, position: 'before', markId: 'n_z' })
    // On line 1, left of n_x's middle: first.
    expect(insertTarget(wrapped, 'n_row', { x: 10, y: 10 }, lines, true)).toMatchObject({ index: 0, markId: 'n_x' })
    // On line 2, right of n_z: after everything.
    expect(insertTarget(wrapped, 'n_row', { x: 300, y: 60 }, lines, true)).toMatchObject({ index: 3, position: 'after', markId: 'n_z' })
    // On line 2, left of n_z's middle: the children of line 1 are before it.
    expect(insertTarget(wrapped, 'n_row', { x: 10, y: 60 }, lines, true)).toMatchObject({ index: 2, position: 'before', markId: 'n_z' })
  })
})
