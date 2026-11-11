import { describe, expect, it } from 'vitest'
import { createNode, createPage } from '#shared/document/factory'
import { canDragNode, isNoopMove, pastThreshold, REORDER_THRESHOLD, reorderTarget } from '#shared/editor/reorder'

function fixture() {
  const page = createPage('Home')
  const row = createNode('Row')
  const [a, b, c] = [createNode('Text'), createNode('Text'), createNode('Text')]
  row.children.push(a, b, c)
  const column = createNode('Column')
  const inner = createNode('Text')
  column.children.push(inner)
  page.root.children.push(row, column)
  return { root: page.root, row, a, b, c, column, inner }
}

// Canvas rects: the Row's texts side by side, the Column below them.
const RECTS: Record<string, { top: number, left: number, width: number, height: number }> = {}
const rectOf = (id: string) => RECTS[id] ?? null

describe('pastThreshold', () => {
  it('starts a drag only beyond 4px of travel', () => {
    expect(REORDER_THRESHOLD).toBe(4)
    expect(pastThreshold({ x: 0, y: 0 }, { x: 3, y: 2 })).toBe(false)
    expect(pastThreshold({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false)
    expect(pastThreshold({ x: 0, y: 0 }, { x: 4, y: 1 })).toBe(true)
  })
})

describe('canDragNode', () => {
  it('drags an unlocked node that is not the root', () => {
    const { root, a, row } = fixture()
    expect(canDragNode(root, a.id)).toBe(true)
    expect(canDragNode(root, root.id)).toBe(false)
    expect(canDragNode(root, 'missing')).toBe(false)
    a.locked = true
    expect(canDragNode(root, a.id)).toBe(false)
    a.locked = undefined
    row.locked = true
    expect(canDragNode(root, a.id)).toBe(false)
  })
})

describe('reorderTarget', () => {
  it('reorders among the siblings of a row along the x axis', () => {
    const { root, row, a, b, c } = fixture()
    Object.assign(RECTS, {
      [a.id]: { top: 0, left: 0, width: 100, height: 20 },
      [b.id]: { top: 0, left: 100, width: 100, height: 20 },
      [c.id]: { top: 0, left: 200, width: 100, height: 20 }
    })
    // Over the right half of C: after it, at the end.
    expect(reorderTarget(root, { id: c.id, placeholder: false }, { x: 280, y: 10 }, undefined, a.id, rectOf))
      .toMatchObject({ target: { parentId: row.id, index: 3 }, nodeId: c.id, position: 'after', horizontal: true })
    // Over the left half of B: before it.
    expect(reorderTarget(root, { id: b.id, placeholder: false }, { x: 110, y: 10 }, undefined, c.id, rectOf))
      .toMatchObject({ target: { parentId: row.id, index: 1 }, position: 'before' })
  })

  it('drops into another container through its middle', () => {
    const { root, column, a } = fixture()
    RECTS[column.id] = { top: 100, left: 0, width: 300, height: 100 }
    expect(reorderTarget(root, { id: column.id, placeholder: false }, { x: 50, y: 150 }, undefined, a.id, rectOf))
      .toMatchObject({ target: { parentId: column.id, index: 1 }, position: 'inside', horizontal: false })
  })

  it('never drops a node into itself', () => {
    const { root, column, inner } = fixture()
    RECTS[inner.id] = { top: 100, left: 0, width: 300, height: 20 }
    expect(reorderTarget(root, { id: inner.id, placeholder: false }, { x: 10, y: 105 }, undefined, column.id, rectOf)).toBeNull()
    expect(reorderTarget(root, { id: column.id, placeholder: false }, { x: 10, y: 150 }, undefined, column.id, rectOf)).toBeNull()
  })

  it('redirects a locked target to its nearest unlocked ancestor, measured there', () => {
    const { root, column, inner, a } = fixture()
    inner.locked = true
    RECTS[column.id] = { top: 100, left: 0, width: 300, height: 100 }
    const hit = reorderTarget(root, { id: inner.id, placeholder: false }, { x: 50, y: 150 }, undefined, a.id, (id, redirected) => (redirected && id === column.id ? RECTS[column.id]! : null))
    expect(hit).toMatchObject({ nodeId: column.id, target: { parentId: column.id, index: 1 } })
  })

  it('nothing under a locked root', () => {
    const { root, a, b } = fixture()
    root.locked = true
    expect(reorderTarget(root, { id: b.id, placeholder: false }, { x: 110, y: 10 }, undefined, a.id, rectOf)).toBeNull()
  })
})

describe('isNoopMove', () => {
  it('is a no-op when the node would land where it is', () => {
    const { root, row, a, b } = fixture()
    expect(isNoopMove(root, a.id, { parentId: row.id, index: 0 })).toBe(true)
    expect(isNoopMove(root, a.id, { parentId: row.id, index: 1 })).toBe(true)
    expect(isNoopMove(root, a.id, { parentId: row.id, index: 2 })).toBe(false)
    expect(isNoopMove(root, b.id, { parentId: row.id, index: 0 })).toBe(false)
  })
})
